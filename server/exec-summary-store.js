'use strict';

/**
 * FBBS Executive Summary — calc engine + store.
 *
 * Turns the three daily sources (holdings, TBLT trades, margin) into the
 * computed `summary_daily` object the management-only Executive Summary tab
 * renders, and persists one idempotent snapshot per business morning.
 *
 * Persistence mirrors swap-store.js / strategy-store.js: SQLite via the shared
 * sqlite-db.js (better-sqlite3), opened/closed per call, with an append-only
 * snapshot table keyed by as_of_date (re-runs upsert — corrections/restatements
 * are safe). A `_<as_of_date>.json` copy is also written for portability; the
 * `_` prefix keeps it out of any /current/ or /archive/ file serving.
 *
 * The exec summary is a Tier-B "internal forever" view (capital, P&L, desk/rep
 * revenue) — never client-facing. The server gates its routes behind the
 * FBBS_ADMIN_USERS allowlist, same as the Upload/Admin pages.
 */

const fs = require('fs');
const path = require('path');
const sqliteDb = require('./sqlite-db');
const parser = require('./exec-summary-parser');
const repRoster = require('./rep-roster');

const DATABASE_FILENAME = 'exec-summary.sqlite';

// Exception thresholds (overridable via env without code change).
const AGED_DAYS_THRESHOLD = Number(process.env.FBBS_EXEC_AGED_DAYS || 30);
const BUFFER_WARN_PCT = Number(process.env.FBBS_EXEC_BUFFER_WARN || 0.10);
const ISSUER_CONCENTRATION_WARN = Number(process.env.FBBS_EXEC_ISSUER_CONC_WARN || 0.15);
const CALL_HORIZON_DAYS = Number(process.env.FBBS_EXEC_CALL_HORIZON || 90);
const RISK_SHOCK_BPS = [-100, -50, -25, 25, 50, 100];
const HEDGE_TARGET_RATIOS = [0.25, 0.50, 0.75, 1.00];

// ---------------------------------------------------------------------------
// Code -> name lookups. Codes mean nothing to a CEO; these humanize the desk
// and rep codes that appear in the TH activity sheet.
//
// Rep names come from the shared firm roster in `rep-roster.js` (the single
// source of truth, reusable by other pages/reports). The desk-level TRADER_MAP
// is a different code space (08-TRSY, 30-PRICD, ...) and is still stubbed —
// confirm the real desk labels with the firm (spec §9). Any code missing from a
// map falls back to the raw code, and the summary carries a `desk/rep names not
// yet mapped` warning while a map is unfilled.
// ---------------------------------------------------------------------------
const TRADER_MAP = {
  '08-TRSY': null,   // Treasury desk (confirm label)
  '30-PRICD': null,
  '32-CDSEC': null,
  '69-NICD': null,
  '80-CORP': null,   // Corporates desk (confirm label)
  '98-SECNT': null,
};
const SALESPERSON_MAP = repRoster.REP_ROSTER;

function deskName(code) { return (code && TRADER_MAP[code]) || code || 'Unmapped'; }
function repName(code) { return repRoster.repName(code, code || 'Unmapped'); }

// ---------------------------------------------------------------- math utils -
function round(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function sumBy(arr, fn) { return arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0); }
function safeDiv(a, b) { return (b && Number.isFinite(a / b)) ? a / b : null; }
function delta(now, prior) {
  if (now == null || prior == null || !Number.isFinite(now - prior)) return null;
  return round(now - prior, 2);
}
function groupSum(arr, keyFn, valFns) {
  const out = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) continue;
    let acc = out.get(k);
    if (!acc) { acc = { key: k, count: 0 }; for (const f of Object.keys(valFns)) acc[f] = 0; out.set(k, acc); }
    acc.count += 1;
    for (const [f, fn] of Object.entries(valFns)) acc[f] += Number(fn(x)) || 0;
  }
  return [...out.values()];
}

