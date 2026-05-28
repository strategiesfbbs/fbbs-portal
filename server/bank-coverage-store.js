'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const COVERAGE_DATABASE_FILENAME = 'bank-coverage.sqlite';
const COVERAGE_STATUSES = new Set(['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant']);
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

function runSqlite(dbPath, sql) {
  sqliteDb.execSqlite(dbPath, sql);
  return '';
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
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
  return dbPath;
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

function getSavedBankCoverageMap(outputDir, bankIds = []) {
  const ids = [...new Set(bankIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    ${coverageSelectSql(`bank_id IN (${ids.map(sqlString).join(',')})`)};
  `);
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

function getPreferredPeerGroup(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT
      bank_id AS bankId,
      peer_group_id AS peerGroupId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM bank_peer_preferences
    WHERE bank_id = ${sqlString(String(bankId || ''))}
    LIMIT 1;
  `);
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
    VALUES (${sqlString(cleanBankId)}, ${sqlString(cleanPeerGroupId)}, ${sqlString(existing ? existing.createdAt : now)}, ${sqlString(now)})
    ON CONFLICT(bank_id) DO UPDATE SET
      peer_group_id = excluded.peer_group_id,
      updated_at = excluded.updated_at;
  `);
  return getPreferredPeerGroup(outputDir, cleanBankId);
}

function removePreferredPeerGroup(outputDir, bankId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  runSqlite(dbPath, `DELETE FROM bank_peer_preferences WHERE bank_id = ${sqlString(String(bankId || ''))};`);
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
    ${contactSelectSql(`bank_id = ${sqlString(id)}`)}
    ${contactOrderBy()}
    LIMIT 200;
  `);
  return rows.map(mapContactRow);
}

function listContactsForBanks(outputDir, bankIds = []) {
  const ids = [...new Set((bankIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    ${contactSelectSql(`bank_id IN (${ids.map(sqlString).join(',')})`)}
    ${contactOrderBy()};
  `);
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
  const rows = querySqliteJson(dbPath, `${contactSelectSql(`id = ${sqlString(String(contactId || ''))}`)} LIMIT 1;`);
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

  if (isPrimary) {
    runSqlite(dbPath, `
      UPDATE bank_contacts SET is_primary = 0, updated_at = ${sqlString(now)}
      WHERE bank_id = ${sqlString(summary.bankId)};
    `);
  }

  runSqlite(dbPath, `
    INSERT INTO bank_contacts (
      id, bank_id, cert_number, name, role, phone, email, is_primary, notes, created_at, updated_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(summary.bankId)},
      ${sqlString(summary.certNumber)},
      ${sqlString(name)},
      ${sqlString(role)},
      ${sqlString(phone)},
      ${sqlString(email)},
      ${isPrimary},
      ${sqlString(notes)},
      ${sqlString(now)},
      ${sqlString(now)}
    );
  `);
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

  if (isPrimary) {
    runSqlite(dbPath, `
      UPDATE bank_contacts SET is_primary = 0, updated_at = ${sqlString(now)}
      WHERE bank_id = ${sqlString(existing.bankId)} AND id <> ${sqlString(existing.id)};
    `);
  }

  runSqlite(dbPath, `
    UPDATE bank_contacts SET
      name = ${sqlString(name)},
      role = ${sqlString(role)},
      phone = ${sqlString(phone)},
      email = ${sqlString(email)},
      is_primary = ${isPrimary},
      notes = ${sqlString(notes)},
      updated_at = ${sqlString(now)}
    WHERE id = ${sqlString(existing.id)};
  `);
  return getBankContact(outputDir, existing.id);
}

function deleteBankContact(outputDir, contactId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getBankContact(outputDir, contactId);
  runSqlite(dbPath, `DELETE FROM bank_contacts WHERE id = ${sqlString(String(contactId || ''))};`);
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
      ref_type AS refType,
      ref_id AS refId
    FROM bank_activities
    WHERE ${where}
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
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(bankId)},
      ${sqlString(cleanText(payload.certNumber, 40))},
      ${sqlString(at)},
      ${sqlString(cleanText(payload.actorUsername, 80))},
      ${sqlString(cleanText(payload.actorDisplay, 200))},
      ${sqlString(kind)},
      ${sqlString(cleanText(payload.summary, 500))},
      ${sqlString(cleanText(payload.refType, 60))},
      ${sqlString(cleanText(payload.refId, 80))}
    );
  `);
  return { id, bankId, at, kind };
}

function listActivitiesForBank(outputDir, bankId, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(bankId || '');
  if (!id) return [];
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 100), 500));
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql(`bank_id = ${sqlString(id)}`)}
    ORDER BY at DESC, id DESC
    LIMIT ${limit};
  `);
  return rows.map(mapActivityRow);
}

function deleteBankActivity(outputDir, bankId, activityId) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const id = String(activityId || '');
  const bank = String(bankId || '');
  if (!id || !bank) return null;
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql(`id = ${sqlString(id)} AND bank_id = ${sqlString(bank)}`)}
    LIMIT 1;
  `);
  const activity = mapActivityRow(rows[0]);
  if (!activity) return null;
  runSqlite(dbPath, `
    DELETE FROM bank_activities
    WHERE id = ${sqlString(id)}
      AND bank_id = ${sqlString(bank)};
  `);
  return activity;
}

