'use strict';

const fs = require('fs');
const path = require('path');

const THC_SUMMARY_DIRNAME = 'thc-summary';
const THC_SUMMARY_MANIFEST_FILENAME = 'manifest.json';

const FORBIDDEN_KEYS = new Set([
  'account',
  'accountNumber',
  'account_number',
  'accountNo',
  'acct',
  'cusip',
  'cusips',
  'holdings',
  'positions',
  'rawHoldings',
  'rawPositions',
  'pledged',
  'safekeeping'
]);

const REPORT_TYPES = ['alm', 'eve', 'ear', 'assumption', 'bondAccounting', 'portfolio', 'incomeRisk', 'liquidity', 'cecl', 'tradeSimulation'];
const REPORT_TYPE_ALIASES = {
  bondaccounting: 'bondAccounting',
  bond_accounting: 'bondAccounting',
  income_risk: 'incomeRisk',
  incomerisk: 'incomeRisk',
  trade_simulation: 'tradeSimulation',
  tradesimulation: 'tradeSimulation'
};

function thcSummaryDirForReportsDir(bankReportsDir) {
  return path.join(bankReportsDir, THC_SUMMARY_DIRNAME);
}

function thcSummaryManifestPathForReportsDir(bankReportsDir) {
  return path.join(thcSummaryDirForReportsDir(bankReportsDir), THC_SUMMARY_MANIFEST_FILENAME);
}

function writeJsonAtomic(filePath, value, spaces = 2) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, spaces));
  fs.renameSync(tmpPath, filePath);
}

function cleanText(value, maxLength = 300) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 2000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, maxLength);
}

function cleanDigits(value) {
  return cleanText(value).replace(/\D/g, '');
}

