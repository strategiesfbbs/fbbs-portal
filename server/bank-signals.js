/**
 * bank-signals.js — the PURE engine behind Signal Inbox v1.
 *
 * Mirrors the daily-dashboard-rv.js discipline: this module is I/O-free and
 * node-testable. It does NO database / fs / network work and never requires
 * better-sqlite3 or any server.js internal. The route in server.js does ALL of
 * the fetching (saved banks, coverage map, last-touch, overdue tasks, the cached
 * map projection, per-bank funding / CD-rollover / offering-fit / FDIC reads) and
 * hands buildBankSignals() one already-resolved `inputs` object. The engine only
 * filters / joins / ranks / groups those plain objects into the response shape.
 *
 * This keeps the signal logic testable with fixtures and avoids exporting
 * server.js internals — the same pattern daily-dashboard-rv.buildRelativeValue
 * uses (it takes an already-fetched candidateSet/curve/fred/mmd).
 *
 * v1 ships 8 live signal kinds across 6 categories. Three more (watchlist-fit,
 * client-no-recent-opp, portfolio-peer-gap) are registered in SIGNAL_DEFS but
 * gated OFF via ENABLED so the route can pass their inputs without surfacing them.
 *
 * Rep-scope is the ROUTE's job: it pre-filters savedBanks/mapBanks by
 * ownerStringContainsRep(owner, scopedRep) before calling the engine, EXCEPT for
 * the one firm-set signal (coverage-large-no-owner), whose rows are unowned banks
 * (no owner to scope), so it always shows to every rep. The engine documents this
 * contract by trusting the inputs it is handed.
 */
'use strict';

// ---------------------------------------------------------------------------
// Tunables (overridable via inputs.thresholds)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  coldDays: 30,            // owned account with no manual touch in N days → cold
  rolloverWindowDays: 180, // brokered CD maturing inside N days → re-raise call
  assetFloorK: 500000,     // totalAssets above this ($000) → "large" for no-owner
  fundingScoreFloor: 9,    // buildBrokeredCdOpportunity score ≥ this → pressure
  fitMinScore: 5,          // best offering-fit class score must clear this
};

// ---------------------------------------------------------------------------
// Signal registry. severityBase is the floor; rankSignals may bump per-row.
// packageScoped signals embed packageDate in their dismissId so a dismiss
// naturally expires when the package rolls; the rest re-surface daily.
// ---------------------------------------------------------------------------
const SIGNAL_DEFS = {
  'coverage-cold-owned': {
    category: 'Coverage',
    label: 'Owned accounts going cold',
    severityBase: 'med',
    actions: ['open', 'logCall', 'createTask', 'dismiss'],
    packageScoped: false,
  },
  'coverage-prospect-overdue-task': {
    category: 'Coverage',
    label: 'Prospects with an overdue task',
    severityBase: 'high',
    actions: ['open', 'createTask', 'logCall', 'dismiss'],
    packageScoped: false,
  },
  'coverage-large-no-owner': {
    category: 'Coverage',
    label: 'Large banks with no owner',
    severityBase: 'low',
    actions: ['open', 'createTask', 'dismiss'],
    packageScoped: false,
  },
  'funding-pressure': {
    category: 'Funding',
    label: 'Funding pressure (high loans/deposits)',
    severityBase: 'high',
    actions: ['open', 'createOpportunity', 'logCall', 'dismiss'],
    packageScoped: false,
  },
  'funding-cd-rolling': {
    category: 'Funding',
    label: 'Brokered CDs rolling off soon',
    severityBase: 'med',
    actions: ['open', 'createOpportunity', 'logCall', 'dismiss'],
    packageScoped: false,
  },
  'securities-offering-fit': {
    category: 'Securities',
    label: "Today's offerings that fit my banks",
    severityBase: 'med',
    actions: ['open', 'createOpportunity', 'logCall', 'dismiss'],
    packageScoped: true,
  },
  'muni-afs-book': {
    category: 'Muni',
    label: 'Banks with an AFS muni book',
    severityBase: 'low',
    actions: ['open', 'createOpportunity', 'logCall', 'dismiss'],
    packageScoped: false,
  },
  'freshness-fdic-newer': {
    category: 'Data-Freshness',
    label: 'FDIC has a newer quarter than our workbook',
    severityBase: 'low',
    actions: ['open', 'dismiss'],
    packageScoped: false,
  },
  // ---- registered but GATED OFF for v1 (route may still pass their inputs) ----
  'securities-watchlist-fit': {
    category: 'Securities',
    label: 'Watchlist banks with a new fit',
    severityBase: 'med',
    actions: ['open', 'createOpportunity', 'logCall', 'dismiss'],
    packageScoped: true,
  },
  'coverage-client-no-recent-opp': {
    category: 'Coverage',
    label: 'Clients with no recent opportunity',
    severityBase: 'low',
    actions: ['open', 'createOpportunity', 'dismiss'],
    packageScoped: false,
  },
  'portfolio-peer-gap': {
    category: 'Portfolio',
    label: 'Portfolio loaded but peer gap to discuss',
    severityBase: 'low',
    actions: ['open', 'createOpportunity', 'dismiss'],
    packageScoped: false,
  },
};

