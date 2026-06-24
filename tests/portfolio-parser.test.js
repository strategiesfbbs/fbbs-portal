'use strict';

// Focused portfolio-parser coverage for the schema-v4 cashflow shape and
// par-weighted portfolio fields. Uses small synthetic workbooks/rows.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const XLSX = require('../server/xlsx');
const {
  _parseCashflowDataForTest,
  _parWeightedAverageForTest,
  parsePortfolioWorkbook
} = require('../server/portfolio-parser');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('cashflow data returns schema-v4 runoff arrays from a synthetic sheet', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ignored'],
    ['Date', 'Base', 'Stress'],
    ['1/31/2026', 1000, 900],
    ['2/28/2026', '875.5', 820],
    ['not a date', 700, 650]
  ]), 'Cashflow Data');
  const cf = _parseCashflowDataForTest(wb);
  assert.deepStrictEqual(cf, {
    asOfDate: '2026-01-31',
    dates: ['2026-01-31', '2026-02-28'],
    baseThousands: [1000, 875.5]
  });
});

test('par-weighted averages ignore holdings that omit the requested field', () => {
  const holdings = [
    { par: 1_000_000, averageLife: 2, effectiveDuration: 1.5 },
    { par: 3_000_000, averageLife: 6 },
    { par: 5_000_000, effectiveDuration: '' },
    { par: 2_000_000, averageLife: null, effectiveDuration: 4.5 }
  ];
  assert.strictEqual(_parWeightedAverageForTest(holdings, 'averageLife'), 5);
  assert.strictEqual(_parWeightedAverageForTest(holdings, 'effectiveDuration'), 3.5);
});

test('parsePortfolioWorkbook includes additive WAL/duration aggregates', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-portfolio-parser-test-'));
  const filePath = path.join(tmp, 'sample.xlsm');
  try {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['', '', 'as of 04/30/2026']]), 'Overview');

    const agencyRows = [];
    for (let i = 0; i < 46; i += 1) agencyRows.push([]);
    agencyRows[46] = ['', 'Cusip', 'Description', 'Par (000)', 'Avg Life', 'Eff. Dur'];
    agencyRows[47] = ['', '3130AAAA1', 'FHLB A', 1000, 2, 1.5];
    agencyRows[48] = ['', '3130BBBB2', 'FHLB B', 3000, 6, ''];
    agencyRows[49] = ['', '3130CCCC3', 'FHLB C', 2000, '', 4.5];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(agencyRows), 'Agency');
    XLSX.writeFile(wb, filePath);

    const parsed = parsePortfolioWorkbook(filePath);
    assert.strictEqual(parsed.schemaVersion, 4);
    assert.strictEqual(parsed.aggregates.par, 6_000_000);
    assert.strictEqual(parsed.aggregates.averageLife, 5);
    assert.strictEqual(parsed.aggregates.effectiveDuration, 3.5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const { name, fn } of tests) {
  try { fn(); passed++; }
  catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}
console.log(`portfolio-parser tests: ${passed} passed.`);
