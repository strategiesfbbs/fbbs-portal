// Tests for server/market-wire.js — official headlines + BLS indicators.
// Pure parse + cache behavior with an injected fetch; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const marketWire = require('../server/market-wire');

function rssFixture(items) {
  const body = items.map(it => `<item>
    <title>${it.cdata ? `<![CDATA[${it.title}]]>` : it.title}</title>
    <link>${it.cdata ? `<![CDATA[${it.link}]]>` : it.link}</link>
    <pubDate>${it.pubDate || ''}</pubDate>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8" ?>\n<rss version="2.0"><channel><title>Fixture</title>\n${body}\n</channel></rss>`;
}

const FED_XML = rssFixture([
  { title: 'Federal Reserve issues FOMC statement', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260610a.htm', pubDate: 'Wed, 10 Jun 2026 18:00:00 GMT', cdata: true },
  { title: 'Minutes of the May meeting', link: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260528a.htm', pubDate: 'Thu, 28 May 2026 18:00:00 GMT', cdata: true },
]);
const FDIC_XML = rssFixture([
  { title: 'FDIC &amp; agencies issue joint guidance', link: 'https://www.fdic.gov/news/press-releases/2026/pr26045.html', pubDate: 'Tue, 09 Jun 2026 14:00:00 GMT' },
]);
const SEC_XML = rssFixture([
  { title: 'SEC announces <b>enforcement</b> action', link: 'https://www.sec.gov/news/press-release/2026-101', pubDate: 'Mon, 08 Jun 2026 12:00:00 GMT' },
]);

function blsFixture() {
  const cpi = [];
  // Newest-first monthly CPI index data spanning two years: May 2026 back to Jan 2025.
  const months = [
    ['2026', 'M05', 'May', '335.123'], ['2026', 'M04', 'April', '333.020'],
    ['2026', 'M03', 'March', '330.213'], ['2026', 'M02', 'February', '326.785'],
    ['2026', 'M01', 'January', '325.252'], ['2025', 'M12', 'December', '324.100'],
    ['2025', 'M11', 'November', '323.500'], ['2025', 'M05', 'May', '325.000'],
  ];
  for (const [year, period, periodName, value] of months) {
    cpi.push({ year, period, periodName, value });
  }
  return {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        { seriesID: 'CUUR0000SA0', data: cpi },
        { seriesID: 'LNS14000000', data: [{ year: '2026', period: 'M05', periodName: 'May', value: '4.2' }] },
      ],
    },
  };
}

const UPCOMING_FIXTURE = [
  { cusip: '912797UG0', securityType: 'Bill', securityTerm: '13-Week', auctionDate: '2026-06-15T00:00:00', issueDate: '2026-06-18T00:00:00' },
  { cusip: '91282CMZ2', securityType: 'Note', securityTerm: '2-Year', auctionDate: '2026-06-23T00:00:00', issueDate: '2026-06-30T00:00:00' },
  { cusip: '', securityType: 'Bill', securityTerm: '', auctionDate: '', issueDate: '' }, // junk row
];

const RESULTS_FIXTURE = [
  { cusip: '912810UK5', securityType: 'Bond', securityTerm: '29-Year 11-Month', auctionDate: '2026-06-11T00:00:00', highYield: '5.0200', bidToCoverRatio: '2.330000' },
  { cusip: '912797NH7', securityType: 'Bill', securityTerm: '4-Week', auctionDate: '2026-06-11T00:00:00', highYield: '', highInvestmentRate: '3.674000', highDiscountRate: '3.595000', bidToCoverRatio: '3.130000' },
  { cusip: 'JUNK', securityType: 'Bill', securityTerm: '8-Week', auctionDate: '2026-06-10T00:00:00', highYield: '', highInvestmentRate: '', highDiscountRate: '', bidToCoverRatio: '' }, // no usable rate
];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'market-wire-test-'));
}

function fetchFor(map) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push(url);
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    if (!hit) throw new Error('unexpected url ' + url);
    const value = typeof hit[1] === 'function' ? hit[1]() : hit[1];
    if (value instanceof Error) throw value;
    return {
      ok: true,
      status: 200,
      text: async () => value,
      json: async () => (typeof value === 'string' ? JSON.parse(value) : value),
    };
  };
  impl.calls = calls;
  return impl;
}

