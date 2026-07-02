'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getThcSummaryForBank,
  getThcSummaryStatus,
  importThcSummaryPayload,
  loadThcSummaryManifest,
  sanitizeThcSummaryManifest
} = require('../server/thc-summary-store');

function tempReportsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-thc-summary-'));
}

const bankSummaries = [
  { id: 'bank-1', displayName: 'First Example Bank', certNumber: '12345' },
  { id: 'bank-2', displayName: 'Second Example Bank', certNumber: '67890' }
];

{
  const dir = tempReportsDir();
  const manifest = importThcSummaryPayload(dir, {
    records: [
      {
        certNumber: '12345',
        cycle: '2026Q1',
        asOfDate: '2026-03-31',
        reportStatus: {
          alm: { status: 'Ready', date: '2026-04-15' },
          incomeRisk: { status: 'Ready', date: '2026-04-15' },
          liquidity: 'Delivered',
          cecl: 'Needs refresh',
          bondAccounting: 'Delivered',
          tradeSimulation: { status: 'Pending', link: 'https://thc.example/sim' }
        },
        metrics: {
          bookValue: '$1,000,000',
          marketValue: '990000',
          gainLossPct: '-1.00%',
          bookYield: '4.25%',
          niiAtRiskPct: '-3.2%',
          eveAtRiskPct: '-6.4%'
        },
        sectorAllocation: [{ label: 'Municipals', marketValue: 500000, pct: 50 }],
        scenarioResults: [{ kind: 'EVE', shockBp: 100, metric: 'MV', pctChange: -3.2, policyLimit: -10, change: -25000, status: 'Within policy' }],
        tradeSimulation: {
          id: 'SIM-100',
          status: 'Ready',
          summary: 'Use ladder extension scenario for rep discussion.',
          impact: { yieldPickupBp: 35, durationDelta: -0.2, annualIncome: 15000, parTraded: 750000, lotsAffectedCount: 4, withinPolicyAfter: true }
        },
        adminLink: 'https://thc.example/banks/12345'
      },
      { bankId: 'unknown-bank', bankName: 'Unmatched Bank', cycle: '2026Q1' }
    ]
  }, { bankSummaries, sourceFile: 'thc-safe.json' });

  assert.strictEqual(manifest.recordCount, 2);
  assert.strictEqual(manifest.matchedCount, 1);
  assert.strictEqual(manifest.unmatchedCount, 1);

  const loaded = loadThcSummaryManifest(dir);
  assert.strictEqual(loaded.sourceFile, 'thc-safe.json');

  const status = getThcSummaryStatus(dir);
  assert.strictEqual(status.available, true);
  assert.strictEqual(status.matchedCount, 1);

  const summary = getThcSummaryForBank(dir, { id: 'bank-1', certNumber: '12345' });
  assert(summary.available);
  assert.strictEqual(summary.bankDisplayName, 'First Example Bank');
  assert.strictEqual(summary.reportStatus.alm.status, 'Ready');
  assert.strictEqual(summary.reportStatus.incomeRisk.status, 'Ready');
  assert.strictEqual(summary.reportStatus.liquidity.status, 'Ready');
  assert.strictEqual(summary.reportStatus.cecl.status, 'Needs Refresh');
  assert.strictEqual(summary.reportStatus.bondAccounting.status, 'Ready');
  assert.strictEqual(summary.tradeSimulation.status, 'Ready');
  assert.strictEqual(summary.tradeSimulation.impact.yieldPickupBp, 35);
  assert.strictEqual(summary.metrics.niiAtRiskPct, -3.2);
  assert.strictEqual(summary.scenarioResults[0].kind, 'EVE');
  assert.strictEqual(summary.metrics.bookValue, 1000000);
  assert.strictEqual(summary.metrics.unrealizedGainLossPct, -1);

  const adminSummary = getThcSummaryForBank(dir, { id: 'bank-1', certNumber: '12345' }, { includeAdminLinks: true });
  assert.strictEqual(adminSummary.adminLink, 'https://thc.example/banks/12345');
  assert.strictEqual(adminSummary.reportStatus.tradeSimulation.link, 'https://thc.example/sim');

  const sanitizedManifest = sanitizeThcSummaryManifest(loaded);
  assert.strictEqual(sanitizedManifest.records[0].adminLink, undefined);
  assert.strictEqual(sanitizedManifest.records[0].reportStatus.tradeSimulation.link, undefined);
}

