/**
 * fdic-bulk-sync.js — pull a whole new quarter into bank-data.sqlite from the
 * free FDIC BankFind API, ahead of the quarterly FedFis workbook.
 *
 * The FedFis workbook stays the authoritative full import (it carries derived
 * fields the FDIC doesn't publish). This sync is the stopgap for the gap
 * between the FDIC releasing a quarter and the workbook arriving: it adds the
 * new period — explicitly mapped headline fields — to every bank whose cert matches,
 * and bumps the bank's summary period. It NEVER overwrites a period that
 * already exists (the workbook import rebuilds the whole DB later and
 * naturally supersedes these stopgap rows).
 *
 * One API page covers every FDIC-insured bank (~4,400 actives), so a full
 * sync is one or two HTTP requests. Period values added here carry
 * `source: 'fdic'` so they're distinguishable from workbook rows.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');
const { BANK_DATABASE_FILENAME, BANK_FIELDS } = require('./bank-data-importer');

const API_BASE = 'https://api.fdic.gov/banks/financials';
const FETCH_TIMEOUT_MS = 60000;
const PAGE_LIMIT = 10000;

// Direct RIS field → BANK_FIELDS key. Money fields are $000 on both sides;
// ratios are % on both sides. Field meanings verified against live API
// responses 2026-06-11 (cert 2738).
const DIRECT_MAP = [
  { ris: 'ASSET', key: 'totalAssets' },
  { ris: 'DEP', key: 'totalDeposits' },
  { ris: 'LNLSGR', key: 'totalLoans' },
  { ris: 'LNLSDEPR', key: 'loansToDeposits' },
  { ris: 'LNLSNTV', key: 'loansToAssets' },
  { ris: 'SCPLEDGE', key: 'pledgedSecurities' },
  { ris: 'SCAF', key: 'afsTotal' },
  { ris: 'SCHF', key: 'htmTotal' },
  { ris: 'IGLSEC', key: 'realizedGainLossSecurities' },
  { ris: 'EQ', key: 'totalEquityCapital' },
  { ris: 'RBCT1J', key: 'tier1Capital' },
  { ris: 'RBC1RWAJ', key: 'tier1RiskBasedRatio' },
  { ris: 'RBCRWAJ', key: 'riskBasedCapitalRatio' },
  { ris: 'RBC1AAJ', key: 'leverageRatio' },
  { ris: 'EQCDIV', key: 'dividendsDeclared' },
  { ris: 'EQCDIVNTINC', key: 'dividendsToNetIncome' },
  { ris: 'ROA', key: 'roa' },
  { ris: 'ROE', key: 'roe' },
  { ris: 'INTINCY', key: 'yieldOnEarningAssets' },
  { ris: 'INTEXPY', key: 'costOfFunds' },
  { ris: 'NIMY', key: 'netInterestMargin' },
  { ris: 'EEFFR', key: 'efficiencyRatio' },
  { ris: 'NETINC', key: 'netIncome' },
  { ris: 'LNATRESR', key: 'llrToLoans' },
  { ris: 'NCLNLSR', key: 'nplsToLoans' },
  { ris: 'LNATRES', key: 'loanLossReserve' },
  { ris: 'ELNATR', key: 'loanLossProvision' },
  { ris: 'NTLNLSR', key: 'netChargeoffsToAvgLoans' },
  { ris: 'DEPLGAMT', key: 'largeDepositsToDeposits' }, // $ amount; field type is percentOf with totalDeposits denominator
  { ris: 'ASSTLTR', key: 'longTermAssetsToAssets' },
  { ris: 'TFRA', key: 'fiduciaryAssets' },
  { ris: 'NUMEMP', key: 'fullTimeEmployees' },
  { ris: 'OFFDOM', key: 'numberOfOffices' },
];

// Ratios the workbook carries pre-computed but the API serves as raw $:
// numerator / denominator × 100.
const COMPUTED_MAP = [
  { key: 'brokeredDepositsToDeposits', num: 'BRO', den: 'DEP' },
  { key: 'securitiesToAssets', num: 'SC', den: 'ASSET' },
  { key: 'securitiesFvToBv', num: 'SCMV', den: 'SC' },
  { key: 'nonInterestBearingDeposits', num: 'DEPNI', den: 'DEP' },
  { key: 'realEstateLoansToLoans', num: 'LNRE', den: 'LNLSGR' },
  { key: 'farmLoansToLoans', num: 'LNREAG', den: 'LNLSGR' },
  { key: 'agProdLoansToLoans', num: 'LNAG', den: 'LNLSGR' },
  { key: 'ciLoansToLoans', num: 'LNCI', den: 'LNLSGR' },
  { key: 'consumerLoansToLoans', num: 'LNCON', den: 'LNLSGR' },
];

const SUM_MAP = [
  { key: 'totalBorrowings', fields: ['FREPP', 'OBOR'] },
];

const RIS_FIELDS = [...new Set(
  ['CERT', 'REPDTE']
    .concat(DIRECT_MAP.map(({ ris }) => ris))
    .concat(COMPUTED_MAP.flatMap(c => [c.num, c.den]))
    .concat(SUM_MAP.flatMap(c => c.fields))
)];

// Text/identity fields carried forward from the bank's most recent existing
// period so the Details/Account sections still render on the FDIC period.
// Numbers are never carried forward — a stale figure with a fresh period
// label would be worse than a dash.
const CARRY_FORWARD_KEYS = [
  'displayName', 'assetRange', 'agLoanRange', 'name', 'id', 'city', 'state',
  'regulatoryId', 'parentName', 'parentRegulatoryId', 'certNumber',
  'primaryRegulator', 'subchapterS', 'county', 'phone', 'address', 'zip',
  'website'
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fieldDef(key) {
  return (BANK_FIELDS || []).find(field => field.key === key) || { key, label: key, section: 'unknown', type: 'unknown' };
}

function buildFieldCoverage() {
  const mapped = [];
  for (const item of DIRECT_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'direct',
      sourceFields: [item.ris],
    });
  }
  for (const item of COMPUTED_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'ratio',
      sourceFields: [item.num, item.den],
    });
  }
  for (const item of SUM_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'sum',
      sourceFields: item.fields.slice(),
    });
  }

  const mappedKeys = new Set(mapped.map(row => row.key));
  const carriedIdentity = CARRY_FORWARD_KEYS
    .filter(key => !mappedKeys.has(key))
    .map(key => {
      const def = fieldDef(key);
      return { key, label: def.label, section: def.section };
    });
  const remaining = (BANK_FIELDS || [])
    .filter(field => !mappedKeys.has(field.key) && !CARRY_FORWARD_KEYS.includes(field.key))
    .map(field => ({ key: field.key, label: field.label, section: field.section, type: field.type }));

  return {
    source: 'FDIC BankFind Suite financials endpoint',
    mappedCount: mapped.length,
    carriedIdentityCount: carriedIdentity.length,
    remainingCount: remaining.length,
    totalBankFields: (BANK_FIELDS || []).length,
    mapped,
    carriedIdentity,
    remaining,
    warnings: [
      'FDIC sync still adds only newer missing periods; it never overwrites an existing workbook or FDIC period.',
      'Identity fields are carried forward from the latest existing portal period when the financial endpoint does not provide them.',
      'Detailed AFS/HTM sector splits remain marked for FFIEC bulk Call Report mapping before workbook retirement.',
    ],
  };
}

// '20260630' → '2026Q2' / end date '6/30/2026'.
function repdteToPeriod(repdte) {
  const s = String(repdte || '');
  if (!/^\d{8}$/.test(s)) return null;
  const quarter = Math.ceil(Number(s.slice(4, 6)) / 3);
  return `${s.slice(0, 4)}Q${quarter}`;
}

function periodToEndDate(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/);
  if (!m) return period || null;
  return { 1: `3/31/${m[1]}`, 2: `6/30/${m[1]}`, 3: `9/30/${m[1]}`, 4: `12/31/${m[1]}` }[m[2]];
}

function quarterRank(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  return m ? Number(m[1]) * 10 + Number(m[2]) : 0;
}

// One RIS row → BANK_FIELDS-keyed numeric values. Everything rounds to two
// decimals: ratios want 2dp and the $000 money fields are integers anyway.
// Pure, unit-tested.
function mapRisRow(row) {
  const values = {};
  for (const { ris, key } of DIRECT_MAP) {
    const v = num(row[ris]);
    if (v != null) values[key] = Number(v.toFixed(2));
  }
  for (const { key, num: numField, den: denField } of COMPUTED_MAP) {
    const numerator = num(row[numField]);
    const denominator = num(row[denField]);
    if (numerator != null && denominator) {
      values[key] = Number((numerator / denominator * 100).toFixed(2));
    }
  }
  for (const { key, fields } of SUM_MAP) {
    let hasValue = false;
    let total = 0;
    for (const sourceField of fields) {
      const v = num(row[sourceField]);
      if (v != null) {
        hasValue = true;
        total += v;
      }
    }
    if (hasValue) values[key] = Number(total.toFixed(2));
  }
  return values;
}

// Build the period entry to prepend to a bank's periods[]: carried-forward
// identity text from the latest existing period + fresh FDIC numbers.
function buildFdicPeriodEntry(bank, period, risRow) {
  const latest = bank.periods && bank.periods[0] ? (bank.periods[0].values || {}) : {};
  const values = { source: 'fdic' };
  for (const key of CARRY_FORWARD_KEYS) {
    if (latest[key] != null && latest[key] !== '') values[key] = latest[key];
  }
  values.period = period;
  Object.assign(values, mapRisRow(risRow));
  return { period, endDate: periodToEndDate(period), values, source: 'fdic' };
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'fbbs-portal/fdic-bulk-sync' },
  });
  if (!res.ok) throw new Error(`FDIC API responded ${res.status}`);
  return res.json();
}

// Latest broadly-filed quarter end: take the newest REPDTE on file, but step
// back one quarter if fewer than 1,000 banks have filed it yet (the first
// days of a filing window would otherwise produce a near-empty sync).
async function getLatestFiledRepdte(fetchImpl) {
  const top = await fetchJson(`${API_BASE}?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`, fetchImpl);
  const newest = top && top.data && top.data[0] && top.data[0].data ? String(top.data[0].data.REPDTE) : null;
  if (!newest) throw new Error('FDIC API returned no REPDTE');
  const counted = await fetchJson(`${API_BASE}?filters=REPDTE:${newest}&fields=CERT&limit=1&format=json`, fetchImpl);
  const total = counted && counted.meta && Number(counted.meta.total) || 0;
  if (total >= 1000) return newest;
  const prev = previousQuarterEnd(newest);
  return prev || newest;
}

function previousQuarterEnd(repdte) {
  const period = repdteToPeriod(repdte);
  if (!period) return null;
  let [year, q] = [Number(period.slice(0, 4)), Number(period.slice(5))];
  q -= 1;
  if (q === 0) { q = 4; year -= 1; }
  return `${year}${{ 1: '0331', 2: '0630', 3: '0930', 4: '1231' }[q]}`;
}

// All filers for one quarter, keyed by cert. Pages defensively even though
// one 10k page covers the whole industry today.
async function fetchQuarterByCert(repdte, fetchImpl, log) {
  const byCert = new Map();
  let offset = 0;
  for (;;) {
    const url = `${API_BASE}?filters=REPDTE:${repdte}&fields=${RIS_FIELDS.join(',')}` +
      `&limit=${PAGE_LIMIT}&offset=${offset}&format=json`;
    const page = await fetchJson(url, fetchImpl);
    const rows = (page.data || []).map(entry => entry && entry.data).filter(Boolean);
    for (const row of rows) {
      const cert = String(row.CERT || '').trim();
      if (cert) byCert.set(cert, row);
    }
    const total = page.meta && Number(page.meta.total) || rows.length;
    offset += rows.length;
    log('info', `FDIC sync: fetched ${offset}/${total} filers for ${repdte}`);
    if (!rows.length || offset >= total) break;
  }
  return byCert;
}

/**
 * Sync the latest FDIC-filed quarter into bank-data.sqlite.
 *
 * opts: { dryRun?, fetchImpl?, log?, repdte? (override for tests), stampDir? }
 * Returns { period, repdte, filers, matched, updated, skippedExisting, dryRun }.
 * Throws on network/API failure (callers surface the error to the admin).
 */
