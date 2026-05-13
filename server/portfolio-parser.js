// Parses a THC Analytics bond accounting portfolio workbook into structured
// holdings. The xlsm template stores per-sector holdings on dedicated sheets
// (Agency, MBS, CMO, CMBS, Treasury, CDs, Corporate, Exempt Muni, Taxable
// Muni, SBA, ABS, Other) with the header row hidden somewhere below row 40
// and the actual holding rows directly under it. Portfolio totals live on
// the "linked data" sheet.
//
// Parsed output is cached as `holdings.json` next to the source xlsm so we
// only do the xlsx read once per file. Cache rebuilds when the source mtime
// changes.

const fs = require('fs');
const path = require('path');

const SECTOR_SHEETS = [
  'Agency', 'MBS', 'CMO', 'CMBS', 'Treasury', 'CDs',
  'Corporate', 'Exempt Muni', 'Taxable Muni', 'SBA', 'ABS', 'Other'
];

// Map common header-cell variants to canonical field names. THC's templates
// embed newlines and trailing spaces — normalize and match loosely.
const HEADER_MAP = {
  'cusip': 'cusip',
  'description': 'description',
  'issuer name': 'issuerName',
  'par (000)': 'parThousands',
  'face value (000)': 'parThousands',
  'cpn (%)': 'coupon',
  'cpn type': 'couponType',
  'coupon rate (%)': 'coupon',
  'maturity': 'maturityRaw',
  'maturity (year)': 'maturityRaw',
  'next call': 'nextCallRaw',
  'next call date': 'nextCallRaw',
  'bk val (000)': 'bookValueThousands',
  'mkt val (000)': 'marketValueThousands',
  'g/l (000)': 'gainLossThousands',
  'gain/loss (000)': 'gainLossThousands',
  'bk px': 'bookPrice',
  'mkt px': 'marketPrice',
  'book price': 'bookPrice',
  'market price': 'marketPrice',
  'bk ytw (%)': 'bookYieldYtw',
  'bk ytm (%)': 'bookYieldYtm',
  'mkt ytw (%)': 'marketYieldYtw',
  'mkt ytm (%)': 'marketYieldYtm',
  'book yield (%)': 'bookYieldYtm',
  'avg life': 'averageLife',
  'average life': 'averageLife',
  'wal': 'averageLife',
  'weighted average life': 'averageLife',
  'oas (bp)': 'oasBp',
  'spread (bp)': 'spreadBp',
  'eff. dur': 'effectiveDuration',
  'eff. conv': 'effectiveConvexity',
  'afs/ htm': 'classification',
  'afs/htm': 'classification',
  'accrued interest': 'accruedInterest'
};

function normalizeHeader(raw) {
  return String(raw || '').toLowerCase().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function excelSerialToIsoDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  // Excel epoch is 1899-12-30 (accounting for the 1900 leap-year bug)
  const ms = (n - 25569) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function toIsoDate(value) {
  if (value === '' || value == null) return '';
  if (typeof value === 'number') return excelSerialToIsoDate(value);
  const s = String(value).trim();
  // Already ISO-ish?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // US format M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const yr = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${yr}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return '';
}

function toNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function findHeaderRow(sheet) {
  const XLSX = require('xlsx');
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  if (!range) return null;
  // Walk rows; header is the row containing "Cusip" in column B (or A-D).
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 200); r += 1) {
    for (const col of ['B', 'A', 'C', 'D']) {
      const cell = sheet[col + (r + 1)];
      if (!cell) continue;
      const v = normalizeHeader(cell.v);
      if (v === 'cusip') return r + 1;
    }
  }
  return null;
}

function parseSectorSheet(sheet, sectorName) {
  if (!sheet) return [];
  const XLSX = require('xlsx');
  const headerRow = findHeaderRow(sheet);
  if (!headerRow) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  // Build column → field map from the header row.
  const colMap = {};
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const colLetter = XLSX.utils.encode_col(c);
    const cell = sheet[colLetter + headerRow];
    if (!cell || cell.v == null) continue;
    const key = HEADER_MAP[normalizeHeader(cell.v)];
    if (key) colMap[colLetter] = key;
  }
  if (!Object.values(colMap).includes('cusip')) return [];

  const holdings = [];
  // headerRow is 1-indexed; iterate 1-indexed Excel rows directly.
  const lastRow = range.e.r + 1;
  for (let r = headerRow + 1; r <= lastRow; r += 1) {
    const row = {};
    let hasCusip = false;
    for (const [colLetter, field] of Object.entries(colMap)) {
      const cell = sheet[colLetter + r];
      if (!cell || cell.v === '' || cell.v == null) continue;
      const value = cell.v;
      switch (field) {
        case 'cusip':
        case 'description':
        case 'issuerName':
        case 'couponType':
        case 'classification':
          row[field] = String(value).trim();
          if (field === 'cusip' && row[field]) hasCusip = true;
          break;
        case 'maturityRaw':
          row.maturity = toIsoDate(value);
          break;
        case 'nextCallRaw':
          row.nextCall = toIsoDate(value);
          break;
        default:
          row[field] = toNumber(value);
      }
    }
    if (!hasCusip) {
      // Subtotal or blank — stop at the first non-data row past the holdings block.
      if (Object.keys(row).length === 0) break;
      continue;
    }
    // Convert thousands to dollars for clarity.
    if (row.parThousands != null) row.par = Math.round(row.parThousands * 1000);
    if (row.bookValueThousands != null) row.bookValue = Math.round(row.bookValueThousands * 1000);
    if (row.marketValueThousands != null) row.marketValue = Math.round(row.marketValueThousands * 1000);
    if (row.gainLossThousands != null) row.gainLoss = Math.round(row.gainLossThousands * 1000);
    row.sector = sectorName;
    // Yield gap: positive means market yield is higher than book — swap-out signal.
    const bookYld = row.bookYieldYtw ?? row.bookYieldYtm;
    const mktYld = row.marketYieldYtw ?? row.marketYieldYtm;
    if (bookYld != null && mktYld != null) row.yieldGap = mktYld - bookYld;
    holdings.push(row);
  }
  return holdings;
}

