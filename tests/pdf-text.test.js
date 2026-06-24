'use strict';

// Characterization tests for server/pdf-text.js' custom pdf-parse page renderer.
// The fixture is synthetic: it exercises the text-item spacing and Y-tolerance
// logic without needing a real PDF file.

const assert = require('assert');
const { _renderPageForTest } = require('../server/pdf-text');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function page(items) {
  return {
    getTextContent() {
      return Promise.resolve({ items });
    }
  };
}

function item(str, x, y, width) {
  return { str, width, transform: [1, 0, 0, 1, x, y] };
}

test('inserts spaces between adjacent same-line text runs with an x gap', async () => {
  const text = await _renderPageForTest(page([
    item('CUSIP', 10, 700, 34),
    item('YIELD', 60, 700, 38),
    item('PRICE', 115, 700, 34)
  ]));
  assert.strictEqual(text, 'CUSIP YIELD PRICE');
});

test('groups fractional baseline shifts within the Y tolerance into one row', async () => {
  const text = await _renderPageForTest(page([
    item('Bank', 10, 700.0, 28),
    item('Name', 42, 699.3, 30),
    item('Next', 10, 697.8, 24)
  ]));
  assert.strictEqual(text, 'Bank Name\nNext');
});

test('preserves explicit spaces and separates wrapped-back same-line text', async () => {
  const text = await _renderPageForTest(page([
    item('ABC', 40, 700, 20),
    item(' DEF', 65, 700, 28),
    item('LEFT', 10, 700, 26)
  ]));
  assert.strictEqual(text, 'ABC DEF LEFT');
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(err.stack || err.message);
      process.exitCode = 1;
    }
  }
  console.log(`pdf-text tests: ${passed} passed.`);
})();