function normalizeDate(value) {
  const text = cleanText(value, 40);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return text.slice(0, 40);
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const cleaned = String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-' || /^n\/?a$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cusipCheckDigit(token) {
  const chars = String(token || '').toUpperCase();
  if (!/^[0-9A-Z*@#]{9}$/.test(chars)) return null;
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    let value;
    const ch = chars[i];
    if (/[0-9]/.test(ch)) value = Number(ch);
    else if (/[A-Z]/.test(ch)) value = ch.charCodeAt(0) - 55;
    else if (ch === '*') value = 36;
    else if (ch === '@') value = 37;
    else if (ch === '#') value = 38;
    else return null;
    if (i % 2 === 1) value *= 2;
    sum += Math.floor(value / 10) + (value % 10);
  }
  return String((10 - (sum % 10)) % 10);
}

function looksLikeCusip(value) {
  const token = String(value || '').toUpperCase();
  return /^[0-9A-Z]{9}$/.test(token) && cusipCheckDigit(token) === token[8];
}

function findForbiddenValue(value, pathParts = []) {
  if (typeof value === 'string') {
    const text = value.toUpperCase();
    const cusip = text.match(/\b[0-9A-Z]{9}\b/g);
    if (cusip && cusip.some(looksLikeCusip)) return { path: pathParts.join('.') || '$', type: 'CUSIP-like value' };
    if (/\b(?:ACCOUNT|ACCT|SAFEKEEP|SAFEKEEPING)\b[^A-Z0-9]{0,12}[A-Z0-9][A-Z0-9-]{5,24}\b/i.test(value)) {
      return { path: pathParts.join('.') || '$', type: 'account/safekeeping-like value' };
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findForbiddenValue(value[i], pathParts.concat(`[${i}]`));
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const found = findForbiddenValue(value[key], pathParts.concat(key));
    if (found) return found;
  }
  return null;
}

function normalizeStatus(value) {
  const text = cleanText(value, 80);
  if (!text) return '';
  const lower = text.toLowerCase();
  if (/ready|posted|available|complete|delivered/.test(lower)) return 'Ready';
  if (/progress|running|pending/.test(lower)) return 'In Progress';
  if (/requested|needed|queued/.test(lower)) return 'Requested';
  if (/stale|expired|old|refresh/.test(lower)) return 'Needs Refresh';
  if (/missing|none|not available/.test(lower)) return 'Missing';
  return text;
}

function normalizeReportStatus(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const type of REPORT_TYPES) {
    // The alias table maps input-alias → canonical, so aliases for this
    // canonical type are the KEYS whose value is `type` (looking up BY the
    // canonical name only ever returned the canonical name again, silently
    // dropping snake_case module keys like income_risk).
    const aliasKeys = [type, type.toLowerCase(), ...Object.keys(REPORT_TYPE_ALIASES).filter(key => REPORT_TYPE_ALIASES[key] === type)];
    const row = aliasKeys.map(key => source[key]).find(value => value !== undefined && value !== null) || null;
    if (row && typeof row === 'object') {
      out[type] = {
        status: normalizeStatus(row.status || row.available || ''),
        date: normalizeDate(row.date || row.reportDate || row.asOfDate || ''),
        cycle: cleanText(row.cycle || '', 40),
        link: cleanText(row.link || row.url || '', 600)
      };
    } else if (row !== undefined && row !== null && row !== '') {
      out[type] = { status: normalizeStatus(row), date: '', cycle: '', link: '' };
    }
  }
  return out;
}

function normalizeMetricBlock(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    bookValue: normalizeNumber(source.bookValue),
    marketValue: normalizeNumber(source.marketValue),
    unrealizedGainLoss: normalizeNumber(source.unrealizedGainLoss ?? source.gainLoss),
    unrealizedGainLossPct: normalizeNumber(source.unrealizedGainLossPct ?? source.gainLossPct),
    bookYield: normalizeNumber(source.bookYield),
    marketYield: normalizeNumber(source.marketYield),
    weightedAverageCoupon: normalizeNumber(source.weightedAverageCoupon ?? source.wac),
    weightedAverageLife: normalizeNumber(source.weightedAverageLife ?? source.wal),
    effectiveDuration: normalizeNumber(source.effectiveDuration ?? source.duration),
    niiAtRiskPct: normalizeNumber(source.niiAtRiskPct ?? source.incomeAtRiskPct),
    eveAtRiskPct: normalizeNumber(source.eveAtRiskPct ?? source.nevAtRiskPct),
    liquidityRatio: normalizeNumber(source.liquidityRatio),
    ceclReservePct: normalizeNumber(source.ceclReservePct ?? source.reserveCoveragePct)
  };
}

function normalizeNamedAmountRows(rows, amountKeys = ['marketValue', 'par', 'value']) {
  return (Array.isArray(rows) ? rows : []).slice(0, 40).map(row => {
    const source = row && typeof row === 'object' ? row : {};
    const amountKey = amountKeys.find(key => normalizeNumber(source[key]) !== null);
    return {
      label: cleanText(source.label || source.sector || source.bucket || source.name || '', 120),
      amount: amountKey ? normalizeNumber(source[amountKey]) : null,
      pct: normalizeNumber(source.pct || source.percent || source.weight),
      count: normalizeNumber(source.count)
    };
  }).filter(row => row.label || row.amount !== null || row.pct !== null);
}

function normalizeScenarioRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map(row => {
    const source = row && typeof row === 'object' ? row : {};
    return {
      kind: cleanText(source.kind || source.type || source.scenarioType || '', 40),
      shockBp: normalizeNumber(source.shockBp ?? source.shock ?? source.bp),
      metric: cleanText(source.metric || source.label || '', 120),
      value: normalizeNumber(source.value ?? source.estimatedMarketValue ?? source.marketValue),
      change: normalizeNumber(source.change ?? source.estimatedChange),
      pctChange: normalizeNumber(source.pctChange ?? source.percentChange ?? source.changePct),
      policyLimit: normalizeNumber(source.policyLimit ?? source.limit),
      status: normalizeStatus(source.status || ''),
      withinPolicy: source.withinPolicy === true ? true : source.withinPolicy === false ? false : null,
      exception: cleanText(source.exception || source.policyException || '', 180)
    };
  }).filter(row => row.kind || row.shockBp !== null || row.metric || row.value !== null || row.status);
}

