// Tests for server/salesforce-import.js — the pure Foundation parser/matcher
// for the 2026-06-24 Salesforce export. No I/O, no network. The final block is
// a guarded integration check that asserts the real-export funnel only when the
// staged CSVs + bank-data.sqlite are present (skips cleanly otherwise).
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sf = require('../server/salesforce-import');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---- normalizeCert ----
test('normalizeCert strips commas and trailing .0', () => {
  assert.strictEqual(sf.normalizeCert('12,345.0'), '12345');
  assert.strictEqual(sf.normalizeCert('4829'), '4829');
  assert.strictEqual(sf.normalizeCert(4829), '4829');
  assert.strictEqual(sf.normalizeCert('4829.000'), '4829');
  assert.strictEqual(sf.normalizeCert(''), '');
  assert.strictEqual(sf.normalizeCert(null), '');
  assert.strictEqual(sf.normalizeCert('NCUA-77'), 'NCUA-77'); // non-numeric passes through
});

// ---- buildRepResolver ----
test('buildRepResolver joins OwnerId on the 15-char prefix', () => {
  const reps = [
    { 'First Name': 'Jason', 'Last Name': 'Henderson', 'User ID': '005Vz000000RAo9', 'Alias': 'JHend', 'Active': '1' },
    { 'First Name': 'Jay', 'Last Name': 'Wombolt', 'User ID': '005Vz000000RAo5', 'Alias': 'JWomb', 'Active': '0' },
  ];
  const resolve = sf.buildRepResolver(reps);
  // data IDs carry a 3-char suffix; resolver matches the 15-char prefix
  assert.strictEqual(resolve('005Vz000000RAo9IAG').name, 'Jason Henderson');
  assert.strictEqual(resolve('005Vz000000RAo5IAA').name, 'Jay Wombolt');
  assert.strictEqual(resolve('005Vz000000RAo9IAG').active, true);
  assert.strictEqual(resolve('005Vz000000RAo5IAA').active, false);
  assert.strictEqual(resolve('005Vz999999XXXXIAG'), null);
  assert.strictEqual(resolve(''), null);
});

// ---- classifyTitle ----
test('classifyTitle normalizes free-text titles into decision-maker categories', () => {
  for (const t of ['President/CEO', 'President & CEO', 'CEO/President', 'Chief Executive Officer']) {
    const c = sf.classifyTitle(t);
    assert.ok(c.decisionMaker, `${t} should be a decision-maker`);
  }
  assert.strictEqual(sf.classifyTitle('CFO').category, 'cfo');
  assert.strictEqual(sf.classifyTitle('EVP/CFO').category, 'cfo');
  assert.strictEqual(sf.classifyTitle('Chief Financial Officer').category, 'cfo');
  assert.strictEqual(sf.classifyTitle('Investment Officer').category, 'investment');
  assert.strictEqual(sf.classifyTitle('Portfolio Manager').category, 'investment');
  assert.strictEqual(sf.classifyTitle('Cashier').category, 'cashier');
  // investment beats president when both could match
  assert.strictEqual(sf.classifyTitle('President & Chief Investment Officer').category, 'investment');
  // non-DM
  const analyst = sf.classifyTitle('Credit Analyst');
  assert.strictEqual(analyst.decisionMaker, false);
  // empty
  const blank = sf.classifyTitle('');
  assert.strictEqual(blank.role, '');
  assert.strictEqual(blank.decisionMaker, false);
});

