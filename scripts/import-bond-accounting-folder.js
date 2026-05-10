'use strict';

const path = require('path');
const { listBankSummaries } = require('../server/bank-data-importer');
const { importBondAccountingFolder } = require('../server/bond-accounting-store');

const bankListPath = process.argv[2];
const portfolioFolderPath = process.argv[3];
const outputDir = process.argv[4] || path.join(__dirname, '..', 'data', 'bank-reports');

if (!bankListPath || !portfolioFolderPath) {
  console.error('Usage: node scripts/import-bond-accounting-folder.js <bank-list.xlsx> <portfolio-folder> [output-dir]');
  process.exit(1);
}

try {
  const bankSummaries = listBankSummaries(outputDir);
  const manifest = importBondAccountingFolder(outputDir, bankListPath, portfolioFolderPath, {
    bankSummaries
  });
  console.log(JSON.stringify({
    outputDir,
    importedAt: manifest.importedAt,
    portfolioFileCount: manifest.portfolioFileCount,
    matchedCount: manifest.matchedCount,
    pCodeMatchedCount: manifest.pCodeMatchedCount,
    unmatchedCount: manifest.unmatchedCount,
    bankList: manifest.bankList,
    unmatched: manifest.matches
      .filter(row => row.status !== 'matched')
      .map(row => ({
        filename: row.filename,
        pCode: row.pCode,
        clientName: row.portfolioClientName,
        certNumber: row.certNumber,
        status: row.status
      }))
  }, null, 2));
} catch (err) {
  console.error(err);
  process.exit(1);
}