function normalizeTradeSimulationImpact(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    theme: cleanText(source.theme || source.strategyTheme || '', 160),
    yieldPickupBp: normalizeNumber(source.yieldPickupBp ?? source.yieldPickUpBp),
    durationDelta: normalizeNumber(source.durationDelta ?? source.effectiveDurationDelta),
    walDelta: normalizeNumber(source.walDelta ?? source.weightedAverageLifeDelta),
    annualIncome: normalizeNumber(source.annualIncome ?? source.annualIncomeDelta),
    niiImpact: normalizeNumber(source.niiImpact ?? source.netInterestIncomeImpact),
    eveImpact: normalizeNumber(source.eveImpact ?? source.nevImpact),
    breakevenMonths: normalizeNumber(source.breakevenMonths ?? source.breakeven),
    realizedGainLoss: normalizeNumber(source.realizedGainLoss ?? source.gainLoss),
    lotsAffectedCount: normalizeNumber(source.lotsAffectedCount ?? source.lotCount),
    parTraded: normalizeNumber(source.parTraded ?? source.aggregatePar),
    withinPolicyAfter: source.withinPolicyAfter === true ? true : source.withinPolicyAfter === false ? false : null
  };
}

function containsForbiddenKey(value, pathParts = []) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = containsForbiddenKey(value[i], pathParts.concat(`[${i}]`));
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return pathParts.concat(key).join('.');
    const found = containsForbiddenKey(value[key], pathParts.concat(key));
    if (found) return found;
  }
  return null;
}

// Collector variants of the two forbidden scans: walk the WHOLE payload and
// return every violation instead of stopping at the first, so an admin fixing
// a multi-bank THC export sees the complete list in one pass.
function collectForbiddenKeys(value, pathParts = [], out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) collectForbiddenKeys(value[i], pathParts.concat(`[${i}]`), out);
    return out;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) out.push({ path: pathParts.concat(key).join('.'), type: `forbidden raw-detail field "${key}"` });
    collectForbiddenKeys(value[key], pathParts.concat(key), out);
  }
  return out;
}

function collectForbiddenValues(value, pathParts = [], out = []) {
  if (typeof value === 'string') {
    const found = findForbiddenValue(value, pathParts);
    if (found) out.push({ path: found.path, type: `forbidden ${found.type}` });
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) collectForbiddenValues(value[i], pathParts.concat(`[${i}]`), out);
    return out;
  }
  for (const key of Object.keys(value)) collectForbiddenValues(value[key], pathParts.concat(key), out);
  return out;
}

// "records.[3].summary" / "[3].summary" → 3, so a violation can carry the
// offending record's bank identity.
function violationRecordIndex(pathText) {
  const m = String(pathText || '').match(/^(?:records|banks|summaries)\.\[(\d+)\]/)
    || String(pathText || '').match(/^\[(\d+)\]/);
  return m ? Number(m[1]) : null;
}

function recordsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.records)) return payload.records;
  if (payload && Array.isArray(payload.banks)) return payload.banks;
  if (payload && Array.isArray(payload.summaries)) return payload.summaries;
  return [];
}

