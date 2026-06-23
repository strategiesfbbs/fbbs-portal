/**
 * daily-dashboard.js — Phase 1 of the native Sales Dashboard.
 *
 * Pure, I/O-free candidate layer that ports the FBBS morning dashboard's
 * audience/tax logic into the portal. It takes the live cross-asset offering
 * rows (the `buildAllOfferingsRows()` shape: cusip, assetClass, sector, coupon,
 * yield, ytm, ytnc, maturity, price, state, availabilityK, callDate) and
 * produces a grounded, audience-segmented, availability-screened candidate set
 * with the taxable-equivalent yield worked out for each client tax structure.
 *
 * Discipline (same as offerings-pick.js): every number here is computed from the
 * portal's own parsed inventory — never invented, never carried forward from a
 * prior day. The downstream Claude judgment layer (Phase 2) only RANKS within
 * the candidate set this module builds; it never produces a figure.
 *
 * Conventions ported verbatim from the desk's CLAUDE.md handoff:
 *   - TEY = YTW / (1 − tax_rate)  (§3.1). YTW, never YTM. The displayed TEY
 *     EXCLUDES the TEFRA interest-expense haircut and the 20% C-corp BQ
 *     disallowance — those are disclaimed on the page, not netted here.
 *   - Corporate / agency YTW = min(YTM, YTNC) for callables, YTM otherwise (§3.5).
 *   - Availability floor: a featured pick must have ≥ $250K offered (§4.4).
 *     Sub-$250K stays in inventory only; unknown size never excludes.
 *   - Audience balance: each of C-Corp / S-Corp / RIA should carry ≥3 picks (§2).
 */
'use strict';

const swapMath = require('./swap-math');

const FLOOR_K = 250;            // ≥$250K offered to be a featured pick (§4.4)
const MIN_PER_AUDIENCE = 3;     // audience-coverage target (§2)
const MAX_PER_AUDIENCE = 10;    // cap per-audience candidate list fed downstream
const MAX_CANDIDATES = 90;      // hard cap on the flattened prompt candidate set

// The three client tax structures. Default rates follow the desk convention
// (C-corp 21%, Sub-S 29.6%); the interactive tax-rate selector can override
// them per session. RIA picks are evaluated on a taxable / relative-value basis
// — no muni gross-up, no bank-qualified mechanics.
const AUDIENCES = [
  { key: 'ccorp', label: 'C-Corp Bank',     taxRatePct: 21,   grossUpExemptMuni: true,  bankEligible: true  },
  { key: 'scorp', label: 'S-Corp Bank',     taxRatePct: 29.6, grossUpExemptMuni: true,  bankEligible: true  },
  { key: 'ria',   label: 'RIA / Money Mgr', taxRatePct: 0,    grossUpExemptMuni: false, bankEligible: false },
];
const AUDIENCE_KEYS = AUDIENCES.map(a => a.key);

