'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const COVERAGE_DATABASE_FILENAME = 'bank-coverage.sqlite';
const COVERAGE_STATUSES = new Set(['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant']);
const COVERAGE_PRIORITIES = new Set(['High', 'Medium', 'Low']);
// Manual, rep-logged activity kinds (distinct from the system-audit kinds like
// 'coverage-save' / 'status-change' that recordBankActivity writes). These are
// the only kinds counted as a "touch" for last-activity / going-cold logic.
const MANUAL_ACTIVITY_KINDS = ['call', 'email', 'meeting', 'task', 'note'];
const MANUAL_ACTIVITY_KIND_SET = new Set(MANUAL_ACTIVITY_KINDS);

function coverageDatabasePathForDir(outputDir) {
  return path.join(outputDir, COVERAGE_DATABASE_FILENAME);
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

// better-sqlite3 throws on undefined binds; normalize empty values to null.
function textOrNull(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

// Bind a finite number or null (mirrors the old sqlNumber NULL fallback).
function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
      status TEXT NOT NULL DEFAULT 'Open',
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
    CREATE TABLE IF NOT EXISTS bank_peer_preferences (
      bank_id TEXT PRIMARY KEY,
      peer_group_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bank_contacts (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      name TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      email TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bank_activities (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      at TEXT NOT NULL,
      actor_username TEXT,
      actor_display TEXT,
      kind TEXT NOT NULL,
      summary TEXT,
      ref_type TEXT,
      ref_id TEXT
    );
    CREATE TABLE IF NOT EXISTS bank_product_fit (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      product TEXT NOT NULL,
      notes TEXT,
      flagged_by_username TEXT,
      flagged_by_display TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(bank_id, product)
    );
    CREATE TABLE IF NOT EXISTS billing_queue (
      id TEXT PRIMARY KEY,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      summary TEXT,
      amount REAL,
      state TEXT NOT NULL DEFAULT 'Pending',
      enqueued_at TEXT NOT NULL,
      billed_at TEXT,
      billed_by TEXT,
      notes TEXT,
      UNIQUE(ref_type, ref_id)
    );
    CREATE TABLE IF NOT EXISTS bank_tasks (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      title TEXT NOT NULL,
      body TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'Normal',
      status TEXT NOT NULL DEFAULT 'Open',
      assigned_to TEXT,
      assigned_display TEXT,
      created_by TEXT,
      created_display TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bank_coverage_priority ON bank_coverage(priority, next_action_date);
    CREATE INDEX IF NOT EXISTS idx_bank_tasks_bank ON bank_tasks(bank_id, status, due_date);
    CREATE INDEX IF NOT EXISTS idx_bank_tasks_assignee ON bank_tasks(assigned_to, status, due_date);
    CREATE TABLE IF NOT EXISTS bank_opportunities (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      cert_number TEXT,
      product TEXT NOT NULL,
      description TEXT,
      est_value REAL,
      stage TEXT NOT NULL DEFAULT 'Prospect',
      close_date TEXT,
      owner TEXT,
      owner_display TEXT,
      created_by TEXT,
      created_display TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      stage_changed_at TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bank_opps_bank ON bank_opportunities(bank_id, stage);
    CREATE INDEX IF NOT EXISTS idx_bank_opps_owner ON bank_opportunities(owner, stage);
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id TEXT PRIMARY KEY,
      rep TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      label TEXT,
      asset_class TEXT,
      page TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(rep, kind, ref_id)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_rep ON watchlist_items(rep, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_notes_bank_created ON bank_notes(bank_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_contacts_bank ON bank_contacts(bank_id, is_primary DESC, name COLLATE NOCASE ASC);
    CREATE INDEX IF NOT EXISTS idx_bank_activities_bank_at ON bank_activities(bank_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_activities_actor_at ON bank_activities(actor_username, at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_product_fit_bank ON bank_product_fit(bank_id);
    CREATE INDEX IF NOT EXISTS idx_billing_queue_state_enqueued ON billing_queue(state, enqueued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_queue_bank ON billing_queue(bank_id);
    CREATE TABLE IF NOT EXISTS coverage_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  migrateBankActivityColumns(dbPath);
  migrateCoverageWorkspaceData(dbPath);
  return dbPath;
}

// bank_activities started as a passive system-audit log. Manual CRM activities
// (typed Call/Email/Meeting/Task/Note logged by a rep) reuse the same table so
// the bank detail feed stays a single timeline; these nullable columns hold the
// rep-entered fields. Existing audit rows leave them NULL. ALTER ... ADD COLUMN
// is idempotent here because we first check PRAGMA table_info (mirrors the
// report_hidden migration pattern in report-store.js).
function migrateBankActivityColumns(dbPath) {
  const columns = querySqliteJson(dbPath, `PRAGMA table_info(bank_activities);`);
  const have = new Set(columns.map(col => col.name));
  const additions = [
    ['subject', 'TEXT'],
    ['body', 'TEXT'],
    ['activity_date', 'TEXT'],
    ['contact_id', 'TEXT'],
    // Soft-delete (compliance): activities at a regulated BD are never hard-
    // deleted. Deleted rows keep their content but carry who/when/why and are
    // filtered out of every read path via activitySelectSql.
    ['deleted_at', 'TEXT'],
    ['deleted_by', 'TEXT'],
    ['delete_reason', 'TEXT']
  ];
  for (const [name, type] of additions) {
    if (!have.has(name)) {
      runSqlite(dbPath, `ALTER TABLE bank_activities ADD COLUMN ${name} ${type};`);
    }
  }
}

// One-shot consolidation of the retired Coverage Workspace (2026-06-12): the
// CRM layer superseded its two private data surfaces, so legacy rows fold into
// the systems that replaced them and the tab's UI could be removed.
//   1. bank_notes → the bank activity timeline. Notes added through the old UI
//      already logged a 140-char preview activity (ref_type='note'); those rows
//      get the full note text as their body instead of a duplicate insert.
//      Notes with no surviving activity row get a fresh 'note' activity stamped
//      with the note's original created_at.
//   2. bank_coverage.next_action_date → an Open bank_tasks row (the task engine
//      owns follow-up dates now), then the column is cleared so nothing renders
//      a second, stale "next action" source.
// Guarded by a coverage_meta flag + a per-process cache so the work runs once
// per database ever, and the check costs one SELECT per process thereafter.
const COVERAGE_CONSOLIDATION_KEY = 'coverage-workspace-consolidated';
const consolidatedCoverageDbs = new Set();

function migrateCoverageWorkspaceData(dbPath) {
  if (consolidatedCoverageDbs.has(dbPath)) return;
  const flag = querySqliteJson(dbPath, 'SELECT value FROM coverage_meta WHERE key = ?;', [COVERAGE_CONSOLIDATION_KEY]);
  if (flag.length) {
    consolidatedCoverageDbs.add(dbPath);
    return;
  }
  const now = new Date().toISOString();

  const notes = querySqliteJson(dbPath, 'SELECT id, bank_id, note_text, created_at FROM bank_notes ORDER BY created_at ASC;');
  for (const note of notes) {
    const existing = querySqliteJson(
      dbPath,
      "SELECT id, deleted_at FROM bank_activities WHERE ref_type = 'note' AND ref_id = ? LIMIT 1;",
      [note.id]
    );
    if (existing.length) {
      // Soft-deleted preview rows stay deleted — compliance removal carries
      // over to the migrated copy rather than resurrecting the note.
      if (!existing[0].deleted_at) {
        runSqlite(
          dbPath,
          'UPDATE bank_activities SET body = COALESCE(body, ?), activity_date = COALESCE(activity_date, ?) WHERE id = ?;',
          [note.note_text, String(note.created_at || now).slice(0, 10), existing[0].id]
        );
      }
      continue;
    }
    const cert = querySqliteJson(dbPath, 'SELECT cert_number FROM bank_coverage WHERE bank_id = ?;', [note.bank_id]);
    runSqlite(dbPath, `
      INSERT INTO bank_activities (id, bank_id, cert_number, at, kind, summary, body, activity_date, ref_type, ref_id)
      VALUES (?, ?, ?, ?, 'note', ?, ?, ?, 'note', ?);
    `, [
      crypto.randomUUID(),
      note.bank_id,
      cert.length ? cert[0].cert_number : null,
      note.created_at || now,
      String(note.note_text || '').replace(/\s+/g, ' ').slice(0, 140),
      note.note_text,
      String(note.created_at || now).slice(0, 10),
      note.id
    ]);
  }

  const pendingActions = querySqliteJson(
    dbPath,
    "SELECT bank_id, cert_number, owner, next_action_date FROM bank_coverage WHERE next_action_date IS NOT NULL AND next_action_date != '';"
  );
  for (const row of pendingActions) {
    runSqlite(dbPath, `
      INSERT INTO bank_tasks (
        id, bank_id, cert_number, title, body, due_date, priority, status,
        assigned_to, assigned_display, created_by, created_display, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Open', ?, ?, 'coverage-migration', 'Coverage Workspace migration', ?, ?);
    `, [
      crypto.randomUUID(),
      row.bank_id,
      textOrNull(row.cert_number),
      'Next action (migrated from Coverage Workspace)',
      'Carried over from the retired Coverage Workspace next-action date.',
      row.next_action_date,
      textOrNull(row.owner),
      textOrNull(row.owner),
      now,
      now
    ]);
  }
  runSqlite(dbPath, 'UPDATE bank_coverage SET next_action_date = NULL WHERE next_action_date IS NOT NULL;');

  runSqlite(dbPath, 'INSERT INTO coverage_meta (key, value) VALUES (?, ?);', [COVERAGE_CONSOLIDATION_KEY, now]);
  consolidatedCoverageDbs.add(dbPath);
}

const PRODUCT_FIT_PRODUCTS = [
  'CD Funding',
  'Muni Credit / BCIS',
  'ALM / IRR',
  'Bond Swap',
  'Portfolio Accounting',
  'CECL Analysis'
];

const BILLING_STATES = new Set(['Pending', 'Invoiced', 'Paid', 'Waived']);

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

function normalizeStatus(value, fallback = 'Open') {
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
    status: row.status || 'Open',
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
  const rows = querySqliteJson(dbPath, `${coverageSelectSql('bank_id = ?')} LIMIT 1;`, [String(bankId || '')]);
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
    ${notesSelectSql('bank_id = ?')}
    ORDER BY created_at DESC
    LIMIT 100;
  `, [String(bankId || '')]);
  return {
    saved,
    notes: noteRows.map(mapNoteRow)
  };
}

function getSavedBankCoverageMap(outputDir, bankIds = []) {
  const ids = [...new Set(bankIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(
    dbPath,
    `${coverageSelectSql(`bank_id IN (${ids.map(() => '?').join(',')})`)};`,
    ids
  );
  return new Map(rows.map(row => [String(row.bankId), mapCoverageRow(row)]));
}

function upsertSavedBank(outputDir, bankSummary, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const summary = normalizeBankSummary(bankSummary);
  const existing = getExistingCoverage(outputDir, summary.bankId);
  const now = new Date().toISOString();
  const status = normalizeStatus(input.status, existing ? existing.status : 'Open');
  const priority = input.priority !== undefined
    ? normalizePriority(input.priority, existing ? existing.priority : 'Medium')
    : (existing ? existing.priority : 'Medium');
  const owner = input.owner !== undefined ? cleanText(input.owner, 120) : (existing ? existing.owner : null);
  const nextActionDate = input.nextActionDate !== undefined ? cleanDate(input.nextActionDate) : (existing ? existing.nextActionDate : null);
  const createdAt = existing ? existing.createdAt : now;

  runSqlite(dbPath, `
    INSERT INTO bank_coverage (
      bank_id, display_name, legal_name, city, state, cert_number, primary_regulator,
      period, total_assets, total_deposits, status, priority, owner, next_action_date,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  `, [
    textOrNull(summary.bankId),
    textOrNull(summary.displayName),
    textOrNull(summary.legalName),
    textOrNull(summary.city),
    textOrNull(summary.state),
    textOrNull(summary.certNumber),
    textOrNull(summary.primaryRegulator),
    textOrNull(summary.period),
    numOrNull(summary.totalAssets),
    numOrNull(summary.totalDeposits),
    textOrNull(status),
    textOrNull(priority),
    textOrNull(owner),
    textOrNull(nextActionDate),
    textOrNull(createdAt),
    textOrNull(now)
  ]);

  return getExistingCoverage(outputDir, summary.bankId);
}

function removeSavedBank(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  // better-sqlite3 enables foreign keys per connection, so the ON DELETE
  // CASCADE to bank_notes fires automatically — no explicit PRAGMA needed.
  runSqlite(dbPath, 'DELETE FROM bank_coverage WHERE bank_id = ?;', [String(bankId || '')]);
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
    VALUES (?, ?, ?, ?, ?);
  `, [id, String(bankId || ''), noteText, now, now]);
  const rows = querySqliteJson(dbPath, `${notesSelectSql('id = ?')} LIMIT 1;`, [id]);
  return rows.length ? mapNoteRow(rows[0]) : null;
}

function removeBankNote(outputDir, noteId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  runSqlite(dbPath, 'DELETE FROM bank_notes WHERE id = ?;', [String(noteId || '')]);
  return { success: true };
}

function getPreferredPeerGroup(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT
      bank_id AS bankId,
      peer_group_id AS peerGroupId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_peer_preferences
    WHERE bank_id = ?
    LIMIT 1;
  `, [String(bankId || '')]);
  return rows.length ? {
    bankId: rows[0].bankId,
    peerGroupId: rows[0].peerGroupId,
    createdAt: rows[0].createdAt || '',
    updatedAt: rows[0].updatedAt || ''
  } : null;
}

function setPreferredPeerGroup(outputDir, bankId, peerGroupId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const cleanBankId = cleanText(bankId, 80);
  const cleanPeerGroupId = cleanText(peerGroupId, 80);
  if (!cleanBankId) throw new Error('Bank ID is required');
  if (!cleanPeerGroupId) throw new Error('Peer group ID is required');
  const existing = getPreferredPeerGroup(outputDir, cleanBankId);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO bank_peer_preferences (bank_id, peer_group_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(bank_id) DO UPDATE SET
      peer_group_id = excluded.peer_group_id,
      updated_at = excluded.updated_at;
  `, [cleanBankId, cleanPeerGroupId, existing ? existing.createdAt : now, now]);
  return getPreferredPeerGroup(outputDir, cleanBankId);
}

function removePreferredPeerGroup(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  runSqlite(dbPath, 'DELETE FROM bank_peer_preferences WHERE bank_id = ?;', [String(bankId || '')]);
  return { success: true };
}

// ---------- Bank contacts ----------

function cleanPhone(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^\d+()\-.\s,extEXTx]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 40) : null;
}

function cleanEmail(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned.slice(0, 180);
}

function contactSelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      cert_number AS certNumber,
      name AS name,
      role AS role,
      phone AS phone,
      email AS email,
      is_primary AS isPrimary,
      notes AS notes,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_contacts
    WHERE ${where}
  `;
}

function mapContactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    name: row.name || '',
    role: row.role || '',
    phone: row.phone || '',
    email: row.email || '',
    isPrimary: Boolean(Number(row.isPrimary || 0)),
    notes: row.notes || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function contactOrderBy() {
  return `
    ORDER BY is_primary DESC,
             name COLLATE NOCASE ASC,
             created_at ASC
  `;
}

function listContactsForBank(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const rows = querySqliteJson(dbPath, `
    ${contactSelectSql('bank_id = ?')}
    ${contactOrderBy()}
    LIMIT 200;
  `, [id]);
  return rows.map(mapContactRow);
}

function listContactsForBanks(outputDir, bankIds = []) {
  const ids = [...new Set((bankIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(
    dbPath,
    `${contactSelectSql(`bank_id IN (${ids.map(() => '?').join(',')})`)}
    ${contactOrderBy()};`,
    ids
  );
  const byBank = new Map(ids.map(id => [id, []]));
  rows.forEach(row => {
    const contact = mapContactRow(row);
    if (!contact) return;
    if (!byBank.has(contact.bankId)) byBank.set(contact.bankId, []);
    byBank.get(contact.bankId).push(contact);
  });
  return byBank;
}

function getBankContact(outputDir, contactId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${contactSelectSql('id = ?')} LIMIT 1;`, [String(contactId || '')]);
  return rows.length ? mapContactRow(rows[0]) : null;
}

function createBankContact(outputDir, bankSummary, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const summary = normalizeBankSummary(bankSummary);
  if (!summary.bankId) throw new Error('Bank ID is required');
  const name = cleanText(input.name, 200);
  if (!name) throw new Error('Contact name is required');
  const phone = cleanPhone(input.phone);
  const email = cleanEmail(input.email);
  const role = cleanText(input.role, 120);
  const notes = cleanMultilineText(input.notes, 2000);
  const isPrimary = input.isPrimary ? 1 : 0;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const statements = [];
  if (isPrimary) {
    statements.push({
      sql: 'UPDATE bank_contacts SET is_primary = 0, updated_at = ? WHERE bank_id = ?;',
      params: [now, summary.bankId]
    });
  }
  statements.push({
    sql: `
      INSERT INTO bank_contacts (
        id, bank_id, cert_number, name, role, phone, email, is_primary, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
    params: [
      id, summary.bankId, textOrNull(summary.certNumber), name, textOrNull(role),
      textOrNull(phone), textOrNull(email), isPrimary, textOrNull(notes), now, now
    ]
  });
  txSqlite(dbPath, statements);
  return getBankContact(outputDir, id);
}

function updateBankContact(outputDir, contactId, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBankContact(outputDir, contactId);
  if (!existing) throw new Error('Contact not found');
  const name = input.name !== undefined ? (cleanText(input.name, 200) || existing.name) : existing.name;
  if (!name) throw new Error('Contact name is required');
  const role = input.role !== undefined ? cleanText(input.role, 120) : existing.role;
  const phone = input.phone !== undefined ? cleanPhone(input.phone) : existing.phone;
  const email = input.email !== undefined ? cleanEmail(input.email) : existing.email;
  const notes = input.notes !== undefined ? cleanMultilineText(input.notes, 2000) : existing.notes;
  const isPrimary = input.isPrimary !== undefined ? (input.isPrimary ? 1 : 0) : (existing.isPrimary ? 1 : 0);
  const now = new Date().toISOString();

  const statements = [];
  if (isPrimary) {
    statements.push({
      sql: 'UPDATE bank_contacts SET is_primary = 0, updated_at = ? WHERE bank_id = ? AND id <> ?;',
      params: [now, existing.bankId, existing.id]
    });
  }
  statements.push({
    sql: `
      UPDATE bank_contacts SET
        name = ?,
        role = ?,
        phone = ?,
        email = ?,
        is_primary = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?;
    `,
    params: [name, textOrNull(role), textOrNull(phone), textOrNull(email), isPrimary, textOrNull(notes), now, existing.id]
  });
  txSqlite(dbPath, statements);
  return getBankContact(outputDir, existing.id);
}

function deleteBankContact(outputDir, contactId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBankContact(outputDir, contactId);
  runSqlite(dbPath, 'DELETE FROM bank_contacts WHERE id = ?;', [String(contactId || '')]);
  return existing || { id: contactId };
}

// Every contact across every bank, for the firm-wide Contacts directory.
// The caller joins bank display names and applies the search filter (contact
// volume is manual-entry scale, so shipping all rows is fine).
function listAllContacts(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 2000), 10000));
  const rows = querySqliteJson(dbPath, `
    SELECT id, bank_id AS bankId, cert_number AS certNumber, name, role, phone, email,
           is_primary AS isPrimary, notes, created_at AS createdAt, updated_at AS updatedAt
    FROM bank_contacts
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?;
  `, [limit]);
  return rows.map(row => ({
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    name: row.name || '',
    role: row.role || '',
    phone: row.phone || '',
    email: row.email || '',
    isPrimary: Boolean(row.isPrimary),
    notes: row.notes || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  }));
}

// ---------- Bank activity timeline ----------

function activitySelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      cert_number AS certNumber,
      at AS at,
      actor_username AS actorUsername,
      actor_display AS actorDisplay,
      kind AS kind,
      summary AS summary,
      subject AS subject,
      body AS body,
      activity_date AS activityDate,
      contact_id AS contactId,
      ref_type AS refType,
      ref_id AS refId
    FROM bank_activities
    WHERE deleted_at IS NULL AND (${where})
  `;
}

function mapActivityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    at: row.at || '',
    actorUsername: row.actorUsername || '',
    actorDisplay: row.actorDisplay || '',
    kind: row.kind || '',
    summary: row.summary || '',
    subject: row.subject || '',
    body: row.body || '',
    activityDate: row.activityDate || '',
    contactId: row.contactId || '',
    refType: row.refType || '',
    refId: row.refId || ''
  };
}

function recordBankActivity(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const bankId = cleanText(payload.bankId, 80);
  if (!bankId) return null;
  const kind = cleanText(payload.kind, 60);
  if (!kind) return null;
  const id = crypto.randomUUID();
  const at = payload.at || new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO bank_activities (
      id, bank_id, cert_number, at, actor_username, actor_display,
      kind, summary, ref_type, ref_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bankId,
    textOrNull(cleanText(payload.certNumber, 40)),
    at,
    textOrNull(cleanText(payload.actorUsername, 80)),
    textOrNull(cleanText(payload.actorDisplay, 200)),
    kind,
    textOrNull(cleanText(payload.summary, 500)),
    textOrNull(cleanText(payload.refType, 60)),
    textOrNull(cleanText(payload.refId, 80))
  ]);
  return { id, bankId, at, kind };
}

function listActivitiesForBank(outputDir, bankId, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 100), 500));
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql('bank_id = ?')}
    ORDER BY at DESC, id DESC
    LIMIT ?;
  `, [id, limit]);
  return rows.map(mapActivityRow);
}

// Soft delete: the row stays in bank_activities (content intact) but is
// stamped with who removed it, when, and why, and disappears from every read
// path. A regulated BD can't have reps hard-deleting their own call records.
function deleteBankActivity(outputDir, bankId, activityId, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(activityId || '');
  const bank = String(bankId || '');
  if (!id || !bank) return null;
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql('id = ? AND bank_id = ?')}
    LIMIT 1;
  `, [id, bank]);
  const activity = mapActivityRow(rows[0]);
  if (!activity) return null;
  runSqlite(dbPath, `
    UPDATE bank_activities
    SET deleted_at = ?, deleted_by = ?, delete_reason = ?
    WHERE id = ?
      AND bank_id = ?
      AND deleted_at IS NULL;
  `, [
    new Date().toISOString(),
    textOrNull(cleanText(options.deletedBy, 200)),
    textOrNull(cleanText(options.reason, 500)),
    id,
    bank
  ]);
  return activity;
}

