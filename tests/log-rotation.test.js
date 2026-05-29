'use strict';

// Regression tests for server/log-rotation.js — size-based rotation of the
// append-only audit log. Fresh tmp dir per run; pure fs.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { rotateFileIfNeeded } = require('../server/log-rotation');

let passed = 0;
let failed = 0;
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-log-rotation-'));
const f = path.join(tmpDir, 'audit.log');
try {
  // Missing file → nothing to rotate.
  ok('missing file → false', rotateFileIfNeeded(f, { maxBytes: 10 }) === false);

  // Under the cap → no rotation, file untouched.
  fs.writeFileSync(f, 'abc');
  ok('under cap → false', rotateFileIfNeeded(f, { maxBytes: 100 }) === false);
  ok('under cap → file kept', fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'abc');

  // At/over the cap → active moves to .1 and the active path is freed.
  fs.writeFileSync(f, 'x'.repeat(100));
  ok('over cap → true', rotateFileIfNeeded(f, { maxBytes: 100, keep: 3 }) === true);
  ok('active freed', !fs.existsSync(f));
  ok('.1 holds the rotated content', fs.existsSync(`${f}.1`) && fs.readFileSync(`${f}.1`, 'utf8').length === 100);

  // The next append recreates a fresh active file (simulating appendAuditLog).
  fs.appendFileSync(f, 'new\n');
  ok('append recreates fresh active', fs.readFileSync(f, 'utf8') === 'new\n');

  // Backup shifting: active→.1, .1→.2, .2→.3, oldest (.3 at keep=3) dropped.
  fs.writeFileSync(f, 'A'.repeat(100));
  fs.writeFileSync(`${f}.1`, 'one');
  fs.writeFileSync(`${f}.2`, 'two');
  fs.writeFileSync(`${f}.3`, 'three'); // oldest at keep=3 → should be dropped
  rotateFileIfNeeded(f, { maxBytes: 100, keep: 3 });
  ok('active → .1', fs.readFileSync(`${f}.1`, 'utf8') === 'A'.repeat(100));
  ok('old .1 → .2', fs.readFileSync(`${f}.2`, 'utf8') === 'one');
  ok('old .2 → .3', fs.readFileSync(`${f}.3`, 'utf8') === 'two');
  ok('oldest dropped (no .4)', !fs.existsSync(`${f}.4`));

  // maxBytes 0/undefined → disabled, never rotates.
  fs.writeFileSync(f, 'y'.repeat(100));
  ok('maxBytes 0 → false', rotateFileIfNeeded(f, { maxBytes: 0 }) === false);
  ok('no opts → false', rotateFileIfNeeded(f) === false);

  console.log(`log-rotation tests: ${passed} passed, ${failed} failed.`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
