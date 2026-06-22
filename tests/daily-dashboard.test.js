// Tests for server/daily-dashboard.js — the Phase 1 audience/tax candidate
// layer for the native Sales Dashboard. Pure functions, no I/O, no network.
'use strict';

const assert = require('assert');
const dd = require('../server/daily-dashboard');

// A small cross-asset inventory in the buildAllOfferingsRows() shape, including
// the Phase 1 additions (availabilityK in $000, callDate, ytm/ytnc for callables).
const ROWS = [
  // BQ exempt muni, $275K, callable — bank buyers (ccorp/scorp), grossed up.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: '157399BW5', description: 'Chaffee MO SD', sector: 'BQ', state: 'MO', coupon: 5.0, yield: 3.80, price: 105.12, maturity: '2042-03-01', callDate: '2031-03-01', availabilityK: 275 },
  // Standard exempt muni, $350K — ccorp/scorp.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: '534239MR6', description: 'Lincoln NE GO', sector: 'Municipals', state: 'NE', coupon: 4.0, yield: 3.05, price: 105.56, maturity: '2034-12-15', callDate: '2032-12-15', availabilityK: 350 },
  // Taxable muni, $1.04MM — ccorp + ria, NOT grossed up.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: '982674NK5', description: 'Wyandotte KS Rev', sector: 'Taxable', state: 'KS', coupon: 2.061, yield: 4.10, price: 98.0, maturity: '2030-09-01', callDate: null, availabilityK: 1040 },
  // Callable agency: YTM 4.35 / YTNC 3.90 → YTW must be min = 3.90. $4.37MM.
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130BAKU0', description: 'FHLB · Callable', sector: 'Callable', state: '', coupon: 4.65, yield: 4.35, ytm: 4.35, ytnc: 3.90, price: 99.65, maturity: '2032-05-19', callDate: '2027-05-19', availabilityK: 4370 },
  // FDIC CD, no size (null → passes floor), buy-side → ccorp/scorp.
  { assetClass: 'CD Offering', type: 'cd', page: 'explorer', cusip: '06251FET2', description: 'Bank Hapoalim · 12m', sector: 'CD', state: 'NY', coupon: null, yield: 4.05, price: null, maturity: '2027-06-16', callDate: null, availabilityK: null },
  // Corporate → ria only.
  { assetClass: 'Corporate', type: 'corporate', page: 'corporates', cusip: '319626AA5', description: 'First Citizens BancShares', sector: 'Financial', state: '', coupon: 5.6, yield: 6.06, ytm: 6.06, ytnc: null, price: 96.0, maturity: '2035-02-01', callDate: null, availabilityK: 1500 },
  // Sub-floor agency ($100K) → dropped from featured candidates.
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130SMALL1', description: 'FHLB tiny', sector: 'Bullet', state: '', coupon: 4.0, yield: 4.10, ytm: 4.10, ytnc: null, price: 99.5, maturity: '2029-01-01', callDate: null, availabilityK: 100 },
  // No yield → excluded entirely.
  { assetClass: 'Muni', type: 'muni', page: 'muni-explorer', cusip: '999999ZZ9', description: 'No yield muni', sector: 'BQ', state: 'TX', coupon: 3.0, yield: null, price: 100, maturity: '2030-01-01', callDate: null, availabilityK: 500 },
];

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function approx(a, b, eps = 0.01) { return Math.abs(a - b) <= eps; }

test('rowYtw honors min(YTM, YTNC) for callables', () => {
  const agency = ROWS.find(r => r.cusip === '3130BAKU0');
  assert.strictEqual(dd.rowYtw(agency), 3.90); // min(4.35, 3.90)
  const corp = ROWS.find(r => r.cusip === '319626AA5');
  assert.strictEqual(dd.rowYtw(corp), 6.06);   // ytnc null → ytm
  const cd = ROWS.find(r => r.cusip === '06251FET2');
  assert.strictEqual(dd.rowYtw(cd), 4.05);      // falls back to quoted yield
});

test('exempt/BQ classification follows muni sector', () => {
  assert.ok(dd.isExemptMuni(ROWS.find(r => r.cusip === '157399BW5')));   // BQ
  assert.ok(dd.isExemptMuni(ROWS.find(r => r.cusip === '534239MR6')));   // Municipals
  assert.ok(!dd.isExemptMuni(ROWS.find(r => r.cusip === '982674NK5')));  // Taxable
  assert.ok(dd.isBankQualified(ROWS.find(r => r.cusip === '157399BW5')));
  assert.ok(!dd.isBankQualified(ROWS.find(r => r.cusip === '534239MR6')));
});

test('availability floor excludes only confirmed sub-$250K, passes unknown', () => {
  assert.ok(dd.meetsAvailabilityFloor(ROWS.find(r => r.cusip === '157399BW5'))); // 275K
  assert.ok(!dd.meetsAvailabilityFloor(ROWS.find(r => r.cusip === '3130SMALL1'))); // 100K
  assert.ok(dd.meetsAvailabilityFloor(ROWS.find(r => r.cusip === '06251FET2')));  // null → pass
});

