/**
 * daily-dashboard-rv.js — the relative-value engine behind the Sales Dashboard.
 *
 * The Phase-1 candidate layer (daily-dashboard.js) answers "who can buy this and
 * what does it yield after tax". This module answers the harder question the desk
 * actually trades on: "is it CHEAP?" — i.e. relative value, not raw yield.
 *
 * Everything here is PURE and I/O-free. It takes the audience-screened candidate
 * set plus three grounded benchmark inputs and attaches a relative-value read to
 * every candidate:
 *   - curve     : the official Treasury par yield curve (market-rates.js tenors)
 *   - fdicCd     : FDIC national average CD rates by term (fred-series.js, NDR*MCD)
 *   - priorMap  : the prior package's per-CUSIP snapshot (for trend detection)
 *
 * The cheapness read, per security:
 *   - matched-Treasury spread (bps) at the security's WORKOUT tenor (interpolated
 *     off the official par curve) — the universal "cheap to Treasury" yardstick;
 *   - for munis, the muni/Treasury yield RATIO and a taxable-equivalent spread
 *     (we have no licensed MMD feed, so ratio + same-rating/maturity peer spread
 *     stand in for "cheap to MMD" — both grounded in our own data + the UST curve);
 *   - for CDs, spread over matched Treasury AND over the FDIC national term rate,
 *     plus spread-per-month-of-term (the short-end reinvestment screen);
 *   - a same-sector / same-maturity / same-rating PEER spread (intra-set value);
 *   - a single RISK-ADJUSTED composite (rvBps) that DOCKS long maturity, call
 *     risk, deep premiums and tiny blocks, so a 30Y never out-ranks a short CD
 *     purely because its absolute yield is higher.
 *
 * Discipline is identical to the rest of the AI layer: this produces NUMBERS from
 * OUR parsed inventory + the official curve only. The downstream Claude layer just
 * ranks/explains; it never sees a benchmark it can move.
 */
'use strict';

const ddTax = require('./daily-dashboard'); // AUDIENCE_KEYS, audienceEconomics, rowYtw

const AUDIENCE_KEYS = ddTax.AUDIENCE_KEYS;

// Maturity buckets — the spine of "best idea per bucket" so long bonds don't
// dominate the board just by carrying more yield. maxY is the inclusive upper
// edge in years; the last bucket is open-ended.
const MATURITY_BUCKETS = [
  { key: '0-1y', label: '0–1Y', maxY: 1 },
  { key: '1-3y', label: '1–3Y', maxY: 3 },
  { key: '3-5y', label: '3–5Y', maxY: 5 },
  { key: '5-7y', label: '5–7Y', maxY: 7 },
  { key: '7-10y', label: '7–10Y', maxY: 10 },
  { key: '10y+', label: '10Y+', maxY: Infinity },
];

// Trend thresholds (vs the prior package).
const TREND_WIDER_BPS = 8;       // spread ≥8bp wider today → "wider" (cheaper)
const TREND_TIGHTER_BPS = 8;     // spread ≥8bp tighter → "richer"
const TREND_PRICE_BPS = 0.25;    // dollar price improved ≥¼pt
const STANDOUT_SCORE = 70;       // RV score ≥70 counts as a "standout"

// Tenor label → years, for interpolating the par curve.
const TENOR_YEARS = {
  '1M': 1 / 12, '2M': 2 / 12, '3M': 0.25, '4M': 4 / 12, '6M': 0.5,
  '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10, '20Y': 20, '30Y': 30,
};

// FDIC national CD term (months) → fred-series key.
const FDIC_CD_TERMS = [
  { months: 3, key: 'ndr3m' }, { months: 6, key: 'ndr6m' }, { months: 12, key: 'ndr12m' },
  { months: 24, key: 'ndr24m' }, { months: 36, key: 'ndr36m' }, { months: 60, key: 'ndr60m' },
];

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round(n, dp = 2) { return n == null ? null : Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp); }
function classOf(c) { return String((c && (c.assetClass || c.type)) || '').toLowerCase(); }
function isMuniClass(c) { return /muni/.test(classOf(c)); }
function isCdClass(c) { return /cd|certificate/.test(classOf(c)); }
function isTreasuryClass(c) { return /treasur|ust/.test(classOf(c)); }
function isAgencyClass(c) { return /agency/.test(classOf(c)); }
function isCorpClass(c) { return /corp/.test(classOf(c)); }

