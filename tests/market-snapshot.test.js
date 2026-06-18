// Tests for server/market-snapshot.js — canonical (Economic Update) + live
// (wire) merge. Pure, no I/O.
'use strict';

const assert = require('assert');
const { buildMarketSnapshot, METRICS } = require('../server/market-snapshot');

const ECON = {
  asOfDate: '2026-06-12',
  extractedAt: '2026-06-12T19:30:00.000Z',
  treasuries: [
    { tenor: '2YR', label: '2Y', yield: 4.05 },
    { tenor: '5YR', label: '5Y', yield: 4.12 },
    { tenor: '10YR', label: '10Y', yield: 4.18 },
    { tenor: '30YR', label: '30Y', yield: 4.55 },
  ],
  marketRates: [
    { label: 'Prime Rate', value: 6.75, isPercent: true },
    { label: 'SOFR', value: 3.60, isPercent: true },
  ],
  marketData: [
    { label: 'S&P 500', value: null, priorClose: 7394.3 }, // pre-open → prior close
    { label: 'VIX', value: 17.2, priorClose: 17.9 },
  ],
};

const WIRE = {
  rates: { asOfDate: '2026-06-18', tenYear: 4.20, twoYear: 4.06, spread2s10sBp: 14 },
  fred: { sofr: { value: 3.61 }, fedFunds: { value: 4.33 }, prime: { value: 6.75 } },
};

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

test('canonical comes from the Economic Update, live carries the delta', () => {
  const snap = buildMarketSnapshot(ECON, WIRE);
  const ten = snap.metrics.ten_year;
  assert.strictEqual(ten.value, 4.18, 'canonical 10Y from econ PDF');
  assert.strictEqual(ten.source, 'Economic Update');
  assert.strictEqual(ten.asOf, '2026-06-12');
  assert.strictEqual(ten.live.value, 4.20, 'live 10Y from wire');
  assert.strictEqual(ten.live.deltaBp, 2, '+2bp delta (4.20 - 4.18)');
});

test('2s/10s is derived canonical (bp) with a bp delta', () => {
  const s = buildMarketSnapshot(ECON, WIRE).metrics.twos_tens;
  assert.strictEqual(s.value, 13, 'canonical 2s10s = (4.18-4.05)*100');
  assert.strictEqual(s.unit, 'bp');
  assert.strictEqual(s.live.value, 14);
  assert.strictEqual(s.live.deltaBp, 1, 'live 14 - canonical 13 = 1bp');
});

test('index value falls back to prior close when pre-open', () => {
  const spx = buildMarketSnapshot(ECON, WIRE).metrics.spx;
  assert.strictEqual(spx.value, 7394.3);
  assert.ok(!spx.live, 'no live source for SPX → no delta chip');
});

test('canonical-only metric (30Y) has no live block', () => {
  const m = buildMarketSnapshot(ECON, WIRE).metrics.thirty_year;
  assert.strictEqual(m.value, 4.55);
  assert.ok(!m.live);
});

test('a metric missing from the desk PDF falls back to live as headline', () => {
  const m = buildMarketSnapshot(ECON, WIRE).metrics.fed_funds; // not in ECON.marketRates
  assert.strictEqual(m.value, 4.33, 'live value becomes the headline');
  assert.strictEqual(m.source, 'Live');
  assert.ok(!m.live, 'no canonical → no separate delta block');
});

test('snapshot carries both as-of stamps', () => {
  const snap = buildMarketSnapshot(ECON, WIRE);
  assert.strictEqual(snap.asOf.desk, '2026-06-12');
  assert.strictEqual(snap.asOf.live, '2026-06-18');
});

test('never throws on null inputs; every metric present and empty', () => {
  const snap = buildMarketSnapshot(null, null);
  assert.strictEqual(Object.keys(snap.metrics).length, METRICS.length);
  assert.strictEqual(snap.metrics.ten_year.value, null);
  assert.strictEqual(snap.metrics.ten_year.source, null);
});

console.log(`market-snapshot tests: ${passed} passed.`);