function listRecentActivitiesByActor(outputDir, actorUsername, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const username = String(actorUsername || '').toLowerCase();
  if (!username) return [];
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 20), 200));
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql('LOWER(actor_username) = ?')}
    ORDER BY at DESC
    LIMIT ?;
  `, [username, limit]);
  return rows.map(mapActivityRow);
}

// Most recent manual CRM activities across all banks — feeds the CRM
// dashboard's "recent activity" widget.
function listRecentManualActivities(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const kinds = sanitizeManualKinds(options.kinds);
  const inList = kinds.map(() => '?').join(', ');
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 20), 100));
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql(`kind IN (${inList})`)}
    ORDER BY at DESC
    LIMIT ?;
  `, [...kinds, limit]);
  return rows.map(mapActivityRow);
}

// Restrict a caller-supplied kind list to the manual whitelist so it is always
// safe to inline into an IN (...) clause. Falls back to all manual kinds.
function sanitizeManualKinds(kinds) {
  const list = Array.isArray(kinds)
    ? kinds.map(k => cleanText(k, 60)).filter(k => MANUAL_ACTIVITY_KIND_SET.has(k))
    : [];
  return list.length ? list : MANUAL_ACTIVITY_KINDS.slice();
}

// A manual activity is the rep's CRM "touch": Call/Email/Meeting/Task/Note with
// a subject, free-text body, and a rep-chosen date (distinct from `at`, the
// system insert time). Stored in bank_activities alongside audit rows; `summary`
// is back-filled from the subject so the legacy timeline renderer still reads.
function recordManualActivity(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const bankId = cleanText(payload.bankId, 80);
  if (!bankId) return null;
  const kind = cleanText(payload.kind, 60);
  if (!MANUAL_ACTIVITY_KIND_SET.has(kind)) return null;
  const id = crypto.randomUUID();
  const at = payload.at || new Date().toISOString();
  const activityDate = cleanDate(payload.activityDate) || at.slice(0, 10);
  const subject = cleanText(payload.subject, 300);
  const body = cleanMultilineText(payload.body, 4000);
  // summary keeps the old timeline readable even before the typed UI ships.
  const summary = subject || (kind.charAt(0).toUpperCase() + kind.slice(1));
  runSqlite(dbPath, `
    INSERT INTO bank_activities (
      id, bank_id, cert_number, at, actor_username, actor_display,
      kind, summary, subject, body, activity_date, contact_id, ref_type, ref_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bankId,
    textOrNull(cleanText(payload.certNumber, 40)),
    at,
    textOrNull(cleanText(payload.actorUsername, 80)),
    textOrNull(cleanText(payload.actorDisplay, 200)),
    kind,
    textOrNull(summary),
    textOrNull(subject),
    textOrNull(body),
    activityDate,
    textOrNull(cleanText(payload.contactId, 80)),
    'activity',
    id
  ]);
  const rows = querySqliteJson(dbPath, `${activitySelectSql('id = ?')} LIMIT 1;`, [id]);
  return mapActivityRow(rows[0]);
}

// Latest manual-touch date per bank → { [bankId]: 'YYYY-MM-DD' }. Uses the
// rep-chosen activity_date when present, else the insert day. Powers the
// "going cold" / last-activity surfacing (Phase 2) and Account Touch report.
function lastActivityByBank(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const kinds = sanitizeManualKinds(options.kinds);
  const inList = kinds.map(() => '?').join(', ');
  const rows = querySqliteJson(dbPath, `
    SELECT bank_id AS bankId,
           MAX(COALESCE(activity_date, substr(at, 1, 10))) AS lastDate
    FROM bank_activities
    WHERE deleted_at IS NULL AND kind IN (${inList})
    GROUP BY bank_id;
  `, kinds);
  const map = {};
  rows.forEach(row => { if (row.bankId) map[row.bankId] = row.lastDate || ''; });
  return map;
}

// Per-rep manual-activity counts by kind within an optional date window
// (inclusive YYYY-MM-DD on the effective activity date). Powers the
// Activity-Summary-by-Rep report (Phase 4).
function activityCountsByRep(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const kinds = sanitizeManualKinds(options.kinds);
  const inList = kinds.map(() => '?').join(', ');
  const params = kinds.slice();
  const where = ['deleted_at IS NULL', `kind IN (${inList})`];
  const from = cleanDate(options.from);
  const to = cleanDate(options.to);
  if (from) { where.push(`COALESCE(activity_date, substr(at, 1, 10)) >= ?`); params.push(from); }
  if (to) { where.push(`COALESCE(activity_date, substr(at, 1, 10)) <= ?`); params.push(to); }
  const rows = querySqliteJson(dbPath, `
    SELECT actor_username AS actorUsername,
           actor_display AS actorDisplay,
           kind AS kind,
           COUNT(*) AS count,
           MAX(COALESCE(activity_date, substr(at, 1, 10))) AS lastDate
    FROM bank_activities
    WHERE ${where.join(' AND ')}
    GROUP BY actor_username, kind;
  `, params);
  return rows.map(row => ({
    actorUsername: row.actorUsername || '',
    actorDisplay: row.actorDisplay || '',
    kind: row.kind || '',
    count: Number(row.count) || 0,
    lastDate: row.lastDate || ''
  }));
}

// Per-bank manual-activity counts by kind within an optional date window —
// the "which accounts get the attention" flip side of activityCountsByRep.
function activityCountsByBank(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const kinds = sanitizeManualKinds(options.kinds);
  const inList = kinds.map(() => '?').join(', ');
  const params = kinds.slice();
  const where = ['deleted_at IS NULL', `kind IN (${inList})`];
  const from = cleanDate(options.from);
  const to = cleanDate(options.to);
  if (from) { where.push(`COALESCE(activity_date, substr(at, 1, 10)) >= ?`); params.push(from); }
  if (to) { where.push(`COALESCE(activity_date, substr(at, 1, 10)) <= ?`); params.push(to); }
  const rows = querySqliteJson(dbPath, `
    SELECT bank_id AS bankId,
           kind AS kind,
           COUNT(*) AS count,
           MAX(COALESCE(activity_date, substr(at, 1, 10))) AS lastDate
    FROM bank_activities
    WHERE ${where.join(' AND ')}
    GROUP BY bank_id, kind;
  `, params);
  return rows.map(row => ({
    bankId: row.bankId || '',
    kind: row.kind || '',
    count: Number(row.count) || 0,
    lastDate: row.lastDate || ''
  }));
}

// ---------- Product fit ----------

function productFitSelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      cert_number AS certNumber,
      product AS product,
      notes AS notes,
      flagged_by_username AS flaggedByUsername,
      flagged_by_display AS flaggedByDisplay,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_product_fit
    WHERE ${where}
  `;
}

function mapProductFitRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    product: row.product || '',
    notes: row.notes || '',
    flaggedByUsername: row.flaggedByUsername || '',
    flaggedByDisplay: row.flaggedByDisplay || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || ''
  };
}

