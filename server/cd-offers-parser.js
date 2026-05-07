/**
 * Parser for the Daily CD Offers PDF.
 *
 * Each row in the source has the shape:
 *   [TERM] NAME RATE MATURITY CUSIP SETTLE STATE [RESTRICTIONS...] CPN_FREQ
 *
 * - TERM (e.g. "1m", "3m", "18m", "3y", "5y") only appears on the FIRST
 *   row of each term group; subsequent rows in the same group inherit it.
 * - RATE is a decimal percent (e.g. 3.90).
 * - MATURITY and SETTLE are M/D/YYYY dates.
 * - CUSIP is 9 alphanumerics.
 * - STATE is the 2-letter issuer state code.
 * - RESTRICTIONS is zero or more 2-letter state codes (states where the
 *   CD is NOT eligible for purchase).
 * - CPN_FREQ is one of: at maturity | monthly | semiannually | quarterly | annually
 *
 * The NAME field may contain spaces, slashes, ampersands, and the word
 * "&" — anything up to the first plain decimal rate token.
 */

'use strict';

const XLSX = require('xlsx');

// Known coupon frequency phrases, longest first so we match greedily.
const COUPON_FREQS = [
  'at maturity',
  'semiannually',
  'semi-annually',
  'quarterly',
  'annually',
  'monthly'
];

// Term pattern: "1m", "12m", "3y", "18m", etc.
const TERM_RE = /^(\d+)\s*([my])$/i;

// Rate: "3.90" or "3.9" or "4.0", as its own token.
const RATE_RE = /^\d{1,2}\.\d{1,3}$/;

// Date: M/D/YYYY or MM/DD/YYYY
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

// CUSIP: 9 alphanumerics
const CUSIP_RE = /^[A-Z0-9]{9}$/;

// US state code
const STATE_RE = /^[A-Z]{2}$/;

const EXCEL_COL_ALIASES = {
  term:            ['TERM', 'Term'],
  name:            ['NAME', 'Name', 'Issuer', 'Bank', 'Institution'],
  rate:            ['RATE', 'Rate', 'APY', 'Yield'],
  maturity:        ['MATURITY', 'Maturity', 'Mty'],
  cusip:           ['CUSIP', 'Cusip', 'Security'],
  settle:          ['SETTLE', 'Settle', 'Settlement', 'Settlement Date'],
  issuerState:     ['STATE', 'State', 'Issuer State', 'St'],
  restrictions:    ['RESTRICTIONS', 'Restrictions', 'Restricted States', 'Restriction', 'Not Available In'],
  couponFrequency: ['CPN_FREQ', 'Cpn Freq', 'Coupon Frequency', 'Frequency', 'Payment Frequency', 'Interest Frequency'],
  asOfDate:        ['As Of Date', 'Offer Date']
};

/**
 * Parse the full extracted text of the Daily CD Rates PDF into an array
 * of offering records and metadata about the document.
 *
 * Returns: { asOfDate, offerings, warnings }
 *   - asOfDate: ISO date string (YYYY-MM-DD) if we could find it in the header
 *   - offerings: array of Offering records
 *   - warnings: array of human-readable notes about lines we couldn't parse
 */
