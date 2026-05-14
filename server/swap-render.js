'use strict';

/**
 * FBBS Portal — Bond swap proposal printable view
 *
 * Renders a saved swap proposal as a standalone HTML artifact suitable for
 * `Save as PDF` from any modern browser. Layout mirrors the FBBS Master
 * Swap Template v4.6 print area:
 *
 *   - Header: FBBS branding, proposal ID + date
 *   - Summary block: $ and % tables (Sells / Buys / Net), breakeven
 *   - Portfolio diff: weighted-avg metrics before vs after
 *   - Funding source (sells) table
 *   - Investments (buys) table
 *   - Footer: institutional disclosure + six FBBS offices
 *
 * Renders from snapshot JSON when `status === 'sent'` (the proposal is
 * frozen and the numbers must never silently change). Renders live from
 * legs while `status === 'draft'` and stamps a DRAFT watermark on it.
 */

const swapMath = require('./swap-math');

const OFFICES = [
  'St. Louis, MO',
  'Overland Park, KS',
  'Oklahoma City, OK',
  'Denver, CO',
  'Nashville, TN',
  'Memphis, TN'
];

// Sells/Buys table columns. Widths sum to 100%. Sector and Mod Duration are
// dropped from the per-row view: sector is implicit in the Sells / Buys
// groupings, and Mod Duration lives in the Portfolio Change block where it
// belongs at the aggregate level.
const SELL_BUY_COLUMNS = [
  { key: 'cusip',            label: 'CUSIP',          align: 'left',  width: '8%' },
  { key: 'description',      label: 'Description',    align: 'left',  width: '20%' },
  { key: 'coupon',           label: 'Cpn',            align: 'right', width: '4%',  fmt: 'pct3' },
  { key: 'maturity',         label: 'Maturity',       align: 'right', width: '6%' },
  { key: 'callDate',         label: 'Call',           align: 'right', width: '6%' },
  { key: 'par',              label: 'Par',            align: 'right', width: '7%',  fmt: 'money0' },
  { key: 'teBookYield',      label: 'TE Bk Yld',      align: 'right', width: '6%',  fmt: 'pct3' },
  { key: 'teMarketYield',    label: 'TE Mkt Yld',     align: 'right', width: '6%',  fmt: 'pct3' },
  { key: 'bookPrice',        label: 'Bk Px',          align: 'right', width: '5%',  fmt: 'price' },
  { key: 'marketPrice',      label: 'Mkt Px',         align: 'right', width: '5%',  fmt: 'price' },
  { key: 'averageLife',      label: 'WAL',            align: 'right', width: '4%',  fmt: 'num2' },
  { key: 'bookValue',        label: 'Book Val',       align: 'right', width: '6%',  fmt: 'money0' },
  { key: 'marketValue',      label: 'Mkt Val',        align: 'right', width: '6%',  fmt: 'money0' },
  { key: 'gainLoss',         label: 'G/L',            align: 'right', width: '5%',  fmt: 'money0' },
  { key: 'accrued',          label: 'Accrued',        align: 'right', width: '5%',  fmt: 'money0' },
  { key: 'proceeds',         label: 'Proceeds',       align: 'right', width: '6%',  fmt: 'money0' }
];

// ---------- Formatting ----------

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isBlank(value) {
  return value == null || value === '' || (typeof value === 'string' && !value.trim());
}

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

function price(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(3);
}

function num2(value) {
  if (isBlank(value)) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return n.toFixed(2);
}

const FORMATTERS = { money0, pct3, price, num2 };

function fmtCell(value, fmt) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    if (isBlank(value.value)) return value.hasInput ? 'n/a' : '—';
    value = value.value;
  }
  if (!fmt) return escapeHtml(value || '');
  const f = FORMATTERS[fmt];
  return f ? f(value) : escapeHtml(value || '');
}

function computedCell(value, inputs) {
  return {
    value,
    hasInput: (inputs || []).some(v => !isBlank(v))
  };
}

function shortDate(value) {
  if (!value) return '';
  const s = String(value);
  // accept YYYY-MM-DD or full ISO
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
  return s;
}

function longDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ---------- Data derivation ----------

