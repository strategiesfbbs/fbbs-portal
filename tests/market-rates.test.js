// Tests for server/market-rates.js — Treasury daily par yield curve.
// Pure parse + cache behavior with an injected fetch; no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const marketRates = require('../server/market-rates');

function entryXml(date, fields) {
  const props = Object.entries(fields)
    .map(([k, v]) => `<d:${k} m:type="Edm.Double">${v}</d:${k}>`)
    .join('\n');
  return `<entry>\n<content type="application/xml">\n<m:properties>\n<d:Id m:type="Edm.Int32">1</d:Id>\n<d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>\n${props}\n</m:properties>\n</content>\n</entry>`;
}

const FIXTURE = `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns="http://www.w3.org/2005/Atom">\n<title type="text">DailyTreasuryYieldCurveRateData</title>\n${entryXml('2026-06-08', { BC_1MONTH: '3.70', BC_3MONTH: '3.64', BC_2YEAR: '3.50', BC_5YEAR: '3.78', BC_10YEAR: '4.21', BC_30YEAR: '4.88', BC_30YEARDISPLAY: '4.88' })}\n${entryXml('2026-06-09', { BC_1MONTH: '3.72', BC_3MONTH: '3.65', BC_2YEAR: '3.47', BC_5YEAR: '3.74', BC_10YEAR: '4.19', BC_30YEAR: '4.86', BC_30YEARDISPLAY: '4.86' })}\n</feed>`;

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok: ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL: ${label}\n    ${err.message}`);
  }
}

console.log('market-rates.test.js');

check('parseYieldCurveXml extracts dated tenor entries in date order', () => {
  const entries = marketRates.parseYieldCurveXml(FIXTURE);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].date, '2026-06-08');
  assert.strictEqual(entries[1].date, '2026-06-09');
  assert.strictEqual(entries[1].tenors['2Y'], 3.47);
  assert.strictEqual(entries[1].tenors['10Y'], 4.19);
  // 6-week bill field is skipped; display duplicate of 30Y is not a tenor
  assert.strictEqual(entries[1].tenors['1.5M'], undefined);
});

check('parseYieldCurveXml tolerates junk input', () => {
  assert.deepStrictEqual(marketRates.parseYieldCurveXml(''), []);
  assert.deepStrictEqual(marketRates.parseYieldCurveXml('<html>not a feed</html>'), []);
  assert.deepStrictEqual(marketRates.parseYieldCurveXml(null), []);
});

check('buildCurveResponse computes day-over-day changes', () => {
  const entries = marketRates.parseYieldCurveXml(FIXTURE);
  const curve = marketRates.buildCurveResponse(entries, { fetchedAt: '2026-06-10T12:00:00Z' });
  assert.strictEqual(curve.asOfDate, '2026-06-09');
  assert.strictEqual(curve.previous.asOfDate, '2026-06-08');
  assert.strictEqual(curve.changes['2Y'], -0.03);
  assert.strictEqual(curve.changes['30Y'], -0.02);
  assert.strictEqual(curve.stale, false);
  assert.ok(curve.tenorOrder.indexOf('1M') < curve.tenorOrder.indexOf('30Y'));
});

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-market-rates-'));

  await (async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: true, text: async () => FIXTURE }; };

    const first = await marketRates.getLatestYieldCurve({ marketDir: tmpDir, fetchImpl, now: Date.parse('2026-06-10T12:00:00Z') });
    check('getLatestYieldCurve fetches and returns the latest curve', () => {
      assert.strictEqual(first.asOfDate, '2026-06-09');
      assert.strictEqual(calls, 1);
      assert.ok(fs.existsSync(path.join(tmpDir, 'treasury-yield-curve.json')));
    });

    const second = await marketRates.getLatestYieldCurve({ marketDir: tmpDir, fetchImpl, now: Date.parse('2026-06-10T13:00:00Z') });
    check('a fresh cache is served without refetching', () => {
      assert.strictEqual(second.asOfDate, '2026-06-09');
      assert.strictEqual(calls, 1);
    });

    const failing = async () => { throw new Error('network down'); };
    const stale = await marketRates.getLatestYieldCurve({ marketDir: tmpDir, fetchImpl: failing, now: Date.parse('2026-06-11T12:00:00Z') });
    check('an expired cache is served stale when the fetch fails', () => {
      assert.strictEqual(stale.asOfDate, '2026-06-09');
      assert.strictEqual(stale.stale, true);
    });

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-market-rates-empty-'));
    const none = await marketRates.getLatestYieldCurve({ marketDir: emptyDir, fetchImpl: failing, now: Date.parse('2026-06-11T12:00:00Z') });
    check('no cache + failed fetch returns null (never throws)', () => {
      assert.strictEqual(none, null);
    });
  })();

  if (failures) {
    console.error(`market-rates.test.js: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('market-rates.test.js: all passed');
})();
