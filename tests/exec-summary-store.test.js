'use strict';

// Executive Summary calc-engine + store tests. Plain node assert, no framework
// (matches report-store.test.js / store-smoke.test.js). Run: node tests/exec-summary-store.test.js
//
// Uses synthetic parsed inputs (NOT the real Bloomberg/margin files) so the
// suite is hermetic and runs anywhere. The parser is exercised against real
// fixtures separately during development.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../server/exec-summary-store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-summary-test-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { console.error(`FAIL ${name}\n     ${err.message}`); process.exitCode = 1; }
}

// ---- synthetic parsed sources -------------------------------------------------
function sources(overrides = {}) {
  return Object.assign({
    inventory: {
      warnings: [],
      securities: [
        { security: 'BOND A', cusip: '11111AAA1', sector: 'Corp', position: 1000, bidPrice: 100, bidYield: 5, spread: 50, risk: 8, pnl: 200, mktValue: 1000000 },
        { security: 'BOND B', cusip: '22222BBB2', sector: 'Corp', position: 500, bidPrice: 99, risk: 4, pnl: -100, mktValue: 495000 },
        { security: 'GOVT C', cusip: '33333CCC3', sector: 'Govt', position: -200, bidPrice: 98, risk: 2, pnl: -50, mktValue: -196000 },
        { security: 'MUNI D', cusip: '44444DDD4', sector: 'Muni', position: 300, bidPrice: 101, risk: 5, pnl: 75, mktValue: 303000 },
        { security: 'UNPRICED E', cusip: '55555EEE5', sector: 'Corp', position: 100, bidPrice: null, risk: 1, pnl: 0, mktValue: null },
      ],
      sectorTotals: [{ label: 'Corp' }, { label: 'Govt' }, { label: 'Muni' }],
      grandTotal: { label: 'USD Total', pnl: 125 },
      asOfDate: null,
    },
    activity: {
      warnings: [], asOfDate: '2026-06-04',
      trades: [
        { trader: '80-CORP', type: 'TT', ticket: '1', cusip: '11111AAA1', buySell: 'B', amount: 1000, price: 100, counterparty: 'CP-X', salesperson: 'F57', txnCost1: 300, txnCost2: 100, revenue: 400, principal: 1000000, customerType: 'CUST' },
        { trader: '80-CORP', type: 'TT', ticket: '2', cusip: '22222BBB2', buySell: 'S', amount: 500, price: 99, counterparty: 'CP-Y', salesperson: 'F57', txnCost1: 150, txnCost2: 0, revenue: 150, principal: 495000, customerType: 'DEALER' },
        { trader: '08-TRSY', type: 'TT', ticket: '3', cusip: '33333CCC3', buySell: 'S', amount: 200, price: 98, counterparty: 'CP-Z', salesperson: 'F61', txnCost1: 50, txnCost2: 0, revenue: 50, principal: 196000, customerType: 'UNSPECIFIED' },
      ],
    },
    sector: {
      warnings: [], asOfDate: '2026-06-04', cusipCount: 4,
      byCusip: {
        '11111AAA1': { cusip: '11111AAA1', issuer: 'JPMORGAN CHASE & CO', marketSector: 'Corp', duration: 5 },
        '22222BBB2': { cusip: '22222BBB2', issuer: 'ACME CORP', marketSector: 'Corp', duration: 3 },
        '33333CCC3': { cusip: '33333CCC3', issuer: 'US TREASURY', marketSector: 'Govt', duration: 7 },
        '44444DDD4': { cusip: '44444DDD4', issuer: 'SOME CITY', marketSector: 'Muni', duration: 6 },
      },
    },
    margin: {
      warnings: [], preparedDate: '2026-06-04', cobDate: '2026-06-03', asOfDate: '2026-06-04',
      capital: {
        firmHaircutTotal: 5000000, nonHaircutAdj: -100000, approvedIssuerAdj: -2000000,
        totalRequirement: 1000000, totalEquity: 1500000, sdNetworth: 1510000,
        excessCall: 500000, bufferPct: 500000 / 1500000, pershingExcess: 500000, pershingVariance: 0, netExcessCall: 500000,
      },
      approvedIssuers: [{ name: 'JP MORGAN CHASE', factor: 0.2 }, { name: 'FHLB', factor: 0 }],
      haircuts: [
        { cusip: '11111AAA1', mktValue: 1000000, haircut: 150000, ageDays: 5 },
        { cusip: '22222BBB2', mktValue: 495000, haircut: 60000, ageDays: 45 },
        { cusip: '33333CCC3', mktValue: 196000, haircut: 3000, ageDays: 90 },
        { cusip: '44444DDD4', mktValue: 303000, haircut: 9000, ageDays: 10 },
      ],
      unpriced: [], positionsByAccount: [], accountTypes: { '7R8-891198': 'PRINCIPAL TRADING ACCOUNT' },
      recentDiscrepancies: [{ date: '2026-05-12', note: 'BENEFIT' }], discrepancyCount: 1,
    },
  }, overrides);
}

