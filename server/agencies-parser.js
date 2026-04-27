/**
 * Parser for Agencies Excel uploads.
 *
 * Traders send two files (or two sheets): one for bullets, one for callables.
 * Both use the same underlying record shape but differ in which columns are
 * populated. This parser reads whichever workbooks are provided, unifies the
 * records under one schema, and adds a `structure` field = 'Bullet' | 'Callable'.
 *
 * Differing columns are preserved as nullable (they don't exist on the opposite
 * structure), so the output is a superset rather than a forced-common schema.
 *
 * Yield conventions observed from trader files:
 *   - YTM:  always delivered as a decimal (e.g. 0.0369 = 3.69%). Always * 100.
 *   - YTNC: usually decimal, but sometimes already in percent form (e.g. 7.755).
 *           Heuristic: values ≤ 1 → decimal, multiply by 100.
 *                      values > 1 → assumed to already be in percent form.
 *   - Coupon: always already in percent form.
 *   - Price: normal (e.g. 100.052).
 *
 * Column aliases observed:
 *   ASz                → availableSize    (MM)
 *   Tkr                → ticker           (FFCB, FHLB, FNMA, FHLMC, FAMCA, FHLM, TVA, etc.)
 *   Cpn                → coupon           (% already)
 *   Mty                → maturity         (ISO)
 *   CUSIP              → cusip
 *   A Spd              → askSpread        (bullets only — bp to benchmark)
 *   Bench              → benchmark        (bullets only — e.g. "2Y", "T 3.75 27")
 *   A Px               → askPrice
 *   A YTM              → ytm              (% after conversion)
 *   A YTNC             → ytnc             (% after conversion; nullable for bullets)
 *   Nxt Call           → nextCallDate     (callables only)
 *   Call Typ           → callType         (callables only — "Anytime", "Quarterly", etc.)
 *   Notes              → notes            (callables only)
 *   Settle             → settle           (callables only)
 *   COST BASIS         → costBasis        (callables only — internal)
 *   COMMISSION /       → commissionBp
 *     Commission (in bp)
 */

'use strict';

const XLSX = require('xlsx');

// ----- Column-name aliases -----
// Keys are CANONICAL; values are arrays of header strings seen in the wild
// (case-insensitive, trimmed comparison).
const COL_ALIASES = {
  availableSize:  ['ASz', 'Available Size', 'Size', 'Qty', 'Quantity'],
  ticker:         ['Tkr', 'Ticker', 'Issuer', 'Agency'],
  coupon:         ['Cpn', 'Coupon'],
  maturity:       ['Mty', 'Maturity'],
  cusip:          ['CUSIP', 'Cusip'],
  askSpread:      ['A Spd', 'Ask Spread', 'Spread'],
  benchmark:      ['Bench', 'Benchmark'],
  askPrice:       ['A Px', 'Ask Price', 'Price'],
  ytm:            ['A YTM', 'YTM', 'Yield to Maturity'],
  ytnc:           ['A YTNC', 'YTNC', 'YTC', 'Yield to Call', 'Yield to Next Call'],
  nextCallDate:   ['Nxt Call', 'Next Call', 'Next Call Date', 'Call Date'],
  callType:       ['Call Typ', 'Call Type'],
  notes:          ['Notes', 'Note', 'Comment'],
  settle:         ['Settle', 'Settlement', 'Settle Date'],
  costBasis:      ['COST BASIS', 'Cost Basis', 'Cost'],
  commissionBp:   ['Commission (in bp)', 'Commission', 'COMMISSION', 'Comm']
};

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildHeaderMap(headers) {
  // Returns { canonicalKey → rawHeader } for headers found in `headers`.
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
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  // M/D/YYYY or MM/DD/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  // MM/DD/YY  → assume 20YY (this is how callables' Settle column comes through)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;  // unknown format — leave as null rather than guess
}

function toNumber(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && isFinite(val)) return val;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

/**
 * Normalize a yield value.
 *   treatment === 'ytm':  always decimal, multiply by 100
 *   treatment === 'ytnc': heuristic — ≤ 1 means decimal, otherwise already pct
 */
function toYieldPct(val, treatment) {
  const n = toNumber(val);
  if (n == null) return null;
  if (treatment === 'ytm') return n * 100;
  if (treatment === 'ytnc') return n <= 1 ? n * 100 : n;
  return n;
}

/**
 * Parse one worksheet into an array of unified offering records.
 */
