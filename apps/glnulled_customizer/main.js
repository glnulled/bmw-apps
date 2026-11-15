'use strict';
/**
 * Customizer - the driving mode on the iDrive 7 instrument cluster, over the stock picture (through cluster-render),
 * for clusters coded to a layout that shows none (the M layout on another car), with the stability control:
 * TRACTION under the mode in the traction mode, DSC OFF under it (blinking) when it is off.
 *
 * The page: the mode on or off, DSC / traction shown, DSC OFF blinking, colours, text size, alignment, background;
 * where its box is (arrows, size, Reset) with a map of the cluster; a preview.
 * The work runs from the platform's start (app.json "autostart"): service.js, with or without this screen.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const { Customizer } = require('./service');
const { PANEL } = require('./config');
const { ORANGE, RED } = require('./draw');

const W = 1600, H = 520;

function makeClient(log) {
    let ClusterRender = null;
    try { ClusterRender = require('./cluster_render_client').ClusterRender; } catch (e) { log.warn('customizer: cluster_render_client.js: ' + e); return null; }
    // CLUSTER_RENDER_SOCK: the desk's stand-in (kit/tools/fake_cluster_render.js); on the car the service's own socket
    return new ClusterRender('glnulled_customizer', process.env.CLUSTER_RENDER_SOCK || undefined);
}

async function background(bg) {
    const svc = new Customizer({ signals: bg.signals, log: bg.log, dataDir: bg.dataDir, client: makeClient(bg.log), simulate: process.env.CUSTOMIZER_SIMULATE === '1' });
    await svc.start();
    return svc;
}

/** the page, without the platform: start() and the tests use it */
function createApp(ctx, svc) {
    const st = { step: 10 };
    let dirty = true;
    const changed = () => { dirty = true; };
    const cfg = () => svc.config.get().mode;
    const edit = (fn) => { svc.config.change(fn); changed(); };
    svc.onChange(changed);

    const toggle = (cv, t, x, y, w, label, on, run, key) => G.button(cv, t, x, y, w, 46, label, run, { primary: on, key });
    const row = (cv, t, y, label) => cv.text(label, 44, y, 20, t.dim);

    // where the box is: arrows, size, Reset, and a small map of the cluster
    function boxEditor(cv, t, x0, y0) {
        const r = cfg(), s = st.step;
        cv.text('Position on the cluster', x0, y0, 22, t.text, { font: 'bold' });
        cv.text('x ' + r.x + '   y ' + r.y + '   ' + r.w + ' x ' + r.h, x0, y0 + 30, 20, t.dim);
        G.button(cv, t, x0 + 470, y0 - 26, 0, 40, 'Step ' + s, () => { st.step = s === 10 ? 1 : s === 1 ? 50 : 10; changed(); }, { key: 'step' });
        const mv = (dx, dy) => () => edit((c) => { c.mode.x += dx * s; c.mode.y += dy * s; });
        const sz = (dw, dh) => () => edit((c) => { c.mode.w += dw * s; c.mode.h += dh * s; });
        const bx = x0, by = y0 + 50, B = 64, gap = 8;
        G.button(cv, t, bx + B + gap, by, B, 46, '^', mv(0, -1), { key: 'up' });
        G.button(cv, t, bx, by + 54, B, 46, '<', mv(-1, 0), { key: 'left' });
        G.button(cv, t, bx + 2 * (B + gap), by + 54, B, 46, '>', mv(1, 0), { key: 'right' });
        G.button(cv, t, bx + B + gap, by + 108, B, 46, 'v', mv(0, 1), { key: 'down' });
        const sx = bx + 3 * (B + gap) + 24;
        G.button(cv, t, sx, by, 100, 46, 'W -', sz(-1, 0), { key: 'w-' });
        G.button(cv, t, sx + 110, by, 100, 46, 'W +', sz(1, 0), { key: 'w+' });
        G.button(cv, t, sx, by + 54, 100, 46, 'H -', sz(0, -1), { key: 'h-' });
        G.button(cv, t, sx + 110, by + 54, 100, 46, 'H +', sz(0, 1), { key: 'h+' });
        G.button(cv, t, sx, by + 108, 210, 46, 'Reset', () => { svc.config.resetBox(); changed(); }, { key: 'reset', confirm: true });
        const mx = x0, my = by + 176, k = 0.25;
        cv.strokeRoundRect(mx, my, PANEL.w * k, PANEL.h * k, 8, 1.5, withAlpha('#ffffff', 0.35));
        cv.text('the cluster, 1920 x 720', mx + 6, my + 18, 14, t.dim);
        cv.roundRect(mx + r.x * k, my + r.y * k, Math.max(3, r.w * k), Math.max(3, r.h * k), 2, withAlpha('#33e6ff', 0.85));
    }

    // what the cluster shows now, larger
    function preview(cv, t, x, y, w, h) {
        const m = cfg(), mode = svc.st.mode, stab = m.stability ? svc.st.stab : null;
        cv.roundRect(x, y, w, h, 6, '#000000');
        const cx = x + w / 2;
        if (!mode) { cv.text('no mode from the car yet', cx, y + h / 2 + 8, 20, t.dim, { align: 'center' }); return; }
        const colour = m.style === 'white' ? '#ffffff' : mode.colour;
        if (stab) {
            // the mode on top, TRACTION or DSC OFF (blinking) under it
            cv.text(mode.label, cx, y + h * 0.48, 34, colour, { font: 'bold', align: 'center', spacing: 1 });
            if (stab.kind === 'traction') cv.text('TRACTION', cx, y + h * 0.86, 24, ORANGE, { font: 'bold', align: 'center', spacing: 1 });
            else if (!m.blink || Math.floor(Date.now() / 500) % 2 === 0) cv.text('DSC OFF', cx, y + h * 0.86, 24, RED, { font: 'bold', align: 'center', spacing: 1 });
            return;
        }
        cv.text(mode.label, cx, y + h / 2 + 14, 40, colour, { font: 'bold', align: 'center', spacing: 1 });
    }

    function draw(cv, t) {
        const m = cfg();
        cv.text('Driving mode on the cluster', 44, 80, 24, t.text, { font: 'bold' });
        let x = 44;
        x += 12 + toggle(cv, t, x, 96, 130, m.on ? 'On' : 'Off', m.on, () => edit((c) => { c.mode.on = !c.mode.on; }), 'on');
        x += 12 + toggle(cv, t, x, 96, 0, 'DSC / traction', m.stability, () => edit((c) => { c.mode.stability = !c.mode.stability; }), 'stability');
        toggle(cv, t, x, 96, 0, 'DSC OFF blinks', m.blink, () => edit((c) => { c.mode.blink = !c.mode.blink; }), 'blink');
        row(cv, t, 176, 'Colours');
        toggle(cv, t, 180, 150, 180, 'By mode', m.style === 'colour', () => edit((c) => { c.mode.style = 'colour'; }), 'style-colour');
        toggle(cv, t, 370, 150, 150, 'White', m.style === 'white', () => edit((c) => { c.mode.style = 'white'; }), 'style-white');
        row(cv, t, 230, 'Text size');
        G.button(cv, t, 180, 204, 64, 46, '-', () => edit((c) => { c.mode.size -= 1; }), { key: 'size-' });
        cv.text(String(m.size), 290, 236, 26, t.text, { font: 'bold', align: 'center' });
        G.button(cv, t, 336, 204, 64, 46, '+', () => edit((c) => { c.mode.size += 1; }), { key: 'size+' });
        row(cv, t, 284, 'Align');
        [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].forEach(([a, l], i) =>
            toggle(cv, t, 180 + i * 150, 258, 140, l, m.align === a, () => edit((c) => { c.mode.align = a; }), 'align-' + a));
        row(cv, t, 338, 'Background');
        toggle(cv, t, 180, 312, 150, 'Plate', m.bg === 'plate', () => edit((c) => { c.mode.bg = 'plate'; }), 'bg-plate');
        toggle(cv, t, 340, 312, 150, 'None', m.bg === 'none', () => edit((c) => { c.mode.bg = 'none'; }), 'bg-none');
        preview(cv, t, 44, 376, 476, 96);
        boxEditor(cv, t, 700, 92);
    }

    async function render() {
        const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
        draw(cv, t);
        G.frame(cv, t, ['Customizer'], 0, []);
        dirty = false;
        await ctx.ui.image('MAIN_GFX', cv);
        return cv;
    }
    // drawn on change, and twice a second while the preview blinks DSC OFF
    let lastBlink = -1;
    const tick = () => {
        const s = cfg().stability ? svc.st.stab : null;
        const b = s && s.kind === 'off' && cfg().blink ? Math.floor(Date.now() / 500) % 2 : -1;
        if (dirty || b !== lastBlink) { lastBlink = b; return render(); }
        return null;
    };
    return { st, render, tick, changed };
}

mgu.run({
    background,
    async start(ctx) {
        const svc = ctx.background || await background(ctx);
        const app = createApp(ctx, svc);
        G.onConfirm(app.changed);
        if (ctx.onTab) ctx.onTab(() => app.render());
        if (ctx.onLayout) ctx.onLayout(app.changed);
        ctx.settings.onChange(app.changed);
        ctx.loop('MAIN', 4, app.tick);
        app.render().then(() => ctx.log.info('first frame done')).catch((e) => ctx.log.warn('first render: ' + e));
    },
});

module.exports = { createApp, background };
