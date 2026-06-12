'use strict';

// Coverage Workspace consolidation migration (2026-06-12): legacy bank_notes
// fold into the bank activity timeline and bank_coverage.next_action_date
// becomes an Open task, one-shot per database. The test hand-builds a "legacy"
// bank-coverage.sqlite (pre-CRM schema, no coverage_meta flag) with raw SQL —
// it must NOT touch the store first, because a fresh store call would stamp
// the flag before the legacy rows exist. Plain node, no framework.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execSqlite, runSqlite, querySqliteJson } = require('../server/sqlite-db');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-coverage-migration-'));
const dbPath = path.join(tmpDir, 'bank-coverage.sqlite');

try {
  // ---- Build the legacy database by hand (original column sets only). ----
  execSqlite(dbPath, `
    CREATE TABLE bank_coverage (
      bank_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      legal_name TEXT, city TEXT, state TEXT,
      cert_number TEXT, primary_regulator TEXT, period TEXT,
      total_assets REAL, total_deposits REAL,
      status TEXT NOT NULL DEFAULT 'Open',
      priority TEXT NOT NULL DEFAULT 'Medium',
      owner TEXT,
      next_action_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE bank_notes (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE bank_activities (
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
  `);

  runSqlite(dbPath, `
    INSERT INTO bank_coverage (bank_id, display_name, cert_number, status, priority, owner, next_action_date, created_at, updated_at)
    VALUES ('B-1', 'First Test Bank', '12345', 'Client', 'High', 'Rep One', '2099-01-15', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  runSqlite(dbPath, `
    INSERT INTO bank_coverage (bank_id, display_name, status, priority, created_at, updated_at)
    VALUES ('B-2', 'No Action Bank', 'Prospect', 'Low', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);

  // Note 1: has the preview activity row the old UI logged alongside it.
  const longNote = 'CD appetite strong. ' + 'Wants 6-18mo ladder ideas and a muni swap look. '.repeat(5);
  runSqlite(dbPath, `INSERT INTO bank_notes VALUES ('N-1', 'B-1', ?, '2026-02-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z');`, [longNote]);
  runSqlite(dbPath, `
    INSERT INTO bank_activities (id, bank_id, cert_number, at, kind, summary, ref_type, ref_id)
    VALUES ('A-1', 'B-1', '12345', '2026-02-01T10:00:00.000Z', 'note', ?, 'note', 'N-1');
  `, [longNote.slice(0, 140)]);
  // Note 2: no activity row (pre-activity-log era).
  runSqlite(dbPath, `INSERT INTO bank_notes VALUES ('N-2', 'B-1', 'Orphan note text', '2026-01-15T09:00:00.000Z', '2026-01-15T09:00:00.000Z');`);

  // ---- Trigger the migration through a normal store call. ----
  const coverageStore = require('../server/bank-coverage-store');
  const saved = coverageStore.listSavedBanks(tmpDir);
  ok('store call returns legacy banks', saved.length === 2);

  // Note 1's existing preview activity got the full text as its body.
  const a1 = querySqliteJson(dbPath, "SELECT body, activity_date FROM bank_activities WHERE id = 'A-1';");
  ok('preview activity upgraded with full note body', a1.length === 1 && a1[0].body === longNote, a1.length ? String(a1[0].body).slice(0, 60) : 'missing');
  ok('preview activity gained activity_date', a1[0].activity_date === '2026-02-01');

  // Note 2 got a fresh timeline row stamped with its original date.
  const a2 = querySqliteJson(dbPath, "SELECT body, at, activity_date, kind FROM bank_activities WHERE ref_type = 'note' AND ref_id = 'N-2';");
  ok('orphan note inserted as activity', a2.length === 1 && a2[0].body === 'Orphan note text');
  ok('orphan note keeps original timestamp', a2[0].at === '2026-01-15T09:00:00.000Z' && a2[0].activity_date === '2026-01-15');

  // Next-action date became an Open task and the column was cleared.
  const tasks = querySqliteJson(dbPath, "SELECT bank_id, due_date, status, assigned_to, created_by FROM bank_tasks;");
  ok('one migrated task', tasks.length === 1, `got ${tasks.length}`);
  ok('task carries due date + owner', tasks[0].bank_id === 'B-1' && tasks[0].due_date === '2099-01-15' && tasks[0].status === 'Open' && tasks[0].assigned_to === 'Rep One');
  ok('task stamped as migration', tasks[0].created_by === 'coverage-migration');
  const cleared = querySqliteJson(dbPath, "SELECT COUNT(*) AS n FROM bank_coverage WHERE next_action_date IS NOT NULL;");
  ok('next_action_date cleared everywhere', cleared[0].n === 0);

  // Flag set; a second pass must not duplicate anything.
  const flag = querySqliteJson(dbPath, "SELECT value FROM coverage_meta WHERE key = 'coverage-workspace-consolidated';");
  ok('consolidation flag stamped', flag.length === 1 && Boolean(flag[0].value));
  coverageStore.listSavedBanks(tmpDir);
  const actCount = querySqliteJson(dbPath, "SELECT COUNT(*) AS n FROM bank_activities WHERE ref_type = 'note';");
  const taskCount = querySqliteJson(dbPath, 'SELECT COUNT(*) AS n FROM bank_tasks;');
  ok('idempotent: no duplicate note activities', actCount[0].n === 2, `got ${actCount[0].n}`);
  ok('idempotent: no duplicate tasks', taskCount[0].n === 1, `got ${taskCount[0].n}`);

  // New data created AFTER consolidation flows through the CRM paths and the
  // migration never reprocesses it (flag short-circuits).
  coverageStore.upsertSavedBank(tmpDir, { id: 'B-3', displayName: 'Post Bank' }, { status: 'Prospect', nextActionDate: '2099-06-01' });
  coverageStore.listSavedBanks(tmpDir);
  const taskCount2 = querySqliteJson(dbPath, 'SELECT COUNT(*) AS n FROM bank_tasks;');
  ok('post-flag coverage rows are not re-migrated', taskCount2[0].n === 1, `got ${taskCount2[0].n}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`coverage-consolidation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