function listProductFitForBank(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const rows = querySqliteJson(dbPath, `
    ${productFitSelectSql('bank_id = ?')}
    ORDER BY product COLLATE NOCASE ASC;
  `, [id]);
  return rows.map(mapProductFitRow);
}

function listProductFitForBanks(outputDir, bankIds = []) {
  const ids = [...new Set((bankIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(
    dbPath,
    `${productFitSelectSql(`bank_id IN (${ids.map(() => '?').join(',')})`)}
    ORDER BY product COLLATE NOCASE ASC;`,
    ids
  );
  const byBank = new Map(ids.map(id => [id, []]));
  rows.forEach(row => {
    const fit = mapProductFitRow(row);
    if (!fit) return;
    if (!byBank.has(fit.bankId)) byBank.set(fit.bankId, []);
    byBank.get(fit.bankId).push(fit);
  });
  return byBank;
}

function getProductFitById(outputDir, id) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${productFitSelectSql('id = ?')} LIMIT 1;`, [String(id || '')]);
  return rows.length ? mapProductFitRow(rows[0]) : null;
}

function upsertProductFit(outputDir, bankSummary, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const summary = normalizeBankSummary(bankSummary);
  if (!summary.bankId) throw new Error('Bank ID is required');
  const product = cleanText(input.product, 80);
  if (!product) throw new Error('Product is required');
  if (!PRODUCT_FIT_PRODUCTS.includes(product)) throw new Error(`Unknown product: ${product}`);
  const notes = cleanMultilineText(input.notes, 1000);
  const now = new Date().toISOString();

  // Try update first.
  const existing = querySqliteJson(dbPath, `
    ${productFitSelectSql('bank_id = ? AND product = ?')}
    LIMIT 1;
  `, [summary.bankId, product]).map(mapProductFitRow)[0];

  if (existing) {
    runSqlite(dbPath, `
      UPDATE bank_product_fit SET
        notes = ?,
        flagged_by_username = ?,
        flagged_by_display = ?,
        updated_at = ?
      WHERE id = ?;
    `, [
      textOrNull(notes !== null ? notes : existing.notes),
      textOrNull(cleanText(input.flaggedByUsername, 80) || existing.flaggedByUsername),
      textOrNull(cleanText(input.flaggedByDisplay, 200) || existing.flaggedByDisplay),
      now,
      existing.id
    ]);
    return getProductFitById(outputDir, existing.id);
  }

  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT INTO bank_product_fit (
      id, bank_id, cert_number, product, notes,
      flagged_by_username, flagged_by_display, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    summary.bankId,
    textOrNull(summary.certNumber),
    product,
    textOrNull(notes),
    textOrNull(cleanText(input.flaggedByUsername, 80)),
    textOrNull(cleanText(input.flaggedByDisplay, 200)),
    now,
    now
  ]);
  return getProductFitById(outputDir, id);
}

function deleteProductFit(outputDir, id) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getProductFitById(outputDir, id);
  runSqlite(dbPath, 'DELETE FROM bank_product_fit WHERE id = ?;', [String(id || '')]);
  return existing;
}

// ---------- Billing queue ----------

function billingSelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      ref_type AS refType,
      ref_id AS refId,
      bank_id AS bankId,
      cert_number AS certNumber,
      summary AS summary,
      amount AS amount,
      state AS state,
      enqueued_at AS enqueuedAt,
      billed_at AS billedAt,
      billed_by AS billedBy,
      notes AS notes
    FROM billing_queue
    WHERE ${where}
  `;
}

function mapBillingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    refType: row.refType || '',
    refId: row.refId || '',
    bankId: row.bankId || '',
    certNumber: row.certNumber || '',
    summary: row.summary || '',
    amount: row.amount == null ? null : Number(row.amount),
    state: row.state || 'Pending',
    enqueuedAt: row.enqueuedAt || '',
    billedAt: row.billedAt || '',
    billedBy: row.billedBy || '',
    notes: row.notes || ''
  };
}

