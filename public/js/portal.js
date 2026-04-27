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
                       'archive', 'upload', 'builder', 'admin'];

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

  function formatPercent(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function formatPercentTile(n, digits = 2) {
    if (n == null || isNaN(n)) return '—';
    return `${formatPercent(n, digits)}%`;
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
      : 'None';

    setText('qualityFiles', fileText);
    setText('uploadQualityFiles', fileText);
    setText('qualityDates', dateText);
    setText('uploadQualityDates', dateText);
    setText('qualityCounts', qualitySummary.countsText);
    setText('uploadQualityCounts', qualitySummary.countsText);
    setText('qualityWarnings', warningsText);
    setText('uploadQualityWarnings', warningsText);

    ['qualityDates', 'uploadQualityDates'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('warn', qualitySummary.datesMatch === false);
      el.classList.toggle('ok', qualitySummary.datesMatch === true);
    });
    ['qualityWarnings', 'uploadQualityWarnings'].forEach(id => {
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

    const page = document.getElementById('p-' + pageName);
    if (page) page.classList.add('active');

    const link = document.querySelector('.nav-link[data-page="' + pageName + '"]');
    if (link) link.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'auto' });

    if (updateHash && window.location.hash !== '#' + pageName) {
      history.replaceState(null, '', '#' + pageName);
    }

    if (pageName === 'archive') loadArchive();
    if (pageName === 'cd-recap') loadCdRecap();
    if (pageName === 'explorer') loadOfferings();
    if (pageName === 'muni-explorer') loadMuniOfferings();
    if (pageName === 'agencies') loadAgencies();
    if (pageName === 'corporates') loadCorporates();
    if (pageName === 'builder') loadDashboardBuilderStatus();
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
        <div class="doc-card-ribbon">
          <span>Document ${i + 1} of ${TOTAL_SLOTS}</span>
          <span class="type-pill">${meta.ext}</span>
        </div>
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

    document.getElementById('homeStat').textContent = `${filled} / ${TOTAL_SLOTS}`;

    const subtitle = document.getElementById('homeSubtitle');
    const kicker = document.getElementById('homeKicker');

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
    renderHomeMarketTiles();
    renderGlobalSearch();
  }

  function normalizeSearchText(parts) {
    return parts.filter(v => v != null && v !== '').join(' ').toLowerCase();
  }

  function buildSearchRows() {
    const rows = [];
    (marketData.cds || []).forEach(o => rows.push({
      type: 'CD',
      title: o.name,
      subtitle: `${formatPercentTile(o.rate, 2)} · ${o.term} · ${formatShortDate(o.maturity)}`,
      meta: o.cusip,
      page: 'explorer',
      searchText: normalizeSearchText([o.name, o.cusip, o.issuerState, o.term, o.couponFrequency])
    }));
    (marketData.munis || []).forEach(o => rows.push({
      type: 'Muni',
      title: o.issuerName,
      subtitle: `${o.section || 'Muni'} · ${o.issuerState || ''} · ${formatPercentTile(o.ytw, 3)}`,
      meta: o.cusip,
      page: 'muni-explorer',
      searchText: normalizeSearchText([o.issuerName, o.cusip, o.issuerState, o.section, o.issueType, o.moodysRating, o.spRating])
    }));
    (marketData.agencies || []).forEach(o => rows.push({
      type: 'Agency',
      title: `${o.ticker || 'Agency'} ${o.cusip || ''}`,
      subtitle: `${o.structure || ''} · ${formatPercentTile(o.ytm, 3)} · ${formatShortDate(o.maturity)}`,
      meta: o.callType || o.benchmark || '',
      page: 'agencies',
      searchText: normalizeSearchText([o.ticker, o.cusip, o.structure, o.callType, o.benchmark])
    }));
    (marketData.corporates || []).forEach(o => rows.push({
      type: 'Corporate',
      title: o.issuerName,
      subtitle: `${o.ticker || ''} · ${o.creditTier || ''} · ${formatPercentTile(o.ytm, 3)}`,
      meta: o.cusip,
      page: 'corporates',
      searchText: normalizeSearchText([o.issuerName, o.ticker, o.cusip, o.sector, o.paymentRank, o.creditTier, o.moodysRating, o.spRating])
    }));
    return rows;
  }

  function renderGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const results = document.getElementById('globalSearchResults');
    if (!input || !results) return;

    const q = input.value.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '<div class="global-empty">Start typing to search CDs, munis, agencies, and corporates.</div>';
      return;
    }

    const terms = q.split(/\s+/).filter(Boolean);
    const matches = buildSearchRows()
      .filter(row => terms.every(term => row.searchText.includes(term)))
      .slice(0, 12);

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
      frame.innerHTML = `<iframe src="${src}" title="${meta.label}"></iframe>`;
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

    const viewFirst = day.dashboard || day.econ || day.cd || day.cdoffers;
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

  // ============ Dashboard Builder ============

  async function loadDashboardBuilderStatus() {
    let status = null;
    try {
      const res = await fetch('/api/sales-dashboard/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      status = await res.json();
    } catch (e) {
      showToast('Could not load dashboard builder status: ' + e.message, true);
      return;
    }
    renderDashboardBuilderStatus(status);
  }

  function renderDashboardBuilderStatus(status) {
    const stat = document.getElementById('builderStat');
    const kicker = document.getElementById('builderKicker');
    const grid = document.getElementById('builderStatusGrid');
    const checks = document.getElementById('builderChecks');
    const preview = document.getElementById('previewDashboardBtn');
    const publish = document.getElementById('publishDashboardBtn');
    if (!grid) return;

    const draft = status.draft || null;
    const passed = draft && draft.report && draft.report.passed;
    if (stat) stat.textContent = draft ? (passed ? 'Pass' : 'Review') : 'Draft';
    if (kicker) kicker.textContent = draft
      ? `Draft generated ${formatTime(draft.generatedAt)}`
      : 'No draft generated yet';

    const data = status.availableData || {};
    const counts = status.counts || {};
    const tiles = [
      { label: 'Template', value: status.templatePresent ? 'Ready' : 'Missing' },
      { label: 'CDs', value: data.cds ? `${formatNumber(counts.cds)} rows` : 'Missing' },
      { label: 'Munis', value: data.munis ? `${formatNumber(counts.munis)} rows` : 'Missing' },
      { label: 'Agencies', value: data.agencies ? `${formatNumber(counts.agencies)} rows` : 'Missing' },
      { label: 'Corporates', value: data.corporates ? `${formatNumber(counts.corporates)} rows` : 'Missing' },
      { label: 'Published HTML', value: status.currentDashboard || 'Not published' }
    ];
    grid.innerHTML = tiles.map(t => `
      <div class="stat-tile">
        <span>${escapeHtml(t.label)}</span>
        <strong>${escapeHtml(String(t.value))}</strong>
      </div>
    `).join('');

    if (draft && draft.filename) {
      preview.href = '/current/' + encodeURIComponent(draft.filename);
      preview.classList.remove('disabled-link');
      publish.disabled = !(draft.report && draft.report.passed);
    } else {
      preview.href = '#';
      preview.classList.add('disabled-link');
      publish.disabled = true;
    }

    if (!draft || !draft.report) {
      checks.innerHTML = '<div class="global-empty">Generate a draft to run preflight checks.</div>';
      return;
    }
    checks.innerHTML = draft.report.checks.map(c => `
      <div class="check-row ${c.ok ? 'ok' : 'warn'}">
        <span>${c.ok ? 'Pass' : 'Review'}</span>
        <strong>${escapeHtml(c.label)}</strong>
      </div>
    `).join('');
  }

  function setupDashboardBuilder() {
    const generate = document.getElementById('generateDashboardBtn');
    const publish = document.getElementById('publishDashboardBtn');
    if (generate) {
      generate.addEventListener('click', async () => {
        generate.disabled = true;
        generate.textContent = 'Generating...';
        try {
          const res = await fetch('/api/sales-dashboard/generate', { method: 'POST' });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Generation failed');
          showToast('Dashboard draft generated');
          await loadDashboardBuilderStatus();
        } catch (e) {
          showToast(e.message, true);
        } finally {
          generate.disabled = false;
          generate.textContent = 'Generate Draft';
        }
      });
    }
    if (publish) {
      publish.addEventListener('click', async () => {
        publish.disabled = true;
        publish.textContent = 'Publishing...';
        try {
          const res = await fetch('/api/sales-dashboard/publish', { method: 'POST' });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || 'Publish failed');
          showToast('FBBS Sales Dashboard published');
          await loadCurrent();
          await loadDashboardBuilderStatus();
        } catch (e) {
          showToast(e.message, true);
        } finally {
          publish.textContent = 'Publish Dashboard';
        }
      });
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
          { label: 'Unique CUSIPs', value: formatNumber(recap.uniqueCusips || 0) },
          { label: 'Recap Terms', value: formatNumber(recap.recapTermUniqueCusips || 0) },
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
    } catch (err) {
      console.error('Failed to load weekly CD recap:', err);
      if (body) {
        body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--danger)">
          Failed to load weekly CD recap: ${escapeHtml(err.message)}
        </td></tr>`;
      }
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
      ? ` &middot; As of ${formatShortDate(offeringsData.asOfDate)}`
      : '';
    document.getElementById('explorerSub').innerHTML =
      `${off.length} CDs available${asOf}`;
    document.getElementById('explorerKicker').textContent =
      offeringsData.asOfDate ? formatShortDate(offeringsData.asOfDate) : 'Current package';
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
        <td>${formatShortDate(o.maturity)}</td>
        <td class="cusip-cell">${escapeHtml(o.cusip)}</td>
        <td>${formatShortDate(o.settle)}</td>
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
      ? ` &middot; As of ${formatShortDate(muniData.asOfDate)}`
      : '';
    document.getElementById('muniExplorerSub').innerHTML =
      `${off.length} muni bonds available${asOf}`;
    document.getElementById('muniExplorerKicker').textContent =
      muniData.asOfDate ? formatShortDate(muniData.asOfDate) : 'Current package';
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
      body.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">
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
        ? formatShortDate(o.callDate)
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
          <td>${formatShortDate(o.maturity)}</td>
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
      const res = await fetch('/api/agencies', { cache: 'no-store' });
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

    const fdate = agencyData.fileDate ? ` &middot; File dated ${formatShortDate(agencyData.fileDate)}` : '';
    const udate = agencyData.uploadedAt ? ` &middot; Uploaded ${formatShortDate(agencyData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('agenciesSub').innerHTML = `${off.length} agency offerings${udate}${fdate}`;
    document.getElementById('agenciesKicker').textContent = agencyData.fileDate
      ? `File ${formatShortDate(agencyData.fileDate)}`
      : 'Current';
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
    const fmtDate = v => v ? formatShortDate(v) : '<span class="no-restrict">&mdash;</span>';

    body.innerHTML = filtered.map(o => {
      const structureClass = o.structure === 'Bullet' ? 'structure-bullet' : 'structure-callable';
      return `
        <tr>
          <td><span class="structure-pill ${structureClass}">${escapeHtml(o.structure)}</span></td>
          <td><span class="ticker-pill">${escapeHtml(o.ticker || '')}</span></td>
          <td class="cusip-cell">${escapeHtml(o.cusip || '')}</td>
          <td style="text-align:right">${fmt(o.coupon, 3)}</td>
          <td>${fmtDate(o.maturity)}</td>
          <td>${fmtDate(o.nextCallDate)}</td>
          <td>${o.callType ? `<span class="calltype-chip">${escapeHtml(o.callType)}</span>` : '<span class="no-restrict">&mdash;</span>'}</td>
          <td style="text-align:right" class="rate-cell">${fmt(o.ytm, 3)}</td>
          <td style="text-align:right" class="rate-cell">${fmt(o.ytnc, 3)}</td>
          <td style="text-align:right">${fmt(o.askPrice, 3)}</td>
          <td style="text-align:right" class="qnty-cell">${fmt(o.availableSize, 3)}</td>
          <td style="text-align:right">${o.askSpread == null ? '<span class="no-restrict">&mdash;</span>' : o.askSpread.toFixed(1)}</td>
          <td>${o.benchmark ? escapeHtml(o.benchmark) : '<span class="no-restrict">&mdash;</span>'}</td>
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
                    'YTM','YTNC','AskPrice','AvailableSize','AskSpread','Benchmark',
                    'Settle','CostBasis','Notes','CommissionBp'];
    const rows = filtered.map(o => [
      o.structure, o.ticker, o.cusip,
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.callType || '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(3) : '',
      o.askSpread != null ? o.askSpread.toFixed(1) : '',
      o.benchmark || '',
      o.settle || '',
      o.costBasis != null ? o.costBasis.toFixed(3) : '',
      o.notes || '',
      o.commissionBp != null ? o.commissionBp.toString() : ''
    ]);
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
    const fdate = corpData.fileDate ? ` &middot; File dated ${formatShortDate(corpData.fileDate)}` : '';
    const udate = corpData.uploadedAt ? ` &middot; Uploaded ${formatShortDate(corpData.uploadedAt.slice(0,10))}` : '';
    document.getElementById('corporatesSub').innerHTML = `${off.length} corporate bonds${udate}${fdate}`;
    document.getElementById('corporatesKicker').textContent = corpData.fileDate
      ? `File ${formatShortDate(corpData.fileDate)}`
      : 'Current';
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
    const fmtDate = v => v ? formatShortDate(v) : '<span class="no-restrict">&mdash;</span>';
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
          <td style="text-align:right" class="rate-cell">${fmt(o.ytm, 3)}</td>
          <td style="text-align:right" class="rate-cell">${fmt(o.ytnc, 3)}</td>
          <td style="text-align:right">${fmt(o.askPrice, 3)}</td>
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
                    'Coupon','Maturity','NextCallDate','YTM','YTNC','AskPrice','AvailableSize',
                    'AmtOut','Series','CUSIP','AskSpread','Benchmark','FloaterSpread'];
    const rows = filtered.map(o => [
      o.creditTier, o.moodysRating || '', o.spRating || '',
      o.issuerName, o.ticker || '', o.sector || '', o.paymentRank || '',
      o.coupon != null ? o.coupon.toFixed(3) : '',
      o.maturity || '',
      o.nextCallDate || '',
      o.ytm != null ? o.ytm.toFixed(3) : '',
      o.ytnc != null ? o.ytnc.toFixed(3) : '',
      o.askPrice != null ? o.askPrice.toFixed(3) : '',
      o.availableSize != null ? o.availableSize.toFixed(0) : '',
      o.amtOutRaw || '',
      o.series || '',
      o.cusip,
      o.askSpread != null ? o.askSpread.toString() : '',
      o.benchmark || '',
      o.floaterSpread != null ? o.floaterSpread.toString() : ''
    ]);
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
          : '';
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
    setupDashboardBuilder();
    setupCdRecap();
    setupOfferingsFilters();
    setupMuniFilters();
    setupAgencyFilters();
    setupCorpFilters();
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
