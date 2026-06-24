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

const PARSED_PORTFOLIO_SCHEMA_VERSION = 4;

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
  // The Exempt/Taxable Muni sheets omit the space before the percent paren
  // (e.g. "Bk YTW(%)"); capture those variants so muni yields aren't lost.
  'bk ytw(%)': 'bookYieldYtw',
  'bk ytm(%)': 'bookYieldYtm',
  'mkt ytw(%)': 'marketYieldYtw',
  'mkt ytm(%)': 'marketYieldYtm',
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
  let cleaned = String(value).trim();
  if (!cleaned || cleaned === '-' || /^n\/?a$/i.test(cleaned)) return null;
  let negative = false;
  const paren = cleaned.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    cleaned = paren[1];
  }
  cleaned = cleaned.replace(/[$,%]/g, '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

function findHeaderRow(sheet) {
  const XLSX = require('./xlsx');
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
  const XLSX = require('./xlsx');
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
  const XLSX = require('./xlsx');
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
  // Guard the operands actually used (marketValue - bookValue); a missing
  // bookValue would otherwise compute marketValue - undefined = NaN into holdings.
  if (totals.marketValue != null && totals.bookValue != null) totals.unrealizedGainLoss = totals.marketValue - totals.bookValue;
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

function sheetRows(sheet) {
  if (!sheet) return [];
  const XLSX = require('./xlsx');
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  });
}

// The workbook's "cashflow data" sheet projects the portfolio's outstanding
// balance month-by-month under the base scenario — already embedding calls,
// scheduled amortization, and maturities. We capture the (date, base) series
// in $000 so the portal can show projected runoff (decline in balance) over a
// horizon, which is a truer reinvestment pipeline than stated maturities alone.
function findCashflowSheet(wb) {
  const exact = wb.SheetNames.find(n => /^cashflow data$/i.test(n));
  if (exact) return wb.Sheets[exact];
  const loose = wb.SheetNames.find(n => /cashflow data/i.test(n));
  return loose ? wb.Sheets[loose] : null;
}

function parseCashflowData(wb) {
  const sheet = findCashflowSheet(wb);
  if (!sheet) return null;
  const XLSX = require('./xlsx');
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (!grid || !grid.length) return null;
  // Header row sits within the first few rows and carries both "date" and "base".
  let hr = -1;
  for (let r = 0; r < Math.min(grid.length, 6); r += 1) {
    const norm = (grid[r] || []).map(normalizeHeader);
    if (norm.includes('date') && norm.includes('base')) { hr = r; break; }
  }
  if (hr < 0) return null;
  const hdr = (grid[hr] || []).map(normalizeHeader);
  const dc = hdr.indexOf('date');
  const bc = hdr.indexOf('base');
  if (dc < 0 || bc < 0) return null;
  const dates = [];
  const baseThousands = [];
  for (let r = hr + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;
    const iso = toIsoDate(row[dc]);
    const base = toNumber(row[bc]);
    if (iso && base != null) { dates.push(iso); baseThousands.push(base); }
  }
  if (!dates.length) return null;
  return { asOfDate: dates[0], dates, baseThousands };
}

function parseScenarioSummary(sheet) {
  const rows = sheetRows(sheet);
  const scenarioRows = [];
  for (const row of rows) {
    const shockLabel = String(row[2] || '').trim();
    if (!shockLabel || (!/^[-+]?\d+$/.test(shockLabel) && shockLabel.toLowerCase() !== 'base')) continue;
    const bookValueThousands = toNumber(row[3]);
    const marketValueThousands = toNumber(row[4]);
    scenarioRows.push({
      shock: shockLabel.toLowerCase() === 'base' ? 0 : toNumber(shockLabel),
      label: shockLabel,
      bookValue: bookValueThousands == null ? null : Math.round(bookValueThousands * 1000),
      marketValue: marketValueThousands == null ? null : Math.round(marketValueThousands * 1000),
      gainLoss: toNumber(row[5]) == null ? null : Math.round(toNumber(row[5])),
      gainLossPct: toNumber(row[6]),
      bookPrice: toNumber(row[7]),
      marketPrice: toNumber(row[8]),
      priceChangePct: toNumber(row[9]),
      yieldToWorst: toNumber(row[10]),
      bookYieldToWorst: toNumber(row[11])
    });
  }
  return scenarioRows;
}

function parseTotalReturnAnalysis(sheet) {
  const rows = sheetRows(sheet);
  const headerIndex = rows.findIndex(row => normalizeHeader(row[3]) === 'sector');
  if (headerIndex === -1) return [];
  const header = rows[headerIndex];
  const shockColumns = [];
  for (let i = 4; i < header.length; i += 1) {
    const shock = toNumber(header[i]);
    if (shock != null) shockColumns.push({ index: i, shock, key: String(header[i]).trim() });
  }
  const out = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const sector = cleanText(row[3]);
    if (!sector) continue;
    const returns = {};
    for (const col of shockColumns) {
      const value = toNumber(row[col.index]);
      if (value != null) returns[col.key] = value;
    }
    if (Object.keys(returns).length) out.push({ sector, returns });
  }
  return out;
}

