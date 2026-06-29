/**
 * market-color-feed.js — live market-color news, sourced from public RSS.
 *
 * Replaces the old desk-uploaded .eml market-color inbox with an automatic
 * feed, the same way the Fed/FDIC/SEC wire works (market-wire.js). Same
 * playbook: keyless public feeds only, disk cache under data/market/, TTL,
 * stale-on-failure, never throws, no dependencies (global fetch + regex).
 *
 * Licensing: these are the publishers' own RSS feeds. We surface the headline +
 * the feed-provided summary snippet and link OUT to the source article — we
 * never republish article bodies (the same "link out, never republish" rule the
 * wire follows for Bloomberg/S&P-walled content).
 *
 * A feed that fails on refresh keeps its previously cached items; only a total
 * failure serves the whole cache stale.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// CNBC cross-posts the same story across Markets/Economy/Finance, so the
// response dedups by URL and by normalized title before capping.
const FEEDS = [
  { key: 'cnbc-markets', label: 'CNBC Markets', url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html' },
  { key: 'cnbc-economy', label: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { key: 'cnbc-finance', label: 'CNBC Finance', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { key: 'mw-topstories', label: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { key: 'mw-marketpulse', label: 'MarketWatch Pulse', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  { key: 'mw-bulletins', label: 'MarketWatch Bulletins', url: 'https://feeds.content.dowjones.io/public/rss/mw_bulletins' },
];

const CACHE_FILE = 'market-color-feed.json';
const TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_ITEMS_PER_FEED = 15;
const MAX_ARTICLES = 60;
const SUMMARY_MAX = 320;
const TITLE_MAX = 240;

// Same keyword tagging the old .eml inbox used, so the tag chips/search keep
// working unchanged against the RSS-sourced items.
const TAG_RULES = [
  ['rates', /fed|fomc|rate|yield|treasur|inflation|cpi|ppi|powell/i],
  ['credit', /credit|spread|bond|issuance|debt|default|downgrade/i],
  ['equities', /equit|stock|futures|s&p|nasdaq|dow|earnings/i],
  ['macro', /oil|energy|tariff|iran|china|geopolit|gdp|jobs|payroll/i],
  ['banks', /bank|deposit|loan|liquidit|lender|fdic/i],
];

const PERSONAL_FINANCE_URL_RE = /\/(?:personal-finance|retirement|personalfinance|pf|select|make-it)\b/i;
const PERSONAL_FINANCE_TEXT_RE = /\b(?:personal finance|retirement planning|retirees?|401\(k\)|401k|ira|roth ira|social security benefits?|medicare|student loans?|credit cards?|personal loans?|auto loans?|car insurance|home buyers?|homebuyers?|home equity|mortgage rates?|savings accounts?|checking accounts?|budgeting)\b/i;
const PERSONAL_FINANCE_ADVICE_RE = /\b(?:how to|what to know|what it means for you|your money|your wallet|your taxes|financial advisor|financial planner)\b/i;

// ---------- RSS parsing (pure, fixture-tested) ----------

function decodeEntities(text) {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function inferTags(text) {
  const tags = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) tags.push(tag);
  }
  return tags.length ? tags : ['market color'];
}

function isPersonalFinanceArticle(item) {
  const title = String((item && item.title) || '');
  const summary = String((item && item.summary) || '');
  const url = String((item && item.url) || '');
  const text = `${title} ${summary}`;
  if (PERSONAL_FINANCE_URL_RE.test(url)) return true;
  if (PERSONAL_FINANCE_TEXT_RE.test(text)) return true;
  return PERSONAL_FINANCE_ADVICE_RE.test(text) && /\b(?:money|tax|retire|saving|debt|loan|mortgage|credit|household|consumer)\b/i.test(text);
}

/**
 * Parse RSS 2.0 <item> blocks into normalized articles. Items missing a title
 * or a parseable https link are dropped; title/summary are tag-stripped and
 * capped; tags are inferred from title+summary.
 */
