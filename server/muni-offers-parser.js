/**
 * Parser for the FBBS Municipal Offerings PDF.
 *
 * Each data row in the source has the shape:
 *   [RATINGS...] QNTY ST ISSUER_NAME... ISSUE_TYPE COUPON MATURITY [CALL_DATE]
 *       [YTW YTM PRICE | SPREAD] SETTLE COUPON_DATE CUSIP [CREDIT_ENHANCEMENT...]
 *
 * Where:
 * - RATINGS is a mix of Moody's (mixed-case: Aaa, Aa1–Aa3, A1–A3, Baa1–Baa3)
 *   and S&P (all-caps: AAA, AA+, AA, AA-, A+, A, A-, BBB+ etc.), optionally
 *   with a watchlist parenthetical like "(STA)", "(NEG)", "(POS)", "(DEV)".
 *   A split rating is written "Aaa / Aa3" or "AA / A+ (STA)". Rating tokens
 *   may wrap across multiple lines in the source PDF — this parser reassembles
 *   them before tokenizing.
 * - ISSUE_TYPE is "UT GO", "LTD GO", "REV", "COP", or "GO".
 * - PRICING block is either (YTW, YTM, PRICE) as decimals, OR a spread like
 *   "+40/5YR" (taxable bonds).
 * - CALL_DATE is optional.
 * - CREDIT_ENHANCEMENT is optional and may span multiple tokens (e.g.
 *   "AG / ST INTERCEPT", "Q-SBLF", "PSF-GTD", "BAM").
 *
 * The PDF contains three sections, each with its own header:
 *   "MUNICIPALS - BQ"  → bank-qualified munis          → section: "BQ"
 *   "MUNICIPALS"       → standard tax-exempt munis     → section: "Municipals"
 *   "TAXABLE MUNIS"    → taxable munis                 → section: "Taxable"
 */

'use strict';

const STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','GU','VI'
]);

// Longest-first so "UT GO" beats "GO"
const ISSUE_TYPES = ['UT GO', 'LTD GO', 'REV', 'COP', 'GO'];

// Real CUSIPs are 9 chars alphanumeric AND always contain at least one digit.
// The digit requirement rules out all-letter false positives like "INTERCEPT".
const CUSIP_RE = /^(?=[A-Z0-9]{9}$)[A-Z0-9]*\d[A-Z0-9]*$/;

const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const SPREAD_RE = /^\+\d+\/\d+YR$/i;

const MOODY_RE = /^(Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3]|Ca|C|NR|WR)$/;
const SP_CORE_RE = /^(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D|NR|WR)$/;

// ---------- Utilities ----------

function findIssueTypePos(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    for (const type of ISSUE_TYPES) {
      const parts = type.split(' ');
      if (tokens.slice(i, i + parts.length).join(' ') === type) {
        return { idx: i, length: parts.length, text: type };
      }
    }
  }
  return null;
}

