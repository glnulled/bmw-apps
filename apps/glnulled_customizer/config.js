'use strict';
/**
 * config.js - how and where the Customizer shows the driving mode on the cluster, kept in data/customizer.json
 * (written whole: a new file renamed over the old one). The box is in the cluster's own pixels (cluster-render's
 * 'panel', 1920 x 720, from the top-left).
 *
 * The default box is where the stock cluster writes the mode in the Standard layout, measured on an iDrive 7 cluster
 * coded to the M layout (Nov 2026): right of the rev counter's 1/min x1000, left of the gear.
 */
const fs = require('fs');
const path = require('path');

const PANEL = { w: 1920, h: 720 };
const VERSION = 2;
const DEFAULTS = {
    version: VERSION,
    // on: the mode on the cluster (off: nothing of ours there, the connection to cluster-render closed)
    // stability: TRACTION under the mode, DSC OFF in its place; blink: DSC OFF blinks
    // bg 'plate': on a black plate, which covers what the stock cluster writes in the same place ('none': text only)
    mode: { on: true, x: 1212, y: 658, w: 192, h: 62, size: 28, style: 'colour', align: 'center', bg: 'plate', stability: true, blink: true },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** a box kept inside the panel, at least 16 x 16 */
function fitRect(r) {
    r.w = clamp(Math.round(num(r.w, 100)), 16, PANEL.w);
    r.h = clamp(Math.round(num(r.h, 40)), 16, PANEL.h);
    r.x = clamp(Math.round(num(r.x, 0)), 0, PANEL.w - r.w);
    r.y = clamp(Math.round(num(r.y, 0)), 0, PANEL.h - r.h);
    return r;
}

function merged(saved) {
    const c = JSON.parse(JSON.stringify(DEFAULTS));
    if (saved && typeof saved === 'object' && saved.mode && typeof saved.mode === 'object') {
        // a file from before version 2 keeps its switches, not its box and size (the defaults moved there)
        const keep = saved.version === VERSION ? Object.keys(c.mode) : ['on', 'style', 'align', 'bg', 'stability', 'blink'];
        keep.forEach((f) => { if (f in saved.mode) c.mode[f] = saved.mode[f]; });
        // version 1 had its own switch for drawing at all
        if (saved.version !== VERSION && saved.draw && saved.draw.on === false) c.mode.on = false;
    }
    const m = c.mode;
    m.on = m.on !== false; m.stability = m.stability !== false; m.blink = m.blink !== false;
    m.size = clamp(Math.round(num(m.size, 28)), 14, 120);
    if (['colour', 'white'].indexOf(m.style) < 0) m.style = 'colour';
    if (['left', 'center', 'right'].indexOf(m.align) < 0) m.align = 'center';
    if (['plate', 'none'].indexOf(m.bg) < 0) m.bg = 'plate';
    fitRect(m);
    return c;
}

class Config {
    constructor(dir, log) {
        this.file = path.join(dir, 'customizer.json');
        this.log = log;
        this.listeners = [];
        let saved = null;
        try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {
            if (e.code !== 'ENOENT' && log) log.warn('customizer.json unreadable, defaults: ' + e.message);
        }
        this.c = merged(saved);
    }

    get() { return this.c; }

    /** change(fn): fn(c) edits the config; it is checked, saved and announced */
    change(fn) {
        fn(this.c);
        this.c = merged(this.c);
        try {
            if (!fs.existsSync(path.dirname(this.file))) fs.mkdirSync(path.dirname(this.file));   // (no recursive on the car's Node 8)
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.c, null, 1));
            fs.renameSync(tmp, this.file);
        } catch (e) { if (this.log) this.log.warn('customizer.json: ' + e.message); }
        this.listeners.forEach((f) => { try { f(this.c); } catch (e) { if (this.log) this.log.warn('config listener: ' + e); } });
        return this.c;
    }

    /** the box and the size back to the defaults */
    resetBox() { return this.change((c) => { ['x', 'y', 'w', 'h', 'size'].forEach((k) => { c.mode[k] = DEFAULTS.mode[k]; }); }); }
    onChange(fn) { this.listeners.push(fn); }
}

module.exports = { Config, DEFAULTS, PANEL, fitRect, VERSION };
