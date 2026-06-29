// Tests for server/daily-dashboard-judgment.js — the Phase 2 grounded Claude
// judgment layer. Injected createMessage (no network), temp marketDir. Asserts
// the trust boundary: every CUSIP grounded, OUR numbers re-attached, hallucina-
// tions/wrong-audience dropped, deterministic backfill keeps the page complete,
// and a model failure degrades instead of throwing.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ddj = require('../server/daily-dashboard-judgment');
const dd = require('../server/daily-dashboard');
const rvEngine = require('../server/daily-dashboard-rv');

// Minimal par curve for the RV grounding-set tests (tenor label → percent).
const CURVE_FIXTURE = { asOfDate: '2026-06-20', tenors: { '3M': 4.35, '6M': 4.25, '1Y': 4.00, '2Y': 3.80, '3Y': 3.75, '5Y': 3.85, '7Y': 4.00, '10Y': 4.20, '30Y': 4.55 } };

// A realistic mixed package: exempt+taxable munis (some BQ), agencies incl. ONE
// oversized block (for the BOTD-exclusion test), CDs, corporates, structured.
// Tuned so every audience pool is >= 3.
function makeRows() {
  return [
    // exempt BQ munis (ccorp/scorp)
    { assetClass: 'Muni', cusip: '111111AA1', description: 'BQ Muni A', sector: 'BQ', state: 'MO', coupon: 5.0, yield: 3.90, price: 104.0, maturity: '2040-03-01', callDate: '2031-03-01', availabilityK: 300 },
    { assetClass: 'Muni', cusip: '111111BB2', description: 'BQ Muni B', sector: 'BQ', state: 'IA', coupon: 4.0, yield: 3.40, price: 98.5, maturity: '2035-06-01', callDate: null, availabilityK: 500 },
    { assetClass: 'Muni', cusip: '111111CC3', description: 'Std Muni C', sector: 'Municipals', state: 'NE', coupon: 4.0, yield: 3.10, price: 103.0, maturity: '2034-12-15', callDate: '2032-12-15', availabilityK: 350 },
    { assetClass: 'Muni', cusip: '111111DD4', description: 'Std Muni D', sector: 'Municipals', state: 'KS', coupon: 3.5, yield: 3.00, price: 99.0, maturity: '2033-09-01', callDate: null, availabilityK: 250 },
    // taxable muni (ccorp/ria)
    { assetClass: 'Muni', cusip: '111111EE5', description: 'Taxable Muni E', sector: 'Taxable', state: 'KS', coupon: 4.5, yield: 4.30, price: 99.5, maturity: '2030-09-01', callDate: null, availabilityK: 1040 },
    // agencies (all 3 audiences); one OVERSIZED block for BOTD exclusion
    { assetClass: 'Agency', cusip: '222222AA1', description: 'FHLB Callable', sector: 'Callable', coupon: 5.0, yield: 5.10, ytm: 5.10, ytnc: 4.80, price: 99.9, maturity: '2032-05-19', callDate: '2027-05-19', availabilityK: 4000 },
    { assetClass: 'Agency', cusip: '222222BB2', description: 'FFCB Bullet HUGE', sector: 'Bullet', coupon: 1.9, yield: 5.05, ytm: 5.05, ytnc: null, price: 87.0, maturity: '2031-04-19', callDate: null, availabilityK: 31000 }, // biggest block + deep disc
    { assetClass: 'Agency', cusip: '222222CC3', description: 'FHLMC Bullet', sector: 'Bullet', coupon: 1.6, yield: 4.95, ytm: 4.95, ytnc: null, price: 86.0, maturity: '2032-05-19', callDate: null, availabilityK: 1000 }, // deep disc
    // CDs (ccorp/scorp), no size
    { assetClass: 'CD Offering', cusip: '333333AA1', description: 'Bank A CD 12m', sector: 'CD', state: 'NY', coupon: null, yield: 4.05, price: null, maturity: '2027-06-16', callDate: null, availabilityK: null },
    { assetClass: 'CD Offering', cusip: '333333BB2', description: 'Bank B CD 6m', sector: 'CD', state: 'CA', coupon: null, yield: 3.95, price: null, maturity: '2026-12-16', callDate: null, availabilityK: null },
    // corporates (ria)
    { assetClass: 'Corporate', cusip: '444444AA1', description: 'BancShares 10y', sector: 'Financial', coupon: 5.6, yield: 6.06, ytm: 6.06, ytnc: null, price: 96.0, maturity: '2035-02-01', callDate: null, availabilityK: 1500 },
    { assetClass: 'Corporate', cusip: '444444BB2', description: 'MoneyCenter 10y', sector: 'Financial', coupon: 6.0, yield: 5.80, ytm: 5.80, ytnc: null, price: 101.0, maturity: '2036-01-01', callDate: null, availabilityK: 2000 },
    // structured notes (ria)
    { assetClass: 'Structured Note', cusip: '555555AA1', description: 'JPM 20Y/2Y', sector: 'Callable Fixed', coupon: 6.0, yield: 6.0, price: 99.85, maturity: '2046-06-11', callDate: '2028-06-11', availabilityK: null },
    { assetClass: 'Structured Note', cusip: '555555BB2', description: 'GS 12Y bullet', sector: 'Fixed', coupon: 5.25, yield: 5.25, price: 99.5, maturity: '2038-06-11', callDate: null, availabilityK: null },
  ];
}