/** Median of a numeric array (sorted copy). null on empty. */
function median(arr) {
  const a = arr.filter(v => v != null && Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Whole years between two ISO/parsable dates, day-count Actual/365.25. */
function yearsBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return null;
  const a = Date.parse(String(fromStr).slice(0, 10));
  const b = Date.parse(String(toStr).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}

function bucketForYears(y) {
  if (y == null) return null;
  for (const b of MATURITY_BUCKETS) if (y <= b.maxY) return b;
  return MATURITY_BUCKETS[MATURITY_BUCKETS.length - 1];
}

/**
 * Linear-interpolate the par curve to `years`. Flat-extrapolates past the ends
 * (a 1M target uses the shortest published tenor, a 35Y uses 30Y). null if the
 * curve has fewer than two usable points. Pure.
 */
function interpolateCurve(tenors, years) {
  if (!tenors || years == null) return null;
  const pts = [];
  for (const [label, yrs] of Object.entries(TENOR_YEARS)) {
    const v = num(tenors[label]);
    if (v != null) pts.push({ yrs, v });
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a.yrs - b.yrs);
  if (years <= pts[0].yrs) return pts[0].v;
  if (years >= pts[pts.length - 1].yrs) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i].yrs) {
      const lo = pts[i - 1], hi = pts[i];
      const w = (years - lo.yrs) / (hi.yrs - lo.yrs);
      return lo.v + w * (hi.v - lo.v);
    }
  }
  return pts[pts.length - 1].v;
}

/** Build a months→rate map from a fred-series indicators payload. {} if absent. */
function fdicCdRateMap(fred) {
  const out = {};
  if (!fred) return out;
  for (const t of FDIC_CD_TERMS) {
    const s = fred[t.key];
    const v = s && num(s.value);
    if (v != null) out[t.months] = v;
  }
  return out;
}

// Rating bucket → the MMD scale column to compare a muni against. BBB/HY fall to
// the Baa scale (the weakest the MMD sheet publishes); NR/unknown default to AAA
// (the conventional reference) and are flagged assumed.
const MMD_GRADE_BY_BUCKET = { AAA: 'aaa', AA: 'aa', A: 'a', BBB: 'baa', HY: 'baa', NR: 'aaa' };
const MMD_GRADE_LABEL = { aaa: 'AAA', aa: 'AA', a: 'A', baa: 'Baa' };

/**
 * Linear-interpolate an MMD scale (parsed `curve` rows {term, aaa, aa, a, baa})
 * to `years` on the chosen grade column, flat-extrapolating past the ends.
 * Falls back to the AAA value when a grade column is missing for a row. Pure.
 */
function interpolateMmd(mmdCurve, gradeKey, years) {
  const rows = mmdCurve && Array.isArray(mmdCurve.curve) ? mmdCurve.curve : null;
  if (!rows || !rows.length || years == null) return null;
  const pts = [];
  for (const r of rows) {
    const term = num(r.term);
    const v = num(r[gradeKey] != null ? r[gradeKey] : r.aaa);
    if (term != null && v != null) pts.push({ yrs: term, v });
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a.yrs - b.yrs);
  if (years <= pts[0].yrs) return pts[0].v;
  if (years >= pts[pts.length - 1].yrs) return pts[pts.length - 1].v;
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i].yrs) {
      const lo = pts[i - 1], hi = pts[i];
      const w = (years - lo.yrs) / (hi.yrs - lo.yrs);
      return lo.v + w * (hi.v - lo.v);
    }
  }
  return pts[pts.length - 1].v;
}

/** Nearest-then-interpolated FDIC national CD rate for a term in months. */
function fdicCdRateForTerm(map, months) {
  const terms = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (!terms.length || months == null) return null;
  if (months <= terms[0]) return map[terms[0]];
  if (months >= terms[terms.length - 1]) return map[terms[terms.length - 1]];
  for (let i = 1; i < terms.length; i++) {
    if (months <= terms[i]) {
      const lo = terms[i - 1], hi = terms[i];
      const w = (months - lo) / (hi - lo);
      return map[lo] + w * (map[hi] - map[lo]);
    }
  }
  return map[terms[terms.length - 1]];
}

