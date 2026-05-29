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

console.log(`bank-views tests: ${passed} passed.`);
