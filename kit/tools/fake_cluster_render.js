'use strict';
/**
 * fake_cluster_render.js - a stand-in for cluster-render (robertnisipeanu/idrive-apps, native/cluster-render) on a
 * desktop: it speaks its protocol (PROTOCOL.md, version 1) on a Unix socket, composes the layers the apps send into
 * pictures of the cluster ('panel' 1920x720, 'map' 1088x480) and the HUD (800x480), and shows them in a browser page,
 * over a photo of a cluster if given. Image layers are drawn as sent; effect layers (shaders) can't run here, so
 * shaders marked "// fake:grid" or "// fake:frame" are drawn by their meaning and any other as a labelled box.
 *
 *   node kit/tools/fake_cluster_render.js [--sock /tmp/cluster-render-fake.sock] [--port 8090] [--bg cluster.jpg]
 *   CLUSTER_RENDER_SOCK=/tmp/cluster-render-fake.sock node kit/tools/emu.js glnulled_customizer
 *
 * The page also plays what the car does to a target: the stock HMI taking the panel (parked behind stock), giving it
 * back, and the service going away (every client disconnected; they reconnect and send everything again).
 */
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { Canvas } = require('../runtime/canvas');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SOCK = arg('--sock', '/tmp/cluster-render-fake.sock');
const PORT = Number(arg('--port', 8090));
const BG = arg('--bg', null);
const TARGETS = { map: [1088, 480], panel: [1920, 720], hud: [800, 480] };
const CLASSES = ['ambient', 'content', 'overlay', 'alert'];

const log = [];
function note(s) {
    const line = new Date().toISOString().slice(11, 23) + ' ' + s;
    log.push(line); if (log.length > 400) log.shift();
    console.log(line);
}

let seq = 0;
const clients = new Set();
const parked = {};          // target -> true while the "stock HMI" holds it

function send(c, obj) {
    const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length);
    m.writeUInt32LE(body.length + 1, 0); m[4] = 0x4a; body.copy(m, 5);
    try { c.sock.write(m); } catch (e) { /* gone */ }
}
function targetEvent(c, name) {
    const wanted = [...c.layers.values()].some((l) => l.target === name && l.visible && l.has);
    const state = parked[name] ? 'parked' : wanted ? 'shown' : 'idle';
    if (c.tstate[name] === state) return;
    c.tstate[name] = state;
    send(c, { ev: 'target', target: name, state, holder: parked[name] ? 'stock' : '', reason: parked[name] ? 'parked behind stock' : '', rendering: state === 'shown' ? 'verified' : 'none', guide_disabled: 0, disabled: 0 });
}
function layerEvent(c, l, state, reason) {
    if (l.state === state) return;
    l.state = state;
    send(c, { ev: 'layer', ref: l.ref, state, reason: reason || '' });
}
function refresh(c) {
    c.layers.forEach((l) => {
        if (!l.visible) layerEvent(c, l, 'hidden');
        else if (!l.has) layerEvent(c, l, 'stalled', l.kind === 'image' ? 'no frame yet' : '');
        else if (parked[l.target]) layerEvent(c, l, 'waiting', 'target parked behind stock');
        else layerEvent(c, l, 'shown');
    });
    Object.keys(TARGETS).forEach((t) => targetEvent(c, t));
}

