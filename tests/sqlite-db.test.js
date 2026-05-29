'use strict';

// Regression tests for server/sqlite-db.js — the shared SQLite access layer
// every store routes through. Proves the five call shapes (execSqlite,
// querySqliteJson, runSqlite, transaction, withDatabase) bind parameters,
// return the expected shapes, and — critically — that transaction() is
// atomic (a mid-batch failure rolls the whole batch back, which the old
// sqlite3-CLI pipe never did).
//
// Plain node, no framework. Fresh tmp dir per run. better-sqlite3 is a hard
// dependency now, so there is no CLI-availability guard.

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../server/sqlite-db');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

// Single quote, percent, underscore, backslash — corrupts any query that
// still interpolates instead of binding.
const TRICKY = "O'Brien % Co _ \\ Trust";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-sqlite-db-'));
const dbPath = path.join(tmpDir, 'test.sqlite');
try {
  // execSqlite: fire-and-forget DDL.
  db.execSqlite(dbPath, `
    CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);
  `);
  ok('execSqlite created the db file', fs.existsSync(dbPath));

  // runSqlite: parameterized single write → { changes, lastInsertRowid }.
  const ins = db.runSqlite(dbPath, `INSERT INTO widgets (name, qty) VALUES (?, ?);`, ['alpha', 3]);
  ok('runSqlite reports changes', ins.changes === 1, JSON.stringify(ins));
  ok('runSqlite reports lastInsertRowid', Number(ins.lastInsertRowid) === 1, String(ins.lastInsertRowid));

  // querySqliteJson with no params → plain row objects.
  const all = db.querySqliteJson(dbPath, `SELECT * FROM widgets;`);
  ok('querySqliteJson returns row objects', all.length === 1 && all[0].name === 'alpha' && all[0].qty === 3, JSON.stringify(all));

  // querySqliteJson with positional (array) params.
  db.runSqlite(dbPath, `INSERT INTO widgets (name, qty) VALUES (?, ?);`, ['beta', 7]);
  const byQty = db.querySqliteJson(dbPath, `SELECT name FROM widgets WHERE qty >= ? ORDER BY qty;`, [5]);
  ok('querySqliteJson binds positional params', byQty.length === 1 && byQty[0].name === 'beta', JSON.stringify(byQty));

  // querySqliteJson with named (object) params.
  const byName = db.querySqliteJson(dbPath, `SELECT qty FROM widgets WHERE name = @name;`, { name: 'alpha' });
  ok('querySqliteJson binds named params', byName.length === 1 && byName[0].qty === 3, JSON.stringify(byName));

  // Tricky value round-trips intact through a bound write + read.
  db.runSqlite(dbPath, `INSERT INTO widgets (name, qty) VALUES (?, ?);`, [TRICKY, 1]);
  const tricky = db.querySqliteJson(dbPath, `SELECT name FROM widgets WHERE name = ?;`, [TRICKY]);
  ok('bound params round-trip SQL metacharacters', tricky.length === 1 && tricky[0].name === TRICKY, tricky[0] && tricky[0].name);

  // runSqlite UPDATE reports the right change count.
  const upd = db.runSqlite(dbPath, `UPDATE widgets SET qty = qty + 1 WHERE qty < ?;`, [5]);
  ok('runSqlite UPDATE change count', upd.changes === 2, JSON.stringify(upd));

  // transaction: several writes applied atomically.
  const before = db.querySqliteJson(dbPath, `SELECT COUNT(*) AS n FROM widgets;`)[0].n;
  db.transaction(dbPath, [
    { sql: `INSERT INTO widgets (name, qty) VALUES (?, ?);`, params: ['gamma', 2] },
    { sql: `INSERT INTO widgets (name, qty) VALUES (?, ?);`, params: ['delta', 4] }
  ]);
  const afterTx = db.querySqliteJson(dbPath, `SELECT COUNT(*) AS n FROM widgets;`)[0].n;
  ok('transaction applies all statements', afterTx === before + 2, `${before} -> ${afterTx}`);

  // transaction rollback: a bad statement mid-batch must undo the good one.
  const preFail = db.querySqliteJson(dbPath, `SELECT COUNT(*) AS n FROM widgets;`)[0].n;
  let threw = false;
  try {
    db.transaction(dbPath, [
      { sql: `INSERT INTO widgets (name, qty) VALUES (?, ?);`, params: ['should-rollback', 9] },
      { sql: `INSERT INTO widgets (name, qty) VALUES (?, ?);`, params: ['oops', 'not-an-int', 'extra-param'] } // bad bind → throws
    ]);
  } catch (_) {
    threw = true;
  }
  const postFail = db.querySqliteJson(dbPath, `SELECT COUNT(*) AS n FROM widgets;`)[0].n;
  ok('transaction throws on a bad statement', threw);
  ok('transaction rolls back the whole batch on failure', postFail === preFail, `${preFail} -> ${postFail}`);
  const ghost = db.querySqliteJson(dbPath, `SELECT * FROM widgets WHERE name = ?;`, ['should-rollback']);
  ok('rolled-back row is absent', ghost.length === 0);

  // withDatabase: one handle, multiple ops, returns the callback value.
  const total = db.withDatabase(dbPath, (conn) => {
    const row = conn.prepare(`SELECT SUM(qty) AS total FROM widgets;`).get();
    return row.total;
  });
  ok('withDatabase returns the callback result', Number.isFinite(total) && total > 0, String(total));

  console.log(`sqlite-db tests: ${passed} passed, ${failed} failed.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
