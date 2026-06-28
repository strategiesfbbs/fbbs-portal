'use strict';

// Salesforce Trade__c blotter → portal trade store.
//
// Extends the Pershing vertical (server/pershing-store.js, account-level last-trade
// recency) with the 139K-row line-item bond blotter. Spec:
// docs/salesforce-trade-store-spec-2026-06-28.md.
//
// The trades table co-locates in pershing-accounts.sqlite so the
// trade -> pershing_account -> bank join is one DB. There is NO direct
// Trade->Account link in Salesforce: every trade joins through its Pershing
// Account (master-detail). Each trade's bank_id is denormalized at import time
// from the already-resolved pershing_accounts.bank_id so per-bank reads are a
// single indexed lookup, not a 3-way join over 139K rows.
//
// Idempotent: upsert keyed on salesforce_trade_id (the trade's own 18-char Id),
// mirroring bank_contacts.salesforce_contact_id. Re-importing the same export
// updates in place; it never duplicates.

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

function tradesDatabasePathForDir(outputDir) {
  // Same file as the Pershing store — one DB for the whole join spine.
  return path.join(outputDir, 'pershing-accounts.sqlite');
}

// ---- small value helpers (self-contained; mirror pershing-store conventions) ----

function cleanText(value, maxLength = 300) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function textOrNull(value, maxLength = 300) {
  const text = cleanText(value, maxLength);
  return text === '' ? null : text;
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

function numberOrNull(value) {
  const raw = cleanText(value, 40).replace(/[%$,]/g, '');
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value) {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n);
}