// The v1 enabled set. Everything else in SIGNAL_DEFS is registered but never
// emitted, even when its inputs are present.
const ENABLED = new Set([
  'coverage-cold-owned',
  'coverage-prospect-overdue-task',
  'coverage-large-no-owner',
  'funding-pressure',
  'funding-cd-rolling',
  'securities-offering-fit',
  'muni-afs-book',
  'freshness-fdic-newer',
]);

// Fixed display order of categories.
const CATEGORY_ORDER = ['Coverage', 'Funding', 'Securities', 'Muni', 'Portfolio', 'Data-Freshness'];

const CATEGORY_LABELS = {
  'Coverage': 'Coverage',
  'Funding': 'Funding',
  'Securities': 'Securities',
  'Muni': 'Muni',
  'Portfolio': 'Portfolio',
  'Data-Freshness': 'Data Freshness',
};

const SEVERITY_RANK = { high: 0, med: 1, low: 2 };

// ---------------------------------------------------------------------------
// Small helpers (pure)
// ---------------------------------------------------------------------------
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dayStr(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(fromDate);
  const b = Date.parse(toDate);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// Resolve a coverage record for a bankId from a Map OR a plain object.
function coverageFor(coverageByBank, bankId) {
  if (!coverageByBank) return null;
  const key = String(bankId);
  if (typeof coverageByBank.get === 'function') return coverageByBank.get(key) || coverageByBank.get(bankId) || null;
  return coverageByBank[key] || coverageByBank[bankId] || null;
}

function locationOf(row) {
  return {
    city: row && (row.city || '') || '',
    state: row && (row.state || '') || '',
  };
}

function moneyK(value) {
  const n = num(value);
  if (n === null) return null;
  // $000 → human ($MM if large)
  if (n >= 1000) return `$${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}MM`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}K`;
}

// Build a Signal row from a definition + per-row facts.
function makeSignal(signalKey, facts) {
  const def = SIGNAL_DEFS[signalKey];
  return {
    signalKey,
    category: def.category,
    bankId: String(facts.bankId),
    displayName: facts.displayName || String(facts.bankId),
    city: facts.city || '',
    state: facts.state || '',
    status: facts.status || '',
    owner: facts.owner || '',
    priority: facts.priority || '',
    headline: facts.headline || def.label,
    detail: facts.detail || '',
    metric: facts.metric || null,
    severity: facts.severity || def.severityBase,
    actions: def.actions.slice(),
    dismissId: facts.dismissId,
    // a numeric sort key for rankSignals (per-signal meaning, set by each builder)
    sortKey: facts.sortKey === undefined ? 0 : facts.sortKey,
    extra: facts.extra || {},
  };
}

function dismissIdFor(signalKey, bankId, today, packageDate) {
  const def = SIGNAL_DEFS[signalKey];
  const suffix = def && def.packageScoped ? (packageDate || today || '') : (today || '');
  return `${signalKey}:${bankId}:${suffix}`;
}

// ---------------------------------------------------------------------------
// Per-signal builders. Each returns an array of Signal rows from the inputs.
// The ROUTE has already rep-scoped savedBanks/mapBanks (owned set) where the
// signal is rep-scoped; coverage-large-no-owner runs over the full map set.
// ---------------------------------------------------------------------------

// coverage-cold-owned: owned saved banks (Client/Prospect) with no manual touch
// in coldDays. Oldest-touch-first; a missing touch sorts first.
function buildColdOwned(inputs, th) {
  const { savedBanks, lastTouchByBank, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks)) return [];
  const cutoff = dayStr(new Date(Date.parse(today + 'T00:00:00Z') - th.coldDays * 86400000).toISOString());
  const out = [];
  for (const bank of savedBanks) {
    const status = String(bank.status || '');
    // Cold matters for the accounts we're meant to be working.
    if (status !== 'Client' && status !== 'Prospect') continue;
    const last = dayStr((lastTouchByBank || {})[bank.bankId] || '');
    if (last && last >= cutoff) continue; // touched recently
    const daysCold = last ? daysBetween(last, today) : null;
    // sortKey: oldest-touch-first → smaller key = topmost. Missing touch = -Infinity.
    const sortKey = last ? Date.parse(last) : -Infinity;
    out.push(makeSignal('coverage-cold-owned', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status, owner: bank.owner || '', priority: bank.priority || '',
      headline: last ? `No touch in ${daysCold} days` : 'Never touched',
      detail: last
        ? `Last manual activity ${last}. ${status} account — overdue for a check-in.`
        : `No manual CRM activity on record for this ${status.toLowerCase()} account.`,
      metric: { label: 'Days cold', value: last ? daysCold : null, unit: 'days' },
      severity: (last && daysCold !== null && daysCold >= th.coldDays * 2) || !last ? 'high' : 'med',
      sortKey,
      dismissId: dismissIdFor('coverage-cold-owned', bank.bankId, today, packageDate),
      extra: { lastTouch: last || null, thresholdDays: th.coldDays },
    }));
  }
  return out;
}

// coverage-prospect-overdue-task: Prospect-status owned banks with an Open task
// past its due date. Ranked most-days-overdue first.
function buildProspectOverdueTask(inputs, th) {
  const { overdueTasks, coverageByBank, today, packageDate } = inputs;
  if (!Array.isArray(overdueTasks)) return [];
  // Collapse multiple overdue tasks per bank to the most-overdue one.
  const worstByBank = new Map();
  for (const task of overdueTasks) {
    const cov = coverageFor(coverageByBank, task.bankId);
    if (!cov || String(cov.status || '') !== 'Prospect') continue;
    const due = dayStr(task.dueDate);
    if (!due) continue;
    const overdueDays = daysBetween(due, today);
    if (overdueDays === null || overdueDays <= 0) continue;
    const prev = worstByBank.get(String(task.bankId));
    if (!prev || overdueDays > prev.overdueDays) {
      worstByBank.set(String(task.bankId), { task, cov, due, overdueDays });
    }
  }
  const out = [];
  for (const { task, cov, due, overdueDays } of worstByBank.values()) {
    out.push(makeSignal('coverage-prospect-overdue-task', {
      bankId: task.bankId,
      displayName: cov.displayName || task.bankId,
      ...locationOf(cov),
      status: cov.status || 'Prospect', owner: cov.owner || '', priority: cov.priority || task.priority || '',
      headline: `Overdue task: ${task.title || 'follow-up'}`,
      detail: `Open task due ${due} is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue on this prospect.`,
      metric: { label: 'Days overdue', value: overdueDays, unit: 'days' },
      severity: overdueDays >= 14 ? 'high' : 'med',
      sortKey: overdueDays, // most-overdue-first (descending)
      dismissId: dismissIdFor('coverage-prospect-overdue-task', task.bankId, today, packageDate),
      extra: { taskTitle: task.title || '', dueDate: due, overdueDays },
    }));
  }
  return out;
}

// coverage-large-no-owner: FIRM-SET. Banks above the asset floor with no coverage
// owner — unclaimed whitespace, shown to every rep. totalAssets-desc.
function buildLargeNoOwner(inputs, th) {
  const { mapBanks, coverageByBank, today, packageDate } = inputs;
  if (!Array.isArray(mapBanks)) return [];
  const out = [];
  for (const bank of mapBanks) {
    const assets = num(bank.totalAssets);
    if (assets === null || assets < th.assetFloorK) continue;
    const cov = coverageFor(coverageByBank, bank.id);
    const owner = cov ? String(cov.owner || '').trim() : '';
    if (owner) continue; // already claimed
    out.push(makeSignal('coverage-large-no-owner', {
      bankId: bank.id,
      displayName: bank.displayName || bank.id,
      ...locationOf(bank),
      status: (cov && cov.status) || 'Open', owner: '', priority: (cov && cov.priority) || '',
      headline: `Unclaimed — ${moneyK(assets)} in assets`,
      detail: `${moneyK(assets)} total assets with no coverage owner assigned. Open whitespace.`,
      metric: { label: 'Total assets', value: assets, unit: '$000' },
      severity: assets >= th.assetFloorK * 4 ? 'med' : 'low',
      sortKey: assets, // largest-first (descending)
      dismissId: dismissIdFor('coverage-large-no-owner', bank.id, today, packageDate),
      extra: { totalAssets: assets, certNumber: bank.certNumber || '' },
    }));
  }
  return out;
}

// funding-pressure: owned banks with an elevated brokered-CD funding score.
function buildFundingPressure(inputs, th) {
  const { savedBanks, fundingScoreByBank, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks) || !fundingScoreByBank) return [];
  const out = [];
  for (const bank of savedBanks) {
    const f = fundingScoreByBank[bank.bankId];
    if (!f) continue;
    const score = num(f.score);
    if (score === null || score < th.fundingScoreFloor) continue;
    out.push(makeSignal('funding-pressure', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status: bank.status || '', owner: bank.owner || '', priority: bank.priority || '',
      headline: `Funding pressure — ${f.recommendation || 'candidate'}`,
      detail: `Brokered-CD funding score ${score}/15${f.recommendation ? ` (${f.recommendation})` : ''}. The funding-call cue.`,
      metric: { label: 'Funding score', value: score, unit: '/15' },
      severity: score >= 12 ? 'high' : 'med',
      sortKey: score, // score-desc
      dismissId: dismissIdFor('funding-pressure', bank.bankId, today, packageDate),
      extra: { score, recommendation: f.recommendation || '', need: f.need || '' },
    }));
  }
  return out;
}

// funding-cd-rolling: owned issuing banks with brokered CDs maturing inside the
// window. Soonest-maturity first; nearest CUSIP + count in detail.
function buildCdRolling(inputs, th) {
  const { savedBanks, cdRolloverByBank, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks) || !cdRolloverByBank) return [];
  const out = [];
  for (const bank of savedBanks) {
    const cds = cdRolloverByBank[bank.bankId];
    if (!Array.isArray(cds) || !cds.length) continue;
    const inWindow = cds
      .filter(cd => {
        const d = num(cd.daysOut);
        return d !== null && d >= 0 && d <= th.rolloverWindowDays;
      })
      .sort((a, b) => String(a.maturity || '').localeCompare(String(b.maturity || '')));
    if (!inWindow.length) continue;
    const nearest = inWindow[0];
    out.push(makeSignal('funding-cd-rolling', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status: bank.status || '', owner: bank.owner || '', priority: bank.priority || '',
      headline: `${inWindow.length} brokered CD${inWindow.length === 1 ? '' : 's'} rolling ≤${th.rolloverWindowDays}d`,
      detail: `Nearest matures ${dayStr(nearest.maturity)} (${nearest.daysOut}d) · ${nearest.cusip || 'CUSIP n/a'}${nearest.rate != null ? ` @ ${nearest.rate}%` : ''}. Re-raise call.`,
      metric: { label: 'CDs in window', value: inWindow.length, unit: '' },
      severity: nearest.daysOut !== null && Number(nearest.daysOut) <= 60 ? 'high' : 'med',
      sortKey: -Date.parse(dayStr(nearest.maturity) || today) || 0, // soonest-maturity first
      dismissId: dismissIdFor('funding-cd-rolling', bank.bankId, today, packageDate),
      extra: {
        count: inWindow.length,
        nearestMaturity: dayStr(nearest.maturity),
        nearestCusip: nearest.cusip || '',
        windowDays: th.rolloverWindowDays,
      },
    }));
  }
  return out;
}

// securities-offering-fit: owned banks with a best offering-fit class clearing
// fitMinScore. Best class score-desc; pick CUSIP/yield re-attached.
function buildOfferingFit(inputs, th) {
  const { savedBanks, fitsByBank, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks) || !fitsByBank) return [];
  const out = [];
  for (const bank of savedBanks) {
    const fits = fitsByBank[bank.bankId];
    if (!fits || !Array.isArray(fits.classes) || !fits.classes.length) continue;
    const eligible = fits.classes
      .filter(c => num(c.score) !== null && num(c.score) >= th.fitMinScore)
      .sort((a, b) => (num(b.score) || 0) - (num(a.score) || 0));
    if (!eligible.length) continue;
    const best = eligible[0];
    const pick = Array.isArray(best.picks) && best.picks.length ? best.picks[0] : null;
    const inStateMuni = Boolean(pick && pick.inState);
    out.push(makeSignal('securities-offering-fit', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status: bank.status || '', owner: bank.owner || '', priority: bank.priority || '',
      headline: `Fit: ${best.label || best.type}${inStateMuni ? ' (in-state)' : ''}`,
      detail: pick
        ? `${pick.description || pick.cusip || best.label}${pick.yield != null ? ` @ ${pick.yield}%` : ''}${pick.maturity ? ` due ${dayStr(pick.maturity)}` : ''} fits this bank (score ${Math.round(num(best.score))}).`
        : `${best.label || best.type} offerings fit this bank (score ${Math.round(num(best.score))}).`,
      metric: { label: 'Fit score', value: Math.round(num(best.score)), unit: '' },
      severity: num(best.score) >= 20 || inStateMuni ? 'high' : 'med',
      sortKey: num(best.score) || 0, // best class score-desc
      dismissId: dismissIdFor('securities-offering-fit', bank.bankId, today, packageDate),
      extra: {
        bestClass: best.type || '',
        bestLabel: best.label || '',
        score: Math.round(num(best.score)),
        inStateMuni,
        pick: pick ? {
          cusip: pick.cusip || '', description: pick.description || '',
          coupon: pick.coupon != null ? pick.coupon : null,
          yield: pick.yield != null ? pick.yield : null,
          maturity: dayStr(pick.maturity), state: pick.state || '',
          sector: pick.sector || '', inState: inStateMuni,
        } : null,
        classes: eligible.slice(0, 4).map(c => ({ type: c.type, label: c.label, score: Math.round(num(c.score)) })),
      },
    }));
  }
  return out;
}

// muni-afs-book: owned banks carrying an AFS muni book (afsMunis>0). afsMunis-desc.
// If afsMunis is not projected at all (undefined on every map row), emit nothing
// and let the route attach a warning — never crash.
function buildMuniAfsBook(inputs, th) {
  const { savedBanks, mapBanks, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks) || !Array.isArray(mapBanks)) return [];
  const mapById = new Map(mapBanks.map(b => [String(b.id), b]));
  const out = [];
  for (const bank of savedBanks) {
    const mb = mapById.get(String(bank.bankId));
    if (!mb) continue;
    // afsMunis NOT projected → field absent on the row → skip (route warns).
    if (mb.afsMunis === undefined) continue;
    const afs = num(mb.afsMunis);
    if (afs === null || afs <= 0) continue;
    const subS = String(mb.subchapterS || '').trim();
    const isSubS = /^y/i.test(subS);
    const bqContext = subS
      ? (isSubS ? 'Sub-S — BQ disallowance does not help (q=1.00)' : 'C-corp — BQ munis worth ~32bp')
      : '';
    out.push(makeSignal('muni-afs-book', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status: bank.status || '', owner: bank.owner || '', priority: bank.priority || '',
      headline: `AFS muni book — ${moneyK(afs)}`,
      detail: `Carries ${moneyK(afs)} of AFS municipals. Natural buyer for the muni offerings${bqContext ? ` · ${bqContext}` : ''}.`,
      metric: { label: 'AFS munis', value: afs, unit: '$000' },
      severity: afs >= 50000 ? 'med' : 'low',
      sortKey: afs, // afsMunis-desc
      dismissId: dismissIdFor('muni-afs-book', bank.bankId, today, packageDate),
      extra: { afsMunis: afs, subchapterS: subS, isSubS },
    }));
  }
  return out;
}

// freshness-fdic-newer: owned banks where FDIC's latest quarter is newer than our
// imported workbook period. Newest fdicPeriod first.
function buildFdicNewer(inputs, th) {
  const { savedBanks, fdicFlagsByBank, today, packageDate } = inputs;
  if (!Array.isArray(savedBanks) || !fdicFlagsByBank) return [];
  const out = [];
  for (const bank of savedBanks) {
    const flag = fdicFlagsByBank[bank.bankId];
    if (!flag || !flag.newerAvailable) continue;
    const fdicPeriod = String(flag.fdicPeriod || '');
    const wbPeriod = String(flag.workbookPeriod || '');
    out.push(makeSignal('freshness-fdic-newer', {
      bankId: bank.bankId,
      displayName: bank.displayName,
      ...locationOf(bank),
      status: bank.status || '', owner: bank.owner || '', priority: bank.priority || '',
      headline: `FDIC has ${fdicPeriod} — workbook is ${wbPeriod || 'older'}`,
      detail: `FDIC's latest filed quarter (${fdicPeriod}) is newer than our imported workbook period (${wbPeriod || 'unknown'}). Cue to refresh.`,
      metric: { label: 'FDIC period', value: fdicPeriod, unit: '' },
      severity: 'low',
      sortKey: periodSortKey(fdicPeriod), // newest fdicPeriod first
      dismissId: dismissIdFor('freshness-fdic-newer', bank.bankId, today, packageDate),
      extra: { fdicPeriod, workbookPeriod: wbPeriod },
    }));
  }
  return out;
}

