#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const taskImport = require('../server/salesforce-task-import');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const DEFAULT_TASK_FILE = path.join(DATA_DIR, 'salesforce-export', '2026-07-01', 'raw', '2026-07-01 TASK EXPORT.csv');
const DEFAULT_FOUNDATION_DIR = path.join(DATA_DIR, 'salesforce-export', '2026-06-24', 'raw');
const MANIFEST_DIR = path.join(DATA_DIR, 'salesforce-export', 'manifests');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');

const USAGE = `
Salesforce task/activity import — dry-run by default.

  node scripts/import-salesforce-tasks.js [options]

  --task-file <csv>       Task export CSV
                          default: data/salesforce-export/2026-07-01/raw/2026-07-01 TASK EXPORT.csv
  --foundation-dir <dir>  Salesforce Account/Rep export dir used for bank + owner matching
                          default: data/salesforce-export/2026-06-24/raw
  --output-dir <dir>      Bank reports dir, default data/bank-reports
  --apply                 Actually write staged rows + selected projections
  --tasks                 Project matched Open/In Progress tasks into bank_tasks
  --activities            Project matched completed calls/emails/tasks into bank_activities
  --strategies            Project matched Strategies_Task__c rows into Strategies Queue/history
  --all                   Same as --tasks --activities --strategies
  --include-list-email    Count ListEmail rows as email activities; default keeps them report-only
  --out <file>            Write the import result JSON

Examples:
  node scripts/import-salesforce-tasks.js --out data/salesforce-export/manifests/task-preview.json
  node scripts/import-salesforce-tasks.js --apply --all
`;

function parseArgs(argv) {
  const sections = new Set();
  const args = {
    taskFile: DEFAULT_TASK_FILE,
    foundationDir: DEFAULT_FOUNDATION_DIR,
    outputDir: BANK_REPORTS_DIR,
    apply: false,
    includeListEmail: false,
    out: '',
    sections
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--task-file') args.taskFile = path.resolve(argv[++i] || '');
    else if (arg === '--foundation-dir') args.foundationDir = path.resolve(argv[++i] || '');
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[++i] || '');
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--tasks') sections.add('tasks');
    else if (arg === '--activities') sections.add('activities');
    else if (arg === '--strategies') sections.add('strategies');
    else if (arg === '--all') { sections.add('tasks'); sections.add('activities'); sections.add('strategies'); }
    else if (arg === '--include-list-email') args.includeListEmail = true;
    else if (arg === '--out') args.out = path.resolve(argv[++i] || '');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function appendAudit(record) {
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ ...record, at: new Date().toISOString() }) + '\n');
  } catch (err) {
    console.error(`(warning: could not append audit log: ${err.message})`);
  }
}

function writeManifest(payload, outPath) {
  const file = outPath || path.join(MANIFEST_DIR, `salesforce-task-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function printSummary(result, args, manifest) {
  const p = result.projections || {};
  console.log(`\nSalesforce task import — ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Task file: ${args.taskFile}`);
  console.log(`Foundation dir: ${args.foundationDir}`);
  console.log(`Rows: ${p.totalRows || 0} (${p.matchedRows || 0} matched, ${p.unmatchedRows || 0} unmatched)`);
  console.log(`Account links: ${result.accountLinks.matched}/${result.accountLinks.total} matched`);
  console.log(`Targets: ${JSON.stringify(p.byTarget || {})}`);
  console.log(`Actions: ${JSON.stringify(p.byAction || {})}`);
  if (manifest) console.log(`Manifest: ${manifest}`);
  if (!args.apply) console.log('\nDRY-RUN only. Re-run with --apply plus --tasks/--activities/--strategies or --all to write.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.apply && !args.sections.size) {
    throw new Error('--apply requires --tasks, --activities, --strategies, or --all.');
  }
  const result = taskImport.importSalesforceTaskFile(args);
  const manifest = args.apply || args.out ? writeManifest({
    args: {
      taskFile: args.taskFile,
      foundationDir: args.foundationDir,
      outputDir: args.outputDir,
      apply: args.apply,
      sections: [...args.sections],
      includeListEmail: args.includeListEmail
    },
    result
  }, args.out) : '';
  if (args.apply) {
    appendAudit({
      event: 'salesforce-task-import',
      taskFile: path.basename(args.taskFile),
      sections: [...args.sections],
      totalRows: result.projections.totalRows,
      matchedRows: result.projections.matchedRows,
      unmatchedRows: result.projections.unmatchedRows,
      byTarget: result.projections.byTarget
    });
  }
  printSummary(result, args, manifest);
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
