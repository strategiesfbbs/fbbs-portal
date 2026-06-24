// Characterization tests for server/rep-roster.js — the firm's single source of
// truth for rep-code -> display-name resolution (Exec Summary revenue tables,
// reports, SALESPERSON_MAP). Pure, deterministic, no I/O.
//
// This is a regression guard: it locks in CURRENT behavior so an accidental
// roster edit or a change to the three-way repName fallback contract trips a
// test instead of silently shipping.
'use strict';

const assert = require('assert');
const {
  REP_ROSTER,
  normalizeRepCode,
  repName,
  isKnownRep,
} = require('../server/rep-roster');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// normalizeRepCode — trims surrounding whitespace, uppercases, coerces falsy.
// ---------------------------------------------------------------------------

test('normalizeRepCode trims surrounding whitespace and uppercases', () => {
  assert.strictEqual(normalizeRepCode('  f14 '), 'F14');
});

test('normalizeRepCode uppercases an already-trimmed lowercase code', () => {
  assert.strictEqual(normalizeRepCode('o44'), 'O44');
});

test('normalizeRepCode leaves a canonical code untouched', () => {
  assert.strictEqual(normalizeRepCode('F21'), 'F21');
});

test('normalizeRepCode collapses falsy inputs to empty string', () => {
  assert.strictEqual(normalizeRepCode(''), '');
  assert.strictEqual(normalizeRepCode(undefined), '');
  assert.strictEqual(normalizeRepCode(null), '');
  assert.strictEqual(normalizeRepCode(0), '');
});

test('normalizeRepCode only trims the outer edges, not interior spaces', () => {
  // No roster code carries interior spaces, but the normalizer must not eat them.
  assert.strictEqual(normalizeRepCode('  a b  '), 'A B');
});

test('normalizeRepCode coerces non-string input via String()', () => {
  assert.strictEqual(normalizeRepCode(123), '123');
});

// ---------------------------------------------------------------------------
// repName — three-way fallback contract:
//   1. known code (case/space-insensitive) -> display name
//   2. unknown code -> the explicit `fallback` if one was passed
//   3. unknown code, no fallback -> the normalized code, or null when empty
// ---------------------------------------------------------------------------

test('repName resolves a known code to its display name', () => {
  assert.strictEqual(repName('F14'), 'Jim Courrier');
});

test('repName resolves case-insensitively and trims', () => {
  assert.strictEqual(repName('  f14 '), 'Jim Courrier');
  assert.strictEqual(repName('o44'), 'Edward Krei');
});

test('repName for an unknown code with no fallback returns the normalized code', () => {
  assert.strictEqual(repName('  zzz '), 'ZZZ');
});

test('repName for an unknown code WITH a fallback returns the fallback', () => {
  assert.strictEqual(repName('ZZZ', 'Unknown rep'), 'Unknown rep');
});

test('repName fallback wins even when the fallback is an empty string', () => {
  // fallback !== undefined is the gate, so '' is an explicit, honored fallback.
  assert.strictEqual(repName('ZZZ', ''), '');
});

test('repName fallback of null is honored for an unknown code', () => {
  assert.strictEqual(repName('ZZZ', null), null);
});

test('repName empty input with no fallback returns null', () => {
  assert.strictEqual(repName(''), null);
  assert.strictEqual(repName(undefined), null);
  assert.strictEqual(repName(null), null);
});

test('repName empty input WITH a fallback returns the fallback (not null)', () => {
  assert.strictEqual(repName('', 'n/a'), 'n/a');
});

test('repName: a known code ignores the fallback', () => {
  assert.strictEqual(repName('f14', 'should-not-appear'), 'Jim Courrier');
});

// ---------------------------------------------------------------------------
// isKnownRep — membership test, normalized.
// ---------------------------------------------------------------------------

test('isKnownRep is true for a roster code in any case/spacing', () => {
  assert.strictEqual(isKnownRep('F14'), true);
  assert.strictEqual(isKnownRep('  f14 '), true);
});

test('isKnownRep is false for an unknown code', () => {
  assert.strictEqual(isKnownRep('ZZZ'), false);
});

test('isKnownRep is false for empty/falsy input', () => {
  assert.strictEqual(isKnownRep(''), false);
  assert.strictEqual(isKnownRep(undefined), false);
  assert.strictEqual(isKnownRep(null), false);
});

// ---------------------------------------------------------------------------
// Roster content — spot-check team/partnership codes survive verbatim.
// These read like pairings and are booked jointly; they must not be "fixed".
// ---------------------------------------------------------------------------

test('team/partnership codes survive verbatim', () => {
  assert.strictEqual(REP_ROSTER.F21, 'Mac & Gio');
  assert.strictEqual(REP_ROSTER.F26, 'Glasser/Hagemann');
  assert.strictEqual(REP_ROSTER.F80, 'Crihfield/Crifasi');
  assert.strictEqual(REP_ROSTER.K55, 'Bernard/Lewis');
  assert.strictEqual(REP_ROSTER.K64, 'Lewis/Krei');
  assert.strictEqual(REP_ROSTER.L33, 'L1 Hart & Co');
});

test("a display name with an apostrophe is preserved", () => {
  assert.strictEqual(REP_ROSTER.F53, "Michael D'Addabbo");
});

test('roster size and key/value shape are locked', () => {
  const keys = Object.keys(REP_ROSTER);
  assert.strictEqual(keys.length, 30, 'roster has 30 entries');
  // Every key is an already-normalized code; every value is a non-empty string.
  for (const k of keys) {
    assert.strictEqual(k, normalizeRepCode(k), `key ${k} is in canonical form`);
    assert.strictEqual(typeof REP_ROSTER[k], 'string');
    assert.ok(REP_ROSTER[k].length > 0, `value for ${k} is non-empty`);
  }
});

test('every roster code is resolvable through repName and isKnownRep', () => {
  for (const k of Object.keys(REP_ROSTER)) {
    assert.strictEqual(repName(k), REP_ROSTER[k]);
    assert.strictEqual(isKnownRep(k), true);
  }
});

console.log(`rep-roster tests: ${passed}/${total} passed.`);