function parseCdOffersText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {
    asOfDate: null,
    offerings: [],
    warnings: []
  };

  // Find the "as of" date in the first few lines — "4/23/2026"
  for (const line of lines.slice(0, 5)) {
    const m = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const mm = String(parseInt(m[1], 10)).padStart(2, '0');
      const dd = String(parseInt(m[2], 10)).padStart(2, '0');
      result.asOfDate = `${m[3]}-${mm}-${dd}`;
      break;
    }
  }

  let currentTerm = null;
  let currentTermMonths = null;

  for (const line of lines) {
    // Skip repeated headers, phone, and the title line on page 2+
    if (/^Daily CD Rates\b/i.test(line)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}\s/.test(line)) continue;
    if (/^TERM\s+NAME\s+RATE\b/i.test(line)) continue;
    if (/^P:\s*\(/.test(line)) continue;

    // Tokenize. Preserve multi-word coupon frequency by stripping it from the tail first.
    let remaining = line;
    let cpnFreq = null;
    for (const freq of COUPON_FREQS) {
      if (remaining.toLowerCase().endsWith(' ' + freq) ||
          remaining.toLowerCase() === freq) {
        cpnFreq = freq;
        remaining = remaining.slice(0, remaining.length - freq.length).trim();
        break;
      }
    }
    if (!cpnFreq) {
      // No known frequency → not a data row (likely a section break or other garbage)
      continue;
    }

    const tokens = remaining.split(/\s+/);
    if (tokens.length < 6) {
      result.warnings.push(`Row too short, skipped: ${line}`);
      continue;
    }

    // Check for leading term marker
    let termToken = null;
    const termMatch = tokens[0].match(TERM_RE);
    if (termMatch) {
      termToken = tokens.shift();
      currentTerm = termToken.toLowerCase();
      currentTermMonths = termToken.toLowerCase().endsWith('y')
        ? parseInt(termMatch[1], 10) * 12
        : parseInt(termMatch[1], 10);
    }

    // Find the rate token (first decimal-looking token); everything before it is the name.
    let rateIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (RATE_RE.test(tokens[i])) {
        rateIdx = i;
        break;
      }
    }
    if (rateIdx === -1 || rateIdx === 0) {
      result.warnings.push(`No rate found, skipped: ${line}`);
      continue;
    }

    const name = tokens.slice(0, rateIdx).join(' ').trim();
    const rate = parseFloat(tokens[rateIdx]);
    const maturity = tokens[rateIdx + 1];
    const cusip = tokens[rateIdx + 2];
    const settle = tokens[rateIdx + 3];
    const state = tokens[rateIdx + 4];

    if (!DATE_RE.test(maturity) || !DATE_RE.test(settle) ||
        !CUSIP_RE.test(cusip) || !STATE_RE.test(state)) {
      result.warnings.push(`Malformed row, skipped: ${line}`);
      continue;
    }

    // Remaining tokens between state and end = restriction state codes.
    // The PDF sometimes extracts comma-separated restrictions as "OH," "TX";
    // normalize punctuation before deciding whether a token is valid.
    const restrictionTokens = tokens.slice(rateIdx + 5);
    const { restrictions, unrecognized } = normalizeRestrictions(restrictionTokens);
    if (unrecognized.length) {
      result.warnings.push(`Unrecognized tokens in restrictions: ${line}`);
    }

    if (!currentTerm) {
      result.warnings.push(`Row before any term header, skipped: ${line}`);
      continue;
    }

    result.offerings.push({
      term: currentTerm,
      termMonths: currentTermMonths,
      name,
      rate,
      maturity: toIsoDate(maturity),
      cusip,
      settle: toIsoDate(settle),
      issuerState: state,
      restrictions,
      couponFrequency: normalizeCpnFreq(cpnFreq)
    });
  }

  return result;
}

function parseCdOffersWorkbook(buffer, options = {}) {
  const result = {
    asOfDate: null,
    offerings: [],
    warnings: []
  };

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    result.warnings.push(`Could not parse Excel workbook: ${err.message}`);
    return result;
  }

  for (const sheetName of workbook.SheetNames || []) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });
    if (!rows.length) continue;

    const headerIndex = findHeaderRow(rows);
    if (headerIndex === -1) {
      result.warnings.push(`${sheetName}: could not find a Daily CD Offerings header row`);
      continue;
    }

    if (!result.asOfDate) {
      result.asOfDate = findAsOfDate(rows.slice(0, headerIndex + 1));
    }

    const map = buildExcelHeaderMap(rows[headerIndex]);
    const required = ['name', 'rate', 'maturity', 'cusip'];
    const missing = required.filter(key => map[key] == null);
    if (missing.length) {
      result.warnings.push(`${sheetName}: missing required columns: ${missing.join(', ')}`);
      continue;
    }

    parseWorkbookRows(rows.slice(headerIndex + 1), map, result, sheetName);
  }

  if (!result.asOfDate && options.filename) {
    result.asOfDate = sniffDateFromFilename(options.filename);
  }

  return result;
}

function parseWorkbookRows(rows, map, result, sheetName) {
  let currentTerm = null;
  let currentTermMonths = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isBlankRow(row)) continue;

    const get = key => map[key] == null ? null : row[map[key]];
    const parsedTerm = parseTerm(get('term'));
    if (parsedTerm) {
      currentTerm = parsedTerm.term;
      currentTermMonths = parsedTerm.termMonths;
    }

    const cusip = cleanString(get('cusip')).toUpperCase();
    if (!cusip) continue;
    if (!CUSIP_RE.test(cusip)) {
      result.warnings.push(`${sheetName} row ${i + 2}: skipped invalid CUSIP ${cusip}`);
      continue;
    }

    const name = cleanString(get('name'));
    const rate = toPercentNumber(get('rate'));
    const maturity = toIsoDate(get('maturity'));
    const settle = toIsoDate(get('settle'));
    const issuerState = cleanString(get('issuerState')).toUpperCase();

    if (!name || rate == null || !maturity) {
      result.warnings.push(`${sheetName} row ${i + 2}: skipped (missing name/rate/maturity)`);
      continue;
    }

    let term = currentTerm;
    let termMonths = currentTermMonths;
    if (!termMonths) {
      const inferred = inferTerm(result.asOfDate || settle, maturity);
      if (inferred) {
        term = inferred.term;
        termMonths = inferred.termMonths;
      }
    }

    if (!termMonths) {
      result.warnings.push(`${sheetName} row ${i + 2}: skipped (missing term)`);
      continue;
    }

    const restrictions = parseRestrictions(get('restrictions'));
    const couponFrequency = normalizeCpnFreq(cleanString(get('couponFrequency'))) || null;
    const rowAsOfDate = toIsoDate(get('asOfDate'));
    if (!result.asOfDate && rowAsOfDate) result.asOfDate = rowAsOfDate;

    result.offerings.push({
      term,
      termMonths,
      name,
      rate,
      maturity,
      cusip,
      settle,
      issuerState: STATE_RE.test(issuerState) ? issuerState : '',
      restrictions,
      couponFrequency
    });
  }
}

