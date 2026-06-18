/**
 * market-snapshot.js — one canonical market-data snapshot for every tab.
 *
 * The portal showed the same metric (2s/10s, 10Y, SOFR…) on Daily
 * Intelligence, Economic Update, Relative Value and Market Color, each computed
 * from its own source, so the numbers disagreed. This module is the single
 * source of truth: for each metric it resolves a CANONICAL value (the desk's
 * vetted Economic Update PDF snapshot — authoritative, once-daily) and, when
 * available, a LIVE value (the keyless wire: home.treasury.gov curve + FRED —
 * fresher but a different source). The UI shows canonical as the headline with
 * the live value as a delta chip; the desk number is never silently overwritten.
 *
 * Pure (no I/O) so it is node-testable — the server hands it the already-loaded
 * Economic Update JSON and the wire pieces.
 */
'use strict';

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function econTreasuryYield(econ, tenor) {
  const row = ((econ && econ.treasuries) || []).find(t => t && t.tenor === tenor);
  return row ? num(row.yield) : null;
}

function econRate(econ, label) {
  const want = String(label).toLowerCase();
  const row = ((econ && econ.marketRates) || []).find(r => r && String(r.label).toLowerCase() === want);
  return row ? num(row.value) : null;
}

function econData(econ, labels) {
  const want = labels.map(l => l.toLowerCase());
  const row = ((econ && econ.marketData) || []).find(r => r && want.includes(String(r.label).toLowerCase()));
  if (!row) return null;
  // Indices open later in the day, so the printed value can be null pre-open;
  // fall back to the prior close the desk PDF carries.
  return num(row.value) != null ? num(row.value) : num(row.priorClose);
}

function fredVal(wire, key) {
  const f = wire && wire.fred;
  return f && f[key] ? num(f[key].value) : null;
}

function curveTenor(wire, tenor) {
  const r = wire && wire.rates;
  if (!r) return null;
  if (tenor === '10Y') return num(r.tenYear);
  if (tenor === '2Y') return num(r.twoYear);
  return null;
}

// Each metric: canonical extractor (Economic Update) + live extractor (wire).
// unit drives formatting + delta math ('%' → bp delta; 'bp' → bp delta; '' → raw).
const METRICS = [
  { key: 'two_year', label: '2Y Treasury', unit: '%', dp: 2, canonical: e => econTreasuryYield(e, '2YR'), live: w => curveTenor(w, '2Y') },
  { key: 'five_year', label: '5Y Treasury', unit: '%', dp: 2, canonical: e => econTreasuryYield(e, '5YR'), live: () => null },
  { key: 'ten_year', label: '10Y Treasury', unit: '%', dp: 2, canonical: e => econTreasuryYield(e, '10YR'), live: w => curveTenor(w, '10Y') },
  { key: 'thirty_year', label: '30Y Treasury', unit: '%', dp: 2, canonical: e => econTreasuryYield(e, '30YR'), live: () => null },
  {
    key: 'twos_tens', label: '2s/10s', unit: 'bp', dp: 0,
    canonical: e => {
      const t2 = econTreasuryYield(e, '2YR');
      const t10 = econTreasuryYield(e, '10YR');
      return t2 != null && t10 != null ? Math.round((t10 - t2) * 100) : null;
    },
    live: w => (w && w.rates ? num(w.rates.spread2s10sBp) : null)
  },
  { key: 'sofr', label: 'SOFR', unit: '%', dp: 2, canonical: e => econRate(e, 'SOFR'), live: w => fredVal(w, 'sofr') },
  { key: 'prime', label: 'Prime', unit: '%', dp: 2, canonical: e => econRate(e, 'Prime Rate'), live: w => fredVal(w, 'prime') },
  { key: 'fed_funds', label: 'Fed Funds', unit: '%', dp: 2, canonical: e => econRate(e, 'Fed Funds'), live: w => fredVal(w, 'fedFunds') },
  { key: 'spx', label: 'S&P 500', unit: '', dp: 0, canonical: e => econData(e, ['S&P 500', 'SPX']), live: () => null },
  { key: 'vix', label: 'VIX', unit: '', dp: 2, canonical: e => econData(e, ['VIX']), live: () => null },
  { key: 'crude', label: 'Crude', unit: '', dp: 2, canonical: e => econData(e, ['CRUDE FUTURE', 'Crude Oil', 'WTI', 'CRUDE']), live: () => null },
];

function round(v, dp) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function safe(fn, arg) {
  try { return fn(arg); } catch (_) { return null; }
}

/**
 * Merge canonical (Economic Update JSON) + live (wire { rates, fred }) into one
 * snapshot. Each metric carries its canonical value + source + as-of, and a
 * `live` block (value + signed delta) only when both sides are present. When the
 * desk PDF lacks a metric entirely, the live value becomes the headline with
 * source 'Live'. Never throws.
 */
function buildMarketSnapshot(econ, wire) {
  const liveAsOf = (wire && wire.rates && wire.rates.asOfDate) || null;
  const deskAsOf = (econ && econ.asOfDate) || null;
  const metrics = {};
  for (const m of METRICS) {
    const canonical = safe(m.canonical, econ);
    const liveValue = safe(m.live, wire);
    const hasCanonical = canonical != null;
    const entry = {
      label: m.label,
      unit: m.unit,
      dp: m.dp,
      value: hasCanonical ? canonical : (liveValue != null ? liveValue : null),
      source: hasCanonical ? 'Economic Update' : (liveValue != null ? 'Live' : null),
      asOf: hasCanonical ? deskAsOf : liveAsOf
    };
    if (hasCanonical && liveValue != null) {
      const deltaRaw = liveValue - canonical;
      entry.live = {
        value: liveValue,
        asOf: liveAsOf,
        delta: round(deltaRaw, m.unit === 'bp' ? 0 : m.dp),
        deltaBp: m.unit === '%' ? Math.round(deltaRaw * 100) : (m.unit === 'bp' ? Math.round(deltaRaw) : null)
      };
    }
    metrics[m.key] = entry;
  }
  return {
    asOf: { desk: deskAsOf, deskAt: (econ && econ.extractedAt) || null, live: liveAsOf },
    metrics
  };
}

module.exports = { buildMarketSnapshot, METRICS };
