'use strict';
/**
 * store.js - the driver profiles the app shows and changes.
 *
 * LocalProfiles keeps them in the app's own data folder (data/profiles.json), so they survive
 * reboots and work the same in the car, in preview.js and in the emulator. The Guest profile is
 * always there and can't be changed or deleted, as in the car.
 *
 * Every backend has the same shape, so the screen does not care where profiles live:
 *   list()                      -> [{ id, name, colour, kind: 'guest' | 'local', created, updated }]
 *   create({ name, colour })    -> the new profile          (throws ProfileError)
 *   update(id, { name, colour })-> the changed profile      (throws ProfileError)
 *   remove(id)                  -> true                     (throws ProfileError)
 *   limit                       -> how many profiles fit, Guest included
 *   source                      -> where they are kept, shown on the screen
 *
 * The head unit's own profile manager is a SOME/IP service whose interface is only in the unit's
 * catalog (/etc/oap/someip/someip-interfaces.json). A backend for it can take this shape once the
 * catalog is known; until then the app keeps its own profiles.
 */
const fs = require('fs');
const path = require('path');

const MAX_NAME = 20;
const LIMIT = 8;                 // Guest + 7 of your own
const COLOURS = ['#1c69d4', '#e4002b', '#2ea44f', '#f5a623', '#8957e5', '#00b5c8', '#e754a5', '#9aa0a6'];
const GUEST = { id: 'guest', name: 'Guest', colour: '#9aa0a6', kind: 'guest', created: 0, updated: 0 };

class ProfileError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

/** a name as it is kept: no spaces at the ends, inner runs of spaces as one */
function cleanName(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

class LocalProfiles {
    /** dir: the app's data folder; now: clock (tests) */
    constructor(dir, opts) {
        this.file = path.join(dir, 'profiles.json');
        this.now = (opts && opts.now) || (() => Date.now());
        this.log = (opts && opts.log) || null;
        this.limit = LIMIT;
        this.source = 'Saved in this app';
        this._items = this._load();
    }

    _load() {
        try {
            const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            const items = Array.isArray(j && j.profiles) ? j.profiles : [];
            this._seq = (j && j.seq) | 0;
            // keep only well-formed entries: a hand-edited or half-written file must not stop the app
            return items.filter((p) => p && typeof p.id === 'string' && p.id !== GUEST.id && cleanName(p.name))
                .slice(0, LIMIT - 1)
                .map((p) => ({ id: p.id, name: cleanName(p.name).slice(0, MAX_NAME), colour: COLOURS.indexOf(p.colour) >= 0 ? p.colour : COLOURS[0],
                    kind: 'local', created: +p.created || 0, updated: +p.updated || 0 }));
        } catch (e) {
            if (e.code !== 'ENOENT' && this.log) this.log.warn('profiles.json unreadable, starting empty: ' + e.message);
            this._seq = 0;
            return [];
        }
    }

    _save() {
        // a new file renamed over the old one: a reset in the middle of a write leaves either
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, seq: this._seq, profiles: this._items }, null, 1));
        fs.renameSync(tmp, this.file);
    }

    list() { return [Object.assign({}, GUEST)].concat(this._items.map((p) => Object.assign({}, p))); }

    get(id) { return this.list().find((p) => p.id === id) || null; }

    _check(name, colour, exceptId) {
        const n = cleanName(name);
        if (!n) throw new ProfileError('name-empty', 'Enter a name');
        if (n.length > MAX_NAME) throw new ProfileError('name-long', 'At most ' + MAX_NAME + ' characters');
        if (n.toLowerCase() === GUEST.name.toLowerCase()) throw new ProfileError('name-taken', 'Guest is the car\'s own profile');
        if (this._items.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase())) {
            throw new ProfileError('name-taken', 'There is already a profile called ' + n);
        }
        if (colour !== undefined && COLOURS.indexOf(colour) < 0) throw new ProfileError('colour', 'Unknown colour');
        return n;
    }

    create(fields) {
        const f = fields || {};
        if (this._items.length + 1 >= LIMIT) throw new ProfileError('full', 'All ' + LIMIT + ' profiles are in use: delete one first');
        const name = this._check(f.name, f.colour === undefined ? undefined : f.colour);
        const t = this.now();
        const used = this._items.map((p) => p.colour);
        const colour = f.colour || COLOURS.find((c) => used.indexOf(c) < 0) || COLOURS[0];
        const p = { id: 'p' + (++this._seq), name, colour, kind: 'local', created: t, updated: t };
        this._items.push(p);
        this._save();
        return Object.assign({}, p);
    }

    update(id, fields) {
        if (id === GUEST.id) throw new ProfileError('guest', 'The Guest profile can\'t be changed');
        const p = this._items.find((x) => x.id === id);
        if (!p) throw new ProfileError('missing', 'This profile no longer exists');
        const f = fields || {};
        const name = f.name === undefined ? p.name : this._check(f.name, undefined, id);
        if (f.colour !== undefined && COLOURS.indexOf(f.colour) < 0) throw new ProfileError('colour', 'Unknown colour');
        p.name = name;
        if (f.colour !== undefined) p.colour = f.colour;
        p.updated = this.now();
        this._save();
        return Object.assign({}, p);
    }

    remove(id) {
        if (id === GUEST.id) throw new ProfileError('guest', 'The Guest profile can\'t be deleted');
        const i = this._items.findIndex((x) => x.id === id);
        if (i < 0) throw new ProfileError('missing', 'This profile no longer exists');
        this._items.splice(i, 1);
        this._save();
        return true;
    }
}

module.exports = { LocalProfiles, ProfileError, cleanName, COLOURS, MAX_NAME, LIMIT, GUEST };
