// Tests for server/ffiec-bulk-sync.js — FFIEC CDR Call/UBPR additive sync.
// Fixture-driven against a temp bank-data.sqlite; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteDb = require('../server/sqlite-db');
const { BANK_DATABASE_FILENAME } = require('../server/bank-data-importer');
const sync = require('../server/ffiec-bulk-sync');

const CALL_TSV = [
  'FDIC Certificate Number\tReporting Period End Date\tRCON2170\tRCON2200\tRCON2122\tRCON3210\tRCON1773\tRCON1771\tRIAD4340\tAFSTREASURY\tHTMMUNIS\tBRO',
  '2738\t6/30/2026\t700000\t600000\t480000\t78000\t158000\t41000\t2600\t12000\t7000\t6000',
  '999999\t6/30/2026\t111000\t90000\t45000\t12000\t10000\t2000\t200\t1000\t500\t0',
].join('\n');

const UBPR_TSV = [
  'CERT\tREPDTE\tMDRM\tVALUE',
  '2738\t20260630\tROA\t1.5012',
  '2738\t20260630\tROE\t13.4',
  '2738\t20260630\tNIMY\t4.18',
  '2738\t20260630\tEEFFR\t58.2',
  '2738\t20260630\tRBC1RWAJ\t14.81234',
  '2738\t20260630\tRBCRWAJ\t15.9',
  '2738\t20260630\tRBC1AAJ\t11.2',
  '999999\t20260630\tROA\t0.72',
].join('\n');

const SOURCE_FILES = [
  { name: 'call-single-period.tsv', kind: 'call', content: CALL_TSV },
  { name: 'ubpr-ratio-single-period.tsv', kind: 'ubpr', content: UBPR_TSV },
];

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
  });
  return dbPath;
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); }
  catch (err) { failures += 1; console.error(`  FAIL: ${label}\n    ${err.message}`); }
}

console.log('ffiec-bulk-sync.test.js');

check('date helpers normalize FFIEC reporting dates', () => {
  assert.strictEqual(sync.normalizeRepdte('6/30/2026'), '20260630');
  assert.strictEqual(sync.normalizeRepdte('2026Q2'), '20260630');
  assert.strictEqual(sync.repdteToPeriod('20260630'), '2026Q2');
  assert.strictEqual(sync.periodToEndDate('2026Q2'), '6/30/2026');
});

check('parseFfiecFiles merges wide Call rows with long UBPR rows', () => {
  const parsed = sync.parseFfiecFiles(SOURCE_FILES);
  assert.strictEqual(parsed.records.length, 2);
  const matched = parsed.records.find(row => row.cert === '2738');
  assert.ok(matched);
  assert.strictEqual(matched.period, '2026Q2');
  assert.strictEqual(matched.values.RCON2170, '700000');
  assert.strictEqual(matched.values.ROA, '1.5012');
  assert.ok(matched.sources.includes('call'));
  assert.ok(matched.sources.includes('ubpr'));
});

check('mapFfiecRecord maps direct fields, UBPR ratios, and computed ratios', () => {
  const record = sync.parseFfiecFiles(SOURCE_FILES).records.find(row => row.cert === '2738');
  const v = sync.mapFfiecRecord(record);
  assert.strictEqual(v.totalAssets, 700000);
  assert.strictEqual(v.totalDeposits, 600000);
  assert.strictEqual(v.totalLoans, 480000);
  assert.strictEqual(v.afsTotal, 158000);
  assert.strictEqual(v.htmTotal, 41000);
  assert.strictEqual(v.afsTreasury, 12000);
  assert.strictEqual(v.htmMunis, 7000);
  assert.strictEqual(v.roa, 1.5);
  assert.strictEqual(v.tier1RiskBasedRatio, 14.81);
  assert.strictEqual(v.loansToDeposits, 80);
  assert.strictEqual(v.loansToAssets, 68.57);
  assert.strictEqual(v.brokeredDepositsToDeposits, 1);
  assert.strictEqual(v.securitiesToAssets, 28.43);
});

check('buildFieldCoverage reports FFIEC mapped and carried fields', () => {
  const coverage = sync.buildFieldCoverage();
  assert.ok(coverage.mappedCount >= 40);
  assert.ok(coverage.carriedIdentityCount >= 18);
  assert.ok(coverage.mapped.some(row => row.key === 'htmMunis'));
  assert.ok(coverage.warnings.some(w => /never overwrites/i.test(w)));
});

