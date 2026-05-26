'use strict';

// Regression tests for peer-group-store. Uses a fresh tmp dir per run so
// nothing leaks across CI runs. We hit sqlite3 via the same CLI path the
// production code does — if `sqlite3` is missing we skip with a clear
// message so other suites still run.

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function sqliteAvailable() {
  try {
    const r = childProcess.spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

if (!sqliteAvailable()) {
  console.log('peer-group-store tests: skipped (sqlite3 CLI not available)');
  process.exit(0);
}

const store = require('../server/peer-group-store');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-peer-test-'));
try {
  // --- normalizeCriteria ---
  const empty = store.normalizeCriteria({});
  ok('normalize-empty', Object.keys(empty).length === 0);

  const c = store.normalizeCriteria({
    assetMin: '100000',
    assetMax: 500000,
    states: ['il', 'IA', 'MO', 'il', '??', 'TX'],
    subchapterS: 'Yes',
    loanMix: [
      { key: 'agSum', op: '>=', value: '25' },
      { key: 'bogus', op: '>=', value: 10 },
      { key: 'ciLoansToLoans', op: 'INVALID', value: 5 }
    ]
  });
  ok('normalize-assetMin coerced', c.assetMin === 100000);
  ok('normalize-assetMax preserved', c.assetMax === 500000);
  ok('normalize-states sorted+uniq+upper', JSON.stringify(c.states) === JSON.stringify(['IA', 'IL', 'MO', 'TX']),
    `got ${JSON.stringify(c.states)}`);
  ok('normalize-subS preserved', c.subchapterS === 'Yes');
  ok('normalize-loanMix filters bogus', c.loanMix.length === 1
    && c.loanMix[0].key === 'agSum' && c.loanMix[0].op === '>=' && c.loanMix[0].value === 25);

  ok('normalize-subS rejects invalid', store.normalizeCriteria({ subchapterS: 'Maybe' }).subchapterS === undefined);
  ok('criteriaIsEmpty true', store.criteriaIsEmpty({}) === true);
  ok('criteriaIsEmpty false', store.criteriaIsEmpty({ assetMin: 100 }) === false);

  // --- CRUD ---
  const created = store.createPeerGroup(tmpDir, {
    name: 'Test Group',
    description: 'unit test',
    criteria: { assetMax: 500000, states: ['IL', 'IA'] }
  });
  ok('create returns id', /^PG-\d{4}$/.test(created.id), created.id);
  ok('create persists name', created.name === 'Test Group');
  ok('create normalized criteria', created.criteria.assetMax === 500000
    && JSON.stringify(created.criteria.states) === '["IA","IL"]');

  const fetched = store.getPeerGroup(tmpDir, created.id);
  ok('get round-trip', fetched && fetched.id === created.id && fetched.name === 'Test Group');

  ok('create rejects empty name', (() => {
    try { store.createPeerGroup(tmpDir, { name: '' }); return false; }
    catch (e) { return /name is required/i.test(e.message); }
  })());

  const second = store.createPeerGroup(tmpDir, { name: 'Second', criteria: {} });
  ok('ids increment', second.id === 'PG-0002');

  const updated = store.updatePeerGroup(tmpDir, created.id, {
    name: 'Test Group Renamed',
    criteria: { assetMin: 100000 }
  });
  ok('update name', updated.name === 'Test Group Renamed');
  ok('update criteria replaced', updated.criteria.assetMin === 100000 && updated.criteria.assetMax === undefined);
  ok('update keeps id', updated.id === created.id);

  const list = store.listPeerGroups(tmpDir);
  ok('list returns active', list.length === 2);

  store.archivePeerGroup(tmpDir, created.id);
  const afterArchive = store.listPeerGroups(tmpDir);
  ok('archive removes from default list', afterArchive.length === 1 && afterArchive[0].id === second.id);

  const withArchived = store.listPeerGroups(tmpDir, { includeArchived: true });
  ok('list+includeArchived sees both', withArchived.length === 2);

  store.restorePeerGroup(tmpDir, created.id);
  ok('restore brings it back', store.listPeerGroups(tmpDir).length === 2);

  ok('delete returns true', store.deletePeerGroup(tmpDir, created.id) === true);
  ok('delete removes row', store.getPeerGroup(tmpDir, created.id) === null);

  // --- Seeding ---
  // After deleting everything, seed should populate defaults.
  store.deletePeerGroup(tmpDir, second.id);
  ok('table empty before seed', store.listPeerGroups(tmpDir).length === 0);
  const seeded = store.seedDefaultPeerGroups(tmpDir);
  ok('seed creates defaults', seeded.length >= 4, `got ${seeded.length}`);
  const reseed = store.seedDefaultPeerGroups(tmpDir);
  ok('seed is idempotent', reseed.length === 0);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`peer-group-store tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
