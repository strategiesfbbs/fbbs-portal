'use strict';

/**
 * Smoke tests for server/report-store.js. Uses a temp dir; no network,
 * no shared state.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../server/report-store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'report-store-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

const REP = { username: 'mjones', displayName: 'Mike Jones', source: 'cookie' };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

test('ensureReportDatabase creates the file and yields a sequence', () => {
  store.ensureReportDatabase(tmp);
  assert.ok(fs.existsSync(path.join(tmp, 'reports.sqlite')));
  const id1 = store.nextReportId(tmp, new Date('2026-06-01'));
  const id2 = store.nextReportId(tmp, new Date('2026-06-01'));
  assert.match(id1, /^RP-2026-\d{4}$/);
  assert.match(id2, /^RP-2026-\d{4}$/);
  assert.notStrictEqual(id1, id2);
});

test('createReportDefinition round-trips all fields incl. JSON columns + rep attribution', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-create-'));
  const r = store.createReportDefinition(dir, {
    name: 'Coverage Pipeline',
    type: 'custom-bank',
    folder: 'Coverage',
    description: 'Sub-S ag banks under $500M',
    filters: { states: 'IA, IL', minAssets: '100000', savedOnly: true },
    columns: ['displayName', 'state', 'totalAssets'],
    sort: { key: 'totalAssets', dir: 'desc' },
    pinned: true
  }, REP);
  assert.match(r.id, /^RP-\d{4}-\d{4}$/);
  assert.strictEqual(r.name, 'Coverage Pipeline');
  assert.strictEqual(r.type, 'custom-bank');
  assert.strictEqual(r.folder, 'Coverage');
  assert.strictEqual(r.pinned, true);
  assert.deepStrictEqual(r.filters, { states: 'IA, IL', minAssets: '100000', savedOnly: true });
  assert.deepStrictEqual(r.columns, ['displayName', 'state', 'totalAssets']);
  assert.deepStrictEqual(r.sort, { key: 'totalAssets', dir: 'desc' });
  assert.strictEqual(r.createdBy, 'mjones');
  assert.strictEqual(r.createdByName, 'Mike Jones');
  assert.ok(r.createdAt && r.updatedAt);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unknown type falls back to custom-bank; null rep leaves createdBy empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-type-'));
  const r = store.createReportDefinition(dir, { name: 'X', type: 'not-a-type' }, null);
  assert.strictEqual(r.type, 'custom-bank');
  assert.strictEqual(r.createdBy, '');
  assert.strictEqual(r.createdByName, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('activity report types are accepted (Phase 4)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-activity-'));
  const a = store.createReportDefinition(dir, { name: 'A', type: 'activity-by-rep' }, REP);
  const b = store.createReportDefinition(dir, { name: 'B', type: 'account-touch' }, REP);
  assert.strictEqual(a.type, 'activity-by-rep');
  assert.strictEqual(b.type, 'account-touch');
  assert.ok(store.REPORT_TYPES.has('activity-by-rep') && store.REPORT_TYPES.has('account-touch'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('create honoring a supplied id upserts (migration path) — no duplicate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-upsert-'));
  store.createReportDefinition(dir, { id: 'saved-123', name: 'First', type: 'custom-bank' }, REP);
  store.createReportDefinition(dir, { id: 'saved-123', name: 'Renamed', type: 'bank-peer' }, REP);
  const all = store.listReportDefinitions(dir);
  assert.strictEqual(all.length, 1, 'upsert by id must not duplicate');
  assert.strictEqual(all[0].id, 'saved-123');
  assert.strictEqual(all[0].name, 'Renamed');
  assert.strictEqual(all[0].type, 'bank-peer');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('updateReportDefinition partial patch preserves createdAt/createdBy; null for missing id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-update-'));
  const created = store.createReportDefinition(dir, { id: 'r1', name: 'Orig', pinned: false }, REP);
  const patched = store.updateReportDefinition(dir, 'r1', { name: 'Edited', pinned: true });
  assert.strictEqual(patched.name, 'Edited');
  assert.strictEqual(patched.pinned, true);
  assert.strictEqual(patched.createdAt, created.createdAt, 'createdAt preserved');
  assert.strictEqual(patched.createdBy, 'mjones', 'createdBy preserved');
  assert.strictEqual(store.updateReportDefinition(dir, 'nope', { name: 'x' }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listReportDefinitions orders pinned first and respects limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-list-'));
  store.createReportDefinition(dir, { name: 'A', pinned: false }, REP);
  store.createReportDefinition(dir, { name: 'B', pinned: false }, REP);
  store.createReportDefinition(dir, { name: 'C', pinned: true }, REP);
  const all = store.listReportDefinitions(dir);
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].name, 'C', 'pinned row sorts first');
  const capped = store.listReportDefinitions(dir, { limit: 2 });
  assert.strictEqual(capped.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deleteReportDefinition returns the row, then null on a second delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-delete-'));
  store.createReportDefinition(dir, { id: 'd1', name: 'Doomed' }, REP);
  const deleted = store.deleteReportDefinition(dir, 'd1');
  assert.ok(deleted && deleted.id === 'd1');
  assert.strictEqual(store.getReportDefinition(dir, 'd1'), null);
  assert.strictEqual(store.deleteReportDefinition(dir, 'd1'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hidden list: add/remove, incl. ids with no definition row (fixtures)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-hidden-'));
  assert.deepStrictEqual(store.listHiddenReportIds(dir), []);
  store.setReportHidden(dir, 'fixture-opportunity', true, REP); // no definition row — must still work
  let hidden = store.setReportHidden(dir, 'saved-9', true, null);
  assert.deepStrictEqual(hidden, ['saved-9']);
  assert.deepStrictEqual(store.listHiddenReportIds(dir, REP), ['fixture-opportunity']);
  hidden = store.setReportHidden(dir, 'fixture-opportunity', false, REP);
  assert.ok(!hidden.includes('fixture-opportunity'));
  hidden = store.listHiddenReportIds(dir);
  assert.ok(hidden.includes('saved-9'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hidden list is scoped per rep', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-hidden-rep-'));
  const alice = { username: 'alice', displayName: 'Alice' };
  const bob = { username: 'bob', displayName: 'Bob' };
  store.setReportHidden(dir, 'fixture-opportunity', true, alice);
  store.setReportHidden(dir, 'fixture-coverage', true, bob);
  assert.deepStrictEqual(store.listHiddenReportIds(dir, alice), ['fixture-opportunity']);
  assert.deepStrictEqual(store.listHiddenReportIds(dir, bob), ['fixture-coverage']);
  assert.deepStrictEqual(store.listHiddenReportIds(dir), []);
  store.setReportHidden(dir, 'fixture-opportunity', false, alice);
  assert.deepStrictEqual(store.listHiddenReportIds(dir, alice), []);
  assert.deepStrictEqual(store.listHiddenReportIds(dir, bob), ['fixture-coverage']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tricky values round-trip (parameterized, not interpolated)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-tricky-'));
  const tricky = `O'Brien % _ \\ "quoted" ; DROP`;
  const r = store.createReportDefinition(dir, {
    name: tricky,
    filters: { search: tricky }
  }, REP);
  const round = store.getReportDefinition(dir, r.id);
  assert.strictEqual(round.name, tricky);
  assert.strictEqual(round.filters.search, tricky);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`report-store tests: ${passed} passed.`);