async function syncFdicQuarter(outputDir, opts = {}) {
  const dbPath = path.join(outputDir, BANK_DATABASE_FILENAME);
  const fetchImpl = opts.fetchImpl || fetch;
  const log = opts.log || (() => {});
  const dryRun = Boolean(opts.dryRun);
  const fieldCoverage = buildFieldCoverage();

  const repdte = opts.repdte || await getLatestFiledRepdte(fetchImpl);
  const period = repdteToPeriod(repdte);
  if (!period) throw new Error(`Unusable FDIC report date: ${repdte}`);

  const byCert = await fetchQuarterByCert(repdte, fetchImpl, log);

  const banks = sqliteDb.querySqliteJson(dbPath, `
    SELECT id, cert_number AS certNumber, detail_json AS detailJson FROM banks
    WHERE cert_number IS NOT NULL AND cert_number != '';
  `);

  let matched = 0;
  let skippedExisting = 0;
  let updated = 0;
  const updates = [];
  for (const row of banks) {
    const risRow = byCert.get(String(row.certNumber).trim());
    if (!risRow) continue;
    matched += 1;
    if (dryRun) {
      let bank = null;
      try { bank = JSON.parse(row.detailJson || '{}'); } catch (_) { bank = null; }
      if (bank && (bank.periods || []).some(p => p.period === period)) skippedExisting += 1;
      else updated += 1;
      continue;
    }
    updates.push({ id: String(row.id), risRow });
  }

  if (dryRun) {
    return { period, repdte, filers: byCert.size, matched, updated, skippedExisting, dryRun: true, fieldCoverage };
  }

  sqliteDb.withDatabase(dbPath, (db) => {
    const select = db.prepare('SELECT summary_json, detail_json FROM banks WHERE id = ?;');
    const update = db.prepare(`
      UPDATE banks SET period = ?, total_assets = ?, total_deposits = ?, summary_json = ?, detail_json = ?
      WHERE id = ?;
    `);
    const apply = db.transaction((items) => {
      for (const item of items) {
        const row = select.get(item.id);
        if (!row) continue;
        const bank = JSON.parse(row.detail_json);
        const summary = JSON.parse(row.summary_json);
        if ((bank.periods || []).some(p => p.period === period)) {
          skippedExisting += 1;
          continue;
        }
        const entry = buildFdicPeriodEntry(bank, period, item.risRow);
        bank.periods = [entry].concat(bank.periods || []).slice(0, 12);
        if (quarterRank(period) > quarterRank(summary.period)) {
          summary.period = period;
          summary.totalAssets = entry.values.totalAssets ?? summary.totalAssets;
          summary.totalDeposits = entry.values.totalDeposits ?? summary.totalDeposits;
          bank.summary = summary;
        }
        update.run(
          summary.period || null,
          summary.totalAssets ?? null,
          summary.totalDeposits ?? null,
          JSON.stringify(summary),
          JSON.stringify(bank),
          item.id
        );
        updated += 1;
      }
    });
    apply(updates);
    db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);')
      .run('fdicSync', JSON.stringify({ at: new Date().toISOString(), period, repdte, updated, skippedExisting, fieldCoverage }));
  });

  if (opts.stampDir) {
    fs.mkdirSync(opts.stampDir, { recursive: true });
    const stamp = {
      at: new Date().toISOString(),
      period,
      repdte,
      filers: byCert.size,
      matched,
      updated,
      skippedExisting,
      fieldCoverage: {
        mappedCount: fieldCoverage.mappedCount,
        carriedIdentityCount: fieldCoverage.carriedIdentityCount,
        remainingCount: fieldCoverage.remainingCount,
        warnings: fieldCoverage.warnings,
      },
    };
    const stampPath = path.join(opts.stampDir, 'fdic-sync-state.json');
    fs.writeFileSync(`${stampPath}.tmp-${process.pid}`, JSON.stringify(stamp, null, 2));
    fs.renameSync(`${stampPath}.tmp-${process.pid}`, stampPath);
  }

  log('info', `FDIC sync: ${period} — ${updated} banks updated, ${skippedExisting} already had the period, ${matched} matched of ${byCert.size} filers`);
  return { period, repdte, filers: byCert.size, matched, updated, skippedExisting, dryRun: false, fieldCoverage };
}

module.exports = {
  buildFieldCoverage,
  buildFdicPeriodEntry,
  getLatestFiledRepdte,
  mapRisRow,
  repdteToPeriod,
  syncFdicQuarter,
  RIS_FIELDS,
};