function toIsoDate(mdy) {
  if (mdy == null || mdy === '') return null;
  if (mdy instanceof Date && !isNaN(mdy)) {
    return `${mdy.getFullYear()}-${String(mdy.getMonth() + 1).padStart(2, '0')}-${String(mdy.getDate()).padStart(2, '0')}`;
  }
  if (typeof mdy === 'number' && isFinite(mdy)) {
    const parsed = XLSX.SSF.parse_date_code(mdy);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(mdy).trim())) return String(mdy).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(String(mdy).trim())) {
    const [m, d, y] = String(mdy).trim().split('/');
    return `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(mdy).trim())) return null;
  const [m, d, y] = String(mdy).trim().split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizeCpnFreq(s) {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'semi-annually') return 'semiannually';
  return lower;
}

function normalizeRestrictions(tokens) {
  const restrictions = [];
  const unrecognized = [];
  for (const token of tokens || []) {
    const parts = String(token)
      .split(',')
      .map(part => part.trim().replace(/^[^A-Z]+|[^A-Z]+$/gi, '').toUpperCase())
      .filter(Boolean);

    if (!parts.length) continue;
    for (const part of parts) {
      if (STATE_RE.test(part)) {
        if (!restrictions.includes(part)) restrictions.push(part);
      } else {
        unrecognized.push(token);
      }
    }
  }
  return { restrictions, unrecognized };
}

function normHeader(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function buildExcelHeaderMap(headerRow) {
  const lookup = {};
  (headerRow || []).forEach((header, index) => {
    const key = normHeader(header);
    if (key) lookup[key] = index;
  });

  const map = {};
  for (const [canonical, aliases] of Object.entries(EXCEL_COL_ALIASES)) {
    for (const alias of aliases) {
      const index = lookup[normHeader(alias)];
      if (index != null) {
        map[canonical] = index;
        break;
      }
    }
  }
  return map;
}

function findHeaderRow(rows) {
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const map = buildExcelHeaderMap(rows[i]);
    const score = ['term', 'name', 'rate', 'maturity', 'cusip', 'settle', 'issuerState', 'couponFrequency']
      .reduce((sum, key) => sum + (map[key] != null ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore >= 4 ? bestIndex : -1;
}

function findAsOfDate(rows) {
  for (const row of rows || []) {
    for (const cell of row || []) {
      const iso = toIsoDate(cell);
      if (iso) return iso;
      const m = String(cell || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }
  return null;
}

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isBlankRow(row) {
  return !row || row.every(cell => cell == null || String(cell).trim() === '');
}

function toPercentNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[%,$]/g, '').replace(/,/g, ''));
  if (!isFinite(n)) return null;
  return n > 0 && n <= 1 ? roundRate(n * 100) : roundRate(n);
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function parseTerm(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) return null;
  let m = raw.match(/^(\d+)\s*([my])$/i);
  if (!m) m = raw.match(/^(\d+)\s*(mo|mos|month|months)$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = String(m[2] || '').toLowerCase();
    const termMonths = unit.startsWith('y') ? n * 12 : n;
    return { term: termMonths % 12 === 0 ? `${termMonths / 12}y` : `${termMonths}m`, termMonths };
  }
  m = raw.match(/^(\d+)\s*(yr|yrs|year|years)$/i);
  if (m) {
    const termMonths = parseInt(m[1], 10) * 12;
    return { term: `${termMonths / 12}y`, termMonths };
  }
  return null;
}

function inferTerm(startIso, maturityIso) {
  if (!startIso || !maturityIso) return null;
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${maturityIso}T00:00:00Z`);
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() - start.getUTCDate() >= 15) months += 1;
  if (months <= 0) return null;
  return { term: months % 12 === 0 ? `${months / 12}y` : `${months}m`, termMonths: months };
}

function parseRestrictions(value) {
  if (value == null || value === '') return [];
  const tokens = String(value).split(/[\s,;/]+/).filter(Boolean);
  return normalizeRestrictions(tokens).restrictions;
}

function sniffDateFromFilename(filename) {
  const name = String(filename || '');
  let m = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = name.match(/(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})(?!\d)/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

module.exports = { parseCdOffersText, parseCdOffersWorkbook };
