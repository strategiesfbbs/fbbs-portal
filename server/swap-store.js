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
 * Follows the existing strategy-store sqlite3-CLI pattern (targeted for
 * better-sqlite3 migration alongside the other bank stores). Every value
 * goes through sqlString / sqlNumber / sqlInt so escaping stays in one place.
 */

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SWAP_DATABASE_FILENAME = 'swap-proposals.sqlite';
const SWAP_STATUSES = new Set(['draft', 'sent', 'executed', 'cancelled']);
const SWAP_LEG_SIDES = new Set(['sell', 'buy']);
const SWAP_SOURCE_KINDS = new Set(['holdings', 'daily-package', 'manual']);

function swapDatabasePathForDir(outputDir) {
  return path.join(outputDir, SWAP_DATABASE_FILENAME);
}

// ---------- SQL helpers (escape-everything; never interpolate raw values) ----------

function sqlString(value) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function sqlInt(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function sqlBool(value) {
  if (value === undefined || value === null) return 'NULL';
  return value ? '1' : '0';
}

function runSqlite(dbPath, sql) {
  const result = childProcess.spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
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
  // Atomic-ish: read current, write +1. We're single-process so spawn-per-query
  // works. If we move to better-sqlite3 this becomes a single UPSERT RETURNING.
  const existing = querySqliteJson(dbPath,
    `SELECT next_number AS next FROM swap_proposal_sequence WHERE year = ${sqlInt(year)};`
  );
  const nextNum = (existing.length ? existing[0].next : 1);
  runSqlite(dbPath, `
    INSERT INTO swap_proposal_sequence(year, next_number) VALUES (${sqlInt(year)}, ${sqlInt(nextNum + 1)})
    ON CONFLICT(year) DO UPDATE SET next_number = excluded.next_number;
  `);
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
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(bankId)},
      ${sqlString(cleanText(payload.strategyId, 80))},
      ${sqlString(cleanText(payload.title, 300))},
      ${sqlString(normalizeStatus(payload.status, 'draft'))},
      ${sqlString(proposalDate)},
      ${sqlString(settleDate)},
      ${sqlNumber(taxRate)},
      ${sqlBool(isSubS)},
      ${sqlNumber(payload.horizonYears)},
      ${sqlInt(payload.breakevenCapMonths)},
      ${sqlInt(payload.maturityFloorMonths)},
      ${sqlString(cleanText(payload.preparedBy, 120))},
      ${sqlString(cleanText(payload.preparedFor, 120))},
      ${sqlString(cleanMultiline(payload.notes, 4000))},
      ${sqlString(now.toISOString())},
      ${sqlString(now.toISOString())}
    );
  `);
  return getProposal(outputDir, id);
}

function getProposal(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const rows = querySqliteJson(dbPath,
    `SELECT * FROM swap_proposals WHERE id = ${sqlString(id)};`);
  if (!rows.length) return null;
  const proposal = mapProposal(rows[0]);

  const legRows = querySqliteJson(dbPath, `
    SELECT * FROM swap_proposal_legs
    WHERE proposal_id = ${sqlString(id)}
    ORDER BY side, position ASC, id ASC;
  `);
  const legs = legRows.map(mapLeg);

  const snapshotRows = querySqliteJson(dbPath,
    `SELECT snapshot_json, frozen_at FROM swap_proposal_snapshots WHERE proposal_id = ${sqlString(id)};`);
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
  if (bankId) where.push(`bank_id = ${sqlString(bankId)}`);
  if (status) where.push(`status = ${sqlString(normalizeStatus(status, status))}`);
  const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  const rows = querySqliteJson(dbPath, `
    SELECT * FROM swap_proposals
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT ${safeLimit};
  `);
  return rows.map(mapProposal);
}

function updateProposal(outputDir, id, updates = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const existing = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ${sqlString(id)};`);
  if (!existing.length) throw new Error(`Proposal ${id} not found`);
  const status = existing[0].status;
  if (status !== 'draft') {
    throw new Error(`Proposal ${id} is ${status}; cannot edit (clone into a new draft to revise)`);
  }

  const sets = [];
  const map = {
    title: v => `title = ${sqlString(cleanText(v, 300))}`,
    settleDate: v => `settle_date = ${sqlString(normalizeYmd(v))}`,
    proposalDate: v => `proposal_date = ${sqlString(normalizeYmd(v))}`,
    taxRate: v => `tax_rate = ${sqlNumber(v)}`,
    isSubchapterS: v => `is_subchapter_s = ${sqlBool(v)}`,
    horizonYears: v => `horizon_years = ${sqlNumber(v)}`,
    breakevenCapMonths: v => `breakeven_cap_months = ${sqlInt(v)}`,
    maturityFloorMonths: v => `maturity_floor_months = ${sqlInt(v)}`,
    preparedBy: v => `prepared_by = ${sqlString(cleanText(v, 120))}`,
    preparedFor: v => `prepared_for = ${sqlString(cleanText(v, 120))}`,
    notes: v => `notes = ${sqlString(cleanMultiline(v, 4000))}`,
    strategyId: v => `strategy_id = ${sqlString(cleanText(v, 80))}`
  };
  for (const key of Object.keys(updates)) {
    if (map[key]) sets.push(map[key](updates[key]));
  }
  if (!sets.length) return getProposal(outputDir, id);

  sets.push(`updated_at = ${sqlString(new Date().toISOString())}`);
  runSqlite(dbPath, `UPDATE swap_proposals SET ${sets.join(', ')} WHERE id = ${sqlString(id)};`);
  return getProposal(outputDir, id);
}

