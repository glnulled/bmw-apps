'use strict';

// Customizer (glnulled_customizer): the driving mode's names, DSC (traction / off), the config and its move to the
// new defaults, the pictures, the layers it asks cluster-render for (DSC OFF blinking by visibility only), the
// service with stand-in signals, the page, and the whole path over a socket to the desk's stand-in of cluster-render
// (kit/tools/fake_cluster_render.js) with the real client. No SDK or car needed:
//   node kit/tools/test_glnulled_customizer.js [out-dir]      (out-dir: also the page, the badges and the cluster as PNG)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Module = require('module');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const kit = path.join(ROOT, 'kit/runtime');
const APP = path.join(ROOT, 'apps/glnulled_customizer');
const { Recorder, play } = require(path.join(kit, 'record'));
const { Canvas } = require(path.join(kit, 'canvas'));
const themes = require(path.join(kit, 'themes'));
const OUT = process.argv[2];
const tmps = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'customizer-')); tmps.push(d); return d; };
process.on('exit', () => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

let failed = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); }
};

const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './kit/mgu') return { run() {} };
    if (req.startsWith('./kit/')) return load.call(this, path.join(kit, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const { modeOf, nameOf } = require(path.join(APP, 'modes'));
const { stabilityOf } = require(path.join(APP, 'stability'));
const { Config, DEFAULTS } = require(path.join(APP, 'config'));
const { modeBadge, dscOff } = require(path.join(APP, 'draw'));
const { Overlay, changedBox } = require(path.join(APP, 'overlay'));
const { Customizer } = require(path.join(APP, 'service'));
const { createApp } = require(path.join(APP, 'main'));
const { ClusterRender } = require(path.join(APP, 'cluster_render_client'));
Module._load = load;

const quiet = { info() {}, warn() {}, error() {} };

/** a ClusterRender stand-in that records what it is asked */
function fakeCr() {
    const ev = new (require('events'))();
    let ref = 0;
    const cr = Object.assign(ev, {
        ops: [], layers: {},
        connect() { cr.ops.push(['connect']); },
        close() { cr.ops.push(['close']); },
        image(o) { const r = ++ref; cr.layers[r] = Object.assign({ kind: 'image', visible: true }, o); cr.ops.push(['image', r, o]); return r; },
        set(r, o) { Object.assign(cr.layers[r], o); cr.ops.push(['set', r, o]); },
        drop(r) { delete cr.layers[r]; cr.ops.push(['drop', r]); },
        pixels(r, rects, px) { cr.ops.push(['pixels', r, rects, px.length]); return true; },
    });
    return cr;
}
/** the car's SOME/IP, stood in: watch() hands back the handlers so a test can send values */
function fakeSignals() {
    const s = { handlers: {} };
    s.watch = async (iface, inst, h) => { s.handlers[iface.split('.').pop()] = h; return { available: true }; };
    return s;
}
const MODE = (name) => ({ displayModeDrivingExperience: name, actualValueModeDrivingExperience: 'SIGNAL_UNBEFUELLT' });

(async () => {
    await check('modes: names, wire numbers and structs; the display mode first; nothing for unfilled', () => {
        assert.strictEqual(modeOf(MODE('COMFORT_PLUS')).label, 'COMFORT+');
        assert.strictEqual(modeOf({ displayModeDrivingExperience: 3 }).label, 'SPORT IND');
        assert.strictEqual(modeOf({ displayModeDrivingExperience: 'SIGNAL_UNBEFUELLT', actualValueModeDrivingExperience: 4 }).label, 'COMFORT');
        assert.strictEqual(modeOf({ displayModeDrivingExperience: 'INITIALISIERUNG' }), null);
        assert.strictEqual(modeOf(MODE('TRACTION_ASSIST')).label, 'TRACTION');
        assert.strictEqual(nameOf({ value: 10 }), 'ADAPTIVE');
    });

    await check('stability: traction or off, off wins, from any of the three statuses; full shows nothing', () => {
        const k = (o) => { const r = stabilityOf(o); return r && r.kind; };
        assert.strictEqual(k({ dsc: { displayStatusDSC2: 'DSC_EIN' }, avail: { modeDSCAvailability: 'VOLL' } }), null);
        assert.strictEqual(k({ dsc: { displayStatusDSC2: 'TRAKTIONSMODUS_EIN' } }), 'traction');
        assert.strictEqual(k({ dsc: { displayStatusDSC2: 4 } }), 'traction');
        assert.strictEqual(k({ avail: { modeDSCAvailability: 'MID' } }), 'traction');
        assert.strictEqual(k({ avail: { modeDSCAvailability: 6 } }), 'traction');
        assert.strictEqual(k({ fes: { displayAvailibilityModeDrivingExperience: 13 } }), 'traction');
        assert.strictEqual(k({ dsc: { displayStatusDSC2: 'DSC_AUS' }, avail: { modeDSCAvailability: 'TRAKTION' } }), 'off');
        assert.strictEqual(k({ avail: { modeDSCAvailability: 'KEINE' } }), 'off');
        assert.strictEqual(k({ fes: { displayAvailibilityModeDrivingExperience: 'STABILISIERUNGSFUNKTIONEN_DURCH_KUNDENWUNSCH_ABGESCHALTET' } }), 'off');
        assert.strictEqual(k({ fes: { displayAvailibilityModeDrivingExperience: 12 } }), null);
    });

    await check('config: the defaults (x 1212 y 658, 192 x 62, size 28); a version 1 file keeps its switches, not its box', () => {
        const dir = tmpDir();
        assert.deepStrictEqual([DEFAULTS.mode.x, DEFAULTS.mode.y, DEFAULTS.mode.w, DEFAULTS.mode.h, DEFAULTS.mode.size], [1212, 658, 192, 62, 28]);
        fs.writeFileSync(path.join(dir, 'customizer.json'), JSON.stringify({ version: 1, mode: { on: true, x: 1252, y: 628, w: 192, h: 62, size: 38, style: 'white' }, widget: { on: true }, draw: { on: true } }));
        const c = new Config(dir, quiet);
        assert.deepStrictEqual([c.get().mode.x, c.get().mode.y, c.get().mode.size, c.get().mode.style], [1212, 658, 28, 'white']);
        assert.strictEqual(c.get().widget, undefined);
        c.change((x) => { x.mode.x = 1300; x.mode.size = 30; });
        const again = new Config(dir, quiet).get().mode;
        assert.deepStrictEqual([again.x, again.size], [1300, 30], 'a version 2 file keeps its box');
        c.resetBox();
        assert.deepStrictEqual([c.get().mode.x, c.get().mode.size], [1212, 28]);
        fs.writeFileSync(path.join(dir, 'customizer.json'), JSON.stringify({ version: 1, mode: { on: true }, draw: { on: false } }));
        assert.strictEqual(new Config(dir, quiet).get().mode.on, false, 'version 1 drawing off stays off');
    });

    await check('pictures: plate black edge to edge; TRACTION in orange under the mode; with DSC off the mode stays, DSC OFF red on nothing', () => {
        const cfg = new Config(tmpDir(), quiet).get().mode;
        const px = (cv, x, y) => Array.from(cv.d.slice((y * cfg.w + x) * 4, (y * cfg.w + x) * 4 + 4));
        const has = (cv, rgb) => { for (let i = 0; i < cv.d.length; i += 4) if (cv.d[i] === rgb[0] && cv.d[i + 1] === rgb[1] && cv.d[i + 2] === rgb[2]) return true; return false; };
        const plain = modeBadge(cfg, modeOf(MODE('COMFORT')), null);
        assert.deepStrictEqual(px(plain, 0, 0), [0, 0, 0, 255], 'square corners: nothing of the stock text shows');
        assert.deepStrictEqual(px(plain, cfg.w - 1, cfg.h - 1), [0, 0, 0, 255]);
        const trac = modeBadge(cfg, modeOf(MODE('SPORT_DYNAMIC')), { kind: 'traction' });
        assert(has(trac, [255, 138, 0]), 'orange TRACTION');
        const off = modeBadge(cfg, modeOf(MODE('SPORT_DYNAMIC')), { kind: 'off' });
        assert(has(off, [255, 59, 47]), 'DSC off: the mode stays, in its colour');
        assert(!has(off, [255, 138, 0]) && !has(off, [255, 42, 42]), 'and nothing on the bottom line (DSC OFF is its own layer)');
        const lowest = (cv) => { for (let y = cfg.h - 1; y >= 0; y--) for (let x = 0; x < cfg.w; x++) { const p = px(cv, x, y); if (p[0] > 128) return y; } return -1; };
        const highest = (cv) => { for (let y = 0; y < cfg.h; y++) for (let x = 0; x < cfg.w; x++) { const p = px(cv, x, y); if (p[0] > 128 && p[3] > 0) return y; } return -1; };
        const d = dscOff(cfg, modeOf(MODE('SPORT_DYNAMIC')));
        assert(has(d, [255, 42, 42]), 'red DSC OFF');
        assert.strictEqual(px(d, 0, 0)[3], 0, 'DSC OFF on nothing');
        assert(highest(d) > lowest(off), 'DSC OFF under the mode, not over it');
        if (OUT) {
            fs.mkdirSync(OUT, { recursive: true });
            const rows = [['COMFORT', null], ['COMFORT_PLUS', null], ['SPORT_DYNAMIC', null], ['SPORT_INDIVIDUAL', null], ['ECO_PRO_EFFICIENT', null],
                ['SPORT_DYNAMIC', { kind: 'traction' }], ['COMFORT_PLUS', { kind: 'traction' }], ['SPORT_EXPERT', { kind: 'off' }]];
            const sheet = new Canvas(rows.length * (cfg.w + 12) + 12, cfg.h + 24).clear('#303030');
            rows.forEach(([m, s], i) => {
                const b = modeBadge(cfg, modeOf(MODE(m)), s);
                sheet.blit(b, 12 + i * (cfg.w + 12), 12);
                if (s && s.kind === 'off') sheet.blit(dscOff(cfg), 12 + i * (cfg.w + 12), 12);
            });
            fs.writeFileSync(path.join(OUT, 'customizer-badges.png'), sheet.png());
        }
    });

    await check('overlay: one layer on the panel in the box, sent whole once, then only the change; nothing when nothing changed', () => {
        const cr = fakeCr(), o = new Overlay(cr, quiet), cfg = new Config(tmpDir(), quiet).get();
        o.update({ cfg, mode: modeOf(MODE('COMFORT')), stab: null, blinkOn: true });
        const imgs = cr.ops.filter((x) => x[0] === 'image');
        assert.strictEqual(imgs.length, 1);
        assert.deepStrictEqual([imgs[0][2].target, imgs[0][2].klass, imgs[0][2].x, imgs[0][2].y, imgs[0][2].w, imgs[0][2].h], ['panel', 'overlay', 1212, 658, 192, 62]);
        assert.strictEqual(cr.ops.filter((x) => x[0] === 'pixels')[0][3], 192 * 62 * 4);
        cr.ops.length = 0;
        o.update({ cfg, mode: modeOf(MODE('COMFORT')), stab: null, blinkOn: true });
        assert.strictEqual(cr.ops.length, 0);
        o.update({ cfg, mode: modeOf(MODE('SPORT_DYNAMIC')), stab: null, blinkOn: true });
        const upd = cr.ops.filter((x) => x[0] === 'pixels');
        assert(upd.length === 1 && upd[0][2].length === 1 && upd[0][3] < 192 * 62 * 4);
    });

    await check('overlay: DSC OFF is a second layer over the badge; blinking only shows and hides it (no pixels)', () => {
        const cr = fakeCr(), o = new Overlay(cr, quiet), cfg = new Config(tmpDir(), quiet).get(), m = modeOf(MODE('SPORT_EXPERT'));
        o.update({ cfg, mode: m, stab: { kind: 'off' }, blinkOn: true });
        const imgs = cr.ops.filter((x) => x[0] === 'image');
        assert.strictEqual(imgs.length, 2);
        assert(imgs[1][2].z > imgs[0][2].z, 'over the badge');
        cr.ops.length = 0;
        o.update({ cfg, mode: m, stab: { kind: 'off' }, blinkOn: false });
        assert.deepStrictEqual(cr.ops, [['set', 2, { visible: false }]]);
        cr.ops.length = 0;
        o.update({ cfg, mode: m, stab: { kind: 'off' }, blinkOn: true });
        assert.deepStrictEqual(cr.ops, [['set', 2, { visible: true }]]);
        // blink off in the settings: steady
        cfg.mode.blink = false; cr.ops.length = 0;
        o.update({ cfg, mode: m, stab: { kind: 'off' }, blinkOn: false });
        assert(!cr.ops.some((x) => x[0] === 'set' && x[2].visible === false));
        // DSC back on: the DSC OFF layer hidden, the badge shows the mode again
        cr.ops.length = 0;
        o.update({ cfg, mode: m, stab: null, blinkOn: true });
        assert(cr.ops.some((x) => x[0] === 'set' && x[1] === 2 && x[2].visible === false));
        assert(cr.ops.some((x) => x[0] === 'pixels' && x[1] === 1));
    });

    await check('overlay: moving the box moves the layers, resizing makes them again', () => {
        const cr = fakeCr(), o = new Overlay(cr, quiet), c = new Config(tmpDir(), quiet), m = modeOf(MODE('COMFORT'));
        o.update({ cfg: c.get(), mode: m, stab: null, blinkOn: true });
        c.change((x) => { x.mode.x += 10; });
        cr.ops.length = 0; o.update({ cfg: c.get(), mode: m, stab: null, blinkOn: true });
        assert.deepStrictEqual(cr.ops[0], ['set', 1, { x: 1222, y: 658 }]);
        c.change((x) => { x.mode.w += 10; });
        cr.ops.length = 0; o.update({ cfg: c.get(), mode: m, stab: null, blinkOn: true });
        assert.deepStrictEqual(cr.ops.slice(0, 2).map((x) => x[0]), ['drop', 'image']);
    });

    await check('changedBox: the box around what changed', () => {
        const a = Buffer.alloc(10 * 5 * 4), b = Buffer.from(a);
        b[(2 * 10 + 3) * 4] = 9; b[(4 * 10 + 7) * 4 + 3] = 9;
        assert.deepStrictEqual(changedBox(b, a, 10, 5), { x: 3, y: 2, w: 5, h: 3 });
        assert.strictEqual(changedBox(a, a, 10, 5), null);
    });

    await check('service: the car\'s mode and DSC; DSC OFF blinks every half second; off closes the connection', async () => {
        const sig = fakeSignals(), cr = fakeCr();
        const s = await new Customizer({ signals: sig, log: quiet, dataDir: tmpDir(), client: cr }).start();
        assert(cr.ops.some((x) => x[0] === 'connect'));
        sig.handlers.FES.statusFESVehicleDynamicSwitchHMI(MODE('COMFORT_PLUS'));
        assert.strictEqual(s.st.mode.label, 'COMFORT+');
        sig.handlers.FES.statusDSCSwitchHMI({ displayStatusDSC2: 'TRAKTIONSMODUS_EIN', counterControlDisplayStatusDSC: 'SIGNAL_UNBEFUELLT' });
        assert.strictEqual(s.st.stab.kind, 'traction');
        sig.handlers.FES.statusDSCSwitchHMI({ displayStatusDSC2: 'DSC_AUS' });
        assert.strictEqual(s.st.stab.kind, 'off');
        await new Promise((r) => setTimeout(r, 1100));
        const blinks = cr.ops.filter((x) => x[0] === 'set' && 'visible' in x[2] && x[1] === 2).length;
        assert(blinks >= 2, 'blinked ' + blinks + ' times in 1.1 s');
        sig.handlers.FES.statusDSCSwitchHMI({ displayStatusDSC2: 'DSC_EIN' });
        assert.strictEqual(s.st.stab, null);
        assert.strictEqual(s._blinkTimer, null);
        s.config.change((c) => { c.mode.on = false; });
        assert(cr.ops.some((x) => x[0] === 'close'));
        // Off drops every layer in the client (it makes again what it keeps), before the close; On makes one badge, not two
        assert.strictEqual(Object.keys(cr.layers).length, 0, 'layers left in the client after Off: ' + Object.keys(cr.layers));
        const names = cr.ops.map((x) => x[0]);
        assert(names.lastIndexOf('drop') < names.lastIndexOf('close'), 'the drops go before the close');
        s.config.change((c) => { c.mode.on = true; });
        assert.strictEqual(Object.keys(cr.layers).length, 1, 'one badge after Off and On, got ' + Object.keys(cr.layers).length);
        s.stop();
    });

    await check('page: draws; the arrows move the box; the switches change the config; the picture', async () => {
        const sig = fakeSignals();
        const s = await new Customizer({ signals: sig, log: quiet, dataDir: tmpDir(), client: fakeCr() }).start();
        sig.handlers.FES.statusFESVehicleDynamicSwitchHMI(MODE('SPORT_DYNAMIC'));
        sig.handlers.FES.statusDSCSwitchHMI({ displayStatusDSC2: 'TRAKTIONSMODUS_EIN' });
        let last = null;
        const a = createApp({ log: quiet, theme: () => themes.theme('m_tricolour'), settings: { get() {}, onChange() {} }, ui: { image: async () => {} },
            canvas: (w, h) => { last = new Recorder(w, h); last.own = true; return last; } }, s);
        const press = async (k) => { await a.render(); const t = last.targets.find((x) => x.key === k); assert(t, 'no ' + k + ' in ' + last.targets.map((x) => x.key).join(' ')); await t.run(); };
        if (OUT) { await a.render(); const c = new Canvas(1600, 520); play(last.words(), c); fs.writeFileSync(path.join(OUT, 'customizer-page.png'), c.png()); }
        await press('right');
        assert.strictEqual(s.config.get().mode.x, 1222);
        await press('step'); await press('up');
        assert.strictEqual(s.config.get().mode.y, 657);
        await press('size+');
        assert.strictEqual(s.config.get().mode.size, 29);
        await press('blink');
        assert.strictEqual(s.config.get().mode.blink, false);
        await press('stability');
        assert.strictEqual(s.config.get().mode.stability, false);
        assert(!last.targets.some((x) => /grid|frame|test|widget|debug/i.test(x.key)), 'no debug controls left');
        s.stop();
    });

    await check('end to end: the real client over a socket to the stand-in cluster-render; DSC OFF blinks there; a service restart', async () => {
        const sock = path.join(tmpDir(), 'cr.sock'), port = 18090 + Math.floor(Math.random() * 500);
        const srv = spawn(process.execPath, [path.join(__dirname, 'fake_cluster_render.js'), '--sock', sock, '--port', String(port)], { stdio: 'ignore' });
        const get = (p) => new Promise((res, rej) => http.get('http://127.0.0.1:' + port + p, (r) => { const b = []; r.on('data', (d) => b.push(d)); r.on('end', () => res(Buffer.concat(b))); }).on('error', rej));
        const wait = async (fn, ms) => { const end = Date.now() + (ms || 4000); for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 60)); } };
        try {
            await wait(() => fs.existsSync(sock));
            const sig = fakeSignals();
            const s = await new Customizer({ signals: sig, log: quiet, dataDir: tmpDir(), client: new ClusterRender('test_customizer', sock) }).start();
            sig.handlers.FES.statusFESVehicleDynamicSwitchHMI(MODE('COMFORT_PLUS'));
            assert(await wait(() => /^shown/.test(s.overlay.status().layer.mode || '')), 'mode shown: ' + JSON.stringify(s.overlay.status()));
            const logText = String(await get('/log'));
            assert(/image \d+ on panel at 1212,658 192x62 class overlay/.test(logText), logText);
            if (OUT) fs.writeFileSync(path.join(OUT, 'customizer-fake-panel.png'), await get('/panel.png'));
            sig.handlers.FES.statusDSCSwitchHMI({ displayStatusDSC2: 'DSC_AUS' });
            assert(await wait(() => /shown|hidden/.test(s.overlay.status().layer.dscOff || '')), 'DSC OFF layer');
            const states = new Set();
            await wait(() => { states.add(s.overlay.status().layer.dscOff); return states.has('shown') && states.has('hidden'); }, 3000);
            assert(states.has('shown') && states.has('hidden'), 'blinks on the stand-in: ' + [...states].join(','));
            await get('/act?do=drop');
            assert(await wait(() => s.overlay.status().connected && /^shown/.test(s.overlay.status().layer.mode || ''), 6000), 'back after the service restarted');
            // Off and On twice: the client makes again only the layers of now (they piled up, one more badge each time)
            for (let i = 0; i < 2; i++) {
                s.config.change((c) => { c.mode.on = false; });
                await new Promise((r) => setTimeout(r, 150));
                s.config.change((c) => { c.mode.on = true; });
                assert(await wait(() => s.overlay.status().connected && /^shown/.test(s.overlay.status().layer.mode || ''), 6000), 'back after Off and On');
            }
            assert.strictEqual(s.cr.layers.size, 2, 'the client keeps the badge and DSC OFF, got ' + s.cr.layers.size + ' layers');
            s.stop();
        } finally { srv.kill(); }
    });

    if (failed) { console.log(failed + ' failed'); process.exit(1); }
    console.log('all passed' + (OUT ? ', pictures in ' + OUT : ''));
    process.exit(0);
})();
