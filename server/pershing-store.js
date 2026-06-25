'use strict';

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const PERSHING_DATABASE_FILENAME = 'pershing-accounts.sqlite';

function pershingDatabasePathForDir(outputDir) {
  return path.join(outputDir, PERSHING_DATABASE_FILENAME);
}

function runSqlite(dbPath, sql, params) {
  if (params === undefined) { sqliteDb.execSqlite(dbPath, sql); return ''; }
  return sqliteDb.runSqlite(dbPath, sql, params);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

function ensurePershingDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = pershingDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pershing_accounts (
      salesforce_pershing_id TEXT PRIMARY KEY,
      salesforce_account_id TEXT NOT NULL,
      account_name TEXT,
      bank_id TEXT,
      cert_number TEXT,
      bank_match_status TEXT,
      display_name TEXT,
      city TEXT,
      state TEXT,
      pershing_account_number TEXT NOT NULL,
      most_recent_trade_date TEXT,
      primary_owner_id TEXT,
      primary_owner_name TEXT,
      secondary_owner_id TEXT,
      secondary_owner_name TEXT,
      account_owner_id TEXT,
      account_owner_name TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      source_file TEXT,
      UNIQUE(salesforce_account_id, pershing_account_number)
    );
    CREATE INDEX IF NOT EXISTS idx_pershing_bank ON pershing_accounts(bank_id);
    CREATE INDEX IF NOT EXISTS idx_pershing_cert ON pershing_accounts(cert_number);
    CREATE INDEX IF NOT EXISTS idx_pershing_trade_date ON pershing_accounts(most_recent_trade_date);
    CREATE INDEX IF NOT EXISTS idx_pershing_primary_owner ON pershing_accounts(primary_owner_name);
    CREATE TABLE IF NOT EXISTS pershing_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const columns = querySqliteJson(dbPath, 'PRAGMA table_info(pershing_accounts);').map(row => row.name);
  const migrations = [
    ['account_name', 'ALTER TABLE pershing_accounts ADD COLUMN account_name TEXT;'],
    ['bank_match_status', 'ALTER TABLE pershing_accounts ADD COLUMN bank_match_status TEXT;'],
    ['account_owner_id', 'ALTER TABLE pershing_accounts ADD COLUMN account_owner_id TEXT;'],
    ['account_owner_name', 'ALTER TABLE pershing_accounts ADD COLUMN account_owner_name TEXT;']
  ];
  for (const [column, sql] of migrations) {
    if (!columns.includes(column)) runSqlite(dbPath, sql);
  }
  return dbPath;
}

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return '';
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : '';
}

function textOrNull(value, maxLength = 300) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

function normalizeCert(value) {
  const cleaned = cleanText(value, 80).replace(/,/g, '');
  if (!cleaned) return '';
  if (/^[0-9]+(\.0+)?$/.test(cleaned)) return String(Number(cleaned));
  return cleaned;
}

function normalizeSalesforceId(value) {
  return cleanText(value, 32);
}

function salesforceLookupKeys(value) {
  const id = normalizeSalesforceId(value);
  if (!id) return [];
  const keys = [id, id.toLowerCase()];
  if (id.length >= 15) {
    keys.push(id.slice(0, 15), id.slice(0, 15).toLowerCase());
  }
  return [...new Set(keys)];
}

function lookupBySalesforceId(mapLike, value) {
  if (!mapLike || !value) return null;
  for (const key of salesforceLookupKeys(value)) {
    if (mapLike instanceof Map && mapLike.has(key)) return mapLike.get(key);
    if (!(mapLike instanceof Map) && Object.prototype.hasOwnProperty.call(mapLike, key)) return mapLike[key];
  }
  return null;
}

function field(row, names) {
  if (!row) return '';
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  }
  const lower = {};
  for (const [key, value] of Object.entries(row)) lower[String(key).toLowerCase()] = value;
  for (const name of names) {
    const key = String(name).toLowerCase();
    if (lower[key] !== undefined && lower[key] !== null && lower[key] !== '') return lower[key];
  }
  return '';
}