// "YYYYQn" → sortable integer (newest = largest).
function periodSortKey(period) {
  const m = String(period || '').match(/^(\d{4})Q(\d)$/);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2]);
}

// ---------------------------------------------------------------------------
// rankSignals: severity (high>med>low) then per-signal sort key (always
// descending — each builder set sortKey so that "more urgent = larger"), then
// drop dismissed rows, then group by category in fixed CATEGORY_ORDER.
// ---------------------------------------------------------------------------
function rankSignals(rows, dismissed) {
  const dismissedSet = dismissed instanceof Set
    ? dismissed
    : new Set(Array.isArray(dismissed) ? dismissed.map(String) : []);

  const live = rows.filter(r => !dismissedSet.has(r.dismissId));

  live.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] === undefined ? 1 : SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity] === undefined ? 1 : SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    // larger sortKey first within a severity band
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return String(a.displayName).localeCompare(String(b.displayName));
  });

  // Group into the fixed category order. Categories with no rows still appear
  // with count 0 so the UI renders a stable shell.
  const byCategory = new Map(CATEGORY_ORDER.map(cat => [cat, []]));
  for (const row of live) {
    const bucket = byCategory.get(row.category);
    if (bucket) bucket.push(row);
    // a row in an unknown category is dropped silently (defensive)
  }
  return CATEGORY_ORDER.map(category => ({
    category,
    label: CATEGORY_LABELS[category] || category,
    count: byCategory.get(category).length,
    signals: byCategory.get(category),
  }));
}

