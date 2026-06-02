'use strict';

// Regression tests for server/rep-identity.js — the rep resolution + owner-
// string matching that powers the header rep dropdown and rep-scoped filtering
// across every saved view and the coverage workspace. All pure functions (no
// I/O), so this is a plain-assert suite with no temp dir.

const assert = require('assert');
const r = require('../server/rep-identity');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}
const idy = rep => rep && { username: rep.username, displayName: rep.displayName };

// ---------- normalizeUsername ----------

test('normalizeUsername strips domain / email, lowercases, despaces', () => {
  assert.strictEqual(r.normalizeUsername('FBBS\\Mike Jones'), 'mikejones');
  assert.strictEqual(r.normalizeUsername('mjones@fbbs.com'), 'mjones');
  assert.strictEqual(r.normalizeUsername('  MJONES  '), 'mjones');
  assert.strictEqual(r.normalizeUsername(''), '');
  assert.strictEqual(r.normalizeUsername(null), '');
});

// ---------- prettifyDisplayName ----------

test('prettifyDisplayName title-cases all-caps/lowercase, leaves mixed case alone', () => {
  assert.strictEqual(r.prettifyDisplayName('MIKE JONES'), 'Mike Jones');
  assert.strictEqual(r.prettifyDisplayName('mike jones'), 'Mike Jones');
  assert.strictEqual(r.prettifyDisplayName('Mike Jones'), 'Mike Jones'); // already mixed → untouched
  assert.strictEqual(r.prettifyDisplayName(''), '');
});

// ---------- parseCookies ----------

test('parseCookies parses, trims, and URL-decodes values', () => {
  const c = r.parseCookies('fbbs_rep_override=Mike%20Jones%7Cmjones; other=1');
  assert.strictEqual(c.fbbs_rep_override, 'Mike Jones|mjones');
  assert.strictEqual(c.other, '1');
  assert.deepStrictEqual(r.parseCookies(''), {});
  assert.deepStrictEqual(r.parseCookies(null), {});
  assert.deepStrictEqual(r.parseCookies('=novalue'), {}); // empty key ignored
});

// ---------- parseRepValue ----------

test('parseRepValue handles name, handle, and "display|handle" forms', () => {
  assert.deepStrictEqual(idy(r.parseRepValue('Mike Jones')), { username: 'mikejones', displayName: 'Mike Jones' });
  assert.deepStrictEqual(idy(r.parseRepValue('mjones')), { username: 'mjones', displayName: 'Mjones' });
  assert.deepStrictEqual(idy(r.parseRepValue('Mike Jones|mjones')), { username: 'mjones', displayName: 'Mike Jones' });
  assert.strictEqual(r.parseRepValue(''), null);
});

// ---------- splitOwnerString ----------

test('splitOwnerString splits on , ; / | and "and", keeping multi-word names', () => {
  assert.deepStrictEqual(r.splitOwnerString('Mike Jones, John Smith'), ['Mike Jones', 'John Smith']);
  assert.deepStrictEqual(r.splitOwnerString('Mike Jones / John Smith'), ['Mike Jones', 'John Smith']);
  assert.deepStrictEqual(r.splitOwnerString('Mike Jones and John Smith'), ['Mike Jones', 'John Smith']);
  assert.deepStrictEqual(r.splitOwnerString('Mike Jones; John Smith | Jane Roe'), ['Mike Jones', 'John Smith', 'Jane Roe']);
  assert.deepStrictEqual(r.splitOwnerString(''), []);
});

// ---------- ownerStringContainsRep ----------

test('ownerStringContainsRep matches by username, display, multi-owner, and loose initial+surname', () => {
  const rep = r.parseRepValue('Mike Jones|mjones'); // { username:'mjones', displayName:'Mike Jones' }
  assert.ok(r.ownerStringContainsRep('mjones', rep), 'exact username');
  assert.ok(r.ownerStringContainsRep('Mike Jones', rep), 'exact display');
  assert.ok(r.ownerStringContainsRep('MIKE JONES, John Smith', rep), 'within a multi-owner string');
  assert.ok(r.ownerStringContainsRep('M Jones', rep), 'loose: first initial + surname');
  assert.ok(!r.ownerStringContainsRep('John Smith', rep), 'different person');
  assert.ok(!r.ownerStringContainsRep('', rep), 'empty owner');
  assert.ok(!r.ownerStringContainsRep('Mike Jones', null), 'null rep');
});

