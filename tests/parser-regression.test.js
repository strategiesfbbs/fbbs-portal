'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractPdfText } = require('../server/pdf-text');
const XLSX = require('../server/xlsx');

const { parseCdOffersText, parseCdOffersWorkbook } = require('../server/cd-offers-parser');
const { parseBrokeredCdRateSheetText } = require('../server/brokered-cd-parser');
const { parseMuniOffersText } = require('../server/muni-offers-parser');
const { parseBairdSyndicateWorkbook, looksLikeBairdSyndicateWorkbook } = require('../server/baird-syndicate-parser');
const { parseEconomicUpdateText } = require('../server/economic-update-parser');
const { parseMmdCurveText } = require('../server/mmd-parser');
const { parseTreasuryNotesWorkbook, looksLikeTreasuryWorkbook } = require('../server/treasury-notes-parser');
const { parseAgenciesFiles } = require('../server/agencies-parser');
const { parseCorporatesFiles } = require('../server/corporates-parser');
const {
  sniffDateFromFilename,
  classifyFile,
  classifyFolderDropFile,
  hasPrivatePathSegment,
  isSameOriginWrite,
  mapSwapHoldingPosition,
  readPackageDir,
  collectAgencyPackageFiles,
  sniffAgencyWorkbookSlot,
  uploadSlotFromFieldName
} = require('../server/server');
const { saveCdHistorySnapshot, summarizeWeeklyCdHistory } = require('../server/cd-history');
const { importWeeklyCdWorksheet } = require('../server/cd-history-importer');
const {
  getBankDatabaseStatus,
  getBankFromDatabase,
  importBankWorkbook,
  parseBankWorkbook,
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
  listBankAccountStatuses,
  upsertBankAccountStatus
} = require('../server/bank-account-status-store');
const {
  addStrategyRequestFile,
  createStrategyRequest,
  deleteStrategyRequest,
  getStrategyRequestFile,
  listStrategyRequests,
  updateStrategyRequest
} = require('../server/strategy-store');
const {
  getAveragedSeriesStatus,
  loadAveragedSeriesDataset,
  saveAveragedSeriesWorkbook
} = require('../server/averaged-series-store');
const {
  getBondAccountingForBank,
  getBondAccountingStatus,
  importBondAccountingFolder,
  loadBondAccountingManifest,
  parseBankListWorkbook,
  parsePortfolioFilename,
  resolveBondAccountingStoredFile
} = require('../server/bond-accounting-store');

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
  assert.strictEqual(classifyFile('FBBS_Dashboard_20260424.html'), null);
  assert.strictEqual(classifyFile('20260424.pdf'), 'econ');
  assert.strictEqual(classifyFile('Relative Value 04.24.2026.pdf'), 'relativeValue');
  assert.strictEqual(classifyFile('20260511_CD_Relative_Val.pdf'), 'relativeValue');
  assert.strictEqual(classifyFile('MMD-1.pdf'), 'mmd');
  assert.strictEqual(classifyFile('Treasury Notes 04.24.2026.xlsx'), 'treasuryNotes');
  assert.strictEqual(classifyFile('FBBS Brokered CD Rate Sheet_04_24_2026_.pdf'), 'cd');
  assert.strictEqual(classifyFile('20260424_CD_Offers.pdf'), 'cdoffers');
  assert.strictEqual(classifyFile('20260424_CD_Offers.xlsx'), 'cdoffers');
  assert.strictEqual(classifyFile('new issue cds - cost - 5.8.26.xlsx'), 'cdoffers');
  assert.strictEqual(classifyFile('CDs - Cost.xlsx'), 'cdoffers');
  assert.strictEqual(classifyFile('20260512_MASTER.xls'), null);
  assert.strictEqual(classifyFile('dealer commission spreadsheet.xlsx'), null);
  assert.strictEqual(classifyFile('20260424_FBBS_Offerings.pdf'), 'munioffers');
  // Generic grid1_<hash> names carry no slot hint → unclassified at the filename
  // layer (content sniffing routes them). They must NOT blanket-default to
  // agenciesBullets: findPackageFileForSlot scans the package via classifyFile,
  // and that default made any stray workbook get grabbed as the agency bullets file.
  assert.strictEqual(classifyFile('grid1_twjtolp5.xlsx'), null);
  assert.strictEqual(classifyFile('Baird Syndicate Munis.xlsx'), 'bairdSyndicate');
  assert.strictEqual(classifyFile('bullets 04.24.26.xlsx'), 'agenciesBullets');
  assert.strictEqual(classifyFile('callables 04.24.26.xlsx'), 'agenciesCallables');
  assert.strictEqual(classifyFile('corporates 04.24.26.xlsx'), 'corporates');

  assert.strictEqual(classifyFolderDropFile('TSY NOTE OFFERS 5.12.26.xlsx'), 'treasuryNotes');
  assert.strictEqual(classifyFolderDropFile('bullets 05.12.26.xlsx'), 'agenciesBullets');
  assert.strictEqual(classifyFolderDropFile('callables 05.12.26.xlsx'), 'agenciesCallables');
  assert.strictEqual(classifyFolderDropFile('corporates 05.12.26.xlsx'), 'corporates');
  assert.strictEqual(classifyFolderDropFile('20260512_MASTER.xls'), null);
  assert.strictEqual(classifyFolderDropFile('grid1_nnepvdfk.xlsx'), null);
  assert.strictEqual(classifyFolderDropFile('random spreadsheet.xlsx'), null);
}

