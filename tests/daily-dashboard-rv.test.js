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

// MMD AAA/AA/A/Baa(/insured) scale (mmd-parser shape) for the muni screens, plus
// the AAA muni/UST ratio benchmarks (treasuryRatios) used by the strategist KPIs.
const MMD = {
  asOfDate: '2026-06-18',
  curve: [
    { term: 1, aaa: 2.32, aa: 2.35, a: 2.37, baa: 2.72, insured: 2.40 },
    { term: 3, aaa: 2.46, aa: 2.50, a: 2.58, baa: 2.90, insured: 2.55 },
    { term: 5, aaa: 2.61, aa: 2.65, a: 2.79, baa: 3.16, insured: 2.70 },
    { term: 10, aaa: 3.00, aa: 3.10, a: 3.25, baa: 3.70, insured: 3.15 },
    { term: 30, aaa: 4.27, aa: 4.52, a: 4.47, baa: 5.09, insured: 4.61 },
  ],
  treasuryRatios: [
    { term: 2, ratioPct: 57 }, { term: 5, ratioPct: 62 }, { term: 10, ratioPct: 67 }, { term: 30, ratioPct: 87 },
  ],
};

// A deterministic Pershing buyer-pattern profile (trade-fit.js shape) for the
// trade-fit / audience-ordering tests: C-corps buy CDs most, S-corps buy munis
// most (MO-heavy), RIAs buy CDs + corporate credit. Bands cover the whole curve.
const FULL_BUCKETS = { '0-1y': 0.20, '1-3y': 0.22, '3-5y': 0.20, '5-7y': 0.15, '7-10y': 0.13, '10y+': 0.10 };
const TRADE_PROFILE = {
  generatedAt: '2026-06-24T00:00:00.000Z', asOf: '2026-06-23', totalBuys: 1000,
  audiences: {
    ccorp: { trades: 400, byClass: { cd: 0.45, muni: 0.30, govt: 0.20, corp: 0.05 }, byBucket: FULL_BUCKETS, byState: { MO: 0.5, KS: 0.3, TX: 0.2 }, topIssuers: ['FEDERAL HOME LN'], topStates: ['MO', 'KS', 'TX'] },
    scorp: { trades: 250, byClass: { muni: 0.50, govt: 0.25, cd: 0.20, corp: 0.05 }, byBucket: FULL_BUCKETS, byState: { MO: 0.6, KS: 0.4 }, topIssuers: ['UNITED STATES TREAS'], topStates: ['MO', 'KS'] },
    ria: { trades: 350, byClass: { cd: 0.40, corp: 0.35, muni: 0.20, mbs: 0.05 }, byBucket: FULL_BUCKETS, byState: { TX: 0.5, MO: 0.3 }, topIssuers: ['FIRST CITIZENS'], topStates: ['TX', 'MO'] },
  },
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
  // Structured note — RIA / yield enhancement.
  { assetClass: 'Structured Note', type: 'structured-note', page: 'structured-notes', cusip: '48130KKH9', description: 'JPM 20Y/2Y structured', sector: 'Callable Fixed', state: '', coupon: 6.0, yield: 6.0, ytm: 6.0, ytnc: null, price: 99.85, maturity: '2046-06-11', callDate: '2028-06-11', availabilityK: null, sp: 'A' },
  // AG-insured muni — benchmarked against the insured MMD scale, not just AAA.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: 'INSURED001', description: 'AG-insured IA', sector: 'Municipals', state: 'IA', coupon: 3.0, yield: 2.93, price: 99.5, maturity: '2030-09-01', callDate: null, availabilityK: 500, sp: 'AA', creditEnhancement: 'AG' },
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
  const matured = rv.workoutTenor({ maturity: '2025-01-01', callDate: null }, ASOF);
  assert.strictEqual(matured.effYears, null);
  assert.strictEqual(matured.statedYears, null);
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
  assert.strictEqual(rv.cdTermMonths({ description: '' }, 0.01), null);
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

test('best-by-bucket covers populated bands even when they are not global leaders', () => {
  const treasuryOnly = [
    { assetClass: 'Treasury', type: 'treasury', page: 'treasury-explorer', cusip: '91282CSH1', description: 'UST short bill', sector: 'Treasury', coupon: 0, yield: 4.25, price: 99.7, maturity: '2027-03-15', availabilityK: null },
    { assetClass: 'Treasury', type: 'treasury', page: 'treasury-explorer', cusip: '91282CSV5', description: 'UST 5-7Y note', sector: 'Treasury', coupon: 4.0, yield: 3.95, price: 100.1, maturity: '2032-01-15', availabilityK: null },
  ];
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(treasuryOnly), curve: CURVE, asOf: ASOF });
  assert.strictEqual(set.leaders.length, 0, 'Treasuries are excluded from global RV leaders');
  assert.strictEqual(set.byBucket['0-1y'].count, 1);
  assert.strictEqual(set.byBucket['0-1y'].top[0].cusip, '91282CSH1');
  assert.strictEqual(set.byBucket['5-7y'].count, 1);
  assert.strictEqual(set.byBucket['5-7y'].top[0].cusip, '91282CSV5');
});