test('audience tagging matches the desk PICKS_DATA rules', () => {
  assert.deepStrictEqual(dd.audiencesForRow(ROWS.find(r => r.cusip === '157399BW5')).sort(), ['ccorp', 'scorp']); // BQ muni
  assert.deepStrictEqual(dd.audiencesForRow(ROWS.find(r => r.cusip === '982674NK5')).sort(), ['ccorp', 'ria']);   // taxable muni
  assert.deepStrictEqual(dd.audiencesForRow(ROWS.find(r => r.cusip === '3130BAKU0')).sort(), ['ccorp', 'ria', 'scorp']); // agency
  assert.deepStrictEqual(dd.audiencesForRow(ROWS.find(r => r.cusip === '06251FET2')).sort(), ['ccorp', 'scorp']); // CD
  assert.deepStrictEqual(dd.audiencesForRow(ROWS.find(r => r.cusip === '319626AA5')), ['ria']);                  // corp
});

test('audienceEconomics grosses up exempt munis for bank buyers only', () => {
  const bq = ROWS.find(r => r.cusip === '157399BW5'); // YTW 3.80
  const cc = dd.audienceEconomics(bq, 'ccorp'); // 21%
  assert.ok(cc.taxEquivalent && cc.basis === 'TEY');
  assert.ok(approx(cc.effYield, 3.80 / (1 - 0.21))); // ≈ 4.81
  const sc = dd.audienceEconomics(bq, 'scorp'); // 29.6%
  assert.ok(approx(sc.effYield, 3.80 / (1 - 0.296))); // ≈ 5.40
  // Taxable muni is never grossed up.
  const tax = dd.audienceEconomics(ROWS.find(r => r.cusip === '982674NK5'), 'ccorp');
  assert.ok(!tax.taxEquivalent && approx(tax.effYield, 4.10));
});

test('tax-rate override flows into TEY', () => {
  const bq = ROWS.find(r => r.cusip === '157399BW5');
  const cc = dd.audienceEconomics(bq, 'ccorp', { ccorp: 25 });
  assert.ok(approx(cc.effYield, 3.80 / (1 - 0.25)));
  assert.strictEqual(cc.taxRatePct, 25);
});

test('out-of-band tax-rate override is rejected (no nonsensical TEY)', () => {
  const bq = ROWS.find(r => r.cusip === '157399BW5'); // YTW 3.80
  // 100% would make teYield blow up to ~380% if uncaught — must fall back to default 21%.
  const hi = dd.audienceEconomics(bq, 'ccorp', { ccorp: 100 });
  assert.strictEqual(hi.taxRatePct, 21);
  assert.ok(approx(hi.effYield, 3.80 / (1 - 0.21)));
  assert.ok(hi.effYield < 10, 'effective yield must stay sane');
  // Negative override also falls back to the desk default.
  const neg = dd.audienceEconomics(bq, 'scorp', { scorp: -5 });
  assert.strictEqual(neg.taxRatePct, 29.6);
});

test('buildCandidateSet screens floor + no-yield and segments by audience', () => {
  const set = dd.buildCandidateSet(ROWS);
  // 8 rows: drop the null-yield muni and the $100K sub-floor agency → 6 screened.
  assert.strictEqual(set.screened, 6);
  assert.strictEqual(set.droppedBelowFloor, 1);
  // Every featured candidate is ≥ floor or unknown size.
  for (const c of set.candidates) {
    assert.ok(c.availabilityK == null || c.availabilityK >= 250);
    assert.ok(!set.candidates.some(x => x === c && x.cusip === '3130SMALL1'));
  }
  assert.ok(!set.candidates.find(c => c.cusip === '3130SMALL1'));
  assert.ok(!set.candidates.find(c => c.cusip === '999999ZZ9'));
});

test('per-audience lists sort by the yield that audience earns (TEY for banks)', () => {
  const set = dd.buildCandidateSet(ROWS);
  // ccorp sees grossed-up BQ/std munis; the BQ muni (TEY ≈ 4.81) and taxable
  // muni (4.10) and agency (3.90) and CD (4.05) and std muni (TEY≈3.86).
  const cc = set.byAudience.ccorp.map(c => c.cusip);
  assert.ok(cc.includes('157399BW5'));
  // sorted desc by effYield
  const effs = set.byAudience.ccorp.map(c => c.econ.ccorp.effYield);
  for (let i = 1; i < effs.length; i++) assert.ok(effs[i - 1] >= effs[i]);
  // ria list excludes bank-only CDs and exempt munis, includes the corp.
  const ria = set.byAudience.ria.map(c => c.cusip);
  assert.ok(ria.includes('319626AA5'));
  assert.ok(!ria.includes('06251FET2'));
  assert.ok(!ria.includes('157399BW5'));
});

test('coverage flags thin audiences against the ≥3 target', () => {
  const set = dd.buildCandidateSet(ROWS);
  assert.strictEqual(set.coverage.ria, set.byAudience.ria.length);
  // With this tiny fixture ria has < 3, so coverageOk is false — the signal the
  // route uses to widen the candidate pool or note thin coverage.
  assert.strictEqual(set.coverageOk, set.coverage.ccorp >= 3 && set.coverage.scorp >= 3 && set.coverage.ria >= 3);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`daily-dashboard tests: ${passed} passed.`);
})();
