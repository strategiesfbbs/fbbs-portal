'use strict';

// Shared SQLite access layer built on the better-sqlite3 native addon.
//
// Replaces the old per-store pattern of shelling out to the `sqlite3` CLI
// (childProcess.spawnSync / execFileSync). That pattern required the sqlite3
// binary on PATH, spawned a process per query, and built SQL by string
// interpolation. This module keeps the same two call shapes the stores already
// use so the swap is mechanical:
//
//   execSqlite(dbPath, sql)            ← was runSqlite: fire-and-forget DDL/DML
//   querySqliteJson(dbPath, sql, [p])  ← was querySqliteJson: returns row objects
//
// querySqliteJson now also accepts bound parameters (array or object) so call
// sites can migrate off string interpolation to real parameterized queries.
//
// Connections are opened and closed per call. Opening a better-sqlite3 handle
// does not load the database (it only opens the file), so this is still orders
// of magnitude cheaper than spawning a CLI process, while sidestepping any
// stale-handle issues when an importer recreates a database file in-process.

const Database = require('better-sqlite3');

function execSqlite(dbPath, sql) {
  const db = new Database(dbPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function querySqliteJson(dbPath, sql, params) {
  const db = new Database(dbPath);
  try {
    const stmt = db.prepare(sql);
    return params === undefined ? stmt.all() : stmt.all(params);
  } finally {
    db.close();
  }
}

// Run a single parameterized write and return the better-sqlite3 RunResult
// ({ changes, lastInsertRowid }). For statements that bind values.
function runSqlite(dbPath, sql, params) {
  const db = new Database(dbPath);
  try {
    const stmt = db.prepare(sql);
    return params === undefined ? stmt.run() : stmt.run(params);
  } finally {
    db.close();
  }
}

// Run several parameterized statements atomically. `statements` is an array of
// { sql, params? }. better-sqlite3's prepare() is single-statement only, so any
// logical write that used to pipe multiple statements to the sqlite3 CLI is
// expressed here instead — and gains real transaction semantics it never had
// under the CLI (the CLI ran them as independent auto-commits).
function transaction(dbPath, statements) {
  const db = new Database(dbPath);
  try {
    const run = db.transaction((stmts) => {
      for (const s of stmts) {
        const stmt = db.prepare(s.sql);
        if (s.params === undefined) stmt.run();
        else stmt.run(s.params);
      }
    });
    run(statements);
  } finally {
    db.close();
  }
}

module.exports = { execSqlite, querySqliteJson, runSqlite, transaction };