// ---------- credit ratings (peer grouping) ----------

const MOODYS = ['aaa', 'aa1', 'aa2', 'aa3', 'a1', 'a2', 'a3', 'baa1', 'baa2', 'baa3', 'ba1', 'ba2', 'ba3', 'b1', 'b2', 'b3', 'caa1', 'caa2', 'caa3', 'ca', 'c'];
const SP = ['aaa', 'aa+', 'aa', 'aa-', 'a+', 'a', 'a-', 'bbb+', 'bbb', 'bbb-', 'bb+', 'bb', 'bb-', 'b+', 'b', 'b-', 'ccc+', 'ccc', 'ccc-', 'cc', 'c', 'd'];

/**
 * Numeric notch for a rating string (1 = Aaa/AAA, higher = weaker). Token-aware:
 * scans whitespace/slash-separated tokens so "Aa3 (stable)", "AA+/Aa1" and the
 * like still parse, while junk placeholders ("#N/A N/A") yield null. null if none.
 */
function ratingNotch(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  for (const tok of s.split(/[\s/,;]+/)) {
    const t = tok.toLowerCase().replace(/[^a-z0-9+-]/g, '');
    if (!t) continue;
    let i = MOODYS.indexOf(t);
    if (i >= 0) return i + 1;
    i = SP.indexOf(t);
    if (i >= 0) return i + 1;
  }
  return null;
}

/** Best (lowest) notch across a candidate's moody/sp/rating fields. null if none. */
function bestNotch(c) {
  const cands = [ratingNotch(c && c.moody), ratingNotch(c && c.sp), ratingNotch(c && c.rating)].filter(v => v != null);
  return cands.length ? Math.min(...cands) : null;
}

/** Coarse rating bucket for peer grouping. 'NR' when no rating is carried. */
function ratingBucket(c) {
  const n = bestNotch(c);
  if (n == null) return 'NR';
  if (n <= 1) return 'AAA';
  if (n <= 4) return 'AA';
  if (n <= 7) return 'A';
  if (n <= 10) return 'BBB';
  return 'HY';
}

/**
 * Human rating label for display — the first parseable rating token across the
 * carried fields, else the coarse bucket ('NR' when nothing parses, so the UI
 * hides the chip rather than showing "#N/A").
 */
function ratingLabel(c) {
  for (const raw of [c && c.moody, c && c.sp, c && c.rating]) {
    const s = String(raw || '').trim();
    if (!s) continue;
    for (const tok of s.split(/[\s/,;]+/)) {
      if (ratingNotch(tok) != null) return tok.toUpperCase();
    }
  }
  return ratingBucket(c);
}

// ---------- workout tenor & term ----------

/**
 * The economically-relevant horizon for spread benchmarking: years to the
 * workout date. A callable priced to its call (YTNC ≤ YTM, or a premium dollar
 * price with a call) works out at the call; otherwise at stated maturity.
 * Returns { effYears, statedYears, basis: 'call'|'maturity', toCall, toMaturity }.
 */
function workoutTenor(c, asOf) {
  const toMaturity = yearsBetween(asOf, c && c.maturity);
  const toCall = yearsBetween(asOf, c && c.callDate);
  const ytm = num(c && c.ytm);
  const ytnc = num(c && c.ytnc);
  const price = num(c && c.price);
  let basis = 'maturity';
  if (toCall != null && toCall > 0) {
    if (ytm != null && ytnc != null && ytnc <= ytm) basis = 'call';
    else if ((ytm == null || ytnc == null) && price != null && price > 100.5) basis = 'call'; // premium callable → priced to call
  }
  const effYears = basis === 'call' ? toCall : (toMaturity != null ? toMaturity : toCall);
  return { effYears, statedYears: toMaturity, basis, toCall, toMaturity };
}

