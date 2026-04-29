'use strict';

const path = require('path');
const { importBankWorkbook } = require('../server/bank-data-importer');

const input = process.argv[2];
const outputDir = process.argv[3] || path.join(__dirname, '..', 'data', 'bank-reports');

if (!input) {
  console.error('Usage: node scripts/import-bank-workbook.js <workbook.xlsm> [output-dir]');
  process.exit(1);
}

importBankWorkbook(input, outputDir, { sourceFile: path.basename(input) })
  .then(meta => {
    console.log(JSON.stringify({ outputDir, ...meta }, null, 2));
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
