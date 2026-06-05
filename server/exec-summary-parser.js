'use strict';

/**
 * FBBS Executive Summary — source parsers.
 *
 * Pure xlsx -> normalized-JSON parsers for the daily inputs behind the
 * (management-only) Executive Summary tab. No I/O beyond reading the workbook
 * path it is handed; no SQLite, no network. Follows the portal parser
 * convention: every parser returns `{ asOfDate, warnings, ... }`; the caller
 * (exec-summary-store) injects extractedAt / source filenames.
 *
 * Inputs (Bloomberg + margin-calc exports — cached values, no live BDP at read):
 *   - Inventory & risk grid   (grid1_ab5*.xlsx)      -> parseInventoryGrid
 *   - TBLT trade blotter      (grid1_*.xlsx)         -> parseSectorLookup   (trades + CUSIP lookup)
 *   - TH trade activity       (grid1_v0d*.xlsx)      -> parseTradeActivity  (legacy optional detail)
 *   - Net-capital workbook    (...MARGIN CALC.xlsm)  -> parseMarginWorkbook
 */

const XLSX = require('./xlsx');

// ---------------------------------------------------------------- helpers ----
function txt(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function numify(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (123) accounting negative
  s = s.replace(/[$,%\s]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// Excel serial -> ISO using a UTC epoch (timezone-safe; 1899-12-30 covers the
// Excel 1900 leap-year bug). Also accepts JS Date and mm/dd/yyyy strings.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

function excelToISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return fmtDate(new Date(EXCEL_EPOCH + Math.round(v) * 86400000));
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    if (yy.length === 2) yy = (Number(yy) > 70 ? '19' : '20') + yy;
    return `${yy}-${pad2(Number(mm))}-${pad2(Number(dd))}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function isCusip(s) {
  const t = txt(s).toUpperCase();
  return /^[0-9A-Z]{8,9}$/.test(t) && /\d/.test(t);
}

function readWorkbook(filePath, opts = {}) {
  return XLSX.readFile(filePath, opts);
}
function firstSheetAoa(filePath, opts = {}) {
  const wb = readWorkbook(filePath, opts);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
}
function firstSheetObjects(filePath, opts = {}) {
  const wb = readWorkbook(filePath, opts);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null, blankrows: false });
}

// ----------------------------------------------------- inventory & risk grid -
// One row per security (+ sector subtotal rows that carry no CUSIP). The grid
// is grouped subtotal-first: a sector label row (Corp/Govt/Muni) precedes its
// member securities; a "USD Total" row is the firm grand total.
function parseInventoryGrid(filePath) {
  const warnings = [];
  const rows = firstSheetAoa(filePath);
  if (!rows.length) {
    return { asOfDate: null, warnings: ['inventory grid empty'], securities: [], sectorTotals: [], grandTotal: null };
  }
  const header = rows[0].map(txt);
  const col = name => {
    const i = header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    return i;
  };
  const ci = {
    security: 0,
    cusip: col('CUSIP(s)') >= 0 ? col('CUSIP(s)') : 1,
    position: col('Position'),
    tdsExp: col('TDS Exp'),
    bidPrice: col('BidPrice'),
    bidYield: col('BidYield'),
    spread: col('Spread'),
    risk: col('Risk'),
    pnl: col('P & L'),
  };

  const securities = [];
  const sectorTotals = [];
  let grandTotal = null;
  let currentSector = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const security = txt(row[ci.security]);
    const cusip = txt(row[ci.cusip]).toUpperCase();
    if (!security && !cusip) continue;

    if (!cusip) {
      const rollup = { label: security, position: numify(row[ci.position]), pnl: numify(row[ci.pnl]) };
      if (/^(usd\s+)?total$/i.test(security)) grandTotal = rollup;
      else { sectorTotals.push(rollup); currentSector = security; }
      continue;
    }

    const position = numify(row[ci.position]);   // $000 par
    const bidPrice = numify(row[ci.bidPrice]);
    securities.push({
      security,
      cusip,
      sector: currentSector,
      position,
      tdsExp: numify(row[ci.tdsExp]),
      bidPrice,
      bidYield: numify(row[ci.bidYield]),
      spread: numify(row[ci.spread]),
      risk: numify(row[ci.risk]),   // DV01 input ($/bp)
      pnl: numify(row[ci.pnl]),
      // market value, $ — par($000) * 1000 * price/100; null when unpriced
      mktValue: (position != null && bidPrice != null) ? position * 1000 * bidPrice / 100 : null,
    });
  }

  if (!securities.length) warnings.push('no priced securities parsed from inventory grid');
  return { asOfDate: null, warnings, securities, sectorTotals, grandTotal };
}

// ------------------------------------------------------- TH trade activity ---
// One row per ticket leg. Carries trader/desk, salesperson, counterparty,
// customer type, and the markup/commission (Transaction Cost 1+2 = revenue).
function parseTradeActivity(filePath) {
  const warnings = [];
  const records = firstSheetObjects(filePath);
  const trades = [];
  let maxDate = null;

  for (const row of records) {
    const cusip = txt(row['Cusip Number']).toUpperCase();
    const ticket = txt(row['Ticket']);
    if (!cusip && !ticket) continue;

    const tradeDate = excelToISO(row['Trade Date']);
    const asOf = excelToISO(row['As of Date']) || tradeDate;
    if (asOf && (!maxDate || asOf > maxDate)) maxDate = asOf;

    const c1 = numify(row['Transaction Cost 1 Amount']) || 0;
    const c2 = numify(row['Transaction Cost 2 Amount']) || 0;

    trades.push({
      trader: txt(row['Trader']),                 // desk code, e.g. 30-PRICD
      type: txt(row['Type']),
      ticket,
      security: txt(row['Security Description']),
      cusip,
      buySell: txt(row['B/S']).toUpperCase(),
      amount: numify(row['Amount']),              // $000 par
      price: numify(row['Price']),
      counterparty: txt(row['Counterparty']),
      firmAccount: txt(row['Firm Account Long Name']),
      masterAccount: txt(row['Master Account Long Name']),
      tradeDate,
      settleDate: excelToISO(row['Settle Date']),
      salesperson: txt(row['Salesperson']),       // rep code, e.g. F57
      txnCost1: c1,
      txnCost2: c2,
      revenue: c1 + c2,                           // markup + commission
      principal: numify(row['Principal']),
      accruedInterest: numify(row['Accrued Interest']),
      customerType: txt(row['Firm Account Customer Type']).toUpperCase() || 'UNSPECIFIED', // DEALER/CUST/RETAIL
    });
  }

  if (!trades.length) warnings.push('no trades parsed from activity sheet');
  return { asOfDate: maxDate, warnings, trades };
}

// -------------------------------------- TBLT trades + CUSIP -> sector/issuer -
// The TBLT blotter can carry duplicate CUSIPs because each sheet tells the
// day's trade story. We keep every row as activity, while also building a
// deduped CUSIP reference map for issuer/sector/duration/maturity joins.
function parseSectorLookup(filePath) {
  const warnings = [];
  const records = firstSheetObjects(filePath);
  const byCusip = {};
  const trades = [];
  let maxDate = null;

  records.forEach((row, idx) => {
    const cusip = txt(row['Cusip Number']).toUpperCase();
    if (!isCusip(cusip)) return;

    const td = excelToISO(row['Trade Date']);
    if (td && (!maxDate || td > maxDate)) maxDate = td;
    const amount = numify(row['Amount']);
    const price = numify(row['Price']);
    const principal = numify(row['Principal']);
    const derivedPrincipal = (amount != null && price != null) ? amount * 1000 * price / 100 : null;
    const security = txt(row['Security']) || txt(row['Security Description']);
    const trade = {
      trader: txt(row['Trader']),
      type: txt(row['Type']),
      ticket: txt(row['Ticket']) || `TBLT-${idx + 1}`,
      security,
      cusip,
      buySell: txt(row['B/S']).toUpperCase(),
      amount,
      price,
      counterparty: txt(row['Counterparty']),
      firmAccount: txt(row['Firm Account Long Name']),
      masterAccount: txt(row['Master Account Long Name']),
      tradeDate: td,
      settleDate: excelToISO(row['Settle Date']),
      salesperson: txt(row['Salesperson']),
      txnCost1: numify(row['Transaction Cost 1 Amount']),
      txnCost2: numify(row['Transaction Cost 2 Amount']),
      revenue: numify(row['Revenue']),
      principal: principal != null ? principal : derivedPrincipal,
      accruedInterest: numify(row['Accrued Interest']),
      customerType: txt(row['Firm Account Customer Type']).toUpperCase() || 'UNSPECIFIED',
      issuer: txt(row['Issuer']) || null,
      industrySector: txt(row['Industry Sector']) || null,
      industryGroup: txt(row['Industry Group']) || null,
      marketSector: txt(row['Market Sector Description']) || null,
    };
    if (trade.revenue == null && (trade.txnCost1 != null || trade.txnCost2 != null)) {
      trade.revenue = (trade.txnCost1 || 0) + (trade.txnCost2 || 0);
    }
    trades.push(trade);

    if (!byCusip[cusip]) {
      byCusip[cusip] = {
        cusip,
        issuer: txt(row['Issuer']) || null,
        industrySector: txt(row['Industry Sector']) || null,
        industryGroup: txt(row['Industry Group']) || null,
        marketSector: txt(row['Market Sector Description']) || null,  // Corp/Govt/Mtge/Muni
        coupon: numify(row['Coupon']),
        maturityDate: excelToISO(row['Maturity Date']),
        nextCallDate: excelToISO(row['Next Call Date']),
        duration: numify(row['Duration']),
        securityType: txt(row['Security Type']) || null,
        couponType: txt(row['Coupon Type']) || null,
      };
    } else {
      const e = byCusip[cusip]; // backfill gaps from later legs
      if (!e.issuer) e.issuer = txt(row['Issuer']) || null;
      if (!e.marketSector) e.marketSector = txt(row['Market Sector Description']) || null;
      if (!e.industrySector) e.industrySector = txt(row['Industry Sector']) || null;
      if (e.duration == null) e.duration = numify(row['Duration']);
    }
  });

  const cusipCount = Object.keys(byCusip).length;
  if (!cusipCount) warnings.push('no CUSIPs parsed from TBLT blotter');
  if (!trades.length) warnings.push('no trade rows parsed from TBLT blotter');
  return { asOfDate: maxDate, warnings, byCusip, cusipCount, trades, tradeCount: trades.length };
}

// ------------------------------------------------------ net-capital workbook -
const MAIN_METRICS = [
  ['firmHaircutTotal',  l => l.startsWith('FIRM HAIRCUT REPORT')],
  ['nonHaircutAdj',     l => l.startsWith('NON-HAIRCUT ADJUSTMENTS')],
  ['approvedIssuerAdj', l => l.startsWith('APPROVED 20% ISSUERS')],
  ['totalRequirement',  l => l === 'TOTAL REQUIREMENT'],
  ['equity115mc',       l => l.startsWith('EQUITY (115MC)')],
  ['adjustedEquity',    l => l.startsWith('ADJUSTED EQUITY')],
  ['sdNetworth',        l => l.startsWith('S/D NETWORTH')],
  ['gma168Adj',         l => l.startsWith('GMA168 EQUITY ADJUSTMENTS')],
  ['totalEquity',       l => l === 'TOTAL EQUITY'],
  ['excessCall',        l => l === 'EXCESS (CALL)'],
  ['coveredAgencyReq',  l => l.startsWith('COVERED AGENCY')],
  ['whenIssueReq',      l => l.startsWith('WHEN ISSUE')],
  ['tbaReq',            l => l.startsWith('TBA DAILY')],
  ['netExcessCall',     l => l.startsWith('NET EXCESS')],
  ['pershingExcess',    l => l.startsWith('EXCESS PER PERSHING')],
  ['variance',          l => l === 'VARIANCE'],
];

function parseMarginWorkbook(filePath) {
  const warnings = [];
  const wb = readWorkbook(filePath); // serials, not cellDates -> tz-safe via excelToISO
  const aoa = name => (wb.Sheets[name]
    ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false })
    : []);

  // ---- MAIN: capital summary + approved-issuer list ----
  const capital = {};
  const approvedIssuers = [];
  let preparedDate = null, cobDate = null;

  for (const row of aoa('MAIN')) {
    const label = txt(row[0]).toUpperCase();
    if (label.startsWith('PREPARED ON')) preparedDate = excelToISO(row[1]);
    else if (label.startsWith('CLOSE OF BUSINESS')) cobDate = excelToISO(row[1]);

    if (label) {
      const value = [1, 2, 3].map(i => numify(row[i])).find(n => n !== null) ?? null;
      for (const [key, test] of MAIN_METRICS) {
        if (capital[key] === undefined && test(label)) { capital[key] = value; break; }
      }
    }

    const issuer = txt(row[5]); // col F
    const factor = numify(row[4]); // col E (0 for FHLB, 0.2 for approved)
    if (issuer && issuer.toUpperCase() !== 'APPROVED ISSUER' && factor !== null) {
      approvedIssuers.push({ name: issuer.replace(/\s+$/, ''), factor });
    }
  }

  if (capital.totalEquity != null && capital.totalRequirement != null) {
    const calcExcess = capital.totalEquity - capital.totalRequirement;
    capital.bufferPct = capital.totalEquity ? calcExcess / capital.totalEquity : null;
    if (capital.excessCall != null && Math.abs(calcExcess - capital.excessCall) > 1) {
      warnings.push(`excess(call) ${capital.excessCall} != equity-requirement ${calcExcess}`);
    }
  }
  if (capital.excessCall != null && capital.pershingExcess != null) {
    capital.pershingVariance = capital.excessCall - capital.pershingExcess; // firm vs Pershing trust check
  }
  if (!Object.keys(capital).length) warnings.push('no capital metrics parsed from MAIN');

  // ---- TOTAL_HAIRCUTS: aged haircut report (tab-packed cells) ----
  const haircuts = [];
  for (const row of aoa('TOTAL_HAIRCUTS')) {
    const cusip = txt(txt(row[0]).split('\t')[0]).toUpperCase();
    if (!isCusip(cusip)) continue;
    const cParts = txt(row[2]).split('\t');
    const dParts = txt(row[3]).split('\t');
    haircuts.push({
      cusip,
      mktValue: numify(cParts[0]),
      haircut: numify(dParts[0]),
      ageDays: numify(dParts[1]),
    });
  }

  // ---- UNPRICED long/short ----
  const unpriced = [];
  for (const row of aoa('UNPRICED')) {
    const cusip = txt(row[0]).toUpperCase();
    if (!isCusip(cusip)) continue;
    unpriced.push({ cusip, desc: txt(row[1]), mktValue: numify(row[2]), unpricedBook: numify(row[3]) });
  }

  // ---- FT_60_DETAIL: positions -> account ----
  const positionsByAccount = [];
  const ft = aoa('FT_60_DETAIL');
  for (let r = 1; r < ft.length; r++) {
    const row = ft[r];
    const account = txt(row[0]);
    const cusip = txt(row[2]).toUpperCase();
    if (!account || !isCusip(cusip)) continue;
    positionsByAccount.push({
      account,
      name: txt(row[1]),
      cusip,
      description: txt(row[3]),
      quantity: numify(row[4]),
      settleDate: excelToISO(row[5]),
      book: numify(row[6]),
    });
  }

  // ---- ACCOUNT_TYPE lookup ----
  const accountTypes = {};
  for (const row of aoa('ACCOUNT_TYPE')) {
    const acct = txt(row[0]);
    const type = txt(row[1]);
    if (acct && acct.toUpperCase() !== 'ACCOUNT' && type) accountTypes[acct] = type;
  }

  // ---- MARGIN DISCREPANCIES: tail of dated entries ----
  const discrepancies = [];
  for (const row of aoa('MARGIN DISCREPANCIES')) {
    const date = excelToISO(row[0]);
    const note = txt(row[1]);
    if (date && note) discrepancies.push({ date, note });
  }
  const recentDiscrepancies = discrepancies.slice(-10).reverse();

  return {
    asOfDate: preparedDate,
    cobDate,
    preparedDate,
    warnings,
    capital,
    approvedIssuers,
    haircuts,
    unpriced,
    positionsByAccount,
    accountTypes,
    recentDiscrepancies,
    discrepancyCount: discrepancies.length,
  };
}

module.exports = {
  parseInventoryGrid,
  parseTradeActivity,
  parseSectorLookup,
  parseMarginWorkbook,
  // exported for unit tests
  _helpers: { txt, numify, excelToISO, isCusip },
};
