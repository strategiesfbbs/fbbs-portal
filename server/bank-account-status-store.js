'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ACCOUNT_STATUS_DATABASE_FILENAME = 'bank-account-statuses.sqlite';
const ACCOUNT_STATUSES = new Set(['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant']);
const DEFAULT_ACCOUNT_STATUS = 'Open';

function accountStatusDatabasePathForDir(outputDir) {
  return path.join(outputDir, ACCOUNT_STATUS_DATABASE_FILENAME);
}

function sqlString(value) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(dbPath, sql, options = {}) {
  const result = childProcess.spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || `sqlite3 exited with status ${result.status}`).trim());
  }
  return result.stdout || '';
}

function querySqliteJson(dbPath, sql) {
  const result = childProcess.execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  const text = String(result || '').trim();
  return text ? JSON.parse(text) : [];
}

function ensureAccountStatusDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = accountStatusDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bank_account_statuses (
      bank_id TEXT PRIMARY KEY,
      cert_number TEXT,
      display_name TEXT,
      legal_name TEXT,
      city TEXT,
      state TEXT,
      status TEXT NOT NULL DEFAULT 'Open',
      source TEXT,
      owner TEXT,
      services TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_account_status_cert ON bank_account_statuses(cert_number);
    CREATE INDEX IF NOT EXISTS idx_bank_account_status_status ON bank_account_statuses(status);
  `);
  return dbPath;
}

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeCert(value) {
  const cleaned = cleanText(value, 80);
  if (!cleaned) return null;
  const noCommas = cleaned.replace(/,/g, '');
  if (/^[0-9]+(\.0+)?$/.test(noCommas)) return String(Number(noCommas));
  return noCommas;
}

function normalizeStatus(value, fallback = DEFAULT_ACCOUNT_STATUS) {
  const cleaned = cleanText(value, 40);
  return ACCOUNT_STATUSES.has(cleaned) ? cleaned : fallback;
}

function periodRank(period) {
  const q = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  if (q) return Number(q[1]) * 10 + Number(q[2]);
  const y = String(period || '').match(/^(\d{4})Y$/i);
  if (y) return Number(y[1]) * 10;
  return 0;
}

function normalizeComparableName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(the|national association|na|n a|bank|trust|company|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusSelectSql(where = '1 = 1') {
  return `
    SELECT
      bank_id AS bankId,
      cert_number AS certNumber,
      display_name AS displayName,
      legal_name AS legalName,
      city AS city,
      state AS state,
      status AS status,
      source AS source,
      owner AS owner,
      services AS services,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_account_statuses
    WHERE ${where}
  `;
}

function mapStatusRow(row, isStored = true) {
  if (!row) return null;
  return {
    bankId: row.bankId || '',
    certNumber: row.certNumber || '',
    displayName: row.displayName || '',
    legalName: row.legalName || '',
    city: row.city || '',
    state: row.state || '',
    status: row.status || DEFAULT_ACCOUNT_STATUS,
    source: row.source || (isStored ? 'manual' : 'default'),
    owner: row.owner || '',
    services: row.services || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    isStored
  };
}

function defaultAccountStatus(bankSummary = {}) {
  return mapStatusRow({
    bankId: bankSummary.id || bankSummary.bankId || '',
    certNumber: normalizeCert(bankSummary.certNumber) || '',
    displayName: bankSummary.displayName || bankSummary.name || '',
    legalName: bankSummary.name || bankSummary.legalName || '',
    city: bankSummary.city || '',
    state: bankSummary.state || '',
    status: DEFAULT_ACCOUNT_STATUS,
    source: 'default'
  }, false);
}

function getBankAccountStatus(outputDir, bankId) {
  const dbPath = ensureAccountStatusDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${statusSelectSql(`bank_id = ${sqlString(String(bankId || ''))}`)} LIMIT 1;`);
  return rows.length ? mapStatusRow(rows[0], true) : null;
}

