'use strict';

/**
 * Smoke tests for server/swap-store.js. Spawns the sqlite3 CLI against a
 * temp dir; no network, no shared state.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../server/swap-store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-store-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

test('ensureSwapDatabase creates the file and yields a sequence', () => {
  store.ensureSwapDatabase(tmp);
  assert.ok(fs.existsSync(path.join(tmp, 'swap-proposals.sqlite')));
  const id1 = store.nextProposalId(tmp, new Date('2026-05-13'));
  const id2 = store.nextProposalId(tmp, new Date('2026-05-13'));
  assert.match(id1, /^SP-2026-\d{4}$/);
  assert.match(id2, /^SP-2026-\d{4}$/);
  assert.notStrictEqual(id1, id2);
});

test('createProposal stores all fields + derives tax rate from Sub-S flag', () => {
  const p = store.createProposal(tmp, {
    bankId: 'bank-1',
    title: 'Test swap for MCNB',
    proposalDate: '2026-05-13',
    settleDate: '2026-05-14',
    isSubchapterS: false,
    horizonYears: 3,
    breakevenCapMonths: 12,
    maturityFloorMonths: 12,
    preparedBy: 'Jim Lewis',
    preparedFor: 'CFO',
    notes: 'Initial draft'
  });
  assert.strictEqual(p.proposal.bankId, 'bank-1');
  assert.strictEqual(p.proposal.title, 'Test swap for MCNB');
  assert.strictEqual(p.proposal.status, 'draft');
  assert.strictEqual(p.proposal.taxRate, 21);
  assert.strictEqual(p.proposal.isSubchapterS, false);
  assert.strictEqual(p.legs.length, 0);
  assert.strictEqual(p.snapshot, null);
});

test('Sub-S bank defaults to 29.6% tax rate', () => {
  const p = store.createProposal(tmp, {
    bankId: 'bank-s',
    isSubchapterS: true
  });
  assert.strictEqual(p.proposal.taxRate, 29.6);
});

test('addLeg appends sells and buys with sequential positions', () => {
  const p = store.createProposal(tmp, { bankId: 'bank-legs', isSubchapterS: false });
  const id = p.proposal.id;
  store.addLeg(tmp, id, {
    side: 'sell',
    cusip: '3130AMGY2',
    description: 'FHLB STEP UP',
    sector: 'Agency Callable',
    par: 1_000_000,
    bookPrice: 100,
    marketPrice: 98,
    bookYieldYtm: 1.25,
    marketYieldYtw: 3.93,
    maturity: '2030-07-15',
    sourceKind: 'holdings',
    sourceRef: 'bond-accounting/2026-04-30',
    sourceDate: '2026-04-30'
  });
  store.addLeg(tmp, id, {
    side: 'sell',
    cusip: '3130AMP48',
    par: 1_000_000,
    bookYieldYtm: 1.30,
    sourceKind: 'holdings'
  });
  store.addLeg(tmp, id, {
    side: 'buy',
    cusip: '3130B6WC6',
    par: 950_000,
    marketPrice: 100,
    marketYieldYtw: 5.957,
    sourceKind: 'daily-package',
    sourceRef: '_agencies.json'
  });
  const full = store.getProposal(tmp, id);
  assert.strictEqual(full.legs.length, 3);
  const sells = full.legs.filter(l => l.side === 'sell');
  const buys = full.legs.filter(l => l.side === 'buy');
  assert.strictEqual(sells.length, 2);
  assert.strictEqual(buys.length, 1);
  assert.deepStrictEqual(sells.map(l => l.position), [1, 2]);
  assert.deepStrictEqual(buys.map(l => l.position), [1]);
  assert.strictEqual(sells[0].cusip, '3130AMGY2');
  assert.strictEqual(sells[0].par, 1_000_000);
});

test('updateLeg edits fields; deleteLeg removes', () => {
  const p = store.createProposal(tmp, { bankId: 'bank-edit', isSubchapterS: false });
  const id = p.proposal.id;
  const after1 = store.addLeg(tmp, id, { side: 'buy', cusip: 'AAA', par: 500_000 });
  const legId = after1.legs[0].id;
  const after2 = store.updateLeg(tmp, id, legId, { par: 750_000, marketYieldYtw: 4.5 });
  assert.strictEqual(after2.legs[0].par, 750_000);
  assert.strictEqual(after2.legs[0].marketYieldYtw, 4.5);
  const after3 = store.deleteLeg(tmp, id, legId);
  assert.strictEqual(after3.legs.length, 0);
});

test('freezeProposal sets status=sent, writes snapshot, blocks further edits', () => {
  const p = store.createProposal(tmp, { bankId: 'bank-freeze', isSubchapterS: false });
  const id = p.proposal.id;
  store.addLeg(tmp, id, { side: 'sell', cusip: 'XXX' });
  const snapData = { sellsTotal: 100, buysTotal: 100, fakeSummary: true };
  const frozen = store.freezeProposal(tmp, id, snapData);
  assert.strictEqual(frozen.proposal.status, 'sent');
  assert.ok(frozen.proposal.sentAt);
  assert.deepStrictEqual(frozen.snapshot.data, snapData);

  // Editing after send must throw
  assert.throws(() => store.updateProposal(tmp, id, { title: 'should fail' }), /sent/);
  assert.throws(() => store.addLeg(tmp, id, { side: 'buy' }), /frozen/);
});

test('listProposals filters by bankId and status', () => {
  // Clean tmp dir for this test
  const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-list-'));
  store.createProposal(ld, { bankId: 'A', isSubchapterS: false });
  store.createProposal(ld, { bankId: 'A', isSubchapterS: false });
  store.createProposal(ld, { bankId: 'B', isSubchapterS: false });
  const a = store.listProposals(ld, { bankId: 'A' });
  const b = store.listProposals(ld, { bankId: 'B' });
  const all = store.listProposals(ld);
  assert.strictEqual(a.length, 2);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(all.length, 3);
  for (const p of all) assert.strictEqual(p.status, 'draft');
  fs.rmSync(ld, { recursive: true, force: true });
});

test('cancelProposal transitions status', () => {
  const p = store.createProposal(tmp, { bankId: 'bank-cancel', isSubchapterS: false });
  const after = store.cancelProposal(tmp, p.proposal.id);
  assert.strictEqual(after.proposal.status, 'cancelled');
  assert.ok(after.proposal.cancelledAt);
});

test('isLegUnfilled distinguishes empty stubs from real legs', () => {
  assert.strictEqual(store.isLegUnfilled({ cusip: '', par: null }), true);
  assert.strictEqual(store.isLegUnfilled({ cusip: '', par: 0 }), true);
  assert.strictEqual(store.isLegUnfilled({ cusip: '   ', par: '' }), true);
  assert.strictEqual(store.isLegUnfilled({ cusip: 'ABC123', par: null }), false, 'cusip alone counts as filled');
  assert.strictEqual(store.isLegUnfilled({ cusip: '', par: 100000 }), false, 'par alone counts as filled');
  assert.strictEqual(store.isLegUnfilled({ cusip: 'ABC', par: 1_000_000 }), false);
});

test('pruneUnfilledLegs removes only empty stubs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-prune-'));
  const created = store.createProposal(dir, { bankId: 'B', isSubchapterS: false });
  const id = created.proposal.id;
  // Three states the user explicitly called out:
  store.addLeg(dir, id, { side: 'sell', cusip: 'FULLY-FILLED', par: 1_000_000, bookYieldYtm: 3 });
  store.addLeg(dir, id, { side: 'buy', cusip: 'PARTIAL-DATA', par: 500_000 });   // partial: no yield, has CUSIP+par
  store.addLeg(dir, id, { side: 'buy' });                                          // pure stub
  store.addLeg(dir, id, { side: 'buy', cusip: '', par: null });                    // pure stub
  const beforeCount = store.getProposal(dir, id).legs.length;
  assert.strictEqual(beforeCount, 4);
  const removed = store.pruneUnfilledLegs(dir, id);
  assert.strictEqual(removed, 2, 'should drop both pure stubs, keep the partial');
  const after = store.getProposal(dir, id).legs;
  assert.strictEqual(after.length, 2);
  assert.deepStrictEqual(
    after.map(l => l.cusip).sort(),
    ['FULLY-FILLED', 'PARTIAL-DATA']
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`swap-store tests: ${passed} passed.`);
