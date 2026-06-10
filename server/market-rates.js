/**
 * market-rates.js — official U.S. Treasury daily par yield curve.
 *
 * Fetches the no-auth Treasury XML feed (home.treasury.gov, OData/Atom) and
 * caches it under data/market/. Gives the portal an always-on baseline curve
 * that does not depend on the daily package: Treasury Explorer banner, the
 * exec-summary / home market overlay fallback, and date-stamped curve context
 * for swap proposals.
 *
 * No dependencies — Node's global fetch + a regex parse of the fixed feed
 * shape. The feed publishes one entry per business day with BC_* tenor
 * fields in percent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FEED_BASE = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
const CACHE_FILENAME = 'treasury-yield-curve.json';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // refetch at most every 6 hours
const FETCH_TIMEOUT_MS = 15000;

// XML field → tenor label, in curve order. BC_1_5MONTH (6-week bill) is
// intentionally skipped — nobody quotes it and it clutters the curve.
const TENOR_FIELDS = [
  ['BC_1MONTH', '1M'],
  ['BC_2MONTH', '2M'],
  ['BC_3MONTH', '3M'],
  ['BC_4MONTH', '4M'],
  ['BC_6MONTH', '6M'],
  ['BC_1YEAR', '1Y'],
  ['BC_2YEAR', '2Y'],
  ['BC_3YEAR', '3Y'],
  ['BC_5YEAR', '5Y'],
  ['BC_7YEAR', '7Y'],
  ['BC_10YEAR', '10Y'],
  ['BC_20YEAR', '20Y'],
  ['BC_30YEAR', '30Y'],
];

const TENOR_ORDER = TENOR_FIELDS.map(([, label]) => label);

/**
 * Parse the Treasury daily-yield-curve Atom feed into
 * [{ date: 'YYYY-MM-DD', tenors: { '1M': 3.72, ... } }], sorted by date asc.
 * Pure — unit-tested against a saved fixture.
 */
function parseYieldCurveXml(xml) {
  const entries = [];
  if (typeof xml !== 'string' || !xml.includes('<entry>')) return entries;
  const blocks = xml.split('<entry>').slice(1);
  for (const block of blocks) {
    const dateMatch = block.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const tenors = {};
    for (const [field, label] of TENOR_FIELDS) {
      const m = block.match(new RegExp(`<d:${field}[^>]*>([-0-9.]+)<`));
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) tenors[label] = v;
      }
    }
    if (Object.keys(tenors).length) entries.push({ date: dateMatch[1], tenors });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

/**
 * Shape the cached daily entries into the API response: latest curve,
 * previous business day, and per-tenor day-over-day changes (pct points).
 */
function buildCurveResponse(entries, meta) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const latest = entries[entries.length - 1];
  const previous = entries.length > 1 ? entries[entries.length - 2] : null;
  const changes = {};
  if (previous) {
    for (const label of TENOR_ORDER) {
      if (latest.tenors[label] != null && previous.tenors[label] != null) {
        changes[label] = Number((latest.tenors[label] - previous.tenors[label]).toFixed(2));
      }
    }
  }
  return {
    source: 'U.S. Treasury daily par yield curve (home.treasury.gov)',
    asOfDate: latest.date,
    tenors: latest.tenors,
    previous: previous ? { asOfDate: previous.date, tenors: previous.tenors } : null,
    changes,
    tenorOrder: TENOR_ORDER.filter(l => latest.tenors[l] != null),
    fetchedAt: meta.fetchedAt || null,
    stale: Boolean(meta.stale),
  };
}

async function fetchYearXml(year, fetchImpl) {
  const url = `${FEED_BASE}?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'fbbs-portal/market-rates' },
  });
  if (!res.ok) throw new Error(`Treasury feed responded ${res.status}`);
  return res.text();
}

function readCache(marketDir) {
  try {
    const raw = fs.readFileSync(path.join(marketDir, CACHE_FILENAME), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch (_) { /* absent or unreadable — refetch */ }
  return null;
}

function writeCache(marketDir, cache) {
  fs.mkdirSync(marketDir, { recursive: true });
  const tmp = path.join(marketDir, `${CACHE_FILENAME}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, path.join(marketDir, CACHE_FILENAME));
}

let inflight = null;

/**
 * Latest official curve, served from the on-disk cache when fresh (ttlMs,
 * default 6h), refetched otherwise. On fetch failure a stale cache is
 * returned with stale:true; with no cache at all, null. Never throws.
 *
 * opts: { marketDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getLatestYieldCurve(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getLatestYieldCurve requires opts.marketDir');
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildCurveResponse(cache.entries, { fetchedAt: cache.fetchedAt });
  }

  if (!inflight) {
    inflight = (async () => {
      const year = new Date(now).getUTCFullYear();
      let entries = parseYieldCurveXml(await fetchYearXml(year, fetchImpl));
      // Early January: the new year's feed may not have 2 prints yet — merge
      // in the prior year so "previous business day" stays available.
      if (entries.length < 2) {
        try {
          const prior = parseYieldCurveXml(await fetchYearXml(year - 1, fetchImpl));
          entries = prior.concat(entries);
        } catch (_) { /* prior year optional */ }
      }
      if (!entries.length) throw new Error('Treasury feed returned no entries');
      const fresh = { fetchedAt: new Date(now).toISOString(), entries };
      writeCache(marketDir, fresh);
      return fresh;
    })().finally(() => { inflight = null; });
  }

  try {
    const fresh = await inflight;
    return buildCurveResponse(fresh.entries, { fetchedAt: fresh.fetchedAt });
  } catch (err) {
    log('warn', 'Treasury yield-curve fetch failed:', err.message);
    if (cache) return buildCurveResponse(cache.entries, { fetchedAt: cache.fetchedAt, stale: true });
    return null;
  }
}

module.exports = {
  parseYieldCurveXml,
  buildCurveResponse,
  getLatestYieldCurve,
  TENOR_ORDER,
};
