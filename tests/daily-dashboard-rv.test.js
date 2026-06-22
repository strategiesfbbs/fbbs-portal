// Tests for server/daily-dashboard-rv.js — the relative-value engine behind the
// Sales Dashboard. Pure functions, no I/O, no network.
'use strict';

const assert = require('assert');
const dd = require('../server/daily-dashboard');
const rv = require('../server/daily-dashboard-rv');

const ASOF = '2026-06-22';

// Official par curve (tenor label → percent) for the fixtures.
const CURVE = {
  asOfDate: '2026-06-20',
  tenors: { '1M': 4.40, '3M': 4.35, '6M': 4.25, '1Y': 4.00, '2Y': 3.80, '3Y': 3.75, '5Y': 3.85, '7Y': 4.00, '10Y': 4.20, '20Y': 4.60, '30Y': 4.55 },
};

// FDIC national average CD rates by term (fred-series shape).
const FRED = {
  ndr3m: { value: 0.50 }, ndr6m: { value: 0.80 }, ndr12m: { value: 1.80 },
  ndr24m: { value: 1.50 }, ndr36m: { value: 1.45 }, ndr60m: { value: 1.40 },
};

// MMD AAA/AA/A/Baa scale (mmd-parser shape) for the muni cheap-to-MMD screen.
const MMD = {
  asOfDate: '2026-06-18',
  curve: [
    { term: 1, aaa: 2.32, aa: 2.35, a: 2.37, baa: 2.72 },
    { term: 3, aaa: 2.46, aa: 2.50, a: 2.58, baa: 2.90 },
    { term: 5, aaa: 2.61, aa: 2.65, a: 2.79, baa: 3.16 },
    { term: 10, aaa: 3.00, aa: 3.10, a: 3.25, baa: 3.70 },
    { term: 30, aaa: 4.27, aa: 4.52, a: 4.47, baa: 5.09 },
  ],
};

const ROWS = [
  // BQ exempt muni, callable, premium → priced to call. moody Aa3.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: '157399BW5', description: 'Chaffee MO SD', sector: 'BQ', state: 'MO', coupon: 5.0, yield: 3.80, price: 105.12, maturity: '2042-03-01', callDate: '2031-03-01', availabilityK: 275, moody: 'Aa3' },
  // Short corporate, 3y, A-rated, clean — RIA only.
  { assetClass: 'Corporate', type: 'corporate', page: 'corporates', cusip: '00000SHRT3', description: 'ShortCo 3y', sector: 'Industrial', state: '', coupon: 4.9, yield: 4.90, ytm: 4.90, ytnc: null, price: 100.0, maturity: '2029-06-15', callDate: null, availabilityK: 1500, sp: 'A' },
  // Long agency bullet, 30y, HIGH raw yield (5.10) but thin spread — RIA/banks.
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130LONG30', description: 'FHLB 30y bullet', sector: 'Bullet', state: '', coupon: 5.10, yield: 5.10, ytm: 5.10, ytnc: null, price: 99.0, maturity: '2056-06-15', callDate: null, availabilityK: 5000 },
  // 12m FDIC CD at 4.55 — cheap to FDIC avg, mildly cheap to UST.
  { assetClass: 'CD Offering', type: 'cd', page: 'explorer', cusip: '06251FET2', description: 'Bank Hapoalim · 12m', sector: 'CD', state: 'NY', coupon: null, yield: 4.55, price: null, maturity: '2027-06-16', callDate: null, availabilityK: null },
  // Callable agency worked to a near call, through Treasuries — should screen rich.
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130RICH00', description: 'FHLB callable', sector: 'Callable', state: '', coupon: 4.65, yield: 3.90, ytm: 4.35, ytnc: 3.90, price: 99.65, maturity: '2032-05-19', callDate: '2027-05-19', availabilityK: 4370 },
  // BBB corp at a wide spread (credit comp) — RIA only.
  { assetClass: 'Corporate', type: 'corporate', page: 'corporates', cusip: '319626AA5', description: 'First Citizens', sector: 'Financial', state: '', coupon: 5.6, yield: 6.06, ytm: 6.06, ytnc: null, price: 96.0, maturity: '2035-02-01', callDate: null, availabilityK: 1500, sp: 'BBB+' },
];

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function approx(a, b, eps = 1) { return Math.abs(a - b) <= eps; }
function find(setRv, cusip) { return setRv.candidates.find(c => c.cusip === cusip); }

