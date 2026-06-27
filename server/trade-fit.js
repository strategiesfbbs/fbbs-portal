/**
 * trade-fit.js — data-backed buyer-pattern signal for the Sales Dashboard.
 *
 * Answers "which client tax-structure (audience) has historically BOUGHT paper
 * like this?" straight from the firm's own Pershing trade history, so the
 * dashboard can nudge a close relative-value call toward proven demand and give
 * a rep a grounded buyer-fit talking point. This REPLACES the first-pass
 * hardcoded rules that lived in daily-dashboard-rv.js.
 *
 * Two halves:
 *   1. buildTradeFitProfile(...) — the I/O half. Reads pershing_trades (customer
 *      BUY rows = "bought by a client"), segments every buy into an audience, and
 *      rolls the history into a small, normalized demand profile per audience:
 *      long-run asset class / maturity demand plus RECENCY-WEIGHTED structure,
 *      size, and price appetite. One pass, cached by the caller; never throws —
 *      a missing DB or column degrades to null and the dashboard simply runs
 *      without the nudge.
 *   2. scoreCandidate(...) — the PURE half. Given that profile and one offering,
 *      returns { score (0–25), reasons[] } describing how well the offering fits
 *      an audience's historical buying. Imported by the relative-value engine so
 *      the engine stays I/O-free and unit-testable.
 *
 * AUDIENCE SEGMENTATION (deterministic):
 *   - a trade with a matched bank → ccorp / scorp by the bank's latest
 *     "Subchapter S Election?" (No → C-corp, Yes → S-corp) from bank-data.sqlite;
 *   - a trade with no bank match (a non-bank Pershing account) → ria, the
 *     taxable / money-manager proxy.
 *
 * DISCIPLINE: this is a FIT NUDGE, never an eligibility gate and never a number
 * the page shows as authoritative. `reasons` are deliberately qualitative (no
 * percentages) so they can be read to a client or handed to the model without
 * introducing a desk-unverified figure. Relative value still decides ranking.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const sqliteDb = require('./sqlite-db');

const PERSHING_DB = 'pershing-accounts.sqlite';
const BANK_DB = 'bank-data.sqlite';

// security_type → the coarse asset class the demand profile keys on. EQUITY /
// MUTFUND / UIT are intentionally absent (not the desk's fixed-income business).
const SECTYPE_CLASS = {
  MONEYMKT: 'cd',     // brokered / money-market CDs
  MUNIDEBT: 'muni',
  GOVTSEC: 'govt',    // treasuries + agencies (the source doesn't split them)
  CORPDEBT: 'corp',
  ASSTBACK: 'mbs',    // ABS / MBS / CMO
};
const PROFILE_CLASSES = ['cd', 'muni', 'govt', 'corp', 'mbs'];

// Maturity bands — the SAME spine the relative-value engine buckets on, so a
// candidate's rv.bucket lines up with the audience's by-band demand.
const BUCKET_KEYS = ['0-1y', '1-3y', '3-5y', '5-7y', '7-10y', '10y+'];

// Recent appetite should matter more than ancient history, but not erase the
// long-run sales memory. A 540-day half-life keeps the current-cycle product mix
// visible while still letting older trades contribute a small stabilizing signal.
const RECENCY_HALF_LIFE_DAYS = 540;
const MIN_RECENCY_WEIGHT = 0.08;

// Audience-label demand verbs for the qualitative reasons (no numbers).
const AUD_NAME = { ccorp: 'C-corp banks', scorp: 'S-corp banks', ria: 'RIAs' };

// ---------- pure helpers (shared by the builder and the scorer) ----------

/** Coarse profile class for a candidate offering (maps to PROFILE_CLASSES). */
function coarseClassOf(c) {
  const cls = String((c && (c.assetClass || c.type)) || '').toLowerCase();
  if (/cd|certificate/.test(cls)) return 'cd';
  if (/muni/.test(cls)) return 'muni';
  if (/treasur|ust|agency/.test(cls)) return 'govt';
  if (/mbs|cmo/.test(cls)) return 'mbs';
  if (/corp/.test(cls)) return 'corp';
  if (/structured|note/.test(cls)) return 'corp'; // closest demand proxy (credit/yield)
  return null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yearsBetween(startDate, endDate) {
  const a = Date.parse(String(startDate || '').slice(0, 10));
  const b = Date.parse(String(endDate || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / (365.25 * 86400000);
}

function bucketForYears(y) {
  if (y == null) return null;
  if (y <= 1) return '0-1y';
  if (y <= 3) return '1-3y';
  if (y <= 5) return '3-5y';
  if (y <= 7) return '5-7y';
  if (y <= 10) return '7-10y';
  return '10y+';
}

function recencyWeight(tradeDate, asOfDate) {
  const age = yearsBetween(tradeDate, asOfDate);
  if (age == null || age < 0) return 1;
  const days = age * 365.25;
  return Math.max(MIN_RECENCY_WEIGHT, Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS));
}

/** Normalize an issuer/description string to a comparable keyword (leading tokens). */
function issuerKeyword(s) {
  const u = String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!u) return '';
  // Drop a leading geographic qualifier that doesn't identify the obligor.
  const tokens = u.split(' ').filter(Boolean);
  return tokens.slice(0, 3).join(' ');
}

function isTreasuryText(text) {
  return /\bUNITED STATES TREAS|\bTREAS(URY)?\b|\bUST\b/.test(String(text || '').toUpperCase());
}

function isAgencyText(text) {
  return /\bFEDERAL HOME LN|\bFHLB\b|\bFEDERAL FARM CR|\bFFCB\b|\bFEDERAL NATL MTG|\bFNMA\b|\bFEDERAL HOME LN MTG|\bFHLMC\b|\bFREDDIE\b|\bFANNIE\b/.test(String(text || '').toUpperCase());
}

function isCallableText(text) {
  return /\bCLB\b|\bCALL|\bCALLABLE\b/.test(String(text || '').toUpperCase());
}

function isCmoText(text) {
  return /\bCMO\b|\bREMIC\b|\bMULTICLASS\b|\bMULTIFAMILYREMIC\b/.test(String(text || '').toUpperCase());
}

function priceBand(price) {
  const p = num(price);
  if (p == null) return null;
  if (p < 95) return 'deep-discount';
  if (p < 99) return 'discount';
  if (p <= 101) return 'par';
  if (p <= 105) return 'premium';
  return 'high-premium';
}

function sizeBand(parOrK, isCandidate) {
  const raw = num(parOrK);
  if (raw == null || raw <= 0) return null;
  const par = isCandidate ? raw * 1000 : Math.abs(raw);
  if (par < 100000) return '<100k';
  if (par < 250000) return '100-250k';
  if (par < 500000) return '250-500k';
  if (par < 1000000) return '500k-1m';
  return '1m+';
}

function finalBucketFromYears(y) {
  if (y == null) return null;
  if (y <= 5.5) return '0-5y';
  if (y <= 10.5) return '5-10y';
  if (y <= 20.5) return '10-20y';
  return '20y+';
}

function productStyleFromParts(parts) {
  const p = parts || {};
  const cls = p.cls || null;
  const text = String(p.text || '').toUpperCase();
  const price = num(p.price);
  const years = p.years;

  if (cls === 'govt') {
    if (isTreasuryText(text)) return 'treasury';
    const agency = isAgencyText(text) || /agency/i.test(String(p.assetClass || ''));
    if (agency || /agency/i.test(text)) {
      const callable = p.callable || isCallableText(text);
      if (callable && price != null && price < 95) return 'agency-callable-deep-discount';
      if (callable && price != null && price < 99) return 'agency-callable-discount';
      if (callable) return 'agency-callable-par-premium';
      return 'agency-bullet';
    }
    return 'government-other';
  }

  if (cls === 'mbs') {
    const finalBucket = finalBucketFromYears(years) || 'unknown';
    if (isCmoText(text) || /cmo/i.test(String(p.assetClass || ''))) return `cmo-${finalBucket}-final`;
    return `mbs-${finalBucket}-final`;
  }

  if (cls === 'cd') return `cd-${bucketForYears(years) || 'unknown'}`;
  if (cls === 'corp') return `corp-${bucketForYears(years) || 'unknown'}`;
  if (cls === 'muni') return `muni-${bucketForYears(years) || 'unknown'}`;
  return cls;
}

function productStyleForTradeRow(row) {
  const st = row && row.st;
  const cls = SECTYPE_CLASS[st];
  if (!cls) return null;
  const text = [row.issuer, row.description].filter(Boolean).join(' ');
  return productStyleFromParts({
    cls,
    text,
    price: row.price,
    years: yearsBetween(row.trade_date, row.maturity_date)
  });
}

function productStyleForCandidate(c) {
  const cls = coarseClassOf(c);
  if (!cls) return null;
  const text = [c && c.assetClass, c && c.sector, c && c.description].filter(Boolean).join(' ');
  const years = c && c.rv && c.rv.statedYears != null ? c.rv.statedYears : null;
  return productStyleFromParts({
    cls,
    text,
    assetClass: c && c.assetClass,
    callable: !!(c && c.callDate),
    price: c && c.price,
    years
  });
}

const STYLE_LABELS = {
  'treasury': 'Treasuries',
  'agency-bullet': 'agency bullets',
  'agency-callable-deep-discount': 'deep-discount callable agencies',
  'agency-callable-discount': 'discount callable agencies',
  'agency-callable-par-premium': 'par/premium callable agencies',
  'government-other': 'government/agency paper',
  'cmo-0-5y-final': 'short-final CMOs',
  'cmo-5-10y-final': '5-10y final CMOs',
  'cmo-10-20y-final': '10-20y final CMOs',
  'cmo-20y+-final': 'long-final CMOs',
  'mbs-0-5y-final': 'short-final MBS',
  'mbs-5-10y-final': '5-10y final MBS',
  'mbs-10-20y-final': '10-20y final MBS',
  'mbs-20y+-final': '20y+ final MBS',
};

function styleLabel(key) {
  if (!key) return '';
  if (STYLE_LABELS[key]) return STYLE_LABELS[key];
  return key.replace(/-/g, ' ');
}

// US state / territory name → postal abbreviation, for parsing muni issuer text
// ("STATE OF, MINNESOTA" → MN). Lower-cased lookup.
const STATE_NAME_TO_ABBR = (() => {
  const m = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
    'district of columbia': 'DC', 'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI',
  };
  return m;
})();