function normalizeDate(value) {
  const raw = cleanText(value, 40);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function booleanValue(value) {
  return /^(1|true|yes|y)$/i.test(cleanText(value, 20));
}

function resolveRepName(repMap, repId) {
  const found = lookupBySalesforceId(repMap, repId);
  if (!found) return '';
  if (typeof found === 'string') return found;
  return cleanText(found.displayName || found.name || [found.firstName, found.lastName].filter(Boolean).join(' '), 200);
}

function normalizeAccountEntry(entry) {
  if (!entry) return {};
  return {
    bankId: cleanText(entry.bankId || entry.id, 80),
    certNumber: normalizeCert(entry.certNumber || entry.cert || entry.Cert_Number__c),
    accountName: cleanText(entry.accountName || entry.salesforceAccountName || entry.Name || entry.name, 240),
    matchStatus: cleanText(entry.matchStatus || entry.matchState || entry.bankMatchStatus, 40),
    ownerId: normalizeSalesforceId(entry.ownerId || entry.OwnerId),
    displayName: cleanText(entry.displayName || entry.name || entry.Name, 240),
    city: cleanText(entry.city || entry.City__c || entry.BillingCity, 120),
    state: cleanText(entry.state || entry.State__c || entry.BillingState, 40)
  };
}

function mapPershingRecord(row, options = {}) {
  const accountMap = options.accountMap || new Map();
  const repMap = options.repMap || new Map();
  const sourceFile = cleanText(options.sourceFile, 260);
  const importedAt = options.importedAt || new Date().toISOString();
  const salesforcePershingId = normalizeSalesforceId(field(row, ['salesforcePershingId', 'Id', 'id']));
  const salesforceAccountId = normalizeSalesforceId(field(row, ['salesforceAccountId', 'Account__c', 'account__c']));
  const account = normalizeAccountEntry(lookupBySalesforceId(accountMap, salesforceAccountId));
  const primaryOwnerId = normalizeSalesforceId(field(row, ['primaryOwnerId', 'Owner_1__c', 'owner_1__c']));
  const secondaryOwnerId = normalizeSalesforceId(field(row, ['secondaryOwnerId', 'Owner__c', 'owner__c']));
  const bankMatchStatus = account.matchStatus || (account.bankId ? 'matched' : (account.certNumber ? 'unmatched' : 'no_cert'));
  return {
    salesforcePershingId,
    salesforceAccountId,
    accountName: account.accountName || '',
    bankId: account.bankId || '',
    certNumber: account.certNumber || '',
    bankMatchStatus,
    displayName: account.displayName || account.accountName || '',
    city: account.city || '',
    state: account.state || '',
    pershingAccountNumber: cleanText(field(row, ['pershingAccountNumber', 'Name', 'name']), 40),
    mostRecentTradeDate: normalizeDate(field(row, ['mostRecentTradeDate', 'Most_Recent_Trade_Date__c', 'most_recent_trade_date__c'])),
    primaryOwnerId,
    primaryOwnerName: resolveRepName(repMap, primaryOwnerId),
    secondaryOwnerId,
    secondaryOwnerName: resolveRepName(repMap, secondaryOwnerId),
    accountOwnerId: account.ownerId || '',
    accountOwnerName: resolveRepName(repMap, account.ownerId),
    isDeleted: booleanValue(field(row, ['isDeleted', 'IsDeleted', 'isdeleted'])),
    importedAt,
    sourceFile
  };
}

function validateMappedRecord(record) {
  if (!record.salesforcePershingId) return 'Missing Salesforce Pershing row id';
  if (!record.salesforceAccountId) return 'Missing Salesforce Account id';
  if (!record.pershingAccountNumber) return 'Missing Pershing account number';
  return '';
}

function summarizeImport(records, options = {}) {
  const accountIds = new Set();
  const matchedAccounts = new Set();
  const unmatchedAccounts = new Set();
  const bankIds = new Set();
  let skippedDeleted = 0;
  let invalidRows = 0;
  let rowsWithTradeDate = 0;
  let oldestTradeDate = '';
  let latestTradeDate = '';
  for (const record of records) {
    if (record.isDeleted) { skippedDeleted += 1; continue; }
    const error = validateMappedRecord(record);
    if (error) { invalidRows += 1; continue; }
    accountIds.add(record.salesforceAccountId);
    if (record.bankId) {
      matchedAccounts.add(record.salesforceAccountId);
      bankIds.add(record.bankId);
    } else {
      unmatchedAccounts.add(record.salesforceAccountId);
    }
    if (record.mostRecentTradeDate) {
      rowsWithTradeDate += 1;
      if (!oldestTradeDate || record.mostRecentTradeDate < oldestTradeDate) oldestTradeDate = record.mostRecentTradeDate;
      if (!latestTradeDate || record.mostRecentTradeDate > latestTradeDate) latestTradeDate = record.mostRecentTradeDate;
    }
  }
  const activeRows = records.length - skippedDeleted - invalidRows;
  return {
    sourceFile: cleanText(options.sourceFile, 260),
    importedAt: options.importedAt || '',
    dryRun: Boolean(options.dryRun),
    totalRows: records.length,
    skippedDeleted,
    invalidRows,
    importedCount: activeRows,
    matchedRows: records.filter(r => !r.isDeleted && !validateMappedRecord(r) && r.bankId).length,
    unmatchedRows: records.filter(r => !r.isDeleted && !validateMappedRecord(r) && !r.bankId).length,
    salesforceAccountCount: accountIds.size,
    matchedAccountCount: matchedAccounts.size,
    unmatchedAccountCount: unmatchedAccounts.size,
    bankCount: bankIds.size,
    rowsWithTradeDate,
    rowsWithoutTradeDate: Math.max(0, activeRows - rowsWithTradeDate),
    oldestTradeDate: oldestTradeDate || null,
    latestTradeDate: latestTradeDate || null
  };
}

function importPershingAccounts(outputDir, rows, options = {}) {
  const importedAt = options.importedAt || new Date().toISOString();
  const sourceFile = cleanText(options.sourceFile || '', 260);
  const mapped = (rows || []).map(row => mapPershingRecord(row, { ...options, importedAt, sourceFile }));
  const stats = summarizeImport(mapped, { importedAt, sourceFile, dryRun: options.dryRun });
  if (options.dryRun) return stats;

  const dbPath = ensurePershingDatabase(outputDir);
  sqliteDb.withDatabase(dbPath, db => {
    const insert = db.prepare(`
      INSERT INTO pershing_accounts (
        salesforce_pershing_id, salesforce_account_id, account_name, bank_id, cert_number,
        bank_match_status, display_name, city, state, pershing_account_number, most_recent_trade_date,
        primary_owner_id, primary_owner_name, secondary_owner_id, secondary_owner_name,
        account_owner_id, account_owner_name, is_deleted, imported_at, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    const meta = db.prepare(`
      INSERT INTO pershing_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM pershing_accounts;').run();
      for (const record of mapped) {
        if (record.isDeleted || validateMappedRecord(record)) continue;
        insert.run(
          record.salesforcePershingId,
          record.salesforceAccountId,
          textOrNull(record.accountName, 240),
          textOrNull(record.bankId, 80),
          textOrNull(record.certNumber, 80),
          textOrNull(record.bankMatchStatus, 40),
          textOrNull(record.displayName, 240),
          textOrNull(record.city, 120),
          textOrNull(record.state, 40),
          record.pershingAccountNumber,
          textOrNull(record.mostRecentTradeDate, 20),
          textOrNull(record.primaryOwnerId, 32),
          textOrNull(record.primaryOwnerName, 200),
          textOrNull(record.secondaryOwnerId, 32),
          textOrNull(record.secondaryOwnerName, 200),
          textOrNull(record.accountOwnerId, 32),
          textOrNull(record.accountOwnerName, 200),
          record.isDeleted ? 1 : 0,
          importedAt,
          textOrNull(sourceFile, 260)
        );
      }
      for (const [key, value] of Object.entries(stats)) {
        meta.run(key, value === null || value === undefined ? '' : String(value));
      }
    });
    tx();
  });
  return stats;
}

