'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const BOND_ACCOUNTING_DIRNAME = 'bond-accounting';
const BOND_ACCOUNTING_MANIFEST_FILENAME = 'manifest.json';
const BOND_ACCOUNTING_BANK_LIST_FILENAME = 'bank-list.json';

function bondAccountingDirForReportsDir(bankReportsDir) {
  return path.join(bankReportsDir, BOND_ACCOUNTING_DIRNAME);
}

function bondAccountingManifestPathForReportsDir(bankReportsDir) {
  return path.join(bondAccountingDirForReportsDir(bankReportsDir), BOND_ACCOUNTING_MANIFEST_FILENAME);
}

function bondAccountingBankListPathForReportsDir(bankReportsDir) {
  return path.join(bondAccountingDirForReportsDir(bankReportsDir), BOND_ACCOUNTING_BANK_LIST_FILENAME);
}

function writeJsonAtomic(filePath, value, spaces = 2) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, spaces));
  fs.renameSync(tmpPath, filePath);
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function cleanDigits(value) {
  return cleanText(value).replace(/\D/g, '');
}

function normalizePCode(value) {
  const match = cleanText(value).match(/^P?\s*(\d+)$/i);
  return match ? `P${match[1]}` : '';
}

function sanitizePathSegment(value, fallback = 'item') {
  const cleaned = cleanText(value)
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function parseBankListWorkbook(bankListPath) {
  const workbook = XLSX.readFile(bankListPath, {
    cellFormula: false,
    cellStyles: false,
    raw: false
  });
  const sheetName = workbook.SheetNames.find(name => /bank/i.test(name)) || workbook.SheetNames[0];
  if (!sheetName) throw new Error('Bank list workbook does not contain any sheets.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  });
  const headerIndex = rows.findIndex(row => row.some(value => cleanText(value) === 'Code'));
  if (headerIndex === -1) throw new Error('Could not find the Code column in the bank list workbook.');
  const headers = rows[headerIndex].map(cleanText);
  const records = rows.slice(headerIndex + 1)
    .filter(row => row.some(value => cleanText(value)))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]]).filter(([header]) => header)))
    .map(row => {
      const pCode = normalizePCode(row.Code);
      return {
        clientId: cleanText(row.ClientID),
        clientName: cleanText(row.Client),
        abaNumber: cleanDigits(row.ABANumber),
        account: cleanText(row.Account),
        pCode,
        rssdId: cleanDigits(row.RSSDID),
        certNumber: cleanDigits(row['FDIC Certificate Number']),
        cuid: cleanText(row.CUID),
        clientType: cleanText(row['Client Type']),
        almClient: cleanText(row['ALM Client']),
        state: cleanText(row.State),
        city: cleanText(row.City),
        zipCode: cleanText(row.ZipCode),
        report: cleanText(row.Report),
        salesRep: cleanText(row['Sales Rep']),
        accountingClient: cleanText(row['Accounting Client']),
        status: cleanText(row.Status)
      };
    })
    .filter(row => row.pCode || row.clientName || row.certNumber);
  const byPCode = new Map();
  for (const row of records) {
    if (row.pCode && !byPCode.has(row.pCode.toUpperCase())) byPCode.set(row.pCode.toUpperCase(), row);
  }
  return {
    sourceFile: path.basename(bankListPath),
    sheetName,
    rowCount: records.length,
    pCodeCount: byPCode.size,
    records,
    byPCode
  };
}

function parsePortfolioFilename(filename) {
  const base = path.basename(filename);
  const match = base.match(/^(.+?)\(Account\)_(.+?)_(\d{8})_P(\d+)\.(xlsm|xlsx|xls)$/i);
  if (!match) {
    return {
      filename: base,
      account: '',
      clientName: '',
      reportDate: '',
      pCode: '',
      extension: path.extname(base).slice(1).toLowerCase()
    };
  }
  const ymd = match[3];
  return {
    filename: base,
    account: cleanText(match[1]),
    clientName: cleanText(match[2]),
    reportDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    pCode: `P${match[4]}`,
    extension: match[5].toLowerCase()
  };
}

