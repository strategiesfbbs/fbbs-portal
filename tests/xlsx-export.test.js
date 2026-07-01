'use strict';

// Regression tests for server/xlsx-export.js — the .xlsx builder behind
// Reports v2's "XLSX" output format. Covers: the workbook round-trips
// through the vendored SheetJS reader with headers/rows intact, numbers stay
// numeric (not display-formatted text), the formula-injection guard matches
// csvEscape()/escapeCsvCell() (leading = + - @ gets a neutralizing quote),
// and sheet-name sanitization respects Excel's naming rules.

const assert = require('assert');
const { buildXlsxBuffer, xlsxSafeCell, sanitizeSheetName } = require('../server/xlsx-export');
const XLSX = require('../server/xlsx');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function readBack(buffer, sheetName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1 });
}

test('buildXlsxBuffer round-trips headers + rows, numbers stay numeric', () => {
  const buffer = buildXlsxBuffer('Report', ['Bank', 'Assets', 'Brokered %'], [
    ['Acme Bank', 123456.78, 3.58],
    ['Zeta Bank', 0, 0]
  ]);
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0, 'produces a non-empty buffer');
  const rows = readBack(buffer, 'Report');
  assert.deepStrictEqual(rows[0], ['Bank', 'Assets', 'Brokered %']);
  assert.strictEqual(rows[1][0], 'Acme Bank');
  assert.strictEqual(typeof rows[1][1], 'number', 'money value stays numeric');
  assert.strictEqual(rows[1][1], 123456.78);
  assert.strictEqual(typeof rows[1][2], 'number', 'percent value stays numeric');
  // A legitimate zero must round-trip as 0, not blank/undefined (falsy-zero regression guard).
  assert.strictEqual(rows[2][1], 0);
  assert.strictEqual(rows[2][2], 0);
});

test('xlsxSafeCell neutralizes formula-injection prefixes on strings only', () => {
  assert.strictEqual(xlsxSafeCell('=SUM(1,2)'), "'=SUM(1,2)");
  assert.strictEqual(xlsxSafeCell('+cmd|calc'), "'+cmd|calc");
  assert.strictEqual(xlsxSafeCell('-1+1 (text)'), "'-1+1 (text)");
  assert.strictEqual(xlsxSafeCell('@SUM(1)'), "'@SUM(1)");
  assert.strictEqual(xlsxSafeCell('Acme Bank'), 'Acme Bank');
  assert.strictEqual(xlsxSafeCell(-1), -1, 'a negative NUMBER is not a string and must not be quote-prefixed');
  assert.strictEqual(xlsxSafeCell(0), 0);
  assert.strictEqual(xlsxSafeCell(null), '');
  assert.strictEqual(xlsxSafeCell(undefined), '');
});

test('a formula-guarded cell round-trips as inert text, not a live formula', () => {
  const buffer = buildXlsxBuffer('Report', ['Field'], [['=SUM(1,2)']]);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const cell = workbook.Sheets.Report.A2;
  assert.strictEqual(cell.t, 's', 'cell type is string, not formula');
  assert.strictEqual(cell.v, "'=SUM(1,2)", 'literal value carries the neutralizing quote');
});

test('sanitizeSheetName strips illegal characters and caps at 31 chars', () => {
  assert.strictEqual(sanitizeSheetName('Custom Bank Report'), 'Custom Bank Report');
  assert.strictEqual(sanitizeSheetName('Weird:Name/With*Bad[Chars]'), 'Weird Name With Bad Chars');
  assert.strictEqual(sanitizeSheetName('A'.repeat(50)).length, 31);
  assert.strictEqual(sanitizeSheetName(''), 'Report');
  assert.strictEqual(sanitizeSheetName(null), 'Report');
});

test('empty headers/rows still produce a readable (if empty) sheet', () => {
  const buffer = buildXlsxBuffer('Report', [], []);
  const rows = readBack(buffer, 'Report');
  assert.deepStrictEqual(rows, []);
});

console.log(`xlsx-export tests: ${passed} passed.`);