function parsePeerReview(sheet) {
  const rows = sheetRows(sheet);
  const out = [];
  for (const row of rows) {
    const sector = cleanText(row[1]);
    if (!sector || /^sector$/i.test(sector) || /^peer:/i.test(sector)) continue;
    const parThousands = toNumber(row[3]);
    const hasMetrics = [row[4], row[5], row[7], row[8], row[10], row[11]].some(value => toNumber(value) != null);
    if (!hasMetrics) continue;
    out.push({
      sector,
      par: parThousands == null ? null : Math.round(parThousands * 1000),
      allocationPct: toNumber(row[4]),
      peerAllocationPct: toNumber(row[5]),
      weightedAverageCoupon: toNumber(row[7]),
      peerWeightedAverageCoupon: toNumber(row[8]),
      weightedAverageMaturity: toNumber(row[10]),
      peerWeightedAverageMaturity: toNumber(row[11])
    });
  }
  return out;
}

function keyRateLabel(value) {
  return String(value || '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/^krd\s*/i, '')
    .trim();
}

function parseKeyRateDuration(sheet) {
  const rows = sheetRows(sheet);
  const headerIndex = rows.findIndex(row => String(row[1] || '').trim().toLowerCase() === 'cusip');
  if (headerIndex === -1) return [];
  const header = rows[headerIndex];
  const keyColumns = [];
  for (let i = 7; i < header.length; i += 1) {
    const label = keyRateLabel(header[i]);
    if (label) keyColumns.push({ index: i, label });
  }
  const out = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const label = cleanText(row[1]);
    const description = cleanText(row[2]);
    if (!label || (/^[0-9A-Z]{6,}$/i.test(label) && /\d/.test(label))) continue;
    const values = {};
    for (const col of keyColumns) {
      const value = toNumber(row[col.index]);
      if (value != null) values[col.label] = value;
    }
    if (Object.keys(values).length) {
      out.push({
        label,
        description,
        par: toNumber(row[3]) == null ? null : Math.round(toNumber(row[3]) * 1000),
        bookValue: toNumber(row[4]) == null ? null : Math.round(toNumber(row[4]) * 1000),
        marketValue: toNumber(row[5]) == null ? null : Math.round(toNumber(row[5]) * 1000),
        gainLoss: toNumber(row[6]) == null ? null : Math.round(toNumber(row[6]) * 1000),
        values
      });
    }
  }
  return out;
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function parseWorkbookAnalytics(wb) {
  return {
    scenarioSummary: parseScenarioSummary(wb.Sheets['Scenario Summary']),
    totalReturn: parseTotalReturnAnalysis(wb.Sheets['Total Return Analysis']),
    peerReview: parsePeerReview(wb.Sheets['Peer Review']),
    keyRateDuration: parseKeyRateDuration(wb.Sheets['Key Rate Duration'])
  };
}

function parWeightedAverage(holdings, key) {
  let weighted = 0;
  let weight = 0;
  for (const h of holdings || []) {
    const value = toNumber(h && h[key]);
    const par = toNumber(h && h.par);
    if (value != null && par) {
      weighted += value * par;
      weight += par;
    }
  }
  return weight ? weighted / weight : null;
}

function parsePortfolioWorkbook(filePath) {
  const XLSX = require('./xlsx');
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
  const analytics = parseWorkbookAnalytics(wb);
  const cashflow = parseCashflowData(wb);
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
    schemaVersion: PARSED_PORTFOLIO_SCHEMA_VERSION,
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
      gainLoss: sumGainLoss,
      averageLife: parWeightedAverage(allHoldings, 'averageLife'),
      effectiveDuration: parWeightedAverage(allHoldings, 'effectiveDuration')
    },
    analytics,
    cashflow: cashflow || null,
    cusipIndex
  };
}

function holdingsCachePath(portfolioXlsmPath) {
  return path.join(path.dirname(portfolioXlsmPath), path.basename(portfolioXlsmPath, path.extname(portfolioXlsmPath)) + '.holdings.json');
}

function parsedPortfolioCacheIsFresh(cached) {
  return cached
    && cached.schemaVersion === PARSED_PORTFOLIO_SCHEMA_VERSION
    && cached.analytics
    && Array.isArray(cached.analytics.scenarioSummary)
    && Array.isArray(cached.analytics.totalReturn)
    && Array.isArray(cached.analytics.peerReview)
    && Array.isArray(cached.analytics.keyRateDuration)
    && ('cashflow' in cached);
}

function loadParsedPortfolio(portfolioXlsmPath, options = {}) {
  if (!fs.existsSync(portfolioXlsmPath)) return null;
  const cachePath = holdingsCachePath(portfolioXlsmPath);
  const srcStat = fs.statSync(portfolioXlsmPath);
  if (!options.force && fs.existsSync(cachePath)) {
    const cacheStat = fs.statSync(cachePath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (parsedPortfolioCacheIsFresh(cached)) return cached;
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
  _parseCashflowDataForTest: parseCashflowData,
  _parWeightedAverageForTest: parWeightedAverage,
  parsePortfolioWorkbook,
  parseWorkbookAnalytics,
  loadParsedPortfolio,
  holdingsCachePath
};