test('sales-dashboard coverage exposes inventory strip plus RIA and bank-capital boards', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  const labels = set.inventory.map(b => b.label);
  assert.ok(labels.includes('Tax-exempt munis'));
  assert.ok(labels.includes('Agencies'));
  assert.ok(labels.includes('CD offerings'));
  assert.ok(labels.includes('Corporates'));
  assert.ok(labels.includes('Structured notes'));
  assert.ok(set.inventory.find(b => b.key === 'muni-exempt').bqCount >= 1);
  assert.ok(set.creditYield.some(c => c.cusip === '319626AA5'));
  assert.ok(set.creditYield.some(c => c.cusip === '48130KKH9'));
  assert.ok(set.bankCapital.every(c => /agency|treasur|mbs|cmo/i.test(c.assetClass || c.type || '')));
});

test('audience lists span the maturity curve, lead with best-in-band value, respect eligibility', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF, tradeProfile: TRADE_PROFILE });
  for (const k of dd.AUDIENCE_KEYS) {
    const list = set.byAudience[k];
    if (list.length < 2) continue;
    const buckets = list.map(cu => set.byCusip.get(cu).rv.bucket);
    const populated = new Set(buckets.filter(Boolean));
    // The leading picks each come from a DIFFERENT maturity band (curve coverage
    // up front) — the whole point of the fix, so short/belly are never buried.
    const lead = buckets.slice(0, populated.size);
    assert.strictEqual(new Set(lead).size, lead.length, `${k} leading picks should each be a different band`);
    // Within a band, the best (highest) audience spread leads.
    const byBucket = {};
    for (const cu of list) {
      const c = set.byCusip.get(cu);
      const b = c.rv.bucket;
      if (!byBucket[b]) byBucket[b] = [];
      byBucket[b].push(c.rv.audSpreadBps[k]);
    }
    for (const b in byBucket) {
      const sp = byBucket[b].filter(v => v != null);
      for (let i = 1; i < sp.length; i++) assert.ok(sp[i - 1] >= sp[i], `${k} band ${b} not best-value-first`);
    }
  }
  // RIA never sees bank-only CDs / exempt munis (eligibility is unchanged).
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

test('data-backed trade-fit reflects demand without adding eligibility', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF, tradeProfile: TRADE_PROFILE });

  // CD is bank-only — trade history NEVER grants it an RIA audience.
  const cd = find(set, '06251FET2');
  assert.strictEqual(cd.rv.tradeFit.ria, undefined, 'bank-only CD should not gain RIA eligibility');
  assert.ok(cd.rv.tradeFit.ccorp.score > 0 && cd.rv.tradeFit.scorp.score > 0);
  // C-corps buy CDs most (45%) vs S-corps (20%) → ccorp scores the CD higher.
  assert.ok(cd.rv.tradeFit.ccorp.score > cd.rv.tradeFit.scorp.score);
  assert.ok(cd.rv.tradeFit.ccorp.reasons.some(s => /CD/i.test(s)));

  // S-corps buy munis most; the MO obligor triggers the in-state demand reason.
  const muni = find(set, '157399BW5');
  assert.ok(muni.rv.tradeFit.scorp.reasons.some(s => /muni/i.test(s)));
  assert.ok(muni.rv.tradeFit.ccorp.reasons.some(s => /MO/i.test(s) || /muni/i.test(s)));

  // Corporate stays RIA-only — trade history scores ria, never the banks.
  const corp = find(set, '319626AA5');
  assert.ok(corp.rv.tradeFit.ria.score > 0);
  assert.strictEqual(corp.rv.tradeFit.ccorp, undefined, 'corporate is still not bank-eligible');
  assert.strictEqual(corp.rv.tradeFit.scorp, undefined, 'corporate is still not bank-eligible');

  // No profile injected → no nudge at all (pure, graceful degrade).
  const noProfile = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, asOf: ASOF });
  assert.strictEqual(find(noProfile, '06251FET2').rv.tradeFit, null);
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

