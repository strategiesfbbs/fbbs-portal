// Characterization tests for the three PURE exported functions of
// server/peer-averages.js — criteriaSummaryLabels, cohortSelectionBasis,
// and findBestFitCohort. No DB / no I/O: findBestFitCohort ignores its
// outputDir arg entirely and is fully determined by (bank, allCohorts).
//
// These lock in CURRENT behavior (safety net, not a spec). Pure synthetic
// plain-object fixtures only; node:assert; prints "<name>: N/N passed".
'use strict';

const assert = require('assert');
const peer = require('../server/peer-averages');
const { criteriaSummaryLabels, cohortSelectionBasis, findBestFitCohort } = peer;

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; }
  catch (err) {
    process.exitCode = 1;
    console.error(`FAIL  ${name}`);
    console.error(err && (err.stack || err.message));
  }
}

// ---------------------------------------------------------------------------
// criteriaSummaryLabels(criteria)
// ---------------------------------------------------------------------------

test('criteriaSummaryLabels: empty criteria → empty object', () => {
  assert.deepStrictEqual(criteriaSummaryLabels({}), {});
});

test('criteriaSummaryLabels: min+max → $M–$B range (B/M/K thresholds)', () => {
  // 100000 (K-units) → 100,000 < 1e6 so it is M tier: 100000/1000 = 100 → $100M
  // 1000000 → >= 1e6 → /1e6 = 1 → $1B
  const out = criteriaSummaryLabels({ assetMin: 100000, assetMax: 1000000 });
  assert.strictEqual(out.assetRange, '$100M–$1B');
});

test('criteriaSummaryLabels: B/M/K tier boundaries + modulo decimal trimming', () => {
  // >= 1e6 and exact multiple of 1e6 → no decimal: 2e6 → $2B
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 2000000 }).assetRange, '≥ $2B');
  // >= 1e6 non-exact → 1 decimal: 1.5e6 → $1.5B
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 1500000 }).assetRange, '≥ $1.5B');
  // >= 1e3, exact multiple of 1e3 → no decimal: 5000 → $5M
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 5000 }).assetRange, '≥ $5M');
  // >= 1e3 non-exact → 1 decimal: 2500 → $2.5M
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 2500 }).assetRange, '≥ $2.5M');
  // < 1e3 → raw K: 750 → $750K
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 750 }).assetRange, '≥ $750K');
});

test('criteriaSummaryLabels: only min → "≥ ..."; only max → "≤ ..."', () => {
  assert.strictEqual(criteriaSummaryLabels({ assetMin: 100000 }).assetRange, '≥ $100M');
  assert.strictEqual(criteriaSummaryLabels({ assetMax: 1000000 }).assetRange, '≤ $1B');
});

test('criteriaSummaryLabels: ≤6 states comma-joined; >6 states → "N states"', () => {
  const six = criteriaSummaryLabels({ states: ['IL', 'IA', 'MO', 'WI', 'IN', 'KY'] });
  assert.strictEqual(six.region, 'IL, IA, MO, WI, IN, KY');
  const seven = criteriaSummaryLabels({ states: ['IL', 'IA', 'MO', 'WI', 'IN', 'KY', 'OH'] });
  assert.strictEqual(seven.region, '7 states');
});

test('criteriaSummaryLabels: subchapterS Yes→Sub-S, No→C-corp', () => {
  assert.strictEqual(criteriaSummaryLabels({ subchapterS: 'Yes' }).subchapterS, 'Sub-S');
  assert.strictEqual(criteriaSummaryLabels({ subchapterS: 'No' }).subchapterS, 'C-corp');
  // any non-'Yes' truthy value falls through the ternary to 'C-corp'
  assert.strictEqual(criteriaSummaryLabels({ subchapterS: 'maybe' }).subchapterS, 'C-corp');
});

test('criteriaSummaryLabels: loanMix joined as "key op value · ..."', () => {
  const out = criteriaSummaryLabels({
    loanMix: [
      { key: 'ciLoansToLoans', op: '>=', value: 20 },
      { key: 'realEstateLoansToLoans', op: '<', value: 50 }
    ]
  });
  assert.strictEqual(out.loanMix, 'ciLoansToLoans >= 20 · realEstateLoansToLoans < 50');
});

test('criteriaSummaryLabels: all parts combine into one object', () => {
  const out = criteriaSummaryLabels({
    assetMin: 100000,
    assetMax: 1000000,
    states: ['IL'],
    subchapterS: 'Yes',
    loanMix: [{ key: 'ciLoansToLoans', op: '>', value: 10 }]
  });
  assert.deepStrictEqual(out, {
    assetRange: '$100M–$1B',
    region: 'IL',
    subchapterS: 'Sub-S',
    loanMix: 'ciLoansToLoans > 10'
  });
});