function assertUploadSlotFieldNames() {
  assert.strictEqual(uploadSlotFromFieldName('econ'), 'econ');
  assert.strictEqual(uploadSlotFromFieldName('file-mmd'), 'mmd');
  assert.strictEqual(uploadSlotFromFieldName('file_relativeValue'), 'relativeValue');
  assert.strictEqual(uploadSlotFromFieldName('file-RelativeValue'), 'relativeValue');
  assert.strictEqual(uploadSlotFromFieldName('cdoffersCost'), null);
  assert.strictEqual(uploadSlotFromFieldName('file-cdCost'), null);
  assert.strictEqual(uploadSlotFromFieldName('file-cd-extra'), null);
  assert.strictEqual(uploadSlotFromFieldName('unknown'), null);
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
  assert.strictEqual(isSameOriginWrite({ headers: { host: 'portal.local:3000' } }, { requireHeaderSignal: true }), false);
  assert.strictEqual(isSameOriginWrite({
    headers: {
      host: 'portal.local:3000',
      'sec-fetch-site': 'same-origin'
    }
  }, { requireHeaderSignal: true }), true);
  assert.strictEqual(isSameOriginWrite({
    headers: {
      host: 'portal.local:3000',
      'sec-fetch-site': 'same-site'
    }
  }, { requireHeaderSignal: true }), false);
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

function assertCdWorkbookParser() {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['4/27/2026 Daily CD Rates'],
    [],
    ['TERM', 'NAME', 'RATE', 'MATURITY', 'CUSIP', 'SETTLE', 'STATE', 'RESTRICTIONS', 'CPN_FREQ', 'COST'],
    ['3m', 'THIRD FED SAV&LN CLEVLND', 0.039, new Date(2026, 7, 10), '88413QKB3', '5/11/2026', 'OH', 'FL, OH, TX', 'At Maturity', 99.95],
    [null, 'A BANK', 4.1, '10/1/2026', '111111111', '5/12/2026', 'TX', '', 'Monthly', 99.5]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Daily CD Rates');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseCdOffersWorkbook(buffer, { filename: '20260427_CD_Offers.xlsx' });

  assert.strictEqual(parsed.asOfDate, '2026-04-27');
  assert.strictEqual(parsed.offerings.length, 2);
  assert.deepStrictEqual(parsed.offerings[0], {
    term: '3m',
    termMonths: 3,
    name: 'THIRD FED SAV&LN CLEVLND',
    rate: 3.9,
    maturity: '2026-08-10',
    cusip: '88413QKB3',
    settle: '2026-05-11',
    issuerState: 'OH',
    restrictions: ['FL', 'OH', 'TX'],
    couponFrequency: 'at maturity',
    cost: 99.95,
    commission: 0.5
  });
  assert.strictEqual(parsed.offerings[1].term, '3m');
  assert.strictEqual(parsed.offerings[1].rate, 4.1);
  assert.strictEqual(parsed.offerings[1].couponFrequency, 'monthly');
  assert.strictEqual(parsed.offerings[1].commission, 5);

  const compactWorkbook = XLSX.utils.book_new();
  const compactRows = [
    ['CUSIP(s)', 'Issuer(s)', 'COUPON(s)', 'Maturity(s)', 'First Sett Dt(s)', 'Cpn Freq(s)', 'Ask Amt', 'Inside/Trader Cost'],
    ['02905LDA0', 'AMERICAN PLUS BANK NA', 3.75, '05/13/2027', '05/13/2026', 12, 500, 99.95],
    ['06051YAC4', 'BANK OF AMERICA NA', 3.9, '11/13/2026', '05/13/2026', 0, 500, 99.975],
    ['06051YAB6', 'BANK OF AMERICA NA', 4, '11/15/2027', '05/13/2026', 2, 500, 99.85]
  ];
  XLSX.utils.book_append_sheet(compactWorkbook, XLSX.utils.aoa_to_sheet(compactRows), 'Worksheet');
  const compactBuffer = XLSX.write(compactWorkbook, { type: 'buffer', bookType: 'xlsx' });
  const compactParsed = parseCdOffersWorkbook(compactBuffer, { filename: 'new issue cds - cost - 5.8.26.xlsx' });
  assert.strictEqual(compactParsed.asOfDate, '2026-05-08');
  assert.strictEqual(compactParsed.offerings.length, 3);
  assert.deepStrictEqual(compactParsed.offerings.map(o => o.term), ['1y', '6m', '18m']);
  assert.deepStrictEqual(compactParsed.offerings.map(o => o.couponFrequency), ['monthly', 'at maturity', 'semiannually']);
  assert.strictEqual(compactParsed.offerings[0].commission, 0.5);
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

  const taxableVariants = parseMuniOffersText([
    '6/1/2026',
    'TAXABLE MUNIS',
    'A2 A (POS) 1230 KS WYANDOTTE CNTY/KANSAS CITY KS UNIG GOVT UTILITY SYSTEM REV 2.061 9/1/2030 +10/OLD 5YR 9/1/2026 982674NK5',
    'NR 805 MA MASSACHUSETTS ST SCH BLDG AUTH ETM.. CASH & OTHER COLLATERAL REV 2.400 2/15/2036 2/15/2031 +30/10YR T 8/15/2026 576000H22 ETM'
  ].join('\n'));
  assert.strictEqual(taxableVariants.warnings.length, 0);
  assert.strictEqual(taxableVariants.offerings.length, 2);
  assert.strictEqual(taxableVariants.offerings[0].spread, '+10/OLD 5YR');
  assert.strictEqual(taxableVariants.offerings[0].settle, null);
  assert.strictEqual(taxableVariants.offerings[1].callDate, '2031-02-15');
  assert.strictEqual(taxableVariants.offerings[1].spread, '+30/10YR T');
  assert.strictEqual(taxableVariants.offerings[1].creditEnhancement, 'ETM');
}

function assertBairdSyndicateParser() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Security','St','Issuer','Cpn','Mty','Nxt Call','A Sz','A YTC','A YTM','A Px','Moody','S&P','BQ','FED\nTAX','TOTAL\nCUTS','COMM'],
    ['848576WP5','IA','SPIRIT LAKE IA','5.000','6/1/2030','','5','2.930','2.930','107.687','','AA-','Y','N','-10','$3.75'],
    ['020213MU5','MI','ALMA MI PUBLIC SCHS','4.125','5/1/2043','5/1/2036','80','4.250','4.250','98.500','','AA','N','N','-10','$12.50']
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Worksheet');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseBairdSyndicateWorkbook(buffer);

  assert.strictEqual(parsed.warnings.length, 0);
  assert.strictEqual(parsed.offerings.length, 2);
  assert.strictEqual(parsed.offerings[0].source, 'Baird Syndicate');
  assert.strictEqual(parsed.offerings[0].isSyndicate, true);
  assert.strictEqual(parsed.offerings[0].section, 'BQ');
  assert.strictEqual(parsed.offerings[0].cusip, '848576WP5');
  assert.strictEqual(parsed.offerings[0].maturity, '2030-06-01');
  assert.strictEqual(parsed.offerings[0].ytw, 2.93);
  assert.strictEqual(parsed.offerings[1].section, 'Municipals');
  assert.strictEqual(parsed.offerings[1].callDate, '2036-05-01');
  assert.strictEqual(parsed.offerings[1].bairdCommission, '$12.50');
  assert.strictEqual(looksLikeBairdSyndicateWorkbook(buffer), true);
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

  const separated = parseEconomicUpdateText(`
    ECONOMIC UPDATE 05/01/2026
    ECONOMIC RELEASES
    EVENT
    DATE/TIME
    Durable Goods Orders
    Consumer Confidence
    05/02/26 7:30 AM
    TREASURY YIELD CURVE
  `);
  assert.deepStrictEqual(separated.releases, [
    { event: 'Durable Goods Orders', dateTime: null },
    { event: 'Consumer Confidence', dateTime: null }
  ]);
  assert(separated.warnings.some(warning => warning.includes('separate event names') && warning.includes('date/time rows')));
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

  const bannerParsed = parseAgenciesFiles([{
    filename: 'bullets banner.xlsx',
    buffer: workbookBuffer([
      ['Daily Agency Bullets'],
      ['Generated by trader export'],
      ['ASz', 'Tkr', 'Cpn', 'Mty', 'CUSIP', 'A Px', 'A YTM', 'A Spd', 'Bench'],
      [4.5, 'FHLB', 3.25, '05/15/2028', '3130ABCD1', 99.5, 0.041, 12, '2Y'],
      [1, 'FFCB', 3, '', '3133BAD01', 100, 0.04, 10, '2Y']
    ])
  }]);
  assert.strictEqual(bannerParsed.offerings.length, 1);
  assert.strictEqual(bannerParsed.offerings[0].cusip, '3130ABCD1');
  assert(Math.abs(bannerParsed.offerings[0].ytm - 4.1) < 1e-9);
  assert(bannerParsed.warnings.some(warning => warning.includes('Bullet row 5: skipped')));

  // YTM column-scale detection. The Bloomberg grid1 export delivers A YTM already
  // in percent (3.327); the parser must NOT blindly *100 it (the old bug → 332.7%).
  // Decided once per column from the sample median: >1 ⇒ already percent (kept).
  const gridPercent = parseAgenciesFiles([{
    filename: 'grid1_percent.xlsx',
    buffer: workbookBuffer([
      ['Tkr', 'Cpn', 'Mty', 'Nxt Call', 'Call Typ', 'A Px', 'A YTM', 'A YTNC', 'CUSIP'],
      ['FHLB', 1, '7/27/2026', '6/27/2026', 'Monthly', 99.683, 3.327, 7.003, '3130ANDM9'],
      ['FFCB', 4.5, '8/15/2028', '8/15/2026', 'Quarterly', 100.1, 4.45, 5.1, '3133EPXY8'],
      ['FNMA', 3.5, '9/15/2029', '9/15/2026', 'Anytime', 99.2, 3.96, 4.8, '3135BAD01']
    ])
  }]);
  assert.strictEqual(gridPercent.offerings.length, 3);
  assert(Math.abs(gridPercent.offerings[0].ytm - 3.327) < 1e-9, `grid ytm kept as percent, got ${gridPercent.offerings[0].ytm}`);
  assert(gridPercent.offerings.every(o => o.ytm > 0.1 && o.ytm < 25), 'grid ytm values land in the sane band');
  assert.strictEqual(gridPercent.warnings.filter(w => /ytm/.test(w) && /outside/.test(w)).length, 0);

  // Decimal column (legacy trader sheet) is still scaled up ×100 (median ≤1).
  const gridDecimal = parseAgenciesFiles([{
    filename: 'grid1_decimal.xlsx',
    buffer: workbookBuffer([
      ['Tkr', 'Cpn', 'Mty', 'Nxt Call', 'Call Typ', 'A Px', 'A YTM', 'A YTNC', 'CUSIP'],
      ['FHLB', 1, '7/27/2026', '6/27/2026', 'Monthly', 99.683, 0.03327, 0.07003, '3130ANDM9'],
      ['FFCB', 4.5, '8/15/2028', '8/15/2026', 'Quarterly', 100.1, 0.0445, 0.051, '3133EPXY8'],
      ['FNMA', 3.5, '9/15/2029', '9/15/2026', 'Anytime', 99.2, 0.0396, 0.048, '3135BAD01']
    ])
  }]);
  assert(Math.abs(gridDecimal.offerings[0].ytm - 3.327) < 1e-9, `decimal ytm scaled up, got ${gridDecimal.offerings[0].ytm}`);
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

  const bannerParsed = parseCorporatesFiles([{
    filename: 'corporates banner.xlsx',
    buffer: workbookBuffer([
      ['Corporate inventory export'],
      ['Moody', 'S&P', 'ASz', 'Issuer', 'Tkr', 'Cpn', 'Mty', 'Security', 'A Px', 'A YTM', 'Sector', 'Amt Out'],
      ['A1', 'A', 2000, 'JOHN DEERE CAPITAL CORP', 'DE', 5.15, '09/08/2026', '24422EXD6', 100.43, 0.03448, 'Industrial', '2MMM'],
      ['A2', 'A', 1000, 'BAD ROW INC', 'BAD', 4.5, '', '123456AB1', 99.1, 0.04, 'Industrial', '500MM']
    ])
  }]);
  assert.strictEqual(bannerParsed.offerings.length, 1);
  assert.strictEqual(bannerParsed.offerings[0].cusip, '24422EXD6');
  assert(Math.abs(bannerParsed.offerings[0].ytm - 3.448) < 1e-9);
  assert(bannerParsed.warnings.some(warning => warning.includes('Row 4: skipped')));
}

