'use strict';

const fs = require('fs');
const path = require('path');

const RECAP_TERMS = [
  { key: '3m', label: '3m', months: 3 },
  { key: '6m', label: '6m', months: 6 },
  { key: '12m', label: '12m', months: 12 },
  { key: '18m', label: '18m', months: 18 },
  { key: '24m', label: '24m', months: 24 },
  { key: '3y', label: '36m', months: 36 },
  { key: '4y', label: '48m', months: 48 },
  { key: '5y', label: '60m', months: 60 }
];

function ensureCdHistoryDir(historyDir) {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const keep = path.join(historyDir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}

function saveCdHistorySnapshot(historyDir, payload, { uploadedAt = new Date().toISOString(), uploadDate = null } = {}) {
  ensureCdHistoryDir(historyDir);
  const snapshotDate = payload.asOfDate || uploadDate || uploadedAt.slice(0, 10);
  const snapshot = {
    snapshotDate,
    asOfDate: payload.asOfDate || null,
    uploadedAt,
    uploadDate: uploadDate || uploadedAt.slice(0, 10),
    sourceFile: payload.sourceFile || null,
    warnings: payload.warnings || [],
    offerings: Array.isArray(payload.offerings) ? payload.offerings : []
  };
  const target = path.join(historyDir, `${snapshotDate}.json`);
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2));
  return {
    snapshotDate,
    filename: path.basename(target),
    offeringsCount: snapshot.offerings.length,
    uniqueCusipCount: uniqueByCusip(snapshot.offerings).length
  };
}

