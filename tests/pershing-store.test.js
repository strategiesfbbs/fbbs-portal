'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const pershing = require('../server/pershing-store');

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}${detail ? ' - ' + detail : ''}`);
}

function setSf(map, id, value) {
  map.set(id, value);
  map.set(String(id).slice(0, 15), value);
  map.set(String(id).toLowerCase(), value);
  map.set(String(id).slice(0, 15).toLowerCase(), value);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-pershing-store-'));

try {
  const accountMap = new Map();
  setSf(accountMap, '001BANKONE000000AAA', {
    bankId: 'B-1',
    certNumber: '12345',
    displayName: "O'Brien State Bank",
    accountName: "O'Brien State Bank Salesforce",
    city: 'Quincy',
    state: 'IL',
    ownerId: '005ACCOUNTOWNERAAA',
    matchState: 'matched'
  });
  setSf(accountMap, '001BANKTWO000000BBB', {
    bankId: 'B-2',
    certNumber: '67890',
    displayName: 'Second Bank',
    accountName: 'Second Bank Salesforce',
    city: 'Peoria',
    state: 'IL',
    ownerId: '005ACCOUNTOWNERAAA',
    matchState: 'matched'
  });
  setSf(accountMap, '001NOCERT0000000CCC', {
    accountName: 'RIA Without Cert',
    ownerId: '005ACCOUNTOWNERAAA',
    matchState: 'no_cert'
  });

  const repMap = new Map();
  setSf(repMap, '005PRIMARYOWNERAAA', { displayName: 'Primary Rep' });
  setSf(repMap, '005SECONDOWNER0BBB', { displayName: 'Secondary Rep' });
  setSf(repMap, '005ACCOUNTOWNERAAA', { displayName: 'Account Owner' });

  const rows = [
    {
      Id: 'a10ROW000000000001',
      Account__c: '001BANKONE000000AAA',
      Name: '7R8000001',
      Most_Recent_Trade_Date__c: '2026-06-01',
      Owner_1__c: '005PRIMARYOWNERAAA',
      Owner__c: '005SECONDOWNER0BBB',
      IsDeleted: 'false'
    },
    {
      Id: 'a10ROW000000000002',
      Account__c: '001BANKONE000000AAA',
      Name: '7R8000002',
      Most_Recent_Trade_Date__c: '2026-01-15',
      Owner_1__c: '005PRIMARYOWNERAAA',
      IsDeleted: 'false'
    },
    {
      Id: 'a10ROW000000000003',
      Account__c: '001BANKTWO000000BBB',
      Name: '7R8000003',
      Most_Recent_Trade_Date__c: '2025-01-01',
      Owner_1__c: '005PRIMARYOWNERAAA',
      IsDeleted: 'false'
    },
    {
      Id: 'a10ROW000000000004',
      Account__c: '001NOCERT0000000CCC',
      Name: '7R8000004',
      Owner_1__c: '005PRIMARYOWNERAAA',
      IsDeleted: 'false'
    },
    {
      Id: 'a10ROW000000000005',
      Account__c: '001BANKTWO000000BBB',
      Name: '7R8000005',
      Most_Recent_Trade_Date__c: '2026-06-10',
      Owner_1__c: '005PRIMARYOWNERAAA',
      IsDeleted: 'true'
    }
  ];

  const dry = pershing.importPershingAccounts(tmpDir, rows, {
    accountMap,
    repMap,
    sourceFile: 'pershing.csv',
    importedAt: '2026-06-24T12:00:00.000Z',
    dryRun: true
  });
  ok('dry-run counts active rows', dry.importedCount === 4, JSON.stringify(dry));
  ok('dry-run counts matched rows', dry.matchedRows === 3, JSON.stringify(dry));
  ok('dry-run does not create db', !fs.existsSync(pershing.pershingDatabasePathForDir(tmpDir)));

  const result = pershing.importPershingAccounts(tmpDir, rows, {
    accountMap,
    repMap,
    sourceFile: 'pershing.csv',
    importedAt: '2026-06-24T12:00:00.000Z'
  });
  ok('import count', result.importedCount === 4, JSON.stringify(result));
  ok('import skipped deleted', result.skippedDeleted === 1, JSON.stringify(result));
  ok('import unmatched no-cert row retained', result.unmatchedRows === 1, JSON.stringify(result));

  const b1 = pershing.getPershingForBank(tmpDir, 'B-1', { asOfDate: '2026-06-24' });
  ok('bank accounts listed', b1.accounts.length === 2);
  ok('bank latest trade', b1.rollup.latestTradeDate === '2026-06-01', b1.rollup.latestTradeDate);
  ok('bank trade age', b1.rollup.daysSinceLatestTrade === 23, String(b1.rollup.daysSinceLatestTrade));
  ok('owners resolve primary', b1.rollup.owners[0].name === 'Primary Rep');
  ok('account owner retained', b1.accounts[0].accountOwnerName === 'Account Owner');
  ok('secondary owner retained', b1.accounts[0].secondaryOwnerName === 'Secondary Rep');

  const rollups = pershing.getPershingRollupsForBanks(tmpDir, ['B-1', 'B-2'], { asOfDate: '2026-06-24' });
  ok('rollups map has two banks', rollups.size === 2);
  ok('rollups b2 latest', rollups.get('B-2').latestTradeDate === '2025-01-01');

  const dormant = pershing.listDormantPershingBanks(tmpDir, { asOfDate: '2026-06-24', dormantDays: 180 });
  ok('dormant includes old-trade bank', dormant.some(row => row.bankId === 'B-2'));
  ok('dormant excludes fresh bank', !dormant.some(row => row.bankId === 'B-1'));

  const status = pershing.getPershingImportStatus(tmpDir);
  ok('status available', status.available === true);
  ok('status account count', status.accountCount === 4, JSON.stringify(status));
  ok('status bank count matched only', status.bankCount === 2, JSON.stringify(status));

  pershing.importPershingAccounts(tmpDir, [rows[0]], {
    accountMap,
    repMap,
    sourceFile: 'pershing.csv',
    importedAt: '2026-06-25T12:00:00.000Z'
  });
  const replaced = pershing.getPershingForBank(tmpDir, 'B-1', { asOfDate: '2026-06-25' });
  ok('replace import removes old account rows', replaced.accounts.length === 1);
  ok('replace import updates status count', pershing.getPershingImportStatus(tmpDir).accountCount === 1);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`pershing-store.test.js: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`pershing-store.test.js: ${passed} passed`);
