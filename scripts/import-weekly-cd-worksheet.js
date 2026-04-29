#!/usr/bin/env node
'use strict';

const path = require('path');

const { importWeeklyCdWorksheet } = require('../server/cd-history-importer');

const ROOT = path.join(__dirname, '..');

function usage() {
  console.error([
    'Usage: node scripts/import-weekly-cd-worksheet.js <Weekly CD Worksheet.xlsx> [options]',
    '',
    'Options:',
    '  --data-dir <path>   Portal data directory. Defaults to <project>/data.',
    '  --history-dir <path> CD history directory. Defaults to <data-dir>/cd-history.',
    '  --overwrite         Replace existing snapshot files when dates overlap.',
    '  --dry-run           Parse and report without writing files.'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    workbookPath: null,
    dataDir: path.join(ROOT, 'data'),
    historyDir: null,
    overwrite: false,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir') {
      args.dataDir = path.resolve(argv[++i] || '');
    } else if (arg === '--history-dir') {
      args.historyDir = path.resolve(argv[++i] || '');
    } else if (arg === '--overwrite') {
      args.overwrite = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (!args.workbookPath) {
      args.workbookPath = path.resolve(arg);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!args.workbookPath) {
    usage();
    process.exit(1);
  }
  if (!args.historyDir) args.historyDir = path.join(args.dataDir, 'cd-history');
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = importWeeklyCdWorksheet(args.workbookPath, {
    historyDir: args.historyDir,
    overwrite: args.overwrite,
    dryRun: args.dryRun
  });

  console.log(JSON.stringify({
    workbook: args.workbookPath,
    historyDir: args.historyDir,
    stats: result.stats,
    warnings: result.warnings,
    written: result.written.slice(0, 10),
    writtenTail: result.written.slice(-5),
    skippedExisting: result.skippedExisting.slice(0, 10),
    skippedExistingTail: result.skippedExisting.slice(-5)
  }, null, 2));
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
