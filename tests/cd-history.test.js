'use strict';

// Regression tests for the pure logic in server/cd-history.js — the
// week-over-week comparison engine behind the Weekly CD Recap. The
// snapshot save/load (fs) is out of scope; this covers the aggregation,
// dedup, term normalization, and date math the recap is built from.

const assert = require('assert');
const h = require('../server/cd-history');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ---------- median / delta ----------

test('median handles odd, even, empty, and non-finite filtering', () => {
  assert.strictEqual(h.median([3, 1, 2]), 2);
  assert.strictEqual(h.median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(h.median([5]), 5);
  assert.strictEqual(h.median([]), null);
  assert.strictEqual(h.median([1, NaN, 3]), 2); // NaN dropped → median of [1,3]
});

test('delta subtracts only when both sides are finite', () => {
  assert.strictEqual(h.delta(5, 3), 2);
  assert.strictEqual(h.delta(3, 5), -2);
  assert.strictEqual(h.delta(5, NaN), null);
  assert.strictEqual(h.delta(undefined, 3), null);
});

// ---------- normalizeTerm ----------

test('normalizeTerm canonicalizes month codes to year keys', () => {
  assert.strictEqual(h.normalizeTerm('36m'), '3y');
  assert.strictEqual(h.normalizeTerm('48M'), '4y');
  assert.strictEqual(h.normalizeTerm('60m'), '5y');
  assert.strictEqual(h.normalizeTerm('12m'), '12m'); // passthrough
  assert.strictEqual(h.normalizeTerm('', 36), '3y'); // from termMonths
  assert.strictEqual(h.normalizeTerm('', 18), '18m');
  assert.strictEqual(h.normalizeTerm('', 'x'), ''); // non-numeric months → empty
});

// ---------- uniqueByCusip ----------

test('uniqueByCusip dedups case-insensitively, keeping the earliest first-seen', () => {
  const rows = h.uniqueByCusip([
    { cusip: 'A1', firstSeenDate: '2026-05-01', rate: 4.0 },
    { cusip: 'a1', firstSeenDate: '2026-04-01', rate: 4.2 }, // earlier → wins
    { cusip: '', rate: 9 } // no cusip → skipped
  ]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].firstSeenDate, '2026-04-01');
});

// ---------- findSnapshotOnOrBefore ----------

test('findSnapshotOnOrBefore returns the latest snapshot at or before the target', () => {
  const snaps = [
    { effectiveDate: '2026-05-01', id: 'a' },
    { effectiveDate: '2026-05-08', id: 'b' },
    { effectiveDate: '2026-05-15', id: 'c' }
  ];
  assert.strictEqual(h.findSnapshotOnOrBefore(snaps, '2026-05-10').id, 'b');
  assert.strictEqual(h.findSnapshotOnOrBefore(snaps, '2026-05-15').id, 'c'); // inclusive
  assert.strictEqual(h.findSnapshotOnOrBefore(snaps, '2026-04-30'), null);   // before all
  assert.strictEqual(h.findSnapshotOnOrBefore(snaps, null), null);
});

// ---------- medianRatesByTerm ----------

test('medianRatesByTerm medians distinct-CUSIP rates per recap term', () => {
  const termKey = h.RECAP_TERMS[0].key;
  const out = h.medianRatesByTerm([
    { cusip: 'X1', term: termKey, rate: 1 },
    { cusip: 'X2', term: termKey, rate: 2 },
    { cusip: 'X3', term: termKey, rate: 3 }
  ]);
  assert.strictEqual(out[termKey], 2);
});

// ---------- date math: parseYmd / toYmd / shiftYmd / weekBounds ----------

test('parseYmd / toYmd round-trip and reject bad input', () => {
  assert.strictEqual(h.toYmd(h.parseYmd('2026-05-29')), '2026-05-29');
  assert.strictEqual(h.parseYmd('nope'), null);
  assert.strictEqual(h.parseYmd('2026-5-9'), null); // strict zero-padded format
});

test('shiftYmd shifts by days/months/years', () => {
  assert.strictEqual(h.shiftYmd('2026-05-29', { days: -7 }), '2026-05-22');
  assert.strictEqual(h.shiftYmd('2026-05-29', { months: 1 }), '2026-06-29');
  assert.strictEqual(h.shiftYmd('2026-05-29', { years: -1 }), '2025-05-29');
  assert.strictEqual(h.shiftYmd('bad', { days: 1 }), null);
});

test('weekBounds returns the Mon–Fri business week containing the date', () => {
  // 2026-05-29 is a Friday → week is 2026-05-25 (Mon) .. 2026-05-29 (Fri)
  assert.deepStrictEqual(h.weekBounds('2026-05-29'), { start: '2026-05-25', end: '2026-05-29' });
  // 2026-05-31 is a Sunday → maps back to that same Mon–Fri week
  assert.deepStrictEqual(h.weekBounds('2026-05-31'), { start: '2026-05-25', end: '2026-05-29' });
});

console.log(`cd-history tests: ${passed} passed.`);