/** CD term in months — from the description ("12m"/"18 mo") else the workout tenor. */
function cdTermMonths(c, effYears) {
  const m = String((c && c.description) || '').match(/(\d{1,3})\s*(?:m\b|mo\b|month)/i);
  if (m) { const v = Number(m[1]); if (Number.isFinite(v) && v > 0 && v <= 600) return v; }
  if (effYears != null && effYears > 0) return Math.round(effYears * 12);
  return null;
}

// ---------- penalties (risk-adjustment, in bp-equivalents) ----------

/**
 * Total bp of "haircut" applied to a security's headline spread so the composite
 * cheapness (rvBps) is risk-adjusted, not a raw-yield proxy. Each component is a
 * grounded, explainable deduction; the cap keeps any single feature from zeroing
 * a genuinely cheap bond.
 */
function structurePenaltyBps(c, w) {
  let p = 0;
  const price = num(c.price);
  // Extension / duration: a long workout is paid for in yield; dock it so a 30Y
  // doesn't win on carry alone. ~2bp per year past 10Y, steepening past 20Y.
  if (w.effYears != null && w.effYears > 10) {
    p += Math.min(40, (w.effYears - 10) * 2);
    if (w.effYears > 20) p += Math.min(20, (w.effYears - 20) * 2);
  }
  // Call risk: a callable worked to its call gives the issuer the option — the
  // realized life can extend if rates rise. Dock premium-priced callables most.
  if (w.basis === 'call') {
    p += 12;
    if (price != null && price > 102) p += Math.min(18, (price - 102) * 3);
  }
  // Deep premium: dollar price well over par amortizes back to par/call.
  if (price != null && price > 105) p += Math.min(25, (price - 105) * 2.5);
  // Small block: a confirmed sub-$500K lot may only fill partially.
  if (c.availabilityK != null && c.availabilityK < 500) p += 10;
  return Math.round(p);
}

// ---------- caveats & buyer types (deterministic, grounded) ----------

const AUD_LABEL = { ccorp: 'C-Corp banks', scorp: 'S-Corp banks', ria: 'RIAs / money managers' };

function buyerTypesFor(c) {
  const auds = Array.isArray(c.audiences) ? c.audiences : [];
  const out = [];
  if (isCdClass(c)) return ['Banks needing FDIC-insured, non-callable short paper'];
  if (isMuniClass(c)) {
    if (c.exemptMuni) {
      out.push(c.bq ? 'Bank-qualified buyers (C-Corp & S-Corp banks)' : 'C-Corp & S-Corp banks');
    } else {
      out.push('C-Corp banks (taxable spread) & RIAs');
    }
    if (c.state) out.push(`In-state ${c.state} accounts`);
    return out;
  }
  if (isCorpClass(c)) return ['RIAs / money managers (not bank-eligible)'];
  // agency / treasury / mbs / structured
  return auds.length ? auds.map(k => AUD_LABEL[k] || k) : ['All client types'];
}

function caveatsFor(c, w, rv) {
  const out = [];
  const price = num(c.price);
  if (w.basis === 'call' && c.callDate) {
    out.push(`Callable ${String(c.callDate).slice(0, 10)} — yield shown is to-call; realized life extends if rates rise.`);
  } else if (c.callDate) {
    out.push(`Callable ${String(c.callDate).slice(0, 10)} — priced to maturity, but the call caps upside.`);
  }
  if (price != null && price > 105) out.push(`Premium dollar price (${round(price)}) — amortizes to par/call; confirm book-yield impact.`);
  else if (price != null && price < 99) out.push(`Discount (${round(price)}) — accretes to par; check OID / de-minimis treatment.`);
  if (w.effYears != null && w.effYears > 10) out.push(`Long ${round(w.effYears, 1)}y effective life — extension/duration risk; size to the curve.`);
  if (c.availabilityK != null && c.availabilityK < 500) out.push(`Small block (~$${Math.round(c.availabilityK)}K) — may fill partially.`);
  const rb = ratingBucket(c);
  if ((isCorpClass(c) || isMuniClass(c)) && (rb === 'BBB' || rb === 'HY')) {
    out.push(`Credit ${ratingLabel(c)} — part of the spread is credit compensation; confirm the name fits the account.`);
  }
  if (isMuniClass(c) && rv && rv.ratioPct != null && rv.ratioPct < 70) {
    out.push(`Rich muni/UST ratio (${Math.round(rv.ratioPct)}%) — value depends on the buyer's tax rate.`);
  }
  if (isCdClass(c)) out.push('FDIC-insured to $250K per depositor per bank; non-callable.');
  return out;
}

