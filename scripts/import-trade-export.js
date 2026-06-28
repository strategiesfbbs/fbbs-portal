#!/usr/bin/env node
'use strict';

// Import the Salesforce Trade__c export (the ~139,352-row bond blotter) into the
// portal trade store (data/bank-reports/pershing-accounts.sqlite → trades table).
//
// The Pershing export must be imported FIRST (scripts/import-pershing-export.js) —
// each trade's bank is resolved through its Pershing account.
//
//   node scripts/import-trade-export.js --validate      # preflight only, no write
//   node scripts/import-trade-export.js --dry-run        # parse + summarize, no write
//   node scripts/import-trade-export.js --apply          # write to the DB
//
// Spec: docs/salesforce-trade-store-spec-2026-06-28.md

const fs = require('fs');
const path = require('path');

const { importTrades, buildPershingMapFromDb, tradesDatabasePathForDir } = require('../server/trade-store');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DEFAULT_RAW_DIR = path.join(DEFAULT_DATA_DIR, 'salesforce-export', '2026-06-24', 'raw');
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_DATA_DIR, 'bank-reports');
const EXPECTED_ROWS = 139352; // from the SF audit; advisory only

function parseArgs(argv) {
  const args = { rawDir: DEFAULT_RAW_DIR, outputDir: DEFAULT_OUTPUT_DIR, tradeFile: '', mode: 'validate' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--validate') args.mode = 'validate';
    else if (arg === '--dry-run' || arg === '--dryRun') args.mode = 'dry-run';
    else if (arg === '--apply') args.mode = 'apply';
    else if (arg === '--raw-dir') args.rawDir = path.resolve(argv[++i] || '');
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[++i] || '');
    else if (arg === '--trade-file') args.tradeFile = path.resolve(argv[++i] || '');
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/import-trade-export.js [--validate|--dry-run|--apply] [--raw-dir <dir>] [--output-dir <dir>] [--trade-file <csv>]',
    '',
    'Default mode is --validate (preflight, no write). Import the Pershing export first.'
  ].join('\n');
}

// CSV parser tolerant of quoted fields, escaped quotes, and embedded newlines.
function parseCsvText(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsvText(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    header.forEach((key, idx) => { obj[key] = cells[idx] !== undefined ? cells[idx] : ''; });
    return obj;
  });
}

function findTradeFile(rawDir) {
  if (!fs.existsSync(rawDir)) return '';
  const files = fs.readdirSync(rawDir).filter(f => /\.csv$/i.test(f));
  // Prefer a name containing "trade" but not "pershing".
  const trade = files.find(f => /trade/i.test(f) && !/pershing/i.test(f));
  return trade ? path.join(rawDir, trade) : '';
}

function readDecoded(filePath) {
  // The SF exports carry non-UTF-8 bytes; decode tolerantly (latin1 fallback).
  const buf = fs.readFileSync(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  } catch (e) {
    return buf.toString('latin1');
  }
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }

  const tradeFile = args.tradeFile || findTradeFile(args.rawDir);
  if (!tradeFile || !fs.existsSync(tradeFile)) {
    console.error(`No Trade export CSV found (looked in ${args.rawDir}). Pass --trade-file <csv>.`);
    process.exitCode = 2;
    return;
  }

  console.log(`Trade file:  ${tradeFile}`);
  console.log(`Output DB:   ${tradesDatabasePathForDir(args.outputDir)}`);
  console.log(`Mode:        ${args.mode}`);

  const rows = csvToObjects(readDecoded(tradeFile));
  if (!rows.length) {
    console.error('Trade CSV parsed to 0 rows.');
    process.exitCode = 2;
    return;
  }

  // Preflight: confirm the Pershing join is available before trusting the import.
  const pershingMap = buildPershingMapFromDb(tradesDatabasePathForDir(args.outputDir));
  if (pershingMap.size === 0) {
    console.warn('WARNING: pershing_accounts is empty — run scripts/import-pershing-export.js first, or every trade will be unmatched to a bank.');
  }

  const dryRun = args.mode !== 'apply';
  const stats = importTrades(args.outputDir, rows, {
    dryRun,
    pershingMap,
    sourceFile: path.basename(tradeFile)
  });

  console.log('\n--- Trade import summary ---');
  console.log(`  parsed rows:        ${stats.totalRows}`);
  console.log(`  importable:         ${stats.importedCount}`);
  console.log(`  skipped (deleted):  ${stats.skippedDeleted}`);
  console.log(`  invalid (no id):    ${stats.invalidRows}`);
  console.log(`  unique trade ids:   ${stats.uniqueTradeIds}`);
  console.log(`  duplicate ids:      ${stats.duplicateTradeIds}`);
  console.log(`  matched to a bank:  ${stats.matchedRows} (${pct(stats.bankMatchRate)})`);
  console.log(`  unmatched:          ${stats.unmatchedRows}`);
  console.log(`  distinct banks:     ${stats.bankCount}`);
  console.log(`  pershing accounts:  ${stats.pershingAccountCount}`);
  console.log(`  trade-date range:   ${stats.oldestTradeDate || '—'} → ${stats.latestTradeDate || '—'}`);
  if (args.mode === 'apply') console.log(`  created: ${stats.created} · updated: ${stats.updated}`);

  // --validate: turn the preflight into a PASS/FAIL gate ("validated, not just ran").
  if (args.mode === 'validate') {
    const problems = [];
    if (stats.importedCount === 0) problems.push('0 importable rows');
    if (stats.duplicateTradeIds > 0) problems.push(`${stats.duplicateTradeIds} duplicate trade ids (PK collisions)`);
    if (stats.bankMatchRate < 0.5) problems.push(`only ${pct(stats.bankMatchRate)} of trades resolved to a bank — Pershing export likely missing/stale`);
    const rowDelta = Math.abs(stats.totalRows - EXPECTED_ROWS) / EXPECTED_ROWS;
    if (rowDelta > 0.2) console.warn(`  NOTE: row count ${stats.totalRows} is >20% off the expected ~${EXPECTED_ROWS} — confirm the export is complete.`);
    console.log('');
    if (problems.length) {
      console.error('PREFLIGHT FAILED:\n  - ' + problems.join('\n  - '));
      console.error('\nFix the export, then re-run --validate. Do NOT cancel Salesforce on a failed preflight.');
      process.exitCode = 1;
    } else {
      console.log('PREFLIGHT PASSED — export looks complete and joinable. Re-run with --apply to write.');
    }
  }
}

main();