const META = { date: '2026-06-22' };
const MACRO = {
  packageDate: '2026-06-22',
  treasuries: [{ label: '10Y', tenor: '10y', yield: 4.21, dailyChange: 0.03 }, { label: '2Y', tenor: '2y', yield: 3.90 }], // dailyChange is %-points (0.03 = 3bp)
  marketRates: [], bondIndices: [], headlines: ['Risk-on into the weekend'], releases: [], salesCues: [],
  offerings: { total: 14 },
};

// A well-formed model reply over makeRows() CUSIPs.
function goodReply() {
  return JSON.stringify({
    picks: {
      ccorp: [
        { cusip: '111111AA1', headline: 'BQ muni top TEY', rationale: 'Highest C-Corp TEY on the run.' },
        { cusip: '222222AA1', headline: 'FHLB callable carry', rationale: 'Near-par agency income.' },
        { cusip: '333333AA1', headline: 'FDIC CD', rationale: 'Clean front-end pickup.' },
      ],
      scorp: [
        { cusip: '111111AA1', headline: 'BQ muni top TEY', rationale: 'Best S-Corp gross-up today.' },
        { cusip: '111111CC3', headline: 'Std muni intermediate', rationale: 'AAA tax-exempt ladder.' },
        { cusip: '333333AA1', headline: 'FDIC CD', rationale: 'Front-end carry.' },
      ],
      ria: [
        { cusip: '444444AA1', headline: 'Bank credit', rationale: 'Highest taxable carry.' },
        { cusip: '555555AA1', headline: 'Structured note', rationale: 'High fixed coupon.' },
        { cusip: '222222BB2', headline: 'Deep-disc agency', rationale: 'Effective bullet at a discount.' },
      ],
    },
    connector: {
      ccorp: 'Rates steady -> C-Corp banks add BQ TEY before the belly flattens.',
      scorp: 'Rates steady -> S-Corp banks capture the richest gross-up today.',
      ria: 'Rates steady -> RIAs reach for taxable bank-credit carry.',
    },
    botd: { cusip: '111111AA1', headline: 'BQ muni bond of the day', rationale: 'Top bank-qualified TEY with premium callable structure.' },
    sod: { title: 'Deep-discount agencies as effective bullets', narrative: 'Sub-market coupons priced below par. Discount accretes to par.', cusips: ['222222BB2', '222222CC3'] },
  });
}

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-ddj-')); }
function fakeMsg(text) { return async () => ({ text, model: 'fake-model', usage: null }); }

// ---------- pure helpers ----------

test('compactCandidate keeps cusip/cls/eff, pre-computes deep, drops undefined', () => {
  const set = dd.buildCandidateSet(makeRows());
  const c = set.candidates.find(x => x.cusip === '222222BB2'); // price 87 → deep
  const cc = ddj.compactCandidate(c);
  assert.strictEqual(cc.cusip, '222222BB2');
  assert.strictEqual(cc.deep, true);
  assert.ok(cc.eff && typeof cc.eff === 'object');
  assert.ok('price' in cc); // always present
  assert.ok(!('callDate' in cc)); // undefined dropped (renamed to call)
});

