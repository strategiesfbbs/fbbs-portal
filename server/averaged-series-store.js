'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const AVERAGED_SERIES_DIRNAME = 'averaged-series';
const AVERAGED_SERIES_WORKBOOK_FILENAME = 'current-averaged-series.xlsm';
const AVERAGED_SERIES_MANIFEST_FILENAME = 'manifest.json';
const AVERAGED_SERIES_DATASET_FILENAME = 'peer-series.json';

function averagedSeriesDirForReportsDir(bankReportsDir) {
  return path.join(bankReportsDir, AVERAGED_SERIES_DIRNAME);
}

function averagedSeriesWorkbookPathForReportsDir(bankReportsDir) {
  return path.join(averagedSeriesDirForReportsDir(bankReportsDir), AVERAGED_SERIES_WORKBOOK_FILENAME);
}

function averagedSeriesManifestPathForReportsDir(bankReportsDir) {
  return path.join(averagedSeriesDirForReportsDir(bankReportsDir), AVERAGED_SERIES_MANIFEST_FILENAME);
}

function averagedSeriesDatasetPathForReportsDir(bankReportsDir) {
  return path.join(averagedSeriesDirForReportsDir(bankReportsDir), AVERAGED_SERIES_DATASET_FILENAME);
}

function writeJsonAtomic(filePath, value, spaces = 2) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, spaces));
  fs.renameSync(tmpPath, filePath);
}

