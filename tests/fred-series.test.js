// Tests for server/fred-series.js — FRED rate benchmarks (key-gated).
// Pure parse + cache behavior with an injected fetch; no network, no real key.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fredSeries = require('../server/fred-series');

function observations(rows) {
  return { observations: rows };
}

const FIXTURES = {
  SOFR: observations([
    { date: '2026-06-10', value: '4.31' },
    { date: '2026-06-09', value: '4.30' },
  ]),
  DFF: observations([
    { date: '2026-06-10', value: '.' }, // holiday hole — must fall through
    { date: '2026-06-09', value: '4.33' },
  ]),
  T10YIE: observations([
    { date: '2026-06-10', value: '2.41' },
  ]),
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fred-series-test-'));
}

function fetchFor(map) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const hit = Object.entries(map).find(([k]) => url.includes(`series_id=${k}&`));
    if (!hit) throw new Error('unexpected url ' + url);
    const value = typeof hit[1] === 'function' ? hit[1]() : hit[1];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value };
  };
  impl.calls = calls;
  return impl;
}

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok: ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL: ${label}\n    ${err.message}`);
  }
}

async function main() {
  console.log('fred-series.test.js');

  await check('parseFredObservations skips "." holes and tolerates junk', () => {
    assert.deepStrictEqual(fredSeries.parseFredObservations(FIXTURES.DFF), { value: 4.33, date: '2026-06-09' });
    assert.deepStrictEqual(fredSeries.parseFredObservations(FIXTURES.SOFR), { value: 4.31, date: '2026-06-10' });
    assert.strictEqual(fredSeries.parseFredObservations(null), null);
    assert.strictEqual(fredSeries.parseFredObservations(observations([{ date: 'x', value: '.' }])), null);
  });

  await check('no API key → null, and the network is never touched', async () => {
    const impl = fetchFor(FIXTURES);
    const out = await fredSeries.getFredIndicators({ marketDir: tmpDir(), apiKey: '', fetchImpl: impl });
    assert.strictEqual(out, null);
    assert.strictEqual(impl.calls.length, 0);
  });

  await check('fetches all series, caches, serves from cache within TTL', async () => {
    const dir = tmpDir();
    const impl = fetchFor(FIXTURES);
    const out = await fredSeries.getFredIndicators({ marketDir: dir, apiKey: 'test-key', fetchImpl: impl, now: Date.parse('2026-06-11T12:00:00Z') });
    assert.strictEqual(out.stale, false);
    assert.strictEqual(out.sofr.value, 4.31);
    assert.strictEqual(out.fedFunds.value, 4.33);
    assert.strictEqual(out.breakeven10Y.value, 2.41);
    assert.strictEqual(out.sofr.label, 'SOFR');

    const callsBefore = impl.calls.length;
    await fredSeries.getFredIndicators({ marketDir: dir, apiKey: 'test-key', fetchImpl: impl, now: Date.parse('2026-06-11T14:00:00Z') });
    assert.strictEqual(impl.calls.length, callsBefore, 'served from cache within TTL');
  });

  await check('a failing series keeps its cached value; total failure serves stale', async () => {
    const dir = tmpDir();
    await fredSeries.getFredIndicators({ marketDir: dir, apiKey: 'k', fetchImpl: fetchFor(FIXTURES), now: Date.parse('2026-06-11T00:00:00Z') });

    const flaky = fetchFor({
      SOFR: observations([{ date: '2026-06-11', value: '4.35' }]),
      DFF: () => new Error('connection refused'),
      T10YIE: FIXTURES.T10YIE,
    });
    const out = await fredSeries.getFredIndicators({ marketDir: dir, apiKey: 'k', fetchImpl: flaky, now: Date.parse('2026-06-11T08:00:00Z') });
    assert.strictEqual(out.stale, false);
    assert.strictEqual(out.sofr.value, 4.35, 'fresh SOFR');
    assert.strictEqual(out.fedFunds.value, 4.33, 'DFF outage keeps the cached print');

    const dead = fetchFor({});
    const staleOut = await fredSeries.getFredIndicators({ marketDir: dir, apiKey: 'k', fetchImpl: dead, now: Date.parse('2026-06-11T20:00:01Z') });
    assert.strictEqual(staleOut.stale, true);
    assert.strictEqual(staleOut.sofr.value, 4.35);

    const none = await fredSeries.getFredIndicators({ marketDir: tmpDir(), apiKey: 'k', fetchImpl: dead, now: Date.parse('2026-06-11T20:00:01Z') });
    assert.strictEqual(none, null);
  });

  if (failures) {
    console.error(`fred-series tests: ${failures} failed`);
    process.exit(1);
  }
  console.log('fred-series tests: all passed');
}

main().catch(err => {
  console.error('fred-series.test.js crashed:', err);
  process.exit(1);
});
