'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const { parseCdOffersText } = require('../server/cd-offers-parser');
const { parseMuniOffersText } = require('../server/muni-offers-parser');
const { parseAgenciesFiles } = require('../server/agencies-parser');
const { parseCorporatesFiles } = require('../server/corporates-parser');
const { sniffDateFromFilename, classifyFile } = require('../server/server');
const { saveCdHistorySnapshot, summarizeWeeklyCdHistory } = require('../server/cd-history');

const ROOT = path.join(__dirname, '..');
const CURRENT_DIR = path.join(ROOT, 'data', 'current');

function currentFile(name) {
  return path.join(CURRENT_DIR, name);
}

async function pdfText(filename) {
  const parser = new PDFParse({ data: fs.readFileSync(currentFile(filename)) });
  const result = await parser.getText();
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
    restrictions: ['TX'],
    couponFrequency: 'at maturity'
  });
}

async function assertMuniParser() {
  const parsed = parseMuniOffersText(await pdfText('20260424_FBBS_Offerings.pdf'));
  assert.strictEqual(parsed.asOfDate, '2026-04-24');
  assert.strictEqual(parsed.offerings.length, 26);
  assert.strictEqual(parsed.offerings[0].section, 'BQ');
  assert.strictEqual(parsed.offerings[0].cusip, '824105BB5');
  assert.strictEqual(parsed.offerings[0].creditEnhancement, 'BAM');
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

function assertCdHistoryWeeklyDedupe() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fbbs-cd-history-'));
  const baseOfferings = [
    { term: '3m', termMonths: 3, name: 'A BANK', rate: 3.75, cusip: '111111111', maturity: '2026-07-01' },
    { term: '3m', termMonths: 3, name: 'B BANK', rate: 3.85, cusip: '222222222', maturity: '2026-07-02' },
    { term: '6m', termMonths: 6, name: 'C BANK', rate: 3.90, cusip: '333333333', maturity: '2026-10-01' }
  ];
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
  fs.rmSync(tmp, { recursive: true, force: true });
}

(async function run() {
  assertDateSniffing();
  assertClassification();
  await assertCdParser();
  await assertMuniParser();
  assertAgenciesParser();
  assertCorporatesParser();
  assertCdHistoryWeeklyDedupe();
  console.log('Parser regression tests passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