test('bqCorrectTey reproduces the desk/catalog TEFRA math', () => {
  const cc = rv.bqCorrectTey(3.15, 21, 0.20, 1.5); // BQ C-corp
  assert.ok(approx(cc.tey, 3.91, 0.02));
  assert.ok(approx(cc.tefraBp, 8, 1));
  const nbq = rv.bqCorrectTey(3.15, 21, 1.00, 1.5); // non-BQ C-corp
  assert.ok(approx(nbq.tey, 3.59, 0.02));
  // BQ disallowance factor q by audience + BQ status.
  assert.strictEqual(rv.bqFactorFor('ccorp', true), 0.20);
  assert.strictEqual(rv.bqFactorFor('ccorp', false), 1.00);
  assert.strictEqual(rv.bqFactorFor('scorp', true), 0);
  assert.strictEqual(rv.bqFactorFor('scorp', false), 1.00);
});

test('muni picks rank on the BQ/TEFRA-correct net TEY, and BQ is worth ~32bp', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF });
  const muni = find(set, '157399BW5'); // BQ Aa3, YTW 3.80, C-corp 21%
  assert.ok(muni.rv.netTey.ccorp > 4.6 && muni.rv.netTey.ccorp < 4.8); // ≈4.73 (vs naive 4.81)
  assert.ok(approx(muni.rv.tefraBp.ccorp, 8, 1));
  assert.ok(approx(muni.rv.bqAdvantageBp, 32, 3)); // BQ worth ~32bp vs non-BQ
  // The audience spread re-ranks on net TEY (so it's a touch below the naive figure).
  assert.ok(muni.rv.audSpreadBps.ccorp > 80 && muni.rv.audSpreadBps.ccorp < 95);
});

test('"yields like a lower grade" notch + de-minimis flags', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF });
  const muni = find(set, '157399BW5'); // YTW 3.80 sits above the Baa MMD scale at ~4.7y
  assert.strictEqual(muni.rv.impliedGrade, 'Baa');
  assert.ok(muni.rv.notchesCheap >= 1); // Aa3→AA, yields like Baa
  // De-minimis on a discount muni.
  const dm = rv.deMinimis(95.98, 16);
  assert.ok(dm.breach && approx(dm.threshold, 96.0, 0.01));
  const equality = rv.deMinimis(97.50, 10);
  assert.strictEqual(equality.breach, true);
  assert.strictEqual(equality.threshold, 97.50);
  assert.strictEqual(rv.deMinimis(101, 10), null); // premium → n/a
});

test('BQ q-factor and implied-MMD notch direction edge cases', () => {
  assert.strictEqual(rv.bqFactorFor('scorp', true), 0);
  const implied = rv.impliedMmdGrade(MMD, 5, 3.20, 'AA');
  assert.deepStrictEqual(implied, { impliedGrade: 'Baa', notchesCheap: 2 });
  const rich = rv.impliedMmdGrade(MMD, 5, 2.61, 'AA');
  assert.deepStrictEqual(rich, { impliedGrade: 'AAA', notchesCheap: -1 });
});

test('outlier chips surface the strongest signals (≤3)', () => {
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF });
  for (const c of set.candidates) assert.ok(Array.isArray(c.rv.chips) && c.rv.chips.length <= 3);
  const muni = find(set, '157399BW5');
  assert.ok(muni.rv.chips.some(s => /MMD/.test(s)));
});

test('archive-fed movers strip the parallel curve move (excess-of-median)', () => {
  // Prior package: everything 10bp lower than today EXCEPT the corp 30bp lower
  // (so the corp cheapened idiosyncratically), and the CD absent (new today).
  const PRIOR_ROWS = ROWS.filter(r => r.cusip !== '06251FET2' && r.yield != null).map(r => ({
    cusip: r.cusip, type: r.type, description: r.description, state: r.state, price: r.price,
    yield: r.yield - (r.cusip === '319626AA5' ? 0.30 : 0.10),
  }));
  const set = rv.buildRelativeValue({
    candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF,
    priorRows: PRIOR_ROWS, priorMeta: { priorDate: '2026-06-12', daysAgo: 10 },
  });
  assert.ok(set.movers);
  assert.strictEqual(set.movers.priorDate, '2026-06-12');
  assert.ok(approx(set.movers.curveMoveBp, 10, 1)); // median move = +10bp
  assert.ok(set.movers.cheapened.some(c => c.cusip === '319626AA5')); // corp cheapened vs the curve
  assert.ok(set.movers.newToday.some(c => c.cusip === '06251FET2')); // CD is new today
  assert.strictEqual(set.benchmarks.priorPackage.daysAgo, 10);
});

