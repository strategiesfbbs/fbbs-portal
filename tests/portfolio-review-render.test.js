'use strict';

// Characterization tests for server/portfolio-review-render.js — the printable
// Portfolio Review renderer. This is a client-facing deliverable (Save-as-PDF
// for the bank), so the tests lock in: the unavailable/null short-circuit,
// the cell formatters (money0 negatives parenthesized, '—' for blank, 'n/a'
// for non-finite; pct3/pct2/num2 digit counts; bool 'Yes'/''), the
// empty-holdings and empty-sectors fallbacks, the Sub-S vs C-corp tax label,
// the opts.bankName title override, and HTML-escaping of untrusted
// bank/sector/source strings (the output is served as text/html).
//
// Pure: renderPortfolioReviewHtml(review, opts) takes a plain JS object and
// returns an HTML string — no DB, no fs, no network.

const assert = require('assert');
const { renderPortfolioReviewHtml } = require('../server/portfolio-review-render');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

// A representative full review object. Numbers chosen so the formatters'
// behavior is observable (negative G/L, blank, NaN, 3 vs 2 decimal places).
function fullReview(overrides = {}) {
  return Object.assign({
    available: true,
    bankName: 'First Test Bank',
    city: 'Quincy',
    state: 'IL',
    certNumber: '12345',
    reportDate: '2026-03-31',
    sourceFile: 'portfolio-Q1.xlsx',
    isSubchapterS: false,
    taxRate: 21,
    summary: {
      positions: 3,
      par: 3_000_000,
      bookValue: 2_950_000,
      marketValue: 2_900_000,
      gainLoss: -50_000,
      gainLossPct: -1.6949,
      bookYield: 3.25,
      marketYield: 3.5,
      weightedCoupon: 3.125,
      weightedAverageLife: 4.2,
      effectiveDuration: 3.8,
      yieldOnSecurities: 3.4,
      netInterestMargin: 2.95,
      costOfFunds: 1.5
    },
    holdings: [
      {
        sector: 'Municipal', cusip: 'AAA111111', description: 'CITY OF QUINCY GO',
        coupon: 3.5, maturity: '2030-06-01', nextCall: '2028-06-01',
        par: 1_000_000, bookValue: 1_010_000, marketValue: 990_000,
        gainLoss: -20_000, gainLossPct: -1.98, bookYield: 3.25, marketYield: 3.6,
        yieldGap: 0.35, averageLife: 4.1, effectiveDuration: 3.7, callable: true
      },
      {
        sector: 'Agency', cusip: 'BBB222222', description: 'FHLB NOTE',
        coupon: 4.0, maturity: '2031-01-15', nextCall: '',
        par: 2_000_000, bookValue: 1_940_000, marketValue: 1_910_000,
        gainLoss: -30_000, gainLossPct: -1.546, bookYield: 4.0, marketYield: 4.25,
        yieldGap: 0.25, averageLife: 4.3, effectiveDuration: 3.9, callable: false
      }
    ],
    sectors: [
      { sector: 'Municipal', count: 1, par: 1_000_000, marketValue: 990_000, pctOfMarket: 34.14 },
      { sector: 'Agency', count: 1, par: 2_000_000, marketValue: 1_910_000, pctOfMarket: 65.86 }
    ]
  }, overrides);
}

// ---------- unavailable / null short-circuit ----------

test('null review returns the minimal unavailable doc with default bank name', () => {
  const html = renderPortfolioReviewHtml(null);
  assert.ok(html.includes('Portfolio review unavailable'), 'unavailable title');
  assert.ok(html.includes('No parsed bond-accounting portfolio is available'), 'unavailable copy');
  assert.ok(html.includes('for Bank.'), 'falls back to "Bank"');
  assert.ok(!html.includes('<!doctype html>\n<html'), 'is the minimal doc, not the full page');
});

test('review.available === false returns the unavailable doc with the escaped bank name', () => {
  const html = renderPortfolioReviewHtml({ available: false, bankName: 'Acme <Evil> Bank & Co' });
  assert.ok(html.includes('Portfolio review unavailable'), 'unavailable title');
  assert.ok(html.includes('Acme &lt;Evil&gt; Bank &amp; Co'), 'bank name is escaped');
  assert.ok(!html.includes('Acme <Evil> Bank'), 'raw bank name must not survive');
});

// ---------- full render main path ----------

test('a full review renders a complete <!doctype html> page with summary metrics', () => {
  const html = renderPortfolioReviewHtml(fullReview());
  assert.ok(html.startsWith('<!doctype html>'), 'doctype present');
  assert.ok(html.includes('<title>Portfolio Review · First Test Bank</title>'), 'titled');
  assert.ok(html.includes("First Bankers' Banc Securities, Inc."), 'firm brand');
  assert.ok(html.includes('Quincy, IL'), 'location composed from city + state');
  assert.ok(html.includes('Cert 12345'), 'cert number');
  // Summary metric formatting:
  assert.ok(html.includes('3,000,000'), 'par with separators');
  assert.ok(html.includes('(50,000)'), 'negative summary G/L parenthesized');
  assert.ok(html.includes('-1.69%'), 'gainLossPct via pct2 (2dp, rounded)');
  assert.ok(html.includes('3.250%'), 'bookYield via pct3 (3dp)');
  assert.ok(html.includes('4.20'), 'weighted avg life via num2 (2dp)');
});