const TOTAL_LABEL_MAP = {
  'total par value(000)': 'parTotalThousands',
  'total market value w/o accrued(000)': 'marketValueTotalThousands',
  'total book value(000)': 'bookValueTotalThousands',
  'weighted average coupon%': 'weightedCoupon',
  'weighted average life': 'weightedAverageLife',
  'market ytw%': 'marketYieldYtw',
  'book ytw%': 'bookYieldYtw',
  'te market ytw%': 'taxEqMarketYieldYtw',
  'te book ytw%': 'taxEqBookYieldYtw'
};

function parseLinkedDataTotals(sheet) {
  if (!sheet) return null;
  const XLSX = require('xlsx');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const totals = {};
  for (const row of rows) {
    const label = normalizeHeader(row[1]);
    const current = row[4]; // "Current" column
    if (!label || current === '' || current == null) continue;
    const key = TOTAL_LABEL_MAP[label];
    if (!key) continue;
    const n = toNumber(current);
    if (n == null) continue;
    totals[key] = n;
  }
  if (totals.parTotalThousands != null) totals.par = Math.round(totals.parTotalThousands * 1000);
  if (totals.marketValueTotalThousands != null) totals.marketValue = Math.round(totals.marketValueTotalThousands * 1000);
  if (totals.bookValueTotalThousands != null) totals.bookValue = Math.round(totals.bookValueTotalThousands * 1000);
  if (totals.par != null && totals.marketValue != null) totals.unrealizedGainLoss = totals.marketValue - totals.bookValue;
  return totals;
}

function parseAsOfDate(wb) {
  const overview = wb.Sheets['Overview'];
  if (!overview) return '';
  // C3 typically holds "as of MM/DD/YYYY"
  const cell = overview['C3'];
  if (cell && cell.v) {
    const m = String(cell.v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

function parsePortfolioWorkbook(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath);
  const sectors = {};
  const sectorCounts = {};
  let allHoldings = [];
  for (const name of SECTOR_SHEETS) {
    const rows = parseSectorSheet(wb.Sheets[name], name);
    if (rows.length) {
      sectors[name] = rows;
      sectorCounts[name] = rows.length;
      allHoldings = allHoldings.concat(rows);
    }
  }
  const totals = parseLinkedDataTotals(wb.Sheets['linked data']);
  const asOfDate = parseAsOfDate(wb);
  // Derive helpful aggregates.
  const totalPositions = allHoldings.length;
  const sumPar = allHoldings.reduce((acc, h) => acc + (h.par || 0), 0);
  const sumBookValue = allHoldings.reduce((acc, h) => acc + (h.bookValue || 0), 0);
  const sumMarketValue = allHoldings.reduce((acc, h) => acc + (h.marketValue || 0), 0);
  const sumGainLoss = allHoldings.reduce((acc, h) => acc + (h.gainLoss || 0), 0);
  // CUSIP index for fast "do they already own this" lookups.
  const cusipIndex = {};
  for (const h of allHoldings) {
    if (h.cusip) cusipIndex[h.cusip.toUpperCase()] = { sector: h.sector, par: h.par, bookYield: h.bookYieldYtm ?? h.bookYieldYtw };
  }
  return {
    parsedAt: new Date().toISOString(),
    asOfDate,
    sourceFile: path.basename(filePath),
    sectors,
    sectorCounts,
    totals: totals || null,
    aggregates: {
      totalPositions,
      par: sumPar,
      bookValue: sumBookValue,
      marketValue: sumMarketValue,
      gainLoss: sumGainLoss
    },
    cusipIndex
  };
}

function holdingsCachePath(portfolioXlsmPath) {
  return path.join(path.dirname(portfolioXlsmPath), path.basename(portfolioXlsmPath, path.extname(portfolioXlsmPath)) + '.holdings.json');
}

function loadParsedPortfolio(portfolioXlsmPath, options = {}) {
  if (!fs.existsSync(portfolioXlsmPath)) return null;
  const cachePath = holdingsCachePath(portfolioXlsmPath);
  const srcStat = fs.statSync(portfolioXlsmPath);
  if (!options.force && fs.existsSync(cachePath)) {
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
      try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (_) {
        // fall through and rebuild
      }
    }
  }
  const parsed = parsePortfolioWorkbook(portfolioXlsmPath);
  try {
    fs.writeFileSync(cachePath, JSON.stringify(parsed));
  } catch (_) {
    // Cache write failures are non-fatal — return the in-memory result.
  }
  return parsed;
}

module.exports = {
  SECTOR_SHEETS,
  parsePortfolioWorkbook,
  loadParsedPortfolio,
  holdingsCachePath
};