// ---- calc engine --------------------------------------------------------------
test('capital metrics + buffer pass through', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.asOfDate, '2026-06-03');
  assert.strictEqual(s.cobDate, '2026-06-03');
  assert.strictEqual(s.preparedDate, '2026-06-04');
  assert.strictEqual(s.capital.excessCall, 500000);
  assert.ok(Math.abs(s.capital.bufferPct - 1 / 3) < 1e-6);
});

test('risk: MV / DV01 / sector grouping (signed shorts included)', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.risk.totalMktValue, 1602000); // 1.0M + 495K - 196K + 303K
  assert.strictEqual(s.risk.portfolioDv01, 20);      // 8+4+2+5+1
  const govt = s.risk.bySector.find(x => x.sector === 'Govt');
  assert.strictEqual(govt.mktValue, -196000);
});

test('pnl reconciles and worst sector identified', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.pnl.unrealizedTotal, 125); // 200-100-50+75+0
});

test('revenue: day total, by desk and rep', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.revenue.dayTotal, 600);
  assert.strictEqual(s.revenue.bySalesperson[0].code, 'F57');
  assert.strictEqual(s.revenue.bySalesperson[0].revenue, 550);
  assert.strictEqual(s.revenue.byDesk[0].code, '80-CORP');
});

test('customer vs dealer split is complementary', () => {
  const s = store.computeExecSummary(sources());
  const f = s.activity.customerFlow;
  assert.ok(Math.abs((f.customerPct + f.dealerPct) - 1) < 1e-6);
  assert.ok(Math.abs(f.customerPct - 1000000 / 1691000) < 1e-4);
  assert.strictEqual(s.activity.ticketCount, 3);
});

test('approved-issuer fuzzy match flags JPMorgan (JP MORGAN CHASE ~ JPMORGAN CHASE & CO)', () => {
  const s = store.computeExecSummary(sources());
  const top = s.capitalEfficiency.topIssuersByRequirement[0];
  assert.strictEqual(top.requirement, 150000);
  assert.ok(/JPMORGAN/.test(top.issuer));
  assert.strictEqual(top.approvedIssuer, true);
  assert.strictEqual(s.capitalEfficiency.approvedIssuerSavings, 2000000);
});

test('exceptions: aged threshold, concentration, unpriced', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.exceptions.aged.count, 2);          // 45d + 90d
  assert.strictEqual(s.exceptions.aged.totalHaircut, 63000);
  assert.strictEqual(s.exceptions.unpriced.count, 1);      // UNPRICED E
  assert.strictEqual(s.exceptions.netCapProximity.breach, false); // 33% > 10%
  assert.ok(s.exceptions.concentration.breaches.length >= 1);     // JPMorgan 62%
});

test('net-cap proximity breach when buffer below floor', () => {
  const src = sources();
  src.margin.capital.totalEquity = 1000000;
  src.margin.capital.excessCall = 50000;
  src.margin.capital.bufferPct = 0.05; // below 10% floor
  const s = store.computeExecSummary(src);
  assert.strictEqual(s.exceptions.netCapProximity.breach, true);
  assert.ok(s.narrative.watchItems.some(w => /buffer/i.test(w)));
});

test('pershing variance breach surfaces in watch items', () => {
  const src = sources();
  src.margin.capital.pershingVariance = 25000;
  const s = store.computeExecSummary(src);
  assert.strictEqual(s.exceptions.pershingVariance.breach, true);
  assert.ok(s.narrative.watchItems.some(w => /Pershing/i.test(w)));
});

test('narrative leads with capital and is non-empty', () => {
  const s = store.computeExecSummary(sources());
  assert.ok(/Net capital excess/.test(s.narrative.text));
  assert.ok(Array.isArray(s.narrative.watchItems) && s.narrative.watchItems.length >= 1);
});

