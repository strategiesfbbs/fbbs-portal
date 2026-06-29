'use strict';

const assert = require('assert');
const { renderOfferingSheetHtml, offeringLine } = require('../server/offering-sheet-render');

const row = {
  assetClass: 'Muni',
  type: 'muni',
  description: 'City of Sample Water Revenue',
  cusip: '123456AB7',
  coupon: 4,
  yield: 3.72,
  maturity: '2032-08-01',
  price: 101.25,
  availabilityK: 500,
  state: 'MO',
  sector: 'BQ',
  taxStatus: 'BQ',
  bq: true,
  moody: 'Aa2',
  sp: 'AA-',
  callDate: '2029-08-01'
};

const html = renderOfferingSheetHtml({
  packageDate: '2026-06-26',
  audience: 'ccorp',
  offerings: [row]
}, { generatedAt: '2026-06-26T12:00:00Z' });

assert.ok(html.startsWith('<!doctype html>'), 'renders a standalone HTML document');
assert.ok(html.includes('FBBS Offering Sheet'), 'includes FBBS branding');
assert.ok(html.includes('City of Sample Water Revenue'), 'includes offering description');
assert.ok(html.includes('123456AB7'), 'includes CUSIP');
assert.ok(html.includes('3.720%'), 'formats yield');
assert.ok(html.includes('C-corp bank'), 'labels audience');
assert.ok(html.includes('For Institutional Use Only'), 'includes institutional disclosure');
assert.ok(!html.includes('<script'), 'does not emit scripts');

const line = offeringLine(row);
assert.ok(line.includes('CUSIP 123456AB7'), 'line contains labeled CUSIP');
assert.ok(line.includes('4.000% coupon'), 'line formats coupon');

console.log('offering-sheet-render tests passed');
