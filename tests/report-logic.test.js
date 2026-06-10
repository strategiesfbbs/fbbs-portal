'use strict';

// Unit tests for public/js/modules/report-logic.js — the pure engine behind
// the dynamic report builder (conditions, Group By, aggregations). UMD module,
// so plain require works.

const assert = require('assert');
const logic = require('../public/js/modules/report-logic');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ---------- conditionFieldKind / operatorsFor ----------

test('field kinds map display types to operator vocabularies', () => {
  assert.strictEqual(logic.conditionFieldKind('money'), 'numeric');
  assert.strictEqual(logic.conditionFieldKind('percent'), 'numeric');
  assert.strictEqual(logic.conditionFieldKind('number'), 'numeric');
  assert.strictEqual(logic.conditionFieldKind('boolean'), 'boolean');
  assert.strictEqual(logic.conditionFieldKind('text'), 'text');
  assert.strictEqual(logic.conditionFieldKind('period'), 'text');
  assert.ok(logic.operatorsFor('money').some(o => o.op === 'between'));
  assert.ok(logic.operatorsFor('text').some(o => o.op === 'oneOf'));
  assert.ok(logic.operatorsFor('boolean').every(o => ['isYes', 'isNo'].includes(o.op)));
});

// ---------- parseNumericInput ----------

test('parseNumericInput strips currency formatting and rejects garbage', () => {
  assert.strictEqual(logic.parseNumericInput('10,000'), 10000);
  assert.strictEqual(logic.parseNumericInput('$1,250,000'), 1250000);
  assert.strictEqual(logic.parseNumericInput('-0.15'), -0.15);
  assert.strictEqual(logic.parseNumericInput(''), null);
  assert.strictEqual(logic.parseNumericInput('abc'), null);
  assert.strictEqual(logic.parseNumericInput(null), null);
});

// ---------- evaluateCondition: numeric ----------

test('numeric comparisons: gt/gte/lt/lte/eq', () => {
  const t = (raw, op, value) => logic.evaluateCondition(raw, { op, value }, 'money');
  assert.strictEqual(t(15000, 'gt', '10,000'), true);   // securities > $10MM ($000s)
  assert.strictEqual(t(9000, 'gt', '10,000'), false);
  assert.strictEqual(t(10000, 'gte', '10000'), true);
  assert.strictEqual(t(5, 'lt', '60'), true);
  assert.strictEqual(t(60, 'lte', '60'), true);
  assert.strictEqual(t(60, 'eq', '60'), true);
  assert.strictEqual(t(61, 'eq', '60'), false);
});

test('numeric between is inclusive and order-insensitive', () => {
  const cond = { op: 'between', value: '100', value2: '50' };
  assert.strictEqual(logic.evaluateCondition(75, cond, 'number'), true);
  assert.strictEqual(logic.evaluateCondition(50, cond, 'number'), true);
  assert.strictEqual(logic.evaluateCondition(100, cond, 'number'), true);
  assert.strictEqual(logic.evaluateCondition(101, cond, 'number'), false);
  // Missing upper bound degrades to >= lower
  assert.strictEqual(logic.evaluateCondition(500, { op: 'between', value: '100' }, 'number'), true);
});

test('numeric: untyped value passes every row; non-numeric cell fails a typed bound', () => {
  assert.strictEqual(logic.evaluateCondition(5, { op: 'gt', value: '' }, 'number'), true);
  assert.strictEqual(logic.evaluateCondition(null, { op: 'gt', value: '10' }, 'number'), false);
  assert.strictEqual(logic.evaluateCondition('n/a', { op: 'lt', value: '10' }, 'number'), false);
});

test('negative thresholds work (peer-gap screens)', () => {
  assert.strictEqual(logic.evaluateCondition(-0.4, { op: 'lt', value: '-0.15' }, 'percent'), true);
  assert.strictEqual(logic.evaluateCondition(-0.1, { op: 'lt', value: '-0.15' }, 'percent'), false);
});

// ---------- evaluateCondition: text ----------

test('text is/contains/startsWith are case-insensitive', () => {
  assert.strictEqual(logic.evaluateCondition('TX', { op: 'is', value: 'tx' }, 'text'), true);
  assert.strictEqual(logic.evaluateCondition('First National', { op: 'contains', value: 'nation' }, 'text'), true);
  assert.strictEqual(logic.evaluateCondition('First National', { op: 'startsWith', value: 'first' }, 'text'), true);
  assert.strictEqual(logic.evaluateCondition('First National', { op: 'startsWith', value: 'national' }, 'text'), false);
});