// ---------------------------------------------------------------------------
// cohortSelectionBasis(peerGroup, bank)
// ---------------------------------------------------------------------------

function bankFixture(overrides = {}) {
  return {
    summary: { totalAssets: 500000, state: 'IL', ...(overrides.summary || {}) },
    periods: overrides.periods !== undefined
      ? overrides.periods
      : [{ period: '2026Q1', values: { subchapterS: 'No', ciLoansToLoans: 25, ...(overrides.values || {}) } }]
  };
}

test('cohortSelectionBasis: all four criteria satisfied → full ordered list', () => {
  const peerGroup = {
    criteria: {
      assetMin: 100000,
      states: ['IL', 'IA'],
      subchapterS: 'No',
      loanMix: [{ key: 'ciLoansToLoans', op: '>=', value: 20 }]
    }
  };
  const basis = cohortSelectionBasis(peerGroup, bankFixture());
  assert.deepStrictEqual(basis, ['asset size', 'state', 'corporate structure', 'loan mix']);
});

test('cohortSelectionBasis: asset size triggers on either assetMin OR assetMax', () => {
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { assetMax: 999999 } }, bankFixture()),
    ['asset size']
  );
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { assetMin: 1 } }, bankFixture()),
    ['asset size']
  );
});

test('cohortSelectionBasis: state must match (case-insensitive on bank state)', () => {
  // bank state IL is uppercased before the .includes() check
  const bankLower = bankFixture({ summary: { totalAssets: 500000, state: 'il' } });
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { states: ['IL'] } }, bankLower),
    ['state']
  );
  // a non-matching state contributes nothing
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { states: ['CA'] } }, bankFixture()),
    []
  );
});

test('cohortSelectionBasis: corporate structure only when subchapterS matches exactly', () => {
  // matches
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { subchapterS: 'No' } }, bankFixture()),
    ['corporate structure']
  );
  // mismatch → not included
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { subchapterS: 'Yes' } }, bankFixture()),
    []
  );
});

test('cohortSelectionBasis: loan mix included whenever the cohort has any loanMix rule', () => {
  // Note: cohortSelectionBasis does NOT evaluate the operator — presence is enough.
  const basis = cohortSelectionBasis(
    { criteria: { loanMix: [{ key: 'ciLoansToLoans', op: '>=', value: 99999 }] } },
    bankFixture()
  );
  assert.deepStrictEqual(basis, ['loan mix']);
});

test('cohortSelectionBasis: null peerGroup / null bank → empty list (no throw)', () => {
  assert.deepStrictEqual(cohortSelectionBasis(null, bankFixture()), []);
  assert.deepStrictEqual(cohortSelectionBasis({ criteria: {} }, null), []);
  assert.deepStrictEqual(cohortSelectionBasis(null, null), []);
});

test('cohortSelectionBasis: bank with no periods uses empty values (state still works)', () => {
  const bank = { summary: { totalAssets: 500000, state: 'IL' }, periods: [] };
  // subchapterS won't match (values empty) but state will
  assert.deepStrictEqual(
    cohortSelectionBasis({ criteria: { states: ['IL'], subchapterS: 'No' } }, bank),
    ['state']
  );
});

// ---------------------------------------------------------------------------
// findBestFitCohort(outputDir, bank, allCohorts)
//   outputDir is ignored entirely — pure given (bank, cohorts).
// ---------------------------------------------------------------------------

function cohort(name, criteria) {
  return { name, criteria: criteria || {} };
}

function bigBank(overrides = {}) {
  return {
    summary: { totalAssets: 500000, state: 'IL', ...(overrides.summary || {}) },
    periods: [{ period: '2026Q1', values: { subchapterS: 'No', ciLoansToLoans: 25, realEstateLoansToLoans: 40, ...(overrides.values || {}) } }]
  };
}

const IGNORED_DIR = '/dev/null/ignored';

test('findBestFitCohort: null bank / empty / null cohorts → null', () => {
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, null, [cohort('A', {})]), null);
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, bigBank(), []), null);
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, bigBank(), null), null);
});

test('findBestFitCohort: more specific qualifying cohort wins on constraint count', () => {
  const loose = cohort('Loose', { assetMin: 1 });                                   // specificity 1
  const tight = cohort('Tight', { assetMin: 1, states: ['IL'], subchapterS: 'No' }); // specificity 3
  const picked = findBestFitCohort(IGNORED_DIR, bigBank(), [loose, tight]);
  assert.strictEqual(picked.name, 'Tight');
});

