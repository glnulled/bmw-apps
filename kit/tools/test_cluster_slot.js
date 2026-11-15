'use strict';

// glnulled-cluster-slot (kit/cluster-slot): panel-slot.sh on a stand-in of the unit's cluster-render.local.conf, with
// systemctl stubbed, and the tool's manifests (component.json, mgu-repo.json, Customizer's requirement). No car needed:
//   node kit/tools/test_cluster_slot.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'kit/cluster-slot');
const SH = path.join(TOOL, 'panel-slot.sh');
const tmps = [];
process.on('exit', () => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

let failed = 0;
const check = (name, fn) => {
    try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); }
};

/** a unit: its folder for the conf and a systemctl that only notes what it was asked */
function unit() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-')); tmps.push(dir);
    const conf = path.join(dir, 'cluster-render.local.conf'), calls = path.join(dir, 'systemctl.calls'), ctl = path.join(dir, 'systemctl');
    fs.writeFileSync(ctl, '#!/bin/sh\necho "$@" >> "' + calls + '"\n', { mode: 0o755 });
    const run = (...a) => spawnSync('sh', [SH].concat(a), { encoding: 'utf8', env: Object.assign({}, process.env, { CLUSTER_SLOT_CONF: conf, CLUSTER_SLOT_SYSTEMCTL: ctl }) });
    return { conf, run, read: () => (fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : null),
        restarts: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0) };
}

check('set: no file yet: the slot with its mark, cluster-render started again; twice changes nothing', () => {
    const u = unit();
    let r = u.run('set');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert(/^# glnulled-cluster-slot:.*\npanel_slot = 0x105\n$/.test(u.read()), u.read());
    assert.strictEqual(u.restarts(), 1);
    const before = u.read();
    r = u.run('set');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(u.read(), before);
    assert.strictEqual(u.restarts(), 1, 'nothing changed: not started again');
});

check('set: the unit\'s other settings stay; unset removes only ours and keeps the file', () => {
    const u = unit();
    fs.writeFileSync(u.conf, '# mine\nhud_yield_slots = 0x321,0x322\n');
    assert.strictEqual(u.run('set').status, 0);
    assert(/hud_yield_slots = 0x321,0x322\n# glnulled-cluster-slot:.*\npanel_slot = 0x105\n$/.test(u.read()), u.read());
    assert.strictEqual(u.run('unset').status, 0);
    assert.strictEqual(u.read(), '# mine\nhud_yield_slots = 0x321,0x322\n');
    assert.strictEqual(u.restarts(), 2);
});

check('set: a panel_slot the unit set by hand is left as it is, and unset leaves it too', () => {
    const u = unit(), own = '# by hand\npanel_slot = 0x203\n';
    fs.writeFileSync(u.conf, own);
    const r = u.run('set');
    assert.strictEqual(r.status, 0);
    assert(/left as it is/.test(r.stdout), r.stdout);
    assert.strictEqual(u.read(), own);
    assert.strictEqual(u.run('unset').status, 0);
    assert.strictEqual(u.read(), own);
    assert.strictEqual(u.restarts(), 0);
});

check('unset: ours alone in the file: the file goes, cluster-render started again; another slot replaces ours', () => {
    const u = unit();
    u.run('set');
    spawnSync('sh', [SH, 'set'], { env: Object.assign({}, process.env, { CLUSTER_SLOT_CONF: u.conf, CLUSTER_SLOT_SYSTEMCTL: 'true', CLUSTER_SLOT: '0x104' }) });
    assert(/panel_slot = 0x104\n$/.test(u.read()) && !/0x105/.test(u.read()), u.read());
    assert.strictEqual((u.read().match(/panel_slot/g) || []).length, 1);
    assert.strictEqual(u.run('unset').status, 0);
    assert.strictEqual(u.read(), null);
});

check('set: no cluster-render folder: refused, nothing written', () => {
    const r = spawnSync('sh', [SH, 'set'], { encoding: 'utf8', env: Object.assign({}, process.env, { CLUSTER_SLOT_CONF: '/nonexistent-cluster-render/x.conf', CLUSTER_SLOT_SYSTEMCTL: 'true' }) });
    assert.strictEqual(r.status, 1);
    assert(/not installed/.test(r.stdout), r.stdout);
});

check('manifests: the tool is what the Store\'s deploy tool takes, the source lists it, Customizer requires it', () => {
    const c = JSON.parse(fs.readFileSync(path.join(TOOL, 'component.json'), 'utf8'));
    assert(/^[a-z0-9][a-z0-9-]*$/.test(c.id) && c.kind === 'tool' && /^\d+\.\d+\.\d+$/.test(c.version));
    c.files.forEach((f) => assert(fs.statSync(path.join(TOOL, f.path)).isFile(), f.path));
    ['activate', 'deactivate'].forEach((k) => {
        const f = c.files.find((x) => x.path === c[k][0]);
        assert(f && (parseInt(f.mode, 8) & 0o111), k + ' names an executable file of the tool');
        assert(fs.statSync(path.join(TOOL, f.path)).mode & 0o111, f.path + ' is executable in the repository');
    });
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
    const t = (repo.tools || []).find((x) => x.id === c.id);
    assert(t && t.path === 'kit/cluster-slot', 'mgu-repo.json lists the tool at its path');
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/glnulled_customizer/app.json'), 'utf8'));
    assert.strictEqual(app.requires[c.id], c.version, 'Customizer requires this version');
    assert(app.requires['cluster-render'] && c.requires['cluster-render']);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