test('interpolateCurve linear-interpolates and flat-extrapolates', () => {
  assert.ok(approx(rv.interpolateCurve(CURVE.tenors, 4), (3.75 + 3.85) / 2, 0.001)); // between 3Y & 5Y
  assert.strictEqual(rv.interpolateCurve(CURVE.tenors, 1), 4.00);                    // exact 1Y
  assert.strictEqual(rv.interpolateCurve(CURVE.tenors, 0.01), 4.40);                 // below short end → flat
  assert.strictEqual(rv.interpolateCurve(CURVE.tenors, 50), 4.55);                   // beyond 30Y → flat
});

test('workoutTenor prices premium/low-YTNC callables to the call', () => {
  const agency = ROWS.find(r => r.cusip === '3130RICH00'); // ytnc 3.90 ≤ ytm 4.35
  const w = rv.workoutTenor(agency, ASOF);
  assert.strictEqual(w.basis, 'call');
  assert.ok(w.effYears < 1.2 && w.effYears > 0.7); // ~0.9y to the 2027-05 call
  const bullet = ROWS.find(r => r.cusip === '3130LONG30'); // no call
  assert.strictEqual(rv.workoutTenor(bullet, ASOF).basis, 'maturity');
});

test('fdicCdRateForTerm interpolates between published terms', () => {
  const map = rv.fdicCdRateMap(FRED);
  assert.strictEqual(rv.fdicCdRateForTerm(map, 12), 1.80);
  assert.ok(approx(rv.fdicCdRateForTerm(map, 18), (1.80 + 1.50) / 2, 0.001)); // 12↔24
  assert.strictEqual(rv.fdicCdRateForTerm(map, 1), 0.50);  // below 3m → flat
});

test('rating parsing maps Moody/S&P notches into coarse buckets', () => {
  assert.strictEqual(rv.ratingBucket({ moody: 'Aa3' }), 'AA');
  assert.strictEqual(rv.ratingBucket({ sp: 'A' }), 'A');
  assert.strictEqual(rv.ratingBucket({ sp: 'BBB+' }), 'BBB');
  assert.strictEqual(rv.ratingBucket({}), 'NR');
  // Best (lowest) notch wins when both are present.
  assert.strictEqual(rv.ratingBucket({ moody: 'A2', sp: 'AA' }), 'AA');
});

test('matched-Treasury spread is grounded in the interpolated curve', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const corp = find(set, '319626AA5'); // YTW 6.06, ~8.6y → UST ~4.10
  assert.ok(corp.rv.ustSpreadBps > 180 && corp.rv.ustSpreadBps < 210);
  const short = find(set, '00000SHRT3'); // 4.90 vs 3Y 3.75 → ~+115
  assert.ok(approx(short.rv.ustSpreadBps, 115, 6));
});

test('CD carries both Treasury and FDIC spreads + spread-per-month', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const cd = find(set, '06251FET2'); // 4.55 vs 1Y UST 4.00, vs FDIC 12m 1.80
  assert.strictEqual(cd.rv.cdTermMonths, 12);
  assert.ok(approx(cd.rv.ustSpreadBps, 55, 6));
  assert.ok(approx(cd.rv.fdicSpreadBps, 275, 6));
  assert.ok(cd.rv.spreadPerMonthBps > 4 && cd.rv.spreadPerMonthBps < 5);
});

test('muni carries a muni/UST ratio and a bank TEY spread, not a raw-yield rank', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const muni = find(set, '157399BW5'); // YTW 3.80, ccorp TEY = 4.81
  assert.ok(muni.rv.ratioPct > 90 && muni.rv.ratioPct < 110);
  assert.ok(muni.rv.audSpreadBps.ccorp > 80);  // TEY spread to UST is clearly positive
  assert.ok(muni.rv.ustSpreadBps < 20);        // nominal spread is thin/negative (expected)
});

test('RISK-ADJUSTED: a short bond out-ranks a higher-yield long bond', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const short = find(set, '00000SHRT3'); // 4.90 raw, 3y
  const long = find(set, '3130LONG30');  // 5.10 raw (HIGHER), 30y
  assert.ok(short.ytw < long.ytw, 'sanity: the long bond has the higher raw yield');
  assert.ok(short.rv.rvBps > long.rv.rvBps, 'but the short bond is cheaper risk-adjusted');
  // And the long bond gets a meaningful extension penalty baked into rvBps.
  assert.ok(rv.structurePenaltyBps(long, { effYears: long.rv.effYears, basis: 'maturity', price: 99 }) >= 40);
});