function listRecentActivitiesByActor(outputDir, actorUsername, options = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const username = String(actorUsername || '').toLowerCase();
  if (!username) return [];
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 20), 200));
  const rows = querySqliteJson(dbPath, `
    ${activitySelectSql(`LOWER(actor_username) = ${sqlString(username)}`)}
    ORDER BY at DESC
    LIMIT ${limit};
  `);
  return rows.map(mapActivityRow);
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
    ${productFitSelectSql(`bank_id = ${sqlString(id)}`)}
    ORDER BY product COLLATE NOCASE ASC;
  `);
  return rows.map(mapProductFitRow);
}

function listProductFitForBanks(outputDir, bankIds = []) {
  const ids = [...new Set((bankIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    ${productFitSelectSql(`bank_id IN (${ids.map(sqlString).join(',')})`)}
    ORDER BY product COLLATE NOCASE ASC;
  `);
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
  const rows = querySqliteJson(dbPath, `${productFitSelectSql(`id = ${sqlString(String(id || ''))}`)} LIMIT 1;`);
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
    ${productFitSelectSql(`bank_id = ${sqlString(summary.bankId)} AND product = ${sqlString(product)}`)}
    LIMIT 1;
  `).map(mapProductFitRow)[0];

  if (existing) {
    runSqlite(dbPath, `
      UPDATE bank_product_fit SET
        notes = ${sqlString(notes !== null ? notes : existing.notes)},
        flagged_by_username = ${sqlString(cleanText(input.flaggedByUsername, 80) || existing.flaggedByUsername)},
        flagged_by_display = ${sqlString(cleanText(input.flaggedByDisplay, 200) || existing.flaggedByDisplay)},
        updated_at = ${sqlString(now)}
      WHERE id = ${sqlString(existing.id)};
    `);
    return getProductFitById(outputDir, existing.id);
  }

  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT INTO bank_product_fit (
      id, bank_id, cert_number, product, notes,
      flagged_by_username, flagged_by_display, created_at, updated_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(summary.bankId)},
      ${sqlString(summary.certNumber)},
      ${sqlString(product)},
      ${sqlString(notes)},
      ${sqlString(cleanText(input.flaggedByUsername, 80))},
      ${sqlString(cleanText(input.flaggedByDisplay, 200))},
      ${sqlString(now)},
      ${sqlString(now)}
    );
  `);
  return getProductFitById(outputDir, id);
}

function deleteProductFit(outputDir, id) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const existing = getProductFitById(outputDir, id);
  runSqlite(dbPath, `DELETE FROM bank_product_fit WHERE id = ${sqlString(String(id || ''))};`);
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
  const where = state ? `state = ${sqlString(state)}` : '1 = 1';
  const limit = Math.max(1, Math.min(Math.trunc(Number(options.limit) || 500), 2000));
  const rows = querySqliteJson(dbPath, `
    ${billingSelectSql(where)}
    ORDER BY
      CASE state WHEN 'Pending' THEN 1 WHEN 'Invoiced' THEN 2 WHEN 'Paid' THEN 3 ELSE 4 END,
      enqueued_at DESC
    LIMIT ${limit};
  `);
  return rows.map(mapBillingRow);
}

function getBillingItem(outputDir, id) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `${billingSelectSql(`id = ${sqlString(String(id || ''))}`)} LIMIT 1;`);
  return rows.length ? mapBillingRow(rows[0]) : null;
}

function enqueueBilling(outputDir, payload = {}) {
  const dbPath = ensureCoverageDatabase(outputDir);
  const refType = cleanText(payload.refType, 40);
  const refId = cleanText(payload.refId, 80);
  const bankId = cleanText(payload.bankId, 80);
  if (!refType || !refId || !bankId) return null;

  const existing = querySqliteJson(dbPath, `
    ${billingSelectSql(`ref_type = ${sqlString(refType)} AND ref_id = ${sqlString(refId)}`)}
    LIMIT 1;
  `).map(mapBillingRow)[0];

  const now = new Date().toISOString();
  if (existing) {
    runSqlite(dbPath, `
      UPDATE billing_queue SET
        summary = ${sqlString(cleanText(payload.summary, 500) || existing.summary)},
        amount = ${sqlNumber(payload.amount != null ? payload.amount : existing.amount)},
        cert_number = ${sqlString(cleanText(payload.certNumber, 40) || existing.certNumber)},
        notes = ${sqlString(cleanText(payload.notes, 2000) !== null ? cleanText(payload.notes, 2000) : existing.notes)}
      WHERE id = ${sqlString(existing.id)};
    `);
    return getBillingItem(outputDir, existing.id);
  }
  const id = crypto.randomUUID();
  runSqlite(dbPath, `
    INSERT INTO billing_queue (
      id, ref_type, ref_id, bank_id, cert_number, summary, amount, state,
      enqueued_at, notes
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(refType)},
      ${sqlString(refId)},
      ${sqlString(bankId)},
      ${sqlString(cleanText(payload.certNumber, 40))},
      ${sqlString(cleanText(payload.summary, 500))},
      ${sqlNumber(payload.amount)},
      ${sqlString('Pending')},
      ${sqlString(now)},
      ${sqlString(cleanText(payload.notes, 2000))}
    );
  `);
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
      state = ${sqlString(state)},
      amount = ${sqlNumber(amount)},
      notes = ${sqlString(notes)},
      billed_at = ${sqlString(billedAt)},
      billed_by = ${sqlString(billedBy)}
    WHERE id = ${sqlString(existing.id)};
  `);
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
  PRODUCT_FIT_PRODUCTS,
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
  listActivitiesForBank,
  listBillingQueue,
  listContactsForBank,
  listContactsForBanks,
  listProductFitForBank,
  listProductFitForBanks,
  listRecentActivitiesByActor,
  listSavedBanks,
  recordBankActivity,
  removeBankNote,
  removePreferredPeerGroup,
  removeSavedBank,
  setPreferredPeerGroup,
  updateBankContact,
  updateBillingItem,
  upsertProductFit,
  upsertSavedBank
};
