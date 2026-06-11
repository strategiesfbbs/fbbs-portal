/**
 * market-wire.js — live official headlines + headline economic indicators.
 *
 * Two keyless, freely-redistributable source families, following the
 * market-rates.js playbook (disk cache, TTL, stale-on-failure, never throws):
 *
 *   1. Government press-release RSS (Federal Reserve, FDIC, SEC). Public
 *      domain — unlike Bloomberg/S&P content, these may be shown on the LAN
 *      portal. Headlines link OUT to the source; we never republish bodies.
 *   2. BLS public timeseries API (CPI-U + unemployment rate). The keyless
 *      tier allows 25 requests/day, so indicators refresh on a 12h TTL
 *      (2 calls/day) while headlines refresh every 30 minutes.
 *
 * Per-feed failures keep that feed's previous items; only a total failure
 * serves the whole cache stale. No dependencies — global fetch + regex.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FEEDS = [
  { key: 'fed', label: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { key: 'fdic', label: 'FDIC', url: 'https://www.fdic.gov/rss.xml' },
  { key: 'sec', label: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss' },
];

const AUCTION_UPCOMING_URL = 'https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json';
const AUCTION_RESULTS_URL = 'https://www.treasurydirect.gov/TA_WS/securities/auctioned?days=8&format=json';

const BLS_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const BLS_SERIES = {
  cpi: 'CUUR0000SA0', // CPI-U, all items, NSA index — rendered as YoY %
  unemployment: 'LNS14000000', // unemployment rate, SA, percent
};

const HEADLINES_CACHE = 'market-wire-headlines.json';
const INDICATORS_CACHE = 'market-wire-indicators.json';
const AUCTIONS_CACHE = 'market-wire-auctions.json';
const HEADLINES_TTL_MS = 30 * 60 * 1000;
const INDICATORS_TTL_MS = 12 * 60 * 60 * 1000;
const AUCTIONS_TTL_MS = 60 * 60 * 1000; // results post early afternoon on auction days
const FETCH_TIMEOUT_MS = 15000;
const MAX_ITEMS_PER_FEED = 10;
const MAX_HEADLINES = 24;

const BLS_MONTHS = {
  M01: 'January', M02: 'February', M03: 'March', M04: 'April',
  M05: 'May', M06: 'June', M07: 'July', M08: 'August',
  M09: 'September', M10: 'October', M11: 'November', M12: 'December',
};

// ---------- RSS parsing (pure, fixture-tested) ----------

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value.replace(/<[^>]*>/g, ''));
}

/**
 * Parse RSS 2.0 <item> blocks into [{ title, url, publishedAt }] (ISO dates,
 * newest first as published). Items missing a title or a parseable https
 * link are dropped; titles are tag-stripped and capped.
 */
