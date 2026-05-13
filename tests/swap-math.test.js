'use strict';

/**
 * Regression tests for server/swap-math.js.
 *
 * Run via `node tests/swap-math.test.js` (or `npm test` after the test
 * runner is updated to include this file). No test framework — plain
 * `assert` so a developer without dev deps can sanity-check the math.
 */

const assert = require('assert');
const m = require('../server/swap-math');

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

function near(actual, expected, tol = 0.01, label = '') {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label || 'value'} expected ${expected} ± ${tol}, got ${actual}`);
  }
}

// ---------- Date helpers ----------

test('toDate parses YYYY-MM-DD and MM/DD/YYYY', () => {
  assert.strictEqual(m.ymd(m.toDate('2026-05-13')), '2026-05-13');
  assert.strictEqual(m.ymd(m.toDate('05/13/2026')), '2026-05-13');
  assert.strictEqual(m.toDate('not a date'), null);
  assert.strictEqual(m.toDate(null), null);
});

test('monthsBetween rounds approximately', () => {
  near(m.monthsBetween('2026-01-01', '2027-01-01'), 12, 0.05);
  near(m.monthsBetween('2026-05-13', '2026-11-13'), 6, 0.05);
});

test('defaultSettleDate is T+1 business day from a weekday', () => {
  // Wed 2026-05-13 → Thu 2026-05-14
  assert.strictEqual(m.ymd(m.defaultSettleDate('2026-05-13', 'treasury')), '2026-05-14');
  // Fri 2026-05-15 → Mon 2026-05-18 (skips weekend)
  assert.strictEqual(m.ymd(m.defaultSettleDate('2026-05-15', 'agency')), '2026-05-18');
  // Munis are T+2 → Wed → Fri
  assert.strictEqual(m.ymd(m.defaultSettleDate('2026-05-13', 'muni')), '2026-05-15');
});

// ---------- Day count ----------

test('days30_360 standard cases', () => {
  // Half a year exactly
  assert.strictEqual(m.days30_360('2026-01-01', '2026-07-01'), 180);
  // Full year
  assert.strictEqual(m.days30_360('2026-01-01', '2027-01-01'), 360);
  // Month-end adjustments
  assert.strictEqual(m.days30_360('2026-01-31', '2026-02-28'), 28);
  assert.strictEqual(m.days30_360('2026-01-31', '2026-03-31'), 60); // both ends snap to 30
});

test('daysActual counts wall-clock days', () => {
  assert.strictEqual(m.daysActual('2026-01-01', '2026-01-31'), 30);
  assert.strictEqual(m.daysActual('2026-01-01', '2027-01-01'), 365);
});

test('defaultDayCountForSector maps as expected', () => {
  assert.strictEqual(m.defaultDayCountForSector('Treasury Bond'), 'actual/actual');
  assert.strictEqual(m.defaultDayCountForSector('Agency Callable'), 'actual/actual');
  assert.strictEqual(m.defaultDayCountForSector('Muni BQ'), '30/360');
  assert.strictEqual(m.defaultDayCountForSector('Corporate IG'), '30/360');
  assert.strictEqual(m.defaultDayCountForSector('CD'), '30/360');
  assert.strictEqual(m.defaultDayCountForSector('MBS'), '30/360');
});

// ---------- Accrued interest ----------

test('accruedInterest 30/360 muni half-coupon', () => {
  // $1MM par, 4% coupon, semi-annual, 90 days into period → 4% * 90/360 * 1MM = $10,000
  const a = m.accruedInterest({
    par: 1_000_000,
    coupon: 4,
    lastCouponDate: '2026-02-01',
    settleDate: '2026-05-01',
    dayCount: '30/360',
    frequency: 2
  });
  near(a, 10_000, 1, 'muni accrued');
});

test('accruedInterest actual/actual treasury', () => {
  // $1MM, 5% coupon, 60 actual days → 5% * 60/365 * 1MM ≈ $8,219.18
  const a = m.accruedInterest({
    par: 1_000_000,
    coupon: 5,
    lastCouponDate: '2026-03-01',
    settleDate: '2026-04-30',
    dayCount: 'actual/actual',
    frequency: 2
  });
  near(a, 1_000_000 * 0.05 * 60 / 365, 1, 'treasury accrued');
});

test('accruedInterest infers last coupon from maturity if missing', () => {
  // Maturity 2030-06-15, semi-annual → coupon dates 6/15 and 12/15 each year.
  // Settle 2026-05-13 → last coupon should be 2025-12-15.
  const settle = '2026-05-13';
  const lastInferred = m.ymd(m.inferLastCouponDate('2030-06-15', settle, 2));
  assert.strictEqual(lastInferred, '2025-12-15');
  const accrued = m.accruedInterest({
    par: 500_000,
    coupon: 3,
    maturity: '2030-06-15',
    settleDate: settle,
    dayCount: '30/360',
    frequency: 2
  });
  // 30/360 days 12/15/25 → 5/13/26 = (-15) + 4*30 + 13 + (12/2025 - 12/2024 still same calc)
  // = 360*1 - 30*7 - 17 ... easier: just sanity-check it's plausibly between
  // (4mo accrued at 3% on 500K) ≈ 5000 and (6mo) ≈ 7500.
  assert.ok(accrued > 4500 && accrued < 8000, `accrued ${accrued} not in plausible muni window`);
});

test('accruedInterest returns 0 for zero/missing par or coupon', () => {
  assert.strictEqual(m.accruedInterest({ par: 0, coupon: 4, settleDate: '2026-05-13' }), 0);
  assert.strictEqual(m.accruedInterest({ par: 1000, coupon: 0, settleDate: '2026-05-13' }), 0);
});

// ---------- TE yield ----------

test('teYield C-corp and Sub-S', () => {
  // 4.00% YTM at 21% → 5.063%
  near(m.teYield(4, 21), 4 / 0.79, 0.001, 'C-corp TE');
  // 3.80% YTW at 29.6% → 5.398%
  near(m.teYield(3.80, 29.6), 3.80 / (1 - 0.296), 0.001, 'Sub-S TE');
  // 0% input → 0% TE
  near(m.teYield(0, 21), 0, 0.0001);
  // Null input → null
  assert.strictEqual(m.teYield(null, 21), null);
});

test('defaultTaxRate routes C vs S', () => {
  assert.strictEqual(m.defaultTaxRate({ isSubchapterS: false }), 21);
  assert.strictEqual(m.defaultTaxRate({ isSubchapterS: true }), 29.6);
});

// ---------- Per-leg ----------

test('legBookValue / legMarketValue derive from par × price', () => {
  near(m.legBookValue({ par: 1_000_000, bookPrice: 99.5 }), 995_000, 1);
  near(m.legMarketValue({ par: 1_000_000, marketPrice: 98.25 }), 982_500, 1);
  // Explicit bookValue overrides if provided
  assert.strictEqual(m.legBookValue({ par: 1_000_000, bookPrice: 100, bookValue: 1_001_234 }), 1_001_234);
});

test('legGainLoss subtracts book from market', () => {
  assert.strictEqual(m.legGainLoss({ bookValue: 1_000_000, marketValue: 985_000 }), -15_000);
  assert.strictEqual(m.legGainLoss({ bookValue: 100, marketValue: 110 }), 10);
});

test('legProceeds adds accrued onto market value', () => {
  assert.strictEqual(m.legProceeds({ marketValue: 982_500, accrued: 5_000 }), 987_500);
  assert.strictEqual(m.legProceeds({ marketValue: 982_500 }), 982_500);
});

// ---------- Breakeven ----------

test('swapBreakevenMonths basic case', () => {
  // 15K loss, 20K annual pickup → 15 / (20/12) = 9 months
  near(m.swapBreakevenMonths(-15_000, 20_000), 9, 0.01);
});

test('swapBreakevenMonths returns null when pickup not positive', () => {
  assert.strictEqual(m.swapBreakevenMonths(-15_000, 0), null);
  assert.strictEqual(m.swapBreakevenMonths(-15_000, -5_000), null);
});

test('swapBreakevenMonths returns 0 for already-gain swaps', () => {
  assert.strictEqual(m.swapBreakevenMonths(5_000, 10_000), 0);
});

// ---------- Per-leg swap economics ----------

test('swapEconomicsForLeg mirrors expected pickup', () => {
  // Sell: $1MM par, book yield 2.0%, book price 100 (book value 1MM), market price 98 (mv 980K)
  // Buy yield 5.0%, average life 3 yr
  // Annual income given up = 1MM * 2% = 20K
  // Annual buy income (on proceeds 980K) = 980K * 5% = 49K
  // Annual pickup = 29K
  const e = m.swapEconomicsForLeg({
    held: {
      par: 1_000_000,
      bookPrice: 100, marketPrice: 98,
      bookYieldYtm: 2.0, marketYieldYtw: 5.1,
      averageLife: 3
    },
    offering: { maturity: '2030-05-15' },
    pickYield: 5.0,
    asOfDate: '2026-05-13'
  });
  near(e.annualIncomePickup, 29_000, 100, 'annual pickup');
  near(e.realizedGainLoss, -20_000, 100, 'realized G/L');
  assert.strictEqual(e.horizonYears, 3);
  // Breakeven: 20K loss / (29K/12) ≈ 8.28 mo
  near(e.breakevenMonths, 20_000 / (29_000 / 12), 0.1);
});

// ---------- FBBS rule check ----------
//
// Hard rule: matures-before-breakeven. Everything else is a soft warning.

test('evaluateSwapAgainstRules: classic in-bounds case', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 7.3,
    monthsToMaturity: 48,
    annualIncomePickup: 45_000
  });
  assert.strictEqual(r.hardPass, true);
  assert.strictEqual(r.hardReason, null);
  assert.strictEqual(r.warnings.length, 0);
});

test('evaluateSwapAgainstRules: breakeven over soft cap is a warning, not a drop', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 18,
    monthsToMaturity: 60,
    annualIncomePickup: 10_000
  });
  assert.strictEqual(r.hardPass, true);
  assert.ok(r.warnings.some(w => w.code === 'breakeven-over-soft-cap'), r.warnings);
});

test('evaluateSwapAgainstRules: held matures before breakeven is a HARD drop', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 10,
    monthsToMaturity: 6,
    annualIncomePickup: 5_000
  });
  assert.strictEqual(r.hardPass, false);
  assert.ok(/before breakeven/.test(r.hardReason || ''), r.hardReason);
});

test('evaluateSwapAgainstRules: maturity below soft floor is a warning, not a drop', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 3,
    monthsToMaturity: 8,
    annualIncomePickup: 5_000
  });
  assert.strictEqual(r.hardPass, true);
  assert.ok(r.warnings.some(w => w.code === 'maturity-under-soft-floor'), r.warnings);
});

test('evaluateSwapAgainstRules: no pickup is a warning, not a drop', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 5,
    monthsToMaturity: 36,
    annualIncomePickup: -100
  });
  assert.strictEqual(r.hardPass, true);
  assert.ok(r.warnings.some(w => w.code === 'no-annual-pickup'), r.warnings);
});

test('evaluateSwapAgainstRules: configurable soft thresholds', () => {
  const r = m.evaluateSwapAgainstRules({
    breakevenMonths: 18,
    monthsToMaturity: 60,
    annualIncomePickup: 5_000,
    rules: { breakevenSoftCapMonths: 24, maturitySoftFloorMonths: 6 }
  });
  assert.strictEqual(r.hardPass, true);
  assert.strictEqual(r.warnings.length, 0, 'expected no warnings at relaxed thresholds');
});

test('passesFbbsSwapRules (legacy): hard fail propagates', () => {
  const r = m.passesFbbsSwapRules({
    breakevenMonths: 10,
    monthsToMaturity: 4,
    annualIncomePickup: 5_000
  });
  assert.strictEqual(r.passes, false);
  assert.ok(r.reasons.some(s => /before breakeven/.test(s)));
});

test('passesFbbsSwapRules (legacy): strict pass needs hard + no warnings', () => {
  const r = m.passesFbbsSwapRules({
    breakevenMonths: 5,
    monthsToMaturity: 24,
    annualIncomePickup: 5_000
  });
  assert.strictEqual(r.passes, true);
  assert.deepStrictEqual(r.reasons, []);
});

// ---------- Aggregates / summary ----------

test('aggregateLegs par-weights average life', () => {
  const agg = m.aggregateLegs([
    { par: 1_000_000, averageLife: 2 },
    { par: 3_000_000, averageLife: 6 }
  ], 21);
  near(agg.averageLife, (2 * 1 + 6 * 3) / 4, 0.01);
});

test('aggregateLegs value-weights book yield', () => {
  // Two legs, equal market value at 4% and 6% → 5% weighted
  const agg = m.aggregateLegs([
    { par: 1_000_000, bookPrice: 100, marketPrice: 100, bookYieldYtm: 4, marketYieldYtw: 4 },
    { par: 1_000_000, bookPrice: 100, marketPrice: 100, bookYieldYtm: 6, marketYieldYtw: 6 }
  ], 21);
  near(agg.bookYield, 5, 0.01);
  near(agg.marketYield, 5, 0.01);
});

test('swapSummary roundtrips a simple 1×1 swap', () => {
  const sells = [{
    par: 1_000_000, bookPrice: 100, marketPrice: 98,
    bookYieldYtm: 2.0, marketYieldYtw: 5.0,
    averageLife: 3
  }];
  const buys = [{
    par: 1_000_000, bookPrice: 98, marketPrice: 98,
    bookYieldYtm: 5.0, marketYieldYtw: 5.0,
    averageLife: 3
  }];
  const s = m.swapSummary({ sells, buys, horizonYears: 3, taxRate: 21 });
  assert.strictEqual(s.sells.par, 1_000_000);
  assert.strictEqual(s.buys.par, 1_000_000);
  assert.ok(s.dollars.netInterest > 0, 'should have positive net interest from yield pickup');
  assert.ok(s.dollars.realizedGainLoss < 0, 'sell at 98 against book 100 is a loss');
  // settle adjust: sell proceeds vs buy proceeds — should be near 0 (same MV)
  assert.ok(Math.abs(s.settleAdjust) < 100, `settleAdjust ${s.settleAdjust} should be near 0`);
});

// ---------- Done ----------

console.log(`swap-math tests: ${passed} passed.`);