function listPortfolioFiles(folderPath) {
  return fs.readdirSync(folderPath)
    .filter(name => /\.(xlsm|xlsx|xls)$/i.test(name))
    .map(name => path.join(folderPath, name))
    .filter(filePath => fs.statSync(filePath).isFile())
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function bankSummaryMapByCert(bankSummaries) {
  const map = new Map();
  for (const summary of bankSummaries || []) {
    const cert = cleanDigits(summary && summary.certNumber);
    if (!cert) continue;
    if (!map.has(cert)) map.set(cert, []);
    map.get(cert).push(summary);
  }
  return map;
}

function chooseBankSummary(certMap, certNumber) {
  const rows = certMap.get(cleanDigits(certNumber)) || [];
  return rows.length === 1 ? rows[0] : null;
}

function portfolioTargetPath(rootDir, match) {
  const dateDir = sanitizePathSegment(match.reportDate || 'undated');
  if (match.bankId) {
    return path.join(rootDir, 'matched', sanitizePathSegment(match.bankId), dateDir, sanitizePathSegment(match.filename));
  }
  return path.join(rootDir, 'unmatched', sanitizePathSegment(match.pCode || 'unknown'), dateDir, sanitizePathSegment(match.filename));
}

function importBondAccountingFolder(bankReportsDir, bankListPath, portfolioFolderPath, options = {}) {
  const rootDir = bondAccountingDirForReportsDir(bankReportsDir);
  fs.mkdirSync(rootDir, { recursive: true });

  const bankList = parseBankListWorkbook(bankListPath);
  const certMap = bankSummaryMapByCert(options.bankSummaries || []);
  const portfolioFiles = listPortfolioFiles(portfolioFolderPath);
  const importedAt = new Date().toISOString();
  const matches = [];
  const unmatched = [];

  for (const filePath of portfolioFiles) {
    const parsed = parsePortfolioFilename(path.basename(filePath));
    const bankListRow = parsed.pCode ? bankList.byPCode.get(parsed.pCode.toUpperCase()) : null;
    const bankSummary = bankListRow ? chooseBankSummary(certMap, bankListRow.certNumber) : null;
    const match = {
      id: `${parsed.pCode || 'UNKNOWN'}-${parsed.reportDate || 'undated'}-${sanitizePathSegment(parsed.filename)}`,
      filename: parsed.filename,
      originalPath: filePath,
      account: parsed.account,
      reportDate: parsed.reportDate,
      pCode: parsed.pCode,
      portfolioClientName: parsed.clientName,
      bankList: bankListRow || null,
      bankId: bankSummary ? bankSummary.id : '',
      bankDisplayName: bankSummary ? (bankSummary.displayName || bankSummary.name || '') : '',
      certNumber: bankListRow ? bankListRow.certNumber : '',
      matchedBy: bankListRow ? (bankSummary ? 'pCode+fdicCert' : 'pCode') : '',
      status: bankListRow ? (bankSummary ? 'matched' : 'needs-bank-data-match') : 'unmatched-pcode'
    };
    const targetPath = portfolioTargetPath(rootDir, match);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(filePath, targetPath);
    match.storedPath = path.relative(rootDir, targetPath);
    match.sizeBytes = fs.statSync(targetPath).size;
    matches.push(match);
    if (match.status !== 'matched') unmatched.push(match);
  }

  const manifest = {
    schemaVersion: 1,
    importedAt,
    sourceFolder: options.sourceFolderLabel || portfolioFolderPath,
    bankListSourceFile: path.basename(bankListPath),
    portfolioFileCount: portfolioFiles.length,
    matchedCount: matches.filter(row => row.status === 'matched').length,
    pCodeMatchedCount: matches.filter(row => row.status === 'needs-bank-data-match').length,
    unmatchedCount: unmatched.length,
    bankList: {
      sourceFile: bankList.sourceFile,
      sheetName: bankList.sheetName,
      rowCount: bankList.rowCount,
      pCodeCount: bankList.pCodeCount
    },
    matches
  };

  writeJsonAtomic(bondAccountingBankListPathForReportsDir(bankReportsDir), {
    importedAt,
    sourceFile: bankList.sourceFile,
    sheetName: bankList.sheetName,
    records: bankList.records
  }, 2);
  writeJsonAtomic(bondAccountingManifestPathForReportsDir(bankReportsDir), manifest, 2);
  return manifest;
}

function getBondAccountingForBank(bankReportsDir, bankId) {
  const manifest = loadBondAccountingManifest(bankReportsDir);
  if (!manifest || !bankId) return null;
  const id = String(bankId);
  const matches = (manifest.matches || []).filter(row => String(row.bankId || '') === id);
  return {
    available: matches.length > 0,
    importedAt: manifest.importedAt || '',
    bankListSourceFile: manifest.bankListSourceFile || '',
    portfolioFileCount: matches.length,
    latestReportDate: matches
      .map(row => row.reportDate || '')
      .filter(Boolean)
      .sort()
      .pop() || '',
    portfolios: matches
  };
}

function resolveBondAccountingStoredFile(bankReportsDir, storedPath) {
  const rootDir = bondAccountingDirForReportsDir(bankReportsDir);
  const relativePath = cleanText(storedPath);
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const fullPath = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return fullPath;
}

function getBondAccountingStatus(bankReportsDir) {
  const manifestPath = bondAccountingManifestPathForReportsDir(bankReportsDir);
  if (!fs.existsSync(manifestPath)) return { available: false };
  try {
    const manifest = loadBondAccountingManifest(bankReportsDir);
    return {
      available: true,
      importedAt: manifest.importedAt || '',
      sourceFolder: manifest.sourceFolder || '',
      bankListSourceFile: manifest.bankListSourceFile || '',
      portfolioFileCount: Number(manifest.portfolioFileCount || 0),
      matchedCount: Number(manifest.matchedCount || 0),
      pCodeMatchedCount: Number(manifest.pCodeMatchedCount || 0),
      unmatchedCount: Number(manifest.unmatchedCount || 0)
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

function loadBondAccountingManifest(bankReportsDir) {
  const manifestPath = bondAccountingManifestPathForReportsDir(bankReportsDir);
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

module.exports = {
  BOND_ACCOUNTING_BANK_LIST_FILENAME,
  BOND_ACCOUNTING_DIRNAME,
  BOND_ACCOUNTING_MANIFEST_FILENAME,
  bondAccountingDirForReportsDir,
  getBondAccountingForBank,
  getBondAccountingStatus,
  importBondAccountingFolder,
  loadBondAccountingManifest,
  parseBankListWorkbook,
  parsePortfolioFilename,
  resolveBondAccountingStoredFile
};