test('archive-fed movers use a robust median baseline, not an outlier-skewed mean', () => {
  const rows = [
    { assetClass: 'Agency', cusip: 'AAA111111', description: 'A', yield: 4.00, ytm: 4.00, maturity: '2028-01-01' },
    { assetClass: 'Agency', cusip: 'BBB222222', description: 'B', yield: 4.00, ytm: 4.00, maturity: '2028-01-01' },
    { assetClass: 'Agency', cusip: 'CCC333333', description: 'C', yield: 4.00, ytm: 4.00, maturity: '2028-01-01' },
    { assetClass: 'Corporate', cusip: 'DDD444444', description: 'Outlier', yield: 5.00, ytm: 5.00, maturity: '2028-01-01' },
  ];
  const priorRows = rows.map(r => ({ ...r, yield: r.cusip === 'DDD444444' ? r.yield - 1.00 : r.yield - 0.10 }));
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(rows), curve: CURVE, asOf: ASOF, priorRows });
  assert.strictEqual(set.movers.curveMoveBp, 10);
  const unchanged = set.candidates.filter(c => c.cusip !== 'DDD444444');
  assert.ok(unchanged.every(c => c.rv.trend === 'repeat'), unchanged.map(c => `${c.cusip}:${c.rv.moverBp}`).join(','));
  assert.ok(set.movers.cheapened.some(c => c.cusip === 'DDD444444'));
});

test('credit-enhancement re-scores against the insured MMD scale', () => {
  assert.strictEqual(rv.classifyEnhancement('AG').type, 'insured');
  assert.strictEqual(rv.classifyEnhancement('BAM').type, 'insured');
  assert.strictEqual(rv.classifyEnhancement('ST AID DIR DEP').type, 'state-aid');
  assert.strictEqual(rv.classifyEnhancement('ATY(35) = 3.37%'), null); // junk note → no enhancement
  assert.strictEqual(rv.classifyEnhancement('AGENCY'), null);
  assert.strictEqual(rv.classifyEnhancement('AGGREGATE'), null);
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF });
  const ins = find(set, 'INSURED001'); // YTW 2.93 vs insured MMD ~2.64 at ~4.2y
  assert.ok(ins.rv.enhanced && ins.rv.enhanced.type === 'insured');
  assert.ok(ins.rv.enhanced.spreadBps > 15 && ins.rv.enhanced.spreadBps < 45); // ≈+29bp cheap to insured
  assert.ok(ins.rv.chips.some(s => /insured/.test(s)));
});

test('strategist backdrop: OAS regime percentile + muni/credit KPIs', () => {
  // 90 obs rising 0.80→~1.245; latest 0.92 sits low in the range → tight.
  const fred = {
    igOas: { value: 0.92, history: Array.from({ length: 90 }, (_, i) => ({ d: 'x', v: 0.80 + i * 0.005 })) },
    hyOas: { value: 3.20, history: Array.from({ length: 90 }, (_, i) => ({ d: 'x', v: 3.0 + i * 0.02 })) },
  };
  const s = rv.buildStrategist(fred, CURVE, MMD);
  assert.strictEqual(s.oas.ig.bp, 92);
  assert.ok(s.oas.ig.pctile < 40 && s.oas.ig.tag === 'tight');
  assert.strictEqual(rv.oasRead({ value: 145, history: Array.from({ length: 12 }, (_, i) => ({ v: 120 + i })) }).bp, 145);
  assert.strictEqual(rv.oasRead({ value: 1.45, history: Array.from({ length: 12 }, (_, i) => ({ v: 1.2 + i / 100 })) }).bp, 145);
  assert.strictEqual(s.kpi.mmdAaa['10y'], 3.00);
  assert.strictEqual(s.kpi.ratios['10y'], 67);
  assert.strictEqual(s.kpi.twos10s.level, 40); // (4.20 − 3.80) × 100
  // Rides on the analysis output too.
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred, mmd: MMD, asOf: ASOF });
  assert.ok(set.strategist && set.strategist.oas.ig.tag === 'tight');
});

