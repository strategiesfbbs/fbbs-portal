// Tests for server/bank-signals.js — the pure Signal Inbox engine. Plain node,
// no framework, fixture-driven (synthetic inputs only — never touches sqlite/fs).
'use strict';

const assert = require('assert');
const sig = require('../server/bank-signals');

const TODAY = '2026-06-24';
const PKG = '2026-06-23';

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Find a single category's signals array from the response.
function cat(resp, category) {
  const c = resp.categories.find(x => x.category === category);
  return c ? c.signals : [];
}
function byKey(resp, signalKey) {
  return resp.categories.flatMap(c => c.signals).filter(s => s.signalKey === signalKey);
}

// ---------------------------------------------------------------------------
// coverage-cold-owned
// ---------------------------------------------------------------------------
test('coverage-cold-owned: only owned Client/Prospect banks past coldDays, oldest-first, missing-touch first', () => {
  const inputs = {
    rep: { username: 'asmith', displayName: 'A Smith' },
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [
      { bankId: 'b1', displayName: 'Cold Client', city: 'X', state: 'IA', owner: 'asmith', status: 'Client', priority: 'High' },
      { bankId: 'b2', displayName: 'Warm Prospect', city: 'Y', state: 'MO', owner: 'asmith', status: 'Prospect' },
      { bankId: 'b3', displayName: 'Never Touched', city: 'Z', state: 'NE', owner: 'asmith', status: 'Prospect' },
      { bankId: 'b4', displayName: 'Open Bank', city: 'Q', state: 'KS', owner: 'asmith', status: 'Open' }, // not Client/Prospect
    ],
    lastTouchByBank: {
      b1: '2026-05-01', // ~54 days → cold
      b2: '2026-06-20', // 4 days → warm
      // b3 has no touch
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = cat(resp, 'Coverage').filter(s => s.signalKey === 'coverage-cold-owned');
  const ids = rows.map(r => r.bankId);
  assert.ok(ids.includes('b1'), 'cold client surfaces');
  assert.ok(ids.includes('b3'), 'never-touched surfaces');
  assert.ok(!ids.includes('b2'), 'warm prospect excluded');
  assert.ok(!ids.includes('b4'), 'Open status excluded');
  // missing-touch sorts before any dated touch (oldest-first); within Coverage
  // category, b3 (never) should precede b1 (dated) given equal/higher severity.
  const i3 = ids.indexOf('b3');
  const i1 = ids.indexOf('b1');
  assert.ok(i3 < i1, 'never-touched ranks above a dated cold touch');
  // dismissId format
  const r1 = rows.find(r => r.bankId === 'b1');
  assert.strictEqual(r1.dismissId, `coverage-cold-owned:b1:${TODAY}`, 'CRM signal dismissId uses today');
});

// ---------------------------------------------------------------------------
// coverage-prospect-overdue-task
// ---------------------------------------------------------------------------
test('coverage-prospect-overdue-task: only Prospect banks with a past-due task, most-overdue-first', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    overdueTasks: [
      { bankId: 'b1', title: 'Send proposal', dueDate: '2026-06-01', priority: 'High' }, // 23d overdue, prospect
      { bankId: 'b2', title: 'Call back', dueDate: '2026-06-20', priority: 'Normal' },    // 4d overdue, prospect
      { bankId: 'b3', title: 'Old client task', dueDate: '2026-06-10', priority: 'Normal' }, // client → excluded
      { bankId: 'b4', title: 'Future', dueDate: '2026-07-01', priority: 'Normal' },        // not overdue
    ],
    coverageByBank: {
      b1: { status: 'Prospect', owner: 'asmith', displayName: 'Prospect One', city: 'A', state: 'IA' },
      b2: { status: 'Prospect', owner: 'asmith', displayName: 'Prospect Two', city: 'B', state: 'MO' },
      b3: { status: 'Client', owner: 'asmith', displayName: 'Client Three' },
      b4: { status: 'Prospect', owner: 'asmith', displayName: 'Prospect Four' },
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'coverage-prospect-overdue-task');
  const ids = rows.map(r => r.bankId);
  assert.deepStrictEqual(ids, ['b1', 'b2'], 'only overdue prospects, most-overdue-first');
  assert.ok(rows[0].detail.includes('2026-06-01'), 'dueDate carried into detail');
  assert.strictEqual(rows[0].metric.value, 23, 'days overdue computed');
});

// ---------------------------------------------------------------------------
// coverage-large-no-owner  (firm-set)
// ---------------------------------------------------------------------------
test('coverage-large-no-owner: unowned banks above floor, totalAssets-desc, firm-set', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    thresholds: { assetFloorK: 500000 },
    mapBanks: [
      { id: 'm1', displayName: 'Big Unowned', city: 'A', state: 'IA', totalAssets: 2000000, certNumber: '111' },
      { id: 'm2', displayName: 'Bigger Unowned', city: 'B', state: 'MO', totalAssets: 3000000, certNumber: '222' },
      { id: 'm3', displayName: 'Owned Big', city: 'C', state: 'NE', totalAssets: 9000000, certNumber: '333' },
      { id: 'm4', displayName: 'Small Unowned', city: 'D', state: 'KS', totalAssets: 100000, certNumber: '444' },
    ],
    coverageByBank: { m3: { owner: 'someone', status: 'Client' } },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'coverage-large-no-owner');
  const ids = rows.map(r => r.bankId);
  assert.deepStrictEqual(ids, ['m2', 'm1'], 'unowned above floor, largest first; owned + small excluded');
  assert.strictEqual(rows[0].owner, '', 'no-owner rows carry blank owner');
});

