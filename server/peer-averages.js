'use strict';

// Compute peer-group averages on demand from bank-data.sqlite.
//
// Inputs: a normalized criteria object (see peer-group-store.normalizeCriteria)
// + a period string (e.g. "2026Q1"). For each metric we read every matching
// bank's value for that period and take a straight arithmetic mean (every
// bank weighted equally — SNL/FedFis convention).
//
// Output shape mirrors the legacy peer-comparison shape so the tear sheet
// renderer doesn't need to know whether numbers came from the FedFis
// workbook or from a user-defined cohort.

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const BANK_DATABASE_FILENAME = 'bank-data.sqlite';

function bankDatabasePathForDir(outputDir) {
  return path.join(outputDir, BANK_DATABASE_FILENAME);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

// ---------------------------------------------------------------------------
// Metric registry — server-side mirror of public/js/portal.js
// PEER_ANALYSIS_METRICS. Kept in sync manually; if you add a metric to the
// client list, mirror it here so peer averages compute it. higherIsBetter
// drives the favorable/watch signal on the tear sheet.

const PEER_METRICS = [
  { key: 'totalAssets', label: 'Total Assets', type: 'money', higherIsBetter: null },
  { key: 'afsTotal', label: 'Total Securities AFS-FV', type: 'money', higherIsBetter: null },
  { key: 'htmTotal', label: 'Total Securities HTM-FV', type: 'money', higherIsBetter: null },
  { key: 'securitiesToAssets', label: 'Securities / Assets', type: 'percent', higherIsBetter: null },
  { key: 'totalLoans', label: 'Total Loans & Leases', type: 'money', higherIsBetter: null },
  { key: 'loansToAssets', label: 'Loans / Assets', type: 'percent', higherIsBetter: null },
  { key: 'totalDeposits', label: 'Total Deposits', type: 'money', higherIsBetter: null },
  { key: 'loansToDeposits', label: 'Loans / Deposits', type: 'percent', higherIsBetter: null },
  { key: 'totalBorrowings', label: 'Total Borrowings', type: 'money', higherIsBetter: null },
  { key: 'realEstateLoansToLoans', label: 'Real Estate Loans / Loans', type: 'percent', higherIsBetter: null },
  { key: 'farmLoansToLoans', label: 'Farmland / Loans', type: 'percent', higherIsBetter: null },
  { key: 'agProdLoansToLoans', label: 'Agricultural Production / Loans', type: 'percent', higherIsBetter: null },
  { key: 'ciLoansToLoans', label: 'C&I Loans / Loans', type: 'percent', higherIsBetter: null },
  { key: 'totalEquityCapital', label: 'Total Equity Capital', type: 'money', higherIsBetter: null },
  { key: 'tier1Capital', label: 'Tier 1 Capital', type: 'money', higherIsBetter: null },
  { key: 'tier1RiskBasedRatio', label: 'Tier 1 Risk-Based Ratio', type: 'percent', higherIsBetter: true },
  { key: 'riskBasedCapitalRatio', label: 'Risk-Based Capital Ratio', type: 'percent', higherIsBetter: true },
  { key: 'tangibleEquityToAssets', label: 'Tangible Equity / Assets', type: 'percent', higherIsBetter: true },
  { key: 'leverageRatio', label: 'Leverage Ratio', type: 'percent', higherIsBetter: true },
  { key: 'dividendsDeclared', label: 'Dividends Declared', type: 'money', higherIsBetter: null },
  { key: 'dividendsToNetIncome', label: 'Dividends / Net Income', type: 'percent', higherIsBetter: null },
  { key: 'roa', label: 'ROA', type: 'percent', higherIsBetter: true },
  { key: 'roe', label: 'ROE', type: 'percent', higherIsBetter: true },
  { key: 'yieldOnEarningAssets', label: 'Yield on Earning Assets', type: 'percent', higherIsBetter: true },
  { key: 'yieldOnLoans', label: 'Yield on Loans', type: 'percent', higherIsBetter: true },
  { key: 'yieldOnSecurities', label: 'Yield on Securities', type: 'percent', higherIsBetter: true },
  { key: 'netInterestMargin', label: 'Net Interest Margin', type: 'percent', higherIsBetter: true },
  { key: 'efficiencyRatio', label: 'Efficiency Ratio', type: 'percent', higherIsBetter: false },
  { key: 'costOfFunds', label: 'Cost of Funds', type: 'percent', higherIsBetter: false },
  { key: 'netIncome', label: 'Net Income', type: 'money', higherIsBetter: null },
  { key: 'realizedGainLossSecurities', label: 'Realized Gain/Loss on Securities', type: 'money', higherIsBetter: null },
  { key: 'texasRatio', label: 'Texas Ratio', type: 'percent', higherIsBetter: false },
  { key: 'llrToLoans', label: 'Loan Loss Reserves / Loans', type: 'percent', higherIsBetter: true },
  { key: 'nplsToLoans', label: 'NPLs / Loans', type: 'percent', higherIsBetter: false },
  { key: 'loanLossReserve', label: 'Loan & Lease Loss Reserve', type: 'money', higherIsBetter: null },
  { key: 'loanLossProvision', label: 'Loan Loss Provision', type: 'money', higherIsBetter: false },
  { key: 'netChargeoffsToAvgLoans', label: 'Net Chargeoffs / Avg Loans', type: 'percent', higherIsBetter: false },
  { key: 'largeDepositsToDeposits', label: 'Deposits > $250K / Deposits', type: 'percent', denominatorKey: 'totalDeposits', higherIsBetter: false },
  { key: 'nonInterestBearingDeposits', label: 'Non-Interest Bearing Deposits / Deposits', type: 'percent', higherIsBetter: true },
  { key: 'brokeredDepositsToDeposits', label: 'Brokered Deposits / Deposits', type: 'percent', higherIsBetter: false },
  { key: 'jumboTimeDeposits', label: 'Jumbo Time Deposits / Deposits', type: 'percent', higherIsBetter: false },
  { key: 'publicFunds', label: 'Public Funds / Deposits', type: 'percent', higherIsBetter: null },
  { key: 'netNonCoreFundingDependence', label: 'Net NonCore Funding Dependence', type: 'percent', higherIsBetter: false },
  { key: 'wholesaleFundingReliance', label: 'Reliance on Wholesale Funding', type: 'percent', higherIsBetter: false },
  { key: 'longTermAssetsToAssets', label: 'Long-Term Assets / Assets', type: 'percent', higherIsBetter: false },
  { key: 'liquidAssetsToAssets', label: 'Liquid Assets / Assets', type: 'percent', higherIsBetter: true },
  { key: 'avgIntBearingFundsToAssets', label: 'Avg Interest-Bearing Funds / Avg Assets', type: 'percent', higherIsBetter: false },
  { key: 'intEarnAssetsToFunds', label: 'Interest-Earning Assets / Interest-Bearing Funds', type: 'percent', higherIsBetter: true },
  { key: 'securitiesFvToBv', label: 'Securities FV / BV', type: 'percent', higherIsBetter: true }
];

const PEER_METRIC_KEYS = PEER_METRICS.map(m => m.key);

function metricSqlExpression(metric, periodAlias) {
  const path = `'$.values.${metric.key}'`;
  const valueExpr = `CAST(json_extract(${periodAlias}.value, ${path}) AS REAL)`;
  if (!metric.denominatorKey) return valueExpr;
  const denomPath = `'$.values.${metric.denominatorKey}'`;
  const denomExpr = `CAST(json_extract(${periodAlias}.value, ${denomPath}) AS REAL)`;
  return `CASE WHEN ${valueExpr} IS NOT NULL AND ${denomExpr} IS NOT NULL AND ${denomExpr} != 0 THEN (${valueExpr} / ${denomExpr}) * 100 ELSE NULL END`;
}

// ---------------------------------------------------------------------------
// SQL fragments from criteria.

function safeStateList(states) {
  return states
    .map(s => `'${String(s).replace(/'/g, "''")}'`)
    .join(',');
}

// Build the WHERE clauses + JSON_EACH joins needed to filter to the cohort.
// Asset and state columns live on `banks` directly. Sub-S and loan-mix
// fields live in detail_json.periods[].values, so we join the same period
// row that the bank's latest period (or the requested period) uses.
function buildCohortWhere(criteria, periodAlias) {
  const wheres = [];
  if (Number.isFinite(criteria.assetMin)) {
    wheres.push(`b.total_assets >= ${Number(criteria.assetMin)}`);
  }
  if (Number.isFinite(criteria.assetMax)) {
    wheres.push(`b.total_assets <= ${Number(criteria.assetMax)}`);
  }
  if (criteria.states && criteria.states.length) {
    wheres.push(`b.state IN (${safeStateList(criteria.states)})`);
  }
  if (criteria.subchapterS === 'Yes') {
    wheres.push(`json_extract(${periodAlias}.value, '$.values.subchapterS') = 'Yes'`);
  } else if (criteria.subchapterS === 'No') {
    wheres.push(`json_extract(${periodAlias}.value, '$.values.subchapterS') = 'No'`);
  }
  if (criteria.loanMix && criteria.loanMix.length) {
    for (const r of criteria.loanMix) {
      const path = `'$.values.${r.key}'`;
      wheres.push(`CAST(json_extract(${periodAlias}.value, ${path}) AS REAL) ${r.op} ${Number(r.value)}`);
    }
  }
  return wheres;
}

// Pick the period to compute against. If caller passes one we use it; else
// use the latest period that exists across the dataset.
function resolvePeriod(dbPath, requestedPeriod) {
  if (requestedPeriod && /^\d{4}Q\d$/.test(requestedPeriod)) return requestedPeriod;
  const rows = querySqliteJson(dbPath, `
    SELECT MAX(json_extract(summary_json, '$.period')) AS p
    FROM banks
    WHERE json_extract(summary_json, '$.period') GLOB '????Q?';
  `);
  const latest = rows && rows[0] && rows[0].p;
  return latest && /^\d{4}Q\d$/.test(latest) ? latest : null;
}

// Find every bank matching the criteria for the given period. Returns
// { period, bankIds, count }. Used by the cohort-preview popcount.
function findMatchingBanks(outputDir, criteria, requestedPeriod) {
  const dbPath = bankDatabasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return { period: null, bankIds: [], count: 0 };
  const period = resolvePeriod(dbPath, requestedPeriod);
  if (!period) return { period: null, bankIds: [], count: 0 };
  const wheres = buildCohortWhere(criteria || {}, 'p');
  const whereSql = wheres.length ? 'AND ' + wheres.join('\n      AND ') : '';
  const rows = querySqliteJson(dbPath, `
    SELECT b.id AS id
    FROM banks b, json_each(b.detail_json, '$.periods') p
    WHERE json_extract(p.value, '$.period') = '${period.replace(/'/g, "''")}'
      ${whereSql};
  `, { maxBuffer: 64 * 1024 * 1024 });
  return { period, bankIds: rows.map(r => r.id), count: rows.length };
}

// Compute peer-group averages for every metric in PEER_METRICS over the
// matching cohort at the given period. Numeric values are arithmetic-mean
// averaged across the matching banks; per-metric sampleSize tracks how
// many banks contributed a finite number (a bank can be in the cohort
// but have a null value for some metric).
function computeCohortAverages(outputDir, criteria, requestedPeriod) {
  const dbPath = bankDatabasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) {
    return { period: null, populationCount: 0, byKey: {} };
  }
  const period = resolvePeriod(dbPath, requestedPeriod);
  if (!period) return { period: null, populationCount: 0, byKey: {} };
  const wheres = buildCohortWhere(criteria || {}, 'p');
  const whereSql = wheres.length ? 'AND ' + wheres.join('\n      AND ') : '';

  // Project every metric in a single SELECT so we make exactly one SQL call
  // per cohort/period. AVG ignores NULLs; we count finite samples per key
  // with SUM(CASE ...).
  const projects = PEER_METRICS.map(m => {
    const expr = metricSqlExpression(m, 'p');
    return [
      `AVG(${expr}) AS avg_${m.key}`,
      `SUM(CASE WHEN ${expr} IS NOT NULL THEN 1 ELSE 0 END) AS n_${m.key}`
    ].join(', ');
  }).join(',\n      ');

  const sql = `
    SELECT
      COUNT(*) AS population,
      ${projects}
    FROM banks b, json_each(b.detail_json, '$.periods') p
    WHERE json_extract(p.value, '$.period') = '${period.replace(/'/g, "''")}'
      ${whereSql};
  `;
  const rows = querySqliteJson(dbPath, sql, { maxBuffer: 64 * 1024 * 1024 });
  if (!rows.length) return { period, populationCount: 0, byKey: {} };
  const r = rows[0];
  const population = Number(r.population) || 0;
  const byKey = {};
  for (const m of PEER_METRICS) {
    const peerValue = r['avg_' + m.key];
    const sampleSize = Number(r['n_' + m.key]) || 0;
    if (peerValue == null || !Number.isFinite(Number(peerValue))) {
      byKey[m.key] = {
        peerValue: null,
        sampleSize,
        peerLabel: m.label,
        higherIsBetter: m.higherIsBetter
      };
      continue;
    }
    byKey[m.key] = {
      peerValue: Number(peerValue),
      sampleSize,
      peerLabel: m.label,
      higherIsBetter: m.higherIsBetter
    };
  }
  return { period, populationCount: population, byKey };
}