function listBillingQueue(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const state = cleanText(options.state, 40);
  const params = [];
  let where = '1 = 1';
  if (state) { where = 'state = ?'; params.push(state); }
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 500), 2000));
  params.push(limit);
  const rows = querySqliteJson(dbPath, `
    ${billingSelectSql(where)}
    ORDER BY
      CASE state WHEN 'Pending' THEN 1 WHEN 'Invoiced' THEN 2 WHEN 'Paid' THEN 3 ELSE 4 END,
      enqueued_at DESC
    LIMIT ?;
  `, params);
  return rows.map(mapBillingRow);
}

function getBillingItem(outputDir, id) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${billingSelectSql('id = ?')} LIMIT 1;`, [String(id || '')]);
  return rows.length ? mapBillingRow(rows[0]) : null;
}

function enqueueBilling(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const refType = cleanText(payload.refType, 40);
  const refId = cleanText(payload.refId, 80);
  const bankId = cleanText(payload.bankId, 80);
  if (!refType || !refId || !bankId) return null;

  const existing = querySqliteJson(dbPath, `
    ${billingSelectSql('ref_type = ? AND ref_id = ?')}
    LIMIT 1;
  `, [refType, refId]).map(mapBillingRow)[0];

  const now = new Date().toISOString();
  if (existing) {
    const patchedNotes = cleanText(payload.notes, 2000);
    runSqlite(dbPath, `
      UPDATE billing_queue SET
        summary = ?,
        amount = ?,
        cert_number = ?,
        notes = ?
      WHERE id = ?;
    `, [
      textOrNull(cleanText(payload.summary, 500) || existing.summary),
      numOrNull(payload.amount != null ? payload.amount : existing.amount),
      textOrNull(cleanText(payload.certNumber, 40) || existing.certNumber),
      textOrNull(patchedNotes !== null ? patchedNotes : existing.notes),
      existing.id
    ]);
    return getBillingItem(outputDir, existing.id);
  }
  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT INTO billing_queue (
      id, ref_type, ref_id, bank_id, cert_number, summary, amount, state,
      enqueued_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    refType,
    refId,
    bankId,
    textOrNull(cleanText(payload.certNumber, 40)),
    textOrNull(cleanText(payload.summary, 500)),
    numOrNull(payload.amount),
    'Pending',
    now,
    textOrNull(cleanText(payload.notes, 2000))
  ]);
  return getBillingItem(outputDir, id);
}

function updateBillingItem(outputDir, id, input = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBillingItem(outputDir, id);
  if (!existing) throw new Error('Billing item not found');
  if (input.state && !BILLING_STATES.has(input.state)) {
    throw new Error(`Unknown billing state: ${input.state}`);
  }
  const state = input.state || existing.state;
  const amount = input.amount !== undefined ? input.amount : existing.amount;
  const notes = input.notes !== undefined ? (cleanText(input.notes, 2000) || '') : existing.notes;
  const now = new Date().toISOString();
  const billedAt = state === existing.state ? existing.billedAt : (state === 'Pending' ? null : now);
  const billedBy = state === existing.state ? existing.billedBy : (state === 'Pending' ? null : cleanText(input.billedBy, 120));
  runSqlite(dbPath, `
    UPDATE billing_queue SET
      state = ?,
      amount = ?,
      notes = ?,
      billed_at = ?,
      billed_by = ?
    WHERE id = ?;
  `, [
    textOrNull(state),
    numOrNull(amount),
    textOrNull(notes),
    textOrNull(billedAt),
    textOrNull(billedBy),
    existing.id
  ]);
  return getBillingItem(outputDir, existing.id);
}

function countBillingByState(outputDir) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT state AS state, COUNT(*) AS count FROM billing_queue GROUP BY state;
  `);
  const counts = { Pending: 0, Invoiced: 0, Paid: 0, Waived: 0 };
  rows.forEach(r => { counts[r.state] = Number(r.count || 0); });
  return counts;
}

