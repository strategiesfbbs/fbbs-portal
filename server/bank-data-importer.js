'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const BANK_DATABASE_FILENAME = 'bank-data.sqlite';
const LEGACY_CRM_SECTION = ['sales', 'force'].join('');

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
      maxBuffer: 80 * 1024 * 1024
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
    // Fall through to the historical workbook layout below.
  }
  return 'xl/worksheets/sheet9.xml';
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

function sqlString(value) {
  if (value === undefined || value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function sqlLike(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
}

function runSqlite(dbPath, sql, options = {}) {
  const result = childProcess.spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 256 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || `sqlite3 exited with status ${result.status}`).trim());
  }
  return result.stdout || '';
}

function querySqliteJson(dbPath, sql) {
  const result = childProcess.execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const text = String(result || '').trim();
  return text ? JSON.parse(text) : [];
}

function databasePathForDir(outputDir) {
  return path.join(outputDir, BANK_DATABASE_FILENAME);
}

function buildBankDatabaseSql(parsed) {
  const lines = [
    'PRAGMA journal_mode = OFF;',
    'PRAGMA synchronous = OFF;',
    'PRAGMA temp_store = MEMORY;',
    'DROP TABLE IF EXISTS metadata;',
    'DROP TABLE IF EXISTS banks;',
    'CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    `INSERT INTO metadata (key, value) VALUES ('metadata', ${sqlString(JSON.stringify(parsed.metadata))});`,
    `INSERT INTO metadata (key, value) VALUES ('fields', ${sqlString(JSON.stringify(BANK_FIELDS))});`,
    `INSERT INTO metadata (key, value) VALUES ('schemaVersion', '1');`,
    [
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
    ].join(' '),
    'BEGIN TRANSACTION;'
  ];

  for (const bank of parsed.banks) {
    const summary = bank.summary || {};
    const values = [
      sqlString(bank.id),
      sqlString(summary.displayName),
      sqlString(summary.name),
      sqlString(summary.city),
      sqlString(summary.state),
      sqlString(summary.certNumber),
      sqlString(summary.parentName),
      sqlString(summary.primaryRegulator),
      sqlString(summary.period),
      sqlNumber(summary.totalAssets),
      sqlNumber(summary.totalDeposits),
      sqlString(bankSearchTextFromSummary(summary)),
      sqlString(JSON.stringify(summary)),
      sqlString(JSON.stringify(bank))
    ];
    lines.push(`INSERT INTO banks VALUES (${values.join(',')});`);
  }

  lines.push(
    'COMMIT;',
    'CREATE INDEX idx_banks_display_name ON banks(display_name COLLATE NOCASE);',
    'CREATE INDEX idx_banks_legal_name ON banks(legal_name COLLATE NOCASE);',
    'CREATE INDEX idx_banks_cert_number ON banks(cert_number);',
    'CREATE INDEX idx_banks_state_city ON banks(state, city);'
  );
  return lines.join('\n');
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
  runSqlite(tmpDbPath, buildBankDatabaseSql(parsed));

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

function getBankDatabaseStatus(outputDir) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return { available: false };
  try {
    const metadata = readBankMetadata(outputDir) || {};
    const rows = querySqliteJson(dbPath, 'SELECT COUNT(*) AS bankCount FROM banks;');
    const bankCount = rows.length ? Number(rows[0].bankCount) : 0;
    if (metadata.bankCount && bankCount !== Number(metadata.bankCount)) {
      return {
        available: false,
        metadata,
        bankCount,
        error: `Bank database is incomplete: ${bankCount} of ${metadata.bankCount} banks are available. Re-import the workbook.`
      };
    }
    return { available: bankCount > 0, metadata, bankCount };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

function searchBankDatabase(outputDir, query, limit = 12) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const metadata = readBankMetadata(outputDir) || {};
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
  const q = String(query || '').trim().toLowerCase();
  let sql;

  if (!q) {
    sql = `SELECT summary_json FROM banks ORDER BY display_name COLLATE NOCASE LIMIT ${safeLimit};`;
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    const where = tokens
      .map(token => `search_text LIKE '%${sqlLike(token)}%' ESCAPE '\\'`)
      .join(' AND ');
    const qSql = sqlString(q);
    sql = `
      SELECT summary_json
      FROM banks
      WHERE ${where || '1 = 1'}
      ORDER BY
        CASE WHEN lower(display_name) = ${qSql} THEN 60 ELSE 0 END +
        CASE WHEN lower(legal_name) = ${qSql} THEN 40 ELSE 0 END +
        CASE WHEN lower(display_name) LIKE '${sqlLike(q)}%' ESCAPE '\\' THEN 30 ELSE 0 END +
        CASE WHEN lower(display_name) LIKE '%${sqlLike(q)}%' ESCAPE '\\' THEN 10 ELSE 0 END DESC,
        display_name COLLATE NOCASE
      LIMIT ${safeLimit};
    `;
  }

  const results = querySqliteJson(dbPath, sql).map(row => JSON.parse(row.summary_json));
  return { metadata, results };
}

function getBankFromDatabase(outputDir, id) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const metadata = readBankMetadata(outputDir) || {};
  const rows = querySqliteJson(
    dbPath,
    `SELECT detail_json FROM banks WHERE id = ${sqlString(String(id || ''))} LIMIT 1;`
  );
  if (!rows.length) return null;
  return { metadata, bank: JSON.parse(rows[0].detail_json) };
}

