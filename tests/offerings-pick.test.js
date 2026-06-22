// Tests for server/offerings-pick.js — candidate building, JSON parsing,
// CUSIP grounding (drop hallucinated/unseen CUSIPs, re-attach our numbers),
// and date-keyed caching. Injects a fake createMessage; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const op = require('../server/offerings-pick');

// A small cross-asset inventory in the All Offerings normalized row shape.
const ROWS = [
  { assetClass: 'Municipal', type: 'muni', page: 'muni-offerings', cusip: '13063DST7', description: 'CA State GO 5s 2034', coupon: 5.0, yield: 4.62, price: 102.1, maturity: '2034-08-01', state: 'CA', sector: 'GO' },
  { assetClass: 'Municipal', type: 'muni', page: 'muni-offerings', cusip: '64971WJ40', description: 'NYC TFA 4s 2031', coupon: 4.0, yield: 4.20, price: 99.0, maturity: '2031-05-01', state: 'NY', sector: 'Revenue' },
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130AXYZ1', description: 'FHLB 4.5 2029', coupon: 4.5, yield: 4.75, price: 100.0, maturity: '2029-03-15', state: '', sector: 'Callable' },
  // Callable rows carry both YTM and YTNC; pick logic should use yield-to-worst.
  { assetClass: 'Agency', type: 'agency', page: 'agencies', cusip: '3130CALL1', description: 'FHLB callable 2030', coupon: 5.0, yield: 5.25, ytm: 5.25, ytnc: 4.10, price: 101.0, maturity: '2030-03-15', state: '', sector: 'Callable' },
  { assetClass: 'Corporate', type: 'corporate', page: 'corporates', cusip: '037833EK1', description: 'AAPL 4.65 2033', coupon: 4.65, yield: 4.90, price: 98.5, maturity: '2033-02-23', state: '', sector: 'IG' },
  { assetClass: 'Treasury', type: 'treasury', page: 'treasury-explorer', cusip: '91282CKK7', description: 'UST 4.25 2030', coupon: 4.25, yield: 4.40, price: 99.3, maturity: '2030-11-15', state: '', sector: 'Note' },
  // No yield → must be excluded from candidates.
  { assetClass: 'Municipal', type: 'muni', page: 'muni-offerings', cusip: '999999ZZ9', description: 'No yield muni', coupon: 3.0, yield: null, price: 100, maturity: '2030-01-01', state: 'TX', sector: 'GO' },
];

const META = { date: '2026-06-18' };

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-picks-')); }

test('buildCandidateSet keeps only rows with a CUSIP and a yield', () => {
  const { candidates, byCusip } = op.buildCandidateSet(ROWS);
  assert.strictEqual(candidates.length, 6); // the null-yield muni is dropped
  assert.ok(!byCusip.has('999999ZZ9'));
  assert.ok(byCusip.has('037833EK1'));
  // sorted highest-yield first across classes
  assert.strictEqual(candidates[0].cusip, '037833EK1'); // 4.90 corp
  assert.strictEqual(candidates[0].yield, 4.90);
  const callable = candidates.find(c => c.cusip === '3130CALL1');
  assert.strictEqual(callable.yield, 4.10);
});

test('buildPicksPrompt carries the system prompt, the date, and the candidates', () => {
  const { candidates } = op.buildCandidateSet(ROWS);
  const { system, messages } = op.buildPicksPrompt(candidates, META);
  assert.ok(/FBBS|First Bankers/.test(system));
  assert.strictEqual(messages.length, 1);
  assert.ok(messages[0].content.includes('2026-06-18'));
  assert.ok(messages[0].content.includes('"cusip"'));
  assert.ok(messages[0].content.includes('STRICT JSON'));
});

