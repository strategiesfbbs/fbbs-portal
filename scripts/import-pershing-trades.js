#!/usr/bin/env node
'use strict';

const path = require('path');

const { importPershingTradeFile } = require('../server/pershing-store');

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

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.file) throw new Error(usage());
  const result = importPershingTradeFile(args.outputDir, args.file, {
    asOfDate: args.asOfDate,
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
