'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const WIRP_DIRNAME = 'wirp';
const WIRP_WORKBOOK_FILENAME = 'current-wirp-forward-rates.xlsx';
const WIRP_JSON_FILENAME = 'current-wirp-forward-rates.json';

function wirpDir(baseDir) {
  return path.join(baseDir, WIRP_DIRNAME);
}

function wirpWorkbookPath(baseDir) {
  return path.join(wirpDir(baseDir), WIRP_WORKBOOK_FILENAME);
}

function wirpJsonPath(baseDir) {
  return path.join(wirpDir(baseDir), WIRP_JSON_FILENAME);
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanText(value).replace(/,/g, '');
  if (!text || /^n\/?a$/i.test(text)) return null;
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function excelDateToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 30000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = cleanText(value);
  let m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (m) return `${m[3]}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  m = text.match(/\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
  return null;
}

function normalizeHeader(value, index) {
  const text = cleanText(value);
  return text || `Column ${index + 1}`;
}

function findHeaderRow(rows) {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 20).forEach((row, index) => {
    const cells = (row || []).map(cleanText).filter(Boolean);
    if (cells.length < 2) return;
    const joined = cells.join(' ').toLowerCase();
    let score = cells.length;
    if (/meeting|date|fomc|fed|wirp/i.test(joined)) score += 4;
    if (/implied|rate|prob|cut|hike|move/i.test(joined)) score += 5;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function keyForHeader(headers, patterns) {
  return headers.find(header => patterns.some(re => re.test(header.toLowerCase()))) || null;
}

function preferredKeyForHeader(headers, patternGroups) {
  for (const patterns of patternGroups) {
    const found = keyForHeader(headers, patterns);
    if (found) return found;
  }
  return null;
}

function rowObject(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    obj[header] = row[index];
  });
  return obj;
}

function extractRecords(rows) {
  if (!rows.length) return [];
  const headerIndex = findHeaderRow(rows);
  const headers = (rows[headerIndex] || []).map(normalizeHeader);
  const meetingKey = keyForHeader(headers, [/meeting/, /date/, /fomc/]);
  const impliedKey = preferredKeyForHeader(headers, [
    [/^implied rate$/, /implied.*rate/, /rate.*implied/],
    [/expected.*rate/, /weighted.*rate/, /^rate$/]
  ]);
  const moveKey = preferredKeyForHeader(headers, [
    [/imp.*rate.*∆/, /imp.*rate.*delta/, /implied.*rate.*change/],
    [/move.*bps/, /change.*bps/, /^bps$/],
    [/move/, /change/]
  ]);
  const hikesCutsKey = keyForHeader(headers, [/#.*hikes?.*cuts?/, /hikes?.*cuts?/]);
  const probabilityKey = preferredKeyForHeader(headers, [
    [/%.*hike.*cut/, /hike.*cut.*%/],
    [/prob/, /odds/, /chance/]
  ]);

  const records = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row || !row.some(cell => cleanText(cell))) continue;
    const obj = rowObject(headers, row);
    const allCells = row.map(cleanText).filter(Boolean);
    const meetingDate = parseDateFromObject(obj, meetingKey) || allCells.map(parseDateFromText).find(Boolean) || null;
    const impliedRate = impliedKey ? parseNumber(obj[impliedKey]) : inferImpliedRate(headers, row);
    const move = moveKey ? parseNumber(obj[moveKey]) : null;
    const moveBps = move === null ? null : Number((move * 100).toFixed(1));
    const hikesCuts = hikesCutsKey ? parseNumber(obj[hikesCutsKey]) : null;
    const probability = probabilityKey ? parseNumber(obj[probabilityKey]) : null;
    const label = cleanText(meetingKey ? obj[meetingKey] : allCells[0]) || (meetingDate ? `Meeting ${meetingDate}` : '');

    if (!meetingDate && impliedRate === null && moveBps === null && probability === null) continue;
    records.push({
      label,
      meetingDate,
      impliedRate,
      moveBps,
      hikesCuts,
      probability,
      raw: Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, cleanText(value)]))
    });
  }

  return records
    .filter(record => record.impliedRate !== null || record.moveBps !== null || record.probability !== null)
    .sort((a, b) => String(a.meetingDate || '').localeCompare(String(b.meetingDate || '')));
}

function parseDateFromObject(obj, preferredKey) {
  if (preferredKey) {
    const date = excelDateToIso(obj[preferredKey]);
    if (date) return date;
  }
  for (const value of Object.values(obj)) {
    const date = excelDateToIso(value);
    if (date) return date;
  }
  return null;
}

function parseDateFromText(text) {
  return excelDateToIso(text);
}

function inferImpliedRate(headers, row) {
  const candidates = [];
  headers.forEach((header, index) => {
    const lower = header.toLowerCase();
    if (/prob|odds|chance/i.test(lower)) return;
    const n = parseNumber(row[index]);
    if (n === null) return;
    if (/rate|implied|expected|target/i.test(lower)) candidates.unshift(n);
    else candidates.push(n);
  });
  return candidates.find(n => n > 0 && n < 25) ?? null;
}

function summarize(records) {
  const rateRecords = records.filter(row => row.impliedRate !== null);
  if (rateRecords.length < 2) {
    return {
      bias: 'unknown',
      biasLabel: 'Forward path pending',
      expectedChangeBps: null,
      explanation: 'Upload a WIRP export with implied rates to drive forward-rate term selection.'
    };
  }

  const first = rateRecords[0];
  const last = rateRecords[rateRecords.length - 1];
  const expectedChangeBps = Number(((last.impliedRate - first.impliedRate) * 100).toFixed(0));
  let bias = 'flat';
  if (expectedChangeBps <= -25) bias = 'falling';
  else if (expectedChangeBps >= 25) bias = 'rising';

  const biasLabel = bias === 'falling'
    ? 'Market pricing lower policy rates'
    : bias === 'rising'
      ? 'Market pricing firmer policy rates'
      : 'Market pricing a fairly flat path';
  const direction = expectedChangeBps > 0 ? 'higher' : expectedChangeBps < 0 ? 'lower' : 'unchanged';

  return {
    bias,
    biasLabel,
    expectedChangeBps,
    firstMeeting: first.meetingDate || first.label || null,
    lastMeeting: last.meetingDate || last.label || null,
    firstImpliedRate: first.impliedRate,
    lastImpliedRate: last.impliedRate,
    explanation: `WIRP-implied rate path is about ${Math.abs(expectedChangeBps)} bp ${direction} from ${first.meetingDate || first.label || 'first meeting'} to ${last.meetingDate || last.label || 'last meeting'}.`
  };
}

function parseWirpWorkbook(buffer, options = {}) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: true,
    cellText: false
  });
  const sheetSummaries = workbook.SheetNames.map(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: '' });
    const records = extractRecords(rows);
    return { name, rows, records };
  }).sort((a, b) => b.records.length - a.records.length);

  const chosen = sheetSummaries[0] || { name: '', records: [] };
  const records = chosen.records.slice(0, 40);
  const warnings = [];
  if (!records.length) {
    warnings.push('WIRP workbook was stored, but no implied-rate rows were recognized yet.');
  }
  if (sheetSummaries.length > 1 && chosen.records.length) {
    warnings.push(`Parsed WIRP rows from "${chosen.name}" sheet.`);
  }

  return {
    sourceFile: options.sourceFile || 'WIRP export',
    uploadedAt: new Date().toISOString(),
    sheetName: chosen.name || null,
    records,
    summary: summarize(records),
    warnings
  };
}

function saveWirpWorkbook(baseDir, file) {
  fs.mkdirSync(wirpDir(baseDir), { recursive: true });
  fs.writeFileSync(wirpWorkbookPath(baseDir), file.data);
  const parsed = parseWirpWorkbook(file.data, { sourceFile: file.filename });
  fs.writeFileSync(wirpJsonPath(baseDir), JSON.stringify(parsed, null, 2));
  return parsed;
}

function loadWirpAnalysis(baseDir) {
  const jsonPath = wirpJsonPath(baseDir);
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function getWirpStatus(baseDir) {
  const analysis = loadWirpAnalysis(baseDir);
  if (!analysis) return { available: false };
  return {
    available: true,
    sourceFile: analysis.sourceFile,
    uploadedAt: analysis.uploadedAt,
    sheetName: analysis.sheetName,
    recordCount: Array.isArray(analysis.records) ? analysis.records.length : 0,
    summary: analysis.summary || null,
    warnings: analysis.warnings || []
  };
}

module.exports = {
  getWirpStatus,
  loadWirpAnalysis,
  parseWirpWorkbook,
  saveWirpWorkbook
};
