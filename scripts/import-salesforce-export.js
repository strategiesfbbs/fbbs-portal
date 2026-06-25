#!/usr/bin/env node
'use strict';

// Salesforce export importer (Foundation + CRM slice).
// I/O shell around the pure server/salesforce-import.js module: reads the
// staged CSVs, builds the portal resolvers (cert→bankId, name→bankId, existing
// contacts by Salesforce id + dedup keys) from the live bank DBs, runs the pure
// plan, prints the funnel, and — only with explicit apply flags — writes.
//
// Dry-run is the DEFAULT. Applying requires `--apply` PLUS a section flag:
//   --contacts   create/update bank_contacts (idempotent via salesforce_contact_id)
//   --owners     backfill blank bank_coverage.owner from the modal contact owner
//   --statuses   seed/upgrade bank account status from SF (never overrides worked)
//
// Every apply writes a durable manifest under data/salesforce-export/manifests/
// and appends one summary line to data/audit.log.
//
// Spec: docs/salesforce-integration-spec-2026-06-24.md
//
// Usage:
//   node scripts/import-salesforce-export.js [--dir <export dir>]
//        [--apply] [--contacts] [--owners] [--statuses]
//        [--out <plan.json>] [--limit <n>]

const fs = require('fs');
const path = require('path');
const sf = require('../server/salesforce-import');
const { listBankSummaries } = require('../server/bank-data-importer');
const {
  listAllContacts, getContactsBySalesforceIds, createBankContact, updateBankContact,
  getSavedBankCoverageMap, upsertSavedBank,
} = require('../server/bank-coverage-store');
const { getBankAccountStatuses, upsertBankAccountStatus } = require('../server/bank-account-status-store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const DEFAULT_DIR = path.join(DATA_DIR, 'salesforce-export', '2026-06-24', 'raw');
const MANIFEST_DIR = path.join(DATA_DIR, 'salesforce-export', 'manifests');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');
const STAMP = '2026-06-24';

const USAGE = `
Salesforce export importer — dry-run by default.

  node scripts/import-salesforce-export.js [options]

  --dir <path>     export dir (default: data/salesforce-export/2026-06-24/raw)
  --apply          actually write (otherwise dry-run); requires a section flag
  --contacts       create/update bank_contacts (idempotent via salesforce_contact_id)
  --owners         backfill blank coverage owner from modal contact owner
  --statuses       seed/upgrade account status from Salesforce (never overrides worked)
  --out <file>     write the full plan JSON for review
  --limit <n>      cap contacts written (testing)

  With no section flag, all sections are shown (dry-run). --apply needs at least
  one of --contacts / --owners / --statuses.
`;

function parseArgs(argv) {
  const sections = new Set();
  const a = { dir: DEFAULT_DIR, apply: false, out: '', limit: 0, help: false, sections };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dir') a.dir = argv[++i];
    else if (t === '--apply') a.apply = true;
    else if (t === '--contacts') sections.add('contacts');
    else if (t === '--owners' || t === '--owner-proposal') sections.add('owners');
    else if (t === '--statuses' || t === '--status-proposal') sections.add('statuses');
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--limit') a.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (t === '--help' || t === '-h') a.help = true;
  }
  // Display: if no section named, show all. Apply: only explicitly-named sections.
  a.show = sections.size ? sections : new Set(['contacts', 'owners', 'statuses']);
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

function appendAudit(record) {
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ ...record, at: new Date().toISOString() }) + '\n');
  } catch (e) {
    console.error(`  (warning: could not append to audit.log: ${e.message})`);
  }
}

