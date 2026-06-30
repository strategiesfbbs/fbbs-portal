// Tests for the folder-drop Pershing trade auto-importer (autoPershingTradesTick
// in server.js). Runs the real module in-process against a temp DATA_DIR — no
// HTTP, no timers.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// DATA_DIR must be set before the module is required — server.js resolves all
// its data paths at load time.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-pershing-auto-import-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LOG_LEVEL = 'error';

const { autoPershingTradesTick, autoPublishTick } = require('../server/server');
const pershing = require('../server/pershing-store');

const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const DROP_DIR = path.join(BANK_REPORTS_DIR, 'incoming', 'pershing-trades');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.log');

const HEADER = '"Account Number","Buy/Sell","IP Name","CUSIP","Quantity","Issuer","Security Description","Asset Type Code","Callable","Price (Transaction Currency)","Activity Date","Trade Date","Settlement Date","Maturity Date"';

function tradeCsv(rows) {
  return [HEADER, ...rows].join('\n');
}

const ROW_625 = '"=""7R8000001""","BUY","DAN H","=""912828U24""",100000.00000,"US TREASURY","US TREASURY NOTE 2.500% 05/31/30","USTREAS","No",99.5,"06/25/2026","06/25/2026","06/26/2026","05/31/2030"';
const ROW_626 = '"=""7R8000002""","SELL","JIM L","=""3130A1AA1""",-50000,"FHLB","FHLB 4.000% 06/30/28","AGENCY","Yes",101.25,"06/26/2026","06/26/2026","06/29/2026","06/30/2028"';
// A distinct row used to prove the dropbox side-car actually imports (unique trade_key).
const ROW_630 = '"=""7R8009999""","BUY","NEW REP","=""912828ZZ9""",100000.00000,"US TREASURY","US TREASURY NOTE 3.000% 06/30/31","GOVTSEC","No",99.0,"06/30/2026","06/30/2026","07/01/2026","06/30/2031"';

function dropFile(name, body) {
  fs.mkdirSync(DROP_DIR, { recursive: true });
  fs.writeFileSync(path.join(DROP_DIR, name), body, 'utf8');
}

