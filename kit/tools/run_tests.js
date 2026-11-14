'use strict';
// Runs every kit/tools/test_*.js (no SDK, renderer or car needed) and says which failed:
//   node kit/tools/run_tests.js        (npm test)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const tests = fs.readdirSync(dir).filter((f) => /^test_.*\.js$/.test(f)).sort();
const failed = [];
for (const t of tests) {
    const r = spawnSync(process.execPath, [path.join(dir, t)], { encoding: 'utf8' });
    const ok = r.status === 0;
    console.log((ok ? 'ok   ' : 'FAIL ') + t);
    if (!ok) { failed.push(t); process.stdout.write((r.stdout || '') + (r.stderr || '')); }
}
console.log(failed.length ? failed.length + ' of ' + tests.length + ' failed: ' + failed.join(', ') : 'all ' + tests.length + ' passed');
process.exit(failed.length ? 1 : 0);
