// Tests for server/fdic-bankfind.js — FDIC BankFind live check.
// Fixture-driven, no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fdic = require('../server/fdic-bankfind');

const FIXTURE = {
  meta: { total: 169 },
  data: [
    { data: { CERT: 2738, REPDTE: '20260331', ASSET: 679539, DEP: 591506, EQ: 76420, LNLSNET: 473019, SC: 157171, ROA: 1.474504829, ROE: 13.09, NIMY: 4.175463471 }, score: 0 },
    { data: { CERT: 2738, REPDTE: '20251231', ASSET: 676306, DEP: 577584, EQ: 76355, LNLSNET: 473967, SC: 146398, ROA: 1.362729794, ROE: 12.23, NIMY: 4.106332986 }, score: 0 }
  ],
  totals: { count: 169 }
};

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok: ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL: ${label}\n    ${err.message}`);
  }
}

console.log('fdic-bankfind.test.js');

check('repdteToPeriod maps quarter ends', () => {
  assert.strictEqual(fdic.repdteToPeriod('20260331'), '2026Q1');
  assert.strictEqual(fdic.repdteToPeriod('20251231'), '2025Q4');
  assert.strictEqual(fdic.repdteToPeriod('20250630'), '2025Q2');
  assert.strictEqual(fdic.repdteToPeriod('junk'), '');
  assert.strictEqual(fdic.repdteToPeriod(null), '');
});

check('parseFinancialsResponse maps and rounds the headline fields', () => {
  const rows = fdic.parseFinancialsResponse(FIXTURE);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].period, '2026Q1');
  assert.strictEqual(rows[0].totalAssets, 679539);
  assert.strictEqual(rows[0].roa, 1.47);
  assert.strictEqual(rows[0].nim, 4.18);
  assert.strictEqual(rows[1].period, '2025Q4');
});

check('parseFinancialsResponse tolerates junk', () => {
  assert.deepStrictEqual(fdic.parseFinancialsResponse(null), []);
  assert.deepStrictEqual(fdic.parseFinancialsResponse({ data: 'nope' }), []);
  assert.deepStrictEqual(fdic.parseFinancialsResponse({ data: [{ data: { REPDTE: 'bad' } }] }), []);
});

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-fdic-'));
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => FIXTURE }; };

  const snap = await fdic.getFdicSnapshot(2738, { cacheDir: tmpDir, fetchImpl, now: Date.parse('2026-06-11T12:00:00Z') });
  check('getFdicSnapshot fetches latest + previous', () => {
    assert.strictEqual(snap.latest.period, '2026Q1');
    assert.strictEqual(snap.previous.period, '2025Q4');
    assert.strictEqual(snap.stale, false);
    assert.strictEqual(calls, 1);
  });

  const cached = await fdic.getFdicSnapshot(2738, { cacheDir: tmpDir, fetchImpl, now: Date.parse('2026-06-11T15:00:00Z') });
  check('fresh cache served without refetch', () => {
    assert.strictEqual(cached.latest.period, '2026Q1');
    assert.strictEqual(calls, 1);
  });

  const failing = async () => { throw new Error('offline'); };
  const stale = await fdic.getFdicSnapshot(2738, { cacheDir: tmpDir, fetchImpl: failing, now: Date.parse('2026-06-13T12:00:00Z') });
  check('expired cache served stale on fetch failure', () => {
    assert.strictEqual(stale.latest.period, '2026Q1');
    assert.strictEqual(stale.stale, true);
  });

  const emptyFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  const none = await fdic.getFdicSnapshot(99999, { cacheDir: tmpDir, fetchImpl: emptyFetch, now: Date.parse('2026-06-11T12:00:00Z') });
  check('unknown cert returns null and caches the empty answer', () => {
    assert.strictEqual(none, null);
    assert.ok(fs.existsSync(path.join(tmpDir, 'cert-99999.json')));
  });

  check('blank cert returns null without touching the network', async () => {
    assert.strictEqual(await fdic.getFdicSnapshot('', { cacheDir: tmpDir, fetchImpl: failing }), null);
  });

  if (failures) {
    console.error(`fdic-bankfind.test.js: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('fdic-bankfind.test.js: all passed');
})();