test('compactCandidate prefers net TEY when RV supplied it', () => {
  const set = dd.buildCandidateSet(makeRows());
  const c = { ...set.candidates.find(x => x.cusip === '111111AA1') };
  c.rv = { netTey: { ccorp: 4.73 }, tradeFit: { ccorp: { score: 19, reasons: ['history favored munis'] } } };
  const cc = ddj.compactCandidate(c);
  assert.strictEqual(cc.eff.ccorp.y, 4.73);
  assert.strictEqual(cc.eff.ccorp.b, 'net TEY');
  assert.strictEqual(cc.tradeFit.ccorp.score, 19);
});

test('buildDashboardPrompt embeds rules, macro, byAudience, securities; no econ quad leak', () => {
  const set = dd.buildCandidateSet(makeRows());
  const { system, messages } = ddj.buildDashboardPrompt(set, MACRO, META);
  assert.strictEqual(system, ddj.SYSTEM_PROMPT);
  const u = messages[0].content;
  for (const needle of [' -> ', '3 to 5', 'more than 3', '99.00', 'botd', 'sod', 'tradeFit', 'tie-breaker', 'SECURITIES', 'BY-AUDIENCE', 'MACRO']) {
    assert.ok(u.includes(needle), `prompt missing ${needle}`);
  }
  assert.ok(!u.includes('taxEquivalent'), 'should not leak the full econ quad');
});

test('parseDashboard: bare, fenced, leading-prose, garbage, flat-array bucketing', () => {
  const obj = { picks: { ccorp: [{ cusip: 'X' }], scorp: [], ria: [] }, connector: {}, botd: null, sod: null };
  assert.deepStrictEqual(ddj.parseDashboard(JSON.stringify(obj)).picks.ccorp[0].cusip, 'X');
  assert.strictEqual(ddj.parseDashboard('```json\n' + JSON.stringify(obj) + '\n```').picks.ccorp.length, 1);
  assert.strictEqual(ddj.parseDashboard('Here you go:\n' + JSON.stringify(obj)).picks.ccorp.length, 1);
  const garbage = ddj.parseDashboard('not json at all');
  assert.deepStrictEqual(garbage.picks, { ccorp: [], scorp: [], ria: [] });
  const flat = ddj.parseDashboard(JSON.stringify({ picks: [{ cusip: 'Y', audience: 'ria' }] }));
  assert.strictEqual(flat.picks.ria[0].cusip, 'Y');
});

test('parseDashboard salvages a max_tokens-truncated reply', () => {
  // A reply cut off mid-rationale inside the ria array (no closing braces).
  const truncated =
    '{"picks":{"ccorp":[{"cusip":"111111AA1","headline":"BQ muni","rationale":"Top TEY."}],' +
    '"scorp":[{"cusip":"111111CC3","headline":"Std muni","rationale":"AAA ladder."}],' +
    '"ria":[{"cusip":"444444AA1","headline":"Bank credit","rationale":"Highest taxable car';
  const p = ddj.parseDashboard(truncated);
  assert.strictEqual(p.picks.ccorp[0].cusip, '111111AA1'); // complete picks survive
  assert.strictEqual(p.picks.scorp[0].cusip, '111111CC3');
  assert.strictEqual(p.picks.ria[0].cusip, '444444AA1');   // the truncated one is still salvaged
});

// ---------- grounding ----------

test('happy path: CUSIPs valid, OUR numbers re-attached, model numbers ignored', () => {
  const set = dd.buildCandidateSet(makeRows());
  const tampered = JSON.parse(goodReply());
  tampered.picks.ccorp[0].ytw = 99.9;   // model tries to inject a number
  tampered.picks.ccorp[0].price = 1.23;
  const g = ddj.groundDashboard(ddj.parseDashboard(JSON.stringify(tampered)), set, MACRO);
  const first = g.picks.ccorp[0];
  const cand = set.candidates.find(c => c.cusip === first.cusip);
  assert.strictEqual(first.eff.effYield, cand.econ.ccorp.effYield); // OUR number
  assert.ok(!('99.9' === String(first.ytw))); // tampered value not used
  assert.strictEqual(first.ytw, cand.ytw);
  assert.strictEqual(first.price, cand.price);
  assert.strictEqual(g.degraded, false);
  for (const k of ['ccorp', 'scorp', 'ria']) for (const p of g.picks[k]) assert.strictEqual(p.source, 'model');
});

