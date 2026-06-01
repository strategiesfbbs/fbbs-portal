'use strict';

/**
 * Tests for server/strategy-store.js summarizeStrategyCountsByBank — the
 * uncapped per-bank strategy aggregation the Coverage Book relies on.
 * listStrategyRequests caps at 500 rows; the summary must count everything.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../server/strategy-store');
const sqliteDb = require('../server/sqlite-db');

const tmpDirs = [];
function freshDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'strategy-summary-' + tag + '-'));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => tmpDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

function addStrategies(dir, bankId, status, n) {
  for (let i = 0; i < n; i++) {
    store.createStrategyRequest(dir, { id: bankId, displayName: 'Bank ' + bankId }, { requestType: 'Bond Swap', status, summary: 'req' });
  }
}

test('aggregates per bank: open = Open + In Progress, total = all active, byStatus breakdown', () => {
  const dir = freshDir('agg');
  addStrategies(dir, 'A', 'Open', 3);
  addStrategies(dir, 'A', 'In Progress', 2);
  addStrategies(dir, 'A', 'Completed', 1);
  addStrategies(dir, 'B', 'Open', 1);
  addStrategies(dir, 'B', 'Needs Billed', 4);
  const byBank = store.summarizeStrategyCountsByBank(dir);
  assert.strictEqual(byBank['A'].open, 5, 'A open = 3 Open + 2 In Progress');
  assert.strictEqual(byBank['A'].total, 6, 'A total = 6 active');
  assert.strictEqual(byBank['A'].byStatus['Open'], 3);
  assert.strictEqual(byBank['A'].byStatus['In Progress'], 2);
  assert.strictEqual(byBank['A'].byStatus['Completed'], 1);
  assert.strictEqual(byBank['B'].open, 1, 'Needs Billed is not "open"');
  assert.strictEqual(byBank['B'].total, 5);
});

test('summary is NOT capped at 500 rows (unlike listStrategyRequests)', () => {
  const dir = freshDir('cap');
  addStrategies(dir, 'BIG', 'Open', 600);
  const listed = store.listStrategyRequests(dir, { bankId: 'BIG' }).requests.length;
  assert.strictEqual(listed, 500, 'listStrategyRequests caps at 500 rows');
  const byBank = store.summarizeStrategyCountsByBank(dir);
  assert.strictEqual(byBank['BIG'].total, 600, 'summary counts all 600');
  assert.strictEqual(byBank['BIG'].open, 600);
});

test('archived requests are excluded from the summary', () => {
  const dir = freshDir('arch');
  store.createStrategyRequest(dir, { id: 'C', displayName: 'C' }, { requestType: 'Bond Swap', status: 'Open' });
  const archived = store.createStrategyRequest(dir, { id: 'C', displayName: 'C' }, { requestType: 'Bond Swap', status: 'Open' });
  // No public archive fn is exported; set archived_at directly for the test.
  sqliteDb.runSqlite(store.strategyDatabasePathForDir(dir),
    'UPDATE strategy_requests SET archived_at = ? WHERE id = ?;', [new Date().toISOString(), archived.id]);
  const byBank = store.summarizeStrategyCountsByBank(dir);
  assert.strictEqual(byBank['C'].total, 1, 'archived request excluded');
  assert.strictEqual(byBank['C'].open, 1);
});

test('empty store yields an empty summary', () => {
  const dir = freshDir('empty');
  assert.deepStrictEqual(store.summarizeStrategyCountsByBank(dir), {});
});

console.log(`strategy-summary tests: ${passed} passed.`);
