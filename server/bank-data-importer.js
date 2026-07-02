'use strict';

const childProcess = require('child_process'); // still used to shell out to `unzip`
const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');
// 2025 Census Gazetteer ZCTA internal points, keyed by ZIP/ZCTA.
const ZIP_CENTROIDS = require('./us-zcta-centroids-2025.json');

const BANK_DATABASE_FILENAME = 'bank-data.sqlite';
const LEGACY_CRM_SECTION = ['sales', 'force'].join('');
const CURRENT_BANK_MAX_QUARTER_LAG = 1;

const BANK_FIELDS = [
  { key: 'displayName', col: 'A', label: 'Account Name', section: 'details', type: 'text' },
  { key: 'assetRange', col: 'B', label: 'Total Asset Range', section: 'details', type: 'text' },
  { key: 'agLoanRange', col: 'C', label: 'Ag Prod and Farmland Loans / Total Loans', section: 'details', type: 'text' },
  { key: 'agSum', col: 'D', label: 'Ag Sum', section: 'details', type: 'number' },
  { key: 'name', col: 'E', label: 'Company Name', section: 'details', type: 'text' },
  { key: 'id', col: 'F', label: 'SNL Institution Key', section: 'details', type: 'text' },
  { key: 'city', col: 'G', label: 'City', section: 'details', type: 'text' },
  { key: 'state', col: 'H', label: 'State', section: 'details', type: 'text' },
  { key: 'regulatoryId', col: 'I', label: 'Regulatory ID', section: 'details', type: 'text' },
  { key: 'parentName', col: 'J', label: 'Parent Account', section: 'details', type: 'text' },
  { key: 'parentRegulatoryId', col: 'K', label: 'Parent Regulatory ID', section: 'details', type: 'text' },
  { key: 'certNumber', col: 'L', label: 'Cert Number', section: 'details', type: 'text' },
  { key: 'primaryRegulator', col: 'M', label: 'Primary Regulator', section: 'details', type: 'text' },
  { key: 'subchapterS', col: 'N', label: 'Subchapter S Election?', section: 'details', type: 'text' },
  { key: 'period', col: 'O', label: 'End of Period Date', section: 'details', type: 'period' },
  { key: 'totalAssets', col: 'P', label: 'Total Assets ($000)', section: 'balanceSheet', type: 'money' },
  { key: 'totalDeposits', col: 'V', label: 'Total Deposits ($000)', section: 'balanceSheet', type: 'money' },
  { key: 'loansToDeposits', col: 'W', label: 'Loans / Deposits (%)', section: 'balanceSheet', type: 'percent' },
  { key: 'totalBorrowings', col: 'X', label: 'Total Borrowings ($000)', section: 'balanceSheet', type: 'money' },
  { key: 'pledgedSecurities', col: 'AT', label: 'Pledged Securities (BV) ($000)', section: 'balanceSheet', type: 'money' },
  { key: 'loansToAssets', col: 'U', label: 'Total Loans / Assets (%)', section: 'balanceSheet', type: 'percent' },
  { key: 'brokeredDepositsToDeposits', col: 'CC', label: 'Brokered Deposits / Deposits (%)', section: 'balanceSheet', type: 'percent' },
  { key: 'securitiesToAssets', col: 'GS', label: 'Total Securities / Total Assets (%)', section: 'balanceSheet', type: 'percent' },
  { key: 'securitiesFvToBv', col: 'CP', label: 'Securities (FV) / Securities (BV) (%)', section: 'balanceSheet', type: 'percent' },
  { key: 'realizedGainLossSecurities', col: 'BP', label: 'Realized Gain/Loss on Securities ($000)', section: 'balanceSheet', type: 'money' },
  { key: 'afsTotal', col: 'FQ', label: 'Total Securities (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsTreasury', col: 'AA', label: 'US Treasury Secs (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsAgencyCorp', col: 'AB', label: 'US Govt Ag & US Corp (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsMunis', col: 'AC', label: 'Munis (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsPassThroughRmbs', col: 'AF', label: 'Pass Thru RMBS: Total (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsOtherRmbs', col: 'AG', label: 'CMOs & Other RMBS (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsCmbs', col: 'AI', label: 'CMBS (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsAllMbs', col: 'AJ', label: 'Total All MBS (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'afsOtherDebt', col: 'AK', label: 'Other Debt Secs (AFS-FV) ($000)', section: 'securitiesAfs', type: 'money' },
  { key: 'htmTotal', col: 'FP', label: 'Total Securities (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmTreasury', col: 'IO', label: 'US Treasury Secs (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmAgencyCorp', col: 'IP', label: 'US Govt Ag & US Corp (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmMunis', col: 'IQ', label: 'Munis (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmPassThroughRmbs', col: 'IR', label: 'Pass Thru RMBS: Total (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmOtherRmbs', col: 'IS', label: 'CMOs & Other RMBS (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmCmbs', col: 'IT', label: 'CMBS (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmAllMbs', col: 'IU', label: 'Total All MBS (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'htmOtherDebt', col: 'IV', label: 'Other Debt Secs (HTM-FV) ($000)', section: 'securitiesHtm', type: 'money' },
  { key: 'totalLoans', col: 'T', label: 'Total Loans & Leases (HFI, HFS) ($000)', section: 'loans', type: 'money' },
  { key: 'realEstateLoansToLoans', col: 'AU', label: 'Real Estate Loans / Loans (%)', section: 'loans', type: 'percent' },
  { key: 'farmLoansToLoans', col: 'AV', label: 'Farmland Loans / Loans (%)', section: 'loans', type: 'percent' },
  { key: 'agProdLoansToLoans', col: 'AW', label: 'Agricultural Prod / Loans (%)', section: 'loans', type: 'percent' },
  { key: 'ciLoansToLoans', col: 'AX', label: 'Total C&I Loans / Loans (%)', section: 'loans', type: 'percent' },
  { key: 'consumerLoansToLoans', col: 'AY', label: 'Total Consumer Loans / Loans (%)', section: 'loans', type: 'percent' },
  { key: 'totalEquityCapital', col: 'AZ', label: 'Total Equity Capital ($000)', section: 'capital', type: 'money' },
  { key: 'tier1Capital', col: 'BA', label: 'Tier 1 Capital ($000)', section: 'capital', type: 'money' },
  { key: 'tier1RiskBasedRatio', col: 'BB', label: 'Tier 1 Risk-based Ratio (%)', section: 'capital', type: 'percent' },
  { key: 'riskBasedCapitalRatio', col: 'BC', label: 'Risk Based Capital Ratio (%)', section: 'capital', type: 'percent' },
  { key: 'tangibleEquityToAssets', col: 'DQ', label: 'Tang Equity / Tang Assets (%)', section: 'capital', type: 'percent' },
  { key: 'leverageRatio', col: 'BD', label: 'Leverage Ratio (%)', section: 'capital', type: 'percent' },
  { key: 'dividendsDeclared', col: 'BF', label: 'Total Dividends Declared ($000)', section: 'capital', type: 'money' },
  { key: 'dividendsToNetIncome', col: 'BE', label: 'Common Divis Declared / Net Inc (%)', section: 'capital', type: 'percent' },
  { key: 'roa', col: 'BI', label: 'ROA (%)', section: 'profitability', type: 'percent' },
  { key: 'roe', col: 'BK', label: 'ROE (%)', section: 'profitability', type: 'percent' },
  { key: 'yieldOnEarningAssets', col: 'BL', label: 'Yield on Earning Assets (%)', section: 'profitability', type: 'percent' },
  { key: 'yieldOnLoans', col: 'BN', label: 'Yield on Loans (%)', section: 'profitability', type: 'percent' },
  { key: 'yieldOnSecurities', col: 'BO', label: 'Yield on Securities (FTE) (%)', section: 'profitability', type: 'percent' },
  { key: 'netInterestMargin', col: 'BQ', label: 'Net Interest Margin (%)', section: 'profitability', type: 'percent' },
  { key: 'efficiencyRatio', col: 'BU', label: 'Efficiency Ratio (FTE) (%)', section: 'profitability', type: 'percent' },
  { key: 'costOfFunds', col: 'BM', label: 'Cost of Funds (%)', section: 'profitability', type: 'percent' },
  { key: 'netIncome', col: 'BG', label: 'Net Income ($000)', section: 'profitability', type: 'money' },
  { key: 'texasRatio', col: 'CO', label: 'Texas Ratio (%)', section: 'assetQuality', type: 'percent' },
  { key: 'llrToLoans', col: 'BW', label: 'Loan Loss Reserves / Loans (%)', section: 'assetQuality', type: 'percent' },
  { key: 'nplsToLoans', col: 'BX', label: 'NPLs / Loans (%)', section: 'assetQuality', type: 'percent' },
  { key: 'loanLossReserve', col: 'BY', label: 'Loan & Lease Loss Reserve ($000)', section: 'assetQuality', type: 'money' },
  { key: 'loanLossProvision', col: 'CR', label: 'Provision for Loan & Lease Losses ($000)', section: 'assetQuality', type: 'money' },
  { key: 'netChargeoffsToAvgLoans', col: 'CA', label: 'Net Chargeoffs / Avg Loans (%)', section: 'assetQuality', type: 'percent' },
  { key: 'largeDepositsToDeposits', col: 'HL', label: 'Total Dep with Bal > $250K / Deposits (%)', section: 'liquidity', type: 'percentOf', denominatorKey: 'totalDeposits' },
  { key: 'nonInterestBearingDeposits', col: 'CJ', label: 'Non-Int Bearing Dep / Deposits (%)', section: 'liquidity', type: 'percent' },
  { key: 'jumboTimeDeposits', col: 'CD', label: 'Jumbo Time Dep / Dom Deposits (%)', section: 'liquidity', type: 'percent' },
  { key: 'publicFunds', col: 'JG', label: 'Public Funds / Dom Deposits (%)', section: 'liquidity', type: 'percent' },
  { key: 'netNonCoreFundingDependence', col: 'CE', label: 'Net NonCore Funding Dependence (%)', section: 'liquidity', type: 'percent' },
  { key: 'wholesaleFundingReliance', col: 'CF', label: 'Reliance on Wholesale Funding (%)', section: 'liquidity', type: 'percent' },
  { key: 'longTermAssetsToAssets', col: 'CB', label: 'Long-term Assets / Assets (%)', section: 'liquidity', type: 'percent' },
  { key: 'liquidAssetsToAssets', col: 'CG', label: 'Liquid Assets / Assets (%)', section: 'liquidity', type: 'percent' },
  { key: 'avgIntBearingFundsToAssets', col: 'CI', label: 'Avg Int Bear Funds / Avg Assets (%)', section: 'liquidity', type: 'percent' },
  { key: 'intEarnAssetsToFunds', col: 'FN', label: 'Int Earn Assets / Int Bear Funds (%)', section: 'liquidity', type: 'percent' },
  { key: 'county', col: 'GT', label: 'Address 1 County', section: 'accountDetails', type: 'text' },
  { key: 'phone', col: 'HE', label: 'Phone', section: 'accountDetails', type: 'text' },
  { key: 'address', col: 'HF', label: 'Address', section: 'accountDetails', type: 'text' },
  { key: 'zip', col: 'HG', label: 'Zip', section: 'accountDetails', type: 'text' },
  { key: 'website', col: 'HH', label: 'Website', section: 'accountDetails', type: 'text' },
  { key: 'fiduciaryAssets', col: 'GY', label: 'Fiduciary Assets ($000)', section: 'accountDetails', type: 'money' },
  { key: 'fullTimeEmployees', col: 'DB', label: 'FTEs', section: 'accountDetails', type: 'number' },
  { key: 'numberOfOffices', col: 'IJ', label: 'Number of Offices', section: 'accountDetails', type: 'number' }
];

const COLS_TO_READ = new Set(BANK_FIELDS.map(field => field.col).concat(['JK']));
const COL_INDEX_TO_LETTER = new Map([...COLS_TO_READ].map(col => [colToIndex(col), col]));
const FIELD_BY_COL = new Map(BANK_FIELDS.map(field => [field.col, field]));

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function cellRefCol(ref) {
  return String(ref || '').replace(/[0-9]/g, '');
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlTags(text) {
  return decodeXml(String(text || '')
    .replace(/<t[^>]*>/g, '')
    .replace(/<\/t>/g, '')
    .replace(/<[^>]+>/g, ''));
}

function parseAttrs(attrs) {
  const out = {};
  String(attrs || '').replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, (_, key, value) => {
    out[key] = value;
    return '';
  });
  return out;
}

function loadSharedStrings(workbookPath) {
  let xml = '';
  try {
    xml = childProcess.execFileSync('unzip', ['-p', workbookPath, 'xl/sharedStrings.xml'], {
      maxBuffer: 80 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString('utf8');
  } catch (err) {
    return [];
  }
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = re.exec(xml))) strings.push(stripXmlTags(match[1]));
  return strings;
}

function unzipText(workbookPath, entryPath, options = {}) {
  return childProcess.execFileSync('unzip', ['-p', workbookPath, entryPath], {
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024
  }).toString('utf8');
}

function resolveWorkbookTarget(target) {
  const cleaned = String(target || '').replace(/^\/+/, '');
  return cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`;
}

function findWorksheetPath(workbookPath, sheetName) {
  try {
    const workbookXml = unzipText(workbookPath, 'xl/workbook.xml');
    const relsXml = unzipText(workbookPath, 'xl/_rels/workbook.xml.rels');
    const relTargets = new Map();
    const relRe = /<Relationship\s+([^>]*?)\/?>/g;
    let relMatch;
    while ((relMatch = relRe.exec(relsXml))) {
      const attrs = parseAttrs(relMatch[1]);
      if (attrs.Id && attrs.Target) relTargets.set(attrs.Id, resolveWorkbookTarget(attrs.Target));
    }

    const sheetRe = /<sheet\s+([^>]*?)\/?>/g;
    let sheetMatch;
    while ((sheetMatch = sheetRe.exec(workbookXml))) {
      const attrs = parseAttrs(sheetMatch[1]);
      if (attrs.name === sheetName && attrs['r:id'] && relTargets.has(attrs['r:id'])) {
        return relTargets.get(attrs['r:id']);
      }
    }
  } catch (err) {
    throw new Error(`Could not locate ${sheetName} worksheet in workbook: ${err.message}`);
  }
  throw new Error(`Could not locate ${sheetName} worksheet in workbook`);
}

function parseCellValue(body, type, sharedStrings) {
  const inline = body.match(/<is>([\s\S]*?)<\/is>/);
  if (inline) return stripXmlTags(inline[1]);
  const vm = body.match(/<v>([\s\S]*?)<\/v>/);
  if (!vm) return null;
  const raw = decodeXml(vm[1]);
  if (type === 's') return sharedStrings[Number(raw)] || '';
  if (type === 'str' || type === 'inlineStr') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function parseRow(rowXml, sharedStrings, { wantedOnly = true } = {}) {
  const values = {};
  const cellRe = /<c\s+([^>]*)>([\s\S]*?)<\/c>/g;
  let cell;
  while ((cell = cellRe.exec(rowXml))) {
    const attrs = parseAttrs(cell[1]);
    const col = cellRefCol(attrs.r);
    if (wantedOnly && !COLS_TO_READ.has(col)) continue;
    values[col] = parseCellValue(cell[2], attrs.t, sharedStrings);
  }
  return values;
}

function parseRowNumber(rowXml) {
  const m = rowXml.match(/^<row\s+[^>]*r="(\d+)"/);
  return m ? Number(m[1]) : null;
}

function normalizeValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toUpperCase() === 'NA') return null;
    return trimmed;
  }
  return value;
}

function quarterRank(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2]);
}

function periodToEndDate(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  if (!m) return period || null;
  const y = m[1];
  return { Q1: `3/31/${y}`, Q2: `6/30/${y}`, Q3: `9/30/${y}`, Q4: `12/31/${y}` }[`Q${m[2]}`];
}

function buildValues(rowValues) {
  const values = {};
  for (const field of BANK_FIELDS) {
    values[field.key] = normalizeValue(rowValues[field.col]);
  }
  return values;
}

function bankSummary(values) {
  return {
    id: String(values.id || ''),
    displayName: values.displayName || [values.name, values.city, values.state].filter(Boolean).join(', '),
    name: values.name || '',
    city: values.city || '',
    state: values.state || '',
    certNumber: values.certNumber || '',
    parentName: values.parentName || '',
    primaryRegulator: values.primaryRegulator || '',
    period: values.period || null,
    totalAssets: values.totalAssets ?? null,
    totalDeposits: values.totalDeposits ?? null
  };
}

function bankSearchTextFromSummary(summary) {
  return [
    summary.displayName,
    summary.name,
    summary.city,
    summary.state,
    summary.certNumber,
    summary.parentName,
    summary.primaryRegulator
  ].filter(Boolean).join(' ').toLowerCase();
}

// Escape the LIKE wildcards (\ % _) inside a value that will be *bound* as a
// parameter against `LIKE ? ESCAPE '\'`. Quotes are NOT escaped here — the
// parameter binding handles those; doubling them would corrupt the match.
function escapeLikeWildcards(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function querySqliteJson(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

function databasePathForDir(outputDir) {
  return path.join(outputDir, BANK_DATABASE_FILENAME);
}

// Build the whole bank database on one connection: set the bulk-load PRAGMAs,
// (re)create the schema, stream every bank row through one prepared INSERT
// inside a transaction, then build the indexes. better-sqlite3 reuses the
// compiled statement across the loop, so this is both parameterized and fast.
function writeBankDatabaseRows(dbPath, parsed) {
  sqliteDb.withDatabase(dbPath, (db) => {
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.pragma('temp_store = MEMORY');
    db.exec('DROP TABLE IF EXISTS metadata;');
    db.exec('DROP TABLE IF EXISTS banks;');
    db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?);');
    insertMeta.run('metadata', JSON.stringify(parsed.metadata));
    insertMeta.run('fields', JSON.stringify(BANK_FIELDS));
    insertMeta.run('schemaVersion', '1');
    db.exec([
      'CREATE TABLE banks (',
      'id TEXT PRIMARY KEY,',
      'display_name TEXT,',
      'legal_name TEXT,',
      'city TEXT,',
      'state TEXT,',
      'cert_number TEXT,',
      'parent_name TEXT,',
      'primary_regulator TEXT,',
      'period TEXT,',
      'total_assets REAL,',
      'total_deposits REAL,',
      'search_text TEXT NOT NULL,',
      'summary_json TEXT NOT NULL,',
      'detail_json TEXT NOT NULL',
      ');'
    ].join(' '));

    const insertBank = db.prepare(`
      INSERT INTO banks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    const insertAll = db.transaction((banks) => {
      for (const bank of banks) {
        const summary = bank.summary || {};
        insertBank.run(
          textOrNull(bank.id),
          textOrNull(summary.displayName),
          textOrNull(summary.name),
          textOrNull(summary.city),
          textOrNull(summary.state),
          textOrNull(summary.certNumber),
          textOrNull(summary.parentName),
          textOrNull(summary.primaryRegulator),
          textOrNull(summary.period),
          numOrNull(summary.totalAssets),
          numOrNull(summary.totalDeposits),
          bankSearchTextFromSummary(summary),
          JSON.stringify(summary),
          JSON.stringify(bank)
        );
      }
    });
    insertAll(parsed.banks);

    db.exec('CREATE INDEX idx_banks_display_name ON banks(display_name COLLATE NOCASE);');
    db.exec('CREATE INDEX idx_banks_legal_name ON banks(legal_name COLLATE NOCASE);');
    db.exec('CREATE INDEX idx_banks_cert_number ON banks(cert_number);');
    db.exec('CREATE INDEX idx_banks_state_city ON banks(state, city);');
  });
}

function parseBankWorkbook(workbookPath, options = {}) {
  const sharedStrings = loadSharedStrings(workbookPath);
  const worksheetPath = findWorksheetPath(workbookPath, 'ALL_DATA');
  const banks = new Map();
  const metadata = {
    importedAt: new Date().toISOString(),
    sourceFile: options.sourceFile || path.basename(workbookPath),
    latestPeriod: null,
    bankCount: 0,
    rowCount: 0,
    fields: BANK_FIELDS
  };

  return new Promise((resolve, reject) => {
    const unzip = childProcess.spawn('unzip', ['-p', workbookPath, worksheetPath]);
    let buffer = '';
    let rejected = false;

    unzip.on('error', reject);
    unzip.stderr.on('data', chunk => {
      if (options.onWarning) options.onWarning(chunk.toString('utf8'));
    });
    unzip.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('</row>')) >= 0) {
        const raw = buffer.slice(0, idx + 6);
        buffer = buffer.slice(idx + 6);
        const start = raw.indexOf('<row');
        if (start === -1) continue;
        const rowXml = raw.slice(start);
        const rowNumber = parseRowNumber(rowXml);
        if (!rowNumber || rowNumber < 15) continue;

        try {
          const rowValues = parseRow(rowXml, sharedStrings);
          if (rowValues.JK != null && Number(rowValues.JK) !== 1) continue;
          const values = buildValues(rowValues);
          if (!values.id || !values.period || !values.name) continue;
          metadata.rowCount += 1;
          if (!metadata.latestPeriod || quarterRank(values.period) > quarterRank(metadata.latestPeriod)) {
            metadata.latestPeriod = values.period;
          }
          const id = String(values.id);
          let bank = banks.get(id);
          if (!bank) {
            bank = { id, summary: bankSummary(values), periods: [] };
            banks.set(id, bank);
          }
          bank.periods.push({
            period: values.period,
            endDate: periodToEndDate(values.period),
            values
          });
          if (quarterRank(values.period) >= quarterRank(bank.summary.period)) {
            bank.summary = bankSummary(values);
          }
        } catch (err) {
          rejected = true;
          try { unzip.kill(); } catch (_) {}
          reject(err);
          return;
        }
      }
    });
    unzip.on('close', code => {
      if (rejected) return;
      if (code && code !== 0 && code !== null) {
        reject(new Error(`Unable to unzip ALL_DATA worksheet from workbook (${code})`));
        return;
      }
      const bankList = [...banks.values()]
        .map(bank => ({
          ...bank,
          periods: bank.periods.sort((a, b) => quarterRank(b.period) - quarterRank(a.period)).slice(0, 12)
        }))
        .sort((a, b) => a.summary.displayName.localeCompare(b.summary.displayName));
      metadata.bankCount = bankList.length;
      resolve({ metadata, banks: bankList });
    });
  });
}

async function importBankWorkbook(workbookPath, outputDir, options = {}) {
  const parsed = await parseBankWorkbook(workbookPath, options);
  if (!parsed.metadata.rowCount || !parsed.metadata.bankCount) {
    const err = new Error('No bank rows parsed — wrong worksheet or unexpected layout.');
    err.statusCode = 400;
    throw err;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  writeBankDatabase(parsed, outputDir);
  writeJsonAtomic(path.join(outputDir, 'bank-manifest.json'), { metadata: parsed.metadata }, 2);
  return parsed.metadata;
}

function writeJsonAtomic(filePath, value, spaces) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, spaces));
  fs.renameSync(tmpPath, filePath);
}

function writeBankDatabase(parsed, outputDir) {
  const dbPath = databasePathForDir(outputDir);
  const tmpDbPath = `${dbPath}.tmp-${process.pid}-${Date.now()}`;
  const backupDbPath = `${dbPath}.backup-${process.pid}-${Date.now()}`;

  fs.rmSync(tmpDbPath, { force: true });
  writeBankDatabaseRows(tmpDbPath, parsed);

  try {
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, backupDbPath);
    fs.renameSync(tmpDbPath, dbPath);
    fs.rmSync(backupDbPath, { force: true });
  } catch (err) {
    fs.rmSync(tmpDbPath, { force: true });
    if (!fs.existsSync(dbPath) && fs.existsSync(backupDbPath)) {
      fs.renameSync(backupDbPath, dbPath);
    }
    throw err;
  }
}

function readBankMetadata(outputDir) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const rows = querySqliteJson(dbPath, "SELECT value FROM metadata WHERE key = 'metadata' LIMIT 1;");
  if (!rows.length) return null;
  return normalizeBankMetadata(JSON.parse(rows[0].value));
}

function normalizeBankMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata.fields)) return metadata;
  return {
    ...metadata,
    fields: metadata.fields.map(field => ({
      ...field,
      section: field.section === LEGACY_CRM_SECTION ? 'accountDetails' : field.section
    }))
  };
}

function periodRank(period) {
  const m = String(period || '').trim().match(/^(\d{4})Q([1-4])$/i);
  if (!m) return null;
  return Number(m[1]) * 4 + Number(m[2]);
}

function periodFromRank(rank) {
  if (!Number.isFinite(rank) || rank < 1) return '';
  const year = Math.floor((rank - 1) / 4);
  const quarter = rank - year * 4;
  return `${year}Q${quarter}`;
}

function periodRankSql(columnSql) {
  return `(CAST(substr(${columnSql}, 1, 4) AS INTEGER) * 4 + CAST(substr(${columnSql}, 6, 1) AS INTEGER))`;
}

function getBankFreshnessStats(dbPath, maxQuarterLag = CURRENT_BANK_MAX_QUARTER_LAG) {
  if (!fs.existsSync(dbPath)) {
    return {
      latestPeriod: '',
      freshnessCutoffPeriod: '',
      maxQuarterLag,
      totalBankCount: 0,
      currentBankCount: 0,
      staleBankCount: 0,
      missingPeriodCount: 0,
      excludedBankCount: 0,
    };
  }
  const rows = querySqliteJson(dbPath, 'SELECT period, COUNT(*) AS count FROM banks GROUP BY period;');
  let latestRank = null;
  let totalBankCount = 0;
  let missingPeriodCount = 0;
  const periodCounts = [];
  for (const row of rows) {
    const count = Number(row.count) || 0;
    totalBankCount += count;
    const rank = periodRank(row.period);
    if (rank == null) {
      missingPeriodCount += count;
      continue;
    }
    periodCounts.push({ period: String(row.period), rank, count });
    latestRank = latestRank == null ? rank : Math.max(latestRank, rank);
  }
  if (latestRank == null) {
    return {
      latestPeriod: '',
      freshnessCutoffPeriod: '',
      maxQuarterLag,
      totalBankCount,
      currentBankCount: 0,
      staleBankCount: totalBankCount,
      missingPeriodCount,
      excludedBankCount: totalBankCount,
    };
  }
  const freshnessCutoffRank = latestRank - Math.max(0, Number(maxQuarterLag) || 0);
  let currentBankCount = 0;
  let staleBankCount = missingPeriodCount;
  for (const item of periodCounts) {
    if (item.rank >= freshnessCutoffRank) currentBankCount += item.count;
    else staleBankCount += item.count;
  }
  return {
    latestPeriod: periodFromRank(latestRank),
    freshnessCutoffPeriod: periodFromRank(freshnessCutoffRank),
    freshnessCutoffRank,
    maxQuarterLag,
    totalBankCount,
    currentBankCount,
    staleBankCount,
    missingPeriodCount,
    excludedBankCount: staleBankCount,
  };
}

function currentBankSqlFilter(stats, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const column = `${prefix}period`;
  if (!stats || !stats.latestPeriod || !Number.isFinite(stats.freshnessCutoffRank)) {
    return { sql: '1 = 0', params: [] };
  }
  return {
    sql: `${column} GLOB '????Q?' AND ${periodRankSql(column)} >= ?`,
    params: [stats.freshnessCutoffRank],
  };
}

function isCurrentBankPeriod(period, stats) {
  const rank = periodRank(period);
  return rank != null && stats && Number.isFinite(stats.freshnessCutoffRank) && rank >= stats.freshnessCutoffRank;
}

function freshnessPayload(stats) {
  return {
    latestPeriod: stats.latestPeriod,
    freshnessCutoffPeriod: stats.freshnessCutoffPeriod,
    maxQuarterLag: stats.maxQuarterLag,
    totalBankCount: stats.totalBankCount,
    currentBankCount: stats.currentBankCount,
    staleBankCount: stats.staleBankCount,
    missingPeriodCount: stats.missingPeriodCount,
    excludedBankCount: stats.excludedBankCount,
    excludedStaleBankCount: stats.excludedBankCount,
  };
}

function getBankDatabaseStatus(outputDir) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return { available: false };
  try {
    const metadata = readBankMetadata(outputDir) || {};
    const rows = querySqliteJson(dbPath, 'SELECT COUNT(*) AS bankCount FROM banks;');
    const totalBankCount = rows.length ? Number(rows[0].bankCount) : 0;
    const freshness = getBankFreshnessStats(dbPath);
    if (metadata.bankCount && totalBankCount !== Number(metadata.bankCount)) {
      return {
        available: false,
        metadata,
        bankCount: freshness.currentBankCount,
        ...freshnessPayload(freshness),
        error: `Bank database is incomplete: ${totalBankCount} of ${metadata.bankCount} banks are available. Re-import the workbook.`
      };
    }
    return { available: freshness.currentBankCount > 0, metadata, bankCount: freshness.currentBankCount, ...freshnessPayload(freshness) };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

function searchBankDatabase(outputDir, query, limit = 12, options = {}) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const metadata = readBankMetadata(outputDir) || {};
  const freshness = getBankFreshnessStats(dbPath);
  const activeFilter = options.includeStale ? { sql: '1 = 1', params: [] } : currentBankSqlFilter(freshness);
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
  const q = String(query || '').trim().toLowerCase();
  let sql;
  let params;
  let countSql;
  let countParams;

  if (!q) {
    sql = `SELECT summary_json FROM banks WHERE ${activeFilter.sql} ORDER BY display_name COLLATE NOCASE LIMIT ?;`;
    params = activeFilter.params.concat([safeLimit]);
    countSql = `SELECT COUNT(*) AS count FROM banks WHERE ${activeFilter.sql};`;
    countParams = activeFilter.params.slice();
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    const where = tokens
      .map(() => `search_text LIKE ? ESCAPE '\\'`)
      .join(' AND ');
    const qEsc = escapeLikeWildcards(q);
    sql = `
      SELECT summary_json
      FROM banks
      WHERE ${activeFilter.sql}
        AND ${where || '1 = 1'}
      ORDER BY
        CASE WHEN lower(display_name) = ? THEN 60 ELSE 0 END +
        CASE WHEN lower(legal_name) = ? THEN 40 ELSE 0 END +
        CASE WHEN lower(display_name) LIKE ? ESCAPE '\\' THEN 30 ELSE 0 END +
        CASE WHEN lower(display_name) LIKE ? ESCAPE '\\' THEN 10 ELSE 0 END DESC,
        display_name COLLATE NOCASE
      LIMIT ?;
    `;
    params = activeFilter.params.concat([
      ...tokens.map(token => `%${escapeLikeWildcards(token)}%`),
      q,
      q,
      `${qEsc}%`,
      `%${qEsc}%`,
      safeLimit
    ]);
    countSql = `SELECT COUNT(*) AS count FROM banks WHERE ${activeFilter.sql} AND ${where || '1 = 1'};`;
    countParams = activeFilter.params.concat(tokens.map(token => `%${escapeLikeWildcards(token)}%`));
  }

  const results = querySqliteJson(dbPath, sql, params).map(row => JSON.parse(row.summary_json));
  const countRow = querySqliteJson(dbPath, countSql, countParams)[0] || {};
  const total = Number(countRow.count) || results.length;
  return { metadata, results, total, limit: safeLimit, truncated: total > results.length, bankCount: freshness.currentBankCount, ...freshnessPayload(freshness) };
}

function getBankFromDatabase(outputDir, id, options = {}) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const metadata = readBankMetadata(outputDir) || {};
  const freshness = getBankFreshnessStats(dbPath);
  const rows = querySqliteJson(
    dbPath,
    'SELECT period, detail_json FROM banks WHERE id = ? LIMIT 1;',
    [String(id || '')]
  );
  if (!rows.length) return null;
  if (!options.includeStale && !isCurrentBankPeriod(rows[0].period, freshness)) return null;
  // isStale lets includeStale callers (tear-sheet fetch by known id) flag a
  // bank whose latest call report sits behind the freshness cutoff.
  return {
    metadata,
    bank: JSON.parse(rows[0].detail_json),
    isStale: !isCurrentBankPeriod(rows[0].period, freshness)
  };
}

// Batched lookup of the slim summary blob for many banks in one query — avoids
// the N+1 of getBankFromDatabase (which parses each bank's full detail_json) when
// a caller only needs summary fields. Returns Map(id -> parsed summary).
function getBankSummariesByIds(outputDir, ids, options = {}) {
  const out = new Map();
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return out;
  const unique = [...new Set((ids || []).map(id => String(id || '')).filter(Boolean))];
  if (!unique.length) return out;
  const freshness = getBankFreshnessStats(dbPath);
  const activeFilter = options.includeStale ? { sql: '1 = 1', params: [] } : currentBankSqlFilter(freshness);
  const placeholders = unique.map(() => '?').join(',');
  const rows = querySqliteJson(
    dbPath,
    `SELECT id, summary_json FROM banks WHERE id IN (${placeholders}) AND ${activeFilter.sql};`,
    unique.concat(activeFilter.params)
  );
  for (const row of rows) {
    try {
      out.set(String(row.id), JSON.parse(row.summary_json));
    } catch (_) { /* skip an unparseable row rather than fail the whole batch */ }
  }
  return out;
}

function listBankSummaries(outputDir, options = {}) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return [];
  const freshness = getBankFreshnessStats(dbPath);
  const activeFilter = options.includeStale ? { sql: '1 = 1', params: [] } : currentBankSqlFilter(freshness);
  return querySqliteJson(dbPath, `SELECT summary_json FROM banks WHERE ${activeFilter.sql};`, activeFilter.params)
    .map(row => JSON.parse(row.summary_json));
}

// Id-only projection of the current (freshness-filtered) bank universe — no
// summary_json parse. For membership checks (currentBankIdSet callers) where
// listBankSummaries' full-table JSON.parse is pure overhead.
function listCurrentBankIds(outputDir) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return [];
  const freshness = getBankFreshnessStats(dbPath);
  const activeFilter = currentBankSqlFilter(freshness);
  return querySqliteJson(dbPath, `SELECT id FROM banks WHERE ${activeFilter.sql};`, activeFilter.params)
    .map(row => String(row.id || ''))
    .filter(Boolean);
}

const MAP_FIELD_KEYS = [
  'displayName', 'certNumber', 'city', 'state', 'county', 'address', 'zip',
  'totalAssets', 'totalEquityCapital', 'tier1Capital', 'totalDeposits', 'totalBorrowings',
  'afsTotal', 'htmTotal', 'htmMunis', 'securitiesToAssets', 'loansToAssets', 'loansToDeposits',
  'roa', 'roe', 'netInterestMargin', 'yieldOnSecurities', 'yieldOnLoans',
  'yieldOnEarningAssets', 'costOfFunds', 'efficiencyRatio', 'leverageRatio',
  'nonInterestBearingDeposits', 'wholesaleFundingReliance', 'brokeredDepositsToDeposits',
  'netNonCoreFundingDependence',
  'liquidAssetsToAssets', 'tier1RiskBasedRatio', 'texasRatio', 'nplsToLoans', 'longTermAssetsToAssets',
  // AFS muni book + Sub-S election (BQ context). Additive per CLAUDE.md
  // "Adding a metric to the map" — projected here so the cached map dataset
  // carries them for maps, tear sheets, and future coverage screens.
  'afsMunis', 'subchapterS',
  // Reports v2's custom-bank builder offers these as selectable columns
  // (CUSTOM_BANK_REPORT_COLUMNS in portal.js) but its dataset IS this same
  // map projection — any curated report column not listed here silently
  // renders blank for every bank. Keep this list a superset of that one.
  'numberOfOffices', 'website', 'phone'
];

function zip5(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length < 5 ? digits.padStart(5, '0') : digits.slice(0, 5);
}

function normalizeLocationPart(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function mapLocationForRow(row) {
  const zip = zip5(row.zip);
  const centroid = zip && ZIP_CENTROIDS[zip];
  const city = normalizeLocationPart(row.city);
  const county = normalizeLocationPart(row.county);
  const state = normalizeLocationPart(row.state);
  const key = [zip, city, county, state].filter(Boolean).join('|');
  const countyRaw = String(row.county || '').trim();
  const countyLabel = countyRaw && countyRaw.includes(',') ? countyRaw : (countyRaw ? `${countyRaw} County` : '');
  const label = [
    String(row.city || '').trim(),
    countyLabel,
    String(row.state || '').trim(),
    zip
  ].filter(Boolean).join(' · ');
  return {
    zip5: zip,
    locationKey: key,
    locationLabel: label,
    latitude: centroid ? centroid[0] : null,
    longitude: centroid ? centroid[1] : null
  };
}

function buildMapFieldDefs() {
  return MAP_FIELD_KEYS
    .map(key => {
      const def = BANK_FIELDS.find(f => f.key === key);
      if (!def) return null;
      return { key: def.key, label: def.label, type: def.type, section: def.section };
    })
    .filter(Boolean);
}

function peerDeltaFieldKey(metricKey) {
  return `peerDelta_${metricKey}`;
}

function queryBankMapDataset(outputDir, periodPattern = null, options = {}) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const freshness = getBankFreshnessStats(dbPath);
  const activeFilter = options.includeStale ? { sql: '1 = 1', params: [] } : currentBankSqlFilter(freshness, 'b');
  const pattern = periodPattern || '*';
  const fields = buildMapFieldDefs();
  // Pull each bank's latest-period values from detail_json by walking
  // the periods array via json_each, then extracting from the entry
  // whose period matches summary_json.period. Same source of truth as
  // the tear sheet (which reads detail_json), but pushed entirely into
  // SQL so we don't ship every detail blob to Node.
  const fieldSelects = fields
    .map(f => `json_extract(p.value, '$.values.${f.key}') AS ${f.key}`)
    .join(',\n      ');
  const rows = querySqliteJson(dbPath, `
    SELECT
      b.id AS id,
      json_extract(b.summary_json, '$.period') AS period,
      ${fieldSelects}
    FROM banks b, json_each(b.detail_json, '$.periods') p
    WHERE json_extract(p.value, '$.period') = json_extract(b.summary_json, '$.period')
      AND json_extract(b.summary_json, '$.period') GLOB ?
      AND ${activeFilter.sql}
    ORDER BY b.total_assets DESC;
  `, [String(pattern)].concat(activeFilter.params));
  const stateCounts = {};
  let mappedCount = 0;
  let latestPeriod = '';
  const peerComparison = options.peerComparison || null;
  const peerByKey = (peerComparison && peerComparison.byKey) || null;
  const peerFieldDefs = peerByKey ? Object.keys(peerByKey).map(metricKey => {
    const def = BANK_FIELDS.find(f => f.key === metricKey);
    const baseLabel = def ? def.label : metricKey;
    return {
      key: peerDeltaFieldKey(metricKey),
      label: `${baseLabel.replace(/\s*\(.*?\)\s*$/, '').trim()} Δ vs peer`,
      type: 'percent',
      section: 'peer',
      sourceKey: metricKey,
      higherIsBetter: peerByKey[metricKey].higherIsBetter
    };
  }) : [];

  for (const r of rows) {
    if (r.state) stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;
    if (r.period && r.period > latestPeriod) latestPeriod = r.period;
    Object.assign(r, mapLocationForRow(r));
    if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) mappedCount += 1;
    if (peerByKey) {
      for (const def of peerFieldDefs) {
        const bankRaw = r[def.sourceKey];
        if (bankRaw === null || bankRaw === undefined || bankRaw === '') continue;
        const bankValue = Number(bankRaw);
        const peerValue = Number(peerByKey[def.sourceKey].peerValue);
        if (!Number.isFinite(bankValue) || !Number.isFinite(peerValue)) continue;
        r[def.key] = bankValue - peerValue;
      }
    }
  }
  return {
    banks: rows,
    fields: peerFieldDefs.length ? fields.concat(peerFieldDefs) : fields,
    stateCounts,
    latestPeriod,
    bankCount: rows.length,
    currentBankCount: freshness.currentBankCount,
    totalBankCount: freshness.totalBankCount,
    staleBankCount: freshness.staleBankCount,
    excludedBankCount: freshness.excludedBankCount,
    excludedStaleBankCount: freshness.excludedBankCount,
    freshnessCutoffPeriod: freshness.freshnessCutoffPeriod,
    maxQuarterLag: freshness.maxQuarterLag,
    mappedCount,
    peerComparison: peerComparison ? {
      peerGroup: peerComparison.peerGroup,
      period: peerComparison.period,
      bankPeriod: peerComparison.bankPeriod,
      periodAligned: peerComparison.periodAligned,
      byKey: peerComparison.byKey
    } : null
  };
}

module.exports = {
  BANK_DATABASE_FILENAME,
  BANK_FIELDS,
  CURRENT_BANK_MAX_QUARTER_LAG,
  databasePathForDir,
  getBankDatabaseStatus,
  getBankFromDatabase,
  getBankFreshnessStats,
  getBankSummariesByIds,
  importBankWorkbook,
  isCurrentBankPeriod,
  listBankSummaries,
  listCurrentBankIds,
  parseBankWorkbook,
  periodRank,
  queryBankMapDataset,
  searchBankDatabase,
  writeBankDatabase
};