test('model prose with numbers is replaced by deterministic grounded prose', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = JSON.parse(goodReply());
  reply.picks.ccorp[0].headline = 'Fake 9 percent winner';
  reply.picks.ccorp[0].rationale = 'Invented +999bp pickup.';
  reply.picks.ccorp[0].talkingPoint = 'Tell them it yields 12.34%.';
  reply.connector.ccorp = 'Fake 9.99% macro -> invented 88bp pickup.';
  reply.sod = { title: 'Fake 2x barbell', narrative: 'Use 99bp because Claude said so.', cusips: ['222222BB2', '222222CC3'] };

  const g = ddj.groundDashboard(reply, set, MACRO);
  const first = g.picks.ccorp[0];
  assert.strictEqual(first.headline, '');
  assert.ok(!first.rationale.includes('999'));
  assert.ok(!first.talkingPoint.includes('12.34'));
  assert.notStrictEqual(g.connector.ccorp, 'Fake 9.99% macro -> invented 88bp pickup.');
  assert.strictEqual(g.sod.source, 'backfill');
  assert.ok(!g.sod.narrative.includes('99bp'));
  assert.ok(g.flags.includes('model-prose-number-dropped'));
  assert.strictEqual(g.degraded, true);
});

test('model prose keeps harmless date/tenor words but drops quantified market claims', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = JSON.parse(goodReply());
  reply.picks.ccorp[0].headline = 'Five-year ladder fit';
  reply.picks.ccorp[0].rationale = 'Works for a 2026 planning conversation.';
  reply.picks.ccorp[0].talkingPoint = 'Use this for five-year ladder structure.';

  const g = ddj.groundDashboard(reply, set, MACRO);
  const first = g.picks.ccorp[0];
  assert.strictEqual(first.headline, 'Five-year ladder fit');
  assert.strictEqual(first.rationale, 'Works for a 2026 planning conversation.');
  assert.strictEqual(first.talkingPoint, 'Use this for five-year ladder structure.');
});

test('hallucinated CUSIP dropped + backfilled to >=3', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = {
    picks: {
      ccorp: [{ cusip: '111111AA1' }, { cusip: 'ZZZZZZ999' }, { cusip: 'QQQQQQ000' }],
      scorp: [{ cusip: '111111AA1' }, { cusip: '111111CC3' }, { cusip: '333333AA1' }],
      ria: [{ cusip: '444444AA1' }, { cusip: '555555AA1' }, { cusip: '222222BB2' }],
    },
    connector: {}, botd: null, sod: { cusips: ['ZZZZZZ999'] },
  };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.flags.includes('dropped-unknown-cusip'));
  assert.ok(g.picks.ccorp.length >= 3);
  assert.ok(g.picks.ccorp.every(p => set.candidates.find(c => c.cusip === p.cusip)));
  assert.ok(g.degraded);
});

test('wrong-audience CUSIP dropped (corporate under scorp), still allowed under ria', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = {
    picks: {
      ccorp: [{ cusip: '111111AA1' }, { cusip: '222222AA1' }, { cusip: '333333AA1' }],
      scorp: [{ cusip: '444444AA1' }, { cusip: '111111CC3' }, { cusip: '333333AA1' }], // corp not eligible for scorp
      ria: [{ cusip: '444444AA1' }, { cusip: '555555AA1' }, { cusip: '222222BB2' }],
    },
    connector: {}, botd: null, sod: null,
  };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.flags.includes('dropped-audience-ineligible'));
  assert.ok(!g.picks.scorp.find(p => p.cusip === '444444AA1' && p.source === 'model'));
  assert.ok(g.picks.ria.find(p => p.cusip === '444444AA1')); // fine for ria
});

test('per-class cap: no audience keeps >3 of one class', () => {
  const set = dd.buildCandidateSet(makeRows());
  // four agencies for ria (only 3 exist; add munis won't help) — use the agency-heavy set
  const reply = {
    picks: {
      ccorp: [{ cusip: '222222AA1' }, { cusip: '222222BB2' }, { cusip: '222222CC3' }, { cusip: '111111AA1' }, { cusip: '111111BB2' }],
      scorp: [{ cusip: '111111AA1' }, { cusip: '111111CC3' }, { cusip: '333333AA1' }],
      ria: [{ cusip: '444444AA1' }, { cusip: '555555AA1' }, { cusip: '222222BB2' }],
    },
    connector: {}, botd: null, sod: null,
  };
  const g = ddj.groundDashboard(reply, set, MACRO);
  for (const k of ['ccorp', 'scorp', 'ria']) {
    const byClass = {};
    for (const p of g.picks[k]) byClass[p.assetClass] = (byClass[p.assetClass] || 0) + 1;
    for (const cls in byClass) assert.ok(byClass[cls] <= 3, `${k} has >3 ${cls}`);
  }
});

