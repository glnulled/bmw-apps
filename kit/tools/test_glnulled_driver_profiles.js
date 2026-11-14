'use strict';

// Driver profiles (glnulled_driver_profiles): the store (create / change / delete, the Guest profile, limits, a damaged file) and the
// screen (cards, the keyboard, Save, Delete pressed twice) with the platform stubbed. No SDK or car needed:
//   node kit/tools/test_glnulled_driver_profiles.js [out-dir]      (out-dir: also writes the screens as PNG)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..', '..');
const APPS = path.join(ROOT, 'apps');
const kit = path.join(ROOT, 'kit/runtime');
const { Recorder, play } = require(path.join(kit, 'record'));
const { Canvas } = require(path.join(kit, 'canvas'));
const themes = require(path.join(kit, 'themes'));
const tmps = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-')); tmps.push(d); return d; };
process.on('exit', () => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const OUT = process.argv[2];

let failed = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); }
};

const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './kit/mgu') return { run() {} };
    if (req.startsWith('./kit/')) return load.call(this, path.join(kit, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const { createApp } = require(path.join(APPS, 'glnulled_driver_profiles/main'));
const { LocalProfiles, ProfileError, LIMIT, COLOURS } = require(path.join(APPS, 'glnulled_driver_profiles/store'));
Module._load = load;

function harness(dir) {
    const store = new LocalProfiles(dir);
    const texts = [];
    let last = null;
    const ctx = {
        log: { info() {}, warn() {}, error() {} },
        theme: () => themes.theme('m_tricolour'),
        canvas: (w, h) => {
            const cv = new Recorder(w, h), text = cv.text.bind(cv);
            cv.own = true;                       // the kit runs the screen: the page's own buttons
            cv.text = (s, ...a) => { texts.push(String(s)); return text(s, ...a); };
            last = cv;
            return cv;
        },
        ui: { image: async () => {} },
    };
    const app = createApp(ctx, store);
    const screen = async () => { texts.length = 0; await app.render(); return texts.slice(); };
    const press = async (key) => {
        await app.render();
        const tg = last.targets.find((x) => x.key === key);
        assert(tg, 'no target ' + key + ' (have ' + last.targets.map((x) => x.key).join(' ') + ')');
        await tg.run();
    };
    const png = async (name) => {
        if (!OUT) return;
        await app.render();
        const c = new Canvas(1600, 520);
        play(last.words(), c);
        fs.mkdirSync(OUT, { recursive: true });
        fs.writeFileSync(path.join(OUT, name + '.png'), c.png());
    };
    return { store, app, screen, press, png };
}

(async () => {
    await check('store: Guest is always there and can not be changed or deleted', () => {
        const s = new LocalProfiles(tmpDir());
        assert.deepStrictEqual(s.list().map((p) => p.name), ['Guest']);
        assert.throws(() => s.update('guest', { name: 'X' }), ProfileError);
        assert.throws(() => s.remove('guest'), ProfileError);
        assert.throws(() => s.create({ name: 'guest' }), /Guest/);
    });

    await check('store: create, rename, recolour, delete; kept across a restart', () => {
        const dir = tmpDir(), s = new LocalProfiles(dir);
        const a = s.create({ name: '  Anna   Maria ' });
        assert.strictEqual(a.name, 'Anna Maria');
        assert.strictEqual(a.colour, COLOURS[0]);
        const b = s.create({ name: 'Bob', colour: COLOURS[3] });
        s.update(a.id, { name: 'Anna', colour: COLOURS[5] });
        const again = new LocalProfiles(dir);
        assert.deepStrictEqual(again.list().map((p) => p.name + ':' + p.colour), ['Guest:#9aa0a6', 'Anna:' + COLOURS[5], 'Bob:' + COLOURS[3]]);
        again.remove(b.id);
        assert.deepStrictEqual(new LocalProfiles(dir).list().map((p) => p.name), ['Guest', 'Anna']);
        // a new profile never gets the id of a deleted one
        const c = again.create({ name: 'Carl' });
        assert.notStrictEqual(c.id, b.id);
    });

    await check('store: empty, too long, duplicate names and the limit are refused', () => {
        const s = new LocalProfiles(tmpDir());
        assert.throws(() => s.create({ name: '   ' }), /Enter a name/);
        assert.throws(() => s.create({ name: 'x'.repeat(21) }), /At most 20/);
        const a = s.create({ name: 'Anna' });
        assert.throws(() => s.create({ name: 'ANNA' }), /already/);
        s.update(a.id, { name: 'anna' });           // its own name in another case is fine
        for (let i = 2; i < LIMIT; i++) s.create({ name: 'P' + i });
        assert.strictEqual(s.list().length, LIMIT);
        assert.throws(() => s.create({ name: 'One more' }), /delete one first/);
    });

    await check('store: a damaged file starts empty instead of stopping the app', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'profiles.json'), '{"profiles": [ {"id": "p1", "name": "Ok"}, {"id": 5}, nul');
        assert.deepStrictEqual(new LocalProfiles(dir).list().map((p) => p.name), ['Guest']);
        fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify({ seq: 3, profiles: [{ id: 'p1', name: 'Ok', colour: 'nope' }, { id: 'guest', name: 'Fake' }, { id: 'p2' }] }));
        const s = new LocalProfiles(dir);
        assert.deepStrictEqual(s.list().map((p) => p.name + ':' + p.colour), ['Guest:#9aa0a6', 'Ok:' + COLOURS[0]]);
        assert.strictEqual(s.create({ name: 'New' }).id, 'p4');
    });

    const h = harness(tmpDir());
    await check('screen: the list shows Guest and offers a new profile', async () => {
        const txt = await h.screen();
        assert(txt.includes('1 of ' + LIMIT + ' profiles'), txt.join('|'));
        assert(txt.includes('Guest'));
        assert(txt.includes('+  New profile'));
        await h.png('list-empty');
    });

    await check('screen: typing a name on the keyboard and saving it creates the profile', async () => {
        await h.press('new');
        assert.strictEqual(h.app.st.view, 'edit');
        for (const k of ['A', 'N', 'N', 'A']) await h.press('key:' + k);
        await h.press('key:space');
        for (const k of ['B', 'DEL', 'K']) await h.press('key:' + k);
        await h.press('colour:4');
        assert.strictEqual(h.app.st.draft.name, 'Anna K');     // capitals at the start of each word
        await h.png('edit-new');
        await h.press('save');
        assert.strictEqual(h.app.st.view, 'list');
        assert.deepStrictEqual(h.store.list().map((p) => p.name + ':' + p.colour), ['Guest:#9aa0a6', 'Anna K:' + COLOURS[4]]);
        const txt = await h.screen();
        assert(txt.includes('Created Anna K'), txt.join('|'));
    });

    await check('screen: a duplicate name shows the error and stays on the form', async () => {
        await h.press('card:new');
        for (const k of ['A', 'N', 'N', 'A']) await h.press('key:' + k);
        await h.press('key:space');
        await h.press('key:K');
        await h.press('save');
        assert.strictEqual(h.app.st.view, 'edit');
        const txt = await h.screen();
        assert(txt.some((s) => /already a profile called Anna K/.test(s)), txt.join('|'));
        await h.press('cancel');
        assert.strictEqual(h.store.list().length, 2);
    });

    await check('screen: Guest opens nothing; a card opens its profile to rename it', async () => {
        await h.press('card:guest');
        assert.strictEqual(h.app.st.view, 'list');
        const id = h.store.list()[1].id;
        await h.press('card:' + id);
        assert.strictEqual(h.app.st.draft.name, 'Anna K');
        await h.press('key:DEL'); await h.press('key:DEL');
        await h.press('key:SHIFT'); await h.press('key:Z');
        await h.png('edit-existing');
        await h.press('save');
        assert.strictEqual(h.store.get(id).name, 'AnnaZ');
    });

    await check('screen: Delete needs a second press', async () => {
        h.store.create({ name: 'Bob' });
        await h.png('list');
        const id = h.store.list()[1].id;
        await h.press('card:' + id);
        await h.press('delete');
        assert.strictEqual(h.store.list().length, 3, 'deleted on the first press');
        const txt = await h.screen();
        assert(txt.includes('CONFIRM'), txt.join('|'));
        await h.press('delete');
        assert.deepStrictEqual(h.store.list().map((p) => p.name), ['Guest', 'Bob']);
        assert.strictEqual(h.app.st.view, 'list');
    });

    await check('screen: a full list offers no new profile', async () => {
        for (let i = h.store.list().length; i < LIMIT; i++) h.store.create({ name: 'Driver ' + i });
        h.app.changed();
        const txt = await h.screen();
        assert(!txt.includes('+  New profile'));
        h.app.open(null);
        assert.strictEqual(h.app.st.view, 'list');
        await h.png('list-full');
    });

    // the car's personalisation services: slots guest and i01-i07, a slot's service there while its profile is
    const { CarProfiles } = require(path.join(APPS, 'glnulled_driver_profiles/car'));
    const PFX = 'de.bmw.infotainment.personalization.';
    function fakeCar() {
        const car = { names: { guest: 'guest', i01: 'TEST_NAME' }, current: 'guest', calls: [], full: false, refuse: null };
        const avail = {};
        const ref = (slot) => PFX + 'UserAccountManager.' + slot;
        const account = (slot) => ({
            isAvailable: () => slot in car.names,
            async getValue(f) {
                if (!(slot in car.names)) throw new Error('not available');
                if (f === 'id') return slot === 'guest' ? 'guest' : 'i3fa75' + slot.slice(-1);    // the account's short id, as in the car
                if (f === 'name') return car.names[slot];
                if (f === 'type') return slot === 'guest' ? 'GUEST' : 'USER';
                throw new Error('no field ' + f);
            },
            async setValue(f, v) { car.calls.push(['set', slot, f, v]); car.names[slot] = v; },
        });
        const proxies = {};
        car.signals = {
            hasNative: () => true,
            async proxy(iface, inst) {
                const slot = (/\.(guest|valet|i0\d)$/.exec(inst) || [])[1];
                return (proxies[inst] = iface === PFX + 'UserAccount' ? account(slot) : {
                    isAvailable: () => true,
                    async getValue(f) { if (f === 'currentUserAccountReference') return ref(car.current); throw new Error(f); },
                });
            },
            async onAvailable(p, fn) { avail[Object.keys(proxies).find((k) => proxies[k] === p)] = fn; if (p.isAvailable()) fn(true); },
            async on() {},
            async set(p, f, v) { return p.setValue(f, v); },
            async call(p, method, args) {
                car.calls.push([method, args]);
                if (car.refuse) return car.refuse;
                if (method === 'createUserAccount') {
                    if (car.full) return { CreateUserAccountResult: 'MAX_NUM_EXCEEDED', userAccountReference: '' };
                    const slot = ['i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07'].find((s) => !(s in car.names));
                    car.names[slot] = args.name;
                    return { CreateUserAccountResult: 'SUCCESS', userAccountReference: ref(slot) };
                }
                if (method === 'removeUserAccount') {
                    if (!/^de\.bmw\./.test(args.userAccountReference)) return { RemoveResult: 'FAILED' };
                    const slot = args.userAccountReference.split('.').pop();
                    if (slot === 'guest') return { RemoveResult: 'IS_PROTECTED_ACCOUNT' };
                    delete car.names[slot];
                    return { RemoveResult: 0 };
                }
                if (method === 'login') {
                    if (!/^de\.bmw\..*\.(guest|i0\d)$/.test(args.userAccountReference)) return { LoginResult: 'FAILED' };
                    car.current = args.userAccountReference.split('.').pop(); return { LoginResult: 'SUCCESS' };
                }
                throw new Error('unknown ' + method);
            },
        };
        return car;
    }
    const quiet = { info() {}, warn() {}, error() {} };

    await check('car: lists the car\'s profiles and the one in use', async () => {
        const car = fakeCar();
        const s = await new CarProfiles(car.signals, quiet).init();
        assert.deepStrictEqual(s.list().map((p) => p.id + ':' + p.name + ':' + p.kind + (p.active ? '*' : '')), ['guest:guest:guest*', 'i01:TEST_NAME:car']);
        assert.strictEqual(s.get('i01').ref, PFX + 'UserAccountManager.i01');
        assert.strictEqual(s.get('i01').account, 'i3fa751');
    });

    await check('car: create with a name, rename, switch to it, delete just that one', async () => {
        const car = fakeCar();
        const s = await new CarProfiles(car.signals, quiet).init();
        const p = await s.create({ name: '  Anna ' });
        assert.strictEqual(p.id, 'i02');
        assert.deepStrictEqual(car.calls[0], ['createUserAccount', { name: 'Anna' }]);
        await s.update('i01', { name: 'Bob' });
        assert.strictEqual(car.names.i01, 'Bob');
        await s.activate('i02');
        assert.strictEqual(car.current, 'i02');
        assert(s.get('i02').active);
        await s.remove('i01');
        assert.deepStrictEqual(Object.keys(car.names).sort(), ['guest', 'i02']);
        assert.deepStrictEqual(car.calls.find((c) => c[0] === 'removeUserAccount'), ['removeUserAccount', { userAccountReference: PFX + 'UserAccountManager.i01' }]);
    });

    await check('car: Guest stays, a full car and a refusal are told as they are', async () => {
        const car = fakeCar();
        const s = await new CarProfiles(car.signals, quiet).init();
        await assert.rejects(s.remove('guest'), /Guest/);
        await assert.rejects(s.update('guest', { name: 'X' }), /Guest/);
        await assert.rejects(s.create({ name: 'test_name' }), /already/);
        car.full = true;
        await assert.rejects(s.create({ name: 'Carl' }), /no room/);
        car.full = false; car.refuse = { CreateUserAccountResult: 2 };
        await assert.rejects(s.create({ name: 'Carl' }), /did not create.*FAILED/);
    });

    await check('screen: with the car\'s profiles, a card switches and renames them', async () => {
        const car = fakeCar();
        const s = await new CarProfiles(car.signals, quiet).init();
        let last = null;
        const a = createApp({ log: quiet, theme: () => themes.theme('m_tricolour'), ui: { image: async () => {} },
            canvas: (w, h) => { last = new Recorder(w, h); last.own = true; return last; } }, s, null);
        const press = async (k) => { await a.render(); const tg = last.targets.find((x) => x.key === k); assert(tg, 'no ' + k + ' in ' + last.targets.map((x) => x.key).join(' ')); await tg.run(); };
        await press('card:i01');
        assert(!last.targets.some((x) => /^colour:/.test(x.key)), 'no colours for the car\'s profiles');
        await press('activate');
        assert.strictEqual(car.current, 'i01');
        await press('card:i01');
        for (let i = 0; i < 9; i++) await press('key:DEL');
        for (const k of ['A', 'N', 'N', 'A']) await press('key:' + k);
        await press('save');
        assert.strictEqual(car.names.i01, 'Anna');
        await press('card:guest');
        await new Promise((r) => setTimeout(r, 5));
        assert.strictEqual(car.current, 'guest');
        if (OUT) { await a.render(); const c = new Canvas(1600, 520); play(last.words(), c); fs.writeFileSync(path.join(OUT, 'car-list.png'), c.png()); }
    });

    await check('keyboard: Russian layout types Cyrillic with capitals, LANG steps through the layouts on', async () => {
        const vals = { kb_en: true, kb_ru: true };
        let last = null;
        const a = createApp({ log: quiet, theme: () => themes.theme('m_tricolour'), ui: { image: async () => {} }, settings: { get: (k) => vals[k] },
            canvas: (w, h) => { last = new Recorder(w, h); last.own = true; return last; } }, new LocalProfiles(tmpDir()), null);
        const press = async (k) => { await a.render(); const tg = last.targets.find((x) => x.key === k); assert(tg, 'no ' + k); await tg.run(); };
        const keys = async () => { await a.render(); return last.targets.map((x) => x.key); };
        await press('card:new');
        assert((await keys()).includes('key:Q'));
        await press('key:lang');
        assert((await keys()).includes('key:Й') && !(await keys()).includes('key:Q'));
        for (const k of ['Г', 'Л', 'Е', 'Б']) await press('key:' + k);
        await press('key:space');
        await press('key:Ё');
        assert.strictEqual(a.st.draft.name, 'Глеб Ё');
        if (OUT) { await a.render(); const c = new Canvas(1600, 520); play(last.words(), c); fs.writeFileSync(path.join(OUT, 'edit-ru.png'), c.png()); }
        await press('save');
        assert.strictEqual(a.st.view, 'list');
        // every key of a row is on the screen, the 12-key row too
        await press('card:new'); await press('key:lang');
        assert(last.targets.filter((x) => /^key:/.test(x.key)).every((x) => x.x >= 0 && x.x + x.w <= 1600), 'a key off the screen');
        // Russian only: no LANG key, Cyrillic straight away
        vals.kb_en = false;
        assert(!(await keys()).includes('key:lang') && (await keys()).includes('key:Й'));
        // none on: English
        vals.kb_ru = false;
        assert((await keys()).includes('key:Q'));
    });

    await check('screen: the profile in use is marked without a frame; the focus frame follows the card\'s corners', async () => {
        const car = fakeCar();
        const s = await new CarProfiles(car.signals, quiet).init();
        let last = null;
        const a = createApp({ log: quiet, theme: () => themes.theme('m_tricolour'), ui: { image: async () => {} },
            canvas: (w, h) => { last = new Recorder(w, h); last.own = true; const tx = last.text.bind(last); last.texts = []; last.text = (t, ...r) => { last.texts.push(String(t)); return tx(t, ...r); }; return last; } }, s, null);
        await a.render();
        assert(last.texts.includes('IN USE'));
        assert(last.targets.filter((x) => /^card:/.test(x.key)).every((x) => x.r === 16));
    });

    if (failed) { console.log(failed + ' failed'); process.exit(1); }
    console.log('all passed' + (OUT ? ', screens in ' + OUT : ''));
})();
