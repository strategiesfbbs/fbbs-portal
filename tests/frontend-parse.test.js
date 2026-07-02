'use strict';

// Parse-check the no-build frontend bundle. There is no build step to catch a
// syntax error in portal.js (or the module files) before it reaches the
// browser, so a stray brace ships as a blank SPA. `new Function` compiles the
// source without executing it — browser globals are never touched.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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

function testRoutePreservation() {
  const relPath = 'public/js/portal.js';
  const source = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const match = source.match(/const\s+VALID_PAGES\s*=\s*\[([\s\S]*?)\];/);
  try {
    assert.ok(match, 'VALID_PAGES constant not found');
    const actual = Array.from(match[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
    const expected = [
      'home', 'exec-summary', 'daily-intelligence', 'pulse', 'mmd', 'treasuryNotes', 'cd', 'cdoffers', 'munioffers',
      'sales-dashboard', 'all-offerings', 'watchlist', 'treasury-explorer',
      'cd-recap', 'cd-internal', 'explorer', 'muni-explorer', 'agencies', 'corporates',
      'mbs-cmo', 'structured-notes', 'market-color', 'banks', 'contacts', 'account-activity', 'maps', 'reports', 'peer-groups', 'maturity-calendar', 'cd-rollover', 'strategies', 'bond-swap', 'views', 'archive', 'upload', 'package-qa', 'admin'
    ];
    assert.deepStrictEqual(actual, expected);
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL ${relPath} route preservation contract — ${err.message}`);
  }
}

testRoutePreservation();

function testNavModelUsesValidPages() {
  const relPath = 'public/js/portal.js';
  const source = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const validMatch = source.match(/const\s+VALID_PAGES\s*=\s*\[([\s\S]*?)\];/);
  const groupsMatch = source.match(/const\s+NAV_GROUPS\s*=\s*\[([\s\S]*?)\];\n\n  const NAV_OFF_SIDEBAR_ITEMS/);
  const hiddenMatch = source.match(/const\s+NAV_OFF_SIDEBAR_ITEMS\s*=\s*\[([\s\S]*?)\];\n\n  const NAV_GROUP_LABEL_BY_KEY/);
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  try {
    assert.ok(validMatch, 'VALID_PAGES constant not found');
    assert.ok(groupsMatch, 'NAV_GROUPS constant not found');
    assert.ok(hiddenMatch, 'NAV_OFF_SIDEBAR_ITEMS constant not found');
    const navMatch = indexSource.match(/<nav\b[^>]*class="[^"]*\bsidebar-nav\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(navMatch && /id="sidebarNav"/.test(navMatch[0]), 'sidebarNav mount not found');
    assert.ok(!/\bdata-(?:page|goto)=/.test(navMatch[1]), 'static sidebar navigation links should not be hand-authored');
    const valid = new Set(Array.from(validMatch[1].matchAll(/'([^']+)'/g)).map(m => m[1]));
    const visiblePages = Array.from(groupsMatch[1].matchAll(/page:\s*'([^']+)'/g)).map(m => m[1]);
    const hiddenPages = Array.from(hiddenMatch[1].matchAll(/page:\s*'([^']+)'/g)).map(m => m[1]);
    const navPages = new Set(visiblePages.concat(hiddenPages));
    const invalid = Array.from(navPages).filter(page => !valid.has(page));
    const orphaned = Array.from(valid).filter(page => !navPages.has(page));
    assert.deepStrictEqual(invalid, []);
    assert.deepStrictEqual(orphaned, []);
    assert.ok(visiblePages.includes('all-offerings'), 'visible nav should include All Offerings');
    assert.ok(hiddenPages.includes('cdoffers'), 'off-sidebar nav should preserve raw CD offers route');
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL ${relPath} nav model contract — ${err.message}`);
  }
}

testNavModelUsesValidPages();

function testPlotlyIsLazyLoaded() {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  const portalSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/portal.js'), 'utf8');
  try {
    assert.ok(!/<script\s+src="\/vendor\/plotly-2\.27\.0\.min\.js"/.test(indexSource), 'Plotly should not be loaded globally');
    assert.ok(portalSource.includes("const PLOTLY_SRC = '/vendor/plotly-2.27.0.min.js'"), 'Plotly lazy loader source not found');
    assert.ok(/function\s+ensurePlotlyLoaded\s*\(/.test(portalSource), 'ensurePlotlyLoaded missing');
    assert.ok(/ensurePlotlyLoaded\(\)\s*\n\s*\.then\(\(\)\s*=>\s*renderMapsMarkerMap/.test(portalSource), 'map render should trigger lazy Plotly load');
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL Plotly lazy-load contract — ${err.message}`);
  }
}

testPlotlyIsLazyLoaded();

const modulesDir = path.join(__dirname, '..', 'public', 'js', 'modules');
if (fs.existsSync(modulesDir)) {
  fs.readdirSync(modulesDir)
    .filter(name => name.endsWith('.js'))
    .forEach(name => parseCheck(path.join('public', 'js', 'modules', name)));
}

console.log(`frontend-parse tests: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
