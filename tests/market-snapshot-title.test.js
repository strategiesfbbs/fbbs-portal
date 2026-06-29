// Tests for server/market-snapshot-title.js — prompt, sanitization and cache.
// Injects a fake createMessage; no network. Uses a temp marketDir.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const title = require('../server/market-snapshot-title');
const { buildMarketSnapshot } = require('../server/market-snapshot');

const ECON = {
  asOfDate: '2026-06-12',
  treasuries: [
    { tenor: '2YR', label: '2Y', yield: 4.08, dailyChange: -0.01 },
    { tenor: '10YR', label: '10Y', yield: 4.48, dailyChange: 0.04, weeklyChange: 0.05 },
  ],
  marketRates: [{ label: 'SOFR', value: 3.6, priorClose: 3.6, change: 0 }],
  marketData: [
    { label: 'S&P 500', value: 6080.1, priorClose: 6031.4, change: 48.7 },
    { label: 'VIX', value: 17.2, priorClose: 18.5, change: -1.3 },
  ],
  bondIndices: [{ label: 'IG Spread', value: 92, priorClose: 94, change: -2 }],
  headlines: ['Treasury yields rise as market weighs Fed path'],
  releases: [{ event: 'Housing Starts', dateTime: '06/16/26 7:30 AM' }],
  salesCues: [{ title: 'Extension conversations', body: 'Long rates moved higher.' }],
};

const META = {
  date: '2026-06-12',
  offeringsCount: 248,
  muniOfferingsCount: 93,
  treasuryNotesCount: 223,
  agencyCount: 448,
  corporatesCount: 200,
};

const SNAPSHOT = buildMarketSnapshot(ECON, {
  rates: { asOfDate: '2026-06-12', tenYear: 4.52, twoYear: 4.07, spread2s10sBp: 45 },
  fred: { sofr: { value: 3.61 } },
});

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-market-title-'));
}

test('buildTitleInput compacts market drivers and package counts', () => {
  const input = title.buildTitleInput(ECON, META, SNAPSHOT);
  assert.strictEqual(input.packageDate, '2026-06-12');
  assert.ok(input.snapshotMetrics.some(m => m.label === '10Y Treasury' && m.liveDeltaBp === 4));
  assert.strictEqual(input.treasuryChanges.length, 2);
  assert.strictEqual(input.offerings.total, 248);
  assert.deepStrictEqual(input.headlines, ['Treasury yields rise as market weighs Fed path']);
});

test('buildTitlePrompt asks for a concise grounded title', () => {
  const { system, messages } = title.buildTitlePrompt(title.buildTitleInput(ECON, META, SNAPSHOT));
  assert.ok(/FBBS|First Bankers/.test(system));
  assert.ok(/sets the tone/.test(system));
  assert.strictEqual(messages.length, 1);
  assert.ok(messages[0].content.includes('"snapshotMetrics"'));
  assert.ok(messages[0].content.includes('3 to 7 words'));
});

test('sanitizeTitle trims markdown, punctuation, and the retired wording', () => {
  assert.strictEqual(title.sanitizeTitle(' **Long Rates Lead Higher.** '), 'Long Rates Lead Higher');
  assert.strictEqual(title.sanitizeTitle('10Y Treasury sets the tone'), '');
});

test('generateTitle writes the cache and returns structured tool output', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async (opts) => {
    calls++;
    assert.strictEqual(opts.maxTokens, 180);
    assert.strictEqual(opts.effort, 'low');
    assert.strictEqual(opts.toolChoice.name, 'emit_market_snapshot_title');
    return {
      toolInput: { title: 'Long Rates Lead Higher', reason: '10Y moved up and live delta is positive.' },
      model: 'claude-opus-4-8',
      usage: { input_tokens: 5 },
    };
  };
  const out = await title.generateTitle({ marketDir: dir, econ: ECON, meta: META, snapshot: SNAPSHOT, createMessageImpl, now: 0 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.cached, false);
  assert.strictEqual(out.packageDate, '2026-06-12');
  assert.strictEqual(out.title, 'Long Rates Lead Higher');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, title.CACHE_FILENAME), 'utf-8'));
  assert.strictEqual(onDisk.title, 'Long Rates Lead Higher');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generateTitle serves the cache for the same package date', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async () => {
    calls++;
    return { toolInput: { title: 'Risk Tone Improves' }, model: 'm' };
  };
  await title.generateTitle({ marketDir: dir, econ: ECON, meta: META, snapshot: SNAPSHOT, createMessageImpl });
  const again = await title.generateTitle({ marketDir: dir, econ: ECON, meta: META, snapshot: SNAPSHOT, createMessageImpl });
  assert.strictEqual(calls, 1);
  assert.strictEqual(again.cached, true);
  assert.strictEqual(again.title, 'Risk Tone Improves');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fallbackTitle uses deterministic market movement when model title is unusable', () => {
  const input = title.buildTitleInput(ECON, META, SNAPSHOT);
  assert.strictEqual(title.fallbackTitle(input), 'Long Rates Lead Higher');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`market-snapshot-title tests: ${passed} passed.`);
})();
