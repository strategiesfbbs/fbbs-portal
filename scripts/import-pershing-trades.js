#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { importPershingTrades } = require('../server/pershing-store');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_DATA_DIR, 'bank-reports');

function parseArgs(argv) {
  const args = { outputDir: DEFAULT_OUTPUT_DIR, dryRun: false, file: '' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--dryRun') args.dryRun = true;
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[++i] || '');
    else if (arg === '--as-of-date') args.asOfDate = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!args.file) args.file = path.resolve(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/import-pershing-trades.js [--dry-run] [--as-of-date YYYY-MM-DD] [--output-dir <dir>] <trade-history.csv>',
    '',
    'Imports a Pershing trade-history CSV into data/bank-reports/pershing-accounts.sqlite.',
    'The account-recency import should be loaded first so trades can join to banks.'
  ].join('\n');
}

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
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
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
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = String(cols[idx] ?? '').trim(); });
    return obj;
  });
}

function inferAsOfDate(filePath) {
  const base = path.basename(filePath);
  const match = base.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!match) return '';
  return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.file) throw new Error(usage());
  if (!fs.existsSync(args.file)) throw new Error(`Missing trade-history file: ${args.file}`);
  const rows = parseCsvText(fs.readFileSync(args.file, 'utf8'));
  const result = importPershingTrades(args.outputDir, rows, {
    sourceFile: path.basename(args.file),
    asOfDate: args.asOfDate || inferAsOfDate(args.file),
    dryRun: args.dryRun
  });
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
