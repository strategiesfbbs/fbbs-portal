/**
 * fred-series.js — daily rate benchmarks from the St. Louis Fed's FRED API.
 *
 * Adds the desk benchmarks the keyless sources don't carry: SOFR, effective
 * fed funds, and the 10Y breakeven inflation rate. FRED requires a (free)
 * API key, so this module is DORMANT until FRED_API_KEY is set — every entry
 * point returns null without a key and the Market Wire simply doesn't show
 * these cards. Same playbook as market-rates.js / market-wire.js: disk cache
 * under data/market/, TTL, per-series failures keep that series' cached
 * value, stale-on-failure, never throws, no dependencies.
 *
 * FRED terms allow this use (the data is public; the key just identifies the
 * caller). Default tier is 120 requests/minute — three calls every six hours
 * is nowhere near it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// `group` drives where the frontend surfaces a series (core wire cards vs.
// the Market Color hub's extended band);
// `format: 'bp'` marks OAS series quoted in percent but displayed in bp.
// (The FDIC national-average CD series (NDR*MCD) were removed 2026-07-02 —
// a retail branch-rate survey far below where FBBS issuers actually fund;
// the desk's own daily brokered-CD medians replaced them everywhere.)
const SERIES = [
  { id: 'SOFR', key: 'sofr', label: 'SOFR', group: 'core' },
  { id: 'DFF', key: 'fedFunds', label: 'Fed Funds (effective)', group: 'core' },
  { id: 'T10YIE', key: 'breakeven10Y', label: '10Y Breakeven', group: 'core' },
  // Credit spreads — ICE BofA option-adjusted spreads (percent → shown as bp).
  { id: 'BAMLC0A0CM', key: 'igOas', label: 'IG OAS', group: 'core', format: 'bp' },
  { id: 'BAMLH0A0HYM2', key: 'hyOas', label: 'HY OAS', group: 'core', format: 'bp' },
  // Funding complex.
  { id: 'SOFR30DAYAVG', key: 'sofr30', label: 'SOFR 30d Avg', group: 'extended' },
  { id: 'SOFR90DAYAVG', key: 'sofr90', label: 'SOFR 90d Avg', group: 'extended' },
  { id: 'IORB', key: 'iorb', label: 'IORB', group: 'extended' },
  { id: 'DPRIME', key: 'prime', label: 'Prime', group: 'extended' },
  // Inflation expectations beyond the 10Y breakeven.
  { id: 'T5YIE', key: 'breakeven5Y', label: '5Y Breakeven', group: 'extended' },
  { id: 'T5YIFR', key: 'fwd5y5y', label: '5y5y Fwd Inflation', group: 'extended' },
];

const CACHE_FILENAME = 'fred-indicators.json';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Latest usable observation from a FRED observations payload (desc order
 * requested; "." means no print for that date — weekends/holidays).
 * Returns { value, date } or null on junk.
 */
function parseFredObservations(json) {
  const rows = json && Array.isArray(json.observations) ? json.observations : [];
  for (const row of rows) {
    const value = Number(row.value);
    if (row.value !== '.' && Number.isFinite(value)) {
      return { value: Number(value.toFixed(2)), date: String(row.date || '') };
    }
  }
  return null;
}

/**
 * Up to `max` usable observations, ascending by date, as compact
 * { d, v } pairs — feeds the wire-card sparklines. Desc input expected.
 */
function parseFredHistory(json, max = 90) {
  const rows = json && Array.isArray(json.observations) ? json.observations : [];
  const out = [];
  for (const row of rows) {
    const value = Number(row.value);
    if (row.value === '.' || !Number.isFinite(value)) continue;
    out.push({ d: String(row.date || ''), v: Number(value.toFixed(2)) });
    if (out.length >= max) break;
  }
  return out.reverse();
}

function readCache(marketDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(marketDir, CACHE_FILENAME), 'utf-8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* absent or unreadable — refetch */ }
  return null;
}

function writeCache(marketDir, cache) {
  fs.mkdirSync(marketDir, { recursive: true });
  const tmp = path.join(marketDir, `${CACHE_FILENAME}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, path.join(marketDir, CACHE_FILENAME));
}

function buildResponse(cache, { stale = false } = {}) {
  if (!cache || !cache.series || !Object.keys(cache.series).length) return null;
  return { ...cache.series, fetchedAt: cache.fetchedAt || null, stale: Boolean(stale) };
}

let inflight = null;

/**
 * SOFR / fed funds / 10Y breakeven, cache-fresh within ttlMs (default 6h).
 * Null when FRED_API_KEY is not configured. A series that fails on refresh
 * keeps its cached value; if every series fails the cache is served with
 * stale:true, or null with no cache. Never throws.
 *
 * opts: { marketDir (required), apiKey?, ttlMs?, fetchImpl?, now?, log? }
 */
async function getFredIndicators(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getFredIndicators requires opts.marketDir');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.FRED_API_KEY || '');
  if (!String(apiKey).trim()) return null; // dormant until configured
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildResponse(cache);
  }

  if (!inflight) {
    inflight = (async () => {
      const results = await Promise.allSettled(SERIES.map(async s => {
        // 130 raw rows ≈ 90 usable daily prints after "."-holes — sparkline depth.
        const url = `${FRED_BASE}?series_id=${encodeURIComponent(s.id)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=130`;
        const res = await fetchImpl(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'fbbs-portal/fred-series' },
        });
        if (!res.ok) throw new Error(`FRED ${s.id} responded ${res.status}`);
        const json = await res.json();
        const latest = parseFredObservations(json);
        if (!latest) throw new Error(`FRED ${s.id} had no usable observations`);
        return { s, latest, history: parseFredHistory(json) };
      }));
      const series = { ...(cache && cache.series) };
      let succeeded = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled') {
          const { s, latest, history } = r.value;
          series[s.key] = {
            ...latest,
            label: s.label,
            seriesId: s.id,
            group: s.group || 'core',
            ...(s.format ? { format: s.format } : {}),
            ...(s.term ? { term: s.term } : {}),
            ...(history && history.length > 1 ? { history } : {})
          };
          succeeded += 1;
        } else {
          log('warn', `FRED series ${SERIES[i].id} failed:`, r.reason.message);
        }
      }
      if (!succeeded) throw new Error('all FRED series failed');
      const fresh = { fetchedAt: new Date(now).toISOString(), series };
      writeCache(marketDir, fresh);
      return fresh;
    })().finally(() => { inflight = null; });
  }

  try {
    return buildResponse(await inflight);
  } catch (err) {
    log('warn', 'FRED refresh failed:', err.message);
    if (cache) return buildResponse(cache, { stale: true });
    return null;
  }
}

module.exports = {
  parseFredObservations,
  parseFredHistory,
  getFredIndicators,
  SERIES,
};
