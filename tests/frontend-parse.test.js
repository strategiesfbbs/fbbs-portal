'use strict';

// Parse-check the no-build frontend bundle. There is no build step to catch a
// syntax error in portal.js (or the module files) before it reaches the
// browser, so a stray brace ships as a blank SPA. `new Function` compiles the
// source without executing it — browser globals are never touched.

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function parseCheck(relPath) {
  const fullPath = path.join(__dirname, '..', relPath);
  try {
    // eslint-disable-next-line no-new-func
    new Function(fs.readFileSync(fullPath, 'utf8'));
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL ${relPath} does not parse — ${err.message}`);
  }
}

parseCheck('public/js/portal.js');

const modulesDir = path.join(__dirname, '..', 'public', 'js', 'modules');
if (fs.existsSync(modulesDir)) {
  fs.readdirSync(modulesDir)
    .filter(name => name.endsWith('.js'))
    .forEach(name => parseCheck(path.join('public', 'js', 'modules', name)));
}

console.log(`frontend-parse tests: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
