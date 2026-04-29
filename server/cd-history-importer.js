'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const {
  ensureCdHistoryDir,
  saveCdHistorySnapshot
} = require('./cd-history');

const DEFAULT_SHEETS = ['2024 Data', '2025 Data', 'Data'];

function parseWeeklyCdWorksheet(workbookPath, {
  sheets = DEFAULT_SHEETS,
  sourceFile = path.basename(workbookPath)
} = {}) {
  const workbook = XLSX.readFile(workbookPath, {
    cellDates: true,
    raw: true
  });

  const snapshotMaps = new Map();
  const warnings = [];
  const stats = {
    sourceFile,
    sheets: [],
    scannedRows: 0,
    importedRows: 0,
    skippedRows: 0,
    duplicateRows: 0
  };

  for (const sheetName of sheets) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      warnings.push(`Workbook is missing sheet "${sheetName}".`);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      raw: true,
      defval: null
    });
    const sheetStats = {
      name: sheetName,
      scannedRows: rows.length,
      importedRows: 0,
      skippedRows: 0,
      duplicateRows: 0
    };
    stats.scannedRows += rows.length;

    for (const rawRow of rows) {
      const mapped = mapWorksheetRow(rawRow, { sourceSheet: sheetName });
      if (!mapped) {
        stats.skippedRows += 1;
        sheetStats.skippedRows += 1;
        continue;
      }

      let snapshotMap = snapshotMaps.get(mapped.snapshotDate);
      if (!snapshotMap) {
        snapshotMap = new Map();
        snapshotMaps.set(mapped.snapshotDate, snapshotMap);
      }
      if (snapshotMap.has(mapped.offering.cusip)) {
        stats.duplicateRows += 1;
        sheetStats.duplicateRows += 1;
      }
      snapshotMap.set(mapped.offering.cusip, mapped.offering);
      stats.importedRows += 1;
      sheetStats.importedRows += 1;
    }

    stats.sheets.push(sheetStats);
  }

  const snapshots = [...snapshotMaps.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([snapshotDate, offeringsByCusip]) => ({
      snapshotDate,
      asOfDate: snapshotDate,
      uploadedAt: `${snapshotDate}T12:00:00.000Z`,
      uploadDate: snapshotDate,
      sourceFile,
      warnings: [],
      offerings: [...offeringsByCusip.values()].sort((a, b) => {
        const termCompare = (a.termMonths ?? 9999) - (b.termMonths ?? 9999);
        if (termCompare !== 0) return termCompare;
        return String(a.name || '').localeCompare(String(b.name || ''));
      })
    }));

  stats.snapshotCount = snapshots.length;
  stats.dateStart = snapshots[0] ? snapshots[0].snapshotDate : null;
  stats.dateEnd = snapshots.at(-1) ? snapshots.at(-1).snapshotDate : null;
  stats.uniqueRows = snapshots.reduce((sum, snapshot) => sum + snapshot.offerings.length, 0);

  return { snapshots, warnings, stats };
}

function importWeeklyCdWorksheet(workbookPath, {
  historyDir,
  sheets = DEFAULT_SHEETS,
  overwrite = false,
  dryRun = false
} = {}) {
  if (!historyDir) throw new Error('historyDir is required');

  const parsed = parseWeeklyCdWorksheet(workbookPath, { sheets });
  const written = [];
  const skippedExisting = [];

  if (!dryRun) ensureCdHistoryDir(historyDir);

  for (const snapshot of parsed.snapshots) {
    const target = path.join(historyDir, `${snapshot.snapshotDate}.json`);
    if (!overwrite && fs.existsSync(target)) {
      skippedExisting.push({
        snapshotDate: snapshot.snapshotDate,
        filename: path.basename(target),
        offeringsCount: snapshot.offerings.length
      });
      continue;
    }

    if (!dryRun) {
      saveCdHistorySnapshot(historyDir, snapshot, {
        uploadedAt: snapshot.uploadedAt,
        uploadDate: snapshot.uploadDate
      });
    }
    written.push({
      snapshotDate: snapshot.snapshotDate,
      filename: path.basename(target),
      offeringsCount: snapshot.offerings.length
    });
  }

  return {
    ...parsed,
    stats: {
      ...parsed.stats,
      writtenSnapshots: written.length,
      skippedExistingSnapshots: skippedExisting.length,
      dryRun: !!dryRun,
      overwrite: !!overwrite
    },
    written,
    skippedExisting
  };
}

function mapWorksheetRow(row, { sourceSheet }) {
  const cusip = normalizeCusip(getFirst(row, ['CUSIP', 'CUSIP2']));
  const rate = toNumber(row.RATE);
  const term = normalizeRawTerm(row.TERM);
  const snapshotDate = toYmd(row['Date Uploaded']) || toYmd(row.SETTLE);
  const maturity = toYmd(row.MATURITY);

  if (!cusip || !rate || !term || !snapshotDate || !maturity) return null;

  const settle = toYmd(row.SETTLE) || snapshotDate;
  const restrictions = parseRestrictions(getRestrictionsValue(row));
  const issuerState = cleanString(row.DOMICILED);
  const couponFrequency = cleanString(row['CPN FREQ']);

  return {
    snapshotDate,
    offering: {
      term,
      termMonths: termToMonths(term),
      name: cleanString(row.NAME),
      rate,
      maturity,
      cusip,
      settle,
      issuerState,
      restrictions,
      couponFrequency: couponFrequency || null,
      sourceSheet
    }
  };
}

function getFirst(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return null;
}

function getRestrictionsValue(row) {
  if (row.Column1 != null && row.Column1 !== '') return row.Column1;
  return row.RESTRICTIONS;
}

function cleanString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeCusip(value) {
  const cusip = cleanString(value).replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /^[A-Z0-9]{9}$/.test(cusip) ? cusip : '';
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRestrictions(value) {
  const raw = cleanString(value);
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map(item => item.trim().toUpperCase())
    .filter(item => /^[A-Z]{2}$/.test(item));
}

function normalizeRawTerm(value) {
  const raw = cleanString(value).toLowerCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (/^\d+y$/.test(raw)) return raw;
  if (/^\d+m$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${raw}m`;
  return raw;
}

function termToMonths(term) {
  const raw = normalizeRawTerm(term);
  let match = raw.match(/^(\d+)m$/);
  if (match) return parseInt(match[1], 10);
  match = raw.match(/^(\d+)y$/);
  if (match) return parseInt(match[1], 10) * 12;
  return null;
}

function toYmd(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value)) {
    return dateToYmd(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  const date = new Date(raw);
  return isNaN(date) ? null : dateToYmd(date);
}

function dateToYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

module.exports = {
  DEFAULT_SHEETS,
  parseWeeklyCdWorksheet,
  importWeeklyCdWorksheet,
  mapWorksheetRow,
  termToMonths,
  toYmd
};
