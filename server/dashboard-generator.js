'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'dashboard-assets', 'FBBS_Dashboard_TEMPLATE.html');

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPct(value, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

function fmtNum(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtDate(value) {
  if (!value) return '—';
  const parts = String(value).split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${Number(m)}/${Number(d)}/${y}`;
  }
  return String(value);
}

function avg(values) {
  const nums = values.filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function max(values) {
  const nums = values.filter(v => v != null && !Number.isNaN(Number(v))).map(Number);
  return nums.length ? Math.max(...nums) : null;
}

function topBy(values, getter, limit = 10) {
  return [...values]
    .filter(v => getter(v) != null && !Number.isNaN(Number(getter(v))))
    .sort((a, b) => Number(getter(b)) - Number(getter(a)))
    .slice(0, limit);
}

function sectorName(value) {
  const raw = String(value || 'Industrial');
  if (/financial/i.test(raw)) return 'Financial';
  if (/tech/i.test(raw)) return 'Technology';
  if (/comm|telecom|media/i.test(raw)) return 'Communications';
  if (/consumer|retail/i.test(raw)) return 'Consumer';
  if (/util/i.test(raw)) return 'Utilities';
  return 'Industrial';
}

function muniRow(o, taxable = false) {
  const rating = [o.moodysRating, o.spRating].filter(Boolean).join(' / ') || '—';
  if (taxable) {
    return `<tr><td>${esc(o.issuerName)}</td><td>${esc(o.issuerState)}</td><td>${fmtPct(o.coupon, 3)}</td><td>${fmtDate(o.maturity)}</td><td>${fmtDate(o.callDate)}</td><td>${o.ytw != null ? fmtPct(o.ytw, 3) : esc(o.spread || '—')}</td><td>${fmtPct(o.ytm, 3)}</td><td>${fmtNum(o.price, 3)}</td><td>${esc(rating)}</td><td>${esc(o.cusip)}</td><td>${fmtNum(o.quantity)}</td></tr>`;
  }
  const enh = o.creditEnhancement ? `<span class="pill pill-blue">${esc(o.creditEnhancement)}</span>` : '—';
  return `<tr><td>${esc(o.issuerName)}</td><td>${esc(o.issuerState)}</td><td>${fmtPct(o.coupon, 3)}</td><td>${fmtDate(o.maturity)}</td><td>${fmtDate(o.callDate)}</td><td class="tey-cell" data-ytm="${esc(o.ytm ?? '')}" data-ytw="${esc(o.ytw ?? '')}">—</td><td class="ytw">${fmtPct(o.ytw, 3)}</td><td>${fmtPct(o.ytm, 3)}</td><td>${fmtNum(o.price, 3)}</td><td>${esc(rating)}</td><td>${enh}</td><td>${fmtNum(o.quantity)}</td></tr>`;
}

function agencyBulletRow(o) {
  return `<tr><td>${esc(o.ticker)}</td><td>${fmtPct(o.coupon, 3)}</td><td>${fmtDate(o.maturity)}</td><td class="ytw">${fmtPct(o.ytm, 3)}</td><td class="${Number(o.askSpread) >= 0 ? 'spd-pos' : 'spd-neg'}">${fmtNum(o.askSpread, 1)}bp</td><td>${esc(o.benchmark)}</td><td>${fmtNum(o.availableSize, 3)}MM</td><td>${esc(o.cusip)}</td></tr>`;
}

function agencyCallableRow(o) {
  return `<tr><td>${esc(o.ticker)}</td><td>${fmtPct(o.coupon, 3)}</td><td>${fmtDate(o.maturity)}</td><td>${fmtDate(o.nextCallDate)}</td><td>${esc(o.callType || '—')}</td><td>${fmtPct(o.ytnc, 3)}</td><td class="ytw">${fmtPct(o.ytm, 3)}</td><td>${fmtNum(o.availableSize, 3)}MM</td><td>${esc(o.cusip)}</td></tr>`;
}

function corporateRow(o) {
  const sector = sectorName(o.sector);
  const spreadClass = Number(o.askSpread) >= 0 ? 'spd-pos' : 'spd-neg';
  return `<tr data-sector="${esc(sector)}"><td>${esc(o.issuerName)}</td><td>${esc(o.ticker)}</td><td>${fmtPct(o.coupon, 3)}</td><td>${fmtDate(o.maturity)}</td><td>${fmtDate(o.nextCallDate)}</td><td class="ytw">${fmtPct(o.ytm, 3)}</td><td class="${spreadClass}">${fmtNum(o.askSpread, 0)}bp</td><td>${esc([o.moodysRating, o.spRating].filter(Boolean).join(' / ') || o.creditTier || '—')}</td><td><span class="sector-badge">${esc(sector === 'Communications' ? 'Comms' : sector)}</span></td><td>${fmtNum(o.availableSize, 0)}</td></tr>`;
}

function cdRow(o) {
  return `<tr><td>${esc(o.term)}</td><td>${esc(o.name)}</td><td class="ytw">${fmtPct(o.rate, 2)}</td><td>${esc(o.couponFrequency || '—')}</td><td>${esc(o.cusip)}</td></tr>`;
}

function strategyCards({ bestCd, bestMuni, bestAgency, bestCorp, dateText }) {
  return `
    <div class="strat-grid">
      <div class="strat-card featured">
        <div class="card-header"><div class="card-header-top"><div class="strat-title">Strategy of the Day: Source-Backed Draft</div><span class="featured-badge">★ Strategy of the Day</span></div><div class="buyer-row"><span class="buyer-badge tag-scorp">S-Corp Bank</span><span class="buyer-badge tag-ccorp">C-Corp Bank</span><span class="buyer-badge tag-ria">RIA / Money Manager</span></div></div>
        <div class="card-body"><p>This portal-generated draft uses parsed inventory from ${esc(dateText)} and avoids unsourced macro claims. Add trader commentary before final client-facing publication.</p><div class="detail-row"><div class="detail-chip dc-highlight"><span class="dc-label">Top CD</span><span class="dc-val">${esc(bestCd ? `${bestCd.name} ${fmtPct(bestCd.rate, 2)}` : 'Pending')}</span></div><div class="detail-chip"><span class="dc-label">Agency YTM</span><span class="dc-val">${bestAgency ? fmtPct(bestAgency.ytm, 3) : '—'}</span></div><div class="detail-chip"><span class="dc-label">Corp YTM</span><span class="dc-val">${bestCorp ? fmtPct(bestCorp.ytm, 3) : '—'}</span></div></div></div>
      </div>
      <div class="strat-card"><div class="card-header"><div class="card-header-top"><div class="strat-title">Tax-Exempt Muni Review</div></div><div class="buyer-row"><span class="buyer-badge tag-scorp">S-Corp Bank</span><span class="buyer-badge tag-ccorp">C-Corp Bank</span></div></div><div class="card-body"><p>${bestMuni ? `Review ${esc(bestMuni.issuerName)} at ${fmtPct(bestMuni.ytw, 3)} YTW with ${fmtNum(bestMuni.quantity)} available. TEY is calculated from YTW and excludes TEFRA and disallowance adjustments.` : 'Upload muni offerings to populate tax-exempt ideas.'}</p></div></div>
      <div class="strat-card"><div class="card-header"><div class="card-header-top"><div class="strat-title">Callable Agency / Bullet Ladder</div></div><div class="buyer-row"><span class="buyer-badge tag-scorp">S-Corp Bank</span><span class="buyer-badge tag-ccorp">C-Corp Bank</span><span class="buyer-badge tag-ria">RIA / Money Manager</span></div></div><div class="card-body"><p>${bestAgency ? `Highest parsed agency YTM is ${esc(bestAgency.ticker)} ${fmtPct(bestAgency.coupon, 3)} due ${fmtDate(bestAgency.maturity)} at ${fmtPct(bestAgency.ytm, 3)}.` : 'Upload agency Excel files to populate agency ladder ideas.'}</p></div></div>
      <div class="strat-card"><div class="card-header"><div class="card-header-top"><div class="strat-title">IG Corporate Screen</div></div><div class="buyer-row"><span class="buyer-badge tag-ria">RIA / Money Manager</span><span class="buyer-badge tag-ccorp">C-Corp Bank</span></div></div><div class="card-body"><p>${bestCorp ? `Corporate screen highlights ${esc(bestCorp.issuerName)} ${esc(bestCorp.ticker || '')} at ${fmtPct(bestCorp.ytm, 3)} YTM, ${esc(bestCorp.creditTier || 'IG')} tier.` : 'Upload corporates Excel file to populate corporate ideas.'}</p></div></div>
    </div>`;
}

function buildPicks({ bestCd, bestMuni, bestAgency, bestCorp }) {
  const picks = [];
  if (bestAgency) picks.push({ type: 'Agency', audience: ['scorp', 'ccorp', 'ria'], title: `${bestAgency.ticker} ${fmtPct(bestAgency.coupon, 2)} ${fmtDate(bestAgency.maturity)}`, yld: fmtPct(bestAgency.ytm, 3), why: `CUSIP ${bestAgency.cusip} · ${fmtNum(bestAgency.availableSize, 3)}MM available · 20% risk weight`, tab: 'agencies' });
  if (bestMuni) picks.push({ type: 'Tax-Exempt Muni', audience: ['scorp', 'ccorp'], title: `${bestMuni.issuerName}`.slice(0, 58), yld: fmtPct(bestMuni.ytw, 3), why: `CUSIP ${bestMuni.cusip} · YTW-based TEY · ${fmtNum(bestMuni.quantity)} available`, tab: 'munis' });
  if (bestCorp) picks.push({ type: 'IG Corporate', audience: ['ria', 'ccorp'], title: `${bestCorp.issuerName}`.slice(0, 58), yld: fmtPct(bestCorp.ytm, 3), why: `CUSIP ${bestCorp.cusip} · ${bestCorp.creditTier || 'IG'} tier · ${bestCorp.sector || 'sector'} exposure`, tab: 'corps' });
  if (bestCd) picks.push({ type: 'CD', audience: ['scorp', 'ccorp', 'ria'], title: `${bestCd.name}`.slice(0, 58), yld: fmtPct(bestCd.rate, 2), why: `CUSIP ${bestCd.cusip} · ${bestCd.term} term · ${bestCd.couponFrequency || 'coupon frequency listed'}`, tab: 'cds' });
  while (picks.length < 6) picks.push({ type: 'Draft Slot', audience: ['scorp', 'ccorp', 'ria'], title: 'Trader commentary pending', yld: '—', why: 'Add desk commentary before final publication.', tab: 'strategies' });
  return JSON.stringify(picks).replace(/</g, '\\u003c');
}

function preflight(html) {
  const count = needle => (html.match(new RegExp(needle, 'g')) || []).length;
  const checks = [
    { label: 'No template placeholders remain', ok: !html.includes('{{') },
    { label: 'Muni search exists once', ok: count('id="muniSearch"') === 1 },
    { label: 'Corporate search exists once', ok: count('id="corpsSearch"') === 1 },
    { label: 'Seven inactive panels hidden', ok: count('style="display:none"') >= 7 },
    { label: 'TEY cells include YTW data', ok: count('class="tey-cell"') <= count('data-ytw=') },
    { label: 'TEFRA disclaimer present', ok: /tefra/i.test(html) },
    { label: 'Disallowance disclaimer present', ok: /disallow/i.test(html) }
  ];
  return { passed: checks.every(c => c.ok), checks };
}

function buildDefaultTokens(dateText) {
  const pending = 'Source pending';
  const tokens = {
    DATE: dateText,
    UST_2Y: '—', UST_2Y_SUB: pending, UST_2Y_DIR: '',
    UST_5Y: '—', UST_5Y_SUB: pending, UST_5Y_DIR: '',
    UST_10Y: '—', UST_10Y_SUB: pending, UST_10Y_DIR: '',
    FED_EFF: '—', FED_SUB: pending, FED_DIR: '',
    DJIA: '—', DJIA_SUB: pending, DJIA_DIR: '',
    SP500: '—', SP500_SUB: pending, SP500_DIR: '',
    VIX: '—', VIX_SUB: pending, VIX_DIR: '',
    WTI: '—', WTI_SUB: pending, WTI_DIR: '',
    MMD_5Y: '—', MMD_5Y_LABEL: 'pending', MMD_5Y_RATIO: pending,
    MMD_10Y: '—', MMD_10Y_LABEL: 'pending', MMD_10Y_RATIO: pending,
    MMD_20Y: '—', MMD_20Y_LABEL: 'pending', MMD_20Y_RATIO: pending,
    MMD_AS_OF_SHORT: 'pending', MMD_AS_OF_DATE: pending,
    MMD_1Y: '—', MMD_SCALE_2Y: '—', MMD_3Y: '—', MMD_SCALE_5Y: '—', MMD_7Y: '—', MMD_SCALE_10Y: '—', MMD_15Y: '—', MMD_SCALE_20Y: '—', MMD_25Y: '—', MMD_30Y: '—',
    RV_UST_DATA: '[null,null,null,null,null,null,null,null,null,null]',
    RV_CD_DATA: '[null,null,null,null,null,null,null,null,null,null]',
    RV_AGENCY_DATA: '[null,null,null,null,null,null,null,null,null,null]',
    RV_CORP_DATA: '[null,null,null,null,null,null,null,null,null,null]',
    BCD_CHART_CD_DATA: '[null,null,null,null,null,null,null,null,null,null,null]',
    BCD_CHART_FHLB_DATA: '[null,null,null,null,null,null,null,null,null,null,null]',
    BCD_CHART_SOFR_DATA: '[null,null,null,null,null,null,null,null,null,null,null]',
    BCD_CHART_UST_DATA: '[null,null,null,null,null,null,null,null,null,null,null]',
    CD_CHART_LABELS: '["1m","3m","6m","12m","18m","2y","3y","4y","5y"]',
    CD_CHART_CD_DATA: '[null,null,null,null,null,null,null,null,null]',
    CD_CHART_UST_DATA: '[null,null,null,null,null,null,null,null,null]',
    CD_CHART_CD_COLORS: '["#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B","#2E9E6B"]',
    RV_CD_VS_UST_ROWS: '<tr><td colspan="5">CD Relative Value PDF not parsed yet.</td></tr>',
    RV_MUNI_TEY_ROWS: '<tr><td colspan="4">MMD / TEY source pending.</td></tr>',
    RV_CORP_SPREAD_ROWS: '<tr><td colspan="3">Corporate spread source pending.</td></tr>',
    RV_KEY_TAKEAWAY: 'Portal draft generated from parsed inventory. Add macro and relative-value source files before final publication.',
    BCD_BULLET_ROWS: '<tr><td colspan="6">Brokered CD Rate Sheet parser pending.</td></tr>',
    BCD_CALLABLE_ROWS: '<tr><td colspan="4">Brokered CD Rate Sheet parser pending.</td></tr>',
    BCD_COMMENTARY: 'Brokered CD commentary source pending.',
    BCD_KPI1_LABEL: 'Source', BCD_KPI1_VAL: 'Pending', BCD_KPI1_SUB: 'Brokered CD PDF', BCD_KPI1_DIR: '',
    BCD_KPI2_LABEL: 'Source', BCD_KPI2_VAL: 'Pending', BCD_KPI2_SUB: 'FHLB benchmark', BCD_KPI2_DIR: '',
    BCD_KPI3_LABEL: 'Source', BCD_KPI3_VAL: 'Pending', BCD_KPI3_SUB: 'SOFR / curve', BCD_KPI3_DIR: '',
    BCD_KPI4_LABEL: 'Source', BCD_KPI4_VAL: 'Pending', BCD_KPI4_SUB: 'Desk notes', BCD_KPI4_DIR: '',
    CD_SWEET_SPOT_GRID: '<div class="cd-cell"><div class="cd-term">CD source</div><div class="cd-rate">Pending</div><div class="cd-vs">Upload CD RV PDF for spread view</div></div>',
    CD_BEST_RATE_LABEL: 'Best Parsed CD Rate',
    CD_BEST_RATE_NARRATIVE: 'Pending CD offerings upload',
    CD_BEST_RATE_DETAILS: 'Generated by portal draft workflow.',
    CD_WARN_TITLE: 'Review before publication',
    CD_WARN_BODY: 'Macro and relative value inputs are pending until additional dashboard source parsers are added.',
    CD_SHORT_END_ROWS: '<tr><td colspan="5">Upload CD offerings to populate.</td></tr>',
    CD_CORE_RANGE_ROWS: '<tr><td colspan="5">Upload CD offerings to populate.</td></tr>',
    AGENCY_NOTE: 'Portal draft uses parsed agency Excel rows. Review featured bonds and trader notes before publication.',
    CORP_CONTEXT_NARRATIVE: 'Portal draft uses parsed corporate Excel rows. Add desk commentary before final client-facing publication.',
    CORP_FOOTER_NOTE: 'Generated draft: verify spread context and ratings before publication.',
    SCORP_BLURB: 'Review tax-exempt muni TEY and agency structure with institution-specific tax guidance.',
    CCORP_BLURB: 'Review tax-exempt TEY with C-Corp disallowance and institution-specific tax guidance.',
    RIA_BLURB: 'Review CDs, agencies, and IG corporates for client suitability and liquidity needs.',
    SCORP_IDEA1_TITLE: 'Tax-exempt muni review', SCORP_IDEA1_NOTE: 'Source-backed pick pending review.',
    SCORP_IDEA2_TITLE: 'Callable agency ladder', SCORP_IDEA2_NOTE: 'Source-backed pick pending review.',
    SCORP_IDEA3_TITLE: 'CD alternatives', SCORP_IDEA3_NOTE: 'Source-backed pick pending review.',
    CCORP_IDEA1_TITLE: 'Agency ladder', CCORP_IDEA1_NOTE: 'Source-backed pick pending review.',
    CCORP_IDEA2_TITLE: 'Muni TEY review', CCORP_IDEA2_NOTE: 'Source-backed pick pending review.',
    CCORP_IDEA3_TITLE: 'IG corporate screen', CCORP_IDEA3_NOTE: 'Source-backed pick pending review.',
    RIA_IDEA1_TITLE: 'CD screen', RIA_IDEA1_NOTE: 'Source-backed pick pending review.',
    RIA_IDEA2_TITLE: 'Agency bullets', RIA_IDEA2_NOTE: 'Source-backed pick pending review.',
    RIA_IDEA3_TITLE: 'IG corporates', RIA_IDEA3_NOTE: 'Source-backed pick pending review.',
    MUNI_INV_NOTE: 'Parsed muni offerings from portal upload.',
    AGENCY_SHELF_NOTE: 'Parsed agency offerings from portal upload.',
    CORP_IDEAS_NOTE: 'Parsed corporate offerings from portal upload.'
  };
  return tokens;
}

function generateDashboard({ currentDir, outputPath }) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const meta = readJson(path.join(currentDir, '_meta.json')) || {};
  const cds = readJson(path.join(currentDir, '_offerings.json')) || {};
  const munis = readJson(path.join(currentDir, '_muni_offerings.json')) || {};
  const agencies = readJson(path.join(currentDir, '_agencies.json')) || {};
  const corps = readJson(path.join(currentDir, '_corporates.json')) || {};
  const date = meta.date || cds.asOfDate || munis.asOfDate || agencies.fileDate || corps.fileDate || new Date().toISOString().slice(0, 10);
  const dateText = fmtDate(date);

  const cdRows = Array.isArray(cds.offerings) ? cds.offerings : [];
  const muniRows = Array.isArray(munis.offerings) ? munis.offerings : [];
  const agencyRows = Array.isArray(agencies.offerings) ? agencies.offerings : [];
  const corpRows = Array.isArray(corps.offerings) ? corps.offerings : [];
  const bestCd = topBy(cdRows, o => o.rate, 1)[0];
  const bestMuni = topBy(muniRows.filter(o => o.section !== 'Taxable' && Number(o.quantity) >= 250), o => o.ytw, 1)[0];
  const bestAgency = topBy(agencyRows.filter(o => Number(o.availableSize) >= 0.25), o => o.ytm, 1)[0];
  const bestCorp = topBy(corpRows.filter(o => Number(o.availableSize) >= 250), o => o.ytm, 1)[0];

  const bq = muniRows.filter(o => o.section === 'BQ');
  const standard = muniRows.filter(o => o.section !== 'BQ' && o.section !== 'Taxable');
  const taxable = muniRows.filter(o => o.section === 'Taxable');
  const bullets = agencyRows.filter(o => o.structure === 'Bullet');
  const callables = agencyRows.filter(o => o.structure === 'Callable');
  const shortCds = cdRows.filter(o => Number(o.termMonths) <= 12);
  const coreCds = cdRows.filter(o => Number(o.termMonths) > 12);

  const tokens = buildDefaultTokens(dateText);
  Object.assign(tokens, {
    MUNI_COUNT: fmtNum(muniRows.length),
    MUNI_INV_COUNT: fmtNum(muniRows.length),
    AGENCY_COUNT: fmtNum(agencyRows.length),
    AGENCY_SHELF_COUNT: fmtNum(agencyRows.length),
    CORP_COUNT: fmtNum(corpRows.length),
    CORP_IDEAS_COUNT: fmtNum(corpRows.length),
    STRUCTURED_COUNT: '0',
    BQ_MUNI_ROWS: bq.length ? bq.map(o => muniRow(o)).join('\n') : '<tr><td colspan="12">No BQ muni rows parsed.</td></tr>',
    STD_MUNI_ROWS: standard.length ? standard.map(o => muniRow(o)).join('\n') : '<tr><td colspan="12">No standard muni rows parsed.</td></tr>',
    TAXABLE_MUNI_ROWS: taxable.length ? taxable.map(o => muniRow(o, true)).join('\n') : '<tr><td colspan="11">No taxable muni rows parsed.</td></tr>',
    AGENCY_BULLET_ROWS: bullets.length ? topBy(bullets, o => o.ytm, 20).map(agencyBulletRow).join('\n') : '<tr><td colspan="8">No agency bullet rows parsed.</td></tr>',
    AGENCY_CALLABLE_ROWS: callables.length ? topBy(callables, o => o.ytm, 20).map(agencyCallableRow).join('\n') : '<tr><td colspan="9">No agency callable rows parsed.</td></tr>',
    CORPORATE_ROWS: corpRows.length ? topBy(corpRows, o => o.ytm, 80).map(corporateRow).join('\n') : '<tr><td colspan="10">No corporate rows parsed.</td></tr>',
    CD_SHORT_END_ROWS: shortCds.length ? topBy(shortCds, o => o.rate, 12).map(cdRow).join('\n') : '<tr><td colspan="5">No short-end CD rows parsed.</td></tr>',
    CD_CORE_RANGE_ROWS: coreCds.length ? topBy(coreCds, o => o.rate, 12).map(cdRow).join('\n') : '<tr><td colspan="5">No core-range CD rows parsed.</td></tr>',
    CD_BEST_RATE_NARRATIVE: bestCd ? `${esc(bestCd.name)} at ${fmtPct(bestCd.rate, 2)}` : tokens.CD_BEST_RATE_NARRATIVE,
    CD_BEST_RATE_DETAILS: bestCd ? `CUSIP ${esc(bestCd.cusip)} · ${esc(bestCd.term)} · matures ${fmtDate(bestCd.maturity)}` : tokens.CD_BEST_RATE_DETAILS,
    BOTD_HEADLINE: bestMuni ? `${esc(bestMuni.issuerName)} ${fmtPct(bestMuni.coupon, 3)} due ${fmtDate(bestMuni.maturity)}` : 'Tax-exempt muni selection pending',
    BOTD_TEY: bestMuni ? fmtPct(bestMuni.ytw / (1 - 0.21), 3) : '—',
    BOTD_TEY_RATE: '21',
    BOTD_NARRATIVE: bestMuni ? `${fmtPct(bestMuni.ytw, 3)} YTW and ${fmtNum(bestMuni.quantity)} available.` : 'Upload muni offerings and review eligible tax-exempt bonds.',
    BOTD_CUSIP: bestMuni ? bestMuni.cusip : '—',
    BOTD_SETTLE: bestMuni ? fmtDate(bestMuni.settle) : '—',
    BOTD_YTW_JS: bestMuni ? Number(bestMuni.ytw).toFixed(3) : '0',
    STRATEGIES_CONTEXT_NARRATIVE: `Portal-generated draft from parsed ${dateText} inventory. Macro, MMD, brokered CD, CD relative value, and trader commentary inputs should be reviewed before final publication.`,
    STRATEGY_CARDS_HTML: strategyCards({ bestCd, bestMuni, bestAgency, bestCorp, dateText }),
    PICKS_DATA_JS: buildPicks({ bestCd, bestMuni, bestAgency, bestCorp }),
    AGENCY_NOTE: `${agencyRows.length ? `${fmtNum(agencyRows.length)} agency rows parsed. Average YTM ${fmtPct(avg(agencyRows.map(o => o.ytm)), 3)}.` : 'No agency rows parsed.'} Review relative-value selection before final publication.`,
    CORP_CONTEXT_NARRATIVE: `${corpRows.length ? `${fmtNum(corpRows.length)} corporate rows parsed. Average YTM ${fmtPct(avg(corpRows.map(o => o.ytm)), 3)}.` : 'No corporate rows parsed.'} Review ratings, spread context, and desk commentary before final publication.`
  });

  let html = template.replace(/{{([A-Z0-9_]+)}}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) return tokens[key];
    return '—';
  });

  const report = preflight(html);
  fs.writeFileSync(outputPath, html);
  return {
    outputFile: path.basename(outputPath),
    date,
    report,
    counts: {
      cds: cdRows.length,
      munis: muniRows.length,
      agencies: agencyRows.length,
      corporates: corpRows.length
    }
  };
}

module.exports = {
  generateDashboard,
  preflight,
  TEMPLATE_PATH
};
