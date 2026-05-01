'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractPdfText } = require('../server/pdf-text');
const XLSX = require('xlsx');

const { parseCdOffersText } = require('../server/cd-offers-parser');
const { parseBrokeredCdRateSheetText } = require('../server/brokered-cd-parser');
const { parseMuniOffersText } = require('../server/muni-offers-parser');
const { parseEconomicUpdateText } = require('../server/economic-update-parser');
const { parseAgenciesFiles } = require('../server/agencies-parser');
const { parseCorporatesFiles } = require('../server/corporates-parser');
const {
  sniffDateFromFilename,
  classifyFile,
  hasPrivatePathSegment,
  isSameOriginWrite,
  readPackageDir,
  collectAgencyPackageFiles
} = require('../server/server');
const { saveCdHistorySnapshot, summarizeWeeklyCdHistory } = require('../server/cd-history');
const { importWeeklyCdWorksheet } = require('../server/cd-history-importer');
const {
  getBankDatabaseStatus,
  getBankFromDatabase,
  searchBankDatabase,
  writeBankDatabase
} = require('../server/bank-data-importer');
const {
  addBankNote,
  getBankCoverage,
  getSavedBankCoverageMap,
  listSavedBanks,
  removeBankNote,
  removeSavedBank,
  upsertSavedBank
} = require('../server/bank-coverage-store');
const {
  defaultAccountStatus,
  getBankAccountStatus,
  getBankAccountStatusImportStatus,
  importBankAccountStatusWorkbook,
  upsertBankAccountStatus
} = require('../server/bank-account-status-store');
const {
  addStrategyRequestFile,
  createStrategyRequest,
  getStrategyRequestFile,
  listStrategyRequests,
  updateStrategyRequest
} = require('../server/strategy-store');

const ROOT = path.join(__dirname, '..');
const CURRENT_DIR = path.join(ROOT, 'data', 'current');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'archive');

function currentFile(name) {
  const current = path.join(CURRENT_DIR, name);
  if (fs.existsSync(current)) return current;

  const dateMatch = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (dateMatch) {
    const archiveDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const archived = path.join(ARCHIVE_DIR, archiveDate, name);
    if (fs.existsSync(archived)) return archived;
  }

  if (fs.existsSync(ARCHIVE_DIR)) {
    for (const archiveDate of fs.readdirSync(ARCHIVE_DIR)) {
      const archived = path.join(ARCHIVE_DIR, archiveDate, name);
      if (fs.existsSync(archived)) return archived;
    }
  }

  return current;
}

async function pdfText(filename) {
  const result = await extractPdfText(fs.readFileSync(currentFile(filename)));
  return result.text || '';
}

function assertDateSniffing() {
  assert.strictEqual(sniffDateFromFilename('20260424_CD_Offers.pdf'), '2026-04-24');
  assert.strictEqual(sniffDateFromFilename('FBBS Brokered CD Rate Sheet_04_24_2026_.pdf'), '2026-04-24');
  assert.strictEqual(sniffDateFromFilename('bullets 04.24.26.xlsx'), '2026-04-24');
  assert.strictEqual(sniffDateFromFilename('callables-04-24-26.xlsx'), '2026-04-24');
  assert.strictEqual(sniffDateFromFilename('corporates_04_24_2026.xlsx'), '2026-04-24');
}

function assertClassification() {
  assert.strictEqual(classifyFile('FBBS_Dashboard_20260424.html'), 'dashboard');
  assert.strictEqual(classifyFile('20260424.pdf'), 'econ');
  assert.strictEqual(classifyFile('FBBS Brokered CD Rate Sheet_04_24_2026_.pdf'), 'cd');
  assert.strictEqual(classifyFile('20260424_CD_Offers.pdf'), 'cdoffers');
  assert.strictEqual(classifyFile('20260424_FBBS_Offerings.pdf'), 'munioffers');
  assert.strictEqual(classifyFile('bullets 04.24.26.xlsx'), 'agenciesBullets');
  assert.strictEqual(classifyFile('callables 04.24.26.xlsx'), 'agenciesCallables');
  assert.strictEqual(classifyFile('corporates 04.24.26.xlsx'), 'corporates');
}