function onJson(c, m) {
    switch (m.op) {
    case 'hello':
        c.app = m.app || '?';
        note(c.app + ': hello (proto ' + m.proto + ')');
        send(c, { ev: 'hello', proto: 1, backend: 'id7', targets: Object.keys(TARGETS).map((k) => k + ':' + TARGETS[k].join('x')).join(','), repeat: 1 });
        send(c, { ev: 'budget', cap_kb_per_s: 5500, max_kb_per_s: 5500, floor_kb_per_s: 400, reason: 'fake' });
        break;
    case 'layer': case 'asset': {
        const t = TARGETS[m.target];
        if (!t) { send(c, { ev: 'error', op: m.op, ref: m.ref, reason: 'unknown target ' + m.target }); return; }
        const kind = m.op === 'asset' ? 'asset' : m.kind;
        const l = { ref: m.ref, target: m.target, kind, cls: m.class || 'content', z: m.z || 0, x: m.x || 0, y: m.y || 0, w: m.w || t[0], h: m.h || t[1],
            iw: m.iw || m.w || t[0], ih: m.ih || m.h || t[1], visible: m.visible === undefined ? 1 : m.visible, fs: m.fs || '', u: {}, has: kind === 'effect', seq: ++seq, state: '' };
        if (kind === 'image' || kind === 'asset') { l.canvas = new Canvas(l.iw, l.ih); }
        c.layers.set(m.ref, l);
        note(c.app + ': ' + kind + ' ' + m.ref + ' on ' + m.target + ' at ' + l.x + ',' + l.y + ' ' + l.w + 'x' + l.h + ' class ' + l.cls + ' z ' + l.z);
        refresh(c);
        break;
    }
    case 'set': {
        const l = c.layers.get(m.ref); if (!l) return;
        ['x', 'y', 'w', 'h', 'z', 'visible', 'opacity'].forEach((k) => { if (k in m) l[k] = m[k]; });
        if ('class' in m) l.cls = m.class;
        refresh(c);
        break;
    }
    case 'uniform': { const l = c.layers.get(m.ref); if (l) l.u[m.name] = String(m.v).split(/\s+/).map(Number); break; }
    case 'drop': c.layers.delete(m.ref); note(c.app + ': drop ' + m.ref); refresh(c); break;
    case 'status': {
        const lines = ['fake cluster-render', 'clients ' + clients.size];
        Object.keys(TARGETS).forEach((t) => lines.push('target ' + t + ': ' + (parked[t] ? 'parked behind stock' : 'free')));
        lines.push('slot 0x203 status 2: 0x10004f8 class 0 map ' + (parked.panel ? 3 : 1) + (parked.panel ? ', 0x1000400 class 0 map 1' : ''));
        c.layers.forEach((l) => lines.push('layer ' + l.ref + ' ' + l.kind + ' ' + l.target + ' ' + l.state));
        send(c, { ev: 'status', text: lines.join('\n') });
        break;
    }
    default: note(c.app + ': ' + m.op + ' (ignored here)');
    }
}

function onFrame(c, b) {
    const ref = b.readUInt32LE(0), n = b.readUInt16LE(12);
    const l = c.layers.get(ref);
    if (!l || !l.canvas) return;
    let off = 14 + n * 8;
    const d = l.canvas.d;
    if (!n) { b.copy(Buffer.from(d.buffer, d.byteOffset, d.length), 0, off, off + d.length); } else {
        for (let i = 0; i < n; i++) {
            const x = b.readUInt16LE(14 + i * 8), y = b.readUInt16LE(16 + i * 8), w = b.readUInt16LE(18 + i * 8), h = b.readUInt16LE(20 + i * 8);
            for (let r = 0; r < h; r++) { b.copy(Buffer.from(d.buffer, d.byteOffset + ((y + r) * l.iw + x) * 4, w * 4), 0, off, off + w * 4); off += w * 4; }
        }
    }
    if (!l.has) { l.has = true; refresh(c); }
    l.frames = (l.frames || 0) + 1;
}

const server = net.createServer((sock) => {
    const c = { sock, app: '?', layers: new Map(), tstate: {}, buf: Buffer.alloc(0) };
    clients.add(c);
    sock.on('data', (d) => {
        c.buf = Buffer.concat([c.buf, d]);
        while (c.buf.length >= 5) {
            const len = c.buf.readUInt32LE(0);
            if (c.buf.length < 4 + len) break;
            const type = c.buf[4], body = c.buf.slice(5, 4 + len);
            c.buf = c.buf.slice(4 + len);
            try {
                if (type === 0x4a) onJson(c, JSON.parse(body.toString('utf8')));
                else if (type === 0x46) onFrame(c, body);
                else note(c.app + ': message type 0x' + type.toString(16) + ' (not drawn here)');
            } catch (e) { note(c.app + ': bad message: ' + e.message); }
        }
    });
    sock.on('close', () => { clients.delete(c); note(c.app + ': disconnected'); });
    sock.on('error', () => {});
});