function writeManifest(payload) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(MANIFEST_DIR, `import-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }

  console.log(`\nSalesforce export import — ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Export dir: ${args.dir}`);
  if (args.apply && !args.sections.size) {
    console.log(`\n!! --apply requires a section flag (--contacts / --owners / --statuses). Nothing written.`);
  }

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

  // Existing contacts → SF-id index (idempotency) + name/email dedup keys.
  const existingBySfId = getContactsBySalesforceIds(BANK_REPORTS_DIR, contacts.map(c => c.sfId));
  const existing = listAllContacts(BANK_REPORTS_DIR, { limit: 10000 });
  const existingKeys = new Set();
  for (const c of existing) {
    if (c.email) existingKeys.add(`${c.bankId}|e|${c.email.toLowerCase()}`);
    if (c.name) existingKeys.add(`${c.bankId}|n|${c.name.toLowerCase()}`);
  }

  // ---- contact import plan ----
  const plan = sf.buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys, existingBySfId });
  const st = plan.stats;

  console.log(`\n=== ACCOUNTS ===`);
  const typeCounts = {};
  for (const a of accountIndex.byId.values()) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  Object.entries(typeCounts).sort((x, y) => y[1] - x[1]).forEach(([t, c]) => console.log(`  ${t.padEnd(20)} ${c}`));
  console.log(`  portal certs: ${certToBankId.size}   existing portal contacts: ${existing.length}  (SF-linked: ${existingBySfId.size})`);

  console.log(`\n=== CONTACT → BANK funnel ===`);
  console.log(`  live contacts parsed:        ${st.total}`);
  console.log(`  → create (new):              ${st.create}  (cert ${st.viaCert} / name ${st.viaName})`);
  console.log(`  → update (changed):          ${st.update}`);
  console.log(`  → unchanged (already synced):${st.unchanged}`);
  console.log(`  → duplicate (name/email):    ${st.duplicate}`);
  console.log(`  → unmatched:                 ${st.unmatched}  (${pct(st.unmatched, st.total)})`);
  console.log(`  unmatched reasons:`);
  Object.entries(st.byReason).sort((x, y) => y[1] - x[1]).forEach(([r, c]) => console.log(`     ${String(c).padStart(5)}  ${r}`));

  // ---- owner backfill proposal (contact-modal, blank-only) ----
  const matched = plan.create.concat(plan.update, plan.unchanged, plan.duplicate);
  const contactsByBankId = new Map();
  for (const m of matched) {
    if (!contactsByBankId.has(m.bankId)) contactsByBankId.set(m.bankId, []);
    contactsByBankId.get(m.bankId).push(m.contact);
  }
  const candidateBankIds = [...contactsByBankId.keys()];
  const coverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, candidateBankIds);
  // The authoritative owner field is bank_account_statuses.owner (what saved
  // views filter on and effectiveAccountStatus surfaces). "Blank" must be judged
  // on the EFFECTIVE owner so we never overwrite a worked assignment.
  const ownerAcctStatus = getBankAccountStatuses(BANK_REPORTS_DIR, candidateBankIds);
  const currentOwners = new Map();
  let alreadyOwned = 0;
  let catchAll = 0;
  for (const id of candidateBankIds) {
    const cov = coverageMap.get(id);
    const as = ownerAcctStatus.get(id);
    const effectiveOwner = String((cov && cov.owner) || (as && as.owner) || '').trim();
    if (effectiveOwner) {
      alreadyOwned += 1;
      if (effectiveOwner === 'A.W. Spellmeyer') catchAll += 1;
    }
    currentOwners.set(id, effectiveOwner);
  }
  const ownerPlan = sf.buildOwnerBackfillPlan({ contactsByBankId, currentOwners });

  if (args.show.has('owners')) {
    console.log(`\n=== OWNER backfill PROPOSAL (contact-modal, BLANK-ONLY on effective owner) ===`);
    console.log(`  banks with matched contacts: ${candidateBankIds.length}`);
    console.log(`  already have an owner (account_status): ${alreadyOwned}  (incl. ${catchAll} on the 'A.W. Spellmeyer' catch-all — left as-is per blank-only policy)`);
    console.log(`  owner proposals (genuinely blank → set from modal contact owner): ${ownerPlan.stats.proposed}`);
    ownerPlan.proposals.slice(0, 10).forEach(p => console.log(`     bank ${p.bankId} → ${p.suggestedOwner}  (${p.basis})`));
  }

  // ---- status backfill proposal (seed/upgrade, never override worked) ----
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

  if (args.show.has('statuses')) {
    console.log(`\n=== STATUS backfill PROPOSAL (seed/upgrade, never override worked) ===`);
    console.log(`  (portal account-status already holds prior SF status: most banks are intentionally skipped)`);
    const byStatus = {};
    statusPlan.proposals.forEach(p => { byStatus[p.suggestedStatus] = (byStatus[p.suggestedStatus] || 0) + 1; });
    console.log(`  proposals: ${statusPlan.stats.proposed}  (seed ${statusPlan.stats.seed} / upgrade-from-Open ${statusPlan.stats.upgrade})  ${JSON.stringify(byStatus)}`);
    statusPlan.proposals.slice(0, 10).forEach(p => console.log(`     [${p.kind}] bank ${p.bankId}: ${p.currentStatus || '(none)'} → ${p.suggestedStatus}`));
  }

  // ---- apply ----
  const applied = { contacts: null, owners: null, statuses: null };
  const manifestDetail = {};

  if (args.apply && args.sections.has('contacts')) {
    let created = 0, updated = 0, failed = 0;
    const createdIds = [], updatedRecs = [];
    const toCreate = args.limit ? plan.create.slice(0, args.limit) : plan.create;
    for (const x of toCreate) {
      const summary = summaryById.get(x.bankId);
      if (!summary) { failed++; continue; }
      try {
        createBankContact(BANK_REPORTS_DIR, summary, {
          name: x.desired.name, role: x.desired.role, phone: x.desired.phone, email: x.desired.email,
          salesforceContactId: x.contact.sfId,
          doNotCall: x.desired.doNotCall, optOutEmail: x.desired.optOutEmail, emailBounced: x.desired.emailBounced,
          notes: `Salesforce ${x.contact.sfId} · imported ${STAMP}`,
        });
        created++; createdIds.push(x.contact.sfId);
      } catch (e) { failed++; if (failed <= 5) console.error(`     create failed for ${x.contact.name} → ${x.bankId}: ${e.message}`); }
    }
    for (const x of plan.update) {
      try {
        updateBankContact(BANK_REPORTS_DIR, x.existingId, {
          name: x.desired.name, role: x.desired.role, phone: x.desired.phone, email: x.desired.email,
          salesforceContactId: x.contact.sfId,
          doNotCall: x.desired.doNotCall, optOutEmail: x.desired.optOutEmail, emailBounced: x.desired.emailBounced,
        });
        updated++; updatedRecs.push({ sfId: x.contact.sfId, changed: x.changed });
      } catch (e) { failed++; if (failed <= 5) console.error(`     update failed for ${x.contact.name}: ${e.message}`); }
    }
    applied.contacts = { created, updated, unchanged: plan.unchanged.length, duplicate: plan.duplicate.length, unmatched: plan.unmatched.length, failed };
    manifestDetail.createdSfIds = createdIds;
    manifestDetail.updated = updatedRecs;
    console.log(`\n=== APPLY contacts ===\n  created ${created} · updated ${updated} · unchanged ${plan.unchanged.length} · skipped-dup ${plan.duplicate.length}${failed ? ` · failed ${failed}` : ''}`);
  }

  if (args.apply && args.sections.has('owners')) {
    let ok = 0, failed = 0;
    const recs = [];
    for (const p of ownerPlan.proposals) {
      const summary = summaryById.get(p.bankId);
      if (!summary) { failed++; continue; }
      try {
        // Write the authoritative owner field (account_status.owner); the store
        // preserves the existing status, so this never downgrades a worked bank.
        upsertBankAccountStatus(BANK_REPORTS_DIR, summary, { owner: p.suggestedOwner, source: 'salesforce-import' });
        ok++; recs.push({ bankId: p.bankId, owner: p.suggestedOwner });
      } catch (e) { failed++; if (failed <= 5) console.error(`     owner failed for ${p.bankId}: ${e.message}`); }
    }
    applied.owners = { applied: ok, failed };
    manifestDetail.owners = recs;
    console.log(`\n=== APPLY owners ===\n  owners set on genuinely-blank banks: ${ok}${failed ? ` · failed ${failed}` : ''}`);
  }

  if (args.apply && args.sections.has('statuses')) {
    let ok = 0, failed = 0;
    const recs = [];
    for (const p of statusPlan.proposals) {
      const summary = summaryById.get(p.bankId);
      if (!summary) { failed++; continue; }
      try {
        upsertBankAccountStatus(BANK_REPORTS_DIR, summary, { status: p.suggestedStatus, source: 'salesforce-import' });
        // If a coverage row exists (it overrides account-status), sync it too so
        // the change actually surfaces via effectiveAccountStatus.
        const cov = statusCoverageMap.get(p.bankId);
        if (cov && cov.status) upsertSavedBank(BANK_REPORTS_DIR, summary, { status: p.suggestedStatus });
        ok++; recs.push({ bankId: p.bankId, status: p.suggestedStatus, kind: p.kind });
      } catch (e) { failed++; if (failed <= 5) console.error(`     status failed for ${p.bankId}: ${e.message}`); }
    }
    applied.statuses = { applied: ok, failed };
    manifestDetail.statuses = recs;
    console.log(`\n=== APPLY statuses ===\n  statuses set (seed/upgrade): ${ok}${failed ? ` · failed ${failed}` : ''}`);
  }

  // ---- manifest + audit (on any apply) ----
  if (args.apply && args.sections.size) {
    const manifest = {
      stamp: STAMP,
      generatedAt: new Date().toISOString(),
      mode: 'apply',
      exportDir: args.dir,
      sections: [...args.sections],
      contacts: applied.contacts,
      owners: applied.owners,
      statuses: applied.statuses,
      detail: manifestDetail,
    };
    const manifestFile = writeManifest(manifest);
    appendAudit({
      event: 'salesforce-import',
      sections: [...args.sections],
      contacts: applied.contacts,
      owners: applied.owners,
      statuses: applied.statuses,
      manifest: path.relative(DATA_DIR, manifestFile),
    });
    console.log(`\nManifest: ${manifestFile}`);
  } else if (!args.apply) {
    console.log(`\nDRY-RUN — nothing written. Apply with e.g. \`--apply --contacts\` / \`--apply --owners\` / \`--apply --statuses\`.`);
  }

  // ---- full plan JSON (review artifact) ----
  if (args.out) {
    const payload = {
      stamp: STAMP, generatedAt: new Date().toISOString(), accounts: typeCounts,
      contacts: {
        stats: st,
        create: plan.create.map(x => ({ bankId: x.bankId, via: x.via, sfId: x.contact.sfId, name: x.contact.name, role: x.contact.role, email: x.contact.email, decisionMaker: x.contact.decisionMaker, category: x.contact.category })),
        update: plan.update.map(x => ({ bankId: x.bankId, sfId: x.contact.sfId, name: x.contact.name, changed: x.changed })),
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
