'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const STRATEGY_DATABASE_FILENAME = 'bank-strategies.sqlite';
const STRATEGY_FILE_DIRNAME = 'strategy-files';
const STRATEGY_TYPES = new Set(['Bond Swap', 'Muni BCIS', 'THO Report', 'CECL Analysis', 'Miscellaneous']);
const STRATEGY_STATUSES = new Set(['Open', 'In Progress', 'Completed', 'Needs Billed']);
const STRATEGY_PRIORITIES = new Set(['1', '2', '3', '4', '5']);

function strategyDatabasePathForDir(outputDir) {
  return path.join(outputDir, STRATEGY_DATABASE_FILENAME);
}

function strategyFilesRootForDir(outputDir) {
  return path.join(outputDir, STRATEGY_FILE_DIRNAME);
}

function runSqlite(dbPath, sql, params) {
  if (params === undefined) { sqliteDb.execSqlite(dbPath, sql); return ''; }
  return sqliteDb.runSqlite(dbPath, sql, params);
}

function txSqlite(dbPath, statements) {
  return sqliteDb.transaction(dbPath, statements);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

function ensureStrategyDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = strategyDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS strategy_requests (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      legal_name TEXT,
      city TEXT,
      state TEXT,
      cert_number TEXT,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      priority TEXT NOT NULL DEFAULT '3',
      requested_by TEXT,
      assigned_to TEXT,
      invoice_contact TEXT,
      thc_strategy_id TEXT,
      thc_trade_simulation_id TEXT,
      thc_cycle TEXT,
      thc_status TEXT,
      thc_summary TEXT,
      summary TEXT NOT NULL,
      comments TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      billed_at TEXT,
      archived_at TEXT,
      archived_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_status_updated ON strategy_requests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_bank ON strategy_requests(bank_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_type ON strategy_requests(request_type, status);
    CREATE TABLE IF NOT EXISTS strategy_request_files (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      label TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY(strategy_id) REFERENCES strategy_requests(id)
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_files_request ON strategy_request_files(strategy_id, uploaded_at DESC);
  `);
  const columns = querySqliteJson(dbPath, 'PRAGMA table_info(strategy_requests);').map(row => row.name);
  if (!columns.includes('archived_at')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN archived_at TEXT;');
  }
  if (!columns.includes('archived_by')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN archived_by TEXT;');
  }
  if (!columns.includes('thc_strategy_id')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN thc_strategy_id TEXT;');
  }
  if (!columns.includes('thc_trade_simulation_id')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN thc_trade_simulation_id TEXT;');
  }
  if (!columns.includes('thc_cycle')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN thc_cycle TEXT;');
  }
  if (!columns.includes('thc_status')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN thc_status TEXT;');
  }
  if (!columns.includes('thc_summary')) {
    runSqlite(dbPath, 'ALTER TABLE strategy_requests ADD COLUMN thc_summary TEXT;');
  }
  runSqlite(dbPath, 'CREATE INDEX IF NOT EXISTS idx_strategy_archive ON strategy_requests(archived_at, updated_at DESC);');
  return dbPath;
}

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanMultilineText(value, maxLength = 4000) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeType(value) {
  const cleaned = cleanText(value, 80);
  return STRATEGY_TYPES.has(cleaned) ? cleaned : 'Miscellaneous';
}

function normalizeStatus(value, fallback = 'Open') {
  const cleaned = cleanText(value, 40);
  return STRATEGY_STATUSES.has(cleaned) ? cleaned : fallback;
}

function normalizePriority(value, fallback = '3') {
  const cleaned = cleanText(value, 10);
  return STRATEGY_PRIORITIES.has(cleaned) ? cleaned : fallback;
}

function sanitizeFileName(original) {
  let name = path.basename(original || '').trim();
  name = name.replace(/[^A-Za-z0-9._\- ]/g, '_');
  name = name.replace(/_{2,}/g, '_');
  name = name.replace(/^\.+/, '');
  if (!name) name = 'file';
  if (name.length > 160) {
    const ext = path.extname(name);
    name = name.slice(0, 160 - ext.length) + ext;
  }
  return name;
}

function normalizeBankSummary(summary) {
  const row = summary || {};
  const bankId = cleanText(row.id || row.bankId, 80);
  if (!bankId) throw new Error('Bank ID is required');
  return {
    bankId,
    displayName: cleanText(row.displayName || row.name || 'Bank', 300) || 'Bank',
    legalName: cleanText(row.name || row.legalName, 300),
    city: cleanText(row.city, 120),
    state: cleanText(row.state, 40),
    certNumber: cleanText(row.certNumber, 80)
  };
}

function strategySelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      display_name AS displayName,
      legal_name AS legalName,
      city AS city,
      state AS state,
      cert_number AS certNumber,
      request_type AS requestType,
      status AS status,
      priority AS priority,
      requested_by AS requestedBy,
      assigned_to AS assignedTo,
      invoice_contact AS invoiceContact,
      thc_strategy_id AS thcStrategyId,
      thc_trade_simulation_id AS thcTradeSimulationId,
      thc_cycle AS thcCycle,
      thc_status AS thcStatus,
      thc_summary AS thcSummary,
      summary AS summary,
      comments AS comments,
      created_at AS createdAt,
      updated_at AS updatedAt,
      completed_at AS completedAt,
      billed_at AS billedAt,
      archived_at AS archivedAt,
      archived_by AS archivedBy
    FROM strategy_requests
    WHERE ${where}
  `;
}

function mapStrategyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    displayName: row.displayName || '',
    legalName: row.legalName || '',
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    requestType: row.requestType || 'Miscellaneous',
    status: row.status || 'Open',
    priority: row.priority || '3',
    requestedBy: row.requestedBy || '',
    assignedTo: row.assignedTo || '',
    invoiceContact: row.invoiceContact || '',
    thcStrategyId: row.thcStrategyId || '',
    thcTradeSimulationId: row.thcTradeSimulationId || '',
    thcCycle: row.thcCycle || '',
    thcStatus: row.thcStatus || '',
    thcSummary: row.thcSummary || '',
    summary: row.summary || '',
    comments: row.comments || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    completedAt: row.completedAt || '',
    billedAt: row.billedAt || '',
    archivedAt: row.archivedAt || '',
    archivedBy: row.archivedBy || '',
    isArchived: Boolean(row.archivedAt)
  };
}

function mapStrategyFileRow(row) {
  if (!row) return null;
  return {
    id: row.id || '',
    strategyId: row.strategyId || '',
    filename: row.originalFilename || '',
    label: row.label || '',
    sizeBytes: Number(row.sizeBytes || 0),
    uploadedAt: row.uploadedAt || ''
  };
}

function listFilesForStrategyIds(outputDir, strategyIds) {
  const ids = [...new Set((strategyIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const dbPath = ensureStrategyDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT
      id AS id,
      strategy_id AS strategyId,
      original_filename AS originalFilename,
      label AS label,
      size_bytes AS sizeBytes,
      uploaded_at AS uploadedAt
    FROM strategy_request_files
    WHERE strategy_id IN (${ids.map(() => '?').join(', ')})
    ORDER BY uploaded_at DESC;
  `, ids);
  const filesByRequest = new Map(ids.map(id => [id, []]));
  rows.forEach(row => {
    const file = mapStrategyFileRow(row);
    if (!file) return;
    if (!filesByRequest.has(file.strategyId)) filesByRequest.set(file.strategyId, []);
    filesByRequest.get(file.strategyId).push(file);
  });
  return filesByRequest;
}

function attachFiles(outputDir, requests) {
  const rows = Array.isArray(requests) ? requests : [requests].filter(Boolean);
  const filesByRequest = listFilesForStrategyIds(outputDir, rows.map(row => row.id));
  rows.forEach(row => {
    row.files = filesByRequest.get(row.id) || [];
  });
  return Array.isArray(requests) ? rows : rows[0] || null;
}

function listStrategyRequests(outputDir, filters = {}) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const where = [];
  const params = [];
  const archivedFilter = String(filters.archived || '').toLowerCase();
  if (archivedFilter === 'only') {
    where.push('archived_at IS NOT NULL');
  } else if (archivedFilter !== 'all') {
    where.push('archived_at IS NULL');
  }
  if (filters.status && STRATEGY_STATUSES.has(filters.status)) {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.bankId) {
    where.push('bank_id = ?');
    params.push(String(filters.bankId || ''));
  }
  const rows = querySqliteJson(dbPath, `
    ${strategySelectSql(where.length ? where.join(' AND ') : '1 = 1')}
    ORDER BY
      CASE status
        WHEN 'Open' THEN 1
        WHEN 'In Progress' THEN 2
        WHEN 'Needs Billed' THEN 3
        WHEN 'Completed' THEN 4
        ELSE 5
      END,
      archived_at IS NOT NULL ASC,
      CAST(priority AS INTEGER) ASC,
      updated_at DESC
    LIMIT 500;
  `, params);
  const requests = attachFiles(outputDir, rows.map(mapStrategyRow));
  const counts = Object.fromEntries([...STRATEGY_STATUSES].map(status => [status, 0]));
  const countWhere = archivedFilter === 'only'
    ? 'archived_at IS NOT NULL'
    : (archivedFilter === 'all' ? '1 = 1' : 'archived_at IS NULL');
  const countRows = querySqliteJson(dbPath, `SELECT status, COUNT(*) AS count FROM strategy_requests WHERE ${countWhere} GROUP BY status;`);
  countRows.forEach(row => {
    if (STRATEGY_STATUSES.has(row.status)) counts[row.status] = Number(row.count || 0);
  });
  counts.Archived = Number((querySqliteJson(dbPath, 'SELECT COUNT(*) AS count FROM strategy_requests WHERE archived_at IS NOT NULL;')[0] || {}).count || 0);
  return { requests, counts };
}

// Complete per-bank strategy counts for the Coverage Book. listStrategyRequests
// caps at 500 rows, so deriving per-bank counts from it under-reports once the
// queue is large. This is a direct GROUP BY (no row cap) over active
// (non-archived) requests: `open` = Open + In Progress; `total` = all
// non-archived for the bank; `byStatus` keeps the per-status breakdown.
function summarizeStrategyCountsByBank(outputDir) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT bank_id AS bankId, status, COUNT(*) AS count
    FROM strategy_requests
    WHERE archived_at IS NULL AND bank_id IS NOT NULL AND bank_id <> ''
    GROUP BY bank_id, status;
  `);
  const byBank = {};
  rows.forEach(row => {
    const bankId = String(row.bankId);
    const n = Number(row.count || 0);
    const entry = byBank[bankId] || (byBank[bankId] = { open: 0, total: 0, byStatus: {} });
    entry.total += n;
    if (STRATEGY_STATUSES.has(row.status)) entry.byStatus[row.status] = (entry.byStatus[row.status] || 0) + n;
    if (row.status === 'Open' || row.status === 'In Progress') entry.open += n;
  });
  return byBank;
}

function getStrategyRequest(outputDir, id) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${strategySelectSql('id = ?')} LIMIT 1;`, [String(id || '')]);
  return rows.length ? attachFiles(outputDir, mapStrategyRow(rows[0])) : null;
}

function createStrategyRequest(outputDir, bankSummary, input = {}) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const bank = normalizeBankSummary(bankSummary);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const requestType = normalizeType(input.requestType);
  const summary = cleanText(input.summary, 500) || requestType;
  const status = normalizeStatus(input.status, 'Open');

  runSqlite(dbPath, `
    INSERT INTO strategy_requests (
      id, bank_id, display_name, legal_name, city, state, cert_number,
      request_type, status, priority, requested_by, assigned_to, invoice_contact,
      thc_strategy_id, thc_trade_simulation_id, thc_cycle, thc_status, thc_summary,
      summary, comments, created_at, updated_at, completed_at, billed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bank.bankId,
    bank.displayName,
    bank.legalName,
    bank.city,
    bank.state,
    bank.certNumber,
    requestType,
    status,
    normalizePriority(input.priority, '3'),
    cleanText(input.requestedBy, 120),
    cleanText(input.assignedTo, 120),
    cleanText(input.invoiceContact, 180),
    cleanText(input.thcStrategyId, 120),
    cleanText(input.thcTradeSimulationId, 120),
    cleanText(input.thcCycle, 80),
    cleanText(input.thcStatus, 80),
    cleanMultilineText(input.thcSummary, 2000),
    summary,
    cleanMultilineText(input.comments),
    now,
    now,
    status === 'Completed' ? now : null,
    status === 'Needs Billed' ? now : null
  ]);
  return getStrategyRequest(outputDir, id);
}

function updateStrategyRequest(outputDir, id, input = {}) {
  const existing = getStrategyRequest(outputDir, id);
  if (!existing) return null;
  const dbPath = ensureStrategyDatabase(outputDir);
  const now = new Date().toISOString();
  const status = input.status !== undefined
    ? normalizeStatus(input.status, existing.status)
    : existing.status;
  const completedAt = status === 'Completed'
    ? (existing.completedAt || now)
    : existing.completedAt || null;
  const billedAt = status === 'Needs Billed'
    ? (existing.billedAt || now)
    : input.markBilled
      ? (existing.billedAt || now)
    : existing.billedAt || null;
  const archiveIntent = input.archived;
  const archivedAt = archiveIntent === true
    ? (existing.archivedAt || now)
    : archiveIntent === false
      ? null
      : existing.archivedAt || null;
  const archivedBy = archiveIntent === true
    ? (cleanText(input.archivedBy, 120) || existing.archivedBy || null)
    : archiveIntent === false
      ? null
      : existing.archivedBy || null;

  runSqlite(dbPath, `
    UPDATE strategy_requests SET
      request_type = ?,
      status = ?,
      priority = ?,
      requested_by = ?,
      assigned_to = ?,
      invoice_contact = ?,
      thc_strategy_id = ?,
      thc_trade_simulation_id = ?,
      thc_cycle = ?,
      thc_status = ?,
      thc_summary = ?,
      summary = ?,
      comments = ?,
      updated_at = ?,
      completed_at = ?,
      billed_at = ?,
      archived_at = ?,
      archived_by = ?
    WHERE id = ?;
  `, [
    input.requestType !== undefined ? normalizeType(input.requestType) : existing.requestType,
    status,
    input.priority !== undefined ? normalizePriority(input.priority, existing.priority) : existing.priority,
    input.requestedBy !== undefined ? cleanText(input.requestedBy, 120) : existing.requestedBy,
    input.assignedTo !== undefined ? cleanText(input.assignedTo, 120) : existing.assignedTo,
    input.invoiceContact !== undefined ? cleanText(input.invoiceContact, 180) : existing.invoiceContact,
    input.thcStrategyId !== undefined ? cleanText(input.thcStrategyId, 120) : existing.thcStrategyId,
    input.thcTradeSimulationId !== undefined ? cleanText(input.thcTradeSimulationId, 120) : existing.thcTradeSimulationId,
    input.thcCycle !== undefined ? cleanText(input.thcCycle, 80) : existing.thcCycle,
    input.thcStatus !== undefined ? cleanText(input.thcStatus, 80) : existing.thcStatus,
    input.thcSummary !== undefined ? cleanMultilineText(input.thcSummary, 2000) : existing.thcSummary,
    input.summary !== undefined ? (cleanText(input.summary, 500) || existing.summary) : existing.summary,
    input.comments !== undefined ? cleanMultilineText(input.comments) : existing.comments,
    now,
    completedAt,
    billedAt,
    archivedAt,
    archivedBy,
    String(id || '')
  ]);
  return getStrategyRequest(outputDir, id);
}

function strategyFilePathForRow(outputDir, strategyId, storedFilename) {
  const dir = path.resolve(strategyFilesRootForDir(outputDir), String(strategyId || ''));
  const target = path.resolve(dir, String(storedFilename || ''));
  const rel = path.relative(dir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid strategy file path');
  return target;
}

function addStrategyRequestFile(outputDir, strategyId, file, input = {}) {
  const existing = getStrategyRequest(outputDir, strategyId);
  if (!existing) return null;
  if (!file || !Buffer.isBuffer(file.data) || !file.data.length) {
    const err = new Error('Strategy file is required');
    err.statusCode = 400;
    throw err;
  }
  const dbPath = ensureStrategyDatabase(outputDir);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const originalFilename = sanitizeFileName(file.filename || 'strategy-file');
  const storedFilename = `${id}-${originalFilename}`;
  const filePath = strategyFilePathForRow(outputDir, existing.id, storedFilename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, file.data);
  txSqlite(dbPath, [
    {
      sql: `
    INSERT INTO strategy_request_files (
      id, strategy_id, original_filename, stored_filename, label, size_bytes, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
  `,
      params: [
        id,
        existing.id,
        originalFilename,
        storedFilename,
        cleanText(input.label, 120),
        Number(file.data.length) || 0,
        now
      ]
    },
    { sql: `UPDATE strategy_requests SET updated_at = ? WHERE id = ?;`, params: [now, existing.id] }
  ]);
  return getStrategyRequest(outputDir, existing.id);
}

function getStrategyRequestFile(outputDir, strategyId, fileId) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT
      id AS id,
      strategy_id AS strategyId,
      original_filename AS originalFilename,
      stored_filename AS storedFilename,
      label AS label,
      size_bytes AS sizeBytes,
      uploaded_at AS uploadedAt
    FROM strategy_request_files
    WHERE strategy_id = ?
      AND id = ?
    LIMIT 1;
  `, [String(strategyId || ''), String(fileId || '')]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...mapStrategyFileRow(row),
    storedFilename: row.storedFilename || '',
    path: strategyFilePathForRow(outputDir, row.strategyId, row.storedFilename)
  };
}

function deleteStrategyRequest(outputDir, id) {
  const existing = getStrategyRequest(outputDir, id);
  if (!existing) return null;
  const dbPath = ensureStrategyDatabase(outputDir);
  txSqlite(dbPath, [
    { sql: `DELETE FROM strategy_request_files WHERE strategy_id = ?;`, params: [existing.id] },
    { sql: `DELETE FROM strategy_requests WHERE id = ?;`, params: [existing.id] }
  ]);
  const fileDir = path.resolve(strategyFilesRootForDir(outputDir), existing.id);
  const root = path.resolve(strategyFilesRootForDir(outputDir));
  const rel = path.relative(root, fileDir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    fs.rmSync(fileDir, { recursive: true, force: true });
  }
  return existing;
}

module.exports = {
  STRATEGY_DATABASE_FILENAME,
  STRATEGY_FILE_DIRNAME,
  STRATEGY_STATUSES,
  STRATEGY_TYPES,
  addStrategyRequestFile,
  createStrategyRequest,
  deleteStrategyRequest,
  getStrategyRequestFile,
  getStrategyRequest,
  listStrategyRequests,
  summarizeStrategyCountsByBank,
  strategyDatabasePathForDir,
  strategyFilesRootForDir,
  updateStrategyRequest
};
