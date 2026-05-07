'use strict';

const XLSX = require('xlsx');

const COL_ALIASES = {
  description: ['Description', 'Security', 'Security Description', 'Issue', 'Name', 'Treasury', 'Treasury Note', 'Treasury Notes'],
  cusip:       ['CUSIP', 'Cusip', 'CUSIP(s)', 'Security ID', 'Security Id', 'ID', 'Identifier'],
  coupon:      ['Coupon', 'Cpn', 'Cpn(s)', 'Cpn %', 'Rate', 'Coupon Rate'],
  maturity:    ['Maturity', 'Maturity(s)', 'Mty', 'Due', 'Due Date', 'Final Maturity'],
  settle:      ['Settle', 'Settlement', 'Settlement Date'],
  price:       ['Price', 'Px', 'Ask Price', 'A Px', 'Offer Price', 'Ask Px', 'Net Offer Cost', 'NET OFFER COST'],
  yield:       ['Yield', 'YTM', 'A YTM', 'Ask Yield', 'Yld', 'Yield to Maturity', 'Net Offer YTM', 'NET OFFER YTM'],
  spread:      ['Spread', 'A Spd', 'Ask Spread', 'T Spread', 'T-Spread', 'G Spread', 'OAS'],
  quantity:    ['Quantity', 'Qty', 'Size', 'Available', 'Available Size', 'ASz', 'Par', 'Face', 'Amount', 'Offer Size', 'Ask Amt', 'ASK AMT'],
  benchmark:   ['Benchmark', 'Bench', 'Curve', 'Treasury Benchmark', 'Comp Treasury'],
  type:        ['Type', 'Security Type', 'Product']
};

function parseTreasuryNotesWorkbook(buffer, options = {}) {
  const result = {
    asOfDate: null,
    notes: [],
    warnings: [],
    sources: []
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
      result.warnings.push(`${sheetName}: could not find a Treasury Notes header row`);
      continue;
    }

    if (!result.asOfDate) {
      result.asOfDate = findAsOfDate(rows.slice(0, headerIndex + 1));
    }

    const headers = rows[headerIndex].map(cleanString);
    const map = buildHeaderMap(headers);
    const parsed = parseRows(rows.slice(headerIndex + 1), headers, map, sheetName, result.warnings);
    result.sources.push({ filename: options.filename || null, sheet: sheetName, rowCount: parsed.length });
    result.notes.push(...parsed);
  }

  if (!result.asOfDate && options.filename) {
    result.asOfDate = sniffDateFromFilename(options.filename);
  }

  return result;
}

function parseRows(rows, headers, map, sheetName, warnings) {
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (isBlankRow(row)) continue;

    const get = key => map[key] == null ? null : row[map[key]];
    const rawFields = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const value = normalizeCell(row[idx]);
      if (value !== null && value !== '') rawFields[header] = value;
    });

    const cusip = cleanString(get('cusip')).toUpperCase();
    const maturity = toIsoDate(get('maturity'));
    const coupon = toPercentNumber(get('coupon'));
    const description = cleanString(get('description')) || inferDescription(row) || buildDescription(coupon, maturity);
    const yieldValue = toPercentNumber(get('yield'));
    const price = toNumber(get('price'));
    const spread = toNumber(get('spread'));
    const quantity = parseQuantity(get('quantity'));

    const populatedCoreFields = [
      description,
      cusip,
      coupon,
      maturity,
      price,
      yieldValue,
      spread,
      quantity.value
    ].filter(value => value != null && value !== '').length;

    if (populatedCoreFields < 2) continue;
    if (cusip && !/^[A-Z0-9]{6,12}$/.test(cusip)) {
      warnings.push(`${sheetName} row ${i + 2}: unusual CUSIP "${cusip}"`);
    }

    out.push({
      description,
      cusip,
      coupon,
      maturity,
      settle: toIsoDate(get('settle')),
      price,
      yield: yieldValue,
      spread,
      quantity: quantity.value,
      quantityRaw: quantity.raw,
      benchmark: cleanString(get('benchmark')),
      type: cleanString(get('type')),
      rawFields
    });
  }

  return out;
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 30).forEach((row, index) => {
    const map = buildHeaderMap((row || []).map(cleanString));
    const keys = Object.keys(map);
    let score = keys.length;
    if (map.cusip != null) score += 2;
    if (map.maturity != null) score += 2;
    if (map.coupon != null) score += 1;
    if (map.yield != null || map.price != null) score += 1;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 3 ? best.index : -1;
}

function buildHeaderMap(headers) {
  const lookup = new Map();
  headers.forEach((header, index) => {
    if (!header) return;
    lookup.set(normHeader(header), index);
  });

  const map = {};
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    for (const alias of aliases) {
      const idx = lookup.get(normHeader(alias));
      if (idx != null) {
        map[key] = idx;
        break;
      }
    }
  }
  return map;
}

function findAsOfDate(rows) {
  for (const row of rows) {
    for (let i = 0; i < (row || []).length; i++) {
      const cell = row[i];
      const iso = toIsoDate(cell);
      if (iso && /as\s*of|date/i.test(String(row[i - 1] || '') + ' ' + String(cell || ''))) return iso;
      if (typeof cell === 'string') {
        const m = cell.match(/as\s*of\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
        if (m) return toIsoDate(m[1]);
      }
    }
  }
  return null;
}

function inferDescription(row) {
  const text = (row || []).map(cleanString).filter(Boolean).find(value => /treasury|note|bill|bond|cusip/i.test(value));
  return text || '';
}

function buildDescription(coupon, maturity) {
  const parts = ['Treasury Note'];
  if (coupon != null) parts.push(`${Number(coupon).toFixed(3)}%`);
  if (maturity) parts.push(`due ${maturity}`);
  return parts.join(' ');
}

function normalizeCell(value) {
  if (value == null) return null;
  if (value instanceof Date && !isNaN(value)) return toIsoDate(value);
  if (typeof value === 'number') return Math.round(value * 1000000) / 1000000;
  return cleanString(value);
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const raw = cleanString(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && isFinite(value)) return Math.round(value * 1000000) / 1000000;
  const raw = cleanString(value).replace(/[%,$]/g, '').replace(/,/g, '');
  const n = parseFloat(raw);
  return isFinite(n) ? Math.round(n * 1000000) / 1000000 : null;
}

function toPercentNumber(value) {
  const n = toNumber(value);
  if (n == null) return null;
  const normalized = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(normalized * 1000) / 1000;
}

function parseQuantity(value) {
  if (value == null || value === '') return { value: null, raw: '' };
  const raw = cleanString(value);
  const normalized = raw.replace(/[$,]/g, '').trim();
  const m = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!m) return { value: toNumber(value), raw };
  const base = parseFloat(m[1]);
  const suffix = (m[2] || '').toLowerCase();
  const multiplier = suffix === 'b' ? 1000000000 : suffix === 'm' ? 1000000 : suffix === 'k' ? 1000 : 1;
  return { value: Math.round(base * multiplier), raw };
}

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isBlankRow(row) {
  return !row || row.every(cell => cell == null || cleanString(cell) === '');
}

function normHeader(value) {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

module.exports = { parseTreasuryNotesWorkbook };
