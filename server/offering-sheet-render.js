'use strict';

/**
 * FBBS Portal — Offering Sheet printable view
 *
 * Renders one or more normalized offering rows as a standalone, branded HTML
 * artifact suitable for Save-as-PDF. Pure render: no I/O, no pricing math beyond
 * formatting the portal's already-normalized inventory fields.
 */

const { escapeHtml, isBlank } = require('./html-escape');

function num(value) {
  if (isBlank(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money0(value) {
  const n = num(value);
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function pct3(value) {
  const n = num(value);
  if (n == null) return '—';
  return `${n.toFixed(3)}%`;
}

function price(value) {
  const n = num(value);
  if (n == null) return '—';
  return n.toFixed(3);
}

function shortDate(value) {
  if (!value) return '—';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : escapeHtml(s);
}

function longDate(value) {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(d.getTime())) return escapeHtml(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function audienceLabel(key) {
  const k = String(key || '').toLowerCase();
  if (k === 'ccorp') return 'C-corp bank';
  if (k === 'scorp') return 'S-corp bank';
  if (k === 'ria') return 'RIA';
  return key ? String(key) : 'Institutional';
}

function stat(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

function detailRow(label, value) {
  if (isBlank(value)) return '';
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function offeringLine(row) {
  return [
    row.assetClass,
    row.description,
    row.cusip ? `CUSIP ${row.cusip}` : '',
    row.coupon != null ? `${pct3(row.coupon)} coupon` : '',
    row.yield != null ? `${pct3(row.yield)} yield` : '',
    row.maturity ? `mat ${shortDate(row.maturity)}` : '',
    row.price != null ? `price ${price(row.price)}` : '',
  ].filter(Boolean).join(' · ');
}

function renderOfferingCard(row) {
  const size = row.availabilityK ? money0(Number(row.availabilityK) * 1000) : '—';
  const ratings = [row.moody, row.sp].filter(Boolean).join(' / ') || '—';
  const attrs = [
    row.taxStatus,
    row.bq === true ? 'Bank qualified' : row.bq === false ? 'Non-BQ' : '',
    row.callDate ? `Call ${shortDate(row.callDate)}` : '',
    row.creditEnhancement,
    row.sector
  ].filter(Boolean);
  return `
  <section class="offering">
    <div class="offering-head">
      <div>
        <p class="kicker">${escapeHtml(row.assetClass || 'Offering')}</p>
        <h2>${escapeHtml(row.description || row.cusip || 'Offering')}</h2>
        <p class="line">${escapeHtml(offeringLine(row))}</p>
      </div>
      <div class="yield-box">
        <span>${pct3(row.yield)}</span>
        <small>Yield</small>
      </div>
    </div>
    <dl class="stats">
      ${stat('CUSIP', escapeHtml(row.cusip || '—'))}
      ${stat('Coupon', pct3(row.coupon))}
      ${stat('Maturity', shortDate(row.maturity))}
      ${stat('Price', price(row.price))}
      ${stat('Size', size)}
      ${stat('Ratings', escapeHtml(ratings))}
    </dl>
    <table class="details">
      <tbody>
        ${detailRow('Sector / structure', row.sector)}
        ${detailRow('State', row.state)}
        ${detailRow('Tax status', row.taxStatus)}
        ${detailRow('Next call', row.callDate ? shortDate(row.callDate) : '')}
        ${detailRow('Attributes', attrs.join(' · '))}
      </tbody>
    </table>
  </section>`;
}

function renderOfferingSheetHtml(input, opts = {}) {
  const offerings = Array.isArray(input && input.offerings) ? input.offerings : [];
  const packageDate = input && input.packageDate;
  const audience = audienceLabel(input && input.audience);
  const title = offerings.length > 1 ? 'Offering Basket' : 'Offering Sheet';
  const generatedAt = opts.generatedAt || new Date().toISOString();
  if (!offerings.length) {
    return `<!doctype html><meta charset="utf-8"><title>Offering Sheet unavailable</title><p>No offering rows were provided.</p>`;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} · FBBS</title>
<style>
:root { --ink:#0f1f17; --muted:#4a5b53; --rule:#c8d6cd; --soft:#f4f8f6; --brand:#003f2a; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#fff; color:var(--ink); font:13px/1.42 -apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif; }
.page { max-width:1080px; margin:0 auto; padding:30px 38px 36px; }
@media print { .page { max-width:none; padding:22px 28px 28px; } .offering { break-inside: avoid; } }
header.brand { display:flex; justify-content:space-between; gap:20px; align-items:flex-end; border-bottom:2px solid var(--ink); padding-bottom:10px; }
.firm { font-weight:800; letter-spacing:.04em; font-size:12px; text-transform:uppercase; }
.firm strong { display:block; font-size:19px; letter-spacing:0; text-transform:none; margin-top:2px; }
.doc-info { text-align:right; color:var(--muted); font-size:11px; }
.doc-info strong { display:block; color:var(--ink); font-size:22px; letter-spacing:.02em; }
.intro { display:flex; justify-content:space-between; gap:18px; color:var(--muted); border-bottom:1px solid var(--rule); padding:12px 0; }
.intro strong { color:var(--ink); }
.offering { border:1px solid var(--rule); border-radius:8px; padding:16px; margin-top:16px; }
.offering-head { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; }
.kicker { margin:0 0 4px; color:var(--brand); font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
h2 { margin:0 0 5px; font-size:20px; line-height:1.2; }
.line { margin:0; color:var(--muted); }
.yield-box { min-width:96px; text-align:right; background:var(--soft); border:1px solid var(--rule); border-radius:8px; padding:9px 10px; }
.yield-box span { display:block; color:var(--brand); font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; }
.yield-box small { color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; }
.stats { display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin:14px 0; }
.stats div { background:var(--soft); border-radius:6px; padding:8px; min-width:0; }
dt { margin:0 0 2px; color:var(--muted); font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
dd { margin:0; font-weight:750; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.details { width:100%; border-collapse:collapse; font-size:12px; }
.details th, .details td { border-top:1px solid var(--rule); padding:7px 8px; vertical-align:top; }
.details th { width:170px; color:var(--muted); text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
footer { border-top:1px solid var(--rule); margin-top:18px; padding-top:10px; color:var(--muted); font-size:10.5px; line-height:1.45; }
@media (max-width:760px) { .page { padding:20px; } header.brand, .intro, .offering-head { flex-direction:column; align-items:flex-start; } .doc-info, .yield-box { text-align:left; } .stats { grid-template-columns:repeat(2,1fr); } }
</style>
</head>
<body>
<main class="page">
  <header class="brand">
    <div class="firm">First Bankers' Banc Securities, Inc.<strong>FBBS Offering Sheet</strong></div>
    <div class="doc-info"><strong>${escapeHtml(title)}</strong>${packageDate ? `Package ${escapeHtml(longDate(packageDate))}<br>` : ''}Generated ${escapeHtml(longDate(generatedAt))}</div>
  </header>
  <section class="intro">
    <div><strong>Audience:</strong> ${escapeHtml(audience)}</div>
    <div><strong>Count:</strong> ${offerings.length}</div>
  </section>
  ${offerings.map(renderOfferingCard).join('')}
  <footer>
    For Institutional Use Only. Subject to availability, price change, prior sale, and credit approval.
    This internal sheet summarizes parsed portal inventory and is not investment advice or a client-facing prospectus.
    Review official offering documents and desk marks before use.
  </footer>
</main>
</body>
</html>`;
}

module.exports = { renderOfferingSheetHtml, offeringLine };