/** Pull a 2-letter state from a muni issuer string ("STATE OF, MINNESOTA" → MN). */
function stateFromIssuer(issuer) {
  const s = String(issuer || '').toLowerCase();
  if (!s) return null;
  // Most muni issuers carry the state name after the last comma.
  const tail = s.split(',').pop().trim();
  if (STATE_NAME_TO_ABBR[tail]) return STATE_NAME_TO_ABBR[tail];
  // Fall back to scanning for any state name as a whole phrase.
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    if (s.includes(name)) return abbr;
  }
  return null;
}

/** Normalize a fraction map so the values sum to 1 (or {} when empty). */
function normalizeShares(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / total;
  return out;
}

// ---------- profile builder (I/O; never throws) ----------

/**
 * Latest non-empty "Subchapter S Election?" per bank id from bank-data.sqlite,
 * for the given set of ids. Returns a Map(bank_id → 'scorp' | 'ccorp'). Reads
 * only the requested rows; tolerant of malformed JSON.
 */
function subchapterAudienceMap(bankDbPath, bankIds) {
  const out = new Map();
  if (!bankIds.length || !fs.existsSync(bankDbPath)) return out;
  const CHUNK = 400;
  for (let i = 0; i < bankIds.length; i += CHUNK) {
    const slice = bankIds.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    let rows = [];
    try {
      rows = sqliteDb.querySqliteJson(bankDbPath, `SELECT id, detail_json FROM banks WHERE id IN (${placeholders});`, slice);
    } catch (_) { return out; } // schema mismatch → degrade to no split
    for (const r of rows) {
      let sub = null;
      try {
        const detail = JSON.parse(r.detail_json || '{}');
        for (const p of (detail.periods || [])) {
          const v = p && p.values && p.values.subchapterS;
          if (v != null && v !== '') sub = v; // periods are oldest→newest; keep the last
        }
      } catch (_) { /* skip malformed */ }
      if (sub == null) continue;
      out.set(String(r.id), /yes/i.test(String(sub)) ? 'scorp' : 'ccorp');
    }
  }
  return out;
}