function assertSecurityHelpers() {
  assert.strictEqual(hasPrivatePathSegment('_meta.json'), true);
  assert.strictEqual(hasPrivatePathSegment('nested/_secret.json'), true);
  assert.strictEqual(hasPrivatePathSegment('folder/report.pdf'), false);

  assert.strictEqual(isSameOriginWrite({
    headers: {
      host: 'portal.local:3000',
      origin: 'http://portal.local:3000'
    }
  }), true);
  assert.strictEqual(isSameOriginWrite({
    headers: {
      host: 'portal.local:3000',
      origin: 'http://evil.example'
    }
  }), false);
  assert.strictEqual(isSameOriginWrite({
    headers: {
      host: 'portal.local:3000',
      'sec-fetch-site': 'cross-site'
    }
  }), false);
  assert.strictEqual(isSameOriginWrite({ headers: { host: 'portal.local:3000' } }), true);
}

async function assertCdParser() {
  const parsed = parseCdOffersText(await pdfText('20260424_CD_Offers.pdf'));
  assert.strictEqual(parsed.asOfDate, '2026-04-24');
  assert.strictEqual(parsed.offerings.length, 131);
  assert.deepStrictEqual(parsed.offerings[0], {
    term: '1m',
    termMonths: 1,
    name: 'NEWBURYPORT FIVE CENTS',
    rate: 3.9,
    maturity: '2026-05-27',
    cusip: '651023KN2',
    settle: '2026-04-29',
    issuerState: 'MA',
    restrictions: ['CA', 'TX'],
    couponFrequency: 'at maturity'
  });

  const commaRestrictions = parseCdOffersText([
    '4/27/2026 Daily CD Rates',
    'TERM NAME RATE MATURITY CUSIP SETTLE STATE RESTRICTIONS CPN_FREQ',
    '3m THIRD FED SAV&LN CLEVLND 3.90 8/10/2026 88413QKB3 5/11/2026 OH FL, OH, TX at maturity'
  ].join('\n'));
  assert.strictEqual(commaRestrictions.warnings.length, 0);
  assert.deepStrictEqual(commaRestrictions.offerings[0].restrictions, ['FL', 'OH', 'TX']);
}

async function assertBrokeredCdParser() {
  const parsed = parseBrokeredCdRateSheetText(await pdfText('FBBS Brokered CD Rate Sheet_04_24_2026_.pdf'));
  assert.strictEqual(parsed.asOfDate, '2026-04-24');
  assert.strictEqual(parsed.terms.length, 11);
  assert.deepStrictEqual(parsed.terms[0], {
    label: '3 mo',
    months: 3,
    low: 3.9,
    mid: 3.95,
    high: 4
  });
  assert.strictEqual(parsed.terms.find(term => term.months === 120).mid, 4.35);
}

async function assertMuniParser() {
  const parsed = parseMuniOffersText(await pdfText('20260424_FBBS_Offerings.pdf'));
  assert.strictEqual(parsed.asOfDate, '2026-04-24');
  assert.strictEqual(parsed.offerings.length, 27);
  assert.strictEqual(parsed.warnings.length, 0);
  assert.strictEqual(parsed.offerings[0].section, 'BQ');
  assert.strictEqual(parsed.offerings[0].cusip, '824105BB5');
  assert.strictEqual(parsed.offerings[0].creditEnhancement, 'BAM');

  const wrappedTaxable = parsed.offerings.find(row => row.cusip === '655867W54');
  assert(wrappedTaxable);
  assert.strictEqual(wrappedTaxable.issuerName, 'NORFOLK VA ETM - 100% SLUGS');
  assert.strictEqual(wrappedTaxable.spread, '+24/7YR');
}