test('day-over-day deltas computed against a prior snapshot', () => {
  const prior = { capital: { excessCall: 400000, totalRequirement: 1100000, bufferPct: 0.30 }, risk: { totalMktValue: 1500000 }, pnl: { unrealizedTotal: 0 }, revenue: { dayTotal: 100 } };
  const s = store.computeExecSummary(sources(), { prior });
  assert.strictEqual(s.capital.deltas.excessCall, 100000);    // 500k - 400k
  assert.strictEqual(s.capital.deltas.totalRequirement, -100000);
  assert.strictEqual(s.kpis.inventoryMV.deltaDay, 102000);    // 1.602M - 1.5M
});

test('null/empty market -> overlay null; empty trades does not throw', () => {
  assert.strictEqual(store.computeExecSummary(sources()).marketOverlay, null);
  const src = sources({});
  src.activity = { warnings: [], asOfDate: '2026-06-04', trades: [] };
  const s = store.computeExecSummary(src);
  assert.strictEqual(s.revenue.dayTotal, 0);
  assert.strictEqual(s.activity.ticketCount, 0);
});

test('market overlay derives 2s10s when curve present', () => {
  const src = sources();
  src.market = { ust: { ust_2y: 4.0, ust_10y: 4.5 }, sofr: 5.3, ig_oas: 90, hy_oas: 320 };
  const s = store.computeExecSummary(src);
  assert.strictEqual(s.marketOverlay.curve2s10s, 50); // (4.5-4.0)*100 bp
  assert.strictEqual(s.marketOverlay.igOas, 90);
});

// ---- persistence --------------------------------------------------------------
test('ensureDatabase creates the sqlite file', () => {
  const dbPath = store.ensureDatabase(tmp);
  assert.ok(fs.existsSync(dbPath));
});

test('save -> get round-trip + dated JSON copy', () => {
  const s = store.computeExecSummary(sources());
  store.saveSnapshot(tmp, s, { sourceFiles: ['a.xlsx'] });
  const got = store.getSnapshot(tmp, '2026-06-03');
  assert.strictEqual(got.capital.excessCall, 500000);
  assert.strictEqual(got.revenue.dayTotal, 600);
  assert.ok(fs.existsSync(path.join(tmp, '_2026-06-03.json')));
});

test('idempotent upsert: re-save same date keeps one row', () => {
  const s = store.computeExecSummary(sources());
  store.saveSnapshot(tmp, s);
  store.saveSnapshot(tmp, s);
  assert.strictEqual(store.listSnapshots(tmp).filter(r => r.asOfDate === '2026-06-03').length, 1);
});

test('COB date controls snapshot identity when prepared date differs', () => {
  const s = store.computeExecSummary(sources());
  assert.strictEqual(s.asOfDate, s.cobDate);
  assert.notStrictEqual(s.asOfDate, s.preparedDate);
});

test('legacy prepared-date row is readable by COB and replaced by canonical COB save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-legacy-cob-'));
  const canonical = store.computeExecSummary(sources());
  const legacy = Object.assign({}, canonical, { asOfDate: canonical.preparedDate });
  store.saveSnapshot(dir, legacy);
  assert.strictEqual(store.getSnapshot(dir, canonical.cobDate).asOfDate, canonical.preparedDate);

  store.saveSnapshot(dir, canonical);
  const rows = store.listSnapshots(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].asOfDate, canonical.cobDate);
  assert.strictEqual(store.getSnapshot(dir, canonical.preparedDate), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('prior snapshot + month-to-date revenue queries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-mtd-'));
  store.saveSnapshot(dir, Object.assign(store.computeExecSummary(sources()), { asOfDate: '2026-06-02', cobDate: '2026-06-02', revenue: { dayTotal: 1000 } }));
  store.saveSnapshot(dir, Object.assign(store.computeExecSummary(sources()), { asOfDate: '2026-06-03', cobDate: '2026-06-03', revenue: { dayTotal: 2000 } }));
  assert.strictEqual(store.getPriorMonthRevenue(dir, '2026-06-04'), 3000);
  const prior = store.getPriorSnapshot(dir, '2026-06-04');
  assert.strictEqual(prior.asOfDate, '2026-06-03');
  assert.strictEqual(store.getPriorSnapshot(dir, '2026-06-02'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveSnapshot rejects a malformed as_of_date', () => {
  assert.throws(() => store.saveSnapshot(tmp, store.computeExecSummary(sources({ margin: Object.assign(sources().margin, { preparedDate: 'nope', cobDate: 'nope', asOfDate: 'nope' }) }))), /as_of_date/);
});

console.log(`\nexec-summary-store: ${passed} passed${process.exitCode ? ' — with FAILURES' : ''}`);
