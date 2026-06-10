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
    CREATE INDEX IF NOT EXISTS idx_bank_coverage_priority ON bank_coverage(priority, next_action_date);
    CREATE INDEX IF NOT EXISTS idx_bank_notes_bank_created ON bank_notes(bank_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_contacts_bank ON bank_contacts(bank_id, is_primary DESC, name COLLATE NOCASE ASC);
    CREATE INDEX IF NOT EXISTS idx_bank_activities_bank_at ON bank_activities(bank_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_activities_actor_at ON bank_activities(actor_username, at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_product_fit_bank ON bank_product_fit(bank_id);
    CREATE INDEX IF NOT EXISTS idx_billing_queue_state_enqueued ON billing_queue(state, enqueued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_billing_queue_bank ON billing_queue(bank_id);
  `);
  migrateBankActivityColumns(dbPath);
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

module.exports = {
  BILLING_STATES,
  COVERAGE_DATABASE_FILENAME,
  MANUAL_ACTIVITY_KINDS,
  PRODUCT_FIT_PRODUCTS,
  activityCountsByBank,
  activityCountsByRep,
  addBankNote,
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
