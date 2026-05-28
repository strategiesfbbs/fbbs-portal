'use strict';

// User-curated peer groups. The schema describes a *cohort definition* —
// a set of filters on the BANK_FIELDS dimensions. Averages are NOT stored
// here; they are computed on demand against `bank-data.sqlite` in
// peer-averages.js. That keeps cohort definitions tiny and lets averages
// stay correct as new call-report workbooks land.

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');

const PEER_GROUP_DATABASE_FILENAME = 'peer-groups.sqlite';

function peerGroupDatabasePathForDir(outputDir) {
  return path.join(outputDir, PEER_GROUP_DATABASE_FILENAME);
}

function runSqlite(dbPath, sql, params) {
  if (params === undefined) { sqliteDb.execSqlite(dbPath, sql); return ''; }
  return sqliteDb.runSqlite(dbPath, sql, params);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

function ensurePeerGroupDatabase(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = peerGroupDatabasePathForDir(outputDir);
  runSqlite(dbPath, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS peer_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      criteria_json TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_peer_groups_name ON peer_groups(name COLLATE NOCASE);
  `);
  return dbPath;
}

// --- Criteria validation ---------------------------------------------------
//
// criteria shape (all keys optional; empty/null means "no constraint"):
//   {
//     assetMin: number ($000),
//     assetMax: number ($000),
//     states: [string],         // 2-letter codes
//     subchapterS: 'Yes' | 'No' | null,
//     loanMix: [                // AND-combined
//       { key: string, op: '>=' | '<=' | '>' | '<' | '=', value: number }
//     ]
//   }

const LOAN_MIX_KEYS = new Set([
  'realEstateLoansToLoans',
  'farmLoansToLoans',
  'agProdLoansToLoans',
  'ciLoansToLoans',
  'agSum'
]);
const LOAN_MIX_OPS = new Set(['>=', '<=', '>', '<', '=']);

function normalizeCriteria(input) {
  const c = input && typeof input === 'object' ? input : {};
  const out = {};
  if (Number.isFinite(Number(c.assetMin))) out.assetMin = Number(c.assetMin);
  if (Number.isFinite(Number(c.assetMax))) out.assetMax = Number(c.assetMax);
  if (Array.isArray(c.states)) {
    const states = c.states
      .map(s => String(s || '').trim().toUpperCase())
      .filter(s => /^[A-Z]{2}$/.test(s));
    if (states.length) out.states = Array.from(new Set(states)).sort();
  }
  if (c.subchapterS === 'Yes' || c.subchapterS === 'No') out.subchapterS = c.subchapterS;
  if (Array.isArray(c.loanMix)) {
    const mix = c.loanMix
      .map(r => ({
        key: String(r && r.key || '').trim(),
        op: String(r && r.op || '').trim(),
        value: Number(r && r.value)
      }))
      .filter(r => LOAN_MIX_KEYS.has(r.key) && LOAN_MIX_OPS.has(r.op) && Number.isFinite(r.value));
    if (mix.length) out.loanMix = mix;
  }
  return out;
}

function criteriaIsEmpty(criteria) {
  if (!criteria) return true;
  return !criteria.assetMin && !criteria.assetMax
    && !(criteria.states && criteria.states.length)
    && !criteria.subchapterS
    && !(criteria.loanMix && criteria.loanMix.length);
}

// --- ID generation ---------------------------------------------------------
//
// PG-NNNN sequential, zero-padded to 4 digits.

function nextPeerGroupId(dbPath) {
  const rows = querySqliteJson(dbPath, `
    SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 AS next
    FROM peer_groups
    WHERE id GLOB 'PG-[0-9]*';
  `);
  const next = rows.length ? Number(rows[0].next) : 1;
  return `PG-${String(next).padStart(4, '0')}`;
}

// --- CRUD ------------------------------------------------------------------

function rowToPeerGroup(row) {
  if (!row) return null;
  let criteria = {};
  try { criteria = JSON.parse(row.criteria_json || '{}'); } catch (_) { criteria = {}; }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    criteria,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || null
  };
}

function listPeerGroups(outputDir, options = {}) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const showArchived = options.includeArchived === true;
  const onlyArchived = options.onlyArchived === true;
  let where = '';
  if (onlyArchived) where = 'WHERE archived_at IS NOT NULL';
  else if (!showArchived) where = 'WHERE archived_at IS NULL';
  const rows = querySqliteJson(dbPath, `
    SELECT id, name, description, criteria_json, created_by, created_at, updated_at, archived_at
    FROM peer_groups
    ${where}
    ORDER BY name COLLATE NOCASE ASC;
  `);
  return rows.map(rowToPeerGroup);
}

function getPeerGroup(outputDir, id) {
  if (!id) return null;
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const rows = querySqliteJson(dbPath, `
    SELECT id, name, description, criteria_json, created_by, created_at, updated_at, archived_at
    FROM peer_groups
    WHERE id = ?;
  `, [id]);
  return rows.length ? rowToPeerGroup(rows[0]) : null;
}

function createPeerGroup(outputDir, input = {}) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Peer group name is required');
  const description = String(input.description || '').trim();
  const criteria = normalizeCriteria(input.criteria);
  const createdBy = String(input.createdBy || '').trim();
  const id = nextPeerGroupId(dbPath);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    INSERT INTO peer_groups (id, name, description, criteria_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `, [id, name, description, JSON.stringify(criteria), createdBy, now, now]);
  return getPeerGroup(outputDir, id);
}

function updatePeerGroup(outputDir, id, patch = {}) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const current = getPeerGroup(outputDir, id);
  if (!current) throw new Error(`Peer group ${id} not found`);
  const merged = {
    name: patch.name !== undefined ? String(patch.name || '').trim() : current.name,
    description: patch.description !== undefined ? String(patch.description || '').trim() : current.description,
    criteria: patch.criteria !== undefined ? normalizeCriteria(patch.criteria) : current.criteria
  };
  if (!merged.name) throw new Error('Peer group name is required');
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE peer_groups SET
      name = ?,
      description = ?,
      criteria_json = ?,
      updated_at = ?
    WHERE id = ?;
  `, [merged.name, merged.description, JSON.stringify(merged.criteria), now, id]);
  return getPeerGroup(outputDir, id);
}

function archivePeerGroup(outputDir, id) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const current = getPeerGroup(outputDir, id);
  if (!current) throw new Error(`Peer group ${id} not found`);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE peer_groups SET
      archived_at = ?,
      updated_at = ?
    WHERE id = ?;
  `, [now, now, id]);
  return getPeerGroup(outputDir, id);
}

