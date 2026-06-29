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

  const tradeOnlyDry = pershing.importPershingTrades(tmpDir, [{
    'Account Number': '="7R8000001"',
    'Buy/Sell': 'BUY',
    CUSIP: '912828U24',
    Quantity: '100000',
    'Price (Transaction Currency)': '99',
    'Trade Date': '06/01/2026'
  }], { sourceFile: 'trade-only.csv', asOfDate: '2026-06-24', dryRun: true });
  ok('trade dry-run before account import parses rows', tradeOnlyDry.importedCount === 1, JSON.stringify(tradeOnlyDry));
  ok('trade dry-run before account import does not create db', !fs.existsSync(pershing.pershingDatabasePathForDir(tmpDir)));

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
  ok('rollup falls back to account owner', rollups.get('B-2').owners[0].name === 'Account Owner');

  const dormant = pershing.listDormantPershingBanks(tmpDir, { asOfDate: '2026-06-24', dormantDays: 180 });
  ok('dormant includes old-trade bank', dormant.some(row => row.bankId === 'B-2'));
  ok('dormant excludes fresh bank', !dormant.some(row => row.bankId === 'B-1'));

  const status = pershing.getPershingImportStatus(tmpDir);
  ok('status available', status.available === true);
  ok('status account count', status.accountCount === 4, JSON.stringify(status));
  ok('status bank count matched only', status.bankCount === 2, JSON.stringify(status));

  const tradeRows = [
    {
      'Account Number': '="7R8000001"',
      'Buy/Sell': 'BUY',
      'CUSIP': '="912828U24"',
      'Quantity': '250000.00000',
      'Issuer': 'US TREASURY',
      'Security Description': 'US TREASURY NOTE 2.500% 05/31/30',
      'Asset Type Code': 'USTREAS',
      'Price (Transaction Currency)': '99.125',
      'Trade Date': '06/15/2026',
      'Settlement Date': '06/16/2026',
      'Maturity Date': '05/31/2030'
    },
    {
      trade_id: 'T-STABLE-1',
      pershing_account_number: '7R8000002',
      side: 'SELL',
      cusip: '3130A1AA1',
      quantity_or_par: '-100000',
      issuer: 'FHLB',
      security_description: 'FHLB NOTE 4.000% 06/30/28',
      security_type: 'AGENCY',
      price: '101.5',
      trade_date: '2026-06-20',
      settlement_date: '2026-06-21',
      maturity_date: '2028-06-30',
      yield_to_worst: '3.75'
    },
    {
      'Account Number': '7RUNMATCHED',
      'Buy/Sell': 'BUY',
      CUSIP: '48130KVE4',
      Quantity: '50000',
      'Price (Transaction Currency)': '100',
      'Trade Date': '06/22/2026'
    }
  ];
  const tradeDry = pershing.importPershingTrades(tmpDir, tradeRows, {
    sourceFile: 'pershing-trades.csv',
    asOfDate: '2026-06-24',
    dryRun: true
  });
  ok('trade dry-run imports valid rows', tradeDry.importedCount === 3, JSON.stringify(tradeDry));
  ok('trade dry-run counts unique keys', tradeDry.uniqueTradeCount === 3, JSON.stringify(tradeDry));
  ok('trade dry-run joins matched accounts', tradeDry.matchedRows === 2, JSON.stringify(tradeDry));
  ok('trade dry-run counts unmatched trades', tradeDry.unmatchedRows === 1, JSON.stringify(tradeDry));

  const tradeResult = pershing.importPershingTrades(tmpDir, tradeRows, {
    sourceFile: 'pershing-trades.csv',
    asOfDate: '2026-06-24',
    importedAt: '2026-06-24T14:00:00.000Z'
  });
  ok('trade import count', tradeResult.importedCount === 3, JSON.stringify(tradeResult));
  ok('trade import bank count', tradeResult.bankCount === 1, JSON.stringify(tradeResult));

  pershing.importPershingTrades(tmpDir, tradeRows, {
    sourceFile: 'pershing-trades.csv',
    asOfDate: '2026-06-24',
    importedAt: '2026-06-24T15:00:00.000Z'
  });
  const tradeStatus = pershing.getPershingTradeImportStatus(tmpDir);
  ok('trade status available', tradeStatus.available === true, JSON.stringify(tradeStatus));
  ok('trade re-import is idempotent', tradeStatus.tradeCount === 3, JSON.stringify(tradeStatus));
  ok('trade status latest date', tradeStatus.latestTradeDate === '2026-06-22', JSON.stringify(tradeStatus));
  ok('trade status unmatched count', tradeStatus.unmatchedTradeCount === 1, JSON.stringify(tradeStatus));

  const b1Trades = pershing.listPershingTradesForBank(tmpDir, 'B-1', { asOfDate: '2026-06-24' });
  ok('bank trades listed', b1Trades.trades.length === 2, JSON.stringify(b1Trades.trades));
  ok('formula account/cusip normalized', b1Trades.trades.some(t => t.cusip === '912828U24' && t.pershingAccountNumber === '7R8000001'));
  ok('sell quantity stored positive', b1Trades.trades.some(t => t.side === 'SELL' && t.quantityOrPar === 100000));
  ok('coupon extracted from description', b1Trades.trades.some(t => t.cusip === '912828U24' && t.coupon === 2.5));
  ok('yield estimated from price/coupon/maturity', b1Trades.trades.some(t => t.cusip === '912828U24' && t.yieldToMaturity != null && t.yieldSource === 'estimated'));
  ok('source yield is labeled source', b1Trades.trades.some(t => t.cusip === '3130A1AA1' && t.yieldToWorst === 3.75 && t.yieldSource === 'source'));
  const filteredTrades = pershing.listPershingTradesForBank(tmpDir, 'B-1', {
    from: '2026-06-18',
    side: 'SELL',
    securityType: 'AGENCY',
    cusip: '3130',
    limit: 10
  });
  ok('bank trade filters work', filteredTrades.trades.length === 1 && filteredTrades.trades[0].cusip === '3130A1AA1', JSON.stringify(filteredTrades.trades));

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