// Build the legacy peer-comparison shape so the tear sheet renderer
// keeps working unchanged.
function peerComparisonFromCohort(outputDir, peerGroup, bankPeriod, options = {}) {
  if (!peerGroup) return null;
  const requested = bankPeriod || null;
  const averages = computeCohortAverages(outputDir, peerGroup.criteria || {}, requested);
  if (!averages.period || averages.populationCount === 0) return null;
  return {
    peerGroup: {
      id: peerGroup.id,
      label: peerGroup.name,
      criteria: criteriaSummaryLabels(peerGroup.criteria || {}),
      populationCount: averages.populationCount,
      latestPeriod: averages.period
    },
    period: averages.period,
    bankPeriod: bankPeriod || '',
    periodAligned: Boolean(bankPeriod) && averages.period === bankPeriod,
    selectionReason: options.selectionReason || '',
    selectionBasis: Array.isArray(options.selectionBasis) ? options.selectionBasis : [],
    byKey: averages.byKey
  };
}

function cohortSelectionBasis(peerGroup, bank) {
  const cr = peerGroup && peerGroup.criteria ? peerGroup.criteria : {};
  const summary = bank && bank.summary ? bank.summary : {};
  const latest = bank && Array.isArray(bank.periods) ? bank.periods[0] : null;
  const values = latest && latest.values ? latest.values : {};
  const parts = [];
  if (Number.isFinite(cr.assetMin) || Number.isFinite(cr.assetMax)) parts.push('asset size');
  if (cr.states && cr.states.length && cr.states.includes(String(summary.state || '').toUpperCase())) parts.push('state');
  if (cr.subchapterS && cr.subchapterS === String(values.subchapterS || '').trim()) parts.push('corporate structure');
  if (cr.loanMix && cr.loanMix.length) parts.push('loan mix');
  return parts;
}

