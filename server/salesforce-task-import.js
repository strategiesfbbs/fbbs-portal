'use strict';

const fs = require('fs');
const path = require('path');

const sf = require('./salesforce-import');
const sqliteDb = require('./sqlite-db');
const { listBankSummaries } = require('./bank-data-importer');
const {
  coverageDatabasePathForDir,
  ensureCoverageDatabase,
  listAllContacts
} = require('./bank-coverage-store');
const {
  ensureStrategyDatabase,
  strategyDatabasePathForDir
} = require('./strategy-store');
const { normalizeUsername } = require('./rep-identity');

const SOURCE_SYSTEM = 'salesforce-task';
const ACCOUNT_LINK_TABLE = 'salesforce_account_links';
const TASK_STAGE_TABLE = 'salesforce_task_rows';

function query(dbPath, sql, params) {
  return sqliteDb.querySqliteJson(dbPath, sql, params);
}

function run(dbPath, sql, params) {
  return sqliteDb.runSqlite(dbPath, sql, params);
}

function exec(dbPath, sql) {
  return sqliteDb.execSqlite(dbPath, sql);
}

function cleanText(value, max = 500) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : '';
}

function cleanMultiline(value, max = 4000) {
  const s = String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return s ? s.slice(0, max) : '';
}

function isTrue(value) {
  return /^(true|1|yes)$/i.test(String(value == null ? '' : value).trim());
}

function normalizeDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`;
  return '';
}

function normalizeDateTime(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString();
  return s.slice(0, 40);
}

function normalizeSalesforceId(value) {
  return String(value == null ? '' : value).trim();
}

function normalizePriority(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || /^normal$/i.test(s) || s === '3') return 'Normal';
  if (s === '4' || s === '5' || /^high$/i.test(s)) return 'High';
  if (s === '1' || s === '2' || /^low$/i.test(s)) return 'Low';
  return 'Normal';
}

function strategyPriority(value) {
  const s = String(value == null ? '' : value).trim();
  if (/^[1-5]$/.test(s)) return s;
  if (/^high$/i.test(s)) return '5';
  if (/^low$/i.test(s)) return '1';
  return '3';
}

function safeSourceId(prefix, id) {
  const cleaned = normalizeSalesforceId(id).replace(/[^A-Za-z0-9_-]/g, '');
  return `${prefix}-${cleaned || Math.random().toString(36).slice(2)}`;
}

function field(row, names) {
  for (const name of names) {
    if (row && row[name] !== undefined) return row[name];
  }
  return '';
}

function readCsvFile(filePath) {
  return sf.parseCsv(fs.readFileSync(filePath).toString('utf8'));
}

function findCsv(dir, fragment) {
  const files = fs.readdirSync(dir);
  const hit = files.find(name => name.toUpperCase().includes(fragment.toUpperCase()) && /\.csv$/i.test(name));
  if (!hit) throw new Error(`Could not find a *${fragment}*.csv in ${dir}`);
  return path.join(dir, hit);
}

function buildBankIndexes(bankSummaries = []) {
  const certToBankId = new Map();
  const nameToBankId = new Map();
  const bankById = new Map();
  for (const row of bankSummaries || []) {
    const bankId = cleanText(row.id || row.bankId, 80);
    if (!bankId) continue;
    const bank = {
      bankId,
      displayName: cleanText(row.displayName || row.name || bankId, 300),
      legalName: cleanText(row.name || row.legalName, 300),
      city: cleanText(row.city, 120),
      state: cleanText(row.state, 40),
      certNumber: cleanText(row.certNumber, 80)
    };
    bankById.set(bankId, bank);
    if (bank.certNumber) certToBankId.set(String(bank.certNumber), bankId);
    const key = sf.normalizeNameForMatch(bank.displayName || bank.legalName);
    if (key) {
      if (!nameToBankId.has(key)) nameToBankId.set(key, []);
      nameToBankId.get(key).push(bankId);
    }
  }
  return { certToBankId, nameToBankId, bankById };
}

function ensureImportTables(outputDir) {
  const dbPath = ensureCoverageDatabase(outputDir);
  exec(dbPath, `
    CREATE TABLE IF NOT EXISTS ${ACCOUNT_LINK_TABLE} (
      salesforce_account_id TEXT PRIMARY KEY,
      bank_id TEXT,
      cert_number TEXT,
      account_name TEXT,
      account_type TEXT,
      owner_id TEXT,
      owner_username TEXT,
      owner_display TEXT,
      match_via TEXT,
      match_reason TEXT,
      imported_at TEXT NOT NULL,
      source_file TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_salesforce_account_links_bank
      ON ${ACCOUNT_LINK_TABLE}(bank_id);
    CREATE TABLE IF NOT EXISTS ${TASK_STAGE_TABLE} (
      salesforce_task_id TEXT PRIMARY KEY,
      bank_id TEXT,
      cert_number TEXT,
      match_via TEXT,
      match_reason TEXT,
      account_id TEXT,
      what_id TEXT,
      who_id TEXT,
      owner_id TEXT,
      owner_username TEXT,
      owner_display TEXT,
      activity_date TEXT,
      completed_at TEXT,
      created_at TEXT,
      last_modified_at TEXT,
      status TEXT,
      is_closed INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      task_subtype TEXT,
      call_type TEXT,
      call_duration_seconds INTEGER,
      priority TEXT,
      subject TEXT,
      description TEXT,
      strategies_task INTEGER NOT NULL DEFAULT 0,
      frequency_of_run TEXT,
      corp_election TEXT,
      target_kind TEXT,
      target_id TEXT,
      import_action TEXT,
      imported_at TEXT NOT NULL,
      source_file TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_salesforce_task_rows_target
      ON ${TASK_STAGE_TABLE}(target_kind, import_action);
    CREATE INDEX IF NOT EXISTS idx_salesforce_task_rows_bank
      ON ${TASK_STAGE_TABLE}(bank_id, activity_date);
  `);
  return dbPath;
}

function ownerFromResolver(ownerId, repResolver) {
  const id = normalizeSalesforceId(ownerId);
  const rep = typeof repResolver === 'function' ? repResolver(id) : null;
  if (rep) {
    return {
      ownerId: id,
      ownerUsername: normalizeUsername(rep.username || rep.name || rep.alias || ''),
      ownerDisplay: rep.name || rep.username || rep.alias || ''
    };
  }
  if (id.startsWith('00G')) {
    return { ownerId: id, ownerUsername: 'strategies', ownerDisplay: 'Strategies' };
  }
  return { ownerId: id, ownerUsername: '', ownerDisplay: '' };
}

function accountMatch(account, { certToBankId, nameToBankId } = {}) {
  if (!account) return { bankId: '', via: '', reason: 'AccountId not in account export' };
  if (account.cert && certToBankId && certToBankId.has(account.cert)) {
    return { bankId: certToBankId.get(account.cert), via: 'cert', reason: 'cert match' };
  }
  const key = sf.normalizeNameForMatch(account.name);
  const hits = key && nameToBankId ? nameToBankId.get(key) : null;
  if (hits && hits.length === 1) return { bankId: hits[0], via: 'name', reason: 'name match (cert miss)' };
  if (hits && hits.length > 1) return { bankId: '', via: '', reason: `ambiguous name match (${hits.length} banks)` };
  if (account.type === 'RIA') return { bankId: '', via: '', reason: 'RIA account (no bank entity)' };
  if (account.type === 'GENERAL') return { bankId: '', via: '', reason: 'general account (no bank)' };
  if (account.cert) return { bankId: '', via: '', reason: 'bank cert not in portal' };
  return { bankId: '', via: '', reason: 'bank account missing cert' };
}

function buildAccountLinks(accountRows = [], { repRows = [], bankSummaries = [], importedAt, sourceFile } = {}) {
  const repResolver = sf.buildRepResolver(repRows);
  const accountIndex = sf.buildAccountIndex(accountRows);
  const bankIndexes = buildBankIndexes(bankSummaries);
  const links = [];
  for (const account of accountIndex.byId.values()) {
    const owner = ownerFromResolver(account.ownerId, repResolver);
    const match = accountMatch(account, bankIndexes);
    links.push({
      salesforceAccountId: account.id,
      bankId: match.bankId || '',
      certNumber: account.cert || '',
      accountName: account.name || '',
      accountType: account.type || '',
      ownerId: account.ownerId || '',
      ownerUsername: owner.ownerUsername || '',
      ownerDisplay: owner.ownerDisplay || '',
      matchVia: match.via || '',
      matchReason: match.reason || '',
      importedAt,
      sourceFile
    });
  }
  return links;
}

function upsertAccountLinks(outputDir, links = []) {
  const dbPath = ensureImportTables(outputDir);
  sqliteDb.withDatabase(dbPath, db => {
    const stmt = db.prepare(`
      INSERT INTO ${ACCOUNT_LINK_TABLE} (
        salesforce_account_id, bank_id, cert_number, account_name, account_type,
        owner_id, owner_username, owner_display, match_via, match_reason, imported_at, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(salesforce_account_id) DO UPDATE SET
        bank_id = excluded.bank_id,
        cert_number = excluded.cert_number,
        account_name = excluded.account_name,
        account_type = excluded.account_type,
        owner_id = excluded.owner_id,
        owner_username = excluded.owner_username,
        owner_display = excluded.owner_display,
        match_via = excluded.match_via,
        match_reason = excluded.match_reason,
        imported_at = excluded.imported_at,
        source_file = excluded.source_file;
    `);
    const tx = db.transaction(() => {
      links.forEach(row => stmt.run(
        row.salesforceAccountId, row.bankId, row.certNumber, row.accountName, row.accountType,
        row.ownerId, row.ownerUsername, row.ownerDisplay, row.matchVia, row.matchReason,
        row.importedAt, row.sourceFile
      ));
    });
    tx();
  });
}

function contactMapFromCoverage(outputDir) {
  const contacts = listAllContacts(outputDir, { limit: 10000 });
  const map = new Map();
  contacts.forEach(row => {
    if (row.salesforceContactId && row.bankId) map.set(row.salesforceContactId, row.bankId);
  });
  return map;
}

function accountLinkMap(links = []) {
  const map = new Map();
  links.forEach(row => {
    if (row.salesforceAccountId) map.set(row.salesforceAccountId, row);
  });
  return map;
}

function lookupBankMatch(row, { accountLinks, contactToBank } = {}) {
  const ids = [
    ['AccountId', normalizeSalesforceId(row.accountId)],
    ['WhatId', normalizeSalesforceId(row.whatId)]
  ];
  for (const [via, id] of ids) {
    if (!id || !id.startsWith('001')) continue;
    const link = accountLinks.get(id);
    if (link && link.bankId) return { bankId: link.bankId, certNumber: link.certNumber || '', via, reason: link.matchReason || 'account link' };
    if (link) return { bankId: '', certNumber: '', via, reason: link.matchReason || 'account link unmatched' };
  }
  const whoId = normalizeSalesforceId(row.whoId);
  if (whoId && whoId.startsWith('003')) {
    const bankId = contactToBank.get(whoId);
    if (bankId) return { bankId, certNumber: '', via: 'WhoId', reason: 'contact match' };
    return { bankId: '', certNumber: '', via: '', reason: 'contact not imported' };
  }
  if (whoId && whoId.startsWith('00Q')) return { bankId: '', certNumber: '', via: '', reason: 'lead/orphan task' };
  return { bankId: '', certNumber: '', via: '', reason: 'no bank/contact reference' };
}

function mapStrategyType(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.includes('bond swap')) return 'Bond Swap';
  if (s.includes('cecl')) return 'CECL Analysis';
  if (s.includes('t ho') || s.includes('tho') || s.includes('portfolio report')) return 'THO Report';
  if (s.includes('muni') || s.includes('bcis')) return 'Muni BCIS';
  return 'Miscellaneous';
}

function mapTargetKind(record, options = {}) {
  const subtype = String(record.taskSubtype || '');
  const status = String(record.status || '');
  const subject = String(record.subject || '');
  if (record.isDeleted) return 'report_only';
  if (!record.bankId) return 'unmatched';
  if (/\(sample\)/i.test(subject)) return 'report_only';
  if (record.strategiesTask) return 'strategy';
  if ((status === 'Open' || status === 'In Progress') && subtype === 'Task') return 'bank_task';
  if (status === 'Completed') {
    if (subtype === 'Call' || subtype === 'Email' || subtype === 'Task') return 'bank_activity';
    if (subtype === 'ListEmail' && options.includeListEmail) return 'bank_activity';
  }
  return 'report_only';
}

function mapActivityKind(subtype) {
  if (subtype === 'Call') return 'call';
  if (subtype === 'Email' || subtype === 'ListEmail') return 'email';
  if (subtype === 'Task') return 'task';
  return 'note';
}

function normalizeTaskRow(raw, options = {}) {
  const owner = ownerFromResolver(field(raw, ['OwnerId']), options.repResolver);
  const record = {
    salesforceTaskId: normalizeSalesforceId(field(raw, ['Id'])),
    accountId: normalizeSalesforceId(field(raw, ['AccountId'])),
    whatId: normalizeSalesforceId(field(raw, ['WhatId'])),
    whoId: normalizeSalesforceId(field(raw, ['WhoId'])),
    ownerId: owner.ownerId,
    ownerUsername: owner.ownerUsername,
    ownerDisplay: owner.ownerDisplay,
    activityDate: normalizeDate(field(raw, ['ActivityDate'])),
    completedAt: normalizeDateTime(field(raw, ['CompletedDateTime'])),
    createdAt: normalizeDateTime(field(raw, ['CreatedDate'])),
    lastModifiedAt: normalizeDateTime(field(raw, ['LastModifiedDate', 'SystemModstamp'])),
    status: cleanText(field(raw, ['Status']), 40),
    isClosed: isTrue(field(raw, ['IsClosed'])),
    isDeleted: isTrue(field(raw, ['IsDeleted'])),
    taskSubtype: cleanText(field(raw, ['TaskSubtype']), 80),
    callType: cleanText(field(raw, ['CallType']), 80),
    callDurationSeconds: Math.max(0, parseInt(field(raw, ['CallDurationInSeconds']), 10) || 0),
    priority: cleanText(field(raw, ['Priority']), 40),
    subject: cleanText(field(raw, ['Subject']), 500),
    description: cleanMultiline(field(raw, ['Description']), 4000),
    strategiesTask: isTrue(field(raw, ['Strategies_Task__c'])),
    frequencyOfRun: cleanText(field(raw, ['Frequency_of_Run__c']), 80),
    corpElection: cleanText(field(raw, ['S_Corp_or_C_Corp__c']), 80),
    importedAt: options.importedAt,
    sourceFile: options.sourceFile || ''
  };
  const match = lookupBankMatch(record, options);
  record.bankId = match.bankId || '';
  record.certNumber = match.certNumber || '';
  record.matchVia = match.via || '';
  record.matchReason = match.reason || '';
  record.targetKind = mapTargetKind(record, options);
  record.targetId = '';
  record.importAction = record.targetKind === 'unmatched' ? 'unmatched' : 'staged';
  return record;
}

function summarize(records = [], { dryRun = false, applied = false } = {}) {
  const emptyCounts = () => ({});
  const inc = (obj, key) => { obj[key || '(blank)'] = (obj[key || '(blank)'] || 0) + 1; };
  const summary = {
    dryRun: Boolean(dryRun),
    applied: Boolean(applied),
    totalRows: records.length,
    matchedRows: records.filter(r => r.bankId).length,
    unmatchedRows: records.filter(r => !r.bankId).length,
    byTarget: emptyCounts(),
    byStatus: emptyCounts(),
    bySubtype: emptyCounts(),
    byAction: emptyCounts()
  };
  records.forEach(row => {
    inc(summary.byTarget, row.targetKind);
    inc(summary.byStatus, row.status);
    inc(summary.bySubtype, row.taskSubtype);
    inc(summary.byAction, row.importAction);
  });
  return summary;
}

function upsertStagedTasks(outputDir, records = []) {
  const dbPath = ensureImportTables(outputDir);
  sqliteDb.withDatabase(dbPath, db => {
    const stmt = db.prepare(`
      INSERT INTO ${TASK_STAGE_TABLE} (
        salesforce_task_id, bank_id, cert_number, match_via, match_reason,
        account_id, what_id, who_id, owner_id, owner_username, owner_display,
        activity_date, completed_at, created_at, last_modified_at, status, is_closed,
        is_deleted, task_subtype, call_type, call_duration_seconds, priority, subject,
        description, strategies_task, frequency_of_run, corp_election, target_kind,
        target_id, import_action, imported_at, source_file
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(salesforce_task_id) DO UPDATE SET
        bank_id = excluded.bank_id,
        cert_number = excluded.cert_number,
        match_via = excluded.match_via,
        match_reason = excluded.match_reason,
        account_id = excluded.account_id,
        what_id = excluded.what_id,
        who_id = excluded.who_id,
        owner_id = excluded.owner_id,
        owner_username = excluded.owner_username,
        owner_display = excluded.owner_display,
        activity_date = excluded.activity_date,
        completed_at = excluded.completed_at,
        created_at = excluded.created_at,
        last_modified_at = excluded.last_modified_at,
        status = excluded.status,
        is_closed = excluded.is_closed,
        is_deleted = excluded.is_deleted,
        task_subtype = excluded.task_subtype,
        call_type = excluded.call_type,
        call_duration_seconds = excluded.call_duration_seconds,
        priority = excluded.priority,
        subject = excluded.subject,
        description = excluded.description,
        strategies_task = excluded.strategies_task,
        frequency_of_run = excluded.frequency_of_run,
        corp_election = excluded.corp_election,
        target_kind = excluded.target_kind,
        target_id = excluded.target_id,
        import_action = excluded.import_action,
        imported_at = excluded.imported_at,
        source_file = excluded.source_file;
    `);
    const tx = db.transaction(() => {
      records.forEach(r => stmt.run(
        r.salesforceTaskId, r.bankId, r.certNumber, r.matchVia, r.matchReason,
        r.accountId, r.whatId, r.whoId, r.ownerId, r.ownerUsername, r.ownerDisplay,
        r.activityDate, r.completedAt, r.createdAt, r.lastModifiedAt, r.status, r.isClosed ? 1 : 0,
        r.isDeleted ? 1 : 0, r.taskSubtype, r.callType, r.callDurationSeconds, r.priority, r.subject,
        r.description, r.strategiesTask ? 1 : 0, r.frequencyOfRun, r.corpElection, r.targetKind,
        r.targetId, r.importAction, r.importedAt, r.sourceFile
      ));
    });
    tx();
  });
}

function upsertImportedActivity(db, record) {
  const id = safeSourceId('sf-activity', record.salesforceTaskId);
  const metadata = [
    record.description,
    record.callType ? `Call type: ${record.callType}` : '',
    record.callDurationSeconds ? `Duration: ${record.callDurationSeconds}s` : '',
    record.frequencyOfRun ? `Frequency: ${record.frequencyOfRun}` : '',
    record.corpElection ? `Tax: ${record.corpElection}` : ''
  ].filter(Boolean).join('\n');
  db.prepare(`
    INSERT INTO bank_activities (
      id, bank_id, cert_number, at, actor_username, actor_display, kind,
      summary, subject, body, activity_date, ref_type, ref_id,
      source_system, source_id, source_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bank_id = excluded.bank_id,
      cert_number = excluded.cert_number,
      at = excluded.at,
      actor_username = excluded.actor_username,
      actor_display = excluded.actor_display,
      kind = excluded.kind,
      summary = excluded.summary,
      subject = excluded.subject,
      body = excluded.body,
      activity_date = excluded.activity_date,
      source_file = excluded.source_file;
  `).run(
    id,
    record.bankId,
    record.certNumber || null,
    record.completedAt || record.createdAt || record.importedAt,
    record.ownerUsername || null,
    record.ownerDisplay || null,
    mapActivityKind(record.taskSubtype),
    record.subject || mapActivityKind(record.taskSubtype),
    record.subject || mapActivityKind(record.taskSubtype),
    metadata || null,
    record.activityDate || (record.completedAt || record.createdAt || record.importedAt).slice(0, 10),
    'salesforce-task',
    record.salesforceTaskId,
    SOURCE_SYSTEM,
    record.salesforceTaskId,
    record.sourceFile || null
  );
  return id;
}

function upsertImportedTask(db, record) {
  const id = safeSourceId('sf-task', record.salesforceTaskId);
  const body = [
    record.description,
    record.status && record.status !== 'Open' ? `Salesforce status: ${record.status}` : '',
    record.frequencyOfRun ? `Frequency: ${record.frequencyOfRun}` : '',
    record.corpElection ? `Tax: ${record.corpElection}` : ''
  ].filter(Boolean).join('\n');
  db.prepare(`
    INSERT INTO bank_tasks (
      id, bank_id, cert_number, title, body, due_date, priority, status,
      assigned_to, assigned_display, created_by, created_display, created_at,
      updated_at, source_system, source_id, source_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bank_id = excluded.bank_id,
      cert_number = excluded.cert_number,
      title = excluded.title,
      body = excluded.body,
      due_date = excluded.due_date,
      priority = excluded.priority,
      assigned_to = excluded.assigned_to,
      assigned_display = excluded.assigned_display,
      updated_at = excluded.updated_at,
      source_file = excluded.source_file;
  `).run(
    id,
    record.bankId,
    record.certNumber || null,
    record.subject || 'Salesforce follow-up',
    body || null,
    record.activityDate || null,
    normalizePriority(record.priority),
    record.ownerUsername || null,
    record.ownerDisplay || null,
    record.ownerUsername || null,
    record.ownerDisplay || null,
    record.createdAt || record.importedAt,
    record.lastModifiedAt || record.importedAt,
    SOURCE_SYSTEM,
    record.salesforceTaskId,
    record.sourceFile || null
  );
  return id;
}

function upsertImportedStrategy(db, record, bankById) {
  const id = safeSourceId('sf-strategy', record.salesforceTaskId);
  const bank = bankById.get(record.bankId) || { bankId: record.bankId, displayName: record.bankId, certNumber: record.certNumber || '' };
  const status = record.status === 'Completed'
    ? 'Completed'
    : record.status === 'In Progress'
      ? 'In Progress'
      : 'Open';
  const comments = [
    record.description,
    record.frequencyOfRun ? `Frequency: ${record.frequencyOfRun}` : '',
    record.corpElection ? `Tax: ${record.corpElection}` : ''
  ].filter(Boolean).join('\n');
  db.prepare(`
    INSERT INTO strategy_requests (
      id, bank_id, display_name, legal_name, city, state, cert_number,
      request_type, status, priority, requested_by, assigned_to,
      summary, comments, created_at, updated_at, completed_at,
      source_system, source_id, source_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bank_id = excluded.bank_id,
      display_name = excluded.display_name,
      legal_name = excluded.legal_name,
      city = excluded.city,
      state = excluded.state,
      cert_number = excluded.cert_number,
      request_type = excluded.request_type,
      status = excluded.status,
      priority = excluded.priority,
      requested_by = excluded.requested_by,
      assigned_to = excluded.assigned_to,
      summary = excluded.summary,
      comments = excluded.comments,
      updated_at = excluded.updated_at,
      completed_at = excluded.completed_at,
      source_file = excluded.source_file;
  `).run(
    id,
    record.bankId,
    bank.displayName || record.bankId,
    bank.legalName || null,
    bank.city || null,
    bank.state || null,
    bank.certNumber || record.certNumber || null,
    mapStrategyType(record.subject),
    status,
    strategyPriority(record.priority),
    record.ownerDisplay || record.ownerUsername || null,
    'Strategies',
    record.subject || mapStrategyType(record.subject),
    comments || null,
    record.createdAt || record.importedAt,
    record.lastModifiedAt || record.importedAt,
    status === 'Completed' ? (record.completedAt || record.lastModifiedAt || record.importedAt) : null,
    SOURCE_SYSTEM,
    record.salesforceTaskId,
    record.sourceFile || null
  );
  return id;
}

function applyProjectedRows(outputDir, records, { sections = new Set(), bankSummaries = [] } = {}) {
  const coverageDb = ensureImportTables(outputDir);
  const strategyDb = ensureStrategyDatabase(outputDir);
  const bankById = buildBankIndexes(bankSummaries).bankById;
  const sectionSet = sections instanceof Set ? sections : new Set(sections || []);
  const counts = { activities: 0, tasks: 0, strategies: 0, skipped: 0 };
  sqliteDb.withDatabase(coverageDb, covDb => {
    const updateStage = covDb.prepare(`
      UPDATE ${TASK_STAGE_TABLE}
      SET target_id = ?, import_action = ?
      WHERE salesforce_task_id = ?;
    `);
    const tx = covDb.transaction(() => {
      records.forEach(record => {
        if (record.targetKind === 'bank_activity' && sectionSet.has('activities')) {
          record.targetId = upsertImportedActivity(covDb, record);
          record.importAction = 'upserted';
          counts.activities += 1;
        } else if (record.targetKind === 'bank_task' && sectionSet.has('tasks')) {
          record.targetId = upsertImportedTask(covDb, record);
          record.importAction = 'upserted';
          counts.tasks += 1;
        } else if (record.targetKind === 'strategy' && sectionSet.has('strategies')) {
          // Strategy rows are written just below in their own DB connection.
          record.targetId = safeSourceId('sf-strategy', record.salesforceTaskId);
          record.importAction = 'pending-strategy';
        } else {
          record.importAction = record.targetKind === 'unmatched' ? 'unmatched' : 'staged';
          counts.skipped += 1;
        }
        updateStage.run(record.targetId || null, record.importAction, record.salesforceTaskId);
      });
    });
    tx();
  });

  if (sectionSet.has('strategies')) {
    sqliteDb.withDatabase(strategyDb, stratDb => {
      const tx = stratDb.transaction(() => {
        records.filter(r => r.targetKind === 'strategy').forEach(record => {
          record.targetId = upsertImportedStrategy(stratDb, record, bankById);
          record.importAction = 'upserted';
          counts.strategies += 1;
        });
      });
      tx();
    });
    sqliteDb.withDatabase(coverageDb, db => {
      const stmt = db.prepare(`UPDATE ${TASK_STAGE_TABLE} SET target_id = ?, import_action = ? WHERE salesforce_task_id = ?;`);
      const tx = db.transaction(() => {
        records.filter(r => r.targetKind === 'strategy').forEach(record => stmt.run(record.targetId, record.importAction, record.salesforceTaskId));
      });
      tx();
    });
  }

  return counts;
}

function importSalesforceTaskRows(outputDir, taskRows, options = {}) {
  const importedAt = options.importedAt || new Date().toISOString();
  const sourceFile = options.sourceFile || 'salesforce-task-export.csv';
  const bankSummaries = options.bankSummaries || listBankSummaries(outputDir);
  const repRows = options.repRows || [];
  const accountRows = options.accountRows || [];
  const repResolver = sf.buildRepResolver(repRows);
  const accountLinks = buildAccountLinks(accountRows, { repRows, bankSummaries, importedAt, sourceFile: options.accountSourceFile || sourceFile });
  const linkMap = accountLinkMap(accountLinks);
  const contactToBank = options.contactToBank || contactMapFromCoverage(outputDir);
  const records = (taskRows || [])
    .map(row => normalizeTaskRow(row, {
      repResolver,
      accountLinks: linkMap,
      contactToBank,
      importedAt,
      sourceFile,
      includeListEmail: options.includeListEmail
    }))
    .filter(row => row.salesforceTaskId);
  const dryRun = !options.apply;
  if (!dryRun) {
    upsertAccountLinks(outputDir, accountLinks);
    upsertStagedTasks(outputDir, records);
    const sections = options.sections instanceof Set ? options.sections : new Set(options.sections || []);
    applyProjectedRows(outputDir, records, { sections, bankSummaries });
    upsertStagedTasks(outputDir, records);
  }
  return {
    importedAt,
    sourceFile,
    accountLinks: {
      total: accountLinks.length,
      matched: accountLinks.filter(row => row.bankId).length,
      unmatched: accountLinks.filter(row => !row.bankId).length
    },
    projections: summarize(records, { dryRun, applied: !dryRun }),
    rows: records
  };
}

function importSalesforceTaskFile(options = {}) {
  const outputDir = options.outputDir;
  if (!outputDir) throw new Error('outputDir is required');
  const taskFile = options.taskFile;
  if (!taskFile || !fs.existsSync(taskFile)) throw new Error(`Missing task export: ${taskFile}`);
  const foundationDir = options.foundationDir || '';
  const accountFile = options.accountFile || (foundationDir ? findCsv(foundationDir, 'ACCOUNT') : '');
  const repFile = options.repFile || (foundationDir ? findCsv(foundationDir, 'REP') : '');
  const accountRows = accountFile ? readCsvFile(accountFile) : [];
  const repRows = repFile ? readCsvFile(repFile) : [];
  const taskRows = readCsvFile(taskFile);
  return importSalesforceTaskRows(outputDir, taskRows, {
    ...options,
    accountRows,
    repRows,
    sourceFile: path.basename(taskFile),
    accountSourceFile: accountFile ? path.basename(accountFile) : ''
  });
}

function getSalesforceTaskReport(outputDir, options = {}) {
  const dbPath = ensureImportTables(outputDir);
  const limit = Math.max(1, Math.min(1000, parseInt(options.limit, 10) || 250));
  const target = cleanText(options.target, 40);
  const bankById = buildBankIndexes(listBankSummaries(outputDir)).bankById;
  const params = [];
  let where = '1 = 1';
  if (target && target !== 'all') {
    where += ' AND target_kind = ?';
    params.push(target);
  }
  const totals = query(dbPath, `
    SELECT
      COUNT(*) AS totalRows,
      SUM(CASE WHEN bank_id IS NOT NULL AND bank_id <> '' THEN 1 ELSE 0 END) AS matchedRows,
      SUM(CASE WHEN bank_id IS NULL OR bank_id = '' THEN 1 ELSE 0 END) AS unmatchedRows,
      MAX(imported_at) AS importedAt
    FROM ${TASK_STAGE_TABLE};
  `)[0] || {};
  const byTarget = query(dbPath, `SELECT target_kind AS key, COUNT(*) AS count FROM ${TASK_STAGE_TABLE} GROUP BY target_kind ORDER BY count DESC;`);
  const byAction = query(dbPath, `SELECT import_action AS key, COUNT(*) AS count FROM ${TASK_STAGE_TABLE} GROUP BY import_action ORDER BY count DESC;`);
  const byStatus = query(dbPath, `SELECT status AS key, COUNT(*) AS count FROM ${TASK_STAGE_TABLE} GROUP BY status ORDER BY count DESC;`);
  const rows = query(dbPath, `
    SELECT
      salesforce_task_id AS salesforceTaskId,
      bank_id AS bankId,
      cert_number AS certNumber,
      match_via AS matchVia,
      match_reason AS matchReason,
      owner_username AS ownerUsername,
      owner_display AS ownerDisplay,
      activity_date AS activityDate,
      completed_at AS completedAt,
      created_at AS createdAt,
      status,
      task_subtype AS taskSubtype,
      call_type AS callType,
      call_duration_seconds AS callDurationSeconds,
      priority,
      subject,
      strategies_task AS strategiesTask,
      frequency_of_run AS frequencyOfRun,
      corp_election AS corpElection,
      target_kind AS targetKind,
      target_id AS targetId,
      import_action AS importAction,
      source_file AS sourceFile
    FROM ${TASK_STAGE_TABLE}
    WHERE ${where}
    ORDER BY
      CASE WHEN activity_date IS NULL OR activity_date = '' THEN 1 ELSE 0 END,
      activity_date DESC,
      created_at DESC
    LIMIT ?;
  `, [...params, limit]).map(row => {
    const bank = bankById.get(row.bankId) || {};
    return {
      ...row,
      displayName: bank.displayName || '',
      city: bank.city || '',
      state: bank.state || '',
      strategiesTask: !!row.strategiesTask
    };
  });
  return {
    status: {
      available: Number(totals.totalRows || 0) > 0,
      totalRows: Number(totals.totalRows || 0),
      matchedRows: Number(totals.matchedRows || 0),
      unmatchedRows: Number(totals.unmatchedRows || 0),
      importedAt: totals.importedAt || ''
    },
    byTarget,
    byAction,
    byStatus,
    rows
  };
}

module.exports = {
  SOURCE_SYSTEM,
  importSalesforceTaskRows,
  importSalesforceTaskFile,
  getSalesforceTaskReport,
  normalizeTaskRow,
  buildAccountLinks,
  ensureImportTables,
  readCsvFile
};