// ---------------------------------------------------------------------------
// funding-pressure
// ---------------------------------------------------------------------------
test('funding-pressure: owned banks with score >= floor, score-desc, recommendation in detail', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    thresholds: { fundingScoreFloor: 9 },
    savedBanks: [
      { bankId: 'b1', displayName: 'High Pressure', owner: 'asmith', status: 'Client', city: 'A', state: 'IA' },
      { bankId: 'b2', displayName: 'Med Pressure', owner: 'asmith', status: 'Prospect', city: 'B', state: 'MO' },
      { bankId: 'b3', displayName: 'Low Pressure', owner: 'asmith', status: 'Client', city: 'C', state: 'NE' },
    ],
    fundingScoreByBank: {
      b1: { score: 13, recommendation: 'Likely candidate', need: 'structural' },
      b2: { score: 9, recommendation: 'Possible candidate', need: 'urgent' },
      b3: { score: 4, recommendation: 'Not priority', need: 'light' },
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'funding-pressure');
  assert.deepStrictEqual(rows.map(r => r.bankId), ['b1', 'b2'], 'score >= floor, score-desc');
  assert.ok(rows[0].detail.includes('Likely candidate'), 'recommendation in detail');
});

// ---------------------------------------------------------------------------
// funding-cd-rolling
// ---------------------------------------------------------------------------
test('funding-cd-rolling: CDs within window, soonest-maturity first, count + nearest CUSIP', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    thresholds: { rolloverWindowDays: 180 },
    savedBanks: [
      { bankId: 'b1', displayName: 'Issuer One', owner: 'asmith', status: 'Client', city: 'A', state: 'IA' },
      { bankId: 'b2', displayName: 'Issuer Two', owner: 'asmith', status: 'Client', city: 'B', state: 'MO' },
      { bankId: 'b3', displayName: 'No CDs', owner: 'asmith', status: 'Client' },
    ],
    cdRolloverByBank: {
      b1: [
        { cusip: 'CUS111', maturity: '2026-09-01', daysOut: 69, rate: 4.5, term: '12m' },
        { cusip: 'CUS112', maturity: '2026-08-01', daysOut: 38, rate: 4.4, term: '9m' },
      ],
      b2: [
        { cusip: 'CUS221', maturity: '2026-12-01', daysOut: 160, rate: 4.0, term: '18m' },
        { cusip: 'CUS222', maturity: '2027-09-01', daysOut: 434, rate: 4.0, term: '36m' }, // out of window
      ],
      b3: [],
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'funding-cd-rolling');
  const ids = rows.map(r => r.bankId);
  assert.ok(ids.includes('b1') && ids.includes('b2'), 'both issuers with in-window CDs');
  assert.ok(!ids.includes('b3'), 'empty CD list = no row');
  const b1 = rows.find(r => r.bankId === 'b1');
  assert.strictEqual(b1.metric.value, 2, 'count of in-window CDs');
  assert.ok(b1.detail.includes('CUS112'), 'nearest (soonest) CUSIP in detail');
  assert.ok(b1.extra.nearestMaturity === '2026-08-01', 'nearest maturity is the soonest');
});

