'use strict';
/**
 * car.js - the head unit's own driver profiles, through its personalisation services (SOME/IP), the way the
 * HMI's Driver profiles menu uses them. From the unit's catalog (/etc/oap/someip/someip-interfaces.json):
 *
 *   SessionManager.currentUserAccountReference          the profile in use
 *   UserAccount (instances guest, i01 ... i07, valet)    one per profile slot: id, name (with a setter), type
 *   UserAccountManager.createUserAccount(name)           -> CreateUserAccountResult, the new profile's reference
 *   UserAccountManager.removeUserAccount(reference)      -> RemoveResult (one profile; Guest is protected)
 *   Authentication.login(reference)                      -> LoginResult (switches to that profile)
 *
 * Same shape as store.js LocalProfiles, but every call is async: list(), create(), update(), remove(), plus
 * activate(id) and current. Raw replies are logged, so a first run in a car shows their exact form.
 */
const PFX = 'de.bmw.infotainment.personalization.';
const IF = {
    manager: PFX + 'UserAccountManager',
    account: PFX + 'UserAccount',
    session: PFX + 'SessionManager',
    auth: PFX + 'Authentication',
};
const SLOTS = ['guest', 'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07'];
const TYPES = { 0: 'USER', 1: 'GUEST', 2: 'VALET', 3: 'FLEET' };
const MAX_NAME = 20;

const { ProfileError } = require('./store');

/** an enum the binding may give by name or by number */
const enumName = (v, names) => (typeof v === 'number' ? names[v] : typeof v === 'string' ? v : v && typeof v === 'object' ? enumName(Object.values(v)[0], names) : undefined);
/** the value of a one-field struct, or the value itself */
const plain = (v) => (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && Object.keys(v).length === 1 ? plain(Object.values(v)[0]) : v);
const str = (v) => { const p = plain(v); return p == null ? '' : Buffer.isBuffer(p) ? p.toString('utf8') : String(p); };
const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
/** the slot of a reference: "i01" in "de.bmw...UserAccountManager.i01" or "i01" */
const slotOf = (ref) => { const m = /(?:^|\.)(guest|valet|i0\d)\s*$/.exec(String(ref || '').trim()); return m ? m[1] : null; };
/** a call's named output (the binding returns the method's outputs as a struct) */
const out = (r, name) => (r && typeof r === 'object' && name in r ? r[name] : r && typeof r === 'object' ? Object.values(r)[0] : r);

class CarProfiles {
    constructor(signals, log) {
        this.signals = signals; this.log = log;
        this.limit = SLOTS.length;          // Guest + 7, as the unit's slots i01-i07
        this.source = 'Profiles of the car';
        this.car = true;
        this.accounts = {};                 // slot -> { proxy, available }
        this.items = [];
        this.current = null;                // slot of the profile in use
        this.error = null;
        this._listeners = [];
    }

    onChange(fn) { this._listeners.push(fn); }
    _changed() { this._listeners.forEach((f) => { try { f(); } catch (e) { /* drawing only */ } }); }

    async init() {
        const s = this.signals;
        this.manager = await s.proxy(IF.manager, IF.manager);
        this.auth = await s.proxy(IF.auth, IF.auth);
        this.session = await s.proxy(IF.session, IF.session);
        for (const slot of SLOTS) {
            const a = { proxy: null, available: false };
            this.accounts[slot] = a;
            try {
                a.proxy = await s.proxy(IF.account, IF.manager + '.' + slot);
                // a slot's service comes and goes with its profile
                await s.onAvailable(a.proxy, (on) => { if (a.available !== on) { a.available = on; this._soon(); } });
            } catch (e) { this.log.warn('profile slot ' + slot + ': ' + e); }
        }
        try { await s.on(this.session, 'currentUserOnChange', (v) => { this.current = slotOf(str(v)); this._changed(); }, this.log); } catch (e) { this.log.warn('currentUserOnChange: ' + e); }
        await this.refresh();
        return this;
    }

    _soon() {
        clearTimeout(this._t);
        this._t = setTimeout(() => this.refresh().catch((e) => this.log.warn('refresh: ' + e)), 300);
    }

    async _get(p, field) { return p.getValue(field, 3000); }