// ISO yyyy-mm-dd -> UTC ms (tz-safe; ignores any time component). Years between
// two ISO dates on a 365.25-day basis — used for the inventory maturity ladder.
function isoToUTC(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
function yearsBetween(fromISO, toISO) {
  const a = isoToUTC(fromISO), b = isoToUTC(toISO);
  if (a == null || b == null) return null;
  return (b - a) / (365.25 * 86400000);
}

// Capital requirement waterfall: the firm haircut, the two adjustments, and the
// resulting requirement reconcile to (firmHaircut + nonHaircut + approvedIssuer);
// the excess leg is equity - requirement. Components that are absent are dropped
// so the bridge degrades on partial margin workbooks. Returns null if too sparse.
function buildCapitalBridge(c) {
  const requirement = [];
  if (c.firmHaircutTotal != null) requirement.push({ label: 'Firm haircut', value: c.firmHaircutTotal, kind: 'base' });
  if (c.nonHaircutAdj != null) requirement.push({ label: 'Non-haircut adj.', value: c.nonHaircutAdj, kind: 'flow' });
  if (c.approvedIssuerAdj != null) requirement.push({ label: 'Approved-issuer 20% benefit', value: c.approvedIssuerAdj, kind: 'flow' });
  if (c.totalRequirement != null) requirement.push({ label: 'Total requirement', value: c.totalRequirement, kind: 'subtotal' });

  const excess = [];
  if (c.totalEquity != null) excess.push({ label: 'Total equity', value: c.totalEquity, kind: 'base' });
  if (c.totalRequirement != null) excess.push({ label: 'Less: total requirement', value: -c.totalRequirement, kind: 'flow' });
  if (c.excessCall != null) excess.push({ label: 'Excess (Call)', value: c.excessCall, kind: 'result' });

  let reconciles = null;
  if (c.firmHaircutTotal != null && c.nonHaircutAdj != null && c.approvedIssuerAdj != null && c.totalRequirement != null) {
    reconciles = Math.abs((c.firmHaircutTotal + c.nonHaircutAdj + c.approvedIssuerAdj) - c.totalRequirement) <= 1;
  }
  if (requirement.length < 2 && excess.length < 2) return null;
  return { requirement, excess, reconciles };
}

// Inventory "book profile": MV-weighted average yield / spread / duration plus a
// years-to-maturity ladder. Yield & spread come off the inventory grid; duration
// & maturity off the TBLT blotter (joined by CUSIP). Each metric weights by
// |market value| over only the positions that carry it, so missing Bloomberg
// columns don't dilute the average — they just shrink coverage. Net (signed) MV
// fills each ladder bucket, matching how the sector table reports MV.
const MATURITY_BUCKETS = [
  { key: '<1y', label: 'Under 1y', lo: -Infinity, hi: 1 },
  { key: '1-3y', label: '1–3y', lo: 1, hi: 3 },
  { key: '3-5y', label: '3–5y', lo: 3, hi: 5 },
  { key: '5-10y', label: '5–10y', lo: 5, hi: 10 },
  { key: '10y+', label: '10y+', lo: 10, hi: Infinity },
];
// Normalize a Bloomberg coupon-type string into CEO-legible buckets. Falls back
// to the coupon rate (0 -> Zero, >0 -> Fixed) when the type string is blank.
function classifyCouponType(raw, coupon) {
  const s = String(raw || '').toUpperCase();
  if (/FLOAT|VARIABLE|VRDN|FRN|ADJ/.test(s)) return 'Floating';
  if (/STEP/.test(s)) return 'Step';
  if (/ZERO|STRIP|DISCOUNT/.test(s)) return 'Zero';
  if (/FIX/.test(s)) return 'Fixed';
  if (s) return 'Other';
  if (coupon === 0) return 'Zero';
  if (coupon != null && coupon > 0) return 'Fixed';
  return null;
}
function computeBookProfile(secs, byCusip, asOfDate) {
  const priced = secs.filter(s => s.mktValue != null);
  let yNum = 0, yDen = 0, yCov = 0, sNum = 0, sDen = 0, sCov = 0, dNum = 0, dDen = 0, dCov = 0, cNum = 0, cDen = 0, cCov = 0;
  const ladder = MATURITY_BUCKETS.map(b => ({ bucket: b.key, label: b.label, mktValue: 0, positions: 0 }));
  const couponMix = new Map();
  let laddered = 0;

  for (const s of priced) {
    const w = Math.abs(s.mktValue);
    if (s.bidYield != null) { yNum += w * s.bidYield; yDen += w; yCov++; }
    if (s.spread != null) { sNum += w * s.spread; sDen += w; sCov++; }
    const ref = byCusip[s.cusip] || null;
    if (ref && ref.duration != null) { dNum += w * ref.duration; dDen += w; dCov++; }
    if (ref && ref.coupon != null) { cNum += w * ref.coupon; cDen += w; cCov++; }
    const cpnType = classifyCouponType(ref && ref.couponType, ref && ref.coupon);
    if (cpnType) {
      let m = couponMix.get(cpnType);
      if (!m) { m = { type: cpnType, mktValue: 0, positions: 0 }; couponMix.set(cpnType, m); }
      m.mktValue += s.mktValue; m.positions += 1;
    }
    const ytm = ref && ref.maturityDate ? yearsBetween(asOfDate, ref.maturityDate) : null;
    if (ytm != null) {
      const i = MATURITY_BUCKETS.findIndex(b => ytm >= b.lo && ytm < b.hi);
      if (i >= 0) { ladder[i].mktValue += s.mktValue; ladder[i].positions += 1; laddered++; }
    }
  }

  return {
    waYield: yDen ? round(yNum / yDen, 3) : null,
    waSpread: sDen ? round(sNum / sDen, 1) : null,
    waDuration: dDen ? round(dNum / dDen, 2) : null,
    waCoupon: cDen ? round(cNum / cDen, 3) : null,
    yieldCoverage: `${yCov}/${priced.length}`,
    spreadCoverage: `${sCov}/${priced.length}`,
    durationCoverage: `${dCov}/${priced.length}`,
    couponCoverage: `${cCov}/${priced.length}`,
    couponMix: [...couponMix.values()].map(m => ({ ...m, mktValue: round(m.mktValue, 0) }))
      .sort((a, b) => Math.abs(b.mktValue) - Math.abs(a.mktValue)),
    maturityLadder: laddered ? ladder.map(b => ({ ...b, mktValue: round(b.mktValue, 0) })) : [],
    ladderCoverage: `${laddered}/${priced.length}`,
    asOf: asOfDate || null,
  };
}

// Positions rolled up by account type (margin FT-60 detail + ACCOUNT_TYPE map) —
// shows where book value sits (principal trading vs error vs fail accounts).
function computePositionsByAccount(positionsByAccount, accountTypes) {
  const rows = Array.isArray(positionsByAccount) ? positionsByAccount : [];
  if (!rows.length) return null;
  const types = accountTypes || {};
  const byType = new Map();
  for (const p of rows) {
    const type = (types[p.account] || 'Unclassified').trim() || 'Unclassified';
    let acc = byType.get(type);
    if (!acc) { acc = { type, book: 0, positions: 0, accounts: new Set() }; byType.set(type, acc); }
    acc.book += Number(p.book) || 0;
    acc.positions += 1;
    if (p.account) acc.accounts.add(p.account);
  }
  const out = [...byType.values()]
    .map(a => ({ type: a.type, book: round(a.book, 0), positions: a.positions, accounts: a.accounts.size }))
    .sort((a, b) => Math.abs(b.book) - Math.abs(a.book));
  return { byType: out, totalBook: round(sumBy(out, x => x.book), 0), accountCount: new Set(rows.map(p => p.account).filter(Boolean)).size };
}

// Inventory composition by Bloomberg industry group (finer than Corp/Govt/Muni).
function computeComposition(secs, byCusip, haircutByCusip) {
  const priced = secs.filter(s => s.mktValue != null);
  const grp = groupSum(priced, s => {
    const ref = byCusip[s.cusip] || null;
    return (ref && (ref.industryGroup || ref.industrySector)) || 'Unclassified';
  }, {
    mktValue: s => s.mktValue,
    requirement: s => (haircutByCusip[s.cusip] ? haircutByCusip[s.cusip].haircut : 0),
  }).map(g => ({ group: g.key, mktValue: round(g.mktValue, 0), positions: g.count, requirement: round(g.requirement, 0) }))
    .sort((a, b) => Math.abs(b.mktValue) - Math.abs(a.mktValue));
  const mapped = priced.filter(s => { const r = byCusip[s.cusip]; return r && (r.industryGroup || r.industrySector); }).length;
  return { byIndustryGroup: grp.slice(0, 10), coverage: `${mapped}/${priced.length}` };
}

// Bonds with a call inside `withinDays` of COB — extension / refi watch.
function computeUpcomingCalls(secs, byCusip, asOfDate, withinDays) {
  const priced = secs.filter(s => s.mktValue != null);
  const items = [];
  for (const s of priced) {
    const ref = byCusip[s.cusip] || null;
    if (!ref || !ref.nextCallDate) continue;
    const yrs = yearsBetween(asOfDate, ref.nextCallDate);
    if (yrs == null) continue;
    const d = Math.round(yrs * 365.25);
    if (d < 0 || d > withinDays) continue;
    items.push({ cusip: s.cusip, issuer: ref.issuer || s.security, callDate: ref.nextCallDate, daysToCall: d, mktValue: round(s.mktValue, 0) });
  }
  items.sort((a, b) => (a.callDate < b.callDate ? -1 : a.callDate > b.callDate ? 1 : 0));
  return { withinDays, count: items.length, totalMktValue: round(sumBy(items, x => x.mktValue), 0), items: items.slice(0, 15) };
}

// Forward settlement pipeline: trades settling after COB, netted by settle date.
function computeSettlement(trades, cobDate) {
  const fwd = (trades || []).filter(t => t.settleDate && cobDate && t.settleDate > cobDate);
  if (!fwd.length) return { asOf: cobDate || null, unsettledCount: 0, items: [], totalNet: 0, totalGross: 0 };
  const signed = t => (t.buySell === 'S' ? -1 : 1) * (t.principal || 0);
  const byDate = groupSum(fwd, t => t.settleDate, { net: signed, gross: t => Math.abs(t.principal || 0) })
    .map(g => ({ settleDate: g.key, net: round(g.net, 0), gross: round(g.gross, 0), tickets: g.count }))
    .sort((a, b) => (a.settleDate < b.settleDate ? -1 : 1));
  return { asOf: cobDate || null, unsettledCount: fwd.length, items: byDate, totalNet: round(sumBy(byDate, x => x.net), 0), totalGross: round(sumBy(byDate, x => x.gross), 0) };
}

// CEO risk shock: simple parallel-rate DV01 math. Positive shock = rates up,
// so a positive DV01 book loses value. This deliberately avoids hedge trade
// advice; it is a management sensitivity frame.
function computeRiskShock(risk, capital) {
  const dv01 = risk && risk.portfolioDv01 != null ? Number(risk.portfolioDv01) : null;
  if (dv01 == null || !Number.isFinite(dv01)) return null;
  const excess = capital && capital.excessCall != null ? Number(capital.excessCall) : null;
  const equity = capital && capital.totalEquity != null ? Number(capital.totalEquity) : null;
  const totalAbsSectorDv01 = sumBy(risk.bySector || [], s => Math.abs(s.dv01 || 0));
  return {
    basis: 'Parallel-rate DV01 estimate; excludes convexity, key-rate curve shape, basis, hedge accounting, and callable/MBS extension.',
    portfolioDv01: round(dv01, 1),
    shocks: RISK_SHOCK_BPS.map(bp => {
      const estimatedPnl = round(-dv01 * bp, 0);
      const proFormaExcess = excess == null ? null : round(excess + estimatedPnl, 0);
      return {
        shockBp: bp,
        estimatedPnl,
        proFormaExcess,
        proFormaBufferPct: (proFormaExcess != null && equity) ? round(proFormaExcess / equity, 4) : null,
        pctExcessAtRisk: excess ? round(Math.max(0, -estimatedPnl) / excess, 4) : null,
      };
    }),
    bySector: (risk.bySector || [])
      .filter(s => s.dv01 != null)
      .map(s => ({
        sector: s.sector,
        dv01: round(s.dv01, 1),
        pctOfAbsDv01: totalAbsSectorDv01 ? round(Math.abs(s.dv01) / totalAbsSectorDv01, 4) : null,
        up100Pnl: round(-(s.dv01 || 0) * 100, 0),
      }))
      .sort((a, b) => Math.abs(b.dv01 || 0) - Math.abs(a.dv01 || 0)),
  };
}

function computeHedgeWatch(risk, capital) {
  const netDv01 = risk && risk.portfolioDv01 != null ? Number(risk.portfolioDv01) : null;
  if (netDv01 == null || !Number.isFinite(netDv01)) return null;
  const excess = capital && capital.excessCall != null ? Number(capital.excessCall) : null;
  const up100Loss = Math.max(0, netDv01 * 100);
  const pctExcessAtRisk = excess ? up100Loss / excess : null;
  let posture = 'Low';
  if (pctExcessAtRisk != null && pctExcessAtRisk >= 0.10) posture = 'Review';
  else if (pctExcessAtRisk != null && pctExcessAtRisk >= 0.05) posture = 'Monitor';
  return {
    posture,
    currentDv01: round(netDv01, 1),
    existingHedgeDv01: null,
    netDv01: round(netDv01, 1),
    up100Loss: round(up100Loss, 0),
    pctExcessAtRisk: pctExcessAtRisk == null ? null : round(pctExcessAtRisk, 4),
    scenarios: HEDGE_TARGET_RATIOS.map(ratio => {
      const dv01ToOffset = netDv01 * ratio;
      const residualDv01 = netDv01 - dv01ToOffset;
      const residualUp100Loss = Math.max(0, residualDv01 * 100);
      return {
        targetRatio: ratio,
        dv01ToOffset: round(dv01ToOffset, 1),
        residualDv01: round(residualDv01, 1),
        residualUp100Loss: round(residualUp100Loss, 0),
        residualPctExcessAtRisk: excess ? round(residualUp100Loss / excess, 4) : null,
      };
    }),
    dataNeeded: [
      'Current hedge positions and DV01 from the hedge sheet',
      'Key-rate DV01 by tenor (2Y/5Y/10Y/30Y) for curve hedging',
      'Approved hedge instruments and DV01 per contract/notional',
      'Desk target hedge ratio or management risk limit',
    ],
    note: 'For discussion only: the portal shows hedge equivalents from DV01, not a trade recommendation.',
  };
}

function computeRevenueQuality(revenue, activitySummary) {
  const cf = (activitySummary && activitySummary.customerFlow) || {};
  const grossPrincipal = (cf.customerPrincipal || 0) + (cf.dealerPrincipal || 0);
  const revenueKnown = Boolean(revenue && revenue.dayTotal != null);
  const dayTotal = revenueKnown ? Number(revenue.dayTotal) : null;
  const byType = (cf.byType || []).map(t => ({
    type: t.type,
    principal: t.principal,
    tickets: t.tickets,
    pctPrincipal: grossPrincipal ? round((t.principal || 0) / grossPrincipal, 4) : null,
  }));
  return {
    grossPrincipal: round(grossPrincipal, 0),
    revenuePerTicket: revenueKnown && activitySummary && activitySummary.ticketCount ? round(dayTotal / activitySummary.ticketCount, 0) : null,
    revenuePerMillionPrincipal: revenueKnown && grossPrincipal ? round(dayTotal / grossPrincipal * 1000000, 0) : null,
    markupPct: revenueKnown && dayTotal ? round((revenue.markup || 0) / dayTotal, 4) : null,
    commissionPct: revenueKnown && dayTotal ? round((revenue.commission || 0) / dayTotal, 4) : null,
    customerPct: cf.customerPct ?? null,
    dealerPct: cf.dealerPct ?? null,
    byType,
  };
}

function computeManagementActions(exceptions, riskShock, hedgeWatch, revenueQuality) {
  const actions = [];
  const add = (title, detail, severity, owner) => actions.push({ title, detail, severity, owner });
  const aged = exceptions.aged || {};
  const conc = exceptions.concentration || {};
  const topConcentration = (conc.breaches || [])[0];
  if (exceptions.netCapProximity && exceptions.netCapProximity.breach) {
    add('Net-cap buffer below warning floor', `Buffer is ${pct(exceptions.netCapProximity.bufferPct)} against a ${pct(exceptions.netCapProximity.warnFloorPct)} floor.`, 'bad', 'Management / Finance');
  }
  if (exceptions.pershingVariance && exceptions.pershingVariance.breach) {
    add('Reconcile Pershing variance', `Firm calc differs from Pershing by ${money(exceptions.pershingVariance.value)}.`, 'bad', 'Operations');
  }
  if (topConcentration) {
    add('Review issuer concentration', `${topConcentration.issuer} is ${pct(topConcentration.pct)} of inventory MV.`, 'warn', 'Desk Head');
  }
  if (aged.count) {
    add('Clear aged inventory review', `${aged.count} aged position(s) over ${aged.thresholdDays} days, ${money(aged.totalHaircut)} haircut.`, 'warn', 'Operations / Desk');
  }
  if (exceptions.unpriced && exceptions.unpriced.count) {
    add('Confirm unpriced marks', `${exceptions.unpriced.count} unpriced position(s) need mark review.`, 'warn', 'Operations');
  }
  if (hedgeWatch && hedgeWatch.posture !== 'Low') {
    add('Discuss hedge posture', `A +100 bp parallel shock is about ${pct(hedgeWatch.pctExcessAtRisk)} of excess capital before hedges.`, 'warn', 'CEO / Desk Head');
  }
  if (revenueQuality && revenueQuality.customerPct != null && revenueQuality.customerPct < 0.25) {
    add('Check customer-flow mix', `Customer flow is ${pct(revenueQuality.customerPct)} of gross principal today.`, 'watch', 'Sales Manager');
  }
  if (!actions.length) add('No management exceptions flagged', 'Capital, marks, pricing exceptions, and concentration checks are inside current watch thresholds.', 'ok', 'Management');
  return actions;
}

function buildCeoBrief(s) {
  const c = s.capital || {}, r = s.risk || {}, rev = s.revenue || {}, h = s.hedgeWatch || {};
  const actions = s.managementActions || [];
  const topRiskSector = [...(r.bySector || [])].filter(x => x.dv01 != null).sort((a, b) => Math.abs(b.dv01 || 0) - Math.abs(a.dv01 || 0))[0];
  const adverse100 = s.riskShock && (s.riskShock.shocks || []).find(x => x.shockBp === 100);
  const bad = actions.filter(a => a.severity === 'bad').length;
  const warn = actions.filter(a => a.severity === 'warn').length;
  const tone = bad ? 'bad' : warn ? 'warn' : 'ok';
  const headline = `Capital excess is ${money(c.excessCall)} (${pct(c.bufferPct)} buffer) against ${money(c.totalRequirement)} requirement; inventory DV01 is ${r.portfolioDv01 != null ? r.portfolioDv01.toFixed(1) : 'n/a'}/bp${topRiskSector ? `, led by ${topRiskSector.sector}` : ''}.`;
  const decisionText = [];
  if (adverse100) decisionText.push(`+100 bp parallel shock is approximately ${money(adverse100.estimatedPnl)} (${pct(adverse100.pctExcessAtRisk)} of excess capital).`);
  if (h.posture) decisionText.push(`Hedge Watch posture: ${h.posture}.`);
  if (rev.dayTotal != null) decisionText.push(`Today revenue: ${money(rev.dayTotal)}; MTD ${money(rev.mtd)}.`);
  return {
    tone,
    headline,
    decisionText,
    highlights: [
      { label: 'Capital', value: money(c.excessCall), detail: `${pct(c.bufferPct)} buffer`, tone: c.bufferPct != null && c.bufferPct < BUFFER_WARN_PCT ? 'bad' : 'ok' },
      { label: 'Risk', value: r.portfolioDv01 != null ? `${r.portfolioDv01.toFixed(1)}/bp` : 'n/a', detail: topRiskSector ? `${topRiskSector.sector} largest DV01` : 'DV01 unavailable', tone: h.posture === 'Review' ? 'warn' : 'ok' },
      { label: 'Shock', value: adverse100 ? money(adverse100.estimatedPnl) : 'n/a', detail: '+100 bp estimate', tone: adverse100 && adverse100.pctExcessAtRisk >= 0.10 ? 'warn' : 'ok' },
      { label: 'Revenue', value: money(rev.dayTotal), detail: `${s.activity.ticketCount || 0} tickets`, tone: rev.dayTotal < 0 ? 'bad' : 'ok' },
      { label: 'Actions', value: String(actions.length), detail: `${bad} critical / ${warn} watch`, tone },
    ],
  };
}

// Fuzzy issuer-name match. The approved-issuer list carries abbreviated/truncated
// Bloomberg names ("JP MORGAN CHASE", "BANK MONTREAL", "ROYAL BK OF CDA") that
// won't substring-match full issuer names ("JPMORGAN CHASE & CO"), so we match on
// significant word tokens with prefix tolerance and a few abbreviation expansions.
const GENERIC_ISSUER_TOKENS = new Set(['INC', 'CO', 'THE', 'LLC', 'PLC', 'NA', 'GLOBAL', 'GROUP', 'CORPORATION', 'CORP', 'AND', 'OF', 'COMPANY', 'HOLDINGS', 'HLDG', 'SECS', 'SECURITIES', 'FIN']);
const ISSUER_ABBR = { BK: 'BANK', CDA: 'CANADA', NATL: 'NATIONAL', MTL: 'MONTREAL', GRP: 'GROUP' };
function issuerTokens(s) {
  return String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map(t => ISSUER_ABBR[t] || t).filter(t => !GENERIC_ISSUER_TOKENS.has(t));
}
function issuerMatch(a, b) {
  const ta = issuerTokens(a), tb = issuerTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length === 1 && short[0].length < 3) return false; // avoid a lone generic token matching everything
  return short.every(s => long.some(l => l === s || l.startsWith(s) || s.startsWith(l)));
}

