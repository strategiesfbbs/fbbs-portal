'use strict';

// Regression tests for the pure helpers in server/bond-accounting-store.js —
// the P-code/FDIC-cert join logic and the path-safety guards used when copying
// portfolio workbooks into data/bank-reports/bond-accounting/{matched,unmatched}.
// The file-I/O importer itself is out of scope (needs xlsx fixtures); this
// locks down the logic that decides WHERE files land and HOW they're matched.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../server/bond-accounting-store');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// ---------- normalizePCode ----------

test('normalizePCode canonicalizes to P<digits> or empty', () => {
  assert.strictEqual(b.normalizePCode('P123'), 'P123');
  assert.strictEqual(b.normalizePCode('123'), 'P123');
  assert.strictEqual(b.normalizePCode('p 123'), 'P123');
  assert.strictEqual(b.normalizePCode('  456 '), 'P456');
  assert.strictEqual(b.normalizePCode('PXYZ'), '');
  assert.strictEqual(b.normalizePCode('P12A'), '');
  assert.strictEqual(b.normalizePCode(''), '');
  assert.strictEqual(b.normalizePCode(null), '');
});

// ---------- cleanDigits ----------

test('cleanDigits keeps only digits', () => {
  assert.strictEqual(b.cleanDigits('12-345'), '12345');
  assert.strictEqual(b.cleanDigits(' 67 '), '67');
  assert.strictEqual(b.cleanDigits('Cert #8276'), '8276');
  assert.strictEqual(b.cleanDigits(null), '');
});

// ---------- sanitizePathSegment (path-traversal guard) ----------

test('sanitizePathSegment strips separators and leading dots, keeps a safe segment', () => {
  assert.strictEqual(b.sanitizePathSegment('normal name.xlsx'), 'normal name.xlsx');
  assert.strictEqual(b.sanitizePathSegment('a\\b'), 'a_b');
  assert.strictEqual(b.sanitizePathSegment('...hidden'), 'hidden');
  assert.strictEqual(b.sanitizePathSegment(''), 'item');
  assert.strictEqual(b.sanitizePathSegment('', 'fallback'), 'fallback');
});

test('sanitizePathSegment defuses a traversal payload into one separator-free segment', () => {
  const out = b.sanitizePathSegment('../../etc/passwd');
  assert.ok(!out.includes('/') && !out.includes('\\'), `no separators: ${out}`);
  assert.ok(!out.startsWith('.'), `no leading dot: ${out}`);
  assert.ok(out.length <= 120);
});

// ---------- parsePortfolioFilename ----------

test('parsePortfolioFilename parses the FBBS naming pattern', () => {
  const p = b.parsePortfolioFilename('MyAccount(Account)_First Bank_20260430_P123.xlsx');
  assert.strictEqual(p.account, 'MyAccount');
  assert.strictEqual(p.clientName, 'First Bank');
  assert.strictEqual(p.reportDate, '2026-04-30');
  assert.strictEqual(p.pCode, 'P123');
  assert.strictEqual(p.extension, 'xlsx');
});

test('parsePortfolioFilename falls back gracefully for a non-matching name', () => {
  const p = b.parsePortfolioFilename('/tmp/random-report.xlsm');
  assert.strictEqual(p.filename, 'random-report.xlsm');
  assert.strictEqual(p.pCode, '');
  assert.strictEqual(p.reportDate, '');
  assert.strictEqual(p.extension, 'xlsm');
});

// ---------- bankSummaryMapByCert / chooseBankSummary ----------

test('bankSummaryMapByCert groups by cleaned cert and skips certless rows', () => {
  const map = b.bankSummaryMapByCert([
    { id: 'A', certNumber: '12345' },
    { id: 'B', certNumber: '12-345' }, // cleans to 12345 → same bucket
    { id: 'C', certNumber: '' }        // skipped
  ]);
  assert.strictEqual(map.get('12345').length, 2);
  assert.ok(!map.has(''));
});

test('chooseBankSummary returns the row only when the cert is unambiguous', () => {
  const map = b.bankSummaryMapByCert([
    { id: 'solo', certNumber: '999' },
    { id: 'A', certNumber: '111' },
    { id: 'B', certNumber: '111' }
  ]);
  assert.strictEqual(b.chooseBankSummary(map, '999').id, 'solo'); // exactly one
  assert.strictEqual(b.chooseBankSummary(map, '111'), null);      // ambiguous → no match
  assert.strictEqual(b.chooseBankSummary(map, '000'), null);      // none
});

