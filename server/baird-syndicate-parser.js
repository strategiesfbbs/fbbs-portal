'use strict';

const xlsx = require('./xlsx');

function normalizeHeader(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[$,%\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = String(value).trim();
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!mdy) return null;
  let year = Number(mdy[3]);
  if (year < 100) year += 2000;
  const month = Number(mdy[1]);
  const day = Number(mdy[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function cleanString(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function flagYes(value) {
  return /^y(es)?$/i.test(String(value || '').trim());
}

function sectionForRow(row) {
  if (flagYes(row.bq)) return 'BQ';
  if (flagYes(row.fedTax)) return 'Taxable';
  return 'Municipals';
}

function parseBairdSyndicateWorkbook(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  const result = {
    asOfDate: null,
    warnings: [],
    offerings: []
  };
  if (!sheet) {
    result.warnings.push('Baird Syndicate workbook did not contain a worksheet.');
    return result;
  }

  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const headerIndex = rows.findIndex(row => row.some(cell => normalizeHeader(cell) === 'security'));
  if (headerIndex === -1) {
    result.warnings.push('Baird Syndicate workbook did not contain a Security header row.');
    return result;
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const idx = key => headers.indexOf(key);
  const columns = {
    cusip: idx('security'),
    state: idx('st'),
    issuer: idx('issuer'),
    coupon: idx('cpn'),
    maturity: idx('mty'),
    callDate: idx('nxt call'),
    quantity: idx('a sz'),
    ytc: idx('a ytc'),
    ytm: idx('a ytm'),
    price: idx('a px'),
    moodysRating: idx('moody'),
    spRating: idx('s&p'),
    bq: idx('bq'),
    fedTax: idx('fed tax'),
    totalCuts: idx('total cuts'),
    commission: idx('comm')
  };

  const required = ['cusip', 'state', 'issuer', 'coupon', 'maturity', 'quantity', 'price'];
  for (const key of required) {
    if (columns[key] === -1) result.warnings.push(`Baird Syndicate workbook is missing the ${key} column.`);
  }
  if (required.some(key => columns[key] === -1)) return result;

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = key => columns[key] === -1 ? '' : row[columns[key]];
    const cusip = cleanString(cell('cusip'));
    const issuerName = cleanString(cell('issuer'));
    if (!cusip && !issuerName) continue;

    const coupon = numberOrNull(cell('coupon'));
    const maturity = toIsoDate(cell('maturity'));
    const quantity = numberOrNull(cell('quantity'));
    const price = numberOrNull(cell('price'));
    if (!cusip || !issuerName || coupon == null || !maturity || quantity == null || price == null) {
      result.warnings.push(`Skipped Baird Syndicate row ${r + 1}: missing required bond detail.`);
      continue;
    }

    const ytc = numberOrNull(cell('ytc'));
    const ytm = numberOrNull(cell('ytm'));
    const ytwCandidates = [ytc, ytm].filter(n => Number.isFinite(n));
    const ytw = ytwCandidates.length ? Math.min(...ytwCandidates) : null;
    const bq = cleanString(cell('bq'));
    const fedTax = cleanString(cell('fedTax'));

    result.offerings.push({
      source: 'Baird Syndicate',
      isSyndicate: true,
      section: sectionForRow({ bq, fedTax }),
      moodysRating: cleanString(cell('moodysRating')),
      spRating: cleanString(cell('spRating')),
      quantity,
      issuerState: cleanString(cell('state')),
      issuerName,
      issueType: 'Syndicate',
      coupon,
      maturity,
      callDate: toIsoDate(cell('callDate')),
      ytw,
      ytc,
      ytm,
      price,
      spread: null,
      settle: null,
      couponDate: null,
      cusip,
      creditEnhancement: null,
      bairdBq: bq,
      bairdFedTax: fedTax,
      bairdTotalCuts: numberOrNull(cell('totalCuts')),
      bairdCommission: cleanString(cell('commission'))
    });
  }

  return result;
}

// Content-based detector for the daily folder drop. Desk exports sometimes arrive
// with a generic name (e.g. "grid1_<hash>.xlsx") that the filename classifier can't
// distinguish from a WIRP/Treasury export, so we peek at the workbook itself: a Baird
// Syndicate muni sheet has the Security/St/Issuer/Cpn/Mty/A Sz/A Px column layout and
// yields at least one parseable offering. Treasury and WIRP exports have neither.
function looksLikeBairdSyndicateWorkbook(buffer) {
  let parsed;
  try {
    parsed = parseBairdSyndicateWorkbook(buffer);
  } catch (err) {
    return false;
  }
  return Array.isArray(parsed.offerings) && parsed.offerings.length > 0;
}

module.exports = { parseBairdSyndicateWorkbook, looksLikeBairdSyndicateWorkbook };
