#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { listBankSummaries } = require('../server/bank-data-importer');
const { importPershingAccounts } = require('../server/pershing-store');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DEFAULT_RAW_DIR = path.join(DEFAULT_DATA_DIR, 'salesforce-export', '2026-06-24', 'raw');
const DEFAULT_OUTPUT_DIR = path.join(DEFAULT_DATA_DIR, 'bank-reports');

function parseArgs(argv) {
  const args = { rawDir: DEFAULT_RAW_DIR, outputDir: DEFAULT_OUTPUT_DIR, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '--dryRun') args.dryRun = true;
    else if (arg === '--raw-dir') args.rawDir = path.resolve(argv[++i] || '');
    else if (arg === '--output-dir') args.outputDir = path.resolve(argv[++i] || '');
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/import-pershing-export.js [--dry-run] [--raw-dir <dir>] [--output-dir <dir>]',
    '',
    'Reads the Salesforce Pershing, Account, and Rep CSV exports from the raw dir',
    'and updates data/bank-reports/pershing-accounts.sqlite.'
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
  const headers = rows[0].map(h => String(h || '').replace(/^"|"$/g, '').trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = String(cols[idx] ?? '').trim(); });
    return obj;
  });
}

function readCsv(filePath) {
  return parseCsvText(fs.readFileSync(filePath, 'utf8'));
}

function normalizeCert(value) {
  const cleaned = String(value || '').trim().replace(/,/g, '');
  if (!cleaned) return '';
  if (/^[0-9]+(\.0+)?$/.test(cleaned)) return String(Number(cleaned));
  return cleaned;
}

function sfKeys(value) {
  const id = String(value || '').trim();
  if (!id) return [];
  const keys = [id, id.toLowerCase()];
  if (id.length >= 15) {
    keys.push(id.slice(0, 15), id.slice(0, 15).toLowerCase());
  }
  return [...new Set(keys)];
}

function setSalesforceMap(map, id, value) {
  sfKeys(id).forEach(key => map.set(key, value));
}

function buildRepMap(repRows) {
  const map = new Map();
  repRows.forEach(row => {
    const id = row['User ID'];
    const displayName = [row['First Name'], row['Last Name']].filter(Boolean).join(' ').trim();
    const value = {
      displayName,
      firstName: row['First Name'] || '',
      lastName: row['Last Name'] || '',
      alias: row.Alias || '',
      username: row.Username || '',
      active: /^true$/i.test(String(row.Active || ''))
    };
    setSalesforceMap(map, id, value);
  });
  return map;
}

function buildAccountMap(accountRows, summaries) {
  const byCert = new Map();
  summaries.forEach(summary => {
    const cert = normalizeCert(summary.certNumber);
    if (!cert) return;
    if (!byCert.has(cert)) byCert.set(cert, []);
    byCert.get(cert).push(summary);
  });
  const map = new Map();
  accountRows.forEach(row => {
    const cert = normalizeCert(row.Cert_Number__c);
    const matches = cert ? (byCert.get(cert) || []) : [];
    const summary = matches.length === 1 ? matches[0] : null;
    const value = {
      salesforceAccountId: row.Account_Id_18__c || row.Id || '',
      recordTypeId: row.RecordTypeId || '',
      status: row.Status__c || '',
      ownerId: row.OwnerId || '',
      certNumber: cert,
      bankId: summary ? summary.id : '',
      displayName: summary ? (summary.displayName || summary.name || '') : (row.Name || ''),
      city: summary ? (summary.city || '') : (row.City__c || row.BillingCity || ''),
      state: summary ? (summary.state || '') : (row.State__c || row.BillingState || ''),
      matchState: !cert ? 'no-cert' : (matches.length === 1 ? 'matched' : (matches.length > 1 ? 'ambiguous-cert' : 'cert-not-in-portal'))
    };
    setSalesforceMap(map, value.salesforceAccountId, value);
    if (row.Id && row.Id !== value.salesforceAccountId) setSalesforceMap(map, row.Id, value);
  });
  return map;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const files = {
    pershing: path.join(args.rawDir, '2026-06-24 PERSHING EXTRACT.csv'),
    account: path.join(args.rawDir, '2026-06-24 ACCOUNT EXTRACT.csv'),
    rep: path.join(args.rawDir, '2026-06-24 REP EXTRACT.csv')
  };
  Object.values(files).forEach(file => {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  });
  const summaries = listBankSummaries(args.outputDir);
  const accountRows = readCsv(files.account);
  const repRows = readCsv(files.rep);
  const pershingRows = readCsv(files.pershing);
  const result = importPershingAccounts(args.outputDir, pershingRows, {
    accountMap: buildAccountMap(accountRows, summaries),
    repMap: buildRepMap(repRows),
    sourceFile: path.basename(files.pershing),
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