// ---------------------------------------------------------------------------
// securities-offering-fit
// ---------------------------------------------------------------------------
test('securities-offering-fit: best class gates fitMin, pick re-attached, inState muni flagged, class-score-desc', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    thresholds: { fitMinScore: 5 },
    savedBanks: [
      { bankId: 'b1', displayName: 'Muni Buyer', owner: 'asmith', status: 'Client', city: 'A', state: 'IA' },
      { bankId: 'b2', displayName: 'Weak Fit', owner: 'asmith', status: 'Prospect', city: 'B', state: 'MO' },
      { bankId: 'b3', displayName: 'No Fits', owner: 'asmith', status: 'Client' },
    ],
    fitsByBank: {
      b1: { classes: [
        { type: 'muni', label: 'Muni', score: 24, picks: [{ cusip: 'MUNI001', description: 'IA SD', yield: 3.8, maturity: '2034-03-01', state: 'IA', sector: 'BQ', inState: true }] },
        { type: 'agency', label: 'Agency', score: 8, picks: [{ cusip: 'AG001', yield: 5.0, maturity: '2030-01-01' }] },
      ] },
      b2: { classes: [
        { type: 'agency', label: 'Agency', score: 4, picks: [{ cusip: 'AG002', yield: 5.0 }] }, // below fitMin
      ] },
      b3: { classes: [] },
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'securities-offering-fit');
  const ids = rows.map(r => r.bankId);
  assert.deepStrictEqual(ids, ['b1'], 'only banks with a class clearing fitMin');
  assert.strictEqual(rows[0].extra.pick.cusip, 'MUNI001', 'best pick CUSIP re-attached');
  assert.strictEqual(rows[0].extra.pick.yield, 3.8, 'pick yield re-attached');
  assert.strictEqual(rows[0].extra.inStateMuni, true, 'in-state muni flagged');
  // packageScoped → dismissId uses packageDate
  assert.strictEqual(rows[0].dismissId, `securities-offering-fit:b1:${PKG}`, 'package-scoped dismissId uses packageDate');
});

// ---------------------------------------------------------------------------
// muni-afs-book
// ---------------------------------------------------------------------------
test('muni-afs-book: owned banks with afsMunis>0, afsMunis-desc, BQ context from subchapterS', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [
      { bankId: 'b1', displayName: 'C-corp Muni', owner: 'asmith', status: 'Client', city: 'A', state: 'IA' },
      { bankId: 'b2', displayName: 'Sub-S Muni', owner: 'asmith', status: 'Client', city: 'B', state: 'MO' },
      { bankId: 'b3', displayName: 'No Munis', owner: 'asmith', status: 'Client', city: 'C', state: 'NE' },
    ],
    mapBanks: [
      { id: 'b1', afsMunis: 80000, subchapterS: 'No' },
      { id: 'b2', afsMunis: 30000, subchapterS: 'Yes' },
      { id: 'b3', afsMunis: 0, subchapterS: 'No' },
    ],
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'muni-afs-book');
  assert.deepStrictEqual(rows.map(r => r.bankId), ['b1', 'b2'], 'afsMunis>0 only, afsMunis-desc');
  assert.strictEqual(rows[0].extra.isSubS, false, 'C-corp flagged');
  assert.strictEqual(rows[1].extra.isSubS, true, 'Sub-S flagged');
  assert.ok(rows[0].detail.includes('C-corp'), 'BQ context surfaced for C-corp');
});

test('muni-afs-book: tolerates afsMunis===undefined (field not projected) — no rows, warning, no crash', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [{ bankId: 'b1', displayName: 'Some Bank', owner: 'asmith', status: 'Client' }],
    mapBanks: [{ id: 'b1' /* no afsMunis key */, subchapterS: 'No' }],
  };
  const resp = sig.buildBankSignals(inputs);
  assert.strictEqual(byKey(resp, 'muni-afs-book').length, 0, 'no muni-afs rows when field not projected');
  assert.ok(resp.warnings.some(w => /afsMunis/.test(w)), 'a warning explains the missing projection');
});

// ---------------------------------------------------------------------------
// freshness-fdic-newer
// ---------------------------------------------------------------------------
test('freshness-fdic-newer: only newerAvailable, fdicPeriod>workbookPeriod in detail, newest-first', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [
      { bankId: 'b1', displayName: 'Stale One', owner: 'asmith', status: 'Client', city: 'A', state: 'IA' },
      { bankId: 'b2', displayName: 'Stale Two', owner: 'asmith', status: 'Client', city: 'B', state: 'MO' },
      { bankId: 'b3', displayName: 'Current', owner: 'asmith', status: 'Client' },
    ],
    fdicFlagsByBank: {
      b1: { newerAvailable: true, fdicPeriod: '2026Q1', workbookPeriod: '2025Q4' },
      b2: { newerAvailable: true, fdicPeriod: '2026Q2', workbookPeriod: '2025Q4' },
      b3: { newerAvailable: false, fdicPeriod: '2025Q4', workbookPeriod: '2025Q4' },
    },
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'freshness-fdic-newer');
  assert.deepStrictEqual(rows.map(r => r.bankId), ['b2', 'b1'], 'only newer, newest fdicPeriod first');
  assert.ok(rows[0].detail.includes('2026Q2') && rows[0].detail.includes('2025Q4'), 'period comparison in detail');
});