function normalizeDate(value) {
  const raw = cleanText(value, 40);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`;
  const mdy2 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdy2) {
    const yr = Number(mdy2[3]) > 50 ? `19${mdy2[3]}` : `20${mdy2[3]}`;
    return `${yr}-${String(mdy2[1]).padStart(2, '0')}-${String(mdy2[2]).padStart(2, '0')}`;
  }
  return raw.slice(0, 10);
}

function normalizeSalesforceId(value) {
  return cleanText(value, 32);
}

function salesforceLookupKeys(value) {
  const id = normalizeSalesforceId(value);
  if (!id) return [];
  const keys = [id];
  if (id.length >= 15) keys.push(id.slice(0, 15));
  return [...new Set(keys)];
}

function booleanValue(value) {
  return /^(1|true|yes|y)$/i.test(cleanText(value, 20));
}

function resolveRepName(repMap, repId) {
  if (!repMap || !repId) return '';
  for (const key of salesforceLookupKeys(repId)) {
    const found = repMap instanceof Map ? repMap.get(key) : repMap[key];
    if (found) return typeof found === 'string' ? found : cleanText(found.displayName || found.name, 200);
  }
  return '';
}

// ---- schema ----

function ensureTradesTable(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteDb.execSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS trades (
      salesforce_trade_id TEXT PRIMARY KEY,
      salesforce_pershing_id TEXT NOT NULL,
      trade_name TEXT,
      cusip TEXT,
      issuer TEXT,
      description TEXT,
      buy_sell TEXT,
      callable TEXT,
      typecode TEXT,
      coupon REAL,
      yield REAL,
      price REAL,
      qty INTEGER,
      activity_date TEXT,
      trade_date TEXT,
      settlement_date TEXT,
      maturity TEXT,
      owner_1_id TEXT,
      owner_1_name TEXT,
      owner_2_id TEXT,
      owner_2_name TEXT,
      bank_id TEXT,
      cert_number TEXT,
      bank_match_status TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      source_file TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_pershing ON trades(salesforce_pershing_id);
    CREATE INDEX IF NOT EXISTS idx_trades_bank ON trades(bank_id);
    CREATE INDEX IF NOT EXISTS idx_trades_cusip ON trades(cusip);
    CREATE INDEX IF NOT EXISTS idx_trades_trade_date ON trades(trade_date);
    CREATE INDEX IF NOT EXISTS idx_trades_bank_date ON trades(bank_id, trade_date);
    CREATE TABLE IF NOT EXISTS trades_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return dbPath;
}

// pershingId -> { bankId, certNumber, matchStatus } from the already-imported
// pershing_accounts table (the bank join is resolved there). Read-only.
function buildPershingMapFromDb(dbPath) {
  const map = new Map();
  let rows = [];
  try {
    rows = sqliteDb.querySqliteJson(dbPath, `
      SELECT salesforce_pershing_id AS id, bank_id AS bankId, cert_number AS cert, bank_match_status AS matchStatus
      FROM pershing_accounts WHERE is_deleted = 0;
    `);
  } catch (e) {
    // pershing_accounts not imported yet — every trade falls to unmatched.
    return map;
  }
  for (const row of rows) {
    const entry = { bankId: cleanText(row.bankId, 80), certNumber: cleanText(row.cert, 80), matchStatus: cleanText(row.matchStatus, 40) };
    for (const key of salesforceLookupKeys(row.id)) map.set(key, entry);
  }
  return map;
}

function lookupPershing(pershingMap, pershingId) {
  if (!pershingMap || !pershingId) return null;
  for (const key of salesforceLookupKeys(pershingId)) {
    const found = pershingMap instanceof Map ? pershingMap.get(key) : pershingMap[key];
    if (found) return found;
  }
  return null;
}

// ---- pure mapping ----

function mapTradeRecord(row, options = {}) {
  const pershingMap = options.pershingMap || new Map();
  const repMap = options.repMap || new Map();
  const sourceFile = cleanText(options.sourceFile, 260);
  const importedAt = options.importedAt || new Date().toISOString();

  const salesforceTradeId = normalizeSalesforceId(field(row, ['salesforceTradeId', 'Id', 'id', 'Trade_Id_18__c']));
  const salesforcePershingId = normalizeSalesforceId(field(row, ['salesforcePershingId', 'Pershing_Account__c', 'pershing_account__c']));
  const pershing = lookupPershing(pershingMap, salesforcePershingId) || {};
  const owner1Id = normalizeSalesforceId(field(row, ['Owner_1__c', 'owner_1__c', 'owner1Id']));
  const owner2Id = normalizeSalesforceId(field(row, ['Owner__c', 'owner__c', 'owner2Id']));
  const bankMatchStatus = pershing.bankId ? 'matched' : (salesforcePershingId ? 'unmatched' : 'no_pershing');

  return {
    salesforceTradeId,
    salesforcePershingId,
    tradeName: cleanText(field(row, ['Name', 'name', 'tradeName']), 60),
    cusip: cleanText(field(row, ['CUSIP__c', 'cusip__c', 'cusip', 'CUSIP']), 9).toUpperCase(),
    issuer: cleanText(field(row, ['Issuer__c', 'issuer__c', 'issuer']), 255),
    description: cleanText(field(row, ['Description__c', 'description__c', 'description']), 255),
    buySell: cleanText(field(row, ['Buy_Sell__c', 'buy_sell__c', 'buySell']), 12),
    callable: cleanText(field(row, ['Callable__c', 'callable__c', 'callable']), 12),
    typecode: cleanText(field(row, ['TYPECODE__c', 'typecode__c', 'typecode']), 12),
    coupon: numberOrNull(field(row, ['Coupon__c', 'coupon__c', 'coupon'])),
    yield: numberOrNull(field(row, ['Yield__c', 'yield__c', 'yield'])),
    price: numberOrNull(field(row, ['Price__c', 'price__c', 'price'])),
    qty: intOrNull(field(row, ['Qty__c', 'qty__c', 'qty'])),
    activityDate: normalizeDate(field(row, ['Activity_Date__c', 'activity_date__c', 'activityDate'])),
    tradeDate: normalizeDate(field(row, ['Trade_Date__c', 'trade_date__c', 'tradeDate'])),
    settlementDate: normalizeDate(field(row, ['Settlement_Date__c', 'settlement_date__c', 'settlementDate'])),
    maturity: normalizeDate(field(row, ['Maturity__c', 'maturity__c', 'maturity'])),
    owner1Id,
    owner1Name: resolveRepName(repMap, owner1Id),
    owner2Id,
    owner2Name: resolveRepName(repMap, owner2Id),
    bankId: pershing.bankId || '',
    certNumber: pershing.certNumber || '',
    bankMatchStatus,
    isDeleted: booleanValue(field(row, ['IsDeleted', 'isDeleted', 'isdeleted'])),
    importedAt,
    sourceFile
  };
}

function validateTradeRecord(record) {
  if (!record.salesforceTradeId) return 'Missing Salesforce Trade id';
  if (!record.salesforcePershingId) return 'Missing Pershing account id';
  return '';
}

function summarizeTradeImport(records, options = {}) {
  const tradeIds = new Set();
  const dupIds = new Set();
  const banks = new Set();
  const pershingIds = new Set();
  let skippedDeleted = 0;
  let invalidRows = 0;
  let matchedRows = 0;
  let unmatchedRows = 0;
  let oldest = '';
  let latest = '';
  for (const record of records) {
    if (record.isDeleted) { skippedDeleted += 1; continue; }
    if (validateTradeRecord(record)) { invalidRows += 1; continue; }
    if (tradeIds.has(record.salesforceTradeId)) dupIds.add(record.salesforceTradeId);
    tradeIds.add(record.salesforceTradeId);
    pershingIds.add(record.salesforcePershingId);
    if (record.bankId) { matchedRows += 1; banks.add(record.bankId); } else unmatchedRows += 1;
    if (record.tradeDate) {
      if (!oldest || record.tradeDate < oldest) oldest = record.tradeDate;
      if (!latest || record.tradeDate > latest) latest = record.tradeDate;
    }
  }
  const valid = matchedRows + unmatchedRows;
  return {
    sourceFile: cleanText(options.sourceFile, 260),
    importedAt: options.importedAt || '',
    dryRun: Boolean(options.dryRun),
    totalRows: records.length,
    skippedDeleted,
    invalidRows,
    importedCount: valid,
    uniqueTradeIds: tradeIds.size,
    duplicateTradeIds: dupIds.size,
    matchedRows,
    unmatchedRows,
    bankCount: banks.size,
    pershingAccountCount: pershingIds.size,
    bankMatchRate: valid ? Number((matchedRows / valid).toFixed(4)) : 0,
    oldestTradeDate: oldest || null,
    latestTradeDate: latest || null
  };
}

function importTrades(outputDir, rows, options = {}) {
  const importedAt = options.importedAt || new Date().toISOString();
  const sourceFile = cleanText(options.sourceFile || '', 260);
  const dbPath = tradesDatabasePathForDir(outputDir);
  // Resolve the pershing -> bank map from the already-imported pershing table
  // unless one is injected (tests inject a map).
  const pershingMap = options.pershingMap || buildPershingMapFromDb(dbPath);
  const mapped = (rows || []).map(row => mapTradeRecord(row, { ...options, pershingMap, importedAt, sourceFile }));
  const stats = summarizeTradeImport(mapped, { importedAt, sourceFile, dryRun: options.dryRun });
  if (options.dryRun) return stats;

  ensureTradesTable(dbPath);
  const existing = new Set(
    sqliteDb.querySqliteJson(dbPath, 'SELECT salesforce_trade_id AS id FROM trades;').map(r => r.id)
  );
  let created = 0;
  let updated = 0;
  sqliteDb.withDatabase(dbPath, db => {
    const upsert = db.prepare(`
      INSERT INTO trades (
        salesforce_trade_id, salesforce_pershing_id, trade_name, cusip, issuer, description,
        buy_sell, callable, typecode, coupon, yield, price, qty,
        activity_date, trade_date, settlement_date, maturity,
        owner_1_id, owner_1_name, owner_2_id, owner_2_name,
        bank_id, cert_number, bank_match_status, is_deleted, imported_at, source_file
      ) VALUES (
        @salesforce_trade_id, @salesforce_pershing_id, @trade_name, @cusip, @issuer, @description,
        @buy_sell, @callable, @typecode, @coupon, @yield, @price, @qty,
        @activity_date, @trade_date, @settlement_date, @maturity,
        @owner_1_id, @owner_1_name, @owner_2_id, @owner_2_name,
        @bank_id, @cert_number, @bank_match_status, @is_deleted, @imported_at, @source_file
      )
      ON CONFLICT(salesforce_trade_id) DO UPDATE SET
        salesforce_pershing_id = excluded.salesforce_pershing_id,
        trade_name = excluded.trade_name, cusip = excluded.cusip, issuer = excluded.issuer,
        description = excluded.description, buy_sell = excluded.buy_sell, callable = excluded.callable,
        typecode = excluded.typecode, coupon = excluded.coupon, yield = excluded.yield,
        price = excluded.price, qty = excluded.qty, activity_date = excluded.activity_date,
        trade_date = excluded.trade_date, settlement_date = excluded.settlement_date,
        maturity = excluded.maturity, owner_1_id = excluded.owner_1_id, owner_1_name = excluded.owner_1_name,
        owner_2_id = excluded.owner_2_id, owner_2_name = excluded.owner_2_name,
        bank_id = excluded.bank_id, cert_number = excluded.cert_number,
        bank_match_status = excluded.bank_match_status, is_deleted = excluded.is_deleted,
        imported_at = excluded.imported_at, source_file = excluded.source_file;
    `);
    const meta = db.prepare(`
      INSERT INTO trades_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `);
    const tx = db.transaction(() => {
      for (const r of mapped) {
        if (r.isDeleted || validateTradeRecord(r)) continue;
        // Track ids as we go so an in-batch duplicate counts as an update, not a
        // second create (upsert collapses it to one row).
        if (existing.has(r.salesforceTradeId)) updated += 1;
        else { created += 1; existing.add(r.salesforceTradeId); }
        upsert.run({
          salesforce_trade_id: r.salesforceTradeId,
          salesforce_pershing_id: r.salesforcePershingId,
          trade_name: textOrNull(r.tradeName, 60),
          cusip: textOrNull(r.cusip, 9),
          issuer: textOrNull(r.issuer, 255),
          description: textOrNull(r.description, 255),
          buy_sell: textOrNull(r.buySell, 12),
          callable: textOrNull(r.callable, 12),
          typecode: textOrNull(r.typecode, 12),
          coupon: r.coupon,
          yield: r.yield,
          price: r.price,
          qty: r.qty,
          activity_date: textOrNull(r.activityDate, 20),
          trade_date: textOrNull(r.tradeDate, 20),
          settlement_date: textOrNull(r.settlementDate, 20),
          maturity: textOrNull(r.maturity, 20),
          owner_1_id: textOrNull(r.owner1Id, 32),
          owner_1_name: textOrNull(r.owner1Name, 200),
          owner_2_id: textOrNull(r.owner2Id, 32),
          owner_2_name: textOrNull(r.owner2Name, 200),
          bank_id: textOrNull(r.bankId, 80),
          cert_number: textOrNull(r.certNumber, 80),
          bank_match_status: textOrNull(r.bankMatchStatus, 40),
          is_deleted: r.isDeleted ? 1 : 0,
          imported_at: importedAt,
          source_file: textOrNull(sourceFile, 260)
        });
      }
      for (const [key, value] of Object.entries(stats)) {
        meta.run(key, value === null || value === undefined ? '' : String(value));
      }
      meta.run('created', String(created));
      meta.run('updated', String(updated));
    });
    tx();
  });
  return { ...stats, created, updated };
}

// ---- reads ----

function rowToTrade(row) {
  return {
    salesforceTradeId: row.salesforceTradeId || '',
    salesforcePershingId: row.salesforcePershingId || '',
    tradeName: row.tradeName || '',
    cusip: row.cusip || '',
    issuer: row.issuer || '',
    description: row.description || '',
    buySell: row.buySell || '',
    callable: row.callable || '',
    typecode: row.typecode || '',
    coupon: row.coupon,
    yield: row.yield,
    price: row.price,
    qty: row.qty,
    activityDate: row.activityDate || '',
    tradeDate: row.tradeDate || '',
    settlementDate: row.settlementDate || '',
    maturity: row.maturity || '',
    owner1Name: row.owner1Name || '',
    owner2Name: row.owner2Name || '',
    bankId: row.bankId || '',
    certNumber: row.certNumber || ''
  };
}

const TRADE_SELECT = `
  salesforce_trade_id AS salesforceTradeId, salesforce_pershing_id AS salesforcePershingId,
  trade_name AS tradeName, cusip, issuer, description, buy_sell AS buySell, callable, typecode,
  coupon, yield, price, qty, activity_date AS activityDate, trade_date AS tradeDate,
  settlement_date AS settlementDate, maturity, owner_1_name AS owner1Name, owner_2_name AS owner2Name,
  bank_id AS bankId, cert_number AS certNumber
`;

function buildTradeRollup(rows) {
  const dated = rows.filter(r => r.tradeDate);
  const latestTradeDate = dated.map(r => r.tradeDate).sort().pop() || '';
  const lastBuy = dated.filter(r => /buy/i.test(r.buySell)).map(r => r.tradeDate).sort().pop() || '';
  const lastSell = dated.filter(r => /sell/i.test(r.buySell)).map(r => r.tradeDate).sort().pop() || '';
  const sectorCounts = new Map();
  rows.forEach(r => {
    const k = r.typecode || 'Other';
    sectorCounts.set(k, (sectorCounts.get(k) || 0) + 1);
  });
  return {
    tradeCount: rows.length,
    latestTradeDate,
    lastBuyDate: lastBuy,
    lastSellDate: lastSell,
    sectors: [...sectorCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
  };
}

// Per-bank blotter (paged). The view the portal does not have today.
function getTradesForBank(outputDir, bankId, options = {}) {
  const dbPath = tradesDatabasePathForDir(outputDir);
  ensureTradesTable(dbPath);
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 1000));
  const offset = Math.max(0, Number(options.offset) || 0);
  const id = String(bankId || '');
  let countRow = [];
  try {
    countRow = sqliteDb.querySqliteJson(dbPath, 'SELECT COUNT(*) AS n FROM trades WHERE bank_id = ? AND is_deleted = 0;', [id]);
  } catch (e) {
    return { bankId: id, total: 0, rollup: buildTradeRollup([]), trades: [] };
  }
  const total = countRow.length ? Number(countRow[0].n) : 0;
  const rows = sqliteDb.querySqliteJson(dbPath, `
    SELECT ${TRADE_SELECT} FROM trades
    WHERE bank_id = ? AND is_deleted = 0
    ORDER BY
      CASE WHEN trade_date IS NULL OR trade_date = '' THEN 1 ELSE 0 END ASC,
      trade_date DESC, salesforce_trade_id ASC
    LIMIT ? OFFSET ?;
  `, [id, limit, offset]).map(rowToTrade);
  // Rollup is over the FULL bank history, not just the page.
  const allDates = sqliteDb.querySqliteJson(dbPath, `
    SELECT ${TRADE_SELECT} FROM trades WHERE bank_id = ? AND is_deleted = 0;
  `, [id]).map(rowToTrade);
  return { bankId: id, total, rollup: buildTradeRollup(allDates), trades: rows };
}

// MAX(trade_date) per bank — the Flow #1 "Most Recent Trade" rollup. Feeds the
// bank-signals recency signal so it reads real line-item recency, not the
// account-level stamp. Returns a Map(bankId -> { latestTradeDate, tradeCount }).
function getTradeRecencyForBanks(outputDir, bankIds) {
  const ids = [...new Set((bankIds || []).map(b => String(b || '').trim()).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const dbPath = tradesDatabasePathForDir(outputDir);
  ensureTradesTable(dbPath);
  const placeholders = ids.map(() => '?').join(',');
  let rows = [];
  try {
    rows = sqliteDb.querySqliteJson(dbPath, `
      SELECT bank_id AS bankId, MAX(trade_date) AS latestTradeDate, COUNT(*) AS tradeCount
      FROM trades WHERE bank_id IN (${placeholders}) AND is_deleted = 0 AND trade_date IS NOT NULL AND trade_date != ''
      GROUP BY bank_id;
    `, ids);
  } catch (e) {
    return out;
  }
  for (const row of rows) out.set(String(row.bankId), { latestTradeDate: row.latestTradeDate || '', tradeCount: Number(row.tradeCount) || 0 });
  return out;
}

function getTradeImportStatus(outputDir) {
  const dbPath = tradesDatabasePathForDir(outputDir);
  ensureTradesTable(dbPath);
  const out = {};
  try {
    for (const row of sqliteDb.querySqliteJson(dbPath, 'SELECT key, value FROM trades_meta;')) out[row.key] = row.value;
  } catch (e) { /* empty */ }
  return out;
}

module.exports = {
  tradesDatabasePathForDir,
  ensureTradesTable,
  mapTradeRecord,
  validateTradeRecord,
  summarizeTradeImport,
  buildPershingMapFromDb,
  importTrades,
  getTradesForBank,
  getTradeRecencyForBanks,
  getTradeImportStatus,
  buildTradeRollup
};