function normalizeSummaryRecord(raw, bankById, bankByCert) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const bankIdInput = cleanText(row.bankId || row.id || '', 120);
  const cert = cleanDigits(row.certNumber || row.fdicCert || row.certificate || row.cert);
  const matched = (bankIdInput && bankById.get(bankIdInput)) || (cert && bankByCert.get(cert)) || null;
  const reportStatus = normalizeReportStatus(row.reportStatus || row.reports || row.statuses || row.availableReports);
  const cycle = cleanText(row.cycle || row.period || row.thcCycle || '', 40)
    || Object.values(reportStatus).map(status => status.cycle).filter(Boolean).sort().pop()
    || '';
  const asOfDate = normalizeDate(row.asOfDate || row.portfolioAsOfDate || row.reportDate || row.date)
    || Object.values(reportStatus).map(status => status.date).filter(Boolean).sort().pop()
    || '';
  return {
    bankId: matched ? String(matched.id || '') : bankIdInput,
    bankDisplayName: matched ? cleanText(matched.displayName || matched.name || '', 300) : cleanText(row.bankName || row.name || '', 300),
    certNumber: matched ? cleanDigits(matched.certNumber) : cert,
    cycle,
    asOfDate,
    sourceSystem: cleanText(row.sourceSystem || 'THC', 80) || 'THC',
    importedSourceId: cleanText(row.importedSourceId || row.thcBankId || row.portfolioId || '', 120),
    posture: {
      alm: cleanText(row.almPosture || row.irrPosture || row.posture && row.posture.alm || '', 200),
      policy: cleanText(row.policyStatus || row.withinPolicy || row.posture && row.posture.policy || '', 120),
      summary: cleanMultiline(row.summary || row.talkingPoint || row.posture && row.posture.summary || '', 1000)
    },
    reportStatus,
    metrics: normalizeMetricBlock(row.metrics || row.portfolio || row.snapshot),
    sectorAllocation: normalizeNamedAmountRows(row.sectorAllocation || row.sectors, ['marketValue', 'bookValue', 'amount', 'value']),
    maturityCallWall: normalizeNamedAmountRows(row.maturityCallWall || row.callWall || row.maturityBuckets, ['par', 'amount', 'marketValue']),
    scenarioResults: normalizeScenarioRows(row.scenarioResults || row.scenarios || row.rateShocks),
    tradeSimulation: {
      id: cleanText(row.tradeSimulationId || row.tradeSimulation && row.tradeSimulation.id || '', 120),
      status: normalizeStatus(row.tradeSimulationStatus || row.tradeSimulation && row.tradeSimulation.status || ''),
      date: normalizeDate(row.tradeSimulationDate || row.tradeSimulation && row.tradeSimulation.date || ''),
      summary: cleanMultiline(row.tradeSimulationSummary || row.tradeSimulation && row.tradeSimulation.summary || '', 1000),
      impact: normalizeTradeSimulationImpact(row.tradeSimulationImpact || row.tradeSimulation && row.tradeSimulation.impact)
    },
    adminLink: cleanText(row.adminLink || row.thcLink || row.url || '', 600),
    notes: cleanMultiline(row.notes || '', 1000),
    matched: Boolean(matched)
  };
}

function importThcSummaryPayload(bankReportsDir, payload, options = {}) {
  const rows = recordsFromPayload(payload);
  if (!rows.length) {
    const err = new Error('THC summary import requires a JSON array or { records: [...] }.');
    err.statusCode = 400;
    throw err;
  }
  // Every contract violation, each annotated with the offending record's bank
  // identity when the path sits under a record.
  const violations = [...collectForbiddenKeys(payload), ...collectForbiddenValues(payload)].map(v => {
    const idx = violationRecordIndex(v.path);
    const row = idx != null && rows[idx] && typeof rows[idx] === 'object' ? rows[idx] : null;
    return {
      ...v,
      recordIndex: idx,
      bankName: row ? cleanText(row.bankName || row.name || '', 300) : '',
      certNumber: row ? cleanDigits(row.certNumber || row.fdicCert || row.certificate || row.cert) : ''
    };
  });
  const bankSummaries = options.bankSummaries || [];
  const bankById = new Map(bankSummaries.map(row => [String(row.id || ''), row]));
  const bankByCert = new Map();
  bankSummaries.forEach(row => {
    const cert = cleanDigits(row.certNumber);
    if (cert && !bankByCert.has(cert)) bankByCert.set(cert, row);
  });
  const importedAt = new Date().toISOString();
  const records = rows.map(row => normalizeSummaryRecord(row, bankById, bankByCert))
    .filter(row => row.bankId || row.certNumber || row.bankDisplayName);
  const counts = {
    recordCount: records.length,
    matchedCount: records.filter(row => row.matched).length,
    unmatchedCount: records.filter(row => !row.matched).length
  };
  // Dry run: preview the full violation list + match counts, never write.
  if (options.dryRun) {
    return { dryRun: true, violations, ...counts };
  }
  // A real import still hard-rejects when any violation exists.
  if (violations.length) {
    const first = violations[0];
    const more = violations.length - 1;
    const err = new Error(`THC summary import rejected: ${first.type} at "${first.path}"${more ? ` (+${more} more violation${more === 1 ? '' : 's'})` : ''}.`);
    err.statusCode = 400;
    err.violations = violations;
    throw err;
  }
  const manifest = {
    schemaVersion: 1,
    importedAt,
    sourceFile: cleanText(options.sourceFile || '', 180),
    ...counts,
    contract: {
      allowed: [
        'bankId/certNumber',
        'cycle/asOfDate',
        'reportStatus',
        'portfolio-level metrics',
        'sectorAllocation',
        'maturityCallWall',
        'THC-computed scenario summary',
        'trade simulation summary/status',
        'aggregate trade simulation impact',
        'liquidity/CECL/IncomeRisk status'
      ],
      forbidden: Array.from(FORBIDDEN_KEYS).sort()
    },
    records
  };
  writeJsonAtomic(thcSummaryManifestPathForReportsDir(bankReportsDir), manifest, 2);
  return manifest;
}