function assertTreasuryNotesParser() {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['CUSIP(s)', 'Cpn(s)', 'Maturity(s)', 'Ask Amt', 'NET OFFER COST', 'NET OFFER YTM'],
    ['912828U24', 2, '11/15/2026', 5000, 99.20292663574219, 3.562],
    ['91282CCP4', 0.625, '07/31/2026', 5000, 99.532, 3.507],
    ['91282CJK8', 4.625, '11/15/2026', 5000, 100.53955078125, 3.566]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Worksheet');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const parsed = parseTreasuryNotesWorkbook(buffer, { filename: 'TSY NOTE OFFERS 5.7.26.xlsx' });
  assert.strictEqual(parsed.asOfDate, '2026-05-07');
  assert.strictEqual(parsed.notes.length, 3);
  assert.strictEqual(parsed.sources[0].rowCount, 3);
  assert.strictEqual(parsed.notes[1].coupon, 0.625);
  assert.deepStrictEqual(parsed.notes[0], {
    description: 'Treasury Note 2.000% due 2026-11-15',
    cusip: '912828U24',
    coupon: 2,
    maturity: '2026-11-15',
    settle: null,
    price: 99.202927,
    yield: 3.562,
    spread: null,
    quantity: 5000,
    quantityRaw: '5000',
    benchmark: '',
    type: '',
    rawFields: {
      'CUSIP(s)': '912828U24',
      'Cpn(s)': 2,
      'Maturity(s)': '11/15/2026',
      'Ask Amt': 5000,
      'NET OFFER COST': 99.202927,
      'NET OFFER YTM': 3.562
    }
  });

  const genericNameParsed = parseTreasuryNotesWorkbook(workbookBuffer([
    ['Name', 'Cpn', 'Mty', 'A Px', 'A YTM', 'Settle', 'CUSIP', 'Cpn Freq'],
    ['US TREASURY N/B', 0.625, '7/31/2026', 99.532, 3.507, '06/02/26', '91282CCP4', 2]
  ]), { filename: 'grid1_q0b0wejm.xlsx' });
  assert.strictEqual(genericNameParsed.notes[0].description, 'Treasury Note 0.625% due 2026-07-31');

  const explicitAsOfParsed = parseTreasuryNotesWorkbook(workbookBuffer([
    ['Trade Date', '05/01/2026'],
    ['As Of', '05/07/2026'],
    ['CUSIP(s)', 'Cpn(s)', 'Maturity(s)', 'Ask Amt', 'NET OFFER COST', 'NET OFFER YTM'],
    ['912828U24', 2, '11/15/2026', 5000, 99.20292663574219, 3.562]
  ]), { filename: 'grid1_treasury.xlsx' });
  assert.strictEqual(explicitAsOfParsed.asOfDate, '2026-05-07');
}

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Worksheet');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// The desk's export tool reuses generic "grid1_<hash>.xlsx" names for WIRP, Treasury,
// and Baird Syndicate reports, so the filename can't disambiguate them. These detectors
// drive the folder-drop content fallback (sniffWorkbookSlot) and must be mutually
// exclusive on real-world layouts.
function assertWorkbookContentSniffing() {
  // Treasury notes in the Bloomberg "ask" export layout (what arrives as grid1_*.xlsx
  // after the trader-side format change) — different columns than the NET OFFER sheet,
  // but unmistakably Treasuries by description + 912-prefixed CUSIPs.
  const treasury = workbookBuffer([
    ['Name', 'Cpn', 'Mty', 'A Px', 'A YTM', 'Settle', 'CUSIP', 'Cpn Freq'],
    ['US TREASURY N/B', 4.5, '7/15/2026', 100.121, 3.415, '06/02/26', '91282CHM6', 2],
    ['US TREASURY N/B', 0.625, '7/31/2026', 99.532, 3.507, '06/02/26', '91282CCP4', 2],
    ['US TREASURY N/B', 1.875, '7/31/2026', 99.735, 3.488, '06/02/26', '912828Y95', 2],
    ['US TREASURY N/B', 4.375, '8/15/2026', 100.25, 3.42, '06/02/26', '91282CHX2', 2]
  ]);
  assert.strictEqual(looksLikeTreasuryWorkbook(treasury), true);
  assert.strictEqual(looksLikeBairdSyndicateWorkbook(treasury), false);

  // Baird Syndicate munis — same generic naming, but a Security/St/Issuer muni layout.
  const baird = workbookBuffer([
    ['Security', 'St', 'Issuer', 'Cpn', 'Mty', 'Nxt Call', 'A Sz', 'A YTC', 'A YTM', 'A Px', 'Moody', 'S&P', 'BQ', 'FED\nTAX', 'TOTAL\nCUTS', 'COMM'],
    ['848576WP5', 'IA', 'SPIRIT LAKE IA', '5.000', '6/1/2030', '', '5', '2.930', '2.930', '107.687', '', 'AA-', 'Y', 'N', '-10', '$3.75'],
    ['020213MU5', 'MI', 'ALMA MI PUBLIC SCHS', '4.125', '5/1/2043', '5/1/2036', '80', '4.250', '4.250', '98.500', '', 'AA', 'N', 'N', '-10', '$12.50'],
    ['64966QCH7', 'NY', 'NEW YORK NY', '4.000', '8/1/2034', '', '25', '3.510', '3.510', '103.250', '', 'AA', 'Y', 'N', '-10', '$5.00']
  ]);
  assert.strictEqual(looksLikeBairdSyndicateWorkbook(baird), true);
  assert.strictEqual(looksLikeTreasuryWorkbook(baird), false);

  // Genuine WIRP / Fed Funds futures export — no bond columns at all. Must match
  // neither detector so it stays a reference (preserving the grid1_nnepvdfk behavior).
  const wirp = workbookBuffer([
    ['Pricing Date', '2026-05-12'],
    ['Region: United States', 'Instrument: Fed Funds Futures'],
    ['Target Rate', 3.75],
    ['Meeting', 'Implied Rate', 'Move'],
    ['6/18/2026', 3.62, -0.13],
    ['7/30/2026', 3.48, -0.27]
  ]);
  assert.strictEqual(looksLikeTreasuryWorkbook(wirp), false);
  assert.strictEqual(looksLikeBairdSyndicateWorkbook(wirp), false);

  // Agency callables in the Bloomberg grid layout (Tkr column of GSE issuers,
  // call columns present). Must NOT false-match Treasury: the parser synthesizes
  // a "Treasury Note …" description for every row, so detection has to key on the
  // 912* CUSIP prefix — these are 3130* (FHLB). The agency sniffer routes them.
  const agencyCallables = workbookBuffer([
    ['SIZE IN MM', 'Tkr', 'Cpn', 'Mty', 'Nxt Call', 'Call Typ', 'A Px', 'A YTM', 'A YTNC', 'CUSIP'],
    [1.98, 'FHLB', 1, '7/27/2026', '6/27/2026', 'Monthly', 99.683, 3.327, 7.003, '3130ANDM9'],
    [3.61, 'FHLB', 1, '7/27/2026', '6/27/2026', 'Monthly', 99.683, 3.327, 7.003, '3130ANDN7'],
    [2.0, 'FFCB', 4.5, '8/15/2028', '8/15/2026', 'Quarterly', 100.1, 4.45, 5.1, '3133EPXY8']
  ]);
  assert.strictEqual(looksLikeTreasuryWorkbook(agencyCallables), false);
  assert.strictEqual(sniffAgencyWorkbookSlot(agencyCallables), 'agenciesCallables');

  // Agency bullets grid — same issuer column, no call columns → bullets.
  const agencyBullets = workbookBuffer([
    ['ASz', 'Tkr', 'Cpn', 'Mty', 'A Px', 'A YTM', 'A Spd', 'CUSIP'],
    [5, 'FHLB', 3.25, '5/15/2028', 99.5, 4.1, 12, '3130ABCD1'],
    [2, 'FNMA', 3.0, '6/15/2027', 100.0, 4.0, 10, '3135BAD01'],
    [1, 'FFCB', 4.0, '9/15/2029', 98.7, 4.3, 14, '3133EPXY8']
  ]);
  assert.strictEqual(sniffAgencyWorkbookSlot(agencyBullets), 'agenciesBullets');

  // Muni (Baird) and Treasury sheets have no Tkr column → not agencies.
  assert.strictEqual(sniffAgencyWorkbookSlot(baird), null);
  assert.strictEqual(sniffAgencyWorkbookSlot(treasury), null);
}