test('backfill to MIN with composed rationale + source=backfill', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = { picks: { ccorp: [{ cusip: '111111AA1' }], scorp: [], ria: [] }, connector: {}, botd: null, sod: null };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.strictEqual(g.picks.ccorp.length, 3);
  const added = g.picks.ccorp.filter(p => p.source === 'backfill');
  assert.ok(added.length >= 2);
  for (const p of added) assert.ok(p.rationale && p.rationale.length > 0);
  assert.ok(g.degraded);
});

test('picks SPAN THE MATURITY CURVE when the RV grounding set carries bands', () => {
  // The whole fix: with band-aware candidates, the deterministic picks must cover
  // multiple maturity bands (incl. the short end) instead of clustering long.
  const candidateSet = dd.buildCandidateSet(makeRows(), { asOf: '2026-06-22' });
  const rvAnalysis = rvEngine.buildRelativeValue({ candidateSet, curve: CURVE_FIXTURE, asOf: '2026-06-22' });
  const groundingSet = ddj.buildGroundingSet(candidateSet, rvAnalysis);
  const g = ddj.groundDashboard({}, groundingSet, MACRO); // no model reply → deterministic curve-spanning picks

  for (const k of ['ccorp', 'scorp', 'ria']) {
    const bands = new Set(g.picks[k].map(p => p.rv && p.rv.bucket).filter(Boolean));
    assert.ok(g.picks[k].length >= 3, `${k} has at least the floor of picks`);
    assert.ok(bands.size >= 3, `${k} picks should span >=3 maturity bands, got ${[...bands]}`);
  }
  // ccorp (banks) buy across the curve — a short-end idea must be present, not just long.
  const ccorpBands = new Set(g.picks.ccorp.map(p => p.rv && p.rv.bucket));
  assert.ok([...ccorpBands].some(b => b === '0-1y' || b === '1-3y'), 'ccorp picks must include a short-end idea');
  assert.ok([...ccorpBands].some(b => b === '5-7y' || b === '7-10y' || b === '10y+'), 'ccorp picks must include a belly/long idea');
  // Curve breadth above the floor is intentional, NOT a degradation.
  assert.ok(!g.flags.includes('coverage-short'));
});

test('curve-coverage backfill above the floor does not mark the read degraded', () => {
  const candidateSet = dd.buildCandidateSet(makeRows(), { asOf: '2026-06-22' });
  const rvAnalysis = rvEngine.buildRelativeValue({ candidateSet, curve: CURVE_FIXTURE, asOf: '2026-06-22' });
  const groundingSet = ddj.buildGroundingSet(candidateSet, rvAnalysis);
  // A model reply that already meets the floor for every audience; the engine then
  // tops up for curve breadth. Those top-ups must use 'curve-filled' (not degrading).
  const reply = {
    picks: {
      ccorp: [{ cusip: '111111AA1' }, { cusip: '333333AA1' }, { cusip: '222222AA1' }],
      scorp: [{ cusip: '111111AA1' }, { cusip: '111111CC3' }, { cusip: '333333AA1' }],
      ria: [{ cusip: '444444AA1' }, { cusip: '555555AA1' }, { cusip: '222222BB2' }],
    },
    connector: {
      ccorp: 'Rates steady -> banks add across the curve.',
      scorp: 'Rates steady -> S-corps ladder munis.',
      ria: 'Rates steady -> RIAs reach for carry.',
    },
    botd: { cusip: '111111AA1', headline: 'BOTD', rationale: 'Best value.' },
    sod: { title: 'Theme', narrative: 'A clean curve play.', cusips: ['333333AA1', '222222BB2'] },
  };
  const g = ddj.groundDashboard(reply, groundingSet, MACRO);
  assert.ok(g.flags.includes('curve-filled'), 'curve breadth should be flagged curve-filled');
  assert.ok(!g.flags.includes('backfilled'), 'no below-floor backfill expected');
  assert.strictEqual(g.degraded, false, 'curve breadth is intended, not degraded');
});