function parseSheet(worksheet, structure, warnings) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: null });
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const map = buildHeaderMap(headers);

  // Minimal required columns
  const required = ['cusip', 'ticker', 'coupon', 'maturity'];
  const missing = required.filter(k => !map[k]);
  if (missing.length) {
    warnings.push(`${structure} sheet is missing required columns: ${missing.join(', ')}`);
    return [];
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const get = key => map[key] ? row[map[key]] : null;

    const cusip = get('cusip');
    if (!cusip) continue;  // skip trailing blank rows / totals

    const record = {
      structure,
      ticker:         get('ticker'),
      cusip:          String(cusip).trim(),
      coupon:         toNumber(get('coupon')),
      maturity:       toIsoDate(get('maturity')),
      availableSize:  toNumber(get('availableSize')),
      askPrice:       toNumber(get('askPrice')),
      ytm:            toYieldPct(get('ytm'), 'ytm'),
      ytnc:           toYieldPct(get('ytnc'), 'ytnc'),

      // Bullet-only
      askSpread:      toNumber(get('askSpread')),
      benchmark:      get('benchmark') != null ? String(get('benchmark')).trim() : null,

      // Callable-only
      nextCallDate:   toIsoDate(get('nextCallDate')),
      callType:       get('callType') != null ? String(get('callType')).trim() : null,
      notes:          get('notes') != null ? String(get('notes')).trim() : null,
      settle:         toIsoDate(get('settle')),
      costBasis:      toNumber(get('costBasis')),

      commissionBp:   toNumber(get('commissionBp'))
    };

    if (!record.ticker || record.coupon == null || record.maturity == null) {
      warnings.push(`${structure} row ${i+2}: skipped (missing ticker/coupon/maturity)`);
      continue;
    }

    out.push(record);
  }

  return out;
}

/**
 * Classify a workbook as bullets or callables based on sheet name and headers.
 * Falls back to caller-provided hint (from the filename).
 */
function detectStructure(workbook, filenameHint) {
  const sheetName = workbook.SheetNames[0] || '';
  const lower = sheetName.toLowerCase();
  if (lower.includes('bullet')) return 'Bullet';
  if (lower.includes('callable') || lower.includes('call')) return 'Callable';

  // Inspect headers of first sheet for distinguishing columns
  const ws = workbook.Sheets[sheetName];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
    if (rows.length) {
      const headers = Object.keys(rows[0]).map(normKey);
      // Callable-specific columns
      if (headers.includes('nxt call') || headers.includes('call typ') ||
          headers.includes('next call') || headers.includes('call type')) {
        return 'Callable';
      }
      // Bullet-specific columns
      if (headers.includes('a spd') || headers.includes('bench') ||
          headers.includes('benchmark') || headers.includes('ask spread')) {
        return 'Bullet';
      }
    }
  }

  if (filenameHint) {
    const hint = filenameHint.toLowerCase();
    if (hint.includes('bullet')) return 'Bullet';
    if (hint.includes('callable') || hint.includes('call')) return 'Callable';
  }
  return null;
}

/**
 * Main entry point. Accepts an array of { filename, buffer } objects and
 * returns a unified { offerings, warnings, sources }.
 *
 * Each buffer is parsed independently so traders can send:
 *   - two workbooks (one bullet, one callable), OR
 *   - one workbook with both sheets, OR
 *   - just one of the two
 *
 * If a workbook has multiple sheets, each sheet is classified individually.
 */
function parseAgenciesFiles(files) {
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

    // If the workbook has multiple sheets, treat each sheet as its own dataset
    if (wb.SheetNames.length > 1) {
      for (const sn of wb.SheetNames) {
        const subWb = { SheetNames: [sn], Sheets: { [sn]: wb.Sheets[sn] } };
        const structure = detectStructure(subWb, f.filename + ' / ' + sn);
        if (!structure) {
          warnings.push(`${f.filename} sheet "${sn}": cannot determine structure (bullet or callable); skipped`);
          continue;
        }
        const recs = parseSheet(wb.Sheets[sn], structure, warnings);
        sources.push({ filename: f.filename, sheet: sn, structure, rowCount: recs.length });
        offerings.push(...recs);
      }
    } else {
      const structure = detectStructure(wb, f.filename);
      if (!structure) {
        warnings.push(`${f.filename}: cannot determine structure; skipped`);
        continue;
      }
      const recs = parseSheet(wb.Sheets[wb.SheetNames[0]], structure, warnings);
      sources.push({ filename: f.filename, sheet: wb.SheetNames[0], structure, rowCount: recs.length });
      offerings.push(...recs);
    }
  }

  return { offerings, warnings, sources };
}

module.exports = { parseAgenciesFiles };