// ---------- aggregateRepsFromOwnerStrings ----------

test('aggregateRepsFromOwnerStrings dedups by username, sums counts, sorts by count desc', () => {
  const reps = r.aggregateRepsFromOwnerStrings([
    { owner: 'Mike Jones', count: 3 },
    { owner: 'MIKE JONES, John Smith', count: 2 },
    { owner: 'Jane Roe', count: 1 }
  ]);
  const mj = reps.find(x => x.username === 'mikejones');
  assert.ok(mj && mj.count === 5, JSON.stringify(reps));
  assert.strictEqual(reps[0].username, 'mikejones', 'highest count sorts first');
  assert.ok(reps.some(x => x.username === 'johnsmith' && x.count === 2));
});

// ---------- resolveRequestRep (precedence) ----------

test('resolveRequestRep: cookie override wins', () => {
  const rep = r.resolveRequestRep({ headers: { cookie: 'fbbs_rep_override=Mike%20Jones%7Cmjones' } });
  assert.strictEqual(rep.username, 'mjones');
  assert.strictEqual(rep.source, 'cookie');
});

test('resolveRequestRep: production mode can ignore cookie override', () => {
  const rep = r.resolveRequestRep({
    headers: {
      cookie: 'fbbs_rep_override=Mike%20Jones%7Cmjones',
      'x-iisnode-logon_user': 'FBBS\\jsmith'
    }
  }, { allowCookieOverride: false });
  assert.strictEqual(rep.username, 'jsmith');
  assert.strictEqual(rep.source, 'iis');
});

test('resolveRequestRep: __none__ sentinel forces null (no IIS/env fallback)', () => {
  assert.strictEqual(r.resolveRequestRep({ headers: { cookie: 'fbbs_rep_override=__none__', 'auth-user': 'someone' } }), null);
});

test('resolveRequestRep: production mode ignores __none__ cookie sentinel', () => {
  const rep = r.resolveRequestRep({
    headers: {
      cookie: 'fbbs_rep_override=__none__',
      'auth-user': 'FBBS\\someone'
    }
  }, { allowCookieOverride: false });
  assert.strictEqual(rep.username, 'someone');
  assert.strictEqual(rep.source, 'iis');
});

test('resolveRequestRep: IIS logon header when no cookie', () => {
  const rep = r.resolveRequestRep({ headers: { 'x-iisnode-logon_user': 'FBBS\\mjones' } });
  assert.strictEqual(rep.username, 'mjones');
  assert.strictEqual(rep.source, 'iis');
});

test('resolveRequestRep: env default as last resort, else null', () => {
  const rep = r.resolveRequestRep({ headers: {} }, { defaultRep: 'Mike Jones' });
  assert.strictEqual(rep.username, 'mikejones');
  assert.strictEqual(rep.source, 'env');
  assert.strictEqual(r.resolveRequestRep({ headers: {} }), null);
});

test('resolveRequestRep: env default can be disabled', () => {
  assert.strictEqual(r.resolveRequestRep({ headers: {} }, { defaultRep: 'Mike Jones', allowDefaultRep: false }), null);
});

// ---------- cookie header builders ----------

test('buildRepOverrideCookie / clearRepOverrideCookieHeader', () => {
  assert.ok(r.buildRepOverrideCookie('Mike Jones|mjones').includes('fbbs_rep_override=Mike%20Jones%7Cmjones'));
  assert.ok(r.buildRepOverrideCookie(null).includes('__none__'));
  assert.ok(/Max-Age=0/.test(r.clearRepOverrideCookieHeader()));
});

console.log(`rep-identity tests: ${passed} passed.`);