/** every client's visible layers on target, bottom to top, into one picture */
function compose(target) {
    const [W, H] = TARGETS[target], cv = new Canvas(W, H);
    if (parked[target]) return cv;
    const all = [];
    clients.forEach((c) => c.layers.forEach((l) => { if (l.target === target && l.visible && l.has && l.kind !== 'asset') all.push(l); }));
    all.sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || a.z - b.z || a.seq - b.seq);
    all.forEach((l) => {
        if (l.kind === 'image') { cv.blit(l.canvas, l.x, l.y); return; }
        if (/fake:grid/.test(l.fs)) {
            for (let x = 0; x < l.w; x += 20) cv.fillRect(l.x + x, l.y, x % 500 === 0 ? 3 : x % 100 === 0 ? 2 : 1, l.h, x % 500 === 0 ? [255, 50, 50, 240] : x % 100 === 0 ? [255, 255, 60, 180] : [255, 255, 255, 56]);
            for (let y = 0; y < l.h; y += 20) cv.fillRect(l.x, l.y + y, l.w, y % 500 === 0 ? 3 : y % 100 === 0 ? 2 : 1, y % 500 === 0 ? [255, 50, 50, 240] : y % 100 === 0 ? [255, 255, 60, 180] : [255, 255, 255, 56]);
        } else if (/fake:frame/.test(l.fs)) {
            const c = (l.u.u_color || [1, 0, 1, 1]).map((v) => Math.round(v * 255));
            cv.fillRect(l.x, l.y, l.w, 3, c); cv.fillRect(l.x, l.y + l.h - 3, l.w, 3, c); cv.fillRect(l.x, l.y, 3, l.h, c); cv.fillRect(l.x + l.w - 3, l.y, 3, l.h, c);
        } else {
            cv.fillRect(l.x, l.y, l.w, l.h, [255, 0, 255, 60]);
            cv.text('effect ' + l.ref, l.x + 6, l.y + 22, 18, '#ffffff', { literal: true });
        }
    });
    return cv;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>fake cluster-render</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:16px}.t{position:relative;width:100%;max-width:1440px;background:#000 center/100% 100% no-repeat}
.t img{width:100%;display:block}button{margin:4px 4px 4px 0;padding:6px 10px}pre{background:#000;padding:8px;height:260px;overflow:auto;font-size:12px}</style>
<h3>panel (1920x720)</h3><div class="t" id="p"${BG ? ' style="background-image:url(/bg)"' : ''}><img id="pi"></div>
<h3>HUD (800x480)</h3><div class="t" style="max-width:600px"><img id="hi"></div>
<p><button onclick="act('park')">Stock HMI takes the panel</button><button onclick="act('unpark')">Stock HMI gives it back</button>
<button onclick="act('drop')">Service restarts (drop clients)</button><button onclick="act('budget')">Budget drops</button></p>
<pre id="log"></pre>
<script>
function act(a){fetch('/act?do='+a)}
setInterval(()=>{const t=Date.now();pi.src='/panel.png?'+t;hi.src='/hud.png?'+t;
fetch('/log').then(r=>r.text()).then(s=>{log.textContent=s;log.scrollTop=1e9})},700)
</script>`;

http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(PAGE); }
    if (u.pathname === '/panel.png' || u.pathname === '/hud.png' || u.pathname === '/map.png') {
        res.setHeader('content-type', 'image/png'); res.setHeader('cache-control', 'no-store');
        return res.end(compose(u.pathname.slice(1, -4)).png());
    }
    if (u.pathname === '/bg' && BG) return fs.createReadStream(BG).pipe(res);
    if (u.pathname === '/log') return res.end(log.join('\n'));
    if (u.pathname === '/act') {
        const a = u.searchParams.get('do');
        if (a === 'park' || a === 'unpark') { parked.panel = a === 'park'; note('the stock HMI ' + (parked.panel ? 'takes' : 'gives back') + ' the panel'); clients.forEach(refresh); }
        if (a === 'drop') { note('service restart: every client dropped'); clients.forEach((c) => c.sock.destroy()); }
        if (a === 'budget') { note('budget drops'); clients.forEach((c) => send(c, { ev: 'budget', cap_kb_per_s: 800, max_kb_per_s: 5500, floor_kb_per_s: 400, reason: 'link struggles (fake)' })); }
        return res.end('ok');
    }
    res.statusCode = 404; res.end();
}).listen(PORT, '127.0.0.1', () => note('page: http://localhost:' + PORT));

try { fs.unlinkSync(SOCK); } catch (e) { /* none */ }
server.listen(SOCK, () => note('socket: ' + SOCK + (BG ? ', background ' + path.basename(BG) : '')));