function criteriaSummaryLabels(criteria) {
  const parts = {};
  if (Number.isFinite(criteria.assetMin) || Number.isFinite(criteria.assetMax)) {
    const fmtK = (n) => {
      if (!Number.isFinite(n)) return '';
      if (n >= 1000000) return `$${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}B`;
      if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}M`;
      return `$${n}K`;
    };
    const lo = Number.isFinite(criteria.assetMin) ? fmtK(criteria.assetMin) : '';
    const hi = Number.isFinite(criteria.assetMax) ? fmtK(criteria.assetMax) : '';
    if (lo && hi) parts.assetRange = `${lo}–${hi}`;
    else if (lo) parts.assetRange = `≥ ${lo}`;
    else if (hi) parts.assetRange = `≤ ${hi}`;
  }
  if (criteria.states && criteria.states.length) {
    parts.region = criteria.states.length > 6
      ? `${criteria.states.length} states`
      : criteria.states.join(', ');
  }
  if (criteria.subchapterS) {
    parts.subchapterS = criteria.subchapterS === 'Yes' ? 'Sub-S' : 'C-corp';
  }
  if (criteria.loanMix && criteria.loanMix.length) {
    parts.loanMix = criteria.loanMix
      .map(r => `${r.key} ${r.op} ${r.value}`)
      .join(' · ');
  }
  return parts;
}

// Pick the smallest cohort the bank fully qualifies for. "Smallest" means
// the cohort whose matching population is smallest — most specific peer
// set. Falls back to the largest if the bank doesn't qualify for any.
function findBestFitCohort(outputDir, bank, allCohorts) {
  if (!bank || !Array.isArray(allCohorts) || !allCohorts.length) return null;
  const summary = bank.summary || {};
  const latest = Array.isArray(bank.periods) && bank.periods[0] ? bank.periods[0] : null;
  const values = (latest && latest.values) || {};
  const bankAssets = Number(summary.totalAssets);
  const bankState = String(summary.state || '').toUpperCase().trim();
  const bankSubS = String(values.subchapterS || '').trim();

  const qualifying = allCohorts.filter(c => {
    const cr = c.criteria || {};
    if (Number.isFinite(cr.assetMin) && bankAssets < cr.assetMin) return false;
    if (Number.isFinite(cr.assetMax) && bankAssets > cr.assetMax) return false;
    if (cr.states && cr.states.length && !cr.states.includes(bankState)) return false;
    if (cr.subchapterS && cr.subchapterS !== bankSubS) return false;
    if (cr.loanMix && cr.loanMix.length) {
      for (const r of cr.loanMix) {
        const v = Number(values[r.key]);
        if (!Number.isFinite(v)) return false;
        if (r.op === '>=' && !(v >= r.value)) return false;
        if (r.op === '<=' && !(v <= r.value)) return false;
        if (r.op === '>' && !(v > r.value)) return false;
        if (r.op === '<' && !(v < r.value)) return false;
        if (r.op === '=' && !(v === r.value)) return false;
      }
    }
    return true;
  });

  if (!qualifying.length) return null;

  // We don't have populationCount on each cohort here cheaply — so use
  // criteria "specificity" as a proxy: more constraints = smaller cohort.
  // Ties broken by cohort name for deterministic picks.
  const specificity = (c) => {
    let score = 0;
    if (Number.isFinite(c.criteria.assetMin)) score++;
    if (Number.isFinite(c.criteria.assetMax)) score++;
    if (c.criteria.states && c.criteria.states.length) score++;
    if (c.criteria.subchapterS) score++;
    if (c.criteria.loanMix && c.criteria.loanMix.length) score += c.criteria.loanMix.length;
    return score;
  };
  qualifying.sort((a, b) => {
    const sa = specificity(a);
    const sb = specificity(b);
    if (sa !== sb) return sb - sa; // most specific first
    return String(a.name).localeCompare(String(b.name));
  });
  return qualifying[0];
}

module.exports = {
  PEER_METRICS,
  PEER_METRIC_KEYS,
  cohortSelectionBasis,
  findMatchingBanks,
  computeCohortAverages,
  peerComparisonFromCohort,
  findBestFitCohort,
  criteriaSummaryLabels
};
