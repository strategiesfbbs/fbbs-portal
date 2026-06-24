'use strict';

// Focused CRM task/opportunity helper coverage. Broad store smoke tests already
// prove the full store can bind and round-trip values; these tests lock the
// follow-up helper semantics that replaced legacy next_action_date reads.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const coverage = require('../server/bank-coverage-store');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function withTempDir(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-bank-coverage-crm-'));
  try { fn(tmp); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('overdue/upcoming Open-task helpers filter by date, status, assignee, and limit', () => withTempDir(tmp => {
  const base = { bankId: 'B-1', assignedTo: 'Rep1' };
  const overdue = coverage.createBankTask(tmp, { ...base, title: 'Overdue', dueDate: '2026-06-01' });
  coverage.createBankTask(tmp, { ...base, title: 'Today', dueDate: '2026-06-10' });
  coverage.createBankTask(tmp, { ...base, title: 'Upcoming', dueDate: '2026-06-15' });
  coverage.createBankTask(tmp, { ...base, title: 'Outside horizon', dueDate: '2026-06-30' });
  coverage.createBankTask(tmp, { ...base, assignedTo: 'OtherRep', title: 'Other rep overdue', dueDate: '2026-06-01' });
  coverage.updateBankTask(tmp, overdue.id, { status: 'Done', completedBy: 'Rep1' });
  coverage.createBankTask(tmp, { ...base, title: 'Still overdue', dueDate: '2026-06-02' });

  const overdueRows = coverage.listOverdueOpenTasks(tmp, { username: 'REP1', today: '2026-06-10' });
  assert.deepStrictEqual(overdueRows.map(t => t.title), ['Still overdue']);

  const upcomingRows = coverage.listUpcomingOpenTasks(tmp, {
    username: 'rep1',
    today: '2026-06-10',
    horizon: '2026-06-20',
    limit: 1
  });
  assert.deepStrictEqual(upcomingRows.map(t => t.title), ['Today']);
}));

test('task status transitions stamp and clear completion fields', () => withTempDir(tmp => {
  const task = coverage.createBankTask(tmp, { bankId: 'B-1', title: 'Call back', dueDate: '2026-06-12' });
  const done = coverage.updateBankTask(tmp, task.id, { status: 'Done', completedBy: 'Rep One' });
  assert.strictEqual(done.status, 'Done');
  assert.ok(done.completedAt);
  assert.strictEqual(done.completedBy, 'Rep One');

  const reopened = coverage.updateBankTask(tmp, task.id, { status: 'Open' });
  assert.strictEqual(reopened.status, 'Open');
  assert.strictEqual(reopened.completedAt, '');
  assert.strictEqual(reopened.completedBy, '');
}));

test('opportunity stage moves stamp closed state and reopen cleanly', () => withTempDir(tmp => {
  const opp = coverage.createBankOpportunity(tmp, {
    bankId: 'B-1',
    product: 'Bond Swap',
    estValue: 12000,
    owner: 'Rep1'
  });
  const won = coverage.updateBankOpportunity(tmp, opp.id, { stage: 'Won' });
  assert.strictEqual(won.stage, 'Won');
  assert.ok(won.stageChangedAt);
  assert.ok(won.closedAt);

  const reopened = coverage.updateBankOpportunity(tmp, opp.id, { stage: 'Proposed' });
  assert.strictEqual(reopened.stage, 'Proposed');
  assert.ok(reopened.stageChangedAt);
  assert.strictEqual(reopened.closedAt, '');
  assert.strictEqual(coverage.pipelineSummary(tmp, { username: 'rep1' }).open.count, 1);
}));

for (const { name, fn } of tests) {
  try { fn(); passed++; }
  catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}
console.log(`bank-coverage-crm tests: ${passed} passed.`);
