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

test('inferLastCouponDate keeps month-end coupons month-end (no setUTCMonth drift)', () => {
  // Maturity 2030-08-31 (month-end), semi-annual → coupon dates 2/28-29 & 8/31.
  // Settle 2026-05-13 → last coupon must be 2026-02-28, NOT a March overflow.
  assert.strictEqual(m.ymd(m.inferLastCouponDate('2030-08-31', '2026-05-13', 2)), '2026-02-28');
  // 2030-03-31 maturity, settle 2026-05-13 → last coupon 2026-03-31 (not 04-01).
  assert.strictEqual(m.ymd(m.inferLastCouponDate('2030-03-31', '2026-05-13', 2)), '2026-03-31');
  // Accrued off the 2/28 last-coupon (30/360) is ~$8,333 on $1MM 4% — the old
  // overflow walk produced ~$7,778 (a ~$555 error per $1MM).
  const accrued = m.accruedInterest({
    par: 1_000_000, coupon: 4, maturity: '2030-08-31',
    settleDate: '2026-05-13', dayCount: '30/360', frequency: 2,
  });
  near(accrued, 8333, 40, 'month-end accrued');
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

// ---------- Yield / duration from price (CC #2) ----------
//
// Standard semi-annual bond identities.

test('yieldFromPriceAndMaturity: par bond returns coupon', () => {
  const y = m.yieldFromPriceAndMaturity({
    price: 100, coupon: 5,
    settleDate: '2026-01-01', maturity: '2031-01-01'
  });
  // 5% coupon at par = 5% YTM
  near(y, 5, 0.05, 'par YTM');
});

test('yieldFromPriceAndMaturity: discount bond yields above coupon', () => {
  const y = m.yieldFromPriceAndMaturity({
    price: 95, coupon: 5,
    settleDate: '2026-01-01', maturity: '2031-01-01'
  });
  // 5 yr 5% coupon at 95 ≈ 6.16% YTM (Bloomberg-canonical fixture)
  near(y, 6.16, 0.15, 'discount YTM');
});

test('yieldFromPriceAndMaturity: deep-discount muni mirrors observed market', () => {
  // Tell City IN WTR REV from SP-2026-0011: 2% coupon, price 76.32, mat 2039-01-01
  // Settle 2026-05-14. Resulting YTM should be in the low-4s range.
  const y = m.yieldFromPriceAndMaturity({
    price: 76.31549835, coupon: 2,
    settleDate: '2026-05-14', maturity: '2039-01-01'
  });
  assert.ok(y > 3.8 && y < 4.6, `expected YTM in 3.8-4.6% range, got ${y}`);
});

test('yieldFromPriceAndMaturity: returns null on bad inputs', () => {
  assert.strictEqual(m.yieldFromPriceAndMaturity({ price: 0, coupon: 5, settleDate: '2026-01-01', maturity: '2031-01-01' }), null);
  assert.strictEqual(m.yieldFromPriceAndMaturity({ price: 100, coupon: 5, settleDate: '2026-01-01', maturity: '2025-01-01' }), null);
  assert.strictEqual(m.yieldFromPriceAndMaturity({ price: 100, coupon: null, settleDate: '2026-01-01', maturity: '2031-01-01' }), null);
});

test('modifiedDurationFromYield: par 5yr 5% bond ≈ 4.4 yrs', () => {
  const d = m.modifiedDurationFromYield({
    yieldPct: 5, coupon: 5,
    settleDate: '2026-01-01', maturity: '2031-01-01'
  });
  // Canonical: 5yr 5% par bond Macaulay ≈ 4.5 yrs, Modified ≈ 4.39
  near(d, 4.39, 0.1, 'mod duration');
});

test('modifiedDurationFromYield: longer bonds have higher duration', () => {
  const shortDur = m.modifiedDurationFromYield({
    yieldPct: 5, coupon: 5, settleDate: '2026-01-01', maturity: '2028-01-01'
  });
  const longDur = m.modifiedDurationFromYield({
    yieldPct: 5, coupon: 5, settleDate: '2026-01-01', maturity: '2036-01-01'
  });
  assert.ok(longDur > shortDur, `longer bond should have higher duration: ${longDur} vs ${shortDur}`);
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

test('aggregateLegs only gross-ups tax-exempt TE yields', () => {
  const taxable = m.aggregateLegs([
    { par: 1_000_000, marketPrice: 100, marketYieldYtw: 5, sourceKind: 'manual' }
  ], 21);
  near(taxable.marketYield, 5, 0.001);
  near(taxable.teMarketYield, 5, 0.001, 'manual hypothetical buy keeps typed yield');

  const exempt = m.aggregateLegs([
    { par: 1_000_000, marketPrice: 100, marketYieldYtw: 5, sector: 'Exempt Muni' }
  ], 21);
  near(exempt.teMarketYield, m.teYield(5, 21), 0.001, 'exempt muni gets TE gross-up');
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

// ---------- Input validation: validateLegInput ----------

test('validateLegInput passes an empty stub leg (add-then-fill workflow)', () => {
  assert.deepStrictEqual(m.validateLegInput({}), []);
  assert.deepStrictEqual(m.validateLegInput({ side: 'buy', cusip: '' }), []);
});

test('validateLegInput passes a clean leg', () => {
  const ok = m.validateLegInput({
    par: 1_000_000, coupon: 4.5, bookPrice: 99.5, marketPrice: 98.25,
    bookYieldYtm: 4.6, marketYieldYtw: 5.1, modifiedDuration: 3.2,
    averageLife: 3.4, accrued: 1234.56
  });
  assert.deepStrictEqual(ok, []);
});

test('validateLegInput rejects negative and zero par', () => {
  assert.ok(m.validateLegInput({ par: -500 }).some(p => /Par/.test(p)));
  assert.ok(m.validateLegInput({ par: 0 }).some(p => /Par must be greater than 0/.test(p)));
});

test('validateLegInput rejects an out-of-range coupon', () => {
  assert.ok(m.validateLegInput({ coupon: 150 }).some(p => /Coupon.*exceed 30/.test(p)));
  assert.ok(m.validateLegInput({ coupon: -1 }).some(p => /Coupon.*less than 0/.test(p)));
});

test('validateLegInput rejects a non-numeric value', () => {
  assert.ok(m.validateLegInput({ coupon: 'abc' }).some(p => /Coupon.*must be a number/.test(p)));
});

test('validateLegInput rejects a zero/negative price and negative accrued', () => {
  assert.ok(m.validateLegInput({ marketPrice: 0 }).some(p => /Market price must be greater than 0/.test(p)));
  assert.ok(m.validateLegInput({ accrued: -10 }).some(p => /Accrued/.test(p)));
});

test('validateLegInput treats blank strings as absent', () => {
  assert.deepStrictEqual(m.validateLegInput({ par: '', coupon: '', marketPrice: '' }), []);
});

// ---------- Input validation: validateLegsForSend ----------

test('validateLegsForSend passes a complete 1×1 swap', () => {
  const sells = [{ cusip: '111', par: 1_000_000, maturity: '2030-01-01', bookPrice: 100, marketPrice: 98, bookYieldYtm: 2, marketYieldYtw: 5 }];
  const buys = [{ cusip: '222', par: 1_000_000, maturity: '2031-01-01', marketPrice: 98, marketYieldYtw: 5 }];
  assert.deepStrictEqual(m.validateLegsForSend(sells, buys), []);
});

test('validateLegsForSend flags a sell leg missing par and maturity', () => {
  const sells = [{ cusip: 'ABC', bookPrice: 100, marketPrice: 98, bookYieldYtm: 2 }];
  const buys = [{ cusip: '222', par: 1_000_000, maturity: '2031-01-01', marketPrice: 98, marketYieldYtw: 5 }];
  const issues = m.validateLegsForSend(sells, buys);
  assert.strictEqual(issues.length, 1);
  assert.ok(/Sell leg 1 \(ABC\)/.test(issues[0]), issues[0]);
  assert.ok(/par amount/.test(issues[0]) && /maturity date/.test(issues[0]), issues[0]);
});

test('validateLegsForSend flags a buy leg missing market yield and price', () => {
  const sells = [{ cusip: '111', par: 1_000_000, maturity: '2030-01-01', bookPrice: 100, marketPrice: 98, bookYieldYtm: 2 }];
  const buys = [{ cusip: '222', par: 1_000_000, maturity: '2031-01-01' }];
  const issues = m.validateLegsForSend(sells, buys);
  assert.strictEqual(issues.length, 1);
  assert.ok(/Buy leg 1 \(222\)/.test(issues[0]), issues[0]);
  assert.ok(/market price/.test(issues[0]) && /market yield/.test(issues[0]), issues[0]);
});

test('validateLegsForSend passes once a price-only leg is enriched (derived yield)', () => {
  // A buy leg with price + coupon + maturity but no explicit yield: raw it
  // would be flagged, but after enrichment the yield is derived, so the
  // freeze-time check (which runs on enriched legs) must pass.
  const sells = [{ cusip: '111', par: 1_000_000, maturity: '2030-01-01', bookPrice: 100, marketPrice: 98, bookYieldYtm: 2 }];
  const rawBuy = { cusip: '222', par: 1_000_000, maturity: '2031-01-01', coupon: 5, marketPrice: 98 };
  assert.ok(m.validateLegsForSend(sells, [rawBuy]).length === 1, 'raw price-only buy should be flagged');
  const enrichedBuy = m.enrichLegWithComputedFields(rawBuy, '2026-05-29');
  assert.deepStrictEqual(m.validateLegsForSend(sells, [enrichedBuy]), []);
});

// ---------- Buy sizing: solveBuyParForProceeds ----------

test('solveBuyParForProceeds sizes a single buy leg cash-neutral', () => {
  // Sell $1MM @ 98 → proceeds 980,000. Buy @ 100 → par must be 980,000.
  const r = m.solveBuyParForProceeds({
    sells: [{ par: 1_000_000, marketPrice: 98 }],
    buys: [{ marketPrice: 100 }]
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.suggestedPar, 980_000);
  assert.strictEqual(r.proceeds.sell, 980_000);
  assert.strictEqual(r.proceeds.netCash, 0);
});

test('solveBuyParForProceeds handles a premium buy price (rounding residual reported)', () => {
  // Sell proceeds 1,000,000; buy @ 101 → raw 990,099.01, rounds to 990,000,
  // leaving ~$100 of net cash.
  const r = m.solveBuyParForProceeds({
    sells: [{ par: 1_000_000, marketPrice: 100 }],
    buys: [{ marketPrice: 101 }]
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.suggestedPar, 990_000);
  near(r.rawPar, 990_099.01, 0.5);
  assert.strictEqual(r.proceeds.netCash, 100);
});

test('solveBuyParForProceeds hits a non-zero target net cash', () => {
  // Want to leave $50,000 with the bank.
  const r = m.solveBuyParForProceeds({
    sells: [{ par: 1_000_000, marketPrice: 100 }],
    buys: [{ marketPrice: 100 }],
    targetNetCash: 50_000
  });
  assert.strictEqual(r.suggestedPar, 950_000);
  assert.strictEqual(r.proceeds.netCash, 50_000);
  assert.strictEqual(r.proceeds.targetNetCash, 50_000);
});

test('solveBuyParForProceeds folds accrued into the coefficient', () => {
  // A coupon-bearing buy leg: proceeds = market value + accrued, so the
  // coefficient exceeds price/100 and the sized par drops below the
  // price-only answer. Net cash lands within one rounding increment.
  const r = m.solveBuyParForProceeds({
    sells: [{ par: 1_000_000, marketPrice: 100 }],
    buys: [{ marketPrice: 100, coupon: 5, maturity: '2031-01-01', sector: 'Corporate' }],
    settleDate: '2026-05-29'
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.coefficient > 1.0, `coefficient ${r.coefficient} should exceed 1.0 with accrued`);
  assert.ok(r.suggestedPar < 1_000_000, `par ${r.suggestedPar} should be below the price-only 1,000,000`);
  assert.ok(Math.abs(r.proceeds.netCash) <= 1000, `net cash ${r.proceeds.netCash} should be within a rounding increment`);
});

test('solveBuyParForProceeds locks the other buy legs', () => {
  // Two buys; size leg 0 with leg 1 ($1MM @ 100) locked. Sells 2MM proceeds.
  const r = m.solveBuyParForProceeds({
    sells: [{ par: 2_000_000, marketPrice: 100 }],
    buys: [{ marketPrice: 100 }, { par: 1_000_000, marketPrice: 100 }],
    flexIndex: 0
  });
  assert.strictEqual(r.proceeds.lockedBuy, 1_000_000);
  assert.strictEqual(r.suggestedPar, 1_000_000);
  assert.strictEqual(r.proceeds.netCash, 0);
});

test('solveBuyParForProceeds reports actionable reasons when it cannot solve', () => {
  assert.strictEqual(m.solveBuyParForProceeds({ sells: [{ par: 1e6, marketPrice: 100 }], buys: [] }).ok, false);
  assert.ok(/market price/.test(m.solveBuyParForProceeds({
    sells: [{ par: 1e6, marketPrice: 100 }], buys: [{}]
  }).reason));
  assert.ok(/sell leg/.test(m.solveBuyParForProceeds({
    sells: [], buys: [{ marketPrice: 100 }]
  }).reason));
});

// ---------- Municipal TEY (FBBS verified form) ----------

test('municipalTeYield matches the verified FBBS form (YTW - COF*t*q)/(1-t)', () => {
  // 3.50% BQ muni, 21% tax, 1.50% COF, q=0.20 → (3.5 - 1.5*0.21*0.20)/0.79
  near(m.municipalTeYield(3.5, { cofPct: 1.5, taxRatePct: 21, bqFactor: 0.20 }), 4.3506, 0.001, 'BQ muni TEY');
  // Non-BQ (q=1.00) carries a larger disallowance → lower TEY
  near(m.municipalTeYield(3.5, { cofPct: 1.5, taxRatePct: 21, bqFactor: 1.00 }), 4.0316, 0.001, 'non-BQ muni TEY');
  // Sub-S rate 29.6%
  near(m.municipalTeYield(3.5, { cofPct: 1.5, taxRatePct: 29.6, bqFactor: 0.20 }), 4.8455, 0.001, 'Sub-S muni TEY');
});

test('municipalTeYield with zero COF reduces to the plain gross-up', () => {
  near(m.municipalTeYield(4, { cofPct: 0, taxRatePct: 21, bqFactor: 0.20 }), m.teYield(4, 21), 0.0001, 'zero-COF TEY');
});

test('municipalTeYield guards bad input', () => {
  assert.strictEqual(m.municipalTeYield(null, { taxRatePct: 21 }), null);
  assert.strictEqual(m.municipalTeYield(3.5, { taxRatePct: 100 }), null);
  // Missing options default to COF 0 / q 0.20 / tax 0 → returns the raw yield
  near(m.municipalTeYield(3.5), 3.5, 0.0001, 'no-options TEY');
});

// ---------- Reinvestment breakeven (years) ----------

test('reinvestBreakevenYears = |%loss| / annual pickup', () => {
  near(m.reinvestBreakevenYears(-3, 1.5), 2.0, 0.0001, 'breakeven years');
  near(m.reinvestBreakevenYears(-1, 2), 0.5, 0.0001, 'breakeven years 2');
  assert.strictEqual(m.reinvestBreakevenYears(-3, 0), null, 'no pickup → null');
  assert.strictEqual(m.reinvestBreakevenYears(-3, -1), null, 'negative pickup → null');
  assert.strictEqual(m.reinvestBreakevenYears(null, 1.5), null, 'no loss → null');
});

// ---------- Multi-sell reinvestment package ----------

// Two losing lots reinvested at 5%; loss is recouped right at the 24mo cap.
const PKG_A = { proceeds: 1000000, annualIncomeGivenUp: 40000, realizedGainLoss: -20000, monthsToMaturity: 60, horizonYears: 4, par: 1000000, marketValue: 990000 };
const PKG_B = { proceeds: 500000, annualIncomeGivenUp: 20000, realizedGainLoss: -10000, monthsToMaturity: 48, horizonYears: 3, par: 500000, marketValue: 495000 };

test('summarizeReinvestPackage sums income and breakeven across members', () => {
  const r = m.summarizeReinvestPackage([PKG_A, PKG_B], { buyYieldPct: 5.0, breakevenCapMonths: 24 });
  assert.strictEqual(r.passes, true, 'package within all gates passes');
  near(r.proceeds, 1500000, 1, 'combined proceeds');
  near(r.annualBuyIncome, 75000, 1, 'income gained = proceeds x buy yield');
  near(r.annualIncomeGivenUp, 60000, 1, 'income given up = sum of members');
  near(r.annualIncomePickup, 15000, 1, 'net annual pickup');
  near(r.realizedGainLoss, -30000, 1, 'combined realized loss');
  near(r.breakevenMonths, 24.0, 0.05, 'blended breakeven = loss / (pickup/12)');
  near(r.minMonthsToMaturity, 48, 0.1, 'earliest member maturity');
  near(r.horizonYears, 3.67, 0.02, 'proceeds-weighted horizon');
  assert.strictEqual(r.count, 2, 'member count');
});

test('summarizeReinvestPackage fails when breakeven exceeds the cap', () => {
  const heavyLoss = Object.assign({}, PKG_B, { realizedGainLoss: -30000 }); // total -50k → 40mo
  const r = m.summarizeReinvestPackage([PKG_A, heavyLoss], { buyYieldPct: 5.0, breakevenCapMonths: 24 });
  assert.strictEqual(r.passes, false, 'over-cap breakeven fails');
  assert.ok(r.reasons.some(x => /breakeven/.test(x)), 'reason names breakeven');
});

test('summarizeReinvestPackage fails when a sold bond matures before breakeven', () => {
  const shortMat = Object.assign({}, PKG_B, { monthsToMaturity: 12 }); // < 24mo breakeven
  const r = m.summarizeReinvestPackage([PKG_A, shortMat], { buyYieldPct: 5.0, breakevenCapMonths: 24 });
  assert.strictEqual(r.passes, false, 'maturity-before-breakeven fails');
  assert.ok(r.reasons.some(x => /matures/.test(x)), 'reason names the early maturity');
});

test('summarizeReinvestPackage fails with no net annual income pickup', () => {
  const r = m.summarizeReinvestPackage([PKG_A, PKG_B], { buyYieldPct: 4.0, breakevenCapMonths: 24 });
  assert.strictEqual(r.passes, false, 'reinvesting at the give-up yield earns nothing extra');
  assert.ok(r.reasons.some(x => /pickup/.test(x)), 'reason names the missing pickup');
});

test('summarizeReinvestPackage recoups immediately when the package nets a gain', () => {
  const gainA = Object.assign({}, PKG_A, { realizedGainLoss: 5000 });
  const gainB = Object.assign({}, PKG_B, { realizedGainLoss: 5000 });
  const r = m.summarizeReinvestPackage([gainA, gainB], { buyYieldPct: 5.0, breakevenCapMonths: 24 });
  assert.strictEqual(r.passes, true, 'a net-gain package with pickup passes');
  assert.strictEqual(r.breakevenMonths, 0, 'no loss to earn back → breakeven 0');
});

test('summarizeReinvestPackage guards empty input', () => {
  const r = m.summarizeReinvestPackage([], { buyYieldPct: 5.0 });
  assert.strictEqual(r.passes, false, 'no members never passes');
  assert.strictEqual(r.count, 0, 'count 0');
});

// ---------- Done ----------

console.log(`swap-math tests: ${passed} passed.`);