async function assertEconomicUpdateParser() {
  const parsed = parseEconomicUpdateText(await pdfText('20260427.pdf'));
  assert.strictEqual(parsed.asOfDate, '2026-04-27');
  assert.strictEqual(parsed.treasuries.length, 10);
  assert.strictEqual(parsed.treasuries.find(row => row.tenor === '10YR').yield, 4.319);
  assert.strictEqual(parsed.releases[0].event, 'Durable Goods Orders');
  assert.strictEqual(parsed.releases[0].dateTime, '04/29/26 7:30 AM');
  assert(parsed.releases.some(row => row.event === 'Housing Starts'));
  assert(!parsed.releases.some(row => /^Apr\b/.test(row.event)));
}

function assertAgenciesParser() {
  const parsed = parseAgenciesFiles([
    { filename: 'bullets 04.24.26.xlsx', buffer: fs.readFileSync(currentFile('bullets 04.24.26.xlsx')) },
    { filename: 'callables 04.24.26.xlsx', buffer: fs.readFileSync(currentFile('callables 04.24.26.xlsx')) }
  ]);
  assert.strictEqual(parsed.offerings.length, 342);
  assert.deepStrictEqual(parsed.sources.map(s => [s.structure, s.rowCount]), [
    ['Bullet', 56],
    ['Callable', 286]
  ]);
  assert.strictEqual(parsed.offerings[0].cusip, '3133EWKF6');
  assert.strictEqual(parsed.offerings[0].ticker, 'FFCB');
}

function assertCorporatesParser() {
  const parsed = parseCorporatesFiles([
    { filename: 'corporates 04.24.26.xlsx', buffer: fs.readFileSync(currentFile('corporates 04.24.26.xlsx')) }
  ]);
  assert.strictEqual(parsed.offerings.length, 197);
  assert.strictEqual(parsed.sources[0].rowCount, 197);
  assert.strictEqual(parsed.offerings[0].cusip, '24422EXD6');
  assert.strictEqual(parsed.offerings[0].creditTier, 'A');
  assert.strictEqual(parsed.offerings[0].investmentGrade, true);
}

