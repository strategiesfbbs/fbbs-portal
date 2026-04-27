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

function toIsoDate(mdy) {
  const [m, d, y] = mdy.split('/');
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

module.exports = { parseCdOffersText };
