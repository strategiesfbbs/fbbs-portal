'use strict';

// Canonical "Salesforce-style" saved views over the bank database.
//
// Each preset is a function that takes ({ outputDir, rep, ...filters }) and
// returns { rows, totals }. Pure read-only — they project existing data
// from bank_account_statuses, bank_coverage, and strategy_requests; no new
// state is introduced.
//
// `rep` is a resolved rep record (`{ username, displayName }`) or null.
// When non-null and a preset supports it, results are filtered by owner-
// string contains-matching via the shared rep-identity helper.

const {
  countBankAccountStatuses,
  listBankAccountStatuses
} = require('./bank-account-status-store');
const {
  lastActivityByBank,
  listBillingQueue,
  listSavedBanks
} = require('./bank-coverage-store');
const {
  listStrategyRequests
} = require('./strategy-store');
const {
  ownerStringContainsRep
} = require('./rep-identity');

const VIEW_DEFINITIONS = [
  {
    id: 'clients',
    label: 'Clients',
    description: 'Banks with account status Client.',
    kind: 'account-status',
    supportsRep: true,
    statusFilter: 'Client'
  },
  {
    id: 'prospects',
    label: 'Prospects',
    description: 'Banks with account status Prospect.',
    kind: 'account-status',
    supportsRep: true,
    statusFilter: 'Prospect'
  },
  {
    id: 'open',
    label: 'Open',
    description: 'Banks with account status Open (un-triaged).',
    kind: 'account-status',
    supportsRep: true,
    statusFilter: 'Open'
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    description: 'Banks flagged for watchlist follow-up.',
    kind: 'account-status',
    supportsRep: true,
    statusFilter: 'Watchlist'
  },
  {
    id: 'needs-billed',
    label: 'Needs Billed',
    description: 'Strategy requests waiting to be billed.',
    kind: 'strategies',
    supportsRep: true,
    statusFilter: 'Needs Billed'
  },
  {
    id: 'stale-follow-ups',
    label: 'Stale Follow-ups',
    description: 'Coverage rows whose next-action date has passed.',
    kind: 'follow-ups',
    supportsRep: true
  },
  {
    id: 'my-book',
    label: 'My Book',
    description: 'Every bank where you are listed as a coverage owner.',
    kind: 'account-status',
    supportsRep: true,
    requiresRep: true
  },
  {
    id: 'billing-pending',
    label: 'Billing Queue',
    description: 'Strategies and swaps awaiting invoice.',
    kind: 'billing',
    supportsRep: false,
    stateFilter: 'Pending'
  }
];

function getViewDefinition(id) {
  return VIEW_DEFINITIONS.find(v => v.id === id) || null;
}

function listViewDefinitions() {
  return VIEW_DEFINITIONS.map(v => ({
    id: v.id,
    label: v.label,
    description: v.description,
    supportsRep: !!v.supportsRep,
    requiresRep: !!v.requiresRep,
    kind: v.kind
  }));
}

function summarizeBank(row) {
  return {
    bankId: row.bankId || '',
    displayName: row.displayName || row.legalName || '',
    legalName: row.legalName || '',
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    status: row.status || '',
    owner: row.owner || '',
    services: row.services || '',
    affiliate: row.affiliate || '',
    updatedAt: row.updatedAt || ''
  };
}

function summarizeStrategy(row) {
  return {
    id: row.id,
    bankId: row.bankId,
    displayName: row.displayName || '',
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    requestType: row.requestType || '',
    status: row.status || '',
    priority: row.priority || '',
    summary: row.summary || '',
    assignedTo: row.assignedTo || '',
    requestedBy: row.requestedBy || '',
    invoiceContact: row.invoiceContact || '',
    completedAt: row.completedAt || '',
    updatedAt: row.updatedAt || '',
    createdAt: row.createdAt || ''
  };
}

function summarizeFollowUp(row) {
  return {
    bankId: row.bankId,
    displayName: row.displayName,
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    status: row.status || '',
    priority: row.priority || '',
    owner: row.owner || '',
    nextActionDate: row.nextActionDate || '',
    updatedAt: row.updatedAt || ''
  };
}

// Loading every Open bank can return 5,000+ rows. Cap at 8,000 so even the largest status
// group fits in one shell-out and the JS-side rep filter has the full set to work with.
const ACCOUNT_VIEW_FETCH_LIMIT = 8000;

// One GROUP BY over bank_activities (manual CRM kinds only) → { bankId: 'YYYY-MM-DD' }.
// Swallows store errors so a coverage-db hiccup can't take the views page down.
function safeLastActivityMap(outputDir) {
  try {
    return lastActivityByBank(outputDir) || {};
  } catch (_) {
    return {};
  }
}

function runAccountStatusView(view, { outputDir, rep, limit = ACCOUNT_VIEW_FETCH_LIMIT }) {
  const rows = listBankAccountStatuses(outputDir, {
    status: view.statusFilter,
    limit,
    maxLimit: ACCOUNT_VIEW_FETCH_LIMIT,
    sort: 'bank'
  });
  const filtered = (view.requiresRep || (view.supportsRep && rep))
    ? rows.filter(r => ownerStringContainsRep(r.owner, rep))
    : rows;
  const lastActivity = safeLastActivityMap(outputDir);
  return {
    rows: filtered.map(row => ({
      ...summarizeBank(row),
      lastActivityDate: lastActivity[row.bankId] || ''
    })),
    columns: ['displayName', 'city', 'state', 'certNumber', 'status', 'owner', 'affiliate', 'lastActivityDate'],
    rowKind: 'bank'
  };
}