test('findBestFitCohort: loanMix length counts per-rule toward specificity', () => {
  const single = cohort('Single', { states: ['IL'], subchapterS: 'No' }); // 2
  const multi = cohort('Multi', {
    states: ['IL'],
    loanMix: [
      { key: 'ciLoansToLoans', op: '>=', value: 10 },
      { key: 'realEstateLoansToLoans', op: '<=', value: 99 }
    ]
  }); // 1 (states) + 2 (loanMix) = 3
  const picked = findBestFitCohort(IGNORED_DIR, bigBank(), [single, multi]);
  assert.strictEqual(picked.name, 'Multi');
});

test('findBestFitCohort: no qualifying cohort → null', () => {
  // bank has 500000 assets in IL; both cohorts disqualify it
  const wrongState = cohort('WrongState', { states: ['CA'] });
  const tooBig = cohort('TooBig', { assetMin: 9999999 });
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, bigBank(), [wrongState, tooBig]), null);
});

test('findBestFitCohort: asset min/max bounds qualify/disqualify correctly', () => {
  const bank = bigBank(); // 500000 assets
  assert.strictEqual(
    findBestFitCohort(IGNORED_DIR, bank, [cohort('InRange', { assetMin: 100000, assetMax: 1000000 })]).name,
    'InRange'
  );
  // below min → disqualified
  assert.strictEqual(
    findBestFitCohort(IGNORED_DIR, bank, [cohort('TooSmall', { assetMin: 600000 })]),
    null
  );
  // above max → disqualified
  assert.strictEqual(
    findBestFitCohort(IGNORED_DIR, bank, [cohort('Capped', { assetMax: 400000 })]),
    null
  );
});

test('findBestFitCohort: each loanMix operator filters correctly', () => {
  // ciLoansToLoans = 25 on the bank
  const cases = [
    { op: '>=', value: 25, qualifies: true },
    { op: '>=', value: 26, qualifies: false },
    { op: '<=', value: 25, qualifies: true },
    { op: '<=', value: 24, qualifies: false },
    { op: '>', value: 24, qualifies: true },
    { op: '>', value: 25, qualifies: false },
    { op: '<', value: 26, qualifies: true },
    { op: '<', value: 25, qualifies: false },
    { op: '=', value: 25, qualifies: true },
    { op: '=', value: 24, qualifies: false }
  ];
  for (const c of cases) {
    const ch = cohort('LM', { loanMix: [{ key: 'ciLoansToLoans', op: c.op, value: c.value }] });
    const picked = findBestFitCohort(IGNORED_DIR, bigBank(), [ch]);
    if (c.qualifies) {
      assert.ok(picked && picked.name === 'LM', `op ${c.op} ${c.value} should qualify`);
    } else {
      assert.strictEqual(picked, null, `op ${c.op} ${c.value} should disqualify`);
    }
  }
});

test('findBestFitCohort: non-finite loanMix metric value disqualifies the cohort', () => {
  // bank missing ciLoansToLoans → Number(undefined) is NaN → disqualified
  const bank = {
    summary: { totalAssets: 500000, state: 'IL' },
    periods: [{ period: '2026Q1', values: { subchapterS: 'No' } }] // no ciLoansToLoans
  };
  const ch = cohort('NeedsCI', { loanMix: [{ key: 'ciLoansToLoans', op: '>=', value: 10 }] });
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, bank, [ch]), null);
});

test('findBestFitCohort: specificity ties broken alphabetically by name', () => {
  // Both qualify, both specificity 1 (assetMin only). "Alpha" < "Zulu".
  const zulu = cohort('Zulu', { assetMin: 1 });
  const alpha = cohort('Alpha', { assetMin: 1 });
  // pass in non-alpha order to prove the sort, not input order, decides
  const picked = findBestFitCohort(IGNORED_DIR, bigBank(), [zulu, alpha]);
  assert.strictEqual(picked.name, 'Alpha');
});

test('findBestFitCohort: state match is case-insensitive on the bank side', () => {
  const bank = bigBank({ summary: { totalAssets: 500000, state: 'il' } });
  const ch = cohort('IL', { states: ['IL'] });
  assert.strictEqual(findBestFitCohort(IGNORED_DIR, bank, [ch]).name, 'IL');
});

test('findBestFitCohort: subchapterS must equal the bank latest-period value', () => {
  const bank = bigBank({ values: { subchapterS: 'Yes', ciLoansToLoans: 25 } });
  assert.strictEqual(
    findBestFitCohort(IGNORED_DIR, bank, [cohort('SubS', { subchapterS: 'Yes' })]).name,
    'SubS'
  );
  assert.strictEqual(
    findBestFitCohort(IGNORED_DIR, bank, [cohort('CCorp', { subchapterS: 'No' })]),
    null
  );
});

console.log(`peer-averages tests: ${passed}/${total} passed.`);
if (passed !== total) process.exit(1);
