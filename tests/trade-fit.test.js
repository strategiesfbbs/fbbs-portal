// Tests for server/trade-fit.js — the data-backed buyer-pattern nudge.
//
// The scorer half is pure and tested against a synthetic profile. The builder
// half is I/O (SQLite) and tested against tiny temp pershing + bank databases
// created with better-sqlite3, so audience segmentation (Subchapter-S split +
// non-bank → RIA) and the demand rollups are exercised end-to-end without the
// real 130K-row history.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tf = require('../server/trade-fit');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------- pure helpers ----------

test('coarseClassOf maps offering asset classes to profile classes', () => {
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'CD Offering' }), 'cd');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Muni' }), 'muni');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Treasury' }), 'govt');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Agency' }), 'govt');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Corporate' }), 'corp');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Structured Note' }), 'corp');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'MBS/CMO' }), 'mbs');
  assert.strictEqual(tf.coarseClassOf({ assetClass: 'Other' }), null);
});

test('stateFromIssuer parses the state out of muni issuer text', () => {
  assert.strictEqual(tf.stateFromIssuer('STATE OF, MINNESOTA'), 'MN');
  assert.strictEqual(tf.stateFromIssuer('STATE OF, NEW YORK'), 'NY');
  assert.strictEqual(tf.stateFromIssuer('CITY OF SOMEWHERE, MISSOURI'), 'MO');
  assert.strictEqual(tf.stateFromIssuer('NOT A STATE'), null);
});

const SYNTH_PROFILE = {
  generatedAt: 'x', asOf: '2026-06-20', totalBuys: 1000,
  audiences: {
    ccorp: { trades: 400, byClass: { cd: 0.5, muni: 0.3, govt: 0.2 }, byBucket: { '0-1y': 0.4, '1-3y': 0.3, '3-5y': 0.3 }, byState: { MO: 0.6, KS: 0.4 }, topIssuers: ['FEDERAL HOME LN'], topStates: ['MO', 'KS'] },
    scorp: { trades: 300, byClass: { muni: 0.6, cd: 0.2, govt: 0.2 }, byBucket: { '7-10y': 0.5, '3-5y': 0.5 }, byState: { MO: 1.0 }, topIssuers: [], topStates: ['MO'] },
    ria: { trades: 300, byClass: { corp: 0.5, cd: 0.4, muni: 0.1 }, byBucket: { '3-5y': 0.6, '5-7y': 0.4 }, byState: {}, topIssuers: ['CAPITAL ONE'], topStates: [] },
  },
};

test('scoreCandidate scores class + band demand, capped, with reasons', () => {
  const cd = { assetClass: 'CD Offering', description: 'BANK CD', state: '' };
  const ccorp = tf.scoreCandidate(cd, SYNTH_PROFILE, 'ccorp', '0-1y');
  assert.ok(ccorp && ccorp.score > 0);
  assert.ok(ccorp.reasons.some(s => /CD/i.test(s)));
  // C-corps buy CDs most (0.5) vs S-corps (0.2) → ccorp scores higher.
  const scorp = tf.scoreCandidate(cd, SYNTH_PROFILE, 'scorp', '0-1y');
  assert.ok(scorp && ccorp.score > scorp.score);
  // Score never exceeds the 25 cap.
  assert.ok(ccorp.score <= 25);
});

test('scoreCandidate adds in-state muni demand + issuer match; null when no signal', () => {
  const moMuni = { assetClass: 'Muni', description: 'MISSOURI ST', state: 'MO' };
  const s = tf.scoreCandidate(moMuni, SYNTH_PROFILE, 'scorp', '7-10y');
  assert.ok(s.reasons.some(r => /MO/.test(r)), 'in-state demand reason expected');

  const corp = { assetClass: 'Corporate', description: 'CAPITAL ONE NATL ASSN', state: '' };
  const r = tf.scoreCandidate(corp, SYNTH_PROFILE, 'ria', '3-5y');
  assert.ok(r.reasons.some(x => /issuer/i.test(x)), 'issuer-match reason expected');

  // A class the audience never bought → no score.
  const mbs = { assetClass: 'MBS/CMO', description: 'GNMA', state: '' };
  assert.strictEqual(tf.scoreCandidate(mbs, SYNTH_PROFILE, 'scorp', '3-5y'), null);
  // No profile → null.
  assert.strictEqual(tf.scoreCandidate(cdLike(), null, 'ccorp', '0-1y'), null);
});

function cdLike() { return { assetClass: 'CD Offering', description: 'X', state: '' }; }