function parseRssItems(xml) {
  const items = [];
  if (typeof xml !== 'string' || !/<item[\s>]/i.test(xml)) return items;
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const title = tagText(block, 'title').slice(0, 200);
    const url = tagText(block, 'link');
    if (!title || !/^https:\/\//i.test(url)) continue;
    const pubDate = tagText(block, 'pubDate') || tagText(block, 'dc:date');
    const parsed = pubDate ? Date.parse(pubDate) : NaN;
    items.push({
      title,
      url,
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return items;
}

// ---------- BLS parsing (pure, fixture-tested) ----------

function blsPeriodLabel(entry) {
  const month = BLS_MONTHS[entry.period];
  return month ? `${month} ${entry.year}` : `${entry.period} ${entry.year}`;
}

/**
 * Shape a BLS v2 timeseries response into the two indicators the desk
 * watches. CPI arrives as an index level, so the YoY change is computed
 * against the same month a year earlier; unemployment is already a rate.
 * Returns {} on junk input — callers treat missing keys as "no data".
 */
function parseBlsResponse(json) {
  const indicators = {};
  const series = json && json.Results && Array.isArray(json.Results.series) ? json.Results.series : [];
  for (const s of series) {
    const data = Array.isArray(s.data) ? s.data.filter(d => Number.isFinite(Number(d.value))) : [];
    if (!data.length) continue;
    const latest = data[0]; // BLS returns newest first
    if (s.seriesID === BLS_SERIES.cpi) {
      const prior = data.find(d => d.period === latest.period && Number(d.year) === Number(latest.year) - 1);
      if (!prior) continue;
      indicators.cpiYoY = {
        value: Number((((Number(latest.value) / Number(prior.value)) - 1) * 100).toFixed(1)),
        period: blsPeriodLabel(latest),
        source: 'BLS CPI-U',
      };
    } else if (s.seriesID === BLS_SERIES.unemployment) {
      indicators.unemployment = {
        value: Number(Number(latest.value).toFixed(1)),
        period: blsPeriodLabel(latest),
        source: 'BLS',
      };
    }
  }
  return indicators;
}

// ---------- Treasury auction parsing (pure, fixture-tested) ----------

function auctionDay(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function auctionNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && String(value).trim() !== '' ? n : null;
}

/**
 * Shape the two TreasuryDirect TA_WS payloads into
 * { upcoming: [...], results: [...] }. Bills publish discount/investment
 * rates instead of highYield, so the stop is taken from the first of
 * highYield → highInvestmentRate (bond-equivalent) → highDiscountRate.
 * Junk rows (no auction date or term) are dropped.
 */
function parseAuctions(upcomingJson, resultsJson) {
  const upcoming = (Array.isArray(upcomingJson) ? upcomingJson : [])
    .map(a => ({
      cusip: String(a.cusip || '').trim(),
      type: String(a.securityType || '').trim(),
      term: String(a.securityTerm || '').trim(),
      auctionDate: auctionDay(a.auctionDate),
      issueDate: auctionDay(a.issueDate),
    }))
    .filter(a => a.auctionDate && a.term)
    .sort((a, b) => a.auctionDate.localeCompare(b.auctionDate))
    .slice(0, 12);

  const results = (Array.isArray(resultsJson) ? resultsJson : [])
    .map(a => ({
      cusip: String(a.cusip || '').trim(),
      type: String(a.securityType || '').trim(),
      term: String(a.securityTerm || '').trim(),
      auctionDate: auctionDay(a.auctionDate),
      stopYield: auctionNumber(a.highYield) != null
        ? auctionNumber(a.highYield)
        : (auctionNumber(a.highInvestmentRate) != null ? auctionNumber(a.highInvestmentRate) : auctionNumber(a.highDiscountRate)),
      bidToCover: auctionNumber(a.bidToCoverRatio),
    }))
    .filter(a => a.auctionDate && a.term && a.stopYield != null)
    .sort((a, b) => b.auctionDate.localeCompare(a.auctionDate))
    .slice(0, 10);

  return { upcoming, results };
}

// ---------- Cache plumbing ----------

function readCache(marketDir, filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(marketDir, filename), 'utf-8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* absent or unreadable — refetch */ }
  return null;
}

function writeCache(marketDir, filename, cache) {
  fs.mkdirSync(marketDir, { recursive: true });
  const tmp = path.join(marketDir, `${filename}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, path.join(marketDir, filename));
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'fbbs-portal/market-wire' },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

// ---------- Headlines ----------

function buildHeadlinesResponse(cache, { stale = false } = {}) {
  if (!cache || !cache.feeds) return null;
  const headlines = [];
  const sources = [];
  for (const feed of FEEDS) {
    const slot = cache.feeds[feed.key];
    if (!slot) continue;
    sources.push({ key: feed.key, label: feed.label, fetchedAt: slot.fetchedAt || null });
    for (const item of slot.items || []) {
      headlines.push({ ...item, source: feed.label, sourceKey: feed.key });
    }
  }
  headlines.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  return {
    headlines: headlines.slice(0, MAX_HEADLINES),
    sources,
    fetchedAt: cache.fetchedAt || null,
    stale: Boolean(stale),
  };
}

let headlinesInflight = null;

/**
 * Merged official headlines, cache-fresh within ttlMs (default 30m).
 * A feed that fails on refresh keeps its previously cached items; if every
 * feed fails the whole cache is served with stale:true. Never throws.
 *
 * opts: { marketDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getLatestHeadlines(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getLatestHeadlines requires opts.marketDir');
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : HEADLINES_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir, HEADLINES_CACHE);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildHeadlinesResponse(cache);
  }

  if (!headlinesInflight) {
    headlinesInflight = (async () => {
      const results = await Promise.allSettled(
        FEEDS.map(async feed => ({ feed, items: parseRssItems(await fetchText(feed.url, fetchImpl)) }))
      );
      const feeds = { ...(cache && cache.feeds) };
      let succeeded = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.items.length) {
          feeds[r.value.feed.key] = { fetchedAt: new Date(now).toISOString(), items: r.value.items };
          succeeded += 1;
        } else {
          const reason = r.status === 'rejected' ? r.reason.message : 'no items parsed';
          log('warn', `market-wire feed ${FEEDS[i].key} failed:`, reason);
        }
      }
      if (!succeeded) throw new Error('all market-wire feeds failed');
      const fresh = { fetchedAt: new Date(now).toISOString(), feeds };
      writeCache(marketDir, HEADLINES_CACHE, fresh);
      return fresh;
    })().finally(() => { headlinesInflight = null; });
  }

  try {
    return buildHeadlinesResponse(await headlinesInflight);
  } catch (err) {
    log('warn', 'market-wire headlines refresh failed:', err.message);
    if (cache) return buildHeadlinesResponse(cache, { stale: true });
    return null;
  }
}

// ---------- Indicators ----------

function buildIndicatorsResponse(cache, { stale = false } = {}) {
  if (!cache || !cache.indicators || !Object.keys(cache.indicators).length) return null;
  return { ...cache.indicators, fetchedAt: cache.fetchedAt || null, stale: Boolean(stale) };
}

let indicatorsInflight = null;

/**
 * CPI YoY + unemployment rate from the keyless BLS API, cache-fresh within
 * ttlMs (default 12h — the keyless tier is capped at 25 calls/day). The
 * request spans three calendar years so the prior-year CPI month is always
 * present, even in January when the latest print is from the old year.
 * Stale cache on failure; null with no cache. Never throws.
 *
 * opts: { marketDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getEconomicIndicators(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getEconomicIndicators requires opts.marketDir');
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : INDICATORS_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir, INDICATORS_CACHE);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildIndicatorsResponse(cache);
  }

  if (!indicatorsInflight) {
    indicatorsInflight = (async () => {
      const year = new Date(now).getUTCFullYear();
      const res = await fetchImpl(BLS_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'fbbs-portal/market-wire' },
        body: JSON.stringify({
          seriesid: Object.values(BLS_SERIES),
          startyear: String(year - 2),
          endyear: String(year),
        }),
      });
      if (!res.ok) throw new Error(`BLS API responded ${res.status}`);
      const indicators = parseBlsResponse(await res.json());
      if (!Object.keys(indicators).length) throw new Error('BLS response had no usable series');
      const fresh = { fetchedAt: new Date(now).toISOString(), indicators };
      writeCache(marketDir, INDICATORS_CACHE, fresh);
      return fresh;
    })().finally(() => { indicatorsInflight = null; });
  }

  try {
    return buildIndicatorsResponse(await indicatorsInflight);
  } catch (err) {
    log('warn', 'market-wire indicators refresh failed:', err.message);
    if (cache) return buildIndicatorsResponse(cache, { stale: true });
    return null;
  }
}

// ---------- Treasury auctions ----------

function buildAuctionsResponse(cache, { stale = false } = {}) {
  if (!cache || (!Array.isArray(cache.upcoming) && !Array.isArray(cache.results))) return null;
  return {
    upcoming: cache.upcoming || [],
    results: cache.results || [],
    fetchedAt: cache.fetchedAt || null,
    stale: Boolean(stale),
  };
}

let auctionsInflight = null;

/**
 * Upcoming Treasury auctions + the last week of auction results from the
 * keyless TreasuryDirect TA_WS API, cache-fresh within ttlMs (default 1h).
 * Stale cache on failure; null with no cache. Never throws.
 *
 * opts: { marketDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getTreasuryAuctions(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getTreasuryAuctions requires opts.marketDir');
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : AUCTIONS_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir, AUCTIONS_CACHE);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildAuctionsResponse(cache);
  }

  if (!auctionsInflight) {
    auctionsInflight = (async () => {
      const [upcomingText, resultsText] = await Promise.all([
        fetchText(AUCTION_UPCOMING_URL, fetchImpl),
        fetchText(AUCTION_RESULTS_URL, fetchImpl),
      ]);
      const parsed = parseAuctions(JSON.parse(upcomingText), JSON.parse(resultsText));
      if (!parsed.upcoming.length && !parsed.results.length) {
        throw new Error('TreasuryDirect returned no auctions');
      }
      const fresh = { fetchedAt: new Date(now).toISOString(), ...parsed };
      writeCache(marketDir, AUCTIONS_CACHE, fresh);
      return fresh;
    })().finally(() => { auctionsInflight = null; });
  }

  try {
    return buildAuctionsResponse(await auctionsInflight);
  } catch (err) {
    log('warn', 'market-wire auctions refresh failed:', err.message);
    if (cache) return buildAuctionsResponse(cache, { stale: true });
    return null;
  }
}

module.exports = {
  parseRssItems,
  parseBlsResponse,
  parseAuctions,
  getLatestHeadlines,
  getEconomicIndicators,
  getTreasuryAuctions,
  FEEDS,
};