test('parsePicks tolerates a code fence and stray prose', () => {
  const a = op.parsePicks('```json\n{"picks":[{"cusip":"037833EK1","headline":"h","rationale":"r"}]}\n```');
  assert.strictEqual(a.length, 1);
  const b = op.parsePicks('Here you go:\n{"picks":[{"cusip":"X"}]}\nThanks');
  assert.strictEqual(b.length, 1);
  assert.deepStrictEqual(op.parsePicks('not json'), []);
});

test('groundPicks drops unseen CUSIPs and re-attaches OUR numbers', () => {
  const { byCusip } = op.buildCandidateSet(ROWS);
  const raw = [
    { cusip: '037833EK1', headline: 'Apple value', rationale: 'High IG yield.' },
    // model invented a yield — it must be ignored; we use the row's 4.62
    { cusip: '13063DST7', headline: 'CA GO', rationale: 'In-state muni.', yield: 9.99 },
    { cusip: 'HALLUCIN8', headline: 'Made up', rationale: 'Not in inventory.' },
  ];
  const grounded = op.groundPicks(raw, byCusip);
  assert.strictEqual(grounded.length, 2); // hallucinated CUSIP dropped
  const apple = grounded.find(p => p.cusip === '037833EK1');
  assert.strictEqual(apple.yield, 4.90);
  assert.strictEqual(apple.page, 'corporates');
  assert.strictEqual(apple.type, 'corporate');
  const ca = grounded.find(p => p.cusip === '13063DST7');
  assert.strictEqual(ca.yield, 4.62); // OUR number, not the model's 9.99
  assert.strictEqual(ca.state, 'CA');
});

test('groundPicks dedupes a repeated CUSIP', () => {
  const { byCusip } = op.buildCandidateSet(ROWS);
  const grounded = op.groundPicks(
    [{ cusip: '91282CKK7' }, { cusip: '91282CKK7' }], byCusip);
  assert.strictEqual(grounded.length, 1);
});

test('generatePicks calls the model, grounds, writes cache, returns picks', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async (opts) => {
    calls++;
    assert.strictEqual(opts.effort, 'medium');
    return {
      text: '{"picks":[{"cusip":"037833EK1","headline":"Apple","rationale":"IG value."},{"cusip":"3130AXYZ1","headline":"FHLB","rationale":"Agency spread."}]}',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 9 },
    };
  };
  const out = await op.generatePicks({ marketDir: dir, rows: ROWS, meta: META, createMessageImpl, now: 0 });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.cached, false);
  assert.strictEqual(out.picks.length, 2);
  assert.strictEqual(out.packageDate, '2026-06-18');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, op.CACHE_FILENAME), 'utf-8'));
  assert.strictEqual(onDisk.picks.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generatePicks serves the cache for the same package date (no API call)', async () => {
  const dir = tmpDir();
  let calls = 0;
  const createMessageImpl = async () => {
    calls++;
    return { text: '{"picks":[{"cusip":"037833EK1","headline":"h","rationale":"r"}]}', model: 'm' };
  };
  await op.generatePicks({ marketDir: dir, rows: ROWS, meta: META, createMessageImpl });
  const again = await op.generatePicks({ marketDir: dir, rows: ROWS, meta: META, createMessageImpl });
  assert.strictEqual(calls, 1);
  assert.strictEqual(again.cached, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generatePicks throws when the model returns no usable CUSIP', async () => {
  const dir = tmpDir();
  const createMessageImpl = async () => ({ text: '{"picks":[{"cusip":"NOPE0000"}]}', model: 'm' });
  await assert.rejects(
    () => op.generatePicks({ marketDir: dir, rows: ROWS, meta: META, createMessageImpl, force: true }),
    /no pick that matched/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generatePicks throws when there are no candidates', async () => {
  const dir = tmpDir();
  const createMessageImpl = async () => ({ text: '{"picks":[]}', model: 'm' });
  await assert.rejects(
    () => op.generatePicks({ marketDir: dir, rows: [], meta: META, createMessageImpl }),
    /usable yield/);
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`offerings-pick tests: ${passed} passed.`);
})();