function rowToAccount(row) {
  return {
    salesforcePershingId: row.salesforcePershingId || '',
    salesforceAccountId: row.salesforceAccountId || '',
    accountName: row.accountName || '',
    bankId: row.bankId || '',
    certNumber: row.certNumber || '',
    bankMatchStatus: row.bankMatchStatus || '',
    displayName: row.displayName || '',
    city: row.city || '',
    state: row.state || '',
    pershingAccountNumber: row.pershingAccountNumber || '',
    mostRecentTradeDate: row.mostRecentTradeDate || '',
    primaryOwnerId: row.primaryOwnerId || '',
    primaryOwnerName: row.primaryOwnerName || '',
    secondaryOwnerId: row.secondaryOwnerId || '',
    secondaryOwnerName: row.secondaryOwnerName || '',
    accountOwnerId: row.accountOwnerId || '',
    accountOwnerName: row.accountOwnerName || '',
    importedAt: row.importedAt || '',
    sourceFile: row.sourceFile || ''
  };
}

function daysBetween(asOfDate, date) {
  if (!asOfDate || !date) return null;
  const a = Date.parse(asOfDate);
  const d = Date.parse(date);
  if (!Number.isFinite(a) || !Number.isFinite(d)) return null;
  return Math.max(0, Math.round((a - d) / 86400000));
}

