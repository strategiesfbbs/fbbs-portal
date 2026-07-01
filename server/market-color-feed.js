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

// Desk relevance gate:
// MarketWatch top stories and CNBC finance feeds carry a lot of lifestyle,
// stock-picking, and consumer-advice content. The sales desk needs article
// color that can plausibly shape a bank conversation: rates, the Fed, fixed
// income/credit, bank funding/regulation, macro data, energy/trade shocks, or
// broad market-index moves. Keep the rules explicit and fixture-tested so the
// page does not slowly drift back into retail news.
const TAG_RULES = [
  ['rates', /\b(?:fed|fomc|powell|warsh|hammack|kashkari|goolsbee|interest[- ]rates?|rate[- ](?:cut|cuts|hike|hikes|path|outlook)|monetary policy|central bank|treasur(?:y|ies)|yield(?:s| curve)?|curve|auction|term premium|duration|inflation|cpi|ppi|pce)\b/i],
  ['credit', /\b(?:bond markets?|bonds?|fixed income|credit spreads?|spreads?|corporate debt|muni(?:cipal)?s?|issuance|default|downgrade|upgrade|high[- ]yield|investment[- ]grade|leveraged loans?|oas)\b/i],
  ['equities', /\b(?:s&p 500|nasdaq(?:-100)?|dow jones|russell 2000|small[- ]caps?|stock futures|u\.s\. stocks?|equity markets?|bear market|bull market|market rally|sell-?off|record close|market breadth|valuation|earnings season)\b/i],
  ['macro', /\b(?:oil prices?|crude|energy prices?|tariffs?|sanctions?|trade war|exports?|shipping|strait of hormuz|supply chain|geopolitics?|gdp|payrolls?|jobs report|jobless claims|unemployment|adp|ism|pmi|factory|manufacturing|retail sales|consumer confidence|housing starts|economic data|economic calendar|recession|soft landing)\b/i],
  ['banks', /\b(?:bank earnings|regional banks?|bank stocks?|banking system|deposits?|loan growth|liquidity|lenders?|fdic|net interest margin|commercial real estate|cre)\b/i],
];

const PERSONAL_FINANCE_URL_RE = /\/(?:personal-finance|retirement|personalfinance|pf|select|make-it)\b/i;
const PERSONAL_FINANCE_TEXT_RE = /\b(?:personal finance|retirement planning|retirees?|401\(k\)|401k|ira|roth ira|social security benefits?|medicare|student loans?|credit cards?|personal loans?|auto loans?|car insurance|home buyers?|homebuyers?|home equity|reverse mortgage|mortgage rates?|savings accounts?|checking accounts?|budgeting|estate planning|inheritance|payroll taxes?|trump accounts?|children's financial future)\b/i;
const PERSONAL_FINANCE_ADVICE_RE = /\b(?:how to|what to know|what it means for you|your money|your wallet|your taxes|financial advisor|financial planner|should you|protect your|worth streaming|best time to buy|stocks? to buy)\b/i;
const LIFESTYLE_TEXT_RE = /\b(?:streaming|netflix|hulu|hbo|max|apple tv|cooling costs?|heat wave|stay healthy|meds?|romance|life admin|soft off day|love your job|job satisfaction|walmart|earthquakes?|casinos?)\b/i;
const RETAIL_TRADING_TEXT_RE = /\b(?:traders? (?:are )?(?:betting|divided|worried)|how to ride|with less risk|top wall street analysts|analysts? (?:are )?bullish|short sellers?|shorting|post-earnings rally|monster rally|options traders?|prediction market|polymarket|kalshi|bitcoin|crypto)\b/i;
const STOCK_PICK_TEXT_RE = /\b(?:these \d+ stocks?|stocks? to buy|best time .*buy .*stocks?|global etf|etf that's|how to ride|with less risk|top wall street analysts|analysts? (?:are )?bullish)\b/i;
const SINGLE_STOCK_TEXT_RE = /\b(?:caterpillar|micron|metlife|spacex|alphabet|verizon|openai|tesla|apple stock)\b/i;
const BANK_ACCOUNT_CONSUMER_RE = /\b(?:your bank accounts?|connect to your bank accounts?|bank account privacy|checking accounts?)\b/i;

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

function tagNamesForText(text) {
  const tags = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) tags.push(tag);
  }
  return tags;
}

function inferTags(text) {
  const tags = tagNamesForText(text);
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

function isSalesRelevantArticle(item) {
  const title = String((item && item.title) || '');
  const summary = String((item && item.summary) || '');
  const url = String((item && item.url) || '');
  const text = `${title} ${summary}`;
  if (isPersonalFinanceArticle({ title, summary, url })) return false;
  if (LIFESTYLE_TEXT_RE.test(text)) return false;
  if (BANK_ACCOUNT_CONSUMER_RE.test(text)) return false;
  if (STOCK_PICK_TEXT_RE.test(text)) return false;

  const tags = tagNamesForText(text);
  if (!tags.length) return false;

  // Equity-only single-name/options pieces are retail trade ideas, not useful
  // color for bank-account conversations. Keep broad index/market items and
  // any article that also has a rates, macro, credit, or banking hook.
  const onlyEquities = tags.length === 1 && tags[0] === 'equities';
  if (onlyEquities && (RETAIL_TRADING_TEXT_RE.test(text) || SINGLE_STOCK_TEXT_RE.test(text))) return false;
  if (RETAIL_TRADING_TEXT_RE.test(text) && !tags.some(tag => tag === 'rates' || tag === 'credit' || tag === 'macro' || tag === 'banks')) return false;
  return true;
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
    if (!isSalesRelevantArticle({ title, url, summary })) continue;
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
    if (!isSalesRelevantArticle(it)) continue;
    const tkey = normalizeTitleKey(it.title);
    if (tkey && seenTitle.has(tkey)) continue;
    seenUrl.add(it.url);
    if (tkey) seenTitle.add(tkey);
    items.push({ id: articleId(it.url), ...it, tags: inferTags(`${it.title} ${it.summary || ''}`) });
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
        if (r.status === 'fulfilled') {
          feeds[r.value.feed.key] = { fetchedAt: new Date(now).toISOString(), items: r.value.items };
          succeeded += 1;
        } else {
          const reason = r.reason.message;
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
  isSalesRelevantArticle,
  buildResponse,
  FEEDS,
};
