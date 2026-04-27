/**
 * Parser for the Corporate Bond Offerings Excel file.
 *
 * Traders send a single workbook with one sheet covering ~200 corporate bonds
 * across sectors (Financial, Industrial, Utilities, etc.). Each row includes
 * Moody's + S&P ratings, a ticker + full issuer name, coupon/maturity, and
 * pricing data including ask yield (YTM), yield to next call (YTNC), price,
 * and a spread-to-benchmark for that bond.
 *
 * Conventions observed from trader files:
 *   - Moody's  (e.g. "A1", "Baa2") and S&P ("A", "BBB", "BBB+") in separate cols
 *   - YTM:   decimal (e.g. 0.0412 = 4.12%). Always * 100.
 *   - YTNC:  decimal like YTM (in agencies it was mixed; here consistently
 *            decimal but we apply the same safety heuristic).
 *   - Coupon: already in percent form.
 *   - Price:  normal (e.g. 100.62).
 *   - Amt Out: string like "550MM" = 550M, "3MMM" = 3000M (3 billion), "1.15MMM" = 1150M.
 *              Parsed into amtOutMM (number, in millions) for filter/sort.
 *   - A Spd:  spread in basis points — can be negative for bonds tighter than benchmark.
 *   - Bench:  e.g. "EDSF", "2Y", "T 4.625 55" (a specific Treasury).
 *
 * Column aliases observed:
 *   Moody          → moodysRating
 *   S&P            → spRating
 *   ASz            → availableSize   (MM)
 *   Issuer         → issuerName      (full company name)
 *   Tkr            → ticker          (short symbol)
 *   Cpn            → coupon          (% already)
 *   Mty            → maturity
 *   Nxt Call       → nextCallDate
 *   Security       → cusip           (this column is the CUSIP)
 *   A Spd          → askSpread       (bp — can be negative)
 *   Bench          → benchmark
 *   A Px           → askPrice
 *   A YTNC         → ytnc            (% after conversion)
 *   A YTM          → ytm             (% after conversion)
 *   Sector         → sector          ("Financial", "Industrial", …)
 *   Amt Out        → amtOutRaw       (original string) + amtOutMM (parsed, millions)
 *   SER            → series          ("MTN", "GMTN", etc.)
 *   Payment Rank   → paymentRank     ("Sr Unsecured", "Subordinated")
 *   Fltr Sprd      → floaterSpread   (not all rows floating; informational)
 */

'use strict';

const XLSX = require('xlsx');

const COL_ALIASES = {
  moodysRating:   ['Moody',        'Moodys', "Moody's"],
  spRating:       ['S&P',          'SP', 'S & P'],
  availableSize:  ['ASz',          'Available Size', 'Size'],
  issuerName:     ['Issuer',       'Issuer Name'],
  ticker:         ['Tkr',          'Ticker', 'Symbol'],
  coupon:         ['Cpn',          'Coupon'],
  maturity:       ['Mty',          'Maturity'],
  nextCallDate:   ['Nxt Call',     'Next Call', 'Next Call Date'],
  cusip:          ['Security',     'CUSIP', 'Cusip'],
  askSpread:      ['A Spd',        'Ask Spread', 'Spread'],
  benchmark:      ['Bench',        'Benchmark'],
  askPrice:       ['A Px',         'Ask Price', 'Price'],
  ytnc:           ['A YTNC',       'YTNC', 'Yield to Next Call'],
  ytm:            ['A YTM',        'YTM', 'Yield to Maturity'],
  sector:         ['Sector'],
  amtOut:         ['Amt Out',      'Amount Outstanding', 'Amt Outstanding'],
  series:         ['SER',          'Series'],
  paymentRank:    ['Payment Rank', 'Rank', 'Seniority'],
  floaterSpread:  ['Fltr Sprd',    'Floater Spread']
};

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildHeaderMap(headers) {
  const lookup = {};
  for (const h of headers) lookup[normKey(h)] = h;
  const map = {};
  for (const [canonical, aliases] of Object.entries(COL_ALIASES)) {
    for (const alias of aliases) {
      const raw = lookup[normKey(alias)];
      if (raw) { map[canonical] = raw; break; }
    }
  }
  return map;
}

function toIsoDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date && !isNaN(val)) {
    return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
  }
  const s = String(val).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function toNumber(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && isFinite(val)) return val;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function toYieldPct(val, treatment) {
  const n = toNumber(val);
  if (n == null) return null;
  if (treatment === 'ytm') return n * 100;
  // YTNC: values ≤ 1 treated as decimal; > 1 already in percent
  return n <= 1 ? n * 100 : n;
}

/**
 * Parse amount outstanding strings like "550MM", "3MMM", "1.15MMM" into
 * a number in MILLIONS. The convention is:
 *   MM  → millions (multiplier 1)
 *   MMM → billions (multiplier 1000)
 *   B   → billions (multiplier 1000) (defensive — not seen but possible)
 *   K   → thousands (multiplier 0.001) (defensive)
 * Returns { raw, mm } so the UI can show the original string for context.
 */