test('through-Treasuries callable screens poorly; leaders are sorted by rvBps', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const rich = find(set, '3130RICH00'); // worked to call, through UST
  assert.ok(rich.rv.rvBps < 0);
  for (let i = 1; i < set.leaders.length; i++) {
    assert.ok(set.leaders[i - 1].rv.rvBps >= set.leaders[i].rv.rvBps);
  }
  // The rich callable should not be a leader.
  assert.ok(!set.leaders.slice(0, 3).some(c => c.cusip === '3130RICH00'));
});

test('best-by-bucket spreads ideas across the curve (long end cannot sweep)', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  // Each populated bucket exposes its own top idea.
  const populated = Object.values(set.byBucket).filter(b => b.count > 0);
  assert.ok(populated.length >= 2);
  for (const b of populated) assert.ok(b.top.length >= 1 && b.top.length <= 3);
});

test('audience lists re-rank by the tax-aware spread that audience earns', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  for (const k of dd.AUDIENCE_KEYS) {
    const list = set.byAudience[k];
    const sp = list.map(cu => set.byCusip.get(cu).rv.audSpreadBps[k]).filter(v => v != null);
    for (let i = 1; i < sp.length; i++) assert.ok(sp[i - 1] >= sp[i], `${k} not sorted by tax-aware spread`);
  }
  // RIA never sees bank-only CDs / exempt munis.
  assert.ok(!set.byAudience.ria.includes('06251FET2'));
  assert.ok(!set.byAudience.ria.includes('157399BW5'));
});

test('caveats and buyer types are populated and grounded', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const long = find(set, '3130LONG30');
  assert.ok(long.rv.caveats.some(s => /effective life/i.test(s)));
  const cd = find(set, '06251FET2');
  assert.ok(cd.rv.buyerTypes.some(s => /FDIC/i.test(s)));
  const bbb = find(set, '319626AA5');
  assert.ok(bbb.rv.caveats.some(s => /credit/i.test(s)));
  assert.deepStrictEqual(bbb.rv.buyerTypes, ['RIAs / money managers (not bank-eligible)']);
});

test('trend detection classifies new / wider / improved vs the prior snapshot', () => {
  const first = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  // Build a "prior" snapshot, then perturb: widen the corp, improve the CD price-equivalent.
  const prior = JSON.parse(JSON.stringify(first.snapshot));
  prior['319626AA5'].sp -= 30; // corp was 30bp tighter yesterday → "wider" today
  delete prior['06251FET2'];   // CD absent yesterday → "new"
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF, priorMap: prior });
  assert.strictEqual(find(set, '319626AA5').rv.trend, 'wider');
  assert.strictEqual(find(set, '06251FET2').rv.trend, 'new');
  assert.ok(set.trends.new.includes('06251FET2'));
  assert.ok(set.trends.wider.includes('319626AA5'));
});

test('muni cheap-to-MMD uses the grade-matched MMD scale', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF });
  const muni = find(set, '157399BW5'); // Aa3 → AA grade; YTW 3.80; ~4.7y workout (to 2031 call)
  assert.strictEqual(muni.rv.mmdGrade, 'AA');
  assert.ok(muni.rv.mmdYield > 2.5 && muni.rv.mmdYield < 2.7); // AA MMD ~4.7y
  assert.ok(muni.rv.mmdSpreadBps > 90 && muni.rv.mmdSpreadBps < 140); // ~+117bp cheap to AA MMD
  assert.strictEqual(set.benchmarks.mmd, true);
  assert.strictEqual(set.benchmarks.mmdAsOf, '2026-06-18');
  // interpolateMmd flat-extrapolates and falls back to AAA when a grade is absent.
  assert.strictEqual(rv.interpolateMmd(MMD, 'aaa', 0.5), 2.32);
  assert.strictEqual(rv.interpolateMmd(MMD, 'aa', 40), 4.52);
});

test('benchmarks block reports availability honestly (MMD optional)', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  assert.strictEqual(set.benchmarks.treasury, true);
  assert.strictEqual(set.benchmarks.fdicCd, true);
  assert.strictEqual(set.benchmarks.mmd, false); // not supplied here
  // Degrades cleanly with no curve / no fred / no mmd.
  const bare = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), asOf: ASOF });
  assert.strictEqual(bare.benchmarks.treasury, false);
  assert.strictEqual(bare.benchmarks.mmd, false);
  assert.ok(Array.isArray(bare.leaders));
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`daily-dashboard-rv tests: ${passed} passed.`);
})();