function addLeg(outputDir, id, leg = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposal = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ${sqlString(id)};`);
  if (!proposal.length) throw new Error(`Proposal ${id} not found`);
  if (proposal[0].status !== 'draft') {
    throw new Error(`Proposal ${id} is ${proposal[0].status}; legs are frozen`);
  }

  const side = normalizeSide(leg.side);
  // Append to the end of this side: next position = max(position) + 1
  const positionRows = querySqliteJson(dbPath, `
    SELECT COALESCE(MAX(position), 0) + 1 AS next
    FROM swap_proposal_legs
    WHERE proposal_id = ${sqlString(id)} AND side = ${sqlString(side)};
  `);
  const position = positionRows.length ? positionRows[0].next : 1;

  const now = new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO swap_proposal_legs (
      proposal_id, side, position,
      cusip, description, sector, coupon, maturity, call_date, par,
      book_price, market_price,
      book_yield_ytm, book_yield_ytw,
      market_yield_ytm, market_yield_ytw,
      modified_duration, average_life, accrued,
      source_kind, source_ref, source_date,
      entered_by, entered_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(side)},
      ${sqlInt(position)},
      ${sqlString(cleanText(leg.cusip, 16))},
      ${sqlString(cleanText(leg.description, 200))},
      ${sqlString(cleanText(leg.sector, 80))},
      ${sqlNumber(leg.coupon)},
      ${sqlString(normalizeYmd(leg.maturity))},
      ${sqlString(normalizeYmd(leg.callDate))},
      ${sqlNumber(leg.par)},
      ${sqlNumber(leg.bookPrice)},
      ${sqlNumber(leg.marketPrice)},
      ${sqlNumber(leg.bookYieldYtm)},
      ${sqlNumber(leg.bookYieldYtw)},
      ${sqlNumber(leg.marketYieldYtm)},
      ${sqlNumber(leg.marketYieldYtw)},
      ${sqlNumber(leg.modifiedDuration)},
      ${sqlNumber(leg.averageLife)},
      ${sqlNumber(leg.accrued)},
      ${sqlString(normalizeSourceKind(leg.sourceKind))},
      ${sqlString(cleanText(leg.sourceRef, 300))},
      ${sqlString(normalizeYmd(leg.sourceDate))},
      ${sqlString(cleanText(leg.enteredBy, 120))},
      ${sqlString(now)}
    );
    UPDATE swap_proposals SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(id)};
  `);
  return getProposal(outputDir, id);
}