function parseFeedItems(xml) {
  const items = [];
  if (typeof xml !== 'string' || !/<item[\s>]/i.test(xml)) return items;
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const title = tagText(block, 'title').slice(0, TITLE_MAX);
    const url = tagText(block, 'link');
    if (!title || !/^https:\/\//i.test(url)) continue;
    const summary = tagText(block, 'description').slice(0, SUMMARY_MAX);
    if (isPersonalFinanceArticle({ title, url, summary })) continue;
    const pubDate = tagText(block, 'pubDate') || tagText(block, 'dc:date');
    const parsed = pubDate ? Date.parse(pubDate) : NaN;
    items.push({
      title,
      url,
      summary,
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
      tags: inferTags(`${title} ${summary}`),
    });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return items;
}

// Stable per-article id from the URL (so the front end has a key without crypto).
function articleId(url) {
  let h = 5381;
  const s = String(url);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'a' + (h >>> 0).toString(36);
}

function normalizeTitleKey(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
    headers: { 'User-Agent': 'fbbs-portal/market-color-feed' },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.text();
}

// ---------- Response assembly ----------

function buildResponse(cache, { stale = false } = {}) {
  if (!cache || !cache.feeds) return { updatedAt: null, sources: [], items: [], warnings: [], stale: Boolean(stale) };
  const sources = [];
  const collected = [];
  for (const feed of FEEDS) {
    const slot = cache.feeds[feed.key];
    if (!slot) continue;
    sources.push({ key: feed.key, label: feed.label, fetchedAt: slot.fetchedAt || null });
    for (const item of slot.items || []) {
      collected.push({ ...item, source: feed.label, sourceKey: feed.key });
    }
  }
  collected.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));

  const seenUrl = new Set();
  const seenTitle = new Set();
  const items = [];
  for (const it of collected) {
    if (seenUrl.has(it.url)) continue;
    if (isPersonalFinanceArticle(it)) continue;
    const tkey = normalizeTitleKey(it.title);
    if (tkey && seenTitle.has(tkey)) continue;
    seenUrl.add(it.url);
    if (tkey) seenTitle.add(tkey);
    items.push({ id: articleId(it.url), ...it });
    if (items.length >= MAX_ARTICLES) break;
  }

  return {
    updatedAt: cache.fetchedAt || null,
    sources,
    items,
    warnings: [],
    stale: Boolean(stale),
  };
}

let inflight = null;

/**
 * Merged market-color news, cache-fresh within ttlMs (default 30m). A feed that
 * fails on refresh keeps its previously cached items; if every feed fails the
 * whole cache is served with stale:true. Never throws.
 *
 * opts: { marketDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getMarketColorFeed(opts) {
  const marketDir = opts && opts.marketDir;
  if (!marketDir) throw new Error('getMarketColorFeed requires opts.marketDir');
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(marketDir, CACHE_FILE);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildResponse(cache);
  }

  if (!inflight) {
    inflight = (async () => {
      const results = await Promise.allSettled(
        FEEDS.map(async feed => ({ feed, items: parseFeedItems(await fetchText(feed.url, fetchImpl)) }))
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
          log('warn', `market-color feed ${FEEDS[i].key} failed:`, reason);
        }
      }
      if (!succeeded) throw new Error('all market-color feeds failed');
      const fresh = { fetchedAt: new Date(now).toISOString(), feeds };
      writeCache(marketDir, CACHE_FILE, fresh);
      return fresh;
    })().finally(() => { inflight = null; });
  }

  try {
    return buildResponse(await inflight);
  } catch (err) {
    log('warn', 'market-color feed refresh failed:', err.message);
    if (cache) return buildResponse(cache, { stale: true });
    return { updatedAt: null, sources: [], items: [], warnings: ['Live market color unavailable.'], stale: true };
  }
}

module.exports = {
  getMarketColorFeed,
  // exported for tests
  parseFeedItems,
  inferTags,
  isPersonalFinanceArticle,
  buildResponse,
  FEEDS,
};
