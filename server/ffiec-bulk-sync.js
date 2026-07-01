/**
 * ffiec-bulk-sync.js — append FFIEC CDR Call Report / UBPR bulk data into
 * bank-data.sqlite without replacing the FedFis workbook import path.
 *
 * The importer is intentionally source-pluggable. The pure parser/write path
 * works with extracted TSV fixtures, local downloaded ZIP/TSV files, or
 * configured URLs. The public FFIEC bulk UI is ASP.NET-postback driven, while
 * FFIEC's PWS account flow supplies API instructions separately; until a live
 * account/download URL is configured this module reports a clear admin error
 * instead of scraping brittle viewstate.
 */
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqliteDb = require('./sqlite-db');
const { BANK_DATABASE_FILENAME, BANK_FIELDS } = require('./bank-data-importer');

const FETCH_TIMEOUT_MS = 120000;
const PUBLIC_BULK_PAGE = 'https://cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx';

const CERT_FIELDS = [
  'CERT', 'FDICCERT', 'FDICCERTNUMBER', 'FDICCERTIFICATENUMBER',
  'CERTNUMBER', 'CERTIFICATENUMBER', 'RSSDCERT', 'FDIC_CERT'
];
const REPDTE_FIELDS = [
  'REPDTE', 'REPORTDATE', 'REPORTINGDATE', 'REPORTINGPERIOD',
  'REPORTINGPERIODENDDATE', 'RPTDATE', 'RPTCYCLEDATE', 'CYCLEDATE',
  'PERIODENDDATE', 'PERIOD'
];
const CODE_FIELDS = ['CODE', 'MDRM', 'MDRMCODE', 'LINEITEM', 'LINEITEMCODE', 'ITEM', 'ITEMCODE', 'FIELD', 'FIELDNAME'];
const VALUE_FIELDS = ['VALUE', 'AMOUNT', 'FIELDVALUE', 'VAL', 'BALANCE', 'RATIO'];

// Identity text is copied from the portal's latest existing period whenever
// FFIEC omits it. Numeric fields are never carried forward under a new period.
const CARRY_FORWARD_KEYS = [
  'displayName', 'assetRange', 'agLoanRange', 'name', 'id', 'city', 'state',
  'regulatoryId', 'parentName', 'parentRegulatoryId', 'certNumber',
  'primaryRegulator', 'subchapterS', 'county', 'phone', 'address', 'zip',
  'website'
];