function emptyAudience() {
  return {
    trades: 0,
    weightedTrades: 0,
    _class: {},
    _bucket: {},
    _recentClass: {},
    _recentBucket: {},
    _style: {},
    _size: {},
    _price: {},
    _state: {},
    _issuer: {}
  };
}

function bump(map, key, n) { if (key) map[key] = (map[key] || 0) + n; }

/**
 * Build the per-audience demand profile from Pershing buy history.
 *
 * opts: { bankReportsDir (required), pershingDbPath?, bankDbPath?, log? }
 * Returns the compact profile object, or null if the trade DB is unavailable /
 * unreadable / empty. NEVER throws.
 */
function buildTradeFitProfile(opts) {
  const o = opts || {};
  const log = o.log || (() => {});
  const dir = o.bankReportsDir || '';
  const pershingDbPath = o.pershingDbPath || path.join(dir, PERSHING_DB);
  const bankDbPath = o.bankDbPath || path.join(dir, BANK_DB);

  try {
    if (!fs.existsSync(pershingDbPath)) return null;

    const sectypeList = Object.keys(SECTYPE_CLASS);
    const inList = sectypeList.map(() => '?').join(',');
    let tradeRows = [];
    let asOf = null;
    try {
      const asOfRow = sqliteDb.querySqliteJson(pershingDbPath, `SELECT MAX(trade_date) AS d FROM pershing_trades WHERE side='BUY';`);
      asOf = asOfRow && asOfRow[0] ? asOfRow[0].d : null;
      tradeRows = sqliteDb.querySqliteJson(pershingDbPath,
        `SELECT COALESCE(bank_id,'') AS bid, security_type AS st, COALESCE(issuer,'') AS issuer, ` +
        `COALESCE(security_description,'') AS description, maturity_date, trade_date, price, coupon, quantity_or_par ` +
        `FROM pershing_trades WHERE side='BUY' AND security_type IN (${inList});`, sectypeList);
    } catch (err) {
      log('warn', `trade-fit: trade query failed (${err && err.message}); skipping nudge`);
      return null;
    }
    if (!tradeRows.length) return null;

    // Resolve the C-corp / S-corp split for every bank id that actually traded.
    const bankIds = [...new Set(tradeRows.map(r => r.bid).filter(Boolean))];
    const audByBank = subchapterAudienceMap(bankDbPath, bankIds);
    const audienceFor = bid => (bid ? (audByBank.get(String(bid)) || 'ccorp') : 'ria');

    const audiences = { ccorp: emptyAudience(), scorp: emptyAudience(), ria: emptyAudience() };
    let totalBuys = 0;
    for (const r of tradeRows) {
      const aud = audiences[audienceFor(r.bid)];
      const cls = SECTYPE_CLASS[r.st];
      const w = recencyWeight(r.trade_date, asOf);
      const bucket = bucketForYears(yearsBetween(r.trade_date, r.maturity_date));
      aud.trades += 1;
      aud.weightedTrades += w;
      totalBuys += 1;
      bump(aud._class, cls, 1);
      bump(aud._recentClass, cls, w);
      bump(aud._bucket, bucket, 1);
      bump(aud._recentBucket, bucket, w);
      bump(aud._style, productStyleForTradeRow(r), w);
      bump(aud._size, sizeBand(r.quantity_or_par, false), w);
      bump(aud._price, priceBand(r.price), w);
      if (r.st === 'MUNIDEBT') {
        const st = stateFromIssuer(r.issuer);
        if (st) bump(aud._state, st, 1);
      }
      const kw = issuerKeyword(r.issuer);
      if (kw) bump(aud._issuer, kw, 1);
    }

    // Finalize: normalized shares + top lists.
    const out = {};
    for (const k of ['ccorp', 'scorp', 'ria']) {
      const a = audiences[k];
      const topIssuers = Object.entries(a._issuer)
        .sort((x, y) => y[1] - x[1]).slice(0, 12)
        .map(([kw]) => kw);
      const topStates = Object.entries(a._state)
        .sort((x, y) => y[1] - x[1]).slice(0, 12)
        .map(([st]) => st);
      out[k] = {
        trades: a.trades,
        weightedTrades: Math.round(a.weightedTrades * 100) / 100,
        byClass: normalizeShares(a._class),
        byRecentClass: normalizeShares(a._recentClass),
        byBucket: normalizeShares(a._bucket),
        byRecentBucket: normalizeShares(a._recentBucket),
        byStyle: normalizeShares(a._style),
        bySize: normalizeShares(a._size),
        byPrice: normalizeShares(a._price),
        byState: normalizeShares(a._state),
        topIssuers,
        topStates,
      };
    }

    const profile = { generatedAt: new Date().toISOString(), asOf: asOf || null, totalBuys, audiences: out };
    log('info', `trade-fit profile built: ${totalBuys} buys (ccorp ${out.ccorp.trades} / scorp ${out.scorp.trades} / ria ${out.ria.trades})`);
    return profile;
  } catch (err) {
    log('warn', `trade-fit: profile build failed (${err && err.message}); skipping nudge`);
    return null;
  }
}

