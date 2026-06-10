'use strict';

// Smoke coverage for the SQLite stores that had no automated tests before the
// better-sqlite3 parameterization (phase 2): bank-coverage-store,
// bank-account-status-store, bank-data-importer, and peer-averages. The goal
// is not exhaustive behavior testing — it is to prove every parameterized
// query actually binds and runs (no leftover sqlString interpolation, no
// undefined-bind crashes, no stale `{ maxBuffer }` second arg) and that values
// containing SQL metacharacters round-trip intact.
//
// Plain node, no framework. Fresh tmp dir per run. better-sqlite3 is a hard
// dependency now, so there is no CLI-availability guard.

const fs = require('fs');
const os = require('os');
const path = require('path');

const coverageStore = require('../server/bank-coverage-store');
const accountStatusStore = require('../server/bank-account-status-store');
const bankImporter = require('../server/bank-data-importer');
const peerAverages = require('../server/peer-averages');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

// Values chosen to break naive string interpolation: single quote, percent,
// underscore, backslash. If any query still interpolates, these corrupt it.
const TRICKY = "O'Brien % Co _ \\ Trust";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-store-smoke-'));
try {
  // ----------------------------------------------------------------------
  // bank-coverage-store
  // ----------------------------------------------------------------------
  const bank = { id: 'B-1', name: TRICKY, displayName: TRICKY, city: "St. O'Fallon", state: 'IL', certNumber: '12345', totalAssets: 400000, totalDeposits: 350000 };

  const saved = coverageStore.upsertSavedBank(tmpDir, bank, { status: 'Prospect', priority: 'High', owner: TRICKY, nextActionDate: '2026-06-01' });
  ok('coverage-upsert returns row', saved && saved.bankId === 'B-1');
  ok('coverage-upsert preserves tricky name', saved && saved.displayName === TRICKY, saved && saved.displayName);
  ok('coverage-upsert status', saved && saved.status === 'Prospect');

  const re = coverageStore.upsertSavedBank(tmpDir, bank, { status: 'Client' });
  ok('coverage-upsert conflict-update', re && re.status === 'Client' && re.priority === 'High');

  const cov = coverageStore.getBankCoverage(tmpDir, 'B-1');
  ok('coverage-get saved', cov && cov.saved && cov.saved.owner === TRICKY);

  const map = coverageStore.getSavedBankCoverageMap(tmpDir, ['B-1', 'B-2', "B'3"]);
  ok('coverage-map IN-clause', map instanceof Map && map.has('B-1'));

  const note = coverageStore.addBankNote(tmpDir, 'B-1', `note with ${TRICKY}`);
  ok('coverage-addNote', note && note.text.includes('Trust'));
  const cov2 = coverageStore.getBankCoverage(tmpDir, 'B-1');
  ok('coverage-note listed', cov2.notes.length === 1);
  coverageStore.removeBankNote(tmpDir, note.id);
  ok('coverage-removeNote', coverageStore.getBankCoverage(tmpDir, 'B-1').notes.length === 0);

  coverageStore.setPreferredPeerGroup(tmpDir, 'B-1', 'PG-0001');
  ok('coverage-setPeerPref', coverageStore.getPreferredPeerGroup(tmpDir, 'B-1').peerGroupId === 'PG-0001');
  coverageStore.removePreferredPeerGroup(tmpDir, 'B-1');
  ok('coverage-removePeerPref', coverageStore.getPreferredPeerGroup(tmpDir, 'B-1') === null);

  // Contacts — primary-flag clearing is a two-statement atomic write.
  const c1 = coverageStore.createBankContact(tmpDir, bank, { name: "Pat O'Brien", role: 'CFO', phone: '(217) 555-1212', email: 'pat@example.com', isPrimary: true });
  ok('contact-create primary', c1 && c1.isPrimary === true);
  const c2 = coverageStore.createBankContact(tmpDir, bank, { name: 'Dana Smith', isPrimary: true });
  ok('contact-create second primary', c2 && c2.isPrimary === true);
  const contacts = coverageStore.listContactsForBank(tmpDir, 'B-1');
  ok('contact-primary-exclusive', contacts.filter(c => c.isPrimary).length === 1, JSON.stringify(contacts.map(c => [c.name, c.isPrimary])));
  const upd = coverageStore.updateBankContact(tmpDir, c1.id, { role: 'CEO', isPrimary: true });
  ok('contact-update', upd.role === 'CEO' && upd.isPrimary === true);
  ok('contact-update re-clears other', coverageStore.listContactsForBank(tmpDir, 'B-1').filter(c => c.isPrimary).length === 1);
  const contactMap = coverageStore.listContactsForBanks(tmpDir, ['B-1']);
  ok('contact-map', contactMap.get('B-1').length === 2);
  coverageStore.deleteBankContact(tmpDir, c2.id);
  ok('contact-delete', coverageStore.listContactsForBank(tmpDir, 'B-1').length === 1);

  // Activities
  const act = coverageStore.recordBankActivity(tmpDir, { bankId: 'B-1', kind: 'note', summary: TRICKY, actorUsername: 'Rep1', actorDisplay: 'Rep One' });
  ok('activity-record', act && act.id);
  const acts = coverageStore.listActivitiesForBank(tmpDir, 'B-1');
  ok('activity-list', acts.length === 1 && acts[0].summary === TRICKY);
  const byActor = coverageStore.listRecentActivitiesByActor(tmpDir, 'rep1');
  ok('activity-byActor lowercased', byActor.length === 1);
  coverageStore.deleteBankActivity(tmpDir, 'B-1', act.id);
  ok('activity-delete', coverageStore.listActivitiesForBank(tmpDir, 'B-1').length === 0);

  // Manual typed activities (Call/Email/Meeting/Task/Note) — Phase 1 keystone.
  const call = coverageStore.recordManualActivity(tmpDir, {
    bankId: 'B-1', kind: 'call', subject: `Call re ${TRICKY}`, body: 'line one\nline two',
    activityDate: '2026-06-01', actorUsername: 'Rep1', actorDisplay: 'Rep One', contactId: 'C-9'
  });
  ok('manual-activity-record', call && call.kind === 'call' && call.subject.includes('Trust'));
  ok('manual-activity-body multiline', call && call.body === 'line one\nline two');
  ok('manual-activity-date', call && call.activityDate === '2026-06-01');
  ok('manual-activity-contact', call && call.contactId === 'C-9');
  coverageStore.recordManualActivity(tmpDir, { bankId: 'B-1', kind: 'email', subject: 'Sent rates', activityDate: '2026-06-08', actorUsername: 'Rep1' });
  ok('manual-activity-bad-kind rejected', coverageStore.recordManualActivity(tmpDir, { bankId: 'B-1', kind: 'bogus', subject: 'x' }) === null);
  const last = coverageStore.lastActivityByBank(tmpDir);
  ok('lastActivityByBank max date', last['B-1'] === '2026-06-08', last['B-1']);
  const counts = coverageStore.activityCountsByRep(tmpDir, { from: '2026-06-01', to: '2026-06-30' });
  const callRow = counts.find(c => c.kind === 'call');
  ok('activityCountsByRep call count', callRow && callRow.count === 1 && callRow.actorUsername === 'Rep1');
  ok('activityCountsByRep date-window excludes', coverageStore.activityCountsByRep(tmpDir, { from: '2026-07-01' }).length === 0);
  // Clean up so later assertions on B-1 activity counts stay isolated.
  coverageStore.listActivitiesForBank(tmpDir, 'B-1').forEach(a => coverageStore.deleteBankActivity(tmpDir, 'B-1', a.id));

  // Product fit
  const fit = coverageStore.upsertProductFit(tmpDir, bank, { product: 'Bond Swap', notes: TRICKY, flaggedByUsername: 'rep1' });
  ok('productfit-upsert', fit && fit.product === 'Bond Swap' && fit.notes === TRICKY);
  const fit2 = coverageStore.upsertProductFit(tmpDir, bank, { product: 'Bond Swap', notes: 'updated' });
  ok('productfit-upsert-update', fit2.id === fit.id && fit2.notes === 'updated');
  ok('productfit-list', coverageStore.listProductFitForBank(tmpDir, 'B-1').length === 1);
  ok('productfit-map', coverageStore.listProductFitForBanks(tmpDir, ['B-1']).get('B-1').length === 1);
  coverageStore.deleteProductFit(tmpDir, fit.id);
  ok('productfit-delete', coverageStore.listProductFitForBank(tmpDir, 'B-1').length === 0);

  // Billing queue
  const bill = coverageStore.enqueueBilling(tmpDir, { refType: 'swap', refId: "SP-2026-0001'", bankId: 'B-1', summary: TRICKY, amount: 1250.5, certNumber: '12345' });
  ok('billing-enqueue', bill && bill.amount === 1250.5 && bill.summary === TRICKY);
  const bill2 = coverageStore.enqueueBilling(tmpDir, { refType: 'swap', refId: "SP-2026-0001'", bankId: 'B-1', amount: 2000 });
  ok('billing-enqueue dedupes on ref', bill2.id === bill.id && bill2.amount === 2000);
  const billUpd = coverageStore.updateBillingItem(tmpDir, bill.id, { state: 'Invoiced', billedBy: 'rep1' });
  ok('billing-update state', billUpd.state === 'Invoiced' && billUpd.billedBy === 'rep1');
  ok('billing-list filtered', coverageStore.listBillingQueue(tmpDir, { state: 'Invoiced' }).length === 1);
  ok('billing-count', coverageStore.countBillingByState(tmpDir).Invoiced === 1);

  // Cascade delete: removing the saved bank should drop its notes via FK.
  coverageStore.addBankNote(tmpDir, 'B-1', 'pre-delete note');
  coverageStore.removeSavedBank(tmpDir, 'B-1');
  ok('coverage-remove', coverageStore.getBankCoverage(tmpDir, 'B-1').saved === null);
  ok('coverage-remove cascades notes', coverageStore.getBankCoverage(tmpDir, 'B-1').notes.length === 0);

  // ----------------------------------------------------------------------
  // bank-account-status-store
  // ----------------------------------------------------------------------
  const asDir = path.join(tmpDir, 'acct');
  const summary = { id: 'B-1', certNumber: '12345', displayName: TRICKY, name: TRICKY, city: "St. O'Fallon", state: 'IL' };
  const st = accountStatusStore.upsertBankAccountStatus(asDir, summary, { status: 'Client', owner: TRICKY, services: 'ALM, BCIS' });
  ok('acct-upsert', st && st.status === 'Client' && st.owner === TRICKY);
  const st1 = accountStatusStore.getBankAccountStatus(asDir, 'B-1');
  ok('acct-get', st1 && st1.displayName === TRICKY);
  const stMap = accountStatusStore.getBankAccountStatuses(asDir, ['B-1', "B'2"]);
  ok('acct-getMany IN-clause', stMap.has('B-1'));

  // Bulk upsert (transaction path)
  accountStatusStore.upsertBankAccountStatusRows(asDir, [
    { bankId: 'B-2', certNumber: '222', displayName: 'Second Bank', legalName: 'Second Bank NA', city: 'Peoria', state: 'IL', status: 'Prospect', source: 'wb', owner: 'rep2', services: 'CECL', affiliate: null, affiliateStatus: null, affiliateRep: null, bankersBankServices: null },
    { bankId: 'B-3', certNumber: '333', displayName: 'Third Bank', legalName: 'Third Bank NA', city: 'Quincy', state: 'MO', status: 'Open', source: 'wb', owner: null, services: null, affiliate: 'Aff', affiliateStatus: 'Active', affiliateRep: 'rep3', bankersBankServices: 'Wire Transfer' }
  ]);
  ok('acct-bulk count', accountStatusStore.countBankAccountStatuses(asDir, {}) === 3);
  ok('acct-search quote', accountStatusStore.listBankAccountStatuses(asDir, { q: "O'Brien" }).length === 1);
  ok('acct-search wildcard literal', accountStatusStore.listBankAccountStatuses(asDir, { q: '%' }).length === 1, 'literal % should match only the tricky name');
  ok('acct-filter status', accountStatusStore.listBankAccountStatuses(asDir, { status: 'Prospect' }).length === 1);
  ok('acct-filter service fbbs', accountStatusStore.listBankAccountStatuses(asDir, { service: 'fbbs' }).length === 2);
  ok('acct-filter service affiliate', accountStatusStore.listBankAccountStatuses(asDir, { service: 'affiliate' }).length === 1);
  ok('acct-distinct owners', accountStatusStore.listDistinctAccountOwners(asDir).length >= 1);
  const imp = accountStatusStore.getBankAccountStatusImportStatus(asDir);
  ok('acct-import-status metadata roundtrip', imp.available === true && imp.statusCount === 3);

  // ----------------------------------------------------------------------
  // bank-data-importer (writeBankDatabase bulk path) + peer-averages
  // ----------------------------------------------------------------------
  const reportsDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  function makeBank(id, o) {
    const period = '2026Q1';
    const values = {
      displayName: o.displayName, city: o.city, state: o.state, certNumber: o.certNumber,
      zip: o.zip, totalAssets: o.totalAssets, totalDeposits: o.totalDeposits,
      roa: o.roa, subchapterS: o.subchapterS, agSum: o.agSum
    };
    const summaryObj = {
      id, displayName: o.displayName, name: o.legalName || o.displayName, city: o.city,
      state: o.state, certNumber: o.certNumber, parentName: '', primaryRegulator: 'FDIC',
      period, totalAssets: o.totalAssets, totalDeposits: o.totalDeposits, zip: o.zip
    };
    return { id, summary: summaryObj, periods: [{ period, values }] };
  }

  const parsed = {
    metadata: { importedAt: new Date().toISOString(), sourceFile: 'smoke.xlsm', latestPeriod: '2026Q1', bankCount: 2, rowCount: 2, fields: bankImporter.BANK_FIELDS },
    banks: [
      makeBank('B-1', { displayName: TRICKY, city: "St. O'Fallon", state: 'IL', certNumber: '12345', zip: '62269', totalAssets: 400000, totalDeposits: 350000, roa: 1.1, subchapterS: 'Yes', agSum: 30 }),
      makeBank('B-2', { displayName: 'Second Bank', city: 'Des Moines', state: 'IA', certNumber: '222', zip: '50301', totalAssets: 800000, totalDeposits: 700000, roa: 0.9, subchapterS: 'No', agSum: 10 })
    ]
  };
  bankImporter.writeBankDatabase(parsed, reportsDir);

  const status = bankImporter.getBankDatabaseStatus(reportsDir);
  ok('importer-status available', status.available === true && status.bankCount === 2, JSON.stringify(status));

  const searchTricky = bankImporter.searchBankDatabase(reportsDir, "o'brien");
  ok('importer-search quote in LIKE', searchTricky.results.length === 1 && searchTricky.results[0].id === 'B-1', JSON.stringify(searchTricky.results.map(r => r.id)));
  const searchWild = bankImporter.searchBankDatabase(reportsDir, 'bank');
  ok('importer-search token', searchWild.results.length >= 1);
  const searchEmpty = bankImporter.searchBankDatabase(reportsDir, '');
  ok('importer-search empty lists all', searchEmpty.results.length === 2);

  const oneBank = bankImporter.getBankFromDatabase(reportsDir, 'B-1');
  ok('importer-getBank', oneBank && oneBank.bank.id === 'B-1');
  ok('importer-getBank missing', bankImporter.getBankFromDatabase(reportsDir, "X'1") === null);
  ok('importer-listSummaries', bankImporter.listBankSummaries(reportsDir).length === 2);

  const mapData = bankImporter.queryBankMapDataset(reportsDir);
  ok('importer-mapDataset rows', mapData && Array.isArray(mapData.banks) && mapData.banks.length === 2, mapData && JSON.stringify(Object.keys(mapData)));
  ok('importer-mapDataset GLOB period filter', mapData && mapData.latestPeriod === '2026Q1', mapData && mapData.latestPeriod);

  // peer-averages reads the same bank-data.sqlite the importer just wrote.
  const matchAll = peerAverages.findMatchingBanks(reportsDir, {}, '2026Q1');
  ok('peer-findMatching all', matchAll.count === 2 && matchAll.period === '2026Q1', JSON.stringify(matchAll));
  const matchSmall = peerAverages.findMatchingBanks(reportsDir, { assetMax: 500000 }, '2026Q1');
  ok('peer-findMatching assetMax', matchSmall.count === 1 && matchSmall.bankIds[0] === 'B-1');
  const matchState = peerAverages.findMatchingBanks(reportsDir, { states: ['IL'] }, '2026Q1');
  ok('peer-findMatching state', matchState.count === 1 && matchState.bankIds[0] === 'B-1');
  const matchSubS = peerAverages.findMatchingBanks(reportsDir, { subchapterS: 'Yes' }, '2026Q1');
  ok('peer-findMatching subS', matchSubS.count === 1 && matchSubS.bankIds[0] === 'B-1');
  const matchMix = peerAverages.findMatchingBanks(reportsDir, { loanMix: [{ key: 'agSum', op: '>=', value: 25 }] }, '2026Q1');
  ok('peer-findMatching loanMix', matchMix.count === 1 && matchMix.bankIds[0] === 'B-1');

  const avgs = peerAverages.computeCohortAverages(reportsDir, {}, '2026Q1');
  ok('peer-cohort population', avgs.populationCount === 2 && avgs.period === '2026Q1', JSON.stringify({ pop: avgs.populationCount, period: avgs.period }));
  ok('peer-cohort avg roa', Math.abs(avgs.byKey.roa.peerValue - 1.0) < 1e-9, avgs.byKey.roa && String(avgs.byKey.roa.peerValue));
  ok('peer-cohort avg totalAssets', Math.abs(avgs.byKey.totalAssets.peerValue - 600000) < 1e-6);

  const comparison = peerAverages.peerComparisonFromCohort(reportsDir, { id: 'PG-1', name: 'All', criteria: {} }, '2026Q1');
  ok('peer-comparison shape', comparison && comparison.peerGroup && comparison.peerGroup.populationCount === 2, comparison && JSON.stringify(comparison.peerGroup || null));

  console.log(`store-smoke tests: ${passed} passed, ${failed} failed.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
