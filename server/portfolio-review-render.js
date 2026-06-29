'use strict';

/**
 * FBBS Portal — Portfolio Review printable view
 *
 * Renders the /api/portfolio-review payload as a standalone, branded HTML
 * artifact suitable for `Save as PDF` from any modern browser. Layout mirrors
 * the swap proposal print view (server/swap-render.js): FBBS header, a summary
 * meta grid, a sector-mix table, and the institutional footer. Admin payloads
 * may include a holdings table; rep-facing payloads are intentionally summary
 * only.
 *
 * Pure render — takes the same object buildPortfolioReview() already returns,
 * so there is no extra data assembly. No I/O.
 */

const HOLDING_COLUMNS = [
  { key: 'sector',            label: 'Sector',      align: 'left',  fmt: 'text' },
  { key: 'cusip',             label: 'CUSIP',       align: 'left',  fmt: 'text' },
  { key: 'description',       label: 'Description', align: 'left',  fmt: 'text' },
  { key: 'coupon',            label: 'Cpn',         align: 'right', fmt: 'pct3' },
  { key: 'maturity',          label: 'Maturity',    align: 'right', fmt: 'text' },
  { key: 'nextCall',          label: 'Call',        align: 'right', fmt: 'text' },
  { key: 'par',               label: 'Par',         align: 'right', fmt: 'money0' },
  { key: 'bookValue',         label: 'Book Val',    align: 'right', fmt: 'money0' },
  { key: 'marketValue',       label: 'Mkt Val',     align: 'right', fmt: 'money0' },
  { key: 'gainLoss',          label: 'G/L',         align: 'right', fmt: 'money0' },
  { key: 'gainLossPct',       label: 'G/L %',       align: 'right', fmt: 'pct2' },
  { key: 'bookYield',         label: 'Bk Yld',      align: 'right', fmt: 'pct3' },
  { key: 'marketYield',       label: 'Mkt Yld',     align: 'right', fmt: 'pct3' },
  { key: 'yieldGap',          label: 'Yld Gap',     align: 'right', fmt: 'pct2' },
  { key: 'averageLife',       label: 'WAL',         align: 'right', fmt: 'num2' },
  { key: 'effectiveDuration', label: 'Dur',         align: 'right', fmt: 'num2' },
  { key: 'callable',          label: 'Call?',       align: 'right', fmt: 'bool' }
];

// ---------- Formatting ----------

const { escapeHtml, isBlank } = require('./html-escape');

function money0(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n < 0 ? `(${abs})` : abs;
}

function pct3(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(3)}%`;
}

function pct2(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(2)}%`;
}

function num2(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(2);
}

function fmtCell(col, value) {
  switch (col.fmt) {
    case 'money0': return money0(value);
    case 'pct3': return pct3(value);
    case 'pct2': return pct2(value);
    case 'num2': return num2(value);
    case 'bool': return value ? 'Yes' : '';
    default: return isBlank(value) ? '' : escapeHtml(value);
  }
}

