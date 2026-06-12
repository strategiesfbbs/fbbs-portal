'use strict';

// market-color-store: content-hash dedup on ingest + one-time inbox cleanup.
// Same-day folder re-publishes resend the same .eml batch — the store must
// keep exactly one copy of each distinct email.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  dedupeMarketColorInbox,
  loadMarketColorInbox,
  saveMarketColorUpload
} = require('../server/market-color-store');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok: ${name}`); }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-store-test-'));
}

function emlBuffer(subject, body) {
  return Buffer.from(`From: Desk <desk@fbbs.test>\r\nSubject: ${subject}\r\nDate: Fri, 12 Jun 2026 07:00:00 -0500\r\n\r\n${body}\r\n`);
}

function upload(filename, buffer) {
  return { filename, data: buffer };
}

// ---------- ingest dedup ----------

test('re-uploading the same .eml batch adds nothing the second time', () => {
  const dir = tempDir();
  const batch = [
    upload('color-1.eml', emlBuffer('Morning color', 'Rates rallied.')),
    upload('color-2.eml', emlBuffer('Midday color', 'Curve steepened.'))
  ];
  const first = saveMarketColorUpload(dir, batch);
  assert.strictEqual(first.uploadedSources.length, 2);
  assert.strictEqual(first.skippedDuplicates, 0);

  const second = saveMarketColorUpload(dir, batch);
  assert.strictEqual(second.uploadedSources.length, 0);
  assert.strictEqual(second.skippedDuplicates, 2);

  const inbox = loadMarketColorInbox(dir);
  assert.strictEqual(inbox.sources.length, 2);
  assert.strictEqual(inbox.items.length, 2);
  assert.ok(inbox.sources.every(s => s.contentHash), 'new sources carry contentHash');
  assert.strictEqual(fs.readdirSync(path.join(dir, 'files')).length, 2, 'no duplicate files on disk');
});

test('a changed email body is a new email, not a duplicate', () => {
  const dir = tempDir();
  saveMarketColorUpload(dir, [upload('color.eml', emlBuffer('Morning color', 'Rates rallied.'))]);
  const result = saveMarketColorUpload(dir, [upload('color.eml', emlBuffer('Morning color', 'Rates rallied, then faded.'))]);
  assert.strictEqual(result.uploadedSources.length, 1);
  assert.strictEqual(result.skippedDuplicates, 0);
  assert.strictEqual(loadMarketColorInbox(dir).items.length, 2);
});

test('duplicates within one batch collapse to a single copy', () => {
  const dir = tempDir();
  const buf = emlBuffer('Repeat', 'Same email twice in one folder.');
  const result = saveMarketColorUpload(dir, [upload('a.eml', buf), upload('b.eml', buf)]);
  assert.strictEqual(result.uploadedSources.length, 1);
  assert.strictEqual(result.skippedDuplicates, 1);
});

test('dedup recognizes legacy sources that predate contentHash', () => {
  const dir = tempDir();
  const buf = emlBuffer('Legacy', 'Stored before hashing existed.');
  saveMarketColorUpload(dir, [upload('legacy.eml', buf)]);
  // simulate a pre-dedup inbox: strip the stored hash
  const inboxFile = path.join(dir, 'inbox.json');
  const inbox = JSON.parse(fs.readFileSync(inboxFile, 'utf-8'));
  delete inbox.sources[0].contentHash;
  fs.writeFileSync(inboxFile, JSON.stringify(inbox));

  const result = saveMarketColorUpload(dir, [upload('legacy.eml', buf)]);
  assert.strictEqual(result.uploadedSources.length, 0);
  assert.strictEqual(result.skippedDuplicates, 1);
  assert.ok(loadMarketColorInbox(dir).sources[0].contentHash, 'legacy hash backfilled and persisted');
});

// ---------- one-time cleanup ----------

test('dedupeMarketColorInbox removes pre-existing duplicate copies, keeps the earliest', () => {
  const dir = tempDir();
  const buf = emlBuffer('Dup', 'Ingested three times pre-dedup.');
  // Build a legacy triple-ingest: upload once, then clone the source+item rows
  // (fresh ids, later uploadedAt, no contentHash) the way repeat publishes did.
  saveMarketColorUpload(dir, [upload('dup.eml', buf)]);
  const inboxFile = path.join(dir, 'inbox.json');
  const inbox = JSON.parse(fs.readFileSync(inboxFile, 'utf-8'));
  const original = inbox.sources[0];
  delete original.contentHash;
  for (let i = 1; i <= 2; i++) {
    const id = `clone-${i}`;
    const storedFilename = `${id}-dup.eml`;
    fs.writeFileSync(path.join(dir, 'files', storedFilename), buf);
    inbox.sources.unshift({ ...original, id, storedFilename, uploadedAt: `2030-01-0${i}T00:00:00.000Z` });
    inbox.items.unshift({ ...inbox.items[0], id: `item-${i}`, sourceFile: { ...inbox.items[0].sourceFile, id } });
  }
  fs.writeFileSync(inboxFile, JSON.stringify(inbox));
  assert.strictEqual(loadMarketColorInbox(dir).sources.length, 3);

  const { removed } = dedupeMarketColorInbox(dir);
  assert.strictEqual(removed, 2);
  const cleaned = loadMarketColorInbox(dir);
  assert.strictEqual(cleaned.sources.length, 1);
  assert.strictEqual(cleaned.items.length, 1);
  assert.strictEqual(cleaned.sources[0].id, original.id, 'earliest-uploaded copy survives');
  assert.strictEqual(cleaned.items[0].sourceFile.id, original.id, 'surviving item points at the kept source');
  assert.strictEqual(fs.readdirSync(path.join(dir, 'files')).length, 1, 'duplicate stored files unlinked');
});

test('dedupeMarketColorInbox is a no-op on a clean inbox', () => {
  const dir = tempDir();
  saveMarketColorUpload(dir, [upload('one.eml', emlBuffer('One', 'Only copy.'))]);
  assert.strictEqual(dedupeMarketColorInbox(dir).removed, 0);
  const before = fs.readFileSync(path.join(dir, 'inbox.json'), 'utf-8');
  assert.strictEqual(dedupeMarketColorInbox(dir).removed, 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'inbox.json'), 'utf-8'), before, 'clean inbox not rewritten');
});

test('dedupeMarketColorInbox handles an empty inbox', () => {
  const dir = tempDir();
  assert.strictEqual(dedupeMarketColorInbox(dir).removed, 0);
});

console.log(`market-color-store tests: ${passed} passed, ${process.exitCode ? 'some' : 0} failed.`);