function loadCdHistory(historyDir) {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map(filename => {
      try {
        return JSON.parse(fs.readFileSync(path.join(historyDir, filename), 'utf-8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeWeeklyCdHistory(historyDir, { anchorDate = null } = {}) {
  const snapshots = loadCdHistory(historyDir);
  const latestDate = anchorDate || snapshots.map(s => s.snapshotDate || s.asOfDate || s.uploadDate).filter(Boolean).sort().at(-1) || todayYmd();
  const { start, end } = weekBounds(latestDate);
  const weekSnapshots = snapshots.filter(s => {
    const d = s.snapshotDate || s.asOfDate || s.uploadDate;
    return d && d >= start && d <= end;
  });

  const allRows = [];
  for (const snap of weekSnapshots) {
    const snapshotDate = snap.snapshotDate || snap.asOfDate || snap.uploadDate;
    for (const offering of snap.offerings || []) {
      allRows.push({
        ...offering,
        firstSeenDate: snapshotDate,
        sourceFile: snap.sourceFile || null
      });
    }
  }

  const uniqueRows = uniqueByCusip(allRows);
  const terms = RECAP_TERMS.map(term => {
    const rows = uniqueRows.filter(o => normalizeTerm(o.term, o.termMonths) === term.key);
    const rates = rows.map(o => Number(o.rate)).filter(n => Number.isFinite(n));
    const top = [...rows]
      .filter(o => Number.isFinite(Number(o.rate)))
      .sort((a, b) => Number(b.rate) - Number(a.rate) || String(a.maturity || '').localeCompare(String(b.maturity || '')))
      .slice(0, 5);
    return {
      term: term.key,
      label: term.label,
      months: term.months,
      uniqueCusips: rows.length,
      medianRate: median(rates),
      minRate: rates.length ? Math.min(...rates) : null,
      maxRate: rates.length ? Math.max(...rates) : null,
      top
    };
  });

  const recapUniverse = new Set(RECAP_TERMS.map(t => t.key));
  const recapRows = uniqueRows.filter(o => recapUniverse.has(normalizeTerm(o.term, o.termMonths)));
  const recapCount = recapRows.length;
  for (const term of terms) {
    term.issueShare = recapCount ? term.uniqueCusips / recapCount : null;
  }

  return {
    weekStart: start,
    weekEnd: end,
    anchorDate: latestDate,
    snapshotCount: weekSnapshots.length,
    snapshotDates: weekSnapshots.map(s => s.snapshotDate || s.asOfDate || s.uploadDate).filter(Boolean),
    rawRows: allRows.length,
    uniqueCusips: uniqueRows.length,
    recapTermUniqueCusips: recapCount,
    duplicateRowsRemoved: allRows.length - uniqueRows.length,
    terms,
    rateComparisons: buildRateComparisons(snapshots, latestDate),
    availableSnapshots: snapshots.map(s => ({
      snapshotDate: s.snapshotDate || s.asOfDate || s.uploadDate,
      asOfDate: s.asOfDate || null,
      uploadDate: s.uploadDate || null,
      uploadedAt: s.uploadedAt || null,
      sourceFile: s.sourceFile || null,
      offeringsCount: Array.isArray(s.offerings) ? s.offerings.length : 0,
      uniqueCusipCount: uniqueByCusip(s.offerings || []).length
    }))
  };
}

function buildRateComparisons(snapshots, anchorDate) {
  const bounds = weekBounds(anchorDate);
  const periods = [
    { key: 'today', label: 'Today', targetDate: anchorDate },
    { key: 'previousWeek', label: 'Previous Week', targetDate: shiftYmd(bounds.start, { days: -1 }) },
    { key: 'previousMonth', label: 'Previous Month', targetDate: shiftYmd(anchorDate, { months: -1 }) },
    { key: 'previousYear', label: 'Previous Year', targetDate: shiftYmd(anchorDate, { years: -1 }) }
  ];
  const sorted = [...snapshots]
    .map(s => ({ ...s, effectiveDate: s.snapshotDate || s.asOfDate || s.uploadDate }))
    .filter(s => s.effectiveDate)
    .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));

  const periodSnapshots = periods.map(period => {
    const snapshot = findSnapshotOnOrBefore(sorted, period.targetDate);
    return {
      ...period,
      snapshotDate: snapshot ? snapshot.effectiveDate : null,
      medians: snapshot ? medianRatesByTerm(snapshot.offerings || []) : {}
    };
  });

  const comparisonTerms = RECAP_TERMS.map(term => {
    const row = {
      term: term.key,
      label: term.label,
      months: term.months,
      rates: {},
      rateFallbacks: {}
    };
    for (const period of periodSnapshots) {
      row.rates[period.key] = period.medians[term.key] ?? null;
    }
    for (const key of ['previousWeek', 'previousMonth', 'previousYear']) {
      if (Number.isFinite(row.rates.today) && !Number.isFinite(row.rates[key])) {
        row.rates[key] = row.rates.today;
        row.rateFallbacks[key] = true;
      }
    }
    row.deltas = {
      previousWeek: delta(row.rates.today, row.rates.previousWeek),
      previousMonth: delta(row.rates.today, row.rates.previousMonth),
      previousYear: delta(row.rates.today, row.rates.previousYear)
    };
    return row;
  });

  return {
    periods: periodSnapshots.map(({ key, label, targetDate, snapshotDate }) => ({
      key,
      label,
      targetDate,
      snapshotDate
    })),
    terms: comparisonTerms
  };
}

function medianRatesByTerm(offerings) {
  const rows = uniqueByCusip(offerings);
  const out = {};
  for (const term of RECAP_TERMS) {
    const rates = rows
      .filter(o => normalizeTerm(o.term, o.termMonths) === term.key)
      .map(o => Number(o.rate))
      .filter(n => Number.isFinite(n));
    out[term.key] = median(rates);
  }
  return out;
}

function findSnapshotOnOrBefore(sortedSnapshots, targetDate) {
  if (!targetDate) return null;
  for (let i = sortedSnapshots.length - 1; i >= 0; i--) {
    if (sortedSnapshots[i].effectiveDate <= targetDate) return sortedSnapshots[i];
  }
  return null;
}

function delta(current, prior) {
  return Number.isFinite(current) && Number.isFinite(prior) ? current - prior : null;
}

function uniqueByCusip(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    const cusip = String(row.cusip || '').trim().toUpperCase();
    if (!cusip) continue;
    const prior = seen.get(cusip);
    if (!prior || String(row.firstSeenDate || row.asOfDate || '').localeCompare(String(prior.firstSeenDate || prior.asOfDate || '')) < 0) {
      seen.set(cusip, row);
    }
  }
  return [...seen.values()];
}

function normalizeTerm(term, termMonths) {
  const raw = String(term || '').toLowerCase().trim();
  if (raw === '36m') return '3y';
  if (raw === '48m') return '4y';
  if (raw === '60m') return '5y';
  if (raw) return raw;
  const months = Number(termMonths);
  if (months === 36) return '3y';
  if (months === 48) return '4y';
  if (months === 60) return '5y';
  if (Number.isFinite(months)) return `${months}m`;
  return '';
}

function median(values) {
  const nums = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function weekBounds(ymd) {
  const date = parseYmd(ymd) || parseYmd(todayYmd());
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  return { start: toYmd(start), end: toYmd(end) };
}

function shiftYmd(ymd, { days = 0, months = 0, years = 0 } = {}) {
  const date = parseYmd(ymd);
  if (!date) return null;
  date.setFullYear(date.getFullYear() + years);
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

function parseYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayYmd() {
  return toYmd(new Date());
}

module.exports = {
  RECAP_TERMS,
  ensureCdHistoryDir,
  saveCdHistorySnapshot,
  summarizeWeeklyCdHistory,
  loadCdHistory
};
