'use strict';

// Regression tests for server/bank-views.js — the canonical "Salesforce-style"
// saved views over the bank database. Covers the pure logic: the view-
// definition registry, definition lookup, and the CSV projection used by the
// view export. (The run*View functions are thin store reads + the rep filter,
// which is exercised in rep-identity.test.js.)

const assert = require('assert');
const v = require('../server/bank-views');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

const EXPECTED_IDS = ['clients', 'prospects', 'open', 'watchlist', 'needs-billed', 'stale-follow-ups', 'my-book', 'billing-pending'];

test('listViewDefinitions exposes every preset with its flags', () => {
  const defs = v.listViewDefinitions();
  const ids = defs.map(d => d.id);
  EXPECTED_IDS.forEach(id => assert.ok(ids.includes(id), `missing view ${id}`));
  const myBook = defs.find(d => d.id === 'my-book');
  assert.strictEqual(myBook.requiresRep, true, 'my-book requires a rep');
  const billing = defs.find(d => d.id === 'billing-pending');
  assert.strictEqual(billing.supportsRep, false, 'billing is not rep-scoped');
});

test('view definitions have unique ids and a known kind', () => {
  const kinds = new Set(['account-status', 'strategies', 'follow-ups', 'billing']);
  const seen = new Set();
  v.VIEW_DEFINITIONS.forEach(def => {
    assert.ok(!seen.has(def.id), `duplicate id ${def.id}`);
    seen.add(def.id);
    assert.ok(kinds.has(def.kind), `unknown kind ${def.kind} on ${def.id}`);
  });
});

test('getViewDefinition resolves known ids and returns null otherwise', () => {
  assert.strictEqual(v.getViewDefinition('clients').statusFilter, 'Client');
  assert.strictEqual(v.getViewDefinition('needs-billed').kind, 'strategies');
  assert.strictEqual(v.getViewDefinition('nope'), null);
  assert.strictEqual(v.getViewDefinition(''), null);
});

test('viewToCsvRows maps column keys to labels and projects rows in order', () => {
  const result = {
    columns: ['displayName', 'city', 'status', 'owner'],
    rows: [{ displayName: 'Alton Bank', city: 'Alton', status: 'Client', owner: 'Jim Lewis' }]
  };
  const csv = v.viewToCsvRows(result);
  assert.deepStrictEqual(csv[0], ['Bank', 'City', 'Status', 'Coverage Owner']);
  assert.deepStrictEqual(csv[1], ['Alton Bank', 'Alton', 'Client', 'Jim Lewis']);
});

test('viewToCsvRows fills missing/null cells with empty strings', () => {
  const csv = v.viewToCsvRows({ columns: ['displayName', 'owner'], rows: [{ displayName: 'X' }, { owner: null }] });
  assert.deepStrictEqual(csv[1], ['X', '']);
  assert.deepStrictEqual(csv[2], ['', '']);
});

test('viewToCsvRows falls back to the raw key when no label is mapped', () => {
  const csv = v.viewToCsvRows({ columns: ['mysteryField'], rows: [{ mysteryField: 'z' }] });
  assert.deepStrictEqual(csv[0], ['mysteryField']);
});

test('viewToCsvRows handles null result and the requires-rep gate', () => {
  assert.deepStrictEqual(v.viewToCsvRows(null), [['No data']]);
  assert.deepStrictEqual(
    v.viewToCsvRows({ meta: { requiresRep: true } }),
    [['Message'], ['Pick a rep before exporting this view.']]
  );
});

test('viewToCsvRows labels lastActivityDate as Last Activity', () => {
  const csv = v.viewToCsvRows({ columns: ['displayName', 'lastActivityDate'], rows: [{ displayName: 'X', lastActivityDate: '2026-06-01' }] });
  assert.deepStrictEqual(csv[0], ['Bank', 'Last Activity']);
  assert.deepStrictEqual(csv[1], ['X', '2026-06-01']);
});

// Integration: the follow-ups view surfaces banks with an OVERDUE OPEN TASK
// (the post-2026-06-12 successor to the cleared next_action_date column) and
// joins each row to its latest manual CRM touch (the "going cold" column).
test('runBankView surfaces banks with an overdue open task + joins lastActivityDate', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const coverageStore = require('../server/bank-coverage-store');
  const bankImporter = require('../server/bank-data-importer');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-views-'));
  try {
    bankImporter.writeBankDatabase({
      metadata: {
        importedAt: '2026-07-01T12:00:00.000Z',
        sourceFile: 'views-bank-fixture.xlsx',
        latestPeriod: '2026Q1',
        bankCount: 2,
        rowCount: 2,
        fields: bankImporter.BANK_FIELDS
      },
      banks: [
        {
          id: 'V-1',
          summary: { id: 'V-1', displayName: 'View Test Bank', city: 'Alton', state: 'IL', certNumber: '999', period: '2026Q1', totalAssets: 1, totalDeposits: 1 },
          periods: [{ period: '2026Q1', values: { displayName: 'View Test Bank', city: 'Alton', state: 'IL', certNumber: '999', period: '2026Q1' } }]
        },
        {
          id: 'V-2',
          summary: { id: 'V-2', displayName: 'No Task Bank', city: 'Alton', state: 'IL', certNumber: '888', period: '2026Q1', totalAssets: 1, totalDeposits: 1 },
          periods: [{ period: '2026Q1', values: { displayName: 'No Task Bank', city: 'Alton', state: 'IL', certNumber: '888', period: '2026Q1' } }]
        }
      ]
    }, tmpDir);
    const bank = { id: 'V-1', displayName: 'View Test Bank', city: 'Alton', state: 'IL', certNumber: '999' };
    coverageStore.upsertSavedBank(tmpDir, bank, { status: 'Client', owner: 'Jim Lewis' });
    coverageStore.createBankTask(tmpDir, { bankId: 'V-1', title: 'Follow up', dueDate: '2020-01-01' });
    coverageStore.recordManualActivity(tmpDir, { bankId: 'V-1', kind: 'call', subject: 'Touch', activityDate: '2026-06-01' });
    const result = v.runBankView({ outputDir: tmpDir, viewId: 'stale-follow-ups', rep: null });
    assert.ok(result.columns.includes('lastActivityDate'), 'follow-ups view exposes lastActivityDate');
    const row = result.rows.find(r => r.bankId === 'V-1');
    assert.ok(row, 'overdue-task row present');
    assert.strictEqual(row.displayName, 'View Test Bank', 'joined bank name from coverage');
    assert.strictEqual(row.nextActionDate, '2020-01-01', 'shows the earliest overdue due date');
    assert.strictEqual(row.lastActivityDate, '2026-06-01');
    // A bank with no overdue task must NOT appear.
    coverageStore.upsertSavedBank(tmpDir, { id: 'V-2', displayName: 'No Task Bank', certNumber: '888' }, { status: 'Client' });
    const result2 = v.runBankView({ outputDir: tmpDir, viewId: 'stale-follow-ups', rep: null });
    assert.ok(!result2.rows.find(r => r.bankId === 'V-2'), 'bank without an overdue task is excluded');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`bank-views tests: ${passed} passed.`);
