// Tests for server/fdic-bulk-sync.js — FDIC new-quarter stopgap sync.
// Fixture-driven against a temp bank-data.sqlite; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteDb = require('../server/sqlite-db');
const { BANK_DATABASE_FILENAME } = require('../server/bank-data-importer');
const sync = require('../server/fdic-bulk-sync');

const RIS_ROW = {
  CERT: 2738, REPDTE: '20260630',
  ASSET: 700000, DEP: 600000, LNLSGR: 480000, LNLSDEPR: 78.1, LNLSNTV: 67.9,
  SCPLEDGE: 52000, SCAF: 158000, SCHF: 41000, IGLSEC: -12, EQ: 78000, RBCT1J: 79000,
  RBC1RWAJ: 14.81234, RBCRWAJ: 15.9, RBC1AAJ: 11.2, EQCDIV: 2000, EQCDIVNTINC: 25.5,
  ROA: 1.5012, ROE: 13.4, INTINCY: 5.4, INTEXPY: 1.22, NIMY: 4.18, EEFFR: 58.2,
  NETINC: 2600, LNATRESR: 1.57, NCLNLSR: 0.41, LNATRES: 7600, ELNATR: 100,
  NTLNLSR: 0.07, DEPLGAMT: 162000, ASSTLTR: 38.22, TFRA: 12345, NUMEMP: 151, OFFDOM: 11,
  BRO: 6000, SC: 160000, SCMV: 155000, DEPNI: 174000, LNRE: 442000, LNREAG: 18000,
  LNAG: 3600, LNCI: 15000, LNCON: 21000, FREPP: 2500, OBOR: 17500,
};

function makeBankDb(tmpDir) {
  const dbPath = path.join(tmpDir, BANK_DATABASE_FILENAME);
  const summary = {
    id: '1012880', displayName: 'First & Farmers National Bank, Inc.',
    name: 'First & Farmers National Bank, Inc.', city: 'Somerset', state: 'KY',
    certNumber: '2738', parentName: '', primaryRegulator: 'OCC',
    period: '2026Q1', totalAssets: 679539, totalDeposits: 591506
  };
  const bank = {
    id: '1012880',
    summary,
    periods: [{
      period: '2026Q1', endDate: '3/31/2026',
      values: {
        id: '1012880', name: summary.name, displayName: summary.displayName,
        city: 'Somerset', state: 'KY', certNumber: '2738', primaryRegulator: 'OCC',
        subchapterS: 'No', phone: '606-555-0100', website: 'www.firstandfarmers.com',
        period: '2026Q1', totalAssets: 679539, totalDeposits: 591506, roa: 1.47
      }
    }]
  };
  sqliteDb.withDatabase(dbPath, (db) => {
    db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    db.exec(`CREATE TABLE banks (
      id TEXT PRIMARY KEY, display_name TEXT, legal_name TEXT, city TEXT, state TEXT,
      cert_number TEXT, parent_name TEXT, primary_regulator TEXT, period TEXT,
      total_assets REAL, total_deposits REAL, search_text TEXT NOT NULL,
      summary_json TEXT NOT NULL, detail_json TEXT NOT NULL);`);
    db.prepare('INSERT INTO banks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);').run(
      bank.id, summary.displayName, summary.name, summary.city, summary.state,
      summary.certNumber, '', 'OCC', summary.period, summary.totalAssets,
      summary.totalDeposits, 'first farmers', JSON.stringify(summary), JSON.stringify(bank)
    );
    const unmatchedSummary = {
      id: 'unmatched-1', displayName: 'Unmatched Prior Bank', name: 'Unmatched Prior Bank',
      city: 'Nowhere', state: 'MO', certNumber: '999999', period: '2026Q2',
      totalAssets: 1, totalDeposits: 1
    };
    const unmatchedBank = {
      id: unmatchedSummary.id,
      summary: unmatchedSummary,
      periods: [{ period: '2026Q2', endDate: '6/30/2026', values: { certNumber: '999999', period: '2026Q2', totalAssets: 1 } }]
    };
    db.prepare('INSERT INTO banks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);').run(
      unmatchedBank.id, unmatchedSummary.displayName, unmatchedSummary.name, unmatchedSummary.city, unmatchedSummary.state,
      unmatchedSummary.certNumber, '', 'FDIC', unmatchedSummary.period, unmatchedSummary.totalAssets,
      unmatchedSummary.totalDeposits, 'unmatched prior', JSON.stringify(unmatchedSummary), JSON.stringify(unmatchedBank)
    );
  });
  return dbPath;
}

// fetchImpl that serves the latest-REPDTE probe, the filer-count probe, and
// the quarter page from the same fixture.
function makeFetch(repdte, rows, counters) {
  return async (url) => {
    counters.calls.push(url);
    if (url.includes('sort_by=REPDTE')) {
      return { ok: true, json: async () => ({ data: [{ data: { REPDTE: repdte } }] }) };
    }
    if (url.includes('fields=CERT&limit=1')) {
      return { ok: true, json: async () => ({ meta: { total: 4400 }, data: [] }) };
    }
    return { ok: true, json: async () => ({ meta: { total: rows.length }, data: rows.map(r => ({ data: r })) }) };
  };
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); }
  catch (err) { failures += 1; console.error(`  FAIL: ${label}\n    ${err.message}`); }
}

console.log('fdic-bulk-sync.test.js');

