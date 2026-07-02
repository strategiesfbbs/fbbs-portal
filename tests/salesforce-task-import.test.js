'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteDb = require('../server/sqlite-db');
const taskImport = require('../server/salesforce-task-import');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-sf-tasks-'));
}

const bankSummaries = [
  { id: 'B-1', displayName: 'First Test Bank', name: 'First Test Bank', city: 'St Louis', state: 'MO', certNumber: '12345' }
];

const accountRows = [
  {
    Id: '001ACCOUNT000001',
    Account_Id_18__c: '001ACCOUNT000001AAA',
    RecordTypeId: '012Hs000000CFaPIAW',
    Cert_Number__c: '12345',
    Name: 'First Test Bank',
    OwnerId: '005OWNER000001AAA'
  }
];

const repRows = [
  {
    'User ID': '005OWNER000001',
    Username: 'seller@fbbsinc.com',
    'First Name': 'Sales',
    'Last Name': 'Rep',
    Alias: 'srep',
    Active: '1'
  }
];

const taskRows = [
  {
    Id: '00TOPEN000001AAA',
    AccountId: '001ACCOUNT000001AAA',
    WhatId: '001ACCOUNT000001AAA',
    OwnerId: '005OWNER000001AAA',
    ActivityDate: '2026-07-08',
    CreatedDate: '2026-07-01T12:00:00.000Z',
    LastModifiedDate: '2026-07-01T12:05:00.000Z',
    Status: 'Open',
    IsClosed: 'false',
    IsDeleted: 'false',
    TaskSubtype: 'Task',
    Priority: '5',
    Subject: 'Call about loan tape'
  },
  {
    Id: '00TCALL000001AAA',
    AccountId: '001ACCOUNT000001AAA',
    OwnerId: '005OWNER000001AAA',
    ActivityDate: '2026-07-01',
    CompletedDateTime: '2026-07-01T15:00:00.000Z',
    CreatedDate: '2026-07-01T14:50:00.000Z',
    Status: 'Completed',
    IsClosed: 'true',
    IsDeleted: 'false',
    TaskSubtype: 'Call',
    CallType: 'Outbound',
    CallDurationInSeconds: '120',
    Priority: '3',
    Subject: 'Outbound to CFO',
    Description: 'Discussed portfolio review.'
  },
  {
    Id: '00TSTRAT00001AAA',
    AccountId: '001ACCOUNT000001AAA',
    WhatId: '001ACCOUNT000001AAA',
    OwnerId: '00GVz000000jFMHMA2',
    ActivityDate: '2026-07-13',
    CreatedDate: '2026-07-01T16:00:00.000Z',
    CompletedDateTime: '2026-07-02T16:00:00.000Z',
    Status: 'Completed',
    IsClosed: 'true',
    IsDeleted: 'false',
    TaskSubtype: 'Task',
    Strategies_Task__c: 'true',
    Subject: 'Bond Swap',
    Description: 'Needs loss-harvest ideas.',
    Priority: '4',
    S_Corp_or_C_Corp__c: 'S-Corp'
  },
  {
    Id: '00TLIST000001AAA',
    AccountId: '001ACCOUNT000001AAA',
    OwnerId: '005OWNER000001AAA',
    ActivityDate: '2026-07-01',
    CompletedDateTime: '2026-07-01T17:00:00.000Z',
    Status: 'Completed',
    IsClosed: 'true',
    IsDeleted: 'false',
    TaskSubtype: 'ListEmail',
    Subject: 'List Email: Rates'
  }
];

function scalar(dbPath, sql) {
  return sqliteDb.querySqliteJson(dbPath, sql)[0].n;
}

function run() {
  const dir = tmpDir();
  const result = taskImport.importSalesforceTaskRows(dir, taskRows, {
    apply: true,
    sections: new Set(['tasks', 'activities', 'strategies']),
    accountRows,
    repRows,
    bankSummaries,
    sourceFile: 'tasks.csv',
    importedAt: '2026-07-02T12:00:00.000Z'
  });

  assert.strictEqual(result.projections.totalRows, 4);
  assert.strictEqual(result.projections.matchedRows, 4);
  assert.strictEqual(result.projections.byTarget.bank_task, 1);
  assert.strictEqual(result.projections.byTarget.bank_activity, 1);
  assert.strictEqual(result.projections.byTarget.strategy, 1);
  assert.strictEqual(result.projections.byTarget.report_only, 1);

  const coverageDb = path.join(dir, 'bank-coverage.sqlite');
  const strategyDb = path.join(dir, 'bank-strategies.sqlite');
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM salesforce_task_rows;'), 4);
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM bank_tasks;'), 1);
  assert.strictEqual(scalar(coverageDb, "SELECT COUNT(*) AS n FROM bank_tasks WHERE source_system = 'salesforce-task';"), 1);
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM bank_activities;'), 1);
  assert.strictEqual(scalar(strategyDb, 'SELECT COUNT(*) AS n FROM strategy_requests;'), 1);
  assert.strictEqual(
    sqliteDb.querySqliteJson(strategyDb, 'SELECT request_type AS type, status FROM strategy_requests;')[0].type,
    'Bond Swap'
  );

  taskImport.importSalesforceTaskRows(dir, taskRows, {
    apply: true,
    sections: new Set(['tasks', 'activities', 'strategies']),
    accountRows,
    repRows,
    bankSummaries,
    sourceFile: 'tasks.csv',
    importedAt: '2026-07-02T12:05:00.000Z'
  });
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM salesforce_task_rows;'), 4);
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM bank_tasks;'), 1);
  assert.strictEqual(scalar(coverageDb, 'SELECT COUNT(*) AS n FROM bank_activities;'), 1);
  assert.strictEqual(scalar(strategyDb, 'SELECT COUNT(*) AS n FROM strategy_requests;'), 1);

  const report = taskImport.getSalesforceTaskReport(dir, { target: 'bank_activity', limit: 10 });
  assert.strictEqual(report.status.totalRows, 4);
  assert.strictEqual(report.rows.length, 1);
  assert.strictEqual(report.rows[0].taskSubtype, 'Call');

  console.log('salesforce-task-import tests: all passed');
}

try {
  run();
} catch (err) {
  console.error('salesforce-task-import.test.js failed:', err);
  process.exit(1);
}