function num(v) {
  if (v == null || v === '') return null; // Number(null) is 0 — guard it
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cusipKey(v) {
  return String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

/** Asset class of a row, lower-cased and trimmed. */
function classOf(row) {
  return String((row && (row.assetClass || row.type)) || '').toLowerCase();
}

function isMuni(row) {
  return /muni/.test(classOf(row));
}

/** Tax-exempt muni? BQ and standard ("Municipals") are exempt; "Taxable" is not. */
function isExemptMuni(row) {
  if (!isMuni(row)) return false;
  return !/tax/i.test(String((row && row.sector) || ''));
}

function isBankQualified(row) {
  return isMuni(row) && /\bbq\b/i.test(String((row && row.sector) || ''));
}

/**
 * Yield-to-worst for a row, honoring the desk's min(YTM, YTNC) convention for
 * callable agency/corporate paper. Falls back to the row's quoted `yield`
 * (already YTW for munis, the rate for CDs, YTM for treasuries). Pure.
 */
function rowYtw(row) {
  if (!row) return null;
  const legs = [num(row.ytm), num(row.ytnc)].filter(v => v != null);
  if (legs.length) return Math.min(...legs);
  return num(row.yield);
}

/** Offered size in $000, or null when the source doesn't carry a size. */
function availabilityK(row) {
  return row ? num(row.availabilityK) : null;
}

/**
 * Availability floor: a featured pick needs ≥ floorK ($000) offered. Unknown
 * size (null) passes — we only exclude paper we can confirm is too small, so a
 * source that doesn't publish size (CDs, treasuries) is never wrongly dropped.
 */
function meetsAvailabilityFloor(row, floorK = FLOOR_K) {
  const sz = availabilityK(row);
  return sz == null ? true : sz >= floorK;
}

/**
 * Which audiences a row is a candidate for, by asset class and muni sub-bucket.
 * Mirrors the 6/3 dashboard's PICKS_DATA tagging:
 *   - exempt muni (BQ / standard) → bank buyers (ccorp, scorp)
 *   - taxable muni                → ccorp (spread, no TEFRA) + ria
 *   - agency / treasury / MBS     → all three
 *   - CD (FDIC buy-side)          → bank buyers (ccorp, scorp)
 *   - corporate                   → ria only (not bank-eligible)
 *   - structured note             → ria only (yield enhancement)
 * Pure; returns a de-duplicated array of audience keys.
 */
function audiencesForRow(row) {
  const cls = classOf(row);
  if (isMuni(row)) {
    if (isExemptMuni(row)) return ['ccorp', 'scorp'];
    return ['ccorp', 'ria']; // taxable muni
  }
  if (/agency/.test(cls)) return ['ccorp', 'scorp', 'ria'];
  if (/treasury|ust/.test(cls)) return ['ccorp', 'scorp', 'ria'];
  if (/mbs|cmo/.test(cls)) return ['ccorp', 'scorp', 'ria'];
  if (/cd|certificate/.test(cls)) return ['ccorp', 'scorp'];
  if (/corp/.test(cls)) return ['ria'];
  if (/structured|note/.test(cls)) return ['ria'];
  return [];
}

// A marginal tax rate the TEY gross-up stays sane for: 0% ≤ t < 60%. An override
// outside this band (the interactive selector fat-fingered to 100, a negative) is
// ignored and the desk default applies — we never depend on teYield's internal
// clamp (which would silently turn t≥100 into a ~100× effective yield).
const MAX_TAX_RATE_PCT = 60;

function audienceByKey(key, taxRateOverrides) {
  const base = AUDIENCES.find(a => a.key === key);
  if (!base) return null;
  const override = num(taxRateOverrides && taxRateOverrides[key]);
  const taxRatePct = (override != null && override >= 0 && override < MAX_TAX_RATE_PCT) ? override : base.taxRatePct;
  return { ...base, taxRatePct };
}

/**
 * The economics of one row FOR one audience: its YTW, and the effective yield
 * the audience actually earns — taxable-equivalent (YTW/(1−t)) for an exempt
 * muni a bank buyer grosses up, the plain YTW otherwise. Pure.
 *
 * Returns { ytw, effYield, basis, taxRatePct, taxEquivalent } or null if no YTW.
 */
function audienceEconomics(row, audienceKey, taxRateOverrides) {
  const audience = audienceByKey(audienceKey, taxRateOverrides);
  if (!audience) return null;
  const ytw = rowYtw(row);
  if (ytw == null) return null;
  const exempt = isExemptMuni(row);
  if (exempt && audience.grossUpExemptMuni && audience.taxRatePct > 0) {
    const tey = swapMath.teYield(ytw, audience.taxRatePct);
    if (tey != null) {
      return { ytw, effYield: tey, basis: 'TEY', taxRatePct: audience.taxRatePct, taxEquivalent: true };
    }
  }
  return { ytw, effYield: ytw, basis: exempt ? 'tax-exempt' : 'taxable', taxRatePct: audience.taxRatePct, taxEquivalent: false };
}

/** Compact, grounded candidate row for the prompt / UI. Pure. */
function toCandidate(row) {
  return {
    cusip: cusipKey(row.cusip),
    assetClass: row.assetClass || row.type || 'Other',
    sector: row.sector || '',
    state: row.state || '',
    page: row.page || 'all-offerings',
    description: String(row.description || '').slice(0, 120),
    coupon: num(row.coupon),
    ytw: rowYtw(row),
    price: num(row.price),
    maturity: row.maturity || null,
    callDate: row.callDate || null,
    availabilityK: availabilityK(row),
    bq: isBankQualified(row),
    exemptMuni: isExemptMuni(row),
    // Credit ratings, when the source carries them (muni / corporate) — used by
    // the relative-value engine for rating-peer grouping and caveats. Null otherwise.
    moody: row.moody || null,
    sp: row.sp || null,
    creditEnhancement: row.creditEnhancement || null, // muni insurer / state-aid → enhanced MMD scale

    audiences: audiencesForRow(row),
  };
}

/**
 * Build the grounded, audience-segmented candidate set from live offering rows.
 *
 * opts: { floorK?, taxRates? (per-audience override), minPerAudience?,
 *         maxPerAudience?, maxCandidates? }
 *
 * Returns:
 *   {
 *     audiences: [{ key, label, taxRatePct, ... }],
 *     byAudience: { ccorp: [cand…], scorp: [...], ria: [...] },  // sorted by effYield desc
 *     candidates: [cand…],   // flat, de-duped by CUSIP, capped — the prompt set
 *     coverage:   { ccorp: n, scorp: n, ria: n },
 *     coverageOk: bool,      // every audience ≥ minPerAudience
 *     floorK, droppedBelowFloor, screened
 *   }
 * Each candidate carries `econ: { ccorp:{...}, scorp:{...}, ria:{...} }` with the
 * per-audience effective yield, so the UI and the model see the worked tax math.
 */
function buildCandidateSet(rows, opts) {
  const o = opts || {};
  const floorK = num(o.floorK) != null ? num(o.floorK) : FLOOR_K;
  const minPer = num(o.minPerAudience) != null ? num(o.minPerAudience) : MIN_PER_AUDIENCE;
  const maxPer = num(o.maxPerAudience) != null ? num(o.maxPerAudience) : MAX_PER_AUDIENCE;
  const maxCand = num(o.maxCandidates) != null ? num(o.maxCandidates) : MAX_CANDIDATES;
  const taxRates = o.taxRates || null;

  const list = Array.isArray(rows) ? rows : [];
  let droppedBelowFloor = 0;
  const screened = [];
  for (const row of list) {
    const cusip = cusipKey(row && row.cusip);
    if (cusip.length < 6) continue;
    if (rowYtw(row) == null) continue;
    if (!audiencesForRow(row).length) continue;
    if (!meetsAvailabilityFloor(row, floorK)) { droppedBelowFloor += 1; continue; }
    screened.push(row);
  }

  // Per-audience lists, each row carrying its full per-audience economics so we
  // can sort by the yield THAT audience actually earns (TEY for a bank buyer).
  const byAudience = {};
  const candById = new Map();
  for (const key of AUDIENCE_KEYS) {
    const tagged = [];
    for (const row of screened) {
      if (!audiencesForRow(row).includes(key)) continue;
      const cusip = cusipKey(row.cusip);
      let cand = candById.get(cusip);
      if (!cand) {
        cand = toCandidate(row);
        cand.econ = {};
        for (const ak of cand.audiences) cand.econ[ak] = audienceEconomics(row, ak, taxRates);
        candById.set(cusip, cand);
      }
      tagged.push(cand);
    }
    tagged.sort((a, b) => ((b.econ[key] && b.econ[key].effYield) || 0) - ((a.econ[key] && a.econ[key].effYield) || 0));
    byAudience[key] = tagged.slice(0, maxPer);
  }

  // Flatten to a de-duped prompt set: the union of every audience's top list,
  // highest effective yield first (across whichever audience values it most),
  // capped so the downstream prompt stays bounded.
  const bestEff = c => Math.max(...AUDIENCE_KEYS.map(k => (c.econ[k] && c.econ[k].effYield) || 0));
  const flat = Array.from(candById.values())
    .filter(c => AUDIENCE_KEYS.some(k => (byAudience[k] || []).includes(c)))
    .sort((a, b) => bestEff(b) - bestEff(a))
    .slice(0, maxCand);

  const coverage = {};
  for (const key of AUDIENCE_KEYS) coverage[key] = (byAudience[key] || []).length;
  const coverageOk = AUDIENCE_KEYS.every(k => coverage[k] >= minPer);

  const audiences = AUDIENCES.map(a => {
    const resolved = audienceByKey(a.key, taxRates);
    return { key: a.key, label: a.label, taxRatePct: resolved.taxRatePct, bankEligible: a.bankEligible };
  });

  return {
    audiences,
    byAudience,
    candidates: flat,
    coverage,
    coverageOk,
    floorK,
    droppedBelowFloor,
    screened: screened.length,
  };
}

module.exports = {
  AUDIENCES,
  AUDIENCE_KEYS,
  FLOOR_K,
  MIN_PER_AUDIENCE,
  rowYtw,
  availabilityK,
  meetsAvailabilityFloor,
  isMuni,
  isExemptMuni,
  isBankQualified,
  audiencesForRow,
  audienceEconomics,
  toCandidate,
  buildCandidateSet,
};