test('text oneOf splits on commas/whitespace and matches exactly', () => {
  const cond = { op: 'oneOf', value: 'TX, OK MO' };
  assert.strictEqual(logic.evaluateCondition('OK', cond, 'text'), true);
  assert.strictEqual(logic.evaluateCondition('KS', cond, 'text'), false);
  // exact-token match: "T" must not match "TX"
  assert.strictEqual(logic.evaluateCondition('T', cond, 'text'), false);
});

test('blank operator matches empty/null on any kind', () => {
  assert.strictEqual(logic.evaluateCondition('', { op: 'blank' }, 'text'), true);
  assert.strictEqual(logic.evaluateCondition(null, { op: 'blank' }, 'money'), true);
  assert.strictEqual(logic.evaluateCondition('x', { op: 'blank' }, 'text'), false);
  assert.strictEqual(logic.evaluateCondition(0, { op: 'blank' }, 'money'), false);
});

test('boolean isYes/isNo accept true and "Yes"', () => {
  assert.strictEqual(logic.evaluateCondition(true, { op: 'isYes' }, 'boolean'), true);
  assert.strictEqual(logic.evaluateCondition('Yes', { op: 'isYes' }, 'boolean'), true);
  assert.strictEqual(logic.evaluateCondition('No', { op: 'isYes' }, 'boolean'), false);
  assert.strictEqual(logic.evaluateCondition('No', { op: 'isNo' }, 'boolean'), true);
});

// ---------- aggregateValues ----------

test('aggregates compute over numeric values only', () => {
  assert.strictEqual(logic.aggregateValues([1, 2, 3, 'x', null], 'sum'), 6);
  assert.strictEqual(logic.aggregateValues([2, 4], 'avg'), 3);
  assert.strictEqual(logic.aggregateValues([5, -2, 9], 'min'), -2);
  assert.strictEqual(logic.aggregateValues([5, -2, 9], 'max'), 9);
  assert.strictEqual(logic.aggregateValues(['x', null], 'sum'), null);
  assert.strictEqual(logic.aggregateValues([1], 'median'), null); // unknown fn
});

// ---------- groupRows ----------

const BANKS = [
  { state: 'TX', status: 'Client', assets: 100 },
  { state: 'TX', status: 'Prospect', assets: 50 },
  { state: 'TX', status: 'Client', assets: 200 },
  { state: 'MO', status: 'Client', assets: 75 },
  { state: '', status: 'Open', assets: 10 }
];

test('groupRows buckets, counts, sorts biggest-first, and labels blanks', () => {
  const groups = logic.groupRows(BANKS, { field: 'state' });
  assert.deepStrictEqual(groups.map(g => g.key), ['TX', '(blank)', 'MO']);
  assert.strictEqual(groups[0].count, 3);
  assert.strictEqual(groups[0].rows.length, 3);
});

test('groupRows computes per-group aggregates', () => {
  const groups = logic.groupRows(BANKS, { field: 'state', aggs: { assets: 'sum' } });
  const tx = groups.find(g => g.key === 'TX');
  assert.strictEqual(tx.aggregates.assets, 350);
  const mo = groups.find(g => g.key === 'MO');
  assert.strictEqual(mo.aggregates.assets, 75);
});

test('groupRows thenBy nests subgroups with the same aggregates', () => {
  const groups = logic.groupRows(BANKS, { field: 'state', thenBy: 'status', aggs: { assets: 'sum' } });
  const tx = groups.find(g => g.key === 'TX');
  assert.ok(Array.isArray(tx.subgroups));
  const txClients = tx.subgroups.find(g => g.key === 'Client');
  assert.strictEqual(txClients.count, 2);
  assert.strictEqual(txClients.aggregates.assets, 300);
  // No third level
  assert.strictEqual(txClients.subgroups, null);
});

test('groupRows uses the getValue accessor for synthetic fields', () => {
  const groups = logic.groupRows(BANKS, {
    field: 'tier',
    getValue: (row, key) => key === 'tier' ? (row.assets >= 100 ? 'Large' : 'Small') : row[key]
  });
  assert.deepStrictEqual(groups.map(g => `${g.key}:${g.count}`).sort(), ['Large:2', 'Small:3']);
});

console.log(`report-logic tests: ${passed} passed.`);
