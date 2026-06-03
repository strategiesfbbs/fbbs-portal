'use strict';

/**
 * FBBS Portal — Reports store
 *
 * SQLite-backed persistence for the Reports Workspace (Strategies-style
 * "replace Salesforce" reporting hub). Previously the workspace kept everything
 * in the browser (localStorage saved definitions + sessionStorage run history +
 * hardcoded fixtures), so reports never persisted across machines or reps. This
 * store moves the durable pieces server-side so saved reports are shared.
 *
 * Tables:
 *   report_definitions — a saved report (filters / columns / sort stored as
 *                        JSON text), attributed to the rep who created it.
 *   report_hidden      — ids the user dismissed. Intentionally NOT foreign-keyed
 *                        to report_definitions: dismissed ids include client
 *                        fixture ids ("fixture-*") and legacy session ids that
 *                        have no row, matching the old localStorage semantics.
 *   report_sequence    — RP-YYYY-NNNN id allocator.
 *
 * Goes through the shared sqlite-db.js (better-sqlite3) with bound parameters,
 * exactly like swap-store.js / strategy-store.js. Opens/closes a handle per call.
 */

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const REPORTS_DATABASE_FILENAME = 'reports.sqlite';
const REPORT_TYPES = new Set(['custom-bank', 'bank-peer', 'portfolio-peer', 'opportunity', 'coverage', 'billing-queue']);

function reportsDatabasePathForDir(outputDir) {
  return path.join(outputDir, REPORTS_DATABASE_FILENAME);
}

// ---------- sqlite-db thin wrappers (match swap-store.js) ----------

function runSqlite(dbPath, sql, params) {
  if (params === undefined) { sqliteDb.execSqlite(dbPath, sql); return ''; }
  return sqliteDb.runSqlite(dbPath, sql, params);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

// ---------- Coercers ----------

function boolToInt(value) {
  if (value === undefined || value === null) return 0;
  return value ? 1 : 0;
}

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeType(value) {
  const v = cleanText(value, 40);
  return v && REPORT_TYPES.has(v) ? v : 'custom-bank';
}

// JSON columns: stringify on write, parse on read with a safe fallback so a
// corrupt blob never throws past the mapper. A size cap guards against a client
// storing a giant filters/columns/sort blob (legit values are well under 1 KB;
// MAX_JSON_BYTES is generous). Oversized input falls back to the default.
const MAX_JSON_BYTES = 20000;
function toJsonText(value, fallback) {
  const fallbackText = fallback === undefined ? null : JSON.stringify(fallback);
  if (value === undefined || value === null) return fallbackText;
  try {
    const text = JSON.stringify(value);
    if (text && text.length > MAX_JSON_BYTES) return fallbackText;
    return text;
  } catch (_) { return fallbackText; }
}

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch (_) { return fallback; }
}

// rep may be null (no resolved rep) or { username, displayName }. Be defensive
// about the exact shape the server's rep resolver returns.
function repFields(rep) {
  if (!rep || typeof rep !== 'object') return { username: null, displayName: null };
  return {
    username: cleanText(rep.username || rep.id || rep.user || rep.name, 120),
    displayName: cleanText(rep.displayName || rep.name || rep.username, 160)
  };
}

// ---------- Schema ----------

function ensureReportDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = reportsDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS report_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom-bank',
      folder TEXT,
      description TEXT,
      filters_json TEXT,
      columns_json TEXT,
      sort_json TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_report_updated ON report_definitions(pinned DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_report_creator ON report_definitions(created_by, updated_at DESC);

    CREATE TABLE IF NOT EXISTS report_hidden (
      report_id TEXT PRIMARY KEY,
      hidden_by TEXT,
      hidden_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_sequence (
      year INTEGER PRIMARY KEY,
      next_number INTEGER NOT NULL
    );
  `);
  migrateReportHiddenPerRep(dbPath);
  return dbPath;
}

function migrateReportHiddenPerRep(dbPath) {
  const columns = querySqliteJson(dbPath, `PRAGMA table_info(report_hidden);`);
  const reportIdPk = columns.find(col => col.name === 'report_id');
  const hiddenByPk = columns.find(col => col.name === 'hidden_by');
  if (reportIdPk && reportIdPk.pk === 1 && (!hiddenByPk || !hiddenByPk.pk)) {
    runSqlite(dbPath, `
      CREATE TABLE IF NOT EXISTS report_hidden_v2 (
        report_id TEXT NOT NULL,
        hidden_by TEXT NOT NULL DEFAULT '',
        hidden_at TEXT NOT NULL,
        PRIMARY KEY (report_id, hidden_by)
      );
      INSERT OR REPLACE INTO report_hidden_v2(report_id, hidden_by, hidden_at)
        SELECT report_id, COALESCE(hidden_by, ''), hidden_at FROM report_hidden;
      DROP TABLE report_hidden;
      ALTER TABLE report_hidden_v2 RENAME TO report_hidden;
    `);
  }
}

// ---------- ID generation ----------

function nextReportId(outputDir, now = new Date()) {
  const dbPath = ensureReportDatabase(outputDir);
  const year = now.getUTCFullYear();
  const existing = querySqliteJson(dbPath,
    `SELECT next_number AS next FROM report_sequence WHERE year = ?;`, [year]);
  const nextNum = existing.length ? existing[0].next : 1;
  runSqlite(dbPath, `
    INSERT INTO report_sequence(year, next_number) VALUES (?, ?)
    ON CONFLICT(year) DO UPDATE SET next_number = excluded.next_number;
  `, [year, nextNum + 1]);
  return `RP-${year}-${String(nextNum).padStart(4, '0')}`;
}

// ---------- Mapper ----------

function mapReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    type: row.type || 'custom-bank',
    folder: row.folder || '',
    description: row.description || '',
    filters: parseJson(row.filters_json, {}),
    columns: parseJson(row.columns_json, []),
    sort: parseJson(row.sort_json, null),
    pinned: Boolean(row.pinned),
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ---------- Public API ----------

// Create (or idempotently upsert by id — the client migration replays legacy
// `saved-*` ids so two machines migrating the same export don't duplicate). On
// an upsert we preserve the original created_at / created_by.
function createReportDefinition(outputDir, payload = {}, rep = null) {
  const dbPath = ensureReportDatabase(outputDir);
  const now = new Date();
  const id = cleanText(payload.id, 80) || nextReportId(outputDir, now);
  const { username, displayName } = repFields(rep);
  const nowIso = now.toISOString();

  runSqlite(dbPath, `
    INSERT INTO report_definitions (
      id, name, type, folder, description,
      filters_json, columns_json, sort_json, pinned,
      created_by, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      folder = excluded.folder,
      description = excluded.description,
      filters_json = excluded.filters_json,
      columns_json = excluded.columns_json,
      sort_json = excluded.sort_json,
      pinned = excluded.pinned,
      updated_at = excluded.updated_at;
  `, [
    id,
    cleanText(payload.name, 200) || 'Saved Report',
    normalizeType(payload.type),
    cleanText(payload.folder, 120),
    cleanText(payload.description, 600),
    toJsonText(payload.filters, {}),
    toJsonText(payload.columns, []),
    toJsonText(payload.sort, null),
    boolToInt(payload.pinned),
    username || cleanText(payload.createdBy, 120),
    displayName || cleanText(payload.createdByName, 160),
    nowIso,
    nowIso
  ]);
  return getReportDefinition(outputDir, id);
}

function getReportDefinition(outputDir, id) {
  const dbPath = ensureReportDatabase(outputDir);
  const rows = querySqliteJson(dbPath,
    `SELECT * FROM report_definitions WHERE id = ?;`, [id]);
  return rows.length ? mapReport(rows[0]) : null;
}

function listReportDefinitions(outputDir, { type, createdBy, limit = 100 } = {}) {
  const dbPath = ensureReportDatabase(outputDir);
  const where = ['1 = 1'];
  const params = [];
  if (type) { where.push('type = ?'); params.push(normalizeType(type)); }
  if (createdBy) { where.push('created_by = ?'); params.push(String(createdBy)); }
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  params.push(safeLimit);
  const rows = querySqliteJson(dbPath, `
    SELECT * FROM report_definitions
    WHERE ${where.join(' AND ')}
    ORDER BY pinned DESC, updated_at DESC
    LIMIT ?;
  `, params);
  return rows.map(mapReport);
}

// Partial update (PATCH). Never touches created_at / created_by. Returns null
// for an unknown id so the route can 404.
function updateReportDefinition(outputDir, id, patch = {}) {
  const dbPath = ensureReportDatabase(outputDir);
  const existing = querySqliteJson(dbPath,
    `SELECT id FROM report_definitions WHERE id = ?;`, [id]);
  if (!existing.length) return null;

  const map = {
    name: v => ['name = ?', cleanText(v, 200) || 'Saved Report'],
    type: v => ['type = ?', normalizeType(v)],
    folder: v => ['folder = ?', cleanText(v, 120)],
    description: v => ['description = ?', cleanText(v, 600)],
    filters: v => ['filters_json = ?', toJsonText(v, {})],
    columns: v => ['columns_json = ?', toJsonText(v, [])],
    sort: v => ['sort_json = ?', toJsonText(v, null)],
    pinned: v => ['pinned = ?', boolToInt(v)]
  };
  const sets = [];
  const params = [];
  for (const key of Object.keys(patch)) {
    if (map[key]) {
      const [frag, value] = map[key](patch[key]);
      sets.push(frag);
      params.push(value);
    }
  }
  if (!sets.length) return getReportDefinition(outputDir, id);
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  runSqlite(dbPath, `UPDATE report_definitions SET ${sets.join(', ')} WHERE id = ?;`, params);
  return getReportDefinition(outputDir, id);
}

// Returns the deleted row (for audit) or null if it didn't exist.
function deleteReportDefinition(outputDir, id) {
  const dbPath = ensureReportDatabase(outputDir);
  const existing = getReportDefinition(outputDir, id);
  if (!existing) return null;
  runSqlite(dbPath, `DELETE FROM report_definitions WHERE id = ?;`, [id]);
  return existing;
}

function listHiddenReportIds(outputDir, rep = null) {
  const dbPath = ensureReportDatabase(outputDir);
  const { username } = repFields(rep);
  const hiddenBy = username || '';
  const rows = querySqliteJson(dbPath,
    `SELECT report_id FROM report_hidden WHERE hidden_by = ? ORDER BY hidden_at DESC;`, [hiddenBy]);
  return rows.map(row => row.report_id);
}

function setReportHidden(outputDir, id, hidden, rep = null) {
  const dbPath = ensureReportDatabase(outputDir);
  const reportId = cleanText(id, 80);
  if (!reportId) throw new Error('report id is required');
  if (hidden) {
    const { username } = repFields(rep);
    runSqlite(dbPath, `
      INSERT INTO report_hidden(report_id, hidden_by, hidden_at) VALUES (?, ?, ?)
      ON CONFLICT(report_id, hidden_by) DO UPDATE SET
        hidden_at = excluded.hidden_at;
    `, [reportId, username || '', new Date().toISOString()]);
  } else {
    const { username } = repFields(rep);
    runSqlite(dbPath, `DELETE FROM report_hidden WHERE report_id = ? AND hidden_by = ?;`, [reportId, username || '']);
  }
  return listHiddenReportIds(outputDir, rep);
}

module.exports = {
  ensureReportDatabase,
  nextReportId,
  createReportDefinition,
  getReportDefinition,
  listReportDefinitions,
  updateReportDefinition,
  deleteReportDefinition,
  listHiddenReportIds,
  setReportHidden,
  // Exposed for tests
  REPORT_TYPES
};