    /** read every profile slot that is there, and which one is in use */
    async refresh() {
        const items = [];
        for (const slot of SLOTS) {
            const a = this.accounts[slot];
            if (!a || !a.proxy || !(a.available || (a.proxy.isAvailable && a.proxy.isAvailable()))) continue;
            try {
                const [id, name, type] = await Promise.all([this._get(a.proxy, 'id').catch(() => null), this._get(a.proxy, 'name'), this._get(a.proxy, 'type').catch(() => null)]);
                if (!this._logged) this.log.info('profile ' + slot + ' raw: id ' + show(id) + ', name ' + show(name) + ', type ' + show(type));
                const kind = enumName(type, TYPES) || (slot === 'guest' ? 'GUEST' : 'USER');
                if (kind === 'VALET') continue;
                // the car refers to a profile by its slot's instance (createUserAccount's reference, the current one);
                // id is the account's own short id (E333's 7 characters)
                items.push({ id: slot, ref: IF.manager + '.' + slot, account: str(id), name: str(name) || (slot === 'guest' ? 'Guest' : slot),
                    kind: kind === 'GUEST' ? 'guest' : 'car', colour: null });
            } catch (e) { this.log.warn('profile ' + slot + ': ' + e); }
        }
        try {
            const c = await this._get(this.session, 'currentUserAccountReference');
            if (!this._logged) this.log.info('current profile raw: ' + show(c));
            this.current = slotOf(str(c)) || this.current;
        } catch (e) { this.log.warn('current profile: ' + e); }
        this._logged = true;
        this.items = items;
        this.error = items.length ? null : 'The car listed no profiles';
        this._changed();
        return items;
    }

    list() { return this.items.map((p) => Object.assign({ active: p.id === this.current }, p)); }
    get(id) { return this.list().find((p) => p.id === id) || null; }

    _name(name, exceptId) {
        const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        if (!n) throw new ProfileError('name-empty', 'Enter a name');
        if (n.length > MAX_NAME) throw new ProfileError('name-long', 'At most ' + MAX_NAME + ' characters');
        if (this.items.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) throw new ProfileError('name-taken', 'There is already a profile called ' + n);
        return n;
    }

    async create(fields) {
        const name = this._name(fields && fields.name);
        const r = await this.signals.call(this.manager, 'createUserAccount', { name }, 10000);
        this.log.info('createUserAccount(' + name + ') raw: ' + show(r));
        const res = enumName(out(r, 'CreateUserAccountResult'), { 0: 'SUCCESS', 1: 'MAX_NUM_EXCEEDED', 2: 'FAILED' });
        if (res === 'MAX_NUM_EXCEEDED') throw new ProfileError('full', 'The car has no room for another profile');
        if (res !== 'SUCCESS') throw new ProfileError('failed', 'The car did not create the profile (' + (res || show(r)) + ')');
        const ref = str(r && typeof r === 'object' ? Object.values(r)[1] : '');
        await this.refresh();
        return this.get(slotOf(ref)) || { id: slotOf(ref), ref, name, kind: 'car' };
    }

    async update(id, fields) {
        if (id === 'guest') throw new ProfileError('guest', 'The Guest profile can\'t be changed');
        const a = this.accounts[id];
        if (!a || !a.proxy || !this.get(id)) throw new ProfileError('missing', 'This profile no longer exists');
        const name = this._name(fields && fields.name, id);
        const r = await this.signals.set(a.proxy, 'name', name, 8000);
        this.log.info('rename ' + id + ' -> ' + name + ' raw: ' + show(r));
        await this.refresh();
        return this.get(id);
    }

    async remove(id) {
        const p = this.get(id);
        if (!p) throw new ProfileError('missing', 'This profile no longer exists');
        if (p.kind === 'guest') throw new ProfileError('guest', 'The Guest profile can\'t be deleted');
        const r = await this.signals.call(this.manager, 'removeUserAccount', { userAccountReference: p.ref }, 10000);
        this.log.info('removeUserAccount(' + p.ref + ') raw: ' + show(r));
        const res = enumName(out(r, 'RemoveResult'), { 0: 'SUCCESS', 1: 'FAILED', 2: 'IS_PROTECTED_ACCOUNT' });
        if (res === 'IS_PROTECTED_ACCOUNT') throw new ProfileError('protected', 'The car keeps this profile (protected)');
        if (res !== 'SUCCESS') throw new ProfileError('failed', 'The car did not delete the profile (' + (res || show(r)) + ')');
        await this.refresh();
        return true;
    }

    /** switch the car to this profile (as choosing it in the HMI's Driver profiles menu) */
    async activate(id) {
        const p = this.get(id);
        if (!p) throw new ProfileError('missing', 'This profile no longer exists');
        const r = await this.signals.call(this.auth, 'login', { userAccountReference: p.ref }, 15000);
        this.log.info('login(' + p.ref + ') raw: ' + show(r));
        const res = enumName(out(r, 'LoginResult'), { 0: 'SUCCESS', 1: 'FAILED', 2: 'PROTECTED' });
        if (res === 'PROTECTED') throw new ProfileError('protected', 'This profile is protected (PIN or key): choose it in the car\'s menu');
        if (res !== 'SUCCESS') throw new ProfileError('failed', 'The car did not switch (' + (res || show(r)) + ')');
        this.current = id;
        await this.refresh();
        return true;
    }
}

module.exports = { CarProfiles, ProfileError, IF, SLOTS, slotOf, enumName };