function runStrategiesView(view, { outputDir, rep }) {
  const result = listStrategyRequests(outputDir, { status: view.statusFilter });
  const matches = (result.requests || []).filter(r => {
    if (view.supportsRep && rep) {
      return ownerStringContainsRep(r.assignedTo, rep) || ownerStringContainsRep(r.requestedBy, rep);
    }
    return true;
  });
  return {
    rows: matches.map(summarizeStrategy),
    columns: ['displayName', 'city', 'state', 'requestType', 'status', 'priority', 'assignedTo', 'invoiceContact', 'updatedAt'],
    rowKind: 'strategy'
  };
}

function runFollowUpsView(view, { outputDir, rep }) {
  const today = new Date().toISOString().slice(0, 10);
  const saved = listSavedBanks(outputDir) || [];
  const matches = saved.filter(row => {
    if (!row.nextActionDate) return false;
    if (String(row.nextActionDate).slice(0, 10) >= today) return false;
    if (view.supportsRep && rep) return ownerStringContainsRep(row.owner, rep);
    return true;
  });
  const lastActivity = safeLastActivityMap(outputDir);
  return {
    rows: matches.map(row => ({
      ...summarizeFollowUp(row),
      lastActivityDate: lastActivity[row.bankId] || ''
    })),
    columns: ['displayName', 'city', 'state', 'status', 'priority', 'owner', 'nextActionDate', 'lastActivityDate'],
    rowKind: 'follow-up'
  };
}

function runBillingView(view, { outputDir }) {
  const rows = listBillingQueue(outputDir, { state: view.stateFilter });
  return {
    rows: rows.map(row => ({
      id: row.id,
      bankId: row.bankId,
      certNumber: row.certNumber,
      refType: row.refType,
      refId: row.refId,
      summary: row.summary,
      amount: row.amount,
      state: row.state,
      enqueuedAt: row.enqueuedAt,
      billedAt: row.billedAt
    })),
    columns: ['summary', 'refType', 'amount', 'state', 'enqueuedAt'],
    rowKind: 'billing'
  };
}

function runBankView({ outputDir, viewId, rep, limit }) {
  const view = getViewDefinition(viewId);
  if (!view) return null;
  if (view.requiresRep && !rep) {
    return {
      view,
      rows: [{ message: 'Pick a rep before opening this view.' }],
      columns: ['message'],
      rowKind: 'bank',
      count: 0,
      meta: { requiresRep: true }
    };
  }
  let projected;
  if (view.kind === 'account-status') projected = runAccountStatusView(view, { outputDir, rep, limit });
  else if (view.kind === 'strategies') projected = runStrategiesView(view, { outputDir, rep });
  else if (view.kind === 'follow-ups') projected = runFollowUpsView(view, { outputDir, rep });
  else if (view.kind === 'billing') projected = runBillingView(view, { outputDir });
  else return null;
  return {
    view,
    rows: projected.rows,
    columns: projected.columns,
    rowKind: projected.rowKind,
    count: projected.rows.length,
    meta: {
      rep: rep ? { username: rep.username, displayName: rep.displayName } : null
    }
  };
}

function countBankView({ outputDir, view, rep }) {
  if (view.requiresRep && !rep) return null;
  // Fast path: no rep filter on account-status views can use SQL COUNT(*).
  if (view.kind === 'account-status' && !rep) {
    return countBankAccountStatuses(outputDir, { status: view.statusFilter });
  }
  if (view.kind === 'billing') {
    return listBillingQueue(outputDir, { state: view.stateFilter }).length;
  }
  const result = runBankView({ outputDir, viewId: view.id, rep });
  return result ? result.count : 0;
}

function listBankViewSummaries({ outputDir, rep }) {
  return VIEW_DEFINITIONS.map(view => ({
    id: view.id,
    label: view.label,
    description: view.description,
    supportsRep: !!view.supportsRep,
    requiresRep: !!view.requiresRep,
    kind: view.kind,
    count: countBankView({ outputDir, view, rep })
  }));
}

const CSV_COLUMN_LABELS = {
  displayName: 'Bank',
  legalName: 'Legal Name',
  city: 'City',
  state: 'State',
  certNumber: 'FDIC Cert',
  status: 'Status',
  owner: 'Coverage Owner',
  services: 'Services',
  affiliate: 'Affiliate',
  requestType: 'Request Type',
  priority: 'Priority',
  assignedTo: 'Assigned To',
  requestedBy: 'Requested By',
  invoiceContact: 'Invoice Contact',
  completedAt: 'Completed At',
  createdAt: 'Created At',
  updatedAt: 'Updated At',
  nextActionDate: 'Next Action Date',
  lastActivityDate: 'Last Activity',
  summary: 'Summary',
  refType: 'Source',
  amount: 'Amount',
  enqueuedAt: 'Enqueued At',
  billedAt: 'Billed At',
  message: 'Message'
};

function viewToCsvRows(viewResult) {
  if (!viewResult) return [['No data']];
  if (viewResult.meta && viewResult.meta.requiresRep) {
    return [['Message'], ['Pick a rep before exporting this view.']];
  }
  const cols = viewResult.columns || [];
  const header = cols.map(c => CSV_COLUMN_LABELS[c] || c);
  const body = (viewResult.rows || []).map(row => cols.map(c => row[c] == null ? '' : row[c]));
  return [header, ...body];
}

module.exports = {
  VIEW_DEFINITIONS,
  getViewDefinition,
  listBankViewSummaries,
  listViewDefinitions,
  runBankView,
  viewToCsvRows
};
