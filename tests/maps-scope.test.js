// Node tests for the US Bank Map scope/owner policy module.
// Pins the follow/pinned matrix so the "map trapped in rep territory" bug
// class (2026-07-02) can't quietly return.
const assert = require('assert');
const scope = require('../public/js/modules/maps-scope.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('ok  ' + name); }
  catch (err) { console.error('FAIL ' + name + '\n  ' + err.message); process.exitCode = 1; }
}

const BRYCE = { displayName: 'Bryce Martin', username: 'bmartin' };

test('ownerNameMatches: exact + identity-key, never partial/initial matches', () => {
  assert.ok(scope.ownerNameMatches('Bryce Martin', 'bryce  martin')); // whitespace/case
  assert.ok(scope.ownerNameMatches('Bryce-Martin', 'Bryce Martin'));  // identity key strips punctuation
  assert.ok(!scope.ownerNameMatches('B. Martin', 'Bryce Martin'));    // no initial+surname false positive
  assert.ok(!scope.ownerNameMatches('Bryce Martinez', 'Bryce Martin'));
  assert.ok(!scope.ownerNameMatches('', 'Bryce Martin'));
  assert.ok(!scope.ownerNameMatches('Bryce Martin', ''));
});

test('ownerStringMatches: multi-owner strings split on , ; / | and "and"', () => {
  assert.ok(scope.ownerStringMatches('Jane Doe / Bryce Martin', 'Bryce Martin'));
  assert.ok(scope.ownerStringMatches('Jane Doe and Bryce Martin', 'bmartin') === false); // username != owner text
  assert.ok(scope.ownerStringMatches('Bryce Martin; Jane Doe', 'Jane Doe'));
  assert.ok(!scope.ownerStringMatches('Jane Doe', 'Bryce Martin'));
  assert.ok(scope.ownerStringMatches('anything', '')); // empty filter matches all
  assert.ok(!scope.ownerStringMatches('', 'Bryce Martin')); // unowned bank fails an owner filter
});

test('resolveScope derives all / mine / rep', () => {
  assert.strictEqual(scope.resolveScope('', BRYCE), 'all');
  assert.strictEqual(scope.resolveScope('  ', BRYCE), 'all');
  assert.strictEqual(scope.resolveScope('Bryce Martin', BRYCE), 'mine');
  assert.strictEqual(scope.resolveScope('bmartin', BRYCE), 'mine'); // username form
  assert.strictEqual(scope.resolveScope('Jane Doe', BRYCE), 'rep');
  assert.strictEqual(scope.resolveScope('Jane Doe', null), 'rep'); // no acting rep → any owner is 'rep'
});

test('territoryAfterRepSwitch: follows only when unpinned', () => {
  // Unpinned (default/'mine') → follow to the new rep's owner.
  let t = scope.territoryAfterRepSwitch({ owner: 'Bryce Martin', ownerPinned: false }, 'Jane Doe');
  assert.deepStrictEqual(t, { owner: 'Jane Doe', ownerPinned: false, changed: true });
  // Unpinned, new rep has NO owner → widen to all, still unpinned.
  t = scope.territoryAfterRepSwitch({ owner: 'Bryce Martin', ownerPinned: false }, '');
  assert.deepStrictEqual(t, { owner: '', ownerPinned: false, changed: true });
  // Pinned (user chose All) → never re-scope.
  t = scope.territoryAfterRepSwitch({ owner: '', ownerPinned: true }, 'Jane Doe');
  assert.deepStrictEqual(t, { owner: '', ownerPinned: true, changed: false });
  // Pinned (user chose another rep) → never re-scope.
  t = scope.territoryAfterRepSwitch({ owner: 'Jane Doe', ownerPinned: true }, 'Bryce Martin');
  assert.deepStrictEqual(t, { owner: 'Jane Doe', ownerPinned: true, changed: false });
});

test('territoryForScope: the explicit-action policy table', () => {
  // All → cleared owner, pinned (rep switches must not re-scope).
  assert.deepStrictEqual(scope.territoryForScope('all'), { owner: '', ownerPinned: true });
  // My territory → rep owner, UNpinned (following re-armed).
  assert.deepStrictEqual(scope.territoryForScope('mine', { owner: 'Bryce Martin' }),
    { owner: 'Bryce Martin', ownerPinned: false });
  // Another rep from the select → pinned.
  assert.deepStrictEqual(scope.territoryForScope('rep', { owner: 'Jane Doe', rep: BRYCE }),
    { owner: 'Jane Doe', ownerPinned: true });
  // Picking yourself in the select reads as My territory → unpinned.
  assert.deepStrictEqual(scope.territoryForScope('rep', { owner: 'Bryce Martin', rep: BRYCE }),
    { owner: 'Bryce Martin', ownerPinned: false });
});

test('scopeBannerText: all vs mine vs rep phrasing with counts', () => {
  assert.strictEqual(scope.scopeBannerText('all', '', 0, 4654),
    'Viewing all current banks · 4,654');
  assert.strictEqual(scope.scopeBannerText('mine', 'Bryce Martin', 19, 4654),
    'Viewing Bryce Martin territory · 19 of 4,654 current banks');
  assert.strictEqual(scope.scopeBannerText('rep', 'Jane Doe', 42, 4654),
    'Viewing Jane Doe book · 42 of 4,654 current banks');
});

test('universeSubtitle: universe stats only, with unmapped note', () => {
  assert.strictEqual(
    scope.universeSubtitle({ latestPeriod: '2026Q1', currentBankCount: 4654, staleBankCount: 1250, mappedCount: 4602 }),
    'Period 2026Q1 · 4,654 current banks · 1,250 stale/inactive hidden · 4,602 mapped · 52 without map location');
  // No stale, everything mapped → no noise.
  assert.strictEqual(
    scope.universeSubtitle({ currentBankCount: 10, staleBankCount: 0, mappedCount: 10 }),
    '10 current banks · 10 mapped');
});

console.log(`maps-scope tests: ${passed} passed${process.exitCode ? ' (with failures)' : '.'}`);
