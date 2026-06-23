// Tests for the folder-drop auto-publisher (autoPublishTick in server.js).
// Runs the real module in-process against a temp DATA_DIR — no HTTP, no timers.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// DATA_DIR must be set before the module is required — server.js resolves all
// its data paths at load time.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-auto-publish-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LOG_LEVEL = 'error';

const { autoPublishTick } = require('../server/server');

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DROP_DIR = path.join(DATA_DIR, 'dropbox', todayStamp());
const CURRENT_DIR = path.join(DATA_DIR, 'current');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.log');

function packagePdf(marker) {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n`);
}

function auditEvents() {
  try {
    return fs.readFileSync(AUDIT_PATH, 'utf-8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function currentPackagePdf() {
  if (!fs.existsSync(CURRENT_DIR)) return null;
  const file = fs.readdirSync(CURRENT_DIR).find(f => f.toLowerCase().endsWith('.pdf'));
  return file ? fs.readFileSync(path.join(CURRENT_DIR, file), 'utf-8') : null;
}

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok: ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL: ${label}\n    ${err.message}`);
  }
}

async function main() {
  console.log('auto-publish.test.js');

  await check('an empty drop folder does nothing', async () => {
    await autoPublishTick();
    await autoPublishTick();
    assert.strictEqual(currentPackagePdf(), null);
    assert.strictEqual(auditEvents().length, 0);
  });

  await check('a new file publishes only after the folder is stable for one tick', async () => {
    fs.mkdirSync(DROP_DIR, { recursive: true });
    fs.writeFileSync(path.join(DROP_DIR, 'Economic Update.pdf'), packagePdf('v1'));

    await autoPublishTick(); // first sighting — must NOT publish yet
    assert.strictEqual(currentPackagePdf(), null, 'published before the stability window');

    await autoPublishTick(); // unchanged since last tick — publish
    const published = currentPackagePdf();
    assert.ok(published && published.includes('v1'), 'package PDF not published');

    const meta = JSON.parse(fs.readFileSync(path.join(CURRENT_DIR, '_meta.json'), 'utf-8'));
    assert.strictEqual(meta.publishedBy, 'Folder Drop (auto)');

    const events = auditEvents();
    assert.ok(events.some(e => e.event === 'folder-auto-publish'), 'no folder-auto-publish audit event');
  });

  await check('an already-published folder state is never re-published', async () => {
    const auditBefore = auditEvents().length;
    await autoPublishTick();
    await autoPublishTick();
    assert.strictEqual(auditEvents().length, auditBefore, 'tick on an unchanged folder wrote audit events');
  });

  await check('a slot collision holds the publish and audits the skip once', async () => {
    fs.writeFileSync(path.join(DROP_DIR, 'Second Economic Update.pdf'), packagePdf('intruder'));
    await autoPublishTick(); // new fingerprint — pending
    await autoPublishTick(); // stable — collision detected, held
    await autoPublishTick(); // still held, no duplicate audit row

    const published = currentPackagePdf();
    assert.ok(published.includes('v1'), 'collision overwrote the live package PDF');
    const skips = auditEvents().filter(e => e.event === 'folder-auto-publish-skipped' && e.reason === 'slot-collision');
    assert.strictEqual(skips.length, 1, `expected exactly one skip audit row, got ${skips.length}`);
  });

  await check('resolving the collision publishes the updated file', async () => {
    fs.rmSync(path.join(DROP_DIR, 'Second Economic Update.pdf'));
    fs.writeFileSync(path.join(DROP_DIR, 'Economic Update.pdf'), packagePdf('v2'));
    await autoPublishTick(); // changed — pending
    await autoPublishTick(); // stable — publish
    const published = currentPackagePdf();
    assert.ok(published && published.includes('v2'), 'updated package PDF not published');
  });

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  if (failures) {
    console.error(`auto-publish tests: ${failures} failed`);
    process.exit(1);
  }
  console.log('auto-publish tests: all passed');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('auto-publish.test.js crashed:', err);
  process.exit(1);
});