function auditEvents() {
  try {
    return fs.readFileSync(AUDIT_PATH, 'utf-8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function tradeCount() {
  return pershing.getPershingTradeImportStatus(BANK_REPORTS_DIR).tradeCount || 0;
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
  console.log('pershing-trades-auto-import.test.js');

  await check('an empty/absent drop folder does nothing', async () => {
    await autoPershingTradesTick();
    assert.strictEqual(tradeCount(), 0);
  });

  await check('first tick stages a new file but does NOT import (stability gate)', async () => {
    dropFile('trades 6-25-2026.csv', tradeCsv([ROW_625]));
    await autoPershingTradesTick();
    assert.strictEqual(tradeCount(), 0, 'a freshly seen file should not import on its first sighting');
    assert.ok(fs.existsSync(path.join(DROP_DIR, 'trades 6-25-2026.csv')), 'file should still be in the drop folder');
  });

  await check('second tick (byte-stable) imports and moves the file to processed/', async () => {
    await autoPershingTradesTick();
    assert.strictEqual(tradeCount(), 1, 'the stable file should now be imported');
    assert.ok(!fs.existsSync(path.join(DROP_DIR, 'trades 6-25-2026.csv')), 'imported file should leave the drop root');
    const processed = path.join(DROP_DIR, 'processed');
    const moved = fs.existsSync(processed) && fs.readdirSync(processed, { recursive: true }).some(p => String(p).endsWith('trades 6-25-2026.csv'));
    assert.ok(moved, 'imported file should be moved under processed/');
    assert.ok(auditEvents().some(e => e.event === 'pershing-trades-auto-import' && e.importedCount === 1), 'no success audit event');
  });

  await check('a changing (still-copying) file is held until it settles', async () => {
    dropFile('trades 6-26-2026.csv', tradeCsv([ROW_626]));
    await autoPershingTradesTick();               // first sighting → pending
    // simulate the copy growing before the next tick
    fs.appendFileSync(path.join(DROP_DIR, 'trades 6-26-2026.csv'), ' ');
    await autoPershingTradesTick();               // fingerprint changed → still held
    assert.strictEqual(tradeCount(), 1, 'a file whose bytes changed must not import yet');
    await autoPershingTradesTick();               // now byte-stable → imports
    assert.strictEqual(tradeCount(), 2, 'the settled file should import on the stable tick');
  });

  await check('re-dropping the same export is idempotent (upsert on trade_key)', async () => {
    dropFile('trades 6-25-2026.csv', tradeCsv([ROW_625]));
    await autoPershingTradesTick();
    await autoPershingTradesTick();
    assert.strictEqual(tradeCount(), 2, 'a re-dropped day must not double-count');
  });

  await check('processed/ and failed/ subfolders are ignored by the scan', async () => {
    const before = tradeCount();
    await autoPershingTradesTick();
    await autoPershingTradesTick();
    assert.strictEqual(tradeCount(), before, 'already-processed files must never re-import');
  });

  await check('a zero-row file is consumed (moved out of root), never left to hot-loop', async () => {
    const before = tradeCount();
    dropFile('empty.csv', '');
    await autoPershingTradesTick();   // first sighting → pending
    await autoPershingTradesTick();   // stable → imports 0 rows, moves out
    assert.ok(!fs.existsSync(path.join(DROP_DIR, 'empty.csv')), 'empty file should leave the drop root');
    assert.strictEqual(tradeCount(), before, 'a zero-row file must not change the trade count');
  });

  // ---- Daily package dropbox side-car (drop trade CSVs alongside offerings/emails) ----
  const { scanFolderDrop } = require('../server/server');
  const today = new Date().toISOString().slice(0, 10);
  const PKG_DROP = path.join(DATA_DIR, 'dropbox', today);
  const PROCESSED = path.join(BANK_REPORTS_DIR, 'incoming', 'pershing-trades', 'processed');

  function dropInPackageFolder(name, body) {
    fs.mkdirSync(PKG_DROP, { recursive: true });
    fs.writeFileSync(path.join(PKG_DROP, name), body, 'utf8');
  }
  function processedHas(name) {
    if (!fs.existsSync(PROCESSED)) return false;
    return fs.readdirSync(PROCESSED, { recursive: true }).some(p => String(p).endsWith(name));
  }

  await check('scanFolderDrop routes a Pershing trade CSV to tradeFiles, a junk CSV to ignored', async () => {
    dropInPackageFolder('trades 6-30-2026.csv', tradeCsv([ROW_630]));
    dropInPackageFolder('notes.csv', 'foo,bar\n1,2\n');   // a non-Pershing CSV
    const scan = scanFolderDrop(null);
    assert.ok((scan.tradeFiles || []).some(f => f.filename === 'trades 6-30-2026.csv'), 'trade CSV should be in tradeFiles');
    assert.ok(!(scan.publishable || []).some(f => f.filename === 'trades 6-30-2026.csv'), 'trade CSV must not be a package slot');
    assert.ok(!(scan.ignored || []).some(f => f.filename === 'trades 6-30-2026.csv'), 'trade CSV must not be ignored');
    assert.ok(!(scan.tradeFiles || []).some(f => f.filename === 'notes.csv'), 'a non-Pershing CSV must not be a trade file');
    assert.ok((scan.ignored || []).some(f => f.filename === 'notes.csv'), 'a non-Pershing CSV should be ignored');
  });

  await check('dropbox side-car imports a trade CSV (stability-gated) and moves it to processed/', async () => {
    const before = tradeCount();
    await autoPublishTick();   // first sighting → pending (no import)
    assert.strictEqual(tradeCount(), before, 'trade CSV must not import on its first dropbox sighting');
    await autoPublishTick();   // byte-stable → imports
    assert.strictEqual(tradeCount(), before + 1, 'the stable dropbox trade CSV should import its one new row');
    assert.ok(!fs.existsSync(path.join(PKG_DROP, 'trades 6-30-2026.csv')), 'imported trade CSV should leave the dropbox folder');
    assert.ok(processedHas('trades 6-30-2026.csv'), 'imported dropbox trade CSV should land under processed/');
  });

  await check('a trade-only drop never publishes a package and leaves the junk CSV alone', async () => {
    const current = path.join(DATA_DIR, 'current');
    const hasPackage = fs.existsSync(current) && fs.readdirSync(current).some(f => /\.(pdf|xlsx|xlsm)$/i.test(f));
    assert.ok(!hasPackage, 'no package should publish from a trade-only drop');
    assert.ok(fs.existsSync(path.join(PKG_DROP, 'notes.csv')), 'a non-trade CSV stays put (it is just ignored)');
  });
}

main().then(() => {
  if (failures) {
    console.error(`pershing-trades-auto-import tests: ${failures} failed`);
    process.exit(1);
  }
  console.log('pershing-trades-auto-import tests: all passed');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}).catch(err => {
  console.error('pershing-trades-auto-import.test.js crashed:', err);
  process.exit(1);
});