test('tradeFitForCandidate only scores audiences the candidate is eligible for', () => {
  const cd = { assetClass: 'CD Offering', description: 'BANK CD', state: '', audiences: ['ccorp', 'scorp'] };
  const fit = tf.tradeFitForCandidate(cd, SYNTH_PROFILE, '0-1y');
  assert.ok(fit.ccorp && fit.scorp);
  assert.strictEqual(fit.ria, undefined, 'CD is bank-only — no RIA fit even if RIAs buy CDs');
});

// ---------- builder (SQLite I/O) ----------

function buildFixtureDbs(dir) {
  // bank-data.sqlite: bank 100 = C-corp (No), bank 200 = S-corp (Yes).
  const bdb = new Database(path.join(dir, tf.BANK_DB));
  bdb.exec('CREATE TABLE banks (id TEXT, detail_json TEXT);');
  const mkDetail = sub => JSON.stringify({ periods: [{ period: '2025Y', values: { subchapterS: sub } }] });
  const insB = bdb.prepare('INSERT INTO banks (id, detail_json) VALUES (?, ?)');
  insB.run('100', mkDetail('No'));
  insB.run('200', mkDetail('Yes'));
  bdb.close();

  // pershing-accounts.sqlite: customer BUY rows for each audience.
  const pdb = new Database(path.join(dir, tf.PERSHING_DB));
  pdb.exec('CREATE TABLE pershing_trades (bank_id TEXT, side TEXT, cusip TEXT, security_type TEXT, issuer TEXT, maturity_date TEXT, trade_date TEXT);');
  const ins = pdb.prepare('INSERT INTO pershing_trades (bank_id, side, cusip, security_type, issuer, maturity_date, trade_date) VALUES (?,?,?,?,?,?,?)');
  // C-corp bank (100): mostly CDs, short.
  for (let i = 0; i < 8; i++) ins.run('100', 'BUY', 'CD' + i, 'MONEYMKT', 'SOME BANK', '2026-12-01', '2026-06-01');
  ins.run('100', 'BUY', 'M1', 'MUNIDEBT', 'STATE OF, MISSOURI', '2030-06-01', '2026-06-01');
  // S-corp bank (200): mostly munis, MO, longer.
  for (let i = 0; i < 6; i++) ins.run('200', 'BUY', 'MU' + i, 'MUNIDEBT', 'STATE OF, MISSOURI', '2035-06-01', '2026-06-01');
  ins.run('200', 'BUY', 'G1', 'GOVTSEC', 'UNITED STATES TREAS', '2031-06-01', '2026-06-01');
  // Non-bank accounts → RIA: corporates.
  for (let i = 0; i < 7; i++) ins.run('', 'BUY', 'C' + i, 'CORPDEBT', 'CAPITAL ONE NATL ASSN', '2031-06-01', '2026-06-01');
  // A SELL row and an EQUITY row that must be ignored.
  ins.run('100', 'SELL', 'X1', 'MONEYMKT', 'SOME BANK', '2026-12-01', '2026-06-01');
  ins.run('', 'BUY', 'E1', 'EQUITY', 'ACME', '', '2026-06-01');
  pdb.close();
}

test('buildTradeFitProfile segments by Subchapter-S + non-bank and rolls demand', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tf-'));
  buildFixtureDbs(dir);
  const p = tf.buildTradeFitProfile({ bankReportsDir: dir });
  assert.ok(p, 'profile built');

  // C-corp (bank 100): CD-dominant.
  assert.ok(p.audiences.ccorp.byClass.cd > p.audiences.ccorp.byClass.muni);
  // S-corp (bank 200): muni-dominant + MO in-state demand.
  assert.ok(p.audiences.scorp.byClass.muni >= 0.7);
  assert.ok(p.audiences.scorp.byState.MO > 0);
  // RIA (non-bank): corporate-dominant.
  assert.ok(p.audiences.ria.byClass.corp >= 0.9);
  assert.ok((p.audiences.ria.topIssuers || []).some(s => /CAPITAL ONE/.test(s)));

  // SELL + EQUITY rows excluded → totals are the BUY fixed-income rows only.
  assert.strictEqual(p.totalBuys, 8 + 1 + 6 + 1 + 7); // 23
  // Shares per audience sum to ~1.
  for (const k of ['ccorp', 'scorp', 'ria']) {
    const sum = Object.values(p.audiences[k].byClass).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${k} class shares sum to 1`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildTradeFitProfile returns null (never throws) when the trade DB is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-tf-empty-'));
  assert.strictEqual(tf.buildTradeFitProfile({ bankReportsDir: dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`trade-fit tests: ${passed} passed.`);
})();