function parseAmtOut(val) {
  if (val == null || val === '') return { raw: null, mm: null };
  const raw = String(val).trim();
  const m = raw.match(/^([\d.,]+)\s*([A-Za-z]+)?$/);
  if (!m) return { raw, mm: null };
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return { raw, mm: null };
  const suffix = (m[2] || '').toUpperCase();
  let mult = 1;
  if (suffix === 'MMM' || suffix === 'B' || suffix === 'BN')      mult = 1000;
  else if (suffix === 'MM' || suffix === 'M')                      mult = 1;
  else if (suffix === 'K')                                         mult = 0.001;
  return { raw, mm: num * mult };
}

/**
 * Broad credit bucket from rating letters. Used for the rating-tier filter.
 * Returns one of: 'AAA/AA', 'A', 'BBB', 'HY', 'NR'
 */
function creditTier(moody, sp) {
  // Prefer S&P for the tier classification (letter codes are intuitive)
  const pick = sp || moody;
  if (!pick) return 'NR';
  const u = String(pick).toUpperCase().replace(/[()]/g, '').trim();
  if (/^AAA/.test(u))                  return 'AAA/AA';
  if (/^AA/.test(u))                   return 'AAA/AA';
  if (/^A[1-3+-]?$/.test(u) || u === 'A') return 'A';
  if (/^BAA/.test(u) || /^BBB/.test(u)) return 'BBB';
  if (/^BA/.test(u) || /^BB/.test(u))   return 'HY';
  if (/^B/.test(u) || /^C/.test(u) || /^D/.test(u)) return 'HY';
  return 'NR';
}

function isInvestmentGrade(moody, sp) {
  const t = creditTier(moody, sp);
  return t === 'AAA/AA' || t === 'A' || t === 'BBB';
}

function parseCorporatesSheet(worksheet, warnings) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: null });
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const map = buildHeaderMap(headers);

  const required = ['cusip', 'issuerName', 'coupon', 'maturity'];
  const missing = required.filter(k => !map[k]);
  if (missing.length) {
    warnings.push(`Corporates sheet missing required columns: ${missing.join(', ')}`);
    return [];
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = key => map[key] ? row[map[key]] : null;

    const cusip = get('cusip');
    if (!cusip) continue;  // skip trailing blank rows / totals

    const moodysRating = get('moodysRating') != null ? String(get('moodysRating')).trim() : null;
    const spRating     = get('spRating')     != null ? String(get('spRating')).trim()     : null;
    const amtOut = parseAmtOut(get('amtOut'));

    const record = {
      cusip:          String(cusip).trim(),
      issuerName:     get('issuerName') != null ? String(get('issuerName')).trim() : null,
      ticker:         get('ticker') != null ? String(get('ticker')).trim() : null,
      moodysRating,
      spRating,
      creditTier:     creditTier(moodysRating, spRating),
      investmentGrade: isInvestmentGrade(moodysRating, spRating),
      coupon:         toNumber(get('coupon')),
      maturity:       toIsoDate(get('maturity')),
      nextCallDate:   toIsoDate(get('nextCallDate')),
      availableSize:  toNumber(get('availableSize')),
      amtOutRaw:      amtOut.raw,
      amtOutMM:       amtOut.mm,
      askPrice:       toNumber(get('askPrice')),
      ytm:            toYieldPct(get('ytm'),  'ytm'),
      ytnc:           toYieldPct(get('ytnc'), 'ytnc'),
      askSpread:      toNumber(get('askSpread')),
      benchmark:      get('benchmark') != null ? String(get('benchmark')).trim() : null,
      sector:         get('sector') != null ? String(get('sector')).trim() : null,
      series:         get('series') != null ? String(get('series')).trim() : null,
      paymentRank:    get('paymentRank') != null ? String(get('paymentRank')).trim() : null,
      floaterSpread:  toNumber(get('floaterSpread'))
    };

    if (!record.issuerName || record.coupon == null || record.maturity == null) {
      warnings.push(`Row ${i+2}: skipped (missing issuer/coupon/maturity)`);
      continue;
    }
    out.push(record);
  }
  return out;
}

/**
 * Top-level entry point. Accepts an array of { filename, buffer } objects.
 * Traders usually send a single workbook but we tolerate multiple.
 */
function parseCorporatesFiles(files) {
  const warnings = [];
  const sources = [];
  const offerings = [];

  for (const f of files) {
    let wb;
    try {
      wb = XLSX.read(f.buffer, { type: 'buffer', cellDates: true });
    } catch (err) {
      warnings.push(`Could not parse ${f.filename}: ${err.message}`);
      continue;
    }
    for (const sn of wb.SheetNames) {
      const recs = parseCorporatesSheet(wb.Sheets[sn], warnings);
      sources.push({ filename: f.filename, sheet: sn, rowCount: recs.length });
      offerings.push(...recs);
    }
  }

  return { offerings, warnings, sources };
}

module.exports = { parseCorporatesFiles };