test('reportDate is rendered via longDate as a UTC long date', () => {
  const html = renderPortfolioReviewHtml(fullReview());
  assert.ok(html.includes('Portfolio as of March 31, 2026'), 'YYYY-MM-DD → long UTC date');
});

// ---------- money0 formatting edges ----------

test('money0: negative → parenthesized, blank → em-dash, NaN → n/a', () => {
  const review = fullReview({
    summary: {
      positions: 1,
      par: -1234,            // negative → "(1,234)"
      bookValue: '',         // blank → "—"
      marketValue: NaN,      // non-finite → "n/a"
      gainLoss: 0,
      gainLossPct: 0,
      bookYield: 0
    },
    holdings: [],
    sectors: []
  });
  const html = renderPortfolioReviewHtml(review);
  assert.ok(html.includes('(1,234)'), 'negative number is parenthesized with separators');
  assert.ok(html.includes('<dd>—</dd>'), 'blank renders the em-dash');
  assert.ok(html.includes('<dd>n/a</dd>'), 'non-finite renders n/a');
});

// ---------- bool / fmtCell ----------

test('fmtCell bool renders Yes for truthy and empty string for falsy', () => {
  const html = renderPortfolioReviewHtml(fullReview());
  // First holding is callable:true → "Yes"; second is callable:false → "".
  assert.ok(html.includes('>Yes</td>'), 'callable true → Yes cell');
  // The Call? column for a non-callable holding is an empty cell.
  assert.ok(html.includes('class="r"></td>'), 'callable false → empty cell');
});

// ---------- tax label switch ----------

test('tax label says C-corp when isSubchapterS is false, with pct3(taxRate)', () => {
  const html = renderPortfolioReviewHtml(fullReview({ isSubchapterS: false, taxRate: 21 }));
  assert.ok(html.includes('C-corp (21.000%)'), 'C-corp label + pct3 rate');
  assert.ok(!html.includes('Sub-S ('), 'no Sub-S label');
});

test('tax label says Sub-S when isSubchapterS is true, with pct3(taxRate)', () => {
  const html = renderPortfolioReviewHtml(fullReview({ isSubchapterS: true, taxRate: 29.6 }));
  assert.ok(html.includes('Sub-S (29.600%)'), 'Sub-S label + pct3 rate');
  assert.ok(!html.includes('C-corp ('), 'no C-corp label');
});

// ---------- empty holdings / sectors fallbacks ----------

test('empty holdings array yields the "No parsed holdings." block', () => {
  const html = renderPortfolioReviewHtml(fullReview({ holdings: [] }));
  assert.ok(html.includes('No parsed holdings.'), 'holdings fallback present');
  assert.ok(!html.includes('<h3>Holdings ('), 'no counted holdings heading');
});

test('a non-empty holdings list renders a counted Holdings heading', () => {
  const html = renderPortfolioReviewHtml(fullReview());
  assert.ok(html.includes('<h3>Holdings (2)</h3>'), 'holdings count in heading');
  assert.ok(!html.includes('No parsed holdings.'), 'no empty fallback');
});

test('absent sectors yields no sector section', () => {
  const html = renderPortfolioReviewHtml(fullReview({ sectors: undefined }));
  assert.ok(!html.includes('Sector mix'), 'no sector section for absent sectors');
});

test('empty sectors array yields no sector section', () => {
  const html = renderPortfolioReviewHtml(fullReview({ sectors: [] }));
  assert.ok(!html.includes('Sector mix'), 'no sector section for empty sectors');
});

test('a non-empty sectors list renders the Sector mix section', () => {
  const html = renderPortfolioReviewHtml(fullReview());
  assert.ok(html.includes('Sector mix'), 'sector section present');
  assert.ok(html.includes('Municipal'), 'sector name rendered');
  assert.ok(html.includes('34.14%'), 'pctOfMarket via pct2');
});

// ---------- HTML escaping of untrusted strings ----------

test('untrusted bank name is HTML-escaped in the title and header', () => {
  const inj = 'Evil <script>alert(1)</script> & "co" \'x\'';
  const html = renderPortfolioReviewHtml(fullReview({ bankName: inj }));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not survive');
  assert.ok(html.includes('Evil &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot; &#39;x&#39;'),
    'bank name fully escaped');
});

test('untrusted sector and sourceFile strings are HTML-escaped', () => {
  const evilSector = '<img src=x onerror=alert(1)>';
  const evilSource = 'bad<svg/onload=alert(2)>.xlsx';
  const html = renderPortfolioReviewHtml(fullReview({
    sourceFile: evilSource,
    sectors: [{ sector: evilSector, count: 1, par: 100, marketValue: 100, pctOfMarket: 50 }]
  }));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'raw sector img must not survive');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'sector is escaped');
  assert.ok(!html.includes('<svg/onload=alert(2)>'), 'raw source svg must not survive');
  assert.ok(html.includes('bad&lt;svg/onload=alert(2)&gt;.xlsx'), 'sourceFile is escaped');
});

// ---------- opts.bankName override ----------

test('opts.bankName overrides review.bankName in the title', () => {
  const html = renderPortfolioReviewHtml(fullReview({ bankName: 'Original Bank' }), { bankName: 'Override Bank' });
  assert.ok(html.includes('<title>Portfolio Review · Override Bank</title>'), 'title uses opts.bankName');
  assert.ok(!html.includes('Original Bank'), 'review.bankName not used when overridden');
});

console.log(`portfolio-review-render tests: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
