'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COVERAGE_DATABASE_FILENAME = 'bank-coverage.sqlite';
const COVERAGE_STATUSES = new Set(['Prospect', 'Client', 'Watchlist', 'Dormant']);
const COVERAGE_PRIORITIES = new Set(['High', 'Medium', 'Low']);

function coverageDatabasePathForDir(outputDir) {
  return path.join(outputDir, COVERAGE_DATABASE_FILENAME);
}

function sqlString(value) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : 'NULL';
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

function ensureCoverageDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = coverageDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bank_coverage (
      bank_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      legal_name TEXT,
      city TEXT,
      state TEXT,
      cert_number TEXT,
      primary_regulator TEXT,
      period TEXT,
      total_assets REAL,
      total_deposits REAL,
      status TEXT NOT NULL DEFAULT 'Watchlist',
      priority TEXT NOT NULL DEFAULT 'Medium',
      owner TEXT,
      next_action_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bank_notes (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (bank_id) REFERENCES bank_coverage(bank_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bank_coverage_priority ON bank_coverage(priority, next_action_date);
    CREATE INDEX IF NOT EXISTS idx_bank_notes_bank_created ON bank_notes(bank_id, created_at DESC);
  `);
  return dbPath;
}

function cleanText(value, maxLength = 200) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanMultilineText(value, maxLength = 4000) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanDate(value) {
  const cleaned = cleanText(value, 10);
  return cleaned && /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function normalizeStatus(value, fallback = 'Watchlist') {
  const cleaned = cleanText(value, 40);
  return COVERAGE_STATUSES.has(cleaned) ? cleaned : fallback;
}

function normalizePriority(value, fallback = 'Medium') {
  const cleaned = cleanText(value, 40);
  return COVERAGE_PRIORITIES.has(cleaned) ? cleaned : fallback;
}

function normalizeBankSummary(summary) {
  const row = summary || {};
  const bankId = cleanText(row.id || row.bankId, 80);
  if (!bankId) throw new Error('Bank ID is required');
  return {
    bankId,
    displayName: cleanText(row.displayName || row.name || 'Bank', 300) || 'Bank',
    legalName: cleanText(row.name, 300),
    city: cleanText(row.city, 120),
    state: cleanText(row.state, 40),
    certNumber: cleanText(row.certNumber, 80),
    primaryRegulator: cleanText(row.primaryRegulator, 80),
    period: cleanText(row.period, 40),
    totalAssets: row.totalAssets,
    totalDeposits: row.totalDeposits
  };
}

function mapCoverageRow(row) {
  if (!row) return null;
  return {
    bankId: row.bankId,
    displayName: row.displayName,
    legalName: row.legalName || '',
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    primaryRegulator: row.primaryRegulator || '',
    period: row.period || '',
    totalAssets: row.totalAssets == null ? null : Number(row.totalAssets),
    totalDeposits: row.totalDeposits == null ? null : Number(row.totalDeposits),
    status: row.status || 'Watchlist',
    priority: row.priority || 'Medium',
    owner: row.owner || '',
    nextActionDate: row.nextActionDate || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function mapNoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    text: row.text || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function coverageSelectSql(where = '1 = 1') {
  return `
    SELECT
      bank_id AS bankId,
      display_name AS displayName,
      legal_name AS legalName,
      city AS city,
      state AS state,
      cert_number AS certNumber,
      primary_regulator AS primaryRegulator,
      period AS period,
      total_assets AS totalAssets,
      total_deposits AS totalDeposits,
      status AS status,
      priority AS priority,
      owner AS owner,
      next_action_date AS nextActionDate,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_coverage
    WHERE ${where}
  `;
}

function notesSelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      note_text AS text,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_notes
    WHERE ${where}
  `;
}

function getExistingCoverage(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${coverageSelectSql(`bank_id = ${sqlString(bankId)}`)} LIMIT 1;`);
  return rows.length ? mapCoverageRow(rows[0]) : null;
}

function listSavedBanks(outputDir) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    ${coverageSelectSql()}
    ORDER BY
      CASE priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
      CASE WHEN next_action_date IS NULL OR next_action_date = '' THEN 1 ELSE 0 END,
      next_action_date ASC,
      updated_at DESC,
      display_name COLLATE NOCASE ASC;
  `);
  return rows.map(mapCoverageRow);
}

function getBankCoverage(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const saved = getExistingCoverage(outputDir, String(bankId || ''));
  const noteRows = querySqliteJson(dbPath, `
    ${notesSelectSql(`bank_id = ${sqlString(String(bankId || ''))}`)}
    ORDER BY created_at DESC
    LIMIT 100;
  `);
  return {
    saved,
    notes: noteRows.map(mapNoteRow)
  };
}

function upsertSavedBank(outputDir, bankSummary, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const summary = normalizeBankSummary(bankSummary);
  const existing = getExistingCoverage(outputDir, summary.bankId);
  const now = new Date().toISOString();
  const status = normalizeStatus(input.status, existing ? existing.status : 'Watchlist');
  const priority = normalizePriority(input.priority, existing ? existing.priority : 'Medium');
  const owner = cleanText(input.owner, 120);
  const nextActionDate = cleanDate(input.nextActionDate);
  const createdAt = existing ? existing.createdAt : now;

  runSqlite(dbPath, `
    INSERT INTO bank_coverage (
      bank_id, display_name, legal_name, city, state, cert_number, primary_regulator,
      period, total_assets, total_deposits, status, priority, owner, next_action_date,
      created_at, updated_at
    ) VALUES (
      ${sqlString(summary.bankId)},
      ${sqlString(summary.displayName)},
      ${sqlString(summary.legalName)},
      ${sqlString(summary.city)},
      ${sqlString(summary.state)},
      ${sqlString(summary.certNumber)},
      ${sqlString(summary.primaryRegulator)},
      ${sqlString(summary.period)},
      ${sqlNumber(summary.totalAssets)},
      ${sqlNumber(summary.totalDeposits)},
      ${sqlString(status)},
      ${sqlString(priority)},
      ${sqlString(owner)},
      ${sqlString(nextActionDate)},
      ${sqlString(createdAt)},
      ${sqlString(now)}
    )
    ON CONFLICT(bank_id) DO UPDATE SET
      display_name = excluded.display_name,
      legal_name = excluded.legal_name,
      city = excluded.city,
      state = excluded.state,
      cert_number = excluded.cert_number,
      primary_regulator = excluded.primary_regulator,
      period = excluded.period,
      total_assets = excluded.total_assets,
      total_deposits = excluded.total_deposits,
      status = excluded.status,
      priority = excluded.priority,
      owner = excluded.owner,
      next_action_date = excluded.next_action_date,
      updated_at = excluded.updated_at;
  `);

  return getExistingCoverage(outputDir, summary.bankId);
}

function removeSavedBank(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  runSqlite(dbPath, `
    PRAGMA foreign_keys = ON;
    DELETE FROM bank_coverage WHERE bank_id = ${sqlString(String(bankId || ''))};
  `);
  return { success: true };
}

function addBankNote(outputDir, bankId, text) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const noteText = cleanMultilineText(text);
  if (!noteText) throw new Error('Note text is required');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT INTO bank_notes (id, bank_id, note_text, created_at, updated_at)
    VALUES (${sqlString(id)}, ${sqlString(String(bankId || ''))}, ${sqlString(noteText)}, ${sqlString(now)}, ${sqlString(now)});
  `);
  const rows = querySqliteJson(dbPath, `${notesSelectSql(`id = ${sqlString(id)}`)} LIMIT 1;`);
  return rows.length ? mapNoteRow(rows[0]) : null;
}

function removeBankNote(outputDir, noteId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  runSqlite(dbPath, `DELETE FROM bank_notes WHERE id = ${sqlString(String(noteId || ''))};`);
  return { success: true };
}

module.exports = {
  COVERAGE_DATABASE_FILENAME,
  addBankNote,
  coverageDatabasePathForDir,
  ensureCoverageDatabase,
  getBankCoverage,
  listSavedBanks,
  removeBankNote,
  removeSavedBank,
  upsertSavedBank
};
