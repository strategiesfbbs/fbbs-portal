'use strict';

// Regression tests for the pure parsing/normalization helpers in
// server/mbs-cmo-store.js — the value coercion behind MBS/CMO offer parsing.
// The file-I/O + workbook/PDF/email parsers are out of scope here; this locks
// down the per-cell normalization they all funnel through.

const assert = require('assert');
const m = require('../server/mbs-cmo-store');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ---------- toNumber ----------

test('toNumber parses 32nds bond-price notation', () => {
  assert.strictEqual(m.toNumber('101-16'), 101.5);   // 16/32
  assert.strictEqual(m.toNumber('99-08'), 99.25);    // 8/32
  assert.strictEqual(m.toNumber('100-00'), 100);
});

test('toNumber strips currency/percent/commas and keeps the number', () => {
  assert.strictEqual(m.toNumber('$1,250.50'), 1250.5);
  assert.strictEqual(m.toNumber('4.85%'), 4.85);
  assert.strictEqual(m.toNumber('-3.2'), -3.2);
  assert.strictEqual(m.toNumber(42), 42);
});

test('toNumber returns null for empty and missing-value sentinels', () => {
  assert.strictEqual(m.toNumber(''), null);
  assert.strictEqual(m.toNumber(null), null);
  assert.strictEqual(m.toNumber('#N/A'), null);
  assert.strictEqual(m.toNumber('#VALUE!'), null);
  assert.strictEqual(m.toNumber('---'), null);
  assert.strictEqual(m.toNumber('n/m'), null); // no digits → null
});

// ---------- isMissingValue ----------

test('isMissingValue flags blanks, error codes, and dash runs', () => {
  assert.ok(m.isMissingValue(null));
  assert.ok(m.isMissingValue('   '));
  assert.ok(m.isMissingValue('#N/A'));
  assert.ok(m.isMissingValue('-----'));
  assert.ok(!m.isMissingValue('0'));
  assert.ok(!m.isMissingValue('abc'));
});

// ---------- normalizeDate ----------

test('normalizeDate handles Excel serials and US date formats', () => {
  assert.strictEqual(m.normalizeDate('4/30/2026'), '2026-04-30');
  assert.strictEqual(m.normalizeDate('4/30/26'), '2026-04-30');
  assert.strictEqual(m.normalizeDate('4/2026'), '2026-04-01'); // month/year → first of month
  // Excel serial → ISO (serial = days-since-epoch + 25569, matching the impl)
  const serial = Math.round(Date.UTC(2026, 3, 30) / 86400000) + 25569;
  assert.strictEqual(m.normalizeDate(serial), '2026-04-30');
  assert.strictEqual(m.normalizeDate(''), null);
  assert.strictEqual(m.normalizeDate('#N/A'), null);
});

// ---------- normalizeCusip ----------

test('normalizeCusip upper-cases, strips noise, and validates length', () => {
  assert.strictEqual(m.normalizeCusip('3137b1u75'), '3137B1U75'); // 9 chars
  assert.strictEqual(m.normalizeCusip(' 31283k-aa '), '31283KAA'); // 8 chars after strip
  assert.strictEqual(m.normalizeCusip('ABC123'), null);            // <8
  assert.strictEqual(m.normalizeCusip('WAY-TOO-LONG-VALUE'), null); // >9
  assert.strictEqual(m.normalizeCusip(''), null);
});

// ---------- inferProductType ----------

test('inferProductType classifies from any field text', () => {
  assert.strictEqual(m.inferProductType({ desc: 'FNMA PAC sequential' }), 'CMO');
  assert.strictEqual(m.inferProductType({ desc: 'GNMA single family pool' }), 'MBS');
  assert.strictEqual(m.inferProductType({ desc: 'something generic' }), 'MBS/CMO');
});

// ---------- sanitizeFilename ----------

test('sanitizeFilename strips path + unsafe chars and bounds length', () => {
  assert.strictEqual(m.sanitizeFilename('/etc/../MBS Offers.xlsx'), 'MBS Offers.xlsx');
  assert.strictEqual(m.sanitizeFilename('MBS*Offers?.xlsx'), 'MBS_Offers_.xlsx'); // unsafe chars → _
  assert.strictEqual(m.sanitizeFilename('...hidden'), 'hidden');
  assert.strictEqual(m.sanitizeFilename(''), 'file');
  assert.ok(m.sanitizeFilename('x'.repeat(300) + '.xlsx').length <= 180);
});

console.log(`mbs-cmo-store tests: ${passed} passed.`);