function longDate(value) {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(d.getTime())) return escapeHtml(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ---------- Sections ----------

function metaItem(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function renderSummaryGrid(review) {
  const s = review.summary || {};
  const taxLabel = review.isSubchapterS ? 'Sub-S' : 'C-corp';
  return `
  <dl class="meta">
    ${metaItem('Positions', s.positions != null ? s.positions : '—')}
    ${metaItem('Par', money0(s.par))}
    ${metaItem('Book value', money0(s.bookValue))}
    ${metaItem('Market value', money0(s.marketValue))}
    ${metaItem('Unrealized G/L', money0(s.gainLoss))}
    ${metaItem('Unrealized G/L %', pct2(s.gainLossPct))}
    ${metaItem('Book yield', pct3(s.bookYield))}
    ${metaItem('Market yield', pct3(s.marketYield))}
    ${metaItem('Weighted coupon', pct3(s.weightedCoupon))}
    ${metaItem('Weighted avg life', num2(s.weightedAverageLife))}
    ${metaItem('Effective duration', num2(s.effectiveDuration))}
    ${metaItem('Yield on securities', pct3(s.yieldOnSecurities))}
    ${metaItem('Net interest margin', pct3(s.netInterestMargin))}
    ${metaItem('Cost of funds', pct3(s.costOfFunds))}
    ${metaItem('Tax treatment', `${taxLabel} (${pct3(review.taxRate)})`)}
    ${metaItem('Source file', escapeHtml(review.sourceFile || '—'))}
  </dl>`;
}

function renderHoldingsTable(holdings) {
  const head = HOLDING_COLUMNS.map(c =>
    `<th class="${c.align === 'right' ? 'r' : ''}">${escapeHtml(c.label)}</th>`).join('');
  if (!holdings || !holdings.length) {
    return `<section class="block"><h3>Holdings</h3><p class="empty">No parsed holdings.</p></section>`;
  }
  const body = holdings.map(h => '<tr>' + HOLDING_COLUMNS.map(c =>
    `<td class="${c.align === 'right' ? 'r' : ''}">${fmtCell(c, h[c.key])}</td>`).join('') + '</tr>').join('');
  return `
  <section class="block">
    <h3>Holdings (${holdings.length})</h3>
    <table class="grid">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function renderSummaryOnlyNotice(review) {
  if (!review || !review.summaryOnly) return '';
  return `
  <section class="block">
    <h3>THC summary guardrail</h3>
    <p class="empty">${escapeHtml(review.summaryOnlyReason || 'Raw portfolio holdings are admin-only. This report shows aggregate THC-derived summary fields only.')}</p>
  </section>`;
}

function renderSectorTable(sectors) {
  if (!sectors || !sectors.length) return '';
  const body = sectors.map(se => `<tr>
    <td>${escapeHtml(se.sector || se.label || '—')}</td>
    <td class="r">${se.count != null ? se.count : '—'}</td>
    <td class="r">${money0(se.par)}</td>
    <td class="r">${money0(se.marketValue)}</td>
    <td class="r">${pct2(se.pctOfMarket != null ? se.pctOfMarket : se.weight)}</td>
  </tr>`).join('');
  return `
  <section class="block">
    <h3>Sector mix</h3>
    <table class="grid">
      <thead><tr><th>Sector</th><th class="r">Count</th><th class="r">Par</th><th class="r">Mkt Val</th><th class="r">% Mkt</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function renderCashFlowWall(wall) {
  const rows = wall && Array.isArray(wall.rows) ? wall.rows : [];
  if (!rows.length) return '';
  const body = rows.map(row => `<tr>
    <td>${escapeHtml(row.bucket || '')}</td>
    <td class="r">${money0(row.maturityPar)}</td>
    <td class="r">${row.maturityCount != null ? row.maturityCount : '—'}</td>
    <td class="r">${money0(row.callPar)}</td>
    <td class="r">${row.callCount != null ? row.callCount : '—'}</td>
    <td class="r">${money0(row.totalPar)}</td>
  </tr>`).join('');
  return `
  <section class="block">
    <h3>Maturity &amp; call wall</h3>
    <table class="grid">
      <thead><tr><th>Bucket</th><th class="r">Maturity Par</th><th class="r">Mat Cnt</th><th class="r">Call Par</th><th class="r">Call Cnt</th><th class="r">Total Par</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="empty">${escapeHtml(wall.basis || 'Maturities are certain runoff; calls are potential runoff.')}</p>
  </section>`;
}

function renderRateShockProxy(proxy) {
  if (!proxy || proxy.available === false || !Array.isArray(proxy.shocks) || !proxy.shocks.length) return '';
  const shockLabel = value => Number(value) === 0 ? 'Base' : `${Number(value) > 0 ? '+' : ''}${value} bp`;
  const body = proxy.shocks.map(row => `<tr>
    <td>${escapeHtml(shockLabel(row.shockBp))}</td>
    <td class="r">${money0(row.estimatedMarketValue)}</td>
    <td class="r">${money0(row.estimatedChange)}</td>
    <td class="r">${pct2(row.priceChangePct)}</td>
  </tr>`).join('');
  return `
  <section class="block">
    <h3>Standard rate-shock proxy</h3>
    <table class="grid">
      <thead><tr><th>Shock</th><th class="r">Est. Mkt Val</th><th class="r">Change</th><th class="r">Price Chg</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="empty">${escapeHtml(proxy.basis || '')}</p>
  </section>`;
}

// ---------- Public entry point ----------

function renderPortfolioReviewHtml(review, opts = {}) {
  if (!review || review.available === false) {
    const name = review && review.bankName ? review.bankName : 'Bank';
    return `<!doctype html><meta charset="utf-8"><title>Portfolio review unavailable</title>` +
      `<p>No parsed bond-accounting portfolio is available for ${escapeHtml(name)}.</p>`;
  }
  const bankName = opts.bankName || review.bankName || 'Bank';
  const location = [review.city, review.state].filter(Boolean).join(', ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Portfolio Review · ${escapeHtml(bankName)}</title>
<style>
:root { --ink: #0f1f17; --rule: #c8d6cd; --muted: #4a5b53; --bg-soft: #f4f8f6; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: var(--ink);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
.page { max-width: 1200px; margin: 0 auto; padding: 28px 36px 36px; }
@media print { .page { max-width: none; } }
header.brand { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--ink); padding-bottom: 10px; }
header.brand .firm { font-weight: 800; letter-spacing: 0.04em; font-size: 12px; text-transform: uppercase; color: var(--ink); }
header.brand .firm strong { display: block; font-size: 18px; letter-spacing: 0; text-transform: none; margin-top: 2px; }
header.brand .doc-info { text-align: right; font-size: 11px; color: var(--muted); }
header.brand .doc-info strong { display: block; font-size: 20px; color: var(--ink); letter-spacing: 0.02em; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 18px; font-size: 12px; }
.meta div { background: var(--bg-soft); padding: 8px 10px; border-radius: 6px; }
.meta dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 800; margin: 0 0 2px; }
.meta dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.block { margin-top: 16px; }
.block h3 { font-size: 13px; margin: 0 0 6px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
table.grid { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
table.grid th, table.grid td { padding: 4px 5px; border-bottom: 1px solid var(--rule); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.grid td:nth-child(3) { white-space: normal; }
table.grid th { background: var(--bg-soft); font-weight: 800; font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; text-align: left; }
table.grid .r { text-align: right; font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); font-style: italic; }
footer.foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--rule); font-size: 10px; color: var(--muted); }
footer.foot .badges { font-weight: 800; letter-spacing: 0.08em; }
footer.foot .disclosure { margin-top: 6px; }
.print-controls { background: var(--bg-soft); padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--rule); font-size: 12px; }
.print-controls button { background: var(--ink); color: #fff; border: 0; border-radius: 999px; padding: 6px 16px; font-weight: 800; cursor: pointer; }
@media print {
  .print-controls { display: none; }
  .page { padding: 0.3in; }
  table.grid { font-size: 9px; }
  .block { page-break-inside: auto; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { size: letter landscape; margin: 0.4in; }
</style>
</head>
<body>
<div class="print-controls">
  <span>Portfolio Review · ${escapeHtml(bankName)}${location ? ' · ' + escapeHtml(location) : ''} · internal strategy screen</span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="page">
  <header class="brand">
    <div class="firm">First Bankers' Banc Securities, Inc.<strong>Portfolio Review</strong></div>
    <div class="doc-info"><strong>${escapeHtml(bankName)}</strong>${location ? escapeHtml(location) + ' · ' : ''}${review.certNumber ? 'Cert ' + escapeHtml(review.certNumber) : ''}<br>Portfolio as of ${escapeHtml(longDate(review.reportDate)) || '—'}</div>
  </header>

  ${renderSummaryGrid(review)}
  ${renderSummaryOnlyNotice(review)}
  ${review.summaryOnly ? '' : renderHoldingsTable(review.holdings)}
  ${renderSectorTable(review.sectors)}
  ${renderCashFlowWall(review.cashFlowWall)}
  ${renderRateShockProxy(review.rateShockProxy)}

  <footer class="foot">
    <div class="badges">FINRA · MEMBER SIPC · MSRB</div>
    <div class="disclosure">Internal strategy screen only; desk review controls the final recommendation and client language. For Institutional Use Only. Investments are not FDIC insured, not bank guaranteed &amp; may lose value. First Bankers' Banc Securities, Inc. is a member of FINRA / SIPC. Copyright &copy; ${new Date().getUTCFullYear()} FBBS, Inc.</div>
  </footer>
</div>
</body>
</html>`;
}

module.exports = { renderPortfolioReviewHtml };
