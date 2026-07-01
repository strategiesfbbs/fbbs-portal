// Tests for server/market-color-feed.js — public-RSS market-color news.
// Pure parse + cache behavior with an injected fetch; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const feed = require('../server/market-color-feed');

function rssFixture(items) {
  const body = items.map(it => `<item>
    <title>${it.cdata ? `<![CDATA[${it.title}]]>` : it.title}</title>
    <link>${it.link}</link>
    <description>${it.cdata ? `<![CDATA[${it.desc || ''}]]>` : (it.desc || '')}</description>
    <pubDate>${it.pubDate || ''}</pubDate>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8" ?>\n<rss version="2.0"><channel><title>Fixture</title>\n${body}\n</channel></rss>`;
}

// A fetch double that maps URL substrings to fixture bodies (or throws).
function makeFetch(routes) {
  return async (url) => {
    for (const [needle, body] of routes) {
      if (url.includes(needle)) {
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, text: async () => body };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-feed-'));
}

// ---------- parseFeedItems ----------

function testParse() {
  const xml = rssFixture([
    { title: 'Fed holds rates steady', link: 'https://www.cnbc.com/a.html', desc: 'The FOMC left the target range unchanged.', pubDate: 'Wed, 18 Jun 2026 14:00:00 GMT', cdata: true },
    { title: 'No link here', link: 'http://insecure.example/x', desc: 'dropped — not https', pubDate: '' },
    { title: 'Stocks rally into the close', link: 'https://www.cnbc.com/b.html', desc: 'S&amp;P 500 gains.', pubDate: 'Wed, 18 Jun 2026 13:00:00 GMT' },
  ]);
  const items = feed.parseFeedItems(xml);
  assert.strictEqual(items.length, 2, 'non-https item is dropped');
  assert.strictEqual(items[0].title, 'Fed holds rates steady');
  assert.strictEqual(items[0].url, 'https://www.cnbc.com/a.html');
  assert.strictEqual(items[0].summary, 'The FOMC left the target range unchanged.');
  assert.ok(items[0].tags.includes('rates'), 'rates tag inferred from FOMC');
  assert.strictEqual(items[0].publishedAt, new Date('Wed, 18 Jun 2026 14:00:00 GMT').toISOString());
  assert.ok(items[1].summary.includes('S&P 500'), 'entities decoded in summary');
  assert.ok(items[1].tags.includes('equities'), 'equities tag inferred');
  console.log('  ✓ parseFeedItems: drops non-https, decodes entities, infers tags');
}

function testTagFallback() {
  assert.deepStrictEqual(feed.inferTags('something with no keywords'), ['market color']);
  assert.ok(feed.inferTags('treasury yields fell').includes('rates'));
  console.log('  ✓ inferTags: default + keyword');
}

function testSalesRelevanceFilter() {
  assert.ok(feed.isSalesRelevantArticle({
    title: 'Fed officials debate rate cuts as Treasury yields fall',
    url: 'https://www.cnbc.com/fed.html',
    summary: 'Bond markets are repricing the policy path.'
  }), 'rates and Treasury story kept');
  assert.ok(feed.isSalesRelevantArticle({
    title: 'U.S. stocks moving lower as ADP jobs data miss forecasts',
    url: 'https://www.marketwatch.com/bulletins/redirect/go?g=jobs',
    summary: ''
  }), 'broad equity + macro story kept');
  assert.ok(!feed.isSalesRelevantArticle({
    title: 'Here’s what’s worth streaming in July',
    url: 'https://www.marketwatch.com/story/streaming.html',
    summary: 'Netflix and Hulu picks.'
  }), 'lifestyle story dropped');
  assert.ok(!feed.isSalesRelevantArticle({
    title: 'This insurance stock is on an impressive run. How to ride the momentum with less risk',
    url: 'https://www.cnbc.com/metlife.html',
    summary: 'Analysts are bullish on MetLife.'
  }), 'single-stock trade idea dropped');
  assert.ok(!feed.isSalesRelevantArticle({
    title: 'Why energy could be a great place to invest even with oil prices retreating — 5 stocks to buy',
    url: 'https://www.cnbc.com/energy-stocks.html',
    summary: 'Oil prices are moving after the latest supply shock.'
  }), 'stock-pick list dropped even with a macro hook');
  assert.ok(!feed.isSalesRelevantArticle({
    title: 'These 10 stocks have generated nearly all Nasdaq-100 gains this year',
    url: 'https://www.marketwatch.com/bulletins/redirect/go?g=stocks',
    summary: ''
  }), 'stock-list concentration story dropped');
  assert.ok(!feed.isSalesRelevantArticle({
    title: "Bulls are betting big on this global ETF that's deep in a bear market",
    url: 'https://www.cnbc.com/global-etf.html',
    summary: ''
  }), 'ETF trade setup dropped');
  assert.ok(!feed.isSalesRelevantArticle({
    title: 'ChatGPT is ready to connect to your bank accounts. Should you let it in?',
    url: 'https://www.marketwatch.com/story/bank-accounts.html',
    summary: ''
  }), 'consumer bank-account article dropped');
  console.log('  ✓ isSalesRelevantArticle: keeps desk color, drops retail/lifestyle');
}

function testPersonalFinanceFilter() {
  const xml = rssFixture([
    { title: 'Treasury yields rise as Fed path shifts', link: 'https://www.cnbc.com/markets.html', desc: 'Bond yields moved higher.', pubDate: 'Wed, 18 Jun 2026 14:00:00 GMT' },
    { title: 'How to manage your 401(k) when markets fall', link: 'https://www.cnbc.com/personal-finance/retirement.html', desc: 'Retirement planning tips for your money.', pubDate: 'Wed, 18 Jun 2026 13:00:00 GMT' },
    { title: 'Mortgage rates fall for homebuyers', link: 'https://www.marketwatch.com/story/mortgage.html', desc: 'What it means for your wallet.', pubDate: 'Wed, 18 Jun 2026 12:00:00 GMT' },
    { title: 'Here’s what’s worth streaming in July', link: 'https://www.marketwatch.com/story/streaming.html', desc: 'Netflix and Hulu picks.', pubDate: 'Wed, 18 Jun 2026 11:00:00 GMT' },
  ]);
  const items = feed.parseFeedItems(xml);
  assert.deepStrictEqual(items.map(i => i.title), ['Treasury yields rise as Fed path shifts']);
  assert.ok(feed.isPersonalFinanceArticle({ title: 'Credit card debt hits consumers', url: 'https://example.com/x', summary: '' }));
  console.log('  ✓ parseFeedItems: drops personal-finance and lifestyle articles');
}

// ---------- getMarketColorFeed: dedup + sort + cache ----------

async function testFetchDedupSortCache() {
  const dir = tmpDir();
  // CNBC Markets + Finance both carry the same headline (cross-post) — should dedup.
  const markets = rssFixture([
    { title: 'Shared headline about bonds', link: 'https://www.cnbc.com/shared.html', desc: 'credit spreads tighten', pubDate: 'Wed, 18 Jun 2026 10:00:00 GMT' },
    { title: 'Older Treasury story', link: 'https://www.cnbc.com/old.html', desc: 'Treasury yields slipped.', pubDate: 'Wed, 18 Jun 2026 08:00:00 GMT' },
  ]);
  const finance = rssFixture([
    { title: 'Shared headline about bonds', link: 'https://www.cnbc.com/shared.html', desc: 'credit spreads tighten', pubDate: 'Wed, 18 Jun 2026 10:00:00 GMT' },
    { title: 'Newest Fed rate story', link: 'https://www.cnbc.com/new.html', desc: 'Treasury yields moved after Fed comments.', pubDate: 'Wed, 18 Jun 2026 12:00:00 GMT' },
  ]);
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes('15839069') || url.includes('20910258')) return { ok: true, status: 200, text: async () => markets };
    if (url.includes('10000664')) return { ok: true, status: 200, text: async () => finance };
    // MarketWatch feeds: empty
    return { ok: true, status: 200, text: async () => rssFixture([]) };
  };

  const now = Date.parse('2026-06-18T15:00:00Z');
  const res = await feed.getMarketColorFeed({ marketDir: dir, fetchImpl, now });
  const urls = res.items.map(i => i.url);
  assert.strictEqual(urls.filter(u => u === 'https://www.cnbc.com/shared.html').length, 1, 'cross-posted URL deduped');
  assert.strictEqual(res.items[0].url, 'https://www.cnbc.com/new.html', 'sorted newest-first');
  assert.ok(res.items.every(i => i.id), 'every item has an id');
  assert.ok(res.updatedAt, 'updatedAt set');
  assert.ok(fs.existsSync(path.join(dir, 'market-color-feed.json')), 'cache written');

  // Within TTL → served from cache, no new fetches.
  const callsAfter = calls;
  const cached = await feed.getMarketColorFeed({ marketDir: dir, fetchImpl, now: now + 1000 });
  assert.strictEqual(calls, callsAfter, 'no refetch within TTL');
  assert.strictEqual(cached.items.length, res.items.length);
  console.log('  ✓ getMarketColorFeed: dedup + newest-first + TTL cache');
}

function testCachedPersonalFinanceFilter() {
  const cache = {
    fetchedAt: '2026-06-18T15:00:00.000Z',
    feeds: {
      'cnbc-markets': {
        fetchedAt: '2026-06-18T15:00:00.000Z',
        items: [
          { title: 'Fed officials debate rate cuts', url: 'https://www.cnbc.com/fed.html', summary: 'Treasury yields moved.', publishedAt: '2026-06-18T14:00:00.000Z', tags: ['rates'] },
          { title: 'Best savings accounts for your money', url: 'https://www.cnbc.com/personal-finance/savings.html', summary: 'Personal finance advice.', publishedAt: '2026-06-18T13:00:00.000Z', tags: ['market color'] },
        ],
      },
    },
  };
  const res = feed.buildResponse(cache);
  assert.deepStrictEqual(res.items.map(i => i.title), ['Fed officials debate rate cuts']);
  assert.deepStrictEqual(res.items[0].tags, ['rates']);
  console.log('  ✓ buildResponse: filters personal finance from cache');
}

// ---------- stale-on-failure ----------

async function testStaleOnFailure() {
  const dir = tmpDir();
  const good = rssFixture([{ title: 'Cached Treasury story', link: 'https://www.cnbc.com/c.html', desc: 'Yields fell after the Fed remarks.', pubDate: 'Wed, 18 Jun 2026 10:00:00 GMT' }]);
  const okFetch = makeFetch([['15839069', good]]);
  const now = Date.parse('2026-06-18T15:00:00Z');
  await feed.getMarketColorFeed({ marketDir: dir, fetchImpl: okFetch, now });

  // All feeds fail on the next refresh (past TTL) → serve cache stale.
  const failFetch = async () => { throw new Error('network down'); };
  const stale = await feed.getMarketColorFeed({ marketDir: dir, fetchImpl: failFetch, now: now + 60 * 60 * 1000 });
  assert.strictEqual(stale.stale, true, 'marked stale');
  assert.strictEqual(stale.items.length, 1, 'cached items still served');
  assert.strictEqual(stale.items[0].title, 'Cached Treasury story');
  console.log('  ✓ getMarketColorFeed: stale-on-failure serves cache');
}

// ---------- never throws with no cache ----------

async function testNoCacheNoThrow() {
  const dir = tmpDir();
  const failFetch = async () => { throw new Error('down'); };
  const res = await feed.getMarketColorFeed({ marketDir: dir, fetchImpl: failFetch, now: 0 });
  assert.deepStrictEqual(res.items, [], 'empty items, no throw');
  assert.strictEqual(res.stale, true);
  console.log('  ✓ getMarketColorFeed: cold failure returns empty, never throws');
}

(async function main() {
  testParse();
  testTagFallback();
  testSalesRelevanceFilter();
  testPersonalFinanceFilter();
  await testFetchDedupSortCache();
  testCachedPersonalFinanceFilter();
  await testStaleOnFailure();
  await testNoCacheNoThrow();
  console.log('market-color-feed tests passed');
})().catch(err => { console.error(err); process.exit(1); });