check('buildFfiecPeriodEntry carries identity text forward, never numbers', () => {
  const record = sync.parseFfiecFiles(SOURCE_FILES).records.find(row => row.cert === '2738');
  const bank = { periods: [{ period: '2026Q1', values: { name: 'X', website: 'www.x.com', subchapterS: 'No', roa: 1.47, totalAssets: 679539 } }] };
  const entry = sync.buildFfiecPeriodEntry(bank, '2026Q2', record);
  assert.strictEqual(entry.values.source, 'ffiec');
  assert.strictEqual(entry.values.website, 'www.x.com');
  assert.strictEqual(entry.values.subchapterS, 'No');
  assert.strictEqual(entry.values.totalAssets, 700000);
  assert.strictEqual(entry.values.roa, 1.5);
  assert.strictEqual(entry.endDate, '6/30/2026');
});

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-ffiec-sync-'));
  const dbPath = makeBankDb(tmpDir);
  const stampDir = path.join(tmpDir, 'market', 'ffiec');

  const dry = await sync.syncFfiecQuarter(tmpDir, { dryRun: true, sourceFiles: SOURCE_FILES, stampDir });
  check('dry run reports counts without writing', () => {
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(dry.period, '2026Q2');
    assert.strictEqual(dry.filers, 2);
    assert.strictEqual(dry.matched, 1);
    assert.strictEqual(dry.updated, 1);
    assert.strictEqual(dry.unmatchedFilers, 1);
    const row = sqliteDb.querySqliteJson(dbPath, 'SELECT period FROM banks WHERE id = ?;', ['1012880'])[0];
    assert.strictEqual(row.period, '2026Q1');
  });

  const real = await sync.syncFfiecQuarter(tmpDir, { sourceFiles: SOURCE_FILES, stampDir });
  check('real sync adds the period and bumps summary', () => {
    assert.strictEqual(real.updated, 1);
    assert.strictEqual(real.unmatchedFilers, 1);
    const row = sqliteDb.querySqliteJson(dbPath, 'SELECT period, total_assets, total_deposits, summary_json, detail_json FROM banks WHERE id = ?;', ['1012880'])[0];
    assert.strictEqual(row.period, '2026Q2');
    assert.strictEqual(Number(row.total_assets), 700000);
    assert.strictEqual(Number(row.total_deposits), 600000);
    const bank = JSON.parse(row.detail_json);
    assert.strictEqual(bank.periods.length, 2);
    assert.strictEqual(bank.periods[0].period, '2026Q2');
    assert.strictEqual(bank.periods[0].values.source, 'ffiec');
    assert.strictEqual(bank.periods[0].values.website, 'www.firstandfarmers.com');
    assert.strictEqual(bank.periods[0].values.netInterestMargin, 4.18);
    assert.strictEqual(bank.periods[0].values.htmMunis, 7000);
    assert.strictEqual(bank.periods[1].period, '2026Q1');
    assert.strictEqual(JSON.parse(row.summary_json).period, '2026Q2');
  });

  const again = await sync.syncFfiecQuarter(tmpDir, { sourceFiles: SOURCE_FILES });
  check('second sync skips existing period', () => {
    assert.strictEqual(again.updated, 0);
    assert.strictEqual(again.skippedExisting, 1);
    const bank = JSON.parse(sqliteDb.querySqliteJson(dbPath, 'SELECT detail_json FROM banks WHERE id = ?;', ['1012880'])[0].detail_json);
    assert.strictEqual(bank.periods.length, 2);
  });

  check('sync stamps metadata', () => {
    const meta = sqliteDb.querySqliteJson(dbPath, "SELECT value FROM metadata WHERE key = 'ffiecSync';");
    assert.strictEqual(JSON.parse(meta[0].value).period, '2026Q2');
    const stamp = JSON.parse(fs.readFileSync(path.join(stampDir, 'ffiec-sync-state.json'), 'utf-8'));
    assert.strictEqual(stamp.period, '2026Q2');
    assert.strictEqual(stamp.unmatchedFilers, 1);
    assert.ok(stamp.fieldCoverage.mappedCount >= 40);
  });

  const OLD_CALL_TSV = [
    'FDIC Certificate Number\tReporting Period End Date\tRCON2170',
    '2738\t12/31/2025\t650000',
  ].join('\n');
  const olderSync = await sync.syncFfiecQuarter(tmpDir, {
    sourceFiles: [{ name: 'old-call.tsv', kind: 'call', content: OLD_CALL_TSV }],
  });
  check('syncing an older FFIEC period inserts it in rank order, not at periods[0]', () => {
    assert.strictEqual(olderSync.period, '2025Q4');
    assert.strictEqual(olderSync.updated, 1);
    const bank = JSON.parse(sqliteDb.querySqliteJson(dbPath, 'SELECT detail_json FROM banks WHERE id = ?;', ['1012880'])[0].detail_json);
    assert.strictEqual(bank.periods.length, 3);
    // periods[0] must stay the true latest quarter — portal.js treats
    // periods[0] as "current financials" in several tear-sheet views.
    assert.strictEqual(bank.periods[0].period, '2026Q2');
    assert.strictEqual(bank.periods[1].period, '2026Q1');
    assert.strictEqual(bank.periods[2].period, '2025Q4');
    const summary = JSON.parse(sqliteDb.querySqliteJson(dbPath, 'SELECT summary_json FROM banks WHERE id = ?;', ['1012880'])[0].summary_json);
    assert.strictEqual(summary.period, '2026Q2', 'summary period must not regress either');
  });

  if (failures) {
    console.error(`ffiec-bulk-sync.test.js: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('ffiec-bulk-sync.test.js: all passed');
})();