function toIsoDate(mdy) {
  const [m, d, y] = mdy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function normalizeSpreadTokens(tokens) {
  const compact = tokens.join('').toUpperCase();
  return SPREAD_RE.test(compact) ? compact : null;
}

// ---------- Rating extraction ----------

/**
 * Split rating tokens into Moody's and S&P components.
 * Moody's tokens are mixed-case (e.g. "Aa1", "Aaa"); S&P are all-caps.
 * This distinction is stable across the source documents.
 */
function extractRatings(ratingTokens) {
  let moodysRating = null, spRating = null;

  if (ratingTokens.length === 0) return { moodysRating, spRating };

  let splitIdx = -1;
  for (let i = 0; i < ratingTokens.length; i++) {
    const t = ratingTokens[i];
    const core = t.replace(/\/$/, '');
    // S&P core codes are all-caps and match SP_CORE_RE
    if (SP_CORE_RE.test(core) && t === t.toUpperCase()) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx === -1) {
    // No S&P token detected — is anything Moody's?
    const hasMoody = ratingTokens.some(t => MOODY_RE.test(t.replace(/\/$/, '')));
    if (hasMoody) moodysRating = ratingTokens.join(' ');
    else spRating = ratingTokens.join(' ');
  } else if (splitIdx === 0) {
    spRating = ratingTokens.join(' ');
  } else {
    moodysRating = ratingTokens.slice(0, splitIdx).join(' ').replace(/\s*\/\s*$/, '').trim();
    spRating = ratingTokens.slice(splitIdx).join(' ');
  }

  if (moodysRating) moodysRating = moodysRating.replace(/\s+/g, ' ').trim() || null;
  if (spRating)     spRating     = spRating.replace(/\s+/g, ' ').trim() || null;
  return { moodysRating, spRating };
}

// ---------- Row parsing ----------

function parseMuniRow(line, section, warnings) {
  const tokens = line.split(/\s+/);

  const it = findIssueTypePos(tokens);
  if (!it) { warnings.push(`No issue-type found: ${line}`); return null; }

  const left  = tokens.slice(0, it.idx);
  const right = tokens.slice(it.idx + it.length);

  if (right.length < 5) { warnings.push(`Right side too short: ${line}`); return null; }

  // Left side: find the quantity (first integer). Before it → ratings;
  // after it → state, then issuer name.
  let qntyIdx = -1;
  for (let i = 0; i < left.length; i++) {
    if (/^\d+$/.test(left[i])) { qntyIdx = i; break; }
  }
  if (qntyIdx === -1) { warnings.push(`No quantity found: ${line}`); return null; }

  const ratingTokens = left.slice(0, qntyIdx);
  const quantity = parseInt(left[qntyIdx], 10);
  const issuerState = left[qntyIdx + 1];
  if (!issuerState || !STATE_CODES.has(issuerState)) {
    warnings.push(`Expected state code after quantity, got '${issuerState}': ${line}`);
    return null;
  }
  const issuerName = left.slice(qntyIdx + 2).join(' ').trim();

  const { moodysRating, spRating } = extractRatings(ratingTokens);

  // Right side: walk backwards to find CUSIP, then the two dates before it
  // are settle + couponDate. Tokens after CUSIP = credit enhancement.
  let cusipIdx = -1;
  for (let i = right.length - 1; i >= 0; i--) {
    if (CUSIP_RE.test(right[i])) { cusipIdx = i; break; }
  }
  if (cusipIdx === -1) { warnings.push(`No CUSIP found: ${line}`); return null; }

  const creditEnhancement = right.slice(cusipIdx + 1).join(' ').trim() || null;
  const cusip = right[cusipIdx];

  if (cusipIdx < 2 || !DATE_RE.test(right[cusipIdx - 1]) || !DATE_RE.test(right[cusipIdx - 2])) {
    warnings.push(`Expected settle & couponDate before CUSIP: ${line}`);
    return null;
  }
  const couponDate = right[cusipIdx - 1];
  const settle     = right[cusipIdx - 2];

  // Pricing block: coupon, maturity, then optional call date + optional pricing
  const pricingBlock = right.slice(0, cusipIdx - 2);
  if (pricingBlock.length < 2) { warnings.push(`Pricing block too short: ${line}`); return null; }

  const coupon = parseFloat(pricingBlock[0]);
  if (isNaN(coupon)) { warnings.push(`Bad coupon: ${line}`); return null; }
  if (!DATE_RE.test(pricingBlock[1])) { warnings.push(`Bad maturity: ${line}`); return null; }
  const maturity = pricingBlock[1];

  const rem = pricingBlock.slice(2);
  let callDate = null, ytw = null, ytm = null, price = null, spread = null;

  const isNum = t => /^\d+(\.\d+)?$/.test(t);

  let pricingTokens = rem;
  if (DATE_RE.test(pricingTokens[0])) {
    callDate = pricingTokens[0];
    pricingTokens = pricingTokens.slice(1);
  }

  const normalizedSpread = normalizeSpreadTokens(pricingTokens);

  if (pricingTokens.length === 0) {
    // no pricing
  } else if (normalizedSpread) {
    spread = normalizedSpread;
  } else if (pricingTokens.length === 3) {
    if (isNum(pricingTokens[0]) && isNum(pricingTokens[1]) && isNum(pricingTokens[2])) {
      ytw = parseFloat(pricingTokens[0]);
      ytm = parseFloat(pricingTokens[1]);
      price = parseFloat(pricingTokens[2]);
    } else {
      warnings.push(`Unexpected 3-token pricing '${pricingTokens.join(' ')}': ${line}`);
    }
  } else {
    warnings.push(`Unexpected pricing block length ${pricingTokens.length}: ${line}`);
  }

  return {
    section,
    moodysRating,
    spRating,
    quantity,
    issuerState,
    issuerName,
    issueType: it.text,
    coupon,
    maturity: toIsoDate(maturity),
    callDate: callDate ? toIsoDate(callDate) : null,
    ytw,
    ytm,
    price,
    spread,
    settle: toIsoDate(settle),
    couponDate: toIsoDate(couponDate),
    cusip,
    creditEnhancement
  };
}

// ---------- Top-level ----------

/**
 * Recombine lines that are pure rating fragments with the following line.
 *
 * A line is a rating fragment if:
 *   - it ends with "/" (a split rating continues next), OR
 *   - it's a short line (≤ 2 tokens) where the first token is a valid Moody's
 *     rating code.
 */
function recombineRatingLines(rawLines) {
  const out = [];
  let pending = '';
  for (const line of rawLines) {
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const isFragment =
      /\/$/.test(line) ||
      (tokens.length <= 2 && MOODY_RE.test(tokens[0]));
    if (isFragment) {
      pending = pending ? (pending + ' ' + line) : line;
      continue;
    }
    out.push(pending ? pending + ' ' + line : line);
    pending = '';
  }
  if (pending) out.push(pending);
  return out;
}

function hasQuantityStatePrefix(line) {
  const tokens = line.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/^\d+$/.test(tokens[i]) && STATE_CODES.has(tokens[i + 1])) return true;
  }
  return false;
}