// ---------- Bank tasks (CRM task engine) ----------
//
// Future-dated follow-up work: "call them back Friday", "send the swap
// proposal after their board meeting". Distinct from the past-tense `task`
// activity kind (which logs work already done) and from bank_coverage's
// single next_action_date. A bank can carry any number of open tasks, each
// with its own due date and assignee.

const TASK_STATUSES = ['Open', 'Done', 'Cancelled'];
const TASK_STATUS_SET = new Set(TASK_STATUSES);
const TASK_PRIORITIES = ['Low', 'Normal', 'High'];
const TASK_PRIORITY_SET = new Set(TASK_PRIORITIES);

function taskSelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      cert_number AS certNumber,
      title AS title,
      body AS body,
      due_date AS dueDate,
      priority AS priority,
      status AS status,
      assigned_to AS assignedTo,
      assigned_display AS assignedDisplay,
      created_by AS createdBy,
      created_display AS createdDisplay,
      created_at AS createdAt,
      updated_at AS updatedAt,
      completed_at AS completedAt,
      completed_by AS completedBy
    FROM bank_tasks
    WHERE ${where}
  `;
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    title: row.title || '',
    body: row.body || '',
    dueDate: row.dueDate || '',
    priority: row.priority || 'Normal',
    status: row.status || 'Open',
    assignedTo: row.assignedTo || '',
    assignedDisplay: row.assignedDisplay || '',
    createdBy: row.createdBy || '',
    createdDisplay: row.createdDisplay || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    completedAt: row.completedAt || '',
    completedBy: row.completedBy || ''
  };
}

function createBankTask(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const bankId = cleanText(payload.bankId, 80);
  const title = cleanText(payload.title, 300);
  if (!bankId || !title) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const priority = TASK_PRIORITY_SET.has(payload.priority) ? payload.priority : 'Normal';
  runSqlite(dbPath, `
    INSERT INTO bank_tasks (
      id, bank_id, cert_number, title, body, due_date, priority, status,
      assigned_to, assigned_display, created_by, created_display, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bankId,
    textOrNull(cleanText(payload.certNumber, 40)),
    title,
    textOrNull(cleanMultilineText(payload.body, 4000)),
    textOrNull(cleanDate(payload.dueDate)),
    priority,
    textOrNull(cleanText(payload.assignedTo, 80)),
    textOrNull(cleanText(payload.assignedDisplay, 200)),
    textOrNull(cleanText(payload.createdBy, 80)),
    textOrNull(cleanText(payload.createdDisplay, 200)),
    now,
    now
  ]);
  return getBankTask(outputDir, id);
}