test('BOTD valid model pick re-attached + deepDiscount from OUR price', () => {
  const set = dd.buildCandidateSet(makeRows());
  const g = ddj.groundDashboard(ddj.parseDashboard(goodReply()), set, MACRO);
  assert.strictEqual(g.botd.cusip, '111111AA1');
  assert.strictEqual(g.botd.source, 'model');
  assert.strictEqual(g.botd.deepDiscount, false); // 104.0 price
  // a deep one would be true
  const deepCand = set.candidates.find(c => c.cusip === '222222BB2');
  assert.ok(deepCand.price <= 99.0);
});

test('BOTD backfill avoids the biggest agency block, deterministic, >=floor', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = { picks: { ccorp: [{ cusip: '111111AA1' }], scorp: [], ria: [] }, connector: {}, botd: null, sod: null };
  const g1 = ddj.groundDashboard(reply, set, MACRO);
  const g2 = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g1.flags.includes('botd-backfilled'));
  assert.notStrictEqual(g1.botd.cusip, '222222BB2'); // the 31000 block is excluded
  assert.ok(g1.botd.availabilityK == null || g1.botd.availabilityK >= set.floorK);
  assert.strictEqual(g1.botd.cusip, g2.botd.cusip); // deterministic
});

test('BOTD floor defense: model BOTD below floor is rejected', () => {
  const rows = makeRows();
  rows.push({ assetClass: 'Agency', cusip: '666666AA1', description: 'tiny', sector: 'Bullet', coupon: 4, yield: 7.0, ytm: 7.0, ytnc: null, price: 95, maturity: '2030-01-01', callDate: null, availabilityK: 100 });
  const set = dd.buildCandidateSet(rows);
  // 666666AA1 was below floor → not even in candidates; construct a reply citing it
  const reply = { picks: { ccorp: [{ cusip: '111111AA1' }, { cusip: '222222AA1' }, { cusip: '333333AA1' }], scorp: [], ria: [] }, connector: {}, botd: { cusip: '666666AA1' }, sod: null };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.flags.includes('botd-backfilled'));
  assert.notStrictEqual(g.botd.cusip, '666666AA1');
});

test('SoD backfill: deep-discount theme picks only price<=99 agencies', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = { picks: { ccorp: [{ cusip: '111111AA1' }], scorp: [], ria: [] }, connector: {}, botd: null, sod: { title: '', cusips: [] } };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.flags.includes('sod-backfilled'));
  assert.ok(g.sod.securities.length >= 2);
  if (/deep-discount/i.test(g.sod.title)) {
    for (const s of g.sod.securities) assert.ok(s.price != null && s.price <= 99.0);
  }
});

test('connector: missing arrow synthesized; multi-arrow collapsed; unicode normalized', () => {
  const set = dd.buildCandidateSet(makeRows());
  const reply = {
    picks: { ccorp: [{ cusip: '111111AA1' }, { cusip: '222222AA1' }, { cusip: '333333AA1' }], scorp: [{ cusip: '111111AA1' }, { cusip: '111111CC3' }, { cusip: '333333AA1' }], ria: [{ cusip: '444444AA1' }, { cusip: '555555AA1' }, { cusip: '222222BB2' }] },
    connector: { ccorp: 'no arrow here at all', scorp: 'a → b', ria: 'x -> y -> z' },
    botd: null, sod: null,
  };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.flags.includes('connector-synthesized'));
  assert.ok(g.connector.ccorp.includes(' -> '));
  assert.ok(g.connector.ccorp.includes('+3bp'), 'dailyChange 0.03 %-pts → +3bp, not +0.03bp'); // unit fix
  assert.ok(g.connector.scorp.includes(' -> ')); // unicode normalized
  assert.strictEqual((g.connector.ria.match(/ -> /g) || []).length, 1); // collapsed to one
});

