'use strict';

// Foundation parser/matcher for the 2026-06-24 Salesforce export (accounts,
// contacts, reps, record types). PURE and I/O-free by design: every function
// takes already-parsed CSV row arrays (or a raw CSV string for `parseCsv`) and
// returns plain objects. No fs / DB / network — the CLI shell
// (scripts/import-salesforce-export.js) does all I/O and supplies the portal
// resolvers (cert→bankId, name→bankId, existing dedup keys).
//
// Spec + join graph + feasibility: docs/salesforce-integration-spec-2026-06-24.md
//
// This module is also the contract Codex's Pershing/trade vertical builds
// against — it reuses buildAccountIndex() + buildRepResolver() unchanged.

// ---------- CSV ----------

// Robust CSV → array of row-objects. Mirrors the portal's parseCsvText state
// machine (quotes, "" escapes, embedded newlines inside quotes, CRLF) but keeps
// header case intact so callers reference exact Salesforce API names
// (Account_Id_18__c, Cert_Number__c, …). Values are trimmed.
function parseCsv(text) {
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

// ---------- helpers ----------

const RECORD_TYPE_BY_ID = {
  '012Hs000000CFaFIAW': 'GENERAL',
  '012Hs000000CFaKIAW': 'RIA',
  '012Hs000000CFaPIAW': 'BANK-CREDIT UNION',
};

// FDIC cert normalization — must match the portal's normalizeCert
// (bank-account-status-store.js): strip commas; a pure-numeric value with a
// trailing ".0" collapses to its integer string. Returns '' for blanks.
function normalizeCert(value) {
  const v = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!v) return '';
  const m = /^(\d+)(?:\.0+)?$/.exec(v);
  return m ? String(parseInt(m[1], 10)) : v;
}