function buildRollup(accounts, asOfDate) {
  const live = (accounts || []).filter(a => a && a.pershingAccountNumber);
  const dated = live.filter(a => a.mostRecentTradeDate);
  const latestTradeDate = dated.map(a => a.mostRecentTradeDate).sort().pop() || '';
  const ownerCounts = new Map();
  live.forEach(a => {
    const owner = a.primaryOwnerName || a.primaryOwnerId || '';
    if (owner) ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
  });
  const owners = [...ownerCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    bankId: live[0] ? live[0].bankId : '',
    certNumber: live[0] ? live[0].certNumber : '',
    displayName: live[0] ? live[0].displayName : '',
    city: live[0] ? live[0].city : '',
    state: live[0] ? live[0].state : '',
    accountCount: live.length,
    datedAccountCount: dated.length,
    latestTradeDate,
    daysSinceLatestTrade: latestTradeDate ? daysBetween(asOfDate, latestTradeDate) : null,
    owners
  };
}

function splitNames(value) {
  return String(value || '')
    .split(',')
    .map(s => cleanText(s, 200))
    .filter(Boolean)
    .filter((name, idx, arr) => arr.indexOf(name) === idx);
}

function getPershingForBank(outputDir, bankId, options = {}) {
  const dbPath = ensurePershingDatabase(outputDir);
  const limit = Math.max(1, Math.min(Number(options.limit) || 250, 1000));
  const rows = querySqliteJson(dbPath, `
    SELECT
      salesforce_pershing_id AS salesforcePershingId,
      salesforce_account_id AS salesforceAccountId,
      account_name AS accountName,
      bank_id AS bankId,
      cert_number AS certNumber,
      bank_match_status AS bankMatchStatus,
      display_name AS displayName,
      city,
      state,
      pershing_account_number AS pershingAccountNumber,
      most_recent_trade_date AS mostRecentTradeDate,
      primary_owner_id AS primaryOwnerId,
      primary_owner_name AS primaryOwnerName,
      secondary_owner_id AS secondaryOwnerId,
      secondary_owner_name AS secondaryOwnerName,
      account_owner_id AS accountOwnerId,
      account_owner_name AS accountOwnerName,
      imported_at AS importedAt,
      source_file AS sourceFile
    FROM pershing_accounts
    WHERE bank_id = ? AND is_deleted = 0
    ORDER BY
      CASE WHEN most_recent_trade_date IS NULL OR most_recent_trade_date = '' THEN 1 ELSE 0 END ASC,
      most_recent_trade_date DESC,
      pershing_account_number COLLATE NOCASE ASC
    LIMIT ?;
  `, [String(bankId || ''), limit]).map(rowToAccount);
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  return { bankId: String(bankId || ''), rollup: buildRollup(rows, asOfDate), accounts: rows };
}

