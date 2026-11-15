'use strict';
/**
 * cluster_slot_pattern.js - a test picture on cluster-render's `panel` target, to see where the cluster draws a slot
 * and how large it is (kit/tools/probe_cluster_slots.sh sets the slot and runs this on the head unit, Node 8).
 *
 *   node cluster_slot_pattern.js <label> [seconds] [cluster_render_client.js] [--dump file.rgba]
 *
 * The picture is the panel's whole scene, 1920x720 (drawn at a quarter of that, each dot 4x4 on the cluster):
 *   - edges: red top, green bottom, blue left, yellow right - a missing edge is cut off by the slot's window
 *   - a grid every 100 px, labelled x,y in hundreds (12,6 is x 1200 y 600)
 *   - <label> (the slot) large, in the middle and towards each corner
 *   - a faint dark tint over everything, so the window's extent shows even where nothing else is drawn
 */
const K = 4, W = 1920 / K, H = 720 / K;

// 5x7 dots, rows top to bottom, bit 4 the left column
const FONT = {
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
    '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
    '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12], 'x': [0, 0, 17, 10, 4, 10, 17], ',': [0, 0, 0, 0, 0, 4, 8],
    'a': [0, 0, 14, 1, 15, 17, 15], 'b': [16, 16, 30, 17, 17, 17, 30], 'c': [0, 0, 14, 16, 16, 17, 14], 'd': [1, 1, 15, 17, 17, 17, 15],
    'e': [0, 0, 14, 17, 31, 16, 14], 'f': [6, 9, 8, 28, 8, 8, 8], ' ': [0, 0, 0, 0, 0, 0, 0],
};

function picture(label) {
    const px = Buffer.alloc(W * H * 4);
    const dot = (x, y, c) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
    };
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c); };
    const text = (s, x, y, k, c, plate) => {
        if (plate) rect(x - k, y - k, s.length * 6 * k + k, 9 * k, plate);
        for (let n = 0; n < s.length; n++) {
            const g = FONT[s[n]] || FONT[' '];
            for (let r = 0; r < 7; r++) for (let b = 0; b < 5; b++) if (g[r] & (16 >> b)) rect(x + (n * 6 + b) * k, y + r * k, k, k, c);
        }
    };
    const WHITE = [255, 255, 255, 255], LINE = [255, 255, 255, 110], BLACK = [0, 0, 0, 230];
    rect(0, 0, W, H, [0, 0, 0, 90]);
    for (let x = 0; x < W; x += 25) rect(x, 0, 1, H, LINE);
    for (let y = 0; y < H; y += 25) rect(0, y, W, 1, LINE);
    for (let gx = 2; gx < 19; gx += 2) for (let gy = 1; gy < 7; gy += 2) text(gx + ',' + gy, gx * 25 + 2, gy * 25 + 2, 1, WHITE, BLACK);
    rect(0, 0, W, 3, [255, 40, 40, 255]); rect(0, H - 3, W, 3, [40, 255, 40, 255]);
    rect(0, 0, 3, H, [60, 120, 255, 255]); rect(W - 3, 0, 3, H, [255, 230, 40, 255]);
    const k = 3, tw = label.length * 6 * k, th = 7 * k, MAG = [255, 60, 255, 255];
    [[W / 2, H / 2], [W / 4, H / 4], [3 * W / 4, H / 4], [W / 4, 3 * H / 4], [3 * W / 4, 3 * H / 4]]
        .forEach((p) => text(label, Math.round(p[0] - tw / 2), Math.round(p[1] - th / 2), k, MAG, BLACK));
    return px;
}

function main() {
    const a = process.argv.slice(2), dump = a.indexOf('--dump');
    const label = (a[0] || '0x203').toLowerCase(), px = picture(label);
    if (dump >= 0) { require('fs').writeFileSync(a[dump + 1], px); console.log(W + 'x' + H + ' rgba -> ' + a[dump + 1]); return; }
    const seconds = Number(a[1]) || 20;
    const { ClusterRender } = require(a[2] || '/var/opt/cluster-render/current/cluster_render_client.js');
    const cr = new ClusterRender('glnulled_slot_probe', process.env.CLUSTER_RENDER_SOCK || undefined);
    const ref = cr.image({ target: 'panel', klass: 'overlay', z: 900, x: 0, y: 0, w: W * K, h: H * K, iw: W, ih: H, sampling: 'nearest', fps: 2 });
    const say = (s) => console.log(new Date().toISOString().slice(11, 23) + ' ' + s);
    cr.on('ready', () => { cr.pixels(ref, null, px); say('connected, picture sent'); });
    cr.on('layer', (r, state, reason) => say('layer: ' + state + (reason ? ' (' + reason + ')' : '')));
    cr.on('target', (name, state, holder, reason) => { if (name === 'panel') say('panel: ' + state + ' behind ' + holder + (reason ? ' (' + reason + ')' : '')); });
    cr.on('disconnected', () => say('disconnected'));
    cr.connect();
    setTimeout(() => { cr.close(); say('done'); process.exit(0); }, seconds * 1000);
}

if (require.main === module) main();
module.exports = { picture, W, H };