function updateLeg(outputDir, proposalId, legId, leg = {}) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ${sqlString(proposalId)};`);
  if (!proposalRows.length) throw new Error(`Proposal ${proposalId} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${proposalId} is ${proposalRows[0].status}; legs are frozen`);
  }

  const map = {
    cusip: v => `cusip = ${sqlString(cleanText(v, 16))}`,
    description: v => `description = ${sqlString(cleanText(v, 200))}`,
    sector: v => `sector = ${sqlString(cleanText(v, 80))}`,
    coupon: v => `coupon = ${sqlNumber(v)}`,
    maturity: v => `maturity = ${sqlString(normalizeYmd(v))}`,
    callDate: v => `call_date = ${sqlString(normalizeYmd(v))}`,
    par: v => `par = ${sqlNumber(v)}`,
    bookPrice: v => `book_price = ${sqlNumber(v)}`,
    marketPrice: v => `market_price = ${sqlNumber(v)}`,
    bookYieldYtm: v => `book_yield_ytm = ${sqlNumber(v)}`,
    bookYieldYtw: v => `book_yield_ytw = ${sqlNumber(v)}`,
    marketYieldYtm: v => `market_yield_ytm = ${sqlNumber(v)}`,
    marketYieldYtw: v => `market_yield_ytw = ${sqlNumber(v)}`,
    modifiedDuration: v => `modified_duration = ${sqlNumber(v)}`,
    averageLife: v => `average_life = ${sqlNumber(v)}`,
    accrued: v => `accrued = ${sqlNumber(v)}`,
    sourceKind: v => `source_kind = ${sqlString(normalizeSourceKind(v))}`,
    sourceRef: v => `source_ref = ${sqlString(cleanText(v, 300))}`,
    sourceDate: v => `source_date = ${sqlString(normalizeYmd(v))}`,
    position: v => `position = ${sqlInt(v)}`
  };
  const sets = [];
  for (const key of Object.keys(leg)) {
    if (map[key]) sets.push(map[key](leg[key]));
  }
  if (!sets.length) return getProposal(outputDir, proposalId);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposal_legs SET ${sets.join(', ')}
    WHERE id = ${sqlInt(legId)} AND proposal_id = ${sqlString(proposalId)};
    UPDATE swap_proposals SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(proposalId)};
  `);
  return getProposal(outputDir, proposalId);
}

function deleteLeg(outputDir, proposalId, legId) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ${sqlString(proposalId)};`);
  if (!proposalRows.length) throw new Error(`Proposal ${proposalId} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${proposalId} is ${proposalRows[0].status}; legs are frozen`);
  }
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    DELETE FROM swap_proposal_legs
    WHERE id = ${sqlInt(legId)} AND proposal_id = ${sqlString(proposalId)};
    UPDATE swap_proposals SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(proposalId)};
  `);
  return getProposal(outputDir, proposalId);
}

function freezeProposal(outputDir, id, snapshotData) {
  const dbPath = ensureSwapDatabase(outputDir);
  const proposalRows = querySqliteJson(dbPath,
    `SELECT status FROM swap_proposals WHERE id = ${sqlString(id)};`);
  if (!proposalRows.length) throw new Error(`Proposal ${id} not found`);
  if (proposalRows[0].status !== 'draft') {
    throw new Error(`Proposal ${id} is already ${proposalRows[0].status}`);
  }
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO swap_proposal_snapshots(proposal_id, snapshot_json, frozen_at)
    VALUES (${sqlString(id)}, ${sqlString(JSON.stringify(snapshotData))}, ${sqlString(now)})
    ON CONFLICT(proposal_id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      frozen_at = excluded.frozen_at;
    UPDATE swap_proposals SET status = 'sent', sent_at = ${sqlString(now)},
      updated_at = ${sqlString(now)} WHERE id = ${sqlString(id)};
  `);
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
      runSqlite(dbPath, `DELETE FROM swap_proposal_legs WHERE id = ${sqlInt(leg.id)} AND proposal_id = ${sqlString(proposalId)};`);
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
    UPDATE swap_proposals SET strategy_id = ${sqlString(strategyId)},
      updated_at = ${sqlString(now)} WHERE id = ${sqlString(id)};
  `);
  return getProposal(outputDir, id);
}

function markExecuted(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposals SET status = 'executed', executed_at = ${sqlString(now)},
      updated_at = ${sqlString(now)} WHERE id = ${sqlString(id)};
  `);
  return getProposal(outputDir, id);
}

function cancelProposal(outputDir, id) {
  const dbPath = ensureSwapDatabase(outputDir);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE swap_proposals SET status = 'cancelled', cancelled_at = ${sqlString(now)},
      updated_at = ${sqlString(now)} WHERE id = ${sqlString(id)};
  `);
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
