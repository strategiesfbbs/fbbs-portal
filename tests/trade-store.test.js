'use strict';

// Trade store — synthetic fixture (no real SF export needed). Verifies the
// pure mapping, the trade->pershing->bank resolution, idempotent upsert, the
// per-bank blotter + rollup, and the MAX(trade_date) recency rollup.

const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteDb = require('../server/sqlite-db');
const trade = require('../server/trade-store');

let passed = 0;
let failed = 0;
function ok(label, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}${detail ? ' - ' + detail : ''}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-trade-store-'));
const P_AAA = 'aPERSHING000001AAA'; // 18-char pershing ids
const P_BBB = 'aPERSHING000002BBB';

function seedPershing(outputDir) {
  const dbPath = trade.tradesDatabasePathForDir(outputDir);
  sqliteDb.runSqlite(dbPath, `
    CREATE TABLE IF NOT EXISTS pershing_accounts (
      salesforce_pershing_id TEXT PRIMARY KEY,
      salesforce_account_id TEXT,
      bank_id TEXT,
      cert_number TEXT,
      bank_match_status TEXT,
      pershing_account_number TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqliteDb.runSqlite(dbPath, 'INSERT OR REPLACE INTO pershing_accounts (salesforce_pershing_id, bank_id, cert_number, bank_match_status, is_deleted) VALUES (?, ?, ?, ?, 0);', [P_AAA, 'B-1', '111', 'matched']);
  sqliteDb.runSqlite(dbPath, 'INSERT OR REPLACE INTO pershing_accounts (salesforce_pershing_id, bank_id, cert_number, bank_match_status, is_deleted) VALUES (?, ?, ?, ?, 0);', [P_BBB, 'B-2', '222', 'matched']);
}

// SF-shaped rows (API-name headers, as Data Loader exports them).
function fixtureRows() {
  return [
    { Id: 'T-001', Pershing_Account__c: P_AAA, Name: 'T-0001', CUSIP__c: '912810ez7', Issuer__c: 'US TREASURY', Buy_Sell__c: 'Buy', TYPECODE__c: 'UST', Coupon__c: '4.250', Yield__c: '4.310', Price__c: '99.50', Qty__c: '500000', Trade_Date__c: '2024-01-15', Maturity__c: '2034-02-15' },
    { Id: 'T-002', Pershing_Account__c: P_AAA, Name: 'T-0002', CUSIP__c: '64971XYZ1', Issuer__c: 'NYC MUNI', Buy_Sell__c: 'Sell', TYPECODE__c: 'MUNI', Coupon__c: '3.000', Yield__c: '3.250', Price__c: '101.0', Qty__c: '250000', Trade_Date__c: '03/20/2024', Maturity__c: '2030-06-01' },
    { Id: 'T-003', Pershing_Account__c: P_BBB, Name: 'T-0003', CUSIP__c: '3133ABCD2', Issuer__c: 'FHLB', Buy_Sell__c: 'Buy', TYPECODE__c: 'AGCY', Coupon__c: '5.0', Yield__c: '5.05', Price__c: '100.0', Qty__c: '1000000', Trade_Date__c: '2023-06-01' },
    { Id: 'T-004', Pershing_Account__c: 'aUNKNOWNPERSHINGX1', Name: 'T-0004', CUSIP__c: '00000ZZZ9', Buy_Sell__c: 'Buy', Trade_Date__c: '2024-02-02' },
    { Id: 'T-001', Pershing_Account__c: P_AAA, Name: 'T-0001', CUSIP__c: '912810ez7', Buy_Sell__c: 'Buy', TYPECODE__c: 'UST', Trade_Date__c: '2024-05-05', Qty__c: '500000' }, // in-batch dup of T-001 (later date)
    { Id: 'T-DEL', Pershing_Account__c: P_AAA, Name: 'T-9999', IsDeleted: 'true', Trade_Date__c: '2024-04-04' }
  ];
}

try {
  // ---- pure mapping ----
  const mapped = trade.mapTradeRecord(fixtureRows()[0], {
    pershingMap: new Map([[P_AAA, { bankId: 'B-1', certNumber: '111' }]])
  });
  ok('map: numbers parse', mapped.coupon === 4.25 && mapped.qty === 500000 && mapped.price === 99.5, JSON.stringify(mapped));
  ok('map: cusip upcased', mapped.cusip === '912810EZ7');
  ok('map: bank resolved via pershing', mapped.bankId === 'B-1' && mapped.bankMatchStatus === 'matched');
  ok('map: mdy date normalized', trade.mapTradeRecord(fixtureRows()[1], { pershingMap: new Map() }).tradeDate === '2024-03-20');
  ok('map: unmatched pershing flagged', trade.mapTradeRecord(fixtureRows()[3], { pershingMap: new Map() }).bankMatchStatus === 'unmatched');

  // ---- summarize ----
  const dirA = fs.mkdtempSync(path.join(tmpDir, 'a-'));
  seedPershing(dirA);
  const dry = trade.importTrades(dirA, fixtureRows(), { dryRun: true });
  ok('dryRun: importable = 5', dry.importedCount === 5, String(dry.importedCount));
  ok('dryRun: 1 deleted skipped', dry.skippedDeleted === 1);
  ok('dryRun: 4 unique ids', dry.uniqueTradeIds === 4, String(dry.uniqueTradeIds));
  ok('dryRun: 1 duplicate id', dry.duplicateTradeIds === 1);
  ok('dryRun: 4 matched / 1 unmatched', dry.matchedRows === 4 && dry.unmatchedRows === 1);
  ok('dryRun: 2 banks', dry.bankCount === 2);
  ok('dryRun: date range', dry.oldestTradeDate === '2023-06-01' && dry.latestTradeDate === '2024-05-05', `${dry.oldestTradeDate}..${dry.latestTradeDate}`);
  ok('dryRun: did NOT write', trade.getTradesForBank(dirA, 'B-1').total === 0);

  // ---- apply ----
  const applied = trade.importTrades(dirA, fixtureRows(), { sourceFile: 'TRADE EXTRACT.csv' });
  ok('apply: created 4 unique', applied.created === 4, `created=${applied.created}`);
  ok('apply: in-batch dup counted as update', applied.updated === 1, `updated=${applied.updated}`);

  const b1 = trade.getTradesForBank(dirA, 'B-1');
  ok('read: B-1 has 2 trades', b1.total === 2, String(b1.total));
  ok('read: B-1 rollup latest = dup date', b1.rollup.latestTradeDate === '2024-05-05', b1.rollup.latestTradeDate);
  ok('read: B-1 lastSell', b1.rollup.lastSellDate === '2024-03-20', b1.rollup.lastSellDate);
  ok('read: newest trade first', b1.trades[0].tradeDate === '2024-05-05');

  const rec = trade.getTradeRecencyForBanks(dirA, ['B-1', 'B-2']);
  ok('recency: B-1 MAX(trade_date)', rec.get('B-1') && rec.get('B-1').latestTradeDate === '2024-05-05', JSON.stringify(rec.get('B-1')));
  ok('recency: B-1 count 2', rec.get('B-1') && rec.get('B-1').tradeCount === 2);
  ok('recency: B-2', rec.get('B-2') && rec.get('B-2').latestTradeDate === '2023-06-01' && rec.get('B-2').tradeCount === 1);

  // ---- idempotent re-import ----
  const again = trade.importTrades(dirA, fixtureRows(), { sourceFile: 'TRADE EXTRACT.csv' });
  ok('idempotent: 0 created on re-import', again.created === 0, `created=${again.created}`);
  ok('idempotent: row count stable', trade.getTradesForBank(dirA, 'B-1').total === 2 && trade.getTradeImportStatus(dirA).uniqueTradeIds === '4');

  console.log(`trade-store tests: ${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