// Regression [thc-reports#1]: snake_case THC module keys must resolve through
// the alias table (the lookup used to index the alias map by the canonical
// name, so income_risk / bond_accounting / trade_simulation silently vanished).
{
  const dir = tempReportsDir();
  const manifest = importThcSummaryPayload(dir, {
    records: [{
      certNumber: '12345',
      cycle: '2026Q1',
      reportStatus: {
        income_risk: { status: 'Ready', date: '2026-04-15' },
        bond_accounting: 'Delivered',
        trade_simulation: { status: 'Pending' },
        alm: { status: 'Ready' }
      }
    }]
  }, { bankSummaries, sourceFile: 'thc-snake.json' });
  const record = manifest.records[0];
  assert.strictEqual(record.reportStatus.incomeRisk.status, 'Ready');
  assert.strictEqual(record.reportStatus.incomeRisk.date, '2026-04-15');
  assert.strictEqual(record.reportStatus.bondAccounting.status, 'Ready');
  assert.strictEqual(record.reportStatus.tradeSimulation.status, 'In Progress');
  assert.strictEqual(record.reportStatus.alm.status, 'Ready');
}

{
  const dir = tempReportsDir();
  assert.throws(() => {
    importThcSummaryPayload(dir, {
      records: [{ certNumber: '12345', holdings: [{ cusip: '123456AA1' }] }]
    }, { bankSummaries });
  }, /forbidden raw-detail field/);
}

{
  const dir = tempReportsDir();
  assert.throws(() => {
    importThcSummaryPayload(dir, {
      records: [{ certNumber: '12345', summary: 'Review CUSIP 91282CJL6 for swap.' }]
    }, { bankSummaries });
  }, /forbidden CUSIP-like value/);
}

{
  const dir = tempReportsDir();
  assert.throws(() => {
    importThcSummaryPayload(dir, {
      records: [{ certNumber: '12345', summary: 'See account 123456789 before calling.' }]
    }, { bankSummaries });
  }, /forbidden account\/safekeeping-like value/);
}

// [thc-reports#3]: dry run collects EVERY violation (with the offending
// record's bank identity) and writes nothing; a real import of the same
// payload still hard-rejects, carrying the full violation list on the error.
{
  const dir = tempReportsDir();
  const payload = {
    records: [
      { certNumber: '12345', bankName: 'First Example Bank', summary: 'Review CUSIP 91282CJL6 for swap.' },
      { certNumber: '67890', bankName: 'Second Example Bank', cycle: '2026Q1' },
      { certNumber: '99999', bankName: 'Third Bank', holdings: [{ cusip: '123456AA1' }] }
    ]
  };
  const preview = importThcSummaryPayload(dir, payload, { bankSummaries, dryRun: true });
  assert.strictEqual(preview.dryRun, true);
  assert.ok(preview.violations.length >= 2, 'collects more than the first violation');
  const paths = preview.violations.map(v => v.path);
  assert.ok(paths.includes('records.[0].summary'), paths.join(', '));
  assert.ok(paths.some(p => p.startsWith('records.[2].holdings')), paths.join(', '));
  const cusipViolation = preview.violations.find(v => v.path === 'records.[0].summary');
  assert.strictEqual(cusipViolation.bankName, 'First Example Bank');
  assert.strictEqual(cusipViolation.certNumber, '12345');
  assert.strictEqual(cusipViolation.recordIndex, 0);
  assert.strictEqual(preview.recordCount, 3);
  assert.strictEqual(preview.matchedCount, 2);
  assert.strictEqual(preview.unmatchedCount, 1);
  assert.strictEqual(loadThcSummaryManifest(dir), null, 'dry run writes nothing');

  assert.throws(() => {
    importThcSummaryPayload(dir, payload, { bankSummaries });
  }, err => err.statusCode === 400
    && /THC summary import rejected/.test(err.message)
    && Array.isArray(err.violations)
    && err.violations.length === preview.violations.length);
  assert.strictEqual(loadThcSummaryManifest(dir), null, 'rejected import writes nothing');

  // A clean dry run reports zero violations and still writes nothing.
  const clean = importThcSummaryPayload(dir, {
    records: [{ certNumber: '12345', cycle: '2026Q1', reportStatus: { alm: 'Ready' } }]
  }, { bankSummaries, dryRun: true });
  assert.deepStrictEqual(clean.violations, []);
  assert.strictEqual(clean.matchedCount, 1);
  assert.strictEqual(loadThcSummaryManifest(dir), null, 'clean dry run writes nothing');
}

console.log('thc-summary-store tests passed');