// ---------- per-candidate relative value ----------

/**
 * Compute the relative-value read for one candidate against the benchmark inputs.
 * Returns the `rv` object (see module header). Pure.
 */
function rvForCandidate(c, ctx) {
  const { curve, fdicMap, mmdCurve, asOf } = ctx;
  const ytw = num(c.ytw);
  const w = workoutTenor(c, asOf);
  const bucket = bucketForYears(w.effYears);
  const benchmarkYield = curve ? interpolateCurve(curve.tenors || curve, w.effYears) : null;
  const ustSpreadBps = (ytw != null && benchmarkYield != null) ? round((ytw - benchmarkYield) * 100, 0) : null;

  const rv = {
    effYears: round(w.effYears, 2),
    statedYears: round(w.statedYears, 2),
    workoutBasis: w.basis,
    bucket: bucket ? bucket.key : null,
    bucketLabel: bucket ? bucket.label : null,
    benchmarkTenorYears: round(w.effYears, 1),
    benchmarkYield: round(benchmarkYield, 2),
    ustSpreadBps,
    ratioPct: null,
    mmdYield: null,
    mmdSpreadBps: null,
    mmdGrade: null,
    mmdAssumedGrade: false,
    fdicRate: null,
    fdicSpreadBps: null,
    spreadPerMonthBps: null,
    cdTermMonths: null,
    ratingBucket: ratingBucket(c),
    ratingLabel: ratingLabel(c),
    peerKey: null,
    peerMedianYtw: null,
    peerSpreadBps: null,
    peerN: null,
    audSpreadBps: {},
  };

  // Muni: yield ratio to Treasury + spread to the MMD scale matching its grade.
  if (isMuniClass(c) && ytw != null) {
    if (benchmarkYield != null && benchmarkYield > 0) rv.ratioPct = round((ytw / benchmarkYield) * 100, 0);
    if (mmdCurve) {
      const bucket = ratingBucket(c);
      const gradeKey = MMD_GRADE_BY_BUCKET[bucket] || 'aaa';
      const mmdY = interpolateMmd(mmdCurve, gradeKey, w.effYears);
      if (mmdY != null) {
        rv.mmdYield = round(mmdY, 2);
        rv.mmdSpreadBps = round((ytw - mmdY) * 100, 0); // + = cheap to its MMD grade
        rv.mmdGrade = MMD_GRADE_LABEL[gradeKey] || 'AAA';
        rv.mmdAssumedGrade = (bucket === 'NR'); // no carried rating → compared to AAA
      }
    }
  }

  // CD: spread over the FDIC national term rate + spread-per-month of term.
  if (isCdClass(c) && ytw != null) {
    const months = cdTermMonths(c, w.effYears);
    rv.cdTermMonths = months;
    const fdic = fdicCdRateForTerm(fdicMap, months);
    if (fdic != null) {
      rv.fdicRate = round(fdic, 2);
      rv.fdicSpreadBps = round((ytw - fdic) * 100, 0);
    }
    if (ustSpreadBps != null && months) rv.spreadPerMonthBps = round(ustSpreadBps / months, 2);
  }

  // Per-audience tax-aware spread to Treasury (the lens re-ranking key).
  for (const k of AUDIENCE_KEYS) {
    if (!(c.audiences || []).includes(k)) continue;
    const econ = c.econ && c.econ[k];
    const eff = econ && econ.effYield != null ? econ.effYield : ytw;
    if (eff != null && benchmarkYield != null) rv.audSpreadBps[k] = round((eff - benchmarkYield) * 100, 0);
  }

  return { rv, w };
}

/** Peer-group key: sector/structure + maturity bucket (+ rating for credit paper). */
function peerKey(c, rv) {
  const cls = classOf(c);
  const sector = String(c.sector || '').toLowerCase() || cls;
  const b = rv.bucket || 'na';
  if (isMuniClass(c) || isCorpClass(c)) return `${cls}|${rv.ratingBucket}|${b}`;
  return `${cls}|${sector}|${b}`;
}

