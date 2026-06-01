'use strict';

const assert = require('assert');
const muniTax = require('../public/js/modules/muni-tax');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label || 'value'} expected ${expected}, got ${actual}`);
}

const ccorp = {
  rate: 21,
  capitalGainsRate: 21,
  costOfFunds: 2,
  bqDisallowance: 20,
  generalDisallowance: 100,
  applyTefra: true
};

const scorp = {
  rate: 29.6,
  capitalGainsRate: 29.6,
  costOfFunds: 2,
  bqDisallowance: 0,
  generalDisallowance: 100,
  applyTefra: true
};

test('TEFRA haircut uses COF x disallowance x tax rate in basis points', () => {
  near(muniTax.tefraHaircutBps({ section: 'BQ' }, ccorp), 8.4, 0.000001, 'BQ C-corp haircut');
  near(muniTax.tefraHaircutBps({ section: 'Municipals' }, ccorp), 42.0, 0.000001, 'general-market C-corp haircut');
  near(muniTax.tefraHaircutBps({ section: 'BQ' }, scorp), 0, 0.000001, 'S-corp BQ setting stays unchanged');
});

test('TEY subtracts the TEFRA yield haircut before gross-up', () => {
  const row = { section: 'BQ', ytw: 3.25 };
  near(muniTax.taxAdjustedYield(row, ccorp).value, (3.25 - 0.084) / 0.79, 0.000001, 'BQ TEY');
});

test('taxable munis do not get TEFRA or TEY treatment', () => {
  const row = { section: 'Taxable', ytw: 5, price: 99, maturity: '2027-06-01' };
  assert.strictEqual(muniTax.disallowancePct(row, ccorp), 0);
  assert.strictEqual(muniTax.tefraHaircutBps(row, ccorp), 0);
  assert.strictEqual(muniTax.taxAdjustedYield(row, ccorp), null);
  assert.strictEqual(muniTax.deMinimis(row, { asOfDate: '2026-06-01' }), null);
});

test('missing settle dates use package as-of date for stable de minimis math', () => {
  const row = { section: 'Municipals', price: 98.5, maturity: '2043-05-01', settle: null };
  const deMin = muniTax.deMinimis(row, { asOfDate: '2026-06-01' });
  assert.strictEqual(deMin.fullYears, 16);
  near(deMin.threshold, 96.0, 0.000001, 'threshold');
  near(deMin.cushion, 2.5, 0.000001, 'cushion');
  assert.strictEqual(deMin.isDeMinimis, false);
});

test('discounted sub-one-year munis still show a zero-year de minimis threshold', () => {
  const row = { section: 'Municipals', price: 99.99, maturity: '2026-10-01', settle: null };
  const deMin = muniTax.deMinimis(row, { asOfDate: '2026-06-01' });
  assert.strictEqual(deMin.fullYears, 0);
  near(deMin.threshold, 100, 0.000001, 'zero-year threshold');
  assert.strictEqual(deMin.isDiscount, true);
  assert.strictEqual(deMin.isDeMinimis, true);
});

test('discount after-tax yield is deterministic with as-of fallback', () => {
  const row = { section: 'Municipals', coupon: 4, price: 96.267, maturity: '2044-06-01', settle: null };
  const a = muniTax.taxAdjustedYield(row, ccorp, { asOfDate: '2026-06-01' });
  const b = muniTax.taxAdjustedYield(row, ccorp, { asOfDate: '2026-06-01' });
  assert.strictEqual(a.label, 'TEY');
  assert.strictEqual(a.secondaryLabel, 'ATY');
  near(a.value, b.value, 0, 'deterministic TEY');
  near(a.secondaryValue, b.secondaryValue, 0, 'deterministic ATY');
});

console.log(`muni-tax tests: ${passed} passed.`);