function getBankTask(outputDir, taskId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${taskSelectSql('id = ?')} LIMIT 1;`, [String(taskId || '')]);
  return mapTaskRow(rows[0]);
}

// Patch title/body/dueDate/priority/assignee/status. Setting status to Done
// (or Cancelled) stamps completed_at/by; reopening clears them.
function updateBankTask(outputDir, taskId, patch = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBankTask(outputDir, taskId);
  if (!existing) return null;
  const sets = [];
  const params = [];
  if (patch.title !== undefined) {
    const title = cleanText(patch.title, 300);
    if (title) { sets.push('title = ?'); params.push(title); }
  }
  if (patch.body !== undefined) { sets.push('body = ?'); params.push(textOrNull(cleanMultilineText(patch.body, 4000))); }
  if (patch.dueDate !== undefined) { sets.push('due_date = ?'); params.push(textOrNull(cleanDate(patch.dueDate))); }
  if (patch.priority !== undefined && TASK_PRIORITY_SET.has(patch.priority)) { sets.push('priority = ?'); params.push(patch.priority); }
  if (patch.assignedTo !== undefined) { sets.push('assigned_to = ?'); params.push(textOrNull(cleanText(patch.assignedTo, 80))); }
  if (patch.assignedDisplay !== undefined) { sets.push('assigned_display = ?'); params.push(textOrNull(cleanText(patch.assignedDisplay, 200))); }
  if (patch.status !== undefined && TASK_STATUS_SET.has(patch.status) && patch.status !== existing.status) {
    sets.push('status = ?'); params.push(patch.status);
    if (patch.status === 'Open') {
      sets.push('completed_at = NULL', 'completed_by = NULL');
    } else {
      sets.push('completed_at = ?'); params.push(new Date().toISOString());
      sets.push('completed_by = ?'); params.push(textOrNull(cleanText(patch.completedBy, 200)));
    }
  }
  if (!sets.length) return existing;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(existing.id);
  runSqlite(dbPath, `UPDATE bank_tasks SET ${sets.join(', ')} WHERE id = ?;`, params);
  return getBankTask(outputDir, taskId);
}

function listTasksForBank(outputDir, bankId, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const where = options.includeClosed ? 'bank_id = ?' : `bank_id = ? AND status = 'Open'`;
  const rows = querySqliteJson(dbPath, `
    ${taskSelectSql(where)}
    ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, created_at ASC
    LIMIT 200;
  `, [id]);
  return rows.map(mapTaskRow);
}

// Open tasks for a rep, bucketed for My Work: overdue / due today / upcoming
// (incl. undated). `today` is injectable for tests (YYYY-MM-DD).
function listTasksForRep(outputDir, username, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const user = String(username || '').toLowerCase();
  if (!user) return { overdue: [], dueToday: [], upcoming: [], openCount: 0 };
  const today = cleanDate(options.today) || new Date().toISOString().slice(0, 10);
  const rows = querySqliteJson(dbPath, `
    ${taskSelectSql(`status = 'Open' AND LOWER(COALESCE(assigned_to, '')) = ?`)}
    ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, created_at ASC
    LIMIT 200;
  `, [user]);
  const tasks = rows.map(mapTaskRow);
  const overdue = tasks.filter(t => t.dueDate && t.dueDate < today);
  const dueToday = tasks.filter(t => t.dueDate === today);
  const upcoming = tasks.filter(t => !t.dueDate || t.dueDate > today);
  return { overdue, dueToday, upcoming, openCount: tasks.length };
}

// Firm-wide overdue Open tasks (due_date strictly before `today`), newest-due
// first, optionally rep-scoped by assignee. This is the successor to the old
// bank_coverage.next_action_date "stale follow-up" signal, which the
// 2026-06-12 coverage consolidation folded into the task engine and cleared.
function listOverdueOpenTasks(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const today = cleanDate(options.today) || new Date().toISOString().slice(0, 10);
  const params = [today];
  let where = `status = 'Open' AND due_date IS NOT NULL AND due_date != '' AND due_date < ?`;
  if (options.username) {
    where += ` AND LOWER(COALESCE(assigned_to, '')) = ?`;
    params.push(String(options.username).toLowerCase());
  }
  const limit = Math.min(5000, Math.max(1, Math.floor(Number(options.limit) || 2000)));
  const rows = querySqliteJson(dbPath, `
    ${taskSelectSql(where)}
    ORDER BY due_date ASC, created_at ASC
    LIMIT ${limit};
  `, params);
  return rows.map(mapTaskRow);
}

// Open tasks due within [today, horizon] inclusive, earliest-due first,
// optionally rep-scoped by assignee. Powers the CRM dashboard's "upcoming
// follow-ups" (also a successor to next_action_date).
function listUpcomingOpenTasks(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const today = cleanDate(options.today) || new Date().toISOString().slice(0, 10);
  const horizon = cleanDate(options.horizon) || today;
  const params = [today, horizon];
  let where = `status = 'Open' AND due_date IS NOT NULL AND due_date != '' AND due_date >= ? AND due_date <= ?`;
  if (options.username) {
    where += ` AND LOWER(COALESCE(assigned_to, '')) = ?`;
    params.push(String(options.username).toLowerCase());
  }
  const limit = Math.min(5000, Math.max(1, Math.floor(Number(options.limit) || 200)));
  const rows = querySqliteJson(dbPath, `
    ${taskSelectSql(where)}
    ORDER BY due_date ASC, created_at ASC
    LIMIT ${limit};
  `, params);
  return rows.map(mapTaskRow);
}

// Firm-wide open/overdue counts for the CRM dashboard; rep-scoped when a
// username is given.
function countOpenTasks(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const today = cleanDate(options.today) || new Date().toISOString().slice(0, 10);
  const params = [];
  let where = `status = 'Open'`;
  if (options.username) {
    where += ` AND LOWER(COALESCE(assigned_to, '')) = ?`;
    params.push(String(options.username).toLowerCase());
  }
  const rows = querySqliteJson(dbPath, `
    SELECT COUNT(*) AS open,
           SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM bank_tasks
    WHERE ${where};
  `, [today, ...params]);
  const row = rows[0] || {};
  return { open: Number(row.open) || 0, overdue: Number(row.overdue) || 0 };
}

// ---------- Bank opportunities (sales pipeline) ----------
//
// A deal in flight: "this bank should buy brokered CDs / needs a bond swap /
// is a BCIS candidate", with an estimated value and a stage. Distinct from
// the Strategies Queue (which tracks fulfillment of work already requested) —
// an opportunity is the *selling* side, and a won opportunity often becomes
// a strategy request.

const OPPORTUNITY_STAGES = ['Prospect', 'Qualified', 'Proposed', 'Won', 'Lost'];
const OPPORTUNITY_STAGE_SET = new Set(OPPORTUNITY_STAGES);
const OPPORTUNITY_OPEN_STAGES = ['Prospect', 'Qualified', 'Proposed'];

function opportunitySelectSql(where = '1 = 1') {
  return `
    SELECT
      id AS id,
      bank_id AS bankId,
      cert_number AS certNumber,
      product AS product,
      description AS description,
      est_value AS estValue,
      stage AS stage,
      close_date AS closeDate,
      owner AS owner,
      owner_display AS ownerDisplay,
      created_by AS createdBy,
      created_display AS createdDisplay,
      created_at AS createdAt,
      updated_at AS updatedAt,
      stage_changed_at AS stageChangedAt,
      closed_at AS closedAt
    FROM bank_opportunities
    WHERE ${where}
  `;
}

function mapOpportunityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bankId,
    certNumber: row.certNumber || '',
    product: row.product || '',
    description: row.description || '',
    estValue: row.estValue == null ? null : Number(row.estValue),
    stage: row.stage || 'Prospect',
    closeDate: row.closeDate || '',
    owner: row.owner || '',
    ownerDisplay: row.ownerDisplay || '',
    createdBy: row.createdBy || '',
    createdDisplay: row.createdDisplay || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    stageChangedAt: row.stageChangedAt || '',
    closedAt: row.closedAt || ''
  };
}

function cleanEstValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function createBankOpportunity(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const bankId = cleanText(payload.bankId, 80);
  const product = cleanText(payload.product, 120);
  if (!bankId || !product) return null;
  const stage = OPPORTUNITY_STAGE_SET.has(payload.stage) ? payload.stage : 'Prospect';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO bank_opportunities (
      id, bank_id, cert_number, product, description, est_value, stage, close_date,
      owner, owner_display, created_by, created_display, created_at, updated_at, stage_changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bankId,
    textOrNull(cleanText(payload.certNumber, 40)),
    product,
    textOrNull(cleanMultilineText(payload.description, 2000)),
    cleanEstValue(payload.estValue),
    stage,
    textOrNull(cleanDate(payload.closeDate)),
    textOrNull(cleanText(payload.owner, 80)),
    textOrNull(cleanText(payload.ownerDisplay, 200)),
    textOrNull(cleanText(payload.createdBy, 80)),
    textOrNull(cleanText(payload.createdDisplay, 200)),
    now,
    now,
    now
  ]);
  return getBankOpportunity(outputDir, id);
}

function getBankOpportunity(outputDir, oppId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${opportunitySelectSql('id = ?')} LIMIT 1;`, [String(oppId || '')]);
  return mapOpportunityRow(rows[0]);
}

