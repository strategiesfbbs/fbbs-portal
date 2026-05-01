'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STRATEGY_DATABASE_FILENAME = 'bank-strategies.sqlite';
const STRATEGY_TYPES = new Set(['Bond Swap', 'Muni BCIS', 'CECL Analysis', 'Miscellaneous']);
const STRATEGY_STATUSES = new Set(['Open', 'In Progress', 'Completed', 'Needs Billed']);
const STRATEGY_PRIORITIES = new Set(['1', '2', '3', '4']);

function strategyDatabasePathForDir(outputDir) {
  return path.join(outputDir, STRATEGY_DATABASE_FILENAME);
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
      summary TEXT NOT NULL,
      comments TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      billed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_status_updated ON strategy_requests(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_bank ON strategy_requests(bank_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_type ON strategy_requests(request_type, status);
  `);
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
      summary AS summary,
      comments AS comments,
      created_at AS createdAt,
      updated_at AS updatedAt,
      completed_at AS completedAt,
      billed_at AS billedAt
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
    summary: row.summary || '',
    comments: row.comments || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    completedAt: row.completedAt || '',
    billedAt: row.billedAt || ''
  };
}

function listStrategyRequests(outputDir, filters = {}) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const where = [];
  if (filters.status && STRATEGY_STATUSES.has(filters.status)) {
    where.push(`status = ${sqlString(filters.status)}`);
  }
  if (filters.bankId) {
    where.push(`bank_id = ${sqlString(String(filters.bankId || ''))}`);
  }
  const rows = querySqliteJson(dbPath, `
    ${strategySelectSql(where.length ? where.join(' AND ') : '1 = 1')}
    ORDER BY
      CASE status
        WHEN 'Open' THEN 1
        WHEN 'In Progress' THEN 2
        WHEN 'Completed' THEN 3
        WHEN 'Needs Billed' THEN 4
        ELSE 5
      END,
      CAST(priority AS INTEGER) ASC,
      updated_at DESC
    LIMIT 500;
  `);
  const requests = rows.map(mapStrategyRow);
  const counts = Object.fromEntries([...STRATEGY_STATUSES].map(status => [status, 0]));
  const countRows = querySqliteJson(dbPath, 'SELECT status, COUNT(*) AS count FROM strategy_requests GROUP BY status;');
  countRows.forEach(row => {
    if (STRATEGY_STATUSES.has(row.status)) counts[row.status] = Number(row.count || 0);
  });
  return { requests, counts };
}

function getStrategyRequest(outputDir, id) {
  const dbPath = ensureStrategyDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${strategySelectSql(`id = ${sqlString(String(id || ''))}`)} LIMIT 1;`);
  return rows.length ? mapStrategyRow(rows[0]) : null;
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
      summary, comments, created_at, updated_at, completed_at, billed_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(bank.bankId)},
      ${sqlString(bank.displayName)},
      ${sqlString(bank.legalName)},
      ${sqlString(bank.city)},
      ${sqlString(bank.state)},
      ${sqlString(bank.certNumber)},
      ${sqlString(requestType)},
      ${sqlString(status)},
      ${sqlString(normalizePriority(input.priority, '3'))},
      ${sqlString(cleanText(input.requestedBy, 120))},
      ${sqlString(cleanText(input.assignedTo, 120))},
      ${sqlString(cleanText(input.invoiceContact, 180))},
      ${sqlString(summary)},
      ${sqlString(cleanMultilineText(input.comments))},
      ${sqlString(now)},
      ${sqlString(now)},
      ${sqlString(status === 'Completed' ? now : null)},
      ${sqlString(status === 'Needs Billed' ? now : null)}
    );
  `);
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
    : existing.billedAt || null;

  runSqlite(dbPath, `
    UPDATE strategy_requests SET
      request_type = ${sqlString(input.requestType !== undefined ? normalizeType(input.requestType) : existing.requestType)},
      status = ${sqlString(status)},
      priority = ${sqlString(input.priority !== undefined ? normalizePriority(input.priority, existing.priority) : existing.priority)},
      requested_by = ${sqlString(input.requestedBy !== undefined ? cleanText(input.requestedBy, 120) : existing.requestedBy)},
      assigned_to = ${sqlString(input.assignedTo !== undefined ? cleanText(input.assignedTo, 120) : existing.assignedTo)},
      invoice_contact = ${sqlString(input.invoiceContact !== undefined ? cleanText(input.invoiceContact, 180) : existing.invoiceContact)},
      summary = ${sqlString(input.summary !== undefined ? (cleanText(input.summary, 500) || existing.summary) : existing.summary)},
      comments = ${sqlString(input.comments !== undefined ? cleanMultilineText(input.comments) : existing.comments)},
      updated_at = ${sqlString(now)},
      completed_at = ${sqlString(completedAt)},
      billed_at = ${sqlString(billedAt)}
    WHERE id = ${sqlString(String(id || ''))};
  `);
  return getStrategyRequest(outputDir, id);
}

module.exports = {
  STRATEGY_DATABASE_FILENAME,
  STRATEGY_STATUSES,
  STRATEGY_TYPES,
  createStrategyRequest,
  getStrategyRequest,
  listStrategyRequests,
  strategyDatabasePathForDir,
  updateStrategyRequest
};