function assertPackageReaderUsesSlotMetadata() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-package-meta-'));
  try {
    fs.writeFileSync(path.join(tmp, 'generic spreadsheet.xlsx'), 'not parsed here');
    fs.writeFileSync(path.join(tmp, 'dealer note sheet.xlsx'), 'not parsed here');
    fs.writeFileSync(path.join(tmp, '_meta.json'), JSON.stringify({
      date: '2026-04-28',
      slotFilenames: {
        treasuryNotes: 'dealer note sheet.xlsx',
        corporates: 'generic spreadsheet.xlsx'
      },
      corporatesCount: 12
    }));

    const pkg = readPackageDir(tmp);
    assert.strictEqual(pkg.date, '2026-04-28');
    assert.strictEqual(pkg.treasuryNotes, 'dealer note sheet.xlsx');
    assert.strictEqual(pkg.corporates, 'generic spreadsheet.xlsx');
    assert.strictEqual(pkg.agenciesBullets, null);
    assert.strictEqual(pkg.corporatesCount, 12);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertPackageReaderRecoversStaleMmdMetadata() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-package-mmd-meta-'));
  try {
    fs.writeFileSync(path.join(tmp, 'MMD-1.pdf'), 'not parsed here');
    fs.writeFileSync(path.join(tmp, '20260511.pdf'), 'not parsed here');
    fs.writeFileSync(path.join(tmp, '_meta.json'), JSON.stringify({
      date: '2026-05-11',
      slotFilenames: {
        econ: 'MMD-1.pdf'
      },
      slotFileLists: {
        econ: ['MMD-1.pdf', '20260511.pdf']
      }
    }));

    const pkg = readPackageDir(tmp);
    assert.strictEqual(pkg.mmd, 'MMD-1.pdf');
    assert.notStrictEqual(pkg.econ, 'MMD-1.pdf');
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

async function assertBankWorkbookRequiresAllDataSheet() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bank-workbook-'));
  const workbookPath = path.join(tmp, 'wrong-sheet.xlsx');
  const emptyWorkbookPath = path.join(tmp, 'empty-all-data.xlsx');
  const outputDir = path.join(tmp, 'out');
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Not', 'ALL_DATA'],
      ['Sample', 'Row']
    ]), 'SUMMARY');
    fs.writeFileSync(workbookPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    assert.throws(
      () => parseBankWorkbook(workbookPath),
      /Could not locate ALL_DATA worksheet in workbook/
    );

    const emptyWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(emptyWorkbook, XLSX.utils.aoa_to_sheet([
      ['ALL_DATA'],
      ['No usable bank rows']
    ]), 'ALL_DATA');
    fs.writeFileSync(emptyWorkbookPath, XLSX.write(emptyWorkbook, { type: 'buffer', bookType: 'xlsx' }));
    await assert.rejects(
      () => importBankWorkbook(emptyWorkbookPath, outputDir),
      /No bank rows parsed/
    );
    assert.strictEqual(fs.existsSync(path.join(outputDir, 'bank-data.sqlite')), false);
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

    const servicesWorkbookPath = path.join(tmp, 'Services.xlsx');
    const servicesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(servicesWorkbook, XLSX.utils.aoa_to_sheet([
      ['', 'Services'],
      ['', 'Generated By', 'FBBS'],
      ['', 'Show', 'All accounts'],
      ['', 'Filter', 'Current'],
      [],
      [
        '',
        'Cert Number',
        '',
        'Primary Regulator',
        'Status',
        'Account Name',
        'City 1',
        'State/Province 1',
        'Account Team Members',
        'Affiliate',
        'Affiliate Status',
        'Affiliate Rep',
        'ALM',
        'BCIS',
        'Brokered CDs',
        'CECL',
        'Bond Accounting',
        'FBBS Service Count',
        'ACH Origination',
        'Audit',
        'Bank Stock Loan',
        'Cash Management',
        'Online Banking',
        'DDA',
        'FedNow',
        'Fed Settlement',
        'International Services',
        'Image Cash Letter',
        'Participation Loans Sold',
        'RTP',
        'Safekeeping',
        'Stockholder',
        'Wire Transfer',
        "Bankers' Bank Service Count"
      ],
      [
        '',
        '98765',
        '',
        'FDIC',
        'Client',
        'Prospect Bank',
        'Nashville',
        'IL',
        'Jane Owner; John Officer',
        'MIB',
        'Client',
        'Ron Rep',
        'TRUE',
        'FALSE',
        'TRUE',
        'FALSE',
        'FALSE',
        '2',
        'TRUE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'FALSE',
        'TRUE',
        '2'
      ]
    ]), 'Services');
    XLSX.writeFile(servicesWorkbook, servicesWorkbookPath);

    const servicesResult = importBankAccountStatusWorkbook(tmp, servicesWorkbookPath, summaries, {
      sourceFile: 'Services.xlsx'
    });
    assert.strictEqual(servicesResult.importedCount, 1);
    assert.strictEqual(servicesResult.ownerCount, 1);
    assert.strictEqual(servicesResult.servicesCount, 1);
    assert.strictEqual(servicesResult.affiliateCount, 1);
    assert.strictEqual(servicesResult.bankersBankServicesCount, 1);
    const enrichedStatus = getBankAccountStatus(tmp, 'prospect-bank');
    assert.strictEqual(enrichedStatus.status, 'Client');
    assert.strictEqual(enrichedStatus.owner, 'Jane Owner; John Officer');
    assert.strictEqual(enrichedStatus.services, 'ALM, Brokered CDs');
    assert.strictEqual(enrichedStatus.affiliate, 'MIB');
    assert.strictEqual(enrichedStatus.affiliateStatus, 'Client');
    assert.strictEqual(enrichedStatus.affiliateRep, 'Ron Rep');
    assert.strictEqual(enrichedStatus.bankersBankServices, 'ACH Origination, Wire Transfer');
    const accountCoverageRows = listBankAccountStatuses(tmp, { q: 'Jane Owner', sort: 'owner', service: 'bankersBank' });
    assert.strictEqual(accountCoverageRows.length, 1);
    assert.strictEqual(accountCoverageRows[0].bankId, 'prospect-bank');
    assert.strictEqual(accountCoverageRows[0].status, 'Client');
    const badLimitRows = listBankAccountStatuses(tmp, { limit: 'not-a-number' });
    assert.ok(badLimitRows.length >= 1);

    const manual = upsertBankAccountStatus(tmp, summaries[2], { status: 'Not Real', owner: 'Manual Owner' });
    assert.strictEqual(manual.status, 'Client');
    assert.strictEqual(manual.owner, 'Manual Owner');
    const open = upsertBankAccountStatus(tmp, summaries[2], { status: 'Open' });
    assert.strictEqual(open.status, 'Open');
    assert.strictEqual(open.owner, 'Manual Owner');
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

    const deleted = deleteStrategyRequest(tmp, request.id);
    assert.strictEqual(deleted.id, request.id);
    assert.strictEqual(listStrategyRequests(tmp, { archived: 'all' }).requests.length, 0);
    assert.strictEqual(fs.existsSync(path.dirname(savedFile.path)), false);
    assert.strictEqual(deleteStrategyRequest(tmp, request.id), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertAveragedSeriesStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-avg-series-'));
  const workbookPath = path.join(tmp, 'Averaged Series.xlsx');
  const workbook = XLSX.utils.book_new();
  const rows = [
    [null, null, null, 'Banks with below 1.5B in Total Assets'],
    ['Total Asset Range', null, null, 'Total Asset Range', 'below 1.5B'],
    ['Ag Prod and Farmland Loans/Total Loans', null, null, 'Ag Prod and Farmland Loans / Total Loans', 'ALL BANKS'],
    ['Memo: Subchapter S Election? Yes/No', null, null, 'Memo: Subchapter S Election? Yes/No', 'S-Corp'],
    ['State', null, null, 'State / Region', 'MO'],
    [null, null, null, 'Population Count / Percentage of Population', 12, '/ 10%'],
    ['AVERAGE DATA'],
    ['S-Corp Count'],
    ['C-Corp Count'],
    ['SNL Institution Key'],
    [null, null, null, null, '2026Q1', '2025Q4'],
    [null, null, null, null, '03/31/2026', '12/31/2025'],
    ['Year'],
    [null, null, null, 'BALANCE SHEET'],
    ['Total Assets ($000)', null, null, '1. Total Assets ($000)', 500000, 490000, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'P'],
    ['Total Securities (AFS-FV) ($000)', null, null, '2. Total Securities (AFS-FV) ($000)', '75,267 / 86%', '75,778 / 85%', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'AL'],
    [null, null, null, 'PROFITABILITY'],
    ['Yield on Securities (Full Tax Equiv) (%)', null, null, '43. Yield on Securities (Full Tax Equiv) (%)', 3.18, 3.14, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'BO']
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'AVERAGED_SERIES');
  XLSX.writeFile(workbook, workbookPath);

  try {
    const metadata = saveAveragedSeriesWorkbook(tmp, workbookPath, { sourceFile: 'Averaged Series.xlsx' });
    assert.strictEqual(metadata.latestPeriod, '2026Q1');
    assert.strictEqual(metadata.metricCount, 3);
    assert.strictEqual(metadata.seriesRowCount, 6);

    const status = getAveragedSeriesStatus(tmp);
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.dataset.seriesRowCount, 6);

    const dataset = loadAveragedSeriesDataset(tmp);
    assert.strictEqual(dataset.peerGroups[0].criteria.subchapterS, 'S-Corp');
    assert.strictEqual(dataset.metrics.find(row => row.label === 'Total Assets ($000)').section, 'BALANCE SHEET');
    const securitiesMetric = dataset.metrics.find(row => row.label === 'Total Securities (AFS-FV) ($000)');
    const securitiesQ1 = dataset.series.find(row => row.metricKey === securitiesMetric.key && row.period === '2026Q1');
    assert.strictEqual(securitiesQ1.amount, 75267);
    assert.strictEqual(securitiesQ1.percent, 86);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertBondAccountingStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bond-accounting-'));
  const bankListPath = path.join(tmp, 'BankList.xlsx');
  const portfolioDir = path.join(tmp, 'portfolios');
  fs.mkdirSync(portfolioDir, { recursive: true });
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['Bank List Export'],
    [],
    ['As Of', '04/30/2026'],
    [],
    ['ClientID', 'Client', 'ABANumber', 'Account', 'Code', 'RSSDID', 'FDIC Certificate Number', 'State', 'City', 'Accounting Client', 'Status'],
    ['1', 'Sample Bank', '071000000', '13239', 'P1455', '123456', '12345', 'IL', 'Springfield', 'Yes', 'Active'],
    ['2', 'No SNL Match Bank', '081000000', '182000060', '53', '999999', '34597', 'MO', 'Clayton', 'Yes', 'Active']
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'bank list');
  XLSX.writeFile(workbook, bankListPath);

  const matchedName = '13239(Account)_Sample Bank_20260430_P1455.xlsm';
  const pOnlyName = '182000060(Account)_No SNL Match Bank_20260430_P53.xlsm';
  const unknownName = '000(Account)_Unknown Bank_20260430_P9999.xlsm';
  fs.writeFileSync(path.join(portfolioDir, matchedName), 'sample');
  fs.writeFileSync(path.join(portfolioDir, pOnlyName), 'sample');
  fs.writeFileSync(path.join(portfolioDir, unknownName), 'sample');

  try {
    assert.deepStrictEqual(parsePortfolioFilename(matchedName), {
      filename: matchedName,
      account: '13239',
      clientName: 'Sample Bank',
      reportDate: '2026-04-30',
      pCode: 'P1455',
      extension: 'xlsm'
    });

    const bankList = parseBankListWorkbook(bankListPath);
    assert.strictEqual(bankList.rowCount, 2);
    assert.strictEqual(bankList.pCodeCount, 2);
    assert.strictEqual(bankList.byPCode.get('P53').certNumber, '34597');

    const manifest = importBondAccountingFolder(tmp, bankListPath, portfolioDir, {
      bankSummaries: [{
        id: 'bank-1',
        displayName: 'Sample Bank, Springfield, IL',
        certNumber: '12345'
      }]
    });
    assert.strictEqual(manifest.portfolioFileCount, 3);
    assert.strictEqual(manifest.matchedCount, 1);
    assert.strictEqual(manifest.pCodeMatchedCount, 1);
    assert.strictEqual(manifest.unmatchedCount, 2);
    assert.strictEqual(manifest.matches.find(row => row.pCode === 'P1455').status, 'matched');
    assert.strictEqual(manifest.matches.find(row => row.pCode === 'P53').status, 'needs-bank-data-match');
    assert.strictEqual(manifest.matches.find(row => row.pCode === 'P9999').status, 'unmatched-pcode');
    assert(fs.existsSync(path.join(tmp, 'bond-accounting', manifest.matches.find(row => row.pCode === 'P1455').storedPath)));

    const status = getBondAccountingStatus(tmp);
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.portfolioFileCount, 3);
    assert.strictEqual(status.matchedCount, 1);

    const storedManifest = loadBondAccountingManifest(tmp);
    assert.strictEqual(storedManifest.matches.length, 3);

    const bankPortfolios = getBondAccountingForBank(tmp, 'bank-1');
    assert.strictEqual(bankPortfolios.available, true);
    assert.strictEqual(bankPortfolios.portfolioFileCount, 1);
    assert.strictEqual(bankPortfolios.latestReportDate, '2026-04-30');
    const storedPath = storedManifest.matches.find(row => row.pCode === 'P1455').storedPath;
    const resolvedStoredPath = resolveBondAccountingStoredFile(tmp, storedPath);
    assert(resolvedStoredPath);
    assert(fs.existsSync(resolvedStoredPath));
    assert.strictEqual(resolveBondAccountingStoredFile(tmp, '../bank-data.sqlite'), null);

    const monthlyDir = path.join(tmp, 'monthly-portfolios');
    fs.mkdirSync(monthlyDir, { recursive: true });
    const monthlyName = '13239(Account)_Sample Bank_20260531_P1455.xlsm';
    fs.writeFileSync(path.join(monthlyDir, monthlyName), 'sample');
    const monthlyManifest = importBondAccountingFolder(tmp, '', monthlyDir, {
      bankSummaries: [{
        id: 'bank-1',
        displayName: 'Sample Bank, Springfield, IL',
        certNumber: '12345'
      }]
    });
    assert.strictEqual(monthlyManifest.bankListMode, 'saved');
    assert.strictEqual(monthlyManifest.bankListSourceFile, 'BankList.xlsx');
    assert.strictEqual(monthlyManifest.portfolioFileCount, 1);
    assert.strictEqual(monthlyManifest.matchedCount, 1);
    assert.strictEqual(monthlyManifest.matches[0].reportDate, '2026-05-31');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertPortfolioParser() {
  const { holdingsCachePath, loadParsedPortfolio, parsePortfolioWorkbook } = require('../server/portfolio-parser');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-portfolio-parser-'));
  const filePath = path.join(tmp, 'sample.xlsm');
  try {
    const wb = XLSX.utils.book_new();

    // Mimic THC template: Overview!C3 holds the as-of date.
    const overviewRows = [];
    overviewRows[0] = [];
    overviewRows[1] = [];
    overviewRows[2] = ['', '', 'as of 04/30/2026'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewRows), 'Overview');

    // linked data totals: label in col B, current value in col E.
    const linkedRows = [
      ['', '', '', '', 'Current'],
      ['', 'Total Par Value(000)', '', '', 1000],
      ['', 'Total Market Value w/o Accrued(000)', '', '', 920],
      ['', 'Total Book Value(000)', '', '', 990],
      ['', 'Market YTW%', '', '', 4.50],
      ['', 'Book YTW%', '', '', 2.10]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linkedRows), 'linked data');

    // Agency sheet: header padding above row 47, header at row 47, holdings below.
    const agencyRows = [];
    for (let i = 0; i < 46; i += 1) agencyRows.push([]);
    agencyRows[46] = ['', 'Cusip', 'Description', 'Par (000)', 'Cpn\n(%)', 'Cpn\nType', 'Maturity', 'Next Call', 'Bk Val (000)', 'Mkt Val (000)', 'G/L\n(000)', 'Bk Px', 'Mkt Px', 'Bk YTW\n(%)', 'Bk YTM\n(%)', 'Mkt YTW\n(%)', 'OAS\n(BP)', 'Eff. Dur', 'Eff. Conv', 'AFS/\nHTM'];
    agencyRows[47] = ['', '3130AKYZ3', 'FHLB CALLABLE QUARTERLY', 500, 1.0, 'Fixed', 47354, 46166, 499.5, 452.3, -47.2, 99.9, 90.5, 1.03, 1.03, 4.10, 25, 3.2, 0.12, 'AFS'];
    agencyRows[48] = ['', '3130AL7A6', 'FHLB STEP UP', 500, 2.0, 'Step', 47904, '', 500.0, 454.5, -45.5, 100, 90.9, 2.00, 2.00, 4.10, 17, 4.5, 0.23, 'AFS'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agencyRows), 'Agency');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Scenario Summary'],
      ['', 'evaldate'],
      ['', '', '', 'BK VAL(000)', 'MKT VAL(000)', 'G/L', 'G/L(%)', 'BK PX', 'MKT PX', 'PX % CHG', 'YTW(%)', 'BK YTW(%)'],
      ['', '', '-300', '990', '1,040', '50,000', '5.05', '99.0', '104.0', '4.00', '3.10', '2.10'],
      ['', '', 'Base', '990', '920', '-70,000', '-7.07', '99.0', '92.0', '0.00', '4.50', '2.10'],
      ['', '', '+300', '990', '840', '-150,000', '-15.15', '99.0', '84.0', '-8.70', '6.20', '2.10']
    ]), 'Scenario Summary');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Total Return Analysis'],
      ['', 'evaldate'],
      ['', '', '', '2 Years Forward'],
      ['', '', '', 'Sector', -300, -100, 0, 100, 300],
      ['', '', '', 'Investments', 6.4, 5.1, 3.5, 1.8, -1.7],
      ['', '', '', 'Agency', 5.0, 4.4, 4.0, 3.6, 2.8]
    ]), 'Total Return Analysis');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Portfolio Peer Review'],
      ['', 'evaldate'],
      ['', 'Sector', '', 'Par\n(000)', 'Sector Allocation (%)', '', '', 'WAC (%)', '', '', 'WAM'],
      ['', '', '', '', 'Port', 'Peer', 'Diff', 'Port', 'Peer', 'Diff', 'Port', 'Peer'],
      ['', 'Agency', '', 1000, 55.5, 42.5, '', 2.25, 3.10, '', 4.5, 3.1],
      ['', 'Total', '', 1000, 100, 100, '', 2.25, 3.10, '', 4.5, 3.1],
      ['', 'Peer: 12 banks in the same working group.']
    ]), 'Peer Review');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Key Rate Duration'],
      ['', 'evaldate'],
      ['', 'CUSIP', 'Description', 'Par(000)', 'Bk Val\n(000)', 'Mkt Val\n(000)', 'G/L\n(000)', 'KRD\n0.25', 'KRD1', 'KRD3', 'Eff. Dur'],
      ['', 'Investments', '', '1,000', '990', '920', '-70', '0.05', '0.20', '0.60', '3.20'],
      ['', 'Agency', '', '1,000', '990', '920', '-70', '0.05', '0.20', '0.60', '3.20'],
      ['', '3130AKYZ3', 'FHLB CALLABLE QUARTERLY', '500', '499', '452', '-47', '0.01', '0.10', '0.20', '3.20']
    ]), 'Key Rate Duration');

    XLSX.writeFile(wb, filePath);

    const parsed = parsePortfolioWorkbook(filePath);
    assert.strictEqual(parsed.asOfDate, '2026-04-30');
    assert.strictEqual(parsed.sectorCounts.Agency, 2);
    assert.strictEqual(parsed.aggregates.totalPositions, 2);
    assert.strictEqual(parsed.aggregates.par, 1000000);
    assert.strictEqual(parsed.totals.par, 1000000);
    assert.strictEqual(parsed.totals.marketValue, 920000);
    const first = parsed.sectors.Agency[0];
    assert.strictEqual(first.cusip, '3130AKYZ3');
    assert.strictEqual(first.par, 500000);
    assert.strictEqual(first.gainLoss, -47200);
    assert.strictEqual(first.maturity, '2029-08-24');
    assert(Math.abs(first.yieldGap - 3.07) < 0.01, 'yieldGap should be ~3.07, got ' + first.yieldGap);
    assert.strictEqual(parsed.cusipIndex['3130AKYZ3'].sector, 'Agency');
    assert.strictEqual(parsed.analytics.scenarioSummary.length, 3);
    assert.strictEqual(parsed.analytics.scenarioSummary[1].shock, 0);
    assert.strictEqual(parsed.analytics.scenarioSummary[1].marketValue, 920000);
    assert.strictEqual(parsed.analytics.totalReturn[0].returns['300'], -1.7);
    assert.strictEqual(parsed.analytics.peerReview[0].peerAllocationPct, 42.5);
    assert.strictEqual(parsed.analytics.keyRateDuration[0].label, 'Investments');
    assert.strictEqual(parsed.analytics.keyRateDuration[0].values['Eff. Dur'], 3.2);

    const cachePath = holdingsCachePath(filePath);
    const stale = { ...parsed };
    delete stale.schemaVersion;
    delete stale.analytics;
    fs.writeFileSync(cachePath, JSON.stringify(stale));
    const future = new Date(Date.now() + 60000);
    fs.utimesSync(cachePath, future, future);
    const rebuilt = loadParsedPortfolio(filePath);
    assert.strictEqual(rebuilt.schemaVersion, parsed.schemaVersion);
    assert.strictEqual(rebuilt.analytics.scenarioSummary.length, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertSwapHoldingDurationMapping() {
  const mapped = mapSwapHoldingPosition({
    cusip: '3130AKYZ3',
    description: 'FHLB CALLABLE QUARTERLY',
    maturity: '2029-08-24',
    effectiveDuration: 3.2,
    averageLife: 4.1,
    bookYieldYtw: 1.03,
    marketYieldYtw: 4.1
  }, 'Agency');

  assert.strictEqual(mapped.sector, 'Agency');
  assert.strictEqual(mapped.modifiedDuration, 3.2);
  assert.strictEqual(mapped.averageLife, 4.1);

  const zeroDuration = mapSwapHoldingPosition({
    cusip: '912828ZERO',
    effectiveDuration: 0
  }, 'Treasury');
  assert.strictEqual(zeroDuration.modifiedDuration, 0);

  const outOfRange = mapSwapHoldingPosition({
    cusip: '3133KRUX0',
    effectiveDuration: -6.09,
    averageLife: 0.21,
    marketYieldYtw: -10.315,
    marketYieldYtm: 4.2,
    bookYieldYtw: 3.9
  }, 'MBS');
  assert.strictEqual(outOfRange.modifiedDuration, null);
  assert.strictEqual(outOfRange.marketYieldYtw, null);
  assert.strictEqual(outOfRange.averageLife, 0.21);
  assert.strictEqual(outOfRange.marketYieldYtm, 4.2);
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

function assertCdHistoryResetsOnNewWeek() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-cd-week-reset-'));
  try {
    saveCdHistorySnapshot(tmp, {
      asOfDate: '2026-04-24',
      sourceFile: 'friday-prior-week.pdf',
      offerings: [
        { term: '3m', termMonths: 3, name: 'FRIDAY BANK', rate: 3.6, cusip: '111111111', maturity: '2026-07-24' },
        { term: '6m', termMonths: 6, name: 'FRIDAY TRUST', rate: 3.8, cusip: '222222222', maturity: '2026-10-24' }
      ]
    }, { uploadedAt: '2026-04-24T12:00:00.000Z', uploadDate: '2026-04-24' });
    saveCdHistorySnapshot(tmp, {
      asOfDate: '2026-04-27',
      sourceFile: 'monday-new-week.pdf',
      offerings: [
        { term: '3m', termMonths: 3, name: 'MONDAY BANK', rate: 3.9, cusip: '333333333', maturity: '2026-07-27' },
        { term: '12m', termMonths: 12, name: 'MONDAY TRUST', rate: 4.05, cusip: '444444444', maturity: '2027-04-27' }
      ]
    }, { uploadedAt: '2026-04-27T12:00:00.000Z', uploadDate: '2026-04-27' });

    const recap = summarizeWeeklyCdHistory(tmp, { anchorDate: '2026-04-27' });
    assert.strictEqual(recap.weekStart, '2026-04-27');
    assert.strictEqual(recap.weekEnd, '2026-05-01');
    assert.deepStrictEqual(recap.snapshotDates, ['2026-04-27']);
    assert.strictEqual(recap.rawRows, 2);
    assert.strictEqual(recap.uniqueCusips, 2);
    assert.strictEqual(recap.terms.find(t => t.term === '3m').uniqueCusips, 1);
    assert.strictEqual(recap.terms.find(t => t.term === '3m').medianRate, 3.9);
    assert.strictEqual(recap.terms.find(t => t.term === '6m').uniqueCusips, 0);
    assert.strictEqual(recap.availableSnapshots.length, 2);
    assert.strictEqual(recap.rateComparisons.periods.find(p => p.key === 'previousWeek').snapshotDate, '2026-04-24');
    assert.strictEqual(recap.rateComparisons.terms.find(t => t.term === '3m').rates.previousWeek, 3.6);
    const twelveMonth = recap.rateComparisons.terms.find(t => t.term === '12m');
    assert.strictEqual(twelveMonth.rates.today, 4.05);
    assert.strictEqual(twelveMonth.rates.previousWeek, 4.05);
    assert.strictEqual(twelveMonth.deltas.previousWeek, 0);
    assert.strictEqual(twelveMonth.rateFallbacks.previousWeek, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

function assertMmdParser() {
  const text = `
YEARAAAP/RINS'DAAABAA
120272.502.552.592.552.572.92
220282.452.522.572.502.552.88
1020362.963.173.093.273.73
3020564.314.584.534.675.15
YEARJANFEBMARAPRILMAYJUNEJULYAUGSEPTOCTNOVDEC
FRIDAY  5/8/2026
(5% Coupon):
2027-2056: Unchanged
US TSY 2yr 3.891% 63%
US TSY 10yr 4.362% 68%
`;
  const parsed = parseMmdCurveText(text);
  assert.strictEqual(parsed.asOfDate, '2026-05-08');
  assert.strictEqual(parsed.coupon, 5);
  assert.strictEqual(parsed.curve.length, 4);
  assert.deepStrictEqual(parsed.curve[0], {
    term: 1,
    label: '1Y',
    maturityYear: 2027,
    aaa: 2.5,
    values: [2.5, 2.55, 2.59, 2.55, 2.57, 2.92],
    preRefunded: 2.55,
    insured: 2.59,
    aa: 2.55,
    a: 2.57,
    baa: 2.92
  });
  assert.strictEqual(parsed.curve.find(row => row.term === 30).aaa, 4.31);
  assert.deepStrictEqual(parsed.treasuryRatios[1], { term: 10, treasuryYield: 4.362, ratioPct: 68 });
  assert.deepStrictEqual(parsed.notes, ['2027-2056: Unchanged']);
  assert.deepStrictEqual(parsed.warnings, []);

  const spacedText = `
YEAR AAA P/R INS'D AA A BAA
1 2027 2.50 2.55 2.59 2.55 2.57 2.92
9 2035 2.87 3.05 2.99 3.16 3.61
30 2056 4.31 4.58 4.53 4.67 5.15
YEAR JAN FEB MAR APRIL MAY JUNE JULY AUG SEPT OCT NOV DEC
1 2027 2.50 2.50 2.50 2.50 2.50 2.50 2.50 2.50 2.50 2.49 2.49 2.49
FRIDAY  5/8/2026
`;
  const spaced = parseMmdCurveText(spacedText);
  assert.strictEqual(spaced.curve.length, 3);
  assert.strictEqual(spaced.curve[1].term, 9);
  assert.strictEqual(spaced.curve[1].aaa, 2.87);
}

function assertReferenceIntakeParsers() {
  const { emailCalendarDate, parseStructuredNotesEmail, saveStructuredNotesUpload } = require('../server/structured-notes-store');
  const { parseCdInternalWorkbook } = require('../server/cd-internal-store');

  const plain = [
    'Issuer: JPM Chase & Co.        Goldman Sachs Group, Inc.',
    'Ratings: A1/A        A2/BBB+',
    'Term: 10Y/2Y        15Y/3Y',
    'Settlement: 05/15/2026        05/26/2026',
    'Maturity: 05/15/2036        05/26/2041',
    'Coupon:',
    '5.25%',
    '6.00% Compounded',
    'First Pay: 05/15/2027, Annual        Zero Coupon',
    'First Call: 05/15/2028, Semi        05/26/2029, Annual',
    'Pricing Date: 05/13, P1 4PM        05/21, P1 4PM',
    'CUSIP: 48130KVE4        38151V2Q0',
    'Price: 99.50        $41.10 (~98.50% of issue price)'
  ].join('\r\n');
  const encoded = Buffer.from(plain, 'utf8').toString('base64');
  const email = [
    'Subject: *FBBS STRUCTURED NOTES* TEST',
    'From: Test <test@example.com>',
    'Date: Tue, 12 May 2026 12:00:00 +0000',
    'Content-Type: multipart/mixed; boundary="x"',
    '',
    '--x',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
    '--x--'
  ].join('\r\n');
  const notes = parseStructuredNotesEmail(email, { id: 'source1', filename: 'note.eml', extension: 'eml', uploadedAt: '2026-05-12T12:00:00Z' });
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].cusip, '48130KVE4');
  assert.strictEqual(notes[1].price, 41.1);
  assert.strictEqual(notes[1].structure, 'Zero Coupon');
  assert.strictEqual(emailCalendarDate('Tue, 26 May 2026 12:52:12 +0000'), '2026-05-26');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-notes-'));
  const oldEmail = email.replace('Tue, 12 May 2026 12:00:00 +0000', 'Mon, 25 May 2026 12:00:00 +0000');
  const daily = saveStructuredNotesUpload(tmp, [
    { filename: 'old.eml', data: Buffer.from(oldEmail) },
    { filename: 'today.eml', data: Buffer.from(email.replace('Tue, 12 May 2026 12:00:00 +0000', 'Tue, 26 May 2026 12:00:00 +0000')) }
  ], { targetDate: '2026-05-26', replace: true });
  assert.strictEqual(daily.targetDate, '2026-05-26');
  assert.strictEqual(daily.sources.length, 1);
  assert.strictEqual(daily.notes.length, 2);
  assert.strictEqual(daily.sources[0].filename, 'today.eml');
  assert.strictEqual(daily.notes[0].emailSentDate, '2026-05-26');

  const wb = XLSX.utils.book_new();
  const rows = [
    ['TERM', 'MATURITY', 'UNDERWRITER', 'NAME', 'DESCRIPTION', 'RATE', 'CUSIP', 'SETTLE', 'FDIC NUMBER', 'DOMICILED', 'RESTRICTIONS'],
    ['3m', '08/15/2026', 'TEST UW', 'A BANK', 'A BANK CD', 4.1, '123456789', '05/15/2026', '1001', 'MO', 'TX, CA']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseCdInternalWorkbook(buffer, { id: 'cd1', filename: 'MASTER.xls', uploadedAt: '2026-05-12T12:00:00Z' });
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].fdicNumber, '1001');
  assert.deepStrictEqual(parsed[0].restrictions, ['TX', 'CA']);
}

// Regression for the 13-CUSIP / 12-issuer misalignment: the whitespace-padded
// text/plain grid merges two adjacent issuers ("National Bank of Canada" +
// "Bank of Montreal" separated by a single space), so the trailing CUSIP
// (05552WS92) loses its issuer. The parser must read the HTML <table> instead,
// where every field is one <td> per note and columns align 1:1 with CUSIPs.
function assertStructuredNotesColumnAlignment() {
  const { parseStructuredNotesEmail } = require('../server/structured-notes-store');

  // 13 notes. Issuer #6 ("Bank of Montreal") follows issuer #5 with only a
  // single space in the text/plain grid, so text/plain yields 12 issuer tokens.
  const issuers = [
    'Aardvark Bank', 'Beaver Bank', 'Cobra Capital, Inc.', 'Dingo Securities, B.V.',
    'National Bank of Canada', 'Bank of Montreal', 'Eagle Bank AG', 'Falcon Group, Inc.',
    'Gecko Bank', 'Heron Financial', 'Ibis Bank', 'Jaguar Securities, B.V.',
    'BBVA Global Securities, B.V.'
  ];
  const ratings = ['A1/A', 'A2/A-', 'Aa2/A+', 'A2/A-', 'Aa2/A+', 'A2/A-', 'A1/A', 'A2/BBB+', 'A1/A', 'A3/A+', 's:', 'A2/A-', 'A3/A+'];
  const cusips = [
    '11111AA10', '22222BB20', '33333CC30', '44444DD40', '55555EE50', '66666FF60', '77777GG70',
    '88888HH80', '99999II90', '12121JJ10', '34343KK20', '56565LL30', '05552WS92'
  ];
  const coupons = ['4.15%', '4.75%', '5.00%', '5.10%', '4.95%', '5.00%', '5.25%', '5.30%', '5.40%', '5.50%', '5.55%', '6.25%', '6.50%'];

  // text/plain grid: pad columns with 3 spaces, EXCEPT a single space between
  // issuer #5 and #6 so the column collapses and the row under-counts.
  const issuerCells = issuers.map((name, i) => (i === 5 ? ' ' : '   ') + name);
  const plainLines = [
    'Issuer:' + issuerCells.join(''),
    'Ratings:   ' + ratings.join('   '),
    'Coupons:   ' + coupons.join('   '),
    'CUSIP:   ' + cusips.join('   ')
  ].join('\r\n');

  // HTML table: one <tr> per field, cell[0] is the label, the rest one per note.
  const htmlRow = (label, vals) => '<tr><td>' + label + '</td>' + vals.map(v => '<td><span>' + v + '</span></td>').join('') + '</tr>';
  const html = '<table>' +
    htmlRow('Issuer:', issuers) +
    htmlRow('Ratings:', ratings) +
    htmlRow('Coupons:', coupons) +
    htmlRow('CUSIP:', cusips) +
    '</table>';

  const buildEmail = (includeHtml) => [
    'Subject: *FBBS NEW ISSUE NOTES*',
    'From: Desk <desk@example.com>',
    'Date: Wed, 03 Jun 2026 12:00:00 +0000',
    'Content-Type: multipart/alternative; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(plainLines, 'utf8').toString('base64'),
    ...(includeHtml ? [
      '--b',
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html, 'utf8').toString('base64')
    ] : []),
    '--b--'
  ].join('\r\n');

  // Text/plain alone reproduces the bug: 13 CUSIPs but the last issuer is lost
  // and the merge shifts every issuer from #6 onward.
  const broken = parseStructuredNotesEmail(buildEmail(false), { id: 'plain', filename: 'plain.eml', extension: 'eml', uploadedAt: '2026-06-03T12:00:00Z' });
  assert.strictEqual(broken.length, 13, 'text/plain still yields 13 notes');
  assert.strictEqual(broken[12].cusip, '05552WS92');
  assert.strictEqual(broken[12].issuer, '', 'text/plain misalignment leaves the 13th issuer blank');

  // With the HTML table present, every CUSIP gets its correct issuer.
  const notes = parseStructuredNotesEmail(buildEmail(true), { id: 'html', filename: 'html.eml', extension: 'eml', uploadedAt: '2026-06-03T12:00:00Z' });
  assert.strictEqual(notes.length, 13);
  assert.deepStrictEqual(notes.map(n => n.cusip), cusips);
  assert.deepStrictEqual(notes.map(n => n.issuer), issuers, 'every note aligns 1:1 with its issuer');
  assert.strictEqual(notes[12].issuer, 'BBVA Global Securities, B.V.');
  assert.strictEqual(notes[5].issuer, 'Bank of Montreal', 'the merged pair is recovered');

  // cleanRating is not regressed: the stray "s:" label fragment (note #11) blanks
  // out, while real agency grades pass through untouched.
  assert.strictEqual(notes[10].rating, '', 'label-fragment rating is dropped');
  assert.strictEqual(notes[0].rating, 'A1/A');
  assert.strictEqual(notes[12].rating, 'A3/A+');
}