function restorePeerGroup(outputDir, id) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const current = getPeerGroup(outputDir, id);
  if (!current) throw new Error(`Peer group ${id} not found`);
  const now = new Date().toISOString();
  runSqlite(dbPath, `
    UPDATE peer_groups SET
      archived_at = NULL,
      updated_at = ?
    WHERE id = ?;
  `, [now, id]);
  return getPeerGroup(outputDir, id);
}

function deletePeerGroup(outputDir, id) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const current = getPeerGroup(outputDir, id);
  if (!current) return false;
  runSqlite(dbPath, `DELETE FROM peer_groups WHERE id = ?;`, [id]);
  return true;
}

// Seed a small set of sensible defaults on first init. Idempotent — only
// inserts when the table is empty. Reps can edit/delete these freely.
function seedDefaultPeerGroups(outputDir) {
  const dbPath = ensurePeerGroupDatabase(outputDir);
  const rows = querySqliteJson(dbPath, 'SELECT COUNT(*) AS n FROM peer_groups;');
  if (rows.length && Number(rows[0].n) > 0) return [];
  const defaults = [
    {
      name: 'All US banks',
      description: 'Baseline cohort — every bank in the call-report dataset.',
      criteria: {}
    },
    {
      name: 'Community banks under $500M',
      description: 'Small community banks nationwide.',
      criteria: { assetMax: 500000 }
    },
    {
      name: 'Mid-size $500M–$1B',
      description: 'Mid-size community banks nationwide.',
      criteria: { assetMin: 500000, assetMax: 1000000 }
    },
    {
      name: 'Sub-S under $500M',
      description: 'Sub-S elected community banks under $500M assets.',
      criteria: { assetMax: 500000, subchapterS: 'Yes' }
    },
    {
      name: 'Ag-focused Midwest under $1B',
      description: 'Banks with >25% ag exposure across IL/IA/MO/IN/WI/MN/NE/KS/ND/SD.',
      criteria: {
        assetMax: 1000000,
        states: ['IL', 'IA', 'IN', 'KS', 'MN', 'MO', 'ND', 'NE', 'SD', 'WI'],
        loanMix: [{ key: 'agSum', op: '>=', value: 25 }]
      }
    }
  ];
  return defaults.map(d => createPeerGroup(outputDir, { ...d, createdBy: 'system-default' }));
}

module.exports = {
  PEER_GROUP_DATABASE_FILENAME,
  peerGroupDatabasePathForDir,
  ensurePeerGroupDatabase,
  normalizeCriteria,
  criteriaIsEmpty,
  listPeerGroups,
  getPeerGroup,
  createPeerGroup,
  updatePeerGroup,
  archivePeerGroup,
  restorePeerGroup,
  deletePeerGroup,
  seedDefaultPeerGroups
};