// ---- buildAccountIndex ----
test('buildAccountIndex maps record types, normalizes cert, skips deleted, builds byCert', () => {
  const rows = [
    { Account_Id_18__c: 'A1', Id: 'A1', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829.0', Name: 'First Bank', State__c: 'IA', OwnerId: 'o1', Status__c: 'Client', Subchapter_S_Election__c: 'false', IsDeleted: 'false' },
    { Account_Id_18__c: 'A2', Id: 'A2', RecordTypeId: '012Hs000000CFaKIAW', Cert_Number__c: '', Name: 'Helm RIA', State__c: 'VA', OwnerId: 'o2', Status__c: 'Open', IsDeleted: 'false' },
    { Account_Id_18__c: 'A3', Id: 'A3', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829', Name: 'Dup Cert Bank', State__c: 'IA', OwnerId: 'o1', Status__c: 'Prospect', IsDeleted: 'false' },
    { Account_Id_18__c: 'A4', Id: 'A4', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '999', Name: 'Gone Bank', IsDeleted: 'true' }, // dropped
  ];
  const idx = sf.buildAccountIndex(rows);
  assert.strictEqual(idx.byId.size, 3);
  assert.strictEqual(idx.byId.get('A1').type, 'BANK-CREDIT UNION');
  assert.strictEqual(idx.byId.get('A1').cert, '4829');
  assert.strictEqual(idx.byId.get('A2').type, 'RIA');
  assert.strictEqual(idx.byId.get('A2').cert, '');
  assert.ok(!idx.byId.has('A4'), 'deleted row dropped');
  // collision: A1 and A3 share normalized cert 4829
  assert.deepStrictEqual(idx.byCert.get('4829').sort(), ['A1', 'A3']);
});

// ---- parseContacts ----
test('parseContacts normalizes, flags junk, resolves owner, carries compliance', () => {
  const reps = [{ 'First Name': 'Gio', 'Last Name': 'Rozo', 'User ID': '005Vz000003npE9' }];
  const repResolver = sf.buildRepResolver(reps);
  const rows = [
    { Id: '003A', AccountId: 'A1', FirstName: 'Mike', LastName: 'Hoffman', Name: 'Mike Hoffman', Title: 'President/CEO', Email: 'mhoffman@sullivanbank.com', Phone: '573-468-3191', OwnerId: '005Vz000003npE9IAA', DoNotCall: 'false', HasOptedOutOfEmail: 'false', IsEmailBounced: 'false' },
    { Id: '003B', AccountId: 'A2', FirstName: 'Owen', LastName: 'Leaman', Name: 'Owen Leaman', Title: 'CEO', Email: 'owen@topsisconsulting.com', OwnerId: 'x' }, // junk domain
    { Id: '003C', AccountId: 'A3', FirstName: '', LastName: '', Name: '', Title: '', Email: '' }, // junk: no name
    { Id: '003D', AccountId: 'A4', LastName: 'Smith', Name: 'Jane Smith', Title: 'CFO', Email: 'jane@firstkansasbank.com', MobilePhone: '111-222-3333', OwnerId: 'x', DoNotCall: 'true' },
  ];
  const contacts = sf.parseContacts(rows, { repResolver });
  assert.strictEqual(contacts.length, 4);
  const mike = contacts.find(c => c.sfId === '003A');
  assert.strictEqual(mike.ownerName, 'Gio Rozo');
  assert.strictEqual(mike.decisionMaker, true);
  assert.strictEqual(mike.junk, false);
  assert.strictEqual(contacts.find(c => c.sfId === '003B').junk, true, 'junk email domain');
  assert.strictEqual(contacts.find(c => c.sfId === '003C').junk, true, 'no name');
  const jane = contacts.find(c => c.sfId === '003D');
  assert.strictEqual(jane.doNotCall, true);
  assert.strictEqual(jane.mobile, '111-222-3333');
});

// ---- matchContactToBank ----
test('matchContactToBank: cert hit, name fallback, ambiguous, RIA/orphan unmatched', () => {
  const accountIndex = sf.buildAccountIndex([
    { Account_Id_18__c: 'A1', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829', Name: 'First Bank' },
    { Account_Id_18__c: 'A2', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '7777', Name: 'Name Only Bank' }, // cert not in portal
    { Account_Id_18__c: 'A3', RecordTypeId: '012Hs000000CFaKIAW', Cert_Number__c: '', Name: 'Some RIA' },
    { Account_Id_18__c: 'A4', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '8888', Name: 'Ambiguous Bank' },
  ]);
  const certToBankId = new Map([['4829', 'B1']]);
  const nameToBankId = new Map([
    ['name only bank', ['B2']],
    ['ambiguous bank', ['B3', 'B4']],
  ]);
  const ctx = { accountIndex, certToBankId, nameToBankId };
  const mk = (accountId, junk = false) => ({ accountId, junk, name: 'x', email: '' });

  assert.deepStrictEqual(
    (({ bankId, via }) => ({ bankId, via }))(sf.matchContactToBank(mk('A1'), ctx)),
    { bankId: 'B1', via: 'cert' });
  assert.deepStrictEqual(
    (({ bankId, via }) => ({ bankId, via }))(sf.matchContactToBank(mk('A2'), ctx)),
    { bankId: 'B2', via: 'name' });
  let m = sf.matchContactToBank(mk('A3'), ctx);
  assert.strictEqual(m.bankId, null);
  assert.ok(/RIA/.test(m.reason));
  m = sf.matchContactToBank(mk('A4'), ctx);
  assert.strictEqual(m.bankId, null);
  assert.ok(/ambiguous/i.test(m.reason));
  // orphan + junk
  assert.strictEqual(sf.matchContactToBank({ accountId: '', junk: false, name: 'x' }, ctx).bankId, null);
  assert.ok(/junk/.test(sf.matchContactToBank(mk('A1', true), ctx).reason));
  // accountId not in export
  assert.ok(/not in account export/.test(sf.matchContactToBank(mk('NOPE'), ctx).reason));
});

// ---- buildContactImportPlan ----
test('buildContactImportPlan dedups against existing + within run, counts stats', () => {
  const accountIndex = sf.buildAccountIndex([
    { Account_Id_18__c: 'A1', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829', Name: 'First Bank' },
    { Account_Id_18__c: 'A3', RecordTypeId: '012Hs000000CFaKIAW', Cert_Number__c: '', Name: 'Some RIA' },
  ]);
  const certToBankId = new Map([['4829', 'B1']]);
  const nameToBankId = new Map();
  const existingKeys = new Set(['B1|e|dupe@first.com']); // already imported
  const contacts = [
    { accountId: 'A1', name: 'New One', email: 'new@first.com', junk: false },
    { accountId: 'A1', name: 'Dupe', email: 'dupe@first.com', junk: false },     // dup by existing email
    { accountId: 'A1', name: 'New One', email: 'other@first.com', junk: false }, // dup by name within run
    { accountId: 'A3', name: 'RIA Person', email: 'p@ria.com', junk: false },    // unmatched (RIA)
    { accountId: '', name: 'Orphan', email: '', junk: false },                   // unmatched (orphan)
  ];
  const plan = sf.buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys });
  assert.strictEqual(plan.stats.create, 1, 'only the first New One is created');
  assert.strictEqual(plan.stats.duplicate, 2);
  assert.strictEqual(plan.stats.unmatched, 2);
  assert.strictEqual(plan.stats.update, 0);
  assert.strictEqual(plan.stats.unchanged, 0);
  assert.strictEqual(plan.stats.viaCert, 1);
  assert.strictEqual(plan.create[0].contact.name, 'New One');
  assert.ok(plan.create[0].desired, 'create carries desired field set');
});

test('buildContactImportPlan is idempotent via salesforce_contact_id (update vs unchanged)', () => {
  const accountIndex = sf.buildAccountIndex([
    { Account_Id_18__c: 'A1', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829', Name: 'First Bank' },
  ]);
  const certToBankId = new Map([['4829', 'B1']]);
  const nameToBankId = new Map();
  // The export contact, already imported once under sfId 003A.
  const contact = { accountId: 'A1', sfId: '003A', name: 'Mike Hoffman', title: 'President/CEO', phone: '(573) 468-3191', mobile: '', email: 'mhoffman@bank.com', junk: false, doNotCall: false, optOutEmail: false, emailBounced: false };

  // (a) existing row identical (phone stored with different formatting) → unchanged, no write
  const existingSame = new Map([['003A', { id: 'row1', bankId: 'B1', name: 'Mike Hoffman', role: 'President/CEO', phone: '5734683191', email: 'MHOFFMAN@bank.com', doNotCall: false, optOutEmail: false, emailBounced: false }]]);
  let plan = sf.buildContactImportPlan([contact], { accountIndex, certToBankId, nameToBankId, existingKeys: new Set(), existingBySfId: existingSame });
  assert.strictEqual(plan.stats.create, 0);
  assert.strictEqual(plan.stats.unchanged, 1, 'cosmetic phone/email diffs do not trigger an update');
  assert.strictEqual(plan.stats.update, 0);

  // (b) existing row with a changed title + new DoNotCall flag → update with changed fields
  const changedContact = { ...contact, title: 'CEO', doNotCall: true };
  const existingDiff = new Map([['003A', { id: 'row1', bankId: 'B1', name: 'Mike Hoffman', role: 'President/CEO', phone: '5734683191', email: 'mhoffman@bank.com', doNotCall: false, optOutEmail: false, emailBounced: false }]]);
  plan = sf.buildContactImportPlan([changedContact], { accountIndex, certToBankId, nameToBankId, existingKeys: new Set(), existingBySfId: existingDiff });
  assert.strictEqual(plan.stats.update, 1);
  assert.strictEqual(plan.stats.create, 0);
  assert.deepStrictEqual(plan.update[0].changed.sort(), ['doNotCall', 'role']);
  assert.strictEqual(plan.update[0].existingId, 'row1');
});

// ---- backfill proposals ----
test('buildOwnerBackfillPlan proposes modal contact owner, blank-only', () => {
  const contactsByBankId = new Map([
    ['B1', [{ ownerName: 'A.W. Spellmeyer' }, { ownerName: 'A.W. Spellmeyer' }, { ownerName: 'Gio Rozo' }]],
    ['B2', [{ ownerName: 'Topsis Consulting' }]], // only junk owner → no proposal
    ['B3', [{ ownerName: 'Jay Wombolt' }]],       // but already owned → skipped
  ]);
  const currentOwners = new Map([['B1', ''], ['B2', ''], ['B3', 'Existing Owner']]);
  const plan = sf.buildOwnerBackfillPlan({ contactsByBankId, currentOwners });
  assert.strictEqual(plan.stats.proposed, 1);
  assert.strictEqual(plan.proposals[0].bankId, 'B1');
  assert.strictEqual(plan.proposals[0].suggestedOwner, 'A.W. Spellmeyer');
});

test('buildStatusBackfillPlan: seed blanks, upgrade Open, respect worked statuses', () => {
  const accountIndex = sf.buildAccountIndex([
    { Account_Id_18__c: 'A1', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '4829', Status__c: 'Client' },   // seed (blank)
    { Account_Id_18__c: 'A2', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '5555', Status__c: 'Open' },     // not seedable
    { Account_Id_18__c: 'A3', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '6666', Status__c: 'Prospect' }, // skip (worked)
    { Account_Id_18__c: 'A4', RecordTypeId: '012Hs000000CFaKIAW', Cert_Number__c: '', Status__c: 'Client' },       // RIA, no cert
    { Account_Id_18__c: 'A5', RecordTypeId: '012Hs000000CFaPIAW', Cert_Number__c: '9999', Status__c: 'Client' },   // upgrade (portal Open)
  ]);
  const certToBankId = new Map([['4829', 'B1'], ['5555', 'B2'], ['6666', 'B3'], ['9999', 'B5']]);
  const currentStatuses = new Map([['B3', 'Watchlist'], ['B5', 'Open']]);
  const plan = sf.buildStatusBackfillPlan({ accountIndex, certToBankId, currentStatuses });
  assert.strictEqual(plan.stats.proposed, 2);
  assert.strictEqual(plan.stats.seed, 1);
  assert.strictEqual(plan.stats.upgrade, 1);
  const b1 = plan.proposals.find(p => p.bankId === 'B1');
  const b5 = plan.proposals.find(p => p.bankId === 'B5');
  assert.strictEqual(b1.kind, 'seed');
  assert.strictEqual(b5.kind, 'upgrade');
  assert.strictEqual(b5.suggestedStatus, 'Client');
});

// ---- store-level apply behavior (temp DBs) ----
test('[store] bank_contacts sfId: create persists sfId+compliance, update preserves sfId, no duplicate', () => {
  const bcs = require('../server/bank-coverage-store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-store-'));
  try {
    const summary = { id: 'B1', certNumber: '4829', displayName: 'Test Bank', name: 'Test Bank', city: 'Ames', state: 'IA' };
    const c = bcs.createBankContact(tmp, summary, {
      name: 'Mike H', role: 'CEO', phone: '515-555-1212', email: 'mike@b.com',
      salesforceContactId: '003A', doNotCall: true, notes: 'Salesforce 003A · imported 2026-06-24',
    });
    assert.strictEqual(c.salesforceContactId, '003A');
    assert.strictEqual(c.doNotCall, true);

    const map = bcs.getContactsBySalesforceIds(tmp, ['003A', '003ZZZ']);
    assert.strictEqual(map.size, 1);
    assert.ok(map.has('003A'));

    // DB-level idempotency guard: a second insert with the same sfId is rejected.
    assert.throws(() => bcs.createBankContact(tmp, summary, { name: 'Dup', salesforceContactId: '003A' }),
      /UNIQUE|constraint/i, 'partial unique index blocks a duplicate sfId');

    const updated = bcs.updateBankContact(tmp, c.id, { role: 'President', doNotCall: false });
    assert.strictEqual(updated.role, 'President');
    assert.strictEqual(updated.doNotCall, false);
    assert.strictEqual(updated.salesforceContactId, '003A', 'sfId preserved on update');
    assert.strictEqual(bcs.listAllContacts(tmp).length, 1, 'still one row');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('[store] backfillSalesforceContactIds links notes-only rows on first migrate', () => {
  const sqlite = require('../server/sqlite-db');
  const bcs = require('../server/bank-coverage-store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-backfill-'));
  try {
    const dbPath = path.join(tmp, 'bank-coverage.sqlite');
    // Simulate the pre-sfId schema + a notes-only imported row (the original import shape).
    sqlite.execSqlite(dbPath, `
      CREATE TABLE bank_contacts (id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, cert_number TEXT,
        name TEXT NOT NULL, role TEXT, phone TEXT, email TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
        notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE coverage_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
    sqlite.runSqlite(dbPath, 'INSERT INTO bank_contacts (id,bank_id,name,notes,created_at,updated_at) VALUES (?,?,?,?,?,?);',
      ['c1', 'B1', 'Old Person', 'Salesforce 003OLD · imported 2026-06-24', 't', 't']);
    // First store call on this fresh dbPath triggers migrate (adds column) + backfill.
    const map = bcs.getContactsBySalesforceIds(tmp, ['003OLD']);
    assert.ok(map.has('003OLD'), 'notes-only row got salesforce_contact_id backfilled');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('[store] owner/status apply target is account_status: owner backfill preserves worked status', () => {
  const ass = require('../server/bank-account-status-store');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ownerstatus-'));
  try {
    const summary = { id: 'B1', certNumber: '4829', displayName: 'Test Bank', name: 'Test Bank', city: 'Ames', state: 'IA' };
    // a worked Client status exists on the overlay
    ass.upsertBankAccountStatus(tmp, summary, { status: 'Client' });
    // owner backfill = upsertBankAccountStatus({owner}) — must NOT downgrade the status
    ass.upsertBankAccountStatus(tmp, summary, { owner: 'Gio Rozo', source: 'salesforce-import' });
    let as = ass.getBankAccountStatuses(tmp, ['B1']).get('B1');
    assert.strictEqual(as.owner, 'Gio Rozo');
    assert.strictEqual(as.status, 'Client', 'owner backfill preserved the worked status (no Open clobber)');

    // status seed/upgrade on a fresh bank
    const b2 = { id: 'B2', certNumber: '5555', displayName: 'Bank Two', name: 'Bank Two', city: 'Des Moines', state: 'IA' };
    ass.upsertBankAccountStatus(tmp, b2, { status: 'Prospect', source: 'salesforce-import' });
    as = ass.getBankAccountStatuses(tmp, ['B2']).get('B2');
    assert.strictEqual(as.status, 'Prospect');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---- parseCsv ----
test('parseCsv handles quotes, escaped quotes, embedded newlines, keeps header case', () => {
  const csv = '"Id","Name","Note"\n"1","First Bank","line1\nline2"\n"2","O""Brien Bank, NA","x"';
  const rows = sf.parseCsv(csv);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].Name, 'First Bank');
  assert.strictEqual(rows[0].Note, 'line1\nline2');
  assert.strictEqual(rows[1].Name, 'O"Brien Bank, NA');
});

// ---- guarded integration check (real export + DB) ----
test('[integration] real export reproduces the documented funnel (skips if absent)', () => {
  const raw = path.join(__dirname, '..', 'data', 'salesforce-export', '2026-06-24', 'raw');
  const bankDb = path.join(__dirname, '..', 'data', 'bank-reports', 'bank-data.sqlite');
  if (!fs.existsSync(raw) || !fs.existsSync(bankDb)) {
    console.log('   (skipped — staged export / bank-data.sqlite not present)');
    return;
  }
  const { listBankSummaries } = require('../server/bank-data-importer');
  const read = frag => {
    const f = fs.readdirSync(raw).find(x => x.toUpperCase().includes(frag) && x.toLowerCase().endsWith('.csv'));
    return sf.parseCsv(fs.readFileSync(path.join(raw, f)).toString('utf8'));
  };
  const accountIndex = sf.buildAccountIndex(read('ACCOUNT'));
  const contacts = sf.parseContacts(read('CONTACT'), { repResolver: sf.buildRepResolver(read('REP')) });
  const summaries = listBankSummaries(path.join(__dirname, '..', 'data', 'bank-reports'));
  const certToBankId = new Map();
  const nameToBankId = new Map();
  for (const s of summaries) {
    const cert = sf.normalizeCert(s.certNumber);
    if (cert && !certToBankId.has(cert)) certToBankId.set(cert, String(s.id));
    for (const cand of [s.name, s.displayName]) {
      const k = sf.normalizeNameForMatch(cand);
      if (!k) continue;
      if (!nameToBankId.has(k)) nameToBankId.set(k, []);
      if (!nameToBankId.get(k).includes(String(s.id))) nameToBankId.get(k).push(String(s.id));
    }
  }
  const plan = sf.buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys: new Set() });
  // Documented in the spec: ~2,110 live contacts, ~1,680 current-bank cert
  // auto-links after stale/M&A bank rows are excluded, big RIA bucket.
  assert.ok(plan.stats.total >= 2000 && plan.stats.total <= 2200, `total ${plan.stats.total}`);
  assert.ok(plan.stats.viaCert >= 1650, `viaCert ${plan.stats.viaCert} should be ~1680 current-bank links`);
  assert.ok(plan.stats.unmatched >= 250, `unmatched ${plan.stats.unmatched} (RIA/general/orphan)`);
  // RIA contacts must be a named unmatched reason, not lost
  assert.ok(Object.keys(plan.stats.byReason).some(r => /RIA/.test(r)), 'RIA reason present');

  // Live idempotency: if contacts were already applied, re-planning against the
  // live coverage DB must NOT re-create them — they reconcile as unchanged/update.
  const covDb = path.join(__dirname, '..', 'data', 'bank-reports', 'bank-coverage.sqlite');
  if (fs.existsSync(covDb)) {
    const { getContactsBySalesforceIds, listAllContacts } = require('../server/bank-coverage-store');
    const existingBySfId = getContactsBySalesforceIds(path.join(__dirname, '..', 'data', 'bank-reports'), contacts.map(c => c.sfId));
    const existingKeys = new Set();
    for (const c of listAllContacts(path.join(__dirname, '..', 'data', 'bank-reports'), { limit: 10000 })) {
      if (c.email) existingKeys.add(`${c.bankId}|e|${c.email.toLowerCase()}`);
      if (c.name) existingKeys.add(`${c.bankId}|n|${c.name.toLowerCase()}`);
    }
    const plan2 = sf.buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys, existingBySfId });
    // re-import never creates more than a fresh slate, and the buckets sum to total
    assert.ok(plan2.stats.create <= plan.stats.create, 'idempotent: re-run creates no more than fresh');
    assert.strictEqual(
      plan2.stats.create + plan2.stats.update + plan2.stats.unchanged + plan2.stats.duplicate + plan2.stats.unmatched,
      plan2.stats.total, 'buckets reconcile to total');
    if (existingBySfId.size >= 1650) {
      assert.ok(plan2.stats.create <= 40, `after apply, create should be tiny (was ${plan2.stats.create})`);
      assert.ok(plan2.stats.unchanged + plan2.stats.update >= 1650, 'most current-bank contacts reconcile as unchanged/update');
    }
  }
});

// ---- run ----
(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`ok  ${t.name}`); }
    catch (e) { console.error(`FAIL ${t.name}\n     ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
