// Tests for server/trade-fit-bridge.js — the Salesforce Trade__c → trade-fit
// adapter. Exercises the typecode→security_type mapping, audience segmentation
// from a `trades` fixture, cross-source equivalence with the Pershing reader
// (a UST buy in `trades` must produce the same profile as a GOVTSEC buy in
// `pershing_trades`), and clean degradation when the table is empty/absent.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tf = require('../server/trade-fit');
const bridge = require('../server/trade-fit-bridge');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------- typecode mapping ----------

test('sectypeFor maps documented typecodes and drops non-FI', () => {
  assert.strictEqual(bridge.sectypeFor('UST', ''), 'GOVTSEC');
  assert.strictEqual(bridge.sectypeFor('AGCY', ''), 'GOVTSEC');
  assert.strictEqual(bridge.sectypeFor('MUNI', ''), 'MUNIDEBT');
  assert.strictEqual(bridge.sectypeFor('CORP', ''), 'CORPDEBT');
  assert.strictEqual(bridge.sectypeFor('CD', ''), 'MONEYMKT');
  assert.strictEqual(bridge.sectypeFor('MBS', ''), 'ASSTBACK');
  assert.strictEqual(bridge.sectypeFor('CMO', ''), 'ASSTBACK');
  assert.strictEqual(bridge.sectypeFor('ABS', ''), 'ASSTBACK');
  // Pershing-style long codes also resolve (vocabulary-agnostic).
  assert.strictEqual(bridge.sectypeFor('MONEYMKT', ''), 'MONEYMKT');
  assert.strictEqual(bridge.sectypeFor('GOVTSEC', ''), 'GOVTSEC');
  // Non-FI → null (dropped).
  assert.strictEqual(bridge.sectypeFor('EQUITY', ''), null);
  assert.strictEqual(bridge.sectypeFor('MUTFUND', ''), null);
  assert.strictEqual(bridge.sectypeFor('UIT', ''), null);
  // Blank typecode → fall back to description.
  assert.strictEqual(bridge.sectypeFor('', 'US TREASURY NOTE 4%'), 'GOVTSEC');
  assert.strictEqual(bridge.sectypeFor('', 'FEDERAL HOME LN BKS CLB'), 'GOVTSEC');
  assert.strictEqual(bridge.sectypeFor('', 'STATE OF MISSOURI'), null); // ambiguous → drop (no MUNI token)
  assert.strictEqual(bridge.sectypeFor('', ''), null);
});

// ---------- builder over the Salesforce `trades` table ----------

function mkBankData(dir) {
  const bdb = new Database(path.join(dir, tf.BANK_DB));
  bdb.exec('CREATE TABLE banks (id TEXT, detail_json TEXT);');
  const mkDetail = sub => JSON.stringify({ periods: [{ period: '2025Y', values: { subchapterS: sub } }] });
  const insB = bdb.prepare('INSERT INTO banks (id, detail_json) VALUES (?, ?)');
  insB.run('100', mkDetail('No'));   // C-corp
  insB.run('200', mkDetail('Yes'));  // S-corp
  bdb.close();
}

function mkTradesTable(db) {
  db.exec(`CREATE TABLE trades (
    salesforce_trade_id TEXT PRIMARY KEY, bank_id TEXT, buy_sell TEXT, typecode TEXT,
    issuer TEXT, description TEXT, maturity TEXT, trade_date TEXT, price REAL, coupon REAL,
    qty INTEGER, is_deleted INTEGER NOT NULL DEFAULT 0
  );`);
  return db.prepare(`INSERT INTO trades
    (salesforce_trade_id, bank_id, buy_sell, typecode, issuer, description, maturity, trade_date, price, coupon, qty, is_deleted)
    VALUES (@id,@bank,@bs,@tc,@iss,@desc,@mat,@td,@px,@cpn,@qty,@del)`);
}