function listBankSummaries(outputDir) {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return [];
  return querySqliteJson(dbPath, 'SELECT summary_json FROM banks;')
    .map(row => JSON.parse(row.summary_json));
}

function queryBankMapDataset(outputDir, periodPattern = '2025Q*') {
  const dbPath = databasePathForDir(outputDir);
  if (!fs.existsSync(dbPath)) return null;
  const safePattern = String(periodPattern).replace(/'/g, "''");
  const banks = querySqliteJson(dbPath, `
    SELECT
      id AS bankkey,
      display_name AS bankname,
      cert_number AS fdic,
      city,
      state,
      json_extract(summary_json, '$.period') AS period,
      json_extract(summary_json, '$.totalAssets') AS totalAssets,
      json_extract(summary_json, '$.totalEquityCapital') AS totalEquityCapital,
      json_extract(summary_json, '$.tier1Capital') AS tier1Capital,
      json_extract(summary_json, '$.totalDeposits') AS totalDeposits,
      json_extract(summary_json, '$.afsTotal') AS afsTotal,
      json_extract(summary_json, '$.htmTotal') AS htmTotal,
      json_extract(summary_json, '$.loansToDeposits') AS ltd,
      json_extract(summary_json, '$.roa') AS roa,
      json_extract(summary_json, '$.roe') AS roe,
      json_extract(summary_json, '$.netInterestMargin') AS nim,
      json_extract(summary_json, '$.yieldOnSecurities') AS yos,
      json_extract(summary_json, '$.yieldOnLoans') AS yieldloans,
      json_extract(summary_json, '$.yieldOnEarningAssets') AS yea,
      json_extract(summary_json, '$.costOfFunds') AS cof,
      json_extract(summary_json, '$.efficiencyRatio') AS eff,
      json_extract(summary_json, '$.leverageRatio') AS leverage,
      json_extract(summary_json, '$.nonInterestBearingDeposits') AS nibpct,
      json_extract(summary_json, '$.wholesaleFundingReliance') AS wholesale
    FROM banks
    WHERE json_extract(summary_json, '$.period') GLOB '${safePattern}'
    ORDER BY total_assets DESC;
  `);
  const stateCounts = {};
  let latestPeriod = '';
  for (const b of banks) {
    if (b.state) stateCounts[b.state] = (stateCounts[b.state] || 0) + 1;
    if (b.period && b.period > latestPeriod) latestPeriod = b.period;
  }
  return { banks, stateCounts, latestPeriod, bankCount: banks.length };
}

module.exports = {
  BANK_DATABASE_FILENAME,
  BANK_FIELDS,
  databasePathForDir,
  getBankDatabaseStatus,
  getBankFromDatabase,
  importBankWorkbook,
  listBankSummaries,
  parseBankWorkbook,
  queryBankMapDataset,
  searchBankDatabase,
  writeBankDatabase
};