test('asset-class regime shift diffs the desk RV table, parallel move netted', () => {
  // Spreads are vs UST, so a parallel curve move cancels — only the class spread
  // delta survives. Today: CDs tighter ~10bp, munis wider ~12bp vs prior.
  const today = { rows: [
    { term: '2 Yr', cdSpread: 5, agencySpread: 8, muniSpread: -130, corpSpread: 60 },
    { term: '5 Yr', cdSpread: 8, agencySpread: 9, muniSpread: -120, corpSpread: 64 },
  ] };
  const prior = { rows: [
    { term: '2 Yr', cdSpread: 16, agencySpread: 8, muniSpread: -142, corpSpread: 61 },
    { term: '5 Yr', cdSpread: 18, agencySpread: 9, muniSpread: -132, corpSpread: 63 },
  ] };
  const reg = rv.regimeShift(today, prior);
  const cd = reg.find(r => r.key === 'cd');
  const muni = reg.find(r => r.key === 'muni');
  assert.strictEqual(cd.deltaBp, -10); assert.strictEqual(cd.direction, 'richened'); // CD spreads compressed (mean of −11,−10)
  assert.strictEqual(muni.deltaBp, 12); assert.strictEqual(muni.direction, 'cheapened'); // munis cheapened
  assert.strictEqual(reg.find(r => r.key === 'agency').direction, 'flat');
  // Sorted by |delta|; null when a table is missing.
  assert.ok(Math.abs(reg[0].deltaBp) >= Math.abs(reg[reg.length - 1].deltaBp));
  assert.strictEqual(rv.regimeShift(today, null), null);
  // Rides on the analysis output via strategist.regime.
  const set = rv.buildRelativeValue({ candidateSet: dd.buildCandidateSet(ROWS), curve: CURVE, fred: FRED, mmd: MMD, asOf: ASOF, rvTable: today, priorRvTable: prior, priorMeta: { priorDate: '2026-06-12', daysAgo: 10 } });
  assert.ok(set.strategist.regime && set.strategist.regime.classes.length === 4);
  assert.strictEqual(set.strategist.regime.priorDate, '2026-06-12');
});

test('regimeShift compares unrounded deltas to the threshold', () => {
  const prior = { rows: [{ term: '1Y', cdSpread: 100 }, { term: '2Y', cdSpread: 100 }] };
  const edge = { rows: [{ term: '1Y', cdSpread: 95.4 }, { term: '2Y', cdSpread: 95.4 }] };
  const hit = { rows: [{ term: '1Y', cdSpread: 95 }, { term: '2Y', cdSpread: 95 }] };
  assert.strictEqual(rv.regimeShift(edge, prior).find(r => r.key === 'cd').direction, 'flat');
  assert.strictEqual(rv.regimeShift(hit, prior).find(r => r.key === 'cd').direction, 'richened');
});

test('buildAudienceOrdering keeps audience picks within the tenors they actually buy', () => {
  // A short bond (modest spread) and a long bond (fat spread/yield).
  const pool = [
    { cusip: 'SHORT1', rv: { bucket: '1-3y', audSpreadBps: { ccorp: 20 }, tradeFit: null } },
    { cusip: 'LONG1', rv: { bucket: '10y+', audSpreadBps: { ccorp: 60 }, tradeFit: null } },
  ];
  // 80% of this audience's buys are short; the long end is near-zero ("cold").
  const shortBuyer = { audiences: { ccorp: { trades: 100, byRecentBucket: { '1-3y': 0.8, '0-1y': 0.18, '10y+': 0.02 }, byBucket: {} } } };
  // This audience genuinely buys across the curve, including the long end.
  const curveBuyer = { audiences: { ccorp: { trades: 100, byRecentBucket: { '1-3y': 0.33, '10y+': 0.34, '0-1y': 0.33 }, byBucket: {} } } };

  // No profile → pure relative value: the fatter-spread long bond leads.
  assert.deepStrictEqual(rv.buildAudienceOrdering(pool, 'ccorp', null), ['LONG1', 'SHORT1']);
  // Short buyer → the long bond is demoted to the tail despite the bigger spread
  // (the owner's rule: don't go 20/30y for a 10-and-in buyer just for yield).
  assert.deepStrictEqual(rv.buildAudienceOrdering(pool, 'ccorp', shortBuyer), ['SHORT1', 'LONG1']);
  // A buyer who goes long keeps the long idea on top — the gate is adaptive.
  assert.deepStrictEqual(rv.buildAudienceOrdering(pool, 'ccorp', curveBuyer), ['LONG1', 'SHORT1']);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`daily-dashboard-rv tests: ${passed} passed.`);
})();