// Patch product/description/estValue/closeDate/owner/stage. Stage moves stamp
// stage_changed_at; moving into Won/Lost stamps closed_at, moving back out
// clears it.
function updateBankOpportunity(outputDir, oppId, patch = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBankOpportunity(outputDir, oppId);
  if (!existing) return null;
  const sets = [];
  const params = [];
  if (patch.product !== undefined) {
    const product = cleanText(patch.product, 120);
    if (product) { sets.push('product = ?'); params.push(product); }
  }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(textOrNull(cleanMultilineText(patch.description, 2000))); }
  if (patch.estValue !== undefined) { sets.push('est_value = ?'); params.push(cleanEstValue(patch.estValue)); }
  if (patch.closeDate !== undefined) { sets.push('close_date = ?'); params.push(textOrNull(cleanDate(patch.closeDate))); }
  if (patch.owner !== undefined) { sets.push('owner = ?'); params.push(textOrNull(cleanText(patch.owner, 80))); }
  if (patch.ownerDisplay !== undefined) { sets.push('owner_display = ?'); params.push(textOrNull(cleanText(patch.ownerDisplay, 200))); }
  if (patch.stage !== undefined && OPPORTUNITY_STAGE_SET.has(patch.stage) && patch.stage !== existing.stage) {
    const now = new Date().toISOString();
    sets.push('stage = ?'); params.push(patch.stage);
    sets.push('stage_changed_at = ?'); params.push(now);
    if (patch.stage === 'Won' || patch.stage === 'Lost') {
      sets.push('closed_at = ?'); params.push(now);
    } else {
      sets.push('closed_at = NULL');
    }
  }
  if (!sets.length) return existing;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(existing.id);
  runSqlite(dbPath, `UPDATE bank_opportunities SET ${sets.join(', ')} WHERE id = ?;`, params);
  return getBankOpportunity(outputDir, oppId);
}