// Explicitly mapped fields. `codes` accepts real MDRM/RIS-style names plus
// readable fixture/export aliases; first present nonblank value wins.
const FFIEC_FIELD_MAP = [
  { key: 'totalAssets', schedule: 'RC', codes: ['RCON2170', 'ASSET', 'TOTALASSETS'] },
  { key: 'totalDeposits', schedule: 'RC', codes: ['RCON2200', 'DEP', 'TOTALDEPOSITS'] },
  { key: 'totalLoans', schedule: 'RC', codes: ['RCON2122', 'LNLSGR', 'TOTALLOANS', 'TOTALLOANSANDLEASES'] },
  { key: 'totalEquityCapital', schedule: 'RC', codes: ['RCON3210', 'EQ', 'TOTALEQUITYCAPITAL'] },
  { key: 'netIncome', schedule: 'RI', codes: ['RIAD4340', 'NETINC', 'NETINCOME'] },
  { key: 'afsTotal', schedule: 'RC-B', codes: ['RCON1773', 'SCAF', 'AFSTOTAL', 'TOTALSECURITIESAFSFV'] },
  { key: 'htmTotal', schedule: 'RC-B', codes: ['RCON1771', 'SCHF', 'HTMTOTAL', 'TOTALSECURITIESHTMFV'] },
  { key: 'realizedGainLossSecurities', schedule: 'RI', codes: ['RIADB488', 'IGLSEC', 'REALIZEDGAINLOSSSECURITIES'] },
  { key: 'tier1Capital', schedule: 'RC-R', codes: ['RBCT1J', 'TIER1CAPITAL'] },
  { key: 'tier1RiskBasedRatio', schedule: 'UBPR/RC-R', codes: ['RBC1RWAJ', 'TIER1RISKBASEDRATIO'] },
  { key: 'riskBasedCapitalRatio', schedule: 'UBPR/RC-R', codes: ['RBCRWAJ', 'RISKBASEDCAPITALRATIO'] },
  { key: 'leverageRatio', schedule: 'UBPR/RC-R', codes: ['RBC1AAJ', 'LEVERAGERATIO'] },
  { key: 'roa', schedule: 'UBPR', codes: ['ROA', 'RETURNONASSETS'] },
  { key: 'roe', schedule: 'UBPR', codes: ['ROE', 'RETURNONEQUITY'] },
  { key: 'yieldOnEarningAssets', schedule: 'UBPR', codes: ['INTINCY', 'YIELDONEARNINGASSETS'] },
  { key: 'yieldOnLoans', schedule: 'UBPR', codes: ['YIELDONLOANS'] },
  { key: 'yieldOnSecurities', schedule: 'UBPR', codes: ['YIELDONSECURITIES', 'YIELDONSECURITIESFTE'] },
  { key: 'costOfFunds', schedule: 'UBPR', codes: ['INTEXPY', 'COSTOFFUNDS'] },
  { key: 'netInterestMargin', schedule: 'UBPR', codes: ['NIMY', 'NIM', 'NETINTERESTMARGIN'] },
  { key: 'efficiencyRatio', schedule: 'UBPR', codes: ['EEFFR', 'EFFICIENCYRATIO'] },
  { key: 'llrToLoans', schedule: 'UBPR', codes: ['LNATRESR', 'LLRTOLOANS'] },
  { key: 'nplsToLoans', schedule: 'UBPR', codes: ['NCLNLSR', 'NPLSTOLOANS'] },
  { key: 'loanLossReserve', schedule: 'RC', codes: ['LNATRES', 'LOANLOSSRESERVE'] },
  { key: 'loanLossProvision', schedule: 'RI', codes: ['ELNATR', 'LOANLOSSPROVISION'] },
  { key: 'netChargeoffsToAvgLoans', schedule: 'UBPR', codes: ['NTLNLSR', 'NETCHARGEOFFSTOAVGLOANS'] },
  { key: 'longTermAssetsToAssets', schedule: 'UBPR', codes: ['ASSTLTR', 'LONGTERMASSETSTOASSETS'] },
  { key: 'fiduciaryAssets', schedule: 'RC-T', codes: ['TFRA', 'FIDUCIARYASSETS'] },
  { key: 'fullTimeEmployees', schedule: 'RI', codes: ['RIAD4150', 'NUMEMP', 'FULLTIMEEMPLOYEES'] },
  { key: 'numberOfOffices', schedule: 'RC', codes: ['OFFDOM', 'NUMBEROFOFFICES'] },

  // These are verified by readable aliases and FDIC RIS-style names today.
  // Exact RC-B MDRM sector codes can be expanded here as the FFIEC bulk files
  // are reviewed line-by-line; unmapped fields stay blank rather than guessed.
  { key: 'afsTreasury', schedule: 'RC-B', codes: ['AFSTREASURY', 'AFSUSTREASURY', 'USTREASURYSECSAFSFV'] },
  { key: 'afsAgencyCorp', schedule: 'RC-B', codes: ['AFSAGENCYCORP', 'AFSAGENCY', 'USGOVTAGUSCORPAFSFV'] },
  { key: 'afsMunis', schedule: 'RC-B', codes: ['AFSMUNIS', 'AFSMUNICIPAL', 'MUNISAFSFV'] },
  { key: 'afsPassThroughRmbs', schedule: 'RC-B', codes: ['AFSPASSTHROUGHRMBS', 'AFSPASSTHRURMBS'] },
  { key: 'afsOtherRmbs', schedule: 'RC-B', codes: ['AFSOTHERRMBS', 'AFSCMOSOTHERRMBS'] },
  { key: 'afsCmbs', schedule: 'RC-B', codes: ['AFSCMBS'] },
  { key: 'afsAllMbs', schedule: 'RC-B', codes: ['AFSALLMBS', 'AFSTOTALALLMBS'] },
  { key: 'afsOtherDebt', schedule: 'RC-B', codes: ['AFSOTHERDEBT', 'AFSOTHERDEBTSECS'] },
  { key: 'htmTreasury', schedule: 'RC-B', codes: ['HTMTREASURY', 'HTMUSTREASURY', 'USTREASURYSECSHTMFV'] },
  { key: 'htmAgencyCorp', schedule: 'RC-B', codes: ['HTMAGENCYCORP', 'HTMAGENCY', 'USGOVTAGUSCORPHTMFV'] },
  { key: 'htmMunis', schedule: 'RC-B', codes: ['HTMMUNIS', 'HTMMUNICIPAL', 'MUNISHTMFV'] },
  { key: 'htmPassThroughRmbs', schedule: 'RC-B', codes: ['HTMPASSTHROUGHRMBS', 'HTMPASSTHRURMBS'] },
  { key: 'htmOtherRmbs', schedule: 'RC-B', codes: ['HTMOTHERRMBS', 'HTMCMOSOTHERRMBS'] },
  { key: 'htmCmbs', schedule: 'RC-B', codes: ['HTMCMBS'] },
  { key: 'htmAllMbs', schedule: 'RC-B', codes: ['HTMALLMBS', 'HTMTOTALALLMBS'] },
  { key: 'htmOtherDebt', schedule: 'RC-B', codes: ['HTMOTHERDEBT', 'HTMOTHERDEBTSECS'] },
];