/**
 * Risk-adjusted composite cheapness, in bp. The headline spread for the class,
 * lightly nudged by the peer spread, minus the structure penalty. This is the
 * single number the cross-asset Leaders board and the per-class boards sort on —
 * the answer to "is it cheap, after accounting for what I'm taking on?".
 */
function compositeRvBps(c, rv, w) {
  let base;
  if (isCdClass(c)) {
    // A CD is value only if it beats BOTH Treasury and the FDIC benchmark.
    const parts = [rv.ustSpreadBps, rv.fdicSpreadBps].filter(v => v != null);
    base = parts.length ? Math.min(...parts) : (rv.ustSpreadBps != null ? rv.ustSpreadBps : 0);
  } else if (isMuniClass(c)) {
    // Compare munis on a bank's taxable-equivalent basis (their natural buyer);
    // ccorp TEY spread is the neutral cross-asset yardstick.
    base = rv.audSpreadBps.ccorp != null ? rv.audSpreadBps.ccorp : (rv.ustSpreadBps != null ? rv.ustSpreadBps : 0);
  } else {
    base = rv.ustSpreadBps != null ? rv.ustSpreadBps : 0;
  }
  const peerNudge = rv.peerSpreadBps != null ? Math.max(-50, Math.min(50, rv.peerSpreadBps)) * 0.5 : 0;
  const penalty = structurePenaltyBps(c, w);
  return Math.round(base + peerNudge - penalty);
}

/** Percentile rank (0–100) of v within sorted ascending values; ties share rank. */
function percentileRank(sorted, v) {
  if (!sorted.length) return null;
  let below = 0;
  for (const x of sorted) { if (x < v) below++; }
  return Math.round((below / Math.max(1, sorted.length - 1)) * 100);
}

// ---------- trend detection ----------

/** A compact per-CUSIP snapshot for persistence + next-day diffing. */
function trendSnapshot(enriched) {
  const map = {};
  for (const c of enriched) {
    map[c.cusip] = { y: c.ytw, p: num(c.price), sp: c.rv ? c.rv.ustSpreadBps : null, s: c.rv ? c.rv.score : null };
  }
  return map;
}

/**
 * Classify each candidate vs the prior package snapshot, in place. Sets
 * c.rv.trend ∈ {new, wider, richer, improved, repeat} + a short trendDetail.
 * "repeated standout" = present yesterday AND a standout both days.
 */
function applyTrends(enriched, priorMap) {
  const have = priorMap && typeof priorMap === 'object' && Object.keys(priorMap).length;
  for (const c of enriched) {
    const rv = c.rv;
    if (!have) { rv.trend = null; rv.trendDetail = null; continue; }
    const prev = priorMap[c.cusip];
    if (!prev) { rv.trend = 'new'; rv.trendDetail = 'New to the run today.'; continue; }
    const dSp = (rv.ustSpreadBps != null && prev.sp != null) ? rv.ustSpreadBps - prev.sp : null;
    const dPrice = (num(c.price) != null && prev.p != null) ? num(c.price) - prev.p : null;
    if (dSp != null && dSp >= TREND_WIDER_BPS) {
      rv.trend = 'wider'; rv.trendDetail = `Spread +${dSp}bp vs prior — cheaper today.`;
    } else if (dSp != null && dSp <= -TREND_TIGHTER_BPS) {
      rv.trend = 'richer'; rv.trendDetail = `Spread ${dSp}bp vs prior — richer today.`;
    } else if (dPrice != null && dPrice <= -TREND_PRICE_BPS) {
      rv.trend = 'improved'; rv.trendDetail = `Price ${round(dPrice, 2)} vs prior — better entry.`;
    } else if (rv.score != null && rv.score >= STANDOUT_SCORE && prev.s != null && prev.s >= STANDOUT_SCORE) {
      rv.trend = 'repeat'; rv.trendDetail = 'Repeated standout — cheap on the run again.';
      rv.repeatStandout = true;
    } else {
      rv.trend = 'repeat'; rv.trendDetail = 'Carried over from the prior run.';
    }
  }
}

// ---------- top-level assembly ----------

function take(arr, n) { return arr.slice(0, n); }

