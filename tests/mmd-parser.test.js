// Tests for server/mmd-parser.js — the desk's MMD municipal scale parser.
// The scale arrives as a PDF (parsed from extracted text) or as an Excel grid
// export (parsed by column). Both must produce the same payload shape and the
// same per-grade column mapping, including the blank-P/R rows (terms 9+).
'use strict';

const assert = require('assert');
const XLSX = require('../server/xlsx');
const { parseMmdCurveText, parseMmdCurveWorkbook } = require('../server/mmd-parser');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

// Build a minimal MMD workbook mirroring the desk's export: an annual grid with
// the YEAR/AAA/P-R/INS'D/AA/A/BAA columns (term in the unlabeled first column),
// a blank P/R from term 9 on, then the monthly grid which must be ignored.
function buildWorkbook() {
  const rows = [
    [null, 'YEAR', 'AAA', "P/R", "INS'D", 'AA', 'A', 'BAA'],
    [1, 2027, 2.35, 2.42, 2.42, 2.38, 2.40, 2.75],
    [2, 2028, 2.38, 2.45, 2.48, 2.41, 2.46, 2.79],
    [9, 2035, 2.89, null, 3.05, 2.99, 3.16, 3.61], // P/R blank
    [30, 2056, 4.25, null, 4.50, 4.45, 4.59, 5.07],
    [null, 'YEAR', 'JAN', 'FEB', 'MAR', 'APRIL', 'MAY', 'JUNE'],
    [1, 2027, 2.35, 2.35, 2.35, 2.35, 2.35, 2.35], // monthly grid — must be skipped
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Workbook parser
// ---------------------------------------------------------------------------

test('workbook: parses the annual grid and skips the monthly grid', () => {
  const p = parseMmdCurveWorkbook(buildWorkbook());
  assert.strictEqual(p.warnings.length, 0);
  assert.strictEqual(p.curve.length, 4); // 4 annual rows, not the monthly row
  assert.deepStrictEqual(p.curve.map(r => r.term), [1, 2, 9, 30]);
});

test('workbook: full row maps every grade column by position', () => {
  const p = parseMmdCurveWorkbook(buildWorkbook());
  const r = p.curve[0];
  assert.deepStrictEqual(
    { aaa: r.aaa, preRefunded: r.preRefunded, insured: r.insured, aa: r.aa, a: r.a, baa: r.baa },
    { aaa: 2.35, preRefunded: 2.42, insured: 2.42, aa: 2.38, a: 2.40, baa: 2.75 }
  );
});

test('workbook: blank P/R cell does not become 0 and grades stay aligned', () => {
  const p = parseMmdCurveWorkbook(buildWorkbook());
  const r9 = p.curve.find(r => r.term === 9);
  assert.strictEqual(r9.preRefunded, undefined);      // not 0
  assert.strictEqual(r9.aaa, 2.89);
  assert.strictEqual(r9.insured, 3.05);
  assert.strictEqual(r9.aa, 2.99);
  assert.strictEqual(r9.a, 3.16);
  assert.strictEqual(r9.baa, 3.61);
  assert.deepStrictEqual(r9.values, [2.89, 3.05, 2.99, 3.16, 3.61]);
});

test('workbook: grades are monotonic (AAA < AA < A < BAA) on every row', () => {
  const p = parseMmdCurveWorkbook(buildWorkbook());
  for (const r of p.curve) {
    assert.ok(r.aaa < r.aa && r.aa < r.a && r.a < r.baa, `non-monotonic row term ${r.term}`);
  }
});

test('workbook: empty/garbage buffer warns instead of throwing', () => {
  const p = parseMmdCurveWorkbook(Buffer.from('not a workbook'));
  assert.ok(Array.isArray(p.curve));
  assert.strictEqual(p.curve.length, 0);
  assert.ok(p.warnings.length > 0);
});

// ---------------------------------------------------------------------------
// Text (PDF) parser — same column mapping for blank-P/R rows
// ---------------------------------------------------------------------------

test('text: blank-P/R row maps insured/aa/a in column order', () => {
  const text = [
    'FRIDAY 6/20/2026 (5% Coupon)',
    'YEAR AAA P/R INS\'D AA A BAA',
    '1 2027 2.35 2.42 2.42 2.38 2.40 2.75',
    '9 2035 2.89 3.05 2.99 3.16 3.61', // no P/R column
  ].join('\n');
  const p = parseMmdCurveText(text);
  assert.strictEqual(p.asOfDate, '2026-06-20');
  assert.strictEqual(p.coupon, 5);
  const r9 = p.curve.find(r => r.term === 9);
  assert.strictEqual(r9.insured, 3.05);
  assert.strictEqual(r9.aa, 2.99);
  assert.strictEqual(r9.a, 3.16);
  assert.strictEqual(r9.baa, 3.61);
  assert.ok(r9.aa < r9.a, 'A must yield more than AA');
});

test('text: bare MM/DD/YYYY date (no weekday) still parses', () => {
  const p = parseMmdCurveText('6/25/2026\nYEAR AAA P/R\n1 2027 2.35 2.42 2.42 2.38 2.40 2.75');
  assert.strictEqual(p.asOfDate, '2026-06-25');
});

console.log(`\nmmd-parser: ${passed}/${total} passed`);