// Bank/account name normalizer for the name-match fallback — identical to
// server.js normalizeBankNameForMatch so the CLI can build a name→bankId index
// the same way the legacy importer does. "Bank" stays (it's signal).
function normalizeNameForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'&/()-]/g, ' ')
    .replace(/\b(the|inc|incorporated|na|n a|national association|company|co|corp|corporation|ssb|fsb)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTrue(v) {
  return String(v == null ? '' : v).trim().toLowerCase() === 'true';
}

// ---------- reps ----------

// OwnerId → rep, via the 15-char prefix rule (data IDs carry a 3-char suffix:
// "005Vz000000RAo9IAG" vs the rep file's 15-char "005Vz000000RAo9").
function buildRepResolver(repRows = []) {
  const byPrefix = new Map();
  for (const row of repRows) {
    const userId = String(row['User ID'] || '').trim();
    if (!userId) continue;
    const rep = {
      userId,
      name: `${String(row['First Name'] || '').trim()} ${String(row['Last Name'] || '').trim()}`.trim(),
      username: String(row['Username'] || '').trim(),
      alias: String(row['Alias'] || '').trim(),
      // REP export encodes Active as "1"/"0" (not "true"/"false" like the
      // account/contact boolean columns).
      active: /^(1|true|yes)$/i.test(String(row['Active'] || '').trim()),
    };
    byPrefix.set(userId.slice(0, 15), rep);
  }
  return function resolveOwner(ownerId) {
    const key = String(ownerId || '').slice(0, 15);
    return (key && byPrefix.get(key)) || null;
  };
}

// ---------- accounts ----------

// accountRows = parsed ACCOUNT EXTRACT. Returns the shared index both verticals
// use. Deleted rows are dropped; only the columns the CRM/contact/trade work
// needs are projected (the ~200 call-report financial columns are redundant
// with the portal's own FedFis workbook — see spec §6 — and intentionally not
// carried here).
function buildAccountIndex(accountRows = []) {
  const byId = new Map();
  const byCert = new Map();
  for (const row of accountRows) {
    if (isTrue(row['IsDeleted'])) continue;
    const id = String(row['Account_Id_18__c'] || row['Id'] || '').trim();
    if (!id) continue;
    const cert = normalizeCert(row['Cert_Number__c']);
    const account = {
      id,
      cert,
      type: RECORD_TYPE_BY_ID[String(row['RecordTypeId'] || '').trim()] || 'UNKNOWN',
      name: String(row['Name'] || '').trim(),
      state: String(row['State__c'] || row['BillingState'] || '').trim(),
      ownerId: String(row['OwnerId'] || '').trim(),
      status: String(row['Status__c'] || '').trim(),
      subchapterS: String(row['Subchapter_S_Election__c'] || '').trim(),
      inactive: isTrue(row['Inactive__c']),
    };
    byId.set(id, account);
    if (cert) {
      if (!byCert.has(cert)) byCert.set(cert, []);
      byCert.get(cert).push(id);
    }
  }
  return { byId, byCert };
}

// ---------- titles ----------

// Decision-maker classifier. Titles are free-text with heavy variation
// (President/CEO appears 6+ ways), so match on substring/regex, never exact.
// category ∈ ceo|president|cfo|coo|investment|cashier|treasurer|controller|
//            lending|chair|owner|other. Ordered most-specific-first so the
// bond-desk-relevant roles (investment, cfo) win over generic president.
const TITLE_RULES = [
  { category: 'investment', dm: true, re: /investment officer|portfolio manager|chief investment|\bcio\b|\binvestment/ },
  { category: 'cfo', dm: true, re: /\bcfo\b|chief financial|finance officer/ },
  { category: 'ceo', dm: true, re: /\bceo\b|chief executive/ },
  { category: 'coo', dm: true, re: /\bcoo\b|chief operating|operations officer/ },
  { category: 'treasurer', dm: true, re: /treasurer|treasury/ },
  { category: 'cashier', dm: true, re: /cashier/ },
  { category: 'controller', dm: true, re: /controller/ },
  { category: 'lending', dm: true, re: /lending|loan officer|chief credit|credit officer/ },
  { category: 'chair', dm: true, re: /chair/ },
  { category: 'owner', dm: true, re: /\bowner\b|principal|partner/ },
  { category: 'president', dm: true, re: /president/ }, // incl. VP/EVP/SVP — still senior at a community bank
  // non-decision-makers
  { category: 'other', dm: false, re: /analyst|assistant|administrator|receptionist|teller|clerk|intern|coordinator|specialist/ },
];

function classifyTitle(title) {
  const t = String(title || '').trim();
  if (!t) return { role: '', decisionMaker: false, category: 'other' };
  const lc = t.toLowerCase();
  for (const rule of TITLE_RULES) {
    if (rule.re.test(lc)) return { role: t, decisionMaker: rule.dm, category: rule.category };
  }
  return { role: t, decisionMaker: false, category: 'other' };
}

// ---------- contacts ----------

// Internal/staff/integration domains that are not bank-side contacts.
const JUNK_EMAIL_DOMAINS = new Set([
  'fbbsinc.com', 'mibanc.com', 'salesforce.com', 'topsisconsulting.com',
]);

function emailDomain(email) {
  const m = /@([^@\s]+)\s*$/.exec(String(email || '').toLowerCase().trim());
  return m ? m[1] : '';
}

// contactRows = parsed CONTACT EXTRACT → normalized, owner-resolved contacts.
// `junk` flags internal/staff rows and nameless rows; the import skips them but
// keeps them countable. Compliance flags are carried even though every value is
// false in this export (a future re-export may populate them).
function parseContacts(contactRows = [], { repResolver } = {}) {
  const resolve = typeof repResolver === 'function' ? repResolver : () => null;
  return contactRows
    .filter(row => !isTrue(row['IsDeleted']) && !isTrue(row['Archived_Contact__c']))
    .map(row => {
      const firstName = String(row['FirstName'] || '').trim();
      const lastName = String(row['LastName'] || '').trim();
      const name = String(row['Name'] || '').trim() || `${firstName} ${lastName}`.trim();
      const email = String(row['Email'] || '').trim();
      const phone = String(row['Phone'] || '').trim();
      const mobile = String(row['MobilePhone'] || '').trim();
      const owner = resolve(row['OwnerId']);
      const title = String(row['Title'] || '').trim();
      const cls = classifyTitle(title);
      const domain = emailDomain(email);
      const junk = !name || JUNK_EMAIL_DOMAINS.has(domain);
      return {
        sfId: String(row['Id'] || '').trim(),
        accountId: String(row['AccountId'] || '').trim(),
        name, firstName, lastName,
        title, role: cls.role, decisionMaker: cls.decisionMaker, category: cls.category,
        email, phone, mobile,
        ownerId: String(row['OwnerId'] || '').trim(),
        ownerName: owner ? owner.name : '',
        doNotCall: isTrue(row['DoNotCall']),
        optOutEmail: isTrue(row['HasOptedOutOfEmail']),
        emailBounced: isTrue(row['IsEmailBounced']),
        junk,
      };
    });
}

// ---------- matching ----------

// Resolve one contact to a portal bankId. certToBankId: Map<cert, bankId>.
// nameToBankId: Map<normalizedName, bankId[]> (>1 ⇒ ambiguous). Both supplied
// by the CLI from listBankSummaries(). Returns {bankId|null, via, accountType, reason}.
function matchContactToBank(contact, { accountIndex, certToBankId, nameToBankId } = {}) {
  if (contact.junk) return { bankId: null, via: null, accountType: null, reason: 'junk/internal contact' };
  if (!contact.accountId) return { bankId: null, via: null, accountType: null, reason: 'no AccountId (orphan)' };
  const account = accountIndex && accountIndex.byId.get(contact.accountId);
  if (!account) return { bankId: null, via: null, accountType: null, reason: 'AccountId not in account export' };
  const accountType = account.type;

  if (account.cert && certToBankId && certToBankId.has(account.cert)) {
    return { bankId: certToBankId.get(account.cert), via: 'cert', accountType, reason: 'cert match' };
  }
  // Name fallback (only meaningful for bank/CU accounts).
  const key = normalizeNameForMatch(account.name);
  const hits = (key && nameToBankId && nameToBankId.get(key)) || null;
  if (hits && hits.length === 1) {
    return { bankId: hits[0], via: 'name', accountType, reason: 'name match (cert miss)' };
  }
  if (hits && hits.length > 1) {
    return { bankId: null, via: null, accountType, reason: `ambiguous name match (${hits.length} banks)` };
  }
  let reason;
  if (accountType === 'RIA') reason = 'RIA account (no bank entity)';
  else if (accountType === 'GENERAL') reason = 'general account (no bank)';
  else if (account.cert) reason = 'bank cert not in portal';
  else reason = 'bank account missing cert';
  return { bankId: null, via: null, accountType, reason };
}

// ---------- plans ----------

// Build the contact import plan (NO writes). existingKeys = Set of
// `${bankId}|e|${email.toLowerCase()}` and `${bankId}|n|${name.toLowerCase()}`
// (from the portal's listAllContacts), so a re-run dedups against what's
// already there. Within one run we also dedup against rows we just queued.
function buildContactImportPlan(contacts = [], { accountIndex, certToBankId, nameToBankId, existingKeys } = {}) {
  const seen = new Set(existingKeys || []);
  const create = [];
  const duplicate = [];
  const unmatched = [];
  const byReason = {};
  let viaCert = 0;
  let viaName = 0;

  for (const contact of contacts) {
    const m = matchContactToBank(contact, { accountIndex, certToBankId, nameToBankId });
    if (!m.bankId) {
      unmatched.push({ contact, reason: m.reason });
      byReason[m.reason] = (byReason[m.reason] || 0) + 1;
      continue;
    }
    const keyN = `${m.bankId}|n|${contact.name.toLowerCase()}`;
    const keyE = contact.email ? `${m.bankId}|e|${contact.email.toLowerCase()}` : '';
    if (seen.has(keyN) || (keyE && seen.has(keyE))) {
      duplicate.push({ bankId: m.bankId, contact, key: seen.has(keyN) ? keyN : keyE });
      continue;
    }
    seen.add(keyN);
    if (keyE) seen.add(keyE);
    if (m.via === 'cert') viaCert += 1; else if (m.via === 'name') viaName += 1;
    create.push({ bankId: m.bankId, contact, via: m.via });
  }

  return {
    create, duplicate, unmatched,
    stats: {
      total: contacts.length,
      create: create.length,
      duplicate: duplicate.length,
      unmatched: unmatched.length,
      viaCert, viaName,
      byReason,
    },
  };
}

// Owner backfill PROPOSAL. Account-level OwnerId is unusable (97% one admin),
// so derive each bank's owner from the modal owner of its (matched) contacts.
// contactsByBankId: Map<bankId, contact[]>. currentOwners: Map<bankId, owner|''>.
// Proposes only where the current coverage owner is blank — never stomps.
function buildOwnerBackfillPlan({ contactsByBankId, currentOwners } = {}) {
  const proposals = [];
  const current = currentOwners || new Map();
  for (const [bankId, list] of (contactsByBankId || new Map())) {
    const have = String(current.get(bankId) || '').trim();
    if (have) continue;
    const tally = new Map();
    for (const c of list) {
      const o = String(c.ownerName || '').trim();
      if (!o || o === 'Topsis Consulting') continue;
      tally.set(o, (tally.get(o) || 0) + 1);
    }
    if (!tally.size) continue;
    let best = '';
    let bestN = 0;
    for (const [o, n] of tally) { if (n > bestN) { best = o; bestN = n; } }
    proposals.push({ bankId, suggestedOwner: best, basis: `modal of ${list.length} contact(s) (${bestN}×)`, currentOwner: '' });
  }
  return { proposals, stats: { proposed: proposals.length } };
}

// Status backfill PROPOSAL. SF carries meaningful statuses (Client/Prospect/
// Watchlist/Dormant — not blank/Open) we can seed onto cert-matched banks.
// Two proposal kinds, never overriding a worked status:
//   - 'seed'    : portal has NO status (blank/absent)
//   - 'upgrade' : portal is the default 'Open' but SF has advanced it
// A portal status already in the meaningful set is left alone (skip).
// currentStatuses: Map<bankId, status|''>.
const SEEDABLE_STATUSES = new Set(['Client', 'Prospect', 'Watchlist', 'Dormant']);

function buildStatusBackfillPlan({ accountIndex, certToBankId, currentStatuses } = {}) {
  const proposals = [];
  const current = currentStatuses || new Map();
  let seed = 0;
  let upgrade = 0;
  if (!accountIndex) return { proposals, stats: { proposed: 0, seed: 0, upgrade: 0 } };
  for (const account of accountIndex.byId.values()) {
    if (account.type !== 'BANK-CREDIT UNION') continue;
    if (!SEEDABLE_STATUSES.has(account.status)) continue;
    if (!account.cert || !certToBankId || !certToBankId.has(account.cert)) continue;
    const bankId = certToBankId.get(account.cert);
    const have = String(current.get(bankId) || '').trim();
    let kind;
    if (!have) kind = 'seed';
    else if (have === 'Open') kind = 'upgrade';
    else continue; // already worked to a meaningful status — respect it
    proposals.push({ bankId, suggestedStatus: account.status, sfStatus: account.status, currentStatus: have, kind });
    if (kind === 'seed') seed += 1; else upgrade += 1;
  }
  return { proposals, stats: { proposed: proposals.length, seed, upgrade } };
}

module.exports = {
  parseCsv,
  RECORD_TYPE_BY_ID,
  normalizeCert,
  normalizeNameForMatch,
  buildRepResolver,
  buildAccountIndex,
  classifyTitle,
  parseContacts,
  matchContactToBank,
  buildContactImportPlan,
  buildOwnerBackfillPlan,
  buildStatusBackfillPlan,
  JUNK_EMAIL_DOMAINS,
};