function getBankAccountStatuses(outputDir, bankIds = []) {
  const ids = [...new Set(bankIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureAccountStatusDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    ${statusSelectSql(`bank_id IN (${ids.map(sqlString).join(',')})`)};
  `);
  return new Map(rows.map(row => [String(row.bankId), mapStatusRow(row, true)]));
}

function upsertBankAccountStatus(outputDir, bankSummary, input = {}) {
  const dbPath = ensureAccountStatusDatabase(outputDir);
  const summary = bankSummary || {};
  const bankId = cleanText(summary.id || summary.bankId, 80);
  if (!bankId) throw new Error('Bank ID is required');
  const existing = getBankAccountStatus(outputDir, bankId);
  const now = new Date().toISOString();
  const status = normalizeStatus(input.status, existing ? existing.status : DEFAULT_ACCOUNT_STATUS);
  const source = cleanText(input.source, 80) || (existing ? existing.source : 'manual');
  const owner = input.owner !== undefined ? cleanText(input.owner, 120) : (existing ? existing.owner : null);
  const services = input.services !== undefined ? cleanText(input.services, 500) : (existing ? existing.services : null);
  const createdAt = existing ? existing.createdAt : now;

  runSqlite(dbPath, `
    INSERT INTO bank_account_statuses (
      bank_id, cert_number, display_name, legal_name, city, state, status, source,
      owner, services, created_at, updated_at
    ) VALUES (
      ${sqlString(bankId)},
      ${sqlString(normalizeCert(summary.certNumber))},
      ${sqlString(cleanText(summary.displayName || summary.name || 'Bank', 300) || 'Bank')},
      ${sqlString(cleanText(summary.name || summary.legalName, 300))},
      ${sqlString(cleanText(summary.city, 120))},
      ${sqlString(cleanText(summary.state, 40))},
      ${sqlString(status)},
      ${sqlString(source)},
      ${sqlString(owner)},
      ${sqlString(services)},
      ${sqlString(createdAt)},
      ${sqlString(now)}
    )
    ON CONFLICT(bank_id) DO UPDATE SET
      cert_number = excluded.cert_number,
      display_name = excluded.display_name,
      legal_name = excluded.legal_name,
      city = excluded.city,
      state = excluded.state,
      status = excluded.status,
      source = excluded.source,
      owner = excluded.owner,
      services = excluded.services,
      updated_at = excluded.updated_at;
  `);

  return getBankAccountStatus(outputDir, bankId);
}

function bankStatusInsertSql(row, now) {
  return `INSERT INTO bank_account_statuses (
    bank_id, cert_number, display_name, legal_name, city, state, status, source,
    owner, services, created_at, updated_at
  ) VALUES (
    ${sqlString(row.bankId)},
    ${sqlString(row.certNumber)},
    ${sqlString(row.displayName)},
    ${sqlString(row.legalName)},
    ${sqlString(row.city)},
    ${sqlString(row.state)},
    ${sqlString(row.status)},
    ${sqlString(row.source)},
    NULL,
    NULL,
    ${sqlString(now)},
    ${sqlString(now)}
  )
  ON CONFLICT(bank_id) DO UPDATE SET
    cert_number = excluded.cert_number,
    display_name = excluded.display_name,
    legal_name = excluded.legal_name,
    city = excluded.city,
    state = excluded.state,
    status = excluded.status,
    source = excluded.source,
    updated_at = excluded.updated_at;`;
}

function upsertBankAccountStatusRows(outputDir, rows) {
  if (!rows.length) return;
  const dbPath = ensureAccountStatusDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, [
    'BEGIN TRANSACTION;',
    ...rows.map(row => bankStatusInsertSql(row, now)),
    'COMMIT;'
  ].join('\n'), { maxBuffer: 128 * 1024 * 1024 });
}

function findStatusSheet(workbook) {
  let best = null;
  for (const sheetName of workbook.SheetNames || []) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      blankrows: false,
      raw: false
    });
    if (!rows.length) continue;
    const header = (rows[0] || []).map(value => cleanText(value, 80) || '');
    const statusIndex = header.findIndex(value => /^status$/i.test(value));
    const certIndex = header.findIndex(value => /^cert number$/i.test(value));
    if (statusIndex < 0 || certIndex < 0) continue;
    const nonBlankStatusRows = rows.slice(1).filter(row => cleanText(row[statusIndex], 40)).length;
    const blankStatusRows = rows.slice(1).filter(row => normalizeCert(row[certIndex]) && !cleanText(row[statusIndex], 40)).length;
    const score = (nonBlankStatusRows * 10) - blankStatusRows - header.length;
    if (!best || score > best.score) {
      best = { sheetName, rows, header, statusIndex, certIndex, score };
    }
  }
  if (!best) throw new Error('Could not find Status and Cert Number columns in the account status workbook.');
  return best;
}

function chooseBankForStatus(row, matches) {
  if (!matches || !matches.length) return null;
  let best = null;
  let bestScore = -Infinity;
  const rowName = normalizeComparableName(row.name);
  for (const match of matches) {
    let score = periodRank(match.period);
    if (row.state && String(match.state || '').toUpperCase() === String(row.state).toUpperCase()) score += 3;
    if (row.city && String(match.city || '').toLowerCase() === String(row.city).toLowerCase()) score += 3;
    if (rowName) {
      const matchName = normalizeComparableName(match.displayName || match.name);
      if (matchName === rowName) score += 10;
      else if (matchName.includes(rowName) || rowName.includes(matchName)) score += 5;
    }
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best;
}

function importBankAccountStatusWorkbook(outputDir, workbookInput, bankSummaries, options = {}) {
  const workbook = Buffer.isBuffer(workbookInput)
    ? XLSX.read(workbookInput, { type: 'buffer', raw: false })
    : XLSX.readFile(workbookInput, { raw: false });
  const statusSheet = findStatusSheet(workbook);
  const nameIndex = statusSheet.header.findIndex(value => /^account name$/i.test(value));
  const cityIndex = statusSheet.header.findIndex(value => /^city$/i.test(value));
  const stateIndex = statusSheet.header.findIndex(value => /^state$/i.test(value));
  const byCert = new Map();

  for (const summary of bankSummaries || []) {
    const cert = normalizeCert(summary.certNumber);
    if (!cert) continue;
    if (!byCert.has(cert)) byCert.set(cert, []);
    byCert.get(cert).push(summary);
  }

  const seenCerts = new Map();
  const stats = {
    sourceFile: options.sourceFile || '',
    importedAt: new Date().toISOString(),
    sheetName: statusSheet.sheetName,
    rowCount: 0,
    importedCount: 0,
    unmatchedCount: 0,
    duplicateCount: 0,
    conflictCount: 0,
    invalidStatusCount: 0,
    statuses: {}
  };

  for (let i = 1; i < statusSheet.rows.length; i++) {
    const sourceRow = statusSheet.rows[i] || [];
    const cert = normalizeCert(sourceRow[statusSheet.certIndex]);
    if (!cert) continue;
    const rawStatus = cleanText(sourceRow[statusSheet.statusIndex], 40);
    const status = normalizeStatus(rawStatus, DEFAULT_ACCOUNT_STATUS);
    if (rawStatus && status !== rawStatus) stats.invalidStatusCount += 1;
    const row = {
      rowNumber: i + 1,
      cert,
      status,
      name: nameIndex >= 0 ? cleanText(sourceRow[nameIndex], 300) : null,
      city: cityIndex >= 0 ? cleanText(sourceRow[cityIndex], 120) : null,
      state: stateIndex >= 0 ? cleanText(sourceRow[stateIndex], 40) : null
    };
    stats.rowCount += 1;
    stats.statuses[status] = (stats.statuses[status] || 0) + 1;
    if (seenCerts.has(cert)) {
      stats.duplicateCount += 1;
      if (seenCerts.get(cert).status !== status) stats.conflictCount += 1;
    }
    seenCerts.set(cert, row);
  }

  const matchedRows = [];
  for (const row of seenCerts.values()) {
    const bank = chooseBankForStatus(row, byCert.get(row.cert) || []);
    if (!bank) {
      stats.unmatchedCount += 1;
      continue;
    }
    matchedRows.push({
      bankId: cleanText(bank.id || bank.bankId, 80),
      certNumber: normalizeCert(bank.certNumber),
      displayName: cleanText(bank.displayName || bank.name || 'Bank', 300) || 'Bank',
      legalName: cleanText(bank.name || bank.legalName, 300),
      city: cleanText(bank.city, 120),
      state: cleanText(bank.state, 40),
      status: row.status,
      source: options.sourceFile || 'account-status-workbook'
    });
    stats.importedCount += 1;
  }
  upsertBankAccountStatusRows(outputDir, matchedRows);

  return stats;
}

module.exports = {
  ACCOUNT_STATUS_DATABASE_FILENAME,
  ACCOUNT_STATUSES,
  DEFAULT_ACCOUNT_STATUS,
  accountStatusDatabasePathForDir,
  defaultAccountStatus,
  ensureAccountStatusDatabase,
  getBankAccountStatus,
  getBankAccountStatuses,
  importBankAccountStatusWorkbook,
  normalizeCert,
  normalizeStatus,
  upsertBankAccountStatus,
  upsertBankAccountStatusRows
};