// ---------- portfolioTargetPath (routing + traversal safety) ----------

test('portfolioTargetPath routes matched vs unmatched files', () => {
  const root = '/data/bond-accounting';
  const matched = b.portfolioTargetPath(root, { bankId: 'B-1', reportDate: '2026-04-30', filename: 'f.xlsx' });
  assert.strictEqual(matched, path.join(root, 'matched', 'B-1', '2026-04-30', 'f.xlsx'));
  const unmatched = b.portfolioTargetPath(root, { pCode: 'P9', reportDate: '', filename: 'f.xlsx' });
  assert.strictEqual(unmatched, path.join(root, 'unmatched', 'P9', 'undated', 'f.xlsx'));
});

test('portfolioTargetPath cannot escape the root even with traversal-laden inputs', () => {
  const root = '/data/bond-accounting';
  const out = b.portfolioTargetPath(root, {
    bankId: '../../evil', reportDate: '../x', filename: '../../../etc/passwd'
  });
  const rel = path.relative(root, out);
  assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `stays under root: ${rel}`);
  assert.ok(!rel.split(path.sep).includes('..'), `no '..' path segment: ${rel}`);
});

test('importOneOffPortfolioForBank replaces only that bank one-off row', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bond-oneoff-'));
  try {
    const reportsDir = path.join(tmp, 'reports');
    const root = b.bondAccountingDirForReportsDir(reportsDir);
    fs.mkdirSync(root, { recursive: true });
    const manifestPath = path.join(root, b.BOND_ACCOUNTING_MANIFEST_FILENAME);
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      importedAt: '2026-05-01T00:00:00.000Z',
      sourceFolder: 'monthly',
      bankListSourceFile: 'BankList.xlsx',
      bankListMode: 'saved',
      portfolioFileCount: 1,
      matchedCount: 1,
      pCodeMatchedCount: 0,
      unmatchedCount: 0,
      bankList: { sourceFile: 'BankList.xlsx', sheetName: 'Banks', rowCount: 1, pCodeCount: 1 },
      matches: [{
        id: 'monthly',
        filename: 'monthly.xlsx',
        reportDate: '2026-05-31',
        bankId: 'bank-1',
        bankDisplayName: 'First Bank',
        status: 'matched',
        storedPath: path.join('matched', 'bank-1', '2026-05-31', 'monthly.xlsx')
      }]
    }, null, 2));
    const file1 = path.join(tmp, 'First(Account)_First Bank_20260601_P1.xlsx');
    const file2 = path.join(tmp, 'rerun.xlsx');
    fs.writeFileSync(file1, 'one');
    fs.writeFileSync(file2, 'two');

    b.importOneOffPortfolioForBank(reportsDir, { id: 'bank-1', displayName: 'First Bank', certNumber: '123' }, file1);
    const afterFirst = b.loadBondAccountingManifest(reportsDir);
    assert.strictEqual(afterFirst.matches.length, 2);
    assert.strictEqual(afterFirst.matches[0].sourceType, 'one-off-thomas-ho');
    assert.strictEqual(afterFirst.matches[1].id, 'monthly');

    b.importOneOffPortfolioForBank(reportsDir, { id: 'bank-1', displayName: 'First Bank', certNumber: '123' }, file2, { reportDate: '2026-06-15' });
    const afterSecond = b.loadBondAccountingManifest(reportsDir);
    assert.strictEqual(afterSecond.matches.length, 2);
    assert.strictEqual(afterSecond.matches.filter(row => row.sourceType === 'one-off-thomas-ho').length, 1);
    assert.strictEqual(afterSecond.matches[0].filename, 'rerun.xlsx');
    assert.strictEqual(afterSecond.matches[0].reportDate, '2026-06-15');
    assert.strictEqual(afterSecond.matches[1].id, 'monthly');
    assert.strictEqual(afterSecond.portfolioFileCount, 2);
    assert.strictEqual(afterSecond.matchedCount, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`bond-accounting-store tests: ${passed} passed.`);
