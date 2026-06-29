/**
 * trade-fit-bridge.js — feed the Sales Dashboard trade-fit nudge from the
 * Salesforce Trade__c blotter (`trades` table) when it's populated.
 *
 * trade-fit.js was written against the Pershing `pershing_trades` table; main's
 * Salesforce import lands a parallel `trades` table (same firm reality, a
 * different export, a different `typecode` vocabulary). This bridge reads the
 * `trades` BUY rows, maps each `typecode` onto trade-fit's `security_type`
 * vocabulary, and hands the normalized rows to the SAME rollup
 * (trade-fit.buildProfileFromRows) — so the audience demand profile is identical
 * in shape and meaning regardless of which feed the desk maintains.
 *
 * Discipline: never throws. A missing/empty `trades` table (no Salesforce import
 * yet) returns null and the caller falls back to the Pershing profile. Reads go
 * through sqlite-db with bound parameters.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const sqliteDb = require('./sqlite-db');
const tradeStore = require('./trade-store'); // tradesDatabasePathForDir (same DB file as Pershing)
const tradeFit = require('./trade-fit');      // buildProfileFromRows, BANK_DB

// Salesforce Trade__c `typecode` → trade-fit security_type (a SECTYPE_CLASS key).
// Covers the documented short codes AND the Pershing-style long codes, so the
// bridge is correct whichever vocabulary the export uses. EQUITY/MUTFUND/UIT are
// intentionally absent (dropped — not the desk's fixed-income business).
const TYPECODE_TO_SECTYPE = {
  UST: 'GOVTSEC', USTREAS: 'GOVTSEC', TREAS: 'GOVTSEC', TREASURY: 'GOVTSEC',
  AGCY: 'GOVTSEC', AGENCY: 'GOVTSEC', GOVT: 'GOVTSEC', GOVTSEC: 'GOVTSEC', GSE: 'GOVTSEC',
  MUNI: 'MUNIDEBT', MUN: 'MUNIDEBT', MUNIDEBT: 'MUNIDEBT',
  CORP: 'CORPDEBT', CORPORATE: 'CORPDEBT', CORPDEBT: 'CORPDEBT',
  CD: 'MONEYMKT', BCD: 'MONEYMKT', CERT: 'MONEYMKT', MONEYMKT: 'MONEYMKT',
  MBS: 'ASSTBACK', CMO: 'ASSTBACK', ABS: 'ASSTBACK', CMBS: 'ASSTBACK', SBA: 'ASSTBACK', ASSTBACK: 'ASSTBACK',
};

/**
 * Resolve a trade-fit security_type from a Salesforce typecode (+ description as
 * a fallback). Returns null for non-FI / unmappable rows (the caller drops them).
 */
function sectypeFor(typecode, description) {
  const code = String(typecode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (TYPECODE_TO_SECTYPE[code]) return TYPECODE_TO_SECTYPE[code];

  const text = `${String(typecode || '').toUpperCase()} ${String(description || '').toUpperCase()}`;
  // Explicit non-fixed-income → drop.
  if (/\bEQUITY\b|\bEQ\b|COMMON ?STOCK|\bSTOCK\b|MUT(UAL)? ?FUND|\bMUTFUND\b|\bUIT\b|\bETF\b|\bADR\b/.test(text)) return null;
  if (/\bUST\b|TREAS/.test(text)) return 'GOVTSEC';
  if (/\bAGCY\b|AGENCY|\bFHLB\b|\bFFCB\b|\bFNMA\b|\bFHLMC\b|\bFHLM\b|FARM CR|HOME ?LN|FREDDIE|FANNIE/.test(text)) return 'GOVTSEC';
  if (/MUNI/.test(text)) return 'MUNIDEBT';
  if (/\bMBS\b|\bCMO\b|\bABS\b|\bCMBS\b|ASSET ?BACK|\bGNMA\b|REMIC|MORTGAGE/.test(text)) return 'ASSTBACK';
  if (/CORP/.test(text)) return 'CORPDEBT';
  if (/\bCD\b|CERTIFICATE OF DEP|MONEY ?MKT|MONEYMARKET|BROKERED/.test(text)) return 'MONEYMKT';
  return null;
}

/**
 * Build the per-audience trade-fit demand profile from the Salesforce `trades`
 * table. Same return shape as trade-fit.buildTradeFitProfile. Never throws →
 * returns null when the table is absent/empty or has no usable FI buys.
 *
 * opts: { bankReportsDir (required), log? }
 */
function buildTradeFitProfileFromTradeStore(opts) {
  const o = opts || {};
  const log = o.log || (() => {});
  const dir = o.bankReportsDir || '';
  if (!dir) return null;

  const dbPath = tradeStore.tradesDatabasePathForDir(dir);
  const bankDbPath = path.join(dir, tradeFit.BANK_DB);

  try {
    if (!fs.existsSync(dbPath)) return null;

    let asOf = null;
    let raw = [];
    try {
      const asOfRow = sqliteDb.querySqliteJson(dbPath,
        "SELECT MAX(trade_date) AS d FROM trades WHERE buy_sell LIKE ? AND is_deleted = 0;", ['%Buy%']);
      asOf = asOfRow && asOfRow[0] ? asOfRow[0].d : null;
      raw = sqliteDb.querySqliteJson(dbPath,
        "SELECT COALESCE(bank_id,'') AS bid, typecode, COALESCE(issuer,'') AS issuer, " +
        "COALESCE(description,'') AS description, maturity AS maturity_date, trade_date, " +
        "price, coupon, qty AS quantity_or_par " +
        "FROM trades WHERE buy_sell LIKE ? AND is_deleted = 0;", ['%Buy%']);
    } catch (err) {
      // The `trades` table may not exist yet (no Salesforce import). Degrade.
      log('info', `trade-fit bridge: no usable Salesforce trades (${err && err.message}); using Pershing`);
      return null;
    }
    if (!raw.length) return null;

    const rows = [];
    for (const r of raw) {
      const st = sectypeFor(r.typecode, r.description);
      if (st) rows.push({ ...r, st });
    }
    if (!rows.length) return null;

    return tradeFit.buildProfileFromRows(rows, { asOf, bankDbPath, log });
  } catch (err) {
    log('warn', `trade-fit bridge: ${err && err.message}`);
    return null;
  }
}

module.exports = {
  buildTradeFitProfileFromTradeStore,
  sectypeFor,
  TYPECODE_TO_SECTYPE,
};
