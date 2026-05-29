'use strict';

// Regression tests for the pure parsing helpers in server/wirp-store.js — the
// number/date coercion and header-detection that drive WIRP forward-rate
// workbook parsing. The workbook/fs path is out of scope here.

const assert = require('assert');
const w = require('../server/wirp-store');
const XLSX = require('../server/xlsx');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ---------- parseNumber ----------

test('parseNumber coerces numeric-ish strings, rejects n/a and blanks', () => {
  assert.strictEqual(w.parseNumber('1,250.5'), 1250.5);
  assert.strictEqual(w.parseNumber('4.85%'), 4.85);
  assert.strictEqual(w.parseNumber('-25 bps'), -25);
  assert.strictEqual(w.parseNumber(42), 42);
  assert.strictEqual(w.parseNumber('n/a'), null);
  assert.strictEqual(w.parseNumber('na'), null);
  assert.strictEqual(w.parseNumber(''), null);
  assert.strictEqual(w.parseNumber('—'), null); // no digits
});

// ---------- excelDateToIso ----------

test('excelDateToIso handles Date objects and US / ISO text', () => {
  assert.strictEqual(w.excelDateToIso(new Date(Date.UTC(2026, 4, 29))), '2026-05-29');
  assert.strictEqual(w.excelDateToIso('5/29/2026'), '2026-05-29');
  assert.strictEqual(w.excelDateToIso('2026-05-29'), '2026-05-29');
  assert.strictEqual(w.excelDateToIso('garbage'), null);
});

test('excelDateToIso converts an in-range Excel serial via the SSF date codec', () => {
  const serial = 46176; // within the (30000, 80000) window the impl accepts
  const p = XLSX.SSF.parse_date_code(serial);
  const expected = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  assert.strictEqual(w.excelDateToIso(serial), expected);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(expected), `sanity: ${expected}`);
  assert.strictEqual(w.excelDateToIso(5), null);      // below window
  assert.strictEqual(w.excelDateToIso(999999), null); // above window
});

// ---------- header detection ----------

test('findHeaderRow scores the row with meeting/rate/probability terms', () => {
  const rows = [
    ['WIRP snapshot', '', ''],
    ['Meeting Date', 'Implied Rate', '% Hike/Cut'],
    ['2026-06-17', 5.31, '62%']
  ];
  assert.strictEqual(w.findHeaderRow(rows), 1);
});

test('keyForHeader / preferredKeyForHeader resolve columns by pattern priority', () => {
  const headers = ['Meeting Date', 'Implied Rate', 'Move bps'];
  assert.strictEqual(w.keyForHeader(headers, [/implied.*rate/]), 'Implied Rate');
  assert.strictEqual(w.keyForHeader(headers, [/nonexistent/]), null);
  // first matching group wins
  assert.strictEqual(
    w.preferredKeyForHeader(headers, [[/^implied rate$/, /implied.*rate/], [/^rate$/]]),
    'Implied Rate'
  );
  assert.strictEqual(w.preferredKeyForHeader(headers, [[/zzz/]]), null);
});

console.log(`wirp-store tests: ${passed} passed.`);
