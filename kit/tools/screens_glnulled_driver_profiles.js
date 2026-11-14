'use strict';
/**
 * Driver profiles' screenshots for the README (docs/screens/driver_profiles*.png): the app's own drawing code on a
 * stand-in for the car's personalisation services, through the kit's software rasteriser (the same picture the GPU
 * renderer draws). No SDK or car needed:
 *   node kit/tools/screens_glnulled_driver_profiles.js [out-dir]     (default docs/screens)
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..');
const kit = path.join(ROOT, 'kit', 'runtime');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs', 'screens'));
// the Cyrillic atlas, as the build puts it beside the app (app.json "fonts"); taken away again at the end
const CYR = path.join(kit, 'fonts', 'cyrillic.json');
const hadCyr = fs.existsSync(CYR);
if (!hadCyr) fs.copyFileSync(path.join(ROOT, 'kit', 'localization', 'fonts', 'cyrillic-ru.json'), CYR);

const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './kit/mgu') return { run() {} };
    if (req.startsWith('./kit/')) return load.call(this, path.join(kit, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const APP = path.join(ROOT, 'apps', 'glnulled_driver_profiles');
const { createApp } = require(path.join(APP, 'main'));
const { CarProfiles } = require(path.join(APP, 'car'));
Module._load = load;
const { Recorder, play } = require(path.join(kit, 'record'));
const { Canvas } = require(path.join(kit, 'canvas'));
const themes = require(path.join(kit, 'themes'));

// the car: Guest and three profiles, Anna in use
const PFX = 'de.bmw.infotainment.personalization.UserAccountManager.';
const car = { names: { guest: 'Guest', i01: 'Anna', i02: 'Max', i03: 'Ольга' }, current: 'i01' };
const slotOf = (inst) => (/\.(guest|valet|i0\d)$/.exec(inst) || [])[1];
const signals = {
    hasNative: () => true,
    async proxy(iface, inst) {
        const slot = slotOf(inst);
        if (/\.UserAccount$/.test(iface)) {
            return { isAvailable: () => slot in car.names,
                async getValue(f) { return f === 'id' ? slot : f === 'name' ? car.names[slot] : slot === 'guest' ? 'GUEST' : 'USER'; } };
        }
        return { isAvailable: () => true, async getValue() { return PFX + car.current; } };
    },
    async onAvailable(p, fn) { if (p.isAvailable()) fn(true); },
    async on() {},
    async set() {},
    async call() { return {}; },
};

(async () => {
    try {
        fs.mkdirSync(OUT, { recursive: true });
        const store = await new CarProfiles(signals, { info() {}, warn() {}, error() {} }).init();
        const vals = { kb_en: true, kb_ru: true };
        let last = null;
        const app = createApp({ log: { info() {}, warn() {}, error() {} }, theme: () => themes.theme('m_tricolour'),
            settings: { get: (k) => vals[k] }, ui: { image: async () => {} },
            canvas: (w, h) => { last = new Recorder(w, h); last.own = true; return last; } }, store);
        const press = async (k) => { await app.render(); const t = last.targets.find((x) => x.key === k); if (!t) throw new Error('no ' + k); await t.run(); };
        // the cursor drawn (it blinks with the clock)
        const now = Date.now;
        Date.now = () => 1060;
        const shot = async (name) => {
            await app.render();
            const c = new Canvas(1600, 520);
            play(last.words(), c);
            fs.writeFileSync(path.join(OUT, name + '.png'), c.png());
            console.log(path.relative(ROOT, path.join(OUT, name + '.png')));
        };
        await shot('driver_profiles');
        await press('card:i02');                                          // Max: rename, use, delete
        await shot('driver_profiles_edit');
        await press('cancel');
        await press('card:new');                                          // a new one, typed in Russian
        await press('key:lang');
        for (const k of ['Д', 'М', 'И', 'Т', 'Р', 'И', 'Й']) await press('key:' + k);
        await shot('driver_profiles_ru');
        Date.now = now;
    } finally {
        if (!hadCyr) fs.unlinkSync(CYR);
    }
})().catch((e) => { console.error(e); process.exit(1); });
