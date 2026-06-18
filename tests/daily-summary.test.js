// Tests for server/daily-summary.js — prompt building + date-keyed caching.
// Injects a fake createMessage; no network. Uses a temp marketDir.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ds = require('../server/daily-summary');

const ECON = {
  asOfDate: '2026-06-12',
  treasuries: [
    { tenor: '2YR', label: '2Y', yield: 4.08, dailyChange: -0.01 },
    { tenor: '10YR', label: '10Y', yield: 4.48, dailyChange: 0.02, weeklyChange: 0.05 },
  ],
  marketRates: [{ label: 'SOFR', value: 3.6, priorClose: 3.6, change: 0, isPercent: true }],
  marketData: [{ label: 'DJIA', value: null, priorClose: 50848.75, change: 929.97 }],
  bondIndices: [{ label: 'IG Spread', change: 50.9 }],
  headlines: ['Stocks rallied as oil fell', 'Fed minutes due'],
  releases: [{ event: 'Housing Starts', dateTime: '06/16/26 7:30 AM' }],
  salesCues: [{ title: 'Curve positively sloped', body: '2s/10s at 0.40%' }],
  warnings: ['some warning'],
};

const META = {
  date: '2026-06-12',
  offeringsCount: 248,
  muniOfferingsCount: 93,
  treasuryNotesCount: 223,
  agencyCount: 448,
  corporatesCount: 200,
  brokeredCdTerms: [{ label: '3 mo', months: 3, low: 4, mid: 4.05, high: 4.1 }],
};

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-daily-summary-'));
}

test('buildSummaryInput compacts the package into grounded fields', () => {
  const input = ds.buildSummaryInput(ECON, META);
  assert.strictEqual(input.packageDate, '2026-06-12');
  assert.strictEqual(input.treasuries.length, 2);
  assert.strictEqual(input.treasuries[1].yield, 4.48);
  assert.strictEqual(input.offerings.total, 248);
  assert.strictEqual(input.offerings.muni, 93);
  assert.deepStrictEqual(input.brokeredCdTerms, [{ label: '3 mo', mid: 4.05 }]);
  // warnings are not part of the prompt input
  assert.strictEqual(input.warnings, undefined);
});

test('buildSummaryInput is null-safe', () => {
  const input = ds.buildSummaryInput(null, null);
  assert.strictEqual(input.packageDate, null);
  assert.deepStrictEqual(input.treasuries, []);
  assert.strictEqual(input.offerings.total, null);
});

test('buildSummaryPrompt carries the system prompt and the data', () => {
  const { system, messages } = ds.buildSummaryPrompt(ds.buildSummaryInput(ECON, META));
  assert.ok(/FBBS|First Bankers/.test(system));
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'user');
  assert.ok(messages[0].content.includes('2026-06-12'));
  assert.ok(messages[0].content.includes('"offerings"'));
});

test('generateSummary calls the model, writes the cache, returns the text', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async (opts) => {
    calls++;
    assert.strictEqual(opts.maxTokens, 1200);
    assert.strictEqual(opts.effort, 'medium');
    return { text: '## Market tone\nUp.', model: 'claude-opus-4-8', usage: { input_tokens: 5 } };
  };
  const out = await ds.generateSummary({ marketDir: dir, econ: ECON, meta: META, createMessageImpl, now: 0 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.cached, false);
  assert.strictEqual(out.packageDate, '2026-06-12');
  assert.ok(out.summary.includes('Market tone'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, ds.CACHE_FILENAME), 'utf-8'));
  assert.strictEqual(onDisk.packageDate, '2026-06-12');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateSummary serves the cache for the same package date (no API call)', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async () => { calls++; return { text: 'x', model: 'm' }; };
  await ds.generateSummary({ marketDir: dir, econ: ECON, meta: META, createMessageImpl });
  const again = await ds.generateSummary({ marketDir: dir, econ: ECON, meta: META, createMessageImpl });
  assert.strictEqual(calls, 1);
  assert.strictEqual(again.cached, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateSummary regenerates for a new package date, and on force', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async () => { calls++; return { text: 'x' + calls, model: 'm' }; };
  await ds.generateSummary({ marketDir: dir, econ: ECON, meta: META, createMessageImpl });
  await ds.generateSummary({ marketDir: dir, econ: ECON, meta: { ...META, date: '2026-06-13' }, createMessageImpl });
  assert.strictEqual(calls, 2); // new date busts the cache
  await ds.generateSummary({ marketDir: dir, econ: ECON, meta: { ...META, date: '2026-06-13' }, force: true, createMessageImpl });
  assert.strictEqual(calls, 3); // force regenerates
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getCachedSummary returns null when absent', () => {
  const dir = tmpDir();
  assert.strictEqual(ds.getCachedSummary(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`daily-summary tests: ${passed} passed.`);
})();