/**
 * Enrich a Phase-1 candidate set with relative value and produce the dashboard
 * sections. Pure given its inputs.
 *
 * opts: {
 *   candidateSet (required — from daily-dashboard.buildCandidateSet),
 *   curve?   (market-rates getLatestYieldCurve response, or { tenors }),
 *   fred?    (fred-series getFredIndicators response — for FDIC CD rates),
 *   asOf?    (package date 'YYYY-MM-DD'; defaults to today is the caller's job),
 *   priorMap?(prior package snapshot for trend detection),
 *   leadersN?, perBoardN?
 * }
 *
 * Returns { asOf, benchmarks, candidates, byAudience, leaders, cheapToTreasury,
 *           cdBoard, muniValue, byBucket, trends, snapshot }.
 */
function buildRelativeValue(opts) {
  const o = opts || {};
  const candidateSet = o.candidateSet;
  if (!candidateSet || !Array.isArray(candidateSet.candidates)) {
    throw new Error('buildRelativeValue requires opts.candidateSet');
  }
  const curve = o.curve || null;
  const fdicMap = fdicCdRateMap(o.fred);
  const mmdCurve = (o.mmd && Array.isArray(o.mmd.curve) && o.mmd.curve.length) ? o.mmd : null;
  const asOf = o.asOf || null;
  const priorMap = o.priorMap || null;
  const leadersN = num(o.leadersN) || 12;
  const perBoardN = num(o.perBoardN) || 8;

  const tenors = curve ? (curve.tenors || curve) : null;
  const ctx = { curve: tenors ? { tenors } : null, fdicMap, mmdCurve, asOf };

  // Pass 1 — per-candidate RV + workout, collected for peer grouping.
  const enriched = candidateSet.candidates.map(c => {
    const { rv, w } = rvForCandidate(c, ctx);
    return Object.assign({}, c, { rv, _w: w });
  });

  // Pass 2 — peer spreads (median YTW within sector/bucket/rating peer group).
  const groups = new Map();
  for (const c of enriched) {
    if (isTreasuryClass(c)) continue; // treasuries ARE the benchmark
    const key = peerKey(c, c.rv);
    c.rv.peerKey = key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [, list] of groups) {
    const med = median(list.map(c => num(c.ytw)));
    for (const c of list) {
      c.rv.peerN = list.length;
      if (med != null && list.length >= 3) {
        c.rv.peerMedianYtw = round(med, 2);
        c.rv.peerSpreadBps = num(c.ytw) != null ? round((num(c.ytw) - med) * 100, 0) : null;
      }
    }
  }

  // Pass 3 — composite risk-adjusted cheapness + cross-asset percentile score.
  for (const c of enriched) c.rv.rvBps = compositeRvBps(c, c.rv, c._w);
  const sortedRv = enriched.map(c => c.rv.rvBps).filter(v => v != null).sort((a, b) => a - b);
  for (const c of enriched) {
    c.rv.score = c.rv.rvBps != null ? percentileRank(sortedRv, c.rv.rvBps) : null;
    delete c._w;
    c.rv.caveats = caveatsFor(c, { effYears: c.rv.effYears, basis: c.rv.workoutBasis }, c.rv);
    c.rv.buyerTypes = buyerTypesFor(c);
  }

  // Pass 4 — trends vs the prior package.
  applyTrends(enriched, priorMap);

  const byCusip = new Map(enriched.map(c => [c.cusip, c]));
  const byRvDesc = (a, b) => (b.rv.rvBps == null ? -Infinity : b.rv.rvBps) - (a.rv.rvBps == null ? -Infinity : a.rv.rvBps);

  // Cross-asset Relative Value Leaders.
  const leaders = enriched.filter(c => c.rv.rvBps != null && !isTreasuryClass(c)).sort(byRvDesc);

  // Cheap to Treasury — taxable paper with a real positive UST spread.
  const cheapToTreasury = enriched
    .filter(c => !isMuniClass(c) && !isTreasuryClass(c) && c.rv.ustSpreadBps != null && c.rv.ustSpreadBps > 0)
    .sort((a, b) => (b.rv.ustSpreadBps - a.rv.ustSpreadBps));

  // CD Value Board — beats both Treasury and FDIC, ranked by spread-per-month.
  const cdBoard = enriched
    .filter(c => isCdClass(c) && c.rv.rvBps != null)
    .sort((a, b) => (b.rv.spreadPerMonthBps == null ? -Infinity : b.rv.spreadPerMonthBps) - (a.rv.spreadPerMonthBps == null ? -Infinity : a.rv.spreadPerMonthBps) || (b.rv.rvBps - a.rv.rvBps));

  // Muni value — cheapest to its MMD grade first (the desk's true muni RV), then
  // the muni/UST ratio, then the ccorp TEY spread. Falls back gracefully when the
  // MMD scale is absent (mmdSpreadBps null sorts last).
  const muniValue = enriched
    .filter(c => isMuniClass(c))
    .sort((a, b) =>
      (b.rv.mmdSpreadBps == null ? -Infinity : b.rv.mmdSpreadBps) - (a.rv.mmdSpreadBps == null ? -Infinity : a.rv.mmdSpreadBps)
      || (b.rv.ratioPct == null ? -Infinity : b.rv.ratioPct) - (a.rv.ratioPct == null ? -Infinity : a.rv.ratioPct)
      || ((b.rv.audSpreadBps.ccorp || -Infinity) - (a.rv.audSpreadBps.ccorp || -Infinity)));

  // Best idea per maturity bucket (so the long end can't sweep the board).
  const byBucket = {};
  for (const b of MATURITY_BUCKETS) {
    const inB = leaders.filter(c => c.rv.bucket === b.key);
    byBucket[b.key] = { label: b.label, count: inB.length, top: take(inB, 3) };
  }

  // Tax-aware audience re-ranking: spread the AUDIENCE earns over Treasury.
  const byAudience = {};
  for (const k of AUDIENCE_KEYS) {
    const pool = enriched.filter(c => (c.audiences || []).includes(k));
    pool.sort((a, b) => ((b.rv.audSpreadBps[k] == null ? -Infinity : b.rv.audSpreadBps[k]) - (a.rv.audSpreadBps[k] == null ? -Infinity : a.rv.audSpreadBps[k])) || byRvDesc(a, b));
    byAudience[k] = pool.map(c => c.cusip);
  }

  // Trend rollups.
  const trends = { new: [], wider: [], improved: [], repeated: [] };
  for (const c of enriched) {
    const t = c.rv.trend;
    if (t === 'new') trends.new.push(c.cusip);
    else if (t === 'wider') trends.wider.push(c.cusip);
    else if (t === 'improved') trends.improved.push(c.cusip);
    if (c.rv.repeatStandout) trends.repeated.push(c.cusip);
  }

  return {
    asOf,
    benchmarks: {
      treasury: !!tenors,
      treasuryAsOf: curve && curve.asOfDate ? curve.asOfDate : null,
      fdicCd: Object.keys(fdicMap).length > 0,
      fdicTerms: fdicMap,
      priorSnapshot: !!(priorMap && Object.keys(priorMap || {}).length),
      mmd: !!mmdCurve, // the desk's daily MMD scale (the `mmd` package slot), by grade
      mmdAsOf: mmdCurve && mmdCurve.asOfDate ? mmdCurve.asOfDate : null,
    },
    candidates: enriched,
    byAudience,
    leaders: take(leaders, leadersN),
    cheapToTreasury: take(cheapToTreasury, perBoardN),
    cdBoard: take(cdBoard, perBoardN),
    muniValue: take(muniValue, perBoardN),
    byBucket,
    trends,
    snapshot: trendSnapshot(enriched),
    byCusip,
  };
}

module.exports = {
  MATURITY_BUCKETS,
  TENOR_YEARS,
  yearsBetween,
  bucketForYears,
  interpolateCurve,
  fdicCdRateMap,
  fdicCdRateForTerm,
  interpolateMmd,
  ratingNotch,
  ratingBucket,
  ratingLabel,
  workoutTenor,
  cdTermMonths,
  structurePenaltyBps,
  buyerTypesFor,
  caveatsFor,
  rvForCandidate,
  compositeRvBps,
  trendSnapshot,
  applyTrends,
  buildRelativeValue,
};
