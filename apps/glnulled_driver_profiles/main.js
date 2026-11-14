'use strict';
/**
 * Driver profiles - the car's driver profiles: the list, new ones, renamed, deleted, and the one in use.
 *
 * In the car the profiles are the head unit's own (car.js, its personalisation services); where those are not
 * there (the emulator, preview) the app keeps profiles of its own (store.js) to show how it works.
 *
 * Screens (one page, drawn by the app):
 *   list   Guest and the car's profiles as cards; the one in use has a stripe and IN USE. A tap on a card opens it
 *          (on Guest: switches to Guest); New profile opens an empty one while the car has room.
 *   edit   the name, typed on the drawn keyboard (touch or the iDrive controller; layouts in LAYOUTS, each switched on
 *          or off in the settings), then Save; Use this profile switches the car to it; Delete (pressed twice) removes
 *          just that one. The app's own profiles (emulator) also have a colour.
 * Editing needs the page's own buttons, so the GPU renderer with touch routing (the Store's mgu-render); without it
 * the list is shown and the bar's New profile is all there is.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { withAlpha } = require('./kit/canvas');
const { LocalProfiles, ProfileError, COLOURS, MAX_NAME, LIMIT } = require('./store');
const { CarProfiles } = require('./car');

const W = 1600, H = 520;
const KEY_W = 100, KEY_H = 50, GAP = 10, ROW_GAP = 8;
const KB_W = 1300;                   // the widest a keyboard row gets: a longer row has narrower keys
const KB_Y = 160;
/**
 * Keyboard layouts, each switched on or off in the settings (kb_<id>), in this order. LANG (bottom row) steps
 * through the ones on. Letters are given as capitals; SHIFT picks the case. The hard sign is lower case only (no
 * word starts with it, and the Cyrillic atlas has no capital one).
 */