function stripThcLinks(record) {
  if (!record || typeof record !== 'object') return record;
  const reportStatus = {};
  Object.entries(record.reportStatus || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object') {
      const { link, ...rest } = value;
      reportStatus[key] = rest;
    }
  });
  const { adminLink, ...rest } = record;
  return { ...rest, reportStatus };
}

function sanitizeThcSummaryForAudience(summary, options = {}) {
  if (!summary) return summary;
  return options.includeAdminLinks ? summary : stripThcLinks(summary);
}

function sanitizeThcSummaryManifest(manifest, options = {}) {
  if (!manifest || options.includeAdminLinks) return manifest;
  return {
    ...manifest,
    records: Array.isArray(manifest.records)
      ? manifest.records.map(record => stripThcLinks(record))
      : []
  };
}

function loadThcSummaryManifest(bankReportsDir) {
  const filePath = thcSummaryManifestPathForReportsDir(bankReportsDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function getThcSummaryStatus(bankReportsDir) {
  const manifest = loadThcSummaryManifest(bankReportsDir);
  if (!manifest) return { available: false };
  return {
    available: true,
    importedAt: manifest.importedAt || '',
    sourceFile: manifest.sourceFile || '',
    recordCount: manifest.recordCount || 0,
    matchedCount: manifest.matchedCount || 0,
    unmatchedCount: manifest.unmatchedCount || 0
  };
}

function getThcSummaryForBank(bankReportsDir, bank, options = {}) {
  const manifest = loadThcSummaryManifest(bankReportsDir);
  if (!manifest || !bank) return null;
  const bankId = String(bank.id || bank.bankId || '');
  const cert = cleanDigits(bank.certNumber || bank.summary && bank.summary.certNumber);
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const record = records.find(row => bankId && String(row.bankId || '') === bankId)
    || records.find(row => cert && cleanDigits(row.certNumber) === cert)
    || null;
  return record ? sanitizeThcSummaryForAudience({
    ...record,
    available: true,
    importedAt: manifest.importedAt || '',
    sourceFile: manifest.sourceFile || ''
  }, options) : null;
}

module.exports = {
  getThcSummaryForBank,
  getThcSummaryStatus,
  importThcSummaryPayload,
  loadThcSummaryManifest,
  sanitizeThcSummaryManifest,
  thcSummaryDirForReportsDir,
  thcSummaryManifestPathForReportsDir,
  _private: {
    collectForbiddenKeys,
    collectForbiddenValues,
    containsForbiddenKey,
    findForbiddenValue,
    normalizeSummaryRecord,
    recordsFromPayload
  }
};
