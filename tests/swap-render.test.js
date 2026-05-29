'use strict';

// Regression tests for server/swap-render.js — the printable swap-proposal
// renderer. This is a client-facing deliverable (Save-as-PDF for the bank),
// so the tests cover: draft live-render vs sent snapshot-render, HTML
// escaping of untrusted fields (the output is served as text/html), the
// not-found and empty-legs fallbacks, and a couple of money formats.
//
// Pure: renderProposalHtml(record, opts) takes a plain { proposal, legs,
// snapshot } record and returns an HTML string — no DB needed.

const assert = require('assert');
const { renderProposalHtml } = require('../server/swap-render');
const swapMath = require('../server/swap-math');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function draftRecord(legs, proposalOverrides = {}) {
  return {
    proposal: Object.assign({
      id: 'SP-2026-0001',
      title: 'Bond Swap — Test Bank',
      status: 'draft',
      proposalDate: '2026-05-29',
      settleDate: '2026-05-30',
      taxRate: 21,
      isSubchapterS: false,
      preparedFor: 'Test Bank',
      preparedBy: 'FBBS Rep',
      notes: 'Some notes'
    }, proposalOverrides),
    legs: legs || [],
    snapshot: null
  };
}

const SELL = { side: 'sell', cusip: 'SELL00001', description: 'US TREASURY', par: 1_000_000, coupon: 2, maturity: '2030-01-01', bookPrice: 100, marketPrice: 98, bookYieldYtm: 2, marketYieldYtw: 5, averageLife: 3 };
const BUY = { side: 'buy', cusip: 'BUY000001', description: 'AGENCY NOTE', par: 1_000_000, coupon: 5, maturity: '2031-01-01', marketPrice: 98, marketYieldYtw: 5, averageLife: 3 };

test('renders a draft live with the DRAFT watermark and live source', () => {
  const html = renderProposalHtml(draftRecord([SELL, BUY]));
  assert.ok(html.includes('SP-2026-0001'), 'proposal id');
  assert.ok(html.includes('Bond Swap — Test Bank'), 'title');
  assert.ok(html.includes('class="watermark"') && html.includes('DRAFT'), 'draft watermark');
  assert.ok(html.includes('Draft · live values'), 'draft badge');
  assert.ok(html.includes('source: live'), 'live source label');
  assert.ok(html.includes('SELL00001') && html.includes('BUY000001'), 'both legs present');
});

test('returns a not-found fallback for a missing record', () => {
  assert.ok(renderProposalHtml(null).includes('Proposal not found'));
  assert.ok(renderProposalHtml({}).includes('Proposal not found'));
});

test('renders empty-leg fallbacks without throwing', () => {
  const html = renderProposalHtml(draftRecord([]));
  assert.ok(html.includes('No legs entered.'), 'empty leg table');
  assert.ok(html.includes('summary-block'), 'summary section still rendered');
  assert.ok(/Sells \/ Buys<\/dt><dd>0 \/ 0/.test(html), 'zero counts');
});

test('escapes untrusted fields so render output is XSS-safe', () => {
  const evilTitle = 'Evil <script>alert(1)</script> & "co"';
  const evilLeg = Object.assign({}, SELL, { description: '<img src=x onerror=alert(1)>' });
  const html = renderProposalHtml(draftRecord([evilLeg], { title: evilTitle, notes: '<b>boom</b>' }));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'script tag is escaped');
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'raw img tag must not survive');
  assert.ok(html.includes('&lt;img src=x'), 'leg description is escaped');
  assert.ok(!html.includes('<b>boom</b>'), 'notes are escaped');
});

test('a sent proposal renders from the snapshot, not the live legs', () => {
  // Live legs carry LIVEONLY cusips; the frozen snapshot carries SNAPONLY.
  // The sent render must show the snapshot and ignore the (drifted) legs.
  const liveSell = Object.assign({}, SELL, { cusip: 'LIVEONLYSELL' });
  const liveBuy = Object.assign({}, BUY, { cusip: 'LIVEONLYBUY' });
  const snapSell = Object.assign({}, SELL, { cusip: 'SNAPONLYSELL' });
  const snapBuy = Object.assign({}, BUY, { cusip: 'SNAPONLYBUY' });
  const summary = swapMath.swapSummary({ sells: [snapSell], buys: [snapBuy], horizonYears: 3, taxRate: 21 });
  const record = {
    proposal: Object.assign(draftRecord().proposal, { status: 'sent' }),
    legs: [liveSell, liveBuy],
    snapshot: { frozenAt: '2026-05-20T12:00:00.000Z', data: { sells: [snapSell], buys: [snapBuy], summary } }
  };
  const html = renderProposalHtml(record);
  assert.ok(html.includes('SNAPONLYSELL') && html.includes('SNAPONLYBUY'), 'snapshot legs present');
  assert.ok(!html.includes('LIVEONLYSELL') && !html.includes('LIVEONLYBUY'), 'live legs must NOT appear');
  assert.ok(html.includes('source: snapshot'), 'snapshot source label');
  assert.ok(html.includes('badge frozen'), 'frozen badge (not draft)');
  assert.ok(!html.includes('class="watermark"'), 'no DRAFT watermark on a sent proposal');
});

test('formats money (thousands separators, parenthesized losses)', () => {
  // par 1,000,000 @ book 100 / market 98 → market value 980,000, G/L (20,000).
  const html = renderProposalHtml(draftRecord([SELL]));
  assert.ok(html.includes('1,000,000'), 'par formatted with separators');
  assert.ok(html.includes('980,000'), 'market value computed + formatted');
  assert.ok(html.includes('(20,000)'), 'a loss is parenthesized');
});

console.log(`swap-render tests: ${passed} passed.`);