function recombineWrappedRows(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (
      next &&
      !findIssueTypePos(line.split(/\s+/)) &&
      findIssueTypePos(next.split(/\s+/)) &&
      hasQuantityStatePrefix(line)
    ) {
      out.push(`${line} ${next}`);
      i++;
      continue;
    }
    out.push(line);
  }
  return out;
}

function parseMuniOffersText(text) {
  const raw = text.split('\n').map(l => l.trim());
  const lines = recombineWrappedRows(recombineRatingLines(raw));

  const result = { asOfDate: null, offerings: [], warnings: [] };

  // As-of date is on its own line, not stuck to other content.
  for (const line of raw) {
    const m = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, mm, dd, y] = m;
      result.asOfDate = `${y}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      break;
    }
  }

  const SECTION_MAP = [
    { re: /^MUNICIPALS\s*-\s*BQ\b/i, name: 'BQ' },
    { re: /^TAXABLE MUNIS\b/i,       name: 'Taxable' },
    { re: /^MUNICIPALS\b/i,          name: 'Municipals' }
  ];

  const NOISE_RES = [
    /^MOODY'S\s+S&P/i,
    /^TYPE\s+COUPON/i,
    /^\*\*\*/,
    /^The information set forth/i,
    /^Neither the information/i,
    /^Investment products are not/i,
    /^First Bankers/i,
    /^FBBSinc\.com/i,
    /^Colorado \| Illinois/i,
    /^Overland Park|^Lincoln, NE|^Oklahoma City/i,
    /^-- \d+ of/
  ];

  let section = null;
  for (const line of lines) {
    // Section header?
    let hitSection = false;
    for (const s of SECTION_MAP) {
      if (s.re.test(line)) { section = s.name; hitSection = true; break; }
    }
    if (hitSection) continue;

    // Noise filters
    if (NOISE_RES.some(re => re.test(line))) continue;
    if (line === 'x' || line === 'ENHANCEMENT') continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) continue;

    if (!section) {
      result.warnings.push(`Row before any section header: ${line}`);
      continue;
    }

    const rec = parseMuniRow(line, section, result.warnings);
    if (rec) result.offerings.push(rec);
  }

  return result;
}

module.exports = { parseMuniOffersText };