function deriveLegRow(leg, taxRate) {
  const parRaw = leg.par;
  const par = Number(parRaw) || 0;
  const bookPrice = leg.bookPrice;
  const marketPrice = leg.marketPrice;
  const bookValue = leg.bookValue
    || swapMath.legBookValue({ par, bookPrice, bookValue: leg.bookValue });
  const marketValue = leg.marketValue
    || swapMath.legMarketValue({ par, marketPrice, marketValue: leg.marketValue });
  const gainLoss = swapMath.legGainLoss({ bookValue, marketValue, gainLoss: leg.gainLoss });
  const proceeds = swapMath.legProceeds({ marketValue, accrued: leg.accrued });
  const bookYield = leg.bookYieldYtm != null ? leg.bookYieldYtm : leg.bookYieldYtw;
  const marketYield = leg.marketYieldYtw != null ? leg.marketYieldYtw : leg.marketYieldYtm;
  const teBookYield = taxRate != null && bookYield != null ? swapMath.teYield(bookYield, taxRate) : bookYield;
  const teMarketYield = taxRate != null && marketYield != null ? swapMath.teYield(marketYield, taxRate) : marketYield;
  return {
    cusip: leg.cusip || '',
    sector: leg.sector || '',
    description: leg.description || '',
    coupon: leg.coupon,
    maturity: shortDate(leg.maturity),
    callDate: shortDate(leg.callDate),
    par,
    teBookYield: computedCell(teBookYield, [bookYield, taxRate]),
    teMarketYield: computedCell(teMarketYield, [marketYield, taxRate]),
    bookPrice,
    marketPrice,
    modifiedDuration: leg.modifiedDuration,
    averageLife: leg.averageLife,
    bookValue: computedCell(bookValue, [leg.bookValue, parRaw, bookPrice]),
    marketValue: computedCell(marketValue, [leg.marketValue, parRaw, marketPrice]),
    gainLoss: computedCell(gainLoss, [leg.gainLoss, bookValue, marketValue]),
    accrued: leg.accrued,
    proceeds: computedCell(proceeds, [marketValue, leg.accrued])
  };
}

function renderLegRow(row) {
  return `<tr>${SELL_BUY_COLUMNS.map(col => {
    const v = row[col.key];
    const align = col.align === 'right' ? ' class="r"' : '';
    return `<td${align}>${fmtCell(v, col.fmt)}</td>`;
  }).join('')}</tr>`;
}

function renderTotalsRow(label, agg, taxRate) {
  if (!agg) return '';
  const totalsByKey = {
    cusip: '',
    description: label,
    coupon: null,
    maturity: '',
    callDate: '',
    par: agg.par,
    teBookYield: taxRate != null && agg.bookYield != null ? swapMath.teYield(agg.bookYield, taxRate) : agg.bookYield,
    teMarketYield: taxRate != null && agg.marketYield != null ? swapMath.teYield(agg.marketYield, taxRate) : agg.marketYield,
    bookPrice: null,
    marketPrice: null,
    averageLife: agg.averageLife,
    bookValue: agg.bookValue,
    marketValue: agg.marketValue,
    gainLoss: agg.gainLoss,
    accrued: agg.accrued,
    proceeds: agg.marketValue == null ? null : (Number(agg.marketValue) || 0) + (Number(agg.accrued) || 0)
  };
  const cells = SELL_BUY_COLUMNS.map(col => {
    const v = totalsByKey[col.key];
    const align = col.align === 'right' ? ' class="r totals"' : ' class="totals"';
    return `<td${align}>${fmtCell(v, col.fmt)}</td>`;
  });
  return `<tr class="totals-row">${cells.join('')}</tr>`;
}

function renderLegTable(title, legs, totals, taxRate) {
  const headerRow = SELL_BUY_COLUMNS
    .map(c => `<th style="width:${c.width}" class="${c.align === 'right' ? 'r' : ''}">${escapeHtml(c.label)}</th>`)
    .join('');
  const body = legs.length
    ? legs.map(row => renderLegRow(deriveLegRow(row, taxRate))).join('')
    : `<tr><td class="empty" colspan="${SELL_BUY_COLUMNS.length}">No legs entered.</td></tr>`;
  return `
    <section class="leg-block">
      <h3>${escapeHtml(title)} (${legs.length})</h3>
      <table class="leg-table">
        <colgroup>${SELL_BUY_COLUMNS.map(c => `<col style="width:${c.width}">`).join('')}</colgroup>
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${body}</tbody>
        ${totals ? `<tfoot>${renderTotalsRow('Totals', totals, taxRate)}</tfoot>` : ''}
      </table>
    </section>
  `;
}