test('length caps + non-string coercion', () => {
  const set = dd.buildCandidateSet(makeRows());
  const long = 'x'.repeat(500);
  const reply = {
    picks: { ccorp: [{ cusip: '111111AA1', headline: 42, rationale: long }], scorp: [], ria: [] },
    connector: { ccorp: long + ' -> ' + long }, botd: { cusip: '111111BB2', rationale: long }, sod: { title: long, narrative: long, cusips: ['222222BB2', '222222CC3'] },
  };
  const g = ddj.groundDashboard(reply, set, MACRO);
  assert.ok(g.picks.ccorp[0].rationale.length <= 160);
  assert.ok(g.connector.ccorp.length <= 240);
  assert.ok(g.botd.rationale.length <= 400);
  assert.ok(g.sod.title.length <= 80);
  assert.ok(g.sod.narrative.length <= 500);
});

// ---------- generateDashboard (cache + degraded) ----------

test('generateDashboard happy: writes cache, cached:false, model set', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async () => { calls++; return { text: goodReply(), model: 'fake-model', usage: null }; };
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: { asOfDate: '2026-06-22' }, meta: META, createMessageImpl, force: true });
  assert.strictEqual(calls, 1);
  assert.strictEqual(rec.cached, false);
  assert.strictEqual(rec.model, 'fake-model');
  assert.ok(fs.existsSync(path.join(dir, 'daily-dashboard.json')));
  assert.ok(rec.picks.ccorp.length >= 3 && rec.picks.scorp.length >= 3 && rec.picks.ria.length >= 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateDashboard noCache returns a read without replacing the daily cache', async () => {
  const dir = tmpDir();
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: fakeMsg(goodReply()), force: true, noCache: true });
  assert.strictEqual(rec.cached, false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'daily-dashboard.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateDashboard cache hit: no billable call', async () => {
  const dir = tmpDir();
  await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: fakeMsg(goodReply()), force: true });
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: async () => { throw new Error('should not be called'); } });
  assert.strictEqual(rec.cached, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateDashboard force bypasses same-date cache', async () => {
  const dir = tmpDir();
  await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: fakeMsg(goodReply()), force: true });
  let calls = 0;
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: async () => { calls++; return { text: goodReply(), model: 'm2', usage: null }; }, force: true });
  assert.strictEqual(calls, 1);
  assert.strictEqual(rec.cached, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('package-date roll regenerates', async () => {
  const dir = tmpDir();
  await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: { date: '2026-06-21' }, createMessageImpl: fakeMsg(goodReply()), force: true });
  let calls = 0;
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: { date: '2026-06-22' }, createMessageImpl: async () => { calls++; return { text: goodReply(), model: 'm', usage: null }; } });
  assert.strictEqual(calls, 1);
  assert.strictEqual(rec.cached, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DEGRADED: model throws → resolves with deterministic dashboard, modelError set', async () => {
  const dir = tmpDir();
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: async () => { throw new Error('api down'); }, force: true });
  assert.strictEqual(rec.model, null);
  assert.ok(rec.modelError && /api down/.test(rec.modelError));
  assert.strictEqual(rec.degraded, true);
  assert.ok(rec.picks.ccorp.length >= 3 && rec.picks.scorp.length >= 3 && rec.picks.ria.length >= 3);
  assert.ok(rec.botd && rec.sod && rec.connector.ccorp.includes(' -> '));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DEGRADED: junk reply → deterministic dashboard, modelError null', async () => {
  const dir = tmpDir();
  const rec = await ddj.generateDashboard({ marketDir: dir, rows: makeRows(), econ: {}, meta: META, createMessageImpl: fakeMsg('not json'), force: true });
  assert.strictEqual(rec.modelError, null);
  assert.strictEqual(rec.degraded, true);
  assert.ok(rec.picks.ria.length >= 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('HARD FAIL: zero candidates throws', async () => {
  const dir = tmpDir();
  await assert.rejects(
    () => ddj.generateDashboard({ marketDir: dir, rows: [], econ: {}, meta: META, createMessageImpl: fakeMsg(goodReply()), force: true }),
    /No audience-eligible offerings/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getCachedDashboard shape guard rejects partial cache', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'daily-dashboard.json'), JSON.stringify({ picks: {} })); // no connector
  assert.strictEqual(ddj.getCachedDashboard(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- review-fix regressions ----------

test('eligibility gate uses true aud tagging, not the truncated byAudience top-N', () => {
  // 30 ccorp/scorp CDs crowd the agency out of byAudience.ccorp's top-N, but the
  // agency is genuinely ccorp-eligible (aud tagging) and present in the flat set
  // (via ria). A model ccorp pick of it must SURVIVE, not be dropped as ineligible.
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ assetClass: 'CD Offering', cusip: `CD000${String(i).padStart(2, '0')}A`, description: `CD ${i}`, sector: 'CD', state: 'NY', coupon: null, yield: 5.5 - i * 0.05, price: null, maturity: '2027-06-16', callDate: null, availabilityK: null });
  }
  rows.push({ assetClass: 'Agency', cusip: '222222ZZ9', description: 'FHLB low-yield', sector: 'Bullet', coupon: 4.0, yield: 4.0, ytm: 4.0, ytnc: null, price: 99.5, maturity: '2030-01-01', callDate: null, availabilityK: 1000 });
  const set = dd.buildCandidateSet(rows);
  assert.ok(!set.byAudience.ccorp.find(c => c.cusip === '222222ZZ9'), 'agency should be crowded out of ccorp top-N');
  assert.ok(set.candidates.find(c => c.cusip === '222222ZZ9'), 'agency still in flat set via ria');
  const reply = { picks: { ccorp: [{ cusip: '222222ZZ9', headline: 'agency', rationale: 'eligible by tagging' }], scorp: [], ria: [] }, connector: {}, botd: null, sod: null };
  const g = ddj.groundDashboard(reply, set, MACRO);
  const survived = g.picks.ccorp.find(p => p.cusip === '222222ZZ9');
  assert.ok(survived && survived.source === 'model', 'aud-eligible agency must survive a ccorp pick');
  assert.ok(!g.flags.includes('dropped-audience-ineligible'), 'must not falsely flag a tagged-eligible pick');
});

test('parseDashboard recovers valid JSON followed by trailing prose with a brace', () => {
  const text = '{"picks":{"ccorp":[{"cusip":"AAA"}],"scorp":[],"ria":[]},"connector":{},"botd":null,"sod":null}\n\nNote: rates {may} move.';
  const p = ddj.parseDashboard(text);
  assert.strictEqual(p.picks.ccorp[0].cusip, 'AAA'); // not discarded by the trailing brace
});

test('closeTruncatedJson: dangling backslash truncation still salvages complete picks', () => {
  const text = '{"picks":{"ccorp":[{"cusip":"AAA","rationale":"done"}],"scorp":[{"cusip":"BBB","rationale":"Yield up 30\\';
  const p = ddj.parseDashboard(text);
  assert.strictEqual(p.picks.ccorp[0].cusip, 'AAA'); // complete pick survives the open escape
});

test('closeTruncatedJson: truncated string array keeps its last complete element', () => {
  const text = '{"picks":{"ccorp":[],"scorp":[],"ria":[]},"connector":{},"botd":null,"sod":{"title":"T","narrative":"n","cusips":["222222BB2","222222CC3"';
  const p = ddj.parseDashboard(text);
  assert.deepStrictEqual(p.sod.cusips, ['222222BB2', '222222CC3']); // CC3 not silently dropped
});

test('BOTD backfill: an unknown-size agency is excludable, not silently anointed', () => {
  // Agency-only pool: a null-size block + a known smaller block. The deterministic
  // BOTD must not crown the unpublished-size block just because its size is hidden.
  const rows = [
    { assetClass: 'Agency', cusip: 'AGNULL001', description: 'unknown-size FHLB', sector: 'Bullet', coupon: 5, yield: 5.5, ytm: 5.5, ytnc: null, price: 99.9, maturity: '2032-01-01', callDate: null, availabilityK: null },
    { assetClass: 'Agency', cusip: 'AGKNOWN02', description: 'known-size FHLB', sector: 'Bullet', coupon: 4.5, yield: 5.0, ytm: 5.0, ytnc: null, price: 99.0, maturity: '2031-01-01', callDate: null, availabilityK: 500 },
    { assetClass: 'Agency', cusip: 'AGKNOWN03', description: 'known-size FHLB 2', sector: 'Bullet', coupon: 4.5, yield: 4.9, ytm: 4.9, ytnc: null, price: 99.0, maturity: '2031-06-01', callDate: null, availabilityK: 600 },
  ];
  const set = dd.buildCandidateSet(rows);
  const botd = ddj.pickBotdDeterministic(set, set.floorK);
  assert.notStrictEqual(botd.cusip, 'AGNULL001', 'unknown-size block must be the excluded one');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`daily-dashboard-judgment tests: ${passed} passed.`);
})();