const LAYOUTS = [
    { id: 'en', label: 'EN', rows: [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '\''],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '.'],
        ['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ','],
    ] },
    { id: 'ru', label: 'RU', rows: [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'DEL'],
        ['\u0419', '\u0426', '\u0423', '\u041a', '\u0415', '\u041d', '\u0413', '\u0428', '\u0429', '\u0417', '\u0425', '\u044a'],
        ['\u0424', '\u042b', '\u0412', '\u0410', '\u041f', '\u0420', '\u041e', '\u041b', '\u0414', '\u0416', '\u042d'],
        ['SHIFT', '\u042f', '\u0427', '\u0421', '\u041c', '\u0418', '\u0422', '\u042c', '\u0411', '\u042e', '\u0401'],
    ] },
];
const isLetter = (k) => k.length === 1 && k.toLowerCase() !== k.toUpperCase();
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const dateOf = (ms) => { const d = new Date(ms); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); };
/** text on a colour: dark on light colours */
const inkOn = (hex) => {
    const v = parseInt(hex.slice(1), 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    return r * 0.3 + g * 0.59 + b * 0.11 > 160 ? '#101010' : '#ffffff';
};
const initial = (name) => (String(name).trim()[0] || '?').toUpperCase();

/** what the app's screen does, without the platform: main.js start() and the tests use it */
function createApp(ctx, store) {
    const { log } = ctx;
    // view: 'list' | 'edit'; draft: the profile being typed ({ id: null } = a new one)
    const st = { view: 'list', draft: null, shift: false, error: '', info: '', infoUntil: 0, busy: false, layout: null };
    // the layouts switched on in the settings (English when none is)
    const layouts = () => {
        const on = LAYOUTS.filter((l) => !ctx.settings || ctx.settings.get('kb_' + l.id) !== false);
        return on.length ? on : [LAYOUTS[0]];
    };
    const layout = () => { const on = layouts(); return on.find((l) => l.id === st.layout) || on[0]; };
    const nextLayout = () => { const on = layouts(), i = on.indexOf(layout()); st.layout = on[(i + 1) % on.length].id; changed(); };
    // a card's colour: its own (the app's profiles) or one per slot (the car's)
    const colourOf = (p) => p.colour || (p.kind === 'guest' ? '#9aa0a6' : COLOURS[(store.list().findIndex((x) => x.id === p.id) + COLOURS.length - 1) % COLOURS.length]);
    let dirty = true;
    const changed = () => { dirty = true; };
    const note = (s) => { st.info = s; st.infoUntil = Date.now() + 4000; changed(); };

    const open = (p) => {
        if (p && p.kind === 'guest') {
            if (store.car && !p.active) {
                busyRun('Switching...', () => store.activate(p.id), () => note('Now driving as Guest')).then(() => { if (st.error) { note(st.error); st.error = ''; } });
            } else note('Guest is the car\'s own profile: it can\'t be changed');
            return;
        }
        if (!p && store.list().length >= store.limit) { note('All ' + store.limit + ' profiles are in use: delete one first'); return; }
        st.view = 'edit';
        st.draft = p ? { id: p.id, name: p.name, colour: colourOf(p), created: p.created, active: p.active } : { id: null, name: '', colour: freeColour() };
        st.shift = !st.draft.name;          // a new name starts with a capital
        st.error = '';
        changed();
    };
    const freeColour = () => { const used = store.list().map((p) => p.colour); return COLOURS.find((c) => used.indexOf(c) < 0) || COLOURS[0]; };
    const close = () => { st.view = 'list'; st.draft = null; st.error = ''; changed(); };

    const type = (k) => {
        const d = st.draft;
        if (!d) return;
        st.error = '';
        if (k === 'DEL') d.name = d.name.slice(0, -1);
        else if (k === 'SHIFT') st.shift = !st.shift;
        else if (k === ' ') { if (d.name && !/ $/.test(d.name) && d.name.length < MAX_NAME) d.name += ' '; } else if (d.name.length < MAX_NAME) {
            d.name += isLetter(k) && !st.shift ? k.toLowerCase() : k;
            st.shift = false;
        } else st.error = 'At most ' + MAX_NAME + ' characters';
        // a word starts with a capital: after a space, and again when its first letter is deleted
        if (k === ' ' || k === 'DEL') st.shift = !d.name || / $/.test(d.name);
        changed();
    };

    // one change at a time: the car takes a few seconds for some of them
    const busyRun = async (what, fn, done) => {
        if (st.busy) return;
        st.busy = what; st.error = ''; changed();
        try {
            const r = await fn();
            done(r);
        } catch (e) {
            if (!(e instanceof ProfileError)) log.error(what, e);
            st.error = e.message || String(e);
        }
        st.busy = false; changed();
    };
    const save = () => {
        const d = st.draft;
        const fields = store.car ? { name: d.name } : { name: d.name, colour: d.colour };
        return busyRun(d.id ? 'Saving...' : 'Creating...', () => (d.id ? store.update(d.id, fields) : store.create(fields)), (p) => {
            log.info((d.id ? 'changed ' : 'created ') + 'profile ' + (p && p.id));
            close();
            note((d.id ? 'Saved ' : 'Created ') + ((p && p.name) || d.name));
        });
    };
    const remove = () => {
        const d = st.draft;
        return busyRun('Deleting...', () => store.remove(d.id), () => {
            log.info('deleted profile ' + d.id);
            close();
            note('Deleted ' + d.name);
        });
    };
    const activate = () => {
        const d = st.draft;
        return busyRun('Switching...', () => store.activate(d.id), () => {
            log.info('switched to profile ' + d.id);
            close();
            note('Now driving as ' + d.name);
        });
    };

    function key(cv, t, x, y, w, label, run, opts) {
        const o = opts || {}, S = t.sel || t.accent;
        cv.roundRect(x, y, w, KEY_H, 10, o.on ? withAlpha(S, 0.85) : withAlpha('#ffffff', o.dim ? 0.05 : 0.09));
        cv.text(label, x + w / 2, y + KEY_H / 2 + 9, label.length > 1 ? 20 : 26, o.on ? '#ffffff' : t.text, { align: 'center', font: 'bold' });
        if (cv.own) cv.target(x, y, w, KEY_H, run, 'key:' + (o.key || label));
    }

    function drawList(cv, t) {
        const items = store.list();
        cv.text(items.length + ' of ' + store.limit + ' profiles', 44, 86, 28, t.text, { font: 'bold' });
        cv.text(store.source, 44, 112, 18, t.dim);
        const full = items.length >= store.limit;
        G.button(cv, t, 1316, 58, 240, 52, 'New profile', () => open(null), { primary: !full, busy: full, key: 'new' });
        if (st.busy) cv.text(st.busy, 1296, 92, 20, t.text, { align: 'right' });
        else if (st.info && Date.now() < st.infoUntil) cv.text(st.info, 1296, 92, 20, t.dim, { align: 'right' });
        if (store.error) cv.text(store.error, 44, G.BOTTOM - 8, 18, t.warn || t.crit);

        const cw = 752, ch = 84, top = 128;
        const cards = full ? items : items.concat([null]);   // the first free place offers a new profile
        cards.forEach((p, i) => {
            const x = 44 + (i % 2) * (cw + 16), y = top + Math.floor(i / 2) * (ch + 12);
            if (y + ch > G.BOTTOM + (cv.extra || 0)) return;
            if (!p) {
                cv.strokeRoundRect(x, y, cw, ch, 16, 1.5, withAlpha('#ffffff', 0.18));
                cv.text('+  New profile', x + cw / 2, y + ch / 2 + 9, 24, t.dim, { align: 'center', font: 'bold' });
                if (cv.own) cv.target(x, y, cw, ch, () => open(null), 'card:new', 16);
                return;
            }
            cv.roundRect(x, y, cw, ch, 16, withAlpha('#ffffff', 0.06));
            const c = colourOf(p);
            if (p.active) {
                // a stripe and a pill, no frame: the controller's focus frame goes round the card (radius 16 below)
                cv.roundRect(x, y + 14, 6, ch - 28, 3, t.sel || t.accent);
                const pw = cv.textWidth('IN USE', 16, { font: 'bold', spacing: 1.5 }) + 28;
                cv.roundRect(x + cw - 70 - pw, y + ch / 2 - 15, pw, 30, 15, withAlpha(t.sel || t.accent, 0.85));
                cv.text('IN USE', x + cw - 70 - pw / 2, y + ch / 2 + 6, 16, '#ffffff', { align: 'center', font: 'bold', spacing: 1.5 });
            }
            cv.circle(x + 50, y + ch / 2, 30, c);
            cv.text(initial(p.name), x + 50, y + ch / 2 + 11, 32, inkOn(c), { align: 'center', font: 'bold' });
            cv.text(p.name, x + 100, y + 40, 30, t.text, { font: 'bold' });
            const sub = p.kind === 'guest' ? 'The car\'s own profile, always there' : store.car ? 'Driver profile' : 'Local profile, changed ' + dateOf(p.updated);
            cv.text(sub, x + 100, y + 68, 18, t.dim);
            if (p.kind !== 'guest') {
                cv.line(x + cw - 40, y + ch / 2 - 10, x + cw - 30, y + ch / 2, 3, t.dim);
                cv.line(x + cw - 30, y + ch / 2, x + cw - 40, y + ch / 2 + 10, 3, t.dim);
            }
            if (cv.own) cv.target(x, y, cw, ch, () => open(p), 'card:' + p.id, 16);
        });
    }

    function drawEdit(cv, t) {
        const d = st.draft, S = t.sel || t.accent;
        // the name field, with a blinking cursor and how much room is left
        cv.roundRect(44, 58, 760, 66, 14, withAlpha('#ffffff', 0.08));
        cv.strokeRoundRect(44, 58, 760, 66, 14, 2, S);
        const tw = d.name ? cv.text(d.name, 68, 104, 34, t.text, { font: 'bold' }) : 0;
        if (!d.name) cv.text('Name', 68, 104, 34, withAlpha(t.dim, 0.6), { font: 'bold' });
        if (Math.floor(Date.now() / 530) % 2 === 0) cv.fillRect(70 + tw, 74, 3, 36, S);
        cv.text(d.name.length + '/' + MAX_NAME, 788, 100, 18, t.dim, { align: 'right' });
        cv.text(st.busy || st.error, 44, 146, 20, st.busy ? t.text : t.warn || t.crit);

        if (store.car) {
            // the car's profile: which one is in use, and switching to this one
            if (d.active) cv.text('This profile is in use', 840, 100, 22, t.text, { font: 'bold' });
            else if (d.id) G.button(cv, t, 840, 66, 300, 52, 'Use this profile', activate, { busy: !!st.busy, key: 'activate' });
            else cv.text('The car makes the profile; then choose it to use it', 840, 100, 18, t.dim);
        } else COLOURS.forEach((c, i) => {
            const x = 840 + i * 60, y = 86, on = c === d.colour;
            if (on) cv.circle(x + 24, y + 24, 28, '#ffffff');
            cv.circle(x + 24, y + 24, on ? 24 : 22, c);
            if (cv.own) cv.target(x - 4, y - 4, 56, 56, () => { d.colour = c; changed(); }, 'colour:' + i);
        });
        if (!store.car) cv.text('Colour', 840, 78, 18, t.dim);
        // the preview: how its card will look
        cv.circle(1366, 92, 30, d.colour);
        cv.text(initial(d.name || '?'), 1366, 103, 32, inkOn(d.colour), { align: 'center', font: 'bold' });
        cv.text(d.id ? (store.car ? 'Profile ' + d.id : 'Created') : 'New profile', 1408, 88, 18, t.dim);
        if (d.id && !store.car) cv.text(dateOf(d.created), 1408, 112, 18, t.dim);

        // the keyboard
        layout().rows.forEach((row, r) => {
            const y = KB_Y + r * (KEY_H + ROW_GAP);
            // SHIFT is one and a half keys wide; a row longer than KB_W gets narrower keys
            const units = row.reduce((n, k) => n + (k === 'SHIFT' ? 1.5 : 1), 0);
            const kw = Math.min(KEY_W, (KB_W - (row.length - 1) * GAP) / units);
            let x = (W - (units * kw + (row.length - 1) * GAP)) / 2;
            row.forEach((k) => {
                const wide = k === 'SHIFT' ? kw * 1.5 : kw;
                const label = isLetter(k) && !st.shift ? k.toLowerCase() : k;
                key(cv, t, x, y, wide, label, () => type(k),
                    { on: k === 'SHIFT' && st.shift, key: k });
                x += wide + GAP;
            });
        });

        // the actions, and the space bar between them
        const y = 420;
        if (d.id) G.button(cv, t, 44, y, 230, 56, 'Delete', remove, { color: t.crit, key: 'delete', confirm: true, busy: !!st.busy });
        if (layouts().length > 1) key(cv, t, 300, y + 3, 120, layout().label, nextLayout, { key: 'lang' });
        key(cv, t, 436, y + 3, 100, '-', () => type('-'), { key: '-' });
        key(cv, t, 552, y + 3, 488, 'SPACE', () => type(' '), { key: 'space' });
        G.button(cv, t, 1094, y, 220, 56, 'Cancel', close, { key: 'cancel' });
        G.button(cv, t, 1336, y, 220, 56, 'Save', save, { primary: true, busy: !d.name.trim() || !!st.busy, key: 'save' });
    }

    async function render() {
        const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
        if (st.view === 'edit') drawEdit(cv, t); else drawList(cv, t);
        G.frame(cv, t, [st.view === 'list' ? 'Driver profiles' : st.draft.id ? 'Edit profile' : 'New profile'], 0, []);
        dirty = false;
        await ctx.ui.image('MAIN_GFX', cv);
        return cv;
    }

    // draw again when something changed, while the cursor blinks, and when a note runs out
    let blink = -1, noted = false;
    const tick = () => {
        const b = st.view === 'edit' ? Math.floor(Date.now() / 530) % 2 : -1;
        const n = !!st.info && Date.now() < st.infoUntil;
        if (dirty || b !== blink || n !== noted) { blink = b; noted = n; return render(); }
        return null;
    };

    if (store.onChange) store.onChange(changed);
    return { st, open, close, type, save, remove, activate, render, tick, changed };
}

mgu.run({
    async start(ctx) {
        // the car's profiles; the app's own where the car's services are not there (emulator, preview)
        let store;
        try {
            if (!ctx.signals.hasNative()) throw new Error('no SOME/IP here');
            store = await new CarProfiles(ctx.signals, ctx.log).init();
            ctx.log.info('car profiles: ' + store.list().map((p) => p.id + '=' + p.name + (p.active ? '*' : '')).join(', '));
        } catch (e) {
            ctx.log.warn('car profiles not available, using the app\'s own: ' + (e && e.message || e));
            store = new LocalProfiles(ctx.dataDir, { log: ctx.log });
        }
        const app = createApp(ctx, store);
        ctx.log.info(store.list().length + ' profiles (limit ' + LIMIT + ')');
        G.onConfirm(app.changed);           // Delete's "Confirm" shows and runs out
        // where the kit runs the screen the page has its own New profile button; the bar's is for the rest
        if (ctx.hideButton) ctx.hideButton('BTN_NEW');
        ctx.ui.onClick('BTN_NEW', () => { if (app.st.view === 'list') app.open(null); return app.render(); });
        if (ctx.onTab) ctx.onTab(() => app.render());
        if (ctx.onLayout) ctx.onLayout(app.changed);
        ctx.settings.onChange(app.changed);
        ctx.loop('MAIN', 4, app.tick);
        app.render().then(() => ctx.log.info('first frame done')).catch((e) => ctx.log.warn('first render: ' + e));
    },
});

module.exports = { createApp };