const COMPUTED_MAP = [
  { key: 'loansToDeposits', num: ['RCON2122', 'LNLSGR', 'TOTALLOANS'], den: ['RCON2200', 'DEP', 'TOTALDEPOSITS'] },
  { key: 'loansToAssets', num: ['RCON2122', 'LNLSGR', 'TOTALLOANS'], den: ['RCON2170', 'ASSET', 'TOTALASSETS'] },
  { key: 'securitiesToAssets', num: ['SC', 'TOTALSECURITIES', 'TOTALINVESTMENTSECURITIES'], den: ['RCON2170', 'ASSET', 'TOTALASSETS'] },
  { key: 'securitiesFvToBv', num: ['SCMV', 'SECURITIESFAIRVALUE'], den: ['SC', 'TOTALSECURITIES'] },
  { key: 'brokeredDepositsToDeposits', num: ['BRO', 'BROKEREDDEPOSITS'], den: ['RCON2200', 'DEP', 'TOTALDEPOSITS'] },
  { key: 'nonInterestBearingDeposits', num: ['DEPNI', 'NONINTERESTBEARINGDEPOSITS'], den: ['RCON2200', 'DEP', 'TOTALDEPOSITS'] },
  { key: 'realEstateLoansToLoans', num: ['LNRE', 'REALESTATELOANS'], den: ['RCON2122', 'LNLSGR', 'TOTALLOANS'] },
  { key: 'farmLoansToLoans', num: ['LNREAG', 'FARMLOANS'], den: ['RCON2122', 'LNLSGR', 'TOTALLOANS'] },
  { key: 'agProdLoansToLoans', num: ['LNAG', 'AGPRODLOANS'], den: ['RCON2122', 'LNLSGR', 'TOTALLOANS'] },
  { key: 'ciLoansToLoans', num: ['LNCI', 'CILOANS'], den: ['RCON2122', 'LNLSGR', 'TOTALLOANS'] },
  { key: 'consumerLoansToLoans', num: ['LNCON', 'CONSUMERLOANS'], den: ['RCON2122', 'LNLSGR', 'TOTALLOANS'] },
];