(async function run() {
  assertDateSniffing();
  assertClassification();
  assertUploadSlotFieldNames();
  assertSecurityHelpers();
  await assertCdParser();
  assertCdWorkbookParser();
  await assertBrokeredCdParser();
  await assertMuniParser();
  assertBairdSyndicateParser();
  await assertEconomicUpdateParser();
  assertMmdParser();
  assertReferenceIntakeParsers();
  assertStructuredNotesColumnAlignment();
  assertTreasuryNotesParser();
  assertWorkbookContentSniffing();
  assertAgenciesParser();
  assertCorporatesParser();
  assertPackageReaderUsesSlotMetadata();
  assertPackageReaderRecoversStaleMmdMetadata();
  assertAgencyCollectionPreservesCounterpart();
  assertBankDatabaseRoundTrip();
  await assertBankWorkbookRequiresAllDataSheet();
  assertBankCoverageStore();
  assertBankAccountStatusStore();
  assertStrategyStore();
  assertAveragedSeriesStore();
  assertBondAccountingStore();
  assertPortfolioParser();
  assertSwapHoldingDurationMapping();
  assertCdHistoryWeeklyDedupe();
  assertCdHistoryResetsOnNewWeek();
  assertWeeklyCdWorksheetImport();
  console.log('Parser regression tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