// ---------------------------------------------------------------------------
// dismiss + grouping + gated-off signals
// ---------------------------------------------------------------------------
test('dismiss removes exactly the matching row; categories returned in fixed order with counts', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [
      { bankId: 'b1', displayName: 'Cold A', owner: 'asmith', status: 'Client' },
      { bankId: 'b2', displayName: 'Cold B', owner: 'asmith', status: 'Client' },
    ],
    lastTouchByBank: {}, // both never-touched → both cold
    dismissed: [`coverage-cold-owned:b1:${TODAY}`],
  };
  const resp = sig.buildBankSignals(inputs);
  const rows = byKey(resp, 'coverage-cold-owned');
  assert.deepStrictEqual(rows.map(r => r.bankId), ['b2'], 'dismissed row removed, other kept');
  // fixed category order
  assert.deepStrictEqual(
    resp.categories.map(c => c.category),
    ['Coverage', 'Funding', 'Securities', 'Muni', 'Portfolio', 'Data-Freshness'],
    'categories in fixed CATEGORY_ORDER'
  );
  const coverage = resp.categories.find(c => c.category === 'Coverage');
  assert.strictEqual(coverage.count, coverage.signals.length, 'count matches signal length');
});

test('gated-off v1 signals never appear even when their inputs are present', () => {
  const inputs = {
    scope: 'rep', today: TODAY, packageDate: PKG,
    savedBanks: [{ bankId: 'b1', displayName: 'Watch Bank', owner: 'asmith', status: 'Client' }],
    watchlistBankIds: ['b1'],
    fitsByBank: { b1: { classes: [{ type: 'muni', label: 'Muni', score: 30, picks: [{ cusip: 'M1', yield: 4 }] }] } },
    oppsByBank: { b1: [] },
    portfolioByBank: { b1: { reportDate: '2026-06-01', totalPositions: 12 } },
  };
  const resp = sig.buildBankSignals(inputs);
  assert.strictEqual(byKey(resp, 'securities-watchlist-fit').length, 0, 'watchlist-fit gated off');
  assert.strictEqual(byKey(resp, 'coverage-client-no-recent-opp').length, 0, 'client-no-recent-opp gated off');
  assert.strictEqual(byKey(resp, 'portfolio-peer-gap').length, 0, 'portfolio-peer-gap gated off');
  // the enabled offering-fit signal still works off the same fitsByBank input
  assert.strictEqual(byKey(resp, 'securities-offering-fit').length, 1, 'enabled offering-fit still emits');
});

// ---------------------------------------------------------------------------
// rep-scope contract + graceful degradation
// ---------------------------------------------------------------------------
test('rep-scope contract: scope=firm still emits large-no-owner; engine trusts pre-filtered owned set', () => {
  const inputs = {
    scope: 'firm', today: TODAY, packageDate: PKG,
    thresholds: { assetFloorK: 500000 },
    savedBanks: [{ bankId: 'b1', displayName: 'Owned', owner: 'asmith', status: 'Client' }],
    lastTouchByBank: {}, // b1 cold
    mapBanks: [{ id: 'm1', displayName: 'Big Unowned', totalAssets: 9000000 }],
    coverageByBank: {},
  };
  const resp = sig.buildBankSignals(inputs);
  assert.strictEqual(resp.scope, 'firm');
  assert.ok(byKey(resp, 'coverage-large-no-owner').length >= 1, 'firm-set signal present');
  // every owned-signal row belongs to the passed-in owned set (b1 only)
  byKey(resp, 'coverage-cold-owned').forEach(r => assert.strictEqual(r.bankId, 'b1'));
});

test('empty / missing inputs degrade gracefully (never throws), totals zeroed, shell intact', () => {
  const resp = sig.buildBankSignals({});
  assert.strictEqual(resp.totals.signals, 0, 'no signals from empty inputs');
  assert.strictEqual(resp.categories.length, 6, 'all 6 category shells present');
  assert.ok(Array.isArray(resp.warnings), 'warnings array present');
  // also tolerate undefined inputs entirely
  const resp2 = sig.buildBankSignals();
  assert.strictEqual(resp2.totals.signals, 0, 'undefined inputs → empty response');
});

test('dismissId format helper: package-scoped vs daily', () => {
  assert.strictEqual(sig.dismissIdFor('coverage-cold-owned', 'b1', TODAY, PKG), `coverage-cold-owned:b1:${TODAY}`);
  assert.strictEqual(sig.dismissIdFor('securities-offering-fit', 'b1', TODAY, PKG), `securities-offering-fit:b1:${PKG}`);
});

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${t.name}`);
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
console.log(`bank-signals.test.js: ${passed}/${tests.length} passed`);