const SUM_MAP = [
  { key: 'totalBorrowings', fields: ['FREPP', 'OBOR', 'TOTALBORROWINGS'] },
];

function headerKey(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeCert(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  return digits ? String(Number(digits)) : '';
}

function num(value) {
  if (value == null) return null;
  const cleaned = String(value).trim().replace(/[$,%"]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '-' || /^na$/i.test(cleaned)) return null;
  const paren = cleaned.match(/^\(([-+]?\d+(?:\.\d+)?)\)$/);
  const n = Number(paren ? `-${paren[1]}` : cleaned);
  return Number.isFinite(n) ? n : null;
}

function fieldDef(key) {
  return (BANK_FIELDS || []).find(field => field.key === key) || { key, label: key, section: 'unknown', type: 'unknown' };
}

function getFirst(record, candidates) {
  for (const c of candidates || []) {
    const k = headerKey(c);
    if (record[k] != null && String(record[k]).trim() !== '') return record[k];
  }
  return null;
}

function getFirstNumber(record, candidates) {
  const v = getFirst(record, candidates);
  return num(v);
}

function round2(value) {
  return Number(value.toFixed(2));
}

function normalizeRepdte(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    if (Number(digits.slice(0, 4)) >= 1900) return digits;
    return `${digits.slice(4, 8)}${digits.slice(0, 2)}${digits.slice(2, 4)}`;
  }
  let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}`;
  m = raw.match(/^(\d{4})Q([1-4])$/i);
  if (m) return periodToRepdte(`${m[1]}Q${m[2]}`);
  return null;
}

function repdteToPeriod(repdte) {
  const s = String(repdte || '');
  if (!/^\d{8}$/.test(s)) return null;
  const quarter = Math.ceil(Number(s.slice(4, 6)) / 3);
  return `${s.slice(0, 4)}Q${quarter}`;
}

function periodToRepdte(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  if (!m) return null;
  return `${m[1]}${{ 1: '0331', 2: '0630', 3: '0930', 4: '1231' }[Number(m[2])]}`;
}

function periodToEndDate(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/);
  if (!m) return period || null;
  return { 1: `3/31/${m[1]}`, 2: `6/30/${m[1]}`, 3: `9/30/${m[1]}`, 4: `12/31/${m[1]}` }[m[2]];
}

function quarterRank(period) {
  const m = String(period || '').match(/^(\d{4})Q([1-4])$/i);
  return m ? Number(m[1]) * 10 + Number(m[2]) : 0;
}

function detectDelimiter(line) {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

function parseDelimited(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter(line => line.trim() !== '');
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map(headerKey);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, idx) => {
      if (header) row[header] = cells[idx] == null ? '' : String(cells[idx]).trim();
    });
    rows.push(row);
  }
  return rows;
}

function looksLikeZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function textFromBuffer(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
}

function inferKind(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('ubpr') || lower.includes('performance') || lower.includes('ratio')) return 'ubpr';
  if (lower.includes('call') || lower.includes('reportingseries') || lower.includes('schedule')) return 'call';
  return null;
}

function extractZipFile(zipPath, kind) {
  const names = childProcess.execFileSync('unzip', ['-Z1', zipPath], {
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return names
    .filter(name => /\.(txt|tsv|csv)$/i.test(name))
    .map(name => ({
      name,
      kind: kind || inferKind(name),
      content: childProcess.execFileSync('unzip', ['-p', zipPath, name], {
        maxBuffer: 250 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8'),
    }));
}

function listFilesRecursive(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function normalizeSourceFile(source) {
  if (typeof source === 'string') {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      return listFilesRecursive(source).flatMap(file => normalizeSourceFile(file));
    }
    const kind = inferKind(source);
    if (/\.zip$/i.test(source)) return extractZipFile(source, kind);
    return [{ name: path.basename(source), kind, content: fs.readFileSync(source, 'utf8') }];
  }
  if (!source) return [];
  const kind = source.kind || inferKind(source.name || source.path || source.url);
  if (source.path) return normalizeSourceFile(source.path).map(file => ({ ...file, kind: file.kind || kind }));
  if (source.buffer && looksLikeZipBuffer(source.buffer)) {
    const tmp = path.join(os.tmpdir(), `ffiec-bulk-${process.pid}-${Date.now()}.zip`);
    fs.writeFileSync(tmp, source.buffer);
    try { return extractZipFile(tmp, kind); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
  return [{ name: source.name || 'inline.tsv', kind, content: source.content != null ? String(source.content) : textFromBuffer(source.buffer) }];
}

async function fetchSource(url, kind, fetchImpl) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'fbbs-portal/ffiec-bulk-sync' },
  });
  if (!res.ok) throw new Error(`FFIEC source responded ${res.status}`);
  const ab = await res.arrayBuffer();
  return normalizeSourceFile({ name: path.basename(new URL(url).pathname) || `${kind}.tsv`, kind, buffer: Buffer.from(ab), url });
}

async function loadConfiguredSourceFiles(opts = {}) {
  if (opts.sourceFiles) {
    const provided = Array.isArray(opts.sourceFiles) ? opts.sourceFiles : [opts.sourceFiles];
    return provided.flatMap(normalizeSourceFile);
  }
  const sourceFiles = [];
  const fileSpec = opts.bulkFile || process.env.FFIEC_BULK_FILE;
  const dirSpec = opts.sourceDir || process.env.FFIEC_BULK_DIR;
  const callFile = opts.callReportFile || process.env.FFIEC_CALL_REPORT_FILE;
  const ubprFile = opts.ubprFile || process.env.FFIEC_UBPR_FILE;
  if (fileSpec) sourceFiles.push(...normalizeSourceFile(fileSpec));
  if (dirSpec) sourceFiles.push(...normalizeSourceFile(dirSpec));
  if (callFile) sourceFiles.push(...normalizeSourceFile({ path: callFile, kind: 'call' }));
  if (ubprFile) sourceFiles.push(...normalizeSourceFile({ path: ubprFile, kind: 'ubpr' }));

  const fetchImpl = opts.fetchImpl || fetch;
  const callUrl = opts.callReportUrl || process.env.FFIEC_CALL_REPORT_URL;
  const ubprUrl = opts.ubprUrl || process.env.FFIEC_UBPR_URL;
  if (callUrl) sourceFiles.push(...await fetchSource(callUrl, 'call', fetchImpl));
  if (ubprUrl) sourceFiles.push(...await fetchSource(ubprUrl, 'ubpr', fetchImpl));

  if (!sourceFiles.length) {
    const err = new Error(
      `FFIEC source is not configured. Download "Call Reports -- Single Period" and "UBPR Ratio -- Single Period" as Tab Delimited from ${PUBLIC_BULK_PAGE}, then set FFIEC_BULK_DIR, FFIEC_CALL_REPORT_FILE/FFIEC_UBPR_FILE, or FFIEC_CALL_REPORT_URL/FFIEC_UBPR_URL.`
    );
    err.statusCode = 400;
    throw err;
  }
  return sourceFiles;
}

function recordFromRows(files, opts = {}) {
  const records = new Map();
  const warnings = [];
  const defaultRepdte = normalizeRepdte(opts.repdte || periodToRepdte(opts.period));

  function ensureRecord(cert, repdte) {
    const key = `${cert}|${repdte || defaultRepdte || ''}`;
    if (!records.has(key)) {
      records.set(key, { cert, repdte: repdte || defaultRepdte || null, values: {}, sources: new Set() });
    }
    return records.get(key);
  }

  for (const file of files) {
    const rows = parseDelimited(file.content);
    if (!rows.length) continue;
    const headers = Object.keys(rows[0]);
    const codeHeader = CODE_FIELDS.find(h => headers.includes(h));
    const valueHeader = VALUE_FIELDS.find(h => headers.includes(h));
    const isLong = Boolean(codeHeader && valueHeader);
    let usable = 0;

    for (const row of rows) {
      const cert = normalizeCert(getFirst(row, CERT_FIELDS));
      const repdte = normalizeRepdte(getFirst(row, REPDTE_FIELDS)) || defaultRepdte;
      if (!cert || !repdte) continue;
      const rec = ensureRecord(cert, repdte);
      if (file.kind) rec.sources.add(file.kind);
      if (isLong) {
        const code = headerKey(row[codeHeader]);
        if (code) {
          rec.values[code] = row[valueHeader];
          usable += 1;
        }
      } else {
        for (const [key, value] of Object.entries(row)) {
          if (value != null && String(value).trim() !== '') rec.values[key] = value;
        }
        usable += 1;
      }
    }
    if (!usable) warnings.push(`${file.name || 'FFIEC file'} had no rows with both FDIC cert and report date.`);
  }

  return {
    records: [...records.values()].map(rec => ({
      cert: rec.cert,
      repdte: rec.repdte,
      period: repdteToPeriod(rec.repdte),
      values: rec.values,
      sources: [...rec.sources],
    })),
    warnings,
  };
}

function parseFfiecFiles(files, opts = {}) {
  return recordFromRows(files, opts);
}

function mapFfiecRecord(record) {
  const raw = record.values || record;
  const values = {};
  for (const item of FFIEC_FIELD_MAP) {
    const v = getFirstNumber(raw, item.codes);
    if (v != null) values[item.key] = round2(v);
  }
  for (const item of COMPUTED_MAP) {
    if (values[item.key] != null) continue;
    const numerator = getFirstNumber(raw, item.num);
    const denominator = getFirstNumber(raw, item.den);
    if (numerator != null && denominator) values[item.key] = round2(numerator / denominator * 100);
  }
  for (const item of SUM_MAP) {
    if (values[item.key] != null) continue;
    let total = 0;
    let hasValue = false;
    for (const field of item.fields) {
      const v = getFirstNumber(raw, [field]);
      if (v != null) {
        total += v;
        hasValue = true;
      }
    }
    if (hasValue) values[item.key] = round2(total);
  }
  if (values.securitiesToAssets == null && values.totalAssets) {
    const securitiesTotal = (values.afsTotal || 0) + (values.htmTotal || 0);
    if (securitiesTotal) values.securitiesToAssets = round2(securitiesTotal / values.totalAssets * 100);
  }
  return values;
}

function buildFfiecPeriodEntry(bank, period, record) {
  const latest = bank.periods && bank.periods[0] ? (bank.periods[0].values || {}) : {};
  const values = { source: 'ffiec' };
  for (const key of CARRY_FORWARD_KEYS) {
    if (latest[key] != null && latest[key] !== '') values[key] = latest[key];
  }
  values.period = period;
  Object.assign(values, mapFfiecRecord(record));
  return { period, endDate: periodToEndDate(period), values, source: 'ffiec' };
}

function buildFieldCoverage() {
  const mapped = [];
  for (const item of FFIEC_FIELD_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'direct',
      schedule: item.schedule,
      sourceFields: item.codes.slice(),
    });
  }
  for (const item of COMPUTED_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'ratio',
      sourceFields: item.num.concat(item.den),
    });
  }
  for (const item of SUM_MAP) {
    const def = fieldDef(item.key);
    mapped.push({
      key: item.key,
      label: def.label,
      section: def.section,
      method: 'sum',
      sourceFields: item.fields.slice(),
    });
  }
  const mappedKeys = new Set(mapped.map(row => row.key));
  const carriedIdentity = CARRY_FORWARD_KEYS
    .filter(key => !mappedKeys.has(key))
    .map(key => {
      const def = fieldDef(key);
      return { key, label: def.label, section: def.section };
    });
  const remaining = (BANK_FIELDS || [])
    .filter(field => !mappedKeys.has(field.key) && !CARRY_FORWARD_KEYS.includes(field.key))
    .map(field => ({ key: field.key, label: field.label, section: field.section, type: field.type }));
  return {
    source: 'FFIEC CDR bulk Call Report / UBPR tab-delimited files',
    mappedCount: mapped.length,
    carriedIdentityCount: carriedIdentity.length,
    remainingCount: remaining.length,
    totalBankFields: (BANK_FIELDS || []).length,
    mapped,
    carriedIdentity,
    remaining,
    warnings: [
      'FFIEC sync adds only newer missing periods; it never overwrites an existing workbook/FDIC/FFIEC period.',
      'Identity fields are carried forward from the latest existing portal period when the FFIEC files omit them.',
      'Detailed RC-B sector buckets are mapped only when the downloaded file exposes a verified code or readable alias; unmapped buckets remain blank.',
    ],
  };
}

function newestRepdte(records) {
  return records
    .map(r => r.repdte)
    .filter(r => /^\d{8}$/.test(String(r || '')))
    .sort()
    .pop() || null;
}

async function syncFfiecQuarter(outputDir, opts = {}) {
  const dbPath = path.join(outputDir, BANK_DATABASE_FILENAME);
  const log = opts.log || (() => {});
  const dryRun = Boolean(opts.dryRun);
  const fieldCoverage = buildFieldCoverage();
  const sourceFiles = await loadConfiguredSourceFiles(opts);
  const parsed = parseFfiecFiles(sourceFiles, opts);
  const requestedRepdte = normalizeRepdte(opts.repdte || periodToRepdte(opts.period));
  const repdte = requestedRepdte || newestRepdte(parsed.records);
  const period = repdteToPeriod(repdte);
  if (!period) throw new Error('FFIEC files did not include a usable report date; pass opts.repdte or include a reporting-period column.');

  const byCert = new Map();
  for (const record of parsed.records) {
    if (record.repdte !== repdte) continue;
    const existing = byCert.get(record.cert);
    if (!existing) {
      byCert.set(record.cert, record);
      continue;
    }
    Object.assign(existing.values, record.values);
    existing.sources = [...new Set((existing.sources || []).concat(record.sources || []))];
  }
  if (!byCert.size) throw new Error(`FFIEC files contained no filer rows for ${period}.`);

  const banks = sqliteDb.querySqliteJson(dbPath, `
    SELECT id, cert_number AS certNumber, detail_json AS detailJson FROM banks
    WHERE cert_number IS NOT NULL AND cert_number != '';
  `);

  let matched = 0;
  let skippedExisting = 0;
  let updated = 0;
  const updates = [];
  for (const row of banks) {
    const record = byCert.get(normalizeCert(row.certNumber));
    if (!record) continue;
    matched += 1;
    if (dryRun) {
      let bank = null;
      try { bank = JSON.parse(row.detailJson || '{}'); } catch (_) { bank = null; }
      if (bank && (bank.periods || []).some(p => p.period === period)) skippedExisting += 1;
      else updated += 1;
      continue;
    }
    updates.push({ id: String(row.id), record });
  }

  const warnings = parsed.warnings.concat(fieldCoverage.warnings);
  const sourceSummary = {
    files: sourceFiles.map(file => ({ name: file.name || 'inline.tsv', kind: file.kind || inferKind(file.name) || 'unknown' })),
  };

  if (dryRun) {
    return {
      period, repdte, filers: byCert.size, matched, updated, skippedExisting,
      unmatchedFilers: Math.max(0, byCert.size - matched), dryRun: true,
      fieldCoverage, warnings, sourceSummary,
    };
  }

  sqliteDb.withDatabase(dbPath, (db) => {
    const select = db.prepare('SELECT summary_json, detail_json FROM banks WHERE id = ?;');
    const update = db.prepare(`
      UPDATE banks SET period = ?, total_assets = ?, total_deposits = ?, summary_json = ?, detail_json = ?
      WHERE id = ?;
    `);
    const apply = db.transaction((items) => {
      for (const item of items) {
        const row = select.get(item.id);
        if (!row) continue;
        const bank = JSON.parse(row.detail_json);
        const summary = JSON.parse(row.summary_json);
        if ((bank.periods || []).some(p => p.period === period)) {
          skippedExisting += 1;
          continue;
        }
        const entry = buildFfiecPeriodEntry(bank, period, item.record);
        // Insert in rank order rather than always unshifting — the FFIEC
        // source period isn't guaranteed to be the bank's newest (unlike the
        // FDIC sync, which always pulls the single newest broadly-filed
        // quarter). portal.js treats periods[0] as "the latest financials"
        // in several places; unshifting an older FFIEC period there would
        // silently show stale numbers as current.
        const existingPeriods = bank.periods || [];
        const insertAt = existingPeriods.findIndex(p => quarterRank(period) > quarterRank(p.period));
        bank.periods = (insertAt === -1
          ? existingPeriods.concat(entry)
          : existingPeriods.slice(0, insertAt).concat(entry, existingPeriods.slice(insertAt))
        ).slice(0, 12);
        if (quarterRank(period) > quarterRank(summary.period)) {
          summary.period = period;
          summary.totalAssets = entry.values.totalAssets ?? summary.totalAssets;
          summary.totalDeposits = entry.values.totalDeposits ?? summary.totalDeposits;
          bank.summary = summary;
        }
        update.run(
          summary.period || null,
          summary.totalAssets ?? null,
          summary.totalDeposits ?? null,
          JSON.stringify(summary),
          JSON.stringify(bank),
          item.id
        );
        updated += 1;
      }
    });
    apply(updates);
    db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?);')
      .run('ffiecSync', JSON.stringify({ at: new Date().toISOString(), period, repdte, updated, skippedExisting, unmatchedFilers: Math.max(0, byCert.size - matched), fieldCoverage, sourceSummary }));
  });

  if (opts.stampDir) {
    fs.mkdirSync(opts.stampDir, { recursive: true });
    const stamp = {
      at: new Date().toISOString(),
      period,
      repdte,
      filers: byCert.size,
      matched,
      updated,
      skippedExisting,
      unmatchedFilers: Math.max(0, byCert.size - matched),
      sourceSummary,
      fieldCoverage: {
        mappedCount: fieldCoverage.mappedCount,
        carriedIdentityCount: fieldCoverage.carriedIdentityCount,
        remainingCount: fieldCoverage.remainingCount,
        warnings: fieldCoverage.warnings,
      },
      warnings,
    };
    const stampPath = path.join(opts.stampDir, 'ffiec-sync-state.json');
    fs.writeFileSync(`${stampPath}.tmp-${process.pid}`, JSON.stringify(stamp, null, 2));
    fs.renameSync(`${stampPath}.tmp-${process.pid}`, stampPath);
  }

  log('info', `FFIEC sync: ${period} — ${updated} banks updated, ${skippedExisting} already had the period, ${matched} matched of ${byCert.size} filers`);
  return {
    period, repdte, filers: byCert.size, matched, updated, skippedExisting,
    unmatchedFilers: Math.max(0, byCert.size - matched), dryRun: false,
    fieldCoverage, warnings, sourceSummary,
  };
}

module.exports = {
  buildFieldCoverage,
  buildFfiecPeriodEntry,
  FFIEC_FIELD_MAP,
  loadConfiguredSourceFiles,
  mapFfiecRecord,
  normalizeRepdte,
  parseDelimited,
  parseFfiecFiles,
  periodToEndDate,
  periodToRepdte,
  repdteToPeriod,
  syncFfiecQuarter,
};
