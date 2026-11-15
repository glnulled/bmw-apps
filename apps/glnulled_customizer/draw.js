'use strict';
/**
 * draw.js - the pictures the Customizer puts on the cluster, drawn on the kit's software canvas (RGBA, straight
 * alpha: what cluster-render's image layers take).
 *
 *   modeBadge  the driving mode in its box, on a black plate (it covers the stock cluster's own mode text in the
 *              same place); with the traction mode on, TRACTION in orange under it; with DSC off, the mode on the
 *              top line and the bottom line left for dscOff
 *   dscOff     DSC OFF in red on the bottom line, on nothing: a layer of its own over the badge, shown and hidden
 *              to blink
 */
const { Canvas } = require('./kit/canvas');

const ORANGE = '#ff8a00', RED = '#ff2a2a', FONT = 'bold';

/** the size of s that fits w, from size down */
function fit(cv, s, size, w) {
    let z = size;
    while (z > 12 && cv.textWidth(s, z, { font: FONT, spacing: 1, literal: true }) > w) z -= 1;
    return z;
}

/** where the text goes: x by the alignment; the two lines (the mode, then TRACTION or DSC OFF) */
function layout(cv, cfg, label) {
    const W = cfg.w, H = cfg.h;
    const x = cfg.align === 'left' ? 4 : cfg.align === 'right' ? W - 4 : W / 2;
    const z = fit(cv, label || 'COMFORT', Math.min(cfg.size, Math.round(H * 0.48)), W - 8);
    const t = fit(cv, 'TRACTION', Math.min(Math.round(z * 0.72), Math.round(H * 0.34)), W - 8);
    const gap = Math.max(2, Math.round(H * 0.06)), total = z * 0.74 + gap + t * 0.74, top = (H - total) / 2;
    return { x, z, t, y1: Math.round(top + z * 0.74), y2: Math.round(top + z * 0.74 + gap + t * 0.74) };
}

/** cfg: config mode; mode: modes.js labelOf or null; stab: stability.js stabilityOf or null */
function modeBadge(cfg, mode, stab) {
    const W = cfg.w, H = cfg.h, cv = new Canvas(W, H);
    // the plate goes on even with no mode: the stock text under it stays covered while the car starts up
    if (cfg.bg === 'plate') cv.fillRect(0, 0, W, H, '#000000');
    if (!mode) return cv;
    const s = cfg.stability !== false ? stab : null;
    const colour = cfg.style === 'white' ? '#ffffff' : mode.colour;
    const opt = { font: FONT, align: cfg.align, spacing: 1, literal: true };
    if (s) {
        // two lines: the mode on top; TRACTION under it, or the place DSC OFF blinks in (dscOff)
        const L = layout(cv, cfg, mode.label);
        cv.text(mode.label, L.x, L.y1, L.z, colour, opt);
        if (s.kind === 'traction') cv.text('TRACTION', L.x, L.y2, L.t, ORANGE, opt);
        return cv;
    }
    const z = fit(cv, mode.label, Math.min(cfg.size, Math.round(H * 0.9)), W - 8);
    cv.text(mode.label, cfg.align === 'left' ? 4 : cfg.align === 'right' ? W - 4 : W / 2, Math.round(H / 2 + z * 0.36), z, colour, opt);
    return cv;
}

/** DSC OFF in red on the badge's bottom line, on nothing (the badge's plate and mode are under it) */
function dscOff(cfg, mode) {
    const cv = new Canvas(cfg.w, cfg.h);
    const L = layout(cv, cfg, mode && mode.label);
    cv.text('DSC OFF', L.x, L.y2, L.t, RED, { font: FONT, align: cfg.align, spacing: 1, literal: true });
    return cv;
}

module.exports = { modeBadge, dscOff, ORANGE, RED };
