'use strict';

/**
 * FBBS Portal — Bond swap proposal store
 *
 * SQLite-backed persistence for swap proposals built in the Strategies → Bond
 * Swap tab. Three tables:
 *
 *   swap_proposals         — the proposal header (bank, status, settle, tax)
 *   swap_proposal_legs     — sell/buy legs, ordered
 *   swap_proposal_snapshots — frozen JSON blob captured on `send`
 *
 * Status lifecycle: draft → sent → executed → cancelled.
 * Maps onto the existing Strategies queue: draft=Open, sent=In Progress,
 * executed=Completed, cancelled=Archived. The proposal row keeps its own
 * status; the linked strategy_request row mirrors it.
 *
 * Snapshot rule: once `send` is called, the legs become read-only and the
 * canonical record is `swap_proposal_snapshots.snapshot_json` — the renderer
 * uses it, never live legs. Revisions clone into a new proposal.
 *
 * Persists through the shared sqlite-db.js (better-sqlite3). Every value is
 * passed as a bound parameter; multi-statement writes go through txSqlite so
 * they run atomically.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const SWAP_DATABASE_FILENAME = 'swap-proposals.sqlite';
const SWAP_STATUSES = new Set(['draft', 'sent', 'executed', 'cancelled']);
const SWAP_LEG_SIDES = new Set(['sell', 'buy']);
const SWAP_SOURCE_KINDS = new Set(['holdings', 'daily-package', 'manual']);

function swapDatabasePathForDir(outputDir) {
  return path.join(outputDir, SWAP_DATABASE_FILENAME);
}

// ---------- Bind-value coercers (return JS values for parameterized queries) ----------
// better-sqlite3 only binds numbers, strings, bigints, buffers, and null — so
// these normalize JS inputs (incl. '' and booleans) to a bindable value or null.

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function boolToInt(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
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

// ---------- Schema ----------

function ensureSwapDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = swapDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS swap_proposals (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      strategy_id TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      proposal_date TEXT NOT NULL,
      settle_date TEXT NOT NULL,
      tax_rate REAL,
      is_subchapter_s INTEGER,
      horizon_years REAL,
      breakeven_cap_months INTEGER,
      maturity_floor_months INTEGER,
      prepared_by TEXT,
      prepared_for TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      executed_at TEXT,
      cancelled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_swap_bank ON swap_proposals(bank_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_swap_status ON swap_proposals(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_swap_strategy ON swap_proposals(strategy_id);

    CREATE TABLE IF NOT EXISTS swap_proposal_legs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id TEXT NOT NULL,
      side TEXT NOT NULL,
      position INTEGER NOT NULL,
      cusip TEXT,
      description TEXT,
      sector TEXT,
      coupon REAL,
      maturity TEXT,
      call_date TEXT,
      par REAL,
      book_price REAL,
      market_price REAL,
      book_yield_ytm REAL,
      book_yield_ytw REAL,
      market_yield_ytm REAL,
      market_yield_ytw REAL,
      modified_duration REAL,
      average_life REAL,
      accrued REAL,
      source_kind TEXT,
      source_ref TEXT,
      source_date TEXT,
      entered_by TEXT,
      entered_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES swap_proposals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_swap_legs_proposal ON swap_proposal_legs(proposal_id, side, position);

    CREATE TABLE IF NOT EXISTS swap_proposal_snapshots (
      proposal_id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      frozen_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES swap_proposals(id)
    );

    CREATE TABLE IF NOT EXISTS swap_proposal_sequence (
      year INTEGER PRIMARY KEY,
      next_number INTEGER NOT NULL
    );
  `);
  return dbPath;
}

// ---------- ID generation ----------

function nextProposalId(outputDir, now = new Date()) {
  const dbPath = ensureSwapDatabase(outputDir);
  const year = now.getUTCFullYear();
  // Read current, write +1. Single-process, so this read-then-write is fine.
  const existing = querySqliteJson(dbPath,
    `SELECT next_number AS next FROM swap_proposal_sequence WHERE year = ?;`, [year]
  );
  const nextNum = (existing.length ? existing[0].next : 1);
  runSqlite(dbPath, `
    INSERT INTO swap_proposal_sequence(year, next_number) VALUES (?, ?)
    ON CONFLICT(year) DO UPDATE SET next_number = excluded.next_number;
  `, [year, nextNum + 1]);
  return `SP-${year}-${String(nextNum).padStart(4, '0')}`;
}

// ---------- Normalization ----------

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanMultiline(value, maxLength = 4000) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeStatus(value, fallback = 'draft') {
  const v = cleanText(value, 20);
  return v && SWAP_STATUSES.has(v) ? v : fallback;
}

function normalizeSide(value) {
  const v = cleanText(value, 8);
  if (!v || !SWAP_LEG_SIDES.has(v)) throw new Error(`Invalid leg side: ${value}`);
  return v;
}

function normalizeSourceKind(value) {
  const v = cleanText(value, 20);
  return v && SWAP_SOURCE_KINDS.has(v) ? v : 'manual';
}

function normalizeYmd(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ---------- Mappers ----------

function mapProposal(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankId: row.bank_id,
    strategyId: row.strategy_id || null,
    title: row.title || '',
    status: row.status,
    proposalDate: row.proposal_date,
    settleDate: row.settle_date,
    taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    isSubchapterS: row.is_subchapter_s == null ? null : Boolean(row.is_subchapter_s),
    horizonYears: row.horizon_years == null ? null : Number(row.horizon_years),
    breakevenCapMonths: row.breakeven_cap_months == null ? null : Number(row.breakeven_cap_months),
    maturityFloorMonths: row.maturity_floor_months == null ? null : Number(row.maturity_floor_months),
    preparedBy: row.prepared_by || '',
    preparedFor: row.prepared_for || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at || null,
    executedAt: row.executed_at || null,
    cancelledAt: row.cancelled_at || null
  };
}

function mapLeg(row) {
  if (!row) return null;
  return {
    id: row.id,
    proposalId: row.proposal_id,
    side: row.side,
    position: row.position,
    cusip: row.cusip || '',
    description: row.description || '',
    sector: row.sector || '',
    coupon: row.coupon == null ? null : Number(row.coupon),
    maturity: row.maturity || '',
    callDate: row.call_date || '',
    par: row.par == null ? null : Number(row.par),
    bookPrice: row.book_price == null ? null : Number(row.book_price),
    marketPrice: row.market_price == null ? null : Number(row.market_price),
    bookYieldYtm: row.book_yield_ytm == null ? null : Number(row.book_yield_ytm),
    bookYieldYtw: row.book_yield_ytw == null ? null : Number(row.book_yield_ytw),
    marketYieldYtm: row.market_yield_ytm == null ? null : Number(row.market_yield_ytm),
    marketYieldYtw: row.market_yield_ytw == null ? null : Number(row.market_yield_ytw),
    modifiedDuration: row.modified_duration == null ? null : Number(row.modified_duration),
    averageLife: row.average_life == null ? null : Number(row.average_life),
    accrued: row.accrued == null ? null : Number(row.accrued),
    sourceKind: row.source_kind || 'manual',
    sourceRef: row.source_ref || '',
    sourceDate: row.source_date || '',
    enteredBy: row.entered_by || '',
    enteredAt: row.entered_at
  };
}

// ---------- Public API ----------

function createProposal(outputDir, payload = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const bankId = cleanText(payload.bankId, 80);
  if (!bankId) throw new Error('bankId is required');

  const now = new Date();
  const id = payload.id || nextProposalId(outputDir, now);
  const proposalDate = normalizeYmd(payload.proposalDate) || now.toISOString().slice(0, 10);
  const settleDate = normalizeYmd(payload.settleDate) || proposalDate;
  const isSubS = payload.isSubchapterS == null ? null : Boolean(payload.isSubchapterS);
  const taxRate = payload.taxRate == null
    ? (isSubS == null ? null : (isSubS ? 29.6 : 21))
    : Number(payload.taxRate);

  runSqlite(dbPath, `
    INSERT INTO swap_proposals (
      id, bank_id, strategy_id, title, status,
      proposal_date, settle_date,
      tax_rate, is_subchapter_s, horizon_years,
      breakeven_cap_months, maturity_floor_months,
      prepared_by, prepared_for, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `, [
    id,
    bankId,
    cleanText(payload.strategyId, 80),
    cleanText(payload.title, 300),
    normalizeStatus(payload.status, 'draft'),
    proposalDate,
    settleDate,
    numOrNull(taxRate),
    boolToInt(isSubS),
    numOrNull(payload.horizonYears),
    intOrNull(payload.breakevenCapMonths),
    intOrNull(payload.maturityFloorMonths),
    cleanText(payload.preparedBy, 120),
    cleanText(payload.preparedFor, 120),
    cleanMultiline(payload.notes, 4000),
    now.toISOString(),
    now.toISOString()
  ]);
  return getProposal(outputDir, id);
}

function getProposal(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const rows = querySqliteJson(dbPath,
    `SELECT * FROM swap_proposals WHERE id = ?;`, [id]);
  if (!rows.length) return null;
  const proposal = mapProposal(rows[0]);

  const legRows = querySqliteJson(dbPath, `
    SELECT * FROM swap_proposal_legs
    WHERE proposal_id = ?
    ORDER BY side, position ASC, id ASC;
  `, [id]);
  const legs = legRows.map(mapLeg);

  const snapshotRows = querySqliteJson(dbPath,
    `SELECT snapshot_json, frozen_at FROM swap_proposal_snapshots WHERE proposal_id = ?;`, [id]);
  let snapshot = null;
  if (snapshotRows.length) {
    try {
      snapshot = {
        frozenAt: snapshotRows[0].frozen_at,
        data: JSON.parse(snapshotRows[0].snapshot_json)
      };
    } catch (_) { snapshot = null; }
  }

  return { proposal, legs, snapshot };
}

function listProposals(outputDir, { bankId, status, limit = 100 } = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const where = ['1 = 1'];
  const params = [];
  if (bankId) { where.push('bank_id = ?'); params.push(bankId); }
  if (status) { where.push('status = ?'); params.push(normalizeStatus(status, status)); }
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  params.push(safeLimit);
  const rows = querySqliteJson(dbPath, `
    SELECT * FROM swap_proposals
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ?;
  `, params);
  return rows.map(mapProposal);
}

function updateProposal(outputDir, id, updates = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const existing = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ?;`, [id]);
  if (!existing.length) throw new Error(`Proposal ${id} not found`);
  const status = existing[0].status;
  if (status !== 'draft') {
    throw new Error(`Proposal ${id} is ${status}; cannot edit (clone into a new draft to revise)`);
  }

  const sets = [];
  const params = [];
  const map = {
    title: v => ['title = ?', cleanText(v, 300)],
    settleDate: v => ['settle_date = ?', normalizeYmd(v)],
    proposalDate: v => ['proposal_date = ?', normalizeYmd(v)],
    taxRate: v => ['tax_rate = ?', numOrNull(v)],
    isSubchapterS: v => ['is_subchapter_s = ?', boolToInt(v)],
    horizonYears: v => ['horizon_years = ?', numOrNull(v)],
    breakevenCapMonths: v => ['breakeven_cap_months = ?', intOrNull(v)],
    maturityFloorMonths: v => ['maturity_floor_months = ?', intOrNull(v)],
    preparedBy: v => ['prepared_by = ?', cleanText(v, 120)],
    preparedFor: v => ['prepared_for = ?', cleanText(v, 120)],
    notes: v => ['notes = ?', cleanMultiline(v, 4000)],
    strategyId: v => ['strategy_id = ?', cleanText(v, 80)]
  };
  for (const key of Object.keys(updates)) {
    if (map[key]) {
      const [frag, value] = map[key](updates[key]);
      sets.push(frag);
      params.push(value);
    }
  }
  if (!sets.length) return getProposal(outputDir, id);

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  runSqlite(dbPath, `UPDATE swap_proposals SET ${sets.join(', ')} WHERE id = ?;`, params);
  return getProposal(outputDir, id);
}

function addLeg(outputDir, id, leg = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposal = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ?;`, [id]);
  if (!proposal.length) throw new Error(`Proposal ${id} not found`);
  if (proposal[0].status !== 'draft') {
    throw new Error(`Proposal ${id} is ${proposal[0].status}; legs are frozen`);
  }

  const side = normalizeSide(leg.side);
  // Append to the end of this side: next position = max(position) + 1
  const positionRows = querySqliteJson(dbPath, `
    SELECT COALESCE(MAX(position), 0) + 1 AS next
    FROM swap_proposal_legs
    WHERE proposal_id = ? AND side = ?;
  `, [id, side]);
  const position = positionRows.length ? positionRows[0].next : 1;

  const now = new Date().toISOString();
  txSqlite(dbPath, [
    {
      sql: `
    INSERT INTO swap_proposal_legs (
      proposal_id, side, position,
      cusip, description, sector, coupon, maturity, call_date, par,
      book_price, market_price,
      book_yield_ytm, book_yield_ytw,
      market_yield_ytm, market_yield_ytw,
      modified_duration, average_life, accrued,
      source_kind, source_ref, source_date,
      entered_by, entered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `,
      params: [
        id,
        side,
        intOrNull(position),
        cleanText(leg.cusip, 16),
        cleanText(leg.description, 200),
        cleanText(leg.sector, 80),
        numOrNull(leg.coupon),
        normalizeYmd(leg.maturity),
        normalizeYmd(leg.callDate),
        numOrNull(leg.par),
        numOrNull(leg.bookPrice),
        numOrNull(leg.marketPrice),
        numOrNull(leg.bookYieldYtm),
        numOrNull(leg.bookYieldYtw),
        numOrNull(leg.marketYieldYtm),
        numOrNull(leg.marketYieldYtw),
        numOrNull(leg.modifiedDuration),
        numOrNull(leg.averageLife),
        numOrNull(leg.accrued),
        normalizeSourceKind(leg.sourceKind),
        cleanText(leg.sourceRef, 300),
        normalizeYmd(leg.sourceDate),
        cleanText(leg.enteredBy, 120),
        now
      ]
    },
    { sql: `UPDATE swap_proposals SET updated_at = ? WHERE id = ?;`, params: [now, id] }
  ]);
  return getProposal(outputDir, id);
}

function updateLeg(outputDir, proposalId, legId, leg = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ?;`, [proposalId]);
  if (!proposalRows.length) throw new Error(`Proposal ${proposalId} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${proposalId} is ${proposalRows[0].status}; legs are frozen`);
  }

  const map = {
    cusip: v => ['cusip = ?', cleanText(v, 16)],
    description: v => ['description = ?', cleanText(v, 200)],
    sector: v => ['sector = ?', cleanText(v, 80)],
    coupon: v => ['coupon = ?', numOrNull(v)],
    maturity: v => ['maturity = ?', normalizeYmd(v)],
    callDate: v => ['call_date = ?', normalizeYmd(v)],
    par: v => ['par = ?', numOrNull(v)],
    bookPrice: v => ['book_price = ?', numOrNull(v)],
    marketPrice: v => ['market_price = ?', numOrNull(v)],
    bookYieldYtm: v => ['book_yield_ytm = ?', numOrNull(v)],
    bookYieldYtw: v => ['book_yield_ytw = ?', numOrNull(v)],
    marketYieldYtm: v => ['market_yield_ytm = ?', numOrNull(v)],
    marketYieldYtw: v => ['market_yield_ytw = ?', numOrNull(v)],
    modifiedDuration: v => ['modified_duration = ?', numOrNull(v)],
    averageLife: v => ['average_life = ?', numOrNull(v)],
    accrued: v => ['accrued = ?', numOrNull(v)],
    sourceKind: v => ['source_kind = ?', normalizeSourceKind(v)],
    sourceRef: v => ['source_ref = ?', cleanText(v, 300)],
    sourceDate: v => ['source_date = ?', normalizeYmd(v)],
    position: v => ['position = ?', intOrNull(v)]
  };
  const sets = [];
  const legParams = [];
  for (const key of Object.keys(leg)) {
    if (map[key]) {
      const [frag, value] = map[key](leg[key]);
      sets.push(frag);
      legParams.push(value);
    }
  }
  if (!sets.length) return getProposal(outputDir, proposalId);
  const now = new Date().toISOString();
  txSqlite(dbPath, [
    {
      sql: `UPDATE swap_proposal_legs SET ${sets.join(', ')} WHERE id = ? AND proposal_id = ?;`,
      params: [...legParams, intOrNull(legId), proposalId]
    },
    { sql: `UPDATE swap_proposals SET updated_at = ? WHERE id = ?;`, params: [now, proposalId] }
  ]);
  return getProposal(outputDir, proposalId);
}

function deleteLeg(outputDir, proposalId, legId) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ?;`, [proposalId]);
  if (!proposalRows.length) throw new Error(`Proposal ${proposalId} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${proposalId} is ${proposalRows[0].status}; legs are frozen`);
  }
  const now = new Date().toISOString();
  txSqlite(dbPath, [
    {
      sql: `DELETE FROM swap_proposal_legs WHERE id = ? AND proposal_id = ?;`,
      params: [intOrNull(legId), proposalId]
    },
    { sql: `UPDATE swap_proposals SET updated_at = ? WHERE id = ?;`, params: [now, proposalId] }
  ]);
  return getProposal(outputDir, proposalId);
}

function freezeProposal(outputDir, id, snapshotData) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ?;`, [id]);
  if (!proposalRows.length) throw new Error(`Proposal ${id} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${id} is already ${proposalRows[0].status}`);
  }
  const now = new Date().toISOString();
  txSqlite(dbPath, [
    {
      sql: `
    INSERT INTO swap_proposal_snapshots(proposal_id, snapshot_json, frozen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(proposal_id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      frozen_at = excluded.frozen_at;
  `,
      params: [id, JSON.stringify(snapshotData), now]
    },
    {
      sql: `UPDATE swap_proposals SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?;`,
      params: [now, now, id]
    }
  ]);
  return getProposal(outputDir, id);
}

// A leg counts as "unfilled" if the rep hasn't entered the core identifier
// (CUSIP) or any par. "Add buy/sell" creates an empty stub row so the rep
// has somewhere to type — but unfilled rows shouldn't be counted in the
// printable artifact or summary math.
function isLegUnfilled(leg) {
  if (!leg) return true;
  const cusip = String(leg.cusip || '').trim();
  const par = Number(leg.par);
  return !cusip && (!Number.isFinite(par) || par === 0);
}

function pruneUnfilledLegs(outputDir, proposalId) {
  const dbPath = ensureSwapDatabase(outputDir);
  const record = getProposal(outputDir, proposalId);
  if (!record) return 0;
  let removed = 0;
  for (const leg of (record.legs || [])) {
    if (isLegUnfilled(leg)) {
      runSqlite(dbPath, `DELETE FROM swap_proposal_legs WHERE id = ? AND proposal_id = ?;`, [intOrNull(leg.id), proposalId]);
      removed++;
    }
  }
  return removed;
}

// Clone a frozen proposal into a new draft so a rep can revise after send
// or cancel. Copies header fields + legs (with position preserved) into a
// fresh SP-YYYY-NNNN row. Strategy link is intentionally NOT carried — the
// new draft will mint its own when sent.
function cloneProposalToDraft(outputDir, sourceId) {
  const source = getProposal(outputDir, sourceId);
  if (!source) throw new Error(`Proposal ${sourceId} not found`);
  const { proposal, legs } = source;
  const newId = nextProposalId(outputDir);
  const newProposal = createProposal(outputDir, {
    id: newId,
    bankId: proposal.bankId,
    title: (proposal.title || 'Bond Swap') + ' (revised)',
    proposalDate: new Date().toISOString().slice(0, 10),
    settleDate: proposal.settleDate,
    isSubchapterS: proposal.isSubchapterS,
    taxRate: proposal.taxRate,
    horizonYears: proposal.horizonYears,
    breakevenCapMonths: proposal.breakevenCapMonths,
    maturityFloorMonths: proposal.maturityFloorMonths,
    preparedBy: proposal.preparedBy,
    preparedFor: proposal.preparedFor,
    notes: `Cloned from ${sourceId}. ${proposal.notes || ''}`.trim()
  });
  for (const leg of legs) {
    addLeg(outputDir, newId, {
      side: leg.side,
      cusip: leg.cusip,
      description: leg.description,
      sector: leg.sector,
      coupon: leg.coupon,
      maturity: leg.maturity,
      callDate: leg.callDate,
      par: leg.par,
      bookPrice: leg.bookPrice,
      marketPrice: leg.marketPrice,
      bookYieldYtm: leg.bookYieldYtm,
      bookYieldYtw: leg.bookYieldYtw,
      marketYieldYtm: leg.marketYieldYtm,
      marketYieldYtw: leg.marketYieldYtw,
      modifiedDuration: leg.modifiedDuration,
      averageLife: leg.averageLife,
      accrued: leg.accrued,
      sourceKind: leg.sourceKind,
      sourceRef: leg.sourceRef,
      sourceDate: leg.sourceDate
    });
  }
  return getProposal(outputDir, newId);
}

function updateProposalStrategyLink(outputDir, id, strategyId) {
  const dbPath = ensureSwapDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposals SET strategy_id = ?, updated_at = ? WHERE id = ?;
  `, [strategyId == null ? null : String(strategyId), now, id]);
  return getProposal(outputDir, id);
}

function markExecuted(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposals SET status = 'executed', executed_at = ?, updated_at = ? WHERE id = ?;
  `, [now, now, id]);
  return getProposal(outputDir, id);
}

function cancelProposal(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposals SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?;
  `, [now, now, id]);
  return getProposal(outputDir, id);
}

module.exports = {
  ensureSwapDatabase,
  nextProposalId,
  createProposal,
  getProposal,
  listProposals,
  updateProposal,
  addLeg,
  updateLeg,
  deleteLeg,
  freezeProposal,
  markExecuted,
  cancelProposal,
  cloneProposalToDraft,
  isLegUnfilled,
  pruneUnfilledLegs,
  updateProposalStrategyLink,
  // Exposed for tests
  SWAP_STATUSES,
  SWAP_LEG_SIDES,
  SWAP_SOURCE_KINDS
};