// ------------------------------------------------------------- calc engine ---
/**
 * Pure: parsed sources (+ optional prior snapshot & market data) -> summary.
 * @param {{inventory,activity,sector,margin,market}} src
 * @param {{prior,priorMonthRevenue}} ctx
 */
function computeExecSummary(src, ctx = {}) {
  const inventory = src.inventory || { warnings: [], securities: [] };
  const sector = src.sector || { warnings: [], byCusip: {}, trades: [] };
  const activity = src.activity || { warnings: [], asOfDate: sector.asOfDate || null, trades: sector.trades || [] };
  const margin = src.margin || { warnings: [], haircuts: [], approvedIssuers: [], capital: {} };
  const market = src.market || null;
  const prior = ctx.prior || null;
  const warnings = [
    ...(inventory.warnings || []),
    ...(activity.warnings || []),
    ...(sector.warnings || []),
    ...(margin.warnings || []),
  ];

  const cobDate = margin.cobDate || null;
  const preparedDate = margin.preparedDate || null;
  const asOfDate = cobDate || preparedDate || activity.asOfDate || ctx.asOfDate || null;
  const byCusip = sector.byCusip || {};
  const lookupSector = c => (byCusip[c] && byCusip[c].marketSector) || null;
  const lookupIssuer = c => (byCusip[c] && byCusip[c].issuer) || null;

  // ---- haircut-by-CUSIP index (capital consumed per position) ----
  const haircutByCusip = {};
  for (const h of margin.haircuts) haircutByCusip[h.cusip] = h;

  // ---- approved-issuer matcher (workbook names are abbreviated/truncated) ----
  const isApprovedIssuer = name => Boolean(name) && margin.approvedIssuers.some(i => issuerMatch(i.name, name));

  // ===================== CAPITAL =====================
  const cap = margin.capital || {};
  const capital = {
    firmHaircutTotal: cap.firmHaircutTotal ?? null,
    nonHaircutAdj: cap.nonHaircutAdj ?? null,
    approvedIssuerAdj: cap.approvedIssuerAdj ?? null,
    totalRequirement: cap.totalRequirement ?? null,
    totalEquity: cap.totalEquity ?? null,
    sdNetworth: cap.sdNetworth ?? null,
    excessCall: cap.excessCall ?? null,
    bufferPct: cap.bufferPct ?? safeDiv(cap.excessCall, cap.totalEquity),
    pershingExcess: cap.pershingExcess ?? null,
    pershingVariance: cap.pershingVariance ?? null,
    netExcessCall: cap.netExcessCall ?? null,
    deltas: {
      excessCall: delta(cap.excessCall, prior && prior.capital && prior.capital.excessCall),
      totalRequirement: delta(cap.totalRequirement, prior && prior.capital && prior.capital.totalRequirement),
      bufferPct: delta(cap.bufferPct, prior && prior.capital && prior.capital.bufferPct),
    },
  };
  // Waterfall that explains how the headline requirement / excess is built.
  capital.bridge = buildCapitalBridge(capital);

  // ===================== RISK & P&L (inventory grid) =====================
  const secs = inventory.securities;
  const totalMktValue = sumBy(secs, s => s.mktValue);
  const portfolioDv01 = sumBy(secs, s => s.risk);
  const unrealizedTotal = sumBy(secs, s => s.pnl);

  const sectorGroups = groupSum(secs, s => s.sector || 'Other', {
    mktValue: s => s.mktValue, dv01: s => s.risk, pnl: s => s.pnl,
    requirement: s => (haircutByCusip[s.cusip] ? haircutByCusip[s.cusip].haircut : 0),
  }).map(g => ({
    sector: g.key, positions: g.count,
    mktValue: round(g.mktValue, 0), dv01: round(g.dv01, 1), pnl: round(g.pnl, 0),
    requirement: round(g.requirement, 0),
    pnlPerRequirement: round(safeDiv(g.pnl, g.requirement), 4),
  })).sort((a, b) => (b.mktValue || 0) - (a.mktValue || 0));

  const worstPnlSector = [...sectorGroups].sort((a, b) => (a.pnl || 0) - (b.pnl || 0))[0] || null;

  const risk = {
    totalMktValue: round(totalMktValue, 0),
    portfolioDv01: round(portfolioDv01, 1),
    bySector: sectorGroups,
    deltas: { totalMktValue: delta(round(totalMktValue, 0), prior && prior.risk && prior.risk.totalMktValue) },
  };
  const pnl = {
    unrealizedTotal: round(unrealizedTotal, 0),
    bySector: sectorGroups.map(g => ({ sector: g.sector, pnl: g.pnl })),
    deltas: { unrealizedTotal: delta(round(unrealizedTotal, 0), prior && prior.pnl && prior.pnl.unrealizedTotal) },
  };

  // Book profile: MV-weighted yield/spread/duration/coupon + maturity ladder.
  // Measured as of COB (the position date) so tenor is relative to the marks.
  const bookProfile = computeBookProfile(secs, byCusip, cobDate || asOfDate);
  const composition = computeComposition(secs, byCusip, haircutByCusip);
  const upcomingCalls = computeUpcomingCalls(secs, byCusip, cobDate || asOfDate, CALL_HORIZON_DAYS);
  const positions = computePositionsByAccount(margin.positionsByAccount, margin.accountTypes);

  // ===================== REVENUE & ACTIVITY (TH spine) =====================
  const trades = activity.trades || [];
  const hasRevenueDetail = !trades.length || trades.some(t => t.revenue != null || t.txnCost1 != null || t.txnCost2 != null);
  const revenueDay = hasRevenueDetail ? sumBy(trades, t => t.revenue) : null;
  const markupDay = hasRevenueDetail ? sumBy(trades, t => t.txnCost1) : null;     // principal markup (Txn Cost 1)
  const commissionDay = hasRevenueDetail ? sumBy(trades, t => t.txnCost2) : null; // agency commission (Txn Cost 2)
  const priorMonthRevenue = Number(ctx.priorMonthRevenue) || 0;

  const bySalesperson = groupSum(trades, t => t.salesperson || 'UNSPECIFIED', { revenue: t => t.revenue, principal: t => Math.abs(t.principal || 0) })
    .map(g => ({ code: g.key, name: repName(g.key), revenue: round(g.revenue, 0), tickets: g.count }))
    .sort((a, b) => b.revenue - a.revenue);
  const byDesk = groupSum(trades, t => t.trader || 'UNSPECIFIED', { revenue: t => t.revenue })
    .map(g => ({ code: g.key, name: deskName(g.key), revenue: round(g.revenue, 0), tickets: g.count }))
    .sort((a, b) => b.revenue - a.revenue);

  const signedPrincipal = t => (t.buySell === 'S' ? -1 : 1) * (t.principal || 0);
  const netBySector = groupSum(trades, t => lookupSector(t.cusip) || 'Other', { net: signedPrincipal, gross: t => Math.abs(t.principal || 0) })
    .map(g => ({ sector: g.key, net: round(g.net, 0), gross: round(g.gross, 0), tickets: g.count }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const netByIssuer = groupSum(trades, t => lookupIssuer(t.cusip) || t.security || 'Other', { net: signedPrincipal })
    .map(g => ({ issuer: g.key, net: round(g.net, 0), tickets: g.count }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 10);

  const flowGroups = groupSum(trades, t => t.customerType || 'UNSPECIFIED', { principal: t => Math.abs(t.principal || 0) });
  const totalFlow = sumBy(flowGroups, g => g.principal);
  const custFlow = sumBy(flowGroups.filter(g => g.key === 'CUST' || g.key === 'RETAIL'), g => g.principal);
  const hasCustomerTypeDetail = trades.some(t => t.customerType && t.customerType !== 'UNSPECIFIED');
  const hasCounterpartyDetail = trades.some(t => t.counterparty);

  const topCounterparties = hasCounterpartyDetail ? groupSum(trades, t => t.counterparty || 'Unknown', { principal: t => Math.abs(t.principal || 0) })
    .map(g => ({ counterparty: g.key, principal: round(g.principal, 0), tickets: g.count, pct: round(safeDiv(g.principal, totalFlow), 4) }))
    .sort((a, b) => b.principal - a.principal).slice(0, 5) : [];

  const distinctTickets = new Set(trades.map(t => t.ticket).filter(Boolean)).size;
  const tickets = distinctTickets || trades.length;

  const revenue = {
    dayTotal: hasRevenueDetail ? round(revenueDay, 0) : null,
    mtd: hasRevenueDetail ? round(priorMonthRevenue + revenueDay, 0) : null,
    markup: hasRevenueDetail ? round(markupDay, 0) : null,
    commission: hasRevenueDetail ? round(commissionDay, 0) : null,
    bySalesperson, byDesk,
    deltas: { dayTotal: hasRevenueDetail ? delta(round(revenueDay, 0), prior && prior.revenue && prior.revenue.dayTotal) : null },
  };
  const activitySummary = {
    ticketCount: tickets,
    legCount: trades.length,
    netBuySellBySector: netBySector,
    netBuySellByIssuer: netByIssuer,
    customerFlow: {
      // CUST + RETAIL = customer; everything else (DEALER + unclassified street
      // blocks) = dealer/street, so the two shares are complementary.
      byType: flowGroups.map(g => ({ type: g.key, principal: round(g.principal, 0), tickets: g.count })),
      customerPct: hasCustomerTypeDetail ? round(safeDiv(custFlow, totalFlow), 4) : null,
      dealerPct: hasCustomerTypeDetail && totalFlow ? round((totalFlow - custFlow) / totalFlow, 4) : null,
      customerPrincipal: hasCustomerTypeDetail ? round(custFlow, 0) : null,
      dealerPrincipal: hasCustomerTypeDetail ? round(totalFlow - custFlow, 0) : null,
    },
    topCounterparties,
  };

  // Forward settlement pipeline: today's trades settling after COB.
  const settlement = computeSettlement(trades, cobDate);

  // ===================== CAPITAL EFFICIENCY =====================
  const issuerReq = groupSum(secs, s => lookupIssuer(s.cusip) || s.security || 'Other', {
    requirement: s => (haircutByCusip[s.cusip] ? haircutByCusip[s.cusip].haircut : 0),
    mktValue: s => s.mktValue, pnl: s => s.pnl,
  }).map(g => ({
    issuer: g.key, requirement: round(g.requirement, 0), mktValue: round(g.mktValue, 0),
    pnl: round(g.pnl, 0), approvedIssuer: isApprovedIssuer(g.key),
    pnlPerRequirement: round(safeDiv(g.pnl, g.requirement), 4),
  })).filter(x => x.requirement > 0).sort((a, b) => b.requirement - a.requirement);

  const totalRequirementConsumed = sumBy(issuerReq, x => x.requirement);
  const capitalEfficiency = {
    approvedIssuerSavings: capital.approvedIssuerAdj != null ? Math.abs(capital.approvedIssuerAdj) : null,
    pnlPerRequirement: round(safeDiv(unrealizedTotal, capital.totalRequirement), 4),
    revenuePerRequirement: hasRevenueDetail ? round(safeDiv(revenueDay, capital.totalRequirement), 6) : null,
    bySector: sectorGroups.map(g => ({ sector: g.sector, requirement: g.requirement, pnl: g.pnl, pnlPerRequirement: g.pnlPerRequirement })),
    topIssuersByRequirement: issuerReq.slice(0, 8),
    haircutDetailCoverage: `${secs.filter(s => haircutByCusip[s.cusip]).length}/${secs.length}`,
  };

  // ===================== EXCEPTIONS =====================
  const agedAll = margin.haircuts
    .filter(h => h.ageDays != null && h.ageDays > AGED_DAYS_THRESHOLD)
    .map(h => ({ ...h, issuer: lookupIssuer(h.cusip), sector: lookupSector(h.cusip) }))
    .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));

  const unpricedInv = secs.filter(s => s.mktValue == null).map(s => ({ cusip: s.cusip, desc: s.security, source: 'inventory' }));
  const unpricedMargin = (margin.unpriced || []).map(u => ({ cusip: u.cusip, desc: u.desc, mktValue: u.mktValue, source: 'margin' }));

  // issuer concentration vs total inventory MV
  const issuerMv = groupSum(secs, s => lookupIssuer(s.cusip) || s.security || 'Other', { mktValue: s => s.mktValue })
    .map(g => ({ issuer: g.key, mktValue: round(g.mktValue, 0), pct: round(safeDiv(g.mktValue, totalMktValue), 4) }))
    .sort((a, b) => (b.mktValue || 0) - (a.mktValue || 0));
  const concentrationBreaches = issuerMv.filter(x => x.pct != null && x.pct > ISSUER_CONCENTRATION_WARN);

  const exceptions = {
    aged: { thresholdDays: AGED_DAYS_THRESHOLD, count: agedAll.length, totalHaircut: round(sumBy(agedAll, h => h.haircut), 0), items: agedAll.slice(0, 20) },
    unpriced: { count: unpricedInv.length + unpricedMargin.length, items: [...unpricedMargin, ...unpricedInv].slice(0, 20) },
    netCapProximity: {
      bufferPct: capital.bufferPct, warnFloorPct: BUFFER_WARN_PCT, excessCall: capital.excessCall,
      breach: capital.bufferPct != null && capital.bufferPct < BUFFER_WARN_PCT,
    },
    pershingVariance: { value: capital.pershingVariance, breach: capital.pershingVariance != null && Math.abs(capital.pershingVariance) > 1 },
    concentration: { warnPct: ISSUER_CONCENTRATION_WARN, breaches: concentrationBreaches, topIssuers: issuerMv.slice(0, 8) },
    recentDiscrepancies: margin.recentDiscrepancies || [],
  };

  // ===================== MARKET OVERLAY (reuse portal econ data) =====================
  const marketOverlay = buildMarketOverlay(market, netBySector);

  // ===================== CEO LAYER =====================
  const riskShock = computeRiskShock(risk, capital);
  const hedgeWatch = computeHedgeWatch(risk, capital);
  const revenueQuality = computeRevenueQuality(revenue, activitySummary);
  const managementActions = computeManagementActions(exceptions, riskShock, hedgeWatch, revenueQuality);

  // ===================== KPI TILES =====================
  const kpis = {
    excessCall: { value: capital.excessCall, deltaDay: capital.deltas.excessCall, bufferPct: capital.bufferPct },
    totalRequirement: { value: capital.totalRequirement, deltaDay: capital.deltas.totalRequirement },
    inventoryMV: { value: risk.totalMktValue, deltaDay: risk.deltas.totalMktValue },
    unrealizedPnl: { value: pnl.unrealizedTotal, deltaDay: pnl.deltas.unrealizedTotal },
    revenue: { day: revenue.dayTotal, mtd: revenue.mtd, deltaDay: revenue.deltas.dayTotal },
    activity: { net: sumBy(netBySector, s => s.net), tickets, customerPct: activitySummary.customerFlow.customerPct, dealerPct: activitySummary.customerFlow.dealerPct },
  };

  const summary = {
    asOfDate, cobDate, preparedDate,
    deskNamesMapped: Object.values(TRADER_MAP).some(Boolean),
    repNamesMapped: Object.values(SALESPERSON_MAP).some(Boolean),
    kpis, capital, risk, pnl, bookProfile, composition, upcomingCalls, positions,
    revenue, revenueQuality, activity: activitySummary, settlement,
    riskShock, hedgeWatch, managementActions,
    capitalEfficiency, exceptions, marketOverlay,
    coverage: { sectorLookup: `${secs.filter(s => byCusip[s.cusip]).length}/${secs.length}`, haircutDetail: capitalEfficiency.haircutDetailCoverage },
    warnings,
  };
  if (!summary.deskNamesMapped || !summary.repNamesMapped) {
    warnings.push('desk/rep names not yet mapped — showing codes (see exec-summary-store.js TRADER_MAP/SALESPERSON_MAP)');
  }
  summary.ceoBrief = buildCeoBrief(summary);
  summary.narrative = buildNarrative(summary);
  return summary;
}

function buildMarketOverlay(market, netBySector) {
  if (!market || typeof market !== 'object') return null;
  const ust = market.ust || market.treasuries || null;
  const get = k => (ust && (ust[k] != null ? ust[k] : null));
  const ust2 = get('ust_2y') ?? get('2y') ?? get('2YR');
  const ust10 = get('ust_10y') ?? get('10y') ?? get('10YR');
  return {
    curve: ust || null,
    sofr: market.sofr ?? null,
    fedFunds: market.fed_funds ?? market.fedFunds ?? null,
    igOas: market.ig_oas ?? market.igOas ?? null,
    hyOas: market.hy_oas ?? market.hyOas ?? null,
    curve2s10s: (ust2 != null && ust10 != null) ? round((ust10 - ust2) * 100, 1) : null, // bp
    deskActivity: netBySector, // net buy/sell by sector — "what the desk did against the move"
    note: market.note || null,
  };
}

// ---------------------------------------------------- deterministic narrative
function money(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function pct(n) { return n == null || !Number.isFinite(n) ? 'n/a' : `${(n * 100).toFixed(1)}%`; }

function buildNarrative(s) {
  const c = s.capital, r = s.risk, p = s.pnl, rev = s.revenue, a = s.activity;
  const sentences = [];

  // 1) Capital posture (lead)
  let s1 = `Net capital excess is ${money(c.excessCall)} — a ${pct(c.bufferPct)} cushion over the ${money(c.totalRequirement)} requirement`;
  s1 += s.exceptions.pershingVariance.breach
    ? `, but the firm calc is ${money(c.pershingVariance)} off Pershing.`
    : ` (firm calc ties to Pershing, variance $0).`;
  sentences.push(s1);

  // 2) Risk & P&L
  const bp = s.bookProfile || {};
  let durTxt = '';
  if (bp.waDuration != null) {
    durTxt = ` (~${bp.waDuration.toFixed(1)}y duration`;
    durTxt += bp.waYield != null ? `, ${bp.waYield.toFixed(2)}% book yield)` : ')';
  }
  const worst = [...(p.bySector || [])].sort((x, y) => (x.pnl || 0) - (y.pnl || 0))[0];
  let s2 = `Inventory marks at ${money(r.totalMktValue)} carrying ${r.portfolioDv01 != null ? r.portfolioDv01.toFixed(0) : 'n/a'}/bp of DV01${durTxt}, with unrealized P&L of ${money(p.unrealizedTotal)}`;
  s2 += worst && worst.pnl < 0 ? ` (${worst.sector} ${money(worst.pnl)} the main drag).` : `.`;
  sentences.push(s2);

  // 3) Revenue & flow
  const topRep = rev.bySalesperson && rev.bySalesperson[0];
  let s3 = rev.dayTotal != null ? `The desk earned ${money(rev.dayTotal)}` : `TBLT shows ${a.ticketCount} trade row(s)`;
  if (rev.dayTotal != null) {
    s3 += (rev.markup != null && rev.commission != null && rev.commission > 0)
      ? ` (${money(rev.markup)} principal markup, ${money(rev.commission)} agency commission)`
      : ` of markup/commission`;
    s3 += ` today across ${a.ticketCount} tickets`;
  }
  if (a.customerFlow.customerPct != null || a.customerFlow.dealerPct != null) {
    s3 += `, ${pct(a.customerFlow.customerPct)} customer vs ${pct(a.customerFlow.dealerPct)} dealer/street`;
  }
  s3 += topRep && topRep.revenue > 0 ? `; ${topRep.name} led production at ${money(topRep.revenue)}.` : `.`;
  sentences.push(s3);

  // 4) Capital efficiency
  if (s.capitalEfficiency.approvedIssuerSavings) {
    const topIss = s.capitalEfficiency.topIssuersByRequirement[0];
    let s4 = `Approved-issuer treatment saves ${money(s.capitalEfficiency.approvedIssuerSavings)} of requirement`;
    s4 += topIss ? `; ${topIss.issuer} consumes the most capital (${money(topIss.requirement)}).` : `.`;
    sentences.push(s4);
  }

  // Watch items
  const watch = [];
  if (s.exceptions.netCapProximity.breach) watch.push(`Net capital buffer ${pct(c.bufferPct)} is below the ${pct(s.exceptions.netCapProximity.warnFloorPct)} warning floor.`);
  if (s.exceptions.pershingVariance.breach) watch.push(`Pershing variance ${money(c.pershingVariance)} — reconcile before relying on the call.`);
  if (s.exceptions.aged.count) watch.push(`${s.exceptions.aged.count} position(s) aged > ${s.exceptions.aged.thresholdDays}d (${money(s.exceptions.aged.totalHaircut)} haircut).`);
  for (const b of s.exceptions.concentration.breaches.slice(0, 3)) watch.push(`${b.issuer} is ${pct(b.pct)} of inventory MV — concentration > ${pct(s.exceptions.concentration.warnPct)}.`);
  if (s.exceptions.unpriced.count) watch.push(`${s.exceptions.unpriced.count} unpriced position(s) — confirm marks.`);
  if (!watch.length) watch.push('No exceptions flagged today.');

  return { text: sentences.join(' '), watchItems: watch };
}

// ------------------------------------------------------------- persistence ---
function databasePathForDir(execDir) {
  return path.join(execDir, DATABASE_FILENAME);
}

function ensureDatabase(execDir) {
  fs.mkdirSync(execDir, { recursive: true });
  const dbPath = databasePathForDir(execDir);
  sqliteDb.execSqlite(dbPath, `
    CREATE TABLE IF NOT EXISTS exec_summary_snapshots (
      as_of_date   TEXT PRIMARY KEY,
      cob_date     TEXT,
      generated_at TEXT NOT NULL,
      source_files TEXT,
      day_revenue  REAL,
      summary_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exec_summary_date ON exec_summary_snapshots(as_of_date DESC);
  `);
  return dbPath;
}

function saveSnapshot(execDir, summary, meta = {}) {
  const dbPath = ensureDatabase(execDir);
  const asOfDate = summary.asOfDate;
  if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    const err = new Error(`exec summary as_of_date is missing or malformed: ${asOfDate}`);
    err.statusCode = 400;
    throw err;
  }
  const generatedAt = meta.generatedAt || new Date().toISOString();
  summary.generatedAt = generatedAt;
  summary.sourceFiles = meta.sourceFiles || summary.sourceFiles || null;

  const params = {
    as_of_date: asOfDate,
    cob_date: summary.cobDate || null,
    generated_at: generatedAt,
    source_files: summary.sourceFiles ? JSON.stringify(summary.sourceFiles) : null,
    day_revenue: summary.revenue ? summary.revenue.dayTotal ?? null : null,
    summary_json: JSON.stringify(summary),
  };

  // Idempotent by COB date: re-running a business date replaces it. The delete
  // also cleans up early snapshots that were keyed by prepared date.
  sqliteDb.transaction(dbPath, [
    {
      sql: `
        DELETE FROM exec_summary_snapshots
        WHERE @cob_date IS NOT NULL
          AND cob_date = @cob_date
          AND as_of_date <> @as_of_date
      `,
      params,
    },
    {
      sql: `
        INSERT INTO exec_summary_snapshots (as_of_date, cob_date, generated_at, source_files, day_revenue, summary_json)
        VALUES (@as_of_date, @cob_date, @generated_at, @source_files, @day_revenue, @summary_json)
        ON CONFLICT(as_of_date) DO UPDATE SET
          cob_date = excluded.cob_date,
          generated_at = excluded.generated_at,
          source_files = excluded.source_files,
          day_revenue = excluded.day_revenue,
          summary_json = excluded.summary_json
      `,
      params,
    },
  ]);

  // Portable per-date copy; `_` prefix keeps it out of /current/ and /archive/.
  try {
    const jsonPath = path.join(execDir, `_${asOfDate}.json`);
    const tmp = `${jsonPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(summary, null, 2));
    fs.renameSync(tmp, jsonPath);
  } catch (_) { /* SQLite is the source of truth; the JSON copy is best-effort */ }

  return summary;
}

function enrichSummaryForRead(summary) {
  if (!summary || typeof summary !== 'object') return summary;
  if (!summary.riskShock) summary.riskShock = computeRiskShock(summary.risk || {}, summary.capital || {});
  if (!summary.hedgeWatch) summary.hedgeWatch = computeHedgeWatch(summary.risk || {}, summary.capital || {});
  if (!summary.revenueQuality) summary.revenueQuality = computeRevenueQuality(summary.revenue || {}, summary.activity || {});
  if (!summary.managementActions) {
    summary.managementActions = computeManagementActions(summary.exceptions || {}, summary.riskShock, summary.hedgeWatch, summary.revenueQuality);
  }
  if (!summary.ceoBrief) summary.ceoBrief = buildCeoBrief(summary);
  return summary;
}

function parseSummaryRow(row) {
  if (!row) return null;
  try { return enrichSummaryForRead(JSON.parse(row.summary_json)); } catch (_) { return null; }
}

function getSnapshot(execDir, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const dbPath = ensureDatabase(execDir);
  const rows = sqliteDb.querySqliteJson(dbPath, `
    SELECT summary_json
    FROM exec_summary_snapshots
    WHERE as_of_date = ? OR cob_date = ?
    ORDER BY CASE WHEN as_of_date = ? THEN 0 ELSE 1 END, generated_at DESC
    LIMIT 1
  `, [date, date, date]);
  return parseSummaryRow(rows[0]);
}

function getLatestSnapshot(execDir) {
  const dbPath = ensureDatabase(execDir);
  const rows = sqliteDb.querySqliteJson(dbPath, 'SELECT summary_json FROM exec_summary_snapshots ORDER BY as_of_date DESC LIMIT 1');
  return parseSummaryRow(rows[0]);
}

function getPriorSnapshot(execDir, beforeDate) {
  const dbPath = ensureDatabase(execDir);
  const rows = sqliteDb.querySqliteJson(dbPath, 'SELECT summary_json FROM exec_summary_snapshots WHERE as_of_date < ? ORDER BY as_of_date DESC LIMIT 1', [beforeDate]);
  return parseSummaryRow(rows[0]);
}

function listSnapshots(execDir) {
  const dbPath = ensureDatabase(execDir);
  return sqliteDb.querySqliteJson(dbPath,
    'SELECT as_of_date, cob_date, generated_at, day_revenue FROM exec_summary_snapshots ORDER BY as_of_date DESC')
    .map(r => ({ asOfDate: r.as_of_date, cobDate: r.cob_date, generatedAt: r.generated_at, dayRevenue: r.day_revenue }));
}

// Compact KPI time-series for the trend card: the last `limit` snapshots up to
// (and including) asOfDate, oldest-first. Reads summary_json so it tracks the
// same numbers the headline tiles show without a schema migration.
function getTrend(execDir, asOfDate, limit = 30) {
  const dbPath = ensureDatabase(execDir);
  const lim = Math.max(1, Math.min(Number(limit) || 30, 120));
  const useDate = /^\d{4}-\d{2}-\d{2}$/.test(asOfDate || '');
  const rows = useDate
    ? sqliteDb.querySqliteJson(dbPath, 'SELECT as_of_date, summary_json FROM exec_summary_snapshots WHERE as_of_date <= ? ORDER BY as_of_date DESC LIMIT ?', [asOfDate, lim])
    : sqliteDb.querySqliteJson(dbPath, 'SELECT as_of_date, summary_json FROM exec_summary_snapshots ORDER BY as_of_date DESC LIMIT ?', [lim]);
  const series = [];
  for (const r of rows) {
    let s; try { s = JSON.parse(r.summary_json); } catch (_) { continue; }
    const c = s.capital || {}, rk = s.risk || {}, p = s.pnl || {}, rv = s.revenue || {};
    series.push({
      asOfDate: s.asOfDate || r.as_of_date,
      excessCall: c.excessCall ?? null,
      totalRequirement: c.totalRequirement ?? null,
      bufferPct: c.bufferPct ?? null,
      inventoryMV: rk.totalMktValue ?? null,
      unrealizedPnl: p.unrealizedTotal ?? null,
      revenueDay: rv.dayTotal ?? null,
    });
  }
  return series.reverse(); // chronological (oldest -> newest)
}

// month-to-date revenue from prior snapshots in the same calendar month
function getPriorMonthRevenue(execDir, asOfDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate || '')) return 0;
  const month = asOfDate.slice(0, 7);
  const dbPath = ensureDatabase(execDir);
  const rows = sqliteDb.querySqliteJson(dbPath,
    "SELECT COALESCE(SUM(day_revenue),0) AS total FROM exec_summary_snapshots WHERE as_of_date < ? AND substr(as_of_date,1,7) = ?",
    [asOfDate, month]);
  return (rows[0] && Number(rows[0].total)) || 0;
}

// ------------------------------------------------------------- orchestration -
/**
 * Parse the uploaded files, compute the snapshot against history, persist
 * idempotently, and return the summary. `market` (optional) is the portal's
 * already-ingested Economic Update data, passed through to the overlay.
 */
function ingestExecSummary(execDir, paths, opts = {}) {
  const inventory = parser.parseInventoryGrid(paths.inventoryPath);
  const sector = parser.parseSectorLookup(paths.sectorPath || paths.tradesPath);
  const activity = paths.activityPath
    ? parser.parseTradeActivity(paths.activityPath)
    : { asOfDate: sector.asOfDate, warnings: [], trades: sector.trades || [] };
  const margin = parser.parseMarginWorkbook(paths.marginPath);

  const asOfDate = margin.cobDate || margin.preparedDate || activity.asOfDate || opts.asOfDate || null;
  const prior = asOfDate ? getPriorSnapshot(execDir, asOfDate) : getLatestSnapshot(execDir);
  const priorMonthRevenue = asOfDate ? getPriorMonthRevenue(execDir, asOfDate) : 0;

  const summary = computeExecSummary(
    { inventory, activity, sector, margin, market: opts.market || null },
    { prior, priorMonthRevenue, asOfDate }
  );
  return saveSnapshot(execDir, summary, { sourceFiles: opts.sourceFiles || null, generatedAt: opts.generatedAt });
}

module.exports = {
  // calc
  computeExecSummary,
  buildNarrative,
  // persistence
  ensureDatabase,
  databasePathForDir,
  saveSnapshot,
  getSnapshot,
  getLatestSnapshot,
  getPriorSnapshot,
  listSnapshots,
  getTrend,
  getPriorMonthRevenue,
  // orchestration
  ingestExecSummary,
  // lookups (export so they're easy to fill / test)
  TRADER_MAP,
  SALESPERSON_MAP,
  deskName,
  repName,
};