// ---------------------------------------------------------------------------
// buildBankSignals: the public entry point.
// ---------------------------------------------------------------------------
function buildBankSignals(inputs = {}) {
  const warnings = [];
  const today = dayStr(inputs.today) || new Date().toISOString().slice(0, 10);
  const packageDate = inputs.packageDate ? dayStr(inputs.packageDate) || String(inputs.packageDate) : null;
  const scope = inputs.scope === 'firm' ? 'firm' : 'rep';

  const th = {
    coldDays: clampNum((inputs.thresholds || {}).coldDays, DEFAULTS.coldDays, 1, 365),
    rolloverWindowDays: clampNum((inputs.thresholds || {}).rolloverWindowDays, DEFAULTS.rolloverWindowDays, 1, 365),
    assetFloorK: clampNum((inputs.thresholds || {}).assetFloorK, DEFAULTS.assetFloorK, 0, 1e12),
    fundingScoreFloor: clampNum((inputs.thresholds || {}).fundingScoreFloor, DEFAULTS.fundingScoreFloor, 0, 15),
    fitMinScore: clampNum((inputs.thresholds || {}).fitMinScore, DEFAULTS.fitMinScore, 0, 1000),
  };

  // Normalize the inputs object the builders read (carry today/packageDate).
  const norm = { ...inputs, today, packageDate };

  // Builder registry, keyed by signalKey so the ENABLED gate is the only switch.
  const builders = {
    'coverage-cold-owned': buildColdOwned,
    'coverage-prospect-overdue-task': buildProspectOverdueTask,
    'coverage-large-no-owner': buildLargeNoOwner,
    'funding-pressure': buildFundingPressure,
    'funding-cd-rolling': buildCdRolling,
    'securities-offering-fit': buildOfferingFit,
    'muni-afs-book': buildMuniAfsBook,
    'freshness-fdic-newer': buildFdicNewer,
  };

  let rows = [];
  for (const [key, fn] of Object.entries(builders)) {
    if (!ENABLED.has(key)) continue;
    try {
      const built = fn(norm, th) || [];
      rows = rows.concat(built);
    } catch (err) {
      // A bad input for one signal never sinks the page.
      warnings.push(`${key}: ${err && err.message ? err.message : 'failed'}`);
    }
  }

  // afsMunis-not-projected warning: if the map rows exist but NONE carry an
  // afsMunis field, the projection hasn't been added — degrade with a note.
  if (ENABLED.has('muni-afs-book') && Array.isArray(inputs.mapBanks) && inputs.mapBanks.length
    && inputs.mapBanks.every(b => b.afsMunis === undefined)) {
    warnings.push('muni-afs-book: afsMunis is not projected in the map dataset — add it to MAP_FIELD_KEYS and re-import to enable this signal.');
  }

  const totalRows = rows.length;
  const dismissedSet = inputs.dismissed instanceof Set
    ? inputs.dismissed
    : new Set(Array.isArray(inputs.dismissed) ? inputs.dismissed.map(String) : []);

  const categories = rankSignals(rows, dismissedSet);
  const totalSignals = categories.reduce((sum, c) => sum + c.count, 0);

  return {
    rep: inputs.rep || null,
    generatedAt: new Date().toISOString(),
    scope,
    categories,
    totals: { signals: totalSignals, rows: totalRows },
    warnings,
  };
}

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  buildBankSignals,
  rankSignals,
  SIGNAL_DEFS,
  ENABLED,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  DEFAULTS,
  // exposed for the route/tests
  dismissIdFor,
};