function listOpportunitiesForBank(outputDir, bankId, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const openList = OPPORTUNITY_OPEN_STAGES.map(s => `'${s}'`).join(', ');
  const where = options.includeClosed ? 'bank_id = ?' : `bank_id = ? AND stage IN (${openList})`;
  const rows = querySqliteJson(dbPath, `
    ${opportunityOrderedSql(where)}
    LIMIT 200;
  `, [id]);
  return rows.map(mapOpportunityRow);
}

// Opportunity list ordered nearest close date first, then newest. Kept out of
// opportunitySelectSql so summaries can aggregate freely.
function opportunityOrderedSql(where) {
  return `${opportunitySelectSql(where)}
    ORDER BY CASE WHEN close_date IS NULL THEN 1 ELSE 0 END, close_date ASC, created_at DESC`;
}

// Pipeline rollup for #pulse and the pipeline report: open count + value
// total, then by stage / product / owner. Rep-scoped when username given.
function pipelineSummary(outputDir, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const params = [];
  let scope = '1 = 1';
  if (options.username) {
    scope = `LOWER(COALESCE(owner, '')) = ?`;
    params.push(String(options.username).toLowerCase());
  }
  const openList = OPPORTUNITY_OPEN_STAGES.map(s => `'${s}'`).join(', ');
  const group = (col, alias) => querySqliteJson(dbPath, `
    SELECT ${col} AS ${alias}, COUNT(*) AS count, COALESCE(SUM(est_value), 0) AS value
    FROM bank_opportunities
    WHERE ${scope} AND stage IN (${openList})
    GROUP BY ${col};
  `, params);
  const stageRows = group('stage', 'key');
  const byStage = OPPORTUNITY_OPEN_STAGES.map(stage => {
    const row = stageRows.find(r => r.key === stage);
    return { stage, count: row ? Number(row.count) : 0, value: row ? Number(row.value) : 0 };
  });
  const byProduct = group('product', 'key')
    .map(r => ({ product: r.key || '—', count: Number(r.count), value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
  const byOwner = group(`COALESCE(owner_display, owner, '—')`, 'key')
    .map(r => ({ owner: r.key || '—', count: Number(r.count), value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
  const open = byStage.reduce((acc, s) => ({ count: acc.count + s.count, value: acc.value + s.value }), { count: 0, value: 0 });
  const quarterStartMonth = Math.floor(new Date().getMonth() / 3) * 3 + 1;
  const quarterStart = `${new Date().getFullYear()}-${String(quarterStartMonth).padStart(2, '0')}-01`;
  const closedRows = querySqliteJson(dbPath, `
    SELECT stage AS stage, COUNT(*) AS count, COALESCE(SUM(est_value), 0) AS value
    FROM bank_opportunities
    WHERE ${scope} AND stage IN ('Won', 'Lost') AND closed_at >= ?
    GROUP BY stage;
  `, [...params, quarterStart]);
  const wonRow = closedRows.find(r => r.stage === 'Won');
  const lostRow = closedRows.find(r => r.stage === 'Lost');
  const openItems = querySqliteJson(dbPath, `
    ${opportunityOrderedSql(`${scope} AND stage IN (${openList})`)}
    LIMIT 12;
  `, params).map(mapOpportunityRow);
  return {
    open,
    byStage,
    byProduct,
    byOwner,
    wonThisQuarter: { count: wonRow ? Number(wonRow.count) : 0, value: wonRow ? Number(wonRow.value) : 0 },
    lostThisQuarter: { count: lostRow ? Number(lostRow.count) : 0, value: lostRow ? Number(lostRow.value) : 0 },
    openItems
  };
}

// ---------- Watchlist (per-rep, securities + banks) ----------
//
// A rep's persistent "keep an eye on this" list: securities (by CUSIP, with
// a label snapshot + native-explorer page for the deep link) and banks (by
// bankId). No alerts — just a list the Watchlist page re-joins against
// today's inventory so the rep sees what's still offered.

const WATCHLIST_KINDS = new Set(['security', 'bank']);

function addWatchlistItem(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rep = cleanText(payload.rep, 80).toLowerCase();
  const kind = WATCHLIST_KINDS.has(payload.kind) ? payload.kind : null;
  const refId = cleanText(payload.refId, 80);
  if (!rep || !kind || !refId) return null;
  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT OR IGNORE INTO watchlist_items (id, rep, kind, ref_id, label, asset_class, page, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id, rep, kind, refId,
    textOrNull(cleanText(payload.label, 300)),
    textOrNull(cleanText(payload.assetClass, 60)),
    textOrNull(cleanText(payload.page, 60)),
    new Date().toISOString()
  ]);
  return { rep, kind, refId };
}

function removeWatchlistItem(outputDir, rep, kind, refId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const result = runSqlite(dbPath, `
    DELETE FROM watchlist_items WHERE rep = ? AND kind = ? AND ref_id = ?;
  `, [String(rep || '').toLowerCase(), String(kind || ''), String(refId || '')]);
  return result.changes > 0;
}

function listWatchlist(outputDir, rep) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const user = String(rep || '').toLowerCase();
  if (!user) return [];
  return querySqliteJson(dbPath, `
    SELECT id, kind, ref_id AS refId, label, asset_class AS assetClass, page, created_at AS createdAt
    FROM watchlist_items
    WHERE rep = ?
    ORDER BY created_at DESC
    LIMIT 500;
  `, [user]).map(row => ({
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    label: row.label || '',
    assetClass: row.assetClass || '',
    page: row.page || '',
    createdAt: row.createdAt || ''
  }));
}

module.exports = {
  BILLING_STATES,
  COVERAGE_DATABASE_FILENAME,
  MANUAL_ACTIVITY_KINDS,
  PRODUCT_FIT_PRODUCTS,
  OPPORTUNITY_STAGES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  countOpenTasks,
  createBankOpportunity,
  createBankTask,
  getBankOpportunity,
  listOpportunitiesForBank,
  pipelineSummary,
  updateBankOpportunity,
  getBankTask,
  listOverdueOpenTasks,
  listUpcomingOpenTasks,
  listTasksForBank,
  listTasksForRep,
  updateBankTask,
  activityCountsByBank,
  activityCountsByRep,
  addBankNote,
  addWatchlistItem,
  listWatchlist,
  removeWatchlistItem,
  countBillingByState,
  coverageDatabasePathForDir,
  createBankContact,
  deleteBankActivity,
  deleteBankContact,
  deleteProductFit,
  enqueueBilling,
  ensureCoverageDatabase,
  getBankContact,
  getBankCoverage,
  getBillingItem,
  getPreferredPeerGroup,
  getProductFitById,
  getSavedBankCoverageMap,
  lastActivityByBank,
  listActivitiesForBank,
  listAllContacts,
  listBillingQueue,
  listContactsForBank,
  listContactsForBanks,
  listProductFitForBank,
  listProductFitForBanks,
  listRecentActivitiesByActor,
  listRecentManualActivities,
  listSavedBanks,
  recordBankActivity,
  recordManualActivity,
  removeBankNote,
  removePreferredPeerGroup,
  removeSavedBank,
  setPreferredPeerGroup,
  updateBankContact,
  updateBillingItem,
  upsertProductFit,
  upsertSavedBank
};