function renderSummaryBlock(summary) {
  if (!summary) {
    return `<section class="summary-block"><p class="empty">Summary will populate once legs are added.</p></section>`;
  }
  const d = summary.dollars || {};
  const p = summary.percents || {};
  const diff = summary.portfolioDiff || {};
  const beMo = summary.breakevenMonths;
  const beYr = summary.breakevenYears;
  const beLabel = beMo == null
    ? '—'
    : `${beMo.toFixed(1)} mo (${beYr == null ? '—' : beYr.toFixed(2)} yr)`;
  const fmtMoney = v => v == null ? '—' : money0(v);
  const fmtPct = v => v == null ? '—' : pct3(v);
  return `
    <section class="summary-block">
      <div class="summary-tables">
        <table class="summary-table">
          <caption>Dollar Income / Loss</caption>
          <thead><tr><th></th><th class="r">Sells</th><th class="r">Buys</th><th class="r">Net</th></tr></thead>
          <tbody>
            <tr><td>Interest to horizon</td>
              <td class="r">${fmtMoney(d.sellInterest)}</td>
              <td class="r">${fmtMoney(d.buyInterest)}</td>
              <td class="r">${fmtMoney(d.netInterest)}</td></tr>
            <tr><td>Realized gain (loss)</td>
              <td class="r">${fmtMoney(d.realizedGainLoss)}</td>
              <td class="r">—</td>
              <td class="r">${fmtMoney(d.realizedGainLoss)}</td></tr>
            <tr><td>Settle adjust</td>
              <td class="r">${fmtMoney(summary.settleAdjust)}</td>
              <td class="r">—</td>
              <td class="r">${fmtMoney(summary.settleAdjust)}</td></tr>
            <tr class="totals-row"><td>Total income</td>
              <td class="r">—</td>
              <td class="r">—</td>
              <td class="r">${fmtMoney(d.totalIncome)}</td></tr>
          </tbody>
        </table>
        <table class="summary-table">
          <caption>% of Sells Market Value</caption>
          <thead><tr><th></th><th class="r">Sells</th><th class="r">Buys</th><th class="r">Net</th></tr></thead>
          <tbody>
            <tr><td>Interest to horizon</td>
              <td class="r">${fmtPct(p.sellInterest)}</td>
              <td class="r">${fmtPct(p.buyInterest)}</td>
              <td class="r">${fmtPct(p.netInterest)}</td></tr>
            <tr><td>Realized gain (loss)</td>
              <td class="r">${fmtPct(p.realizedGainLoss)}</td>
              <td class="r">—</td>
              <td class="r">${fmtPct(p.realizedGainLoss)}</td></tr>
            <tr><td>Total income</td>
              <td class="r">—</td>
              <td class="r">—</td>
              <td class="r">${fmtPct(p.totalIncome)}</td></tr>
          </tbody>
        </table>
      </div>
      <aside class="summary-side">
        <div><dt>Breakeven</dt><dd>${beLabel}</dd></div>
        <div><dt>Horizon</dt><dd>${summary.horizonYears == null ? '—' : summary.horizonYears.toFixed(2) + ' yr'}</dd></div>
        <div><dt>Net benefit</dt><dd>${fmtMoney(d.netBenefit)}</dd></div>
        <div><dt>Sell market value</dt><dd>${summary.sells && summary.sells.marketValue != null ? fmtMoney(summary.sells.marketValue) : '—'}</dd></div>
      </aside>
      <table class="diff-table">
        <caption>Portfolio change (Sells → Buys)</caption>
        <thead><tr><th></th><th class="r">Sells</th><th class="r">Buys</th><th class="r">Δ</th></tr></thead>
        <tbody>
          <tr><td>Par</td>
            <td class="r">${fmtMoney(summary.sells && summary.sells.par)}</td>
            <td class="r">${fmtMoney(summary.buys && summary.buys.par)}</td>
            <td class="r">${fmtMoney(diff.par)}</td></tr>
          <tr><td>Book value</td>
            <td class="r">${fmtMoney(summary.sells && summary.sells.bookValue)}</td>
            <td class="r">${fmtMoney(summary.buys && summary.buys.bookValue)}</td>
            <td class="r">${fmtMoney(diff.bookValue)}</td></tr>
          <tr><td>Market value</td>
            <td class="r">${fmtMoney(summary.sells && summary.sells.marketValue)}</td>
            <td class="r">${fmtMoney(summary.buys && summary.buys.marketValue)}</td>
            <td class="r">${fmtMoney(diff.marketValue)}</td></tr>
          <tr><td>TE book yield</td>
            <td class="r">${fmtPct(summary.sells && summary.sells.teBookYield)}</td>
            <td class="r">${fmtPct(summary.buys && summary.buys.teBookYield)}</td>
            <td class="r">${fmtPct(diff.teBookYield)}</td></tr>
          <tr><td>TE mkt yield</td>
            <td class="r">${fmtPct(summary.sells && summary.sells.teMarketYield)}</td>
            <td class="r">${fmtPct(summary.buys && summary.buys.teMarketYield)}</td>
            <td class="r">${fmtPct(diff.teMarketYield)}</td></tr>
          <tr><td>Avg life</td>
            <td class="r">${summary.sells && summary.sells.averageLife != null ? num2(summary.sells.averageLife) : '—'}</td>
            <td class="r">${summary.buys && summary.buys.averageLife != null ? num2(summary.buys.averageLife) : '—'}</td>
            <td class="r">${diff.averageLife != null ? num2(diff.averageLife) : '—'}</td></tr>
          <tr><td>Mod duration</td>
            <td class="r">${summary.sells && summary.sells.duration != null ? num2(summary.sells.duration) : '—'}</td>
            <td class="r">${summary.buys && summary.buys.duration != null ? num2(summary.buys.duration) : '—'}</td>
            <td class="r">${diff.duration != null ? num2(diff.duration) : '—'}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

// ---------- Public entry point ----------

function renderProposalHtml(record, opts = {}) {
  if (!record || !record.proposal) {
    return '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Proposal not found.</p>';
  }

  const { proposal } = record;
  // Use snapshot when sent (numbers must not silently change); otherwise
  // compute live from current legs.
  let sells, buys, summary, source = 'live';
  if (record.snapshot && proposal.status === 'sent') {
    const s = record.snapshot.data || {};
    sells = s.sells || [];
    buys = s.buys || [];
    summary = s.summary || null;
    source = 'snapshot';
  } else {
    // Skip unfilled rows in the printable artifact — a row with no CUSIP
    // and no par is an unfinished stub from the editor, not a real leg.
    const realLeg = l => {
      if (!l) return false;
      const cusip = String(l.cusip || '').trim();
      const par = Number(l.par);
      return cusip || (Number.isFinite(par) && par > 0);
    };
    const enrich = l => swapMath.enrichLegWithComputedFields(l, proposal.settleDate);
    sells = (record.legs || []).filter(l => l.side === 'sell' && realLeg(l)).map(enrich);
    buys = (record.legs || []).filter(l => l.side === 'buy' && realLeg(l)).map(enrich);
    summary = swapMath.swapSummary({
      sells, buys,
      horizonYears: proposal.horizonYears || 3,
      taxRate: proposal.taxRate
    });
  }

  const taxRate = proposal.taxRate;
  const isDraft = proposal.status === 'draft';
  const watermark = isDraft ? '<div class="watermark" aria-hidden="true">DRAFT</div>' : '';
  const subjectBank = opts.bankName || record.bankName || '';
  const statusBadge = isDraft
    ? `<span class="badge draft">Draft · live values</span>`
    : `<span class="badge frozen">${escapeHtml(proposal.status)} · snapshot ${record.snapshot && record.snapshot.frozenAt ? longDate(record.snapshot.frozenAt) : ''}</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(proposal.id)} · ${escapeHtml(proposal.title || 'Bond Swap')}</title>
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
header.brand .doc-info strong { display: block; font-size: 22px; color: var(--ink); letter-spacing: 0.02em; }
.proposal-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 14px 0 18px; font-size: 12px; }
.proposal-meta div { background: var(--bg-soft); padding: 8px 10px; border-radius: 6px; }
.proposal-meta dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 800; margin: 0 0 2px; }
.proposal-meta dd { margin: 0; font-weight: 700; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; margin-left: 6px; vertical-align: middle; }
.badge.draft { background: #fef3c7; color: #92400e; }
.badge.frozen { background: #dcfce7; color: #166534; }
.summary-block { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; row-gap: 12px; margin: 8px 0 18px; }
.summary-tables { grid-column: 1 / span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.summary-side { grid-column: 1 / span 2; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: var(--bg-soft); padding: 10px; border-radius: 6px; }
.summary-side dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 800; margin: 0 0 2px; }
.summary-side dd { margin: 0; font-size: 14px; font-weight: 800; color: var(--ink); }
.summary-table, .diff-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.summary-table caption, .diff-table caption { text-align: left; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding-bottom: 4px; font-weight: 800; }
.summary-table th, .summary-table td, .diff-table th, .diff-table td { padding: 5px 7px; border-bottom: 1px solid var(--rule); }
.summary-table th, .diff-table th { text-align: left; background: var(--bg-soft); font-weight: 800; font-size: 11px; }
.summary-table .r, .diff-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.summary-table .totals-row td, .diff-table .totals-row td { font-weight: 800; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.diff-table { grid-column: 1 / span 2; }
.leg-block { margin-top: 14px; }
.leg-block h3 { font-size: 13px; margin: 0 0 6px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.leg-table { width: 100%; border-collapse: collapse; font-size: 10.5px; table-layout: fixed; }
.leg-table th, .leg-table td { padding: 4px 5px; border-bottom: 1px solid var(--rule); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.leg-table td:nth-child(2) { white-space: normal; }
.leg-table th { background: var(--bg-soft); font-weight: 800; font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; }
.leg-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.leg-table .totals, .leg-table .totals-row td { font-weight: 800; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
.leg-table .empty { color: var(--muted); font-style: italic; text-align: center; padding: 12px; }
footer.foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--rule); font-size: 10px; color: var(--muted); }
footer.foot .offices { letter-spacing: 0.06em; margin-bottom: 4px; }
footer.foot .badges { font-weight: 800; letter-spacing: 0.08em; }
footer.foot .disclosure { margin-top: 6px; }
.notation-note { margin-top: 8px; font-style: italic; }
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg); font-size: 140px; font-weight: 900; color: #92400e; opacity: 0.07; letter-spacing: 0.1em; pointer-events: none; z-index: 0; }
.print-controls { background: var(--bg-soft); padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--rule); font-size: 12px; }
.print-controls button { background: var(--ink); color: #fff; border: 0; border-radius: 999px; padding: 6px 16px; font-weight: 800; cursor: pointer; }
.empty { color: var(--muted); font-style: italic; }
@media print {
  .print-controls { display: none; }
  .page { padding: 0.3in; }
  .leg-table { font-size: 9px; }
  .summary-block { page-break-after: avoid; }
  .leg-block { page-break-inside: avoid; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { size: letter portrait; margin: 0.5in; }
</style>
</head>
<body>
<div class="print-controls">
  <span>${escapeHtml(proposal.id)} · ${escapeHtml(proposal.title || 'Bond Swap')} ${statusBadge} · source: ${escapeHtml(source)}</span>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</div>
<div class="page">
  ${watermark}
  <header class="brand">
    <div class="firm">First Bankers' Banc Securities, Inc.<strong>Bond Swap Proposal</strong></div>
    <div class="doc-info"><strong>${escapeHtml(proposal.id)}</strong>${escapeHtml(longDate(proposal.proposalDate))}</div>
  </header>

  <dl class="proposal-meta">
    <div><dt>Prepared for</dt><dd>${escapeHtml(proposal.preparedFor || subjectBank || 'Bank')}</dd></div>
    <div><dt>Prepared by</dt><dd>${escapeHtml(proposal.preparedBy || 'FBBS')}</dd></div>
    <div><dt>Trade date</dt><dd>${escapeHtml(shortDate(proposal.proposalDate))}</dd></div>
    <div><dt>Settle date</dt><dd>${escapeHtml(shortDate(proposal.settleDate))}</dd></div>
    <div><dt>Tax rate</dt><dd>${proposal.taxRate == null ? '—' : pct3(proposal.taxRate)}${proposal.isSubchapterS ? ' (Sub-S)' : (proposal.isSubchapterS === false ? ' (C-corp)' : '')}</dd></div>
    <div><dt>Status</dt><dd>${escapeHtml(proposal.status)}</dd></div>
    <div><dt>Sells / Buys</dt><dd>${sells.length} / ${buys.length}</dd></div>
    <div><dt>Notes</dt><dd>${escapeHtml(proposal.notes || '—')}</dd></div>
  </dl>

  ${renderSummaryBlock(summary)}

  ${renderLegTable('Funding source (Sells)', sells, summary && summary.sells, taxRate)}
  ${renderLegTable('Investments (Buys)', buys, summary && summary.buys, taxRate)}

  <footer class="foot">
    <div class="offices">${OFFICES.map(escapeHtml).join(' · ')}</div>
    <div class="badges">FINRA · MEMBER SIPC · MSRB</div>
    <div class="notation-note">&mdash; = no input. n/a = cannot compute from the supplied inputs.</div>
    <div class="disclosure">For Institutional Use Only. Investments are not FDIC insured, not bank guaranteed &amp; may lose value. Certificate of Deposit investments may qualify for FDIC insurance through the issuing bank. First Bankers' Banc Securities, Inc. is a member of FINRA / SIPC. Copyright &copy; ${new Date().getUTCFullYear()} FBBS, Inc.</div>
  </footer>
</div>
</body>
</html>`;
}

module.exports = { renderProposalHtml };