function readCell(rows, rowIndex, colIndex) {
  const row = rows[rowIndex] || [];
  const value = row[colIndex];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function readNumberCell(rows, rowIndex, colIndex) {
  const value = rows[rowIndex] && rows[rowIndex][colIndex];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readAveragedSeriesRows(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, {
    cellFormula: false,
    cellStyles: false,
    cellNF: false,
    cellDates: false
  });
  if (!workbook.SheetNames.includes('AVERAGED_SERIES')) {
    const err = new Error('Averaged-series workbook must include an AVERAGED_SERIES sheet.');
    err.statusCode = 400;
    throw err;
  }
  const sheet = workbook.Sheets.AVERAGED_SERIES;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
}

function periodColumnsFromRows(rows) {
  return (rows[10] || [])
    .map((value, index) => ({ period: String(value || '').trim(), index }))
    .filter(item => /^\d{4}Q[1-4]$/i.test(item.period))
    .slice(0, 12);
}

function isSectionLabel(value) {
  const label = String(value || '').trim();
  return Boolean(label) && /^[A-Z][A-Z0-9 &/()%-]+$/.test(label);
}

function cleanMetricLabel(value) {
  return String(value || '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/^\s*\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function metricKeyFromLabel(label, rowNumber) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'metric'}-${rowNumber}`;
}

function normalizeMetricValue(value) {
  if (value === undefined || value === null || value === '') {
    return { rawValue: null, value: null, amount: null, percent: null };
  }
  if (typeof value === 'number') {
    return { rawValue: value, value, amount: null, percent: null };
  }
  const rawValue = String(value).replace(/\s+/g, ' ').trim();
  if (!rawValue) return { rawValue: null, value: null, amount: null, percent: null };

  const amountPercentMatch = rawValue.match(/^(-?[\d,]+(?:\.\d+)?)\s*\/\s*(-?[\d,]+(?:\.\d+)?)\s*%?$/);
  if (amountPercentMatch) {
    return {
      rawValue,
      value: null,
      amount: Number(amountPercentMatch[1].replace(/,/g, '')),
      percent: Number(amountPercentMatch[2].replace(/,/g, ''))
    };
  }

  const numberMatch = rawValue.match(/^-?[\d,]+(?:\.\d+)?%?$/);
  if (numberMatch) {
    const number = Number(rawValue.replace(/,/g, '').replace(/%$/, ''));
    return {
      rawValue,
      value: Number.isFinite(number) ? number : null,
      amount: null,
      percent: rawValue.endsWith('%') && Number.isFinite(number) ? number : null
    };
  }

  return { rawValue, value: null, amount: null, percent: null };
}

function peerGroupFromRows(rows, options = {}) {
  const periods = (rows[10] || [])
    .slice(4, 12)
    .map(value => String(value || '').trim())
    .filter(value => /^\d{4}Q[1-4]$/i.test(value));
  return {
    id: 'current',
    label: readCell(rows, 0, 3) || 'Averaged Series Peer Group',
    criteria: {
      assetRange: readCell(rows, 1, 4),
      agLoanRange: readCell(rows, 2, 4),
      subchapterS: readCell(rows, 3, 4),
      region: readCell(rows, 4, 4)
    },
    populationCount: readNumberCell(rows, 5, 4),
    populationPercent: readCell(rows, 5, 5),
    latestPeriod: periods[0] || '',
    periods,
    sourceFile: options.sourceFile || ''
  };
}

function extractAveragedSeriesMetadata(workbookPath, options = {}) {
  const rows = readAveragedSeriesRows(workbookPath);
  const peerGroup = peerGroupFromRows(rows, options);
  const metricRows = rows.slice(13).filter(row => {
    const label = cleanMetricLabel(row[3] || row[0]);
    return label && !isSectionLabel(label);
  });
  const metadata = {
    importedAt: new Date().toISOString(),
    sourceFile: options.sourceFile || path.basename(workbookPath),
    sheetName: 'AVERAGED_SERIES',
    title: peerGroup.label,
    assetRange: peerGroup.criteria.assetRange,
    agLoanRange: peerGroup.criteria.agLoanRange,
    subchapterS: peerGroup.criteria.subchapterS,
    region: peerGroup.criteria.region,
    populationCount: peerGroup.populationCount,
    populationPercent: peerGroup.populationPercent,
    latestPeriod: peerGroup.latestPeriod,
    periods: peerGroup.periods,
    metricCount: metricRows.length,
    workbookFile: AVERAGED_SERIES_WORKBOOK_FILENAME,
    datasetFile: AVERAGED_SERIES_DATASET_FILENAME,
    seriesRowCount: metricRows.length * peerGroup.periods.length
  };
  return metadata;
}

function parseAveragedSeriesWorkbook(workbookPath, options = {}) {
  const rows = readAveragedSeriesRows(workbookPath);
  const periodColumns = periodColumnsFromRows(rows);
  const peerGroup = peerGroupFromRows(rows, options);
  const metrics = [];
  const series = [];
  let section = 'Overview';

  rows.slice(13).forEach((row, offset) => {
    const rowNumber = offset + 14;
    const rawLabel = row[3] || row[0];
    const label = cleanMetricLabel(rawLabel);
    if (!label) return;
    if (isSectionLabel(label)) {
      section = label;
      return;
    }

    const metricKey = metricKeyFromLabel(label, rowNumber);
    const sourceColumns = [row[22], row[25]]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const metric = {
      key: metricKey,
      label,
      section,
      rowNumber,
      sourceColumns
    };
    metrics.push(metric);

    for (const column of periodColumns) {
      const parsed = normalizeMetricValue(row[column.index]);
      series.push({
        peerGroupId: peerGroup.id,
        metricKey,
        period: column.period,
        ...parsed
      });
    }
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFile: options.sourceFile || path.basename(workbookPath),
    peerGroups: [peerGroup],
    periods: periodColumns.map(column => column.period),
    metrics,
    series
  };
}

function saveAveragedSeriesWorkbook(bankReportsDir, workbookPath, options = {}) {
  const metadata = extractAveragedSeriesMetadata(workbookPath, options);
  const dataset = parseAveragedSeriesWorkbook(workbookPath, {
    sourceFile: metadata.sourceFile
  });
  const dir = averagedSeriesDirForReportsDir(bankReportsDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(workbookPath, averagedSeriesWorkbookPathForReportsDir(bankReportsDir));
  writeJsonAtomic(averagedSeriesDatasetPathForReportsDir(bankReportsDir), dataset, 2);
  writeJsonAtomic(averagedSeriesManifestPathForReportsDir(bankReportsDir), { metadata }, 2);
  return metadata;
}

function loadAveragedSeriesDataset(bankReportsDir) {
  const datasetPath = averagedSeriesDatasetPathForReportsDir(bankReportsDir);
  if (!fs.existsSync(datasetPath)) return null;
  return JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
}

function getAveragedSeriesStatus(bankReportsDir) {
  const manifestPath = averagedSeriesManifestPathForReportsDir(bankReportsDir);
  const workbookPath = averagedSeriesWorkbookPathForReportsDir(bankReportsDir);
  const datasetPath = averagedSeriesDatasetPathForReportsDir(bankReportsDir);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(workbookPath) || !fs.existsSync(datasetPath)) {
    return { available: false };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    const stat = fs.statSync(workbookPath);
    return {
      available: true,
      metadata: manifest.metadata || {},
      dataset: {
        peerGroupCount: Array.isArray(dataset.peerGroups) ? dataset.peerGroups.length : 0,
        metricCount: Array.isArray(dataset.metrics) ? dataset.metrics.length : 0,
        seriesRowCount: Array.isArray(dataset.series) ? dataset.series.length : 0,
        periods: Array.isArray(dataset.periods) ? dataset.periods : []
      },
      sizeBytes: stat.size
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

module.exports = {
  AVERAGED_SERIES_DIRNAME,
  AVERAGED_SERIES_DATASET_FILENAME,
  AVERAGED_SERIES_MANIFEST_FILENAME,
  AVERAGED_SERIES_WORKBOOK_FILENAME,
  averagedSeriesDatasetPathForReportsDir,
  averagedSeriesDirForReportsDir,
  averagedSeriesWorkbookPathForReportsDir,
  extractAveragedSeriesMetadata,
  getAveragedSeriesStatus,
  loadAveragedSeriesDataset,
  parseAveragedSeriesWorkbook,
  saveAveragedSeriesWorkbook
};