let failures = 0;
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok: ${label}`))
    .catch(err => {
      failures += 1;
      console.error(`  FAIL: ${label}\n    ${err.message}`);
    });
}

async function main() {
  console.log('market-wire.test.js');

  await check('parseRssItems handles CDATA, entities, embedded tags, and bad links', () => {
    const items = marketWire.parseRssItems(FED_XML);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].title, 'Federal Reserve issues FOMC statement');
    assert.strictEqual(items[0].publishedAt, '2026-06-10T18:00:00.000Z');

    const fdic = marketWire.parseRssItems(FDIC_XML);
    assert.strictEqual(fdic[0].title, 'FDIC & agencies issue joint guidance');

    const sec = marketWire.parseRssItems(SEC_XML);
    assert.strictEqual(sec[0].title, 'SEC announces enforcement action');

    const junk = marketWire.parseRssItems(rssFixture([
      { title: 'No link item', link: 'not-a-url' },
      { title: '', link: 'https://example.gov/x' },
    ]));
    assert.strictEqual(junk.length, 0);
    assert.deepStrictEqual(marketWire.parseRssItems(null), []);
    assert.deepStrictEqual(marketWire.parseRssItems('<html>nope</html>'), []);
  });

  await check('parseBlsResponse computes CPI YoY against the same month last year', () => {
    const ind = marketWire.parseBlsResponse(blsFixture());
    // 335.123 / 325.000 - 1 = 3.1145% → 3.1
    assert.strictEqual(ind.cpiYoY.value, 3.1);
    assert.strictEqual(ind.cpiYoY.period, 'May 2026');
    assert.strictEqual(ind.unemployment.value, 4.2);
    assert.strictEqual(ind.unemployment.period, 'May 2026');
    assert.deepStrictEqual(marketWire.parseBlsResponse(null), {});
    assert.deepStrictEqual(marketWire.parseBlsResponse({ Results: { series: [] } }), {});
  });

  await check('getLatestHeadlines merges feeds newest-first and caches', async () => {
    const dir = tmpDir();
    const impl = fetchFor({ 'federalreserve.gov': FED_XML, 'fdic.gov': FDIC_XML, 'sec.gov': SEC_XML });
    const out = await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T12:00:00Z') });
    assert.strictEqual(out.stale, false);
    assert.strictEqual(out.headlines.length, 4);
    assert.strictEqual(out.headlines[0].source, 'Federal Reserve');
    assert.strictEqual(out.headlines[0].title, 'Federal Reserve issues FOMC statement');
    assert.strictEqual(out.sources.length, 3);

    // Within TTL: served from cache, no further fetches.
    const callsBefore = impl.calls.length;
    await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T12:10:00Z') });
    assert.strictEqual(impl.calls.length, callsBefore);
  });

  await check('a failing feed keeps its previously cached items', async () => {
    const dir = tmpDir();
    const good = fetchFor({ 'federalreserve.gov': FED_XML, 'fdic.gov': FDIC_XML, 'sec.gov': SEC_XML });
    await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: good, now: Date.parse('2026-06-11T08:00:00Z') });

    const flaky = fetchFor({
      'federalreserve.gov': FED_XML,
      'fdic.gov': () => new Error('connection refused'),
      'sec.gov': SEC_XML,
    });
    const out = await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: flaky, now: Date.parse('2026-06-11T10:00:00Z') });
    assert.strictEqual(out.stale, false);
    const fdicItems = out.headlines.filter(h => h.sourceKey === 'fdic');
    assert.strictEqual(fdicItems.length, 1, 'FDIC items survive its outage');
  });

  await check('all feeds failing serves the stale cache; no cache yields null', async () => {
    const dir = tmpDir();
    const good = fetchFor({ 'federalreserve.gov': FED_XML, 'fdic.gov': FDIC_XML, 'sec.gov': SEC_XML });
    await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: good, now: Date.parse('2026-06-11T08:00:00Z') });

    const dead = fetchFor({});
    const out = await marketWire.getLatestHeadlines({ marketDir: dir, fetchImpl: dead, now: Date.parse('2026-06-11T10:00:00Z') });
    assert.strictEqual(out.stale, true);
    assert.strictEqual(out.headlines.length, 4);

    const emptyDir = tmpDir();
    const none = await marketWire.getLatestHeadlines({ marketDir: emptyDir, fetchImpl: dead, now: Date.parse('2026-06-11T10:00:00Z') });
    assert.strictEqual(none, null);
  });

  await check('getEconomicIndicators caches on a long TTL and serves stale on failure', async () => {
    const dir = tmpDir();
    const impl = fetchFor({ 'api.bls.gov': JSON.stringify(blsFixture()) });
    const out = await marketWire.getEconomicIndicators({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T08:00:00Z') });
    assert.strictEqual(out.cpiYoY.value, 3.1);
    assert.strictEqual(out.stale, false);

    // 6 hours later: still cached (12h TTL).
    const callsBefore = impl.calls.length;
    await marketWire.getEconomicIndicators({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T14:00:00Z') });
    assert.strictEqual(impl.calls.length, callsBefore);

    // Past TTL with a dead API: stale cache.
    const dead = fetchFor({});
    const staleOut = await marketWire.getEconomicIndicators({ marketDir: dir, fetchImpl: dead, now: Date.parse('2026-06-12T08:00:01Z') });
    assert.strictEqual(staleOut.stale, true);
    assert.strictEqual(staleOut.unemployment.value, 4.2);

    const emptyDir = tmpDir();
    const none = await marketWire.getEconomicIndicators({ marketDir: emptyDir, fetchImpl: dead, now: Date.parse('2026-06-12T08:00:01Z') });
    assert.strictEqual(none, null);
  });

  await check('parseAuctions shapes upcoming + results and prefers bond-equivalent stops', () => {
    const out = marketWire.parseAuctions(UPCOMING_FIXTURE, RESULTS_FIXTURE);
    assert.strictEqual(out.upcoming.length, 2);
    assert.strictEqual(out.upcoming[0].auctionDate, '2026-06-15');
    assert.strictEqual(out.upcoming[0].term, '13-Week');
    assert.strictEqual(out.results.length, 2);
    assert.strictEqual(out.results[0].stopYield, 5.02);
    assert.strictEqual(out.results[0].bidToCover, 2.33);
    // Bill: highYield blank → falls back to the bond-equivalent investment rate.
    assert.strictEqual(out.results[1].stopYield, 3.674);
    assert.deepStrictEqual(marketWire.parseAuctions(null, null), { upcoming: [], results: [] });
  });

  await check('getTreasuryAuctions caches and serves stale on failure', async () => {
    const dir = tmpDir();
    const impl = fetchFor({
      'securities/upcoming': JSON.stringify(UPCOMING_FIXTURE),
      'securities/auctioned': JSON.stringify(RESULTS_FIXTURE),
    });
    const out = await marketWire.getTreasuryAuctions({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T12:00:00Z') });
    assert.strictEqual(out.stale, false);
    assert.strictEqual(out.results[0].stopYield, 5.02);

    const callsBefore = impl.calls.length;
    await marketWire.getTreasuryAuctions({ marketDir: dir, fetchImpl: impl, now: Date.parse('2026-06-11T12:30:00Z') });
    assert.strictEqual(impl.calls.length, callsBefore, 'served from cache within TTL');

    const dead = fetchFor({});
    const staleOut = await marketWire.getTreasuryAuctions({ marketDir: dir, fetchImpl: dead, now: Date.parse('2026-06-11T14:00:01Z') });
    assert.strictEqual(staleOut.stale, true);
    assert.strictEqual(staleOut.upcoming.length, 2);

    const none = await marketWire.getTreasuryAuctions({ marketDir: tmpDir(), fetchImpl: dead, now: Date.parse('2026-06-11T14:00:01Z') });
    assert.strictEqual(none, null);
  });

  if (failures) {
    console.error(`market-wire.test.js: ${failures} failed`);
    process.exit(1);
  }
  console.log('market-wire.test.js: all passed');
}

main().catch(err => {
  console.error('market-wire.test.js crashed:', err);
  process.exit(1);
});