check('mapRisRow maps direct and computed fields', () => {
  const v = sync.mapRisRow(RIS_ROW);
  assert.strictEqual(v.totalAssets, 700000);
  assert.strictEqual(v.htmTotal, 41000);
  assert.strictEqual(v.tier1RiskBasedRatio, 14.81);
  assert.strictEqual(v.roa, 1.5);
  assert.strictEqual(v.brokeredDepositsToDeposits, 1);          // 6000/600000
  assert.strictEqual(v.securitiesToAssets, 22.86);              // 160000/700000
  assert.strictEqual(v.securitiesFvToBv, 96.88);                // 155000/160000
  assert.strictEqual(v.realEstateLoansToLoans, 92.08);          // 442000/480000
  assert.strictEqual(v.farmLoansToLoans, 3.75);                 // 18000/480000
  assert.strictEqual(v.totalBorrowings, 20000);                 // 2500 + 17500
  assert.strictEqual(v.largeDepositsToDeposits, 162000);        // $ amount (percentOf type)
  assert.strictEqual(v.longTermAssetsToAssets, 38.22);
  assert.strictEqual(v.fiduciaryAssets, 12345);
});

check('buildFieldCoverage reports mapped, carried, and remaining fields', () => {
  const coverage = sync.buildFieldCoverage();
  assert.ok(coverage.mappedCount >= 43);
  assert.ok(coverage.carriedIdentityCount >= 18);
  assert.ok(coverage.remaining.some(row => row.key === 'afsTreasury'));
  assert.ok(coverage.mapped.some(row => row.key === 'totalBorrowings' && row.method === 'sum'));
  assert.ok(coverage.warnings.length);
});

check('buildFdicPeriodEntry carries identity text forward, never numbers', () => {
  const bank = { periods: [{ period: '2026Q1', values: { name: 'X', website: 'www.x.com', subchapterS: 'No', roa: 1.47, totalAssets: 679539 } }] };
  const entry = sync.buildFdicPeriodEntry(bank, '2026Q2', RIS_ROW);
  assert.strictEqual(entry.values.website, 'www.x.com');
  assert.strictEqual(entry.values.subchapterS, 'No');
  assert.strictEqual(entry.values.period, '2026Q2');
  assert.strictEqual(entry.values.source, 'fdic');
  assert.strictEqual(entry.values.totalAssets, 700000);   // fresh, not carried
  assert.strictEqual(entry.values.roa, 1.5);               // fresh, not 1.47
  assert.strictEqual(entry.endDate, '6/30/2026');
});

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-fdic-sync-'));
  const dbPath = makeBankDb(tmpDir);
  const counters = { calls: [] };
  const fetchImpl = makeFetch('20260630', [RIS_ROW], counters);

  const stampDir = path.join(tmpDir, 'market', 'fdic');
  const dry = await sync.syncFdicQuarter(tmpDir, { dryRun: true, fetchImpl, stampDir });
  check('dry run reports without writing', () => {
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(dry.period, '2026Q2');
    assert.strictEqual(dry.matched, 1);
    assert.strictEqual(dry.updated, 1);
    assert.strictEqual(dry.skippedExisting, 0);
    assert.ok(dry.fieldCoverage.mappedCount >= 43);
    const row = sqliteDb.querySqliteJson(dbPath, 'SELECT period FROM banks WHERE id = ?;', ['1012880'])[0];
    assert.strictEqual(row.period, '2026Q1');
  });

  const real = await sync.syncFdicQuarter(tmpDir, { fetchImpl, stampDir });
  check('real sync adds the period and bumps the summary', () => {
    assert.strictEqual(real.updated, 1);
    const row = sqliteDb.querySqliteJson(dbPath, 'SELECT period, total_assets, summary_json, detail_json FROM banks WHERE id = ?;', ['1012880'])[0];
    assert.strictEqual(row.period, '2026Q2');
    assert.strictEqual(Number(row.total_assets), 700000);
    const bank = JSON.parse(row.detail_json);
    assert.strictEqual(bank.periods.length, 2);
    assert.strictEqual(bank.periods[0].period, '2026Q2');
    assert.strictEqual(bank.periods[0].values.source, 'fdic');
    assert.strictEqual(bank.periods[0].values.website, 'www.firstandfarmers.com');
    assert.strictEqual(bank.periods[0].values.htmTotal, 41000);
    assert.strictEqual(bank.periods[0].values.totalBorrowings, 20000);
    assert.strictEqual(bank.periods[1].period, '2026Q1');
    assert.strictEqual(JSON.parse(row.summary_json).period, '2026Q2');
  });

  const again = await sync.syncFdicQuarter(tmpDir, { fetchImpl });
  check('second sync skips banks that already have the period', () => {
    assert.strictEqual(again.updated, 0);
    assert.strictEqual(again.skippedExisting, 1);
    const bank = JSON.parse(sqliteDb.querySqliteJson(dbPath, 'SELECT detail_json FROM banks WHERE id = ?;', ['1012880'])[0].detail_json);
    assert.strictEqual(bank.periods.length, 2);
  });

  check('sync stamps metadata', () => {
    const meta = sqliteDb.querySqliteJson(dbPath, "SELECT value FROM metadata WHERE key = 'fdicSync';");
    assert.strictEqual(JSON.parse(meta[0].value).period, '2026Q2');
    assert.ok(JSON.parse(meta[0].value).fieldCoverage.mappedCount >= 43);
    const stamp = JSON.parse(fs.readFileSync(path.join(stampDir, 'fdic-sync-state.json'), 'utf-8'));
    assert.strictEqual(stamp.period, '2026Q2');
    assert.ok(stamp.fieldCoverage.mappedCount >= 43);
  });

  if (failures) {
    console.error(`fdic-bulk-sync.test.js: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('fdic-bulk-sync.test.js: all passed');
})();
