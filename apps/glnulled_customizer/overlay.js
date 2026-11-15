'use strict';
/**
 * overlay.js - the Customizer's layers in cluster-render (robertnisipeanu/idrive-apps, native/cluster-render), on its
 * 'panel' target (the whole cluster, 1920 x 720, over the stock gauges). Everything outside them stays the stock
 * cluster: nothing here redraws the cluster.
 *
 *   mode    the badge (draw.js modeBadge) in its box                  image, written when what it shows changes
 *   dscOff  DSC OFF under the mode, over the badge                    image, written once a mode; blinking is shown / hidden
 *                                                                      (no pixels sent for it)
 * A picture goes whole the first time and after a reconnect (the client keeps it), then only the box that changed.
 * What the service says (targets, layers, refusals) goes to the log.
 */
const D = require('./draw');

const CLASS = 'overlay';

function sameRect(a, b) { return a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h; }

/** the rows of a w-wide RGBA canvas inside rect r, packed (what cr.pixels takes for one rect) */
function packRect(d, w, r) {
    const out = Buffer.allocUnsafe(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) Buffer.from(d.buffer, d.byteOffset + ((r.y + y) * w + r.x) * 4, r.w * 4).copy(out, y * r.w * 4);
    return out;
}
/** the box around the pixels that differ between two same-size RGBA buffers, or null */
function changedBox(a, b, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            const i = row + x * 4;
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

class Overlay {
    /** cr: a ClusterRender client (or a stand-in in tests); log: the app's log */
    constructor(cr, log) {
        this.cr = cr; this.log = log;
        this.layers = {};        // name -> { ref, rect, prev (Buffer of the last picture), visible, key }
        this.st = { connected: false, target: {}, layer: {} };
        cr.on('ready', () => { this.st.connected = true; this._log('connected (' + (cr.backend || '?') + ')'); });
        cr.on('disconnected', () => { if (this.st.connected) this._log('disconnected, the client reconnects by itself'); this.st.connected = false; });
        cr.on('layer', (ref, state, reason) => {
            const name = Object.keys(this.layers).find((n) => this.layers[n].ref === ref) || String(ref);
            const v = state + (reason ? ' (' + reason + ')' : '');
            if (this.st.layer[name] !== v) this._log('layer ' + name + ': ' + v);
            this.st.layer[name] = v;
        });
        cr.on('target', (name, state, holder, reason) => {
            const v = state + (holder ? ' behind ' + holder : '') + (reason ? ' (' + reason + ')' : '');
            if (this.st.target[name] !== v) this._log('target ' + name + ': ' + v);
            this.st.target[name] = v;
        });
        cr.on('refused', (op, ref, reason) => this._log('refused ' + (op || '') + ' ' + (ref || '') + ': ' + (reason || '')));
    }

    _log(s) { if (this.log) this.log.info('cluster: ' + s); }

    _hide(name) { const l = this.layers[name]; if (l && l.visible) { this.cr.set(l.ref, { visible: false }); l.visible = false; } }
    _show(name) { const l = this.layers[name]; if (l && !l.visible) { this.cr.set(l.ref, { visible: true }); l.visible = true; } }

    /** an image layer `name` at rect r showing canvas cv (null: hidden); key: what the picture shows, to skip redraws */
    image(name, r, cv, z) {
        let l = this.layers[name];
        if (!cv) { this._hide(name); return; }
        if (l && !sameRect(l.rect, r)) {
            // moved: in place; resized: made again
            if (l.rect.w === r.w && l.rect.h === r.h) { this.cr.set(l.ref, { x: r.x, y: r.y }); l.rect = Object.assign({}, r); } else { this.cr.drop(l.ref); delete this.layers[name]; l = null; }
        }
        if (!l) {
            const ref = this.cr.image({ target: 'panel', klass: CLASS, z, x: r.x, y: r.y, w: r.w, h: r.h, iw: r.w, ih: r.h, fps: 4 });
            l = this.layers[name] = { ref, rect: Object.assign({}, r), prev: null, visible: true };
            this._log('layer ' + name + ' made at ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h);
        }
        this._show(name);
        const d = Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
        if (!l.prev) { if (this.cr.pixels(l.ref, null, d) !== false) l.prev = Buffer.from(d); return; }
        const box = changedBox(d, l.prev, r.w, r.h);
        if (!box) return;
        this.cr.pixels(l.ref, [box], packRect(d, r.w, box));
        d.copy(l.prev);
    }

    /**
     * The layers for st = { cfg, mode (modes.js label or null), stab (stability.js or null), blinkOn }: the badge, and
     * DSC OFF over it while DSC is off (blinkOn false hides it for the blink's dark half).
     */
    update(st) {
        const m = st.cfg.mode;
        if (!m.on) { this._hide('mode'); this._hide('dscOff'); return; }
        const stab = m.stability ? st.stab : null;
        const off = !!stab && stab.kind === 'off';
        const show = !!st.mode || !!stab || m.bg === 'plate';
        const key = [m.x, m.y, m.w, m.h, m.size, m.style, m.align, m.bg, st.mode && st.mode.label, stab && stab.kind].join('|');
        if (key !== this._key || !show) { this._key = show ? key : null; this.image('mode', m, show ? D.modeBadge(m, st.mode, stab) : null, 10); }
        if (!off) { this._hide('dscOff'); return; }
        const dkey = [m.x, m.y, m.w, m.h, m.size, m.align, st.mode && st.mode.label].join('|');
        if (dkey !== this._dkey || !this.layers.dscOff) { this._dkey = dkey; this.image('dscOff', m, D.dscOff(m, st.mode), 11); }
        if (m.blink && st.blinkOn === false) this._hide('dscOff'); else this._show('dscOff');
    }

    status() { return this.st; }
}

module.exports = { Overlay, changedBox, packRect };