function assertPackageReaderUsesSlotMetadata() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-package-meta-'));
  try {
    fs.writeFileSync(path.join(tmp, 'generic spreadsheet.xlsx'), 'not parsed here');
    fs.writeFileSync(path.join(tmp, '_meta.json'), JSON.stringify({
      date: '2026-04-28',
      slotFilenames: {
        corporates: 'generic spreadsheet.xlsx'
      },
      corporatesCount: 12
    }));

    const pkg = readPackageDir(tmp);
    assert.strictEqual(pkg.date, '2026-04-28');
    assert.strictEqual(pkg.corporates, 'generic spreadsheet.xlsx');
    assert.strictEqual(pkg.agenciesBullets, null);
    assert.strictEqual(pkg.corporatesCount, 12);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertAgencyCollectionPreservesCounterpart() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-agency-merge-'));
  try {
    fs.writeFileSync(path.join(tmp, 'existing bullets.xlsx'), 'bullets');
    fs.writeFileSync(path.join(tmp, 'fresh callables.xlsx'), 'callables');

    const selected = collectAgencyPackageFiles(tmp, {
      slotFilenames: {
        agenciesCallables: 'fresh callables.xlsx'
      },
      priorMeta: {
        slotFilenames: {
          agenciesBullets: 'existing bullets.xlsx',
          agenciesCallables: 'old callables.xlsx'
        }
      }
    });

    assert.deepStrictEqual(selected.missingSlots, []);
    assert.deepStrictEqual(selected.files.map(f => [f.slot, f.filename]), [
      ['agenciesBullets', 'existing bullets.xlsx'],
      ['agenciesCallables', 'fresh callables.xlsx']
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertBankDatabaseRoundTrip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bank-db-'));
  try {
    writeBankDatabase({
      metadata: {
        importedAt: '2026-04-29T12:00:00.000Z',
        sourceFile: 'sample.xlsm',
        latestPeriod: '2025Q4',
        bankCount: 1,
        rowCount: 2,
        fields: []
      },
      banks: [{
        id: 'bank-1',
        summary: {
          id: 'bank-1',
          displayName: 'Sample Bank, Springfield, IL',
          name: 'Sample Bank',
          city: 'Springfield',
          state: 'IL',
          certNumber: '12345',
          parentName: 'Sample Bancorp',
          primaryRegulator: 'FDIC',
          period: '2025Q4',
          totalAssets: 1000,
          totalDeposits: 800
        },
        periods: [
          { period: '2025Q4', endDate: '12/31/2025', values: { id: 'bank-1', name: 'Sample Bank' } }
        ]
      }]
    }, tmp);

    const status = getBankDatabaseStatus(tmp);
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.bankCount, 1);
    assert.strictEqual(status.metadata.latestPeriod, '2025Q4');

    const results = searchBankDatabase(tmp, 'sample springfield', 5);
    assert.strictEqual(results.results.length, 1);
    assert.strictEqual(results.results[0].certNumber, '12345');

    const detail = getBankFromDatabase(tmp, 'bank-1');
    assert.strictEqual(detail.bank.periods.length, 1);
    assert.strictEqual(detail.bank.summary.displayName, 'Sample Bank, Springfield, IL');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertBankCoverageStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bank-coverage-'));
  try {
    const summary = {
      id: 'bank-1',
      displayName: 'Sample Bank, Springfield, IL',
      name: 'Sample Bank',
      city: 'Springfield',
      state: 'IL',
      certNumber: '12345',
      primaryRegulator: 'FDIC',
      period: '2025Q4',
      totalAssets: 1000,
      totalDeposits: 800
    };

    const saved = upsertSavedBank(tmp, summary, {
      status: 'Prospect',
      priority: 'High',
      owner: 'FBBS',
      nextActionDate: '2026-05-01'
    });
    assert.strictEqual(saved.bankId, 'bank-1');
    assert.strictEqual(saved.status, 'Prospect');
    assert.strictEqual(saved.priority, 'High');
    assert.strictEqual(saved.owner, 'FBBS');

    const rows = listSavedBanks(tmp);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].displayName, 'Sample Bank, Springfield, IL');
    const savedMap = getSavedBankCoverageMap(tmp, ['bank-1', 'missing-bank']);
    assert.strictEqual(savedMap.size, 1);
    assert.strictEqual(savedMap.get('bank-1').status, 'Prospect');

    const note = addBankNote(tmp, 'bank-1', 'Discussed CD ladder and muni needs.');
    assert(note.id);
    assert.strictEqual(getBankCoverage(tmp, 'bank-1').notes.length, 1);

    removeBankNote(tmp, note.id);
    assert.strictEqual(getBankCoverage(tmp, 'bank-1').notes.length, 0);

    removeSavedBank(tmp, 'bank-1');
    assert.strictEqual(listSavedBanks(tmp).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertBankAccountStatusStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bank-status-'));
  try {
    const summaries = [
      {
        id: 'old-bank',
        displayName: 'Sample Bank, Springfield, IL',
        name: 'Sample Bank',
        city: 'Springfield',
        state: 'IL',
        certNumber: '12345',
        period: '2017Y'
      },
      {
        id: 'new-bank',
        displayName: 'Sample Bank, Springfield, IL',
        name: 'Sample Bank',
        city: 'Springfield',
        state: 'IL',
        certNumber: '12345',
        period: '2025Q4'
      },
      {
        id: 'prospect-bank',
        displayName: 'Prospect Bank, Nashville, IL',
        name: 'Prospect Bank',
        city: 'Nashville',
        state: 'IL',
        certNumber: '98765',
        period: '2025Q4'
      }
    ];
    assert.strictEqual(defaultAccountStatus(summaries[0]).status, 'Open');

    const workbookPath = path.join(tmp, 'Account + FDIC Cert.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Status', 'Cert Number'],
      ['Client', '12345'],
      ['Prospect', '98765'],
      ['Open', '00000']
    ]), 'Sheet1');
    XLSX.writeFile(workbook, workbookPath);

    const result = importBankAccountStatusWorkbook(tmp, workbookPath, summaries, {
      sourceFile: 'Account + FDIC Cert.xlsx'
    });
    assert.strictEqual(result.importedCount, 2);
    assert.strictEqual(result.unmatchedCount, 1);
    assert.strictEqual(getBankAccountStatus(tmp, 'new-bank').status, 'Client');
    assert.strictEqual(getBankAccountStatus(tmp, 'old-bank'), null);
    assert.strictEqual(getBankAccountStatus(tmp, 'prospect-bank').status, 'Prospect');
    const importStatus = getBankAccountStatusImportStatus(tmp);
    assert.strictEqual(importStatus.available, true);
    assert.strictEqual(importStatus.statusCount, 2);
    assert.strictEqual(importStatus.metadata.sourceFile, 'Account + FDIC Cert.xlsx');

    const manual = upsertBankAccountStatus(tmp, summaries[2], { status: 'Not Real' });
    assert.strictEqual(manual.status, 'Prospect');
    const open = upsertBankAccountStatus(tmp, summaries[2], { status: 'Open' });
    assert.strictEqual(open.status, 'Open');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertStrategyStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-strategies-'));
  try {
    const summary = {
      id: 'bank-1',
      displayName: 'Sample Bank, Springfield, IL',
      name: 'Sample Bank',
      city: 'Springfield',
      state: 'IL',
      certNumber: '12345'
    };
    const request = createStrategyRequest(tmp, summary, {
      requestType: 'Bond Swap',
      priority: '2',
      requestedBy: 'Joe',
      assignedTo: 'Strategies',
      invoiceContact: 'Controller',
      summary: 'Evaluate swap for tax-loss harvesting',
      comments: 'Client asked for a breakeven review.'
    });
    assert(request.id);
    assert.strictEqual(request.status, 'Open');
    assert.strictEqual(request.requestType, 'Bond Swap');
    assert.strictEqual(request.priority, '2');

    const open = listStrategyRequests(tmp, { status: 'Open' });
    assert.strictEqual(open.requests.length, 1);
    assert.strictEqual(open.counts.Open, 1);

    const updated = updateStrategyRequest(tmp, request.id, { status: 'Needs Billed', assignedTo: 'Dan', priority: '5' });
    assert.strictEqual(updated.status, 'Needs Billed');
    assert.strictEqual(updated.assignedTo, 'Dan');
    assert.strictEqual(updated.priority, '5');
    assert(updated.billedAt);

    const tho = updateStrategyRequest(tmp, request.id, { requestType: 'THO Report' });
    assert.strictEqual(tho.requestType, 'THO Report');

    const withFile = addStrategyRequestFile(tmp, request.id, {
      filename: 'Final THO Report.pdf',
      data: Buffer.from('%PDF-1.4\n')
    });
    assert.strictEqual(withFile.files.length, 1);
    assert.strictEqual(withFile.files[0].filename, 'Final THO Report.pdf');
    const savedFile = getStrategyRequestFile(tmp, request.id, withFile.files[0].id);
    assert(savedFile.path.endsWith('.pdf'));
    assert.strictEqual(fs.existsSync(savedFile.path), true);

    const byBank = listStrategyRequests(tmp, { bankId: 'bank-1' });
    assert.strictEqual(byBank.requests.length, 1);
    assert.strictEqual(byBank.counts['Needs Billed'], 1);
    assert.strictEqual(byBank.requests[0].files.length, 1);

    const archived = updateStrategyRequest(tmp, request.id, { archived: true, markBilled: true });
    assert(archived.archivedAt);
    assert(archived.billedAt);

    const active = listStrategyRequests(tmp);
    assert.strictEqual(active.requests.length, 0);
    assert.strictEqual(active.counts.Archived, 1);

    const archivedOnly = listStrategyRequests(tmp, { archived: 'only', bankId: 'bank-1' });
    assert.strictEqual(archivedOnly.requests.length, 1);
    assert.strictEqual(archivedOnly.requests[0].isArchived, true);

    const restored = updateStrategyRequest(tmp, request.id, { archived: false });
    assert.strictEqual(restored.isArchived, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertCdHistoryWeeklyDedupe() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-cd-history-'));
  const baseOfferings = [
    { term: '3m', termMonths: 3, name: 'A BANK', rate: 3.75, cusip: '111111111', maturity: '2026-07-01' },
    { term: '3m', termMonths: 3, name: 'B BANK', rate: 3.85, cusip: '222222222', maturity: '2026-07-02' },
    { term: '6m', termMonths: 6, name: 'C BANK', rate: 3.90, cusip: '333333333', maturity: '2026-10-01' }
  ];
  saveCdHistorySnapshot(tmp, {
    asOfDate: '2026-04-14',
    sourceFile: 'prior-week.pdf',
    offerings: [
      { term: '3m', termMonths: 3, name: 'OLD A BANK', rate: 3.50, cusip: '999999999', maturity: '2026-07-01' },
      { term: '6m', termMonths: 6, name: 'OLD C BANK', rate: 3.75, cusip: '888888888', maturity: '2026-10-01' }
    ]
  }, { uploadedAt: '2026-04-14T12:00:00.000Z', uploadDate: '2026-04-14' });
  saveCdHistorySnapshot(tmp, {
    asOfDate: '2026-04-20',
    sourceFile: 'day-1.pdf',
    offerings: baseOfferings
  }, { uploadedAt: '2026-04-20T12:00:00.000Z', uploadDate: '2026-04-20' });
  saveCdHistorySnapshot(tmp, {
    asOfDate: '2026-04-21',
    sourceFile: 'day-2.pdf',
    offerings: [
      { term: '3m', termMonths: 3, name: 'A BANK', rate: 3.75, cusip: '111111111', maturity: '2026-07-01' },
      { term: '6m', termMonths: 6, name: 'D BANK', rate: 4.00, cusip: '444444444', maturity: '2026-10-02' }
    ]
  }, { uploadedAt: '2026-04-21T12:00:00.000Z', uploadDate: '2026-04-21' });

  const recap = summarizeWeeklyCdHistory(tmp, { anchorDate: '2026-04-24' });
  assert.strictEqual(recap.weekStart, '2026-04-20');
  assert.strictEqual(recap.weekEnd, '2026-04-24');
  assert.strictEqual(recap.rawRows, 5);
  assert.strictEqual(recap.uniqueCusips, 4);
  assert.strictEqual(recap.duplicateRowsRemoved, 1);
  assert.strictEqual(recap.terms.find(t => t.term === '3m').uniqueCusips, 2);
  assert.strictEqual(recap.terms.find(t => t.term === '3m').medianRate, 3.8);
  assert.strictEqual(recap.terms.find(t => t.term === '6m').uniqueCusips, 2);
  assert.strictEqual(recap.terms.find(t => t.term === '6m').medianRate, 3.95);
  assert.strictEqual(recap.rateComparisons.periods.find(p => p.key === 'today').snapshotDate, '2026-04-21');
  assert.strictEqual(recap.rateComparisons.periods.find(p => p.key === 'previousWeek').snapshotDate, '2026-04-14');
  const threeMonth = recap.rateComparisons.terms.find(t => t.term === '3m');
  assert.strictEqual(threeMonth.rates.today, 3.75);
  assert.strictEqual(threeMonth.rates.previousWeek, 3.5);
  assert.strictEqual(threeMonth.deltas.previousWeek, 0.25);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function assertWeeklyCdWorksheetImport() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-cd-import-'));
  const workbookPath = path.join(tmp, 'Weekly CD Worksheet.xlsx');
  const historyDir = path.join(tmp, 'cd-history');
  const workbook = XLSX.utils.book_new();

  const dataRows = [
    ['CUSIP', 'NAME', 'DESCRIPTION', 'RATE', 'MATURITY', 'CUSIP2', 'SETTLE', 'FDIC NUMBER', 'DOMICILED', 'IDC', 'MAT YEAR', 'TERM', 'Column1', 'RESTRICTIONS', 'Column2', 'Date Uploaded'],
    ['111111111', 'A BANK', 'A BANK 3.8 07/01/26', 3.8, new Date(2026, 6, 1), '111111111', new Date(2026, 3, 1), '1', 'MO', '300', 2026, '3m', 'TX, CA', 'TEST', null, new Date(2026, 2, 28)],
    ['222222222', 'B BANK', 'B BANK 4.1 10/01/26', 4.1, new Date(2026, 9, 1), '222222222', new Date(2026, 3, 2), '2', 'IL', '300', 2026, '6m', '', 'TEST', null, new Date(2026, 2, 28)],
    [null, null, null, '3m', 4.2, '6m', 4.1, '12m', 4, '18m', 4, '24m', 3.95, '36m', 4, '4y']
  ];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Data');

  const historicRows = [
    ['CUSIP', 'NAME', 'DESCRIPTION', 'RATE', 'MATURITY', 'CUSIP2', 'SETTLE', 'FDIC NUMBER', 'DOMICILED', 'IDC', 'MAT YEAR', 'TERM', 'RESTRICTIONS', 'RUNNER', 'CPN FREQ', 'Issuance'],
    ['333333333', 'C BANK', 'C BANK 5 04/01/24', 5, new Date(2024, 3, 1), '333333333', new Date(2024, 0, 2), '3', 'TX', '300', 2024, '3m', 'NE', 'TEST', 'at maturity', 1]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(historicRows), '2024 Data');
  XLSX.writeFile(workbook, workbookPath, { cellDates: true });

  try {
    const result = importWeeklyCdWorksheet(workbookPath, {
      historyDir,
      sheets: ['2024 Data', 'Data']
    });

    assert.strictEqual(result.stats.writtenSnapshots, 2);
    assert.strictEqual(result.stats.uniqueRows, 3);
    assert.strictEqual(result.stats.skippedRows, 1);
    assert.strictEqual(fs.existsSync(path.join(historyDir, '1900-01-04.json')), false);

    const currentSnapshot = JSON.parse(fs.readFileSync(path.join(historyDir, '2026-03-28.json'), 'utf-8'));
    assert.strictEqual(currentSnapshot.offerings.length, 2);
    assert.deepStrictEqual(currentSnapshot.offerings.find(o => o.cusip === '111111111').restrictions, ['TX', 'CA']);
    assert.strictEqual(currentSnapshot.offerings.find(o => o.cusip === '222222222').termMonths, 6);

    const historicSnapshot = JSON.parse(fs.readFileSync(path.join(historyDir, '2024-01-02.json'), 'utf-8'));
    assert.strictEqual(historicSnapshot.offerings[0].couponFrequency, 'at maturity');

    const rerun = importWeeklyCdWorksheet(workbookPath, {
      historyDir,
      sheets: ['2024 Data', 'Data']
    });
    assert.strictEqual(rerun.stats.writtenSnapshots, 0);
    assert.strictEqual(rerun.stats.skippedExistingSnapshots, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async function run() {
  assertDateSniffing();
  assertClassification();
  assertSecurityHelpers();
  await assertCdParser();
  await assertBrokeredCdParser();
  await assertMuniParser();
  await assertEconomicUpdateParser();
  assertAgenciesParser();
  assertCorporatesParser();
  assertPackageReaderUsesSlotMetadata();
  assertAgencyCollectionPreservesCounterpart();
  assertBankDatabaseRoundTrip();
  assertBankCoverageStore();
  assertBankAccountStatusStore();
  assertStrategyStore();
  assertCdHistoryWeeklyDedupe();
  assertWeeklyCdWorksheetImport();
  console.log('Parser regression tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