test('buildTradeFitProfileFromTradeStore segments by audience and excludes sells/deleted/equities', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tfb-'));
  mkBankData(dir);
  const db = new Database(path.join(dir, 'pershing-accounts.sqlite'));
  const ins = mkTradesTable(db);
  let n = 0;
  const row = o => ins.run(Object.assign({ id: 'T' + (n++), bank: '', bs: 'Buy', tc: '', iss: '', desc: '', mat: '2030-06-01', td: '2026-06-01', px: 100, cpn: 4, qty: 250000, del: 0 }, o));
  // C-corp (100): CDs, short.
  for (let i = 0; i < 8; i++) row({ bank: '100', tc: 'CD', iss: 'SOME BANK', desc: 'SOME BANK CD', mat: '2026-12-01' });
  // S-corp (200): MO munis, longer.
  for (let i = 0; i < 6; i++) row({ bank: '200', tc: 'MUNI', iss: 'STATE OF, MISSOURI', desc: 'STATE OF MISSOURI', mat: '2035-06-01', px: 102, cpn: 5 });
  // RIA (no bank): corporates.
  for (let i = 0; i < 7; i++) row({ bank: '', tc: 'CORP', iss: 'CAPITAL ONE NATL ASSN', desc: 'CAPITAL ONE NATL ASSN', mat: '2031-06-01', px: 98, cpn: 5, qty: 100000 });
  // Excluded: a SELL, a deleted row, and an EQUITY.
  row({ bank: '100', bs: 'Sell', tc: 'CD', iss: 'SOME BANK', desc: 'SOME BANK CD' });
  row({ bank: '100', bs: 'Buy', tc: 'CD', iss: 'SOME BANK', desc: 'SOME BANK CD', del: 1 });
  row({ bank: '', bs: 'Buy', tc: 'EQUITY', iss: 'ACME', desc: 'ACME COMMON STOCK', qty: 1 });
  db.close();

  const p = bridge.buildTradeFitProfileFromTradeStore({ bankReportsDir: dir });
  assert.ok(p, 'profile built from the Salesforce trades table');
  assert.strictEqual(p.totalBuys, 8 + 6 + 7, 'only FI BUY rows counted (sell/deleted/equity excluded)');
  assert.ok(p.audiences.ccorp.byClass.cd >= 0.99, 'C-corp CD-dominant');
  assert.ok(p.audiences.scorp.byClass.muni >= 0.99, 'S-corp muni-dominant');
  assert.ok(p.audiences.scorp.byState.MO > 0, 'S-corp MO in-state demand');
  assert.ok(p.audiences.ria.byClass.corp >= 0.99, 'RIA corporate-dominant');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bridge and Pershing reader agree on the same logical buys (cross-source equivalence)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tfb-eq-'));
  mkBankData(dir);
  const dbPath = path.join(dir, 'pershing-accounts.sqlite');
  const db = new Database(dbPath);

  // Same logical buys in BOTH shapes: trades.typecode UST/MUNI/CD ↔ pershing GOVTSEC/MUNIDEBT/MONEYMKT.
  const ins = mkTradesTable(db);
  db.exec('CREATE TABLE pershing_trades (bank_id TEXT, side TEXT, cusip TEXT, security_type TEXT, issuer TEXT, security_description TEXT, maturity_date TEXT, trade_date TEXT, price REAL, coupon REAL, quantity_or_par REAL);');
  const insP = db.prepare('INSERT INTO pershing_trades (bank_id, side, cusip, security_type, issuer, security_description, maturity_date, trade_date, price, coupon, quantity_or_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)');

  const buys = [
    { bank: '100', tc: 'CD', st: 'MONEYMKT', iss: 'SOME BANK', desc: 'SOME BANK CD', mat: '2027-06-01', td: '2026-06-01', px: 100, cpn: 4.5, qty: 250000 },
    { bank: '100', tc: 'UST', st: 'GOVTSEC', iss: 'UNITED STATES TREAS', desc: 'UNITED STATES TREAS NTS', mat: '2031-06-01', td: '2026-05-01', px: 99, cpn: 4, qty: 500000 },
    { bank: '200', tc: 'MUNI', st: 'MUNIDEBT', iss: 'STATE OF, MISSOURI', desc: 'STATE OF MISSOURI', mat: '2035-06-01', td: '2026-04-01', px: 102, cpn: 5, qty: 250000 },
    { bank: '', tc: 'CORP', st: 'CORPDEBT', iss: 'CAPITAL ONE NATL ASSN', desc: 'CAPITAL ONE NATL ASSN', mat: '2030-06-01', td: '2026-03-01', px: 98, cpn: 5, qty: 100000 },
  ];
  let i = 0;
  for (const b of buys) {
    ins.run({ id: 'T' + (i++), bank: b.bank, bs: 'Buy', tc: b.tc, iss: b.iss, desc: b.desc, mat: b.mat, td: b.td, px: b.px, cpn: b.cpn, qty: b.qty, del: 0 });
    insP.run(b.bank, 'BUY', 'C' + i, b.st, b.iss, b.desc, b.mat, b.td, b.px, b.cpn, b.qty);
  }
  db.close();

  const fromTrades = bridge.buildTradeFitProfileFromTradeStore({ bankReportsDir: dir });
  const fromPershing = tf.buildTradeFitProfile({ bankReportsDir: dir });
  assert.ok(fromTrades && fromPershing);
  // The demand rollups must be identical (same logical buys, same mapping).
  for (const k of ['ccorp', 'scorp', 'ria']) {
    assert.deepStrictEqual(fromTrades.audiences[k].byClass, fromPershing.audiences[k].byClass, `${k} byClass equal`);
    assert.deepStrictEqual(fromTrades.audiences[k].byBucket, fromPershing.audiences[k].byBucket, `${k} byBucket equal`);
  }
  assert.strictEqual(fromTrades.totalBuys, fromPershing.totalBuys);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bridge degrades to null when trades is empty or absent (never throws)', () => {
  // Absent DB file.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tfb-absent-'));
  assert.strictEqual(bridge.buildTradeFitProfileFromTradeStore({ bankReportsDir: empty }), null);
  fs.rmSync(empty, { recursive: true, force: true });

  // DB present but trades table empty.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tfb-empty-'));
  const db = new Database(path.join(dir, 'pershing-accounts.sqlite'));
  mkTradesTable(db);
  db.close();
  assert.strictEqual(bridge.buildTradeFitProfileFromTradeStore({ bankReportsDir: dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });

  // Missing bankReportsDir.
  assert.strictEqual(bridge.buildTradeFitProfileFromTradeStore({}), null);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`trade-fit-bridge tests: ${passed} passed.`);
})();
