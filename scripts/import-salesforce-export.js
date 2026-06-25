#!/usr/bin/env node
'use strict';

// Salesforce export importer (Foundation + Contacts slice).
// I/O shell around the pure server/salesforce-import.js module: reads the
// staged CSVs, builds the portal resolvers (cert→bankId, name→bankId, existing
// dedup keys) from the live bank DBs, runs the pure plan, prints the funnel,
// and — only with `--apply --contacts` — writes contacts via the existing
// createBankContact(). Owner/status are PROPOSAL + dry-run only this slice.
//
// Spec: docs/salesforce-integration-spec-2026-06-24.md
//
// Usage:
//   node scripts/import-salesforce-export.js [--dir <export dir>] [--apply]
//        [--contacts] [--owner-proposal] [--status-proposal]
//        [--out <plan.json>] [--limit <n>]
//   (default = dry-run, all sections shown, nothing written)

const fs = require('fs');
const path = require('path');
const sf = require('../server/salesforce-import');
const { listBankSummaries } = require('../server/bank-data-importer');
const { listAllContacts, createBankContact, getSavedBankCoverageMap } = require('../server/bank-coverage-store');
const { getBankAccountStatuses } = require('../server/bank-account-status-store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const DEFAULT_DIR = path.join(DATA_DIR, 'salesforce-export', '2026-06-24', 'raw');
const STAMP = '2026-06-24';

function parseArgs(argv) {
  const a = { dir: DEFAULT_DIR, apply: false, contacts: false, ownerProposal: false, statusProposal: false, out: '', limit: 0, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dir') a.dir = argv[++i];
    else if (t === '--apply') a.apply = true;
    else if (t === '--contacts') a.contacts = true;
    else if (t === '--owner-proposal') a.ownerProposal = true;
    else if (t === '--status-proposal') a.statusProposal = true;
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--limit') a.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (t === '--help' || t === '-h') a.help = true;
  }
  // If no section flag is given, show every section.
  if (!a.contacts && !a.ownerProposal && !a.statusProposal) {
    a.contacts = a.ownerProposal = a.statusProposal = true;
  }
  return a;
}

// Tolerant read — the account export carries non-UTF-8 bytes; Buffer→utf8
// replaces invalid sequences with U+FFFD instead of throwing.
function readCsv(file) {
  return sf.parseCsv(fs.readFileSync(file).toString('utf8'));
}

function findFile(dir, fragment) {
  const hit = fs.readdirSync(dir).find(f => f.toUpperCase().includes(fragment) && f.toLowerCase().endsWith('.csv'));
  if (!hit) throw new Error(`Could not find a *${fragment}*.csv in ${dir}`);
  return path.join(dir, hit);
}

function pct(n, d) { return d ? `${(100 * n / d).toFixed(1)}%` : '0.0%'; }

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(4, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }

  console.log(`\nSalesforce export import — ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Export dir: ${args.dir}`);

  // ---- parse CSVs ----
  const accountRows = readCsv(findFile(args.dir, 'ACCOUNT'));
  const contactRows = readCsv(findFile(args.dir, 'CONTACT'));
  const repRows = readCsv(findFile(args.dir, 'REP'));

  const repResolver = sf.buildRepResolver(repRows);
  const accountIndex = sf.buildAccountIndex(accountRows);
  const contacts = sf.parseContacts(contactRows, { repResolver });

  // ---- portal resolvers ----
  const summaries = listBankSummaries(BANK_REPORTS_DIR);
  if (!summaries.length) {
    console.error(`\n!! No bank summaries in ${BANK_REPORTS_DIR} — cert/name resolution will be empty. Import the bank workbook first.`);
  }
  const certToBankId = new Map();
  const nameToBankId = new Map();
  const summaryById = new Map();
  for (const s of summaries) {
    summaryById.set(String(s.id), s);
    const cert = sf.normalizeCert(s.certNumber);
    if (cert && !certToBankId.has(cert)) certToBankId.set(cert, String(s.id));
    for (const cand of [s.name, s.displayName]) {
      const key = sf.normalizeNameForMatch(cand);
      if (!key) continue;
      if (!nameToBankId.has(key)) nameToBankId.set(key, []);
      const arr = nameToBankId.get(key);
      if (!arr.includes(String(s.id))) arr.push(String(s.id));
    }
  }

  // Existing contacts → dedup keys.
  const existing = listAllContacts(BANK_REPORTS_DIR);
  const existingKeys = new Set();
  for (const c of existing) {
    if (c.email) existingKeys.add(`${c.bankId}|e|${c.email.toLowerCase()}`);
    if (c.name) existingKeys.add(`${c.bankId}|n|${c.name.toLowerCase()}`);
  }

  // ---- contact import plan ----
  const plan = sf.buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys });
  const st = plan.stats;

  console.log(`\n=== ACCOUNTS ===`);
  const typeCounts = {};
  for (const a of accountIndex.byId.values()) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  Object.entries(typeCounts).sort((x, y) => y[1] - x[1]).forEach(([t, c]) => console.log(`  ${t.padEnd(20)} ${c}`));
  console.log(`  portal certs: ${certToBankId.size}   existing portal contacts: ${existing.length}`);

  console.log(`\n=== CONTACT → BANK funnel ===`);
  console.log(`  live contacts parsed:        ${st.total}`);
  console.log(`  → create (new):              ${st.create}  (cert ${st.viaCert} / name ${st.viaName})`);
  console.log(`  → duplicate (already there): ${st.duplicate}`);
  console.log(`  → unmatched:                 ${st.unmatched}  (${pct(st.unmatched, st.total)})`);
  console.log(`  unmatched reasons:`);
  Object.entries(st.byReason).sort((x, y) => y[1] - x[1]).forEach(([r, c]) => console.log(`     ${String(c).padStart(5)}  ${r}`));
  console.log(`  sample creates:`);
  plan.create.slice(0, 8).forEach(x => console.log(`     [${x.via}] ${x.contact.name} — ${x.contact.role || '(no title)'} → bank ${x.bankId}`));

  // ---- owner backfill proposal (contact-modal, blank-only) ----
  const matched = plan.create.concat(plan.duplicate);
  const contactsByBankId = new Map();
  for (const m of matched) {
    if (!contactsByBankId.has(m.bankId)) contactsByBankId.set(m.bankId, []);
    contactsByBankId.get(m.bankId).push(m.contact);
  }
  const candidateBankIds = [...contactsByBankId.keys()];
  const coverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, candidateBankIds);
  const currentOwners = new Map();
  for (const id of candidateBankIds) {
    const cov = coverageMap.get(id);
    currentOwners.set(id, (cov && cov.owner) ? cov.owner : '');
  }
  const ownerPlan = sf.buildOwnerBackfillPlan({ contactsByBankId, currentOwners });

  if (args.ownerProposal) {
    console.log(`\n=== OWNER backfill PROPOSAL (contact-modal, blank-only — NOT written) ===`);
    console.log(`  banks with matched contacts: ${candidateBankIds.length}`);
    console.log(`  owner proposals (currently blank): ${ownerPlan.stats.proposed}`);
    ownerPlan.proposals.slice(0, 10).forEach(p => console.log(`     bank ${p.bankId} → ${p.suggestedOwner}  (${p.basis})`));
  }

  // ---- status backfill proposal (seed Client/Prospect, blank-only) ----
  const statusCandidates = [];
  for (const a of accountIndex.byId.values()) {
    if (a.type === 'BANK-CREDIT UNION' && a.cert && certToBankId.has(a.cert) && ['Client', 'Prospect', 'Watchlist', 'Dormant'].includes(a.status)) {
      statusCandidates.push(certToBankId.get(a.cert));
    }
  }
  const statusBankIds = [...new Set(statusCandidates)];
  const acctStatusMap = getBankAccountStatuses(BANK_REPORTS_DIR, statusBankIds);
  const statusCoverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, statusBankIds);
  const currentStatuses = new Map();
  for (const id of statusBankIds) {
    const cov = statusCoverageMap.get(id);
    const as = acctStatusMap.get(id);
    // coverage.status is authoritative when saved; else the account-status row.
    currentStatuses.set(id, (cov && cov.status) || (as && as.status) || '');
  }
  const statusPlan = sf.buildStatusBackfillPlan({ accountIndex, certToBankId, currentStatuses });

  if (args.statusProposal) {
    console.log(`\n=== STATUS backfill PROPOSAL (seed/upgrade, never override worked — NOT written) ===`);
    console.log(`  (portal account-status already holds prior SF status: most banks are intentionally skipped)`);
    const byStatus = {};
    statusPlan.proposals.forEach(p => { byStatus[p.suggestedStatus] = (byStatus[p.suggestedStatus] || 0) + 1; });
    console.log(`  proposals: ${statusPlan.stats.proposed}  (seed ${statusPlan.stats.seed} / upgrade-from-Open ${statusPlan.stats.upgrade})  ${JSON.stringify(byStatus)}`);
    statusPlan.proposals.slice(0, 10).forEach(p => console.log(`     [${p.kind}] bank ${p.bankId}: ${p.currentStatus || '(none)'} → ${p.suggestedStatus}`));
  }

  // ---- apply (contacts only) ----
  if (args.apply && args.contacts) {
    let written = 0;
    let failed = 0;
    const toWrite = args.limit ? plan.create.slice(0, args.limit) : plan.create;
    for (const x of toWrite) {
      const summary = summaryById.get(x.bankId);
      if (!summary) { failed++; continue; }
      try {
        createBankContact(BANK_REPORTS_DIR, summary, {
          name: x.contact.name,
          role: x.contact.title,
          phone: x.contact.phone || x.contact.mobile,
          email: x.contact.email,
          notes: `Salesforce ${x.contact.sfId} · imported ${STAMP}`,
        });
        written++;
      } catch (e) {
        failed++;
        if (failed <= 5) console.error(`     write failed for ${x.contact.name} → ${x.bankId}: ${e.message}`);
      }
    }
    console.log(`\n=== APPLY (contacts) ===`);
    console.log(`  contacts written: ${written}${failed ? `   failed: ${failed}` : ''}`);
    console.log(`  (owner/status proposals are NOT applied this slice — see spec §6/§7)`);
  } else if (args.apply) {
    console.log(`\n(--apply given without --contacts: nothing written; owner/status are proposal-only)`);
  } else {
    console.log(`\nDRY-RUN — nothing written. Re-run with \`--apply --contacts\` to create contacts.`);
  }

  // ---- machine-readable plan ----
  if (args.out) {
    const payload = {
      stamp: STAMP,
      generatedAt: new Date().toISOString(),
      accounts: typeCounts,
      contacts: {
        stats: st,
        create: plan.create.map(x => ({ bankId: x.bankId, via: x.via, sfId: x.contact.sfId, name: x.contact.name, role: x.contact.role, email: x.contact.email, decisionMaker: x.contact.decisionMaker, category: x.contact.category })),
        unmatchedSamples: plan.unmatched.slice(0, 100).map(u => ({ name: u.contact.name, accountId: u.contact.accountId, reason: u.reason })),
      },
      ownerProposal: ownerPlan,
      statusProposal: statusPlan,
    };
    fs.writeFileSync(args.out, JSON.stringify(payload, null, 2));
    console.log(`\nPlan written to ${args.out}`);
  }
  console.log('');
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error(`\nimport-salesforce-export failed: ${e.message}\n`); process.exit(1); }
}

module.exports = { parseArgs };
