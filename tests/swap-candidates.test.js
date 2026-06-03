'use strict';

const assert = require('assert');
const { findSwapCandidates, formatSwapCandidateLine } = require('../server/server');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

function emptyInventory() {
  return {
    asOfDate: '2026-06-02',
    rows: {
      agencies: [],
      treasuries: [],
      munis: [],
      stateMunis: [],
      cds: [],
      corporates: []
    }
  };
}

test('findSwapCandidates still creates generic reinvestment ideas without inventory rows', () => {
  const parsedHoldings = {
    sectors: {
      Agency: [{
        cusip: '3130TEST1',
        description: 'FHLB low coupon',
        par: 1_000_000,
        bookValue: 1_000_000,
        marketValue: 995_000,
        gainLoss: -5_000,
        bookYieldYtm: 3.0,
        marketYieldYtm: 4.25,
        maturity: '2031-06-15',
        averageLife: 4.5,
        accruedInterest: 0
      }]
    }
  };

  const result = findSwapCandidates(parsedHoldings, emptyInventory(), {
    includeRejected: true,
    reinvestRate: 5,
    minParThousands: 100,
    maxPctLoss: 4,
    maxDollarLoss: 10
  });

  assert.strictEqual(result.kept.length, 1);
  assert.strictEqual(result.kept[0].offering.generic, true);
  assert.strictEqual(result.kept[0].offering.sourceRef, 'reinvest-target');
  assert.strictEqual(result.kept[0].yieldPickupVsBook, null);
  assert.strictEqual(result.kept[0].pickupVsReinvest, 2);
  assert.ok(result.kept[0].addedAnnualIncome > 0);
});

test('formatSwapCandidateLine handles generic reinvestment ideas', () => {
  const [candidate] = findSwapCandidates({
    sectors: {
      Corporate: [{
        cusip: 'CORPTEST1',
        description: 'Corporate low coupon',
        par: 500_000,
        bookValue: 500_000,
        marketValue: 498_000,
        gainLoss: -2_000,
        bookYieldYtm: 3.75,
        marketYieldYtm: 4.5,
        maturity: '2030-01-15'
      }]
    }
  }, emptyInventory(), {
    reinvestRate: 5,
    minParThousands: 100,
    maxPctLoss: 4,
    maxDollarLoss: 10
  });

  const line = formatSwapCandidateLine(candidate);
  assert.match(line, /Reinvest at 5\.00% target/);
  assert.match(line, /\+1\.25% vs reinvest target/);
});

console.log(`swap-candidates tests: ${passed} passed.`);