// ---------- scorer (pure) ----------

const MAX_SCORE = 25;

/** Share of an audience's most-bought entry in a shares map (the denominator). */
function topShare(shares) {
  const vals = Object.values(shares || {});
  return vals.length ? Math.max(...vals) : 0;
}

/**
 * Score how well one candidate fits an audience's historical buying. Pure.
 *
 * @param c            a candidate/offering ({ assetClass, state, description })
 * @param profile      the buildTradeFitProfile output (or null)
 * @param audienceKey  'ccorp' | 'scorp' | 'ria'
 * @param bucketKey    the candidate's maturity band (rv.bucket); optional
 * @returns { score: 0–25, reasons: string[] } or null when there is no signal.
 *
 * Components (capped at 25 total):
 *   - asset class       up to 12 — long-run class demand
 *   - maturity band     up to  5 — long-run band demand
 *   - recent structure  up to  6 — recency-weighted product appetite
 *   - size / price      up to  3 — recency-weighted ticket/price comfort
 *   - in-state muni          +4 — a muni in a state the audience has favored
 *   - issuer match           +3 — description matches a top-bought issuer keyword
 */
function scoreCandidate(c, profile, audienceKey, bucketKey) {
  if (!profile || !profile.audiences) return null;
  const ap = profile.audiences[audienceKey];
  if (!ap || !ap.trades) return null;

  const cls = coarseClassOf(c);
  if (!cls) return null;

  // The asset class is the GATE: if this audience has never bought this class, the
  // band/state/issuer signals are irrelevant — there is no demonstrated fit.
  const classShare = ap.byClass[cls] || 0;
  const classTop = topShare(ap.byClass);
  if (!(classShare > 0) || !(classTop > 0)) return null;

  let score = 0;
  const reasons = [];
  const name = AUD_NAME[audienceKey] || audienceKey;

  // Asset-class demand (the dominant component).
  const classPts = Math.round((classShare / classTop) * 12);
  if (classPts > 0) {
    score += classPts;
    const clsLabel = cls === 'cd' ? 'CDs' : cls === 'muni' ? 'munis' : cls === 'govt' ? 'government/agency paper' : cls === 'corp' ? 'corporate credit' : 'MBS/CMO';
    if (classShare >= classTop * 0.85) reasons.push(`${name} buy ${clsLabel} most often`);
    else if (classPts >= 6) reasons.push(`${name} have steady ${clsLabel} demand`);
  }

  // Maturity-band demand.
  if (bucketKey) {
    const bShare = ap.byBucket[bucketKey] || 0;
    const bTop = topShare(ap.byBucket);
    if (bShare > 0 && bTop > 0) {
      const pts = Math.round((bShare / bTop) * 5);
      if (pts > 0) {
        score += pts;
        if (bShare >= bTop * 0.7) reasons.push(`heavy ${name} demand in the ${bucketKey} band`);
      }
    }
  }

  // Recency-weighted structure appetite: this is the nuance layer. If recent
  // trades favor deep-discount callable agencies over bullets, or short-final
  // CMOs over longer MBS, this nudges the close RV calls toward what buyers are
  // actually doing now.
  const style = productStyleForCandidate(c);
  const styleShare = style ? (ap.byStyle && ap.byStyle[style]) || 0 : 0;
  const styleTop = topShare(ap.byStyle);
  if (styleShare > 0 && styleTop > 0) {
    const pts = Math.round((styleShare / styleTop) * 6);
    if (pts > 0) {
      score += pts;
      if (styleShare >= styleTop * 0.65) reasons.push(`recent ${name} flow favors ${styleLabel(style)}`);
      else if (pts >= 3) reasons.push(`recent ${name} flow includes ${styleLabel(style)}`);
    }
  }

  const sz = sizeBand(c && c.availabilityK, true);
  const szShare = sz ? (ap.bySize && ap.bySize[sz]) || 0 : 0;
  const szTop = topShare(ap.bySize);
  if (szShare > 0 && szTop > 0) {
    const pts = Math.min(2, Math.round((szShare / szTop) * 2));
    if (pts > 0) {
      score += pts;
      if (szShare >= szTop * 0.75) reasons.push(`block size fits recent ${name} ticket patterns`);
    }
  }

  const pb = priceBand(c && c.price);
  const pbShare = pb ? (ap.byPrice && ap.byPrice[pb]) || 0 : 0;
  const pbTop = topShare(ap.byPrice);
  if (pbShare > 0 && pbTop > 0) {
    const pts = Math.min(1, Math.round((pbShare / pbTop) * 1));
    if (pts > 0) score += pts;
  }

  // In-state muni demand.
  const st = String((c && c.state) || '').toUpperCase();
  if (cls === 'muni' && st && (ap.byState[st] || 0) > 0) {
    score += 4;
    reasons.push(`${name} have a history of buying ${st} paper`);
  }

  // Issuer-keyword match (corporates / agencies / named credits).
  if (cls !== 'muni') {
    const desc = String((c && c.description) || '').toUpperCase();
    if (desc) {
      const hit = (ap.topIssuers || []).find(kw => kw && desc.includes(kw));
      if (hit) { score += 3; reasons.push(`a repeat ${name} issuer`); }
    }
  }

  score = Math.min(MAX_SCORE, score);
  if (score <= 0) return null;
  return { score, reasons: reasons.slice(0, 3) };
}

/** Per-audience trade-fit for a candidate. Returns { ccorp?, scorp?, ria? } or null. */
function tradeFitForCandidate(c, profile, bucketKey, audienceKeys) {
  if (!profile) return null;
  const keys = audienceKeys || ['ccorp', 'scorp', 'ria'];
  const fit = {};
  for (const k of keys) {
    // Only score audiences the candidate is actually eligible for.
    if (Array.isArray(c.audiences) && !c.audiences.includes(k)) continue;
    const row = scoreCandidate(c, profile, k, bucketKey);
    if (row) fit[k] = row;
  }
  return Object.keys(fit).length ? fit : null;
}

module.exports = {
  buildTradeFitProfile,
  scoreCandidate,
  tradeFitForCandidate,
  coarseClassOf,
  stateFromIssuer,
  issuerKeyword,
  productStyleForCandidate,
  productStyleForTradeRow,
  priceBand,
  sizeBand,
  recencyWeight,
  SECTYPE_CLASS,
  PROFILE_CLASSES,
  BUCKET_KEYS,
  PERSHING_DB,
  BANK_DB,
};
