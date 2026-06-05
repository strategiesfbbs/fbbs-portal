'use strict';

/**
 * FBBS Executive Summary — calc engine + store.
 *
 * Turns the four parsed daily inputs (see exec-summary-parser.js) into the
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

const DATABASE_FILENAME = 'exec-summary.sqlite';

// Exception thresholds (overridable via env without code change).
const AGED_DAYS_THRESHOLD = Number(process.env.FBBS_EXEC_AGED_DAYS || 30);
const BUFFER_WARN_PCT = Number(process.env.FBBS_EXEC_BUFFER_WARN || 0.10);
const ISSUER_CONCENTRATION_WARN = Number(process.env.FBBS_EXEC_ISSUER_CONC_WARN || 0.15);

// ---------------------------------------------------------------------------
// Code -> name lookups. Codes mean nothing to a CEO; these humanize the desk
// and rep codes that appear in the TH activity sheet.
//
// TODO(fbbs): confirm the real desk / rep names with the firm and fill these
// in (spec §9). Until then the UI falls back to showing the raw code, and the
// summary carries a `desk/rep names not yet mapped` warning so it's visible.
// ---------------------------------------------------------------------------
const TRADER_MAP = {
  '08-TRSY': null,   // Treasury desk (confirm label)
  '30-PRICD': null,
  '32-CDSEC': null,
  '69-NICD': null,
  '80-CORP': null,   // Corporates desk (confirm label)
  '98-SECNT': null,
};
const SALESPERSON_MAP = {
  F20: null, F36: null, F57: null, F61: null, K50: null, K55: null,
};

function deskName(code) { return (code && TRADER_MAP[code]) || code || 'Unmapped'; }
function repName(code) { return (code && SALESPERSON_MAP[code]) || code || 'Unmapped'; }

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
  const { inventory, activity, sector, margin, market } = src;
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

  // ===================== REVENUE & ACTIVITY (TH spine) =====================
  const trades = activity.trades;
  const revenueDay = sumBy(trades, t => t.revenue);
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

  const topCounterparties = groupSum(trades, t => t.counterparty || 'Unknown', { principal: t => Math.abs(t.principal || 0) })
    .map(g => ({ counterparty: g.key, principal: round(g.principal, 0), tickets: g.count, pct: round(safeDiv(g.principal, totalFlow), 4) }))
    .sort((a, b) => b.principal - a.principal).slice(0, 5);

  const tickets = new Set(trades.map(t => t.ticket).filter(Boolean)).size;

  const revenue = {
    dayTotal: round(revenueDay, 0),
    mtd: round(priorMonthRevenue + revenueDay, 0),
    bySalesperson, byDesk,
    deltas: { dayTotal: delta(round(revenueDay, 0), prior && prior.revenue && prior.revenue.dayTotal) },
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
      customerPct: round(safeDiv(custFlow, totalFlow), 4),
      dealerPct: totalFlow ? round((totalFlow - custFlow) / totalFlow, 4) : null,
      customerPrincipal: round(custFlow, 0),
      dealerPrincipal: round(totalFlow - custFlow, 0),
    },
    topCounterparties,
  };

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
    revenuePerRequirement: round(safeDiv(revenueDay, capital.totalRequirement), 6),
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
    kpis, capital, risk, pnl, revenue, activity: activitySummary,
    capitalEfficiency, exceptions, marketOverlay,
    coverage: { sectorLookup: `${secs.filter(s => byCusip[s.cusip]).length}/${secs.length}`, haircutDetail: capitalEfficiency.haircutDetailCoverage },
    warnings,
  };
  if (!summary.deskNamesMapped || !summary.repNamesMapped) {
    warnings.push('desk/rep names not yet mapped — showing codes (see exec-summary-store.js TRADER_MAP/SALESPERSON_MAP)');
  }
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
  const worst = [...(p.bySector || [])].sort((x, y) => (x.pnl || 0) - (y.pnl || 0))[0];
  let s2 = `Inventory marks at ${money(r.totalMktValue)} carrying ${r.portfolioDv01 != null ? r.portfolioDv01.toFixed(0) : 'n/a'}/bp of DV01, with unrealized P&L of ${money(p.unrealizedTotal)}`;
  s2 += worst && worst.pnl < 0 ? ` (${worst.sector} ${money(worst.pnl)} the main drag).` : `.`;
  sentences.push(s2);

  // 3) Revenue & flow
  const topRep = rev.bySalesperson && rev.bySalesperson[0];
  let s3 = `The desk earned ${money(rev.dayTotal)} of markup/commission today across ${a.ticketCount} tickets, ${pct(a.customerFlow.customerPct)} customer vs ${pct(a.customerFlow.dealerPct)} dealer/street`;
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
    day_revenue: (summary.revenue && summary.revenue.dayTotal) || 0,
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

function parseSummaryRow(row) {
  if (!row) return null;
  try { return JSON.parse(row.summary_json); } catch (_) { return null; }
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
 * Parse the four uploaded files, compute the snapshot against history, persist
 * idempotently, and return the summary. `market` (optional) is the portal's
 * already-ingested Economic Update data, passed through to the overlay.
 */
function ingestExecSummary(execDir, paths, opts = {}) {
  const inventory = parser.parseInventoryGrid(paths.inventoryPath);
  const activity = parser.parseTradeActivity(paths.activityPath);
  const sector = parser.parseSectorLookup(paths.sectorPath);
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
  getPriorMonthRevenue,
  // orchestration
  ingestExecSummary,
  // lookups (export so they're easy to fill / test)
  TRADER_MAP,
  SALESPERSON_MAP,
  deskName,
  repName,
};
