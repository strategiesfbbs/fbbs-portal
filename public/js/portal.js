/**
 * FBBS Portal — Front-end JavaScript
 * Handles page navigation, file uploads, and data display.
 */

(function() {
  'use strict';

  let currentPackage = null;
  let archiveData = [];
  let qualitySummary = {
    warnings: 0,
    datesMatch: null,
    countsText: '—'
  };
  let marketData = {
    cds: [],
    munis: [],
    agencies: [],
    corporates: []
  };
  let economicUpdateData = null;
  let selectedMarketSection = 'rates';
  let selectedCdCalcTerm = 3;
  let selectedCdRecapPeriod = 'previousWeek';
  let cdRecapData = null;
  let bankDataStatus = null;
  let selectedBank = null;
  let savedBanks = [];
  let selectedBankAccountStatus = null;
  let selectedTearSheetCoverage = null;
  let selectedBankCoverage = null;
  let selectedBankNotes = [];
  let activeCoverageBankId = null;
  let activeBankWorkspaceView = 'tear-sheet';
  let strategyRequests = [];
  let strategyCounts = {};
  let selectedFiles = {
    dashboard: null, econ: null, cd: null, cdoffers: null, munioffers: null,
    agenciesBullets: null, agenciesCallables: null, corporates: null
  };

  const SLOTS = ['dashboard', 'econ', 'cd', 'cdoffers', 'munioffers', 'agenciesBullets', 'agenciesCallables', 'corporates'];
  const TOTAL_SLOTS = SLOTS.length;

  const DOC_TYPES = {
    dashboard:         { label: 'FBBS Sales Dashboard', ext: 'HTML', viewer: 'dashboard' },
    econ:              { label: 'Economic Update', ext: 'PDF',  viewer: 'econ' },
    cd:                { label: 'Brokered CD Sheet', ext: 'PDF', viewer: 'cd' },
    cdoffers:          { label: 'Daily CD Offerings', ext: 'PDF', viewer: 'cdoffers' },
    munioffers:        { label: 'Muni Offerings', ext: 'PDF', viewer: 'munioffers' },
    agenciesBullets:   { label: 'Agencies — Bullets', ext: 'XLSX', viewer: 'agencies' },
    agenciesCallables: { label: 'Agencies — Callables', ext: 'XLSX', viewer: 'agencies' },
    corporates:        { label: 'Corporates', ext: 'XLSX', viewer: 'corporates' }
  };

  const VALID_PAGES = ['home', 'dashboard', 'econ', 'cd', 'cdoffers', 'munioffers',
                       'cd-recap', 'explorer', 'muni-explorer', 'agencies', 'corporates',
                       'banks', 'strategies', 'archive', 'upload', 'admin'];

  const NAV_ITEMS = [
    { page: 'home', group: 'Home', label: 'Dashboard', description: 'Status, market snapshot, search all offerings', aliases: 'home command center summary' },
    { page: 'dashboard', group: 'FBBS', label: 'Sales Dashboard', description: 'Open the published FBBS dashboard', aliases: 'sales html full view fbbs' },
    { page: 'econ', group: 'FBBS', label: 'Economic Update', description: 'View or download the economic PDF', aliases: 'economy pdf download fbbs' },
    { page: 'cd', group: 'CDs', label: 'Brokered CD Sheet', description: 'View or download the brokered CD rate sheet', aliases: 'rate sheet brokered cd pdf' },
    { page: 'cdoffers', group: 'Documents', label: 'Daily CD Offerings PDF', description: 'View or download the raw Daily CD Offerings PDF', aliases: 'daily cd offerings offers pdf raw document' },
    { page: 'cd-recap', group: 'CDs', label: 'Weekly CD Recap', description: 'Deduped weekly CD issuance summary', aliases: 'weekly recap history median coupon cds' },
    { page: 'explorer', group: 'Offerings', label: 'CD Explorer', description: 'Filter, sort, and export CD offerings', aliases: 'search cds cusip issuer rates offerings' },
    { page: 'munioffers', group: 'Documents', label: 'Muni Offerings PDF', description: 'View or download the raw muni offerings PDF', aliases: 'municipal pdf munis muni offerings raw document' },
    { page: 'muni-explorer', group: 'Offerings', label: 'Muni Explorer', description: 'Filter, sort, and export muni offerings', aliases: 'municipal bonds state rating munis offerings' },
    { page: 'agencies', group: 'Offerings', label: 'Agency Explorer', description: 'Search agency bullets and callables', aliases: 'agency agencies fhlb fnma callable bullet offerings' },
    { page: 'corporates', group: 'Offerings', label: 'Corporate Explorer', description: 'Search corporate inventory', aliases: 'corporate bonds issuer ticker sector offerings' },
    { page: 'banks', group: 'Banks', label: 'Bank Tear Sheets', description: 'Search call report balance sheet and tear sheet data', aliases: 'bank call report balance sheet snl cert salesforce' },
    { page: 'strategies', group: 'Banks', label: 'Strategies Queue', description: 'Track bond swap, Muni BCIS, CECL, and miscellaneous requests', aliases: 'bond swap bcis cecl monday tasks requests billing strategies' },
    { page: 'archive', group: 'Operations', label: 'Archive', description: 'Open previously published packages', aliases: 'history dates old documents' },
    { page: 'upload', group: 'Operations', label: 'Upload', description: 'Publish today\'s daily package', aliases: 'publish files drop documents agency cd muni corporate' },
    { page: 'admin', group: 'Operations', label: 'Admin', description: 'Review the publish audit log', aliases: 'audit log admin history' }
  ];

  const NAV_GROUP_BY_PAGE = {
    dashboard: 'fbbs',
    econ: 'fbbs',
    cd: 'cds',
    'cd-recap': 'cds',
    explorer: 'offerings',
    'muni-explorer': 'offerings',
    agencies: 'offerings',
    corporates: 'offerings',
    banks: 'banks',
    strategies: 'banks'
  };

  const DEFAULT_BROKERED_CD_TERMS = [
    { label: '3 mo', months: 3, low: 3.900, mid: 3.950, high: 4.000 },
    { label: '6 mo', months: 6, low: 3.900, mid: 3.925, high: 3.950 },
    { label: '9 mo', months: 9, low: 3.950, mid: 4.000, high: 4.050 },
    { label: '12 mo', months: 12, low: 3.900, mid: 3.950, high: 4.000 },
    { label: '18 mo', months: 18, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '2 yr', months: 24, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '3 yr', months: 36, low: 3.950, mid: 4.025, high: 4.100 },
    { label: '4 yr', months: 48, low: 4.000, mid: 4.075, high: 4.150 },
    { label: '5 yr', months: 60, low: 4.050, mid: 4.125, high: 4.200 },
    { label: '7 yr', months: 84, low: 4.150, mid: 4.225, high: 4.300 },
    { label: '10 yr', months: 120, low: 4.250, mid: 4.325, high: 4.400 }
  ];

  const COMMISSION_STORAGE_KEY = 'fbbs_commission_settings_v1';
  const BANK_RECENT_STORAGE_KEY = 'fbbs_recent_banks_v1';
  const MAX_RECENT_BANKS = 6;
  const BANK_COVERAGE_STATUSES = ['Open', 'Prospect', 'Client', 'Watchlist', 'Dormant'];
  const BANK_COVERAGE_PRIORITIES = ['High', 'Medium', 'Low'];
  const STRATEGY_TYPES = ['Bond Swap', 'Muni BCIS', 'CECL Analysis', 'Miscellaneous'];
  const STRATEGY_STATUSES = ['Open', 'In Progress', 'Completed', 'Needs Billed'];
  const STRATEGY_PRIORITIES = ['1', '2', '3', '4'];
  const COMMISSION_PRODUCT_LABELS = {
    agencies: 'Agencies',
    corporates: 'Corporates'
  };
  const DEFAULT_COMMISSION_SETTINGS = {
    agencies: { enabled: false, method: 'dollars', dollarMarkup: 5, bpMarkup: 50 },
    corporates: { enabled: false, method: 'dollars', dollarMarkup: 5, bpMarkup: 50 }
  };
  let commissionSettings = loadCommissionSettings();

  // ============ Utilities ============

  function showToast(msg, isError) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function loadCommissionSettings() {
    try {
      const raw = localStorage.getItem(COMMISSION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const settings = {};
      Object.keys(DEFAULT_COMMISSION_SETTINGS).forEach(product => {
        settings[product] = {
          ...DEFAULT_COMMISSION_SETTINGS[product],
          ...(parsed[product] || {})
        };
        if (settings[product].dollarMarkup == null && settings[product].manualBp != null) {
          settings[product].dollarMarkup = Number(settings[product].manualBp) / 10;
        }
        if (settings[product].bpMarkup == null && settings[product].manualBp != null) {
          settings[product].bpMarkup = Number(settings[product].manualBp);
        }
        if (settings[product].method !== 'bps') settings[product].method = 'dollars';
        settings[product].dollarMarkup = normalizeCommissionDollars(settings[product].dollarMarkup);
        settings[product].bpMarkup = normalizeCommissionBps(settings[product].bpMarkup);
      });
      return settings;
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_COMMISSION_SETTINGS));
    }
  }

  function saveCommissionSettings() {
    try {
      localStorage.setItem(COMMISSION_STORAGE_KEY, JSON.stringify(commissionSettings));
    } catch (e) {
      // Storage is a convenience only; the overlay still works for the session.
    }
  }

  function normalizeCommissionDollars(value) {
    const n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(100, n);
  }

  function normalizeCommissionBps(value) {
    const n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(1000, n);
  }

  function commissionMarkForProduct(product) {
    const settings = commissionSettings[product];
    if (!settings || !settings.enabled) return null;
    if (settings.method === 'bps') {
      const bps = normalizeCommissionBps(settings.bpMarkup);
      return {
        label: `${Number(bps).toFixed(Number(bps) % 1 === 0 ? 0 : 2)} bp`,
        method: 'bps',
        value: bps
      };
    }
    const dollars = normalizeCommissionDollars(settings.dollarMarkup);
    return {
      label: formatCommissionDollars(dollars),
      method: 'dollars',
      value: dollars
    };
  }

  function formatCommissionDollars(dollars) {
    if (dollars == null) return '';
    return `$${Number(dollars).toFixed(Number(dollars) % 1 === 0 ? 0 : 2)}`;
  }

  function commissionSubline(text) {
    return text ? `<span class="commission-subline">${escapeHtml(text)}</span>` : '';
  }

  function markedAgencyValues(record) {
    const commission = commissionMarkForProduct('agencies');
    if (!commission || !record || record.askPrice == null) return null;
    const baseBasis = agencySpreadBasis(record);
    const clientPrice = markedAgencyPrice(record, commission, baseBasis);
    if (clientPrice == null) return null;
    const priceMarkup = clientPrice - record.askPrice;
    const ytmDelta = yieldDeltaForPriceMark(record, record.maturity, record.ytm, clientPrice);
    const ytncDelta = yieldDeltaForPriceMark(record, record.nextCallDate, record.ytnc, clientPrice);
    const markedYtm = ytmDelta == null || record.ytm == null ? null : record.ytm + ytmDelta;
    const markedYtnc = ytncDelta == null || record.ytnc == null ? null : record.ytnc + ytncDelta;
    const markedSpreadBasis = agencySpreadBasis(record, clientPrice, { ytm: markedYtm, ytnc: markedYtnc });
    const markedSpread = markedAgencySpread(record, markedSpreadBasis);
    return { ...commission, priceMarkup, clientPrice, markedYtm, markedYtnc, markedSpreadBasis, markedSpread };
  }

  function markedAgencyPrice(record, commission, baseBasis) {
    if (!commission || !record) return null;
    if (commission.method === 'bps') {
      if (!baseBasis || baseBasis.yieldPct == null) return null;
      const markedYieldPct = baseBasis.yieldPct - (commission.value / 100);
      const modelBasePrice = solveBondPrice(record.coupon, baseBasis.yieldPct, baseBasis.date, record.settle);
      const modelMarkedPrice = solveBondPrice(record.coupon, markedYieldPct, baseBasis.date, record.settle);
      if (modelBasePrice == null || modelMarkedPrice == null) return null;
      return record.askPrice + (modelMarkedPrice - modelBasePrice);
    }
    return record.askPrice + (commission.value / 10);
  }

  function markedAgencySpread(record, markedBasis) {
    const baseBasis = agencySpreadBasis(record);
    if (!markedBasis || markedBasis.yieldPct == null) return null;
    const treasury = treasuryForAgencyBasis(markedBasis);
    if (treasury && treasury.yield != null) return (markedBasis.yieldPct - treasury.yield) * 100;

    const baseSpread = effectiveAgencySpread(record);
    if (baseSpread == null || !baseBasis || baseBasis.key !== markedBasis.key) return null;
    return baseSpread + ((markedBasis.yieldPct - baseBasis.yieldPct) * 100);
  }

  function yieldDeltaForPriceMark(record, endDate, sourceYieldPct, markedPrice) {
    if (!record || record.askPrice == null || record.coupon == null || !endDate || sourceYieldPct == null) return null;
    const baseModelYield = solveBondYieldPct(record.coupon, record.askPrice, endDate, record.settle);
    const markedModelYield = solveBondYieldPct(record.coupon, markedPrice, endDate, record.settle);
    if (baseModelYield == null || markedModelYield == null) return null;
    return markedModelYield - baseModelYield;
  }

  function solveBondYieldPct(couponPct, price, endDateStr, settleDateStr) {
    const priceNum = Number(price);
    const coupon = Number(couponPct);
    if (!isFinite(priceNum) || priceNum <= 0 || !isFinite(coupon)) return null;

    const settle = parseIsoDate(settleDateStr) || new Date();
    const endDate = parseIsoDate(endDateStr);
    if (!endDate || endDate <= settle) return null;

    const periods = Math.max(1, Math.ceil(monthsBetween(settle, endDate) / 6));
    const couponPerPeriod = coupon / 2;

    let low = -0.95;
    let high = 1.5;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      const pv = bondPriceFromYield(mid, couponPerPeriod, periods);
      if (pv > priceNum) low = mid;
      else high = mid;
    }
    return ((low + high) / 2) * 100;
  }

  function solveBondPrice(couponPct, yieldPct, endDateStr, settleDateStr) {
    const coupon = Number(couponPct);
    const yieldNum = Number(yieldPct);
    if (!isFinite(coupon) || !isFinite(yieldNum)) return null;
    const settle = parseIsoDate(settleDateStr) || new Date();
    const endDate = parseIsoDate(endDateStr);
    if (!endDate || endDate <= settle) return null;
    const periods = Math.max(1, Math.ceil(monthsBetween(settle, endDate) / 6));
    return bondPriceFromYield(yieldNum / 100, coupon / 2, periods);
  }

  function bondPriceFromYield(yieldDecimal, couponPerPeriod, periods) {
    const rate = yieldDecimal / 2;
    let pv = 0;
    for (let i = 1; i <= periods; i++) {
      pv += couponPerPeriod / Math.pow(1 + rate, i);
    }
    pv += 100 / Math.pow(1 + rate, periods);
    return pv;
  }

  function parseIsoDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function monthsBetween(start, end) {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + ((end.getDate() - start.getDate()) / 30.4375);
  }

  function commissionPriceHtml(product, record, price, decimals) {
    if (price == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(price).toFixed(decimals == null ? 3 : decimals);
    const marked = product === 'corporates' ? markedCorporateValues(record) : markedAgencyValues(record);
    if (!marked) return base;
    return `${base}${commissionSubline(`client ${marked.clientPrice.toFixed(decimals == null ? 3 : decimals)} / ${marked.label}`)}`;
  }

  function commissionSpreadHtml(record) {
    const spread = effectiveAgencySpread(record);
    if (!record || spread == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(spread).toFixed(1);
    const marked = markedAgencyValues(record);
    if (!marked || marked.markedSpread == null) return base;
    return `${base}${commissionSubline(`marked ${marked.markedSpread.toFixed(1)}`)}`;
  }

  function commissionYieldHtml(record, key, decimals) {
    const baseYield = record && record[key];
    if (baseYield == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(baseYield).toFixed(decimals == null ? 3 : decimals);
    const marked = markedAgencyValues(record);
    const markedYield = key === 'ytnc' ? marked && marked.markedYtnc : marked && marked.markedYtm;
    if (markedYield == null) return base;
    return `${base}${commissionSubline(`marked ${markedYield.toFixed(decimals == null ? 3 : decimals)}`)}`;
  }

  function markedCorporateValues(record) {
    const commission = commissionMarkForProduct('corporates');
    if (!commission || !record || record.askPrice == null) return null;
    const baseBasis = corporateYieldBasis(record);
    const clientPrice = markedCorporatePrice(record, commission, baseBasis);
    if (clientPrice == null) return null;
    const priceMarkup = clientPrice - record.askPrice;
    const ytmDelta = yieldDeltaForPriceMark(record, record.maturity, record.ytm, clientPrice);
    const ytncDelta = yieldDeltaForPriceMark(record, record.nextCallDate, record.ytnc, clientPrice);
    const markedYtm = ytmDelta == null || record.ytm == null ? null : record.ytm + ytmDelta;
    const markedYtnc = ytncDelta == null || record.ytnc == null ? null : record.ytnc + ytncDelta;
    const markedSpread = record.askSpread == null || ytmDelta == null ? null : record.askSpread + (ytmDelta * 100);
    return { ...commission, priceMarkup, clientPrice, markedYtm, markedYtnc, markedSpread };
  }

  function corporateYieldBasis(record) {
    if (!record) return null;
    if (record.maturity && record.ytm != null) return { date: record.maturity, yieldPct: record.ytm, key: 'ytm' };
    if (record.nextCallDate && record.ytnc != null) return { date: record.nextCallDate, yieldPct: record.ytnc, key: 'ytnc' };
    return null;
  }

  function markedCorporatePrice(record, commission, baseBasis) {
    if (!commission || !record) return null;
    if (commission.method === 'bps') {
      if (!baseBasis || baseBasis.yieldPct == null) return null;
      const markedYieldPct = baseBasis.yieldPct - (commission.value / 100);
      const modelBasePrice = solveBondPrice(record.coupon, baseBasis.yieldPct, baseBasis.date, null);
      const modelMarkedPrice = solveBondPrice(record.coupon, markedYieldPct, baseBasis.date, null);
      if (modelBasePrice == null || modelMarkedPrice == null) return null;
      return record.askPrice + (modelMarkedPrice - modelBasePrice);
    }
    return record.askPrice + (commission.value / 10);
  }

  function commissionCorporateYieldHtml(record, key, decimals) {
    const baseYield = record && record[key];
    if (baseYield == null) return '<span class="no-restrict">&mdash;</span>';
    const base = Number(baseYield).toFixed(decimals == null ? 3 : decimals);
    const marked = markedCorporateValues(record);
    const markedYield = key === 'ytnc' ? marked && marked.markedYtnc : marked && marked.markedYtm;
    if (markedYield == null) return base;
    return `${base}${commissionSubline(`marked ${markedYield.toFixed(decimals == null ? 3 : decimals)}`)}`;
  }

  function renderCommissionControl(product, afterElementId) {
    const after = document.getElementById(afterElementId);
    if (!after || !commissionSettings[product]) return;
    const panelId = `${product}-commission-control`;
    let panel = document.getElementById(panelId);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'commission-control';
      after.insertAdjacentElement('afterend', panel);
    }
    const settings = commissionSettings[product];
    const scaleText = settings.method === 'bps'
      ? '10 bp = 0.10 price | 50 bp = 0.50 | 100 bp = 1.00'
      : '$1 = 0.10 price | $5 = 0.50 | $10 = 1.00';
    panel.innerHTML = `
      <label class="commission-toggle">
        <input type="checkbox" data-commission-enabled="${product}" ${settings.enabled ? 'checked' : ''}>
        <span>Add sales commission to ${escapeHtml(COMMISSION_PRODUCT_LABELS[product])}</span>
      </label>
      <label class="commission-field">
        <span>Method</span>
        <select data-commission-method="${product}">
          <option value="dollars" ${settings.method === 'dollars' ? 'selected' : ''}>Sales $</option>
          <option value="bps" ${settings.method === 'bps' ? 'selected' : ''}>Basis points</option>
        </select>
      </label>
      <label class="commission-field">
        <span>Sales $</span>
        <input type="number" min="0" max="100" step="0.25" value="${escapeHtml(settings.dollarMarkup)}" data-commission-dollars="${product}">
      </label>
      <label class="commission-field">
        <span>Basis points</span>
        <input type="number" min="0" max="1000" step="1" value="${escapeHtml(settings.bpMarkup)}" data-commission-bps="${product}">
      </label>
      <div class="commission-scale-note">${escapeHtml(scaleText)}</div>
    `;
  }

  function setupCommissionControls() {
    document.addEventListener('change', e => {
      const enabledProduct = e.target && e.target.dataset ? e.target.dataset.commissionEnabled : null;
      const methodProduct = e.target && e.target.dataset ? e.target.dataset.commissionMethod : null;
      if (enabledProduct && commissionSettings[enabledProduct]) {
        commissionSettings[enabledProduct].enabled = e.target.checked;
        saveCommissionSettings();
        refreshCommissionProduct(enabledProduct);
      }
      if (methodProduct && commissionSettings[methodProduct]) {
        commissionSettings[methodProduct].method = e.target.value === 'bps' ? 'bps' : 'dollars';
        saveCommissionSettings();
        renderCommissionControl(methodProduct, methodProduct === 'corporates' ? 'corpStatTiles' : 'agencyStatTiles');
        refreshCommissionProduct(methodProduct);
      }
    });
    document.addEventListener('input', e => {
      const dollarProduct = e.target && e.target.dataset ? e.target.dataset.commissionDollars : null;
      const bpProduct = e.target && e.target.dataset ? e.target.dataset.commissionBps : null;
      const product = dollarProduct || bpProduct;
      if (!product || !commissionSettings[product]) return;
      if (dollarProduct) commissionSettings[product].dollarMarkup = normalizeCommissionDollars(e.target.value);
      if (bpProduct) commissionSettings[product].bpMarkup = normalizeCommissionBps(e.target.value);
      saveCommissionSettings();
      refreshCommissionProduct(product);
    });
  }

  function refreshCommissionProduct(product) {
    if (product === 'agencies' && agencyData) renderAgencies();
    if (product === 'corporates' && corpData) renderCorporates();
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const [y, m, d] = dateStr.split('-');
      const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
      return date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return dateStr; }
  }

  function formatNumericDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const clean = dateStr instanceof Date ? null : String(dateStr).slice(0, 10);
      const date = dateStr instanceof Date
        ? dateStr
        : /^\d{4}-\d{2}-\d{2}$/.test(clean)
          ? new Date(parseInt(clean.slice(0, 4), 10), parseInt(clean.slice(5, 7), 10) - 1, parseInt(clean.slice(8, 10), 10))
          : new Date(dateStr);
      if (isNaN(date)) return dateStr;
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
    } catch (e) { return dateStr; }
  }

  function formatTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatNumber(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  }

  function formatMoney(n, digits = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  }

  function formatPercent(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function formatPercentTile(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return `${formatPercent(n, digits)}%`;
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function slugifyFilename(value) {
    return String(value || 'bank')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'bank';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function average(values) {
    const nums = values.filter(v => v != null && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function maxValue(values) {
    const nums = values.filter(v => v != null && !isNaN(v));
    return nums.length ? Math.max(...nums) : null;
  }

  function minDate(values) {
    const dates = values.filter(Boolean).sort();
    return dates.length ? dates[0] : null;
  }

  function mostCommonTerm(offerings) {
    const counts = new Map();
    offerings.forEach(o => {
      if (!o.term) return;
      const existing = counts.get(o.term) || { term: o.term, count: 0, termMonths: o.termMonths };
      existing.count += 1;
      if (existing.termMonths == null && o.termMonths != null) existing.termMonths = o.termMonths;
      counts.set(o.term, existing);
    });
    const top = [...counts.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.termMonths == null) return 1;
      if (b.termMonths == null) return -1;
      return a.termMonths - b.termMonths;
    })[0];
    return top ? `${top.term} (${formatNumber(top.count)})` : '—';
  }

  function renderStatTiles(targetId, tiles) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = tiles.map(t => `
      <div class="stat-tile">
        <span>${escapeHtml(t.label)}</span>
        <strong>${escapeHtml(String(t.value ?? '—'))}</strong>
      </div>
    `).join('');
  }

  function renderHomeMarketTiles() {
    const cds = marketData.cds || [];
    const munis = marketData.munis || [];
    const agencies = marketData.agencies || [];
    const corporates = marketData.corporates || [];
    const callableAgencies = agencies.filter(o => o.structure === 'Callable').length;
    const igCorporates = corporates.filter(o => o.investmentGrade).length;
    const hyCorporates = corporates.filter(o => !o.investmentGrade).length;

    renderStatTiles('homeMarketTiles', [
      { label: 'Highest CD Rate', value: formatPercentTile(maxValue(cds.map(o => o.rate)), 2) },
      { label: 'Most Common CD Term', value: mostCommonTerm(cds) },
      { label: 'Callable Agencies', value: formatNumber(callableAgencies) },
      { label: 'Corporates IG / HY', value: corporates.length ? `${formatNumber(igCorporates)} / ${formatNumber(hyCorporates)}` : '—' },
      { label: 'Average Agency YTM', value: formatPercentTile(average(agencies.map(o => o.ytm)), 3) },
      { label: 'Average Corp YTM', value: formatPercentTile(average(corporates.map(o => o.ytm)), 3) }
    ]);
  }

  function renderHomeStatusTiles(filled) {
    const pkg = currentPackage || {};
    const dateText = qualitySummary.datesMatch == null
      ? 'No date check'
      : (qualitySummary.datesMatch ? 'Dates aligned' : 'Check dates');
    const warningText = qualitySummary.warnings
      ? `${qualitySummary.warnings} warning${qualitySummary.warnings === 1 ? '' : 's'}`
      : 'Clean';

    renderStatTiles('homeStatusTiles', [
      { label: 'Package', value: `${filled} / ${TOTAL_SLOTS} files` },
      { label: 'Published', value: pkg.publishedAt ? formatTime(pkg.publishedAt) : 'Not yet' },
      { label: 'Data Health', value: warningText },
      { label: 'Date Check', value: dateText }
    ]);
  }

  function homeMissingDocs() {
    const pkg = currentPackage || {};
    return SLOTS
      .filter(slot => !pkg[slot])
      .map(slot => DOC_TYPES[slot].label);
  }

  function homeWorkItemHtml(item) {
    return `
      <button type="button" class="home-work-item ${item.tone || ''}" data-goto="${escapeHtml(item.page)}">
        <span>${escapeHtml(item.kicker)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <em>${escapeHtml(item.detail)}</em>
      </button>
    `;
  }

  function renderHomeWorkList(filled) {
    const target = document.getElementById('homeWorkList');
    if (!target) return;
    const pkg = currentPackage || {};
    const missing = homeMissingDocs();
    const items = [];

    if (filled < TOTAL_SLOTS) {
      items.push({
        page: 'upload',
        tone: 'attention',
        kicker: 'Publish',
        title: `${TOTAL_SLOTS - filled} file${TOTAL_SLOTS - filled === 1 ? '' : 's'} missing`,
        detail: missing.slice(0, 2).join(', ') + (missing.length > 2 ? ` + ${missing.length - 2} more` : '')
      });
    } else {
      items.push({
        page: 'archive',
        tone: 'ok',
        kicker: 'Published',
        title: `Package ready for ${formatShortDate(pkg.date)}`,
        detail: `Last published ${formatTime(pkg.publishedAt)}`
      });
    }

    if (qualitySummary.datesMatch === false || qualitySummary.warnings > 0) {
      items.push({
        page: 'upload',
        tone: 'attention',
        kicker: 'Review',
        title: qualitySummary.datesMatch === false ? 'Date mismatch detected' : 'Parser warnings detected',
        detail: qualitySummary.countsText || 'Review upload quality before sharing'
      });
    }

    items.push({
      page: 'banks',
      kicker: 'Coverage',
      title: 'Open bank tear sheets',
      detail: 'Search banks, saved coverage, and notes'
    });

    items.push({
      page: 'cd-recap',
      kicker: 'CDs',
      title: 'Review weekly CD recap',
      detail: 'Deduped CUSIPs, term counts, and rate changes'
    });

    target.innerHTML = items.map(homeWorkItemHtml).join('');
  }

  function renderHomeLaunchGrid() {
    const target = document.getElementById('homeLaunchGrid');
    if (!target) return;
    const cds = marketData.cds || [];
    const munis = marketData.munis || [];
    const agencies = marketData.agencies || [];
    const corporates = marketData.corporates || [];
    const cards = [
      { page: 'banks', label: 'Banks', title: 'Bank Tear Sheets', detail: 'Call report tear sheets, saved banks, notes, and coverage status.', metric: 'Coverage workspace' },
      { page: 'explorer', label: 'CDs', title: 'CD Explorer', detail: 'Search daily CD offerings by issuer, CUSIP, term, rate, and restrictions.', metric: `${formatNumber(cds.length)} CDs` },
      { page: 'muni-explorer', label: 'Munis', title: 'Muni Explorer', detail: 'Browse municipal offerings by issuer, state, rating, yield, and call status.', metric: `${formatNumber(munis.length)} munis` },
      { page: 'agencies', label: 'Agencies', title: 'Agency Explorer', detail: 'Review bullet and callable agencies with commission-adjusted context.', metric: `${formatNumber(agencies.length)} offerings` },
      { page: 'corporates', label: 'Corporates', title: 'Corporate Explorer', detail: 'Filter corporate inventory by issuer, ticker, sector, yield, and rating.', metric: `${formatNumber(corporates.length)} bonds` }
    ];

    target.innerHTML = cards.map(card => `
      <button type="button" class="home-launch-card" data-goto="${escapeHtml(card.page)}">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <em>${escapeHtml(card.detail)}</em>
        <b>${escapeHtml(card.metric)}</b>
      </button>
    `).join('');
  }

  async function fetchOptionalJson(path) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn(`Unable to load ${path}:`, e);
      return null;
    }
  }

  async function loadQualitySummary() {
    const [cds, munis, agencies, corporates] = await Promise.all([
      fetchOptionalJson('/api/offerings'),
      fetchOptionalJson('/api/muni-offerings'),
      fetchOptionalJson('/api/agencies'),
      fetchOptionalJson('/api/corporates')
    ]);

    const datasets = [cds, munis, agencies, corporates].filter(Boolean);
    marketData = {
      cds: Array.isArray(cds && cds.offerings) ? cds.offerings : [],
      munis: Array.isArray(munis && munis.offerings) ? munis.offerings : [],
      agencies: Array.isArray(agencies && agencies.offerings) ? agencies.offerings : [],
      corporates: Array.isArray(corporates && corporates.offerings) ? corporates.offerings : []
    };
    const warnings = datasets.reduce((sum, data) => (
      sum + (Array.isArray(data.warnings) ? data.warnings.length : 0)
    ), 0);

    const pkg = currentPackage || {};
    const packageDates = [
      pkg.date,
      cds && cds.asOfDate,
      munis && munis.asOfDate,
      agencies && agencies.fileDate,
      corporates && corporates.fileDate
    ].filter(Boolean);
    const uniqueDates = [...new Set(packageDates)];

    const countParts = [
      pkg.offeringsCount != null ? `${formatNumber(pkg.offeringsCount)} CDs` : null,
      pkg.muniOfferingsCount != null ? `${formatNumber(pkg.muniOfferingsCount)} munis` : null,
      pkg.agencyCount != null ? `${formatNumber(pkg.agencyCount)} agencies` : null,
      pkg.corporatesCount != null ? `${formatNumber(pkg.corporatesCount)} corporates` : null
    ].filter(Boolean);

    qualitySummary = {
      warnings,
      datesMatch: packageDates.length ? uniqueDates.length <= 1 : null,
      countsText: countParts.length ? countParts.join(' · ') : '—'
    };
  }

  function renderQualityStatus(filled) {
    const fileText = `${filled} / ${TOTAL_SLOTS}`;
    const dateText = qualitySummary.datesMatch == null
      ? '—'
      : (qualitySummary.datesMatch ? 'Dates match' : 'Check dates');
    const warningsText = qualitySummary.warnings
      ? `${qualitySummary.warnings} warning${qualitySummary.warnings === 1 ? '' : 's'}`
      : 'No warnings';

    setText('uploadQualityFiles', fileText);
    setText('uploadQualityDates', dateText);
    setText('uploadQualityCounts', qualitySummary.countsText);
    setText('uploadQualityWarnings', warningsText);

    ['uploadQualityDates'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('warn', qualitySummary.datesMatch === false);
      el.classList.toggle('ok', qualitySummary.datesMatch === true);
    });
    ['uploadQualityWarnings'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('warn', qualitySummary.warnings > 0);
      el.classList.toggle('ok', qualitySummary.warnings === 0);
    });
  }

  /**
   * Client-side filename classifier — mirrors the server logic so we can warn
   * the user if they drop a file into what looks like the wrong slot.
   */
  function classifyFile(filename) {
    if (!filename) return null;
    const lower = filename.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'dashboard';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
      if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
      if (lower.includes('bullet')) return 'agenciesBullets';
      return 'agenciesBullets';  // ambiguous → default; user can drop into the right slot
    }
    if (lower.endsWith('.pdf')) {
      const isMuni =
        (lower.includes('fbbs_offering') || lower.includes('fbbs offering') ||
         lower.includes('muni_offering')  || lower.includes('muni offering')  ||
         lower.includes('municipal_offering') || lower.includes('municipal offering'))
        && !lower.includes('cd_offer') && !lower.includes('cdoffer') && !lower.includes('cd offer');
      if (isMuni) return 'munioffers';
      if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
          lower.includes('daily_cd') || lower.includes('daily cd') ||
          lower.includes('cd offering') || lower.includes('cd_offering')) return 'cdoffers';
      if (lower.includes('cd_rate') || lower.includes('brokered_cd') ||
          lower.includes('brokered cd') || lower.includes('rate_sheet') ||
          lower.includes('rate sheet')) return 'cd';
      return 'econ';
    }
    return null;
  }

  // ============ Navigation ============

  function goTo(pageName, { updateHash = true } = {}) {
    if (!VALID_PAGES.includes(pageName)) pageName = 'home';

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.nav-link[aria-current="page"]').forEach(n => n.removeAttribute('aria-current'));

    const page = document.getElementById('p-' + pageName);
    if (page) page.classList.add('active');

    const link = document.querySelector('.nav-link[data-page="' + pageName + '"]');
    if (link) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    updateMarketNavGroup(pageName);

    window.scrollTo({ top: 0, behavior: 'auto' });
    closeNavSearch();

    if (updateHash && window.location.hash !== '#' + pageName) {
      history.replaceState(null, '', '#' + pageName);
    }

    if (pageName === 'archive') loadArchive();
    if (pageName === 'cd-recap') loadCdRecap();
    if (pageName === 'explorer') loadOfferings();
    if (pageName === 'muni-explorer') loadMuniOfferings();
    if (pageName === 'agencies') loadAgencies();
    if (pageName === 'corporates') loadCorporates();
    if (pageName === 'banks') {
      loadBankStatus();
      loadSavedBanks();
    }
    if (pageName === 'strategies') loadStrategies();
    if (pageName === 'upload') loadBankStatus();
    if (pageName === 'admin') loadAuditLog();
  }

  // Expose for inline handlers that still use it (belt + braces)
  window.goTo = goTo;

  // Wire up nav + any data-goto buttons via event delegation
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-page], [data-goto]');
    if (!target) return;
    // Don't intercept external links or the CTA
    if (target.classList.contains('nav-cta')) return;
    if (target.getAttribute('target') === '_blank') return;

    const dest = target.dataset.page || target.dataset.goto;
    if (dest && VALID_PAGES.includes(dest)) {
      e.preventDefault();
      goTo(dest);
    }
  });

  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '#home').slice(1);
    goTo(h, { updateHash: false });
  });

  function updateMarketNavGroup(pageName) {
    document.querySelectorAll('.nav-group.active-group').forEach(group => {
      group.classList.remove('active-group');
    });
    const groupName = NAV_GROUP_BY_PAGE[pageName];
    if (!groupName) return;
    const group = document.querySelector(`.nav-group[data-nav-group="${groupName}"]`);
    if (!group) return;
    group.classList.add('active-group', 'open');
    const toggle = group.querySelector('.nav-parent');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function setupMarketNav() {
    document.querySelectorAll('[data-nav-toggle]').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.nav-group');
        if (!group) return;
        const isOpen = group.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
      });
    });
  }

  function setupNavSearch() {
    const input = document.getElementById('navSearchInput');
    const results = document.getElementById('navSearchResults');
    if (!input || !results) return;

    const render = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) {
        results.classList.remove('show');
        results.innerHTML = '';
        return;
      }
      const terms = query.split(/\s+/).filter(Boolean);
      const matches = NAV_ITEMS.filter(item => {
        const haystack = `${item.group} ${item.label} ${item.description} ${item.aliases}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
      }).slice(0, 7);

      results.classList.add('show');
      results.innerHTML = matches.length ? matches.map(item => `
        <button type="button" class="jump-result" data-goto="${item.page}">
          <span>${escapeHtml(item.group)}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <em>${escapeHtml(item.description)}</em>
        </button>
      `).join('') : '<div class="jump-empty">No matching pages found</div>';
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeNavSearch();
        input.blur();
      }
      if (e.key === 'Enter') {
        const first = results.querySelector('[data-goto]');
        if (first) {
          e.preventDefault();
          goTo(first.dataset.goto);
        }
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.portal-jump')) closeNavSearch();
    });
  }

  function closeNavSearch() {
    const input = document.getElementById('navSearchInput');
    const results = document.getElementById('navSearchResults');
    if (input) input.value = '';
    if (results) {
      results.classList.remove('show');
      results.innerHTML = '';
    }
  }

  // ============ Initial load ============

  function setHeaderDate() {
    const now = new Date();
    const heroDate = document.getElementById('heroDate');
    if (heroDate) {
      heroDate.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }
    const uploadDate = document.getElementById('uploadDate');
    if (uploadDate) {
      uploadDate.textContent = 'Target: ' + now.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
      });
    }
  }

  async function loadCurrent() {
    try {
      const res = await fetch('/api/current', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      currentPackage = await res.json();
    } catch (e) {
      console.error('Failed to load current package:', e);
      currentPackage = {};
    }
    await loadQualitySummary();
    renderHome();
    renderViewer('dashboard');
    renderViewer('econ');
    renderViewer('cd');
    renderViewer('cdoffers');
    renderViewer('munioffers');
    await loadEconomicUpdate();
    renderCdCostCalculator();
  }

  async function loadArchive() {
    try {
      const res = await fetch('/api/archive', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      archiveData = await res.json();
    } catch (e) {
      console.error('Failed to load archive:', e);
      archiveData = [];
    }
    renderArchive();
  }

  // ============ Home ============

  function renderHome() {
    const grid = document.getElementById('homeDocsGrid');
    const pkg = currentPackage || {};
    let filled = 0;
    grid.innerHTML = '';

    SLOTS.forEach((slot, i) => {
      const file = pkg[slot];
      const meta = DOC_TYPES[slot];
      if (file) filled++;

      const card = document.createElement('div');
      card.className = 'doc-card' + (file ? '' : ' empty');

      const viewBtn = file
        ? `<button class="doc-btn" data-goto="${meta.viewer}">View</button>`
        : `<button class="doc-btn" disabled>View</button>`;
      const downloadBtn = file
        ? `<a class="doc-btn outline" href="/current/${encodeURIComponent(file)}?download=1">Download</a>`
        : `<button class="doc-btn outline" disabled>Download</button>`;

      let extraMeta = '';
      if (slot === 'cdoffers' && pkg.offeringsCount) {
        extraMeta = ` &middot; <strong>${pkg.offeringsCount} CDs extracted</strong>`;
      } else if (slot === 'munioffers' && pkg.muniOfferingsCount) {
        extraMeta = ` &middot; <strong>${pkg.muniOfferingsCount} munis extracted</strong>`;
      } else if ((slot === 'agenciesBullets' || slot === 'agenciesCallables') && pkg.agencyCount) {
        const fdate = pkg.agencyFileDate
          ? ` &middot; file dated ${formatShortDate(pkg.agencyFileDate)}`
          : '';
        extraMeta = ` &middot; <strong>${pkg.agencyCount} agencies total</strong>${fdate}`;
      } else if (slot === 'corporates' && pkg.corporatesCount) {
        const fdate = pkg.corporatesFileDate
          ? ` &middot; file dated ${formatShortDate(pkg.corporatesFileDate)}`
          : '';
        extraMeta = ` &middot; <strong>${pkg.corporatesCount} corporates extracted</strong>${fdate}`;
      }

      card.innerHTML = `
        <div class="doc-card-body">
          <div>
            <div class="doc-icon"><span class="doc-ext">${meta.ext}</span></div>
            <div class="doc-title">${meta.label}</div>
            <div class="doc-filename">${file ? escapeHtml(file) : '— not yet uploaded —'}</div>
          </div>
          <div>
            <div class="doc-meta">
              ${file ? 'Uploaded &middot; <strong>Ready to view</strong>' + extraMeta : 'Awaiting upload'}
            </div>
            <div class="doc-actions">
              ${viewBtn}
              ${downloadBtn}
            </div>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    const subtitle = document.getElementById('homeSubtitle');
    const kicker = document.getElementById('homeKicker');
    const packageStat = document.getElementById('homePackageStat');
    if (packageStat) packageStat.textContent = `${filled}/${TOTAL_SLOTS}`;

    if (filled === 0) {
      subtitle.textContent = 'No documents published yet — go to Upload to publish today\'s package';
      kicker.textContent = 'Not published';
    } else if (filled === TOTAL_SLOTS) {
      subtitle.textContent = `Complete package published${pkg.publishedAt ? ' at ' + formatTime(pkg.publishedAt) : ''}`;
      kicker.textContent = `${formatShortDate(pkg.date)} · Published ${formatTime(pkg.publishedAt)}`;
    } else {
      subtitle.textContent = `Partial package — ${filled} of ${TOTAL_SLOTS} documents published`;
      kicker.textContent = `${formatShortDate(pkg.date)} · Partial`;
    }

    renderQualityStatus(filled);
    renderHomeStatusTiles(filled);
    renderHomeWorkList(filled);
    renderHomeLaunchGrid();
    renderHomeMarketTiles();
    renderGlobalSearch();
  }

  function normalizeSearchText(parts) {
    const values = [];
    const add = value => {
      if (value == null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      if (typeof value === 'object') {
        Object.values(value).forEach(add);
        return;
      }
      const raw = String(value).trim().toLowerCase();
      if (!raw) return;
      const spaced = raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      values.push(raw);
      if (spaced && spaced !== raw) values.push(spaced);
      if (spaced && spaced.includes(' ')) values.push(spaced.replace(/\s+/g, ''));
    };
    parts.forEach(add);
    return values.join(' ');
  }

  const STATE_SEARCH_ALIASES = {
    AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
    CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district of columbia washington dc',
    FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
    IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
    ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
    MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
    NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
    NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma',
    OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
    SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
    VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin',
    WY: 'wyoming', PR: 'puerto rico', GU: 'guam', VI: 'virgin islands'
  };

  function stateSearchAliases(value) {
    const code = String(value || '').trim().toUpperCase();
    if (!code) return [];
    const name = STATE_SEARCH_ALIASES[code];
    return name ? [code, name] : [code];
  }

  function creditSearchAliases(value) {
    const tier = String(value || '').trim();
    if (!tier) return [];
    return [tier, `${tier} rated`, `${tier}-rated`, `${tier} rating`];
  }

  function searchTermsFromQuery(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  function buildSearchRows() {
    const rows = [];
    (marketData.cds || []).forEach(o => rows.push({
      type: 'CD',
      title: o.name,
      subtitle: `${formatPercentTile(o.rate, 2)} · ${o.term} · ${formatShortDate(o.maturity)}`,
      meta: o.cusip,
      page: 'explorer',
      searchText: normalizeSearchText([
        o,
        stateSearchAliases(o.issuerState),
        'cd certificate deposit brokered cd security'
      ])
    }));
    (marketData.munis || []).forEach(o => rows.push({
      type: 'Muni',
      title: o.issuerName,
      subtitle: `${o.section || 'Muni'} · ${o.issuerState || ''} · ${formatPercentTile(o.ytw, 3)}`,
      meta: o.cusip,
      page: 'muni-explorer',
      searchText: normalizeSearchText([
        o,
        stateSearchAliases(o.issuerState),
        'muni municipal bond security tax exempt taxable bq'
      ])
    }));
    (marketData.agencies || []).forEach(o => rows.push({
      type: 'Agency',
      title: `${o.ticker || 'Agency'} ${o.cusip || ''}`,
      subtitle: `${o.structure || ''} · ${formatPercentTile(o.ytm, 3)} · ${formatShortDate(o.maturity)}`,
      meta: o.callType || o.benchmark || '',
      page: 'agencies',
      searchText: normalizeSearchText([
        o,
        'agency agencies government sponsored gse bond security bullet callable'
      ])
    }));
    (marketData.corporates || []).forEach(o => rows.push({
      type: 'Corporate',
      title: o.issuerName,
      subtitle: `${o.ticker || ''} · ${o.creditTier || ''} · ${formatPercentTile(o.ytm, 3)}`,
      meta: o.cusip,
      page: 'corporates',
      searchText: normalizeSearchText([
        o,
        creditSearchAliases(o.creditTier),
        o.investmentGrade ? 'investment grade ig' : 'high yield hy',
        'corporate corp bond security'
      ])
    }));
    return rows;
  }

  function interleaveSearchMatches(matches, limit = 24) {
    const typeOrder = ['CD', 'Muni', 'Agency', 'Corporate'];
    const groups = new Map(typeOrder.map(type => [type, []]));
    matches.forEach(row => {
      if (!groups.has(row.type)) groups.set(row.type, []);
      groups.get(row.type).push(row);
    });

    const ordered = [];
    while (ordered.length < limit) {
      let added = false;
      for (const type of typeOrder) {
        const next = groups.get(type).shift();
        if (!next) continue;
        ordered.push(next);
        added = true;
        if (ordered.length >= limit) break;
      }
      if (!added) break;
    }
    return ordered;
  }

  function renderGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const results = document.getElementById('globalSearchResults');
    if (!input || !results) return;

    const terms = searchTermsFromQuery(input.value);
    if (!terms.length) {
      results.innerHTML = '<div class="global-empty">Start typing to search CDs, munis, agencies, and corporates.</div>';
      return;
    }

    const matches = interleaveSearchMatches(
      buildSearchRows().filter(row => terms.every(term => row.searchText.includes(term)))
    );

    if (!matches.length) {
      results.innerHTML = '<div class="global-empty">No matching offerings found.</div>';
      return;
    }

    results.innerHTML = matches.map(row => `
      <button class="global-result" type="button" data-goto="${row.page}">
        <span class="global-type">${escapeHtml(row.type)}</span>
        <span class="global-title">${escapeHtml(row.title || '—')}</span>
        <span class="global-subtitle">${escapeHtml(row.subtitle || '')}</span>
        <span class="global-meta">${escapeHtml(row.meta || '')}</span>
      </button>
    `).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============ Document viewers ============

  function renderViewer(slot) {
    const frame = document.getElementById(slot === 'dashboard' ? 'dashFrame' : slot + 'Frame');
    const sub = document.getElementById(slot === 'dashboard' ? 'dashSub' : slot + 'Sub');
    const btn = document.getElementById(slot === 'dashboard' ? 'dashOpenBtn' : slot + 'DownloadBtn');
    const file = currentPackage && currentPackage[slot];
    const meta = DOC_TYPES[slot];

    if (!frame || !sub || !btn) return;

    if (file) {
      const src = '/current/' + encodeURIComponent(file);
      // The Sales Dashboard is user-uploaded HTML. Sandbox it with
      // allow-scripts only (no allow-same-origin) so its JavaScript can still
      // run (Chart.js, inline handlers) but the iframe gets an opaque origin
      // and cannot read parent state or call our same-origin APIs.
      const sandboxAttr = slot === 'dashboard' ? ' sandbox="allow-scripts"' : '';
      frame.innerHTML = `<iframe src="${src}" title="${meta.label}"${sandboxAttr}></iframe>`;
      sub.textContent = `${file} · Published ${formatTime(currentPackage.publishedAt)}`;
      if (slot === 'dashboard') {
        btn.onclick = () => window.open(src, '_blank', 'noopener');
      } else {
        btn.onclick = () => { window.location.href = src + '?download=1'; };
      }
      btn.style.display = '';
    } else {
      frame.innerHTML = `
        <div class="viewer-empty">
          <div class="ff-kicker">No Document Loaded</div>
          <h2>No ${meta.label} uploaded yet</h2>
          <p>Go to the Upload page to publish today's ${meta.label}.</p>
          <button class="doc-btn" data-goto="upload">Go to Upload</button>
        </div>`;
      sub.textContent = `No ${meta.label} uploaded`;
      btn.style.display = 'none';
    }
  }

  // ============ Economic Update Tool ============

  async function loadEconomicUpdate() {
    const tool = document.getElementById('economicTool');
    if (!tool) return;
    if (!currentPackage || !currentPackage.econ) {
      economicUpdateData = null;
      renderEconomicUpdate();
      return;
    }
    try {
      const res = await fetch('/api/economic-update', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      economicUpdateData = await res.json();
    } catch (e) {
      console.error('Failed to load economic update:', e);
      economicUpdateData = null;
    }
    renderEconomicUpdate();
  }

  function formatMarketValue(row) {
    if (!row) return '—';
    const value = row.value != null ? row.value : row.priorClose;
    if (value == null || isNaN(value)) return row.status || '—';
    return row.isPercent ? formatPercentTile(value, 2) : formatNumber(value);
  }

  function formatMarketChange(value, digits = 3) {
    if (value == null || isNaN(value)) return '—';
    const sign = Number(value) > 0 ? '+' : '';
    return `${sign}${Number(value).toFixed(digits)}`;
  }

  function changeClass(value) {
    if (value == null || isNaN(value)) return '';
    return Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : 'flat';
  }

  function economicRowHtml(row) {
    return `
      <div class="market-data-row">
        <span>${escapeHtml(row.label || row.event || row.tenor || 'Item')}</span>
        <strong>${escapeHtml(row.event ? (row.dateTime || 'Watch') : formatMarketValue(row))}</strong>
        <em class="${changeClass(row.change)}">${escapeHtml(row.change != null ? formatMarketChange(row.change, row.isPercent ? 3 : 2) : row.status || '')}</em>
      </div>
    `;
  }

  function calendarDateParts(dateTime) {
    const text = String(dateTime || '').trim();
    const match = text.match(/^(\d{2}\/\d{2}\/\d{2})\s+(.+)$/);
    if (!match) return { date: 'Watch', time: text || 'Time pending' };
    return { date: match[1], time: match[2] };
  }

  function economicCalendarHtml(items) {
    if (!items.length) {
      return '<div class="market-empty small">No economic calendar items extracted.</div>';
    }
    return `
      <div class="calendar-event-list">
        ${items.map(item => {
          const parts = calendarDateParts(item.dateTime);
          return `
            <article class="calendar-event-card">
              <div class="calendar-event-time">
                <span>${escapeHtml(parts.date)}</span>
                <strong>${escapeHtml(parts.time)}</strong>
              </div>
              <div class="calendar-event-copy">
                <h4>${escapeHtml(item.event || 'Economic release')}</h4>
                <p>From the uploaded daily Economic Update calendar.</p>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderEconomicUpdate() {
    const summary = document.getElementById('econMarketSummary');
    const sub = document.getElementById('econToolSub');
    const dateBadge = document.getElementById('econToolDate');
    const curve = document.getElementById('econCurveChart');
    const slopeEl = document.getElementById('econCurveSlope');
    const cues = document.getElementById('econSalesCues');
    const cueCount = document.getElementById('econCueCount');
    if (!summary || !sub || !dateBadge || !curve || !slopeEl || !cues || !cueCount) return;

    const data = economicUpdateData;
    if (!data) {
      sub.textContent = currentPackage && currentPackage.econ
        ? 'Market data could not be extracted yet. The PDF remains available below.'
        : 'Upload the daily Economic Update PDF to activate this tool.';
      dateBadge.textContent = 'No data';
      summary.innerHTML = `
        <div class="market-empty">
          <strong>No interactive market data loaded</strong>
          <p>This section uses the uploaded daily Economic Update PDF.</p>
        </div>`;
      curve.innerHTML = '';
      slopeEl.textContent = '2s/10s —';
      cues.innerHTML = '';
      cueCount.textContent = '—';
      renderEconomicDetail();
      return;
    }

    const treasuries = data.treasuries || [];
    const marketRates = data.marketRates || [];
    const marketRows = data.marketData || [];
    const two = treasuries.find(row => row.tenor === '2YR');
    const ten = treasuries.find(row => row.tenor === '10YR');
    const sofr = marketRates.find(row => row.label === 'SOFR');
    const prime = marketRates.find(row => row.label === 'Prime Rate');
    const vix = marketRows.find(row => row.label === 'VIX');
    const crude = marketRows.find(row => row.label === 'CRUDE FUTURE');
    const spx = marketRows.find(row => row.label === 'SPX') || marketRows.find(row => row.label === 'S&P 500');

    sub.textContent = `${data.sourceFile || currentPackage.econ || 'Economic Update'} · Extracted ${formatFullTimestamp(data.extractedAt)}`;
    dateBadge.textContent = data.asOfDate ? formatShortDate(data.asOfDate) : 'Current';
    slopeEl.textContent = two && ten ? `2s/10s ${(ten.yield - two.yield).toFixed(3)}%` : '2s/10s —';

    summary.innerHTML = [
      { label: '2Y Treasury', value: two ? formatPercentTile(two.yield, 3) : '—', change: two ? formatMarketChange(two.dailyChange, 3) : '—' },
      { label: '10Y Treasury', value: ten ? formatPercentTile(ten.yield, 3) : '—', change: ten ? formatMarketChange(ten.dailyChange, 3) : '—' },
      { label: 'SOFR', value: formatMarketValue(sofr), change: sofr ? formatMarketChange(sofr.change, 3) : '—' },
      { label: 'Prime Rate', value: formatMarketValue(prime), change: prime ? formatMarketChange(prime.change, 3) : '—' },
      { label: 'SPX', value: formatMarketValue(spx), change: spx ? formatMarketChange(spx.change, 2) : '—' },
      { label: 'VIX', value: formatMarketValue(vix), change: vix ? formatMarketChange(vix.change, 2) : '—' },
      { label: 'Crude Future', value: formatMarketValue(crude), change: crude ? formatMarketChange(crude.change, 2) : '—' }
    ].map(item => `
      <div class="market-summary-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
        <em>${escapeHtml(item.change)}</em>
      </div>
    `).join('');

    renderCurveChart(treasuries);
    const cueRows = data.salesCues || [];
    cueCount.textContent = `${cueRows.length} cues`;
    cues.innerHTML = cueRows.length ? cueRows.map(cue => `
      <div class="sales-cue">
        <strong>${escapeHtml(cue.title)}</strong>
        <p>${escapeHtml(cue.body)}</p>
      </div>
    `).join('') : '<div class="market-empty small">No sales cues extracted.</div>';
    renderEconomicDetail();
  }

  function renderCurveChart(treasuries) {
    const curve = document.getElementById('econCurveChart');
    if (!curve) return;
    if (!treasuries || !treasuries.length) {
      curve.innerHTML = '<div class="market-empty small">Treasury curve unavailable.</div>';
      return;
    }
    const yields = treasuries.map(row => row.yield).filter(n => n != null && !isNaN(n));
    const min = Math.min.apply(null, yields);
    const max = Math.max.apply(null, yields);
    const range = Math.max(max - min, 0.01);
    curve.innerHTML = treasuries.map(row => {
      const height = 18 + ((row.yield - min) / range) * 72;
      return `
        <div class="curve-bar" title="${escapeHtml(row.label)} ${escapeHtml(formatPercentTile(row.yield, 3))}">
          <span style="height:${height.toFixed(1)}%"></span>
          <strong>${escapeHtml(formatPercentTile(row.yield, 2))}</strong>
          <em>${escapeHtml(row.label)}</em>
        </div>
      `;
    }).join('');
  }

  function renderEconomicDetail() {
    const detail = document.getElementById('econMarketDetail');
    if (!detail) return;
    const data = economicUpdateData;
    if (!data) {
      detail.innerHTML = '<div class="market-empty small">Choose a section after the Economic Update has been uploaded.</div>';
      return;
    }

    if (selectedMarketSection === 'risk') {
      detail.innerHTML = `<div class="market-data-list">${(data.marketData || []).map(economicRowHtml).join('')}</div>`;
      return;
    }
    if (selectedMarketSection === 'headlines') {
      const items = data.headlines || [];
      detail.innerHTML = items.length
        ? `<div class="headline-list">${items.map(item => `<p>${escapeHtml(item)}</p>`).join('')}</div>`
        : '<div class="market-empty small">No headlines extracted from the PDF.</div>';
      return;
    }
    if (selectedMarketSection === 'calendar') {
      const items = data.releases || [];
      detail.innerHTML = economicCalendarHtml(items);
      return;
    }

    const rows = [
      ...(data.marketRates || []),
      ...(data.bondIndices || [])
    ];
    detail.innerHTML = rows.length
      ? `<div class="market-data-list">${rows.map(economicRowHtml).join('')}</div>`
      : '<div class="market-empty small">No market rates extracted.</div>';
  }

  function setupEconomicMarketTool() {
    document.querySelectorAll('[data-market-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedMarketSection = btn.dataset.marketSection || 'rates';
        document.querySelectorAll('[data-market-section]').forEach(item => {
          item.classList.toggle('active', item === btn);
        });
        renderEconomicDetail();
      });
    });
  }

  // ============ Brokered CD Cost Calculator ============

  function parseMoneyInput(value) {
    const clean = String(value || '').replace(/[^0-9.]/g, '');
    const parsed = Number(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  function formatTermMonths(months) {
    const n = Number(months);
    if (!n || isNaN(n)) return 'Manual';
    if (n % 12 === 0) return `${n / 12} yr`;
    if (n < 12) return `${n} mo`;
    return `${(n / 12).toFixed(1).replace(/\.0$/, '')} yr`;
  }

  function renderCdCostCalculator() {
    const termButtons = document.getElementById('cdCalcTermButtons');
    const rateInput = document.getElementById('cdCalcRate');
    if (!termButtons || !rateInput) return;

    const terms = getBrokeredCdTerms();
    termButtons.innerHTML = terms.map(term => `
      <button type="button" class="${term.months === selectedCdCalcTerm ? 'active' : ''}" data-cd-term="${term.months}">
        <span>${escapeHtml(term.label)}</span>
        <strong>${escapeHtml(formatPercentTile(term.mid, 3))}</strong>
      </button>
    `).join('');

    const selected = terms.find(term => term.months === selectedCdCalcTerm) || terms[0];
    selectedCdCalcTerm = selected.months;
    rateInput.value = selected.mid.toFixed(3);
    calculateCdCost();
  }

  function getBrokeredCdTerms() {
    const uploadedTerms = currentPackage && Array.isArray(currentPackage.brokeredCdTerms)
      ? currentPackage.brokeredCdTerms
      : [];
    return uploadedTerms.length ? uploadedTerms : DEFAULT_BROKERED_CD_TERMS;
  }

  function calculateCdCost() {
    const amountInput = document.getElementById('cdCalcAmount');
    const rateInput = document.getElementById('cdCalcRate');
    const annualEl = document.getElementById('cdCalcAnnualCost');
    const termEl = document.getElementById('cdCalcTermCost');
    const monthlyEl = document.getElementById('cdCalcMonthlyCost');
    const metaEl = document.getElementById('cdCalcResultMeta');
    if (!amountInput || !rateInput || !annualEl || !termEl || !monthlyEl || !metaEl) return;

    const terms = getBrokeredCdTerms();
    const selected = terms.find(term => term.months === selectedCdCalcTerm) || terms[0];
    const months = selected.months;
    const amount = parseMoneyInput(amountInput.value);
    const rate = Number(rateInput.value);

    if (!amount || isNaN(rate)) {
      annualEl.textContent = '—';
      termEl.textContent = '—';
      monthlyEl.textContent = '—';
      metaEl.textContent = 'Enter an amount and rate to calculate cost.';
      return;
    }

    const annualCost = amount * (rate / 100);
    const termCost = annualCost * (months / 12);
    annualEl.textContent = formatMoney(annualCost);
    termEl.textContent = formatMoney(termCost);
    monthlyEl.textContent = formatMoney(annualCost / 12);
    metaEl.textContent = `${formatMoney(amount)} issued at ${formatPercentTile(rate, 3)} all-in mid for ${formatTermMonths(months)}`;
  }

  function setupCdCostCalculator() {
    const termButtons = document.getElementById('cdCalcTermButtons');
    const amountInput = document.getElementById('cdCalcAmount');
    const rateInput = document.getElementById('cdCalcRate');
    if (!termButtons || !amountInput || !rateInput) return;

    termButtons.addEventListener('click', e => {
      const btn = e.target.closest('[data-cd-term]');
      if (!btn) return;
      selectedCdCalcTerm = Number(btn.dataset.cdTerm);
      const selected = getBrokeredCdTerms().find(term => term.months === selectedCdCalcTerm);
      if (selected) rateInput.value = selected.mid.toFixed(3);
      termButtons.querySelectorAll('[data-cd-term]').forEach(button => {
        button.classList.toggle('active', button === btn);
      });
      calculateCdCost();
    });
    amountInput.addEventListener('input', calculateCdCost);
    amountInput.addEventListener('blur', () => {
      const amount = parseMoneyInput(amountInput.value);
      amountInput.value = amount ? formatMoney(amount) : '';
      calculateCdCost();
    });
    rateInput.addEventListener('input', calculateCdCost);

    document.querySelectorAll('[data-cd-amount]').forEach(btn => {
      btn.addEventListener('click', () => {
        amountInput.value = formatMoney(Number(btn.dataset.cdAmount || 0));
        calculateCdCost();
      });
    });
  }

  // ============ Archive ============

  function renderArchive() {
    const tbody = document.getElementById('archiveBody');
    const countEl = document.getElementById('archiveCount');

    const hasCurrent = currentPackage && SLOTS.some(s => currentPackage[s]);
    const total = archiveData.length + (hasCurrent ? 1 : 0);
    countEl.textContent = total;

    const rows = [];
    if (hasCurrent) rows.push(renderArchiveRow(currentPackage, true));
    archiveData.forEach(day => rows.push(renderArchiveRow(day, false)));

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">
        No publications yet. Upload your first package to get started.
      </td></tr>`;
    } else {
      tbody.innerHTML = rows.join('');
    }
  }

  function renderArchiveRow(day, isCurrent) {
    const date = day.date || '—';
    const basePath = isCurrent ? '/current/' : `/archive/${date}/`;

    const chip = (file, label) => {
      if (file) {
        return `<a class="file-chip" href="${basePath}${encodeURIComponent(file)}" target="_blank" rel="noopener" title="${escapeHtml(file)}">${label}</a>`;
      }
      return `<span class="file-chip missing">${label}</span>`;
    };

    const publishedText = day.publishedAt
      ? `${escapeHtml(day.publishedBy || 'Portal User')} · ${formatTime(day.publishedAt)}`
      : '—';

    const viewFirst = day.dashboard || day.econ || day.cd || day.cdoffers || day.munioffers;
    const viewLink = viewFirst ? `${basePath}${encodeURIComponent(viewFirst)}` : '#';
    const rowClass = isCurrent ? 'current-row' : '';

    return `
      <tr class="${rowClass}">
        <td class="arch-date-cell">
          ${formatShortDate(date)}${isCurrent ? ' <span class="current-badge">Current</span>' : ''}
        </td>
        <td>
          ${chip(day.dashboard, 'Dashboard.html')}
          ${chip(day.econ, 'Econ_Update.pdf')}
          ${chip(day.cd, 'CD_Rate_Sheet.pdf')}
          ${chip(day.cdoffers, 'CD_Offerings.pdf')}
          ${chip(day.munioffers, 'Muni_Offerings.pdf')}
        </td>
        <td>${publishedText}</td>
        <td style="text-align:right">
          ${viewFirst ? `<a class="small-btn" href="${viewLink}" target="_blank" rel="noopener">View</a>` : ''}
        </td>
      </tr>
    `;
  }

  // ============ Upload ============

  function setupUpload() {
    const dropZones = document.querySelectorAll('.drop-zone');

    dropZones.forEach(zone => {
      const input = zone.querySelector('input[type="file"]');
      const slot = zone.dataset.slot;

      zone.addEventListener('click', e => {
        if (e.target !== input) input.click();
      });

      input.addEventListener('change', e => {
        if (e.target.files && e.target.files[0]) {
          handleFileSelect(slot, e.target.files[0], zone);
        }
      });

      ['dragenter', 'dragover'].forEach(ev => {
        zone.addEventListener(ev, e => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach(ev => {
        zone.addEventListener(ev, e => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.remove('dragover');
        });
      });
      zone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files && files[0]) handleFileSelect(slot, files[0], zone);
      });
    });

    document.getElementById('uploadForm').addEventListener('submit', async e => {
      e.preventDefault();
      await publishPackage();
    });
  }

  function setupGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    if (!input) return;
    input.addEventListener('input', renderGlobalSearch);
  }

  // ============ Bank Tear Sheets ============

  async function loadBankStatus() {
    const sub = document.getElementById('bankTearSheetSub');
    const count = document.getElementById('bankDataCount');
    const status = document.getElementById('bankImportStatus');
    const accountStatus = document.getElementById('bankStatusImportStatus');
    try {
      const res = await fetch('/api/banks/status', { cache: 'no-store' });
      bankDataStatus = await readBankJson(res);
    } catch (e) {
      bankDataStatus = { available: false, error: e.message };
    }

    if (bankDataStatus && bankDataStatus.available) {
      const meta = bankDataStatus.metadata || {};
      if (sub) sub.textContent = `Imported ${formatNumber(bankDataStatus.bankCount || meta.bankCount)} banks · latest period ${meta.latestPeriod || '—'}`;
      if (count) count.textContent = formatNumber(bankDataStatus.bankCount || meta.bankCount);
      if (status) status.textContent = `${meta.sourceFile || 'Workbook'} imported ${formatImportedDate(meta.importedAt)} · ${formatNumber(meta.rowCount)} rows · latest ${meta.latestPeriod || '—'}`;
    } else {
      if (sub) sub.textContent = bankDataStatus.error || 'Upload the SNL call report workbook to enable bank tear sheet search.';
      if (count) count.textContent = '0';
      if (status) status.textContent = bankDataStatus.error || 'No bank workbook has been imported yet.';
    }

    const statusMeta = bankDataStatus && bankDataStatus.accountStatuses ? bankDataStatus.accountStatuses : {};
    const importMeta = statusMeta.metadata || {};
    if (accountStatus && statusMeta.available) {
      const source = importMeta.sourceFile || 'Account status workbook';
      const countText = `${formatNumber(statusMeta.statusCount || importMeta.importedCount || 0)} statuses`;
      const unmatchedText = importMeta.unmatchedCount !== undefined ? ` · ${formatNumber(importMeta.unmatchedCount)} unmatched` : '';
      accountStatus.textContent = `${source} imported ${formatImportedDate(importMeta.importedAt)} · ${countText}${unmatchedText}`;
    } else if (accountStatus) {
      accountStatus.textContent = 'Account statuses default to Open until imported or edited.';
    }
  }

  function formatImportedDate(iso) {
    if (!iso) return 'recently';
    try {
      return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return 'recently';
    }
  }

  function setupBankSearch() {
    const input = document.getElementById('bankSearchInput');
    const btn = document.getElementById('bankSearchBtn');
    const upload = document.getElementById('bankWorkbookInput');
    const statusUpload = document.getElementById('bankStatusWorkbookInput');
    const clearRecent = document.getElementById('clearRecentBanksBtn');
    const savedFilter = document.getElementById('bankSavedFilterInput');
    setupBankWorkspaceTabs();
    if (input) {
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => searchBanks(input.value), 180);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchBanks(input.value, { openFirst: true });
        } else if (e.key === 'Escape') {
          clearBankSearchResults();
        }
      });
    }
    if (btn) btn.addEventListener('click', () => searchBanks(input ? input.value : '', { openFirst: true }));
    if (upload) upload.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadBankWorkbook(file);
    });
    if (statusUpload) statusUpload.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadBankStatusWorkbook(file);
    });
    if (clearRecent) clearRecent.addEventListener('click', clearRecentBanks);
    if (savedFilter) savedFilter.addEventListener('input', renderSavedBanks);
    renderRecentBanks();
    loadSavedBanks();
  }

  function setupStrategies() {
    const search = document.getElementById('strategySearchInput');
    const type = document.getElementById('strategyTypeFilter');
    const archive = document.getElementById('strategyArchiveFilter');
    const refresh = document.getElementById('strategyRefreshBtn');
    if (search) search.addEventListener('input', renderStrategyBoard);
    if (type) type.addEventListener('change', renderStrategyBoard);
    if (archive) archive.addEventListener('change', loadStrategies);
    if (refresh) refresh.addEventListener('click', loadStrategies);
  }

  async function loadStrategies() {
    const board = document.getElementById('strategyBoard');
    const archive = document.getElementById('strategyArchiveFilter');
    const archived = archive ? archive.value : '';
    const qs = archived ? `?archived=${encodeURIComponent(archived)}` : '';
    if (board) board.innerHTML = '<div class="bank-search-empty">Loading strategy requests&hellip;</div>';
    try {
      const res = await fetch(`/api/strategies${qs}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      strategyRequests = Array.isArray(data.requests) ? data.requests : [];
      strategyCounts = data.counts || {};
      renderStrategyBoard();
    } catch (e) {
      strategyRequests = [];
      strategyCounts = {};
      renderStrategyBoard(e.message);
    }
  }

  function filteredStrategies() {
    const search = document.getElementById('strategySearchInput');
    const type = document.getElementById('strategyTypeFilter');
    const q = String(search ? search.value : '').trim().toLowerCase();
    const typeFilter = String(type ? type.value : '').trim();
    return strategyRequests.filter(row => {
      if (typeFilter && row.requestType !== typeFilter) return false;
      if (!q) return true;
      return [
        row.displayName, row.legalName, row.city, row.state, row.certNumber,
        row.requestType, row.status, row.priority, row.requestedBy,
        row.assignedTo, row.invoiceContact, row.summary, row.comments,
        row.createdAt, row.updatedAt, row.completedAt, row.billedAt, row.archivedAt
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }

  function renderStrategyBoard(errorMessage) {
    const board = document.getElementById('strategyBoard');
    const countsEl = document.getElementById('strategyCounts');
    const openCount = document.getElementById('strategiesOpenCount');
    const sub = document.getElementById('strategiesSub');
    const archive = document.getElementById('strategyArchiveFilter');
    const archivedMode = archive ? archive.value : '';
    if (!board) return;
    if (openCount) openCount.textContent = formatNumber(archivedMode === 'only' ? (strategyCounts.Archived || 0) : (strategyCounts.Open || 0));
    if (sub) {
      const total = strategyRequests.length;
      const scope = archivedMode === 'only' ? 'archived' : archivedMode === 'all' ? 'total' : 'active';
      sub.textContent = `${formatNumber(total)} ${scope} ${total === 1 ? 'request' : 'requests'} across the Strategies workflow`;
    }
    if (countsEl) {
      countsEl.innerHTML = STRATEGY_STATUSES.map(status => `
        <span class="strategy-count-pill">
          ${escapeHtml(status)}
          <strong>${formatNumber(strategyCounts[status] || 0)}</strong>
        </span>
      `).join('') + `
        <span class="strategy-count-pill">
          Archived
          <strong>${formatNumber(strategyCounts.Archived || 0)}</strong>
        </span>
      `;
    }
    if (errorMessage) {
      board.innerHTML = `<div class="bank-search-empty">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    const rows = filteredStrategies();
    if (!strategyRequests.length) {
      board.innerHTML = archivedMode === 'only'
        ? '<div class="bank-search-empty">No archived strategy requests yet.</div>'
        : '<div class="bank-search-empty">No strategy requests yet. Open a bank tear sheet and submit the first request.</div>';
      return;
    }
    if (!rows.length) {
      board.innerHTML = '<div class="bank-search-empty">No strategy requests match those filters.</div>';
      return;
    }
    board.innerHTML = STRATEGY_STATUSES.map(status => {
      const items = rows.filter(row => row.status === status);
      return `
        <section class="strategy-column">
          <div class="strategy-column-head">
            <h3>${escapeHtml(status)}</h3>
            <span>${formatNumber(items.length)}</span>
          </div>
          <div class="strategy-column-list">
            ${items.length ? items.map(renderStrategyCard).join('') : '<div class="strategy-empty-column">Nothing here right now.</div>'}
          </div>
        </section>
      `;
    }).join('');
    board.querySelectorAll('[data-strategy-update]').forEach(btn => {
      btn.addEventListener('click', () => updateStrategyStatus(btn.dataset.strategyUpdate, btn.dataset.strategyStatus));
    });
    board.querySelectorAll('[data-strategy-archive]').forEach(btn => {
      btn.addEventListener('click', () => archiveStrategyRequest(btn.dataset.strategyArchive, btn.dataset.strategyBilling === 'true'));
    });
    board.querySelectorAll('[data-strategy-restore]').forEach(btn => {
      btn.addEventListener('click', () => restoreStrategyRequest(btn.dataset.strategyRestore));
    });
    board.querySelectorAll('[data-strategy-bank]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bankId = btn.dataset.strategyBank;
        if (!bankId) return;
        goTo('banks');
        loadBank(bankId, { collapseResults: true });
      });
    });
  }

  function renderStrategyCard(row) {
    const availableMoves = row.isArchived ? [] : STRATEGY_STATUSES.filter(status => status !== row.status);
    return `
      <article class="strategy-card">
        <div class="strategy-card-head">
          <strong>${escapeHtml(row.requestType || 'Miscellaneous')}</strong>
          <span>
            ${row.isArchived ? '<em class="strategy-archive-badge">Archived</em>' : ''}
            <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
          </span>
        </div>
        <button type="button" class="strategy-bank-link" data-strategy-bank="${escapeHtml(row.bankId || '')}">
          ${escapeHtml(row.displayName || 'Bank')}
        </button>
        <p>${escapeHtml(row.summary || 'Strategy request')}</p>
        ${row.comments ? `<div class="strategy-card-comments">${escapeHtml(row.comments).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="strategy-card-meta">
          <span>Priority ${escapeHtml(row.priority || '3')}</span>
          ${row.requestedBy ? `<span>By ${escapeHtml(row.requestedBy)}</span>` : ''}
          ${row.assignedTo ? `<span>Owner ${escapeHtml(row.assignedTo)}</span>` : ''}
          ${row.invoiceContact ? `<span>Invoice ${escapeHtml(row.invoiceContact)}</span>` : ''}
          <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : ''].filter(Boolean).join(' · '))}</span>
          <span>Updated ${escapeHtml(formatFullTimestamp(row.updatedAt))}</span>
          ${row.billedAt ? `<span>Billed ${escapeHtml(formatFullTimestamp(row.billedAt))}</span>` : ''}
          ${row.archivedAt ? `<span>Archived ${escapeHtml(formatFullTimestamp(row.archivedAt))}</span>` : ''}
        </div>
        <div class="strategy-card-actions">
          ${row.isArchived ? `
            <button type="button" class="text-btn" data-strategy-restore="${escapeHtml(row.id)}">Restore</button>
          ` : ''}
          ${availableMoves.map(status => `
            <button type="button" class="text-btn" data-strategy-update="${escapeHtml(row.id)}" data-strategy-status="${escapeHtml(status)}">
              Move to ${escapeHtml(status)}
            </button>
          `).join('')}
          ${!row.isArchived && row.status === 'Completed' ? `
            <button type="button" class="text-btn" data-strategy-archive="${escapeHtml(row.id)}">Archive</button>
          ` : ''}
          ${!row.isArchived && row.status === 'Needs Billed' ? `
            <button type="button" class="text-btn" data-strategy-archive="${escapeHtml(row.id)}" data-strategy-billing="true">Mark Billed + Archive</button>
          ` : ''}
        </div>
      </article>
    `;
  }

  function refreshStrategyCountsFromRows() {
    STRATEGY_STATUSES.forEach(nextStatus => {
      strategyCounts[nextStatus] = strategyRequests.filter(row => row.status === nextStatus).length;
    });
  }

  async function updateStrategyStatus(id, status) {
    if (!id || !status) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await readBankJson(res);
      strategyRequests = strategyRequests.map(row => row.id === data.request.id ? data.request : row);
      refreshStrategyCountsFromRows();
      renderStrategyBoard();
      showToast(`Moved request to ${status}`);
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function archiveStrategyRequest(id, markBilled) {
    if (!id) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true, markBilled: Boolean(markBilled) })
      });
      await readBankJson(res);
      await loadStrategies();
      showToast(markBilled ? 'Marked billed and archived request' : 'Archived strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function restoreStrategyRequest(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false })
      });
      await readBankJson(res);
      await loadStrategies();
      showToast('Restored strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function setupBankWorkspaceTabs() {
    document.querySelectorAll('[data-bank-view]').forEach(btn => {
      btn.addEventListener('click', () => switchBankWorkspace(btn.dataset.bankView));
    });
  }

  function switchBankWorkspace(view) {
    const next = view === 'coverage' ? 'coverage' : 'tear-sheet';
    activeBankWorkspaceView = next;
    document.querySelectorAll('[data-bank-view]').forEach(btn => {
      const active = btn.dataset.bankView === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-bank-view-panel]').forEach(panel => {
      const active = panel.dataset.bankViewPanel === next;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    if (next === 'coverage') {
      if (!activeCoverageBankId && selectedTearSheetCoverage && selectedTearSheetCoverage.bankId) {
        activeCoverageBankId = selectedTearSheetCoverage.bankId;
        selectedBankCoverage = selectedTearSheetCoverage;
      }
      loadSavedBanks();
      if (activeCoverageBankId) loadBankCoverage(activeCoverageBankId, { renderDetail: true });
      else renderCoverageDetailEmpty();
    }
  }

  async function readBankJson(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The portal server is serving the old page instead of bank data. Restart the portal, then refresh this screen.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bank data request failed');
    return data;
  }

  async function searchBanks(query, options = {}) {
    const results = document.getElementById('bankSearchResults');
    const q = String(query || '').trim();
    if (!results) return;
    if (q.length < 2) {
      results.innerHTML = '<div class="bank-search-empty">Type at least two characters to search banks.</div>';
      return;
    }
    results.innerHTML = '<div class="bank-search-empty">Searching banks&hellip;</div>';
    try {
      const res = await fetch(`/api/banks/search?q=${encodeURIComponent(q)}&limit=10`, { cache: 'no-store' });
      const data = await readBankJson(res);
      renderBankResults(data.results || []);
      if (options.openFirst && data.results && data.results[0]) loadBank(data.results[0].id, { collapseResults: true });
    } catch (e) {
      results.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderBankResults(rows) {
    const results = document.getElementById('bankSearchResults');
    if (!results) return;
    if (!rows.length) {
      results.innerHTML = '<div class="bank-search-empty">No matching banks found.</div>';
      return;
    }
    results.innerHTML = rows.map(row => `
      <button type="button" class="bank-result" data-bank-id="${escapeHtml(row.id)}">
        <strong>${escapeHtml(row.displayName || row.name || 'Bank')}</strong>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.primaryRegulator].filter(Boolean).join(' · '))}</span>
        <div class="bank-result-meta">
          <em>${escapeHtml(row.period || '')}</em>
          ${renderBankStatusChip(row)}
        </div>
      </button>
    `).join('');
    results.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => loadBank(btn.dataset.bankId, { collapseResults: true }));
    });
  }

  function clearBankSearchResults() {
    const results = document.getElementById('bankSearchResults');
    if (results) results.innerHTML = '';
  }

  function loadRecentBanks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BANK_RECENT_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(row => row && row.id).slice(0, MAX_RECENT_BANKS) : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentBanks(rows) {
    try {
      localStorage.setItem(BANK_RECENT_STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RECENT_BANKS)));
    } catch (e) {
      // Recent banks are a convenience only.
    }
  }

  function rememberRecentBank(bank) {
    if (!bank || !bank.summary || !bank.id) return;
    const s = bank.summary;
    const row = {
      id: String(bank.id),
      displayName: s.displayName || s.name || 'Bank',
      city: s.city || '',
      state: s.state || '',
      certNumber: s.certNumber || '',
      primaryRegulator: s.primaryRegulator || '',
      period: s.period || '',
      accountStatus: s.accountStatus || currentBankAccountStatus()
    };
    const next = [row, ...loadRecentBanks().filter(existing => String(existing.id) !== row.id)];
    saveRecentBanks(next);
    renderRecentBanks();
  }

  function clearRecentBanks() {
    saveRecentBanks([]);
    renderRecentBanks();
  }

  function renderRecentBanks() {
    const panel = document.getElementById('bankRecentPanel');
    const list = document.getElementById('bankRecentList');
    if (!panel || !list) return;
    const rows = loadRecentBanks();
    panel.hidden = rows.length === 0;
    if (!rows.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = rows.map(row => `
      <button type="button" class="bank-recent-item" data-bank-id="${escapeHtml(row.id)}">
        <strong>${escapeHtml(row.displayName || 'Bank')}</strong>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.primaryRegulator].filter(Boolean).join(' · '))}</span>
        <em>${escapeHtml(row.period || '')}</em>
        ${renderBankStatusChip(row)}
      </button>
    `).join('');
    list.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => loadBank(btn.dataset.bankId, { collapseResults: true }));
    });
  }

  function getSavedBankById(bankId) {
    return savedBanks.find(row => String(row.bankId) === String(bankId)) || null;
  }

  async function loadSavedBanks() {
    try {
      const res = await fetch('/api/bank-coverage', { cache: 'no-store' });
      const data = await readBankJson(res);
      savedBanks = Array.isArray(data.savedBanks) ? data.savedBanks : [];
    } catch (e) {
      savedBanks = [];
      const list = document.getElementById('bankSavedList');
      if (list) list.innerHTML = `<div class="bank-search-empty">${escapeHtml(e.message)}</div>`;
    }
    renderSavedBanks();
  }

  function renderSavedBanks() {
    const list = document.getElementById('bankSavedList');
    const count = document.getElementById('bankSavedCount');
    const filter = document.getElementById('bankSavedFilterInput');
    if (!list) return;
    if (count) count.textContent = `${formatNumber(savedBanks.length)} saved`;
    if (!savedBanks.length) {
      list.innerHTML = '<div class="bank-search-empty">Save a bank from a tear sheet to start a coverage list.</div>';
      return;
    }
    const q = String(filter ? filter.value : '').trim().toLowerCase();
    const rows = q
      ? savedBanks.filter(row => [
          row.displayName, row.legalName, row.city, row.state, row.certNumber,
          row.primaryRegulator, row.status, row.priority, row.owner, row.nextActionDate
        ].filter(Boolean).join(' ').toLowerCase().includes(q))
      : savedBanks;
    if (!rows.length) {
      list.innerHTML = '<div class="bank-search-empty">No saved banks match that filter.</div>';
      return;
    }
    list.innerHTML = rows.map(row => `
      <button type="button" class="bank-saved-item${String(row.bankId) === String(activeCoverageBankId) ? ' active' : ''}" data-bank-id="${escapeHtml(row.bankId)}">
        <strong>${escapeHtml(row.displayName || 'Bank')}</strong>
        <span>${escapeHtml([row.city, row.state, row.certNumber ? `Cert ${row.certNumber}` : '', row.primaryRegulator].filter(Boolean).join(' · '))}</span>
        <div class="bank-saved-meta">
          <em class="bank-pill ${coverageClass(row.status)}">${escapeHtml(row.status || 'Open')}</em>
          <em class="bank-pill ${coverageClass(row.priority)}">${escapeHtml(row.priority || 'Medium')}</em>
          <small>${escapeHtml(row.nextActionDate ? formatShortDate(row.nextActionDate) : 'No date')}</small>
        </div>
      </button>
    `).join('');
    list.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => openSavedBankCoverage(btn.dataset.bankId));
    });
  }

  function renderCoverageDetailEmpty() {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="bank-empty-state">
        <div class="ff-kicker">Coverage Details</div>
        <h2>Select a saved bank</h2>
        <p>Coverage status, next actions, and notes will live here.</p>
      </div>
    `;
  }

  function renderCoverageDetailLoading(row) {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="bank-empty-state">
        <div class="ff-kicker">Coverage Details</div>
        <h2>${escapeHtml(row && row.displayName ? row.displayName : 'Loading coverage...')}</h2>
        <p>Loading notes and saved coverage details.</p>
      </div>
    `;
  }

  async function openSavedBankCoverage(bankId) {
    activeCoverageBankId = String(bankId || '');
    selectedBankCoverage = getSavedBankById(activeCoverageBankId);
    selectedBankNotes = [];
    switchBankWorkspace('coverage');
    renderCoverageDetailLoading(selectedBankCoverage);
    await loadBankCoverage(activeCoverageBankId, { renderDetail: true });
  }

  function coverageClass(value) {
    return `bank-pill-${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  function defaultBankAccountStatus() {
    return { status: 'Open', source: 'default', isStored: false };
  }

  function currentBankAccountStatus() {
    const saved = selectedTearSheetCoverage && selectedTearSheetCoverage.status ? selectedTearSheetCoverage : null;
    const status = saved || selectedBankAccountStatus || (selectedBank && selectedBank.bank && selectedBank.bank.summary && selectedBank.bank.summary.accountStatus) || defaultBankAccountStatus();
    return {
      ...defaultBankAccountStatus(),
      ...status,
      status: status.status || 'Open'
    };
  }

  function statusForBankRow(row) {
    if (!row) return defaultBankAccountStatus();
    const saved = getSavedBankById(row.id || row.bankId);
    const status = saved || row.accountStatus || defaultBankAccountStatus();
    return {
      ...defaultBankAccountStatus(),
      ...status,
      status: status.status || 'Open'
    };
  }

  function renderBankStatusChip(row) {
    const status = statusForBankRow(row);
    return `<em class="bank-pill ${coverageClass(status.status)}">${escapeHtml(status.status || 'Open')}</em>`;
  }

  function renderTearSheetCoverageSignal() {
    const saved = selectedTearSheetCoverage;
    const selectedStatus = document.getElementById('bankTearSheetStatus')?.value;
    const status = { ...currentBankAccountStatus(), status: selectedStatus || currentBankAccountStatus().status || 'Open' };
    const sub = [
      saved && saved.priority ? `${saved.priority} priority` : '',
      status.owner ? `Owner: ${status.owner}` : '',
      saved && saved.nextActionDate ? `Next: ${formatShortDate(saved.nextActionDate)}` : '',
      status.services ? `Services: ${status.services}` : ''
    ].filter(Boolean).join(' · ');
    return `
      <div class="bank-coverage-signal-inner">
        <em class="bank-pill ${coverageClass(status.status)}">${escapeHtml(status.status || 'Open')}</em>
        ${sub ? `<span>${escapeHtml(sub)}</span>` : ''}
      </div>
    `;
  }

  function updateTearSheetCoverageSignal() {
    const el = document.getElementById('bankProfileCoverageSignal');
    if (el) el.innerHTML = renderTearSheetCoverageSignal();
  }

  function coverageSelectOptions(values, selected) {
    return values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
  }

  function selectedBankId() {
    return selectedBank && selectedBank.bank ? selectedBank.bank.id : null;
  }

  async function loadBank(id, options = {}) {
    if (options.collapseResults) clearBankSearchResults();
    const profile = document.getElementById('bankProfile');
    if (profile) profile.innerHTML = '<div class="bank-empty-state"><h2>Loading bank tear sheet&hellip;</h2></div>';
    try {
      const res = await fetch(`/api/banks/${encodeURIComponent(id)}`, { cache: 'no-store' });
      selectedBank = await readBankJson(res);
      selectedBankAccountStatus = (selectedBank.bank && selectedBank.bank.summary && selectedBank.bank.summary.accountStatus) || defaultBankAccountStatus();
      selectedTearSheetCoverage = getSavedBankById(selectedBank.bank.id);
      selectedBankNotes = [];
      renderBankProfile();
      rememberRecentBank(selectedBank.bank);
      loadTearSheetCoverage(selectedBank.bank.id);
    } catch (e) {
      if (profile) profile.innerHTML = `<div class="bank-empty-state"><h2>${escapeHtml(e.message)}</h2></div>`;
    }
  }

  function uploadBankWorkbook(file) {
    const status = document.getElementById('bankImportStatus');
    const input = document.getElementById('bankWorkbookInput');
    const formData = new FormData();
    formData.append('bankWorkbook', file, file.name);
    if (status) status.textContent = `Importing ${file.name}... this can take a minute.`;
    fetch('/api/banks/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        showToast(`Imported ${formatNumber(data.metadata.bankCount)} banks · latest ${data.metadata.latestPeriod || '—'}`);
        return loadBankStatus();
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (input) input.value = '';
      });
  }

  function uploadBankStatusWorkbook(file) {
    const status = document.getElementById('bankStatusImportStatus');
    const input = document.getElementById('bankStatusWorkbookInput');
    const formData = new FormData();
    formData.append('bankStatusWorkbook', file, file.name);
    if (status) status.textContent = `Importing statuses from ${file.name}...`;
    fetch('/api/bank-account-statuses/upload', { method: 'POST', body: formData })
      .then(async res => {
        const data = await readBankJson(res);
        const meta = data.metadata || {};
        showToast(`Imported ${formatNumber(meta.importedCount || 0)} bank statuses`);
        if (status) {
          status.textContent = `Imported ${formatNumber(meta.importedCount || 0)} statuses · ${formatNumber(meta.unmatchedCount || 0)} unmatched · ${meta.sheetName || 'workbook'}`;
        }
        return Promise.all([
          loadBankStatus(),
          loadSavedBanks(),
          selectedBankId() ? loadBank(selectedBankId(), { collapseResults: false }) : Promise.resolve()
        ]);
      })
      .catch(err => {
        showToast(err.message, true);
        if (status) status.textContent = err.message;
      })
      .finally(() => {
        if (input) input.value = '';
      });
  }

  function renderBankProfile() {
    const profile = document.getElementById('bankProfile');
    if (!profile || !selectedBank || !selectedBank.bank) return;
    const bank = selectedBank.bank;
    const meta = selectedBank.metadata || {};
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : { values: {} };
    const values = latest.values || {};
    const fields = meta.fields || [];
    const recentPeriods = (bank.periods || []).slice(0, 8);
    const details = [
      ['Account Name', values.name || bank.summary.name],
      ['Parent Account', values.parentName],
      ['Phone', values.phone],
      ['Website', values.website],
      ['City', values.city],
      ['State', values.state],
      ['Address 1 County', values.county],
      ['Fiduciary Assets ($000)', formatBankValue(values.fiduciaryAssets, 'money')],
      ['Cert Number', values.certNumber],
      ['Primary Regulator', values.primaryRegulator],
      ['FTEs', formatBankValue(values.fullTimeEmployees, 'number')],
      ['Subchapter S Election?', values.subchapterS],
      ['Number of Offices', formatBankValue(values.numberOfOffices, 'number')],
      ['SNL Institution Key', values.id]
    ];

    profile.innerHTML = `
      <div class="bank-profile-head">
        <div>
          <span class="tool-eyebrow">Call Report Tear Sheet</span>
          <h3>${escapeHtml(values.name || bank.summary.displayName || 'Bank')}</h3>
          <p>${escapeHtml([values.city, values.state, values.certNumber ? `Cert ${values.certNumber}` : '', values.primaryRegulator].filter(Boolean).join(' · '))}</p>
          <div class="bank-coverage-signal" id="bankProfileCoverageSignal">${renderTearSheetCoverageSignal()}</div>
        </div>
        <div class="bank-profile-tools">
          <div class="bank-profile-actions">
            <select id="bankTearSheetStatus" class="bank-action-select" aria-label="Bank account status">${coverageSelectOptions(BANK_COVERAGE_STATUSES, currentBankAccountStatus().status || 'Open')}</select>
            <button type="button" class="small-btn bank-action-btn" id="bankStatusSaveBtn">Save Status</button>
            <button type="button" class="small-btn bank-action-btn" id="bankSaveBtn">Save Bank</button>
            <button type="button" class="small-btn bank-action-btn" id="bankStrategyToggleBtn">Strategy Request</button>
            <button type="button" class="small-btn bank-action-btn" id="bankPrintBtn">Print</button>
            <button type="button" class="small-btn bank-action-btn" id="bankExportBtn">Export CSV</button>
          </div>
          <div class="bank-period-badge">
            <strong>${escapeHtml(latest.endDate || latest.period || '—')}</strong>
            <span>${escapeHtml(meta.latestPeriod || latest.period || '')}</span>
          </div>
        </div>
      </div>
      ${renderBankStrategyRequestPanel()}
      ${renderBankSection('Details', details, true)}
      ${renderBankFieldSection('Balance Sheet', fields, values, 'balanceSheet')}
      ${renderBankFieldSection('Securities (AFS-FV)', fields, values, 'securitiesAfs', 'afsTotal')}
      ${renderBankFieldSection('Securities (HTM-FV)', fields, values, 'securitiesHtm', 'htmTotal')}
      ${renderBankFieldSection('Loans', fields, values, 'loans')}
      ${renderBankFieldSection('Capital', fields, values, 'capital')}
      ${renderBankFieldSection('Profitability', fields, values, 'profitability')}
      ${renderBankFieldSection('Asset Quality', fields, values, 'assetQuality')}
      ${renderBankFieldSection('Liquidity', fields, values, 'liquidity')}
      ${renderBankTrendTable(fields, recentPeriods)}
    `;
    updateBankSaveButton();
    const saveBtn = document.getElementById('bankSaveBtn');
    const statusSaveBtn = document.getElementById('bankStatusSaveBtn');
    const strategyToggleBtn = document.getElementById('bankStrategyToggleBtn');
    const statusSelect = document.getElementById('bankTearSheetStatus');
    const strategySubmitBtn = document.getElementById('bankStrategySubmitBtn');
    const strategyCancelBtn = document.getElementById('bankStrategyCancelBtn');
    const printBtn = document.getElementById('bankPrintBtn');
    const exportBtn = document.getElementById('bankExportBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveCurrentBankCoverage);
    if (statusSaveBtn) statusSaveBtn.addEventListener('click', saveCurrentBankAccountStatus);
    if (strategyToggleBtn) strategyToggleBtn.addEventListener('click', toggleBankStrategyRequestPanel);
    if (strategySubmitBtn) strategySubmitBtn.addEventListener('click', submitCurrentBankStrategyRequest);
    if (strategyCancelBtn) strategyCancelBtn.addEventListener('click', hideBankStrategyRequestPanel);
    if (statusSelect) statusSelect.addEventListener('change', updateTearSheetCoverageSignal);
    if (printBtn) printBtn.addEventListener('click', printBankProfile);
    if (exportBtn) exportBtn.addEventListener('click', exportBankProfileCsv);
  }

  function renderBankStrategyRequestPanel() {
    const currentStatus = currentBankAccountStatus().status || 'Open';
    return `
      <section class="bank-section bank-strategy-request" id="bankStrategyRequestPanel" hidden>
        <div class="bank-section-title">New Strategy Request</div>
        <div class="strategy-request-grid">
          <label>
            <span>Request Type</span>
            <select id="bankStrategyType">${coverageSelectOptions(STRATEGY_TYPES, 'Muni BCIS')}</select>
          </label>
          <label>
            <span>Priority</span>
            <select id="bankStrategyPriority">${coverageSelectOptions(STRATEGY_PRIORITIES, '3')}</select>
          </label>
          <label>
            <span>Requested By</span>
            <input type="text" id="bankStrategyRequestedBy" placeholder="Name">
          </label>
          <label>
            <span>Assigned To</span>
            <input type="text" id="bankStrategyAssignedTo" value="Strategies" placeholder="Owner">
          </label>
          <label>
            <span>Invoice Contact</span>
            <input type="text" id="bankStrategyInvoiceContact" placeholder="Person to address invoice">
          </label>
          <label>
            <span>Bank Status</span>
            <input type="text" value="${escapeHtml(currentStatus)}" disabled>
          </label>
          <label class="wide">
            <span>Summary</span>
            <input type="text" id="bankStrategySummary" placeholder="Brief request title">
          </label>
          <label class="wide">
            <span>Comments</span>
            <textarea id="bankStrategyComments" rows="4" placeholder="Portfolio notes, timing, deliverables, billing notes, or context from the banker"></textarea>
          </label>
        </div>
        <div class="bank-coverage-actions">
          <button type="button" class="small-btn" id="bankStrategySubmitBtn">Submit Request</button>
          <button type="button" class="text-btn" id="bankStrategyCancelBtn">Cancel</button>
          <span class="bank-coverage-status">Requests land in the Strategies Queue.</span>
        </div>
      </section>
    `;
  }

  function toggleBankStrategyRequestPanel() {
    const panel = document.getElementById('bankStrategyRequestPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const summary = document.getElementById('bankStrategySummary');
      if (summary) summary.focus();
    }
  }

  function hideBankStrategyRequestPanel() {
    const panel = document.getElementById('bankStrategyRequestPanel');
    if (panel) panel.hidden = true;
  }

  async function submitCurrentBankStrategyRequest() {
    const bankId = selectedBankId();
    if (!bankId) return showToast('No bank selected', true);
    const requestType = document.getElementById('bankStrategyType')?.value || 'Miscellaneous';
    const summaryEl = document.getElementById('bankStrategySummary');
    const summary = summaryEl ? summaryEl.value.trim() : '';
    const payload = {
      bankId,
      requestType,
      priority: document.getElementById('bankStrategyPriority')?.value || '3',
      requestedBy: document.getElementById('bankStrategyRequestedBy')?.value || '',
      assignedTo: document.getElementById('bankStrategyAssignedTo')?.value || '',
      invoiceContact: document.getElementById('bankStrategyInvoiceContact')?.value || '',
      summary: summary || requestType,
      comments: document.getElementById('bankStrategyComments')?.value || ''
    };
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readBankJson(res);
      if (data.request) {
        strategyRequests = [data.request, ...strategyRequests.filter(row => row.id !== data.request.id)];
        STRATEGY_STATUSES.forEach(status => {
          strategyCounts[status] = strategyRequests.filter(row => row.status === status).length;
        });
      }
      resetBankStrategyRequestForm();
      hideBankStrategyRequestPanel();
      renderStrategyBoard();
      showToast('Submitted strategy request');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function resetBankStrategyRequestForm() {
    const fields = [
      'bankStrategyRequestedBy',
      'bankStrategyInvoiceContact',
      'bankStrategySummary',
      'bankStrategyComments'
    ];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const assigned = document.getElementById('bankStrategyAssignedTo');
    const type = document.getElementById('bankStrategyType');
    const priority = document.getElementById('bankStrategyPriority');
    if (assigned) assigned.value = 'Strategies';
    if (type) type.value = 'Muni BCIS';
    if (priority) priority.value = '3';
  }

  function renderBankCoverageSection() {
    const saved = selectedBankCoverage || {};
    const status = saved.status || selectedBankAccountStatus?.status || 'Open';
    const priority = saved.priority || 'Medium';
    return `
      <div class="bank-coverage-detail-head">
        <div>
          <span class="tool-eyebrow">Coverage Workspace</span>
          <h3>${escapeHtml(saved.displayName || 'Saved Bank')}</h3>
          <p>${escapeHtml([saved.city, saved.state, saved.certNumber ? `Cert ${saved.certNumber}` : '', saved.primaryRegulator].filter(Boolean).join(' · '))}</p>
        </div>
        <button type="button" class="small-btn" id="bankCoverageOpenTearSheetBtn">Open Tear Sheet</button>
      </div>
      <section class="bank-section bank-coverage-section">
        <div class="bank-section-title">Coverage Details & Notes</div>
        <div class="bank-coverage-grid">
          <label>
            <span>Status</span>
            <select id="bankCoverageStatus">${coverageSelectOptions(BANK_COVERAGE_STATUSES, status)}</select>
          </label>
          <label>
            <span>Priority</span>
            <select id="bankCoveragePriority">${coverageSelectOptions(BANK_COVERAGE_PRIORITIES, priority)}</select>
          </label>
          <label>
            <span>Owner</span>
            <input type="text" id="bankCoverageOwner" value="${escapeHtml(saved.owner || '')}" placeholder="Coverage owner">
          </label>
          <label>
            <span>Next Action</span>
            <input type="date" id="bankCoverageNextAction" value="${escapeHtml(saved.nextActionDate || '')}">
          </label>
        </div>
        <div class="bank-coverage-actions">
          <button type="button" class="small-btn" id="bankCoverageSaveBtn">Save Coverage</button>
          <button type="button" class="text-btn danger" id="bankCoverageRemoveBtn"${saved.bankId ? '' : ' hidden'}>Remove Saved Bank</button>
          <span class="bank-coverage-status" id="bankCoverageStatusText">${saved.bankId ? `Saved ${escapeHtml(formatFullTimestamp(saved.updatedAt))}` : 'Not saved yet'}</span>
        </div>
        <div class="bank-note-composer">
          <textarea id="bankNoteText" rows="3" placeholder="Add meeting notes, CD appetite, liquidity needs, objections, or follow-up items"></textarea>
          <button type="button" class="small-btn" id="bankNoteAddBtn">Add Note</button>
        </div>
        <div class="bank-notes-list" id="bankNotesList">
          <div class="bank-search-empty">Loading notes...</div>
        </div>
      </section>
    `;
  }

  function renderCoverageDetail() {
    const detail = document.getElementById('bankCoverageDetail');
    if (!detail) return;
    if (!selectedBankCoverage || !selectedBankCoverage.bankId) {
      renderCoverageDetailEmpty();
      return;
    }
    detail.innerHTML = renderBankCoverageSection();
    wireBankCoverageControls();
    renderBankNotes();
    updateCoveragePanel();
  }

  function wireBankCoverageControls() {
    const saveCoverageBtn = document.getElementById('bankCoverageSaveBtn');
    const removeCoverageBtn = document.getElementById('bankCoverageRemoveBtn');
    const addNoteBtn = document.getElementById('bankNoteAddBtn');
    const openTearSheetBtn = document.getElementById('bankCoverageOpenTearSheetBtn');
    if (saveCoverageBtn) saveCoverageBtn.addEventListener('click', saveCurrentBankCoverage);
    if (removeCoverageBtn) removeCoverageBtn.addEventListener('click', removeCurrentBankCoverage);
    if (addNoteBtn) addNoteBtn.addEventListener('click', addCurrentBankNote);
    if (openTearSheetBtn) openTearSheetBtn.addEventListener('click', () => {
      if (!activeCoverageBankId) return;
      switchBankWorkspace('tear-sheet');
      loadBank(activeCoverageBankId, { collapseResults: true });
    });
  }

  function bankCoverageFormValues() {
    const isCoverageWorkspace = activeBankWorkspaceView === 'coverage';
    const tearSheetSaved = selectedTearSheetCoverage || getSavedBankById(selectedBankId()) || {};
    const tearSheetStatus = document.getElementById('bankTearSheetStatus')?.value || currentBankAccountStatus().status || 'Open';
    return {
      bankId: isCoverageWorkspace ? activeCoverageBankId : selectedBankId(),
      status: isCoverageWorkspace ? (document.getElementById('bankCoverageStatus')?.value || 'Open') : tearSheetStatus,
      priority: isCoverageWorkspace ? (document.getElementById('bankCoveragePriority')?.value || 'Medium') : (tearSheetSaved.priority || 'Medium'),
      owner: isCoverageWorkspace ? (document.getElementById('bankCoverageOwner')?.value || '') : (tearSheetSaved.owner || ''),
      nextActionDate: isCoverageWorkspace ? (document.getElementById('bankCoverageNextAction')?.value || '') : (tearSheetSaved.nextActionDate || '')
    };
  }

  function updateBankSaveButton() {
    const btn = document.getElementById('bankSaveBtn');
    const statusSelect = document.getElementById('bankTearSheetStatus');
    if (btn) btn.textContent = selectedTearSheetCoverage && selectedTearSheetCoverage.bankId ? 'Saved' : 'Save Bank';
    if (statusSelect) statusSelect.value = currentBankAccountStatus().status || 'Open';
    updateTearSheetCoverageSignal();
  }

  function updateCoveragePanel() {
    const saved = selectedBankCoverage || {};
    const statusEl = document.getElementById('bankCoverageStatus');
    const priorityEl = document.getElementById('bankCoveragePriority');
    const ownerEl = document.getElementById('bankCoverageOwner');
    const nextActionEl = document.getElementById('bankCoverageNextAction');
    const removeBtn = document.getElementById('bankCoverageRemoveBtn');
    const statusText = document.getElementById('bankCoverageStatusText');
    if (statusEl) statusEl.value = saved.status || selectedBankAccountStatus?.status || 'Open';
    if (priorityEl) priorityEl.value = saved.priority || 'Medium';
    if (ownerEl) ownerEl.value = saved.owner || '';
    if (nextActionEl) nextActionEl.value = saved.nextActionDate || '';
    if (removeBtn) removeBtn.hidden = !saved.bankId;
    if (statusText) statusText.textContent = saved.bankId ? `Saved ${formatFullTimestamp(saved.updatedAt)}` : 'Not saved yet';
    updateBankSaveButton();
  }

  async function loadTearSheetCoverage(bankId) {
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      selectedBankAccountStatus = data.accountStatus || selectedBankAccountStatus || defaultBankAccountStatus();
      selectedTearSheetCoverage = data.saved || getSavedBankById(bankId);
    } catch (e) {
      selectedTearSheetCoverage = getSavedBankById(bankId);
    }
    updateBankSaveButton();
  }

  async function loadBankCoverage(bankId, options = {}) {
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { cache: 'no-store' });
      const data = await readBankJson(res);
      if (data.accountStatus) selectedBankAccountStatus = data.accountStatus;
      selectedBankCoverage = data.saved || getSavedBankById(bankId);
      selectedBankNotes = Array.isArray(data.notes) ? data.notes : [];
      if (options.renderDetail) renderCoverageDetail();
      else {
        updateCoveragePanel();
        renderBankNotes();
      }
    } catch (e) {
      selectedBankCoverage = getSavedBankById(bankId);
      selectedBankNotes = [];
      if (options.renderDetail) renderCoverageDetail();
      else {
        updateCoveragePanel();
        renderBankNotes(e.message);
      }
    }
  }

  async function saveCurrentBankCoverage() {
    const formValues = bankCoverageFormValues();
    if (!formValues.bankId) return showToast('No bank selected', true);
    try {
      const res = await fetch('/api/bank-coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await readBankJson(res);
      if (data.accountStatus) selectedBankAccountStatus = data.accountStatus;
      if (selectedBank && selectedBank.bank && selectedBank.bank.summary) {
        selectedBank.bank.summary.accountStatus = selectedBankAccountStatus;
      }
      if (activeBankWorkspaceView === 'coverage') {
        selectedBankCoverage = data.saved;
        activeCoverageBankId = data.saved.bankId;
        if (selectedBankId() === data.saved.bankId) selectedTearSheetCoverage = data.saved;
      } else {
        selectedTearSheetCoverage = data.saved;
      }
      await loadSavedBanks();
      if (activeBankWorkspaceView === 'coverage') renderCoverageDetail();
      else updateCoveragePanel();
      showToast('Saved bank coverage');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function saveCurrentBankAccountStatus() {
    const bankId = selectedBankId();
    const status = document.getElementById('bankTearSheetStatus')?.value || currentBankAccountStatus().status || 'Open';
    if (!bankId) return showToast('No bank selected', true);
    try {
      const res = await fetch('/api/bank-account-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId, status })
      });
      const data = await readBankJson(res);
      selectedBankAccountStatus = data.accountStatus || { status };
      if (data.saved) selectedTearSheetCoverage = data.saved;
      if (selectedBank && selectedBank.bank && selectedBank.bank.summary) {
        selectedBank.bank.summary.accountStatus = selectedBankAccountStatus;
      }
      await loadSavedBanks();
      updateBankSaveButton();
      showToast('Saved bank status');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function removeCurrentBankCoverage() {
    const bankId = activeCoverageBankId || selectedBankId();
    if (!bankId) return showToast('No bank selected', true);
    if (!confirm('Remove this bank and its notes from the saved coverage list?')) return;
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
      await readBankJson(res);
      selectedBankCoverage = null;
      selectedBankNotes = [];
      if (selectedTearSheetCoverage && selectedTearSheetCoverage.bankId === bankId) selectedTearSheetCoverage = null;
      if (activeCoverageBankId === bankId) activeCoverageBankId = null;
      await loadSavedBanks();
      if (activeBankWorkspaceView === 'coverage') renderCoverageDetailEmpty();
      else {
        updateCoveragePanel();
        renderBankNotes();
      }
      showToast('Removed saved bank');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function addCurrentBankNote() {
    const bankId = activeCoverageBankId || selectedBankId();
    const textarea = document.getElementById('bankNoteText');
    const text = textarea ? textarea.value.trim() : '';
    if (!bankId) return showToast('No bank selected', true);
    if (!text) return showToast('Add note text first', true);
    try {
      const res = await fetch(`/api/bank-coverage/${encodeURIComponent(bankId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, coverage: bankCoverageFormValues() })
      });
      await readBankJson(res);
      if (textarea) textarea.value = '';
      await loadSavedBanks();
      await loadBankCoverage(bankId, { renderDetail: activeBankWorkspaceView === 'coverage' });
      showToast('Added bank note');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  async function deleteBankNote(noteId) {
    if (!noteId) return;
    if (!confirm('Delete this note?')) return;
    try {
      const res = await fetch(`/api/bank-coverage/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
      await readBankJson(res);
      selectedBankNotes = selectedBankNotes.filter(note => note.id !== noteId);
      renderBankNotes();
      showToast('Deleted bank note');
    } catch (e) {
      showToast(e.message, true);
    }
  }

  function renderBankNotes(errorMessage) {
    const list = document.getElementById('bankNotesList');
    if (!list) return;
    if (errorMessage) {
      list.innerHTML = `<div class="bank-search-empty">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    if (!selectedBankNotes.length) {
      list.innerHTML = '<div class="bank-search-empty">No notes yet.</div>';
      return;
    }
    list.innerHTML = selectedBankNotes.map(note => `
      <article class="bank-note">
        <div>
          <time>${escapeHtml(formatFullTimestamp(note.createdAt))}</time>
          <p>${escapeHtml(note.text).replace(/\n/g, '<br>')}</p>
        </div>
        <button type="button" class="text-btn danger" data-note-id="${escapeHtml(note.id)}">Delete</button>
      </article>
    `).join('');
    list.querySelectorAll('[data-note-id]').forEach(btn => {
      btn.addEventListener('click', () => deleteBankNote(btn.dataset.noteId));
    });
  }

  function printBankProfile() {
    if (!selectedBank || !selectedBank.bank) return showToast('No bank tear sheet loaded', true);
    window.print();
  }

  function exportBankProfileCsv() {
    if (!selectedBank || !selectedBank.bank) return showToast('No bank tear sheet loaded', true);
    const bank = selectedBank.bank;
    const meta = selectedBank.metadata || {};
    const fields = meta.fields || [];
    const latest = bank.periods && bank.periods[0] ? bank.periods[0] : { values: {} };
    const values = latest.values || {};
    const rows = [
      ['Section', 'Metric', 'Period', 'Value']
    ];

    const detailRows = [
      ['Details', 'Account Name', latest.period || '', values.name || bank.summary.name || ''],
      ['Details', 'Parent Account', latest.period || '', values.parentName || ''],
      ['Details', 'Phone', latest.period || '', values.phone || ''],
      ['Details', 'Website', latest.period || '', values.website || ''],
      ['Details', 'City', latest.period || '', values.city || ''],
      ['Details', 'State', latest.period || '', values.state || ''],
      ['Details', 'Address 1 County', latest.period || '', values.county || ''],
      ['Details', 'Cert Number', latest.period || '', values.certNumber || ''],
      ['Details', 'Primary Regulator', latest.period || '', values.primaryRegulator || ''],
      ['Details', 'SNL Institution Key', latest.period || '', values.id || bank.id || '']
    ];
    rows.push(...detailRows);

    fields
      .filter(field => field.section !== 'details' && Object.prototype.hasOwnProperty.call(values, field.key))
      .forEach(field => {
        rows.push([
          field.section,
          field.label,
          latest.period || '',
          formatBankValue(values[field.key], field.type)
        ]);
      });

    rows.push([]);
    rows.push(['Time Series', 'Metric', 'Period', 'Value']);
    const fieldByKey = Object.fromEntries(fields.map(field => [field.key, field]));
    [
      'totalAssets', 'totalDeposits', 'totalLoans', 'loansToAssets',
      'securitiesToAssets', 'roa', 'roe', 'netInterestMargin',
      'efficiencyRatio', 'texasRatio', 'liquidAssetsToAssets'
    ].forEach(key => {
      const field = fieldByKey[key];
      if (!field) return;
      (bank.periods || []).forEach(period => {
        rows.push([
          'Time Series',
          field.label,
          period.period || period.endDate || '',
          formatBankValue(period.values && period.values[key], field.type)
        ]);
      });
    });

    const filename = `fbbs_bank_tear_sheet_${slugifyFilename(bank.summary.displayName || bank.summary.name || bank.id)}_${latest.period || 'latest'}.csv`;
    downloadCsv(filename, rows);
    showToast('Exported bank tear sheet CSV');
  }

  function renderBankFieldSection(title, fields, values, section, denominatorKey) {
    const rows = fields
      .filter(field => field.section === section)
      .map(field => {
        const value = formatBankValue(values[field.key], field.type);
        const derivedPct = field.denominatorKey ? bankShare(values[field.key], values[field.denominatorKey]) : null;
        const pct = denominatorKey && field.key !== denominatorKey ? bankShare(values[field.key], values[denominatorKey]) : derivedPct;
        return [field.label, pct == null ? value : `${value} / ${pct}`];
      });
    return renderBankSection(title, rows);
  }

  function renderBankSection(title, rows, details) {
    const filtered = rows.filter(([, value]) => value !== null && value !== undefined && value !== '—' && value !== '');
    const midpoint = Math.ceil(filtered.length / 2);
    const columns = [filtered.slice(0, midpoint), filtered.slice(midpoint)];
    return `
      <section class="bank-section ${details ? 'details' : ''}">
        <div class="bank-section-title">${escapeHtml(title)}</div>
        <div class="bank-fields-grid">
          ${columns.map(col => `<div>${col.map(([label, value]) => `
            <div class="bank-field-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join('')}</div>`).join('')}
        </div>
      </section>
    `;
  }

  function renderBankTrendTable(fields, periods) {
    const rows = [
      'totalAssets', 'totalDeposits', 'totalLoans', 'loansToAssets',
      'securitiesToAssets', 'roa', 'roe', 'netInterestMargin',
      'efficiencyRatio', 'texasRatio', 'liquidAssetsToAssets'
    ];
    const fieldByKey = Object.fromEntries(fields.map(field => [field.key, field]));
    if (!periods.length) return '';
    return `
      <section class="bank-section">
        <div class="bank-section-title">Time Series - Quarterly</div>
        <div class="bank-trend-wrap">
          <table class="bank-trend-table">
            <thead>
              <tr>
                <th>Metric</th>
                ${periods.map(period => `<th>${escapeHtml(period.endDate || period.period)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map(key => {
                const field = fieldByKey[key];
                if (!field) return '';
                return `<tr>
                  <td>${escapeHtml(field.label)}</td>
                  ${periods.map(period => `<td>${escapeHtml(formatBankValue(period.values && period.values[key], field.type))}</td>`).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function formatBankValue(value, type) {
    if (value == null || value === '') return '—';
    if (type === 'money') return formatMoney(value, 0);
    if (type === 'percent') return formatPercentTile(value, 2);
    if (type === 'percentOf') return formatMoney(value, 0);
    if (type === 'number') return formatNumber(value);
    if (type === 'period') return String(value);
    return String(value);
  }

  function bankShare(value, total) {
    const n = Number(value);
    const d = Number(total);
    if (!isFinite(n) || !isFinite(d) || d === 0) return null;
    return formatPercentTile((n / d) * 100, 2);
  }

  function slotAcceptExtensions(slot) {
    if (slot === 'dashboard') return ['.html', '.htm'];
    if (slot === 'agenciesBullets' || slot === 'agenciesCallables' || slot === 'corporates') return ['.xlsx', '.xls'];
    return ['.pdf'];
  }

  function fileMatchesSlot(slot, filename) {
    const lower = filename.toLowerCase();
    return slotAcceptExtensions(slot).some(ext => lower.endsWith(ext));
  }

  function handleFileSelect(slot, file, zone) {
    if (!fileMatchesSlot(slot, file.name)) {
      const exts = slotAcceptExtensions(slot).join(' / ');
      showToast(`${DOC_TYPES[slot].label} slot expects ${exts}`, true);
      return;
    }
    const detected = classifyFile(file.name);
    if (detected && detected !== slot) {
      showToast(`Heads up: filename looks like a ${DOC_TYPES[detected].label} but you're putting it in the ${DOC_TYPES[slot].label} slot. Double-check before publishing.`, true);
    }

    selectedFiles[slot] = file;
    zone.classList.add('filled');
    const h5 = zone.querySelector('h5');
    const p = zone.querySelector('p');
    h5.textContent = 'File Selected';
    p.textContent = file.name;

    const statusEl = document.getElementById('status-' + slot);
    statusEl.innerHTML = `<span>${formatSize(file.size)}</span><span class="ok">Ready</span>`;
    updateUploadStat();
  }

  function resetDropZone(slot) {
    const zone = document.querySelector(`.drop-zone[data-slot="${slot}"]`);
    if (!zone) return;
    zone.classList.remove('filled');
    const h5 = zone.querySelector('h5');
    const p = zone.querySelector('p');
    h5.textContent = h5.dataset.default || 'Drop File';
    p.textContent = p.dataset.default || 'or click to browse';
    const input = zone.querySelector('input');
    if (input) input.value = '';
    const statusEl = document.getElementById('status-' + slot);
    if (!statusEl) return;
    const accept = slotAcceptExtensions(slot).join(', ');
    statusEl.innerHTML = `<span>Accepts: ${accept}</span><span class="pending">Awaiting</span>`;
  }

  function updateUploadStat() {
    const count = Object.values(selectedFiles).filter(Boolean).length;
    document.getElementById('uploadStat').textContent = `${count} / ${TOTAL_SLOTS}`;
  }

  async function publishPackage() {
    const entries = Object.entries(selectedFiles).filter(([, f]) => f !== null);
    if (entries.length === 0) {
      showToast('No files selected', true);
      return;
    }

    const btn = document.getElementById('publishBtn');
    btn.disabled = true;
    btn.textContent = 'Publishing…';

    const formData = new FormData();
    entries.forEach(([slot, file]) => {
      formData.append(slot, file, file.name);
    });

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (res.ok && data.success) {
        const parts = [];
        if (typeof data.offeringsCount === 'number') parts.push(`${data.offeringsCount} CDs`);
        if (typeof data.muniOfferingsCount === 'number') parts.push(`${data.muniOfferingsCount} munis`);
        if (typeof data.agencyCount === 'number') parts.push(`${data.agencyCount} agencies`);
        if (typeof data.corporatesCount === 'number') parts.push(`${data.corporatesCount} corporates`);
        const extract = parts.length ? ` · ${parts.join(', ')} extracted` : '';
        showToast(`Published ${data.saved.length} file${data.saved.length === 1 ? '' : 's'}${extract}`);

        if (Array.isArray(data.dateWarnings) && data.dateWarnings.length) {
          setTimeout(() => showToast(data.dateWarnings[0], true), 600);
        }

        selectedFiles = {
          dashboard: null, econ: null, cd: null, cdoffers: null, munioffers: null,
          agenciesBullets: null, agenciesCallables: null, corporates: null
        };
        SLOTS.forEach(resetDropZone);
        updateUploadStat();
        await loadCurrent();
        await loadArchive();
        setTimeout(() => goTo('home'), 500);
      } else {
        showToast(data.error || `Upload failed (HTTP ${res.status})`, true);
      }
    } catch (e) {
      console.error(e);
      showToast('Upload failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publish Package';
    }
  }

  // ============ Weekly CD Recap ============

  async function loadCdRecap() {
    const body = document.getElementById('cdRecapBody');
    const stat = document.getElementById('cdRecapStat');
    const sub = document.getElementById('cdRecapSub');
    const kicker = document.getElementById('cdRecapKicker');
    const grid = document.getElementById('cdRecapStatusGrid');
    if (body) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text3)">Loading weekly CD recap&hellip;</td></tr>';
    }
    try {
      const res = await fetch('/api/cd-recap/weekly', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const recap = await res.json();
      cdRecapData = recap;

      if (stat) stat.textContent = formatNumber(recap.uniqueCusips || 0);
      if (sub) {
        sub.textContent = `${formatShortDate(recap.weekStart)} through ${formatShortDate(recap.weekEnd)} · ${formatNumber(recap.snapshotCount)} daily snapshot${recap.snapshotCount === 1 ? '' : 's'}`;
      }
      if (kicker) {
        kicker.textContent = `${formatNumber(recap.duplicateRowsRemoved || 0)} duplicate CUSIP row${recap.duplicateRowsRemoved === 1 ? '' : 's'} removed`;
      }
      if (grid) {
        const snapshotDates = Array.isArray(recap.snapshotDates) && recap.snapshotDates.length
          ? recap.snapshotDates.map(formatShortDate).join(', ')
          : 'No snapshots yet';
        const tiles = [
          { label: 'Week Range', value: `${formatShortDate(recap.weekStart)} - ${formatShortDate(recap.weekEnd)}` },
          { label: 'Daily Snapshots', value: formatNumber(recap.snapshotCount || 0) },
          { label: 'Raw Rows', value: formatNumber(recap.rawRows || 0) },
          { label: 'Unique CUSIP Count', value: formatNumber(recap.uniqueCusips || 0) },
          { label: 'Charted Term CUSIP Count', value: formatNumber(recap.recapTermUniqueCusips || 0) },
          { label: 'Last Refreshed', value: formatFullTimestamp(new Date().toISOString()) },
          { label: 'Snapshot Dates', value: snapshotDates }
        ];
        grid.innerHTML = tiles.map(t => `
          <div class="stat-tile">
            <span>${escapeHtml(t.label)}</span>
            <strong>${escapeHtml(String(t.value))}</strong>
          </div>
        `).join('');
      }
      renderCdRecapTable(recap);
      renderCdRecapCharts(recap);
    } catch (err) {
      console.error('Failed to load weekly CD recap:', err);
      cdRecapData = null;
      if (body) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--danger)">
          Failed to load weekly CD recap: ${escapeHtml(err.message)}
        </td></tr>`;
      }
      renderCdRecapCharts(null);
      showToast('Could not load weekly CD recap: ' + err.message, true);
    }
  }

  function renderCdRecapTable(recap) {
    const body = document.getElementById('cdRecapBody');
    if (!body) return;
    const terms = Array.isArray(recap.terms) ? recap.terms : [];
    if (!terms.length || !recap.snapshotCount) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text3)">
        Upload Daily CD Offers PDFs to build a weekly recap history.
      </td></tr>`;
      return;
    }
    body.innerHTML = terms.map(t => {
      const top = Array.isArray(t.top) && t.top.length
        ? t.top.map(o => `${escapeHtml(o.name || 'Issuer')} ${formatPercentTile(o.rate, 2)} ${escapeHtml(o.cusip || '')}`).join('<br>')
        : '<span style="color:var(--text3)">No issues</span>';
      return `
        <tr>
          <td><strong>${escapeHtml(t.label || t.term)}</strong></td>
          <td style="text-align:right">${formatNumber(t.uniqueCusips || 0)}</td>
          <td style="text-align:right">${t.issueShare == null ? '—' : (t.issueShare * 100).toFixed(0) + '%'}</td>
          <td class="rate-cell" style="text-align:right">${formatPercentTile(t.medianRate, 2)}</td>
          <td style="text-align:right">${formatPercentTile(t.minRate, 2)}</td>
          <td style="text-align:right">${formatPercentTile(t.maxRate, 2)}</td>
          <td>${top}</td>
        </tr>
      `;
    }).join('');
  }

  function renderCdRecapCharts(recap) {
    renderCdTermCountChart(recap);
    renderCdMedianRateChart(recap);
    renderCdRateComparisonTable(recap);
  }

  function renderCdTermCountChart(recap) {
    const chart = document.getElementById('cdTermCountChart');
    if (!chart) return;
    const terms = Array.isArray(recap && recap.terms)
      ? recap.terms
          .filter(t => Number(t.uniqueCusips) > 0)
          .sort((a, b) => Number(b.uniqueCusips || 0) - Number(a.uniqueCusips || 0))
          .slice(0, 8)
      : [];
    if (!terms.length) {
      chart.innerHTML = '<div class="chart-empty">Upload Daily CD Offers PDFs to build weekly term counts.</div>';
      return;
    }

    const maxCount = Math.max(...terms.map(t => Number(t.uniqueCusips || 0)), 1);
    chart.innerHTML = terms.map(t => {
      const count = Number(t.uniqueCusips || 0);
      const pct = Math.max(4, (count / maxCount) * 100);
      return `
        <div class="term-bar-row">
          <div class="term-bar-label">${escapeHtml(t.label || t.term)}</div>
          <div class="term-bar-track">
            <div class="term-bar-fill" style="width:${pct.toFixed(2)}%"></div>
          </div>
          <strong>${formatNumber(count)}</strong>
        </div>
      `;
    }).join('');
  }

  function renderCdMedianRateChart(recap) {
    const chart = document.getElementById('cdMedianRateChart');
    const legend = document.getElementById('cdMedianRateLegend');
    if (!chart) return;
    const comparison = recap && recap.rateComparisons;
    const periods = Array.isArray(comparison && comparison.periods) ? comparison.periods : [];
    const terms = Array.isArray(comparison && comparison.terms)
      ? comparison.terms.filter(row => Object.values(row.rates || {}).some(v => v != null && !isNaN(v)))
      : [];
    if (!periods.length || !terms.length) {
      if (legend) legend.innerHTML = '';
      chart.innerHTML = '<div class="chart-empty">Rate comparison will fill in as prior CD snapshots accumulate.</div>';
      return;
    }

    const comparisonPeriods = periods.filter(period => period.key !== 'today');
    const validPeriods = comparisonPeriods.filter(period =>
      terms.some(row => Number.isFinite(Number(row.rates && row.rates.today)) && Number.isFinite(Number(row.rates && row.rates[period.key])))
    );
    if (!validPeriods.length) {
      if (legend) legend.innerHTML = '';
      chart.innerHTML = '<div class="chart-empty">Rate comparison will fill in as prior CD snapshots accumulate.</div>';
      return;
    }
    if (!validPeriods.some(period => period.key === selectedCdRecapPeriod)) {
      selectedCdRecapPeriod = validPeriods[0].key;
    }

    const selectedPeriod = validPeriods.find(period => period.key === selectedCdRecapPeriod) || validPeriods[0];
    if (legend) {
      legend.innerHTML = `
        <div class="cd-period-toggle" role="group" aria-label="CD recap comparison period">
          <span>Compare today with</span>
          ${validPeriods.map(period => `
            <button type="button" class="${period.key === selectedPeriod.key ? 'active' : ''}" data-cd-recap-period="${escapeHtml(period.key)}">
              ${escapeHtml(period.label.replace('Previous ', ''))}
            </button>
          `).join('')}
        </div>
        <div class="cd-period-date">
          ${escapeHtml(selectedPeriod.label)}
          <em>${selectedPeriod.snapshotDate ? formatShortDate(selectedPeriod.snapshotDate) : 'No snapshot'}</em>
        </div>
      `;
      legend.querySelectorAll('[data-cd-recap-period]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedCdRecapPeriod = btn.dataset.cdRecapPeriod;
          renderCdMedianRateChart(cdRecapData);
        });
      });
    }

    const rows = terms.map(row => {
      const today = Number(row.rates && row.rates.today);
      const prior = Number(row.rates && row.rates[selectedPeriod.key]);
      const delta = Number.isFinite(today) && Number.isFinite(prior) ? today - prior : null;
      return {
        term: row.term,
        label: row.label || row.term,
        today: Number.isFinite(today) ? today : null,
        prior: Number.isFinite(prior) ? prior : null,
        delta
      };
    });
    const pairRates = rows.flatMap(row => [row.today, row.prior]).filter(Number.isFinite);
    const { min, max } = makeDumbbellRateDomain(Math.min(...pairRates), Math.max(...pairRates));
    const ticks = makeDumbbellRateTicks(min, max);

    chart.innerHTML = `
      <div class="cd-dumbbell-chart">
        <div class="cd-dumbbell-axis">
          ${ticks.map(tick => `
            <span style="left:${ratePosition(tick, min, max).toFixed(2)}%">${escapeHtml(formatPercentTile(tick, 2))}</span>
          `).join('')}
        </div>
        ${rows.map(row => renderDumbbellRow(row, min, max, selectedPeriod)).join('')}
      </div>
    `;
  }

  function renderDumbbellRow(row, min, max, selectedPeriod) {
    if (!Number.isFinite(row.today) || !Number.isFinite(row.prior)) {
      return `
        <div class="cd-dumbbell-row muted">
          <div class="cd-dumbbell-term">${escapeHtml(row.label)}</div>
          <div class="cd-dumbbell-track unavailable">No ${escapeHtml(selectedPeriod.label.toLowerCase())} rate</div>
          <div class="cd-dumbbell-delta">—</div>
        </div>
      `;
    }

    const priorPct = ratePosition(row.prior, min, max);
    const todayPct = ratePosition(row.today, min, max);
    const connectorLeft = Math.min(priorPct, todayPct);
    const connectorWidth = Math.abs(todayPct - priorPct);
    const direction = deltaClass(row.delta);
    const deltaText = formatBasisPointDelta(row.delta);
    return `
      <div class="cd-dumbbell-row" title="${escapeHtml(`${row.label}: ${formatPercentTile(row.prior, 2)} to ${formatPercentTile(row.today, 2)} (${deltaText})`)}">
        <div class="cd-dumbbell-term">${escapeHtml(row.label)}</div>
        <div class="cd-dumbbell-track">
          <span class="cd-dumbbell-connector ${direction}" style="left:${connectorLeft.toFixed(2)}%;width:${Math.max(1, connectorWidth).toFixed(2)}%"></span>
          <span class="cd-dumbbell-dot prior" style="left:${priorPct.toFixed(2)}%"></span>
          <span class="cd-dumbbell-dot today" style="left:${todayPct.toFixed(2)}%"></span>
        </div>
        <div class="cd-dumbbell-delta ${direction}">${escapeHtml(deltaText)}</div>
      </div>
    `;
  }

  function renderCdRateComparisonTable(recap) {
    const tableWrap = document.getElementById('cdRateComparisonTable');
    if (!tableWrap) return;
    const comparison = recap && recap.rateComparisons;
    const comparisonTerms = Array.isArray(comparison && comparison.terms) ? comparison.terms : [];
    const recapTerms = Array.isArray(recap && recap.terms) ? recap.terms : [];
    const issueByTerm = new Map(recapTerms.map(row => [row.term, row]));
    const rows = comparisonTerms
      .filter(row => Object.values(row.rates || {}).some(v => v != null && !isNaN(v)))
      .map(row => {
        const issue = issueByTerm.get(row.term) || {};
        return {
          term: row.term,
          label: row.label || row.term,
          count: Number(issue.uniqueCusips || 0),
          share: issue.issueShare,
          rates: row.rates || {},
          deltas: row.deltas || {}
        };
      });

    if (!rows.length) {
      tableWrap.innerHTML = '<div class="chart-empty">Rate comparison table will fill in as prior CD snapshots accumulate.</div>';
      return;
    }

    tableWrap.innerHTML = `
      <table class="rate-comparison-table">
        <thead>
          <tr>
            <th>Term</th>
            <th>Count</th>
            <th>Share</th>
            <th>Today</th>
            <th>Prev Week</th>
            <th>Wk Chg</th>
            <th>Prev Month</th>
            <th>Mo Chg</th>
            <th>Prev Year</th>
            <th>Yr Chg</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${escapeHtml(row.label)}</strong></td>
              <td>${escapeHtml(formatNumber(row.count))}</td>
              <td>${escapeHtml(formatIssueShare(row.share))}</td>
              <td>${escapeHtml(formatPercentTile(row.rates.today, 2))}</td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousWeek, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousWeek)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousWeek))}</span></td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousMonth, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousMonth)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousMonth))}</span></td>
              <td>${escapeHtml(formatPercentTile(row.rates.previousYear, 2))}</td>
              <td><span class="rate-change-pill ${deltaClass(row.deltas.previousYear)}">${escapeHtml(formatBasisPointDelta(row.deltas.previousYear))}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function makeDumbbellRateDomain(minRate, maxRate) {
    if (!Number.isFinite(minRate) || !Number.isFinite(maxRate)) {
      return { min: 3, max: 5 };
    }
    const range = maxRate - minRate;
    const padding = Math.max(0.12, range * 0.25);
    let min = Math.max(0, Math.floor((minRate - padding) * 4) / 4);
    let max = Math.ceil((maxRate + padding) * 4) / 4;
    if (max - min < 0.75) {
      const mid = (minRate + maxRate) / 2;
      min = Math.max(0, Math.floor((mid - 0.375) * 4) / 4);
      max = Math.ceil((mid + 0.375) * 4) / 4;
    }
    return { min, max };
  }

  function makeDumbbellRateTicks(min, max) {
    const steps = 4;
    const range = Math.max(0.01, max - min);
    return Array.from({ length: steps + 1 }, (_, index) => Number((min + (range / steps) * index).toFixed(2)));
  }

  function ratePosition(rate, min, max) {
    if (!Number.isFinite(rate) || max <= min) return 50;
    return Math.max(0, Math.min(100, ((rate - min) / (max - min)) * 100));
  }

  function formatBasisPointDelta(delta) {
    if (!Number.isFinite(delta)) return '—';
    const bps = Math.round(delta * 100);
    return `${bps > 0 ? '+' : ''}${bps} bp`;
  }

  function formatIssueShare(share) {
    return Number.isFinite(Number(share)) ? `${(Number(share) * 100).toFixed(0)}%` : '—';
  }

  function deltaClass(delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.005) return 'flat';
    return delta > 0 ? 'up' : 'down';
  }

  function setupCdRecap() {
    const refresh = document.getElementById('refreshCdRecapBtn');
    if (refresh) {
      refresh.addEventListener('click', () => loadCdRecap());
    }
  }

  // ============ Offerings Explorer ============

  let offeringsData = null;   // { asOfDate, offerings[], sourceFile, extractedAt }
  let offeringsFilters = {
    search: '', term: '', minRate: null, state: '',
    cpnFreq: '', noRestrictions: false
  };
  let offeringsSort = { col: 'rate', dir: 'desc' };

  async function loadOfferings() {
    const body = document.getElementById('explorerBody');
    const sub = document.getElementById('explorerSub');
    try {
      const res = await fetch('/api/offerings', { cache: 'no-store' });
      if (res.status === 404) {
        offeringsData = null;
        body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">
          No offerings data yet. Upload today's CD Offerings PDF on the Upload page and offerings will appear here automatically.
        </td></tr>`;
        sub.textContent = 'No offerings data';
        document.getElementById('explorerStat').textContent = '0';
        document.getElementById('explorerKicker').textContent = 'Empty';
        renderStatTiles('cdStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Highest Rate', value: '—' },
          { label: 'Average Rate', value: '—' },
          { label: 'Most Common Term', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      offeringsData = await res.json();
    } catch (e) {
      console.error('Failed to load offerings:', e);
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load offerings: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error loading offerings';
      return;
    }

    populateOfferingsFilters();
    renderOfferings();
  }

  function populateOfferingsFilters() {
    if (!offeringsData || !offeringsData.offerings) return;
    const off = offeringsData.offerings;

    // Terms — sort by termMonths ascending
    const termMap = new Map();
    off.forEach(o => { if (!termMap.has(o.term)) termMap.set(o.term, o.termMonths); });
    const sortedTerms = [...termMap.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    const termSelect = document.getElementById('ef-term');
    const keepTerm = termSelect.value;
    termSelect.innerHTML = '<option value="">All terms</option>' +
      sortedTerms.map(t => `<option value="${t}">${t}</option>`).join('');
    termSelect.value = keepTerm;

    // States
    const states = [...new Set(off.map(o => o.issuerState))].sort();
    const stateSelect = document.getElementById('ef-state');
    const keepState = stateSelect.value;
    stateSelect.innerHTML = '<option value="">All states</option>' +
      states.map(s => `<option value="${s}">${s}</option>`).join('');
    stateSelect.value = keepState;

    const asOf = offeringsData.asOfDate
      ? ` &middot; As of ${formatNumericDate(offeringsData.asOfDate)}`
      : '';
    document.getElementById('explorerSub').innerHTML =
      `${off.length} CDs available${asOf}`;
    document.getElementById('explorerKicker').textContent =
      offeringsData.asOfDate ? formatNumericDate(offeringsData.asOfDate) : 'Current package';
  }

  function renderOfferings() {
    const body = document.getElementById('explorerBody');
    if (!offeringsData) return;

    const filtered = applyOfferingsFilters(offeringsData.offerings);
    sortOfferingsInPlace(filtered);

    document.getElementById('explorerStat').textContent = filtered.length;
    renderStatTiles('cdStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Highest Rate', value: formatPercentTile(maxValue(filtered.map(o => o.rate)), 2) },
      { label: 'Average Rate', value: formatPercentTile(average(filtered.map(o => o.rate)), 2) },
      { label: 'Most Common Term', value: mostCommonTerm(filtered) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">
        No offerings match the current filters.
      </td></tr>`;
      return;
    }

    body.innerHTML = filtered.map(o => `
      <tr>
        <td><span class="term-pill">${escapeHtml(o.term)}</span></td>
        <td class="issuer-cell">${escapeHtml(o.name)}</td>
        <td style="text-align:right" class="rate-cell">${o.rate.toFixed(2)}</td>
        <td>${formatNumericDate(o.maturity)}</td>
        <td class="cusip-cell">${escapeHtml(o.cusip)}</td>
        <td>${formatNumericDate(o.settle)}</td>
        <td>${escapeHtml(o.issuerState)}</td>
        <td>${o.restrictions.length
          ? `<span class="restrict-chip" title="Not available in: ${o.restrictions.join(', ')}">${o.restrictions.join(', ')}</span>`
          : '<span class="no-restrict">&mdash;</span>'}</td>
        <td class="cpn-cell">${escapeHtml(o.couponFrequency || '')}</td>
      </tr>
    `).join('');
  }

  function applyOfferingsFilters(offerings) {
    return offerings.filter(o => {
      if (offeringsFilters.search) {
        const q = offeringsFilters.search.toLowerCase();
        if (!o.name.toLowerCase().includes(q) && !o.cusip.toLowerCase().includes(q)) return false;
      }
      if (offeringsFilters.term && o.term !== offeringsFilters.term) return false;
      if (offeringsFilters.minRate != null && o.rate < offeringsFilters.minRate) return false;
      if (offeringsFilters.state && o.issuerState !== offeringsFilters.state) return false;
      if (offeringsFilters.cpnFreq && o.couponFrequency !== offeringsFilters.cpnFreq) return false;
      if (offeringsFilters.noRestrictions && o.restrictions.length > 0) return false;
      return true;
    });
  }

  function sortOfferingsInPlace(arr) {
    const { col, dir } = offeringsSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      // For term, sort by termMonths for numeric order
      if (col === 'term') { av = a.termMonths; bv = b.termMonths; }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function setupOfferingsFilters() {
    const search = document.getElementById('ef-search');
    const term = document.getElementById('ef-term');
    const minRate = document.getElementById('ef-minrate');
    const state = document.getElementById('ef-state');
    const cpn = document.getElementById('ef-cpn');
    const noRestrict = document.getElementById('ef-noRestrictions');

    search.addEventListener('input', () => {
      offeringsFilters.search = search.value.trim();
      if (offeringsData) renderOfferings();
    });
    term.addEventListener('change', () => {
      offeringsFilters.term = term.value;
      if (offeringsData) renderOfferings();
    });
    minRate.addEventListener('input', () => {
      const v = parseFloat(minRate.value);
      offeringsFilters.minRate = isNaN(v) ? null : v;
      if (offeringsData) renderOfferings();
    });
    state.addEventListener('change', () => {
      offeringsFilters.state = state.value;
      if (offeringsData) renderOfferings();
    });
    cpn.addEventListener('change', () => {
      offeringsFilters.cpnFreq = cpn.value;
      if (offeringsData) renderOfferings();
    });
    noRestrict.addEventListener('change', () => {
      offeringsFilters.noRestrictions = noRestrict.checked;
      if (offeringsData) renderOfferings();
    });

    document.getElementById('ef-reset').addEventListener('click', () => {
      search.value = '';
      term.value = '';
      minRate.value = '';
      state.value = '';
      cpn.value = '';
      noRestrict.checked = false;
      offeringsFilters = { search: '', term: '', minRate: null, state: '', cpnFreq: '', noRestrictions: false };
      if (offeringsData) renderOfferings();
    });

    document.getElementById('ef-export').addEventListener('click', exportOfferingsCsv);

    // Column header sorting
    document.querySelectorAll('.explorer-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (offeringsSort.col === col) {
          offeringsSort.dir = offeringsSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          offeringsSort.col = col;
          offeringsSort.dir = (col === 'rate' || col === 'maturity') ? 'desc' : 'asc';
        }
        document.querySelectorAll('.explorer-table th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(offeringsSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (offeringsData) renderOfferings();
      });
    });
  }

  function exportOfferingsCsv() {
    if (!offeringsData) return showToast('No offerings loaded', true);
    const filtered = applyOfferingsFilters(offeringsData.offerings);
    sortOfferingsInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Term','Issuer','Rate','Maturity','CUSIP','Settle','IssuerState','Restrictions','CouponFreq'];
    const rows = filtered.map(o => [
      o.term, o.name, o.rate.toFixed(2), o.maturity, o.cusip, o.settle,
      o.issuerState, o.restrictions.join('|'), o.couponFrequency || ''
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');

    const stamp = offeringsData.asOfDate || 'offerings';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_cd_offerings_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} offerings`);
  }

  // ============ Muni Offerings Explorer ============

  let muniData = null;
  let muniFilters = {
    search: '',
    section: '',        // '', 'BQ', 'Municipals', 'Taxable'
    state: '',
    minCoupon: null,
    minYtw: null,
    callable: '',       // '', 'callable', 'noncall'
    rated: ''           // '', 'both', 'moodys', 'sp', 'unrated'
  };
  let muniSort = { col: 'maturity', dir: 'asc' };

  async function loadMuniOfferings() {
    const body = document.getElementById('muniExplorerBody');
    const sub = document.getElementById('muniExplorerSub');
    try {
      const res = await fetch('/api/muni-offerings', { cache: 'no-store' });
      if (res.status === 404) {
        muniData = null;
        body.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">
          No muni offerings yet. Upload the Muni Offerings PDF on the Upload page and offerings will appear here automatically.
        </td></tr>`;
        sub.textContent = 'No muni offerings data';
        document.getElementById('muniExplorerStat').textContent = '0';
        document.getElementById('muniExplorerKicker').textContent = 'Empty';
        renderStatTiles('muniStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Average YTW', value: '—' },
          { label: 'Callable', value: '—' },
          { label: 'Taxable', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      muniData = await res.json();
    } catch (e) {
      console.error('Failed to load muni offerings:', e);
      body.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load muni offerings: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error loading offerings';
      return;
    }

    populateMuniFilters();
    renderMuniOfferings();
  }

  function populateMuniFilters() {
    if (!muniData || !muniData.offerings) return;
    const off = muniData.offerings;

    const states = [...new Set(off.map(o => o.issuerState))].sort();
    const stateSelect = document.getElementById('mf-state');
    const keepState = stateSelect.value;
    stateSelect.innerHTML = '<option value="">All states</option>' +
      states.map(s => `<option value="${s}">${s}</option>`).join('');
    stateSelect.value = keepState;

    const asOf = muniData.asOfDate
      ? ` &middot; As of ${formatNumericDate(muniData.asOfDate)}`
      : '';
    document.getElementById('muniExplorerSub').innerHTML =
      `${off.length} muni bonds available${asOf}`;
    document.getElementById('muniExplorerKicker').textContent =
      muniData.asOfDate ? formatNumericDate(muniData.asOfDate) : 'Current package';
  }

  function renderMuniOfferings() {
    const body = document.getElementById('muniExplorerBody');
    if (!muniData) return;

    const filtered = applyMuniFilters(muniData.offerings);
    sortMuniInPlace(filtered);

    document.getElementById('muniExplorerStat').textContent = filtered.length;
    renderStatTiles('muniStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Average YTW', value: formatPercentTile(average(filtered.map(o => o.ytw)), 3) },
      { label: 'Callable', value: formatNumber(filtered.filter(o => o.callDate).length) },
      { label: 'Taxable', value: formatNumber(filtered.filter(o => o.section === 'Taxable').length) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3)">
        No offerings match the current filters.
      </td></tr>`;
      return;
    }

    body.innerHTML = filtered.map(o => {
      const ratings = [];
      if (o.moodysRating) ratings.push(`<span class="rating-moody" title="Moody's">${escapeHtml(o.moodysRating)}</span>`);
      if (o.spRating)     ratings.push(`<span class="rating-sp" title="S&amp;P">${escapeHtml(o.spRating)}</span>`);
      const ratingCell = ratings.length ? ratings.join('<br>') : '<span class="no-restrict">&mdash;</span>';

      // Yield / pricing cell: show YTW % or spread, whichever is present
      let yieldCell;
      if (o.ytw != null) {
        yieldCell = `<span class="rate-cell">${o.ytw.toFixed(3)}</span>`;
      } else if (o.spread) {
        yieldCell = `<span class="spread-chip">${escapeHtml(o.spread)}</span>`;
      } else {
        yieldCell = '<span class="no-restrict">&mdash;</span>';
      }

      const priceCell = o.price != null
        ? `<span class="rate-cell">${o.price.toFixed(3)}</span>`
        : '<span class="no-restrict">&mdash;</span>';

      const callCell = o.callDate
        ? formatNumericDate(o.callDate)
        : '<span class="no-restrict">&mdash;</span>';

      const creditCell = o.creditEnhancement
        ? `<span class="credit-chip">${escapeHtml(o.creditEnhancement)}</span>`
        : '<span class="no-restrict">&mdash;</span>';

      return `
        <tr>
          <td><span class="section-pill section-${o.section.toLowerCase()}">${escapeHtml(o.section)}</span></td>
          <td class="rating-cell">${ratingCell}</td>
          <td style="text-align:right" class="qnty-cell">${o.quantity.toLocaleString()}</td>
          <td>${escapeHtml(o.issuerState)}</td>
          <td class="issuer-cell">${escapeHtml(o.issuerName)}</td>
          <td>${escapeHtml(o.issueType)}</td>
          <td style="text-align:right">${o.coupon.toFixed(3)}</td>
          <td>${formatNumericDate(o.maturity)}</td>
          <td>${callCell}</td>
          <td style="text-align:right">${yieldCell}</td>
          <td style="text-align:right">${priceCell}</td>
          <td class="cusip-cell">${escapeHtml(o.cusip)}</td>
          <td>${creditCell}</td>
        </tr>
      `;
    }).join('');
  }

  function applyMuniFilters(offerings) {
    return offerings.filter(o => {
      if (muniFilters.search) {
        const q = muniFilters.search.toLowerCase();
        if (!o.issuerName.toLowerCase().includes(q) && !o.cusip.toLowerCase().includes(q)) return false;
      }
      if (muniFilters.section && o.section !== muniFilters.section) return false;
      if (muniFilters.state && o.issuerState !== muniFilters.state) return false;
      if (muniFilters.minCoupon != null && o.coupon < muniFilters.minCoupon) return false;
      if (muniFilters.minYtw != null && (o.ytw == null || o.ytw < muniFilters.minYtw)) return false;
      if (muniFilters.callable === 'callable' && !o.callDate) return false;
      if (muniFilters.callable === 'noncall' && o.callDate) return false;
      if (muniFilters.rated === 'both' && !(o.moodysRating && o.spRating)) return false;
      if (muniFilters.rated === 'moodys' && !o.moodysRating) return false;
      if (muniFilters.rated === 'sp' && !o.spRating) return false;
      if (muniFilters.rated === 'unrated' && (o.moodysRating || o.spRating)) return false;
      return true;
    });
  }

  function sortMuniInPlace(arr) {
    const { col, dir } = muniSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function setupMuniFilters() {
    const search    = document.getElementById('mf-search');
    const section   = document.getElementById('mf-section');
    const state     = document.getElementById('mf-state');
    const minCoupon = document.getElementById('mf-minCoupon');
    const minYtw    = document.getElementById('mf-minYtw');
    const callable  = document.getElementById('mf-callable');
    const rated     = document.getElementById('mf-rated');

    if (!search) return; // page not in DOM yet; shouldn't happen but defensive

    search.addEventListener('input', () => {
      muniFilters.search = search.value.trim();
      if (muniData) renderMuniOfferings();
    });
    section.addEventListener('change', () => {
      muniFilters.section = section.value;
      if (muniData) renderMuniOfferings();
    });
    state.addEventListener('change', () => {
      muniFilters.state = state.value;
      if (muniData) renderMuniOfferings();
    });
    minCoupon.addEventListener('input', () => {
      const v = parseFloat(minCoupon.value);
      muniFilters.minCoupon = isNaN(v) ? null : v;
      if (muniData) renderMuniOfferings();
    });
    minYtw.addEventListener('input', () => {
      const v = parseFloat(minYtw.value);
      muniFilters.minYtw = isNaN(v) ? null : v;
      if (muniData) renderMuniOfferings();
    });
    callable.addEventListener('change', () => {
      muniFilters.callable = callable.value;
      if (muniData) renderMuniOfferings();
    });
    rated.addEventListener('change', () => {
      muniFilters.rated = rated.value;
      if (muniData) renderMuniOfferings();
    });

    document.getElementById('mf-reset').addEventListener('click', () => {
      search.value = '';
      section.value = '';
      state.value = '';
      minCoupon.value = '';
      minYtw.value = '';
      callable.value = '';
      rated.value = '';
      muniFilters = { search: '', section: '', state: '', minCoupon: null, minYtw: null, callable: '', rated: '' };
      if (muniData) renderMuniOfferings();
    });

    document.getElementById('mf-export').addEventListener('click', exportMuniCsv);

    document.querySelectorAll('#p-muni-explorer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (muniSort.col === col) {
          muniSort.dir = muniSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          muniSort.col = col;
          // Sensible default direction per column
          muniSort.dir = (col === 'coupon' || col === 'ytw' || col === 'price' || col === 'quantity' || col === 'maturity')
            ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-muni-explorer th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(muniSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (muniData) renderMuniOfferings();
      });
    });
  }

  function exportMuniCsv() {
    if (!muniData) return showToast('No muni offerings loaded', true);
    const filtered = applyMuniFilters(muniData.offerings);
    sortMuniInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Section','Moodys','SP','Quantity','State','Issuer','IssueType',
                    'Coupon','Maturity','CallDate','YTW','YTM','Price','Spread',
                    'Settle','CouponDate','CUSIP','CreditEnhancement'];
    const rows = filtered.map(o => [
      o.section, o.moodysRating || '', o.spRating || '', o.quantity,
      o.issuerState, o.issuerName, o.issueType,
      o.coupon.toFixed(3), o.maturity,
      o.callDate || '',
      o.ytw != null ? o.ytw.toFixed(3) : '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      o.price != null ? o.price.toFixed(3) : '',
      o.spread || '',
      o.settle, o.couponDate, o.cusip,
      o.creditEnhancement || ''
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');

    const stamp = muniData.asOfDate || 'muni_offerings';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_muni_offerings_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} muni offerings`);
  }

  // ============ Agencies Explorer ============

  let agencyData = null;
  let agencyTreasuryData = null;
  let agencyFilters = {
    search: '',
    tickers: new Set(),        // multi-select
    structures: new Set(),     // 'Bullet', 'Callable'
    callTypes: new Set(),
    maturityFrom: null,        // ISO
    maturityTo: null,
    nextCallFrom: null,
    nextCallTo: null,
    minCoupon: null,
    maxCoupon: null,
    minYtm: null,
    minYtnc: null,
    minPrice: null,
    maxPrice: null,
    minQty: null
  };
  let agencySort = { col: 'maturity', dir: 'asc' };

  async function loadAgencies() {
    const body = document.getElementById('agenciesBody');
    const sub = document.getElementById('agenciesSub');
    try {
      const [res, treasury] = await Promise.all([
        fetch('/api/agencies', { cache: 'no-store' }),
        loadAgencyTreasuryData()
      ]);
      agencyTreasuryData = treasury;
      if (res.status === 404) {
        agencyData = null;
        body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3)">
          No agency offerings uploaded yet. Drop bullets + callables Excel files on the Upload page.
        </td></tr>`;
        sub.textContent = 'No agency data';
        document.getElementById('agenciesStat').textContent = '0';
        document.getElementById('agenciesKicker').textContent = 'Empty';
        renderStatTiles('agencyStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Bullets', value: '—' },
          { label: 'Callables', value: '—' },
          { label: 'Average YTM', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      agencyData = await res.json();
    } catch (e) {
      console.error('Failed to load agencies:', e);
      body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load agencies: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error';
      return;
    }
    populateAgencyFilters();
    renderAgencies();
  }

  function populateAgencyFilters() {
    if (!agencyData || !agencyData.offerings) return;
    const off = agencyData.offerings;

    // Build ticker checklist from the data
    const tickers = [...new Set(off.map(o => o.ticker))].filter(Boolean).sort();
    const tickerBox = document.getElementById('af-tickers');
    tickerBox.innerHTML = tickers.map(t => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(t)}" ${agencyFilters.tickers.has(t) ? 'checked' : ''}>
        <span>${escapeHtml(t)}</span>
      </label>`).join('');

    // Call types checklist (from data — handles whatever the trader sends)
    const callTypes = [...new Set(off.map(o => o.callType).filter(Boolean))].sort();
    const ctBox = document.getElementById('af-callTypes');
    ctBox.innerHTML = callTypes.length
      ? callTypes.map(t => `
          <label class="chk-pill">
            <input type="checkbox" value="${escapeHtml(t)}" ${agencyFilters.callTypes.has(t) ? 'checked' : ''}>
            <span>${escapeHtml(t)}</span>
          </label>`).join('')
      : '<span class="no-restrict">— no call types in data —</span>';

    // Wire up check-listeners (event delegation)
    tickerBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        const v = e.target.value;
        if (e.target.checked) agencyFilters.tickers.add(v); else agencyFilters.tickers.delete(v);
        if (agencyData) renderAgencies();
      }
    };
    ctBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        const v = e.target.value;
        if (e.target.checked) agencyFilters.callTypes.add(v); else agencyFilters.callTypes.delete(v);
        if (agencyData) renderAgencies();
      }
    };

    const fdate = agencyData.fileDate ? ` &middot; File dated ${formatNumericDate(agencyData.fileDate)}` : '';
    const udate = agencyData.uploadedAt ? ` &middot; Uploaded ${formatNumericDate(agencyData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('agenciesSub').innerHTML = `${off.length} agency offerings${udate}${fdate}`;
    document.getElementById('agenciesKicker').textContent = agencyData.fileDate
      ? `File ${formatNumericDate(agencyData.fileDate)}`
      : 'Current';
    renderCommissionControl('agencies', 'agencyStatTiles');
  }

  async function loadAgencyTreasuryData() {
    try {
      const res = await fetch('/api/economic-update', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data && data.treasuries) && data.treasuries.length ? data : null;
    } catch (e) {
      return null;
    }
  }

  function agencySpreadBasis(record, priceOverride, yields) {
    if (!record) return null;
    const price = priceOverride == null ? record.askPrice : priceOverride;
    const ytm = yields ? yields.ytm : record.ytm;
    const ytnc = yields ? yields.ytnc : record.ytnc;
    const isPremium = Number(price) >= 100;

    if (record.structure === 'Callable' && isPremium && record.nextCallDate && ytnc != null) {
      return { date: record.nextCallDate, yieldPct: ytnc, label: 'call', key: 'ytnc' };
    }
    if (record.maturity && ytm != null) {
      return { date: record.maturity, yieldPct: ytm, label: 'maturity', key: 'ytm' };
    }
    if (record.nextCallDate && ytnc != null) {
      return { date: record.nextCallDate, yieldPct: ytnc, label: 'call', key: 'ytnc' };
    }
    return null;
  }

  function effectiveAgencyBenchmark(record) {
    if (record && record.structure !== 'Callable' && record.benchmark) return record.benchmark;
    const treasury = treasuryForAgencyRecord(record);
    if (treasury) return treasury.label;
    return record && record.benchmark ? record.benchmark : null;
  }

  function effectiveAgencySpread(record) {
    if (!record) return null;
    if (record.structure !== 'Callable' && record.askSpread != null) return record.askSpread;
    const basis = agencySpreadBasis(record);
    const treasury = treasuryForAgencyRecord(record);
    if (!basis || !treasury || treasury.yield == null) return null;
    return (basis.yieldPct - treasury.yield) * 100;
  }

  function treasuryForAgencyRecord(record) {
    const basis = agencySpreadBasis(record);
    return treasuryForAgencyBasis(basis);
  }

  function treasuryForAgencyBasis(basis) {
    const curve = agencyTreasuryCurve();
    if (!basis || !curve.length) return null;
    const months = monthsBetween(new Date(), parseIsoDate(basis.date));
    if (!isFinite(months) || months <= 0) return null;
    return interpolateTreasuryYield(curve, months);
  }

  function agencyTreasuryCurve() {
    const rows = Array.isArray(agencyTreasuryData && agencyTreasuryData.treasuries)
      ? agencyTreasuryData.treasuries
      : [];
    return rows
      .map(row => ({
        months: tenorToMonths(row.tenor),
        label: row.label || row.tenor,
        yield: row.yield
      }))
      .filter(row => row.months != null && row.yield != null)
      .sort((a, b) => a.months - b.months);
  }

  function tenorToMonths(tenor) {
    const match = String(tenor || '').match(/^(\d+)(MO|M|YR|Y)$/i);
    if (!match) return null;
    const n = Number(match[1]);
    if (!isFinite(n)) return null;
    return /^M/i.test(match[2]) ? n : n * 12;
  }

  function interpolateTreasuryYield(curve, targetMonths) {
    if (!curve.length) return null;
    if (targetMonths <= curve[0].months) {
      return { ...curve[0], label: curve[0].label };
    }
    const last = curve[curve.length - 1];
    if (targetMonths >= last.months) {
      return { ...last, label: last.label };
    }
    for (let i = 1; i < curve.length; i++) {
      const left = curve[i - 1];
      const right = curve[i];
      if (targetMonths <= right.months) {
        const weight = (targetMonths - left.months) / (right.months - left.months);
        const interpolated = left.yield + ((right.yield - left.yield) * weight);
        return {
          months: targetMonths,
          yield: interpolated,
          label: nearestTreasuryLabel(left, right, targetMonths)
        };
      }
    }
    return null;
  }

  function nearestTreasuryLabel(left, right, targetMonths) {
    const nearest = Math.abs(targetMonths - left.months) <= Math.abs(right.months - targetMonths)
      ? left
      : right;
    return nearest.label;
  }

  function applyAgencyFilters(offerings) {
    const f = agencyFilters;
    return offerings.filter(o => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(o.cusip && o.cusip.toLowerCase().includes(q)) &&
            !(o.ticker && o.ticker.toLowerCase().includes(q))) return false;
      }
      if (f.structures.size > 0 && !f.structures.has(o.structure)) return false;
      if (f.callTypes.size > 0 && !f.callTypes.has(o.callType)) return false;
      if (f.maturityFrom && (!o.maturity || o.maturity < f.maturityFrom)) return false;
      if (f.maturityTo   && (!o.maturity || o.maturity > f.maturityTo))   return false;
      if (f.nextCallFrom && (!o.nextCallDate || o.nextCallDate < f.nextCallFrom)) return false;
      if (f.nextCallTo   && (!o.nextCallDate || o.nextCallDate > f.nextCallTo))   return false;
      if (f.minCoupon != null && (o.coupon == null || o.coupon < f.minCoupon)) return false;
      if (f.maxCoupon != null && (o.coupon == null || o.coupon > f.maxCoupon)) return false;
      if (f.minYtm != null && (o.ytm == null || o.ytm < f.minYtm)) return false;
      if (f.minYtnc != null && (o.ytnc == null || o.ytnc < f.minYtnc)) return false;
      if (f.minPrice != null && (o.askPrice == null || o.askPrice < f.minPrice)) return false;
      if (f.maxPrice != null && (o.askPrice == null || o.askPrice > f.maxPrice)) return false;
      if (f.minQty != null && (o.availableSize == null || o.availableSize < f.minQty)) return false;
      return true;
    });
  }

  function sortAgenciesInPlace(arr) {
    const { col, dir } = agencySort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (col === 'askSpread') {
        av = effectiveAgencySpread(a);
        bv = effectiveAgencySpread(b);
      }
      if (col === 'benchmark') {
        av = effectiveAgencyBenchmark(a);
        bv = effectiveAgencyBenchmark(b);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function renderAgencies() {
    const body = document.getElementById('agenciesBody');
    if (!agencyData) return;
    const filtered = applyAgencyFilters(agencyData.offerings);
    sortAgenciesInPlace(filtered);
    document.getElementById('agenciesStat').textContent = filtered.length;
    renderStatTiles('agencyStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Bullets', value: formatNumber(filtered.filter(o => o.structure === 'Bullet').length) },
      { label: 'Callables', value: formatNumber(filtered.filter(o => o.structure === 'Callable').length) },
      { label: 'Average YTM', value: formatPercentTile(average(filtered.map(o => o.ytm)), 3) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3)">
        No agencies match the current filters.
      </td></tr>`;
      return;
    }

    const fmt = (v, d = 3) => v == null ? '<span class="no-restrict">&mdash;</span>' : v.toFixed(d);
    const fmtDate = v => v ? formatNumericDate(v) : '<span class="no-restrict">&mdash;</span>';

    body.innerHTML = filtered.map(o => {
      const structureClass = o.structure === 'Bullet' ? 'structure-bullet' : 'structure-callable';
      const benchmark = effectiveAgencyBenchmark(o);
      return `
        <tr>
          <td><span class="structure-pill ${structureClass}">${escapeHtml(o.structure)}</span></td>
          <td><span class="ticker-pill">${escapeHtml(o.ticker || '')}</span></td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td>${fmtDate(o.maturity)}</td>
          <td>${fmtDate(o.nextCallDate)}</td>
          <td>${o.callType ? `<span class="calltype-chip">${escapeHtml(o.callType)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td style="text-align:right" class="rate-cell">${commissionYieldHtml(o, 'ytm', 3)}</td>
          <td style="text-align:right" class="rate-cell">${commissionYieldHtml(o, 'ytnc', 3)}</td>
          <td style="text-align:right">${commissionPriceHtml('agencies', o, o.askPrice, 3)}</td>
          <td style="text-align:right" class="qnty-cell">${fmt(o.availableSize, 3)}</td>
          <td style="text-align:right">${commissionSpreadHtml(o)}</td>
          <td>${benchmark ? escapeHtml(benchmark) : '<span class="no-restrict">&mdash;</span>'}</td>
        </tr>`;
    }).join('');
  }

  function setupAgencyFilters() {
    const byId = id => document.getElementById(id);
    const search = byId('af-search');
    if (!search) return;  // agencies page not in DOM

    search.addEventListener('input', () => {
      agencyFilters.search = search.value.trim();
      if (agencyData) renderAgencies();
    });

    // Structure multi-select (Bullet / Callable)
    document.querySelectorAll('#af-structures input[type="checkbox"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) agencyFilters.structures.add(el.value);
        else agencyFilters.structures.delete(el.value);
        if (agencyData) renderAgencies();
      });
    });

    // Wire the date / number range fields
    const numFields = [
      ['af-matFrom', 'maturityFrom', 'str'],
      ['af-matTo',   'maturityTo',   'str'],
      ['af-callFrom','nextCallFrom', 'str'],
      ['af-callTo',  'nextCallTo',   'str'],
      ['af-minCoupon','minCoupon', 'num'],
      ['af-maxCoupon','maxCoupon', 'num'],
      ['af-minYtm',  'minYtm',  'num'],
      ['af-minYtnc', 'minYtnc', 'num'],
      ['af-minPrice','minPrice','num'],
      ['af-maxPrice','maxPrice','num'],
      ['af-minQty',  'minQty',  'num']
    ];
    for (const [id, key, kind] of numFields) {
      const el = byId(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        if (kind === 'num') {
          const v = parseFloat(el.value);
          agencyFilters[key] = isNaN(v) ? null : v;
        } else {
          agencyFilters[key] = el.value || null;
        }
        if (agencyData) renderAgencies();
      });
    }

    byId('af-reset').addEventListener('click', () => {
      agencyFilters = {
        search: '', tickers: new Set(), structures: new Set(), callTypes: new Set(),
        maturityFrom: null, maturityTo: null, nextCallFrom: null, nextCallTo: null,
        minCoupon: null, maxCoupon: null, minYtm: null,
        minYtnc: null, minPrice: null, maxPrice: null, minQty: null
      };
      search.value = '';
      numFields.forEach(([id]) => { const el = byId(id); if (el) el.value = ''; });
      document.querySelectorAll('#af-structures input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#af-tickers  input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#af-callTypes input[type="checkbox"]').forEach(el => el.checked = false);
      if (agencyData) renderAgencies();
    });

    byId('af-export').addEventListener('click', exportAgenciesCsv);

    document.querySelectorAll('#p-agencies th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (agencySort.col === col) {
          agencySort.dir = agencySort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          agencySort.col = col;
          agencySort.dir = (col === 'coupon' || col === 'ytm' || col === 'ytnc' ||
                            col === 'askPrice' || col === 'availableSize') ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-agencies th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(agencySort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (agencyData) renderAgencies();
      });
    });
  }

  function exportAgenciesCsv() {
    if (!agencyData) return showToast('No agency data loaded', true);
    const filtered = applyAgencyFilters(agencyData.offerings);
    sortAgenciesInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['Structure','Ticker','CUSIP','Coupon','Maturity','NextCallDate','CallType',
                    'SpreadBasis','SpreadYield','MarkedSpreadBasis','MarkedSpreadYield','YTM','MarkedYTM','YTNC','MarkedYTNC','AskPrice','SalesCommissionMethod','SalesCommissionValue','PriceMarkup','ClientPrice','AvailableSize','AskSpread','MarkedSpread','Benchmark',
                    'Settle','CostBasis','Notes','SourceCommissionBp'];
    const rows = filtered.map(o => {
      const marked = markedAgencyValues(o);
      const spreadBasis = agencySpreadBasis(o);
      const spread = effectiveAgencySpread(o);
      const benchmark = effectiveAgencyBenchmark(o);
      return [
      o.structure, o.ticker, o.cusip,
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.callType || '',
      spreadBasis ? spreadBasis.label : '',
      spreadBasis && spreadBasis.yieldPct != null ? spreadBasis.yieldPct.toFixed(3) : '',
      marked && marked.markedSpreadBasis ? marked.markedSpreadBasis.label : '',
      marked && marked.markedSpreadBasis && marked.markedSpreadBasis.yieldPct != null ? marked.markedSpreadBasis.yieldPct.toFixed(3) : '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      marked && marked.markedYtm != null ? marked.markedYtm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      marked && marked.markedYtnc != null ? marked.markedYtnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      marked ? marked.method : '',
      marked ? marked.value.toString() : '',
      marked ? marked.priceMarkup.toFixed(3) : '',
      marked ? marked.clientPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(3) : '',
      spread != null ? spread.toFixed(1) : '',
      marked && marked.markedSpread != null ? marked.markedSpread.toFixed(1) : '',
      benchmark || '',
      o.settle || '',
      o.costBasis != null ? o.costBasis.toFixed(3) : '',
      o.notes || '',
      o.commissionBp != null ? o.commissionBp.toString() : ''
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');

    const stamp = (agencyData.fileDate || 'agencies').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_agencies_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} agency offerings`);
  }

  // ============ Corporates Explorer ============

  let corpData = null;
  let corpFilters = {
    search: '',
    sectors: new Set(),
    paymentRanks: new Set(),
    creditTier: '',          // '' | 'IG' | 'HY' | 'AAA/AA' | 'A' | 'BBB' | 'NR'
    callable: '',            // '' | 'callable' | 'noncall'
    maturityFrom: null,
    maturityTo: null,
    nextCallFrom: null,
    nextCallTo: null,
    minCoupon: null, maxCoupon: null,
    minYtm: null,
    minPrice: null, maxPrice: null,
    minQty: null
  };
  let corpSort = { col: 'maturity', dir: 'asc' };

  async function loadCorporates() {
    const body = document.getElementById('corporatesBody');
    const sub = document.getElementById('corporatesSub');
    try {
      const res = await fetch('/api/corporates', { cache: 'no-store' });
      if (res.status === 404) {
        corpData = null;
        body.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--text3)">
          No corporate offerings uploaded yet. Drop the corporates Excel file on the Upload page.
        </td></tr>`;
        sub.textContent = 'No corporate data';
        document.getElementById('corporatesStat').textContent = '0';
        document.getElementById('corporatesKicker').textContent = 'Empty';
        renderStatTiles('corpStatTiles', [
          { label: 'Shown', value: '0' },
          { label: 'Investment Grade', value: '—' },
          { label: 'High Yield', value: '—' },
          { label: 'Average YTM', value: '—' }
        ]);
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      corpData = await res.json();
    } catch (e) {
      console.error('Failed to load corporates:', e);
      body.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load corporates: ${escapeHtml(e.message)}
      </td></tr>`;
      sub.textContent = 'Error';
      return;
    }
    populateCorpFilters();
    renderCorporates();
  }

  function populateCorpFilters() {
    if (!corpData || !corpData.offerings) return;
    const off = corpData.offerings;

    // Sector multi-select
    const sectors = [...new Set(off.map(o => o.sector).filter(Boolean))].sort();
    const sectorBox = document.getElementById('cf-sectors');
    sectorBox.innerHTML = sectors.map(s => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(s)}" ${corpFilters.sectors.has(s) ? 'checked' : ''}>
        <span>${escapeHtml(s)}</span>
      </label>`).join('');

    // Payment rank multi-select
    const ranks = [...new Set(off.map(o => o.paymentRank).filter(Boolean))].sort();
    const rankBox = document.getElementById('cf-ranks');
    rankBox.innerHTML = ranks.map(r => `
      <label class="chk-pill">
        <input type="checkbox" value="${escapeHtml(r)}" ${corpFilters.paymentRanks.has(r) ? 'checked' : ''}>
        <span>${escapeHtml(r)}</span>
      </label>`).join('');

    // Wire checklist listeners via delegation
    sectorBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        if (e.target.checked) corpFilters.sectors.add(e.target.value);
        else corpFilters.sectors.delete(e.target.value);
        if (corpData) renderCorporates();
      }
    };
    rankBox.onchange = e => {
      if (e.target.matches('input[type="checkbox"]')) {
        if (e.target.checked) corpFilters.paymentRanks.add(e.target.value);
        else corpFilters.paymentRanks.delete(e.target.value);
        if (corpData) renderCorporates();
      }
    };
    const fdate = corpData.fileDate ? ` &middot; File dated ${formatNumericDate(corpData.fileDate)}` : '';
    const udate = corpData.uploadedAt ? ` &middot; Uploaded ${formatNumericDate(corpData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('corporatesSub').innerHTML = `${off.length} corporate bonds${udate}${fdate}`;
    document.getElementById('corporatesKicker').textContent = corpData.fileDate
      ? `File ${formatNumericDate(corpData.fileDate)}`
      : 'Current';
    renderCommissionControl('corporates', 'corpStatTiles');
  }

  function applyCorpFilters(offerings) {
    const f = corpFilters;
    return offerings.filter(o => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!(o.issuerName && o.issuerName.toLowerCase().includes(q)) &&
            !(o.cusip && o.cusip.toLowerCase().includes(q)) &&
            !(o.ticker && o.ticker.toLowerCase().includes(q))) return false;
      }
      if (f.sectors.size > 0 && !f.sectors.has(o.sector)) return false;
      if (f.paymentRanks.size > 0 && !f.paymentRanks.has(o.paymentRank)) return false;
      if (f.creditTier === 'IG' && !o.investmentGrade) return false;
      if (f.creditTier === 'HY' && o.investmentGrade) return false;
      if ((f.creditTier === 'AAA/AA' || f.creditTier === 'A' || f.creditTier === 'BBB' || f.creditTier === 'NR') &&
          o.creditTier !== f.creditTier) return false;
      if (f.callable === 'callable' && !o.nextCallDate) return false;
      if (f.callable === 'noncall' && o.nextCallDate) return false;
      if (f.maturityFrom && (!o.maturity || o.maturity < f.maturityFrom)) return false;
      if (f.maturityTo   && (!o.maturity || o.maturity > f.maturityTo))   return false;
      if (f.nextCallFrom && (!o.nextCallDate || o.nextCallDate < f.nextCallFrom)) return false;
      if (f.nextCallTo   && (!o.nextCallDate || o.nextCallDate > f.nextCallTo))   return false;
      if (f.minCoupon != null && (o.coupon == null || o.coupon < f.minCoupon)) return false;
      if (f.maxCoupon != null && (o.coupon == null || o.coupon > f.maxCoupon)) return false;
      if (f.minYtm != null && (o.ytm == null || o.ytm < f.minYtm)) return false;
      if (f.minPrice != null && (o.askPrice == null || o.askPrice < f.minPrice)) return false;
      if (f.maxPrice != null && (o.askPrice == null || o.askPrice > f.maxPrice)) return false;
      if (f.minQty != null && (o.availableSize == null || o.availableSize < f.minQty)) return false;
      return true;
    });
  }

  function sortCorpInPlace(arr) {
    const { col, dir } = corpSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[col], bv = b[col];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }

  function renderCorporates() {
    const body = document.getElementById('corporatesBody');
    if (!corpData) return;
    const filtered = applyCorpFilters(corpData.offerings);
    sortCorpInPlace(filtered);
    document.getElementById('corporatesStat').textContent = filtered.length;
    renderStatTiles('corpStatTiles', [
      { label: 'Shown', value: formatNumber(filtered.length) },
      { label: 'Investment Grade', value: formatNumber(filtered.filter(o => o.investmentGrade).length) },
      { label: 'High Yield', value: formatNumber(filtered.filter(o => !o.investmentGrade).length) },
      { label: 'Average YTM', value: formatPercentTile(average(filtered.map(o => o.ytm)), 3) }
    ]);

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--text3)">
        No corporates match the current filters.
      </td></tr>`;
      return;
    }

    const fmt = (v, d = 3) => v == null ? '<span class="no-restrict">&mdash;</span>' : v.toFixed(d);
    const fmtDate = v => v ? formatNumericDate(v) : '<span class="no-restrict">&mdash;</span>';
    const tierClass = t => ({
      'AAA/AA': 'tier-aaa',
      'A': 'tier-a',
      'BBB': 'tier-bbb',
      'HY': 'tier-hy',
      'NR': 'tier-nr'
    })[t] || 'tier-nr';

    body.innerHTML = filtered.map(o => {
      const ratings = [];
      if (o.moodysRating) ratings.push(`<span class="rating-moody">${escapeHtml(o.moodysRating)}</span>`);
      if (o.spRating)     ratings.push(`<span class="rating-sp">${escapeHtml(o.spRating)}</span>`);
      const ratingCell = ratings.length ? ratings.join(' ') : '<span class="no-restrict">&mdash;</span>';

      return `
        <tr>
          <td><span class="tier-pill ${tierClass(o.creditTier)}">${escapeHtml(o.creditTier)}</span></td>
          <td class="rating-cell">${ratingCell}</td>
          <td class="issuer-cell"><strong>${escapeHtml(o.issuerName || '')}</strong></td>
          <td>${o.ticker ? `<span class="ticker-pill">${escapeHtml(o.ticker)}</span>` : ''}</td>
          <td>${o.sector ? `<span class="sector-chip">${escapeHtml(o.sector)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td>${o.paymentRank ? `<span class="rank-chip ${o.paymentRank === 'Subordinated' ? 'rank-sub' : ''}">${escapeHtml(o.paymentRank)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td>${fmtDate(o.maturity)}</td>
          <td>${fmtDate(o.nextCallDate)}</td>
          <td style="text-align:right" class="rate-cell">${commissionCorporateYieldHtml(o, 'ytm', 3)}</td>
          <td style="text-align:right" class="rate-cell">${commissionCorporateYieldHtml(o, 'ytnc', 3)}</td>
          <td style="text-align:right">${commissionPriceHtml('corporates', o, o.askPrice, 3)}</td>
          <td style="text-align:right" class="qnty-cell">${fmt(o.availableSize, 0)}</td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
        </tr>`;
    }).join('');
  }

  function setupCorpFilters() {
    const byId = id => document.getElementById(id);
    const search = byId('cf-search');
    if (!search) return;

    search.addEventListener('input', () => {
      corpFilters.search = search.value.trim();
      if (corpData) renderCorporates();
    });

    byId('cf-tier').addEventListener('change', e => {
      corpFilters.creditTier = e.target.value;
      if (corpData) renderCorporates();
    });

    byId('cf-callable').addEventListener('change', e => {
      corpFilters.callable = e.target.value;
      if (corpData) renderCorporates();
    });

    const numFields = [
      ['cf-matFrom', 'maturityFrom', 'str'],
      ['cf-matTo',   'maturityTo',   'str'],
      ['cf-callFrom','nextCallFrom', 'str'],
      ['cf-callTo',  'nextCallTo',   'str'],
      ['cf-minCoupon','minCoupon', 'num'],
      ['cf-maxCoupon','maxCoupon', 'num'],
      ['cf-minYtm',  'minYtm',  'num'],
      ['cf-minPrice','minPrice','num'],
      ['cf-maxPrice','maxPrice','num'],
      ['cf-minQty',  'minQty',  'num']
    ];
    for (const [id, key, kind] of numFields) {
      const el = byId(id);
      if (!el) continue;
      el.addEventListener('input', () => {
        if (kind === 'num') {
          const v = parseFloat(el.value);
          corpFilters[key] = isNaN(v) ? null : v;
        } else {
          corpFilters[key] = el.value || null;
        }
        if (corpData) renderCorporates();
      });
    }

    byId('cf-reset').addEventListener('click', () => {
      corpFilters = {
        search: '', sectors: new Set(), paymentRanks: new Set(),
        creditTier: '', callable: '',
        maturityFrom: null, maturityTo: null, nextCallFrom: null, nextCallTo: null,
        minCoupon: null, maxCoupon: null, minYtm: null,
        minPrice: null, maxPrice: null, minQty: null
      };
      search.value = '';
      byId('cf-tier').value = '';
      byId('cf-callable').value = '';
      numFields.forEach(([id]) => { const el = byId(id); if (el) el.value = ''; });
      document.querySelectorAll('#cf-sectors input[type="checkbox"]').forEach(el => el.checked = false);
      document.querySelectorAll('#cf-ranks input[type="checkbox"]').forEach(el => el.checked = false);
      if (corpData) renderCorporates();
    });

    byId('cf-export').addEventListener('click', exportCorpCsv);

    document.querySelectorAll('#p-corporates th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (corpSort.col === col) {
          corpSort.dir = corpSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          corpSort.col = col;
          corpSort.dir = (col === 'coupon' || col === 'ytm' || col === 'ytnc' ||
                          col === 'askPrice' || col === 'availableSize') ? 'desc' : 'asc';
        }
        document.querySelectorAll('#p-corporates th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(corpSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        if (corpData) renderCorporates();
      });
    });
  }

  function exportCorpCsv() {
    if (!corpData) return showToast('No corporate data loaded', true);
    const filtered = applyCorpFilters(corpData.offerings);
    sortCorpInPlace(filtered);
    if (filtered.length === 0) return showToast('No offerings match filters', true);

    const header = ['CreditTier','Moodys','SP','Issuer','Ticker','Sector','PaymentRank',
                    'Coupon','Maturity','NextCallDate','YTM','MarkedYTM','YTNC','MarkedYTNC',
                    'AskPrice','SalesCommissionMethod','SalesCommissionValue','PriceMarkup','ClientPrice',
                    'AvailableSize','AmtOut','Series','CUSIP','AskSpread','MarkedSpread','Benchmark','FloaterSpread'];
    const rows = filtered.map(o => {
      const marked = markedCorporateValues(o);
      return [
      o.creditTier, o.moodysRating || '', o.spRating || '',
      o.issuerName, o.ticker || '', o.sector || '', o.paymentRank || '',
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      marked && marked.markedYtm != null ? marked.markedYtm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      marked && marked.markedYtnc != null ? marked.markedYtnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      marked ? marked.method : '',
      marked ? marked.value.toString() : '',
      marked ? marked.priceMarkup.toFixed(3) : '',
      marked ? marked.clientPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(0) : '',
      o.amtOutRaw || '',
      o.series || '',
      o.cusip,
      o.askSpread != null ? o.askSpread.toString() : '',
      marked && marked.markedSpread != null ? marked.markedSpread.toFixed(1) : '',
      o.benchmark || '',
      o.floaterSpread != null ? o.floaterSpread.toString() : ''
      ];
    });
    const csv = [header, ...rows]
      .map(r => r.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');

    const stamp = (corpData.fileDate || 'corporates').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fbbs_corporates_${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast(`Exported ${filtered.length} corporate offerings`);
  }

  // ============ Admin / Audit Log ============

  async function loadAuditLog() {
    const body = document.getElementById('adminBody');
    const stat = document.getElementById('adminStat');
    try {
      const res = await fetch('/api/audit-log', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const entries = await res.json();
      stat.textContent = entries.length;

      if (entries.length === 0) {
        body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">
          No publishes recorded yet.
        </td></tr>`;
        return;
      }

      body.innerHTML = entries.map(e => {
        const files = Array.isArray(e.files)
          ? e.files.map(f => `<span class="file-chip" title="${formatSize(f.size)}">${escapeHtml(f.type)}</span>`).join('')
          : '';
        const warnings = Array.isArray(e.warnings) && e.warnings.length
          ? `<div class="admin-warnings">${e.warnings.map(w => `&#9888; ${escapeHtml(w)}`).join('<br>')}</div>`
          : '<div class="admin-clean">No warnings</div>';
        const cdCount = e.offeringsCount != null ? e.offeringsCount : '—';
        const muniCount = e.muniOfferingsCount != null ? e.muniOfferingsCount : '—';
        const agencyCountCell = e.agencyCount != null ? e.agencyCount : '—';
        const corpCountCell = e.corporatesCount != null ? e.corporatesCount : '—';
        return `
          <tr>
            <td>${formatFullTimestamp(e.at)}</td>
            <td class="arch-date-cell">${formatShortDate(e.packageDate)}</td>
            <td>${escapeHtml(e.publishedBy || '—')}</td>
            <td>${files}${warnings}</td>
            <td style="text-align:right">${cdCount}</td>
            <td style="text-align:right">${muniCount}</td>
            <td style="text-align:right">${agencyCountCell}</td>
            <td style="text-align:right">${corpCountCell}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load audit log:', err);
      body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger)">
        Failed to load audit log: ${escapeHtml(err.message)}
      </td></tr>`;
    }
  }

  function formatFullTimestamp(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return iso; }
  }

  // ============ Init ============

  function init() {
    setHeaderDate();
    loadCurrent();
    loadArchive();
    setupUpload();
    setupGlobalSearch();
    setupCdCostCalculator();
    setupEconomicMarketTool();
    setupNavSearch();
    setupMarketNav();
    setupCdRecap();
    setupOfferingsFilters();
    setupMuniFilters();
    setupAgencyFilters();
    setupCorpFilters();
    setupBankSearch();
    setupStrategies();
    setupCommissionControls();
    setupSidebar();

    // Respect a hash on initial load (e.g. bookmarked /#archive)
    const h = (window.location.hash || '#home').slice(1);
    const target = VALID_PAGES.includes(h) ? h : 'home';
    goTo(target, { updateHash: false });
  }

  function setupSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!toggle || !sidebar || !backdrop) return;

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    });
    // On mobile, tapping a nav link should close the sidebar
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.remove('open');
          backdrop.classList.remove('show');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