function getPershingRollupsForBanks(outputDir, bankIds, options = {}) {
  const ids = [...new Set((bankIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensurePershingDatabase(outputDir);
  const placeholders = ids.map(() => '?').join(',');
  const rows = querySqliteJson(dbPath, `
    SELECT
      salesforce_pershing_id AS salesforcePershingId,
      salesforce_account_id AS salesforceAccountId,
      account_name AS accountName,
      bank_id AS bankId,
      cert_number AS certNumber,
      bank_match_status AS bankMatchStatus,
      display_name AS displayName,
      city,
      state,
      pershing_account_number AS pershingAccountNumber,
      most_recent_trade_date AS mostRecentTradeDate,
      primary_owner_id AS primaryOwnerId,
      primary_owner_name AS primaryOwnerName,
      secondary_owner_id AS secondaryOwnerId,
      secondary_owner_name AS secondaryOwnerName,
      account_owner_id AS accountOwnerId,
      account_owner_name AS accountOwnerName,
      imported_at AS importedAt,
      source_file AS sourceFile
    FROM pershing_accounts
    WHERE bank_id IN (${placeholders}) AND is_deleted = 0;
  `, ids).map(rowToAccount);
  const grouped = new Map();
  rows.forEach(row => {
    if (!grouped.has(row.bankId)) grouped.set(row.bankId, []);
    grouped.get(row.bankId).push(row);
  });
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  return new Map([...grouped.entries()].map(([id, accounts]) => [id, buildRollup(accounts, asOfDate)]));
}

function getPershingImportStatus(outputDir) {
  const dbPath = pershingDatabasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return { available: false, importedAt: '', accountCount: 0, bankCount: 0 };
  ensurePershingDatabase(outputDir);
  const metaRows = querySqliteJson(dbPath, 'SELECT key, value FROM pershing_meta;');
  const meta = Object.fromEntries(metaRows.map(row => [row.key, row.value]));
  const counts = querySqliteJson(dbPath, `
    SELECT
      COUNT(*) AS accountCount,
      COUNT(DISTINCT bank_id) AS bankCount,
      SUM(CASE WHEN bank_id IS NULL OR bank_id = '' THEN 1 ELSE 0 END) AS unmatchedRows,
      MAX(most_recent_trade_date) AS latestTradeDate
    FROM pershing_accounts
    WHERE is_deleted = 0;
  `)[0] || {};
  return {
    available: Number(counts.accountCount || 0) > 0,
    importedAt: meta.importedAt || '',
    sourceFile: meta.sourceFile || '',
    accountCount: Number(counts.accountCount || 0),
    bankCount: Number(counts.bankCount || 0),
    unmatchedRows: Number(counts.unmatchedRows || 0),
    latestTradeDate: counts.latestTradeDate || meta.latestTradeDate || ''
  };
}

function listDormantPershingBanks(outputDir, options = {}) {
  const dbPath = ensurePershingDatabase(outputDir);
  const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
  const dormantDays = Math.max(1, Number(options.dormantDays) || 365);
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 1000));
  const cutoff = new Date(Date.parse(asOfDate) - dormantDays * 86400000).toISOString().slice(0, 10);
  const owner = cleanText(options.owner, 200).toLowerCase();
  const includeUndated = options.includeUndated === true || options.includeUndated === '1';
  const params = [];
  let ownerSql = '';
  if (owner) {
    ownerSql = 'AND (LOWER(primary_owner_name) LIKE ? OR LOWER(account_owner_name) LIKE ?)';
    params.push(`%${owner}%`);
    params.push(`%${owner}%`);
  }
  params.push(cutoff);
  params.push(limit);
  const having = includeUndated
    ? `HAVING latestTradeDate IS NULL OR latestTradeDate = '' OR latestTradeDate < ?`
    : `HAVING latestTradeDate IS NOT NULL AND latestTradeDate <> '' AND latestTradeDate < ?`;
  const rows = querySqliteJson(dbPath, `
    SELECT
      bank_id AS bankId,
      cert_number AS certNumber,
      display_name AS displayName,
      city,
      state,
      COUNT(*) AS accountCount,
      SUM(CASE WHEN most_recent_trade_date IS NULL OR most_recent_trade_date = '' THEN 0 ELSE 1 END) AS datedAccountCount,
      MAX(most_recent_trade_date) AS latestTradeDate,
      GROUP_CONCAT(DISTINCT primary_owner_name) AS primaryOwnerNames,
      GROUP_CONCAT(DISTINCT account_owner_name) AS accountOwnerNames
    FROM pershing_accounts
    WHERE is_deleted = 0
      AND bank_id IS NOT NULL
      AND bank_id <> ''
      ${ownerSql}
    GROUP BY bank_id
    ${having}
    ORDER BY
      CASE WHEN latestTradeDate IS NULL OR latestTradeDate = '' THEN 0 ELSE 1 END ASC,
      latestTradeDate ASC,
      display_name COLLATE NOCASE ASC
    LIMIT ?;
  `, params);
  return rows.map(row => ({
    bankId: row.bankId || '',
    certNumber: row.certNumber || '',
    displayName: row.displayName || row.bankId || '',
    city: row.city || '',
    state: row.state || '',
    accountCount: Number(row.accountCount || 0),
    datedAccountCount: Number(row.datedAccountCount || 0),
    latestTradeDate: row.latestTradeDate || '',
    daysSinceLatestTrade: row.latestTradeDate ? daysBetween(asOfDate, row.latestTradeDate) : null,
    primaryOwnerName: splitNames(row.primaryOwnerNames)[0] || '',
    primaryOwnerNames: splitNames(row.primaryOwnerNames),
    accountOwnerNames: splitNames(row.accountOwnerNames)
  }));
}

module.exports = {
  PERSHING_DATABASE_FILENAME,
  pershingDatabasePathForDir,
  ensurePershingDatabase,
  importPershingAccounts,
  getPershingForBank,
  getPershingRollupsForBanks,
  getPershingImportStatus,
  listDormantPershingBanks,
  mapPershingRecord
};
