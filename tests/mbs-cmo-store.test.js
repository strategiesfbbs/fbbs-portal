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

// ---------- filterOffersForDate (current-day-only display policy) ----------

test('filterOffersForDate keeps only offers created on the package date', () => {
  const inv = {
    uploadedAt: '2026-07-02T15:00:00.000Z',
    sources: [{ id: 'a' }],
    offers: [
      { id: '1', createdAt: '2026-07-02T14:00:00.000Z', description: 'today' },
      { id: '2', createdAt: '2026-05-01T20:03:35.276Z', description: 'may' },
      { id: '3', createdAt: null, description: 'undated' },
    ],
    warnings: []
  };
  const out = m.filterOffersForDate(inv, '2026-07-02');
  assert.strictEqual(out.offers.length, 1);
  assert.strictEqual(out.offers[0].description, 'today');
  assert.strictEqual(out.staleOfferCount, 2);
  assert.strictEqual(out.lastUploadedAt, '2026-07-02T15:00:00.000Z');
  assert.strictEqual(out.currentForDate, '2026-07-02');
  // Sources/warnings pass through untouched (history stays browsable).
  assert.strictEqual(out.sources.length, 1);
});

test('filterOffersForDate with no package date hides everything (no date = nothing is current)', () => {
  const inv = { uploadedAt: null, sources: [], offers: [{ id: '1', createdAt: '2026-07-02T14:00:00.000Z' }], warnings: [] };
  const out = m.filterOffersForDate(inv, '');
  assert.strictEqual(out.offers.length, 0);
  assert.strictEqual(out.staleOfferCount, 1);
});

test('localYmd converts ISO timestamps to the local calendar day', () => {
  assert.strictEqual(m.localYmd(''), '');
  assert.strictEqual(m.localYmd('garbage'), '');
  // A midday UTC timestamp lands on the same local day in US timezones.
  const noonUtc = '2026-07-02T12:00:00.000Z';
  assert.ok(/^2026-07-0[12]$/.test(m.localYmd(noonUtc)));
});

console.log(`mbs-cmo-store tests: ${passed} passed.`);
