/**
 * FBBS Portal — Bond swap math
 *
 * Pure functions, no I/O. Every public function takes plain inputs and
 * returns plain outputs; nothing reaches into fs, sqlite, or process.env.
 * This file is the canonical home for the day-count, accrued-interest,
 * tax-equivalent-yield, swap-economics, and FBBS-rule-check logic so the
 * server and the regression tests share one implementation.
 *
 * Conventions:
 *   - Yields and rates are passed as percent (e.g. 4.25 means 4.25%).
 *   - Money values are dollars (not thousands or millions).
 *   - Maturity / settle dates are ISO YYYY-MM-DD strings *or* Date objects.
 *   - Inputs may be sparse or messy; functions return `null` for an
 *     unanswerable question rather than throwing, so callers can downstream-
 *     filter on null without try/catch.
 */

'use strict';

// ---------- Helpers ----------

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  // Accept YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, MM-DD-YYYY
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ymd(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addBusinessDays(date, days) {
  const d = new Date(date.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function monthsBetween(startDate, endDate) {
  const a = toDate(startDate);
  const b = toDate(endDate);
  if (!a || !b) return null;
  const days = (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
  return days / (365.25 / 12);
}

function monthsUntilMaturity(maturityDate, asOfDate) {
  return monthsBetween(asOfDate || new Date(), maturityDate);
}

// ---------- Settle date ----------

const SETTLE_T_PLUS = {
  default: 1,
  treasury: 1,
  agency: 1,
  corporate: 1,
  cd: 1,
  muni: 2
};

function defaultSettleDate(asOfDate, sector) {
  const d = toDate(asOfDate) || new Date();
  const key = String(sector || 'default').toLowerCase();
  const tPlus = SETTLE_T_PLUS[key] != null ? SETTLE_T_PLUS[key] : SETTLE_T_PLUS.default;
  return addBusinessDays(d, tPlus);
}

// ---------- Day count ----------
//
// 30/360 (bond basis): standard for muni, corporate, CD.
// Actual/Actual (ISMA): standard for treasuries and agencies.

function days30_360(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return null;
  let d1 = a.getUTCDate(), m1 = a.getUTCMonth() + 1, y1 = a.getUTCFullYear();
  let d2 = b.getUTCDate(), m2 = b.getUTCMonth() + 1, y2 = b.getUTCFullYear();
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 >= 30) d2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

function daysActual(start, end) {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function defaultDayCountForSector(sector) {
  const s = String(sector || '').toLowerCase();
  if (s.includes('treasury')) return 'actual/actual';
  if (s.includes('agency') && !s.includes('mbs') && !s.includes('cmo')) return 'actual/actual';
  // MBS / CMO use 30/360 for accrued in practice
  return '30/360';
}

// ---------- Accrued interest ----------
//
// accrued = par * (coupon / 100) * (days_since_last_coupon / days_in_year)
// We infer last-coupon by walking back from maturity in `frequency` steps,
// then taking the most recent step that's ≤ settle.

function inferLastCouponDate(maturityDate, settleDate, frequency) {
  const mat = toDate(maturityDate);
  const settle = toDate(settleDate);
  if (!mat || !settle) return null;
  const monthsPerCoupon = 12 / (frequency || 2);
  let candidate = new Date(mat.getTime());
  while (candidate > settle) {
    candidate.setUTCMonth(candidate.getUTCMonth() - monthsPerCoupon);
  }
  return candidate;
}

function accruedInterest({ par, coupon, maturity, lastCouponDate, settleDate, dayCount, frequency }) {
  const p = num(par);
  const c = num(coupon);
  if (p == null || c == null || p <= 0 || c <= 0) return 0;
  const settle = toDate(settleDate);
  if (!settle) return null;
  const freq = frequency || 2;
  const last = toDate(lastCouponDate) || inferLastCouponDate(maturity, settle, freq);
  if (!last) return null;
  const basis = dayCount === 'actual/actual' ? 'actual' : '30/360';
  let daysAccrued, daysInYear;
  if (basis === '30/360') {
    daysAccrued = days30_360(last, settle);
    daysInYear = 360;
  } else {
    daysAccrued = daysActual(last, settle);
    daysInYear = 365;
  }
  if (daysAccrued == null || daysAccrued < 0) return 0;
  return p * (c / 100) * (daysAccrued / daysInYear);
}

// ---------- Tax-equivalent yield ----------
//
// Banks default to 21% federal corporate (C-corp) or 29.6% (Sub-S pass-through).
// FBBS convention reads the bank's `Subchapter S Election?` field directly.

const TAX_RATE_C_CORP = 21;
const TAX_RATE_SUB_S = 29.6;

function defaultTaxRate({ isSubchapterS }) {
  return isSubchapterS ? TAX_RATE_SUB_S : TAX_RATE_C_CORP;
}

// ---------- Yield / duration from price ----------
//
// Many parsed portfolio workbooks omit yield-to-maturity and modified
// duration columns (40% of sampled holdings, 100% for duration as of
// May 2026). Those values are computable from price + coupon + maturity
// when the workbook ships them blank. The math:
//   PV = sum over k=1..N of [(C/f) / (1+y/f)^k] + 100 / (1+y/f)^N
// is solved for y by bisection (robust; converges in ~25 iters within
// 1e-6 yield bps).
//
// Approximation cap: we don't model irregular coupons, partial periods,
// or call schedules — fine for an internal portfolio yield, not for
// pricing OAS-sensitive callables. Skip the call_date entirely; if the
// rep needs YTC they can type it.

function _bondPV(yieldFrac, couponPerPeriod, periodsRemaining, periodFraction) {
  // periodFraction is the residual fraction of a period until first coupon
  // (0..1). For a fresh-issue bond on a coupon date it's 1.0 (full period).
  // Cash flows: at t = periodFraction, then periodFraction+1, etc.
  let pv = 0;
  for (let k = 0; k < periodsRemaining; k++) {
    const t = periodFraction + k;
    pv += couponPerPeriod / Math.pow(1 + yieldFrac, t);
  }
  // Final par redemption coincides with the last coupon.
  pv += 100 / Math.pow(1 + yieldFrac, periodFraction + (periodsRemaining - 1));
  return pv;
}

function yieldFromPriceAndMaturity({ price, coupon, maturity, settleDate, frequency = 2 }) {
  const p = num(price);
  const c = num(coupon);
  const settle = toDate(settleDate);
  const mat = toDate(maturity);
  if (p == null || c == null || !settle || !mat) return null;
  if (p <= 0 || c < 0) return null;
  if (mat <= settle) return null;
  const freq = frequency || 2;
  const couponPerPeriod = c / freq;

  // Count remaining coupons (semi-annual = every 6 months).
  // Start from maturity, walk back; count the dates strictly after settle.
  let periodsRemaining = 0;
  let lastCouponBeforeSettle = new Date(mat.getTime());
  // Move back until we cross settle
  const monthsPerCoupon = 12 / freq;
  while (lastCouponBeforeSettle > settle) {
    periodsRemaining++;
    lastCouponBeforeSettle = new Date(lastCouponBeforeSettle.getTime());
    lastCouponBeforeSettle.setUTCMonth(lastCouponBeforeSettle.getUTCMonth() - monthsPerCoupon);
  }
  if (periodsRemaining < 1) return null;
  // periodFraction = days from settle to next coupon / days in full period
  const nextCoupon = new Date(lastCouponBeforeSettle.getTime());
  nextCoupon.setUTCMonth(nextCoupon.getUTCMonth() + monthsPerCoupon);
  const fullPeriodDays = (nextCoupon.getTime() - lastCouponBeforeSettle.getTime()) / (1000 * 60 * 60 * 24);
  const remainingDays = (nextCoupon.getTime() - settle.getTime()) / (1000 * 60 * 60 * 24);
  const periodFraction = fullPeriodDays > 0 ? Math.max(0, Math.min(1, remainingDays / fullPeriodDays)) : 1;

  // Bisect over yield in [-5%, 30%] annual → [-2.5%, 15%] per period at f=2.
  let lo = -0.05 / freq;
  let hi = 0.30 / freq;
  let yLo = _bondPV(lo, couponPerPeriod, periodsRemaining, periodFraction) - p;
  let yHi = _bondPV(hi, couponPerPeriod, periodsRemaining, periodFraction) - p;
  if (yLo * yHi > 0) return null; // root outside bracket; bad data
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const yMid = _bondPV(mid, couponPerPeriod, periodsRemaining, periodFraction) - p;
    if (Math.abs(yMid) < 1e-7) return mid * freq * 100;
    if (yLo * yMid < 0) { hi = mid; yHi = yMid; } else { lo = mid; yLo = yMid; }
  }
  return ((lo + hi) / 2) * freq * 100;
}

// Modified duration from a known yield: weighted-average time to cash flows
// discounted at that yield, divided by (1 + y/f). Returns years.
function modifiedDurationFromYield({ yieldPct, coupon, maturity, settleDate, frequency = 2 }) {
  const y = num(yieldPct);
  const c = num(coupon);
  const settle = toDate(settleDate);
  const mat = toDate(maturity);
  if (y == null || c == null || !settle || !mat) return null;
  if (mat <= settle) return null;
  const freq = frequency || 2;
  const yieldFrac = (y / 100) / freq;
  const couponPerPeriod = c / freq;

  let periodsRemaining = 0;
  let cursor = new Date(mat.getTime());
  const monthsPerCoupon = 12 / freq;
  while (cursor > settle) {
    periodsRemaining++;
    cursor.setUTCMonth(cursor.getUTCMonth() - monthsPerCoupon);
  }
  if (periodsRemaining < 1) return null;
  const nextCoupon = new Date(cursor.getTime());
  nextCoupon.setUTCMonth(nextCoupon.getUTCMonth() + monthsPerCoupon);
  const fullPeriodDays = (nextCoupon.getTime() - cursor.getTime()) / (1000 * 60 * 60 * 24);
  const remainingDays = (nextCoupon.getTime() - settle.getTime()) / (1000 * 60 * 60 * 24);
  const periodFraction = fullPeriodDays > 0 ? Math.max(0, Math.min(1, remainingDays / fullPeriodDays)) : 1;

  let weightedPv = 0, totalPv = 0;
  for (let k = 0; k < periodsRemaining; k++) {
    const t = periodFraction + k;
    const pv = couponPerPeriod / Math.pow(1 + yieldFrac, t);
    weightedPv += t * pv;
    totalPv += pv;
  }
  const tFinal = periodFraction + (periodsRemaining - 1);
  const parPv = 100 / Math.pow(1 + yieldFrac, tFinal);
  weightedPv += tFinal * parPv;
  totalPv += parPv;
  if (totalPv === 0) return null;
  const macaulayPeriods = weightedPv / totalPv;
  const macaulayYears = macaulayPeriods / freq;
  return macaulayYears / (1 + yieldFrac);
}

// Enrich a leg with computed yield + duration when the source workbook
// shipped them blank. Returns a new object — never mutates input.
//   - bookYieldYtm: derived from bookPrice + coupon + maturity
//   - marketYieldYtw: derived from marketPrice + coupon + maturity (using YTW
//     here is an approximation — true YTW requires a call schedule. For
//     bullets it's identical to YTM.)
//   - modifiedDuration: derived from the (book/market) yield we just landed
//
// `derived` flags on the returned leg tell the renderer which fields were
// computed vs stored, so the UI can mark them differently if it wants.
function enrichLegWithComputedFields(leg, settleDate) {
  if (!leg) return leg;
  const out = { ...leg, derived: {} };
  const haveBookYield = leg.bookYieldYtm != null || leg.bookYieldYtw != null;
  const haveMarketYield = leg.marketYieldYtw != null || leg.marketYieldYtm != null;
  if (!haveBookYield && leg.bookPrice != null && leg.coupon != null && leg.maturity) {
    const y = yieldFromPriceAndMaturity({
      price: leg.bookPrice, coupon: leg.coupon,
      maturity: leg.maturity, settleDate
    });
    if (y != null && Number.isFinite(y)) {
      out.bookYieldYtm = Number(y.toFixed(4));
      out.derived.bookYieldYtm = true;
    }
  }
  if (!haveMarketYield && leg.marketPrice != null && leg.coupon != null && leg.maturity) {
    const y = yieldFromPriceAndMaturity({
      price: leg.marketPrice, coupon: leg.coupon,
      maturity: leg.maturity, settleDate
    });
    if (y != null && Number.isFinite(y)) {
      out.marketYieldYtw = Number(y.toFixed(4));
      out.derived.marketYieldYtw = true;
    }
  }
  if (out.modifiedDuration == null && (out.marketYieldYtw != null || out.marketYieldYtm != null) && leg.coupon != null && leg.maturity) {
    const yld = out.marketYieldYtw != null ? out.marketYieldYtw : out.marketYieldYtm;
    const d = modifiedDurationFromYield({
      yieldPct: yld, coupon: leg.coupon,
      maturity: leg.maturity, settleDate
    });
    if (d != null && Number.isFinite(d)) {
      out.modifiedDuration = Number(d.toFixed(3));
      out.derived.modifiedDuration = true;
    }
  }
  return out;
}

function teYield(yieldPct, taxRatePct) {
  const y = num(yieldPct);
  const t = num(taxRatePct);
  if (y == null || t == null) return null;
  const taxFrac = Math.max(0, Math.min(t, 99)) / 100;
  if (taxFrac >= 1) return null;
  return y / (1 - taxFrac);
}

// ---------- Per-leg derivations ----------

function legBookValue({ par, bookPrice, bookValue }) {
  const bv = num(bookValue);
  if (bv != null && bv > 0) return bv;
  const p = num(par);
  const bp = num(bookPrice);
  if (p == null || bp == null) return null;
  return p * bp / 100;
}

function legMarketValue({ par, marketPrice, marketValue }) {
  const mv = num(marketValue);
  if (mv != null && mv > 0) return mv;
  const p = num(par);
  const mp = num(marketPrice);
  if (p == null || mp == null) return null;
  return p * mp / 100;
}

function legGainLoss({ bookValue, marketValue, gainLoss }) {
  const gl = num(gainLoss);
  if (gl != null) return gl;
  const bv = num(bookValue);
  const mv = num(marketValue);
  if (bv == null || mv == null) return null;
  return mv - bv;
}

function legProceeds({ marketValue, accrued }) {
  const mv = num(marketValue);
  const ac = num(accrued) || 0;
  if (mv == null) return null;
  return mv + ac;
}

function legInterestIncome({ par, yieldPct, horizonYears }) {
  const p = num(par);
  const y = num(yieldPct);
  const h = num(horizonYears);
  if (p == null || y == null || h == null || h <= 0) return null;
  return p * (y / 100) * h;
}

// ---------- Swap economics (per pair) ----------
//
// Mirrors Codex's swapEconomics in server.js so they stay in lockstep.
// The held bond is the SELL; the offering is the BUY.

function holdingHorizonYears(held, offering, asOfDate, capYears = 10) {
  const al = num(held.averageLife);
  if (al != null && al > 0) return Math.min(al, capYears);
  const dur = num(held.effectiveDuration);
  if (dur != null && dur > 0) return Math.min(dur, capYears);
  const matYrs = (monthsUntilMaturity(held.maturity, asOfDate) || 0) / 12;
  if (matYrs > 0) return Math.min(matYrs, capYears);
  const offMatYrs = (monthsUntilMaturity(offering && offering.maturity, asOfDate) || 0) / 12;
  if (offMatYrs > 0) return Math.min(offMatYrs, capYears);
  return 1;
}

function swapBreakevenMonths(realizedGainLoss, annualIncomePickup) {
  const gl = num(realizedGainLoss);
  const pick = num(annualIncomePickup);
  if (gl == null || pick == null) return null;
  if (pick <= 0) return null;            // can't earn back without pickup
  if (gl >= 0) return 0;                 // already a gain, breakeven is immediate
  const loss = -gl;
  return loss / (pick / 12);
}

function swapEconomicsForLeg({ held, offering, pickYield, asOfDate, horizonYears, taxRate }) {
  const bookYld = num(held.bookYieldYtm) ?? num(held.bookYieldYtw);
  const pickY = num(pickYield);
  if (bookYld == null || pickY == null) return null;

  const par = num(held.par) || 0;
  const bookValue = legBookValue({ par, bookPrice: held.bookPrice, bookValue: held.bookValue });
  const marketValue = legMarketValue({ par, marketPrice: held.marketPrice, marketValue: held.marketValue });
  if (bookValue == null || marketValue == null) return null;

  const realizedGainLoss = legGainLoss({
    bookValue, marketValue, gainLoss: held.gainLoss
  });

  const horizon = num(horizonYears) || holdingHorizonYears(held, offering, asOfDate);
  const annualIncomeGivenUp = bookValue * (bookYld / 100);
  const annualBuyIncome = marketValue * (pickY / 100);
  const annualIncomePickup = annualBuyIncome - annualIncomeGivenUp;
  const interestGivenUp = -annualIncomeGivenUp * horizon;
  const buyIncome = annualBuyIncome * horizon;
  const netInterestToHorizon = annualIncomePickup * horizon;
  const netBenefitToHorizon = netInterestToHorizon + (realizedGainLoss || 0);
  const breakevenMonths = swapBreakevenMonths(realizedGainLoss, annualIncomePickup);

  let bookYieldTe = null, marketYieldTe = null, pickYieldTe = null;
  if (taxRate != null) {
    bookYieldTe = teYield(bookYld, taxRate);
    const mktYld = num(held.marketYieldYtw) ?? num(held.marketYieldYtm);
    marketYieldTe = mktYld == null ? null : teYield(mktYld, taxRate);
    pickYieldTe = teYield(pickY, taxRate);
  }

  return {
    horizonYears: Number(horizon.toFixed(2)),
    bookYield: Number(bookYld.toFixed(3)),
    pickYield: Number(pickY.toFixed(3)),
    bookValue: Math.round(bookValue),
    marketValue: Math.round(marketValue),
    realizedGainLoss: Math.round(realizedGainLoss || 0),
    interestGivenUp: Math.round(interestGivenUp),
    buyIncome: Math.round(buyIncome),
    annualIncomePickup: Math.round(annualIncomePickup),
    netInterestToHorizon: Math.round(netInterestToHorizon),
    netBenefitToHorizon: Math.round(netBenefitToHorizon),
    breakevenMonths: breakevenMonths == null ? null : Number(breakevenMonths.toFixed(1)),
    bookYieldTe: bookYieldTe == null ? null : Number(bookYieldTe.toFixed(3)),
    marketYieldTe: marketYieldTe == null ? null : Number(marketYieldTe.toFixed(3)),
    pickYieldTe: pickYieldTe == null ? null : Number(pickYieldTe.toFixed(3))
  };
}

// ---------- FBBS rule check ----------
//
// There is exactly ONE hard rule for the Suggested-swap view:
//   - The held bond must mature AFTER the breakeven. Selling a bond that
//     matures before the loss is recouped is structurally broken and we
//     never auto-suggest it. (A rep + account can still build that swap
//     manually in the Build-your-own tab if they have a reason; the
//     manual builder doesn't apply this filter.)
//
// Everything else is soft — "thinking points" surfaced as warnings on the
// candidate card, not as drop reasons. The desk picks each swap on its
// own merits and every portfolio is different.
//
// Soft warnings:
//   - breakeven > breakevenSoftCapMonths (default 12)
//   - held maturity < maturitySoftFloorMonths (default 12)
//   - annual income pickup ≤ 0 (rare for a real swap — usually means
//     the rep is solving for duration / loss harvesting, not yield)

const DEFAULT_FBBS_RULES = Object.freeze({
  breakevenSoftCapMonths: 12,
  maturitySoftFloorMonths: 12
});

function evaluateSwapAgainstRules({
  breakevenMonths,
  monthsToMaturity,
  annualIncomePickup,
  rules = DEFAULT_FBBS_RULES
}) {
  const be = num(breakevenMonths);
  const mtm = num(monthsToMaturity);
  const pickup = num(annualIncomePickup);
  const softCap = num(rules.breakevenSoftCapMonths) || DEFAULT_FBBS_RULES.breakevenSoftCapMonths;
  const softFloor = num(rules.maturitySoftFloorMonths) || DEFAULT_FBBS_RULES.maturitySoftFloorMonths;

  // Hard rule: matures before breakeven → never auto-suggest.
  let hardPass = true;
  let hardReason = null;
  if (be != null && be > 0 && mtm != null && be > mtm) {
    hardPass = false;
    hardReason = `held matures in ${mtm.toFixed(1)} mo, before breakeven of ${be.toFixed(1)} mo`;
  }

  // Soft warnings: surfaced as chips on the card, never as filter reasons.
  const warnings = [];
  if (be != null && be > softCap) {
    warnings.push({
      code: 'breakeven-over-soft-cap',
      message: `Breakeven ${be.toFixed(1)} mo (above ${softCap} mo desk preference)`
    });
  }
  if (mtm != null && mtm < softFloor) {
    warnings.push({
      code: 'maturity-under-soft-floor',
      message: `Held matures in ${mtm.toFixed(1)} mo (inside ${softFloor} mo desk preference)`
    });
  }
  if (pickup == null || pickup <= 0) {
    warnings.push({
      code: 'no-annual-pickup',
      message: 'No annual yield pickup — likely a duration or loss-harvesting trade'
    });
  }

  return { hardPass, hardReason, warnings };
}

// Back-compat alias for callers still using the older name. Reports a strict
// pass only if hard and no warnings. New code should call
// evaluateSwapAgainstRules directly and route warnings to the UI.
function passesFbbsSwapRules(input) {
  const r = evaluateSwapAgainstRules(input);
  const reasons = [];
  if (r.hardReason) reasons.push(r.hardReason);
  for (const w of r.warnings) reasons.push(w.message);
  return { passes: r.hardPass && r.warnings.length === 0, reasons };
}

// ---------- Portfolio aggregates / diff (Sells vs Buys) ----------
//
// Used by the "Changes to Bond Data Portfolio" summary block on the print
// proposal and by the builder UI footer.

function aggregateLegs(legs, taxRate) {
  if (!Array.isArray(legs) || !legs.length) return null;
  let parSum = 0, bvSum = 0, mvSum = 0, accruedSum = 0;
  let weightedBkYld = 0, weightedMktYld = 0, weightedAvgLife = 0, weightedDuration = 0;
  let bkYldWeight = 0, mktYldWeight = 0, alWeight = 0, durWeight = 0;
  for (const leg of legs) {
    const par = num(leg.par) || 0;
    parSum += par;
    const bv = legBookValue({ par, bookPrice: leg.bookPrice, bookValue: leg.bookValue });
    const mv = legMarketValue({ par, marketPrice: leg.marketPrice, marketValue: leg.marketValue });
    if (bv != null) bvSum += bv;
    if (mv != null) mvSum += mv;
    if (leg.accrued != null) accruedSum += num(leg.accrued) || 0;
    const bky = num(leg.bookYieldYtm) ?? num(leg.bookYieldYtw);
    const mky = num(leg.marketYieldYtw) ?? num(leg.marketYieldYtm);
    if (bky != null && bv != null) { weightedBkYld += bky * bv; bkYldWeight += bv; }
    if (mky != null && mv != null) { weightedMktYld += mky * mv; mktYldWeight += mv; }
    const al = num(leg.averageLife);
    if (al != null && par) { weightedAvgLife += al * par; alWeight += par; }
    const dur = num(leg.modifiedDuration) || num(leg.effectiveDuration);
    if (dur != null && par) { weightedDuration += dur * par; durWeight += par; }
  }
  const bkYld = bkYldWeight ? weightedBkYld / bkYldWeight : null;
  const mktYld = mktYldWeight ? weightedMktYld / mktYldWeight : null;
  return {
    par: parSum,
    bookValue: bvSum || null,
    marketValue: mvSum || null,
    accrued: accruedSum || null,
    gainLoss: (bvSum && mvSum) ? mvSum - bvSum : null,
    bookYield: bkYld,
    marketYield: mktYld,
    teBookYield: bkYld == null || taxRate == null ? null : teYield(bkYld, taxRate),
    teMarketYield: mktYld == null || taxRate == null ? null : teYield(mktYld, taxRate),
    averageLife: alWeight ? weightedAvgLife / alWeight : null,
    duration: durWeight ? weightedDuration / durWeight : null
  };
}

function portfolioDiff(sellsAgg, buysAgg) {
  if (!sellsAgg || !buysAgg) return null;
  const sub = (a, b) => (a == null || b == null) ? null : b - a;
  return {
    par: sub(sellsAgg.par, buysAgg.par),
    bookValue: sub(sellsAgg.bookValue, buysAgg.bookValue),
    marketValue: sub(sellsAgg.marketValue, buysAgg.marketValue),
    bookYield: sub(sellsAgg.bookYield, buysAgg.bookYield),
    marketYield: sub(sellsAgg.marketYield, buysAgg.marketYield),
    teBookYield: sub(sellsAgg.teBookYield, buysAgg.teBookYield),
    teMarketYield: sub(sellsAgg.teMarketYield, buysAgg.teMarketYield),
    averageLife: sub(sellsAgg.averageLife, buysAgg.averageLife),
    duration: sub(sellsAgg.duration, buysAgg.duration)
  };
}

// ---------- Whole-proposal summary ----------
//
// Mirrors the FBBS template's Summary block: $ table (Interest / Gain (Loss)
// / Settle Adjust / Total Income) split by Sells / Buys / Net, plus a %
// version expressed against the market value of the sells.

function swapSummary({ sells, buys, horizonYears, settleAdjust = null, taxRate = null }) {
  const sellsAgg = aggregateLegs(sells, taxRate);
  const buysAgg = aggregateLegs(buys, taxRate);
  const h = num(horizonYears) || 1;

  const sellInterest = sellsAgg && sellsAgg.bookValue && sellsAgg.bookYield != null
    ? -sellsAgg.bookValue * (sellsAgg.bookYield / 100) * h : null;
  const buyInterest = buysAgg && buysAgg.marketValue && buysAgg.marketYield != null
    ? buysAgg.marketValue * (buysAgg.marketYield / 100) * h : null;
  const realizedGainLoss = sellsAgg ? sellsAgg.gainLoss : null;
  const totalIncome = [sellInterest, buyInterest, realizedGainLoss, num(settleAdjust)]
    .reduce((sum, v) => v == null ? sum : sum + v, 0);

  // Compute settle adjust if not provided: proceeds-balancing line
  let computedSettleAdjust = num(settleAdjust);
  if (computedSettleAdjust == null && sellsAgg && buysAgg
      && sellsAgg.marketValue != null && buysAgg.marketValue != null) {
    const sellProceeds = sellsAgg.marketValue + (sellsAgg.accrued || 0);
    const buyProceeds = buysAgg.marketValue + (buysAgg.accrued || 0);
    computedSettleAdjust = sellProceeds - buyProceeds;
  }

  const basis = sellsAgg && sellsAgg.marketValue ? sellsAgg.marketValue : null;
  const pct = (v) => basis && v != null ? (v / basis) * 100 : null;

  const netIncome = (sellInterest || 0) + (buyInterest || 0);
  const netBenefit = netIncome + (realizedGainLoss || 0);
  const breakevenMonths = swapBreakevenMonths(realizedGainLoss, netIncome);
  const breakevenYears = breakevenMonths == null ? null : breakevenMonths / 12;
  const diff = portfolioDiff(sellsAgg, buysAgg);

  return {
    horizonYears: Number(h.toFixed(2)),
    sells: sellsAgg,
    buys: buysAgg,
    settleAdjust: computedSettleAdjust == null ? null : Math.round(computedSettleAdjust),
    dollars: {
      sellInterest: sellInterest == null ? null : Math.round(sellInterest),
      buyInterest: buyInterest == null ? null : Math.round(buyInterest),
      realizedGainLoss: realizedGainLoss == null ? null : Math.round(realizedGainLoss),
      netInterest: Math.round(netIncome),
      netBenefit: Math.round(netBenefit),
      totalIncome: Math.round(totalIncome)
    },
    percents: {
      sellInterest: pct(sellInterest),
      buyInterest: pct(buyInterest),
      realizedGainLoss: pct(realizedGainLoss),
      netInterest: pct(netIncome),
      netBenefit: pct(netBenefit),
      totalIncome: pct(totalIncome)
    },
    breakevenMonths: breakevenMonths == null ? null : Number(breakevenMonths.toFixed(1)),
    breakevenYears: breakevenYears == null ? null : Number(breakevenYears.toFixed(2)),
    portfolioDiff: diff
  };
}

// ---------- Exports ----------

module.exports = {
  // Helpers
  toDate,
  ymd,
  monthsBetween,
  monthsUntilMaturity,
  defaultSettleDate,
  // Day count
  days30_360,
  daysActual,
  defaultDayCountForSector,
  // Bond math
  accruedInterest,
  inferLastCouponDate,
  // Yield
  teYield,
  yieldFromPriceAndMaturity,
  modifiedDurationFromYield,
  enrichLegWithComputedFields,
  defaultTaxRate,
  TAX_RATE_C_CORP,
  TAX_RATE_SUB_S,
  // Per leg
  legBookValue,
  legMarketValue,
  legGainLoss,
  legProceeds,
  legInterestIncome,
  // Swap
  swapBreakevenMonths,
  swapEconomicsForLeg,
  holdingHorizonYears,
  // Rule check
  evaluateSwapAgainstRules,
  passesFbbsSwapRules,
  DEFAULT_FBBS_RULES,
  // Portfolio / summary
  aggregateLegs,
  portfolioDiff,
  swapSummary
};
