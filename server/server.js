/**
 * FBBS Market Intelligence Portal — Internal Web App
 *
 * Serves the portal UI and accepts daily document uploads:
 *   • Market Intelligence Dashboard (HTML)
 *   • Economic Update (PDF)
 *   • Relative Value (PDF)
 *   • Treasury Notes (Excel)             ← also parsed into structured Notes
 *   • Brokered CD Rate Sheet (PDF)
 *   • Daily CD Offerings (PDF or Excel)   ← also parsed into structured Offerings
 *
 * Dependencies: pdf-parse (for extracting PDF text) and better-sqlite3 (for SQLite stores).
 *               Workbook parsing uses the vendored SheetJS wrapper in server/xlsx.js.
 *
 * Configuration (environment variables, all optional):
 *   PORT          — port to listen on (default 3000)
 *   HOST          — interface to bind (default 0.0.0.0)
 *   DATA_DIR      — where to store uploaded packages (default <app>/data)
 *   MAX_UPLOAD_MB — per-request upload cap in megabytes (default 50)
 *   LOG_LEVEL     — 'debug' | 'info' | 'warn' | 'error' (default 'info')
 */

'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AsyncLocalStorage } = require('async_hooks');
const { extractPdfText } = require('./pdf-text');

const { parseCdOffersText, parseCdOffersWorkbook } = require('./cd-offers-parser');
const { parseBrokeredCdRateSheetText } = require('./brokered-cd-parser');
const { parseMuniOffersText } = require('./muni-offers-parser');
const { parseBairdSyndicateWorkbook, looksLikeBairdSyndicateWorkbook } = require('./baird-syndicate-parser');
const { parseEconomicUpdateText } = require('./economic-update-parser');
const XLSX = require('./xlsx');
const execSummaryStore = require('./exec-summary-store');
const { parseMmdCurveText } = require('./mmd-parser');
const { parseTreasuryNotesWorkbook, looksLikeTreasuryWorkbook } = require('./treasury-notes-parser');
const { parseAgenciesFiles } = require('./agencies-parser');
const { parseCorporatesFiles } = require('./corporates-parser');
const {
  getMbsCmoSourceFile,
  loadMbsCmoInventory,
  saveMbsCmoUpload
} = require('./mbs-cmo-store');
const {
  getStructuredNoteSourceFile,
  loadStructuredNotesInventory,
  saveStructuredNotesUpload
} = require('./structured-notes-store');
const marketColorFeed = require('./market-color-feed');
const {
  loadCdInternalInventory,
  saveCdInternalUpload
} = require('./cd-internal-store');
const { emailSummary } = require('./email-source-utils');
const {
  getBankDatabaseStatus,
  getBankFromDatabase,
  getBankSummariesByIds,
  importBankWorkbook,
  listBankSummaries,
  queryBankMapDataset,
  searchBankDatabase,
  BANK_FIELDS
} = require('./bank-data-importer');
const {
  getAveragedSeriesStatus,
  loadAveragedSeriesDataset,
  saveAveragedSeriesWorkbook
} = require('./averaged-series-store');
const {
  getBondAccountingForBank,
  getBondAccountingStatus,
  importBondAccountingFolder,
  loadBondAccountingManifest,
  resolveBondAccountingStoredFile
} = require('./bond-accounting-store');
const { loadParsedPortfolio } = require('./portfolio-parser');
const {
  getWirpStatus,
  loadWirpAnalysis,
  saveWirpWorkbook
} = require('./wirp-store');
const {
  MANUAL_ACTIVITY_KINDS,
  PRODUCT_FIT_PRODUCTS,
  activityCountsByBank,
  activityCountsByRep,
  addWatchlistItem,
  listWatchlist,
  removeWatchlistItem,
  countBillingByState,
  countOpenTasks,
  createBankContact,
  createBankOpportunity,
  createBankTask,
  getBankOpportunity,
  getBankTask,
  listOpportunitiesForBank,
  listTasksForBank,
  listTasksForRep,
  pipelineSummary,
  updateBankOpportunity,
  updateBankTask,
  deleteBankActivity,
  deleteBankContact,
  deleteProductFit,
  enqueueBilling,
  getBankContact,
  getBankCoverage,
  getBillingItem,
  getPreferredPeerGroup,
  getProductFitById,
  getSavedBankCoverageMap,
  lastActivityByBank,
  listActivitiesForBank,
  listAllContacts,
  listBillingQueue,
  listContactsForBank,
  listProductFitForBank,
  listRecentManualActivities,
  listSavedBanks,
  recordBankActivity,
  recordManualActivity,
  removeSavedBank,
  setPreferredPeerGroup,
  updateBankContact,
  updateBillingItem,
  upsertProductFit,
  upsertSavedBank
} = require('./bank-coverage-store');
const {
  defaultAccountStatus,
  getBankAccountStatusImportStatus,
  getBankAccountStatuses,
  importBankAccountStatusWorkbook,
  listBankAccountStatuses,
  listDistinctAccountOwners,
  upsertBankAccountStatus
} = require('./bank-account-status-store');
const {
  aggregateRepsFromOwnerStrings,
  buildRepOverrideCookie,
  clearRepOverrideCookieHeader,
  ownerStringContainsRep,
  normalizeUsername,
  resolveRequestRep: resolveRequestRepBase
} = require('./rep-identity');
const {
  listBankViewSummaries,
  runBankView,
  viewToCsvRows
} = require('./bank-views');
const {
  addStrategyRequestFile,
  createStrategyRequest,
  deleteStrategyRequest,
  getStrategyRequest,
  getStrategyRequestFile,
  listStrategyRequests,
  summarizeStrategyCountsByBank,
  updateStrategyRequest
} = require('./strategy-store');
const {
  ensureCdHistoryDir,
  saveCdHistorySnapshot,
  summarizeWeeklyCdHistory,
  loadCdHistory
} = require('./cd-history');
const swapMath = require('./swap-math');
const swapStore = require('./swap-store');
const reportStore = require('./report-store');
const { renderProposalHtml } = require('./swap-render');
const { renderPortfolioReviewHtml } = require('./portfolio-review-render');
const { rotateFileIfNeeded } = require('./log-rotation');
const peerGroupStore = require('./peer-group-store');
const peerAverages = require('./peer-averages');
const marketRates = require('./market-rates');
const marketWire = require('./market-wire');
const fredSeries = require('./fred-series');
const fdicBankfind = require('./fdic-bankfind');
const fdicBulkSync = require('./fdic-bulk-sync');

// ---------- Config ----------

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const CURRENT_DIR = path.join(DATA_DIR, 'current');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const DROPBOX_DIR = path.join(DATA_DIR, 'dropbox');
const CD_HISTORY_DIR = path.join(DATA_DIR, 'cd-history');
const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const MBS_CMO_DIR = path.join(DATA_DIR, 'mbs-cmo');
const STRUCTURED_NOTES_DIR = path.join(DATA_DIR, 'structured-notes');
const MARKET_COLOR_DIR = path.join(DATA_DIR, 'market-color');
const CD_INTERNAL_DIR = path.join(DATA_DIR, 'cd-internal');
const EXEC_SUMMARY_DIR = path.join(DATA_DIR, 'exec-summary');
const MARKET_DIR = path.join(DATA_DIR, 'market');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');
// FRED API key: env var wins; otherwise a one-line key file under data/
// (gitignored, travels with DATA_DIR) so the double-click launchers don't
// need env-var setup. fred-series.js stays dormant when neither is present.
if (!process.env.FRED_API_KEY) {
  try {
    const fredKeyFile = path.join(MARKET_DIR, 'fred-api-key.txt');
    if (fs.existsSync(fredKeyFile)) {
      const key = fs.readFileSync(fredKeyFile, 'utf-8').trim();
      if (key) process.env.FRED_API_KEY = key;
    }
  } catch (_) { /* dormant without a key */ }
}
// Folder-drop auto-publish (FBBS_AUTO_PUBLISH=0 disables; see autoPublishTick)
const AUTO_PUBLISH_ENABLED = process.env.FBBS_AUTO_PUBLISH !== '0';
const AUTO_PUBLISH_POLL_MS = 2 * 60 * 1000;
// FDIC weekly auto-sync (FBBS_AUTO_FDIC_SYNC=0 disables; see autoFdicSyncTick)
const AUTO_FDIC_SYNC_ENABLED = process.env.FBBS_AUTO_FDIC_SYNC !== '0';
const AUTO_FDIC_SYNC_CHECK_MS = 6 * 60 * 60 * 1000; // stamp check cadence
const AUTO_FDIC_SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000; // actual run cadence
const AUDIT_LOG_MAX_BYTES = (parseInt(process.env.AUDIT_LOG_MAX_MB, 10) || 10) * 1024 * 1024;
const AUDIT_LOG_KEEP = Math.max(1, parseInt(process.env.AUDIT_LOG_KEEP, 10) || 5);
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_UPLOAD_MB, 10) || 50) * 1024 * 1024;
const BANK_UPLOAD_MAX_BYTES = (parseInt(process.env.BANK_UPLOAD_MAX_MB, 10) || 300) * 1024 * 1024;
const BANK_CACHE_MAX_ENTRIES = 200;
const AUTH_MODE = String(process.env.FBBS_AUTH_MODE || 'local').trim().toLowerCase();
const IS_IIS_AUTH_MODE = ['iis', 'windows', 'production'].includes(AUTH_MODE);
const ALLOW_REP_OVERRIDE = !IS_IIS_AUTH_MODE && process.env.FBBS_ALLOW_REP_OVERRIDE !== '0';
const ALLOW_DEFAULT_REP = !IS_IIS_AUTH_MODE;
const REQUIRE_AUTH = IS_IIS_AUTH_MODE || process.env.FBBS_REQUIRE_AUTH === '1';
const ADMIN_USERS = new Set(String(process.env.FBBS_ADMIN_USERS || '')
  .split(/[,\s;]+/)
  .map(normalizeUsername)
  .filter(Boolean));

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;
const PORTAL_BUILD = resolvePortalBuild();

// Derive the build marker from the checked-out commit so /api/health never
// reports a stale hand-bumped label. Falls back for git-less deploys (IIS zip).
function resolvePortalBuild() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['log', '-1', '--format=%h %cs'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (/^[0-9a-f]{7,} \d{4}-\d{2}-\d{2}$/.test(out)) {
      const [hash, date] = out.split(' ');
      return `${date}-${hash}`;
    }
  } catch {
    // git missing or not a repo — fall through
  }
  return 'unversioned';
}
const auditContext = new AsyncLocalStorage();

// ---------- Logging ----------

function log(level, ...args) {
  if (LOG_LEVELS[level] < LOG_LEVEL) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(prefix, ...args);
}

// ---------- Setup ----------

[DATA_DIR, CURRENT_DIR, ARCHIVE_DIR, DROPBOX_DIR, CD_HISTORY_DIR, BANK_REPORTS_DIR, MBS_CMO_DIR, STRUCTURED_NOTES_DIR, MARKET_COLOR_DIR, CD_INTERNAL_DIR, EXEC_SUMMARY_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log('info', 'Created data directory:', dir);
  }
});
ensureCdHistoryDir(CD_HISTORY_DIR);

// ---------- Constants ----------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  '.xls':  'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.csv':  'text/csv; charset=utf-8',
  '.eml':  'message/rfc822',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8'
};

const SLOT_NAMES = ['dashboard', 'econ', 'relativeValue', 'mmd', 'treasuryNotes', 'cd', 'cdoffers', 'munioffers', 'bairdSyndicate', 'agenciesBullets', 'agenciesCallables', 'corporates'];
const DOC_TYPES_LABELS = {
  dashboard: 'FBBS Sales Dashboard',
  econ: 'Economic Update',
  relativeValue: 'Relative Value',
  mmd: 'MMD Curve',
  treasuryNotes: 'Treasury Notes',
  cd: 'Brokered CD Sheet',
  cdoffers: 'Daily CD Offerings',
  munioffers: 'Muni Offerings',
  bairdSyndicate: 'Baird Syndicate Munis',
  agenciesBullets: 'Agency Bullets',
  agenciesCallables: 'Agency Callables',
  corporates: 'Corporates'
};
const CD_COST_FIELD_NAMES = new Set(['cdoffersCost', 'cdCostWorkbook', 'cdCost']);
const OFFERINGS_FILENAME = '_offerings.json';
const MUNI_OFFERINGS_FILENAME = '_muni_offerings.json';
const TREASURY_NOTES_FILENAME = '_treasury_notes.json';
const ECONOMIC_UPDATE_FILENAME = '_economic_update.json';
const RELATIVE_VALUE_FILENAME = '_relative_value.json';
const MMD_FILENAME = '_mmd.json';
const AGENCIES_FILENAME = '_agencies.json';
const CORPORATES_FILENAME = '_corporates.json';
const META_FILENAME = '_meta.json';
const BANK_WORKBOOK_FILENAME = 'current-bank-call-reports.xlsm';
const BANK_STATUS_WORKBOOK_FILENAME = 'current-bank-account-statuses.xlsb';
const BANK_SERVICES_WORKBOOK_FILENAME = 'current-bank-services.xlsx';

// ---------- Helpers ----------

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Only compress JSON past this size — below it, gzip's framing overhead and the
// CPU cost aren't worth it.
const JSON_GZIP_MIN_BYTES = 1400;

// Core JSON writer. When `req` is supplied AND the client accepts gzip AND the
// body clears the threshold, the response is gzipped; otherwise identity. Most
// call sites omit `req` (default null) and so are byte-for-byte unchanged — gzip
// is strictly opt-in per route. `gzCache` lets a hot route (the bank map) hand
// in a pre-gzipped buffer; the chosen gzip buffer is returned so it can cache it.
function writeJsonBody(res, status, body, req = null, gzCache = null) {
  const wantsGzip = !!req &&
    /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) &&
    Buffer.byteLength(body) >= JSON_GZIP_MIN_BYTES;
  if (wantsGzip) {
    const gz = gzCache || zlib.gzipSync(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store'
    });
    res.end(gz);
    return gz;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
  return null;
}

function sendJSON(res, status, data, req = null) {
  writeJsonBody(res, status, JSON.stringify(data), req);
}

// Send an already-serialized JSON string — lets a large, cacheable payload
// (e.g. the bank map dataset) skip re-stringifying on every request.
function sendJSONRaw(res, status, body, req = null) {
  writeJsonBody(res, status, body, req);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendPrintableHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  });
  res.end(html);
}

function sendFile(res, filePath, { download = false, sandboxHtml = false, filename = '', req = null } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }
    const appShellFile = path.resolve(filePath);
    const noStoreAppShell = [
      path.join(PUBLIC_DIR, 'index.html'),
      path.join(PUBLIC_DIR, 'js', 'portal.js'),
      path.join(PUBLIC_DIR, 'css', 'portal.css')
    ].some(staticPath => path.resolve(staticPath) === appShellFile);
    // Version-pinned vendored assets (public/vendor/*) never change for a given
    // URL — cache them hard so a 3.5 MB Plotly doesn't re-download every visit.
    const isVendorAsset = !noStoreAppShell &&
      appShellFile.startsWith(path.resolve(PUBLIC_DIR, 'vendor') + path.sep);
    const contentType = getContentType(filePath);
    // gzip text-y assets when the client accepts it (downloads stay raw, and
    // already-compressed binaries like pdf/xlsx/png are left untouched).
    const wantsGzip = !!req && !download &&
      /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) &&
      /^(?:text\/|application\/(?:javascript|json)|image\/svg)/.test(contentType);
    // Validators for conditional GETs (skip the always-fresh app-shell trio).
    // The ETag is encoding-specific so a gzipped and identity copy never collide
    // in a shared cache.
    const lastModified = stat.mtime.toUTCString();
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${wantsGzip ? '-gzip' : ''}"`;
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': noStoreAppShell ? 'no-store'
        : isVendorAsset ? 'public, max-age=31536000, immutable'
        : 'no-cache'
    };
    if (wantsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    } else {
      // Length is known only for the identity (un-gzipped) body.
      headers['Content-Length'] = stat.size;
    }
    if (!noStoreAppShell) {
      headers['Last-Modified'] = lastModified;
      headers['ETag'] = etag;
    }
    // Answer 304 when the client's validators still match (not for downloads or
    // the no-store app shell). Cheap stat-based revalidation; body never streams.
    if (req && !download && !noStoreAppShell) {
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      const matchesEtag = inm && inm.split(',').some(t => t.trim() === etag);
      const notSinceModified = !inm && ims &&
        new Date(ims).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000;
      if (matchesEtag || notSinceModified) {
        const h304 = {
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': headers['Cache-Control']
        };
        if (wantsGzip) h304['Vary'] = 'Accept-Encoding';
        res.writeHead(304, h304);
        return res.end();
      }
    }
    if (download) {
      const downloadName = path.basename(filename || filePath).replace(/["\r\n]/g, '');
      headers['Content-Disposition'] =
        `attachment; filename="${downloadName}"`;
    }
    if (sandboxHtml && /\.html?$/i.test(filePath)) {
      headers['Content-Security-Policy'] = 'sandbox allow-scripts';
    }
    res.writeHead(200, headers);
    if (req && req.method === 'HEAD') {
      return res.end();
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', e => {
      log('error', 'Stream error for', filePath, e.message);
      try { res.destroy(); } catch (_) {}
    });
    if (wantsGzip) {
      const gzip = zlib.createGzip();
      gzip.on('error', e => {
        log('error', 'gzip error for', filePath, e.message);
        try { res.destroy(); } catch (_) {}
      });
      stream.pipe(gzip).pipe(res);
    } else {
      stream.pipe(res);
    }
  });
}

function safeJoin(base, ...parts) {
  const target = path.resolve(base, ...parts);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function hasPrivatePathSegment(value) {
  return String(value || '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(segment => segment.startsWith('_'));
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function requestHost(req) {
  return firstHeaderValue(req.headers['x-forwarded-host'] || req.headers.host).toLowerCase();
}

function headerUrlHost(value) {
  try {
    return new URL(firstHeaderValue(value)).host.toLowerCase();
  } catch (_) {
    return null;
  }
}

function isSameOriginWrite(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;

  const host = requestHost(req);
  const origin = req.headers.origin;
  if (origin) return Boolean(host && headerUrlHost(origin) === host);

  const referer = req.headers.referer;
  if (referer) return Boolean(host && headerUrlHost(referer) === host);

  return true;
}

function isMutatingApiRequest(req, pathname) {
  const method = String(req.method || 'GET').toUpperCase();
  return pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function resolveRequestRep(req) {
  return resolveRequestRepBase(req, {
    allowCookieOverride: ALLOW_REP_OVERRIDE,
    allowDefaultRep: ALLOW_DEFAULT_REP,
    trustedIisHeadersOnly: IS_IIS_AUTH_MODE
  });
}

function authInfoForRequest(req) {
  const rep = resolveRequestRep(req);
  const isAdmin = Boolean(rep && ADMIN_USERS.has(normalizeUsername(rep.username)));
  return {
    rep,
    auth: {
      mode: IS_IIS_AUTH_MODE ? 'iis' : 'local',
      requireAuth: REQUIRE_AUTH,
      allowRepOverride: ALLOW_REP_OVERRIDE,
      isAdmin,
      adminConfigured: ADMIN_USERS.size > 0
    }
  };
}

function auditActorForRequest(req) {
  const rep = resolveRequestRep(req);
  if (!rep) return null;
  return {
    actorUsername: rep.username || '',
    actorDisplay: rep.displayName || rep.username || '',
    actorSource: rep.source || ''
  };
}

function isPublicApiPath(pathname) {
  return pathname === '/api/health';
}

function isAdminOnlyApiWrite(pathname, method) {
  const verb = String(method || 'GET').toUpperCase();
  if (!['POST', 'PATCH', 'DELETE'].includes(verb)) return false;
  return (
    pathname === '/api/upload' ||
    pathname === '/api/folder-drop/publish' ||
    pathname === '/api/mbs-cmo/upload' ||
    pathname === '/api/banks/upload' ||
    pathname === '/api/bank-account-statuses/upload' ||
    pathname === '/api/banks/averaged-series/upload' ||
    pathname === '/api/banks/bond-accounting/upload' ||
    pathname === '/api/brokered-cd/wirp/upload' ||
    pathname === '/api/exec-summary/upload'
  );
}

function rejectIfUnauthorized(req, res, pathname) {
  if (REQUIRE_AUTH && pathname.startsWith('/api/') && !isPublicApiPath(pathname)) {
    const { rep } = authInfoForRequest(req);
    if (!rep) return sendJSON(res, 401, { error: 'Windows login is required.' });
  }
  if (isAdminOnlyApiWrite(pathname, req.method) && (IS_IIS_AUTH_MODE || ADMIN_USERS.size > 0)) {
    const { rep, auth } = authInfoForRequest(req);
    if (!rep) return sendJSON(res, 401, { error: 'Login is required for this action.' });
    if (ADMIN_USERS.size === 0) return sendJSON(res, 403, { error: 'Admin allowlist is not configured.' });
    if (!auth.isAdmin) return sendJSON(res, 403, { error: 'Admin permission is required for this action.' });
  }
  return null;
}

function classifyFile(filename, explicitSlot) {
  if (explicitSlot && SLOT_NAMES.includes(explicitSlot)) return explicitSlot;
  if (!filename) return null;
  const lower = filename.toLowerCase();

  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'dashboard';

  // Excel workbook slots. Route by filename keyword.
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm') || lower.endsWith('.xls')) {
    if ((lower.includes('treasury') || lower.includes('tsy')) &&
        (lower.includes('note') || lower.includes('notes'))) {
      return 'treasuryNotes';
    }
    if (lower.includes('baird') || lower.includes('syndicate')) {
      return 'bairdSyndicate';
    }
    if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
        lower.includes('daily_cd') || lower.includes('daily cd') ||
        lower.includes('cd offering') || lower.includes('cd_offering') ||
        lower.includes('new issue cd') || lower.includes('new issue cds') ||
        lower.includes('cds - cost')) {
      return 'cdoffers';
    }
    if (looksLikeInternalCdWorkbook(filename)) return null;
    if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
    if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
    if (lower.includes('bullet')) return 'agenciesBullets';
    // Unrecognized workbook → unclassified. Do NOT blanket-default to
    // agenciesBullets: findPackageFileForSlot() scans the current package by
    // classifyFile(), and that default made any stray xlsx (a Baird muni grid,
    // a Treasury grid) get grabbed as the agency bullets file. Real bullets are
    // caught by the 'bullet' keyword or the content sniffer (sniffAgencyWorkbookSlot).
    return null;
  }

  if (lower.endsWith('.pdf')) {
    if (lower.includes('mmd') || lower.includes('municipal market data')) {
      return 'mmd';
    }
    if (lower.includes('relative_value') || lower.includes('relative value') ||
        lower.includes('relative_val') || lower.includes('relativevalue')) {
      return 'relativeValue';
    }
    // Muni offerings: "FBBS_Offerings", "Muni_Offerings", "Municipal_Offerings",
    // but NOT "CD_Offerings" / "CD_Offers" (those belong to cdoffers).
    const isMuni =
      (lower.includes('fbbs_offering') || lower.includes('fbbs offering') ||
       lower.includes('muni_offering')  || lower.includes('muni offering')  ||
       lower.includes('municipal_offering') || lower.includes('municipal offering'))
      && !lower.includes('cd_offer') && !lower.includes('cdoffer') && !lower.includes('cd offer');
    if (isMuni) return 'munioffers';

    // CD offerings
    if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
        lower.includes('daily_cd') || lower.includes('daily cd') ||
        lower.includes('cd offering') || lower.includes('cd_offering')) {
      return 'cdoffers';
    }
    // Brokered CD rate sheet
    if (lower.includes('cd_rate') || lower.includes('brokered_cd') ||
        lower.includes('brokered cd') || lower.includes('rate_sheet') ||
        lower.includes('rate sheet')) {
      return 'cd';
    }
    // Economic Update PDF: the daily file arrives as YYYYMMDD.pdf, or carries an
    // "econ" keyword. Do NOT blanket-default every unknown PDF to econ — that let
    // stray reference PDFs (e.g. an offering doc) collide with the real econ file
    // and silently overwrite it. Unknown PDFs fall through to null (reference/ignored).
    if (/^\d{8}\.pdf$/.test(lower)) return 'econ';
    if (lower.includes('econ') || lower.includes('economic')) return 'econ';
    return null;
  }
  return null;
}

function looksLikeInternalCdWorkbook(filename) {
  const lower = String(filename || '').toLowerCase();
  return /\.(xlsx|xlsm|xls)$/i.test(lower) &&
    (lower.includes('master') ||
     lower.includes('cost') ||
     lower.includes('commission') ||
     lower.includes('spreadsheet'));
}

function looksLikeWirpWorkbook(filename) {
  const lower = String(filename || '').toLowerCase();
  return /\.(xlsx|xlsm|xls)$/i.test(lower) &&
    (lower.includes('wirp') ||
     lower.includes('fed funds') ||
     lower.includes('fedfunds') ||
     /^grid\d*[_-]/i.test(path.basename(lower)));
}

function classifyFolderDropFile(filename) {
  if (!filename) return null;
  const lower = String(filename).toLowerCase();

  if (looksLikeInternalCdWorkbook(filename) || looksLikeWirpWorkbook(filename)) return null;

  if (/\.(xlsx|xlsm|xls)$/i.test(lower)) {
    if ((lower.includes('treasury') || lower.includes('tsy')) &&
        (lower.includes('note') || lower.includes('notes'))) {
      return 'treasuryNotes';
    }
    if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
        lower.includes('daily_cd') || lower.includes('daily cd') ||
        lower.includes('cd offering') || lower.includes('cd_offering') ||
        lower.includes('new issue cd') || lower.includes('new issue cds')) {
      return 'cdoffers';
    }
    if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
    if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
    if (lower.includes('bullet')) return 'agenciesBullets';
    return null;
  }

  return classifyFile(filename);
}

// Positive content detector for agency offering grids. The desk's Bloomberg
// "grid1_<hash>.xlsx" agency exports carry an issuer-ticker column ("Tkr") whose
// values are GSE issuers (FHLB / FNMA / FHLMC / FFCB / Farmer Mac). The agencies
// parser reads this grid format (abbreviated headers + per-column yield scaling),
// so these route to the agency slots. Munis (issuer column, no Tkr) and the real
// Treasury sheet (Name/CUSIP, no Tkr) don't match.
const AGENCY_ISSUER_RE = /\b(FHLB|FNMA|FHLMC|FFCB|FAMCA|FARMER\s*MAC|FED(?:ERAL)?\s*(?:HOME\s*LOAN|FARM\s*CREDIT|NAT))\b/i;
function sniffAgencyWorkbookSlot(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return null;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    const hdr = (rows[0] || []).map(h => String(h || '').toLowerCase().trim());
    const tkrIdx = hdr.findIndex(h => h === 'tkr' || h === 'ticker');
    if (tkrIdx < 0) return null;
    let dataRows = 0, agencyRows = 0;
    for (let i = 1; i < rows.length; i++) {
      const s = String((rows[i] || [])[tkrIdx] || '').trim();
      if (!s) continue;
      dataRows++;
      if (AGENCY_ISSUER_RE.test(s)) agencyRows++;
    }
    if (dataRows < 3 || agencyRows < Math.ceil(dataRows * 0.6)) return null;
    const has = s => hdr.some(h => h.includes(s));
    if (has('call typ') || has('ytnc') || has('nxt call') || has('next call')) return 'agenciesCallables';
    return 'agenciesBullets';
  } catch (err) {
    log('debug', 'Agency workbook content-classify failed:', err.message);
    return null;
  }
}

// Content fallback for folder-drop xlsx that the filename classifier left unslotted.
// Desk exports increasingly arrive with generic names ("grid1_<hash>.xlsx") that the
// same tool reuses for agency, Treasury, Baird Syndicate, and WIRP reports — the
// filename alone can't tell them apart. Peek at the workbook and route agency,
// Treasury-note, and Baird muni exports to their real slots; genuine WIRP/Fed-Funds
// books match none and fall through to reference handling. Returns a slot name or null.
function sniffWorkbookSlot(fullPath) {
  let buffer;
  try {
    buffer = fs.readFileSync(fullPath);
  } catch (err) {
    return null;
  }
  const agencySlot = sniffAgencyWorkbookSlot(buffer);
  if (agencySlot) return agencySlot;
  if (looksLikeTreasuryWorkbook(buffer)) return 'treasuryNotes';
  if (looksLikeBairdSyndicateWorkbook(buffer)) return 'bairdSyndicate';
  return null;
}

function hasBytes(buffer, bytes, offset = 0) {
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && hasBytes(buffer, [0x25, 0x50, 0x44, 0x46]);
}

function looksLikeExcel(buffer) {
  return Buffer.isBuffer(buffer) && (
    hasBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    hasBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    hasBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0])
  );
}

function looksLikeZip(buffer) {
  return Buffer.isBuffer(buffer) && (
    hasBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    hasBytes(buffer, [0x50, 0x4b, 0x05, 0x06])
  );
}

function looksLikePlainText(buffer) {
  return Buffer.isBuffer(buffer) && buffer.slice(0, 2048).indexOf(0) === -1;
}

function looksLikeHtml(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const head = buffer.slice(0, 512).toString('utf-8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
}

function looksLikePng(buffer) {
  return Buffer.isBuffer(buffer) && hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47]);
}

function looksLikeJpeg(buffer) {
  return Buffer.isBuffer(buffer) && hasBytes(buffer, [0xff, 0xd8, 0xff]);
}

function validateMbsCmoFileSignature(file) {
  if (!file || !file.data) return 'Upload is missing file data.';
  const ext = path.extname(file.filename || '').toLowerCase();
  if (!['.pdf', '.xlsx', '.xlsm', '.xlsb', '.xls', '.eml', '.png', '.jpg', '.jpeg'].includes(ext)) {
    return 'MBS/CMO uploads must be Excel, PDF, email, PNG, or JPG files.';
  }
  if (ext === '.pdf') {
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF file.`;
  }
  if (['.xlsx', '.xlsm', '.xlsb', '.xls'].includes(ext)) {
    return looksLikeExcel(file.data) ? null : `${file.filename} does not look like an Excel workbook.`;
  }
  if (ext === '.eml') {
    return looksLikePlainText(file.data) ? null : `${file.filename} does not look like an email message.`;
  }
  if (ext === '.png') {
    return looksLikePng(file.data) ? null : `${file.filename} does not look like a PNG image.`;
  }
  if (['.jpg', '.jpeg'].includes(ext)) {
    return looksLikeJpeg(file.data) ? null : `${file.filename} does not look like a JPG image.`;
  }
  return null;
}

function validateStrategyFileSignature(file) {
  if (!file || !file.data) return 'Upload is missing file data.';
  const ext = path.extname(file.filename || '').toLowerCase();
  if (!['.pdf', '.xlsx', '.xlsm', '.xlsb', '.xls', '.docx', '.csv'].includes(ext)) {
    return 'Strategy deliverables must be PDF, Excel, Word, or CSV files.';
  }
  if (ext === '.pdf') {
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF file.`;
  }
  if (['.xlsx', '.xlsm', '.xlsb', '.xls'].includes(ext)) {
    return looksLikeExcel(file.data) ? null : `${file.filename} does not look like an Excel workbook.`;
  }
  if (ext === '.docx') {
    return looksLikeZip(file.data) ? null : `${file.filename} does not look like a Word document.`;
  }
  if (ext === '.csv') {
    return looksLikePlainText(file.data) ? null : `${file.filename} does not look like a CSV file.`;
  }
  return null;
}

function validateUploadSignature(file, slot) {
  if (!file || !file.data) return 'Upload is missing file data.';
  if (slot === 'dashboard') {
    return looksLikeHtml(file.data) ? null : `${file.filename} does not look like an HTML dashboard file.`;
  }
  if (slot === 'cdoffers') {
    const ext = path.extname(file.filename || '').toLowerCase();
    if (['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      return looksLikeExcel(file.data) ? null : `${file.filename} does not look like an Excel workbook.`;
    }
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF or Excel file.`;
  }
  if (['econ', 'relativeValue', 'cd', 'munioffers', 'mmd'].includes(slot)) {
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF file.`;
  }
  if (slot === 'bairdSyndicate') {
    return looksLikeExcel(file.data) ? null : `${file.filename} does not look like an Excel workbook.`;
  }
  if (['treasuryNotes', 'agenciesBullets', 'agenciesCallables', 'corporates'].includes(slot)) {
    return looksLikeExcel(file.data) ? null : `${file.filename} does not look like an Excel workbook.`;
  }
  return null;
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateStampFromDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Sniff the likely document date from a filename.
 * Recognizes YYYYMMDD, MM_DD_YYYY, MM-DD-YYYY, MM.DD.YYYY,
 * and 2-digit-year variants. Returns null if none found.
 */
function sniffDateFromFilename(filename) {
  if (!filename) return null;

  let m = filename.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const [, y, mm, dd] = m;
    if (isValidYmd(y, mm, dd)) return `${y}-${mm}-${dd}`;
  }

  m = filename.match(/(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](\d{4})(?!\d)/);
  if (m) {
    const [, mo, d, y] = m;
    const mm = mo.padStart(2, '0');
    const dd = d.padStart(2, '0');
    if (isValidYmd(y, mm, dd)) return `${y}-${mm}-${dd}`;
  }

  // 2-digit year: MM_DD_YY / MM-DD-YY / MM.DD.YY, e.g. "bullets 04.24.26.xlsx"
  // Assume 20YY to stay sane in the 21st century.
  m = filename.match(/(?<!\d)(\d{1,2})[._-](\d{1,2})[._-](\d{2})(?!\d)/);
  if (m) {
    const [, mo, d, yy] = m;
    const y = '20' + yy;
    const mm = mo.padStart(2, '0');
    const dd = d.padStart(2, '0');
    if (isValidYmd(y, mm, dd)) return `${y}-${mm}-${dd}`;
  }

  return null;
}

function deriveCurrentPackageDateFromFiles(dir, filenames = null) {
  const names = (filenames || (fs.existsSync(dir) ? fs.readdirSync(dir) : []))
    .filter(name => name && name !== '.gitkeep' && name !== '.DS_Store' && !name.startsWith('_'));
  if (!names.length) return null;

  let newestMtime = null;
  const sniffedDates = new Set();
  for (const name of names) {
    const sniffed = sniffDateFromFilename(name);
    if (sniffed) sniffedDates.add(sniffed);
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (stat.isFile() && (!newestMtime || stat.mtimeMs > newestMtime.mtimeMs)) newestMtime = stat;
    } catch (_) {}
  }

  const mtimeDate = newestMtime ? dateStampFromDate(newestMtime.mtime) : null;
  const agreedSniffDate = sniffedDates.size === 1 ? [...sniffedDates][0] : null;
  if (mtimeDate && mtimeDate !== todayStamp()) return mtimeDate;
  return agreedSniffDate || mtimeDate || null;
}

function isValidYmd(y, mm, dd) {
  const yi = parseInt(y, 10), mi = parseInt(mm, 10), di = parseInt(dd, 10);
  if (yi < 2000 || yi > 2100) return false;
  if (mi < 1 || mi > 12) return false;
  if (di < 1 || di > 31) return false;
  return true;
}

// ---------- Multipart parser ----------

function parseMultipart(req, boundary, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        const err = new Error('Upload exceeds maximum allowed size');
        err.statusCode = 413;
        reject(err);
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', err => { if (!aborted) reject(err); });

    req.on('end', () => {
      if (aborted) return;
      try {
        const buffer = Buffer.concat(chunks);
        const boundaryBuf = Buffer.from('--' + boundary);
        const parts = [];
        let cursor = 0;

        while (cursor < buffer.length) {
          const boundaryIdx = buffer.indexOf(boundaryBuf, cursor);
          if (boundaryIdx === -1) break;

          if (cursor > 0) {
            let end = boundaryIdx;
            if (end >= 2 &&
                buffer[end - 2] === 0x0d &&
                buffer[end - 1] === 0x0a) {
              end -= 2;
            }
            parts.push(buffer.slice(cursor, end));
          }

          let next = boundaryIdx + boundaryBuf.length;
          if (buffer[next] === 0x2d && buffer[next + 1] === 0x2d) break;
          if (buffer[next] === 0x0d && buffer[next + 1] === 0x0a) next += 2;
          cursor = next;
        }

        const files = [];
        const fields = {};

        for (const part of parts) {
          if (!part || part.length === 0) continue;
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;

          const headerStr = part.slice(0, headerEnd).toString('utf-8');
          const body = part.slice(headerEnd + 4);

          // Anchor the field-name capture on a boundary so it can't match the
          // `name="…"` substring inside `filename="…"` (e.g. a part that carries
          // only filename= and no real name=).
          const nameMatch = headerStr.match(/(?:^|[;\s])name="([^"]+)"/i);
          const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
          if (!nameMatch) continue;

          const fieldName = nameMatch[1];

          if (filenameMatch && filenameMatch[1]) {
            let explicitSlot = null;
            let companionRole = null;
            if (CD_COST_FIELD_NAMES.has(fieldName)) {
              explicitSlot = 'cdoffers';
              companionRole = 'cdCostWorkbook';
            } else if (SLOT_NAMES.includes(fieldName)) {
              explicitSlot = fieldName;
            } else {
              const m = fieldName.match(/(?:file[_-]?)?(dashboard|econ|relativeValue|treasuryNotes|cdoffers|munioffers|bairdSyndicate|agenciesBullets|agenciesCallables|corporates|cd)/i);
              if (m) {
                const token = m[1];
                // Normalize the canonical form (case-sensitive slot names)
                const canonical = SLOT_NAMES.find(s => s.toLowerCase() === token.toLowerCase());
                explicitSlot = canonical || null;
              }
            }
            files.push({
              fieldName,
              filename: filenameMatch[1],
              data: body,
              explicitSlot,
              companionRole
            });
          } else {
            fields[fieldName] = body.toString('utf-8');
          }
        }

        resolve({ files, fields });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        const err = new Error('Request body exceeds maximum allowed size');
        err.statusCode = 413;
        reject(err);
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', err => { if (!aborted) reject(err); });
    req.on('end', () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString('utf-8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        err.statusCode = 400;
        err.message = 'Request body must be valid JSON';
        reject(err);
      }
    });
  });
}

function normalizeDropDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayStamp();
}

function dropboxDirForDate(dateValue) {
  const date = normalizeDropDate(dateValue);
  return safeJoin(DROPBOX_DIR, date);
}

// ---------- Filename sanitization ----------

function sanitizeFilename(original) {
  let name = path.basename(original || '').trim();
  name = name.replace(/[^A-Za-z0-9._\- ]/g, '_');
  name = name.replace(/_{2,}/g, '_');
  name = name.replace(/^\.+/, '');
  if (!name) name = 'file';
  if (name.length > 180) {
    const ext = path.extname(name);
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name;
}

// ---------- Offerings extraction ----------

async function extractOfferings(file) {
  try {
    const ext = path.extname(file.filename || '').toLowerCase();
    if (['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      return parseCdOffersWorkbook(file.data, { filename: file.filename });
    }
    const result = await extractPdfText(file.data);
    const parsed = parseCdOffersText(result.text || '');
    return parsed;
  } catch (err) {
    log('warn', 'Offerings extraction failed:', err.message);
    return null;
  }
}

async function extractCdOfferingsPackage(files) {
  const cdFiles = (files || []).filter(f => classifyFile(f.filename, f.explicitSlot) === 'cdoffers');
  if (!cdFiles.length) return null;

  const pdfFile = cdFiles.find(f => f.companionRole !== 'cdCostWorkbook' && /\.pdf$/i.test(f.filename || ''));
  const workbookFile = cdFiles.find(f =>
    f.companionRole === 'cdCostWorkbook' || /\.(xlsx|xlsm|xls)$/i.test(f.filename || '')
  );
  const primaryFile = pdfFile || workbookFile || cdFiles[0];
  const existingPayload = !pdfFile && workbookFile ? loadExistingCdOfferingsPayload() : null;
  const primary = existingPayload || await extractOfferings(primaryFile);
  if (!primary || !Array.isArray(primary.offerings)) return primary;

  const sources = Array.isArray(primary.sourceFiles)
    ? [...primary.sourceFiles]
    : [primary.sourceFile || sanitizeFilename(primaryFile.filename)].filter(Boolean);
  let costSourceFile = null;
  let warnings = Array.isArray(primary.warnings) ? [...primary.warnings] : [];
  let offerings = primary.offerings;
  let asOfDate = primary.asOfDate || null;

  if (workbookFile) {
    const workbook = await extractOfferings(workbookFile);
    if (!sources.includes(sanitizeFilename(workbookFile.filename))) {
      sources.push(sanitizeFilename(workbookFile.filename));
    }
    costSourceFile = sanitizeFilename(workbookFile.filename);
    if (workbook && Array.isArray(workbook.offerings)) {
      warnings = warnings.concat((workbook.warnings || []).map(w => `Cost workbook: ${w}`));
      if (!asOfDate && workbook.asOfDate) asOfDate = workbook.asOfDate;
      offerings = mergeCdCostFields(offerings, workbook.offerings);
    } else {
      warnings.push('Cost workbook was uploaded but could not be parsed.');
    }
  }

  return {
    ...primary,
    asOfDate,
    warnings,
    offerings,
    sourceFile: existingPayload ? primary.sourceFile : sanitizeFilename(primaryFile.filename),
    sourceFiles: sources,
    costSourceFile
  };
}

function mergeCdCostFields(baseOfferings, costOfferings) {
  const costsByCusip = new Map();
  for (const row of costOfferings || []) {
    const cusip = String(row && row.cusip || '').toUpperCase();
    if (!cusip) continue;
    costsByCusip.set(cusip, row);
  }

  return (baseOfferings || []).map(row => {
    const costRow = costsByCusip.get(String(row && row.cusip || '').toUpperCase());
    if (!costRow) return row;
    const merged = { ...row };
    if (costRow.cost != null) merged.cost = costRow.cost;
    if (costRow.commission != null) merged.commission = costRow.commission;
    return merged;
  });
}

function loadExistingCdOfferingsPayload() {
  const p = path.join(CURRENT_DIR, OFFERINGS_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return payload && Array.isArray(payload.offerings) ? payload : null;
  } catch (err) {
    log('warn', 'Could not read existing CD offerings for cost merge:', err.message);
    return null;
  }
}

async function extractBrokeredCdRates(pdfBuffer) {
  try {
    const result = await extractPdfText(pdfBuffer);
    return parseBrokeredCdRateSheetText(result.text || '');
  } catch (err) {
    log('error', 'Brokered CD Rate Sheet extraction failed:', err.message);
    return null;
  }
}

async function extractMuniOfferings(pdfBuffer) {
  try {
    const result = await extractPdfText(pdfBuffer);
    const parsed = parseMuniOffersText(result.text || '');
    return parsed;
  } catch (err) {
    log('warn', 'Muni offerings extraction failed:', err.message);
    return null;
  }
}

function extractBairdSyndicateOfferings(workbookBuffer) {
  try {
    return parseBairdSyndicateWorkbook(workbookBuffer);
  } catch (err) {
    log('warn', 'Baird Syndicate workbook extraction failed:', err.message);
    return null;
  }
}

async function extractEconomicUpdate(pdfBuffer, sourceFile) {
  try {
    const result = await extractPdfText(pdfBuffer);
    return parseEconomicUpdateText(result.text || '', { sourceFile });
  } catch (err) {
    log('warn', 'Economic Update extraction failed:', err.message);
    return null;
  }
}

// ---------- Package reading ----------

function readMetaFile(dirPath) {
  const metaPath = path.join(dirPath, META_FILENAME);
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) || {};
  } catch (e) {
    log('warn', 'Could not read meta in', dirPath, '-', e.message);
    return {};
  }
}

function fileExistsInDir(dirPath, filename) {
  if (typeof filename !== 'string' || !filename || filename.startsWith('_')) return false;
  const filePath = safeJoin(dirPath, filename);
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

function metadataSlotFilename(meta, slot, dirPath, files) {
  const filename = meta && meta.slotFilenames && meta.slotFilenames[slot];
  if (typeof filename !== 'string' || !filename || filename.startsWith('_')) return null;
  if (Array.isArray(files) && !files.includes(filename)) return null;
  const classifiedSlot = classifyFile(filename);
  if (slot === 'mmd' && classifiedSlot !== 'mmd') return null;
  if (slot === 'econ' && classifiedSlot === 'mmd') return null;
  return fileExistsInDir(dirPath, filename) ? filename : null;
}

function findPackageFileForSlot(dirPath, slot, meta = {}, files = null) {
  const names = Array.isArray(files)
    ? files
    : fs.existsSync(dirPath)
      ? fs.readdirSync(dirPath).filter(f => !f.startsWith('_'))
      : [];

  const fromMeta = metadataSlotFilename(meta, slot, dirPath, names);
  if (fromMeta) return fromMeta;

  return names.find(filename => classifyFile(filename) === slot) || null;
}

function findMmdPdfInPackage(dirPath, files = null) {
  const names = Array.isArray(files)
    ? files
    : fs.existsSync(dirPath)
      ? fs.readdirSync(dirPath).filter(f => !f.startsWith('_'))
      : [];

  return names.find(filename => /\.pdf$/i.test(filename) && classifyFile(filename) === 'mmd') || null;
}

function readSlotFileForPackage(dirPath, slot, { slotFilenames = {}, priorMeta = {} } = {}) {
  const filename = slotFilenames[slot] || findPackageFileForSlot(dirPath, slot, priorMeta);
  if (!filename) return null;

  const filePath = safeJoin(dirPath, filename);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return { filename, buffer: fs.readFileSync(filePath) };
  } catch (err) {
    log('warn', `Could not read ${slot} file ${filename}:`, err.message);
    return null;
  }
}

function collectAgencyPackageFiles(dirPath, { slotFilenames = {}, priorMeta = {} } = {}) {
  const slots = ['agenciesBullets', 'agenciesCallables'];
  const files = [];
  const missingSlots = [];

  for (const slot of slots) {
    const file = readSlotFileForPackage(dirPath, slot, { slotFilenames, priorMeta });
    if (file) {
      files.push({ ...file, slot });
    } else {
      missingSlots.push(slot);
    }
  }

  return { files, missingSlots };
}

function readPackageDir(dirPath, { dateIfMissingMeta = null } = {}) {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('_'));
  const meta = readMetaFile(dirPath);
  const pkg = {
    date: dateIfMissingMeta,
    dashboard: null,
    econ: null,
    relativeValue: null,
    mmd: null,
    treasuryNotes: null,
    cd: null,
    cdoffers: null,
    cdoffersCost: null,
    cdoffersFiles: [],
    munioffers: null,
    agenciesBullets: null,
    agenciesCallables: null,
    corporates: null,
    publishedAt: null,
    publishedBy: null,
    offeringsCount: null,
    muniOfferingsCount: null,
    treasuryNotesCount: null,
    agencyCount: null,
    agencyFileDate: null,
    corporatesCount: null,
    corporatesFileDate: null,
    relativeValueRowsCount: null,
    mmdCurveCount: null
  };

  const assignedFromMeta = new Set();
  for (const filenames of Object.values(meta.slotFileLists || {})) {
    if (!Array.isArray(filenames)) continue;
    filenames.forEach(filename => assignedFromMeta.add(filename));
  }
  for (const slot of SLOT_NAMES) {
    const filename = metadataSlotFilename(meta, slot, dirPath, files);
    if (filename) {
      pkg[slot] = filename;
      assignedFromMeta.add(filename);
    }
  }

  for (const f of files) {
    if (assignedFromMeta.has(f)) continue;
    const type = classifyFile(f);
    if (type && !pkg[type]) pkg[type] = f;
  }

  if (!pkg.mmd) {
    pkg.mmd = findMmdPdfInPackage(dirPath, files);
  }

  if (meta.date) pkg.date = meta.date;
  if (meta.publishedAt) pkg.publishedAt = meta.publishedAt;
  if (meta.publishedBy) pkg.publishedBy = meta.publishedBy;
  if (typeof meta.offeringsCount === 'number') pkg.offeringsCount = meta.offeringsCount;
  if (typeof meta.muniOfferingsCount === 'number') pkg.muniOfferingsCount = meta.muniOfferingsCount;
  if (typeof meta.treasuryNotesCount === 'number') pkg.treasuryNotesCount = meta.treasuryNotesCount;
  if (typeof meta.agencyCount === 'number') pkg.agencyCount = meta.agencyCount;
  if (meta.agencyFileDate) pkg.agencyFileDate = meta.agencyFileDate;
  if (typeof meta.corporatesCount === 'number') pkg.corporatesCount = meta.corporatesCount;
  if (meta.corporatesFileDate) pkg.corporatesFileDate = meta.corporatesFileDate;
  if (Array.isArray(meta.brokeredCdTerms)) pkg.brokeredCdTerms = meta.brokeredCdTerms;
  if (meta.brokeredCdAsOfDate) pkg.brokeredCdAsOfDate = meta.brokeredCdAsOfDate;
  if (typeof meta.relativeValueRowsCount === 'number') pkg.relativeValueRowsCount = meta.relativeValueRowsCount;
  if (typeof meta.mmdCurveCount === 'number') pkg.mmdCurveCount = meta.mmdCurveCount;

  const cdOfferFiles = Array.isArray(meta.slotFileLists && meta.slotFileLists.cdoffers)
    ? meta.slotFileLists.cdoffers.filter(filename => fileExistsInDir(dirPath, filename))
    : [];
  if (cdOfferFiles.length) {
    pkg.cdoffersFiles = cdOfferFiles;
    const pdf = cdOfferFiles.find(filename => /\.pdf$/i.test(filename));
    const workbook = cdOfferFiles.find(filename => /\.(xlsx|xlsm|xls)$/i.test(filename));
    if (pdf) pkg.cdoffers = pdf;
    if (workbook) pkg.cdoffersCost = workbook;
  } else {
    const offeringsPath = path.join(dirPath, OFFERINGS_FILENAME);
    if (fs.existsSync(offeringsPath)) {
      try {
        const offerings = JSON.parse(fs.readFileSync(offeringsPath, 'utf-8'));
        if (offerings.costSourceFile && fileExistsInDir(dirPath, offerings.costSourceFile)) {
          pkg.cdoffersCost = offerings.costSourceFile;
        }
      } catch (err) {
        log('debug', 'Could not read offerings metadata for cost source:', err.message);
      }
    }
  }

  if (pkg.relativeValueRowsCount == null) {
    const rvPath = path.join(dirPath, RELATIVE_VALUE_FILENAME);
    if (fs.existsSync(rvPath)) {
      try {
        const rv = JSON.parse(fs.readFileSync(rvPath, 'utf-8'));
        if (Array.isArray(rv.rows)) pkg.relativeValueRowsCount = rv.rows.length;
      } catch (err) {
        log('debug', 'Could not read relative-value metadata:', err.message);
      }
    }
  }

  return pkg;
}

let currentPackageCache = null;
let archiveListCache = null;
// Parsed per-slot JSON for the current package (cd/muni/treasury/agencies/
// corporates), keyed by slot filename. Avoids re-reading + re-parsing the same
// five files on every swap/inventory request. Cleared on every publish.
const currentSlotCache = new Map();

function invalidatePackageCache() {
  currentPackageCache = null;
  archiveListCache = null;
  currentSlotCache.clear();
}

// Read + parse a current-package slot JSON file, memoized until the next publish.
// Returns the parsed object, or null if the file is absent/unreadable.
function readCurrentSlotJson(filename, label) {
  if (currentSlotCache.has(filename)) return currentSlotCache.get(filename);
  let value = null;
  const p = path.join(CURRENT_DIR, filename);
  if (fs.existsSync(p)) {
    try {
      value = JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
      log('warn', `Could not read ${label} file:`, e.message);
      value = null;
    }
  }
  currentSlotCache.set(filename, value);
  return value;
}

function getCurrentPackage() {
  if (!currentPackageCache) {
    currentPackageCache = readPackageDir(CURRENT_DIR, { dateIfMissingMeta: null });
  }
  return currentPackageCache;
}

function getArchiveList() {
  if (archiveListCache) return archiveListCache;
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  archiveListCache = fs.readdirSync(ARCHIVE_DIR)
    .filter(d => {
      const full = path.join(ARCHIVE_DIR, d);
      return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    })
    .sort()
    .reverse()
    .map(dir => readPackageDir(path.join(ARCHIVE_DIR, dir), { dateIfMissingMeta: dir }));
  return archiveListCache;
}

function loadCurrentOfferings() {
  return readCurrentSlotJson(OFFERINGS_FILENAME, 'offerings');
}

async function loadEconomicUpdateFromDir(dirPath) {
  const jsonPath = path.join(dirPath, ECONOMIC_UPDATE_FILENAME);
  if (fs.existsSync(jsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (e) {
      log('warn', 'Could not read economic update file:', e.message);
    }
  }

  const pkg = readPackageDir(dirPath);
  if (!pkg || !pkg.econ) return null;
  const pdfPath = path.join(dirPath, pkg.econ);
  if (!fs.existsSync(pdfPath)) return null;
  const parsed = await extractEconomicUpdate(fs.readFileSync(pdfPath), pkg.econ);
  if (!parsed) return null;
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
  } catch (err) {
    log('warn', 'Could not cache economic update JSON:', err.message);
  }
  return parsed;
}

function loadCurrentEconomicUpdate() {
  return loadEconomicUpdateFromDir(CURRENT_DIR);
}

function loadArchivedEconomicUpdate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return loadEconomicUpdateFromDir(path.join(ARCHIVE_DIR, date));
}

function seedCdHistoryFromCurrentPackage() {
  const current = loadCurrentOfferings();
  if (!current || !current.asOfDate || !Array.isArray(current.offerings)) return;
  const target = path.join(CD_HISTORY_DIR, `${current.asOfDate}.json`);
  if (fs.existsSync(target)) return;
  try {
    saveCdHistorySnapshot(CD_HISTORY_DIR, current, {
      uploadedAt: current.extractedAt || new Date().toISOString(),
      uploadDate: current.asOfDate
    });
    log('info', `Seeded CD history from current package for ${current.asOfDate}`);
  } catch (err) {
    log('warn', 'Could not seed CD history from current package:', err.message);
  }
}

seedCdHistoryFromCurrentPackage();

function loadArchivedOfferings(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const offPath = path.join(ARCHIVE_DIR, date, OFFERINGS_FILENAME);
  if (!fs.existsSync(offPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(offPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function loadCurrentMuniOfferings() {
  return readCurrentSlotJson(MUNI_OFFERINGS_FILENAME, 'muni offerings');
}

function loadArchivedMuniOfferings(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const offPath = path.join(ARCHIVE_DIR, date, MUNI_OFFERINGS_FILENAME);
  if (!fs.existsSync(offPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(offPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

async function loadMmdCurveFromPackage(dirPath, { writeCache = false } = {}) {
  const p = path.join(dirPath, MMD_FILENAME);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
      log('warn', 'Could not read MMD curve file:', e.message);
    }
  }

  const sourceFile = findMmdPdfInPackage(dirPath);
  if (!sourceFile) return null;

  const sourcePath = safeJoin(dirPath, sourceFile);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  try {
    const extracted = await extractPdfText(fs.readFileSync(sourcePath));
    const payload = parseMmdCurveText(extracted && extracted.text);
    payload.extractedAt = new Date().toISOString();
    payload.sourceFile = sourceFile;
    if (writeCache) {
      fs.writeFileSync(p, JSON.stringify(payload, null, 2));
    }
    return payload;
  } catch (e) {
    log('warn', `Could not extract MMD curve from ${sourceFile}:`, e.message);
    return null;
  }
}

function loadCurrentMmdCurve() {
  return loadMmdCurveFromPackage(CURRENT_DIR, { writeCache: true });
}

function loadArchivedMmdCurve(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return loadMmdCurveFromPackage(path.join(ARCHIVE_DIR, date));
}

function loadCurrentTreasuryNotes() {
  return readCurrentSlotJson(TREASURY_NOTES_FILENAME, 'treasury notes');
}

function loadArchivedTreasuryNotes(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const p = path.join(ARCHIVE_DIR, date, TREASURY_NOTES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function relativeValueNumber(value) {
  if (value == null || /^#?N\/A$/i.test(String(value))) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function muniTeyFromRate(yieldPct, taxRatePct) {
  const y = Number(yieldPct);
  const r = Number(taxRatePct);
  if (!Number.isFinite(y) || !Number.isFinite(r) || r >= 100) return null;
  return y / (1 - (r / 100));
}

function parseRelativeValueSnapshotText(text) {
  const terms = new Set(['6 Mo', '9 Mo', '12 Mo', '18 Mo', '2 Yr', '3 Yr', '4 Yr', '5 Yr', '7 Yr', '10 Yr']);
  const rows = [];

  String(text || '').split(/\r?\n/).forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) return;
    const term = `${parts[0]} ${parts[1]}`;
    if (!terms.has(term)) return;

    const values = parts.slice(2);
    if (!/^-?\d+(\.\d+)?$/.test(values[0] || '')) return;

    const ust = relativeValueNumber(values[0]);
    const cd = relativeValueNumber(values[1]);
    let cdSpread = null;
    let agencyIndex = 2;
    if (values.length >= 9) {
      cdSpread = relativeValueNumber(values[2]);
      agencyIndex = 3;
    }

    const agency = relativeValueNumber(values[agencyIndex]);
    const agencySpread = relativeValueNumber(values[agencyIndex + 1]);
    const muni = relativeValueNumber(values[agencyIndex + 2]);
    const muniSpread = relativeValueNumber(values[agencyIndex + 3]);
    const corp = relativeValueNumber(values[agencyIndex + 4]);
    const corpSpread = relativeValueNumber(values[agencyIndex + 5]);

    if (ust == null || agency == null || muni == null || corp == null) return;
    rows.push({
      term,
      ust,
      cd,
      cdSpread,
      agency,
      agencySpread,
      muni,
      muniSpread,
      muniTey296: muniTeyFromRate(muni, 29.6),
      muniTey21: muniTeyFromRate(muni, 21),
      corp,
      corpSpread
    });
  });

  return rows;
}

async function loadRelativeValueSnapshotFromDir(dirPath) {
  const jsonPath = path.join(dirPath, RELATIVE_VALUE_FILENAME);
  const pkg = readPackageDir(dirPath);
  if (!pkg || !pkg.relativeValue) return null;
  if (fs.existsSync(jsonPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (cached && cached.sourceFile === pkg.relativeValue && Array.isArray(cached.rows)) {
        return cached;
      }
    } catch (err) {
      log('warn', 'Could not read relative value cache:', err.message);
    }
  }

  const pdfPath = safeJoin(dirPath, pkg.relativeValue);
  if (!pdfPath || !fs.existsSync(pdfPath)) return null;

  const extracted = await extractPdfText(fs.readFileSync(pdfPath));
  const rows = parseRelativeValueSnapshotText(extracted && extracted.text);
  const parsed = {
    asOfDate: pkg.date || null,
    publishedAt: pkg.publishedAt || null,
    extractedAt: new Date().toISOString(),
    sourceFile: pkg.relativeValue,
    rows,
    series: [
      { key: 'ust', label: 'UST Yield' },
      { key: 'agency', label: 'US AGY' },
      { key: 'muniTey296', label: "MUNI GO 'AA' TEY (29.6%)" },
      { key: 'muniTey21', label: "MUNI GO 'AA' TEY (21%)" },
      { key: 'corp', label: "'AA' Corp" }
    ],
    warnings: rows.length ? [] : ['Could not extract the rate snapshot table from the Relative Value PDF.']
  };

  try {
    fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
  } catch (err) {
    log('warn', 'Could not cache relative value JSON:', err.message);
  }

  return parsed;
}

function loadCurrentRelativeValueSnapshot() {
  return loadRelativeValueSnapshotFromDir(CURRENT_DIR);
}

function loadArchivedRelativeValueSnapshot(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return loadRelativeValueSnapshotFromDir(path.join(ARCHIVE_DIR, date));
}

function loadCurrentAgencies() {
  return readCurrentSlotJson(AGENCIES_FILENAME, 'agencies');
}

function loadArchivedAgencies(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const p = path.join(ARCHIVE_DIR, date, AGENCIES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function loadCurrentCorporates() {
  return readCurrentSlotJson(CORPORATES_FILENAME, 'corporates');
}

function numericValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function yearsUntil(dateStr, anchorDate) {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00Z`);
  const anchor = anchorDate ? new Date(`${anchorDate}T00:00:00Z`) : new Date();
  if (Number.isNaN(date.getTime()) || Number.isNaN(anchor.getTime())) return null;
  return (date.getTime() - anchor.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

function chooseTop(rows, scoreFn) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({ row, score: scoreFn(row) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)[0]?.row || null;
}

function firstBySort(rows, compareFn) {
  return (Array.isArray(rows) ? rows : []).slice().sort(compareFn)[0] || null;
}

function pickRetailCd(offerings) {
  const row = firstBySort(offerings, (a, b) => {
    const rateDiff = (numericValue(b.rate) || -Infinity) - (numericValue(a.rate) || -Infinity);
    if (rateDiff) return rateDiff;
    return (numericValue(a.termMonths) || Infinity) - (numericValue(b.termMonths) || Infinity);
  });
  if (!row) return null;
  return {
    type: 'Retail CD',
    audience: ['Bank', 'RIA'],
    label: row.term || 'CD',
    title: row.name || 'CD offering',
    value: row.rate != null ? `${Number(row.rate).toFixed(2)}%` : null,
    detail: [row.term, row.maturity, row.issuerState].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'explorer',
    reason: 'Highest retail CD offering rate in the current package, with shorter terms winning ties.'
  };
}

function pickMuniBq(offerings) {
  const row = chooseTop((offerings || []).filter(o => String(o.section || '').toUpperCase() === 'BQ'), o => numericValue(o.ytw));
  if (!row) return null;
  const ytw = numericValue(row.ytw);
  const tey296 = ytw == null ? null : ytw / (1 - 0.296);
  const tey21 = ytw == null ? null : ytw / (1 - 0.21);
  return {
    type: 'BQ Muni',
    audience: ['S-Corp Bank', 'Tax-aware'],
    label: row.issuerState || 'BQ',
    title: row.issuerName || 'Bank-qualified muni',
    value: ytw != null ? `${ytw.toFixed(3)}% YTW` : null,
    detail: [
      row.maturity,
      row.callDate ? `call ${row.callDate}` : '',
      row.moodysRating || row.spRating || ''
    ].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'muni-explorer',
    metrics: {
      tey21: tey21 == null ? null : Number(tey21.toFixed(3)),
      tey296: tey296 == null ? null : Number(tey296.toFixed(3))
    },
    reason: 'Highest YTW in the current bank-qualified muni slate; TEY is calculated from YTW.'
  };
}

function pickAgencySpread(offerings, packageDate) {
  const candidates = (offerings || []).filter(o => {
    const years = yearsUntil(o.maturity, packageDate);
    return numericValue(o.askSpread) != null && years != null && years > 0 && years <= 10.5;
  });
  const row = chooseTop(candidates, o => {
    const spread = numericValue(o.askSpread) || 0;
    const ytm = numericValue(o.ytm) || 0;
    const size = Math.log10(Math.max(numericValue(o.availableSize) || 0, 1));
    return spread * 3 + ytm + size;
  });
  if (!row) return null;
  return {
    type: 'Agency RV',
    audience: ['C-Corp Bank', 'Bank'],
    label: row.structure || 'Agency',
    title: `${row.ticker || 'Agency'} ${row.coupon != null ? Number(row.coupon).toFixed(3) + '%' : ''} ${row.maturity || ''}`.trim(),
    value: row.ytm != null ? `${Number(row.ytm).toFixed(3)}% YTM` : null,
    detail: [
      row.askSpread != null ? `${Number(row.askSpread).toFixed(1)}bp vs ${row.benchmark || 'benchmark'}` : '',
      row.availableSize != null ? `$${Number(row.availableSize).toFixed(2)}MM available` : ''
    ].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'agencies',
    reason: 'Best positive spread score inside a bank-friendly maturity window, with size used as a tie-breaker.'
  };
}

function pickAgencyCallable(offerings, packageDate) {
  const candidates = (offerings || []).filter(o => {
    const years = yearsUntil(o.maturity, packageDate);
    const ytnc = numericValue(o.ytnc);
    return o.structure === 'Callable' && years != null && years > 0 && years <= 15 && ytnc != null && ytnc > 0 && ytnc < 20;
  });
  const row = chooseTop(candidates, o => {
    const coupon = numericValue(o.coupon) || 0;
    const ytm = numericValue(o.ytm) || 0;
    const ytnc = numericValue(o.ytnc) || 0;
    return coupon * 0.7 + ytm + Math.min(ytnc, 10) * 0.4;
  });
  if (!row) return null;
  return {
    type: 'Callable Agency',
    audience: ['Bank'],
    label: row.callType || 'Callable',
    title: `${row.ticker || 'Agency'} ${row.coupon != null ? Number(row.coupon).toFixed(3) + '%' : ''} ${row.maturity || ''}`.trim(),
    value: row.ytm != null ? `${Number(row.ytm).toFixed(3)}% YTM` : null,
    detail: [
      row.nextCallDate ? `next call ${row.nextCallDate}` : '',
      row.ytnc != null ? `${Number(row.ytnc).toFixed(3)}% YTNC` : ''
    ].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'agencies',
    reason: 'Callable screen favors usable YTM, higher coupon income, and realistic yield-to-next-call values.'
  };
}

function pickTreasury(offers, packageDate) {
  const candidates = (offers || []).filter(o => {
    const years = yearsUntil(o.maturity, packageDate);
    return years != null && years > 0.25 && years <= 10.5 && numericValue(o.yield) != null;
  });
  const row = chooseTop(candidates, o => {
    const yld = numericValue(o.yield) || 0;
    const spread = numericValue(o.spread) || 0;
    const price = numericValue(o.price);
    const discountBonus = price != null && price < 100 ? (100 - price) * 0.03 : 0;
    return yld + spread * 0.01 + discountBonus;
  });
  if (!row) return null;
  return {
    type: 'Treasury',
    audience: ['Bank', 'RIA'],
    label: row.benchmark || row.type || 'UST',
    title: row.description || 'Treasury offering',
    value: row.yield != null ? `${Number(row.yield).toFixed(3)}% YTM` : null,
    detail: [row.maturity, row.price != null ? `price ${Number(row.price).toFixed(3)}` : ''].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'treasury-explorer',
    reason: 'Highest Treasury score inside 10 years, factoring yield, spread, and discount entry.'
  };
}

function pickCorporateRia(offerings, packageDate) {
  const candidates = (offerings || []).filter(o => {
    const years = yearsUntil(o.maturity, packageDate);
    return o.investmentGrade && years != null && years > 0 && years <= 30 && numericValue(o.ytm) != null;
  });
  const row = chooseTop(candidates, o => {
    const ytm = numericValue(o.ytm) || 0;
    const tierPenalty = o.creditTier === 'BBB' ? 0.15 : 0;
    const size = Math.log10(Math.max(numericValue(o.availableSize) || 0, 1)) * 0.02;
    return ytm - tierPenalty + size;
  });
  if (!row) return null;
  return {
    type: 'Corporate',
    audience: ['RIA'],
    label: row.creditTier || 'IG',
    title: row.issuerName || row.ticker || 'Corporate bond',
    value: row.ytm != null ? `${Number(row.ytm).toFixed(3)}% YTM` : null,
    detail: [row.ticker, row.sector, row.maturity].filter(Boolean).join(' | '),
    cusip: row.cusip || '',
    page: 'corporates',
    reason: 'RIA-only screen for the highest scoring investment-grade corporate yield in the current inventory.'
  };
}

function pickBrokeredCdFunding(meta) {
  const terms = Array.isArray(meta && meta.brokeredCdTerms) ? meta.brokeredCdTerms : [];
  const row = chooseTop(terms, term => {
    const mid = numericValue(term.mid);
    const months = numericValue(term.months) || 0;
    if (mid == null) return -Infinity;
    return mid + Math.min(months, 120) * 0.002;
  });
  if (!row) return null;
  return {
    type: 'Brokered CD Funding',
    audience: ['Funding Desk', 'Bank'],
    label: row.label || 'BCD',
    title: `${row.label || 'Term'} all-in midpoint`,
    value: row.mid != null ? `${Number(row.mid).toFixed(3)}%` : null,
    detail: row.low != null && row.high != null ? `range ${Number(row.low).toFixed(3)}% to ${Number(row.high).toFixed(3)}%` : '',
    cusip: '',
    page: 'cd',
    reason: 'Highest current all-in brokered CD midpoint from the parsed rate sheet; benchmark spread logic can be added once FHLB/SOFR inputs are stored.'
  };
}

function pct(value, digits = 2) {
  const n = numericValue(value);
  return n == null ? 'n/a' : `${n.toFixed(digits)}%`;
}

function moneyMillionsFromThousands(value) {
  const n = numericValue(value);
  if (n == null) return null;
  return n / 1000;
}

function latestPeriodValues(bank) {
  const periods = bank && Array.isArray(bank.periods) ? bank.periods : [];
  return {
    current: periods[0] || null,
    prior: periods[1] || null,
    currentValues: periods[0] && periods[0].values ? periods[0].values : {},
    priorValues: periods[1] && periods[1].values ? periods[1].values : {}
  };
}

function metricDelta(currentValues, priorValues, key) {
  const current = numericValue(currentValues[key]);
  const prior = numericValue(priorValues[key]);
  if (current == null || prior == null) return null;
  return Number((current - prior).toFixed(3));
}

function peerDelta(peerComparison, currentValues, key) {
  const current = numericValue(currentValues[key]);
  const peer = peerComparison && peerComparison.byKey && peerComparison.byKey[key]
    ? numericValue(peerComparison.byKey[key].peerValue)
    : null;
  if (current == null || peer == null) return null;
  return Number((current - peer).toFixed(3));
}

function brokeredSignal(signals, condition, points, title, detail, tone = 'neutral') {
  if (!condition) return 0;
  signals.push({ title, detail, points, tone });
  return points;
}

function recommendBrokeredCdAmount(currentValues, score) {
  const depositsMm = moneyMillionsFromThousands(currentValues.totalDeposits);
  if (depositsMm == null || depositsMm <= 0) {
    return {
      label: 'Sizing pending',
      detail: 'Total deposits were unavailable, so size should be set manually.'
    };
  }
  const lowPct = score >= 8 ? 2 : 1;
  const highPct = score >= 8 ? 5 : 3;
  const low = Math.max(1, depositsMm * lowPct / 100);
  const high = Math.max(low, depositsMm * highPct / 100);
  return {
    label: `$${low.toFixed(0)}MM - $${high.toFixed(0)}MM`,
    detail: `Initial sizing band equals ${lowPct}-${highPct}% of total deposits. Treat as a conversation starter, not an underwriting limit.`
  };
}

function termMonthsScore(term, context) {
  const months = numericValue(term.months) || 0;
  const mid = numericValue(term.mid);
  if (!months || mid == null) return -Infinity;
  const cheapest = context.cheapestMid == null ? mid : context.cheapestMid;
  const extensionCost = Math.max(0, mid - cheapest);
  let score = 100 - extensionCost * 40;

  if (context.need === 'urgent') {
    if (months <= 12) score += 18;
    if (months > 24) score -= 18;
  } else if (context.need === 'structural') {
    if (months >= 12 && months <= 36) score += 16;
    if (months < 6) score -= 10;
  } else {
    if (months >= 6 && months <= 18) score += 8;
  }

  if (context.forwardBias === 'falling') {
    if (months <= 12) score += 18;
    if (months > 24) score -= 24;
  } else if (context.forwardBias === 'rising') {
    if (months >= 12 && months <= 36) score += 18;
    if (months <= 6) score -= 10;
  } else if (context.forwardBias === 'flat') {
    if (months >= 12 && months <= 24 && extensionCost <= 0.2) score += 14;
  }

  return score;
}

function recommendBrokeredCdTerms(terms, wirp, context) {
  const rows = Array.isArray(terms) ? terms.filter(term => numericValue(term.mid) != null) : [];
  if (!rows.length) {
    return {
      summary: 'Upload the Brokered CD Rate Sheet to recommend terms.',
      terms: [],
      rationale: ['Term guidance needs today\'s all-in brokered CD curve.']
    };
  }

  const cheapestMid = Math.min(...rows.map(term => numericValue(term.mid)).filter(n => n != null));
  const forwardBias = wirp && wirp.summary ? wirp.summary.bias : 'unknown';
  const ranked = rows
    .map(term => ({ ...term, score: termMonthsScore(term, { ...context, cheapestMid, forwardBias }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const primary = ranked[0];
  const mix = ranked.length > 1 && context.need !== 'light'
    ? `${primary.label} lead with ${ranked[1].label} secondary`
    : primary.label;
  const rationale = [];

  if (forwardBias === 'falling') rationale.push('WIRP implies lower rates later, so avoid over-extending unless liquidity pressure keeps building.');
  else if (forwardBias === 'rising') rationale.push('WIRP implies firmer rates, so locking some term can protect funding cost.');
  else if (forwardBias === 'flat') rationale.push('WIRP looks fairly flat, so prefer terms where extension cost is modest.');
  else rationale.push('No WIRP path is loaded yet, so term ranking leans on current all-in curve shape and funding need.');

  const curveDetail = primary.low != null && primary.high != null
    ? `${primary.label} all-in range ${pct(primary.low, 3)} to ${pct(primary.high, 3)}`
    : `${primary.label} all-in midpoint ${pct(primary.mid, 3)}`;
  rationale.push(curveDetail);

  return {
    summary: mix,
    terms: ranked.map(term => ({
      label: term.label,
      months: term.months,
      mid: term.mid,
      low: term.low,
      high: term.high
    })),
    rationale
  };
}

function buildBrokeredCdOpportunity(bankData) {
  const bank = bankData && bankData.bank;
  if (!bank || !bank.summary) return null;
  const { current, prior, currentValues, priorValues } = latestPeriodValues(bank);
  const peerComparison = bank.summary.peerComparison || bank.peerComparison || getPeerComparisonForBank(bank);
  const wirp = loadWirpAnalysis(BANK_REPORTS_DIR);
  const meta = readMetaFile(CURRENT_DIR);
  const terms = Array.isArray(meta.brokeredCdTerms) ? meta.brokeredCdTerms : [];

  const ltd = numericValue(currentValues.loansToDeposits);
  const liquidity = numericValue(currentValues.liquidAssetsToAssets);
  const wholesale = numericValue(currentValues.wholesaleFundingReliance);
  const brokered = numericValue(currentValues.brokeredDepositsToDeposits);
  const depositDeltaPct = metricDelta(currentValues, priorValues, 'totalDeposits');
  const ltdDelta = metricDelta(currentValues, priorValues, 'loansToDeposits');
  const liquidityDelta = metricDelta(currentValues, priorValues, 'liquidAssetsToAssets');
  const wholesaleDelta = metricDelta(currentValues, priorValues, 'wholesaleFundingReliance');
  const brokeredDelta = metricDelta(currentValues, priorValues, 'brokeredDepositsToDeposits');
  const ltdPeerDelta = peerDelta(peerComparison, currentValues, 'loansToDeposits');
  const liquidityPeerDelta = peerDelta(peerComparison, currentValues, 'liquidAssetsToAssets');
  const wholesalePeerDelta = peerDelta(peerComparison, currentValues, 'wholesaleFundingReliance');

  const signals = [];
  let score = 0;
  score += brokeredSignal(signals, ltd != null && ltd >= 90, 3, 'Loans/deposits is elevated', `Current loans/deposits is ${pct(ltd)}.`, 'warn');
  score += brokeredSignal(signals, ltdDelta != null && ltdDelta >= 3, 3, 'Loans/deposits tightened quarter over quarter', `Moved ${ltdDelta >= 0 ? 'up' : 'down'} ${Math.abs(ltdDelta).toFixed(2)} percentage points from prior quarter.`, 'warn');
  score += brokeredSignal(signals, liquidity != null && liquidity <= 15, 2, 'Liquidity is low', `Liquid assets/assets is ${pct(liquidity)}.`, 'warn');
  score += brokeredSignal(signals, liquidityDelta != null && liquidityDelta <= -2, 3, 'Liquidity declined quarter over quarter', `Liquid assets/assets fell ${Math.abs(liquidityDelta).toFixed(2)} percentage points from prior quarter.`, 'warn');
  score += brokeredSignal(signals, depositDeltaPct != null && depositDeltaPct < 0, 2, 'Deposits declined quarter over quarter', `Total deposits fell by ${Math.abs(depositDeltaPct).toLocaleString('en-US', { maximumFractionDigits: 0 })} in reported $000 values.`, 'warn');
  score += brokeredSignal(signals, wholesaleDelta != null && wholesaleDelta >= 1.5, 2, 'Wholesale funding reliance is rising', `Reliance rose ${wholesaleDelta.toFixed(2)} percentage points from prior quarter.`, 'warn');
  score += brokeredSignal(signals, ltdPeerDelta != null && ltdPeerDelta >= 5, 2, 'Loans/deposits screens above peer', `Current ratio is ${ltdPeerDelta.toFixed(2)} percentage points above peer.`, 'warn');
  score += brokeredSignal(signals, liquidityPeerDelta != null && liquidityPeerDelta <= -3, 2, 'Liquidity screens below peer', `Liquid assets/assets is ${Math.abs(liquidityPeerDelta).toFixed(2)} percentage points below peer.`, 'warn');
  score += brokeredSignal(signals, wholesalePeerDelta != null && wholesalePeerDelta >= 3, 1, 'Wholesale funding is above peer', `Reliance is ${wholesalePeerDelta.toFixed(2)} percentage points above peer.`, 'neutral');
  score += brokeredSignal(signals, brokered != null && brokered <= 5, 2, 'Current brokered deposit use appears modest', `Brokered deposits/deposits is ${pct(brokered)}.`, 'good');
  score += brokeredSignal(signals, brokered != null && brokered >= 15, -3, 'Current brokered deposit use is already elevated', `Brokered deposits/deposits is ${pct(brokered)}; review policy and concentration before recommending more.`, 'danger');
  score += brokeredSignal(signals, wholesale != null && wholesale >= 25, -1, 'Wholesale funding already high', `Wholesale funding reliance is ${pct(wholesale)}.`, 'danger');

  const recommendation = score >= 9
    ? 'Likely candidate'
    : score >= 5
      ? 'Possible candidate'
      : 'Not priority';
  const need = score >= 9 ? 'structural' : score >= 5 ? 'urgent' : 'light';
  const amount = recommendBrokeredCdAmount(currentValues, score);
  const termRecommendation = recommendBrokeredCdTerms(terms, wirp, { need });

  return {
    bank: {
      id: bank.id,
      displayName: bank.summary.displayName || bank.summary.name || 'Bank',
      city: bank.summary.city || '',
      state: bank.summary.state || '',
      certNumber: bank.summary.certNumber || '',
      period: current && current.period || bank.summary.period || ''
    },
    recommendation,
    score,
    need,
    amount,
    termRecommendation,
    wirp: wirp ? {
      available: true,
      sourceFile: wirp.sourceFile,
      uploadedAt: wirp.uploadedAt,
      summary: wirp.summary,
      records: Array.isArray(wirp.records) ? wirp.records.slice(0, 8) : [],
      warnings: wirp.warnings || []
    } : { available: false, summary: null, records: [], warnings: ['Upload WIRP to add forward-rate term guidance.'] },
    brokeredCdTerms: terms,
    periods: {
      current: current ? current.period : null,
      prior: prior ? prior.period : null
    },
    metrics: [
      metricCard('Loans / Deposits', currentValues.loansToDeposits, priorValues.loansToDeposits, ltdPeerDelta),
      metricCard('Liquid Assets / Assets', currentValues.liquidAssetsToAssets, priorValues.liquidAssetsToAssets, liquidityPeerDelta),
      metricCard('Wholesale Funding Reliance', currentValues.wholesaleFundingReliance, priorValues.wholesaleFundingReliance, wholesalePeerDelta),
      metricCard('Brokered Deposits / Deposits', currentValues.brokeredDepositsToDeposits, priorValues.brokeredDepositsToDeposits, null),
      metricCard('Total Deposits ($000)', currentValues.totalDeposits, priorValues.totalDeposits, null, 'money')
    ],
    signals,
    talkingPoints: buildBrokeredCdTalkingPoints({ recommendation, signals, termRecommendation, amount, wirp })
  };
}

function metricCard(label, current, prior, peerDeltaValue, type = 'percent') {
  const currentNumber = numericValue(current);
  const priorNumber = numericValue(prior);
  const qoq = currentNumber != null && priorNumber != null ? Number((currentNumber - priorNumber).toFixed(3)) : null;
  return { label, current: currentNumber, prior: priorNumber, qoq, peerDelta: peerDeltaValue, type };
}

function buildBrokeredCdTalkingPoints({ recommendation, signals, termRecommendation, amount, wirp }) {
  const points = [
    `${recommendation}: screen is driven by quarter-over-quarter funding movement, current liquidity, peer comparison, and existing brokered deposit use.`,
    `Initial size discussion: ${amount.label}. ${amount.detail}`,
    `Term guide: ${termRecommendation.summary}.`
  ];
  const topSignal = signals.find(signal => signal.points > 0);
  if (topSignal) points.push(`${topSignal.title}: ${topSignal.detail}`);
  if (wirp && wirp.summary && wirp.summary.explanation) points.push(wirp.summary.explanation);
  return points;
}

function buildRuleBasedSalesCues({ economicUpdate, cdRows, treasuryRows, muniRows, agencyRows, corporateRows }) {
  const cues = [];
  const marketTreasuries = economicUpdate && Array.isArray(economicUpdate.treasuries) ? economicUpdate.treasuries : [];
  const biggestMover = chooseTop(marketTreasuries, row => Math.abs(numericValue(row.dailyChange) || 0));
  if (biggestMover && numericValue(biggestMover.dailyChange) !== null) {
    const change = numericValue(biggestMover.dailyChange);
    cues.push({
      title: `${biggestMover.label || biggestMover.tenor || 'Treasury'} moved the most`,
      body: `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change).toFixed(3)} today; use that benchmark as the first rate-context note before moving into inventory.`
    });
  }

  const pricedCdCount = (cdRows || []).filter(row => numericValue(row.cost) !== null || numericValue(row.commission) !== null).length;
  if ((cdRows || []).length) {
    cues.push({
      title: 'CD PDF and cost workbook matched',
      body: `${pricedCdCount} of ${cdRows.length} CD rows have price or commission data attached by CUSIP. Use the matched rows when quoting all-in economics.`
    });
  }

  const topCd = firstBySort(cdRows || [], (a, b) => {
    const rateDiff = (numericValue(b.rate) || -Infinity) - (numericValue(a.rate) || -Infinity);
    if (rateDiff) return rateDiff;
    return (numericValue(a.termMonths) || Infinity) - (numericValue(b.termMonths) || Infinity);
  });
  if (topCd) {
    cues.push({
      title: 'Lead with the strongest retail CD',
      body: `${topCd.name || 'Top CD'} is showing ${numericValue(topCd.rate) != null ? Number(topCd.rate).toFixed(2) + '%' : 'a top rate'}${topCd.term ? ` in ${topCd.term}` : ''}${topCd.cusip ? ` (${topCd.cusip})` : ''}.`
    });
  }

  const releases = economicUpdate && Array.isArray(economicUpdate.releases) ? economicUpdate.releases : [];
  const nextRelease = releases.find(row => row && (row.event || row.label));
  if (nextRelease) {
    cues.push({
      title: 'Watch the next economic release',
      body: `${nextRelease.event || nextRelease.label}${nextRelease.dateTime ? ` at ${nextRelease.dateTime}` : ''}; flag rate-sensitive recommendations before that print.`
    });
  }

  const breadth = [
    cdRows && cdRows.length ? `${cdRows.length} CDs` : '',
    muniRows && muniRows.length ? `${muniRows.length} munis` : '',
    agencyRows && agencyRows.length ? `${agencyRows.length} agencies` : '',
    corporateRows && corporateRows.length ? `${corporateRows.length} corporates` : '',
    treasuryRows && treasuryRows.length ? `${treasuryRows.length} treasuries` : ''
  ].filter(Boolean);
  if (breadth.length) {
    cues.push({
      title: 'Inventory breadth is ready',
      body: `Current parsed inventory includes ${breadth.join(', ')}. Start broad, then narrow by client tax profile and duration target.`
    });
  }

  return cues;
}

function mergeSalesCues(existing, generated) {
  const seen = new Set();
  return [...(existing || []), ...(generated || [])].filter(cue => {
    const key = `${cue && cue.title}|${cue && cue.body}`.toLowerCase();
    if (!cue || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

async function buildDailyIntelligence() {
  const pkg = getCurrentPackage() || {};
  const meta = readMetaFile(CURRENT_DIR);
  const [economicUpdate, cdOfferings, muniOfferings, treasuryNotes, agencies, corporates] = await Promise.all([
    loadCurrentEconomicUpdate(),
    Promise.resolve(loadCurrentOfferings()),
    Promise.resolve(loadCurrentMuniOfferings()),
    Promise.resolve(loadCurrentTreasuryNotes()),
    Promise.resolve(loadCurrentAgencies()),
    Promise.resolve(loadCurrentCorporates())
  ]);

  const cdRows = Array.isArray(cdOfferings && cdOfferings.offerings) ? cdOfferings.offerings : [];
  const muniRows = Array.isArray(muniOfferings && muniOfferings.offerings) ? muniOfferings.offerings : [];
  const treasuryRows = Array.isArray(treasuryNotes && treasuryNotes.notes) ? treasuryNotes.notes : [];
  const agencyRows = Array.isArray(agencies && agencies.offerings) ? agencies.offerings : [];
  const corporateRows = Array.isArray(corporates && corporates.offerings) ? corporates.offerings : [];
  const packageDate = pkg.date || (economicUpdate && economicUpdate.asOfDate) || (cdOfferings && cdOfferings.asOfDate) || null;

  const picks = [
    pickAgencySpread(agencyRows, packageDate),
    pickMuniBq(muniRows),
    pickRetailCd(cdRows),
    pickTreasury(treasuryRows, packageDate),
    pickAgencyCallable(agencyRows, packageDate),
    pickBrokeredCdFunding(meta),
    pickCorporateRia(corporateRows, packageDate)
  ].filter(Boolean);

  const warnings = [
    ...(economicUpdate && Array.isArray(economicUpdate.warnings) ? economicUpdate.warnings.map(w => ({ source: 'Economic Update', message: w })) : []),
    ...(cdOfferings && Array.isArray(cdOfferings.warnings) ? cdOfferings.warnings.map(w => ({ source: 'CD Offerings', message: w })) : []),
    ...(muniOfferings && Array.isArray(muniOfferings.warnings) ? muniOfferings.warnings.map(w => ({ source: 'Muni Offerings', message: w })) : []),
    ...(treasuryNotes && Array.isArray(treasuryNotes.warnings) ? treasuryNotes.warnings.map(w => ({ source: 'Treasury Notes', message: w })) : []),
    ...(agencies && Array.isArray(agencies.warnings) ? agencies.warnings.map(w => ({ source: 'Agencies', message: w })) : []),
    ...(corporates && Array.isArray(corporates.warnings) ? corporates.warnings.map(w => ({ source: 'Corporates', message: w })) : [])
  ];
  const generatedSalesCues = buildRuleBasedSalesCues({ economicUpdate, cdRows, treasuryRows, muniRows, agencyRows, corporateRows });
  const extractedSalesCues = economicUpdate && Array.isArray(economicUpdate.salesCues) ? economicUpdate.salesCues : [];

  return {
    package: pkg,
    asOfDate: packageDate,
    publishedAt: pkg.publishedAt || null,
    counts: {
      treasuries: treasuryRows.length,
      cds: cdRows.length,
      munis: muniRows.length,
      agencies: agencyRows.length,
      corporates: corporateRows.length,
      brokeredCdTerms: Array.isArray(meta.brokeredCdTerms) ? meta.brokeredCdTerms.length : 0
    },
    market: {
      treasuries: economicUpdate && Array.isArray(economicUpdate.treasuries) ? economicUpdate.treasuries : [],
      marketRates: economicUpdate && Array.isArray(economicUpdate.marketRates) ? economicUpdate.marketRates : [],
      marketData: economicUpdate && Array.isArray(economicUpdate.marketData) ? economicUpdate.marketData : [],
      bondIndices: economicUpdate && Array.isArray(economicUpdate.bondIndices) ? economicUpdate.bondIndices : [],
      releases: economicUpdate && Array.isArray(economicUpdate.releases) ? economicUpdate.releases : [],
      salesCues: mergeSalesCues(extractedSalesCues, generatedSalesCues)
    },
    brokeredCdTerms: Array.isArray(meta.brokeredCdTerms) ? meta.brokeredCdTerms : [],
    picks,
    warnings,
    gaps: [
      !economicUpdate ? 'Economic Update data is missing.' : null,
      !treasuryRows.length ? 'Treasury Notes inventory is missing.' : null,
      !cdRows.length ? 'Retail CD offerings are missing.' : null,
      !muniRows.length ? 'Muni offerings are missing.' : null,
      !agencyRows.length ? 'Agency inventory is missing.' : null,
      !corporateRows.length ? 'Corporate inventory is missing.' : null,
      'Structured products are not yet a parsed daily slot.',
      'MBS/CMO featured idea still depends on the MBS/CMO source workspace.'
    ].filter(Boolean)
  };
}

const bankSearchCache = new Map();
const bankDetailCache = new Map();

function cacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > BANK_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  return value;
}

function invalidateBankCaches() {
  bankSearchCache.clear();
  bankDetailCache.clear();
  invalidateMapBankCache();
}

function searchBanks(query, limit = 12) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
  const cacheKey = `${String(query || '').trim().toLowerCase()}|${safeLimit}`;
  if (bankSearchCache.has(cacheKey)) return bankSearchCache.get(cacheKey);
  try {
    const data = searchBankDatabase(BANK_REPORTS_DIR, query, safeLimit);
    if (!data || !Array.isArray(data.results)) return data;
    const bankIds = data.results.map(row => row.id);
    const statuses = getBankAccountStatuses(BANK_REPORTS_DIR, bankIds);
    const coverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, bankIds);
    return cacheSet(bankSearchCache, cacheKey, {
      ...data,
      results: data.results.map(summary => enrichBankSummary(summary, statuses, coverageMap))
    });
  } catch (err) {
    log('warn', 'Bank search failed:', err.message);
    return null;
  }
}

function getBankById(id) {
  const bankId = String(id || '').trim();
  if (bankDetailCache.has(bankId)) return bankDetailCache.get(bankId);
  try {
    const data = getBankFromDatabase(BANK_REPORTS_DIR, bankId);
    if (!data || !data.bank || !data.bank.summary) return data;
    const statuses = getBankAccountStatuses(BANK_REPORTS_DIR, [data.bank.id]);
    const coverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, [data.bank.id]);
    const preferredPeer = getPreferredPeerGroup(BANK_REPORTS_DIR, data.bank.id);
    const preferredComparison = preferredPeer && preferredPeer.peerGroupId
      ? getPeerComparisonForBank(data.bank, {
          cohortId: preferredPeer.peerGroupId,
          preferredPeerGroupId: preferredPeer.peerGroupId,
          selectionReason: 'Preferred cohort'
        })
      : null;
    const peerComparison = preferredComparison || getPeerComparisonForBank(data.bank);
    return cacheSet(bankDetailCache, bankId, {
      ...data,
      bank: {
        ...data.bank,
        summary: enrichBankSummary(data.bank.summary, statuses, coverageMap),
        bondAccounting: getBondAccountingForBank(BANK_REPORTS_DIR, data.bank.id),
        peerPreference: preferredPeer,
        peerComparison
      }
    });
  } catch (err) {
    log('warn', `Could not read bank detail ${id}:`, err.message);
    return null;
  }
}

function effectiveAccountStatus(summary, statuses, coverageMap) {
  if (!summary || !summary.id) return defaultAccountStatus(summary);
  const stored = statuses && statuses.get(String(summary.id));
  let status = stored || defaultAccountStatus(summary);
  const resolvedCoverageMap = coverageMap || getSavedBankCoverageMap(BANK_REPORTS_DIR, [summary.id]);
  const coverage = resolvedCoverageMap.get(String(summary.id));
  if (coverage && coverage.status) {
    status = {
      ...status,
      status: coverage.status,
      priority: coverage.priority || '',
      owner: coverage.owner || status.owner || '',
      nextActionDate: coverage.nextActionDate || '',
      source: 'coverage',
      isCoverageSaved: true
    };
  }
  return status;
}

function enrichBankSummary(summary, statuses, coverageMap) {
  if (!summary) return summary;
  return {
    ...summary,
    accountStatus: effectiveAccountStatus(summary, statuses, coverageMap)
  };
}

function getBankDataStatus() {
  const bankStatus = getBankDatabaseStatus(BANK_REPORTS_DIR);
  return {
    ...bankStatus,
    accountStatuses: getBankAccountStatusImportStatus(BANK_REPORTS_DIR),
    averagedSeries: getAveragedSeriesStatus(BANK_REPORTS_DIR),
    bondAccounting: getBondAccountingStatus(BANK_REPORTS_DIR)
  };
}

function checkDataDirWritable() {
  const probe = path.join(DATA_DIR, `_healthcheck_${process.pid}_${Date.now()}.tmp`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildHealthStatus() {
  const dataDirWritable = checkDataDirWritable();
  const bankData = getBankDataStatus();
  const checks = {
    dataDirWritable,
    bankDataAvailable: { ok: Boolean(bankData.available), bankCount: bankData.bankCount || 0 },
    currentPackageReadable: { ok: Boolean(getCurrentPackage()) }
  };
  const ready = Object.values(checks).every(check => check && check.ok);
  return {
    status: ready ? 'ok' : 'degraded',
    now: new Date().toISOString(),
    build: PORTAL_BUILD,
    checks
  };
}

const INTERNAL_GO_LIVE_REQUIRED_SLOTS = [
  'econ',
  'cd',
  'cdoffers',
  'relativeValue',
  'munioffers',
  'mmd',
  'treasuryNotes',
  'agenciesBullets',
  'agenciesCallables',
  'corporates'
];
const INTERNAL_GO_LIVE_OPTIONAL_SLOTS = ['dashboard', 'bairdSyndicate'];

function isDataDirExternal() {
  return path.resolve(DATA_DIR) !== path.resolve(path.join(ROOT, 'data'));
}

function compactImportStatus(status) {
  if (!status || typeof status !== 'object') return { available: false };
  const metadata = status.metadata && typeof status.metadata === 'object' ? status.metadata : {};
  const dataset = status.dataset && typeof status.dataset === 'object' ? status.dataset : {};
  return {
    available: Boolean(status.available || status.exists || status.importedAt || metadata.importedAt || status.updatedAt || status.bankCount || status.statusCount || status.importedCount),
    sourceFile: status.sourceFile || metadata.sourceFile || status.filename || '',
    importedAt: status.importedAt || metadata.importedAt || status.updatedAt || '',
    latestPeriod: status.latestPeriod || metadata.latestPeriod || status.period || '',
    bankCount: status.bankCount || metadata.bankCount || null,
    importedCount: status.importedCount || status.statusCount || metadata.importedCount || dataset.seriesRowCount || null,
    unmatchedCount: status.unmatchedCount || metadata.unmatchedCount || null
  };
}

function statusCheck(id, label, state, detail) {
  return { id, label, state, detail };
}

function buildGoLiveStatus(req) {
  const { rep, auth } = authInfoForRequest(req);
  const pkg = getCurrentPackage() || {};
  const bankStatus = getBankDataStatus();
  const auditEntries = readAuditLog({ limit: 50 });
  const latestPackageAudit = auditEntries.find(entry =>
    String(entry.packageDate || '').slice(0, 10) === String(pkg.date || '').slice(0, 10)
  ) || null;
  const parserWarnings = latestPackageAudit && latestPackageAudit.parserWarnings && typeof latestPackageAudit.parserWarnings === 'object'
    ? Object.entries(latestPackageAudit.parserWarnings).flatMap(([slot, warnings]) =>
        (Array.isArray(warnings) ? warnings : [])
          .filter(Boolean)
          .map(text => ({ slot, text: String(text) }))
      )
    : [];
  const publishWarnings = [
    ...((latestPackageAudit && Array.isArray(latestPackageAudit.warnings)) ? latestPackageAudit.warnings.map(text => ({ slot: 'publish', text: String(text) })) : []),
    ...parserWarnings
  ];
  const requiredSlots = INTERNAL_GO_LIVE_REQUIRED_SLOTS.map(key => ({
    key,
    label: DOC_TYPES_LABELS[key] || key,
    filename: pkg[key] || '',
    ready: Boolean(pkg[key])
  }));
  const optionalSlots = INTERNAL_GO_LIVE_OPTIONAL_SLOTS.map(key => ({
    key,
    label: DOC_TYPES_LABELS[key] || key,
    filename: pkg[key] || '',
    ready: Boolean(pkg[key])
  }));
  const missingRequiredSlots = requiredSlots.filter(slot => !slot.ready);
  const accountStatuses = compactImportStatus(bankStatus.accountStatuses);
  const bankData = compactImportStatus(bankStatus);
  const averagedSeries = compactImportStatus(bankStatus.averagedSeries);
  const bondAccounting = compactImportStatus(bankStatus.bondAccounting);

  const checks = [
    statusCheck(
      'auth-mode',
      'Windows login mode',
      IS_IIS_AUTH_MODE ? 'ok' : 'warn',
      IS_IIS_AUTH_MODE ? 'Production auth mode is enabled.' : 'Still running in local auth mode.'
    ),
    statusCheck(
      'admin-users',
      'Admin allowlist',
      ADMIN_USERS.size > 0 ? 'ok' : 'fail',
      ADMIN_USERS.size > 0 ? `${ADMIN_USERS.size} admin user${ADMIN_USERS.size === 1 ? '' : 's'} configured.` : 'Set FBBS_ADMIN_USERS before launch.'
    ),
    statusCheck(
      'data-dir',
      'External data folder',
      isDataDirExternal() ? 'ok' : 'warn',
      isDataDirExternal() ? 'DATA_DIR is outside the app folder.' : 'DATA_DIR is using the app-local data folder.'
    ),
    statusCheck(
      'daily-package',
      'Daily package',
      missingRequiredSlots.length ? 'fail' : 'ok',
      missingRequiredSlots.length
        ? `${missingRequiredSlots.length} required slot${missingRequiredSlots.length === 1 ? '' : 's'} missing.`
        : `All ${requiredSlots.length} required internal slots are filled.`
    ),
    statusCheck(
      'publish-warnings',
      'Publish warnings',
      publishWarnings.length ? 'warn' : 'ok',
      publishWarnings.length
        ? `${publishWarnings.length} warning${publishWarnings.length === 1 ? '' : 's'} from the latest package audit.`
        : 'No warnings on the latest matching package audit.'
    ),
    statusCheck(
      'bank-data',
      'Bank tear-sheet data',
      bankData.available ? 'ok' : 'fail',
      bankData.available
        ? `${bankData.bankCount ? `${bankData.bankCount.toLocaleString('en-US')} banks` : 'Bank data'} imported${bankData.latestPeriod ? ` through ${bankData.latestPeriod}` : ''}.`
        : 'Import the latest bank call-report workbook.'
    ),
    statusCheck(
      'account-statuses',
      'Sales ownership/statuses',
      accountStatuses.available ? 'ok' : 'warn',
      accountStatuses.available
        ? `${accountStatuses.importedCount ? `${accountStatuses.importedCount.toLocaleString('en-US')} rows` : 'Account statuses'} imported.`
        : 'Import account ownership/status workbook for sales workflows.'
    )
  ];
  const failCount = checks.filter(check => check.state === 'fail').length;
  const warnCount = checks.filter(check => check.state === 'warn').length;
  const summaryState = failCount ? 'fail' : (warnCount ? 'warn' : 'ok');

  return {
    generatedAt: new Date().toISOString(),
    state: summaryState,
    counts: { ok: checks.filter(check => check.state === 'ok').length, warn: warnCount, fail: failCount },
    rep,
    auth: {
      ...auth,
      adminCount: ADMIN_USERS.size
    },
    package: {
      date: pkg.date || '',
      publishedAt: pkg.publishedAt || '',
      publishedBy: pkg.publishedBy || '',
      requiredSlots,
      optionalSlots,
      missingRequiredSlots,
      publishWarnings: publishWarnings.slice(0, 20),
      latestAuditActor: latestPackageAudit ? {
        actorUsername: latestPackageAudit.actorUsername || '',
        actorDisplay: latestPackageAudit.actorDisplay || '',
        publishedBy: latestPackageAudit.publishedBy || ''
      } : null
    },
    data: {
      dataDir: DATA_DIR,
      dataDirExternal: isDataDirExternal(),
      maxUploadMb: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)),
      bankUploadMaxMb: Math.round(BANK_UPLOAD_MAX_BYTES / (1024 * 1024)),
      bankData,
      accountStatuses,
      averagedSeries,
      bondAccounting
    },
    checks
  };
}

function compactNumber(value, options = {}) {
  const n = numericValue(value);
  if (n === null) return null;
  const digits = options.digits == null ? 1 : options.digits;
  if (options.type === 'money') {
    const abs = Math.abs(n);
    if (abs >= 1000000) return `$${(n / 1000000).toFixed(digits)}B`;
    if (abs >= 1000) return `$${(n / 1000).toFixed(digits)}MM`;
    return `$${n.toFixed(0)}K`;
  }
  if (options.type === 'percent') return `${n.toFixed(options.digits == null ? 2 : options.digits)}%`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function latestBankValues(bank) {
  const latest = bank && Array.isArray(bank.periods) ? bank.periods[0] : null;
  return {
    latest,
    values: (latest && latest.values) || {},
    prior: bank && Array.isArray(bank.periods) ? bank.periods[1] : null
  };
}

function bankMetricLine(label, value, type) {
  const formatted = compactNumber(value, { type, digits: type === 'money' ? 1 : 2 });
  return formatted ? `${label}: ${formatted}` : null;
}

function sumBankValues(values, keys) {
  let total = 0;
  let hasValue = false;
  keys.forEach(key => {
    const value = numericValue(values && values[key]);
    if (value !== null) {
      total += value;
      hasValue = true;
    }
  });
  return hasValue ? total : null;
}

function strongestOfferings(rows, scoreKeys, limit = 3) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      row,
      score: scoreKeys.reduce((best, key) => {
        const n = numericValue(row[key]);
        return n === null ? best : Math.max(best, n);
      }, -Infinity)
    }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.row);
}

function offeringLabel(row, type) {
  if (!row) return '';
  const cusipTag = row.cusip ? ` (${row.cusip})` : '';
  if (type === 'cd') {
    return `${row.term || ''} ${row.name || 'CD'}${numericValue(row.rate) !== null ? ` at ${Number(row.rate).toFixed(2)}%` : ''}${cusipTag}`.trim();
  }
  if (type === 'muni') {
    return `${row.issuerState || ''} ${row.issuerName || 'muni'} ${row.maturity || ''}${numericValue(row.ytw) !== null ? ` YTW ${Number(row.ytw).toFixed(3)}%` : ''}${cusipTag}`.trim();
  }
  if (type === 'agency') {
    return `${row.ticker || 'Agency'} ${row.structure || ''} ${row.maturity || ''}${numericValue(row.ytm) !== null ? ` YTM ${Number(row.ytm).toFixed(3)}%` : ''}${cusipTag}`.trim();
  }
  if (type === 'corporate') {
    return `${row.issuerName || row.ticker || 'Corporate'} ${row.maturity || ''}${numericValue(row.ytm) !== null ? ` YTM ${Number(row.ytm).toFixed(3)}%` : ''}${cusipTag}`.trim();
  }
  if (type === 'treasury') {
    return `${row.description || 'Treasury'}${numericValue(row.yield) !== null ? ` yield ${Number(row.yield).toFixed(3)}%` : ''}${cusipTag}`.trim();
  }
  return row.name || row.issuerName || row.description || '';
}

function currentInventorySnapshot(bankState) {
  const pkg = getCurrentPackage() || {};
  const meta = readMetaFile(CURRENT_DIR);
  const cd = loadCurrentOfferings();
  const muni = loadCurrentMuniOfferings();
  const treasury = loadCurrentTreasuryNotes();
  const agencies = loadCurrentAgencies();
  const corporates = loadCurrentCorporates();
  // Shallow-copy each array: the loaders are now memoized, so handing out the
  // live reference would let any downstream in-place sort/push corrupt the
  // shared cache across requests.
  const cdRows = Array.isArray(cd && cd.offerings) ? cd.offerings.slice() : [];
  const muniRows = Array.isArray(muni && muni.offerings) ? muni.offerings.slice() : [];
  const treasuryRows = Array.isArray(treasury && treasury.notes) ? treasury.notes.slice() : [];
  const agencyRows = Array.isArray(agencies && agencies.offerings) ? agencies.offerings.slice() : [];
  const corporateRows = Array.isArray(corporates && corporates.offerings) ? corporates.offerings.slice() : [];
  const state = String(bankState || '').toUpperCase();
  const stateMunis = state ? muniRows.filter(row => String(row.issuerState || '').toUpperCase() === state) : [];

  return {
    asOfDate: pkg.date || cd && cd.asOfDate || muni && muni.asOfDate || null,
    counts: {
      cds: cdRows.length,
      munis: muniRows.length,
      stateMunis: stateMunis.length,
      agencies: agencyRows.length,
      corporates: corporateRows.length,
      treasuries: treasuryRows.length,
      brokeredCdTerms: Array.isArray(meta.brokeredCdTerms) ? meta.brokeredCdTerms.length : 0
    },
    brokeredCdTerms: Array.isArray(meta.brokeredCdTerms) ? meta.brokeredCdTerms : [],
    rows: {
      cds: cdRows,
      munis: muniRows,
      stateMunis,
      agencies: agencyRows,
      corporates: corporateRows,
      treasuries: treasuryRows
    },
    examples: {
      cds: strongestOfferings(cdRows, ['rate']).map(row => offeringLabel(row, 'cd')).filter(Boolean),
      munis: strongestOfferings(stateMunis.length ? stateMunis : muniRows, ['ytw', 'ytm']).map(row => offeringLabel(row, 'muni')).filter(Boolean),
      agencies: strongestOfferings(agencyRows, ['ytm', 'ytnc']).map(row => offeringLabel(row, 'agency')).filter(Boolean),
      corporates: strongestOfferings(corporateRows, ['ytm', 'ytnc']).map(row => offeringLabel(row, 'corporate')).filter(Boolean),
      treasuries: strongestOfferings(treasuryRows, ['yield']).map(row => offeringLabel(row, 'treasury')).filter(Boolean)
    }
  };
}

function formatSectorBreakdown(sectorCounts) {
  if (!sectorCounts) return '';
  return Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');
}

function buildAssistantSignals(bank, inventory, strategies, holdings) {
  const { latest, values, prior } = latestBankValues(bank);
  const priorValues = (prior && prior.values) || {};
  const status = (bank.summary && bank.summary.accountStatus) || {};
  const deltas = bank.peerComparison && bank.peerComparison.byKey ? bank.peerComparison.byKey : {};
  const signals = [];
  const ltd = numericValue(values.loansToDeposits);
  const liquid = numericValue(values.liquidAssetsToAssets);
  const securities = numericValue(values.securitiesToAssets);
  const wholesale = numericValue(values.wholesaleFundingReliance);
  const brokered = numericValue(values.brokeredDepositsToDeposits);
  const nim = numericValue(values.netInterestMargin);
  const yieldSecs = numericValue(values.yieldOnSecurities);
  const munis = sumBankValues(values, ['afsMunis', 'htmMunis']);
  const allMbs = sumBankValues(values, ['afsAllMbs', 'htmAllMbs']);
  const totalSecurities = sumBankValues(values, ['afsTotal', 'htmTotal']);
  const depositDelta = numericValue(values.totalDeposits) !== null && numericValue(priorValues.totalDeposits) !== null
    ? numericValue(values.totalDeposits) - numericValue(priorValues.totalDeposits)
    : null;

  if (ltd !== null && ltd >= 85) {
    signals.push({
      type: 'Funding',
      strength: ltd >= 95 ? 'High' : 'Medium',
      text: `L/D ${compactNumber(ltd, { type: 'percent' })} — lead with brokered CD terms and funding alternatives.`
    });
  }
  if (liquid !== null && liquid < 12) {
    signals.push({
      type: 'Liquidity',
      strength: liquid < 8 ? 'High' : 'Medium',
      text: `Liquid assets ${compactNumber(liquid, { type: 'percent' })} of assets — keep ideas short, liquid, and ladder-friendly.`
    });
  }
  if (wholesale !== null && wholesale >= 15) {
    signals.push({
      type: 'Wholesale funding',
      strength: wholesale >= 25 ? 'High' : 'Medium',
      text: `Wholesale funding ${compactNumber(wholesale, { type: 'percent' })} — compare today's CD levels against their current cost of funds.`
    });
  }
  if (brokered !== null && brokered > 0) {
    signals.push({
      type: 'Brokered history',
      strength: brokered >= 10 ? 'High' : 'Medium',
      text: `Brokered deposits ${compactNumber(brokered, { type: 'percent' })} of deposits — they already use the channel; ask about term and size.`
    });
  }
  if (securities !== null && securities < 18) {
    signals.push({
      type: 'Portfolio room',
      strength: 'Medium',
      text: `Securities only ${compactNumber(securities, { type: 'percent' })} of assets — room to add if liquidity and policy allow.`
    });
  } else if (securities !== null && securities >= 25) {
    signals.push({
      type: 'Active portfolio',
      strength: 'Medium',
      text: `Securities ${compactNumber(securities, { type: 'percent' })} of assets — pitch swaps and yield pickup against the existing book.`
    });
  }
  if (munis && totalSecurities) {
    signals.push({
      type: 'Muni appetite',
      strength: (munis / totalSecurities) >= 0.2 ? 'High' : 'Medium',
      text: `Munis ${((munis / totalSecurities) * 100).toFixed(0)}% of securities — screen BQ and in-state names from today's list.`
    });
  } else if (inventory.counts.munis) {
    signals.push({
      type: 'Muni screen',
      strength: 'Low',
      text: `No muni position visible in the latest filing, but ${inventory.counts.munis} muni offerings to screen today.`
    });
  }
  if (allMbs && totalSecurities && (allMbs / totalSecurities) >= 0.1) {
    signals.push({
      type: 'MBS/CMO',
      strength: (allMbs / totalSecurities) >= 0.25 ? 'High' : 'Medium',
      text: `MBS ${((allMbs / totalSecurities) * 100).toFixed(0)}% of securities — pull bond accounting before pitching structure.`
    });
  }
  if (nim !== null && yieldSecs !== null && yieldSecs < nim) {
    signals.push({
      type: 'Yield gap',
      strength: 'Medium',
      text: `Book yield ${compactNumber(yieldSecs, { type: 'percent' })} vs. NIM ${compactNumber(nim, { type: 'percent' })} — frame around income lift inside policy limits.`
    });
  }
  if (depositDelta !== null && depositDelta < 0) {
    signals.push({
      type: 'Deposit runoff',
      strength: Math.abs(depositDelta) > 25000 ? 'High' : 'Medium',
      text: `Deposits down ${compactNumber(Math.abs(depositDelta), { type: 'money' })} QoQ — confirm funding need before pitching longer bonds.`
    });
  }
  ['loansToDeposits', 'liquidAssetsToAssets', 'yieldOnSecurities', 'netInterestMargin'].forEach(key => {
    const peer = deltas[key];
    if (!peer || numericValue(peer.delta) === null) return;
    const delta = numericValue(peer.delta);
    if (Math.abs(delta) < 1) return;
    signals.push({
      type: 'Peer delta',
      strength: Math.abs(delta) >= 5 ? 'High' : 'Medium',
      text: `${peer.label || key} is ${delta > 0 ? 'above' : 'below'} peer average by ${Math.abs(delta).toFixed(2)} points.`
    });
  });
  const bondAccountingPresent = bank.bondAccounting && bank.bondAccounting.available ? bank.bondAccounting : null;
  if (bondAccountingPresent) {
    const reportDate = bondAccountingPresent.latestReportDate || 'recent';
    let text;
    if (holdings && holdings.aggregates && holdings.aggregates.totalPositions) {
      const breakdown = formatSectorBreakdown(holdings.sectorCounts);
      const book = holdings.totals && holdings.totals.bookYieldYtw != null ? holdings.totals.bookYieldYtw : null;
      const mkt = holdings.totals && holdings.totals.marketYieldYtw != null ? holdings.totals.marketYieldYtw : null;
      const yieldFragment = (book != null && mkt != null)
        ? ` · book ${book.toFixed(2)}% vs market ${mkt.toFixed(2)}%`
        : '';
      text = `Holdings on file (${reportDate}): ${holdings.aggregates.totalPositions} positions — ${breakdown}${yieldFragment}.`;
    } else {
      const count = bondAccountingPresent.portfolioFileCount || 1;
      text = `Portfolio file${count > 1 ? `s (${count})` : ''} on disk through ${reportDate} — pull holdings before pitching; frame as a swap, not an add.`;
    }
    signals.unshift({ type: 'Holdings on file', strength: 'High', text });
  }
  if (Array.isArray(strategies) && strategies.some(row => row.status === 'Open' || row.status === 'In Progress')) {
    signals.push({
      type: 'Open workflow',
      strength: 'High',
      text: 'Open strategy request already in the queue — check it before opening a new one.'
    });
  }
  if (status.status && status.status !== 'Open') {
    signals.push({
      type: 'Coverage',
      strength: status.status === 'Client' ? 'High' : 'Medium',
      text: `Coverage status: ${status.status}${status.owner ? ` (${status.owner})` : ''} — match the ask to the relationship.`
    });
  }
  if (!signals.length) {
    signals.push({
      type: 'No standout',
      strength: 'Low',
      text: 'No single pressure point in the latest filing — open on relationship, policy limits, and current buy list.'
    });
  }
  return signals.slice(0, 8);
}

function buildAssistantProductFits(bank, inventory, signals, parsedHoldings) {
  const { values } = latestBankValues(bank);
  const holdings = bank.bondAccounting && bank.bondAccounting.available ? bank.bondAccounting : null;
  const filterExamples = (examples) => filterExamplesAgainstHoldings(examples, parsedHoldings);
  const ltd = numericValue(values.loansToDeposits);
  const liquid = numericValue(values.liquidAssetsToAssets);
  const securities = numericValue(values.securitiesToAssets);
  const totalSecurities = sumBankValues(values, ['afsTotal', 'htmTotal']);
  const munis = sumBankValues(values, ['afsMunis', 'htmMunis']);
  const allMbs = sumBankValues(values, ['afsAllMbs', 'htmAllMbs']);
  const fits = [];

  if ((ltd !== null && ltd >= 85) || (liquid !== null && liquid < 12)) {
    fits.push({
      product: 'Brokered CDs / funding',
      explorerPage: 'explorer',
      explorerLabel: 'Open CD Explorer',
      fit: ltd !== null && ltd >= 95 ? 'Strong' : 'Good',
      reason: 'Funding/liquidity profile says they may be in market — open on term, size, and cost of funds.',
      examples: inventory.brokeredCdTerms
        .filter(row => Number(row.mid || row.high || row.low || 0) > 0)
        .slice(0, 4)
        .map(row => `${row.label}: ${Number(row.mid || row.high || row.low || 0).toFixed(3)}%`)
    });
  }
  if (inventory.counts.agencies && (securities === null || securities < 30)) {
    fits.push({
      product: 'Agencies',
      explorerPage: 'agencies',
      explorerLabel: 'Open Agency Explorer',
      fit: securities !== null && securities < 18 ? 'Good' : 'Review',
      reason: holdings
        ? 'Holdings file on disk — open it first and frame as a swap from existing positions.'
        : 'Agency bullets/callables are the easy first screen — clean credit, fits most policies.',
      examples: filterExamples(inventory.examples.agencies)
    });
  }
  if (inventory.counts.munis && (munis || inventory.counts.stateMunis)) {
    fits.push({
      product: 'Munis / BCIS',
      explorerPage: 'muni-explorer',
      explorerLabel: 'Open Muni Explorer',
      fit: munis && totalSecurities && (munis / totalSecurities) >= 0.2 ? 'Strong' : 'Review',
      reason: inventory.counts.stateMunis
        ? `${inventory.counts.stateMunis} in-state munis on today's list — screen for BQ and credit.`
        : 'Book already carries munis — BQ screen and credit review apply.',
      examples: filterExamples(inventory.examples.munis)
    });
  }
  if (inventory.counts.corporates && securities !== null && securities >= 15) {
    fits.push({
      product: 'Corporates',
      explorerPage: 'corporates',
      explorerLabel: 'Open Corporates Explorer',
      fit: 'Review',
      reason: 'IG names for yield pickup — only if their policy and credit limits allow.',
      examples: filterExamples(inventory.examples.corporates)
    });
  }
  if (allMbs && totalSecurities && (allMbs / totalSecurities) >= 0.1 && inventory.counts.treasuries) {
    fits.push({
      product: 'MBS/CMO or Treasury swap',
      explorerPage: 'mbs-cmo',
      explorerLabel: 'Open MBS/CMO',
      fit: 'Review',
      reason: holdings
        ? `Holdings on file (${holdings.latestReportDate || 'recent'}) — review the existing MBS book before pitching; this is a swap conversation, not an add.`
        : 'Existing MBS exposure — pull bond accounting first, then frame cash-flow or duration swap.',
      examples: filterExamples(inventory.examples.treasuries)
    });
  }
  if (!fits.length) {
    fits.push({
      product: 'Discovery call',
      fit: 'Review',
      reason: signals[0] ? signals[0].text : 'Open on policy, liquidity target, tax appetite, and current buy list before pitching.',
      examples: []
    });
  }
  return fits.slice(0, 5);
}

function resolvePortfolioFilePath(bondAccounting) {
  if (!bondAccounting || !Array.isArray(bondAccounting.portfolios) || !bondAccounting.portfolios.length) return '';
  // Latest report wins ties; portfolios array is preserved from the manifest order.
  const latest = bondAccounting.portfolios
    .slice()
    .sort((a, b) => String(b.reportDate || '').localeCompare(String(a.reportDate || '')))[0];
  if (!latest || !latest.storedPath) return '';
  return resolveBondAccountingStoredFile(BANK_REPORTS_DIR, latest.storedPath);
}

// Slim per-bank index for the inverse-query path. Keeps only the cusip set
// and sector counts in memory so we can score 1000+ coverage banks without
// hauling around every bond row. Built lazily and rebuilt when the bond-
// accounting manifest is re-imported.
let coverageHoldingsIndex = null;
let coverageHoldingsIndexBuiltAt = 0;

function invalidateCoverageHoldingsIndex() {
  coverageHoldingsIndex = null;
  coverageHoldingsIndexBuiltAt = 0;
}

function buildCoverageHoldingsIndex() {
  const manifest = loadBondAccountingManifest(BANK_REPORTS_DIR);
  if (!manifest || !Array.isArray(manifest.matches)) return new Map();
  const index = new Map();
  for (const row of manifest.matches) {
    if (!row || !row.bankId || !row.storedPath) continue;
    const filePath = resolveBondAccountingStoredFile(BANK_REPORTS_DIR, row.storedPath);
    if (!filePath) continue;
    let parsed;
    try {
      parsed = loadParsedPortfolio(filePath);
    } catch (err) {
      log('warn', `Holdings index: skipping ${row.bankId} (${err.message})`);
      continue;
    }
    if (!parsed) continue;
    const bankId = String(row.bankId);
    const existing = index.get(bankId);
    // If multiple portfolio files exist for one bank, keep the latest report date.
    if (existing && existing.reportDate >= (parsed.asOfDate || '')) continue;
    const cusips = parsed.cusipIndex ? Object.keys(parsed.cusipIndex) : [];
    const totals = parsed.totals || {};
    const aggregates = parsed.aggregates || {};
    const bookValue = totals.bookValue != null ? totals.bookValue : (aggregates.bookValue != null ? aggregates.bookValue : null);
    const marketValue = totals.marketValue != null ? totals.marketValue : (aggregates.marketValue != null ? aggregates.marketValue : null);
    const gainLoss = totals.unrealizedGainLoss != null
      ? totals.unrealizedGainLoss
      : (bookValue != null && marketValue != null ? marketValue - bookValue : null);
    index.set(bankId, {
      reportDate: parsed.asOfDate || row.reportDate || '',
      totalPositions: aggregates.totalPositions || 0,
      sectorCounts: parsed.sectorCounts || {},
      cusipSet: new Set(cusips.map(c => c.toUpperCase())),
      bookYieldYtw: totals.bookYieldYtw != null ? totals.bookYieldYtw : null,
      marketYieldYtw: totals.marketYieldYtw != null ? totals.marketYieldYtw : null,
      bookValue,
      marketValue,
      gainLoss
    });
  }
  return index;
}

function getCoverageHoldingsIndex() {
  if (coverageHoldingsIndex) return coverageHoldingsIndex;
  const t0 = Date.now();
  coverageHoldingsIndex = buildCoverageHoldingsIndex();
  coverageHoldingsIndexBuiltAt = Date.now();
  log('info', `Coverage holdings index built: ${coverageHoldingsIndex.size} banks in ${coverageHoldingsIndexBuiltAt - t0}ms`);
  return coverageHoldingsIndex;
}

function loadHoldingsForBank(bank) {
  if (!bank || !bank.bondAccounting || !bank.bondAccounting.available) return null;
  const filePath = resolvePortfolioFilePath(bank.bondAccounting);
  if (!filePath) return null;
  try {
    return loadParsedPortfolio(filePath);
  } catch (err) {
    log('warn', `Could not parse portfolio for ${bank.id || 'bank'}: ${err.message}`);
    return null;
  }
}

// Match a parsed-portfolio sector (THC's labels) to one of today's inventory
// buckets so we can find swap candidates within the same asset class.
//
// `yieldKey` is intentionally a single key per sector — using YTW for munis
// and YTM for agencies/corporates. We deliberately do NOT consider YTNC
// (yield-to-next-call) for swap scoring: YTNC spikes to absurd values when
// the next call is imminent, which would falsely flag every callable as a
// blockbuster swap. Steady-state yield is what matters for the comparison.
const SWAP_SECTOR_MAP = {
  Agency: { rowsKey: 'agencies', type: 'agency', yieldKey: 'ytm', sourceRef: '_agencies.json' },
  Treasury: { rowsKey: 'treasuries', type: 'treasury', yieldKey: 'yield', sourceRef: '_treasury_notes.json' },
  'Exempt Muni': { rowsKey: 'munis', type: 'muni', yieldKey: 'ytw', sourceRef: '_muni_offerings.json' },
  'Taxable Muni': { rowsKey: 'munis', type: 'muni', yieldKey: 'ytw', sourceRef: '_muni_offerings.json' },
  CDs: { rowsKey: 'cds', type: 'cd', yieldKey: 'rate', sourceRef: '_offerings.json' },
  Corporate: { rowsKey: 'corporates', type: 'corporate', yieldKey: 'ytm', sourceRef: '_corporates.json' }
};

function maturityYear(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

function percentile(values, pct) {
  const nums = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const idx = Math.max(0, Math.min(nums.length - 1, Math.round((nums.length - 1) * pct)));
  return nums[idx];
}

function median(values) {
  const nums = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function addYearBucket(map, year, amount) {
  if (!year || !Number.isFinite(amount) || amount <= 0) return;
  map.set(year, (map.get(year) || 0) + amount);
}

function ladderGaps(yearBuckets, minYear, maxYear) {
  if (!(yearBuckets instanceof Map) || !yearBuckets.size || !minYear || !maxYear || maxYear < minYear) return [];
  const existing = Array.from(yearBuckets.values()).filter(v => v > 0);
  const typical = median(existing);
  if (!typical || typical <= 0) return [];
  const threshold = typical * 0.6;
  const gaps = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    const par = yearBuckets.get(year) || 0;
    if (par < threshold) gaps.push({ year, par, targetPar: Math.round(typical) });
  }
  return gaps;
}

function buildInvestmentFitProfile(parsedHoldings, asOfDate) {
  const anchorYear = maturityYear(asOfDate) || new Date().getUTCFullYear();
  const profile = {
    asOfDate,
    cusips: new Set(),
    yearBuckets: new Map(),
    gapYears: [],
    minYear: null,
    maxYear: null,
    preferredYears: [],
    sectors: {}
  };
  const allYears = [];
  for (const [sector, rows] of Object.entries(parsedHoldings && parsedHoldings.sectors || {})) {
    const sectorProfile = profile.sectors[sector] || {
      par: 0,
      count: 0,
      yearBuckets: new Map(),
      gapYears: [],
      callableCount: 0,
      minYear: null,
      maxYear: null
    };
    for (const row of rows || []) {
      if (row.cusip) profile.cusips.add(String(row.cusip).toUpperCase());
      const par = numericValue(row.par) || numericValue(row.marketValue) || 0;
      const year = maturityYear(row.maturity);
      sectorProfile.par += par;
      sectorProfile.count += 1;
      if (row.callDate || row.nextCall) sectorProfile.callableCount += 1;
      if (year && year >= anchorYear) {
        allYears.push(year);
        addYearBucket(profile.yearBuckets, year, par);
        addYearBucket(sectorProfile.yearBuckets, year, par);
        sectorProfile.minYear = sectorProfile.minYear == null ? year : Math.min(sectorProfile.minYear, year);
        sectorProfile.maxYear = sectorProfile.maxYear == null ? year : Math.max(sectorProfile.maxYear, year);
      }
    }
    sectorProfile.callableShare = sectorProfile.count ? sectorProfile.callableCount / sectorProfile.count : 0;
    profile.sectors[sector] = sectorProfile;
  }
  profile.minYear = percentile(allYears, 0.1);
  profile.maxYear = percentile(allYears, 0.9);
  if (profile.minYear && profile.maxYear && profile.minYear === profile.maxYear) {
    profile.minYear -= 1;
    profile.maxYear += 1;
  }
  profile.gapYears = ladderGaps(profile.yearBuckets, profile.minYear, profile.maxYear);
  profile.preferredYears = profile.gapYears.map(g => g.year);
  for (const sectorProfile of Object.values(profile.sectors)) {
    const minYear = Math.max(sectorProfile.minYear || profile.minYear || 0, profile.minYear || 0) || sectorProfile.minYear;
    const maxYear = Math.min(sectorProfile.maxYear || profile.maxYear || 0, profile.maxYear || 9999) || sectorProfile.maxYear;
    sectorProfile.gapYears = ladderGaps(sectorProfile.yearBuckets, minYear, maxYear);
  }
  return profile;
}

function nearestYearDistance(year, years) {
  if (!year || !Array.isArray(years) || !years.length) return null;
  return Math.min(...years.map(target => Math.abs(target - year)));
}

function scoreOfferingFit(row, map, held, sector, fitProfile, yieldValue) {
  const year = maturityYear(row && row.maturity);
  const heldYear = maturityYear(held && held.maturity);
  const sectorProfile = fitProfile && fitProfile.sectors ? fitProfile.sectors[sector] : null;
  const sectorGapYears = sectorProfile ? (sectorProfile.gapYears || []).map(g => g.year) : [];
  const portfolioGapYears = fitProfile ? (fitProfile.gapYears || []).map(g => g.year) : [];
  const reasons = [];
  let score = 0;

  if (year && sectorGapYears.includes(year)) {
    score += 70;
    reasons.push(`fills ${year} ${sector} ladder gap`);
  } else if (year && portfolioGapYears.includes(year)) {
    score += 45;
    reasons.push(`fills ${year} portfolio cash-flow gap`);
  }

  const gapDistance = nearestYearDistance(year, sectorGapYears.length ? sectorGapYears : portfolioGapYears);
  if (gapDistance != null && gapDistance > 0 && gapDistance <= 2) {
    score += 24 - gapDistance * 8;
    reasons.push(`near a ladder gap`);
  }

  if (year && heldYear) {
    const distance = Math.abs(year - heldYear);
    if (distance === 0) {
      score += 30;
      reasons.push(`keeps the ${heldYear} cash-flow slot`);
    } else if (distance <= 2) {
      score += 18 - distance * 4;
      reasons.push(`stays near the sold bond maturity`);
    } else if (distance >= 6) {
      score -= Math.min(30, (distance - 5) * 5);
    }
  }

  if (year && fitProfile && fitProfile.minYear && fitProfile.maxYear) {
    if (year >= fitProfile.minYear && year <= fitProfile.maxYear) {
      score += 12;
      reasons.push('inside the bank portfolio ladder');
    } else {
      score -= 25;
    }
  }

  if (map && map.type === 'agency') {
    const structure = String(row && row.structure || '').toLowerCase();
    const isCallable = structure.includes('call');
    const callableShare = sectorProfile ? sectorProfile.callableShare || 0 : 0;
    if (callableShare >= 0.45 && isCallable) {
      score += 18;
      reasons.push('matches callable agency appetite');
    } else if (callableShare <= 0.25 && isCallable) {
      score -= 28;
    } else if (callableShare <= 0.25 && !isCallable) {
      score += 10;
      reasons.push('matches bullet agency profile');
    }
  }

  if (yieldValue != null) score += yieldValue * 6;
  return {
    score,
    year,
    summary: reasons.slice(0, 2).join('; ') || 'matches current holdings profile'
  };
}

function pickBestOffering(rows, yieldKey, heldCusip, fitContext = {}) {
  let best = null;
  let bestScore = -Infinity;
  for (const row of rows) {
    if (heldCusip && row.cusip && String(row.cusip).toUpperCase() === heldCusip) continue;
    if (row.cusip && fitContext.fitProfile && fitContext.fitProfile.cusips && fitContext.fitProfile.cusips.has(String(row.cusip).toUpperCase())) continue;
    const n = numericValue(row[yieldKey]);
    if (n == null || n > 15) continue; // sanity cap — anything above 15% is bad data
    if (fitContext.minYield != null && n < fitContext.minYield) continue;
    const fit = scoreOfferingFit(row, fitContext.map, fitContext.held, fitContext.sector, fitContext.fitProfile, n);
    const score = fit.score;
    if (score > bestScore) { best = { row, yld: n, fit, score }; bestScore = score; }
  }
  return best;
}

function offeringPrice(row, type) {
  if (!row) return null;
  if (type === 'agency' || type === 'corporate') return numericValue(row.askPrice);
  if (type === 'muni' || type === 'treasury') return numericValue(row.price);
  return null;
}

function holdingHorizonYears(held, offering, asOfDate) {
  const explicit = numericValue(held.averageLife);
  if (explicit !== null && explicit > 0) return explicit;
  const duration = numericValue(held.effectiveDuration);
  if (duration !== null && duration > 0) return duration;
  const maturityYears = yearsUntil(held.maturity, asOfDate);
  if (maturityYears !== null && maturityYears > 0) return Math.min(maturityYears, 10);
  const offeringYears = yearsUntil(offering && offering.maturity, asOfDate);
  if (offeringYears !== null && offeringYears > 0) return Math.min(offeringYears, 10);
  return 1;
}

function roundMoney(value) {
  const n = numericValue(value);
  return n === null ? null : Math.round(n);
}


// Economics for "sell and reinvest the proceeds at the target rate." Income basis
// mirrors the Master Swap Template's Hand Income / BM-BO columns *exactly*:
//   income given up = (Book Value + Accrued) x effective yield   [what you book today]
//   income gained   = Proceeds (Market Value + Accrued) x target [redeploy proceeds]
// Yields are TEY for exempt munis (D32 = Tax-EQ mode) so the comparison is
// apples-to-apples against the taxable target. Breakeven (mo) = -G/L / (net annual
// income / 12), matching the template's AK19 / AP23.
function reinvestTargetEconomics(held, effYield, marketValue, bookValue, accrued, gainLossDollars, reinvestTarget, asOfDate) {
  if (effYield == null || reinvestTarget == null || !marketValue) return null;
  const bv = (bookValue != null && bookValue) ? bookValue : marketValue;
  const acc = numericValue(accrued) || 0;
  const proceeds = marketValue + acc;
  const realizedGainLoss = gainLossDollars != null ? gainLossDollars : (marketValue - bv);
  const horizonYears = Math.max(0.1, holdingHorizonYears(held, null, asOfDate));
  const annualIncomeGivenUp = (bv + acc) * effYield / 100;
  const annualBuyIncome = proceeds * reinvestTarget / 100;
  const annualIncomePickup = annualBuyIncome - annualIncomeGivenUp;
  const netInterestToHorizon = annualIncomePickup * horizonYears;
  const netBenefitToHorizon = netInterestToHorizon + realizedGainLoss;
  const lossToEarnBack = realizedGainLoss < 0 ? -realizedGainLoss : 0;
  const breakevenMonths = lossToEarnBack > 0 && annualIncomePickup > 0
    ? lossToEarnBack / (annualIncomePickup / 12)
    : null;
  return {
    horizonYears: Number(horizonYears.toFixed(2)),
    realizedGainLoss: roundMoney(realizedGainLoss),
    interestGivenUp: roundMoney(-annualIncomeGivenUp * horizonYears),
    buyIncome: roundMoney(annualBuyIncome * horizonYears),
    annualIncomeGivenUp: roundMoney(annualIncomeGivenUp),
    annualIncomePickup: roundMoney(annualIncomePickup),
    netInterestToHorizon: roundMoney(netInterestToHorizon),
    netBenefitToHorizon: roundMoney(netBenefitToHorizon),
    breakevenMonths: breakevenMonths === null ? null : Number(breakevenMonths.toFixed(1)),
    replacementPar: Math.round(proceeds)
  };
}

// Find swap candidates — a server-side port of the standalone "Portfolio Idea
// Engine" Portfolio Filtering screen. It is purely a SELL-SIDE screen: every idea
// is "sell this underearning bond and reinvest the proceeds at the target rate."
// There is no inventory dependency for the idea itself; a concrete same-sector buy
// from today's package is attached only as an "available today" hint when one
// beats the held bond.
//
// The screen, in the prototype's order:
//   1. position size ≥ min,
//   2. any realized loss within the % / $ loss budget (gains pass — we also keep
//      small gains per the desk's preference),
//   3. not maturing within 12 months,
//   4. effective yield (TEY for exempt munis) is BELOW the reinvest target
//      (pickup = target − eff > 0) — i.e. genuinely underearning.
// Candidates are ranked lowest effective yield first; breakeven = |%loss| / pickup.
// The reinvest target is a single flat rate the rep sets (default 5.00%).
//
// The one HARD rule still drops a candidate into `dropped[]`: the held bond can't
// mature before its breakeven (the loss can't be recouped from a bond already gone).
//
// `options.includeRejected = true` returns `{ kept, dropped, rules, reinvestTarget,
// reinvestTargetSource }`. The Build-your-own (manual) flow bypasses this entirely.
function findSwapCandidates(parsedHoldings, inventory, options = {}) {
  const empty = options.includeRejected ? { kept: [], dropped: [], reinvestTarget: null } : [];
  if (!parsedHoldings || !parsedHoldings.sectors || !inventory || !inventory.rows) return empty;
  const minPickupVsBook = options.minPickupVsBook ?? 0.25; // a matched buy must beat book by this to show as a hint
  const smallGlPct = options.smallGlPct ?? 2.0;            // |G/L%| at/under this tags as a small gain/loss
  // TEY knobs (Portfolio Filtering workflow). Defaults mirror the prototype.
  const taxRatePct = options.taxRatePct ?? 21;
  const cofPct = options.cofPct ?? 1.5;
  const bqFactor = options.bqFactor ?? 0.20;
  // Loss-budget knobs — what loss the desk will realize, and the floor position
  // size worth a ticket. maxDollarLoss / minParThousands are in $000.
  const maxPctLoss = options.maxPctLoss ?? 4.0;
  const maxDollarLossDollars = options.maxDollarLoss == null ? null : options.maxDollarLoss * 1000;
  const minParDollars = (options.minParThousands == null ? 0 : options.minParThousands) * 1000;
  const skipMaturingWithinMonths = options.skipMaturingWithinMonths ?? 12;
  const flatReinvest = (typeof options.reinvestRate === 'number' && options.reinvestRate > 0)
    ? options.reinvestRate : null;
  const rules = options.rules || swapMath.DEFAULT_FBBS_RULES;
  const limit = Math.max(1, parseInt(options.limit, 10) || 12);
  // A single flat reinvestment target the rep chooses; defaults to the prototype's 5.00%.
  const reinvestTarget = flatReinvest != null ? flatReinvest : (options.defaultReinvest ?? 5.0);
  const reinvestTargetSource = flatReinvest != null ? 'knob' : 'default';
  const kept = [];
  const dropped = [];
  const fitProfile = buildInvestmentFitProfile(parsedHoldings, inventory.asOfDate);

  for (const [sector, holdings] of Object.entries(parsedHoldings.sectors)) {
    // Every sector is screened (sell → reinvest at target), like the prototype.
    // Mapped sectors can additionally attach a concrete same-sector buy from
    // today's package; non-mapped sectors (MBS/CMO/CMBS/SBA/ABS/Other) surface
    // as generic reinvest ideas.
    const map = SWAP_SECTOR_MAP[sector] || null;
    const rows = (map && Array.isArray(inventory.rows[map.rowsKey])) ? inventory.rows[map.rowsKey] : [];
    const useStateMunis = sector.includes('Muni') && inventory.rows.stateMunis && inventory.rows.stateMunis.length;
    const candidateRows = useStateMunis ? inventory.rows.stateMunis : rows;
    const sourceRef = useStateMunis ? '_muni_offerings.json#stateMunis' : (map ? map.sourceRef : 'reinvest-target');
    const isExemptMuni = /exempt muni/i.test(sector);
    // Amortizing sectors carry their book yield in the file; never solve YTM from
    // price for them (the bullet formula is wrong for amortizers).
    const isAmortizing = /\b(MBS|CMO|CMBS|SBA|ABS|POOL)\b/i.test(sector);

    for (const held of holdings) {
      // Nominal book yield. Some sheets (notably the muni sheets) leave the raw
      // Bk YTW column blank and only carry the tax-equivalent column, so fall
      // back to solving YTM from book price + coupon + maturity (bullets only).
      let bookYld = numericValue(held.bookYieldYtm ?? held.bookYieldYtw);
      if (bookYld == null && !isAmortizing) {
        bookYld = swapMath.yieldFromPriceAndMaturity({
          price: numericValue(held.bookPrice), coupon: numericValue(held.coupon),
          maturity: held.maturity, settleDate: inventory.asOfDate
        });
      }
      if (bookYld == null) continue;
      let mktYld = numericValue(held.marketYieldYtw ?? held.marketYieldYtm);
      if (mktYld == null && !isAmortizing) {
        mktYld = swapMath.yieldFromPriceAndMaturity({
          price: numericValue(held.marketPrice), coupon: numericValue(held.coupon),
          maturity: held.maturity, settleDate: inventory.asOfDate
        });
      }
      // Effective yield: exempt munis are gross-up'd to a tax-equivalent basis
      // (FBBS verified form, COF + BQ disallowance) so they compare like-for-like
      // against the taxable reinvestment target. Everything else is its book yield.
      const teY = isExemptMuni
        ? swapMath.municipalTeYield(bookYld, { cofPct, taxRatePct, bqFactor })
        : null;
      const effYield = (isExemptMuni && teY != null) ? teY : bookYld;

      // Gain/loss as a % of book.
      const bookValueForGl = numericValue(held.bookValue)
        || (numericValue(held.par) != null && numericValue(held.bookPrice) != null
            ? numericValue(held.par) * numericValue(held.bookPrice) / 100 : null);
      const glDollars = numericValue(held.gainLoss);
      const glPct = bookValueForGl ? ((glDollars != null ? glDollars : 0) / bookValueForGl) * 100 : null;
      const par = numericValue(held.par) || 0;
      let mv = numericValue(held.marketValue);
      if (mv == null) mv = (bookValueForGl != null ? bookValueForGl : 0) + (glDollars || 0);
      if (!mv) mv = par;

      const pickupVsReinvest = reinvestTarget - effYield;
      const monthsToMaturity = swapMath.monthsUntilMaturity(held.maturity, inventory.asOfDate);

      // --- Portfolio Filtering screen, in the prototype's order ---
      // 1) meaningful position size
      if (par < minParDollars) continue;
      // 2) any realized loss within the % / $ loss budget (gains pass). Apply
      //    each budget independently whenever ITS input is known — a missing
      //    book value (null glPct) must not let a large dollar loss skip the
      //    dollar budget entirely.
      if (maxPctLoss != null && glPct != null && glPct < 0 && Math.abs(glPct) > maxPctLoss) continue;
      if (maxDollarLossDollars != null && glDollars != null && glDollars < 0 && Math.abs(glDollars) > maxDollarLossDollars) continue;
      // 3) skip anything maturing in the near term — it self-liquidates anyway
      if (skipMaturingWithinMonths && monthsToMaturity != null && monthsToMaturity <= skipMaturingWithinMonths) continue;
      // 4) must be underearning: effective yield (TEY for munis) below the target
      if (!(pickupVsReinvest > 0)) continue;

      // Reinvestment economics: sell and redeploy the proceeds at the target rate.
      // Income basis matches the Master Swap Template (Book Value+Accrued x eff yield
      // given up vs Proceeds x target gained), so added income + breakeven tie out.
      const accrued = numericValue(held.accruedInterest) || 0;
      const economics = reinvestTargetEconomics(held, effYield, mv, bookValueForGl, accrued, glDollars, reinvestTarget, inventory.asOfDate);
      if (!economics) continue;
      const addedAnnualIncome = economics.annualIncomePickup;
      const reinvestBeYears = economics.breakevenMonths == null ? null : economics.breakevenMonths / 12;

      // Attach a concrete same-sector buy from today's package as an "available
      // today" hint when one beats the held book yield; otherwise the idea stands
      // on its own as a generic reinvest at the target rate. Non-mapped sectors
      // (MBS/CMO/etc.) have no buy universe, so they're always generic.
      const pick = map ? pickBestOffering(candidateRows, map.yieldKey, held.cusip ? String(held.cusip).toUpperCase() : null, {
        fitProfile, held, sector, map, minYield: bookYld + minPickupVsBook
      }) : null;
      const matchedPickup = pick ? pick.yld - bookYld : null;
      const hasMatchedBuy = pick && matchedPickup >= minPickupVsBook;
      let offeringObj;
      let yieldPickupVsBook = null;
      if (hasMatchedBuy) {
        yieldPickupVsBook = Number(matchedPickup.toFixed(2));
        offeringObj = {
          label: offeringLabel(pick.row, map.type),
          cusip: pick.row.cusip || '',
          yield: Number(pick.yld.toFixed(3)),
          price: offeringPrice(pick.row, map.type),
          coupon: pick.row.coupon ?? null,
          maturity: pick.row.maturity || '',
          callDate: pick.row.nextCallDate || pick.row.callDate || '',
          sector: map.type,
          sourceRef,
          fitYear: pick.fit && pick.fit.year || null,
          fitSummary: pick.fit && pick.fit.summary || '',
          structure: pick.row.structure || '',
          generic: false,
          availableToday: true
        };
      } else {
        offeringObj = {
          label: `Reinvest at ${reinvestTarget.toFixed(2)}% target`,
          cusip: '', yield: Number(reinvestTarget.toFixed(3)), price: 100,
          coupon: null, maturity: '', callDate: '', sector: (map ? map.type : sector),
          sourceRef: 'reinvest-target', fitYear: null,
          fitSummary: 'No same-sector buy beats the held yield today — reinvest the proceeds at the target rate.',
          structure: '', generic: true
        };
      }

      const ruleEval = swapMath.evaluateSwapAgainstRules({
        breakevenMonths: economics.breakevenMonths,
        monthsToMaturity,
        annualIncomePickup: economics.annualIncomePickup,
        rules
      });

      const tags = ['below-reinvest'];
      if (glPct != null) {
        if (glPct < 0) tags.push('small-loss');
        else if (glPct <= smallGlPct) tags.push('small-gain');
      }
      if (yieldPickupVsBook != null && yieldPickupVsBook >= 0.5) tags.push('yield-pickup');
      const candidate = {
        sector,
        tags,
        reinvestRate: reinvestTarget == null ? null : Number(reinvestTarget.toFixed(3)),
        held: {
          cusip: held.cusip || '',
          description: held.description || '',
          par,
          bookPrice: numericValue(held.bookPrice),
          marketPrice: numericValue(held.marketPrice),
          bookValue: numericValue(held.bookValue) || 0,
          marketValue: mv,
          bookYield: Number(bookYld.toFixed(3)),
          marketYield: mktYld == null ? null : Number(mktYld.toFixed(3)),
          effYield: Number(effYield.toFixed(3)),
          teYield: teY == null ? null : Number(teY.toFixed(3)),
          isExemptMuni,
          gainLoss: glDollars || 0,
          gainLossPct: glPct == null ? null : Number(glPct.toFixed(2)),
          maturity: held.maturity || '',
          monthsToMaturity: monthsToMaturity == null ? null : Number(monthsToMaturity.toFixed(1)),
          wal: numericValue(held.averageLife),
          effDuration: numericValue(held.effectiveDuration)
        },
        offering: offeringObj,
        yieldPickupVsBook,
        pickupVsReinvest: Number(pickupVsReinvest.toFixed(2)),
        addedAnnualIncome: Math.round(addedAnnualIncome),
        reinvestBreakevenYears: reinvestBeYears == null ? null : Number(reinvestBeYears.toFixed(1)),
        economics,
        rule: {
          hardPass: ruleEval.hardPass,
          hardReason: ruleEval.hardReason,
          warnings: ruleEval.warnings
        }
      };

      if (ruleEval.hardPass) kept.push(candidate);
      else dropped.push(candidate);
    }
  }
  // Rank lowest effective yield first — the worst earners are the best swaps.
  const byEffYield = (a, b) => a.held.effYield - b.held.effYield;
  kept.sort(byEffYield);
  dropped.sort(byEffYield);
  const trimmedKept = kept.slice(0, limit);
  if (options.includeRejected) {
    return {
      kept: trimmedKept,
      dropped: dropped.slice(0, 30),
      rules,
      reinvestTarget: reinvestTarget == null ? null : Number(reinvestTarget.toFixed(3)),
      reinvestTargetSource
    };
  }
  return trimmedKept;
}

function formatSwapCandidateLine(c) {
  const heldDescr = c.held.description ? c.held.description.slice(0, 36) : c.held.cusip;
  const parK = c.held.par ? `$${Math.round(c.held.par / 1000)}K` : '';
  const heldLeft = `${c.held.cusip || 'held'} ${heldDescr}`.trim();
  const mkt = c.held.marketYield == null ? '' : ` / ${c.held.marketYield.toFixed(2)}% market`;
  const heldYld = `${c.held.bookYield.toFixed(2)}% book${mkt}${parK ? ` · ${parK}` : ''}`;
  const econ = c.economics || {};
  const breakeven = econ.breakevenMonths !== null && econ.breakevenMonths !== undefined ? ` · breakeven ${econ.breakevenMonths.toFixed(1)} mo` : '';
  const net = econ.netBenefitToHorizon ? ` · est. net $${Math.round(econ.netBenefitToHorizon / 1000)}K` : '';
  const pickup = c.yieldPickupVsBook != null
    ? ` · +${c.yieldPickupVsBook.toFixed(2)}% buy pickup`
    : (c.pickupVsReinvest != null ? ` · +${c.pickupVsReinvest.toFixed(2)}% vs reinvest target` : '');
  return `${heldLeft} (${heldYld}) → ${c.offering.label}${pickup}${breakeven}${net}`;
}

function filterExamplesAgainstHoldings(examples, holdings) {
  if (!holdings || !holdings.cusipIndex || !Array.isArray(examples)) return examples;
  return examples.filter(label => {
    // Examples are short strings — look for CUSIP-shaped tokens (9 char alnum)
    // and drop the row if any token is in the bank's holdings.
    const tokens = String(label).match(/[A-Z0-9]{9}/g) || [];
    return !tokens.some(t => holdings.cusipIndex[t.toUpperCase()]);
  });
}

function assistantPeriodAgeMonths(period) {
  if (!period) return null;
  const str = String(period).trim();
  let year = null;
  let monthEnd = null;
  const q = str.match(/^(\d{4})\s*Q([1-4])$/i);
  if (q) {
    year = Number(q[1]);
    monthEnd = Number(q[2]) * 3;
  } else {
    const y = str.match(/^(\d{4})\s*Y?$/i);
    if (y) {
      year = Number(y[1]);
      monthEnd = 12;
    }
  }
  if (!year) return null;
  const now = new Date();
  const filing = new Date(year, monthEnd - 1, 28);
  return (now.getFullYear() - filing.getFullYear()) * 12 + (now.getMonth() - filing.getMonth());
}

// Assistant response builder.
//
// This is the swap point for a future LLM provider. Today the readout is
// fully deterministic — signals + product fits + curated inventory examples
// derived from local data, no outbound calls. To bolt on a real model later,
// wrap this function: keep the same input/output shape, but feed the bounded
// context object (bank, signals, fits, inventory, strategies) into a prompt
// and replace `summary` / `callNote` / `sections` with model output. Do NOT
// send the raw bank blob — the context dict below is already curated for that.
function buildBankAssistantResponse(bankData, action) {
  const bank = bankData.bank;
  const summary = bank.summary || {};
  const { latest, values } = latestBankValues(bank);
  const inventory = currentInventorySnapshot(values.state || summary.state);
  const strategyData = listStrategyRequests(BANK_REPORTS_DIR, { bankId: bank.id, archived: 'all' });
  const strategies = strategyData && Array.isArray(strategyData.requests) ? strategyData.requests.slice(0, 8) : [];
  const parsedHoldings = loadHoldingsForBank(bank);
  const swapCandidates = findSwapCandidates(parsedHoldings, inventory);
  const signals = buildAssistantSignals(bank, inventory, strategies, parsedHoldings);
  const fits = buildAssistantProductFits(bank, inventory, signals, parsedHoldings);
  const bankName = values.name || summary.displayName || summary.name || 'this bank';
  const location = [values.city || summary.city, values.state || summary.state].filter(Boolean).join(', ');
  const metricLines = [
    bankMetricLine('Assets', values.totalAssets, 'money'),
    bankMetricLine('Securities/assets', values.securitiesToAssets, 'percent'),
    bankMetricLine('Loans/deposits', values.loansToDeposits, 'percent'),
    bankMetricLine('Liquid/assets', values.liquidAssetsToAssets, 'percent'),
    bankMetricLine('Yield on securities', values.yieldOnSecurities, 'percent'),
    bankMetricLine('NIM', values.netInterestMargin, 'percent')
  ].filter(Boolean);
  const topFit = fits[0];
  const signalTypes = signals.map(s => String(s.type || '').toLowerCase());
  const hits = (...kws) => kws.some(kw => signalTypes.some(t => t.includes(kw)));
  const nextQuestions = [];
  if (hits('funding', 'wholesale', 'brokered', 'runoff')) nextQuestions.push('Where is cost of funds right now, and what term are they working in?');
  if (hits('liquidity', 'runoff')) nextQuestions.push('What\'s the on-balance-sheet liquidity target, and how flexible is it?');
  if (hits('muni')) nextQuestions.push('Is the muni bucket BQ-only, and what credit cutoff is in policy?');
  if (hits('mbs')) nextQuestions.push('Any concerns on extension or premium amortization in the current MBS book?');
  if (hits('portfolio', 'yield', 'active')) nextQuestions.push('Add yield, replace runoff, or shorten — which problem is the portfolio solving today?');
  if (hits('coverage')) nextQuestions.push('Anything in the relationship history that should shape this outreach?');
  if (!nextQuestions.length) {
    nextQuestions.push('What\'s the portfolio trying to do this quarter — add yield, hold liquidity, manage funding?');
    nextQuestions.push('Which sectors are approved and active on the buy list right now?');
  }
  nextQuestions.push('Does this turn into a strategy request, a bond-accounting review, or a one-off follow-up?');

  const holdings = bank.bondAccounting && bank.bondAccounting.available ? bank.bondAccounting : null;
  const noteLines = [
    `${bankName}${location ? ` (${location})` : ''}${latest && latest.period ? ` · ${latest.period}` : ''}`,
    metricLines.length ? metricLines.join(' · ') : 'Latest call-report metrics not loaded.',
    '',
    `Angle: ${topFit.product} (${topFit.fit}) — ${topFit.reason}`,
    `Ask: ${nextQuestions[0]}`
  ];
  if (topFit.examples && topFit.examples[0]) noteLines.push(`Show: ${topFit.examples[0]}`);
  if (holdings) noteLines.push(`Holdings: bond accounting file on disk through ${holdings.latestReportDate || 'recent'} — review before pitching.`);
  if (swapCandidates.length) {
    const top = swapCandidates[0];
    const pickup = top.yieldPickupVsBook != null
      ? `+${top.yieldPickupVsBook.toFixed(2)}% buy pickup`
      : (top.pickupVsReinvest != null ? `+${top.pickupVsReinvest.toFixed(2)}% vs reinvest target` : 'pickup n/a');
    noteLines.push(`Swap: ${top.held.cusip} (${top.held.bookYield.toFixed(2)}% book) → ${top.offering.label} · ${pickup}`);
  }
  const callNote = noteLines.join('\n');

  const fitPhrase = topFit.fit === 'Review'
    ? `worth a look for ${topFit.product.toLowerCase()}`
    : `a ${topFit.fit.toLowerCase()} fit for ${topFit.product.toLowerCase()}`;

  const notices = [];
  const inventoryEmpty = Object.values(inventory.counts || {}).every(n => !n);
  if (inventoryEmpty) {
    notices.push({
      tone: 'warn',
      text: 'No offering inventory parsed yet today — try again after the morning upload.'
    });
  }
  const periodAge = latest && latest.period ? assistantPeriodAgeMonths(latest.period) : null;
  if (periodAge !== null && periodAge >= 6) {
    notices.push({
      tone: 'warn',
      text: `Latest filing is ${latest.period} — older than usual; verify before acting on these signals.`
    });
  }
  const statusValue = (summary.accountStatus && summary.accountStatus.status) || 'Open';
  const statusPill = {
    status: statusValue,
    slug: String(statusValue).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    owner: (summary.accountStatus && summary.accountStatus.owner) || ''
  };
  const fitsWithLinks = fits.map(fit => ({
    text: `${fit.product} — ${fit.fit}. ${fit.reason}`,
    explorerPage: fit.explorerPage || null,
    explorerLabel: fit.explorerLabel || null
  }));

  const response = {
    action,
    title: `${bankName}`,
    subtitle: [location, latest && latest.period, summary.certNumber ? `Cert ${summary.certNumber}` : ''].filter(Boolean).join(' · '),
    summary: `${fitPhrase.charAt(0).toUpperCase() + fitPhrase.slice(1)} based on the latest filing and today's inventory.`,
    topProduct: topFit.product,
    statusPill,
    holdings: holdings ? {
      reportDate: holdings.latestReportDate || '',
      fileCount: holdings.portfolioFileCount || 0,
      latestStoredPath: (holdings.portfolios && holdings.portfolios[0] && holdings.portfolios[0].storedPath) || '',
      totalPositions: parsedHoldings && parsedHoldings.aggregates ? parsedHoldings.aggregates.totalPositions : null,
      sectorCounts: parsedHoldings ? parsedHoldings.sectorCounts : null,
      bookYieldYtw: parsedHoldings && parsedHoldings.totals ? parsedHoldings.totals.bookYieldYtw : null,
      marketYieldYtw: parsedHoldings && parsedHoldings.totals ? parsedHoldings.totals.marketYieldYtw : null,
      unrealizedGainLoss: parsedHoldings && parsedHoldings.totals ? parsedHoldings.totals.unrealizedGainLoss : null
    } : null,
    swapCandidates,
    notices,
    context: {
      bankId: bank.id,
      asOfDate: inventory.asOfDate,
      inventoryCounts: inventory.counts,
      swapCandidateCount: swapCandidates.length,
      portalBuild: PORTAL_BUILD,
      strategyCount: strategies.length,
      periodAgeMonths: periodAge
    },
    sections: [
      { title: 'Read', items: signals.slice(0, 4).map(signal => signal.text) },
      ...(swapCandidates.length ? [{ title: 'Swap candidates', items: swapCandidates.map(formatSwapCandidateLine) }] : []),
      { title: 'Product fit', items: fitsWithLinks },
      { title: 'From today\'s inventory', items: fits.flatMap(fit => (fit.examples || []).slice(0, 2).map(example => `${fit.product}: ${example}`)).slice(0, 5) },
      { title: 'Ask on the call', items: nextQuestions }
    ],
    callNote,
    disclaimer: 'Internal sales support. Not investment advice.'
  };

  if (action === 'summary') {
    response.summary = `${bankName}${location ? ` (${location})` : ''} — ${latest && latest.period ? `as of ${latest.period}` : 'latest period unavailable'}.`;
    response.sections = [
      { title: 'Snapshot', items: metricLines.length ? metricLines : ['No call-report metrics loaded yet.'] },
      { title: 'Read', items: signals.slice(0, 4).map(signal => signal.text) },
      { title: 'Coverage', items: [
        `Status: ${(summary.accountStatus && summary.accountStatus.status) || 'Open'}${summary.accountStatus && summary.accountStatus.owner ? ` · ${summary.accountStatus.owner}` : ''}`,
        strategies.length ? `${strategies.length} strategy request${strategies.length === 1 ? '' : 's'} in history.` : 'No strategy history.'
      ] }
    ];
  } else if (action === 'call') {
    response.summary = `Confirm need first: ${topFit.reason}`;
    response.sections = [
      { title: 'Open with', items: signals.slice(0, 3).map(signal => signal.text) },
      ...(swapCandidates.length ? [{ title: 'Swap candidates', items: swapCandidates.map(formatSwapCandidateLine) }] : []),
      { title: 'Ask', items: nextQuestions },
      { title: 'Offer only if it fits', items: fits.slice(0, 3).map(fit => `${fit.product}: ${fit.examples && fit.examples[0] ? fit.examples[0] : fit.reason}`) }
    ];
  } else if (action === 'note') {
    response.summary = 'Drop this into coverage notes or a strategy request.';
    response.sections = [
      { title: 'Note', items: callNote.split('\n').filter(Boolean) }
    ];
  }

  return response;
}

async function handleBankAssistant(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const bankId = String(body.bankId || '').trim();
    const action = ['fit', 'summary', 'call', 'note'].includes(body.action) ? body.action : 'fit';
    if (!bankId) return sendJSON(res, 400, { error: 'Bank ID is required' });
    const data = getBankById(bankId);
    if (!data || !data.bank) return sendJSON(res, 404, { error: 'Bank not found' });
    return sendJSON(res, 200, buildBankAssistantResponse(data, action));
  } catch (err) {
    log('warn', 'Bank assistant failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not build assistant response' });
  }
}

// ---------------------------------------------------------------------------
// Inverse query: who in our coverage might buy this offering?
//
// Trader-facing flip-side of the bank assistant. Same provider-seam discipline:
// today the scoring is deterministic on call-report fields + coverage status.
// To plug a model in later, keep the bounded context (coverage universe slice
// + offering blob) and replace `scoreCoverageBankForOffering` with a model
// call — do NOT widen the universe or send raw bank blobs downstream.

const BUYER_PRODUCT_TYPES = new Set(['agency', 'muni', 'cd', 'corporate', 'mbs', 'treasury']);
const BUYER_STATUS_BASE = { Client: 24, Prospect: 14, Watchlist: 8, Dormant: 3, Open: 0 };

function buyerOfferingHeadline(productType, offering) {
  if (!offering || typeof offering !== 'object') return '';
  const num = (v, d = 3) => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(d);
  if (productType === 'agency') {
    const yld = num(offering.ytm); const ync = num(offering.ytnc);
    return `${offering.structure || 'Agency'} ${offering.ticker || ''} ${offering.maturity || ''}${yld ? ` · YTM ${yld}%` : ''}${ync ? ` · YTNC ${ync}%` : ''}${offering.cusip ? ` (${offering.cusip})` : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (productType === 'muni') {
    return `${offering.issuerState || ''} ${offering.issuerName || 'Muni'} ${offering.maturity || ''}${num(offering.ytw) ? ` · YTW ${num(offering.ytw)}%` : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (productType === 'cd') {
    return `${offering.term || ''} ${offering.name || 'CD'}${num(offering.rate, 2) ? ` at ${num(offering.rate, 2)}%` : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (productType === 'corporate') {
    return `${offering.issuerName || offering.ticker || 'Corporate'} ${offering.maturity || ''}${num(offering.ytm) ? ` · YTM ${num(offering.ytm)}%` : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (productType === 'mbs') {
    return `${offering.cusip || offering.description || 'MBS/CMO'}${num(offering.yield) ? ` · ${num(offering.yield)}%` : ''}`.trim();
  }
  if (productType === 'treasury') {
    return `${offering.description || 'Treasury'}${num(offering.yield) ? ` · ${num(offering.yield)}%` : ''}`.trim();
  }
  return '';
}

// Sectors in the parsed-holdings index that count as "this bank actively holds
// inventory in the same asset class as the offering" — used for the sector
// boost in scoreCoverageBankForOffering.
const HOLDINGS_SECTOR_BOOST = {
  agency:    { sectors: ['Agency'], boost: 10, label: 'agencies' },
  muni:      { sectors: ['Exempt Muni', 'Taxable Muni'], boost: 10, label: 'munis' },
  cd:        { sectors: ['CDs'], boost: 6, label: 'CDs' },
  corporate: { sectors: ['Corporate'], boost: 10, label: 'corporates' },
  mbs:       { sectors: ['MBS', 'CMO', 'CMBS'], boost: 12, label: 'MBS/CMO' },
  treasury:  { sectors: ['Treasury'], boost: 8, label: 'treasuries' }
};

function scoreCoverageBankForOffering(bank, productType, offering, holdingsForBank, opts = {}) {
  const status = String(bank.accountStatusLabel || 'Open');
  let base = BUYER_STATUS_BASE[status] || 0;
  if (base <= 0) {
    // The buyers drawer only ranks covered banks. The inverse (tear-sheet
    // "today's fits") starts from a specific bank, so an Open bank still
    // gets scored — on its financials alone, with a token base.
    if (!opts.allowUncovered) return null;
    base = 4;
  }

  // Hard exclude if they already own this exact CUSIP.
  const offeringCusip = offering && offering.cusip ? String(offering.cusip).toUpperCase() : '';
  if (offeringCusip && holdingsForBank && holdingsForBank.cusipSet && holdingsForBank.cusipSet.has(offeringCusip)) {
    return null;
  }

  const ltd = numericValue(bank.loansToDeposits);
  const securities = numericValue(bank.securitiesToAssets);
  const liquid = numericValue(bank.liquidAssetsToAssets);
  const wholesale = numericValue(bank.wholesaleFundingReliance);
  const yieldSecs = numericValue(bank.yieldOnSecurities);
  const nim = numericValue(bank.netInterestMargin);
  const assets = numericValue(bank.totalAssets);
  let score = base;
  const why = [status];

  if (productType === 'agency') {
    if (securities !== null) {
      if (securities >= 12 && securities <= 30) { score += 15; why.push(`Securities ${securities.toFixed(0)}% (active book, room)`); }
      else if (securities < 12) { score += 8; why.push(`Securities only ${securities.toFixed(0)}% (room to add)`); }
    }
    if (ltd !== null && ltd > 95) { score -= 12; why.push(`L/D ${ltd.toFixed(0)}% (funding-pressured)`); }
    if (yieldSecs !== null && nim !== null && yieldSecs < nim - 1) {
      score += 10; why.push(`Book yield ${yieldSecs.toFixed(2)}% trails NIM (lift opportunity)`);
    }
  } else if (productType === 'muni') {
    const offState = String((offering && (offering.issuerState || offering.state)) || '').toUpperCase();
    const bankState = String(bank.state || '').toUpperCase();
    if (offState && bankState && offState === bankState) { score += 28; why.push(`In-state (${bankState})`); }
    if (securities !== null && securities >= 18) { score += 10; why.push(`Securities ${securities.toFixed(0)}% (active book)`); }
    if (assets !== null && assets >= 500000) { score += 6; why.push('Size supports broader BQ universe'); }
    if (ltd !== null && ltd > 95) { score -= 8; why.push(`L/D ${ltd.toFixed(0)}% (funding-pressured)`); }
  } else if (productType === 'cd') {
    if (ltd !== null && ltd >= 95) { score += 22; why.push(`L/D ${ltd.toFixed(0)}% (likely in market)`); }
    else if (ltd !== null && ltd >= 85) { score += 14; why.push(`L/D ${ltd.toFixed(0)}%`); }
    if (liquid !== null && liquid < 10) { score += 10; why.push(`Liquid only ${liquid.toFixed(0)}%`); }
    if (wholesale !== null && wholesale >= 20) { score += 8; why.push(`Wholesale funding ${wholesale.toFixed(0)}%`); }
  } else if (productType === 'corporate') {
    if (securities !== null && securities >= 22) { score += 14; why.push(`Securities ${securities.toFixed(0)}% (active book)`); }
    if (assets !== null && assets >= 1000000) { score += 8; why.push('Bank size supports corporates'); }
    else if (assets !== null && assets < 250000) { score -= 12; why.push('Smaller bank — corporates often outside policy'); }
  } else if (productType === 'mbs') {
    if (securities !== null && securities >= 22) { score += 18; why.push(`Securities ${securities.toFixed(0)}% (active reinvestor)`); }
    else if (securities !== null && securities >= 18) { score += 10; why.push(`Securities ${securities.toFixed(0)}%`); }
    if (assets !== null && assets >= 500000) { score += 6; why.push('Size supports MBS analysis'); }
  } else if (productType === 'treasury') {
    if (liquid !== null && liquid >= 25) { score += 14; why.push(`Liquid ${liquid.toFixed(0)}% (treasury-friendly)`); }
    if (yieldSecs !== null && nim !== null && yieldSecs < nim - 1.5) { score += 10; why.push(`Book yield trails NIM`); }
    if (ltd !== null && ltd > 95) { score -= 8; why.push(`L/D ${ltd.toFixed(0)}% (funding-pressured)`); }
  }

  // Sector-presence boost when we have parsed holdings for this bank.
  const sectorBoost = HOLDINGS_SECTOR_BOOST[productType];
  if (sectorBoost && holdingsForBank && holdingsForBank.sectorCounts) {
    const count = sectorBoost.sectors.reduce((acc, sector) => acc + (holdingsForBank.sectorCounts[sector] || 0), 0);
    if (count > 0) {
      score += sectorBoost.boost;
      why.push(`Holds ${count} ${sectorBoost.label}`);
    }
  }
  return { score, rationale: why };
}

function findBuyerCandidates({ productType, offering, limit = 10, owner = '' }) {
  if (!BUYER_PRODUCT_TYPES.has(productType)) {
    const err = new Error('Unsupported product type');
    err.statusCode = 400;
    throw err;
  }
  const mapData = getMapBankData();
  if (!mapData || !Array.isArray(mapData.banks)) {
    return { offeringHeadline: buyerOfferingHeadline(productType, offering), buyers: [], coverageCount: 0, scopedOwner: null, scopedCount: null, notice: 'Bank dataset not loaded.' };
  }
  const coverage = mapData.banks.filter(b => b.accountStatusLabel && b.accountStatusLabel !== 'Open');
  // Optional rep scope: limit the pool to the banks a given coverage owner is
  // assigned, so a rep gets their own "who should I call?" list rather than the
  // whole firm's coverage. Matched the same way the maturity calendar matches an
  // acting-as rep to a coverage owner (exact, case-insensitive).
  const ownerKey = String(owner || '').trim().toLowerCase();
  const pool = ownerKey
    ? coverage.filter(b => String((b.accountStatus && b.accountStatus.owner) || '').trim().toLowerCase() === ownerKey)
    : coverage;
  const holdingsIndex = getCoverageHoldingsIndex();
  const scored = pool
    .map(b => {
      const holdingsForBank = holdingsIndex ? holdingsIndex.get(String(b.id)) : null;
      const result = scoreCoverageBankForOffering(b, productType, offering, holdingsForBank);
      if (!result || result.score <= 0) return null;
      const statusSlug = String(b.accountStatusLabel || 'open').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return {
        bankId: b.id,
        displayName: b.displayName || b.legalName || 'Unknown bank',
        location: [b.city, b.state].filter(Boolean).join(', '),
        certNumber: b.certNumber || '',
        status: b.accountStatusLabel,
        statusSlug,
        owner: (b.accountStatus && b.accountStatus.owner) || '',
        period: b.period || '',
        score: Math.round(result.score),
        rationale: result.rationale
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 25)));
  let notice = '';
  if (coverage.length === 0) notice = 'No banks have an active coverage status — every bank is set to Open.';
  else if (ownerKey && pool.length === 0) notice = `No covered banks are assigned to ${owner}.`;
  return {
    offeringHeadline: buyerOfferingHeadline(productType, offering),
    coverageCount: coverage.length,
    scopedOwner: ownerKey ? owner : null,
    scopedCount: ownerKey ? pool.length : null,
    buyers: scored,
    notice
  };
}

async function handleBuyerCandidates(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const productType = String(body.productType || '').trim().toLowerCase();
    if (!BUYER_PRODUCT_TYPES.has(productType)) return sendJSON(res, 400, { error: 'Unsupported product type' });
    const offering = (body.offering && typeof body.offering === 'object') ? body.offering : {};
    const limit = Number(body.limit) || 10;
    const owner = typeof body.owner === 'string' ? body.owner : '';
    const result = findBuyerCandidates({ productType, offering, limit, owner });
    return sendJSON(res, 200, result);
  } catch (err) {
    log('warn', 'Buyer candidates failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not score buyer candidates' });
  }
}

// Inverse of findBuyerCandidates: one bank, every offering in today's
// inventory. Each row is scored with the same per-product fit rules the
// buyers drawer uses (sector presence, in-state munis, owned-CUSIP
// exclusion), then grouped by asset class so the tear sheet can answer
// "what in today's package should I pitch this bank?".
function findOfferingFitsForBank(bankId, limitPerClass = 4) {
  const mapData = getMapBankData();
  if (!mapData || !Array.isArray(mapData.banks)) {
    const err = new Error('Bank dataset not loaded');
    err.statusCode = 503;
    throw err;
  }
  const bank = mapData.banks.find(b => String(b.id) === String(bankId));
  if (!bank) {
    const err = new Error('Bank not found');
    err.statusCode = 404;
    throw err;
  }
  const holdingsIndex = getCoverageHoldingsIndex();
  const holdings = holdingsIndex ? holdingsIndex.get(String(bank.id)) : null;
  const byType = new Map();
  let scanned = 0;
  let ownedSkipped = 0;
  for (const row of buildAllOfferingsRows()) {
    if (!BUYER_PRODUCT_TYPES.has(row.type)) continue; // no fit rules (structured notes)
    if (row.yield == null) continue; // nothing to pitch without an economic yield
    scanned += 1;
    const result = scoreCoverageBankForOffering(
      bank, row.type, { cusip: row.cusip, issuerState: row.state }, holdings, { allowUncovered: true }
    );
    if (!result) { ownedSkipped += 1; continue; } // already holds this CUSIP
    const bucket = byType.get(row.type) || [];
    bucket.push({ row, score: result.score, rationale: result.rationale });
    byType.set(row.type, bucket);
  }
  const perClass = Math.max(1, Math.min(Number(limitPerClass) || 4, 10));
  const classes = Array.from(byType.entries())
    .map(([type, list]) => {
      // In-state munis outrank by score; everything else ties within the
      // class, so yield decides. Transparent enough for a call list.
      list.sort((a, b) => (b.score - a.score) || ((b.row.yield ?? 0) - (a.row.yield ?? 0)));
      const top = list[0];
      return {
        type,
        label: top.row.assetClass,
        page: top.row.page,
        score: Math.round(top.score),
        offeringCount: list.length,
        rationale: top.rationale,
        picks: list.slice(0, perClass).map(x => ({
          cusip: x.row.cusip || '',
          description: x.row.description || '',
          coupon: x.row.coupon,
          yield: x.row.yield,
          maturity: x.row.maturity,
          price: x.row.price,
          state: x.row.state || '',
          sector: x.row.sector || '',
          inState: x.row.type === 'muni' && x.row.state
            && String(x.row.state).toUpperCase() === String(bank.state || '').toUpperCase()
        }))
      };
    })
    .sort((a, b) => b.score - a.score);
  let notice = '';
  if (!scanned) notice = 'No offerings are loaded — has today’s package been published?';
  return {
    bank: {
      id: bank.id,
      displayName: bank.displayName || bank.legalName || 'Unknown bank',
      status: bank.accountStatusLabel || 'Open',
      location: [bank.city, bank.state].filter(Boolean).join(', '),
      period: bank.period || ''
    },
    holdings: holdings ? { reportDate: holdings.reportDate, totalPositions: holdings.totalPositions } : null,
    scanned,
    ownedSkipped,
    classes,
    notice
  };
}

let mapBankCache = null;
let mapBankCacheBody = null; // pre-serialized JSON for /api/banks/map (large payload)
let mapBankCacheBodyGz = null; // gzipped copy of mapBankCacheBody (see /api/banks/map)

const BANK_FIELD_LABELS = new Map((BANK_FIELDS || []).map(f => [f.key, f.label]));

function getPeerComparisonForMap() {
  const index = getPeerComparisonIndex();
  if (!index) return null;
  const period = index.periods[0] || '';
  const rawByKey = index.byPeriod.get(period) || {};
  // Attach the curated BANK_FIELDS label to each metric so the map's peer
  // chips render friendly names. The byKey set spans more metrics than the
  // map's projected fields, so the client can't resolve them all on its own
  // and was falling back to the raw camelCase key (netIncome, llrToLoans…).
  // Fall back to the FedFis peer label, then the key, for the few metrics
  // with no BANK_FIELDS entry.
  const byKey = {};
  for (const [key, info] of Object.entries(rawByKey)) {
    byKey[key] = { ...info, label: BANK_FIELD_LABELS.get(key) || info.peerLabel || key };
  }
  return {
    peerGroup: index.peerGroup,
    period,
    bankPeriod: '',
    periodAligned: false,
    byKey
  };
}

function buildMapBankList() {
  const peerForMap = getPeerComparisonForMap();
  const data = queryBankMapDataset(BANK_REPORTS_DIR, null, { peerComparison: peerForMap });
  if (!data || !Array.isArray(data.banks)) return data;
  if (data.peerComparison && data.latestPeriod) {
    data.peerComparison.bankPeriod = data.latestPeriod;
    data.peerComparison.periodAligned = data.latestPeriod === data.peerComparison.period;
  }
  const bankIds = data.banks.map(row => row.id);
  const statuses = getBankAccountStatuses(BANK_REPORTS_DIR, bankIds);
  const coverageMap = getSavedBankCoverageMap(BANK_REPORTS_DIR, bankIds);
  return {
    ...data,
    banks: data.banks.map(row => {
      const accountStatus = effectiveAccountStatus(row, statuses, coverageMap);
      return {
        ...row,
        accountStatus,
        accountStatusLabel: accountStatus.status || 'Open'
      };
    })
  };
}

function getMapBankData() {
  if (mapBankCache) return mapBankCache;
  try {
    const built = buildMapBankList();
    if (built) mapBankCache = built;
    return built;
  } catch (err) {
    log('warn', 'Map bank list build failed:', err.message);
    return null;
  }
}

function invalidateMapBankCache() {
  mapBankCache = null;
  mapBankCacheBody = null;
  mapBankCacheBodyGz = null;
}

// Tear-sheet peer comparison: maps BANK_FIELDS keys to FedFis "Averaged Series"
// peer-group averages so the call-report sections can render a Peer Avg column.
// The peerLabels regex set mirrors PEER_ANALYSIS_METRICS in public/js/portal.js —
// keep the two in sync when adding metrics.
const PEER_TEAR_SHEET_METRICS = [
  { key: 'totalAssets', type: 'money', higherIsBetter: null, peerLabels: [/^total assets/i] },
  { key: 'afsTotal', type: 'money', higherIsBetter: null, peerLabels: [/^total securities\s*\(afs-fv\)/i] },
  { key: 'htmTotal', type: 'money', higherIsBetter: null, peerLabels: [/^total securities\s*\(htm-fv\)/i] },
  { key: 'securitiesToAssets', type: 'percent', higherIsBetter: null, peerLabels: [/^total securities\s*\/\s*total assets/i, /securities.*assets/i] },
  { key: 'totalLoans', type: 'money', higherIsBetter: null, peerLabels: [/^total loans.*leases/i] },
  { key: 'loansToAssets', type: 'percent', higherIsBetter: null, peerLabels: [/^total loans\s*\/\s*assets/i] },
  { key: 'totalDeposits', type: 'money', higherIsBetter: null, peerLabels: [/^total deposits/i] },
  { key: 'loansToDeposits', type: 'percent', higherIsBetter: null, peerLabels: [/loans?\s*\/\s*deposits?/i, /loans?.*deposits?/i] },
  { key: 'totalBorrowings', type: 'money', higherIsBetter: null, peerLabels: [/^total borrowings/i] },
  { key: 'realEstateLoansToLoans', higherIsBetter: null, peerLabels: [/^real estate loans\s*\/\s*loans/i] },
  { key: 'farmLoansToLoans', higherIsBetter: null, peerLabels: [/^farmland.*\/\s*loans/i] },
  { key: 'agProdLoansToLoans', higherIsBetter: null, peerLabels: [/^agricultural prod.*\/\s*loans/i] },
  { key: 'ciLoansToLoans', higherIsBetter: null, peerLabels: [/^total c\s*&\s*i loans\s*\/\s*loans/i, /^total c and i loans\s*\/\s*loans/i] },
  { key: 'totalEquityCapital', higherIsBetter: null, peerLabels: [/^total equity capital/i] },
  { key: 'tier1Capital', higherIsBetter: null, peerLabels: [/^tier 1 capital/i] },
  { key: 'tier1RiskBasedRatio', higherIsBetter: true, peerLabels: [/^tier 1.*risk/i] },
  { key: 'riskBasedCapitalRatio', higherIsBetter: true, peerLabels: [/^risk based capital ratio/i] },
  { key: 'tangibleEquityToAssets', higherIsBetter: true, peerLabels: [/^tang equity\s*\/\s*tang assets/i] },
  { key: 'leverageRatio', higherIsBetter: true, peerLabels: [/^leverage ratio/i] },
  { key: 'dividendsDeclared', higherIsBetter: null, peerLabels: [/^total dividends declared/i] },
  { key: 'dividendsToNetIncome', higherIsBetter: null, peerLabels: [/^common divis declared\s*\/\s*net inc/i] },
  { key: 'roa', higherIsBetter: true, peerLabels: [/^roa\b/i, /return on assets/i, /return on avg/i] },
  { key: 'roe', higherIsBetter: true, peerLabels: [/^roe\b/i, /return on equity/i] },
  { key: 'yieldOnEarningAssets', higherIsBetter: true, peerLabels: [/^yield on earning assets/i] },
  { key: 'yieldOnLoans', higherIsBetter: true, peerLabels: [/^yield on loans/i] },
  { key: 'yieldOnSecurities', higherIsBetter: true, peerLabels: [/yield on securities/i] },
  { key: 'netInterestMargin', higherIsBetter: true, peerLabels: [/net interest margin/i] },
  { key: 'efficiencyRatio', higherIsBetter: false, peerLabels: [/efficiency ratio/i] },
  { key: 'costOfFunds', higherIsBetter: false, peerLabels: [/^cost of funds/i] },
  { key: 'netIncome', higherIsBetter: null, peerLabels: [/^net income/i] },
  { key: 'depositsPerFte', higherIsBetter: null, peerLabels: [/^deposits\s*\/\s*fte/i] },
  { key: 'realizedGainLossSecurities', higherIsBetter: null, peerLabels: [/^realized gain\/loss on securities/i] },
  { key: 'texasRatio', higherIsBetter: false, peerLabels: [/texas ratio/i] },
  { key: 'llrToLoans', higherIsBetter: true, peerLabels: [/^loan loss reserves\s*\/\s*loans/i] },
  { key: 'nplsToLoans', higherIsBetter: false, peerLabels: [/npls?.*loans/i, /nonperforming.*loans/i] },
  { key: 'loanLossReserve', higherIsBetter: null, peerLabels: [/^loan\s*&\s*lease loss reserve/i] },
  { key: 'loanLossProvision', higherIsBetter: false, peerLabels: [/^provision for loan\s*&\s*lease losses/i] },
  { key: 'netChargeoffsToAvgLoans', higherIsBetter: false, peerLabels: [/^net chargeoffs\s*\/\s*avg loans/i] },
  { key: 'largeDepositsToDeposits', higherIsBetter: false, peerLabels: [/^total dep with bal > \$?250k\s*\/\s*deposits/i] },
  { key: 'nonInterestBearingDeposits', higherIsBetter: true, peerLabels: [/^non-int bearing dep\s*\/\s*deposits/i] },
  { key: 'brokeredDepositsToDeposits', higherIsBetter: false, peerLabels: [/^brokered deposits\s*\/\s*deposits/i] },
  { key: 'jumboTimeDeposits', higherIsBetter: false, peerLabels: [/^jumbo time dep\s*\/\s*dom deposits/i] },
  { key: 'publicFunds', higherIsBetter: null, peerLabels: [/^public funds\s*\/\s*dom deposits/i] },
  { key: 'netNonCoreFundingDependence', higherIsBetter: false, peerLabels: [/^net noncore funding dependence/i] },
  { key: 'wholesaleFundingReliance', higherIsBetter: false, peerLabels: [/wholesale funding/i] },
  { key: 'longTermAssetsToAssets', higherIsBetter: false, peerLabels: [/long.?term assets?.*assets/i] },
  { key: 'liquidAssetsToAssets', higherIsBetter: true, peerLabels: [/liquid assets?.*assets/i] },
  { key: 'avgIntBearingFundsToAssets', higherIsBetter: false, peerLabels: [/^avg int bear funds\s*\/\s*avg assets/i] },
  { key: 'intEarnAssetsToFunds', higherIsBetter: true, peerLabels: [/^int earn assets\s*\/\s*int bear funds/i] },
  { key: 'pledgedSecuritiesToSecurities', higherIsBetter: false, peerLabels: [/^pledged securities\s*\(bv\)/i, /^pledged securites\s*\/\s*securities/i, /^pledged securities\s*\/\s*securities/i] },
  { key: 'securitiesFvToBv', higherIsBetter: true, peerLabels: [/^securities\s*\(fv\)\s*\/\s*securities\s*\(bv\)/i] }
];

let peerComparisonCache = null;

function peerSeriesNumericValue(seriesRow, config = {}) {
  if (!seriesRow) return null;
  const fields = config.type === 'money'
    ? ['amount', 'value', 'percent']
    : config.type === 'percent'
      ? ['percent', 'value', 'amount']
      : ['value', 'percent', 'amount'];
  for (const field of fields) {
    const raw = seriesRow[field];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildPeerComparisonIndex() {
  const dataset = loadAveragedSeriesDataset(BANK_REPORTS_DIR);
  if (!dataset) return null;
  const peerGroup = Array.isArray(dataset.peerGroups) && dataset.peerGroups[0]
    ? dataset.peerGroups[0]
    : null;
  if (!peerGroup) return null;
  const periods = Array.isArray(dataset.periods) ? dataset.periods : [];
  const metrics = Array.isArray(dataset.metrics) ? dataset.metrics : [];
  const series = Array.isArray(dataset.series) ? dataset.series : [];
  if (!periods.length || !metrics.length || !series.length) return null;

  const cleanLabel = label => String(label || '').replace(/^\s*\d+\.\s*/, '');
  const seriesByMetricAndPeriod = new Map();
  for (const row of series) {
    seriesByMetricAndPeriod.set(`${row.metricKey}|${row.period}`, row);
  }

  // Build a { period -> { bankFieldKey -> { peerValue, peerLabel, higherIsBetter } } } table
  // so we can pick the peer period that best aligns with the bank's latest period.
  const byPeriod = new Map();
  for (const period of periods) {
    const byKey = {};
    for (const config of PEER_TEAR_SHEET_METRICS) {
      const metric = metrics.find(m => config.peerLabels.some(re => re.test(cleanLabel(m.label))));
      if (!metric) continue;
      const seriesRow = seriesByMetricAndPeriod.get(`${metric.key}|${period}`);
      const peerValue = peerSeriesNumericValue(seriesRow, config);
      if (peerValue == null) continue;
      byKey[config.key] = {
        peerValue,
        peerLabel: metric.label,
        higherIsBetter: config.higherIsBetter
      };
    }
    byPeriod.set(period, byKey);
  }

  return {
    peerGroup: {
      id: peerGroup.id,
      label: peerGroup.label,
      criteria: peerGroup.criteria || {},
      populationCount: peerGroup.populationCount,
      populationPercent: peerGroup.populationPercent,
      latestPeriod: peerGroup.latestPeriod
    },
    periods,
    byPeriod
  };
}

function getPeerComparisonIndex() {
  if (peerComparisonCache !== null) return peerComparisonCache || null;
  try {
    peerComparisonCache = buildPeerComparisonIndex() || false;
    return peerComparisonCache || null;
  } catch (err) {
    log('warn', 'Peer comparison index build failed:', err.message);
    peerComparisonCache = false;
    return null;
  }
}

function invalidatePeerComparisonCache() {
  peerComparisonCache = null;
}

// Pick a peer cohort for `bank`. Priority: explicit cohortId > best-fit
// match from user-defined cohorts > legacy FedFis AVERAGED_SERIES.
// Returns the same shape the tear sheet renderer has always consumed:
// { peerGroup, period, bankPeriod, periodAligned, byKey }.
function getPeerComparisonForBank(bank, options = {}) {
  const latest = bank && Array.isArray(bank.periods) ? bank.periods[0] : null;
  const bankPeriod = latest && latest.period ? latest.period : '';
  const cohortId = options.cohortId ? String(options.cohortId).trim() : '';

  if (cohortId) {
    const cohort = peerGroupStore.getPeerGroup(BANK_REPORTS_DIR, cohortId);
    if (cohort && !cohort.archivedAt) {
      const comparison = peerAverages.peerComparisonFromCohort(BANK_REPORTS_DIR, cohort, bankPeriod, {
        selectionReason: options.selectionReason || 'Selected by user',
        selectionBasis: peerAverages.cohortSelectionBasis(cohort, bank)
      });
      if (comparison) return decoratePeerComparison(comparison, options);
    }
  }

  const cohorts = peerGroupStore.listPeerGroups(BANK_REPORTS_DIR);
  if (cohorts.length) {
    const best = peerAverages.findBestFitCohort(BANK_REPORTS_DIR, bank, cohorts);
    if (best) {
      const comparison = peerAverages.peerComparisonFromCohort(BANK_REPORTS_DIR, best, bankPeriod, {
        selectionReason: 'Best-fit cohort',
        selectionBasis: peerAverages.cohortSelectionBasis(best, bank)
      });
      if (comparison) return decoratePeerComparison(comparison, options);
    }
  }

  // Fallback: legacy FedFis workbook averages (single cohort).
  const index = getPeerComparisonIndex();
  if (!index) return null;
  const period = index.periods.includes(bankPeriod) ? bankPeriod : (index.periods[0] || '');
  const byKey = index.byPeriod.get(period) || {};
  return decoratePeerComparison({
    peerGroup: index.peerGroup,
    period,
    bankPeriod,
    periodAligned: Boolean(bankPeriod) && period === bankPeriod,
    selectionReason: 'Legacy FedFis workbook cohort',
    selectionBasis: [],
    byKey
  }, options);
}

function decoratePeerComparison(comparison, options = {}) {
  if (!comparison) return comparison;
  const samples = Object.values(comparison.byKey || {})
    .map(row => Number(row && row.sampleSize))
    .filter(n => Number.isFinite(n) && n > 0);
  const minSampleSize = samples.length ? Math.min(...samples) : null;
  const population = Number(comparison.peerGroup && comparison.peerGroup.populationCount) || 0;
  const periodAligned = comparison.periodAligned !== false;
  let level = 'High';
  const reasons = [];
  if (population > 0) reasons.push(`${population.toLocaleString('en-US')} banks`);
  if (minSampleSize != null) reasons.push(`smallest metric n=${minSampleSize.toLocaleString('en-US')}`);
  else reasons.push('metric samples not reported');
  reasons.push(periodAligned ? 'period aligned' : 'period mismatch');
  if (/legacy/i.test(comparison.selectionReason || '')) reasons.push('legacy workbook cohort');
  if (!periodAligned || (population > 0 && population < 30) || (minSampleSize != null && minSampleSize < 30)) {
    level = 'Low';
  } else if (/legacy/i.test(comparison.selectionReason || '') || population < 100 || minSampleSize == null || minSampleSize < 100) {
    level = 'Medium';
  }
  return {
    ...comparison,
    preferredPeerGroupId: options.preferredPeerGroupId || '',
    confidence: { level, reasons, populationCount: population || null, minSampleSize }
  };
}

function getBankSummaryForCoverage(bankId) {
  const data = getBankFromDatabase(BANK_REPORTS_DIR, bankId);
  if (!data || !data.bank || !data.bank.summary) return null;
  return data.bank.summary;
}

async function handleSaveBankCoverage(req, res) {
  try {
    const body = await readJsonBody(req);
    const bankId = String(body.bankId || '').trim();
    if (!bankId) return sendJSON(res, 400, { error: 'Bank ID is required' });

    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });

    const existing = getBankCoverage(BANK_REPORTS_DIR, bankId).saved;
    const saved = upsertSavedBank(BANK_REPORTS_DIR, summary, body);
    const accountStatus = upsertBankAccountStatus(BANK_REPORTS_DIR, summary, {
      status: saved.status,
      source: 'coverage',
      owner: saved.owner
    });
    appendAuditLog({
      event: 'bank-coverage-save',
      bankId,
      status: saved.status,
      priority: saved.priority
    });
    const summaryBits = [];
    if (!existing) {
      summaryBits.push(`Saved bank · status ${saved.status} · priority ${saved.priority}`);
    } else {
      if (existing.status !== saved.status) summaryBits.push(`Status ${existing.status} → ${saved.status}`);
      if (existing.priority !== saved.priority) summaryBits.push(`Priority ${existing.priority} → ${saved.priority}`);
      if ((existing.owner || '') !== (saved.owner || '')) summaryBits.push(`Owner → ${saved.owner || '(none)'}`);
      if ((existing.nextActionDate || '') !== (saved.nextActionDate || '')) summaryBits.push(`Next action → ${saved.nextActionDate || '(cleared)'}`);
    }
    if (summaryBits.length) {
      logBankActivity(req, {
        bankId,
        certNumber: summary.certNumber,
        kind: existing ? 'coverage-update' : 'coverage-save',
        summary: summaryBits.join(' · '),
        refType: 'coverage',
        refId: bankId
      });
    }
    invalidateBankCaches();
    return sendJSON(res, 200, { saved, accountStatus });
  } catch (err) {
    log('error', 'Bank coverage save failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not save bank coverage' });
  }
}

// Manual CRM activity (Call/Email/Meeting/Task/Note logged by a rep). Mirrors
// handleAddBankNote: ensures the bank has a coverage row so the activity has a
// home, then records a typed bank_activities row. The "Logged by" display can
// be overridden in the body; the username stays the resolved rep for audit.
async function handleLogBankActivity(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
    if (!MANUAL_ACTIVITY_KINDS.includes(String(body.kind || ''))) {
      return sendJSON(res, 400, { error: 'Invalid activity type' });
    }
    upsertSavedBank(BANK_REPORTS_DIR, summary, body.coverage || {});
    const rep = resolveRequestRep(req);
    const activity = recordManualActivity(BANK_REPORTS_DIR, {
      bankId,
      certNumber: summary.certNumber,
      kind: body.kind,
      subject: body.subject,
      body: body.body,
      activityDate: body.activityDate,
      contactId: body.contactId,
      actorUsername: rep ? rep.username : '',
      actorDisplay: body.loggedBy || (rep ? rep.displayName : '')
    });
    if (!activity) return sendJSON(res, 400, { error: 'Could not log activity' });
    appendAuditLog({
      event: 'bank-activity-log',
      bankId,
      activityId: activity.id,
      kind: activity.kind
    });
    invalidateBankCaches();
    return sendJSON(res, 200, { activity });
  } catch (err) {
    log('error', 'Bank activity log failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not log activity' });
  }
}

// CRM task engine: create a future-dated follow-up task on a bank. The task
// defaults to the acting rep as assignee so "remind me Friday" is one field.
// A system activity row keeps the bank timeline aware of task creation.
async function handleCreateBankTask(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
    if (!String(body.title || '').trim()) return sendJSON(res, 400, { error: 'A task title is required' });
    const rep = resolveRequestRep(req);
    const task = createBankTask(BANK_REPORTS_DIR, {
      bankId,
      certNumber: summary.certNumber,
      title: body.title,
      body: body.body,
      dueDate: body.dueDate,
      priority: body.priority,
      assignedTo: body.assignedTo || (rep ? rep.username : ''),
      assignedDisplay: body.assignedDisplay || (body.assignedTo ? body.assignedTo : (rep ? rep.displayName : '')),
      createdBy: rep ? rep.username : '',
      createdDisplay: rep ? rep.displayName : ''
    });
    if (!task) return sendJSON(res, 400, { error: 'Could not create task' });
    logBankActivity(req, {
      bankId,
      certNumber: summary.certNumber,
      kind: 'task-create',
      summary: `Task created: ${task.title}${task.dueDate ? ` (due ${task.dueDate})` : ''}`,
      refType: 'task',
      refId: task.id
    });
    appendAuditLog({ event: 'bank-task-create', bankId, taskId: task.id, dueDate: task.dueDate || null });
    return sendJSON(res, 200, { task });
  } catch (err) {
    log('error', 'Bank task create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not create task' });
  }
}

// Patch a task (complete, reopen, reschedule, reassign, edit). Completion is
// status:'Done' — stamps completed_at/by in the store.
async function handleUpdateBankTask(req, res, taskId) {
  try {
    const body = await readJsonBody(req);
    const existing = getBankTask(BANK_REPORTS_DIR, taskId);
    if (!existing) return sendJSON(res, 404, { error: 'Task not found' });
    const rep = resolveRequestRep(req);
    const task = updateBankTask(BANK_REPORTS_DIR, taskId, {
      ...body,
      completedBy: rep ? (rep.displayName || rep.username) : ''
    });
    if (body.status === 'Done' && existing.status !== 'Done') {
      logBankActivity(req, {
        bankId: existing.bankId,
        certNumber: existing.certNumber,
        kind: 'task-complete',
        summary: `Task completed: ${existing.title}`,
        refType: 'task',
        refId: existing.id
      });
    }
    appendAuditLog({ event: 'bank-task-update', bankId: existing.bankId, taskId: existing.id, status: task.status });
    return sendJSON(res, 200, { task });
  } catch (err) {
    log('error', 'Bank task update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update task' });
  }
}

// Sales pipeline: create an opportunity on a bank. Owner defaults to the
// acting rep; the bank timeline gets a system row.
async function handleCreateBankOpportunity(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
    if (!String(body.product || '').trim()) return sendJSON(res, 400, { error: 'A product is required' });
    const rep = resolveRequestRep(req);
    const opportunity = createBankOpportunity(BANK_REPORTS_DIR, {
      bankId,
      certNumber: summary.certNumber,
      product: body.product,
      description: body.description,
      estValue: body.estValue,
      stage: body.stage,
      closeDate: body.closeDate,
      owner: body.owner || (rep ? rep.username : ''),
      ownerDisplay: body.ownerDisplay || (body.owner ? body.owner : (rep ? rep.displayName : '')),
      createdBy: rep ? rep.username : '',
      createdDisplay: rep ? rep.displayName : ''
    });
    if (!opportunity) return sendJSON(res, 400, { error: 'Could not create opportunity' });
    logBankActivity(req, {
      bankId,
      certNumber: summary.certNumber,
      kind: 'opportunity-create',
      summary: `Opportunity created: ${opportunity.product}${opportunity.estValue ? ` (~$${Math.round(opportunity.estValue).toLocaleString()})` : ''}`,
      refType: 'opportunity',
      refId: opportunity.id
    });
    appendAuditLog({ event: 'bank-opportunity-create', bankId, opportunityId: opportunity.id, product: opportunity.product });
    return sendJSON(res, 200, { opportunity });
  } catch (err) {
    log('error', 'Bank opportunity create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not create opportunity' });
  }
}

// Patch an opportunity (stage moves, value/close-date edits, reassignment).
// Won/Lost moves land on the bank timeline so the record of the outcome
// lives with the account.
async function handleUpdateBankOpportunity(req, res, oppId) {
  try {
    const body = await readJsonBody(req);
    const existing = getBankOpportunity(BANK_REPORTS_DIR, oppId);
    if (!existing) return sendJSON(res, 404, { error: 'Opportunity not found' });
    const opportunity = updateBankOpportunity(BANK_REPORTS_DIR, oppId, body || {});
    if ((body.stage === 'Won' || body.stage === 'Lost') && existing.stage !== body.stage) {
      logBankActivity(req, {
        bankId: existing.bankId,
        certNumber: existing.certNumber,
        kind: body.stage === 'Won' ? 'opportunity-won' : 'opportunity-lost',
        summary: `Opportunity ${body.stage.toLowerCase()}: ${existing.product}${existing.estValue ? ` (~$${Math.round(existing.estValue).toLocaleString()})` : ''}`,
        refType: 'opportunity',
        refId: existing.id
      });
    }
    appendAuditLog({ event: 'bank-opportunity-update', bankId: existing.bankId, opportunityId: existing.id, stage: opportunity.stage });
    return sendJSON(res, 200, { opportunity });
  } catch (err) {
    log('error', 'Bank opportunity update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update opportunity' });
  }
}

async function handleCreateBankContact(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
    const contact = createBankContact(BANK_REPORTS_DIR, summary, body || {});
    appendAuditLog({
      event: 'bank-contact-create',
      bankId,
      contactId: contact && contact.id,
      isPrimary: contact && contact.isPrimary
    });
    logBankActivity(req, {
      bankId,
      certNumber: summary.certNumber,
      kind: 'contact-add',
      summary: `Added contact ${contact.name}${contact.role ? ` (${contact.role})` : ''}${contact.isPrimary ? ' · primary' : ''}`,
      refType: 'contact',
      refId: contact && contact.id
    });
    return sendJSON(res, 200, { contact });
  } catch (err) {
    log('error', 'Bank contact create failed:', err.message);
    return sendJSON(res, err.statusCode || 400, { error: err.message || 'Could not save contact' });
  }
}

async function handleUpdateBankContact(req, res, contactId) {
  try {
    const body = await readJsonBody(req);
    const existing = getBankContact(BANK_REPORTS_DIR, contactId);
    if (!existing) return sendJSON(res, 404, { error: 'Contact not found' });
    const contact = updateBankContact(BANK_REPORTS_DIR, contactId, body || {});
    appendAuditLog({
      event: 'bank-contact-update',
      bankId: contact.bankId,
      contactId: contact.id,
      isPrimary: contact.isPrimary
    });
    logBankActivity(req, {
      bankId: contact.bankId,
      certNumber: contact.certNumber,
      kind: 'contact-update',
      summary: `Updated contact ${contact.name}${contact.role ? ` (${contact.role})` : ''}`,
      refType: 'contact',
      refId: contact.id
    });
    return sendJSON(res, 200, { contact });
  } catch (err) {
    log('error', 'Bank contact update failed:', err.message);
    return sendJSON(res, err.statusCode || 400, { error: err.message || 'Could not update contact' });
  }
}

function handleDeleteBankContact(req, res, contactId) {
  try {
    const removed = deleteBankContact(BANK_REPORTS_DIR, contactId);
    appendAuditLog({
      event: 'bank-contact-delete',
      bankId: removed && removed.bankId,
      contactId: removed && removed.id
    });
    if (removed && removed.bankId) {
      logBankActivity(req, {
        bankId: removed.bankId,
        certNumber: removed.certNumber,
        kind: 'contact-delete',
        summary: `Removed contact ${removed.name || ''}`.trim(),
        refType: 'contact',
        refId: removed.id
      });
    }
    return sendJSON(res, 200, { success: true });
  } catch (err) {
    log('error', 'Bank contact delete failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not delete contact' });
  }
}

async function handleUpsertProductFit(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
    const rep = resolveRequestRep(req);
    const fit = upsertProductFit(BANK_REPORTS_DIR, summary, {
      product: body && body.product,
      notes: body && body.notes,
      flaggedByUsername: rep ? rep.username : '',
      flaggedByDisplay: rep ? rep.displayName : ''
    });
    appendAuditLog({
      event: 'bank-product-fit-upsert',
      bankId,
      product: fit && fit.product,
      productFitId: fit && fit.id
    });
    logBankActivity(req, {
      bankId,
      certNumber: summary.certNumber,
      kind: 'product-fit',
      summary: `Flagged ${fit.product}${fit.notes ? ` · ${fit.notes}` : ''}`.slice(0, 500),
      refType: 'product-fit',
      refId: fit && fit.id
    });
    return sendJSON(res, 200, { productFit: fit });
  } catch (err) {
    log('error', 'Bank product-fit upsert failed:', err.message);
    return sendJSON(res, err.statusCode || 400, { error: err.message || 'Could not save product fit' });
  }
}

function handleDeleteProductFit(req, res, id) {
  try {
    const removed = deleteProductFit(BANK_REPORTS_DIR, id);
    if (!removed) return sendJSON(res, 404, { error: 'Product fit not found' });
    appendAuditLog({
      event: 'bank-product-fit-delete',
      bankId: removed.bankId,
      product: removed.product,
      productFitId: removed.id
    });
    logBankActivity(req, {
      bankId: removed.bankId,
      certNumber: removed.certNumber,
      kind: 'product-fit-remove',
      summary: `Removed product flag ${removed.product}`,
      refType: 'product-fit',
      refId: removed.id
    });
    return sendJSON(res, 200, { success: true });
  } catch (err) {
    log('error', 'Bank product-fit delete failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not remove product fit' });
  }
}

async function handleUpdateBilling(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const rep = resolveRequestRep(req);
    const billed = updateBillingItem(BANK_REPORTS_DIR, id, {
      state: body && body.state,
      amount: body && body.amount,
      notes: body && body.notes,
      billedBy: body && body.billedBy ? body.billedBy : (rep ? rep.displayName : '')
    });
    appendAuditLog({
      event: 'billing-update',
      billingId: billed.id,
      state: billed.state,
      bankId: billed.bankId
    });
    if (billed && billed.bankId) {
      logBankActivity(req, {
        bankId: billed.bankId,
        certNumber: billed.certNumber,
        kind: 'billing',
        summary: `Billing → ${billed.state}${billed.summary ? ` · ${billed.summary}` : ''}`.slice(0, 500),
        refType: billed.refType,
        refId: billed.refId
      });
    }
    return sendJSON(res, 200, { item: billed });
  } catch (err) {
    log('error', 'Billing update failed:', err.message);
    return sendJSON(res, err.statusCode || 400, { error: err.message || 'Could not update billing item' });
  }
}

async function handleCreateStrategyRequest(req, res) {
  try {
    const body = await readJsonBody(req);
    const bankId = String(body.bankId || '').trim();
    if (!bankId) return sendJSON(res, 400, { error: 'Bank ID is required' });

    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });

    const request = createStrategyRequest(BANK_REPORTS_DIR, summary, body);
    appendAuditLog({
      event: 'strategy-request-create',
      strategyId: request && request.id,
      bankId,
      requestType: request && request.requestType,
      status: request && request.status
    });
    logBankActivity(req, {
      bankId,
      certNumber: summary.certNumber,
      kind: 'strategy-create',
      summary: `Opened ${request.requestType}${request.summary ? ` · ${request.summary}` : ''}`.slice(0, 500),
      refType: 'strategy',
      refId: request && request.id
    });
    if (request && request.status === 'Needs Billed') {
      const queued = enqueueBilling(BANK_REPORTS_DIR, {
        refType: 'strategy',
        refId: request.id,
        bankId: request.bankId,
        certNumber: request.certNumber,
        summary: `${request.requestType}: ${request.summary || request.displayName}`.slice(0, 500)
      });
      if (queued) {
        appendAuditLog({
          event: 'billing-enqueue',
          billingId: queued.id,
          refType: queued.refType,
          refId: queued.refId,
          bankId: queued.bankId
        });
        logBankActivity(req, {
          bankId: request.bankId,
          certNumber: request.certNumber,
          kind: 'billing',
          summary: `Queued for billing · ${request.requestType}`,
          refType: 'billing',
          refId: queued.id
        });
      }
    }
    return sendJSON(res, 200, { request });
  } catch (err) {
    log('error', 'Strategy request create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not create strategy request' });
  }
}

async function handleUpdateStrategyRequest(req, res, id) {
  try {
    const body = await readJsonBody(req);
    if (body && (body.action === 'delete' || body.delete === true)) {
      return handleDeleteStrategyRequest(req, res, id);
    }
    const existing = getStrategyRequest(BANK_REPORTS_DIR, id);
    const request = updateStrategyRequest(BANK_REPORTS_DIR, id, body);
    if (!request) return sendJSON(res, 404, { error: 'Strategy request not found' });
    appendAuditLog({
      event: 'strategy-request-update',
      strategyId: request.id,
      bankId: request.bankId,
      requestType: request.requestType,
      status: request.status
    });
    const bits = [];
    if (existing) {
      if (existing.status !== request.status) bits.push(`${request.requestType}: ${existing.status} → ${request.status}`);
      if (existing.assignedTo !== request.assignedTo) bits.push(`Assigned → ${request.assignedTo || '(none)'}`);
      if (existing.priority !== request.priority) bits.push(`Priority ${existing.priority} → ${request.priority}`);
      if (existing.isArchived !== request.isArchived && request.isArchived) bits.push('Archived');
      if (existing.isArchived !== request.isArchived && !request.isArchived) bits.push('Unarchived');
    }
    if (bits.length) {
      logBankActivity(req, {
        bankId: request.bankId,
        certNumber: request.certNumber,
        kind: 'strategy-update',
        summary: bits.join(' · ').slice(0, 500),
        refType: 'strategy',
        refId: request.id
      });
    }
    // Auto-enqueue billing when a strategy enters Needs Billed for the first time.
    if (existing && existing.status !== 'Needs Billed' && request.status === 'Needs Billed') {
      const queued = enqueueBilling(BANK_REPORTS_DIR, {
        refType: 'strategy',
        refId: request.id,
        bankId: request.bankId,
        certNumber: request.certNumber,
        summary: `${request.requestType}: ${request.summary || request.displayName}`.slice(0, 500)
      });
      if (queued) {
        appendAuditLog({
          event: 'billing-enqueue',
          billingId: queued.id,
          refType: queued.refType,
          refId: queued.refId,
          bankId: queued.bankId
        });
        logBankActivity(req, {
          bankId: request.bankId,
          certNumber: request.certNumber,
          kind: 'billing',
          summary: `Queued for billing · ${request.requestType}`,
          refType: 'billing',
          refId: queued.id
        });
      }
    }
    return sendJSON(res, 200, { request });
  } catch (err) {
    log('error', 'Strategy request update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update strategy request' });
  }
}

function handleDeleteStrategyRequest(req, res, id) {
  try {
    const request = deleteStrategyRequest(BANK_REPORTS_DIR, id);
    if (!request) return sendJSON(res, 404, { error: 'Strategy request not found' });
    appendAuditLog({
      event: 'strategy-request-delete',
      strategyId: request.id,
      bankId: request.bankId,
      requestType: request.requestType,
      status: request.status
    });
    logBankActivity(req, {
      bankId: request.bankId,
      certNumber: request.certNumber,
      kind: 'strategy-delete',
      summary: `Deleted ${request.requestType} request`,
      refType: 'strategy',
      refId: request.id
    });
    return sendJSON(res, 200, { success: true, deleted: request });
  } catch (err) {
    log('error', 'Strategy request delete failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not delete strategy request' });
  }
}

async function handleUploadStrategyRequestFile(req, res, id) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files, fields } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), MAX_UPLOAD_BYTES);
    const file = files.find(row => row.fieldName === 'strategyFile') || files[0];
    if (!file) return sendJSON(res, 400, { error: 'Choose a strategy deliverable to upload' });

    const signatureError = validateStrategyFileSignature(file);
    if (signatureError) return sendJSON(res, 400, { error: signatureError });

    const request = addStrategyRequestFile(BANK_REPORTS_DIR, id, {
      filename: sanitizeFilename(file.filename),
      data: file.data
    }, { label: fields.label });
    if (!request) return sendJSON(res, 404, { error: 'Strategy request not found' });

    appendAuditLog({
      event: 'strategy-request-file-upload',
      strategyId: request.id,
      bankId: request.bankId,
      filename: sanitizeFilename(file.filename)
    });
    return sendJSON(res, 200, { request });
  } catch (err) {
    log('error', 'Strategy file upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not upload strategy file' });
  }
}

// ---------- Swap proposals (Bond Swap tab under Strategies) ----------

function listSwapEligibleBanks() {
  const manifest = loadBondAccountingManifest(BANK_REPORTS_DIR);
  if (!manifest || !Array.isArray(manifest.matches)) return [];
  // One batched summary lookup for all matched banks, instead of one SQLite
  // query + full detail_json parse per bank (the old N+1).
  const matchIds = manifest.matches
    .filter(row => row && row.bankId)
    .map(row => String(row.bankId));
  const summaries = getBankSummariesByIds(BANK_REPORTS_DIR, matchIds);
  const seen = new Map();
  for (const row of manifest.matches) {
    if (!row || !row.bankId) continue;
    const id = String(row.bankId);
    if (seen.has(id)) continue;
    const summary = summaries.get(id);
    if (!summary) continue;
    seen.set(id, {
      id,
      name: summary.displayName || summary.name || 'Bank',
      city: summary.city || '',
      state: summary.state || '',
      certNumber: summary.certNumber || '',
      reportDate: row.reportDate || '',
      isSubchapterS: summary.subchapterS === 'Yes',
      accountStatus: summary.accountStatus ? summary.accountStatus.status : ''
    });
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getSwapBankContext(bankId) {
  const data = getBankById(bankId);
  if (!data || !data.bank) return null;
  const bank = data.bank;
  const summary = bank.summary || {};
  const parsedHoldings = loadHoldingsForBank(bank);
  const inventory = currentInventorySnapshot(summary.state);
  return { bank, summary, parsedHoldings, inventory };
}

// ---- Cross-bank maturity / call calendar (proactive sales call list) ----
// Rolls every imported bond-accounting portfolio into a forward calendar of
// lots maturing — or first callable — within a window, joined to coverage
// owner/status, so a rep can see which covered banks have reinvestment money
// coming free. Pure aggregation over already-parsed portfolios (loadParsedPortfolio
// is cached), so no new ingestion, cache, or invalidation hook is needed.
function maturityCalendarBucketLabel(daysOut) {
  if (daysOut <= 30) return '0-30';
  if (daysOut <= 60) return '31-60';
  if (daysOut <= 90) return '61-90';
  if (daysOut <= 180) return '91-180';
  return '181+';
}

// Split a lot list into certain maturities vs potential (issuer-optional) calls,
// so par coming free isn't conflated. Maturities are money that WILL free up on
// the date; calls only free up IF the issuer exercises — never sum them together.
function maturityCalendarSplitTotals(lots) {
  const t = {
    lotCount: 0, par: 0, marketValue: 0,
    maturityLots: 0, maturityPar: 0, maturityMarketValue: 0,
    callLots: 0, callPar: 0, callMarketValue: 0
  };
  for (const l of lots) {
    const par = l.par || 0;
    const mv = l.marketValue || 0;
    t.lotCount += 1;
    t.par += par;
    t.marketValue += mv;
    if (l.eventType === 'Call') {
      t.callLots += 1;
      t.callPar += par;
      t.callMarketValue += mv;
    } else {
      t.maturityLots += 1;
      t.maturityPar += par;
      t.maturityMarketValue += mv;
    }
  }
  return t;
}

// ---------- Maturity-calendar call economics ----------
//
// An issuer calls when it can refinance the remaining term cheaper than the
// coupon it is paying. For each in-window call we compare the lot's COUPON to
// the current market yield for that product at the bond's remaining term:
//   - first basis: today's package offerings in the same asset class with a
//     maturity within ±2.5y of the held bond's (median yield, needs ≥3 quotes)
//   - fallback (taxable sectors only): the cached official Treasury par curve
//     interpolated at the remaining term. Tax-exempt munis never fall back to
//     a Treasury yardstick — the tax-exempt scale would mislabel nearly every
//     muni call as in-the-money — so with no muni quotes the lot gets no
//     verdict rather than a wrong one.
// Verdict: coupon ≥ market +25bp → 'likely' (savings clear typical refunding
// costs); within ±25bp → 'borderline'; below → 'unlikely'. Advisory chips
// only — the certain/potential par split never moves off this.

const CALL_LIKELY_THRESHOLD_BP = 25;

function callCompareClassFor(sector) {
  const s = String(sector || '').toLowerCase();
  if (/mbs|cmo|cmbs|sba|abs|pass/.test(s)) return null; // amortizing: prepay model, not a discrete call
  if (/muni/.test(s)) return { type: 'muni', taxExempt: !/taxable/.test(s) };
  if (/agency|agcy/.test(s)) return { type: 'agency', taxExempt: false };
  if (/treasur/.test(s)) return { type: 'treasury', taxExempt: false };
  if (/corp/.test(s)) return { type: 'corporate', taxExempt: false };
  if (/\bcds?\b|certificate/.test(s)) return { type: 'cd', taxExempt: false };
  return null;
}

function treasuryYieldAtYears(curve, years) {
  if (!curve || !curve.tenors || !Number.isFinite(years)) return null;
  const TENOR_YEARS = { '1M': 1 / 12, '2M': 2 / 12, '3M': 0.25, '4M': 4 / 12, '6M': 0.5, '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10, '20Y': 20, '30Y': 30 };
  const points = Object.entries(TENOR_YEARS)
    .filter(([label]) => curve.tenors[label] != null)
    .map(([label, yrs]) => ({ yrs, yield: curve.tenors[label] }))
    .sort((a, b) => a.yrs - b.yrs);
  if (!points.length) return null;
  if (years <= points[0].yrs) return points[0].yield;
  if (years >= points[points.length - 1].yrs) return points[points.length - 1].yield;
  for (let i = 1; i < points.length; i++) {
    if (years <= points[i].yrs) {
      const a = points[i - 1], b = points[i];
      const w = (years - a.yrs) / (b.yrs - a.yrs);
      return a.yield + w * (b.yield - a.yield);
    }
  }
  return null;
}

// Per-asset-class {yrs, yield} quote lists from today's package, built once
// per calendar request.
function buildCallYardsticks(todayMs) {
  const byType = new Map();
  for (const row of buildAllOfferingsRows()) {
    const y = Number(row.yield);
    const matMs = row.maturity ? Date.parse(String(row.maturity).slice(0, 10)) : NaN;
    if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(matMs) || matMs <= todayMs) continue;
    const yrs = (matMs - todayMs) / (365.25 * 86400000);
    if (!byType.has(row.type)) byType.set(row.type, []);
    byType.get(row.type).push({ yrs, yield: y });
  }
  return byType;
}

function medianOf(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function assessCallEconomics(pos, remainingYears, yardsticks, curve) {
  const coupon = Number(pos.coupon);
  if (!Number.isFinite(coupon) || coupon <= 0 || !Number.isFinite(remainingYears) || remainingYears <= 0) return null;
  const cls = callCompareClassFor(pos.sector);
  if (!cls) return null;

  let marketYield = null;
  let basis = null;
  const quotes = yardsticks.get(cls.type) || [];
  const near = quotes.filter(q => Math.abs(q.yrs - remainingYears) <= 2.5).map(q => q.yield);
  if (near.length >= 3) {
    marketYield = medianOf(near);
    basis = 'sector-offerings';
  } else if (!cls.taxExempt) {
    marketYield = treasuryYieldAtYears(curve, remainingYears);
    basis = 'treasury-curve';
  }
  if (marketYield == null) return null;

  const spreadBp = Math.round((coupon - marketYield) * 100);
  const likelihood = spreadBp >= CALL_LIKELY_THRESHOLD_BP ? 'likely'
    : spreadBp <= -CALL_LIKELY_THRESHOLD_BP ? 'unlikely'
    : 'borderline';
  return { likelihood, marketYield: Number(marketYield.toFixed(2)), spreadBp, basis };
}

function buildMaturityCalendar(query, curve) {
  const windowDays = Math.max(1, Math.min(3650, Math.round(Number(query.get('window')) || 90)));
  const ownerFilter = String(query.get('owner') || '').trim().toLowerCase();
  const stateFilter = String(query.get('state') || '').trim().toUpperCase();
  const sectorFilter = String(query.get('sector') || '').trim().toLowerCase();
  const generatedAt = new Date().toISOString();

  const manifest = loadBondAccountingManifest(BANK_REPORTS_DIR);
  if (!manifest || !Array.isArray(manifest.matches) || !manifest.matches.length) {
    return {
      available: false, generatedAt, windowDays, owners: [], banks: [],
      totals: {
        bankCount: 0, lotCount: 0, par: 0, marketValue: 0,
        maturityLots: 0, maturityPar: 0, maturityMarketValue: 0,
        callLots: 0, callPar: 0, callMarketValue: 0
      },
      notice: 'No bond-accounting portfolios have been imported yet.'
    };
  }

  const matchIds = manifest.matches.filter(r => r && r.bankId).map(r => String(r.bankId));
  const summaries = getBankSummariesByIds(BANK_REPORTS_DIR, matchIds);

  // Midnight-UTC today, so "days out" is stable regardless of request time of day.
  const todayMs = Math.floor(Date.now() / 86400000) * 86400000;
  const horizonMs = todayMs + windowDays * 86400000;
  const callYardsticks = buildCallYardsticks(todayMs);

  const seenBank = new Set();
  const owners = new Set();
  const banks = [];

  for (const row of manifest.matches) {
    if (!row || !row.bankId || !row.storedPath) continue;
    const bankId = String(row.bankId);
    if (seenBank.has(bankId)) continue; // keep one portfolio per bank (manifest order = latest first)
    const filePath = resolveBondAccountingStoredFile(BANK_REPORTS_DIR, row.storedPath);
    if (!filePath) continue;
    let parsed;
    try { parsed = loadParsedPortfolio(filePath); } catch (err) { log('warn', `Maturity calendar: skipping ${bankId} (${err.message})`); continue; }
    if (!parsed) continue;
    seenBank.add(bankId);

    const summary = summaries.get(bankId) || {};
    const owner = (summary.accountStatus && summary.accountStatus.owner) || '';
    const status = (summary.accountStatus && summary.accountStatus.status) || '';
    const state = String(summary.state || '').toUpperCase();
    if (owner) owners.add(owner);
    if (stateFilter && state !== stateFilter) continue;
    if (ownerFilter && owner.toLowerCase() !== ownerFilter) continue;

    const lots = [];
    for (const pos of flattenPortfolioHoldings(parsed)) {
      if (sectorFilter && String(pos.sector || '').toLowerCase() !== sectorFilter) continue;
      // A maturity or first call landing within the forward window. Both must be
      // in [today, horizon] — a bond already past its first call date is
      // continuously callable (not a discrete upcoming event), so it's only a
      // "coming free" signal when a future call/maturity actually lands in-window.
      //
      // Bucket rule (drives the certain/potential split): if the MATURITY is
      // in-window, the par is CERTAIN to free up in-window — anchor on the
      // maturity even when an earlier in-window call exists (the call only means
      // it MIGHT come back sooner; surface that as a hint, never reclassify the
      // par as potential). Only when the maturity is out-of-window (or absent) and
      // just the call lands in-window is the lot potential (issuer-optional).
      const matMs = pos.maturity ? Date.parse(pos.maturity) : NaN;
      const callMs = pos.nextCall ? Date.parse(pos.nextCall) : NaN;
      const matInWindow = Number.isFinite(matMs) && matMs >= todayMs && matMs <= horizonMs;
      const callInWindow = Number.isFinite(callMs) && callMs >= todayMs && callMs <= horizonMs;
      if (!matInWindow && !callInWindow) continue;

      let eventType, eventMs, eventDate, callableDate = null, callableDaysOut = null;
      if (matInWindow) {
        eventType = 'Maturity'; eventMs = matMs; eventDate = pos.maturity;
        if (callInWindow && callMs < matMs) {
          callableDate = pos.nextCall;
          callableDaysOut = Math.round((callMs - todayMs) / 86400000);
        }
      } else {
        eventType = 'Call'; eventMs = callMs; eventDate = pos.nextCall;
      }
      const daysOut = Math.round((eventMs - todayMs) / 86400000);
      // Call economics for any lot with an in-window call (the potential
      // bucket, plus certain maturities flagged callable-sooner). Remaining
      // term = today → maturity (the term the issuer would refinance).
      let call = null;
      if (eventType === 'Call' || callableDate) {
        const remainingYears = Number.isFinite(matMs) ? (matMs - todayMs) / (365.25 * 86400000) : null;
        call = remainingYears != null ? assessCallEconomics(pos, remainingYears, callYardsticks, curve) : null;
      }
      lots.push({
        cusip: pos.cusip, description: pos.description, sector: pos.sector,
        coupon: pos.coupon, par: pos.par || 0, marketValue: pos.marketValue || 0,
        bookYield: pos.bookYield, eventType, eventDate,
        daysOut, bucket: maturityCalendarBucketLabel(daysOut),
        callableDate, callableDaysOut, call
      });
    }
    if (!lots.length) continue;
    lots.sort((a, b) => a.daysOut - b.daysOut);
    const split = maturityCalendarSplitTotals(lots);
    banks.push({
      bankId,
      name: summary.displayName || summary.name || 'Bank',
      city: summary.city || '',
      state, owner, status,
      reportDate: parsed.asOfDate || row.reportDate || '',
      lotCount: split.lotCount,
      par: split.par,
      marketValue: split.marketValue,
      maturityLots: split.maturityLots,
      maturityPar: split.maturityPar,
      maturityMarketValue: split.maturityMarketValue,
      callLots: split.callLots,
      callPar: split.callPar,
      callMarketValue: split.callMarketValue,
      lots
    });
  }

  // Rank by certain maturities first, then potential calls — the actionable
  // (money-for-sure) banks float to the top.
  banks.sort((a, b) => (b.maturityPar - a.maturityPar) || (b.callPar - a.callPar));
  const grand = banks.reduce((acc, b) => {
    acc.par += b.par; acc.marketValue += b.marketValue; acc.lotCount += b.lotCount;
    acc.maturityLots += b.maturityLots; acc.maturityPar += b.maturityPar; acc.maturityMarketValue += b.maturityMarketValue;
    acc.callLots += b.callLots; acc.callPar += b.callPar; acc.callMarketValue += b.callMarketValue;
    return acc;
  }, {
    bankCount: banks.length, lotCount: 0, par: 0, marketValue: 0,
    maturityLots: 0, maturityPar: 0, maturityMarketValue: 0,
    callLots: 0, callPar: 0, callMarketValue: 0
  });
  return {
    available: true, generatedAt, windowDays,
    importedAt: manifest.importedAt || '',
    owners: Array.from(owners).sort(),
    banks,
    totals: grand
  };
}

// ---------- Brokered-CD rollover wall ----------
// Which issuing banks have brokered CDs maturing in the forward window —
// i.e. who has funding rolling off and may need to re-raise (the call cue
// for the brokered-CD desk). Built entirely from data already on the box:
//  - data/cd-internal: the desk's new-issue MASTER lists (carry FDIC cert)
//  - data/cd-history: every daily FBBS offered-CD snapshot back to 2024
//    (no cert — issuers join to coverage by normalized name)
// CUSIPs are deduped across sources with cd-internal winning (it has the
// cert). No par/size rides on either source, so the wall is count-based.

let cdRolloverUniverseCache = null;
function invalidateCdRolloverUniverse() { cdRolloverUniverseCache = null; }

function buildCdRolloverUniverse() {
  if (cdRolloverUniverseCache) return cdRolloverUniverseCache;
  const byCusip = new Map();
  const put = (row, source) => {
    const cusip = String(row.cusip || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{9}$/.test(cusip)) return;
    if (!row.maturity || !/^\d{4}-\d{2}-\d{2}$/.test(row.maturity)) return;
    const existing = byCusip.get(cusip);
    if (existing && existing.source === 'cd-internal' && source !== 'cd-internal') return;
    byCusip.set(cusip, {
      cusip,
      name: String(row.name || '').trim(),
      cert: String(row.fdicNumber || '').trim(),
      maturity: row.maturity,
      rate: row.rate != null && Number.isFinite(Number(row.rate)) ? Number(row.rate) : null,
      term: String(row.term || '').trim(),
      settle: row.settle || '',
      state: String(row.domiciled || row.issuerState || '').trim().toUpperCase(),
      source
    });
  };
  try {
    for (const snapshot of loadCdHistory(CD_HISTORY_DIR)) {
      for (const row of snapshot.offerings || []) put(row, 'cd-history');
    }
  } catch (err) {
    log('warn', 'CD rollover: cd-history scan failed:', err.message);
  }
  try {
    for (const row of (loadCdInternalInventory(CD_INTERNAL_DIR).offerings || [])) put(row, 'cd-internal');
  } catch (err) {
    log('warn', 'CD rollover: cd-internal scan failed:', err.message);
  }
  cdRolloverUniverseCache = Array.from(byCusip.values());
  return cdRolloverUniverseCache;
}

function buildCdRolloverWall(query) {
  const windowDays = Math.max(1, Math.min(365, Math.round(Number(query.get('window')) || 90)));
  const ownerFilter = String(query.get('owner') || '').trim().toLowerCase();
  const coveredOnly = String(query.get('covered') || '') === '1';
  const generatedAt = new Date().toISOString();
  const universe = buildCdRolloverUniverse();
  if (!universe.length) {
    return {
      available: false, generatedAt, windowDays, owners: [], issuers: [],
      totals: { issuerCount: 0, cdCount: 0, coveredCount: 0 },
      notice: 'No CD history or internal CD masters have been ingested yet.'
    };
  }

  // Coverage joins: FDIC cert first (exact), then normalized name.
  const mapData = getMapBankData();
  const byCert = new Map();
  const byName = new Map();
  for (const b of (mapData && mapData.banks) || []) {
    const cert = String(b.certNumber || '').trim();
    if (cert && !byCert.has(cert)) byCert.set(cert, b);
    const key = normalizeBankNameForMatch(b.displayName || b.legalName || '');
    if (key && !byName.has(key)) byName.set(key, b);
  }

  const todayMs = Math.floor(Date.now() / 86400000) * 86400000;
  const horizonMs = todayMs + windowDays * 86400000;
  const owners = new Set();
  const issuerMap = new Map();
  let cdCount = 0;

  for (const cd of universe) {
    const matMs = Date.parse(cd.maturity);
    if (!Number.isFinite(matMs) || matMs < todayMs || matMs > horizonMs) continue;
    const bank = (cd.cert && byCert.get(cd.cert)) || byName.get(normalizeBankNameForMatch(cd.name)) || null;
    const owner = bank && bank.accountStatus ? String(bank.accountStatus.owner || '') : '';
    if (owner) owners.add(owner);
    if (ownerFilter && owner.toLowerCase() !== ownerFilter) continue;
    if (coveredOnly && !(bank && bank.accountStatusLabel && bank.accountStatusLabel !== 'Open')) continue;
    const issuerKey = cd.cert || `name:${normalizeBankNameForMatch(cd.name)}`;
    const daysOut = Math.round((matMs - todayMs) / 86400000);
    const entry = issuerMap.get(issuerKey) || {
      name: cd.name,
      cert: cd.cert,
      state: cd.state,
      bankId: bank ? bank.id : null,
      bankName: bank ? (bank.displayName || bank.legalName || '') : '',
      status: bank ? (bank.accountStatusLabel || 'Open') : '',
      owner,
      cds: []
    };
    entry.cds.push({
      cusip: cd.cusip, maturity: cd.maturity, daysOut,
      rate: cd.rate, term: cd.term, settle: cd.settle, source: cd.source
    });
    issuerMap.set(issuerKey, entry);
    cdCount += 1;
  }

  const issuers = Array.from(issuerMap.values()).map(entry => {
    entry.cds.sort((a, b) => a.daysOut - b.daysOut);
    return {
      ...entry,
      cdCount: entry.cds.length,
      nearestDays: entry.cds[0].daysOut,
      nearestMaturity: entry.cds[0].maturity,
      avgRate: (() => {
        const rates = entry.cds.map(c => c.rate).filter(r => r != null);
        return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      })()
    };
  }).sort((a, b) => {
    // Covered banks first (they're callable accounts), then nearest wall.
    const aCovered = a.bankId && a.status && a.status !== 'Open' ? 0 : 1;
    const bCovered = b.bankId && b.status && b.status !== 'Open' ? 0 : 1;
    return (aCovered - bCovered) || (a.nearestDays - b.nearestDays) || (b.cdCount - a.cdCount);
  });

  return {
    available: true,
    generatedAt,
    windowDays,
    universeSize: universe.length,
    owners: Array.from(owners).sort(),
    issuers,
    totals: {
      issuerCount: issuers.length,
      cdCount,
      coveredCount: issuers.filter(i => i.bankId && i.status && i.status !== 'Open').length
    },
    notice: ''
  };
}

// Strict numeric coercion for the portfolio review path.
// Unlike numericValue() above, this returns null for null/''/undefined
// instead of coercing them to 0. The sector parser leaves yield/duration
// columns as null when the source sheet lacks them (Treasuries, Exempt Munis),
// and numericValue's 0-default would make those rows look like 0% bonds —
// which then poison weighted averages and the Low-Book-Yield screen.
function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flattenPortfolioHoldings(parsedHoldings) {
  const positions = [];
  for (const [sector, rows] of Object.entries(parsedHoldings && parsedHoldings.sectors || {})) {
    for (const row of rows || []) {
      const bookYield = nullableNumber(row.bookYieldYtm ?? row.bookYieldYtw);
      const marketYield = nullableNumber(row.marketYieldYtw ?? row.marketYieldYtm);
      const bookValue = nullableNumber(row.bookValue);
      const marketValue = nullableNumber(row.marketValue);
      const rawGainLoss = nullableNumber(row.gainLoss);
      const derivedGainLoss = rawGainLoss != null
        ? rawGainLoss
        : (bookValue != null && marketValue != null ? marketValue - bookValue : null);
      positions.push({
        sector,
        cusip: row.cusip || '',
        description: row.description || '',
        coupon: nullableNumber(row.coupon),
        maturity: row.maturity || '',
        nextCall: row.nextCall || row.callDate || '',
        classification: row.classification || '',
        par: nullableNumber(row.par) || 0,
        bookValue,
        marketValue,
        gainLoss: derivedGainLoss,
        gainLossPct: bookValue && derivedGainLoss != null ? (derivedGainLoss / bookValue) * 100 : null,
        bookPrice: nullableNumber(row.bookPrice),
        marketPrice: nullableNumber(row.marketPrice),
        bookYield,
        marketYield,
        yieldGap: bookYield != null && marketYield != null ? marketYield - bookYield : null,
        averageLife: nullableNumber(row.averageLife),
        effectiveDuration: nullableNumber(row.effectiveDuration),
        oasBp: nullableNumber(row.oasBp ?? row.spreadBp),
        callable: Boolean(row.nextCall || row.callDate)
      });
    }
  }
  return positions;
}

function weightedAverage(rows, valueKey, weightKey = 'marketValue') {
  let weighted = 0;
  let weights = 0;
  for (const row of rows || []) {
    const value = nullableNumber(row[valueKey]);
    const weight = nullableNumber(row[weightKey]);
    if (value == null || weight == null || weight <= 0) continue;
    weighted += value * weight;
    weights += weight;
  }
  return weights > 0 ? weighted / weights : null;
}

function topPortfolioRows(rows, predicate, scoreFn, limit = 8) {
  return (rows || [])
    .filter(predicate)
    .map(row => ({ row, score: scoreFn(row) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.row);
}

function buildPortfolioSectorRows(positions, totalMarketValue) {
  const sectors = new Map();
  for (const row of positions || []) {
    const key = row.sector || 'Other';
    const current = sectors.get(key) || { sector: key, count: 0, par: 0, bookValue: 0, marketValue: 0, gainLoss: 0, rows: [] };
    current.count += 1;
    current.par += numericValue(row.par) || 0;
    current.bookValue += numericValue(row.bookValue) || 0;
    current.marketValue += numericValue(row.marketValue) || 0;
    current.gainLoss += numericValue(row.gainLoss) || 0;
    current.rows.push(row);
    sectors.set(key, current);
  }
  return Array.from(sectors.values()).map(row => ({
    sector: row.sector,
    count: row.count,
    par: Math.round(row.par),
    bookValue: Math.round(row.bookValue),
    marketValue: Math.round(row.marketValue),
    gainLoss: Math.round(row.gainLoss),
    marketShare: totalMarketValue ? row.marketValue / totalMarketValue * 100 : null,
    bookYield: weightedAverage(row.rows, 'bookYield'),
    marketYield: weightedAverage(row.rows, 'marketYield'),
    averageLife: weightedAverage(row.rows, 'averageLife'),
    effectiveDuration: weightedAverage(row.rows, 'effectiveDuration')
  })).sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
}

function buildPortfolioLadder(positions, anchorDate) {
  const currentYear = new Date().getUTCFullYear();
  const anchorYear = maturityYear(anchorDate) || currentYear;
  const buckets = new Map();
  for (const row of positions || []) {
    const year = maturityYear(row.maturity);
    if (!year || year < anchorYear) continue;
    const existing = buckets.get(year) || { year, par: 0, marketValue: 0, count: 0 };
    existing.par += numericValue(row.par) || 0;
    existing.marketValue += numericValue(row.marketValue) || 0;
    existing.count += 1;
    buckets.set(year, existing);
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.year - b.year)
    .slice(0, 16)
    .map(row => ({ ...row, par: Math.round(row.par), marketValue: Math.round(row.marketValue) }));
}

function buildPortfolioReviewFlags(positions, sectors, summary, profile) {
  const flags = [];
  const totalMarketValue = summary.marketValue || 0;
  const lossTotal = positions.reduce((acc, row) => acc + Math.min(numericValue(row.gainLoss) || 0, 0), 0);
  const lossCount = positions.filter(row => (numericValue(row.gainLoss) || 0) < 0).length;
  if (lossCount) {
    flags.push({
      type: 'Unrealized loss',
      severity: Math.abs(lossTotal) >= totalMarketValue * 0.05 ? 'High' : 'Medium',
      text: `${lossCount} position${lossCount === 1 ? '' : 's'} carry an unrealized loss; review tax-loss or income-pickup swaps before adding new exposure.`
    });
  }
  if (summary.bookYield != null && summary.marketYield != null && summary.marketYield - summary.bookYield >= 0.75) {
    flags.push({
      type: 'Yield reset',
      severity: 'High',
      text: `Market yield is ${(summary.marketYield - summary.bookYield).toFixed(2)} points above book yield on the parsed portfolio.`
    });
  }
  for (const sector of sectors.slice(0, 4)) {
    if (sector.marketShare != null && sector.marketShare >= 30) {
      flags.push({
        type: 'Concentration',
        severity: sector.marketShare >= 45 ? 'High' : 'Medium',
        text: `${sector.sector} is ${sector.marketShare.toFixed(1)}% of market value; confirm policy limits and cash-flow intent.`
      });
    }
  }
  const callableCount = positions.filter(row => row.callable).length;
  if (positions.length && callableCount / positions.length >= 0.35) {
    flags.push({
      type: 'Optionality',
      severity: 'Medium',
      text: `${callableCount} callable position${callableCount === 1 ? '' : 's'} on file; review extension/call risk before recommending more callables.`
    });
  }
  const longDuration = positions.filter(row => (numericValue(row.effectiveDuration) || 0) >= 5).length;
  if (longDuration) {
    flags.push({
      type: 'Rate risk',
      severity: longDuration >= 8 ? 'High' : 'Medium',
      text: `${longDuration} position${longDuration === 1 ? '' : 's'} show duration of 5+; run rate-shock discussion if liquidity is tight.`
    });
  }
  if (profile && Array.isArray(profile.gapYears) && profile.gapYears.length) {
    flags.push({
      type: 'Ladder gap',
      severity: 'Low',
      text: `Potential cash-flow gaps around ${profile.gapYears.slice(0, 4).map(g => g.year).join(', ')} based on current maturity ladder.`
    });
  }
  if (!flags.length) {
    flags.push({
      type: 'No standout',
      severity: 'Low',
      text: 'No single portfolio pressure point dominates the parsed holdings; use the workbench to screen by sector, yield, and loss.'
    });
  }
  return flags.slice(0, 8);
}

function findScenarioByShock(analytics, shock) {
  const rows = analytics && Array.isArray(analytics.scenarioSummary) ? analytics.scenarioSummary : [];
  return rows.find(row => Number(row.shock) === shock) || null;
}

function findInvestmentsKrd(analytics) {
  const rows = analytics && Array.isArray(analytics.keyRateDuration) ? analytics.keyRateDuration : [];
  return rows.find(row => /^investments$/i.test(row.label || '')) || rows[0] || null;
}

function findPeerAllocationOutliers(analytics, limit = 3) {
  const rows = analytics && Array.isArray(analytics.peerReview) ? analytics.peerReview : [];
  return rows
    .map(row => {
      const allocation = nullableNumber(row.allocationPct);
      const peer = nullableNumber(row.peerAllocationPct);
      return {
        sector: row.sector || '',
        allocationPct: allocation,
        peerAllocationPct: peer,
        gapPct: allocation != null && peer != null ? allocation - peer : null
      };
    })
    .filter(row => row.gapPct != null)
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, limit);
}

function addPortfolioAction(actions, action) {
  if (!action || !action.id || actions.some(existing => existing.id === action.id)) return;
  actions.push(action);
}

function buildPortfolioDecisionLayer({ positions, sectors, summary, analytics, swapIdeas, bankName, reportDate }) {
  const base = findScenarioByShock(analytics, 0);
  const up300 = findScenarioByShock(analytics, 300);
  const down300 = findScenarioByShock(analytics, -300);
  const investmentsKrd = findInvestmentsKrd(analytics);
  const peerOutliers = findPeerAllocationOutliers(analytics);
  const topSector = sectors && sectors[0] ? sectors[0] : null;
  const actions = [];
  const priorities = [];
  const commentary = [];

  const lossPct = nullableNumber(summary.gainLossPct);
  if (summary.gainLoss < 0) {
    priorities.push({
      tone: lossPct != null && lossPct <= -5 ? 'High' : 'Medium',
      title: 'Unrealized loss review',
      detail: `${Math.abs(lossPct || 0).toFixed(2)}% book-value loss creates a swap/tax-loss review opportunity before adding new exposure.`
    });
  }
  if (summary.marketYield != null && summary.bookYield != null && summary.marketYield - summary.bookYield >= 0.75) {
    priorities.push({
      tone: 'High',
      title: 'Yield reset opportunity',
      detail: `Market yield is ${(summary.marketYield - summary.bookYield).toFixed(2)} points above book yield; screen low-book-yield holdings first.`
    });
  }
  if (up300 && nullableNumber(up300.priceChangePct) != null && up300.priceChangePct <= -8) {
    priorities.push({
      tone: up300.priceChangePct <= -12 ? 'High' : 'Medium',
      title: 'Rate-shock exposure',
      detail: `THC scenario shows ${up300.priceChangePct.toFixed(2)}% price change in a +300 bp shock.`
    });
  }
  if (investmentsKrd && investmentsKrd.values && nullableNumber(investmentsKrd.values['Eff. Dur']) >= 4.5) {
    priorities.push({
      tone: nullableNumber(investmentsKrd.values['Eff. Dur']) >= 6 ? 'High' : 'Medium',
      title: 'Duration concentration',
      detail: `THC key-rate duration shows ${Number(investmentsKrd.values['Eff. Dur']).toFixed(2)} effective duration on investments.`
    });
  }
  if (topSector && topSector.marketShare >= 35) {
    priorities.push({
      tone: topSector.marketShare >= 50 ? 'High' : 'Medium',
      title: `${topSector.sector} concentration`,
      detail: `${topSector.sector} is ${topSector.marketShare.toFixed(1)}% of portfolio market value.`
    });
  }

  const firstSwap = Array.isArray(swapIdeas) ? swapIdeas[0] : null;
  if (firstSwap) {
    addPortfolioAction(actions, {
      id: 'bond-swap',
      type: 'strategy',
      label: 'Create Bond Swap Request',
      requestType: 'Bond Swap',
      priority: '2',
      summary: `Portfolio swap review: ${firstSwap.held && firstSwap.held.cusip || 'candidate holding'}`,
      comments: [
        `Portfolio review for ${bankName || 'selected bank'}${reportDate ? ` (${reportDate})` : ''}.`,
        `Candidate: sell ${firstSwap.held && firstSwap.held.cusip || 'current holding'} and review replacement ${firstSwap.offering && firstSwap.offering.label || 'from current inventory'}.`,
        firstSwap.economics && firstSwap.economics.annualIncomePickup != null ? `Estimated annual income pickup: ${Math.round(firstSwap.economics.annualIncomePickup).toLocaleString('en-US')}.` : '',
        firstSwap.economics && firstSwap.economics.breakevenMonths != null ? `Breakeven: ${firstSwap.economics.breakevenMonths} months.` : '',
        'Desk review required before client language.'
      ].filter(Boolean).join('\n'),
      product: 'Bond Swap'
    });
  } else if (summary.gainLoss < 0 || (summary.marketYield != null && summary.bookYield != null && summary.marketYield - summary.bookYield >= 0.75)) {
    addPortfolioAction(actions, {
      id: 'bond-swap-screen',
      type: 'strategy',
      label: 'Create Swap Screen Request',
      requestType: 'Bond Swap',
      priority: '3',
      summary: 'Portfolio swap screen from THC review',
      comments: 'Run a desk-reviewed bond swap screen using the latest matched THC portfolio workbook and current inventory.',
      product: 'Bond Swap'
    });
  }

  if (up300 && nullableNumber(up300.priceChangePct) != null && up300.priceChangePct <= -8) {
    addPortfolioAction(actions, {
      id: 'alm-irr',
      type: 'strategy',
      label: 'Create ALM / IRR Request',
      requestType: 'THO Report',
      priority: up300.priceChangePct <= -12 ? '2' : '3',
      summary: 'ALM / IRR review from THC scenario exposure',
      comments: `THC scenario analytics show ${up300.priceChangePct.toFixed(2)}% price change in +300 bp shock. Review EVE/EaR sensitivity and assumptions.`,
      product: 'ALM / IRR'
    });
  }

  const muniSector = (sectors || []).find(row => /muni/i.test(row.sector || ''));
  if (muniSector && muniSector.marketShare >= 20) {
    addPortfolioAction(actions, {
      id: 'muni-bcis',
      type: 'strategy',
      label: 'Create Muni BCIS Request',
      requestType: 'Muni BCIS',
      priority: muniSector.marketShare >= 35 ? '2' : '3',
      summary: 'Muni BCIS review from portfolio mix',
      comments: `${muniSector.sector} represents ${muniSector.marketShare.toFixed(1)}% of market value. Review credit surveillance, BQ/TEY, and replacement needs.`,
      product: 'Muni Credit / BCIS'
    });
  }

  addPortfolioAction(actions, {
    id: 'portfolio-accounting',
    type: 'product-fit',
    label: 'Flag Portfolio Accounting Fit',
    product: 'Portfolio Accounting',
    summary: 'Matched THC portfolio workbook available',
    comments: `Portfolio accounting fit flagged from the ${reportDate || 'latest'} matched workbook.`
  });

  if (summary.positions) {
    commentary.push(`${bankName || 'This bank'} has ${summary.positions.toLocaleString('en-US')} parsed holdings with ${summary.marketValue ? `$${Math.round(summary.marketValue).toLocaleString('en-US')} market value` : 'market value on file'}.`);
  }
  if (summary.gainLoss != null) {
    commentary.push(`The portfolio is ${summary.gainLoss < 0 ? 'underwater' : 'above book'} by ${Math.abs(summary.gainLossPct || 0).toFixed(2)}% of book value, so the first conversation should be framed around review and repositioning rather than generic product pitching.`);
  }
  if (base || up300 || down300) {
    commentary.push(`THC scenario rows are available${base ? ` with base market value ${Math.round(base.marketValue || 0).toLocaleString('en-US')}` : ''}; use them to support ALM/rate-risk talking points.`);
  }
  if (peerOutliers.length) {
    const top = peerOutliers[0];
    commentary.push(`Peer review shows the largest allocation gap in ${top.sector}: ${top.allocationPct.toFixed(1)}% versus peer ${top.peerAllocationPct.toFixed(1)}%.`);
  }
  if (!commentary.length) {
    commentary.push('The matched THC workbook is available, but the parsed metrics do not point to a single dominant pressure point yet.');
  }

  return {
    commentary,
    priorities: priorities.slice(0, 5),
    peerOutliers,
    scenario: {
      base,
      up300,
      down300,
      effectiveDuration: investmentsKrd && investmentsKrd.values ? nullableNumber(investmentsKrd.values['Eff. Dur']) : null
    },
    actions: actions.slice(0, 5)
  };
}

function buildPortfolioOpportunityRows(decisionLayer, sectors, swapIdeas) {
  const rows = [];
  (decisionLayer.priorities || []).forEach(priority => {
    rows.push({
      type: priority.title,
      severity: priority.tone,
      evidence: priority.detail,
      nextStep: /duration|rate|ALM|IRR/i.test(priority.title)
        ? 'Open ALM / IRR request'
        : /muni/i.test(priority.title)
          ? 'Open Muni BCIS request'
          : 'Open swap screen'
    });
  });
  (swapIdeas || []).slice(0, 2).forEach(row => {
    rows.push({
      type: 'Specific swap candidate',
      severity: 'High',
      evidence: `Sell ${row.held && row.held.cusip || 'holding'}; estimated pickup ${row.economics && row.economics.annualIncomePickup != null ? Math.round(row.economics.annualIncomePickup).toLocaleString('en-US') : 'available in screen'}.`,
      nextStep: 'Create Bond Swap Request'
    });
  });
  const topSector = sectors && sectors[0];
  if (topSector) {
    rows.push({
      type: 'Portfolio mix conversation',
      severity: topSector.marketShare >= 45 ? 'Medium' : 'Low',
      evidence: `${topSector.sector} is ${topSector.marketShare != null ? topSector.marketShare.toFixed(1) : '—'}% of market value.`,
      nextStep: 'Confirm policy limits and reinvestment intent'
    });
  }
  return rows.slice(0, 7);
}

function buildPortfolioReview(bankId, query) {
  const ctx = getSwapBankContext(bankId);
  if (!ctx) return null;
  const { bank, summary, parsedHoldings, inventory } = ctx;
  const { values } = latestBankValues(bank);
  if (!parsedHoldings) {
    return {
      available: false,
      bankId,
      bankName: summary.displayName || summary.name || 'Bank',
      notice: 'No parsed bond-accounting portfolio is available for this bank.'
    };
  }

  const positions = flattenPortfolioHoldings(parsedHoldings);
  const totals = parsedHoldings.totals || {};
  const aggregate = parsedHoldings.aggregates || {};
  const summaryMarket = nullableNumber(totals.marketValue) ?? nullableNumber(aggregate.marketValue) ?? positions.reduce((acc, row) => acc + (nullableNumber(row.marketValue) || 0), 0);
  const summaryBook = nullableNumber(totals.bookValue) ?? nullableNumber(aggregate.bookValue) ?? positions.reduce((acc, row) => acc + (nullableNumber(row.bookValue) || 0), 0);
  const summaryPar = nullableNumber(totals.par) ?? nullableNumber(aggregate.par) ?? positions.reduce((acc, row) => acc + (nullableNumber(row.par) || 0), 0);
  const summaryGainLoss = nullableNumber(totals.unrealizedGainLoss) ?? nullableNumber(aggregate.gainLoss) ?? (summaryMarket - summaryBook);
  const reviewSummary = {
    positions: positions.length,
    par: Math.round(summaryPar || 0),
    bookValue: Math.round(summaryBook || 0),
    marketValue: Math.round(summaryMarket || 0),
    gainLoss: Math.round(summaryGainLoss || 0),
    gainLossPct: summaryBook ? summaryGainLoss / summaryBook * 100 : null,
    bookYield: nullableNumber(totals.bookYieldYtw) ?? weightedAverage(positions, 'bookYield'),
    marketYield: nullableNumber(totals.marketYieldYtw) ?? weightedAverage(positions, 'marketYield'),
    taxEquivalentBookYield: nullableNumber(totals.taxEqBookYieldYtw),
    taxEquivalentMarketYield: nullableNumber(totals.taxEqMarketYieldYtw),
    weightedCoupon: nullableNumber(totals.weightedCoupon) ?? weightedAverage(positions, 'coupon', 'par'),
    weightedAverageLife: nullableNumber(totals.weightedAverageLife) ?? weightedAverage(positions, 'averageLife'),
    effectiveDuration: weightedAverage(positions, 'effectiveDuration'),
    yieldOnSecurities: numericValue(values.yieldOnSecurities),
    netInterestMargin: numericValue(values.netInterestMargin),
    costOfFunds: numericValue(values.costOfFunds),
    securitiesToAssets: numericValue(values.securitiesToAssets)
  };
  const sectors = buildPortfolioSectorRows(positions, reviewSummary.marketValue);
  const profile = buildInvestmentFitProfile(parsedHoldings, inventory.asOfDate || parsedHoldings.asOfDate || new Date().toISOString().slice(0, 10));
  const rules = {
    breakevenSoftCapMonths: parseInt(query.get('breakevenSoftCap'), 10)
      || swapMath.DEFAULT_FBBS_RULES.breakevenSoftCapMonths,
    maturitySoftFloorMonths: parseInt(query.get('maturitySoftFloor'), 10)
      || swapMath.DEFAULT_FBBS_RULES.maturitySoftFloorMonths
  };
  const candidates = findSwapCandidates(parsedHoldings, inventory, {
    includeRejected: true,
    rules,
    limit: parseInt(query.get('limit'), 10) || 8
  });

  // AFS/HTM accounting split — the workbook's per-position classification
  // column, aggregated so the tear sheet can reconcile against the call
  // report's pledged/AFS/HTM rows.
  const classificationMap = new Map();
  for (const row of positions) {
    const raw = String(row.classification || '');
    const key = /htm|held.?to.?maturity/i.test(raw) ? 'HTM' : (/afs|available.?for.?sale/i.test(raw) ? 'AFS' : 'Other');
    const bucket = classificationMap.get(key) || { classification: key, positions: 0, bookValue: 0, marketValue: 0 };
    bucket.positions += 1;
    bucket.bookValue += nullableNumber(row.bookValue) || 0;
    bucket.marketValue += nullableNumber(row.marketValue) || 0;
    classificationMap.set(key, bucket);
  }
  const classificationSplit = ['AFS', 'HTM', 'Other']
    .map(key => classificationMap.get(key))
    .filter(bucket => bucket && bucket.positions)
    .map(bucket => ({ ...bucket, bookValue: Math.round(bucket.bookValue), marketValue: Math.round(bucket.marketValue) }));

  const topHoldings = positions
    .slice()
    .sort((a, b) => ((nullableNumber(b.bookValue) || nullableNumber(b.par) || 0) - (nullableNumber(a.bookValue) || nullableNumber(a.par) || 0)))
    .slice(0, 8);

  const topLosses = topPortfolioRows(positions, row => (nullableNumber(row.gainLoss) || 0) < 0, row => Math.abs(nullableNumber(row.gainLoss) || 0), 10);
  const lossPct = topPortfolioRows(positions, row => (nullableNumber(row.gainLossPct) || 0) < -2, row => Math.abs(nullableNumber(row.gainLossPct) || 0), 10);
  const yieldReset = topPortfolioRows(positions, row => (nullableNumber(row.yieldGap) || 0) >= 0.75, row => nullableNumber(row.yieldGap) || 0, 10);
  const lowYield = topPortfolioRows(positions, row => {
    const yld = nullableNumber(row.bookYield);
    return yld != null && yld < Math.max(3, (reviewSummary.bookYield || 0) - 0.5);
  }, row => 10 - (nullableNumber(row.bookYield) || 0), 10);
  const durationWatch = topPortfolioRows(positions, row => (nullableNumber(row.effectiveDuration) || nullableNumber(row.averageLife) || 0) >= 5, row => nullableNumber(row.effectiveDuration) || nullableNumber(row.averageLife) || 0, 10);
  const callableWatch = topPortfolioRows(positions, row => row.callable || (nullableNumber(row.marketPrice) || 0) >= 102, row => (nullableNumber(row.marketPrice) || 100) + (row.callable ? 10 : 0), 10);
  const analytics = parsedHoldings.analytics || {};
  const decisionLayer = buildPortfolioDecisionLayer({
    positions,
    sectors,
    summary: reviewSummary,
    analytics,
    swapIdeas: candidates.kept || [],
    bankName: summary.displayName || summary.name || 'Bank',
    reportDate: parsedHoldings.asOfDate || ''
  });

  return {
    available: true,
    bankId,
    bankName: summary.displayName || summary.name || 'Bank',
    city: summary.city || '',
    state: summary.state || '',
    certNumber: summary.certNumber || '',
    accountStatus: summary.accountStatus ? summary.accountStatus.status : '',
    isSubchapterS: summary.subchapterS === 'Yes',
    taxRate: summary.subchapterS === 'Yes' ? 29.6 : 21,
    reportDate: parsedHoldings.asOfDate || '',
    inventoryDate: inventory.asOfDate || '',
    sourceFile: parsedHoldings.sourceFile || '',
    summary: reviewSummary,
    flags: buildPortfolioReviewFlags(positions, sectors, reviewSummary, profile),
    sectors,
    classificationSplit,
    topHoldings,
    ladder: buildPortfolioLadder(positions, parsedHoldings.asOfDate || inventory.asOfDate),
    analytics,
    decisionLayer,
    opportunities: buildPortfolioOpportunityRows(decisionLayer, sectors, candidates.kept || []),
    screens: {
      topLosses,
      lossPct,
      yieldReset,
      lowYield,
      durationWatch,
      callableWatch
    },
    holdings: positions,
    swapIdeas: candidates.kept || [],
    rejectedSwapIdeas: candidates.dropped || [],
    rules,
    assumptions: [
      'Uses the latest matched bond-accounting portfolio workbook for the selected bank.',
      'Call-report context comes from the latest uploaded quarterly bank data.',
      'Swap ideas compare parsed holdings against today’s portal inventory and apply the existing FBBS hard rule: the held bond cannot mature before breakeven.',
      'Internal strategy screen only; desk review still controls final recommendation and client language.'
    ]
  };
}

function handlePortfolioReview(res, query) {
  const bankId = String(query.get('bankId') || '').trim();
  if (!bankId) return sendJSON(res, 400, { error: 'bankId is required' });
  try {
    const review = buildPortfolioReview(bankId, query);
    if (!review) return sendJSON(res, 404, { error: 'Bank not found' });
    return sendJSON(res, 200, review);
  } catch (err) {
    log('error', `Portfolio review failed for ${bankId}:`, err.message);
    return sendJSON(res, 500, { error: err.message || 'Could not build portfolio review' });
  }
}

// ---- Reports Workspace persistence (saved report definitions + hidden list).
// Replaces the old browser-only localStorage model so reports are shared across
// machines/reps. createdBy is taken server-side from the resolved rep, never
// trusted from the request body. ----

function handleListReports(req, res, query) {
  try {
    const rep = resolveRequestRep(req);
    const reports = reportStore.listReportDefinitions(BANK_REPORTS_DIR, {
      type: query.get('type') || undefined,
      limit: parseInt(query.get('limit'), 10) || 100
    });
    const hidden = reportStore.listHiddenReportIds(BANK_REPORTS_DIR, rep);
    return sendJSON(res, 200, { reports, hidden, rep });
  } catch (err) {
    log('error', 'Report list failed:', err.message);
    return sendJSON(res, 500, { error: err.message || 'Could not list reports' });
  }
}

function parseCsvParam(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Activity Summary by Rep — counts of manual CRM activities per rep (or per
// bank) over a date range. Defaults to the current month.
function handleActivitySummaryReport(req, res, query) {
  try {
    const now = new Date();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get('from') || '') ? query.get('from') : monthStart;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get('to') || '') ? query.get('to') : now.toISOString().slice(0, 10);
    const kinds = parseCsvParam(query.get('kinds'));
    const view = query.get('view') === 'bank' ? 'bank' : 'rep';
    const repFilter = new Set(parseCsvParam(query.get('reps')).map(s => s.toLowerCase()));

    const empty = () => ({ call: 0, email: 0, meeting: 0, task: 0, note: 0, total: 0, lastDate: '' });
    const rows = new Map();
    if (view === 'rep') {
      activityCountsByRep(BANK_REPORTS_DIR, { from, to, kinds }).forEach(entry => {
        const key = (entry.actorUsername || '(unknown)').toLowerCase();
        if (repFilter.size && !repFilter.has(key)) return;
        const row = rows.get(key) || { rep: entry.actorUsername || '(unknown)', repDisplay: entry.actorDisplay || entry.actorUsername || '(unknown)', ...empty() };
        if (entry.actorDisplay) row.repDisplay = entry.actorDisplay;
        if (row[entry.kind] !== undefined) row[entry.kind] += entry.count;
        row.total += entry.count;
        if (entry.lastDate > row.lastDate) row.lastDate = entry.lastDate;
        rows.set(key, row);
      });
    } else {
      // Bank view: name/state come from the coverage rows the activities hang on.
      const banks = new Map((listSavedBanks(BANK_REPORTS_DIR) || []).map(b => [b.bankId, b]));
      activityCountsByBank(BANK_REPORTS_DIR, { from, to, kinds }).forEach(entry => {
        const bank = banks.get(entry.bankId) || {};
        const row = rows.get(entry.bankId) || {
          bankId: entry.bankId,
          displayName: bank.displayName || entry.bankId,
          city: bank.city || '',
          state: bank.state || '',
          owner: bank.owner || '',
          ...empty()
        };
        if (row[entry.kind] !== undefined) row[entry.kind] += entry.count;
        row.total += entry.count;
        if (entry.lastDate > row.lastDate) row.lastDate = entry.lastDate;
        rows.set(entry.bankId, row);
      });
    }
    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    return sendJSON(res, 200, { view, from, to, rows: list });
  } catch (err) {
    log('error', 'Activity summary report failed:', err.message);
    return sendJSON(res, 500, { error: err.message || 'Could not build activity summary' });
  }
}

// Account Touch Report — covered banks with no manual activity in N days
// (or ever), most neglected first.
function handleAccountTouchReport(req, res, query) {
  try {
    const thresholdDays = Math.max(0, Math.min(3650, parseInt(query.get('days'), 10) || 30));
    const statuses = new Set(parseCsvParam(query.get('statuses')));
    const states = new Set(parseCsvParam(query.get('states')).map(s => s.toUpperCase()));
    const owner = String(query.get('owner') || '').trim().toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const lastTouch = lastActivityByBank(BANK_REPORTS_DIR);
    const dayMs = 86400000;
    const rows = (listSavedBanks(BANK_REPORTS_DIR) || [])
      .filter(row => {
        if (statuses.size && !statuses.has(row.status || 'Open')) return false;
        if (states.size && !states.has(String(row.state || '').toUpperCase())) return false;
        if (owner && !String(row.owner || '').toLowerCase().includes(owner)) return false;
        return true;
      })
      .map(row => {
        const last = lastTouch[row.bankId] || '';
        const daysSince = last
          ? Math.floor((new Date(`${today}T00:00:00`) - new Date(`${last}T00:00:00`)) / dayMs)
          : null; // null = never touched
        return {
          bankId: row.bankId,
          displayName: row.displayName,
          city: row.city || '',
          state: row.state || '',
          status: row.status || 'Open',
          owner: row.owner || '',
          lastActivityDate: last,
          daysSinceContact: daysSince,
          nextActionDate: row.nextActionDate || ''
        };
      })
      .filter(row => row.daysSinceContact === null || row.daysSinceContact >= thresholdDays)
      .sort((a, b) => {
        // Never-touched first, then oldest touch first.
        if ((a.daysSinceContact === null) !== (b.daysSinceContact === null)) return a.daysSinceContact === null ? -1 : 1;
        return (b.daysSinceContact || 0) - (a.daysSinceContact || 0);
      });
    return sendJSON(res, 200, { thresholdDays, rows });
  } catch (err) {
    log('error', 'Account touch report failed:', err.message);
    return sendJSON(res, 500, { error: err.message || 'Could not build account touch report' });
  }
}

async function handleCreateReport(req, res) {
  try {
    const body = await readJsonBody(req, 256 * 1024);
    const rep = resolveRequestRep(req);
    const report = reportStore.createReportDefinition(BANK_REPORTS_DIR, body, rep);
    appendAuditLog({ event: 'report-create', reportId: report.id, type: report.type, rep: rep ? rep.username : null });
    return sendJSON(res, 200, { report });
  } catch (err) {
    log('error', 'Report create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not save report' });
  }
}

async function handleUpdateReport(req, res, id) {
  try {
    const body = await readJsonBody(req, 256 * 1024);
    const report = reportStore.updateReportDefinition(BANK_REPORTS_DIR, id, body);
    if (!report) return sendJSON(res, 404, { error: 'Report not found' });
    appendAuditLog({ event: 'report-update', reportId: id });
    return sendJSON(res, 200, { report });
  } catch (err) {
    log('error', 'Report update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update report' });
  }
}

function handleDeleteReport(req, res, id) {
  try {
    const deleted = reportStore.deleteReportDefinition(BANK_REPORTS_DIR, id);
    if (!deleted) return sendJSON(res, 404, { error: 'Report not found' });
    appendAuditLog({ event: 'report-delete', reportId: id });
    return sendJSON(res, 200, { deleted: true, id });
  } catch (err) {
    log('error', 'Report delete failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not delete report' });
  }
}

async function handleSetReportHidden(req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const id = String(body.id || '').trim();
    if (!id) return sendJSON(res, 400, { error: 'id is required' });
    const hidden = Boolean(body.hidden);
    const rep = resolveRequestRep(req);
    const hiddenIds = reportStore.setReportHidden(BANK_REPORTS_DIR, id, hidden, rep);
    appendAuditLog({ event: hidden ? 'report-hide' : 'report-unhide', reportId: id, rep: rep ? rep.username : null });
    return sendJSON(res, 200, { hidden: hiddenIds });
  } catch (err) {
    log('error', 'Report hidden update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update hidden reports' });
  }
}

async function handleCreateSwapProposal(req, res) {
  try {
    const body = await readJsonBody(req);
    const bankId = String(body.bankId || '').trim();
    if (!bankId) return sendJSON(res, 400, { error: 'bankId is required' });

    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });

    const isSubS = summary.subchapterS === 'Yes';
    const proposalDate = new Date().toISOString().slice(0, 10);
    const settleDate = swapMath.ymd(swapMath.defaultSettleDate(proposalDate)) || proposalDate;

    const created = swapStore.createProposal(BANK_REPORTS_DIR, {
      bankId,
      title: body.title || `Bond Swap — ${summary.displayName || summary.name}`,
      proposalDate,
      settleDate: body.settleDate || settleDate,
      isSubchapterS: body.isSubchapterS != null ? body.isSubchapterS : isSubS,
      taxRate: body.taxRate,
      horizonYears: body.horizonYears,
      breakevenCapMonths: body.breakevenCapMonths || swapMath.DEFAULT_FBBS_RULES.breakevenCapMonths,
      maturityFloorMonths: body.maturityFloorMonths || swapMath.DEFAULT_FBBS_RULES.maturityFloorMonths,
      preparedBy: body.preparedBy,
      preparedFor: body.preparedFor,
      notes: body.notes
    });
    appendAuditLog({
      event: 'swap-proposal-create',
      proposalId: created.proposal.id,
      bankId
    });
    return sendJSON(res, 200, withComputedSummary(created));
  } catch (err) {
    log('error', 'Swap proposal create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not create swap proposal' });
  }
}

async function handleUpdateSwapProposal(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const updated = swapStore.updateProposal(BANK_REPORTS_DIR, id, body);
    appendAuditLog({ event: 'swap-proposal-update', proposalId: id });
    return sendJSON(res, 200, withComputedSummary(updated));
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : (/sent|frozen|cancelled/i.test(err.message) ? 409 : 500);
    return sendJSON(res, status, { error: err.message });
  }
}

// If a leg has par + coupon + maturity but the rep didn't type an accrued
// value, compute it from the proposal's settle date using the day-count
// convention for the leg's sector (Treasuries/Agency = Actual/Actual,
// everything else = 30/360). This makes the per-leg artifact "complete"
// without forcing the rep to do the calc by hand.
function autoFillAccrued(body, proposal) {
  if (!body || !proposal) return body;
  if (body.accrued != null && body.accrued !== '') return body;
  const par = Number(body.par);
  const coupon = Number(body.coupon);
  const maturity = body.maturity;
  if (!Number.isFinite(par) || par <= 0) return body;
  if (!Number.isFinite(coupon) || coupon <= 0) return body;
  if (!maturity) return body;
  const dayCount = swapMath.defaultDayCountForSector(body.sector);
  const accrued = swapMath.accruedInterest({
    par, coupon, maturity,
    settleDate: proposal.settleDate || new Date().toISOString().slice(0, 10),
    dayCount,
    frequency: 2
  });
  if (accrued == null) return body;
  return { ...body, accrued: Math.round(accrued * 100) / 100 };
}

async function handleAddSwapLeg(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const legProblems = swapMath.validateLegInput(body);
    if (legProblems.length) return sendJSON(res, 400, { error: legProblems.join('; ') });
    const current = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!current) return sendJSON(res, 404, { error: 'Proposal not found' });
    const after = swapStore.addLeg(BANK_REPORTS_DIR, id, autoFillAccrued(body, current.proposal));
    appendAuditLog({ event: 'swap-leg-add', proposalId: id, side: body.side, cusip: body.cusip || null });
    return sendJSON(res, 200, withComputedSummary(after));
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : (/frozen|sent|cancelled/i.test(err.message) ? 409 : 500);
    return sendJSON(res, status, { error: err.message });
  }
}

async function handleUpdateSwapLeg(req, res, id, legId) {
  try {
    const body = await readJsonBody(req);
    const legProblems = swapMath.validateLegInput(body);
    if (legProblems.length) return sendJSON(res, 400, { error: legProblems.join('; ') });
    const current = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!current) return sendJSON(res, 404, { error: 'Proposal not found' });
    // Merge the incoming patch with the leg's current values, then auto-fill
    // accrued if the rep didn't supply it. This way a Par or Coupon edit
    // re-derives accrued without losing rep-typed overrides.
    const existingLeg = (current.legs || []).find(l => Number(l.id) === Number(legId)) || {};
    const merged = { ...existingLeg, ...body };
    const patch = body.accrued != null ? body : autoFillAccrued(merged, current.proposal);
    // Only pass through the fields the rep actually changed plus any
    // auto-computed accrued so we don't overwrite unrelated leg fields.
    const finalPatch = body.accrued != null
      ? body
      : { ...body, ...(patch.accrued != null && patch.accrued !== existingLeg.accrued ? { accrued: patch.accrued } : {}) };
    const after = swapStore.updateLeg(BANK_REPORTS_DIR, id, legId, finalPatch);
    appendAuditLog({ event: 'swap-leg-update', proposalId: id, legId });
    return sendJSON(res, 200, withComputedSummary(after));
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : (/frozen|sent|cancelled/i.test(err.message) ? 409 : 500);
    return sendJSON(res, status, { error: err.message });
  }
}

function handleDeleteSwapLeg(req, res, id, legId) {
  try {
    const after = swapStore.deleteLeg(BANK_REPORTS_DIR, id, legId);
    appendAuditLog({ event: 'swap-leg-delete', proposalId: id, legId });
    return sendJSON(res, 200, withComputedSummary(after));
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : (/frozen|sent|cancelled/i.test(err.message) ? 409 : 500);
    return sendJSON(res, status, { error: err.message });
  }
}

function buildProposalSnapshot(proposalRecord) {
  const { proposal, legs } = proposalRecord;
  // Enrich legs (derive blank yields/duration from price+coupon+maturity)
  // BEFORE freezing, so the immutable snapshot — and therefore the printed
  // sent proposal, which renders straight from the snapshot — shows the same
  // values the rep approved in the live editor instead of silently dropping
  // to "—".
  const enrich = l => swapMath.enrichLegWithComputedFields(l, proposal.settleDate);
  const sells = legs.filter(l => l.side === 'sell').map(enrich);
  const buys = legs.filter(l => l.side === 'buy').map(enrich);
  const summary = swapMath.swapSummary({
    sells, buys,
    horizonYears: proposal.horizonYears || 3,
    taxRate: proposal.taxRate
  });
  return {
    proposal,
    sells,
    buys,
    summary,
    builtAt: new Date().toISOString()
  };
}

// Always returns the record with a fresh client-facing computedSummary so the
// inline editor can show live $ / breakeven / portfolio-diff as the rep edits.
// For sent proposals, the snapshot summary is the canonical record but we
// still expose the live recomputation for diff comparison.
function withComputedSummary(record) {
  if (!record || !record.proposal) return record;
  const { proposal, legs } = record;
  // Enrich each leg with derived yield + duration when the source workbook
  // shipped those blank (40% of muni holdings observed in production).
  const enrichedLegs = (legs || []).map(leg => swapMath.enrichLegWithComputedFields(leg, proposal.settleDate));
  const sells = enrichedLegs.filter(l => l.side === 'sell');
  const buys = enrichedLegs.filter(l => l.side === 'buy');
  return {
    ...record,
    legs: enrichedLegs,
    computedSummary: swapMath.swapSummary({
      sells, buys,
      horizonYears: proposal.horizonYears || 3,
      taxRate: proposal.taxRate
    })
  };
}

async function handleSendSwapProposal(req, res, id) {
  try {
    const current = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!current) return sendJSON(res, 404, { error: 'Proposal not found' });
    if (current.proposal.status !== 'draft') {
      return sendJSON(res, 409, { error: `Proposal is already ${current.proposal.status}` });
    }
    // Drop any rows the rep added via "Add sell/buy" but never filled in —
    // an unfilled stub on the printable artifact looks broken to the bank.
    const pruned = swapStore.pruneUnfilledLegs(BANK_REPORTS_DIR, id);
    const refreshed = pruned > 0 ? swapStore.getProposal(BANK_REPORTS_DIR, id) : current;
    const sellsCount = refreshed.legs.filter(l => l.side === 'sell').length;
    const buysCount = refreshed.legs.filter(l => l.side === 'buy').length;
    if (!sellsCount || !buysCount) {
      return sendJSON(res, 400, { error: 'Add at least one sell leg and one buy leg with a CUSIP and par before sending.' });
    }

    const snapshot = buildProposalSnapshot(refreshed);
    // Don't freeze a proposal whose printed economics would be full of "—".
    // Once sent, the snapshot is immutable and goes to the bank, so block the
    // send and tell the rep exactly which legs are missing what.
    const sendIssues = swapMath.validateLegsForSend(snapshot.sells, snapshot.buys);
    if (sendIssues.length) {
      return sendJSON(res, 400, {
        error: 'This proposal is missing data needed for a complete client artifact. Fill in the fields below, then send.',
        issues: sendIssues
      });
    }
    let frozen = swapStore.freezeProposal(BANK_REPORTS_DIR, id, snapshot);

    // Promote into the Strategies Queue as type 'Bond Swap' so the rest
    // of the desk sees it in their existing workflow. Skip if the
    // proposal is already linked (idempotent re-sends).
    let strategy = null;
    if (!frozen.proposal.strategyId) {
      const summary = getBankSummaryForCoverage(frozen.proposal.bankId);
      if (summary) {
        try {
          strategy = createStrategyRequest(BANK_REPORTS_DIR, summary, {
            requestType: 'Bond Swap',
            status: 'In Progress',
            summary: frozen.proposal.title || `Bond Swap proposal ${frozen.proposal.id}`,
            comments: `Linked to swap proposal ${frozen.proposal.id}.\n` +
                      `${sellsCount} sell / ${buysCount} buy · ` +
                      `total income $${snapshot.summary.dollars.totalIncome}` +
                      (snapshot.summary.breakevenMonths != null
                        ? ` · breakeven ${snapshot.summary.breakevenMonths.toFixed(1)}mo`
                        : '') + '\n' +
                      `Print: /api/swap-proposals/${frozen.proposal.id}/render`
          });
          frozen = swapStore.updateProposalStrategyLink(BANK_REPORTS_DIR, id, strategy.id);
        } catch (err) {
          log('warn', `Swap proposal ${id} sent, but could not create linked strategy: ${err.message}`);
        }
      }
    }

    appendAuditLog({
      event: 'swap-proposal-send',
      proposalId: id,
      bankId: refreshed.proposal.bankId,
      sells: sellsCount,
      buys: buysCount,
      prunedLegs: pruned,
      totalIncome: snapshot.summary.dollars.totalIncome,
      strategyId: strategy && strategy.id || frozen.proposal.strategyId || null
    });
    return sendJSON(res, 200, withComputedSummary(frozen));
  } catch (err) {
    log('error', 'Swap proposal send failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not send proposal' });
  }
}

function handleCloneSwapProposal(req, res, id) {
  try {
    const cloned = swapStore.cloneProposalToDraft(BANK_REPORTS_DIR, id);
    appendAuditLog({ event: 'swap-proposal-clone', sourceId: id, newId: cloned.proposal.id });
    return sendJSON(res, 200, withComputedSummary(cloned));
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 500;
    return sendJSON(res, status, { error: err.message });
  }
}

// Advisory: suggest the par for one buy leg that balances the swap's
// proceeds (cash-neutral, or a target net-cash difference). Read-only — the
// rep applies the suggestion through the normal PATCH-leg path so the swap
// rules get re-evaluated. Defaults to the sole buy leg; pass ?flexLegId= to
// size a specific one when there are several.
function handleSizeBuySwapProposal(res, id, query) {
  try {
    const record = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!record) return sendJSON(res, 404, { error: 'Proposal not found' });
    const sells = (record.legs || []).filter(l => l.side === 'sell');
    const buys = (record.legs || []).filter(l => l.side === 'buy');
    if (!buys.length) return sendJSON(res, 400, { error: 'Add a buy leg before sizing.' });

    let flexIndex = 0;
    const flexLegId = query.get('flexLegId');
    if (flexLegId) {
      flexIndex = buys.findIndex(l => Number(l.id) === Number(flexLegId));
      if (flexIndex < 0) return sendJSON(res, 400, { error: 'flexLegId is not a buy leg on this proposal' });
    } else if (buys.length > 1) {
      return sendJSON(res, 400, { error: 'This proposal has multiple buy legs — pass flexLegId to choose which one to size.' });
    }

    let targetNetCash = 0;
    if (query.get('targetNetCash') != null && query.get('targetNetCash') !== '') {
      targetNetCash = Number(query.get('targetNetCash'));
      if (!Number.isFinite(targetNetCash)) return sendJSON(res, 400, { error: 'targetNetCash must be a number' });
    }
    let parIncrement = 1000;
    if (query.get('parIncrement') != null && query.get('parIncrement') !== '') {
      const inc = Number(query.get('parIncrement'));
      if (!Number.isFinite(inc) || inc <= 0) return sendJSON(res, 400, { error: 'parIncrement must be a positive number' });
      parIncrement = inc;
    }

    const result = swapMath.solveBuyParForProceeds({
      sells, buys, flexIndex,
      settleDate: record.proposal.settleDate,
      targetNetCash, parIncrement
    });
    if (!result.ok) return sendJSON(res, 400, { error: result.reason });
    return sendJSON(res, 200, { ...result, flexLegId: buys[flexIndex].id });
  } catch (err) {
    log('error', 'Swap buy-sizing failed:', err.message);
    return sendJSON(res, 500, { error: err.message || 'Could not size buy leg' });
  }
}

function handleExecuteSwapProposal(req, res, id) {
  try {
    const current = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!current) return sendJSON(res, 404, { error: 'Proposal not found' });
    if (current.proposal.status !== 'sent') {
      return sendJSON(res, 409, { error: `Proposal is ${current.proposal.status}; only sent proposals can be executed` });
    }
    const executed = swapStore.markExecuted(BANK_REPORTS_DIR, id);
    // Move the linked Strategies entry to Completed so the queue stays in
    // sync with the actual trade workflow.
    if (current.proposal.strategyId) {
      try {
        updateStrategyRequest(BANK_REPORTS_DIR, current.proposal.strategyId, {
          status: 'Completed'
        });
      } catch (err) {
        log('warn', `Could not transition linked strategy ${current.proposal.strategyId} to Completed: ${err.message}`);
      }
    }
    appendAuditLog({
      event: 'swap-proposal-execute',
      proposalId: id,
      strategyId: current.proposal.strategyId || null
    });
    return sendJSON(res, 200, withComputedSummary(executed));
  } catch (err) {
    return sendJSON(res, err.statusCode || 500, { error: err.message });
  }
}

function handleCancelSwapProposal(req, res, id) {
  try {
    const current = swapStore.getProposal(BANK_REPORTS_DIR, id);
    if (!current) return sendJSON(res, 404, { error: 'Proposal not found' });
    // An executed (settled) trade is booked — it can't be reverted to cancelled,
    // which would desync the record, the Strategies queue, and the real trade.
    if (current.proposal.status === 'executed') {
      return sendJSON(res, 409, { error: 'Executed proposals cannot be cancelled' });
    }
    // Already cancelled → idempotent no-op (don't overwrite cancelled_at).
    if (current.proposal.status === 'cancelled') {
      return sendJSON(res, 200, withComputedSummary(current));
    }
    const cancelled = swapStore.cancelProposal(BANK_REPORTS_DIR, id);
    // If a strategy was created on send, archive it so the queue doesn't
    // dangle. Editing+executing happens through the existing Strategies tab.
    if (current.proposal.strategyId) {
      try {
        updateStrategyRequest(BANK_REPORTS_DIR, current.proposal.strategyId, {
          archived: true,
          archivedBy: 'swap-proposal-cancel'
        });
      } catch (err) {
        log('warn', `Could not archive linked strategy ${current.proposal.strategyId}: ${err.message}`);
      }
    }
    appendAuditLog({
      event: 'swap-proposal-cancel',
      proposalId: id,
      strategyId: current.proposal.strategyId || null
    });
    return sendJSON(res, 200, withComputedSummary(cancelled));
  } catch (err) {
    return sendJSON(res, err.statusCode || 500, { error: err.message });
  }
}

// ============================================================
// Portfolio Idea Engine report — profile, runoff, hero, and the
// narrative findings that surround the swap blotter. Mirrors the
// standalone "FBBS Portfolio Idea Engine" prototype but runs server-side
// off the already-parsed bond-accounting holdings + cashflow series.
// ============================================================

function htmlEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Dollar / percent formatters for the server-composed finding prose.
const rNum0 = n => (n == null || !Number.isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const rNum1 = n => (n == null || !Number.isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rNum2 = n => (n == null || !Number.isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rPct = n => (n == null || !Number.isFinite(n)) ? '—' : rNum2(n) + '%';
const rMM = n => (n == null || !Number.isFinite(n)) ? '—' : (n < 0 ? '-' : '') + '$' + rNum1(Math.abs(n) / 1e6) + 'MM';
const rK = n => (n == null || !Number.isFinite(n)) ? '—' : (n < 0 ? '-' : '') + '$' + rNum0(Math.abs(n) / 1e3) + 'K';
const nNum = (cls, s) => `<span class="${cls}">${s}</span>`;

// In-state muni detection (skips SD/IN which collide with school-dist / preposition).
const US_STATE_CODES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IA KS KY LA MA MD MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC TN TX UT VT VA WA WV WI WY ME'.split(' '));
function muniStateOf(desc) {
  const toks = String(desc || '').toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  for (const t of toks) { if (US_STATE_CODES.has(t) && t !== 'SD' && t !== 'IN') return t; }
  return null;
}

function flattenHoldings(parsedHoldings) {
  const all = [];
  for (const rows of Object.values(parsedHoldings.sectors || {})) {
    for (const h of (rows || [])) all.push(h);
  }
  return all;
}

function holdingGlPct(h) {
  const gl = numericValue(h.gainLoss);
  const bk = numericValue(h.bookValue);
  if (gl == null || !bk) return null;
  return (gl / bk) * 100;
}

function portfolioProfile(parsedHoldings, knobs) {
  const all = flattenHoldings(parsedHoldings);
  const n0 = x => { const v = numericValue(x); return v == null ? 0 : v; };
  const sum = f => all.reduce((a, b) => a + n0(f(b)), 0);
  const totpar = sum(b => b.par);
  const totbk = sum(b => b.bookValue);
  const totmkt = sum(b => b.marketValue);
  const totgl = sum(b => b.gainLoss);
  // Par-weighted average over only the holdings that actually report the field —
  // treating a missing WAL/duration as 0 would understate the book average (e.g.
  // some sector sheets don't carry a WAL column).
  const wavg = f => {
    let numr = 0, den = 0;
    for (const b of all) {
      const v = numericValue(f(b));
      const pr = numericValue(b.par);
      if (v != null && pr) { numr += pr * v; den += pr; }
    }
    return den ? numr / den : null;
  };
  const heldBookYtw = b => b.bookYieldYtw ?? b.bookYieldYtm;
  const heldMktYtw = b => b.marketYieldYtw ?? b.marketYieldYtm;

  const secMap = {};
  for (const b of all) {
    const s = b.sector || 'Other';
    const e = secMap[s] || (secMap[s] = { sector: s, n: 0, par: 0, gainLoss: 0, bookValue: 0 });
    e.n += 1; e.par += n0(b.par); e.gainLoss += n0(b.gainLoss); e.bookValue += n0(b.bookValue);
  }
  const sectors = Object.values(secMap)
    .map(e => ({ ...e, pctPar: totpar ? 100 * e.par / totpar : 0 }))
    .sort((a, b) => b.par - a.par);

  // Exempt-muni tax-equivalent context.
  const exemptMunis = all.filter(b => /exempt muni/i.test(b.sector || ''));
  const exemptPar = exemptMunis.reduce((a, b) => a + n0(b.par), 0);
  const exemptWBookYtw = exemptPar
    ? exemptMunis.reduce((a, b) => a + n0(b.par) * n0(heldBookYtw(b)), 0) / exemptPar
    : null;
  const exemptTey = exemptWBookYtw == null ? null
    : swapMath.municipalTeYield(exemptWBookYtw, { cofPct: knobs.cofPct, taxRatePct: knobs.taxRatePct, bqFactor: knobs.bqFactor });

  return {
    totalPar: totpar,
    totalBook: totbk,
    totalMarket: totmkt,
    totalGainLoss: totgl,
    pctOfBook: totbk ? 100 * totgl / totbk : 0,
    positions: all.length,
    wCoupon: wavg(b => b.coupon),
    wWal: wavg(b => b.averageLife),
    wDuration: wavg(b => b.effectiveDuration),
    wBookYtw: wavg(heldBookYtw),
    wMarketYtw: wavg(heldMktYtw),
    sectors,
    nLoss: all.filter(b => n0(b.gainLoss) < 0).length,
    isAFS: all.some(b => /afs/i.test(b.classification || '')),
    exemptMuni: exemptPar ? { par: exemptPar, wBookYtw: exemptWBookYtw, tey: exemptTey } : null
  };
}

function isoAddMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function portfolioRunoff(parsedHoldings) {
  const all = flattenHoldings(parsedHoldings);
  const cf = parsedHoldings.cashflow;
  const start = (cf && cf.dates && cf.dates[0]) || parsedHoldings.asOfDate || '';
  const maturingBy = months => {
    if (!start) return null;
    const cut = isoAddMonths(start, months);
    if (!cut) return null;
    return all.reduce((a, b) => {
      const m = b.maturity;
      return a + ((m && m >= start && m <= cut) ? (numericValue(b.par) || 0) : 0);
    }, 0);
  };
  const runBy = months => {
    if (!cf || !cf.dates || !cf.dates.length) return null;
    const cut = isoAddMonths(start, months);
    if (!cut) return null;
    const startBal = cf.baseThousands[0];
    let endBal = startBal;
    for (let i = 0; i < cf.dates.length; i += 1) { if (cf.dates[i] <= cut) endBal = cf.baseThousands[i]; }
    return (startBal - endBal) * 1000; // $000 → dollars
  };
  return {
    hasCashflow: !!(cf && cf.dates && cf.dates.length),
    asOf: start,
    mat6: maturingBy(6), mat12: maturingBy(12), mat24: maturingBy(24),
    run6: runBy(6), run12: runBy(12), run24: runBy(24)
  };
}

function swapHero(screen, runoff) {
  const cands = (screen && screen.kept) || [];
  // The reinvestment package is the subset genuinely below the target.
  const pkg = cands.filter(c => c.pickupVsReinvest != null && c.pickupVsReinvest > 0);
  const sum = f => pkg.reduce((a, c) => a + (Number(f(c)) || 0), 0);
  const executableVolume = sum(c => c.held.marketValue);
  const addedAnnualIncome = sum(c => c.addedAnnualIncome);
  const realizedLoss = sum(c => c.held.gainLoss);
  return {
    count: pkg.length,
    executableVolume,
    addedAnnualIncome,
    realizedLoss,
    blendedBreakevenYears: addedAnnualIncome > 0 ? Math.abs(realizedLoss) / addedAnnualIncome : null,
    reinvestPipeline12: runoff.hasCashflow ? runoff.run12 : null
  };
}

function buildPortfolioFindings(profile, runoff, knobs) {
  const out = [];
  const P = profile;

  // 1 — Posture (always)
  {
    let teyTxt = '';
    if (P.exemptMuni && P.exemptMuni.tey != null) {
      teyTxt = ` Tax-exempt holdings carry a book YTW of ${nNum('fr-num', rPct(P.exemptMuni.wBookYtw))}, a taxable-equivalent ${nNum('fr-num', rPct(P.exemptMuni.tey))} at a ${rNum0(knobs.taxRatePct)}% rate and ${rNum2(knobs.cofPct)}% cost of funds.`;
    }
    const glNeg = P.totalGainLoss < 0;
    out.push({
      sev: 'info', badge: 'Snapshot', title: 'Portfolio posture',
      body: `The book totals ${nNum('fr-num', rMM(P.totalBook))} across ${nNum('fr-num', rNum0(P.positions))} positions, marked at ${nNum('fr-num', rMM(P.totalMarket))} — an unrealized ${glNeg ? 'loss' : 'gain'} of ${nNum(glNeg ? 'fr-neg' : 'fr-num', rMM(P.totalGainLoss))}, or ${nNum(glNeg ? 'fr-neg' : 'fr-num', rNum2(Math.abs(P.pctOfBook)) + '%')} of book. Weighted-average coupon is ${nNum('fr-num', rPct(P.wCoupon))}, WAL ${nNum('fr-num', rNum1(P.wWal) + ' yrs')}, effective duration ${nNum('fr-num', rNum1(P.wDuration))}, book YTW ${nNum('fr-num', rPct(P.wBookYtw))} versus a market YTW of ${nNum('fr-num', rPct(P.wMarketYtw))}.${P.isAFS ? ' Holdings are carried <b>available-for-sale</b>, so the markdown sits in OCI and is not a realized hit unless positions are sold.' : ''}${teyTxt}`
    });
  }

  // 2 — Sector concentration
  {
    const top = P.sectors[0];
    if (top) {
      const sev = top.pctPar >= 55 ? 'high' : top.pctPar >= 38 ? 'med' : 'info';
      const phrase = top.pctPar >= 55 ? 'is heavily concentrated in' : top.pctPar >= 38 ? 'carries a meaningful tilt toward' : 'is most weighted to';
      const guide = top.pctPar >= 55 ? ' That is well above the 30–40% range typical for a community-bank book and concentrates spread, credit and liquidity exposure in a single sector.'
        : top.pctPar >= 38 ? ' That sits at the upper end of a typical allocation; further additions here would deepen single-sector exposure.' : '';
      const trade = top.pctPar >= 38 ? ` Trimming even a tenth of that sleeve frees up roughly ${nNum('fr-num', rMM(top.par * 0.1))} to diversify into other sectors — a clean rebalancing pitch.` : '';
      const others = P.sectors.slice(1, 3).map(s => `${htmlEsc(s.sector)} at ${rNum1(s.pctPar)}%`).join(' and ');
      out.push({
        sev, badge: sev === 'high' ? 'Concentration' : 'Allocation', title: `${htmlEsc(top.sector)} dominates the allocation`,
        body: `This portfolio ${phrase} <b>${htmlEsc(top.sector)}</b>, at ${nNum(sev === 'high' ? 'fr-neg' : 'fr-num', rNum1(top.pctPar) + '%')} of par (${nNum('fr-num', rMM(top.par))} across ${nNum('fr-num', rNum0(top.n))} positions).${guide}${others ? ` The next-largest sleeves are ${others}.` : ''}${trade}`
      });
    }
  }

  // 3 — Unrealized loss posture
  {
    const u = Math.abs(P.pctOfBook);
    if (P.totalGainLoss < 0) {
      const sev = u >= 5 ? 'high' : u >= 2 ? 'med' : 'info';
      const tone = u >= 5 ? 'a sizeable drag' : u >= 2 ? 'a moderate drawdown' : 'a modest markdown';
      out.push({
        sev, badge: 'Mark-to-Market', title: `Unrealized loss of ${rNum2(u)}% of book`,
        body: `The book is underwater by ${nNum('fr-neg', rMM(P.totalGainLoss))} (${tone}). ${nNum('fr-num', rNum0(P.nLoss))} of ${nNum('fr-num', rNum0(P.positions))} positions show a loss. Because losses live in OCI under AFS, restructuring is a balance-sheet optimization rather than a P&L event — the relevant test for any sell is whether the swap's breakeven lands inside the average life of what's sold, with positive net income to that point.`
      });
    }
  }

  return out;
}

function buildSwapPortfolioReport(parsedHoldings, screen, knobs) {
  const profile = portfolioProfile(parsedHoldings, knobs);
  const runoff = portfolioRunoff(parsedHoldings);
  const hero = swapHero(screen, runoff);
  const findings = buildPortfolioFindings(profile, runoff, knobs);
  // Findings that need the raw holdings (geo concentration, deep-discount holds,
  // extension, callable, runoff) are appended here where the holdings are in scope.
  appendHoldingFindings(findings, parsedHoldings, profile, runoff, knobs);
  // Stable ordering for display: high → med → opp → info.
  const order = { high: 0, med: 1, opp: 2, info: 3 };
  findings.sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9));
  return { profile, runoff, hero, findings };
}

// Pick the single best reinvestment buy for a multi-sell package: the offering
// across ALL mapped sectors that best fits the bank's ladder gaps (via the same
// fit scorer the per-bond engine uses) while still yielding at least the
// reinvest target, so the package is a genuine income improvement. Returns a buy
// offering object (shaped like a candidate's `offering`) or null when nothing in
// today's package beats the target — the caller then falls back to a generic
// "reinvest at target" buy.
function pickPackageBuy(inventory, fitProfile, reinvestTarget) {
  if (!inventory || !inventory.rows) return null;
  let best = null;
  for (const [sector, map] of Object.entries(SWAP_SECTOR_MAP)) {
    const rows = Array.isArray(inventory.rows[map.rowsKey]) ? inventory.rows[map.rowsKey] : [];
    if (!rows.length) continue;
    const pick = pickBestOffering(rows, map.yieldKey, null, {
      fitProfile, held: null, sector, map, minYield: reinvestTarget
    });
    if (pick && (!best || pick.score > best.score)) best = { ...pick, sector, map };
  }
  if (!best) return null;
  return {
    label: offeringLabel(best.row, best.map.type),
    cusip: best.row.cusip || '',
    yield: Number(best.yld.toFixed(3)),
    price: offeringPrice(best.row, best.map.type),
    coupon: best.row.coupon ?? null,
    maturity: best.row.maturity || '',
    callDate: best.row.nextCallDate || best.row.callDate || '',
    sector: best.map.type,
    sourceRef: best.map.sourceRef,
    fitYear: (best.fit && best.fit.year) || null,
    fitSummary: (best.fit && best.fit.summary) || '',
    structure: best.row.structure || '',
    generic: false,
    availableToday: true
  };
}

// Build auto-suggested MULTI-SELL swap packages: bundle several underearning
// held CUSIPs (across sectors) into one swap that reinvests the combined
// proceeds into a single best-fit buy. Each package is gated on the desk's three
// tests — net annual income pickup, breakeven, and horizon — via
// swapMath.summarizeReinvestPackage. The buy targets the maturity/sector bucket
// that best fills the bank's ladder (pickPackageBuy); when nothing today beats
// the target, the package reinvests at the flat target rate.
//
// Greedy construction: worst earners first (lowest effective yield), add a lot
// only while the WHOLE package still clears every gate. Forward-only, so the
// result is deterministic and easy to explain. Returns [] when fewer than two
// lots can be bundled (a single lot is already covered by the per-bond cards).
function buildSwapPackages(kept, inventory, parsedHoldings, knobs, opts = {}) {
  if (!Array.isArray(kept) || kept.length < 2) return [];
  const capMonths = opts.packageBreakevenCapMonths ?? 24;
  // A package is a single client-facing one-pager, so cap how many lots it
  // bundles — a swap that dumps 50 CUSIPs at once isn't actionable. Worst
  // earners are admitted first, so the cap keeps the highest-value sells.
  const maxLegs = Math.max(2, opts.packageMaxLegs ?? 8);
  const reinvestTarget = knobs.reinvestTarget;
  if (reinvestTarget == null) return [];
  const fitProfile = buildInvestmentFitProfile(parsedHoldings, inventory && inventory.asOfDate);
  const buy = pickPackageBuy(inventory, fitProfile, reinvestTarget);
  const offering = buy || {
    label: `Reinvest at ${reinvestTarget.toFixed(2)}% target`,
    cusip: '', yield: Number(reinvestTarget.toFixed(3)), price: 100,
    coupon: null, maturity: '', callDate: '', sector: '',
    sourceRef: 'reinvest-target', fitYear: null,
    fitSummary: 'No single buy beats the target across the ladder today — reinvest the proceeds at the target rate.',
    structure: '', generic: true, availableToday: false
  };
  const buyYieldPct = offering.yield;

  const toMember = c => ({
    proceeds: c.economics ? c.economics.replacementPar : null,
    annualIncomeGivenUp: c.economics ? c.economics.annualIncomeGivenUp : null,
    realizedGainLoss: c.economics ? c.economics.realizedGainLoss : c.held.gainLoss,
    monthsToMaturity: c.held.monthsToMaturity,
    horizonYears: c.economics ? c.economics.horizonYears : null,
    par: c.held.par,
    marketValue: c.held.marketValue
  });

  // Worst earners are the best sells. Greedily admit a lot only if the package
  // still passes with it in.
  const pool = kept.slice().sort((a, b) => a.held.effYield - b.held.effYield);
  const members = [];
  for (const cand of pool) {
    if (members.length >= maxLegs) break;
    if (!cand.economics || cand.economics.replacementPar == null) continue;
    const trial = summarizeReinvestPackageMembers([...members, cand], buyYieldPct, capMonths, toMember);
    if (trial.passes) members.push(cand);
  }
  if (members.length < 2) return [];

  const economics = summarizeReinvestPackageMembers(members, buyYieldPct, capMonths, toMember);
  const sectorsSold = Array.from(new Set(members.map(m => m.sector)));
  const title = offering.generic
    ? `Sell ${members.length} lots → reinvest at ${reinvestTarget.toFixed(2)}%`
    : `Sell ${members.length} lots → ${offering.label}`;
  return [{
    id: 'PKG-1',
    title,
    sectorsSold,
    sells: members,          // full candidate objects — the UI seeds legs from these
    offering,
    economics,
    breakevenCapMonths: capMonths
  }];
}

function summarizeReinvestPackageMembers(candidates, buyYieldPct, capMonths, toMember) {
  return swapMath.summarizeReinvestPackage(candidates.map(toMember), {
    buyYieldPct,
    breakevenCapMonths: capMonths
  });
}

function appendHoldingFindings(out, parsedHoldings, P, runoff, knobs) {
  const all = flattenHoldings(parsedHoldings);
  const n0 = x => { const v = numericValue(x); return v == null ? 0 : v; };

  // 2b — Geographic (in-state) muni concentration
  {
    const munis = all.filter(b => /muni/i.test(b.sector || ''));
    const muniPar = munis.reduce((a, b) => a + n0(b.par), 0);
    if (muniPar > 0) {
      const st = {};
      munis.forEach(b => { const s = muniStateOf(b.description) || 'Other'; st[s] = (st[s] || 0) + n0(b.par); });
      const arr = Object.entries(st).map(([k, v]) => ({ st: k, par: v, pct: 100 * v / muniPar })).sort((a, b) => b.par - a.par);
      const home = arr.find(x => x.st !== 'Other') || arr[0];
      if (home && home.pct >= 40) {
        const sev = home.pct >= 60 ? 'med' : 'info';
        const others = arr.filter(x => x.st !== 'Other' && x.st !== home.st).slice(0, 3).map(x => `${htmlEsc(x.st)} ${rNum0(x.pct)}%`).join(', ');
        out.push({
          sev, badge: 'Geographic', title: `Municipals are ${rNum0(home.pct)}% concentrated in ${htmlEsc(home.st)}`,
          body: `Of the ${nNum('fr-num', rMM(muniPar))} muni book, ${nNum(sev === 'med' ? 'fr-neg' : 'fr-num', rNum1(home.pct) + '%')} (${nNum('fr-num', rMM(home.par))}) sits in <b>${htmlEsc(home.st)}</b> issuers${others ? `, with the rest scattered across ${others} and others` : ''}. Single-state concentration ties the book to one region's economy and tax base. Rotating a slice into comparable out-of-state GOs diversifies the credit exposure and puts a clean sell/buy pair in motion.`
        });
      }
    }
  }

  // 5 — Deep-discount holds (avoid swapping)
  {
    const withPct = all.map(b => ({ b, pct: holdingGlPct(b) })).filter(x => x.pct != null && x.pct < -15);
    const deep = withPct.sort((a, b) => a.pct - b.pct).slice(0, 5);
    if (deep.length) {
      const names = deep.map(x => `${htmlEsc(String(x.b.description || x.b.cusip || '').slice(0, 26))} (${rNum2(x.pct)}%, ${rK(Math.abs(n0(x.b.gainLoss)))})`).join('; ');
      out.push({
        sev: 'med', badge: 'Hold / Avoid', title: `${withPct.length} deep-discount positions to leave in place`,
        body: `Several positions show large <i>dollar</i> losses but at deep percentage discounts — selling them rarely passes the breakeven test, since the income lost over the bond's average life outweighs the reinvestment pickup. Examples to hold rather than swap: ${names}. The large dollar loss is tempting but the percentage loss makes breakeven too slow.`
      });
    }
  }

  // 6 — Extension / long-WAL exposure
  {
    const long = all.filter(b => n0(b.averageLife) >= 15).sort((a, b) => n0(b.averageLife) - n0(a.averageLife));
    if (long.length) {
      const lpar = long.reduce((a, b) => a + n0(b.par), 0);
      const longest = long[0];
      out.push({
        sev: P.totalPar && lpar / P.totalPar > 0.15 ? 'med' : 'info', badge: 'Extension Risk', title: `${long.length} positions beyond 15-yr average life`,
        body: `${nNum('fr-num', rMM(lpar))} (${nNum('fr-num', rNum1(P.totalPar ? 100 * lpar / P.totalPar : 0) + '%')} of par) sits past a 15-year WAL, led by ${htmlEsc(String(longest.description || '').slice(0, 30))} at ${nNum('fr-num', rNum1(n0(longest.averageLife)) + ' yrs')}. This is the part of the book most exposed to extension and the slowest to reprice if rates stay elevated — a natural source of swap sells when paired with low percentage losses.`
      });
    }
  }

  // 7 — Callable / negative convexity
  {
    const callable = all.filter(b => (b.nextCall && String(b.nextCall).trim()) || /call/i.test(b.couponType || ''));
    const negconv = all.filter(b => n0(b.effectiveConvexity) < 0);
    if (callable.length) {
      const cpar = callable.reduce((a, b) => a + n0(b.par), 0);
      out.push({
        sev: 'info', badge: 'Convexity', title: `Callable exposure of ${rMM(cpar)}`,
        body: `${nNum('fr-num', rNum0(callable.length))} positions (${nNum('fr-num', rMM(cpar))} par) are callable${negconv.length ? `, and ${negconv.length} carry negative convexity` : ''}. In a rally these get called away at the worst time for reinvestment; in a sell-off they extend. Worth confirming the call schedules before counting their yield as locked-in.`
      });
    }
  }

  // 9 — Runoff: maturities vs. modeled runoff (cashflow page)
  {
    const r = runoff;
    const h6label = r.asOf ? (() => { const d = new Date(`${r.asOf}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 6); return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); })() : '6 months out';
    const sev = (P.totalPar && (r.mat6 / P.totalPar) < 0.01) ? 'med' : 'info';
    const matTxt = `<b>Maturing within 6 months:</b> ${nNum('fr-num', rMM(r.mat6))} (${nNum('fr-num', rNum1(P.totalPar ? 100 * r.mat6 / P.totalPar : 0) + '%')} of par) reaches final stated maturity by ${h6label}.`;
    const runTxt = r.hasCashflow
      ? ` <b>Projected runoff (cashflow page, base case):</b> the portfolio's own projection — already embedding calls and amortization — returns ${nNum('fr-num', rMM(r.run6))} within 6 months and ${nNum('fr-num', rMM(r.run12))} within 12 months. That is a ${nNum('fr-num', rMM(r.run12))} reinvestment pipeline to fill over the next year, landing in pieces rather than at maturity. At ${nNum('fr-num', rPct(knobs.reinvestTarget))} versus the book's ${nNum('fr-num', rPct(P.wBookYtw))} yield, redeploying this runoff lifts portfolio income without realizing a dollar of loss — the easiest buy conversation on the page.`
      : ` <i>(No cashflow-data sheet found in this file, so modeled runoff incl. calls could not be read — maturities shown reflect stated maturity dates only.)</i>`;
    out.push({ sev, badge: 'Runoff', title: 'Near-term runoff vs. stated maturities', body: matTxt + runTxt });
  }
}

function handleSwapSuggested(res, bankId, query) {
  const ctx = getSwapBankContext(bankId);
  if (!ctx) return sendJSON(res, 404, { error: 'Bank not found' });
  if (!ctx.parsedHoldings) {
    return sendJSON(res, 200, {
      bankId,
      bankName: ctx.summary.displayName || ctx.summary.name || 'Bank',
      isSubchapterS: ctx.summary.subchapterS === 'Yes',
      holdingsAvailable: false,
      kept: [],
      dropped: [],
      rules: swapMath.DEFAULT_FBBS_RULES,
      notice: 'No bond accounting holdings on file for this bank — upload a portfolio workbook before generating suggested swaps.'
    });
  }
  const rules = {
    breakevenSoftCapMonths: parseInt(query.get('breakevenSoftCap'), 10)
      || swapMath.DEFAULT_FBBS_RULES.breakevenSoftCapMonths,
    maturitySoftFloorMonths: parseInt(query.get('maturitySoftFloor'), 10)
      || swapMath.DEFAULT_FBBS_RULES.maturitySoftFloorMonths
  };
  // Optional tuning knobs — blank/absent means "use the detector defaults".
  const optNum = (raw) => {
    if (raw == null || String(raw).trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const isSubS = ctx.summary.subchapterS === 'Yes';
  // Tax rate: default from the bank's Sub-S election, rep-overridable.
  const taxRatePct = optNum(query.get('taxRate')) ?? (isSubS ? 29.6 : 21);
  // BQ disallowance factor q — exactly the Master Swap Template's CQ cell:
  //   C-Corp: bank-qualified 0.20 / non-BQ 1.00; S-Corp: BQ 0 / non-BQ 1.00.
  // The template drives corp type and tax rate from one switch (D28), so we key
  // q off the effective tax rate (29.6% Sub-S vs 21% C-corp) — overriding the
  // rate to the Sub-S level flips q too, like the template. `bq` carries the
  // rep's bank-qualified choice (<=0.5 means bank-qualified).
  const isSubSRate = taxRatePct >= 25;
  const bqChoice = optNum(query.get('bq'));
  const isBankQualified = bqChoice == null ? true : bqChoice <= 0.5;
  const bqFactor = isBankQualified ? (isSubSRate ? 0 : 0.20) : 1.0;
  // Knobs — the rest mirror the Portfolio Filtering prototype. Blank params fall back.
  const knobs = {
    taxRatePct,
    cofPct: optNum(query.get('cof')) ?? 1.5,
    bqFactor,
    isBankQualified,
    maxPctLoss: optNum(query.get('maxPctLoss')) ?? 4.0,
    maxDollarLoss: optNum(query.get('maxDollarLoss')) ?? 10,   // $000
    minParThousands: optNum(query.get('minPar')) ?? 100,       // $000
    reinvestRate: undefined
  };
  const reinvestRate = optNum(query.get('reinvestRate'));
  if (reinvestRate != null && reinvestRate > 0) knobs.reinvestRate = reinvestRate;

  const result = findSwapCandidates(ctx.parsedHoldings, ctx.inventory, {
    includeRejected: true,
    rules,
    // Pull the full screened set so the blotter + CSV see everything; the UI
    // renders the top handful as cards.
    limit: parseInt(query.get('limit'), 10) || 200,
    reinvestRate: knobs.reinvestRate,
    minPickupVsBook: optNum(query.get('minPickup')),
    smallGlPct: optNum(query.get('smallGlPct')),
    taxRatePct: knobs.taxRatePct,
    cofPct: knobs.cofPct,
    bqFactor: knobs.bqFactor,
    maxPctLoss: knobs.maxPctLoss,
    maxDollarLoss: knobs.maxDollarLoss,
    minParThousands: knobs.minParThousands
  });

  // The reinvestment target actually used (knob, else auto from inventory).
  knobs.reinvestTarget = result.reinvestTarget;
  const report = buildSwapPortfolioReport(ctx.parsedHoldings, result, knobs);
  // Auto-suggested multi-sell packages (sell several lots → one best-fit buy),
  // gated on net income, breakeven, and horizon. Cap is rep-overridable.
  const packageBreakevenCapMonths = parseInt(query.get('packageBreakevenCap'), 10) || 24;
  const packageMaxLegs = parseInt(query.get('packageMaxLegs'), 10) || 8;
  const packages = buildSwapPackages(result.kept, ctx.inventory, ctx.parsedHoldings, knobs, {
    packageBreakevenCapMonths,
    packageMaxLegs
  });

  return sendJSON(res, 200, {
    bankId,
    bankName: ctx.summary.displayName || ctx.summary.name || 'Bank',
    isSubchapterS: isSubS,
    taxRate: knobs.taxRatePct,
    holdingsAvailable: true,
    holdingsReportDate: ctx.parsedHoldings.asOfDate || '',
    holdingsTotalPositions: ctx.parsedHoldings.aggregates ? ctx.parsedHoldings.aggregates.totalPositions : 0,
    kept: result.kept,
    dropped: result.dropped,
    packages,
    reinvestTarget: result.reinvestTarget,
    reinvestTargetSource: result.reinvestTargetSource,
    knobs: {
      taxRatePct: knobs.taxRatePct,
      cofPct: knobs.cofPct,
      bqFactor: knobs.bqFactor,
      reinvestRatePct: knobs.reinvestTarget,
      reinvestRateUserSet: knobs.reinvestRate != null,
      maxPctLoss: knobs.maxPctLoss,
      maxDollarLossK: knobs.maxDollarLoss,
      minParK: knobs.minParThousands
    },
    profile: report.profile,
    runoff: report.runoff,
    hero: report.hero,
    findings: report.findings,
    rules
  });
}

// Flattened view of today's buyable inventory keyed by CUSIP. Used by the
// inline editor's buy-side picker so the rep can search across all sectors
// at once. Pulled from the existing per-sector parsed JSONs in
// `currentInventorySnapshot` — no new data ingest needed.
function listSwapInventory(stateCode) {
  const inventory = currentInventorySnapshot(stateCode);
  if (!inventory || !inventory.rows) return [];
  const flatten = [];
  const seen = new Set();
  const pushRow = (row, sector, sourceRef, description) => {
    if (!row || !row.cusip) return;
    const cusip = String(row.cusip).toUpperCase();
    if (seen.has(cusip)) return;
    seen.add(cusip);
    flatten.push({
      sector,
      cusip,
      description: description || '',
      coupon: row.coupon != null ? Number(row.coupon) : null,
      maturity: row.maturity || '',
      callDate: row.nextCallDate || row.callDate || '',
      par: row.availableSize != null ? Number(row.availableSize) * 1000 : null,
      marketPrice: row.askPrice != null ? Number(row.askPrice) : (row.price != null ? Number(row.price) : null),
      marketYieldYtw: row.ytw != null ? Number(row.ytw)
        : (row.ytnc != null ? Number(row.ytnc)
        : (row.ytm != null ? Number(row.ytm) : null)),
      marketYieldYtm: row.ytm != null ? Number(row.ytm) : null,
      averageLife: row.averageLife != null ? Number(row.averageLife) : null,
      sourceKind: 'daily-package',
      sourceRef
    });
  };

  // Agencies: combined `agencies` array with row.structure = 'Bullet' or 'Callable'
  for (const row of (inventory.rows.agencies || [])) {
    const struct = String(row.structure || '').toLowerCase();
    const sector = struct === 'callable' ? 'Agency Callable' : 'Agency Bullet';
    const ref = struct === 'callable' ? '_agencies.json#callables' : '_agencies.json#bullets';
    const descr = [row.ticker, row.structure, row.maturity].filter(Boolean).join(' ');
    pushRow(row, sector, ref, descr);
  }
  for (const row of (inventory.rows.corporates || [])) {
    const descr = [row.issuerName, row.maturity ? `due ${row.maturity}` : ''].filter(Boolean).join(' ');
    pushRow(row, 'Corporate', '_corporates.json', descr);
  }
  for (const row of (inventory.rows.stateMunis || [])) {
    const descr = [row.issuer, row.maturity ? `due ${row.maturity}` : ''].filter(Boolean).join(' ');
    pushRow(row, 'Muni (in-state)', '_muni_offerings.json#stateMunis', descr);
  }
  for (const row of (inventory.rows.munis || [])) {
    const descr = [row.issuer, row.maturity ? `due ${row.maturity}` : ''].filter(Boolean).join(' ');
    pushRow(row, 'Muni', '_muni_offerings.json', descr);
  }
  for (const row of (inventory.rows.treasuries || [])) {
    const descr = ['Treasury', row.coupon ? row.coupon + '%' : '', row.maturity ? `due ${row.maturity}` : ''].filter(Boolean).join(' ');
    pushRow(row, 'Treasury', '_treasury_notes.json', descr);
  }
  for (const row of (inventory.rows.cds || [])) {
    const descr = [row.issuer, row.maturity ? `due ${row.maturity}` : ''].filter(Boolean).join(' ');
    pushRow(row, 'CD', '_offerings.json', descr);
  }
  return flatten.sort((a, b) => a.cusip.localeCompare(b.cusip));
}

function handleSwapInventory(res, query) {
  try {
    const stateCode = String(query.get('state') || '').toUpperCase() || null;
    const inventory = listSwapInventory(stateCode);
    return sendJSON(res, 200, { count: inventory.length, inventory });
  } catch (err) {
    return sendJSON(res, 500, { error: err.message });
  }
}

function mapSwapHoldingPosition(row, sector) {
  return {
    sector,
    cusip: row.cusip || '',
    description: row.description || '',
    coupon: row.coupon || null,
    maturity: row.maturity || '',
    callDate: row.callDate || '',
    par: row.par || 0,
    bookPrice: row.bookPrice || null,
    marketPrice: row.marketPrice || null,
    bookYieldYtm: row.bookYieldYtm || null,
    bookYieldYtw: row.bookYieldYtw || null,
    marketYieldYtm: row.marketYieldYtm || null,
    marketYieldYtw: row.marketYieldYtw || null,
    // Parser stores the workbook's "Eff. Dur" column as effectiveDuration;
    // legs carry it under modifiedDuration to match swap-store's schema.
    modifiedDuration: row.effectiveDuration ?? null,
    averageLife: row.averageLife || null,
    gainLoss: row.gainLoss || 0,
    bookValue: row.bookValue || null,
    marketValue: row.marketValue || null
  };
}

function handleSwapHoldings(res, bankId) {
  const ctx = getSwapBankContext(bankId);
  if (!ctx) return sendJSON(res, 404, { error: 'Bank not found' });
  if (!ctx.parsedHoldings) return sendJSON(res, 200, { available: false });
  const positions = [];
  for (const [sector, rows] of Object.entries(ctx.parsedHoldings.sectors || {})) {
    for (const row of rows) {
      positions.push(mapSwapHoldingPosition(row, sector));
    }
  }
  return sendJSON(res, 200, {
    available: true,
    reportDate: ctx.parsedHoldings.asOfDate || '',
    totalPositions: positions.length,
    positions
  });
}

async function handleMbsCmoUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), MAX_UPLOAD_BYTES);
    if (!files.length) return sendJSON(res, 400, { error: 'Choose at least one MBS/CMO source file' });

    for (const file of files) {
      const signatureError = validateMbsCmoFileSignature(file);
      if (signatureError) return sendJSON(res, 400, { error: signatureError });
    }

    for (const file of files) {
      if (path.extname(file.filename || '').toLowerCase() !== '.pdf') continue;
      try {
        const result = await extractPdfText(file.data);
        file.pdfText = result.text || '';
      } catch (err) {
        log('warn', 'MBS/CMO PDF extraction failed for', file.filename, err.message);
        file.pdfText = '';
      }
    }

    const inventory = saveMbsCmoUpload(MBS_CMO_DIR, files);
    appendAuditLog({
      event: 'mbs-cmo-upload',
      files: files.map(file => ({
        filename: sanitizeFilename(file.filename),
        size: file.data.length
      })),
      parsedOffers: inventory.uploadedOffers.length,
      warnings: inventory.uploadWarnings
    });
    return sendJSON(res, 200, inventory);
  } catch (err) {
    log('error', 'MBS/CMO upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not upload MBS/CMO files' });
  }
}

async function handleBankDataUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), BANK_UPLOAD_MAX_BYTES);
    const file = files.find(f => /\.(xlsm|xlsx|xls)$/i.test(f.filename));
    if (!file) return sendJSON(res, 400, { error: 'Upload a bank workbook (.xlsm, .xlsx, or .xls).' });
    if (!looksLikeExcel(file.data)) {
      return sendJSON(res, 400, { error: `${file.filename} does not look like an Excel workbook.` });
    }

    const target = path.join(BANK_REPORTS_DIR, BANK_WORKBOOK_FILENAME);
    const tmpTarget = path.join(BANK_REPORTS_DIR, `${BANK_WORKBOOK_FILENAME}.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmpTarget, file.data);
    const metadata = await importBankWorkbook(tmpTarget, BANK_REPORTS_DIR, {
      sourceFile: sanitizeFilename(file.filename)
    });
    fs.renameSync(tmpTarget, target);
    invalidatePeerComparisonCache();
    invalidateBankCaches();
    appendAuditLog({
      event: 'bank-data-import',
      sourceFile: sanitizeFilename(file.filename),
      bankCount: metadata.bankCount,
      rowCount: metadata.rowCount,
      latestPeriod: metadata.latestPeriod
    });
    return sendJSON(res, 200, { success: true, metadata });
  } catch (err) {
    try {
      const staleTemps = fs.readdirSync(BANK_REPORTS_DIR)
        .filter(name => name.startsWith(`${BANK_WORKBOOK_FILENAME}.tmp-`));
      staleTemps.forEach(name => fs.rmSync(path.join(BANK_REPORTS_DIR, name), { force: true }));
    } catch (_) {}
    log('error', 'Bank workbook upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Bank workbook import failed' });
  }
}

async function handleBankStatusUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), BANK_UPLOAD_MAX_BYTES);
    const file = files.find(f => /\.(xlsb|xlsm|xlsx|xls)$/i.test(f.filename));
    if (!file) return sendJSON(res, 400, { error: 'Upload an account status workbook (.xlsb, .xlsm, .xlsx, or .xls).' });
    if (!looksLikeExcel(file.data)) {
      return sendJSON(res, 400, { error: `${file.filename} does not look like an Excel workbook.` });
    }

    const bankSummaries = listBankSummaries(BANK_REPORTS_DIR);
    if (!bankSummaries.length) {
      return sendJSON(res, 400, { error: 'Import bank call report data before importing account statuses.' });
    }

    const metadata = importBankAccountStatusWorkbook(BANK_REPORTS_DIR, file.data, bankSummaries, {
      sourceFile: sanitizeFilename(file.filename)
    });
    const hasServicesData = Boolean(
      metadata.ownerCount ||
      metadata.servicesCount ||
      metadata.affiliateCount ||
      metadata.bankersBankServicesCount
    );
    const target = path.join(
      BANK_REPORTS_DIR,
      hasServicesData ? BANK_SERVICES_WORKBOOK_FILENAME : BANK_STATUS_WORKBOOK_FILENAME
    );
    fs.writeFileSync(target, file.data);
    appendAuditLog({
      event: 'bank-account-status-import',
      sourceFile: sanitizeFilename(file.filename),
      importedCount: metadata.importedCount,
      unmatchedCount: metadata.unmatchedCount,
      ownerCount: metadata.ownerCount,
      servicesCount: metadata.servicesCount,
      affiliateCount: metadata.affiliateCount,
      bankersBankServicesCount: metadata.bankersBankServicesCount
    });
    invalidateBankCaches();
    return sendJSON(res, 200, { success: true, metadata });
  } catch (err) {
    log('error', 'Bank account status upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Bank account status import failed' });
  }
}

async function handleAveragedSeriesUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), BANK_UPLOAD_MAX_BYTES);
    const file = files.find(f => /\.(xlsm|xlsx|xls)$/i.test(f.filename));
    if (!file) return sendJSON(res, 400, { error: 'Upload an averaged-series workbook (.xlsm, .xlsx, or .xls).' });
    if (!looksLikeExcel(file.data)) {
      return sendJSON(res, 400, { error: `${file.filename} does not look like an Excel workbook.` });
    }

    fs.mkdirSync(BANK_REPORTS_DIR, { recursive: true });
    const tmpTarget = path.join(BANK_REPORTS_DIR, `averaged-series-upload.tmp-${process.pid}-${Date.now()}${path.extname(file.filename || '.xlsm') || '.xlsm'}`);
    fs.writeFileSync(tmpTarget, file.data);
    const metadata = saveAveragedSeriesWorkbook(BANK_REPORTS_DIR, tmpTarget, {
      sourceFile: sanitizeFilename(file.filename)
    });
    fs.rmSync(tmpTarget, { force: true });
    invalidatePeerComparisonCache();
    invalidateBankCaches();
    appendAuditLog({
      event: 'averaged-series-import',
      sourceFile: sanitizeFilename(file.filename),
      latestPeriod: metadata.latestPeriod,
      metricCount: metadata.metricCount,
      populationCount: metadata.populationCount
    });
    return sendJSON(res, 200, { success: true, metadata });
  } catch (err) {
    try {
      const staleTemps = fs.readdirSync(BANK_REPORTS_DIR)
        .filter(name => name.startsWith('averaged-series-upload.tmp-'));
      staleTemps.forEach(name => fs.rmSync(path.join(BANK_REPORTS_DIR, name), { force: true }));
    } catch (_) {}
    log('error', 'Averaged-series workbook upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Averaged-series workbook import failed' });
  }
}

// Map the portal's already-ingested Economic Update into the small market shape
// the exec-summary overlay expects (reuse — no new external feed). Best-effort:
// returns null when nothing usable is present.
function marketFromEconomicUpdate(econ) {
  if (!econ || typeof econ !== 'object') return null;
  const ust = {};
  const tmap = { 2: 'ust_2y', 5: 'ust_5y', 10: 'ust_10y', 30: 'ust_30y' };
  if (Array.isArray(econ.treasuries)) {
    for (const t of econ.treasuries) {
      const m = String(t.tenor || '').match(/(\d+)\s*(?:yr|y|year)/i);
      const key = m && tmap[Number(m[1])];
      if (key && t.yield != null) ust[key] = Number(t.yield);
    }
  }
  const rates = Array.isArray(econ.marketRates) ? econ.marketRates : [];
  const findRate = re => { const r = rates.find(x => re.test(String(x.label || ''))); return r && r.value != null ? Number(r.value) : null; };
  const market = {
    ust,
    sofr: findRate(/sofr/i),
    fedFunds: findRate(/fed.?funds|fed funds target|fff/i),
    igOas: findRate(/\big\b|investment grade|cdx ig/i),
    hyOas: findRate(/\bhy\b|high yield/i),
    note: econ.asOfDate ? `Reusing portal Economic Update (as of ${econ.asOfDate})` : 'Reusing portal Economic Update',
  };
  return (Object.keys(ust).length || market.sofr != null) ? market : null;
}

// Market overlay from the official Treasury par curve (market-rates.js) —
// fallback when the daily package has no parsed Economic Update. Same shape
// as marketFromEconomicUpdate so downstream consumers don't care which fed it.
function marketFromOfficialCurve(curve) {
  if (!curve || !curve.tenors) return null;
  const ust = {};
  const tmap = { '2Y': 'ust_2y', '5Y': 'ust_5y', '10Y': 'ust_10y', '30Y': 'ust_30y' };
  for (const [tenor, key] of Object.entries(tmap)) {
    if (curve.tenors[tenor] != null) ust[key] = Number(curve.tenors[tenor]);
  }
  if (!Object.keys(ust).length) return null;
  return {
    ust,
    sofr: null,
    fedFunds: null,
    igOas: null,
    hyOas: null,
    note: `Official Treasury par yield curve (as of ${curve.asOfDate})`,
  };
}

// Economic Update overlay if today's package has one, official Treasury
// curve otherwise. Never throws — overlay is always optional.
async function loadMarketOverlay() {
  let market = null;
  try { market = marketFromEconomicUpdate(await loadCurrentEconomicUpdate()); } catch (_) { /* overlay optional */ }
  if (!market) {
    try {
      market = marketFromOfficialCurve(await marketRates.getLatestYieldCurve({ marketDir: MARKET_DIR, log }));
    } catch (_) { /* overlay optional */ }
  }
  return market;
}

// ---------- CUSIP-first global search ----------

// One place that knows where every security in today's inventory lives.
// Each source: the rows to scan, the SPA page that renders them, and a
// one-line description for the search dropdown. All sources are served
// from the already-memoized slot caches / small JSON files — cheap enough
// to scan per keystroke on a LAN.
function cusipSearchSources() {
  const slot = (filename, label) => readCurrentSlotJson(filename, label) || {};
  const fmtPct = v => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}%` : null);
  const join = parts => parts.filter(Boolean).join(' · ');
  const pct = v => {
    const n = Number(String(v ?? '').replace(/%/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  // Each source also carries normalize(row) → the cross-asset All Offerings
  // row shape: { description, coupon, yield, maturity, price, state, sector }.
  // `yield` is the asset's quoted economic yield (CD rate, muni YTW, agency/
  // corporate YTM, MBS yield, structured-note coupon).
  return [
    {
      type: 'cd', typeLabel: 'CD Offering', page: 'explorer',
      rows: slot(OFFERINGS_FILENAME, 'offerings').offerings || [],
      describe: r => join([r.name, r.term, fmtPct(r.rate), r.maturity]),
      normalize: r => ({ description: join([r.name, r.term]), coupon: null, yield: pct(r.rate), maturity: r.maturity || null, price: null, state: r.issuerState || '', sector: 'CD' }),
    },
    {
      type: 'treasury', typeLabel: 'Treasury', page: 'treasury-explorer',
      rows: slot(TREASURY_NOTES_FILENAME, 'treasury notes').notes || [],
      describe: r => join([r.description, fmtPct(r.yield) && `${fmtPct(r.yield)} YTM`, r.maturity]),
      normalize: r => ({ description: r.description || '', coupon: pct(r.coupon), yield: pct(r.yield), maturity: r.maturity || null, price: pct(r.price), state: '', sector: 'UST' }),
    },
    {
      type: 'muni', typeLabel: 'Muni', page: 'muni-explorer',
      rows: slot(MUNI_OFFERINGS_FILENAME, 'muni offerings').offerings || [],
      describe: r => join([r.issuerName, fmtPct(r.coupon), r.maturity, fmtPct(r.ytw) && `${fmtPct(r.ytw)} YTW`]),
      normalize: r => ({ description: r.issuerName || '', coupon: pct(r.coupon), yield: pct(r.ytw) ?? pct(r.ytm), maturity: r.maturity || null, price: pct(r.price), state: r.issuerState || '', sector: r.section || 'Muni' }),
    },
    {
      type: 'agency', typeLabel: 'Agency', page: 'agencies',
      rows: slot(AGENCIES_FILENAME, 'agencies').offerings || [],
      describe: r => join([r.ticker, r.structure, fmtPct(r.coupon), r.maturity]),
      normalize: r => ({ description: join([r.ticker, r.structure]), coupon: pct(r.coupon), yield: pct(r.ytm) ?? pct(r.ytnc), maturity: r.maturity || null, price: pct(r.askPrice), state: '', sector: r.structure || 'Agency' }),
    },
    {
      type: 'corporate', typeLabel: 'Corporate', page: 'corporates',
      rows: slot(CORPORATES_FILENAME, 'corporates').offerings || [],
      describe: r => join([r.issuerName, fmtPct(r.coupon), r.maturity]),
      normalize: r => ({ description: r.issuerName || '', coupon: pct(r.coupon), yield: pct(r.ytm) ?? pct(r.ytnc), maturity: r.maturity || null, price: pct(r.askPrice), state: '', sector: r.sector || 'Corporate' }),
    },
    {
      type: 'mbs', typeLabel: 'MBS/CMO', page: 'mbs-cmo',
      rows: (loadMbsCmoInventory(MBS_CMO_DIR) || {}).offers || [],
      describe: r => join([r.description, fmtPct(r.coupon), r.productType]),
      normalize: r => ({ description: r.description || '', coupon: pct(r.coupon), yield: pct(r.yield), maturity: r.maturityDate || null, price: pct(r.ask) ?? pct(r.price), state: '', sector: r.productType || 'MBS' }),
    },
    {
      type: 'structured-note', typeLabel: 'Structured Note', page: 'structured-notes',
      rows: (loadStructuredNotesInventory(STRUCTURED_NOTES_DIR) || {}).notes || [],
      describe: r => join([r.issuer, r.structure, fmtPct(r.coupon), r.maturityDate]),
      normalize: r => ({ description: join([r.issuer, r.structure]), coupon: pct(r.coupon), yield: pct(r.coupon), maturity: r.maturityDate || null, price: pct(r.price), state: '', sector: r.structure || 'Structured' }),
    },
  ];
}

// Cross-asset inventory: every security in today's package + standing
// inventories, normalized to one row shape for the All Offerings explorer.
function buildAllOfferingsRows() {
  const rows = [];
  for (const source of cusipSearchSources()) {
    for (const raw of source.rows) {
      const n = source.normalize(raw);
      rows.push({
        assetClass: source.typeLabel,
        type: source.type,
        page: source.page,
        cusip: String(raw.cusip || '').trim(),
        ...n,
      });
    }
  }
  return rows;
}

// Find a CUSIP anywhere in today's inventory. Prefix match first (a rep
// typing the first characters), falling back to substring. Returns at most
// `limit` hits across all sources so the dropdown stays scannable.
function searchCusipEverywhere(rawQuery, limit = 20) {
  const needle = String(rawQuery || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
  if (needle.length < 4) return { query: needle, results: [] };
  const perSource = 6;
  const collect = matchFn => {
    const out = [];
    for (const source of cusipSearchSources()) {
      let count = 0;
      for (const row of source.rows) {
        const cusip = String(row.cusip || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
        if (!cusip || !matchFn(cusip)) continue;
        out.push({
          cusip,
          type: source.type,
          typeLabel: source.typeLabel,
          page: source.page,
          description: source.describe(row) || '',
        });
        count += 1;
        if (count >= perSource || out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return out;
  };
  let results = collect(c => c.startsWith(needle));
  if (!results.length) results = collect(c => c.includes(needle));
  return { query: needle, results };
}

// ---------- Salesforce contacts CSV import ----------

// Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, CR/LF rows.
// Returns an array of objects keyed by lowercased/trimmed header names.
function parseCsvText(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = String(cols[idx] ?? '').trim(); });
    return obj;
  });
}

// Normalize a bank/account name for fuzzy matching between a Salesforce
// "Account Name" and our bank display/legal names: lowercase, strip
// punctuation, drop legal-suffix noise. "Bank" itself stays — it's signal.
function normalizeBankNameForMatch(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,'&/()-]/g, ' ')
    .replace(/\b(the|inc|incorporated|na|n a|national association|company|co|corp|corporation|ssb|fsb)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Import a Salesforce contact-export CSV: match each row's Account Name to a
// bank (display or legal name, normalized), dedupe against existing contacts
// (same bank + email, or same bank + name), and create bank_contacts rows.
// dryRun reports what would happen without writing.
function importSalesforceContacts(csvText, { dryRun = false } = {}) {
  const rows = parseCsvText(csvText);
  if (!rows.length) return { error: 'No data rows found in the CSV.' };

  const get = (row, names) => {
    for (const n of names) { if (row[n]) return row[n]; }
    return '';
  };

  // Bank name → ids index (display + legal names; collisions marked ambiguous).
  const summaries = listBankSummaries(BANK_REPORTS_DIR);
  const summaryById = new Map(summaries.map(s => [String(s.id), s]));
  const nameIndex = new Map();
  for (const s of summaries) {
    for (const candidate of [s.displayName, s.name, s.displayName && s.city ? `${s.displayName} ${s.city}` : null]) {
      const key = normalizeBankNameForMatch(candidate);
      if (!key) continue;
      if (!nameIndex.has(key)) nameIndex.set(key, new Set());
      nameIndex.get(key).add(String(s.id));
    }
  }

  // Existing-contact dedup keys.
  const existing = listAllContacts(BANK_REPORTS_DIR);
  const seen = new Set();
  for (const c of existing) {
    if (c.email) seen.add(`${c.bankId}|e|${c.email.toLowerCase()}`);
    if (c.name) seen.add(`${c.bankId}|n|${c.name.toLowerCase()}`);
  }

  const result = { totalRows: rows.length, created: 0, duplicates: 0, unmatched: 0, unmatchedSamples: [], dryRun };
  for (const row of rows) {
    const first = get(row, ['first name', 'firstname']);
    const last = get(row, ['last name', 'lastname']);
    const name = get(row, ['full name', 'name', 'contact name']) || [first, last].filter(Boolean).join(' ');
    const account = get(row, ['account name', 'company / account', 'account', 'company']);
    if (!name) continue;
    if (!account) {
      result.unmatched += 1;
      if (result.unmatchedSamples.length < 25) result.unmatchedSamples.push({ name, account: '', reason: 'No account name on the row' });
      continue;
    }
    const ids = nameIndex.get(normalizeBankNameForMatch(account));
    if (!ids || !ids.size) {
      result.unmatched += 1;
      if (result.unmatchedSamples.length < 25) result.unmatchedSamples.push({ name, account, reason: 'No bank matched this account name' });
      continue;
    }
    if (ids.size > 1) {
      result.unmatched += 1;
      if (result.unmatchedSamples.length < 25) result.unmatchedSamples.push({ name, account, reason: `Ambiguous — matches ${ids.size} banks` });
      continue;
    }
    const bankId = [...ids][0];
    const email = get(row, ['email', 'email address']).toLowerCase();
    if ((email && seen.has(`${bankId}|e|${email}`)) || seen.has(`${bankId}|n|${name.toLowerCase()}`)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(`${bankId}|n|${name.toLowerCase()}`);
    if (email) seen.add(`${bankId}|e|${email}`);
    if (!dryRun) {
      createBankContact(BANK_REPORTS_DIR, summaryById.get(bankId), {
        name,
        role: get(row, ['title', 'role', 'job title']),
        phone: get(row, ['phone', 'business phone', 'mobile', 'mobile phone']),
        email: get(row, ['email', 'email address']),
        notes: 'Imported from Salesforce'
      });
    }
    result.created += 1;
  }
  return result;
}

async function handleContactsImport(req, res, dryRun) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });
  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), MAX_UPLOAD_BYTES);
    const csv = files.find(f => /\.csv$/i.test(f.filename || '')) || files[0];
    if (!csv || !csv.data) return sendJSON(res, 400, { error: 'Upload a Salesforce contact-export CSV.' });
    const result = importSalesforceContacts(csv.data.toString('utf-8'), { dryRun });
    if (result.error) return sendJSON(res, 400, result);
    if (!dryRun && result.created > 0) {
      appendAuditLog({ event: 'contacts-import', source: sanitizeFilename(csv.filename || 'contacts.csv'), ...{ totalRows: result.totalRows, created: result.created, duplicates: result.duplicates, unmatched: result.unmatched } });
    }
    return sendJSON(res, 200, result);
  } catch (err) {
    log('error', 'Contacts import failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Contacts import failed' });
  }
}

// Identify which of the Executive Summary files an upload is, by content (the grid
// filenames are opaque hashes). Fallback for when the form field name is absent.
// Content-classify one of the Executive Summary daily inputs from a raw
// workbook buffer. Keys on sheet/header signatures so it survives the generic
// "grid1_<hash>.xlsx" Bloomberg filenames that carry no slot hint. Returns
// 'inventory' | 'activity' | 'sector' | 'margin' | null. Shared by the
// labeled-picker upload route and the folder-drop scan.
function classifyExecSummaryBuffer(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const names = wb.SheetNames || [];
    if (names.includes('MAIN') && names.includes('TOTAL_HAIRCUTS')) return 'margin';
    const ws = wb.Sheets[names[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    const hdr = (rows[0] || []).map(h => String(h || '').toLowerCase());
    const has = s => hdr.some(h => h.includes(s));
    if (has('industry sector') && has('market sector')) return 'sector';
    if (has('salesperson') && has('customer type')) return 'activity';
    if (has('cusip(s)') && (has('p & l') || has('bidprice'))) return 'inventory';
  } catch (_) { /* fall through to null */ }
  return null;
}

function classifyExecSummaryFile(file) {
  return classifyExecSummaryBuffer(file && file.data);
}

// Human labels for exec-summary slots (folder-drop scan + UI). The three
// required sources are inventory, TBLT trades, and margin; TH activity remains
// accepted as optional legacy revenue detail when it is dropped in too.
const EXEC_SUMMARY_SLOT_LABELS = {
  inventory: 'Inventory & risk grid',
  activity: 'TH trade activity (optional)',
  sector: 'TBLT trades',
  margin: 'Net-capital margin workbook'
};

const EXEC_SUMMARY_REQUIRED_SLOTS = ['inventory', 'sector', 'margin'];

// Management-only: ingest the daily files, compute + persist one COB-dated
// executive-summary snapshot (idempotent), and return it. Admin-gated via the
// FBBS_ADMIN_USERS allowlist (see isAdminOnlyApiWrite).
async function handleExecSummaryUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  const tmpPaths = [];
  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), BANK_UPLOAD_MAX_BYTES);
    const excel = files.filter(f => /\.(xlsm|xlsx|xls)$/i.test(f.filename || ''));
    if (!excel.length) return sendJSON(res, 400, { error: 'Upload the three Executive Summary files (.xlsx / .xlsm).' });
    for (const f of excel) {
      if (!looksLikeExcel(f.data)) return sendJSON(res, 400, { error: `${f.filename} does not look like an Excel workbook.` });
    }

    const slots = { inventory: null, activity: null, sector: null, margin: null };
    for (const f of excel) {
      const byField = ['inventory', 'activity', 'sector', 'margin'].includes(f.fieldName) ? f.fieldName : null;
      const slot = byField || classifyExecSummaryFile(f);
      if (slot && !slots[slot]) slots[slot] = f;
    }
    const missing = EXEC_SUMMARY_REQUIRED_SLOTS.filter(k => !slots[k]);
    if (missing.length) {
      return sendJSON(res, 400, { error: `Could not identify the Executive Summary file(s) for: ${missing.map(k => EXEC_SUMMARY_SLOT_LABELS[k] || k).join(', ')}. Use the labeled pickers, or confirm the Bloomberg / margin-calc exports.` });
    }

    fs.mkdirSync(EXEC_SUMMARY_DIR, { recursive: true });
    const writeTmp = (f, tag) => {
      const ext = path.extname(f.filename || '') || '.xlsx';
      const p = path.join(EXEC_SUMMARY_DIR, `exec-upload.tmp-${tag}-${process.pid}-${Date.now()}${ext}`);
      fs.writeFileSync(p, f.data);
      tmpPaths.push(p);
      return p;
    };
    const paths = {
      inventoryPath: writeTmp(slots.inventory, 'inv'),
      sectorPath: writeTmp(slots.sector, 'sec'),
      marginPath: writeTmp(slots.margin, 'mgn'),
    };
    if (slots.activity) paths.activityPath = writeTmp(slots.activity, 'act');

    const market = await loadMarketOverlay();

    const summary = execSummaryStore.ingestExecSummary(EXEC_SUMMARY_DIR, paths, {
      market,
      sourceFiles: {
        inventory: sanitizeFilename(slots.inventory.filename),
        activity: slots.activity ? sanitizeFilename(slots.activity.filename) : null,
        trades: sanitizeFilename(slots.sector.filename),
        sector: sanitizeFilename(slots.sector.filename),
        margin: sanitizeFilename(slots.margin.filename),
      },
    });

    appendAuditLog({
      event: 'exec-summary-import',
      asOfDate: summary.asOfDate,
      cobDate: summary.cobDate,
      sourceFiles: summary.sourceFiles,
      warnings: summary.warnings,
      ...(auditActorForRequest(req) || {}),
    });
    return sendJSON(res, 200, { success: true, asOfDate: summary.asOfDate, summary });
  } catch (err) {
    log('error', 'Exec summary upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Executive summary import failed' });
  } finally {
    for (const p of tmpPaths) { try { fs.rmSync(p, { force: true }); } catch (_) {} }
  }
}

async function handleBondAccountingUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  let tmpDir = '';
  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), BANK_UPLOAD_MAX_BYTES);
    const bankListFile = files.find(f => f.fieldName === 'bondBankList' || /bank.*list/i.test(f.filename || ''));
    const portfolioFiles = files.filter(f => f !== bankListFile && /\.(xlsm|xlsx|xls)$/i.test(f.filename || ''));

    if (!bankListFile) return sendJSON(res, 400, { error: 'Upload the bond-accounting bank list workbook.' });
    if (!portfolioFiles.length) return sendJSON(res, 400, { error: 'Choose the portfolio folder or upload at least one portfolio workbook.' });
    if (!looksLikeExcel(bankListFile.data)) {
      return sendJSON(res, 400, { error: `${bankListFile.filename} does not look like an Excel workbook.` });
    }
    for (const file of portfolioFiles) {
      if (!looksLikeExcel(file.data)) {
        return sendJSON(res, 400, { error: `${file.filename} does not look like an Excel workbook.` });
      }
    }

    const bankSummaries = listBankSummaries(BANK_REPORTS_DIR);
    if (!bankSummaries.length) {
      return sendJSON(res, 400, { error: 'Import bank call report data before importing bond-accounting portfolios.' });
    }

    fs.mkdirSync(BANK_REPORTS_DIR, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(BANK_REPORTS_DIR, 'bond-accounting-upload-'));
    const portfolioDir = path.join(tmpDir, 'portfolios');
    fs.mkdirSync(portfolioDir, { recursive: true });

    const bankListPath = path.join(tmpDir, sanitizeFilename(bankListFile.filename || 'bond-accounting-bank-list.xlsx'));
    fs.writeFileSync(bankListPath, bankListFile.data);
    for (const file of portfolioFiles) {
      fs.writeFileSync(path.join(portfolioDir, sanitizeFilename(file.filename)), file.data);
    }

    const manifest = importBondAccountingFolder(BANK_REPORTS_DIR, bankListPath, portfolioDir, {
      bankSummaries,
      sourceFolderLabel: `${portfolioFiles.length} uploaded portfolio workbook${portfolioFiles.length === 1 ? '' : 's'}`
    });
    invalidateCoverageHoldingsIndex();
    appendAuditLog({
      event: 'bond-accounting-import',
      bankListSourceFile: sanitizeFilename(bankListFile.filename),
      portfolioFileCount: manifest.portfolioFileCount,
      matchedCount: manifest.matchedCount,
      pCodeMatchedCount: manifest.pCodeMatchedCount,
      unmatchedCount: manifest.unmatchedCount
    });
    invalidateBankCaches();
    return sendJSON(res, 200, { success: true, manifest });
  } catch (err) {
    log('error', 'Bond accounting import failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Bond accounting import failed' });
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

async function handleWirpUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Expected multipart/form-data upload' });

  try {
    const { files } = await parseMultipart(req, (boundaryMatch[1] || boundaryMatch[2]).trim(), MAX_UPLOAD_BYTES);
    const file = files.find(f => /\.(xlsm|xlsx|xls|csv)$/i.test(f.filename || ''));
    if (!file) return sendJSON(res, 400, { error: 'Upload a WIRP export (.xlsx, .xlsm, .xls, or .csv).' });
    const ext = path.extname(file.filename || '').toLowerCase();
    const validSignature = ext === '.csv' ? looksLikePlainText(file.data) : looksLikeExcel(file.data);
    if (!validSignature) {
      return sendJSON(res, 400, { error: `${file.filename} does not look like a ${ext === '.csv' ? 'CSV' : 'workbook'} file.` });
    }

    const analysis = saveWirpWorkbook(BANK_REPORTS_DIR, {
      filename: sanitizeFilename(file.filename),
      data: file.data
    });
    appendAuditLog({
      event: 'wirp-forward-rates-import',
      sourceFile: sanitizeFilename(file.filename),
      recordCount: Array.isArray(analysis.records) ? analysis.records.length : 0,
      bias: analysis.summary && analysis.summary.bias
    });
    return sendJSON(res, 200, { success: true, wirp: analysis });
  } catch (err) {
    log('error', 'WIRP upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not import WIRP export' });
  }
}

function handleBrokeredCdOpportunity(req, res, query) {
  const bankId = String(query.get('bankId') || '').trim();
  if (!bankId) return sendJSON(res, 400, { error: 'Bank ID is required' });
  const bankData = getBankById(bankId);
  if (!bankData || !bankData.bank) return sendJSON(res, 404, { error: 'Bank not found' });
  const analysis = buildBrokeredCdOpportunity(bankData);
  if (!analysis) return sendJSON(res, 404, { error: 'Bank analysis unavailable' });
  return sendJSON(res, 200, { analysis });
}

function loadArchivedCorporates(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const p = path.join(ARCHIVE_DIR, date, CORPORATES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// ---------- Audit log ----------

function appendAuditLog(entry) {
  const store = auditContext.getStore() || {};
  const actor = store.actor || {};
  const line = JSON.stringify({ ...actor, ...entry, at: new Date().toISOString() }) + '\n';
  try {
    // Rotate before appending so the active file never grows far past the cap.
    rotateFileIfNeeded(AUDIT_LOG_PATH, { maxBytes: AUDIT_LOG_MAX_BYTES, keep: AUDIT_LOG_KEEP });
    fs.appendFileSync(AUDIT_LOG_PATH, line);
  } catch (err) {
    log('error', 'Failed to write audit log:', err.message);
  }
}

function readAuditLog({ limit = 200 } = {}) {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  try {
    const content = readFileTail(AUDIT_LOG_PATH, Math.max(limit, 1) + 20);
    const lines = content.split('\n').filter(Boolean);
    const entries = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      try {
        entries.push(JSON.parse(lines[i]));
      } catch (_) { /* skip */ }
    }
    return entries;
  } catch (err) {
    log('error', 'Failed to read audit log:', err.message);
    return [];
  }
}

function readFileTail(filePath, targetLines, chunkSize = 64 * 1024) {
  const stat = fs.statSync(filePath);
  if (!stat.size) return '';

  const fd = fs.openSync(filePath, 'r');
  const chunks = [];
  let position = stat.size;
  let lineCount = 0;

  try {
    while (position > 0 && lineCount <= targetLines) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      for (let i = 0; i < readSize; i++) {
        if (buffer[i] === 0x0a) lineCount++;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  const text = Buffer.concat(chunks).toString('utf-8');
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - targetLines - 1)).join('\n');
}

// ---------- Folder drop publishing ----------

function folderDropCompanionRole(filename) {
  if (looksLikeInternalCdWorkbook(filename)) {
    return 'cdCostWorkbook';
  }
  return '';
}

function isReferenceDropFile(filename) {
  return /\.(txt|eml|msg)$/i.test(String(filename || '')) ||
    looksLikeInternalCdWorkbook(filename) ||
    looksLikeWirpWorkbook(filename);
}

function folderDropReferenceLabel(filename) {
  if (looksLikeInternalCdWorkbook(filename)) return 'Internal CD workbook';
  if (looksLikeWirpWorkbook(filename)) return 'WIRP rates workbook';
  if (/\.eml$/i.test(String(filename || ''))) return 'Email source';
  if (/\.msg$/i.test(String(filename || ''))) return 'Email source';
  if (/\.txt$/i.test(String(filename || ''))) return 'Text note';
  return 'Reference file';
}

function scanFolderDrop(dateValue) {
  const date = normalizeDropDate(dateValue);
  const folderPath = dropboxDirForDate(date);
  if (!folderPath) {
    const err = new Error('Invalid folder date');
    err.statusCode = 400;
    throw err;
  }
  fs.mkdirSync(folderPath, { recursive: true });
  const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => {
      const filename = entry.name;
      const fullPath = path.join(folderPath, filename);
      const stat = fs.statSync(fullPath);
      const isWorkbook = /\.(xlsx|xlsm|xls)$/i.test(filename);
      let slot = classifyFolderDropFile(filename);
      let execSlot = null;
      if (!slot && isWorkbook) {
        // One buffer read serves both the daily-slot content sniff and the
        // exec-summary classifier, so generic grid1_<hash> exports route right.
        let buffer = null;
        try { buffer = fs.readFileSync(fullPath); } catch (_) { /* unreadable — leave unslotted */ }
        if (buffer) {
          slot = sniffWorkbookSlot(fullPath);
          if (!slot) execSlot = classifyExecSummaryBuffer(buffer);
        }
      }
      const reference = !slot && !execSlot && isReferenceDropFile(filename);
      return {
        filename,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        slot,
        execSlot,
        label: slot ? (DOC_TYPES_LABELS[slot] || slot)
          : execSlot ? (EXEC_SUMMARY_SLOT_LABELS[execSlot] || execSlot)
          : folderDropReferenceLabel(filename),
        companionRole: folderDropCompanionRole(filename),
        date: sniffDateFromFilename(filename),
        reference,
        ignored: filename.startsWith('.') || filename.startsWith('_') || (!slot && !execSlot && !reference)
      };
    })
    .filter(row => !row.filename.startsWith('.') && row.filename !== '.DS_Store');

  const publishable = entries.filter(row => row.slot && !row.ignored);
  const references = entries.filter(row => row.reference && !row.ignored);
  const execFiles = entries.filter(row => row.execSlot && !row.ignored);
  const ignored = entries.filter(row => row.ignored || (!row.slot && !row.execSlot && !row.reference));
  const slots = {};
  publishable.forEach(row => {
    if (!slots[row.slot]) slots[row.slot] = [];
    slots[row.slot].push(row);
  });

  // Exec-summary readiness: first file per slot wins (dedupe), report gaps.
  const execSlots = {};
  execFiles.forEach(row => { if (!execSlots[row.execSlot]) execSlots[row.execSlot] = row.filename; });
  const execPresent = Object.keys(execSlots);
  const execRequiredPresent = EXEC_SUMMARY_REQUIRED_SLOTS.filter(k => execSlots[k]);
  const execMissing = EXEC_SUMMARY_REQUIRED_SLOTS.filter(k => !execSlots[k]);
  const execSummary = {
    detected: execSlots,
    present: execPresent,
    missing: execMissing,
    complete: execMissing.length === 0,
    labels: EXEC_SUMMARY_SLOT_LABELS
  };

  const warnings = [];
  if (!publishable.length) warnings.push('No publishable portal files were found in this folder.');
  // Same daily slot claimed by more than one file — publishing would let the
  // last writer win silently (e.g. an agency-callables sheet that content-sniffs
  // as Treasury colliding with the real Treasury file). Surface it for review.
  Object.entries(slots).forEach(([slot, rows]) => {
    if (rows.length > 1) {
      warnings.push(`${rows.length} files both classify as ${DOC_TYPES_LABELS[slot] || slot}: ${rows.map(r => r.filename).join(', ')}. Only one can fill that slot — remove or relabel the others before publishing.`);
    }
  });
  const touchesAgencies = Boolean(slots.agenciesBullets || slots.agenciesCallables);
  if (touchesAgencies && (!slots.agenciesBullets || !slots.agenciesCallables)) {
    const have = slots.agenciesBullets ? 'Bullets' : 'Callables';
    const missing = slots.agenciesBullets ? 'Callables' : 'Bullets';
    warnings.push(`Agencies: only the ${have} workbook is here. Publishing will go through one-sided (the ${missing} side will be empty in the Agency Explorer until it's added).`);
  }
  const dates = [...new Set(publishable.map(row => row.date).filter(Boolean))];
  if (dates.length > 1) warnings.push(`Files appear to reference multiple dates: ${dates.join(', ')}.`);
  if (references.length) warnings.push(`${references.length} reference/internal file${references.length === 1 ? '' : 's'} found. They will stay in the folder and will not replace package slots yet.`);
  if (execPresent.length && !execSummary.complete) {
    warnings.push(`Executive Summary: ${execRequiredPresent.length} of 3 required files detected (${execPresent.map(k => EXEC_SUMMARY_SLOT_LABELS[k]).join(', ')}). Missing ${execMissing.map(k => EXEC_SUMMARY_SLOT_LABELS[k]).join(', ')} — exec summary will not generate on publish until holdings, TBLT trades, and margin are in the folder.`);
  } else if (execSummary.complete) {
    warnings.push('Executive Summary: holdings, TBLT trades, and margin detected — the management snapshot will refresh on publish.');
  }

  return {
    date,
    folderPath,
    created: true,
    publishable,
    references,
    execFiles,
    execSummary,
    ignored,
    slots,
    warnings
  };
}

function folderDropFilesForPublish(scan) {
  return (scan.publishable || []).map(row => {
    const folderPath = dropboxDirForDate(scan.date);
    const sourcePath = safeJoin(folderPath, row.filename);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const err = new Error(`Could not read ${row.filename}`);
      err.statusCode = 400;
      throw err;
    }
    return {
      fieldName: row.slot,
      filename: row.filename,
      data: fs.readFileSync(sourcePath),
      explicitSlot: row.slot,
      companionRole: row.companionRole || ''
    };
  });
}

function folderDropReferenceFiles(scan) {
  const folderPath = dropboxDirForDate(scan.date);
  return (scan.references || []).map(row => {
    const sourcePath = safeJoin(folderPath, row.filename);
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    return {
      fieldName: 'reference',
      filename: row.filename,
      data: fs.readFileSync(sourcePath),
      label: row.label || ''
    };
  }).filter(Boolean);
}

function looksLikeStructuredNotesEmail(file) {
  if (!/\.eml$/i.test(file.filename || '')) return false;
  const summary = emailSummary(file.data.toString('utf8'), file.filename);
  return /structured|new issue|notes|\bJPM\b|\bGS\b|\bBMO\b|\bNBC\b|\bTD\b/i.test(summary.subject || '');
}

function ingestFolderDropReferences(scan) {
  const files = folderDropReferenceFiles(scan);
  const cdInternalFiles = files.filter(file => looksLikeInternalCdWorkbook(file.filename));
  const emailFiles = files.filter(file => /\.eml$/i.test(file.filename || ''));
  const structuredEmails = emailFiles.filter(looksLikeStructuredNotesEmail);

  const result = {
    cdInternal: null,
    structuredNotes: null
  };

  if (cdInternalFiles.length) {
    result.cdInternal = saveCdInternalUpload(CD_INTERNAL_DIR, cdInternalFiles);
    invalidateCdRolloverUniverse();
  }
  result.structuredNotes = saveStructuredNotesUpload(STRUCTURED_NOTES_DIR, structuredEmails, {
    targetDate: scan.date,
    replace: true
  });
  return result;
}

// Best-effort: when the folder also holds the Executive Summary inputs
// (holdings, TBLT trades, and margin workbook), ingest them into
// the management-only snapshot as part of the same publish — so the desk drops
// everything in one folder and hits Publish once. Already admin-gated: the
// folder-drop publish route sits behind the same FBBS_ADMIN_USERS check as the
// dedicated exec-summary upload. Never throws: a failure here must not break the
// daily package publish, so all errors are caught and reported in the result.
async function ingestFolderDropExecSummary(scan, req) {
  const exec = scan.execSummary || {};
  const detected = exec.detected || {};
  const present = exec.present || [];
  if (!present.length) return null; // no exec files in the folder — nothing to do
  if (!exec.complete) {
    return { ingested: false, skipped: true, reason: 'incomplete', present, missing: exec.missing || [] };
  }

  const tmpPaths = [];
  try {
    const folderPath = dropboxDirForDate(scan.date);
    fs.mkdirSync(EXEC_SUMMARY_DIR, { recursive: true });
    const writeTmp = (slot, tag) => {
      const sourcePath = safeJoin(folderPath, detected[slot]);
      if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`Could not read exec ${slot} file ${detected[slot]}`);
      const ext = path.extname(detected[slot] || '') || '.xlsx';
      const p = path.join(EXEC_SUMMARY_DIR, `exec-folderdrop.tmp-${tag}-${process.pid}-${Date.now()}${ext}`);
      fs.writeFileSync(p, fs.readFileSync(sourcePath));
      tmpPaths.push(p);
      return p;
    };
    const paths = {
      inventoryPath: writeTmp('inventory', 'inv'),
      sectorPath: writeTmp('sector', 'sec'),
      marginPath: writeTmp('margin', 'mgn'),
    };
    if (detected.activity) paths.activityPath = writeTmp('activity', 'act');

    // (was a missing-await bug: loadCurrentEconomicUpdate() is async, so the
    // overlay silently never attached on the folder-drop path)
    const market = await loadMarketOverlay();

    const summary = execSummaryStore.ingestExecSummary(EXEC_SUMMARY_DIR, paths, {
      market,
      sourceFiles: {
        inventory: sanitizeFilename(detected.inventory),
        activity: detected.activity ? sanitizeFilename(detected.activity) : null,
        trades: sanitizeFilename(detected.sector),
        sector: sanitizeFilename(detected.sector),
        margin: sanitizeFilename(detected.margin),
      },
    });

    appendAuditLog({
      event: 'exec-summary-import',
      source: 'folder-drop',
      asOfDate: summary.asOfDate,
      cobDate: summary.cobDate,
      sourceFiles: summary.sourceFiles,
      warnings: summary.warnings,
      ...(auditActorForRequest(req) || {}),
    });
    return { ingested: true, asOfDate: summary.asOfDate, cobDate: summary.cobDate, sourceFiles: summary.sourceFiles, warnings: summary.warnings };
  } catch (err) {
    log('warn', 'Folder-drop exec-summary ingest failed:', err.message);
    return { ingested: false, error: err.message };
  } finally {
    for (const p of tmpPaths) { try { fs.rmSync(p, { force: true }); } catch (_) {} }
  }
}

function validatePublishFileSet(files) {
  let classifiedCount = 0;
  for (const file of files || []) {
    const slot = classifyFile(file.filename, file.explicitSlot);
    if (!slot) continue;
    classifiedCount++;
    const signatureError = validateUploadSignature(file, slot);
    if (signatureError) {
      const err = new Error(signatureError);
      err.statusCode = 400;
      throw err;
    }
    if (!safeJoin(CURRENT_DIR, sanitizeFilename(file.filename))) {
      const err = new Error(`Invalid upload filename: ${file.filename || '(unnamed file)'}`);
      err.statusCode = 400;
      throw err;
    }
  }
  if (!classifiedCount) {
    const err = new Error('No uploaded files could be classified');
    err.statusCode = 400;
    throw err;
  }
}

function snapshotCurrentPackageDir() {
  const snapshotDir = path.join(DATA_DIR, `_publish_rollback_${process.pid}_${Date.now()}`);
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });
  if (fs.existsSync(CURRENT_DIR)) {
    fs.cpSync(CURRENT_DIR, snapshotDir, { recursive: true, force: true });
  }
  return snapshotDir;
}

function restoreCurrentPackageSnapshot(snapshotDir) {
  fs.rmSync(CURRENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CURRENT_DIR, { recursive: true });
  if (snapshotDir && fs.existsSync(snapshotDir)) {
    fs.cpSync(snapshotDir, CURRENT_DIR, { recursive: true, force: true });
  }
  invalidatePackageCache();
}

async function handleFolderDropScan(req, res, query) {
  try {
    return sendJSON(res, 200, scanFolderDrop(query.get('date')));
  } catch (err) {
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not scan folder' });
  }
}

async function handleFolderDropPublish(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const scan = scanFolderDrop(body.date);
    if (!scan.publishable.length) return sendJSON(res, 400, { error: 'No publishable portal files were found in the folder.' });
    const files = folderDropFilesForPublish(scan);
    return await publishPackageFiles(files, res, {
      auditEvent: 'folder-publish',
      publishedBy: 'Folder Drop',
      sourceFolder: scan.folderPath,
      afterPublish: async () => {
        const result = ingestFolderDropReferences(scan);
        result.execSummary = await ingestFolderDropExecSummary(scan, req);
        return result;
      }
    });
  } catch (err) {
    log('error', 'Folder drop publish failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Folder drop publish failed' });
  }
}

// ---------- Folder-drop auto-publish ----------
//
// Watches today's data/dropbox/YYYY-MM-DD folder and publishes it through the
// EXACT same path as the Upload page's Folder Drop button (snapshot/rollback,
// audit log, reference + exec-summary ingest included) once the folder's
// contents have been stable for one full poll interval — so half-copied files
// from a network share or Power Automate flow are never ingested.
// Disable with FBBS_AUTO_PUBLISH=0.
//
// Safety gates, in tick order:
//   - a publish (manual or auto) is already running     → skip this tick
//   - folder changed since the previous tick            → still copying; wait
//   - this exact folder state was already handled       → nothing new to do
//   - two files claim the same daily slot               → human call; skip + audit once
//   - no publishable slot files                         → nothing to do

const autoPublishState = {
  date: null,
  pendingFingerprint: null, // seen once — waiting to confirm the folder settled
  handledFingerprint: null, // published / attempted / skipped — never retried as-is
  collisionAudited: false,
};

// Minimal stand-in for the HTTP response publishPackageFiles() writes to.
function nullHttpResponse() {
  const shim = {
    statusCode: 0,
    headersSent: false,
    body: '',
    writeHead(status) { shim.statusCode = status; shim.headersSent = true; },
    end(body) { if (body != null) shim.body = body.toString(); },
  };
  return shim;
}

// Every file the scan saw (including ignored ones) goes into the fingerprint:
// a half-copied workbook usually classifies as nothing, and it still has to
// hold the publish until it settles.
function dropFolderFingerprint(scan) {
  return [...(scan.publishable || []), ...(scan.references || []), ...(scan.execFiles || []), ...(scan.ignored || [])]
    .map(row => `${row.filename}|${row.size}|${row.modifiedAt}`)
    .sort()
    .join('\n');
}

async function autoPublishTick() {
  if (publishBusy) return;
  let scan;
  try {
    scan = scanFolderDrop(null); // today
  } catch (err) {
    log('warn', 'Auto-publish scan failed:', err.message);
    return;
  }

  if (scan.date !== autoPublishState.date) {
    autoPublishState.date = scan.date;
    autoPublishState.pendingFingerprint = null;
    autoPublishState.handledFingerprint = null;
    autoPublishState.collisionAudited = false;
  }

  const fingerprint = dropFolderFingerprint(scan);
  if (!fingerprint || !scan.publishable.length) {
    autoPublishState.pendingFingerprint = fingerprint || null;
    return;
  }
  if (fingerprint === autoPublishState.handledFingerprint) return;
  if (fingerprint !== autoPublishState.pendingFingerprint) {
    autoPublishState.pendingFingerprint = fingerprint;
    return; // first sighting — confirm it is still byte-identical next tick
  }

  // Stable folder with something new to publish. The one warning that blocks:
  // two files claiming the same slot (last-writer-wins would be silent data
  // loss). Anything else the admin would publish through anyway.
  const collision = Object.values(scan.slots || {}).some(rows => rows.length > 1);
  autoPublishState.handledFingerprint = fingerprint; // win or lose, don't hot-loop
  if (collision) {
    if (!autoPublishState.collisionAudited) {
      autoPublishState.collisionAudited = true;
      log('warn', 'Auto-publish held: slot collision in', scan.folderPath, '— resolve in the folder or publish manually.');
      appendAuditLog({ event: 'folder-auto-publish-skipped', reason: 'slot-collision', date: scan.date, warnings: scan.warnings });
    }
    return;
  }

  try {
    const files = folderDropFilesForPublish(scan);
    const shim = nullHttpResponse();
    await publishPackageFiles(files, shim, {
      auditEvent: 'folder-auto-publish',
      publishedBy: 'Folder Drop (auto)',
      sourceFolder: scan.folderPath,
      afterPublish: async () => {
        const result = ingestFolderDropReferences(scan);
        result.execSummary = await ingestFolderDropExecSummary(scan, null);
        return result;
      }
    });
    if (shim.statusCode >= 200 && shim.statusCode < 300) {
      log('info', `Auto-publish: ${scan.publishable.length} file(s) published from ${scan.folderPath}`);
    } else {
      log('error', `Auto-publish failed (${shim.statusCode}):`, String(shim.body).slice(0, 300));
      appendAuditLog({ event: 'folder-auto-publish-failed', date: scan.date, status: shim.statusCode });
    }
  } catch (err) {
    log('error', 'Auto-publish failed:', err.message);
    appendAuditLog({ event: 'folder-auto-publish-failed', date: scan.date, error: err.message });
  }
}

// ---------- FDIC weekly auto-sync ----------
//
// Runs the same non-destructive quarterly pull as the admin Upload-page
// button (adds cert-matched periods, never overwrites; the next FedFis
// workbook import supersedes it) on a weekly cadence, so a newly filed
// quarter reaches tear sheets without anyone pressing the button.
// The check fires every 6h but only RUNS when the last successful sync is
// more than a week old (stamp in data/market/fdic/auto-sync-state.json);
// failures skip the stamp and so retry on the next 6h check.
// Disable with FBBS_AUTO_FDIC_SYNC=0.

function autoFdicStatePath() {
  return path.join(MARKET_DIR, 'fdic', 'auto-sync-state.json');
}

async function autoFdicSyncTick() {
  try {
    let lastRunAt = null;
    try {
      lastRunAt = JSON.parse(fs.readFileSync(autoFdicStatePath(), 'utf-8')).lastRunAt || null;
    } catch (_) { /* no stamp yet — run */ }
    if (lastRunAt && Date.now() - Date.parse(lastRunAt) < AUTO_FDIC_SYNC_EVERY_MS) return;

    const result = await fdicBulkSync.syncFdicQuarter(BANK_REPORTS_DIR, { dryRun: false, log });
    if (result.updated > 0) invalidateBankCaches();
    appendAuditLog({ event: 'fdic-sync', trigger: 'auto-weekly', ...result });
    fs.mkdirSync(path.dirname(autoFdicStatePath()), { recursive: true });
    fs.writeFileSync(autoFdicStatePath(), JSON.stringify({
      lastRunAt: new Date().toISOString(),
      period: result.period || null,
      updated: result.updated || 0,
    }));
    log('info', `FDIC auto-sync: ${result.updated} bank(s) gained ${result.period || 'n/a'} (${result.skippedExisting} already had it).`);
  } catch (err) {
    log('warn', 'FDIC auto-sync failed (retries on the next 6h check):', err.message);
  }
}

// ---------- Upload handling ----------

async function handleUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return sendJSON(res, 400, { error: 'Missing multipart boundary' });
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  let parsed;
  try {
    parsed = await parseMultipart(req, boundary.trim(), MAX_UPLOAD_BYTES);
  } catch (err) {
    log('warn', 'Multipart parse failed:', err.message);
    return sendJSON(res, err.statusCode || 400, { error: err.message });
  }

  const { files } = parsed;
  if (!files.length) return sendJSON(res, 400, { error: 'No files in upload' });

  return await publishPackageFiles(files, res);
}

// One publish at a time, manual or automatic: the snapshot/rollback dance in
// here is not reentrant, and the auto-publisher checks this flag to stay out
// of the way of an admin clicking Publish at the same moment.
let publishBusy = false;

async function publishPackageFiles(files, res, options = {}) {
  let snapshotDir = '';
  publishBusy = true;
  try {
    validatePublishFileSet(files);
    snapshotDir = snapshotCurrentPackageDir();
    return await publishPackageFilesUnsafe(files, res, options);
  } catch (err) {
    if (snapshotDir) {
      try {
        restoreCurrentPackageSnapshot(snapshotDir);
        log('warn', 'Publish failed; restored prior current package snapshot:', err.message);
      } catch (restoreErr) {
        log('error', 'Publish rollback failed:', restoreErr.message);
      }
    }
    const status = err.statusCode || 500;
    if (!res.headersSent) {
      return sendJSON(res, status, { error: err.message || 'Publish failed' });
    }
    throw err;
  } finally {
    publishBusy = false;
    if (snapshotDir) {
      try { fs.rmSync(snapshotDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

async function publishPackageFilesUnsafe(files, res, options = {}) {
  let priorMeta = readMetaFile(CURRENT_DIR);
  let priorMuniOfferingsPayload = loadCurrentMuniOfferings();
  const existingBeforeUpload = fs.existsSync(CURRENT_DIR)
    ? fs.readdirSync(CURRENT_DIR).filter(f => f !== '.gitkeep' && f !== '.DS_Store')
    : [];

  // Determine which slots this upload is touching
  const incomingSlots = new Set();
  const hasCdCostOnlyUpload = files.some(f => f.companionRole === 'cdCostWorkbook');
  const hasCdPrimaryUpload = files.some(f =>
    classifyFile(f.filename, f.explicitSlot) === 'cdoffers' &&
    f.companionRole !== 'cdCostWorkbook'
  );
  for (const f of files) {
    const s = classifyFile(f.filename, f.explicitSlot);
    if (s) incomingSlots.add(s);
  }

  const touchesAgencies = incomingSlots.has('agenciesBullets') || incomingSlots.has('agenciesCallables');
  const touchesMuniOfferings = incomingSlots.has('munioffers') || incomingSlots.has('bairdSyndicate');
  // Agencies publish best with both Bullets and Callables (the Agency Explorer
  // merges them), but a one-sided publish is allowed: when only one file is in
  // the folder, the package publishes that side and the parse step records a
  // warning rather than hard-blocking the whole upload. The only true failure is
  // no agency file at all, handled below once the files are collected.

  // Archive any existing current-package files from a prior day. If same-day,
  // only replace files for the slots being re-uploaded; preserve everything
  // else so independent upload channels (daily / agencies / corporates) don't
  // clobber each other.
  try {
    const existing = fs.readdirSync(CURRENT_DIR);
    if (existing.length > 0) {
      let archiveDate = null;
      const metaPath = path.join(CURRENT_DIR, META_FILENAME);
      if (fs.existsSync(metaPath)) {
        archiveDate = priorMeta.date || null;
      }
      if (!archiveDate) archiveDate = deriveCurrentPackageDateFromFiles(CURRENT_DIR, existing) || todayStamp();

      const newToday = todayStamp();
      if (archiveDate !== newToday) {
        // Different day: archive everything wholesale
        const archiveTarget = safeJoin(ARCHIVE_DIR, archiveDate);
        if (!archiveTarget) {
          log('error', 'Archive target escaped ARCHIVE_DIR:', archiveDate);
          return sendJSON(res, 500, { error: 'Invalid archive date' });
        }
        if (!fs.existsSync(archiveTarget)) fs.mkdirSync(archiveTarget, { recursive: true });
        for (const f of existing) {
          fs.renameSync(path.join(CURRENT_DIR, f), path.join(archiveTarget, f));
        }
        priorMeta = {};
        priorMuniOfferingsPayload = null;
        log('info', 'Archived prior package to', archiveDate);
      } else {
        // Same day: selectively remove ONLY the files whose slots are being
        // re-uploaded. Per-slot internal json ("_offerings.json", etc.) are
        // also cleared so the re-upload can write fresh ones.
        const perSlotJson = {
          econ:              [ECONOMIC_UPDATE_FILENAME],
          relativeValue:     [RELATIVE_VALUE_FILENAME],
          mmd:               [MMD_FILENAME],
          treasuryNotes:     [TREASURY_NOTES_FILENAME],
          cdoffers:          [OFFERINGS_FILENAME],
          munioffers:        [MUNI_OFFERINGS_FILENAME],
          agenciesBullets:   [AGENCIES_FILENAME],
          agenciesCallables: [AGENCIES_FILENAME],
          corporates:        [CORPORATES_FILENAME]
        };
        const priorSlotByFilename = new Map(
          Object.entries(priorMeta.slotFilenames || {}).map(([slot, filename]) => [filename, slot])
        );
        for (const [slot, filenames] of Object.entries(priorMeta.slotFileLists || {})) {
          if (!Array.isArray(filenames)) continue;
          for (const filename of filenames) priorSlotByFilename.set(filename, slot);
        }
        for (const f of existing) {
          if (f === META_FILENAME || f === 'audit.log') continue;
          const classifiedSlot = f.startsWith('_')
            ? Object.entries(perSlotJson).find(([, jsons]) => jsons.includes(f))?.[0]
            : (priorSlotByFilename.get(f) || classifyFile(f));
          const preserveForCostMerge = classifiedSlot === 'cdoffers' && hasCdCostOnlyUpload && !hasCdPrimaryUpload;
          if (classifiedSlot && incomingSlots.has(classifiedSlot) && !preserveForCostMerge) {
            try { fs.unlinkSync(path.join(CURRENT_DIR, f)); } catch (_) {}
          }
        }
        log('info', 'Same-day re-publish; replaced slots:', [...incomingSlots].join(', '));
      }
    }
  } catch (err) {
    log('error', 'Archive-rollover failed:', err.message);
    // Post-mutation: the rollover may have partially archived/unlinked the prior
    // package. Throw so publishPackageFiles() restores the snapshot rather than
    // leaving the current package half-rotated.
    throw Object.assign(new Error('Failed to rotate existing package'), { statusCode: 500 });
  }

  // Save uploaded files and sniff dates. Most slots are single-file (later wins);
  // CD offerings can include a PDF plus an Excel cost workbook.
  const saved = [];
  const bySlot = {};
  const slotFilenames = {};
  const slotFileLists = {};
  const dateSniffs = {};

  for (const file of files) {
    const slot = classifyFile(file.filename, file.explicitSlot);
    if (!slot) {
      log('warn', 'Could not classify uploaded file:', file.filename);
      continue;
    }
    const signatureError = validateUploadSignature(file, slot);
    if (signatureError) {
      // Post-mutation (the rollover above already moved/removed prior slots).
      // Throw so the snapshot is restored instead of leaving a missing slot.
      throw Object.assign(new Error(signatureError), { statusCode: 400 });
    }
    const safeName = sanitizeFilename(file.filename);
    const target = safeJoin(CURRENT_DIR, safeName);
    if (!target) {
      log('warn', 'Rejected upload target path:', file.filename);
      continue;
    }

    const isCdOfferingsPair = slot === 'cdoffers';

    // Single-file per slot within THIS upload: later upload replaces earlier.
    if (bySlot[slot] && !isCdOfferingsPair) {
      try { fs.unlinkSync(path.join(CURRENT_DIR, bySlot[slot])); } catch (_) {}
      saved.splice(saved.findIndex(s => s.type === slot), 1);
    }
    fs.writeFileSync(target, file.data);
    bySlot[slot] = safeName;
    if (file.companionRole !== 'cdCostWorkbook') {
      slotFilenames[slot] = safeName;
    }
    if (!slotFileLists[slot]) slotFileLists[slot] = [];
    slotFileLists[slot].push(safeName);
    dateSniffs[slot] = sniffDateFromFilename(file.filename);
    saved.push({ filename: safeName, type: slot, size: file.data.length });
  }

  if (slotFileLists.cdoffers && slotFileLists.cdoffers.length > 1) {
    const pdfName = slotFileLists.cdoffers.find(name => /\.pdf$/i.test(name));
    if (pdfName) slotFilenames.cdoffers = pdfName;
  }

  if (saved.length === 0) {
    // Post-mutation: throw so the snapshot is restored rather than leaving the
    // package stripped of the slots the rollover already cleared.
    throw Object.assign(new Error('No uploaded files could be classified'), { statusCode: 400 });
  }

  // Extract the Economic Update PDF into structured market data if present.
  let economicUpdateWarnings = [];
  const econFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'econ');
  if (econFile) {
    const sourceFile = slotFilenames.econ || sanitizeFilename(econFile.filename);
    const extracted = await extractEconomicUpdate(econFile.data, sourceFile);
    if (extracted) {
      economicUpdateWarnings = extracted.warnings || [];
      try {
        fs.writeFileSync(
          path.join(CURRENT_DIR, ECONOMIC_UPDATE_FILENAME),
          JSON.stringify(extracted, null, 2)
        );
        log('info', `Extracted Economic Update market data from ${sourceFile}`);
      } catch (err) {
        log('error', 'Failed to write economic update JSON:', err.message);
      }
    } else {
      economicUpdateWarnings.push('Economic Update PDF was uploaded but market data could not be extracted.');
    }
  }

  // Extract the Relative Value PDF rate snapshot into structured data if present.
  let relativeValueRowsCount = null;
  let relativeValueWarnings = [];
  const relativeValueFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'relativeValue');
  if (relativeValueFile) {
    const sourceFile = slotFilenames.relativeValue || sanitizeFilename(relativeValueFile.filename);
    const extracted = await extractPdfText(relativeValueFile.data);
    const rows = parseRelativeValueSnapshotText(extracted && extracted.text);
    relativeValueRowsCount = rows.length;
    relativeValueWarnings = rows.length ? [] : ['Relative Value PDF was uploaded but the rate snapshot table could not be extracted.'];
    const payload = {
      asOfDate: dateSniffs.relativeValue || null,
      extractedAt: new Date().toISOString(),
      sourceFile,
      rows,
      series: [
        { key: 'ust', label: 'UST Yield' },
        { key: 'agency', label: 'US AGY' },
        { key: 'muniTey296', label: "MUNI GO 'AA' TEY (29.6%)" },
        { key: 'muniTey21', label: "MUNI GO 'AA' TEY (21%)" },
        { key: 'corp', label: "'AA' Corp" }
      ],
      warnings: relativeValueWarnings
    };
    try {
      fs.writeFileSync(path.join(CURRENT_DIR, RELATIVE_VALUE_FILENAME), JSON.stringify(payload, null, 2));
      log('info', `Extracted ${relativeValueRowsCount} relative value snapshot rows from ${sourceFile}`);
    } catch (err) {
      log('error', 'Failed to write relative value JSON:', err.message);
    }
  }

  // Extract the MMD PDF into a native curve graph dataset if present.
  let mmdCurveCount = null;
  let mmdWarnings = [];
  let mmdAsOfDate = null;
  const mmdFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'mmd');
  if (mmdFile) {
    const sourceFile = slotFilenames.mmd || sanitizeFilename(mmdFile.filename);
    const extracted = await extractPdfText(mmdFile.data);
    const payload = parseMmdCurveText(extracted && extracted.text);
    mmdCurveCount = Array.isArray(payload.curve) ? payload.curve.length : 0;
    mmdWarnings = payload.warnings || [];
    mmdAsOfDate = payload.asOfDate;
    payload.extractedAt = new Date().toISOString();
    payload.sourceFile = sourceFile;
    try {
      fs.writeFileSync(path.join(CURRENT_DIR, MMD_FILENAME), JSON.stringify(payload, null, 2));
      log('info', `Extracted ${mmdCurveCount} MMD curve rows from ${sourceFile}`);
    } catch (err) {
      log('error', 'Failed to write MMD curve JSON:', err.message);
    }
  }

  // Extract the Brokered CD Rate Sheet all-in ranges for the calculator.
  let brokeredCdTerms = null;
  let brokeredCdAsOfDate = null;
  let brokeredCdWarnings = [];
  const brokeredCdFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'cd');
  if (brokeredCdFile) {
    const extracted = await extractBrokeredCdRates(brokeredCdFile.data);
    if (extracted) {
      brokeredCdTerms = extracted.terms;
      brokeredCdAsOfDate = extracted.asOfDate;
      brokeredCdWarnings = extracted.warnings || [];
      if (brokeredCdTerms.length > 0) {
        log('info', `Extracted ${brokeredCdTerms.length} Brokered CD rate terms`);
      }
    } else {
      brokeredCdWarnings.push('Brokered CD Rate Sheet was uploaded but all-in ranges could not be extracted.');
    }
  }

  // Extract offerings from the CD Offers PDF or Excel workbook if present.
  let offeringsCount = null;
  let offeringsWarnings = [];
  let offeringsAsOfDate = null;
  let cdHistorySnapshot = null;
  const cdOffersFiles = files.filter(f => classifyFile(f.filename, f.explicitSlot) === 'cdoffers');
  if (cdOffersFiles.length) {
    const extracted = await extractCdOfferingsPackage(files);
    if (extracted && Array.isArray(extracted.offerings)) {
      offeringsCount = extracted.offerings.length;
      offeringsWarnings = extracted.warnings || [];
      offeringsAsOfDate = extracted.asOfDate;
      const offPayload = {
        asOfDate: extracted.asOfDate,
        extractedAt: new Date().toISOString(),
        sourceFile: extracted.sourceFile || slotFilenames.cdoffers,
        sourceFiles: extracted.sourceFiles || slotFileLists.cdoffers || [slotFilenames.cdoffers].filter(Boolean),
        costSourceFile: extracted.costSourceFile || null,
        warnings: offeringsWarnings,
        offerings: extracted.offerings
      };
      try {
        fs.writeFileSync(
          path.join(CURRENT_DIR, OFFERINGS_FILENAME),
          JSON.stringify(offPayload, null, 2)
        );
        cdHistorySnapshot = saveCdHistorySnapshot(CD_HISTORY_DIR, offPayload, {
          uploadedAt: offPayload.extractedAt,
          uploadDate: todayStamp()
        });
        invalidateCdRolloverUniverse();
        log('info', `Extracted ${offeringsCount} offerings from Daily CD Offerings upload`);
      } catch (err) {
        log('error', 'Failed to write offerings JSON:', err.message);
      }
    } else {
      log('warn', 'Daily CD Offerings file was uploaded but no offerings were extracted');
    }
  }

  // Extract muni offerings from the Muni Offerings PDF and optional Baird Syndicate workbook.
  let muniOfferingsCount = null;
  let muniOfferingsWarnings = [];
  let muniOfferingsAsOfDate = null;
  const muniOffersFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'munioffers');
  const bairdSyndicateFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'bairdSyndicate');
  if (muniOffersFile || bairdSyndicateFile) {
    const priorRows = Array.isArray(priorMuniOfferingsPayload && priorMuniOfferingsPayload.offerings)
      ? priorMuniOfferingsPayload.offerings
      : [];
    let primaryOfferings = priorRows.filter(row => !(row && row.isSyndicate));
    let syndicateOfferings = priorRows.filter(row => row && row.isSyndicate);
    let primarySourceFile = priorMuniOfferingsPayload && priorMuniOfferingsPayload.sourceFile;
    let syndicateSourceFile = priorMuniOfferingsPayload && priorMuniOfferingsPayload.bairdSyndicateSourceFile;
    muniOfferingsAsOfDate = priorMuniOfferingsPayload && priorMuniOfferingsPayload.asOfDate;

    if (muniOffersFile) {
      const extracted = await extractMuniOfferings(muniOffersFile.data);
      if (extracted && Array.isArray(extracted.offerings)) {
        primaryOfferings = extracted.offerings.map(row => ({
          ...row,
          source: row.source || 'FBBS',
          isSyndicate: false
        }));
        muniOfferingsWarnings.push(...(extracted.warnings || []));
        muniOfferingsAsOfDate = extracted.asOfDate || muniOfferingsAsOfDate;
        primarySourceFile = slotFilenames.munioffers;
        log('info', `Extracted ${primaryOfferings.length} muni offerings from Muni Offers PDF`);
      } else {
        muniOfferingsWarnings.push('Muni Offerings PDF was uploaded but no offerings were extracted.');
        log('warn', 'Muni Offerings PDF was uploaded but no offerings were extracted');
      }
    }

    if (bairdSyndicateFile) {
      const syndicate = extractBairdSyndicateOfferings(bairdSyndicateFile.data);
      if (syndicate && Array.isArray(syndicate.offerings)) {
        syndicateOfferings = syndicate.offerings;
        muniOfferingsWarnings.push(...(syndicate.warnings || []));
        syndicateSourceFile = slotFilenames.bairdSyndicate;
        log('info', `Extracted ${syndicateOfferings.length} Baird Syndicate muni offerings`);
      } else {
        muniOfferingsWarnings.push('Baird Syndicate workbook was uploaded but no offerings were extracted.');
        log('warn', 'Baird Syndicate workbook was uploaded but no offerings were extracted');
      }
    }

    const combinedOfferings = [...primaryOfferings, ...syndicateOfferings];
    muniOfferingsCount = combinedOfferings.length;
    const offPayload = {
      asOfDate: muniOfferingsAsOfDate,
      extractedAt: new Date().toISOString(),
      sourceFile: primarySourceFile || null,
      bairdSyndicateSourceFile: syndicateSourceFile || null,
      sourceCounts: {
        fbbs: primaryOfferings.length,
        bairdSyndicate: syndicateOfferings.length
      },
      warnings: muniOfferingsWarnings,
      offerings: combinedOfferings
    };
    try {
      fs.writeFileSync(
        path.join(CURRENT_DIR, MUNI_OFFERINGS_FILENAME),
        JSON.stringify(offPayload, null, 2)
      );
    } catch (err) {
      log('error', 'Failed to write muni offerings JSON:', err.message);
    }
  }

  // Extract treasury notes from the uploaded Excel workbook if present.
  let treasuryNotesCount = null;
  let treasuryNotesWarnings = [];
  const treasuryNotesFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'treasuryNotes');
  if (treasuryNotesFile) {
    const sourceFile = slotFilenames.treasuryNotes || sanitizeFilename(treasuryNotesFile.filename);
    const parsed = parseTreasuryNotesWorkbook(treasuryNotesFile.data, { filename: sourceFile });
    treasuryNotesCount = parsed.notes.length;
    treasuryNotesWarnings = parsed.warnings || [];
    if (parsed.notes.length) {
      try {
        fs.writeFileSync(path.join(CURRENT_DIR, TREASURY_NOTES_FILENAME), JSON.stringify({
          asOfDate: parsed.asOfDate || null,
          extractedAt: new Date().toISOString(),
          sourceFile,
          warnings: treasuryNotesWarnings,
          sources: parsed.sources || [],
          notes: parsed.notes
        }, null, 2));
        log('info', `Extracted ${treasuryNotesCount} treasury notes`);
      } catch (err) {
        log('error', 'Failed to write treasury notes JSON:', err.message);
      }
    } else {
      log('warn', 'Treasury Notes workbook was uploaded but no notes were extracted');
    }
  }

  // Extract agency offerings from any uploaded Excel files (bullets + callables).
  let agencyCount = null;
  let agencyWarnings = [];
  let agencySources = [];
  let agencyFileDate = null;   // date sniffed from the filename (the "file dated" date)

  if (touchesAgencies) {
    const agencySelection = collectAgencyPackageFiles(CURRENT_DIR, { slotFilenames, priorMeta });
    if (agencySelection.files.length === 0) {
      // Post-mutation: an agencies-only republish whose new file fails to collect
      // has already unlinked the prior _agencies.json. Throw so it's restored.
      throw Object.assign(new Error('No agency Bullets or Callables file is available to publish.'), { statusCode: 400 });
    }
    const agencyMissingSlots = agencySelection.missingSlots;

    const bulletsFile = agencySelection.files.find(f => f.slot === 'agenciesBullets');
    const callablesFile = agencySelection.files.find(f => f.slot === 'agenciesCallables');
    if (bulletsFile && !dateSniffs.agenciesBullets) {
      dateSniffs.agenciesBullets = sniffDateFromFilename(bulletsFile.filename) || priorMeta.agencyFileDate || null;
    }
    if (callablesFile && !dateSniffs.agenciesCallables) {
      dateSniffs.agenciesCallables = sniffDateFromFilename(callablesFile.filename) || priorMeta.agencyFileDate || null;
    }

    const parsed = parseAgenciesFiles(agencySelection.files);
    agencyCount = parsed.offerings.length;
    agencyWarnings = parsed.warnings.slice();
    agencySources = parsed.sources;
    if (agencyMissingSlots.length > 0) {
      const label = s => (s === 'agenciesBullets' ? 'Bullets' : 'Callables');
      agencyWarnings.push(`Agencies published one-sided: only ${agencySelection.files.map(f => label(f.slot)).join(' & ')} provided. The ${agencyMissingSlots.map(label).join(' & ')} side is empty in the Agency Explorer until it's published.`);
    }
    // Prefer bullets filename date, fall back to callables
    agencyFileDate = dateSniffs.agenciesBullets || dateSniffs.agenciesCallables || null;
    const payload = {
      uploadedAt: new Date().toISOString(),
      fileDate: agencyFileDate,
      sources: parsed.sources,
      warnings: agencyWarnings,
      offerings: parsed.offerings
    };
    try {
      fs.writeFileSync(
        path.join(CURRENT_DIR, AGENCIES_FILENAME),
        JSON.stringify(payload, null, 2)
      );
      log('info', `Extracted ${agencyCount} agency offerings from ${agencySelection.files.length} file(s)`);
    } catch (err) {
      log('error', 'Failed to write agencies JSON:', err.message);
    }
  }

  // Extract corporate offerings from the uploaded xlsx if present.
  let corporatesCount = null;
  let corporatesWarnings = [];
  let corporatesSources = [];
  let corporatesFileDate = null;
  const corpUpload = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'corporates');
  if (corpUpload) {
    const corpFileObj = [{
      filename: sanitizeFilename(corpUpload.filename),
      buffer: corpUpload.data
    }];
    const parsed = parseCorporatesFiles(corpFileObj);
    corporatesCount = parsed.offerings.length;
    corporatesWarnings = parsed.warnings;
    corporatesSources = parsed.sources;
    corporatesFileDate = dateSniffs.corporates || null;
    const payload = {
      uploadedAt: new Date().toISOString(),
      fileDate: corporatesFileDate,
      sources: parsed.sources,
      warnings: corporatesWarnings,
      offerings: parsed.offerings
    };
    try {
      fs.writeFileSync(
        path.join(CURRENT_DIR, CORPORATES_FILENAME),
        JSON.stringify(payload, null, 2)
      );
      log('info', `Extracted ${corporatesCount} corporate offerings`);
    } catch (err) {
      log('error', 'Failed to write corporates JSON:', err.message);
    }
  }

  // Cross-file date validation
  const dateValues = Object.values(dateSniffs).filter(Boolean);
  const uniqueDates = [...new Set(dateValues)];
  const dateWarnings = [];
  if (uniqueDates.length > 1) {
    const summary = Object.entries(dateSniffs)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    dateWarnings.push(`Files appear to be from different dates (${summary}). Double-check that all files are from the same business day.`);
  }
  if (offeringsAsOfDate && dateValues.length > 0 && !dateValues.includes(offeringsAsOfDate)) {
    dateWarnings.push(`CD Offers document is dated ${offeringsAsOfDate}, but filenames suggest ${dateValues.join(', ')}.`);
  }
  if (brokeredCdAsOfDate && dateValues.length > 0 && !dateValues.includes(brokeredCdAsOfDate)) {
    dateWarnings.push(`Brokered CD Rate Sheet is dated ${brokeredCdAsOfDate}, but filenames suggest ${dateValues.join(', ')}.`);
  }
  if (muniOfferingsAsOfDate && dateValues.length > 0 && !dateValues.includes(muniOfferingsAsOfDate)) {
    dateWarnings.push(`Muni Offerings document is dated ${muniOfferingsAsOfDate}, but filenames suggest ${dateValues.join(', ')}.`);
  }
  if (offeringsAsOfDate && muniOfferingsAsOfDate && offeringsAsOfDate !== muniOfferingsAsOfDate) {
    dateWarnings.push(`CD Offers (${offeringsAsOfDate}) and Muni Offerings (${muniOfferingsAsOfDate}) are dated differently inside the PDFs.`);
  }
  if (offeringsAsOfDate && brokeredCdAsOfDate && offeringsAsOfDate !== brokeredCdAsOfDate) {
    dateWarnings.push(`CD Offers (${offeringsAsOfDate}) and Brokered CD Rate Sheet (${brokeredCdAsOfDate}) are dated differently inside the PDFs.`);
  }
  if (mmdAsOfDate && dateValues.length > 0 && !dateValues.includes(mmdAsOfDate)) {
    dateWarnings.push(`MMD document is dated ${mmdAsOfDate}, but filenames suggest ${dateValues.join(', ')}.`);
  }

  const packageDate = offeringsAsOfDate || brokeredCdAsOfDate || muniOfferingsAsOfDate || mmdAsOfDate || uniqueDates[0] || todayStamp();

  const mergedOfferingsCount      = incomingSlots.has('cdoffers')    ? offeringsCount      : (priorMeta.offeringsCount ?? null);
  const mergedMuniOfferingsCount  = touchesMuniOfferings  ? muniOfferingsCount  : (priorMeta.muniOfferingsCount ?? null);
  const mergedTreasuryNotesCount  = incomingSlots.has('treasuryNotes') ? treasuryNotesCount : (priorMeta.treasuryNotesCount ?? null);
  const mergedAgencyCount         = touchesAgencies ? agencyCount        : (priorMeta.agencyCount ?? null);
  const mergedAgencyFileDate      = touchesAgencies ? agencyFileDate     : (priorMeta.agencyFileDate ?? null);
  const mergedCorporatesCount     = incomingSlots.has('corporates')  ? corporatesCount     : (priorMeta.corporatesCount ?? null);
  const mergedCorporatesFileDate  = incomingSlots.has('corporates')  ? corporatesFileDate  : (priorMeta.corporatesFileDate ?? null);
  const mergedBrokeredCdTerms     = incomingSlots.has('cd')          ? brokeredCdTerms     : (priorMeta.brokeredCdTerms ?? null);
  const mergedBrokeredCdAsOfDate  = incomingSlots.has('cd')          ? brokeredCdAsOfDate  : (priorMeta.brokeredCdAsOfDate ?? null);
  const mergedRelativeValueRowsCount = incomingSlots.has('relativeValue')
    ? relativeValueRowsCount
    : (priorMeta.relativeValueRowsCount ?? null);
  const mergedMmdCurveCount = incomingSlots.has('mmd')
    ? mmdCurveCount
    : (priorMeta.mmdCurveCount ?? null);

  // Merged slot filenames: preserve prior filenames for untouched slots
  const mergedSlotFilenames = { ...(priorMeta.slotFilenames || {}), ...slotFilenames };
  const mergedSlotFileLists = { ...(priorMeta.slotFileLists || {}) };
  for (const [slot, filenames] of Object.entries(slotFileLists)) {
    if (slot === 'cdoffers' && hasCdCostOnlyUpload && !hasCdPrimaryUpload) {
      mergedSlotFileLists[slot] = [
        ...new Set([...(mergedSlotFileLists[slot] || []), ...filenames])
      ];
    } else {
      mergedSlotFileLists[slot] = filenames;
    }
  }

  const meta = {
    date: packageDate,
    publishedAt: new Date().toISOString(),
    publishedBy: options.publishedBy || 'Portal User',
    offeringsCount:      mergedOfferingsCount,
    muniOfferingsCount:  mergedMuniOfferingsCount,
    treasuryNotesCount:  mergedTreasuryNotesCount,
    agencyCount:         mergedAgencyCount,
    agencyFileDate:      mergedAgencyFileDate,
    corporatesCount:     mergedCorporatesCount,
    corporatesFileDate:  mergedCorporatesFileDate,
    brokeredCdTerms:     mergedBrokeredCdTerms,
    brokeredCdAsOfDate:  mergedBrokeredCdAsOfDate,
    relativeValueRowsCount: mergedRelativeValueRowsCount,
    mmdCurveCount:     mergedMmdCurveCount,
    slotFilenames:       mergedSlotFilenames,
    slotFileLists:       mergedSlotFileLists
  };
  fs.writeFileSync(path.join(CURRENT_DIR, META_FILENAME), JSON.stringify(meta, null, 2));
  invalidatePackageCache();

  appendAuditLog({
    event: options.auditEvent || 'publish',
    packageDate,
    publishedBy: meta.publishedBy,
    sourceFolder: options.sourceFolder || undefined,
    files: saved.map(s => ({ type: s.type, filename: s.filename, size: s.size })),
    offeringsCount,
    cdHistorySnapshot,
    relativeValueRowsCount,
    mmdCurveCount,
    muniOfferingsCount,
    treasuryNotesCount,
    agencyCount,
    agencyFileDate,
    corporatesCount,
    corporatesFileDate,
    warnings: dateWarnings,
    parserWarnings: {
      econ: economicUpdateWarnings,
      cd: brokeredCdWarnings,
      cdoffers: offeringsWarnings,
      munioffers: muniOfferingsWarnings,
      mmd: mmdWarnings,
      treasuryNotes: treasuryNotesWarnings,
      agencies: agencyWarnings,
      corporates: corporatesWarnings
    }
  });

  log('info', 'Published package:', saved.map(s => `${s.type}=${s.filename}`).join(', '));
  let referenceIngest = null;
  if (typeof options.afterPublish === 'function') {
    try {
      referenceIngest = await options.afterPublish();
    } catch (err) {
      log('warn', 'Reference ingest failed:', err.message);
      referenceIngest = { error: err.message };
    }
  }
  sendJSON(res, 200, {
    success: true,
    saved,
    meta,
    referenceIngest,
    economicUpdateWarnings,
    offeringsCount,
    offeringsWarnings,
    cdHistorySnapshot,
    mmdCurveCount,
    mmdWarnings,
    muniOfferingsCount,
    muniOfferingsWarnings,
    treasuryNotesCount,
    treasuryNotesWarnings,
    agencyCount,
    agencyWarnings,
    agencySources,
    corporatesCount,
    corporatesWarnings,
    corporatesSources,
    dateWarnings
  });
}

// ---------- Rep identity / My Work ----------

function sendJSONWithHeaders(res, status, data, extraHeaders) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {})
  };
  res.writeHead(status, headers);
  res.end(body);
}

function summarizeRepBank(row) {
  return {
    bankId: row.bankId || '',
    displayName: row.displayName || row.legalName || '',
    city: row.city || '',
    state: row.state || '',
    certNumber: row.certNumber || '',
    status: row.status || '',
    owner: row.owner || '',
    updatedAt: row.updatedAt || ''
  };
}

function summarizeRepStrategy(row) {
  return {
    id: row.id,
    bankId: row.bankId,
    displayName: row.displayName || '',
    city: row.city || '',
    state: row.state || '',
    requestType: row.requestType || '',
    status: row.status || '',
    priority: row.priority || '',
    assignedTo: row.assignedTo || '',
    requestedBy: row.requestedBy || '',
    summary: row.summary || '',
    updatedAt: row.updatedAt || '',
    createdAt: row.createdAt || ''
  };
}

// An owned account is "going cold" when its newest manual CRM activity is older
// than this many days (or it has never been touched).
const COLD_ACCOUNT_DAYS = 30;

function buildMyWorkResponse(rep) {
  // Build a "no rep set" envelope so the client can render a prompt without crashing.
  if (!rep) {
    return {
      rep: null,
      myClients: { count: 0, recent: [] },
      myProspects: { count: 0, recent: [] },
      myOpenStrategies: { count: 0, recent: [], byStatus: { Open: 0, 'In Progress': 0, 'Needs Billed': 0 } },
      myOverdueFollowups: { count: 0, items: [] },
      myColdAccounts: { count: 0, items: [], thresholdDays: COLD_ACCOUNT_DAYS },
      myTasks: { openCount: 0, overdue: [], dueToday: [], upcoming: [] },
      recentlyTouched: []
    };
  }

  // Fetch each status independently so My Work can't miss a rep's older clients/prospects
  // because they fell outside a recent-N sample.
  const myClientsView = runBankView({ outputDir: BANK_REPORTS_DIR, viewId: 'clients', rep });
  const myProspectsView = runBankView({ outputDir: BANK_REPORTS_DIR, viewId: 'prospects', rep });
  const myClients = myClientsView ? myClientsView.rows : [];
  const myProspects = myProspectsView ? myProspectsView.rows : [];
  // For "recently touched", union the two and sort by updatedAt — same shape as before.
  const myAccountsForRecent = [...myClients, ...myProspects]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 50);

  const strategyResult = listStrategyRequests(BANK_REPORTS_DIR, { archived: '' }) || { requests: [], counts: {} };
  const openStatuses = new Set(['Open', 'In Progress', 'Needs Billed']);
  const myStrategies = (strategyResult.requests || []).filter(req => {
    if (!openStatuses.has(req.status)) return false;
    return (
      ownerStringContainsRep(req.assignedTo, rep) ||
      ownerStringContainsRep(req.requestedBy, rep)
    );
  });
  const stratByStatus = { Open: 0, 'In Progress': 0, 'Needs Billed': 0 };
  myStrategies.forEach(req => {
    if (stratByStatus[req.status] !== undefined) stratByStatus[req.status] += 1;
  });

  const today = new Date().toISOString().slice(0, 10);
  const savedBanks = listSavedBanks(BANK_REPORTS_DIR) || [];
  const myOverdue = savedBanks.filter(row => {
    if (!ownerStringContainsRep(row.owner, rep)) return false;
    if (!row.nextActionDate) return false;
    return String(row.nextActionDate).slice(0, 10) < today;
  });

  // "Going cold": owned saved banks whose latest manual CRM touch (call/email/
  // meeting/task/note) is older than COLD_ACCOUNT_DAYS or missing entirely.
  // Oldest-touch-first so the most neglected account tops the list.
  let lastTouchMap = {};
  try { lastTouchMap = lastActivityByBank(BANK_REPORTS_DIR) || {}; } catch (_) { /* views survive a coverage-db hiccup */ }
  const coldCutoff = new Date(Date.now() - COLD_ACCOUNT_DAYS * 86400000).toISOString().slice(0, 10);
  const myCold = savedBanks
    .filter(row => {
      if (!ownerStringContainsRep(row.owner, rep)) return false;
      const last = lastTouchMap[row.bankId] || '';
      return !last || last < coldCutoff;
    })
    .sort((a, b) => String(lastTouchMap[a.bankId] || '').localeCompare(String(lastTouchMap[b.bankId] || '')));

  // Recently touched: union of my accounts + my strategies, sorted by updatedAt desc.
  const touchedEntries = [];
  myAccountsForRecent.forEach(row => {
    touchedEntries.push({
      kind: 'account',
      at: row.updatedAt || '',
      bankId: row.bankId,
      displayName: row.displayName || row.legalName || '',
      city: row.city || '',
      state: row.state || '',
      detail: row.status ? `Status: ${row.status}` : ''
    });
  });
  myStrategies.slice(0, 50).forEach(req => {
    touchedEntries.push({
      kind: 'strategy',
      at: req.updatedAt || req.createdAt || '',
      bankId: req.bankId,
      displayName: req.displayName,
      city: req.city || '',
      state: req.state || '',
      detail: `${req.requestType} · ${req.status}`,
      strategyId: req.id
    });
  });
  touchedEntries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const recentlyTouched = touchedEntries.slice(0, 8);

  return {
    rep,
    myClients: {
      count: myClients.length,
      recent: myClients.slice(0, 5).map(summarizeRepBank)
    },
    myProspects: {
      count: myProspects.length,
      recent: myProspects.slice(0, 5).map(summarizeRepBank)
    },
    myOpenStrategies: {
      count: myStrategies.length,
      recent: myStrategies.slice(0, 5).map(summarizeRepStrategy),
      byStatus: stratByStatus
    },
    myOverdueFollowups: {
      count: myOverdue.length,
      items: myOverdue.slice(0, 8).map(row => ({
        bankId: row.bankId,
        displayName: row.displayName,
        city: row.city || '',
        state: row.state || '',
        nextActionDate: row.nextActionDate,
        priority: row.priority,
        status: row.status
      }))
    },
    myColdAccounts: {
      count: myCold.length,
      thresholdDays: COLD_ACCOUNT_DAYS,
      items: myCold.slice(0, 8).map(row => ({
        bankId: row.bankId,
        displayName: row.displayName,
        city: row.city || '',
        state: row.state || '',
        status: row.status,
        priority: row.priority,
        lastActivityDate: lastTouchMap[row.bankId] || ''
      }))
    },
    myTasks: buildMyTasks(rep, savedBanks),
    recentlyTouched
  };
}

// Open-task buckets for My Work, with bank display names joined from saved
// coverage (tasks on unsaved banks fall back to the raw bankId).
function buildMyTasks(rep, savedBanks) {
  try {
    const buckets = listTasksForRep(BANK_REPORTS_DIR, rep.username);
    const names = new Map((savedBanks || []).map(b => [b.bankId, b.displayName]));
    const decorate = t => ({ ...t, bankName: names.get(t.bankId) || t.bankId });
    return {
      openCount: buckets.openCount,
      overdue: buckets.overdue.slice(0, 10).map(decorate),
      dueToday: buckets.dueToday.slice(0, 10).map(decorate),
      upcoming: buckets.upcoming.slice(0, 10).map(decorate)
    };
  } catch (err) {
    log('warn', 'buildMyTasks failed:', err.message);
    return { openCount: 0, overdue: [], dueToday: [], upcoming: [] };
  }
}

function listKnownReps() {
  try {
    const distinct = listDistinctAccountOwners(BANK_REPORTS_DIR) || [];
    return aggregateRepsFromOwnerStrings(distinct);
  } catch (err) {
    log('warn', 'listKnownReps failed:', err.message);
    return [];
  }
}

// ---- Live CRM dashboard (#pulse) ----
// One payload for the whole page: KPI tiles, by-state and by-type breakdowns,
// recent manual activity, and upcoming follow-ups. Rep-scoped when an acting
// rep is resolved (?rep=all overrides, same convention as /api/bank-views).

function buildCrmDashboard(rep) {
  const today = new Date().toISOString().slice(0, 10);
  const repScope = rows => (rep ? rows.filter(r => ownerStringContainsRep(r.owner, rep)) : rows);

  // Clients / prospects come from the account-status universe (same source as
  // the Views tiles), not just saved coverage rows.
  const clients = repScope(listBankAccountStatuses(BANK_REPORTS_DIR, { status: 'Client', limit: 8000, maxLimit: 8000, sort: 'bank' }));
  const prospects = repScope(listBankAccountStatuses(BANK_REPORTS_DIR, { status: 'Prospect', limit: 8000, maxLimit: 8000, sort: 'bank' }));

  // By-state, two series — the SF "Clients & Prospects by State" bar chart.
  const stateMap = new Map();
  const bump = (rows, key) => rows.forEach(row => {
    const state = String(row.state || '').toUpperCase() || '—';
    const entry = stateMap.get(state) || { state, clients: 0, prospects: 0 };
    entry[key] += 1;
    stateMap.set(state, entry);
  });
  bump(clients, 'clients');
  bump(prospects, 'prospects');
  const byState = [...stateMap.values()].sort((a, b) => (b.clients + b.prospects) - (a.clients + a.prospects)).slice(0, 20);

  const savedBanks = listSavedBanks(BANK_REPORTS_DIR) || [];
  const myBanks = repScope(savedBanks);
  const quarter = Math.floor(new Date().getMonth() / 3);
  const quarterStart = `${new Date().getFullYear()}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
  const newThisQuarter = myBanks.filter(row => String(row.createdAt || '').slice(0, 10) >= quarterStart).length;
  const overdue = myBanks.filter(row => row.nextActionDate && String(row.nextActionDate).slice(0, 10) < today);
  const horizon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming = myBanks
    .filter(row => row.nextActionDate && String(row.nextActionDate).slice(0, 10) >= today && String(row.nextActionDate).slice(0, 10) <= horizon)
    .sort((a, b) => String(a.nextActionDate).localeCompare(String(b.nextActionDate)))
    .slice(0, 12)
    .map(row => ({
      bankId: row.bankId,
      displayName: row.displayName,
      owner: row.owner || '',
      nextActionDate: row.nextActionDate,
      priority: row.priority || 'Medium'
    }));

  const strategyResult = listStrategyRequests(BANK_REPORTS_DIR, { archived: '' }) || { requests: [] };
  const openStatuses = new Set(['Open', 'In Progress']);
  const openStrategies = (strategyResult.requests || []).filter(req => {
    if (!openStatuses.has(req.status)) return false;
    if (!rep) return true;
    return ownerStringContainsRep(req.assignedTo, rep) || ownerStringContainsRep(req.requestedBy, rep);
  });
  const typeMap = new Map();
  openStrategies.forEach(req => {
    const type = req.requestType || 'Miscellaneous';
    typeMap.set(type, (typeMap.get(type) || 0) + 1);
  });
  const strategiesByType = [...typeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  const bankNames = new Map(savedBanks.map(b => [b.bankId, b.displayName]));
  let recentActivities = [];
  try {
    recentActivities = listRecentManualActivities(BANK_REPORTS_DIR, { limit: 20 })
      .filter(item => !rep || String(item.actorUsername || '').toLowerCase() === String(rep.username || '').toLowerCase())
      .map(item => ({
        at: item.at,
        activityDate: item.activityDate || String(item.at || '').slice(0, 10),
        rep: item.actorDisplay || item.actorUsername || '',
        bankId: item.bankId,
        bankName: bankNames.get(item.bankId) || item.bankId,
        kind: item.kind,
        subject: item.subject || item.summary || ''
      }));
  } catch (err) {
    log('warn', 'CRM dashboard activities failed:', err.message);
  }

  let taskCounts = { open: 0, overdue: 0 };
  try {
    taskCounts = countOpenTasks(BANK_REPORTS_DIR, { username: rep ? rep.username : null });
  } catch (err) {
    log('warn', 'CRM dashboard task counts failed:', err.message);
  }

  let pipeline = null;
  try {
    pipeline = pipelineSummary(BANK_REPORTS_DIR, { username: rep ? rep.username : null });
  } catch (err) {
    log('warn', 'CRM dashboard pipeline failed:', err.message);
  }

  // THC portfolio roll-up across the (rep-scoped) covered book — aggregate
  // unrealized G/L for desk-level prioritization, worst books first.
  let portfolioRollup = null;
  try {
    const holdingsIdx = getCoverageHoldingsIndex();
    let banks = 0, bookValue = 0, marketValue = 0, gainLoss = 0;
    const books = [];
    for (const row of clients.concat(prospects)) {
      const h = holdingsIdx.get(String(row.bankId));
      if (!h || h.bookValue == null) continue;
      banks += 1;
      bookValue += h.bookValue;
      marketValue += h.marketValue || 0;
      gainLoss += h.gainLoss || 0;
      books.push({
        bankId: row.bankId,
        displayName: row.displayName || row.bankName || '',
        owner: row.owner || '',
        gainLoss: Math.round(h.gainLoss || 0),
        gainLossPct: h.bookValue ? (h.gainLoss || 0) / h.bookValue * 100 : null,
        reportDate: h.reportDate || ''
      });
    }
    if (banks) {
      books.sort((a, b) => a.gainLoss - b.gainLoss);
      portfolioRollup = {
        banks,
        bookValue: Math.round(bookValue),
        marketValue: Math.round(marketValue),
        gainLoss: Math.round(gainLoss),
        gainLossPct: bookValue ? gainLoss / bookValue * 100 : null,
        worst: books.slice(0, 5)
      };
    }
  } catch (err) {
    log('warn', 'CRM dashboard portfolio rollup failed:', err.message);
  }

  return {
    rep: rep ? { username: rep.username, displayName: rep.displayName } : null,
    asOf: new Date().toISOString(),
    kpis: {
      totalClients: clients.length,
      totalProspects: prospects.length,
      newThisQuarter,
      openStrategies: openStrategies.length,
      overdueFollowups: overdue.length,
      openTasks: taskCounts.open,
      overdueTasks: taskCounts.overdue
    },
    byState,
    strategiesByType,
    recentActivities,
    upcomingFollowups: upcoming,
    pipeline,
    portfolioRollup
  };
}

// Bank activity timeline writer. Pulls the actor from the request via the rep
// identity layer so every per-bank action carries who did it. Failure here must
// never fail the wrapping request — activity is observability, not the source
// of truth for the change itself.
function logBankActivity(req, payload) {
  try {
    if (!payload || !payload.bankId || !payload.kind) return null;
    const rep = resolveRequestRep(req);
    return recordBankActivity(BANK_REPORTS_DIR, {
      ...payload,
      actorUsername: payload.actorUsername || (rep ? rep.username : ''),
      actorDisplay: payload.actorDisplay || (rep ? rep.displayName : '')
    });
  } catch (err) {
    log('warn', 'recordBankActivity failed:', err.message);
    return null;
  }
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Neutralize spreadsheet formula injection (leading = + - @ or control char):
  // such a cell can execute when the CSV is opened in Excel. Prefix a single quote.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  return (rows || []).map(row => (row || []).map(escapeCsvCell).join(',')).join('\r\n');
}

function sendCsv(res, filename, csv) {
  const safe = String(filename || 'export.csv').replace(/[^a-z0-9._-]+/gi, '_');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': Buffer.byteLength(csv),
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${safe}"`
  });
  res.end(csv);
}

async function handleMeOverride(req, res) {
  try {
    const body = await readJsonBody(req, 8 * 1024);
    const username = body && body.username !== undefined ? body.username : undefined;
    const displayName = body && body.displayName ? String(body.displayName) : '';
    if (username === null || username === '') {
      return sendJSONWithHeaders(res, 200, { rep: null, cleared: true }, {
        'Set-Cookie': clearRepOverrideCookieHeader()
      });
    }
    if (!username) {
      return sendJSON(res, 400, { error: 'username is required' });
    }
    const trimmed = String(username).trim().slice(0, 120);
    if (!trimmed) return sendJSON(res, 400, { error: 'username is required' });
    const cookieValue = displayName ? `${displayName}|${trimmed}` : trimmed;
    appendAuditLog({ event: 'me-override', username: trimmed });
    return sendJSONWithHeaders(res, 200, {
      rep: { username: trimmed.toLowerCase().replace(/\s+/g, ''), displayName: displayName || trimmed, source: 'cookie' }
    }, {
      'Set-Cookie': buildRepOverrideCookie(cookieValue)
    });
  } catch (err) {
    return sendJSON(res, 400, { error: err.message || 'Could not set rep override' });
  }
}

// ---------- Request router ----------

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  let requestUrl;
  try {
    requestUrl = new URL(req.url || '/', 'http://localhost');
  } catch (_) {
    return sendText(res, 400, 'Bad request');
  }
  const pathname = safeDecodeURIComponent(requestUrl.pathname || '/');
  const query = requestUrl.searchParams;

  res.on('finish', () => {
    const ms = Date.now() - start;
    log('debug', req.method, requestUrl.pathname, '→', res.statusCode, `(${ms}ms)`);
  });

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Defense-in-depth: restrict where the SPA shell can load resources from.
  // We deliberately do NOT apply this strict CSP to user-uploaded files served
  // from /current/ or /archive/ — those (esp. dashboard HTML) legitimately
  // load CDN libraries like Chart.js. The dashboard iframe is sandboxed
  // client-side instead, which puts it in an opaque origin so it cannot
  // make same-origin fetches against this app's APIs.
  const isUserContent =
    pathname.startsWith('/current/') || pathname.startsWith('/archive/');
  if (!isUserContent) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; " +
      "frame-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'"
    );
  }

  if (!pathname) {
    return sendText(res, 400, 'Bad request');
  }

  auditContext.enterWith({ actor: auditActorForRequest(req) });

  if (isMutatingApiRequest(req, pathname) && !isSameOriginWrite(req)) {
    return sendJSON(res, 403, { error: 'Cross-site write request blocked' });
  }
  const authRejection = rejectIfUnauthorized(req, res, pathname);
  if (authRejection) return authRejection;

  try {
    // --- API ---

    if (pathname === '/api/current' && req.method === 'GET') {
      return sendJSON(res, 200, getCurrentPackage() || {});
    }

    if (pathname === '/api/archive' && req.method === 'GET') {
      return sendJSON(res, 200, getArchiveList());
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(res, 200, buildHealthStatus());
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const { rep, auth } = authInfoForRequest(req);
      return sendJSON(res, 200, { rep, auth });
    }

    if (pathname === '/api/me/reps' && req.method === 'GET') {
      return sendJSON(res, 200, { reps: listKnownReps() });
    }

    if (pathname === '/api/me/override' && req.method === 'POST') {
      if (!ALLOW_REP_OVERRIDE) {
        return sendJSON(res, 403, { error: 'Manual rep switching is disabled in production mode.' });
      }
      return await handleMeOverride(req, res);
    }

    if (pathname === '/api/me/work' && req.method === 'GET') {
      const rep = resolveRequestRep(req);
      return sendJSON(res, 200, buildMyWorkResponse(rep));
    }

    if (pathname === '/api/market/yield-curve' && req.method === 'GET') {
      const curve = await marketRates.getLatestYieldCurve({ marketDir: MARKET_DIR, log });
      return sendJSON(res, 200, { curve });
    }

    // Live market wire: official headlines (Fed/FDIC/SEC RSS) + headline
    // economic indicators (keyless BLS) + a curve summary from the cached
    // Treasury feed. Each source degrades independently to stale-or-null.
    if (pathname === '/api/market/wire' && req.method === 'GET') {
      const [headlines, indicators, curve, auctions, fred] = await Promise.all([
        marketWire.getLatestHeadlines({ marketDir: MARKET_DIR, log }),
        marketWire.getEconomicIndicators({ marketDir: MARKET_DIR, log }),
        marketRates.getLatestYieldCurve({ marketDir: MARKET_DIR, log }),
        marketWire.getTreasuryAuctions({ marketDir: MARKET_DIR, log }),
        fredSeries.getFredIndicators({ marketDir: MARKET_DIR, log }), // null until FRED_API_KEY is set
      ]);
      let rates = null;
      if (curve && curve.tenors) {
        const t10 = curve.tenors['10Y'];
        const t2 = curve.tenors['2Y'];
        rates = {
          asOfDate: curve.asOfDate,
          tenYear: t10 != null ? t10 : null,
          twoYear: t2 != null ? t2 : null,
          spread2s10sBp: t10 != null && t2 != null ? Math.round((t10 - t2) * 100) : null,
          changes: curve.changes || {},
        };
      }
      return sendJSON(res, 200, { headlines, indicators, rates, auctions, fred });
    }

    if (pathname === '/api/search/cusip' && req.method === 'GET') {
      return sendJSON(res, 200, searchCusipEverywhere(query.get('q')));
    }

    // Per-rep watchlist: securities re-joined to today's inventory (live
    // yield/price + still-offered flag) and banks joined to summaries.
    if (pathname === '/api/me/watchlist' && req.method === 'GET') {
      const rep = resolveRequestRep(req);
      if (!rep) return sendJSON(res, 200, { rep: null, items: [] });
      const items = listWatchlist(BANK_REPORTS_DIR, rep.username);
      const live = new Map(buildAllOfferingsRows().filter(r => r.cusip).map(r => [r.cusip, r]));
      const bankIds = items.filter(i => i.kind === 'bank').map(i => i.refId);
      const summaries = getBankSummariesByIds(BANK_REPORTS_DIR, bankIds);
      const enriched = items.map(item => {
        if (item.kind === 'security') {
          const row = live.get(item.refId);
          return { ...item, stillOffered: Boolean(row), live: row ? { yield: row.yield, price: row.price, maturity: row.maturity, assetClass: row.assetClass, page: row.page } : null };
        }
        const s = summaries.get(String(item.refId)) || {};
        return { ...item, bankName: s.displayName || s.name || item.label || item.refId, city: s.city || '', state: s.state || '' };
      });
      return sendJSON(res, 200, { rep: { username: rep.username, displayName: rep.displayName }, items: enriched });
    }
    if (pathname === '/api/me/watchlist' && req.method === 'POST') {
      const rep = resolveRequestRep(req);
      if (!rep) return sendJSON(res, 400, { error: 'Pick a rep first (top bar) so the watchlist has an owner.' });
      const body = await readJsonBody(req, 16 * 1024);
      const added = addWatchlistItem(BANK_REPORTS_DIR, { ...body, rep: rep.username });
      if (!added) return sendJSON(res, 400, { error: 'Invalid watchlist item' });
      appendAuditLog({ event: 'watchlist-add', rep: rep.username, kind: added.kind, refId: added.refId });
      return sendJSON(res, 200, { success: true });
    }
    if (pathname === '/api/me/watchlist' && req.method === 'DELETE') {
      const rep = resolveRequestRep(req);
      if (!rep) return sendJSON(res, 400, { error: 'No acting rep' });
      const removed = removeWatchlistItem(BANK_REPORTS_DIR, rep.username, query.get('kind'), query.get('refId'));
      if (removed) {
        appendAuditLog({ event: 'watchlist-remove', rep: rep.username, kind: query.get('kind'), refId: query.get('refId') });
      }
      return sendJSON(res, removed ? 200 : 404, removed ? { success: true } : { error: 'Not on your watchlist' });
    }

    if (pathname === '/api/contacts/import' && req.method === 'POST') {
      const dryRun = query.get('dryRun') === '1' || query.get('dryRun') === 'true';
      return await handleContactsImport(req, res, dryRun);
    }

    // Firm-wide contacts directory: every contact across every bank, joined
    // to bank display names, filtered by q across contact AND bank fields.
    if (pathname === '/api/contacts' && req.method === 'GET') {
      const contacts = listAllContacts(BANK_REPORTS_DIR);
      const ids = [...new Set(contacts.map(c => c.bankId).filter(Boolean))];
      const summaries = getBankSummariesByIds(BANK_REPORTS_DIR, ids);
      const enriched = contacts.map(c => {
        const s = summaries.get(String(c.bankId)) || {};
        return { ...c, bankName: s.displayName || s.name || c.bankId, city: s.city || '', state: s.state || '' };
      });
      const q = String(query.get('q') || '').trim().toLowerCase();
      const filtered = q
        ? enriched.filter(c => {
            const hay = [c.name, c.role, c.email, c.phone, c.bankName, c.city, c.state].join(' ').toLowerCase();
            return q.split(/\s+/).every(term => hay.includes(term));
          })
        : enriched;
      return sendJSON(res, 200, { contacts: filtered, total: enriched.length });
    }

    if (pathname === '/api/offerings/all' && req.method === 'GET') {
      const pkg = getCurrentPackage() || {};
      return sendJSON(res, 200, {
        date: pkg.date || null,
        rows: buildAllOfferingsRows(),
      });
    }

    if (pathname === '/api/crm/dashboard' && req.method === 'GET') {
      const repParam = String(query.get('rep') || '').toLowerCase();
      const rep = repParam === 'all' ? null : resolveRequestRep(req);
      return sendJSON(res, 200, buildCrmDashboard(rep));
    }

    // Pull the newest FDIC-filed quarter into bank-data.sqlite (stopgap until
    // the full FedFis workbook arrives — never overwrites existing periods).
    // Admin-gated like the Upload/Admin pages. ?dryRun=1 reports only.
    if (pathname === '/api/admin/fdic-sync' && req.method === 'POST') {
      const { auth } = authInfoForRequest(req);
      if ((IS_IIS_AUTH_MODE || ADMIN_USERS.size > 0) && !auth.isAdmin) {
        return sendJSON(res, 403, { error: 'Admin permission is required for the FDIC sync.' });
      }
      try {
        const dryRun = query.get('dryRun') === '1' || query.get('dryRun') === 'true';
        const result = await fdicBulkSync.syncFdicQuarter(BANK_REPORTS_DIR, { dryRun, log });
        if (!dryRun && result.updated > 0) invalidateBankCaches();
        appendAuditLog({ event: 'fdic-sync', ...result });
        return sendJSON(res, 200, result);
      } catch (err) {
        log('error', 'FDIC sync failed:', err.message);
        return sendJSON(res, err.statusCode || 502, { error: err.message || 'FDIC sync failed' });
      }
    }

    if (pathname === '/api/admin/go-live-status' && req.method === 'GET') {
      const { auth } = authInfoForRequest(req);
      if ((IS_IIS_AUTH_MODE || ADMIN_USERS.size > 0) && !auth.isAdmin) {
        return sendJSON(res, 403, { error: 'Admin permission is required for this view.' });
      }
      return sendJSON(res, 200, buildGoLiveStatus(req));
    }

    // Management-only Executive Summary (Tier-B internal). Admin-gated, same as the
    // Upload/Admin pages: in production (or whenever an admin allowlist is set) only
    // FBBS_ADMIN_USERS may read it; on a local laptop with no allowlist it is open.
    if ((pathname === '/api/exec-summary' || pathname === '/api/exec-summary/history') && req.method === 'GET') {
      const { auth } = authInfoForRequest(req);
      if ((IS_IIS_AUTH_MODE || ADMIN_USERS.size > 0) && !auth.isAdmin) {
        return sendJSON(res, 403, { error: 'Management/admin permission is required for the Executive Summary.' });
      }
      if (pathname === '/api/exec-summary/history') {
        return sendJSON(res, 200, { snapshots: execSummaryStore.listSnapshots(EXEC_SUMMARY_DIR) });
      }
      const date = query.get('date');
      const summary = date
        ? execSummaryStore.getSnapshot(EXEC_SUMMARY_DIR, date)
        : execSummaryStore.getLatestSnapshot(EXEC_SUMMARY_DIR);
      if (!summary) {
        return sendJSON(res, 404, {
          error: date ? `No executive summary for ${date}` : 'No executive summary yet — upload holdings, TBLT trades, and margin on the Exec Summary tab.'
        });
      }
      // Attach a compact KPI trend (last ~30 snapshots) for the trend card.
      try { summary.trend = execSummaryStore.getTrend(EXEC_SUMMARY_DIR, summary.asOfDate, 30); } catch (_) { /* trend optional */ }
      return sendJSON(res, 200, summary);
    }

    if (pathname === '/api/bank-views' && req.method === 'GET') {
      const repParam = String(query.get('rep') || '').toLowerCase();
      const rep = repParam === 'all' ? null : resolveRequestRep(req);
      return sendJSON(res, 200, {
        rep,
        views: listBankViewSummaries({ outputDir: BANK_REPORTS_DIR, rep })
      });
    }

    const bankViewCsvMatch = pathname.match(/^\/api\/bank-views\/([^/]+)\.csv$/);
    if (bankViewCsvMatch && req.method === 'GET') {
      const viewId = safeDecodeURIComponent(bankViewCsvMatch[1]);
      if (!viewId) return sendText(res, 400, 'Invalid view ID');
      const repParam = String(query.get('rep') || '').toLowerCase();
      const rep = repParam === 'all' ? null : resolveRequestRep(req);
      const result = runBankView({ outputDir: BANK_REPORTS_DIR, viewId, rep });
      if (!result) return sendText(res, 404, 'Unknown view');
      const csv = rowsToCsv(viewToCsvRows(result));
      const today = new Date().toISOString().slice(0, 10);
      const tag = rep ? `_${rep.username}` : '';
      return sendCsv(res, `fbbs_${viewId}${tag}_${today}.csv`, csv);
    }

    const bankViewMatch = pathname.match(/^\/api\/bank-views\/([^/]+)$/);
    if (bankViewMatch && req.method === 'GET') {
      const viewId = safeDecodeURIComponent(bankViewMatch[1]);
      if (!viewId) return sendJSON(res, 400, { error: 'Invalid view ID' });
      const repParam = String(query.get('rep') || '').toLowerCase();
      const rep = repParam === 'all' ? null : resolveRequestRep(req);
      const result = runBankView({ outputDir: BANK_REPORTS_DIR, viewId, rep });
      if (!result) return sendJSON(res, 404, { error: 'Unknown view' });
      return sendJSON(res, 200, result);
    }

    if (pathname === '/api/daily-intelligence' && req.method === 'GET') {
      return sendJSON(res, 200, await buildDailyIntelligence());
    }

    if (pathname === '/api/offerings' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? loadArchivedOfferings(date) : loadCurrentOfferings();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No offerings data for ${date}`
            : 'No offerings data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/economic-update' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? await loadArchivedEconomicUpdate(date) : await loadCurrentEconomicUpdate();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No economic update data for ${date}`
            : 'No economic update data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/relative-value' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? await loadArchivedRelativeValueSnapshot(date) : await loadCurrentRelativeValueSnapshot();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No relative value data for ${date}`
            : 'No relative value data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/cd-recap/weekly' && req.method === 'GET') {
      const anchorDate = query.get('anchorDate');
      return sendJSON(res, 200, summarizeWeeklyCdHistory(CD_HISTORY_DIR, { anchorDate }));
    }

    if (pathname === '/api/mmd' && req.method === 'GET') {
      const date = query.get('date');
      const data = await (date ? loadArchivedMmdCurve(date) : loadCurrentMmdCurve());
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No MMD curve data for ${date}`
            : 'No MMD curve data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/muni-offerings' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? loadArchivedMuniOfferings(date) : loadCurrentMuniOfferings();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No muni offerings data for ${date}`
            : 'No muni offerings data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/treasury-notes' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? loadArchivedTreasuryNotes(date) : loadCurrentTreasuryNotes();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No treasury notes data for ${date}`
            : 'No treasury notes data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/agencies' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? loadArchivedAgencies(date) : loadCurrentAgencies();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No agency data for ${date}`
            : 'No agency data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/corporates' && req.method === 'GET') {
      const date = query.get('date');
      const data = date ? loadArchivedCorporates(date) : loadCurrentCorporates();
      if (!data) {
        return sendJSON(res, 404, {
          error: date
            ? `No corporate data for ${date}`
            : 'No corporate data in the current package'
        });
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/mbs-cmo' && req.method === 'GET') {
      return sendJSON(res, 200, loadMbsCmoInventory(MBS_CMO_DIR));
    }

    if (pathname === '/api/mbs-cmo/upload' && req.method === 'POST') {
      return await handleMbsCmoUpload(req, res);
    }

    if (pathname === '/api/structured-notes' && req.method === 'GET') {
      return sendJSON(res, 200, loadStructuredNotesInventory(STRUCTURED_NOTES_DIR));
    }

    const structuredNoteFileMatch = pathname.match(/^\/api\/structured-notes\/files\/([^/]+)$/);
    if (structuredNoteFileMatch && req.method === 'GET') {
      const fileId = safeDecodeURIComponent(structuredNoteFileMatch[1]);
      if (!fileId) return sendText(res, 400, 'Invalid structured note file ID');
      const file = getStructuredNoteSourceFile(STRUCTURED_NOTES_DIR, fileId);
      if (!file || !fs.existsSync(file.path)) return sendText(res, 404, 'Not found');
      return sendFile(res, file.path, { download: true, filename: file.filename });
    }

    // Market color is now an automatic public-RSS news feed (CNBC + MarketWatch),
    // not the desk's uploaded .eml inbox — same playbook as the Fed/SEC wire.
    if (pathname === '/api/market-color' && req.method === 'GET') {
      return sendJSON(res, 200, await marketColorFeed.getMarketColorFeed({ marketDir: MARKET_DIR, log }));
    }

    if (pathname === '/api/cd-internal' && req.method === 'GET') {
      return sendJSON(res, 200, loadCdInternalInventory(CD_INTERNAL_DIR));
    }

    if (pathname === '/api/portfolio-review/eligible-banks' && req.method === 'GET') {
      const q = String(query.get('q') || '').trim().toLowerCase();
      const banks = listSwapEligibleBanks().filter(row => {
        if (!q) return true;
        return [row.name, row.city, row.state, row.certNumber, row.accountStatus]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });
      return sendJSON(res, 200, { banks });
    }

    if (pathname === '/api/portfolio-review' && req.method === 'GET') {
      return handlePortfolioReview(res, query);
    }

    // Printable portfolio review (Save-as-PDF handout). Keyed by bankId like the
    // JSON route above; renders the same buildPortfolioReview payload.
    if (pathname === '/api/portfolio-review/render' && req.method === 'GET') {
      const bankId = String(query.get('bankId') || '').trim();
      if (!bankId) return sendText(res, 400, 'bankId is required');
      let review;
      try {
        review = buildPortfolioReview(bankId, query);
      } catch (err) {
        log('error', `Portfolio review render failed for ${bankId}:`, err.message);
        return sendText(res, 500, 'Could not build portfolio review');
      }
      if (!review) return sendText(res, 404, 'Bank not found');
      if (review.available === false) return sendText(res, 404, review.notice || 'No portfolio available for this bank');
      const html = renderPortfolioReviewHtml(review, { bankName: review.bankName });
      return sendPrintableHtml(res, html);
    }

    // ---- Reports Workspace persistence. Register the literal /api/reports and
    // /api/reports/hidden routes BEFORE the /api/reports/:id regex so "hidden"
    // isn't captured as an id. ----
    if (pathname === '/api/reports' && req.method === 'GET') {
      return handleListReports(req, res, query);
    }
    if (pathname === '/api/reports' && req.method === 'POST') {
      return await handleCreateReport(req, res);
    }
    if (pathname === '/api/reports/hidden' && req.method === 'GET') {
      return sendJSON(res, 200, { hidden: reportStore.listHiddenReportIds(BANK_REPORTS_DIR, resolveRequestRep(req)) });
    }
    if (pathname === '/api/reports/hidden' && req.method === 'POST') {
      return await handleSetReportHidden(req, res);
    }
    // Aggregation reports (Phase 4) — named routes BEFORE the :id regex.
    if (pathname === '/api/reports/activity-summary' && req.method === 'GET') {
      return handleActivitySummaryReport(req, res, query);
    }
    if (pathname === '/api/reports/account-touch' && req.method === 'GET') {
      return handleAccountTouchReport(req, res, query);
    }
    const reportIdMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
    if (reportIdMatch && req.method === 'PATCH') {
      const id = safeDecodeURIComponent(reportIdMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid report id' });
      return await handleUpdateReport(req, res, id);
    }
    if (reportIdMatch && req.method === 'DELETE') {
      const id = safeDecodeURIComponent(reportIdMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid report id' });
      return handleDeleteReport(req, res, id);
    }

    const mbsCmoFileMatch = pathname.match(/^\/api\/mbs-cmo\/files\/([^/]+)$/);
    if (mbsCmoFileMatch && req.method === 'GET') {
      const fileId = safeDecodeURIComponent(mbsCmoFileMatch[1]);
      if (!fileId) return sendText(res, 400, 'Invalid MBS/CMO file ID');
      const file = getMbsCmoSourceFile(MBS_CMO_DIR, fileId);
      if (!file || !fs.existsSync(file.path)) return sendText(res, 404, 'Not found');
      return sendFile(res, file.path, { download: true, filename: file.filename });
    }

    // ---- Bond Swap proposals (tab under Strategies; routes namespaced
    // under /api/swap-proposals so they don't tangle with the existing
    // /api/strategies/:id catchall below.) ----

    if (pathname === '/api/cd-rollover-wall' && req.method === 'GET') {
      return sendJSON(res, 200, buildCdRolloverWall(query));
    }

    if (pathname === '/api/maturity-calendar' && req.method === 'GET') {
      // Cached Treasury curve feeds the call-economics fallback; never blocks
      // the calendar (null curve just means no treasury-basis verdicts).
      const curve = await marketRates.getLatestYieldCurve({ marketDir: MARKET_DIR, log });
      return sendJSON(res, 200, buildMaturityCalendar(query, curve));
    }

    if (pathname === '/api/swap-proposals/eligible-banks' && req.method === 'GET') {
      return sendJSON(res, 200, { banks: listSwapEligibleBanks() });
    }

    if (pathname === '/api/swap-proposals/suggested' && req.method === 'GET') {
      const bankId = String(query.get('bankId') || '').trim();
      if (!bankId) return sendJSON(res, 400, { error: 'bankId is required' });
      return handleSwapSuggested(res, bankId, query);
    }

    if (pathname === '/api/swap-proposals/holdings' && req.method === 'GET') {
      const bankId = String(query.get('bankId') || '').trim();
      if (!bankId) return sendJSON(res, 400, { error: 'bankId is required' });
      return handleSwapHoldings(res, bankId);
    }

    if (pathname === '/api/swap-proposals/inventory' && req.method === 'GET') {
      return handleSwapInventory(res, query);
    }

    if (pathname === '/api/swap-proposals' && req.method === 'GET') {
      return sendJSON(res, 200, {
        proposals: swapStore.listProposals(BANK_REPORTS_DIR, {
          bankId: query.get('bankId') || undefined,
          status: query.get('status') || undefined,
          limit: parseInt(query.get('limit'), 10) || 100
        })
      });
    }

    if (pathname === '/api/swap-proposals' && req.method === 'POST') {
      return await handleCreateSwapProposal(req, res);
    }

    const swapLegDeleteMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/legs\/(\d+)$/);
    if (swapLegDeleteMatch && req.method === 'DELETE') {
      const id = safeDecodeURIComponent(swapLegDeleteMatch[1]);
      const legId = parseInt(swapLegDeleteMatch[2], 10);
      if (!id || !Number.isFinite(legId)) return sendJSON(res, 400, { error: 'Invalid leg path' });
      return handleDeleteSwapLeg(req, res, id, legId);
    }
    if (swapLegDeleteMatch && req.method === 'PATCH') {
      const id = safeDecodeURIComponent(swapLegDeleteMatch[1]);
      const legId = parseInt(swapLegDeleteMatch[2], 10);
      if (!id || !Number.isFinite(legId)) return sendJSON(res, 400, { error: 'Invalid leg path' });
      return await handleUpdateSwapLeg(req, res, id, legId);
    }

    const swapLegMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/legs$/);
    if (swapLegMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(swapLegMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return await handleAddSwapLeg(req, res, id);
    }

    const swapSendMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/send$/);
    if (swapSendMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(swapSendMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return await handleSendSwapProposal(req, res, id);
    }

    const swapCancelMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/cancel$/);
    if (swapCancelMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(swapCancelMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return handleCancelSwapProposal(req, res, id);
    }

    const swapExecuteMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/execute$/);
    if (swapExecuteMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(swapExecuteMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return handleExecuteSwapProposal(req, res, id);
    }

    const swapCloneMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/clone$/);
    if (swapCloneMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(swapCloneMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return handleCloneSwapProposal(req, res, id);
    }

    const swapRenderMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/render$/);
    if (swapRenderMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(swapRenderMatch[1]);
      if (!id) return sendText(res, 400, 'Invalid proposal id');
      const record = swapStore.getProposal(BANK_REPORTS_DIR, id);
      if (!record) return sendText(res, 404, 'Proposal not found');
      const summary = getBankSummaryForCoverage(record.proposal.bankId);
      const html = renderProposalHtml(record, {
        bankName: summary ? (summary.displayName || summary.name) : ''
      });
      return sendPrintableHtml(res, html);
    }

    const swapSizeBuyMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)\/size-buy$/);
    if (swapSizeBuyMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(swapSizeBuyMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return handleSizeBuySwapProposal(res, id, query);
    }

    const swapProposalMatch = pathname.match(/^\/api\/swap-proposals\/([^/]+)$/);
    if (swapProposalMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(swapProposalMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      const record = swapStore.getProposal(BANK_REPORTS_DIR, id);
      if (!record) return sendJSON(res, 404, { error: 'Proposal not found' });
      return sendJSON(res, 200, withComputedSummary(record));
    }
    if (swapProposalMatch && req.method === 'PATCH') {
      const id = safeDecodeURIComponent(swapProposalMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid proposal id' });
      return await handleUpdateSwapProposal(req, res, id);
    }

    if (pathname === '/api/strategies' && req.method === 'GET') {
      return sendJSON(res, 200, listStrategyRequests(BANK_REPORTS_DIR, {
        archived: query.get('archived'),
        status: query.get('status'),
        bankId: query.get('bankId')
      }));
    }

    if (pathname === '/api/strategies' && req.method === 'POST') {
      return await handleCreateStrategyRequest(req, res);
    }

    // Complete per-bank strategy counts (no 500-row cap) for the Coverage Book.
    // Registered before the /api/strategies/:id matches so "summary" isn't read
    // as an id.
    if (pathname === '/api/strategies/summary' && req.method === 'GET') {
      return sendJSON(res, 200, { byBank: summarizeStrategyCountsByBank(BANK_REPORTS_DIR) });
    }

    const strategyFileMatch = pathname.match(/^\/api\/strategies\/([^/]+)\/files\/([^/]+)$/);
    if (strategyFileMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(strategyFileMatch[1]);
      const fileId = safeDecodeURIComponent(strategyFileMatch[2]);
      if (!id || !fileId) return sendText(res, 400, 'Invalid strategy file ID');
      const file = getStrategyRequestFile(BANK_REPORTS_DIR, id, fileId);
      if (!file || !fs.existsSync(file.path)) return sendText(res, 404, 'Not found');
      return sendFile(res, file.path, { download: true, filename: file.filename });
    }

    const strategyFileUploadMatch = pathname.match(/^\/api\/strategies\/([^/]+)\/files$/);
    if (strategyFileUploadMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(strategyFileUploadMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid strategy request ID' });
      return await handleUploadStrategyRequestFile(req, res, id);
    }

    const strategyDeleteActionMatch = pathname.match(/^\/api\/strategies\/([^/]+)\/delete$/);
    if (strategyDeleteActionMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(strategyDeleteActionMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid strategy request ID' });
      return handleDeleteStrategyRequest(req, res, id);
    }

    const strategyMatch = pathname.match(/^\/api\/strategies\/([^/]+)$/);
    if (strategyMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(strategyMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid strategy request ID' });
      return await handleUpdateStrategyRequest(req, res, id);
    }
    if (strategyMatch && req.method === 'DELETE') {
      const id = safeDecodeURIComponent(strategyMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid strategy request ID' });
      return handleDeleteStrategyRequest(req, res, id);
    }

    if (pathname === '/api/bank-coverage' && req.method === 'GET') {
      return sendJSON(res, 200, { savedBanks: listSavedBanks(BANK_REPORTS_DIR) });
    }

    if (pathname === '/api/bank-coverage' && req.method === 'POST') {
      return await handleSaveBankCoverage(req, res);
    }

    const bankCoverageMatch = pathname.match(/^\/api\/bank-coverage\/([^/]+)$/);
    if (bankCoverageMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankCoverageMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const coverage = getBankCoverage(BANK_REPORTS_DIR, bankId);
      const summary = getBankSummaryForCoverage(bankId);
      const statuses = summary ? getBankAccountStatuses(BANK_REPORTS_DIR, [bankId]) : new Map();
      const coverageMap = coverage.saved ? new Map([[String(bankId), coverage.saved]]) : new Map();
      return sendJSON(res, 200, {
        ...coverage,
        accountStatus: summary ? effectiveAccountStatus(summary, statuses, coverageMap) : null,
        peerPreference: getPreferredPeerGroup(BANK_REPORTS_DIR, bankId),
        contacts: listContactsForBank(BANK_REPORTS_DIR, bankId),
        productFit: listProductFitForBank(BANK_REPORTS_DIR, bankId),
        productCatalog: PRODUCT_FIT_PRODUCTS
      });
    }

    const bankProductFitMatch = pathname.match(/^\/api\/banks\/([^/]+)\/product-fit$/);
    if (bankProductFitMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankProductFitMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return sendJSON(res, 200, {
        products: PRODUCT_FIT_PRODUCTS,
        productFit: listProductFitForBank(BANK_REPORTS_DIR, bankId)
      });
    }
    if (bankProductFitMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankProductFitMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleUpsertProductFit(req, res, bankId);
    }

    const productFitItemMatch = pathname.match(/^\/api\/bank-product-fit\/([^/]+)$/);
    if (productFitItemMatch && req.method === 'DELETE') {
      const id = safeDecodeURIComponent(productFitItemMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid product-fit ID' });
      return handleDeleteProductFit(req, res, id);
    }

    if (pathname === '/api/billing-queue' && req.method === 'GET') {
      const state = query.get('state');
      return sendJSON(res, 200, {
        items: listBillingQueue(BANK_REPORTS_DIR, { state, limit: query.get('limit') }),
        counts: countBillingByState(BANK_REPORTS_DIR)
      });
    }

    const billingItemMatch = pathname.match(/^\/api\/billing-queue\/([^/]+)$/);
    if (billingItemMatch && req.method === 'PATCH') {
      const id = safeDecodeURIComponent(billingItemMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid billing ID' });
      return await handleUpdateBilling(req, res, id);
    }

    const bankActivityMatch = pathname.match(/^\/api\/banks\/([^/]+)\/activity$/);
    if (bankActivityMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankActivityMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const limit = query.get('limit');
      return sendJSON(res, 200, {
        activities: listActivitiesForBank(BANK_REPORTS_DIR, bankId, { limit })
      });
    }
    if (bankActivityMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankActivityMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleLogBankActivity(req, res, bankId);
    }

    const bankActivityItemMatch = pathname.match(/^\/api\/banks\/([^/]+)\/activity\/([^/]+)$/);
    if (bankActivityItemMatch && req.method === 'DELETE') {
      const bankId = safeDecodeURIComponent(bankActivityItemMatch[1]);
      const activityId = safeDecodeURIComponent(bankActivityItemMatch[2]);
      if (!bankId || !activityId) return sendJSON(res, 400, { error: 'Invalid activity ID' });
      // Soft delete with a required reason — the row is retained for audit.
      const reason = String(query.get('reason') || '').trim();
      if (!reason) return sendJSON(res, 400, { error: 'A removal reason is required' });
      const rep = resolveRequestRep(req);
      const removed = deleteBankActivity(BANK_REPORTS_DIR, bankId, activityId, {
        deletedBy: rep ? (rep.displayName || rep.username) : '',
        reason
      });
      if (!removed) return sendJSON(res, 404, { error: 'Activity not found' });
      appendAuditLog({
        event: 'bank-activity-delete',
        bankId,
        activityId,
        kind: removed.kind,
        deletedBy: rep ? rep.username : '',
        reason
      });
      return sendJSON(res, 200, { success: true, activity: removed });
    }

    const bankTasksMatch = pathname.match(/^\/api\/banks\/([^/]+)\/tasks$/);
    if (bankTasksMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankTasksMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const includeClosed = query.get('includeClosed') === '1' || query.get('includeClosed') === 'true';
      return sendJSON(res, 200, { tasks: listTasksForBank(BANK_REPORTS_DIR, bankId, { includeClosed }) });
    }
    if (bankTasksMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankTasksMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleCreateBankTask(req, res, bankId);
    }

    const bankTaskItemMatch = pathname.match(/^\/api\/bank-tasks\/([^/]+)$/);
    if (bankTaskItemMatch && req.method === 'PATCH') {
      const taskId = safeDecodeURIComponent(bankTaskItemMatch[1]);
      if (!taskId) return sendJSON(res, 400, { error: 'Invalid task ID' });
      return await handleUpdateBankTask(req, res, taskId);
    }

    if (pathname === '/api/me/tasks' && req.method === 'GET') {
      const rep = resolveRequestRep(req);
      if (!rep) return sendJSON(res, 200, { rep: null, overdue: [], dueToday: [], upcoming: [], openCount: 0 });
      const savedBanks = listSavedBanks(BANK_REPORTS_DIR) || [];
      return sendJSON(res, 200, { rep: { username: rep.username, displayName: rep.displayName }, ...buildMyTasks(rep, savedBanks) });
    }

    // Live FDIC check: what the FDIC has on file for this bank vs the
    // imported workbook period. Free keyless API, disk-cached 24h.
    const bankFdicMatch = pathname.match(/^\/api\/banks\/([^/]+)\/fdic-check$/);
    if (bankFdicMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankFdicMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const summary = getBankSummaryForCoverage(bankId);
      if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
      const cert = String(summary.certNumber || '').trim();
      if (!cert) return sendJSON(res, 200, { fdic: null, reason: 'no-cert' });
      const snapshot = await fdicBankfind.getFdicSnapshot(cert, {
        cacheDir: path.join(MARKET_DIR, 'fdic'),
        log
      });
      if (!snapshot) return sendJSON(res, 200, { fdic: null, reason: 'not-found' });
      const workbookPeriod = String(summary.period || '');
      const fdicPeriod = snapshot.latest.period;
      return sendJSON(res, 200, {
        fdic: snapshot,
        workbookPeriod,
        newerAvailable: Boolean(workbookPeriod && /^\d{4}Q\d$/.test(workbookPeriod) && fdicPeriod > workbookPeriod)
      });
    }

    // Per-bank slice of the CD rollover universe — powers the tear sheet's
    // "CDs rolling off" signal chip without pulling the whole wall.
    const bankCdRollMatch = pathname.match(/^\/api\/banks\/([^/]+)\/cd-rollover$/);
    if (bankCdRollMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankCdRollMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const mapData = getMapBankData();
      const bank = mapData && Array.isArray(mapData.banks)
        ? mapData.banks.find(b => String(b.id) === String(bankId)) : null;
      if (!bank) return sendJSON(res, 404, { error: 'Bank not found' });
      const windowDays = Math.max(1, Math.min(365, Math.round(Number(query.get('window')) || 180)));
      const cert = String(bank.certNumber || '').trim();
      const nameKey = normalizeBankNameForMatch(bank.displayName || bank.legalName || '');
      const todayMs = Math.floor(Date.now() / 86400000) * 86400000;
      const horizonMs = todayMs + windowDays * 86400000;
      const cds = buildCdRolloverUniverse()
        .filter(cd => {
          const matMs = Date.parse(cd.maturity);
          if (!Number.isFinite(matMs) || matMs < todayMs || matMs > horizonMs) return false;
          return (cert && cd.cert === cert) || (nameKey && normalizeBankNameForMatch(cd.name) === nameKey);
        })
        .sort((a, b) => a.maturity.localeCompare(b.maturity))
        .map(cd => ({
          cusip: cd.cusip, maturity: cd.maturity,
          daysOut: Math.round((Date.parse(cd.maturity) - todayMs) / 86400000),
          rate: cd.rate, term: cd.term
        }));
      return sendJSON(res, 200, { windowDays, count: cds.length, cds: cds.slice(0, 20) });
    }

    // Inverse buyers query: what in today's inventory fits this bank?
    const bankFitsMatch = pathname.match(/^\/api\/banks\/([^/]+)\/offering-fits$/);
    if (bankFitsMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankFitsMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      try {
        return sendJSON(res, 200, findOfferingFitsForBank(bankId, Number(query.get('limit')) || 4));
      } catch (err) {
        log('warn', 'Offering fits failed:', err.message);
        return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not score offerings for this bank' });
      }
    }

    const bankOppsMatch = pathname.match(/^\/api\/banks\/([^/]+)\/opportunities$/);
    if (bankOppsMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankOppsMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const includeClosed = query.get('includeClosed') === '1' || query.get('includeClosed') === 'true';
      return sendJSON(res, 200, { opportunities: listOpportunitiesForBank(BANK_REPORTS_DIR, bankId, { includeClosed }) });
    }
    if (bankOppsMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankOppsMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleCreateBankOpportunity(req, res, bankId);
    }

    const bankOppItemMatch = pathname.match(/^\/api\/bank-opportunities\/([^/]+)$/);
    if (bankOppItemMatch && req.method === 'PATCH') {
      const oppId = safeDecodeURIComponent(bankOppItemMatch[1]);
      if (!oppId) return sendJSON(res, 400, { error: 'Invalid opportunity ID' });
      return await handleUpdateBankOpportunity(req, res, oppId);
    }

    if (pathname === '/api/reports/pipeline' && req.method === 'GET') {
      const repParam = String(query.get('rep') || '').toLowerCase();
      const rep = repParam === 'all' ? null : resolveRequestRep(req);
      return sendJSON(res, 200, {
        rep: rep ? { username: rep.username, displayName: rep.displayName } : null,
        pipeline: pipelineSummary(BANK_REPORTS_DIR, { username: rep ? rep.username : null })
      });
    }

    const bankContactsListMatch = pathname.match(/^\/api\/banks\/([^/]+)\/contacts$/);
    if (bankContactsListMatch && req.method === 'GET') {
      const bankId = safeDecodeURIComponent(bankContactsListMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return sendJSON(res, 200, { contacts: listContactsForBank(BANK_REPORTS_DIR, bankId) });
    }
    if (bankContactsListMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankContactsListMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleCreateBankContact(req, res, bankId);
    }

    const bankContactMatch = pathname.match(/^\/api\/bank-contacts\/([^/]+)$/);
    if (bankContactMatch && req.method === 'PATCH') {
      const contactId = safeDecodeURIComponent(bankContactMatch[1]);
      if (!contactId) return sendJSON(res, 400, { error: 'Invalid contact ID' });
      return await handleUpdateBankContact(req, res, contactId);
    }
    if (bankContactMatch && req.method === 'DELETE') {
      const contactId = safeDecodeURIComponent(bankContactMatch[1]);
      if (!contactId) return sendJSON(res, 400, { error: 'Invalid contact ID' });
      return handleDeleteBankContact(req, res, contactId);
    }

    if (bankCoverageMatch && req.method === 'DELETE') {
      const bankId = safeDecodeURIComponent(bankCoverageMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      removeSavedBank(BANK_REPORTS_DIR, bankId);
      appendAuditLog({ event: 'bank-coverage-remove', bankId });
      logBankActivity(req, {
        bankId,
        kind: 'coverage-remove',
        summary: 'Removed saved bank coverage',
        refType: 'coverage',
        refId: bankId
      });
      invalidateBankCaches();
      return sendJSON(res, 200, { success: true });
    }

    const bankPeerPreferenceMatch = pathname.match(/^\/api\/banks\/([^/]+)\/peer-preference$/);
    if (bankPeerPreferenceMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankPeerPreferenceMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      const summary = getBankSummaryForCoverage(bankId);
      if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });
      try {
        const body = await readJsonBody(req);
        const cohortId = String(body && body.cohortId || '').trim();
        const cohort = peerGroupStore.getPeerGroup(BANK_REPORTS_DIR, cohortId);
        if (!cohort || cohort.archivedAt) return sendJSON(res, 404, { error: 'Peer group not found' });
        const peerPreference = setPreferredPeerGroup(BANK_REPORTS_DIR, bankId, cohortId);
        appendAuditLog({ event: 'bank-peer-preference-save', bankId, peerGroupId: cohortId });
        invalidateBankCaches();
        return sendJSON(res, 200, { peerPreference });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message || 'Could not save peer preference' });
      }
    }

    // --- Peer groups (user-curated cohorts) ---
    if (pathname === '/api/peer-groups' && req.method === 'GET') {
      peerGroupStore.seedDefaultPeerGroups(BANK_REPORTS_DIR);
      const includeArchived = query.get('includeArchived') === '1';
      return sendJSON(res, 200, {
        peerGroups: peerGroupStore.listPeerGroups(BANK_REPORTS_DIR, { includeArchived })
      });
    }

    if (pathname === '/api/peer-groups' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const created = peerGroupStore.createPeerGroup(BANK_REPORTS_DIR, body);
        appendAuditLog({ event: 'peer-group-create', id: created.id, name: created.name });
        return sendJSON(res, 201, { peerGroup: created });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message || 'Could not create peer group' });
      }
    }

    if (pathname === '/api/peer-groups/preview' && req.method === 'POST') {
      // Population-count preview while the rep builds criteria, without
      // creating a row. Cheap query — just COUNT(*).
      try {
        const body = await readJsonBody(req);
        const criteria = peerGroupStore.normalizeCriteria(body && body.criteria);
        const result = peerAverages.findMatchingBanks(BANK_REPORTS_DIR, criteria, body && body.period);
        return sendJSON(res, 200, {
          period: result.period,
          populationCount: result.count
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message || 'Preview failed' });
      }
    }

    const peerGroupAveragesMatch = pathname.match(/^\/api\/peer-groups\/([^/]+)\/averages$/);
    if (peerGroupAveragesMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(peerGroupAveragesMatch[1]);
      const cohort = peerGroupStore.getPeerGroup(BANK_REPORTS_DIR, id);
      if (!cohort) return sendJSON(res, 404, { error: 'Peer group not found' });
      const period = query.get('period') || null;
      const averages = peerAverages.computeCohortAverages(BANK_REPORTS_DIR, cohort.criteria, period);
      return sendJSON(res, 200, {
        peerGroup: cohort,
        period: averages.period,
        populationCount: averages.populationCount,
        byKey: averages.byKey
      });
    }

    const peerGroupMatch = pathname.match(/^\/api\/peer-groups\/([^/]+)$/);
    if (peerGroupMatch && req.method === 'GET') {
      const id = safeDecodeURIComponent(peerGroupMatch[1]);
      const cohort = peerGroupStore.getPeerGroup(BANK_REPORTS_DIR, id);
      if (!cohort) return sendJSON(res, 404, { error: 'Peer group not found' });
      return sendJSON(res, 200, { peerGroup: cohort });
    }

    if (peerGroupMatch && req.method === 'PATCH') {
      const id = safeDecodeURIComponent(peerGroupMatch[1]);
      try {
        const body = await readJsonBody(req);
        const updated = peerGroupStore.updatePeerGroup(BANK_REPORTS_DIR, id, body);
        appendAuditLog({ event: 'peer-group-update', id, name: updated.name });
        return sendJSON(res, 200, { peerGroup: updated });
      } catch (err) {
        const status = /not found/i.test(err.message) ? 404 : 400;
        return sendJSON(res, status, { error: err.message || 'Could not update peer group' });
      }
    }

    if (peerGroupMatch && req.method === 'DELETE') {
      const id = safeDecodeURIComponent(peerGroupMatch[1]);
      try {
        const archived = peerGroupStore.archivePeerGroup(BANK_REPORTS_DIR, id);
        appendAuditLog({ event: 'peer-group-archive', id, name: archived.name });
        return sendJSON(res, 200, { peerGroup: archived });
      } catch (err) {
        return sendJSON(res, /not found/i.test(err.message) ? 404 : 500, { error: err.message });
      }
    }

    if (pathname === '/api/banks/status' && req.method === 'GET') {
      return sendJSON(res, 200, getBankDataStatus());
    }

    if (pathname === '/api/banks/search' && req.method === 'GET') {
      const limit = Math.min(parseInt(query.get('limit'), 10) || 12, 25);
      const data = searchBanks(query.get('q') || '', limit);
      if (!data) return sendJSON(res, 404, { error: 'No bank data has been imported yet' });
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/banks/map' && req.method === 'GET') {
      const data = getMapBankData();
      if (!data) return sendJSON(res, 404, { error: 'No bank data has been imported yet' });
      if (!mapBankCacheBody) mapBankCacheBody = JSON.stringify(data);
      // Multi-MB payload: gzip it (and cache the gzipped buffer) so the common
      // map load ships ~10x smaller without re-compressing every request.
      mapBankCacheBodyGz = writeJsonBody(res, 200, mapBankCacheBody, req, mapBankCacheBodyGz) || mapBankCacheBodyGz;
      return;
    }

    if (pathname === '/api/banks/averaged-series/upload' && req.method === 'POST') {
      return await handleAveragedSeriesUpload(req, res);
    }

    if (pathname === '/api/exec-summary/upload' && req.method === 'POST') {
      return await handleExecSummaryUpload(req, res);
    }

    if (pathname === '/api/banks/averaged-series' && req.method === 'GET') {
      const dataset = loadAveragedSeriesDataset(BANK_REPORTS_DIR);
      if (!dataset) return sendJSON(res, 404, { error: 'No averaged-series peer data has been imported yet' });
      return sendJSON(res, 200, dataset);
    }

    if (pathname === '/api/banks/bond-accounting/upload' && req.method === 'POST') {
      return await handleBondAccountingUpload(req, res);
    }

    if (pathname.startsWith('/api/banks/bond-accounting/files/') && req.method === 'GET') {
      const storedPath = safeDecodeURIComponent(pathname.slice('/api/banks/bond-accounting/files/'.length));
      const filePath = resolveBondAccountingStoredFile(BANK_REPORTS_DIR, storedPath);
      if (!filePath) return sendText(res, 404, 'Not found');
      return sendFile(res, filePath, { download: true });
    }

    if (pathname === '/api/banks/bond-accounting' && req.method === 'GET') {
      const manifest = loadBondAccountingManifest(BANK_REPORTS_DIR);
      if (!manifest) return sendJSON(res, 404, { error: 'No bond accounting portfolios have been imported yet' });
      return sendJSON(res, 200, manifest);
    }

    if (pathname === '/api/assistant/bank' && req.method === 'POST') {
      return await handleBankAssistant(req, res);
    }

    if (pathname === '/api/assistant/buyers' && req.method === 'POST') {
      return await handleBuyerCandidates(req, res);
    }

    if (pathname === '/api/brokered-cd/wirp' && req.method === 'GET') {
      return sendJSON(res, 200, getWirpStatus(BANK_REPORTS_DIR));
    }

    if (pathname === '/api/brokered-cd/wirp/upload' && req.method === 'POST') {
      return await handleWirpUpload(req, res);
    }

    if (pathname === '/api/brokered-cd/opportunity' && req.method === 'GET') {
      return handleBrokeredCdOpportunity(req, res, query);
    }

    if (pathname.startsWith('/api/banks/') && req.method === 'GET') {
      const id = pathname.slice('/api/banks/'.length);
      const data = getBankById(id);
      if (!data) return sendJSON(res, 404, { error: 'Bank not found' });
      // Optional cohort override — recompute peer comparison from the
      // requested cohort instead of returning the cached best-fit result.
      const cohortId = query.get('cohortId');
      if (cohortId && data.bank) {
        const overridden = getPeerComparisonForBank(data.bank, { cohortId });
        if (overridden) {
          return sendJSON(res, 200, {
            ...data,
            bank: { ...data.bank, peerComparison: overridden, peerPreference: getPreferredPeerGroup(BANK_REPORTS_DIR, data.bank.id) }
          });
        }
      }
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/banks/upload' && req.method === 'POST') {
      return await handleBankDataUpload(req, res);
    }

    if (pathname === '/api/bank-account-statuses/upload' && req.method === 'POST') {
      return await handleBankStatusUpload(req, res);
    }

    if (pathname === '/api/audit-log' && req.method === 'GET') {
      const limit = Math.min(parseInt(query.get('limit'), 10) || 200, 1000);
      return sendJSON(res, 200, readAuditLog({ limit }));
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      return await handleUpload(req, res);
    }

    if (pathname === '/api/folder-drop/scan' && req.method === 'GET') {
      return await handleFolderDropScan(req, res, query);
    }

    if (pathname === '/api/folder-drop/publish' && req.method === 'POST') {
      return await handleFolderDropPublish(req, res);
    }

    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'API endpoint not found' });
    }

    // --- File serving: current package ---

    if (pathname.startsWith('/current/')) {
      const filename = safeDecodeURIComponent(pathname.slice('/current/'.length));
      if (filename == null) return sendText(res, 400, 'Invalid path');
      if (hasPrivatePathSegment(filename)) return sendText(res, 404, 'Not found');
      const filePath = safeJoin(CURRENT_DIR, filename);
      if (!filePath) return sendText(res, 400, 'Invalid path');
      const download = query.get('download') === '1';
      return sendFile(res, filePath, { download, sandboxHtml: true });
    }

    // --- File serving: archive ---

    if (pathname.startsWith('/archive/')) {
      const rest = pathname.slice('/archive/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) return sendText(res, 404, 'Not found');
      const date = rest.slice(0, slash);
      const filename = safeDecodeURIComponent(rest.slice(slash + 1));
      if (filename == null) return sendText(res, 400, 'Invalid path');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendText(res, 400, 'Invalid date');
      if (hasPrivatePathSegment(filename)) return sendText(res, 404, 'Not found');
      const filePath = safeJoin(ARCHIVE_DIR, date, filename);
      if (!filePath) return sendText(res, 400, 'Invalid path');
      const download = query.get('download') === '1';
      return sendFile(res, filePath, { download, sandboxHtml: true });
    }

    // --- Static assets ---

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed');
    }

    let staticPath;
    if (pathname === '/' || pathname === '') {
      staticPath = path.join(PUBLIC_DIR, 'index.html');
    } else {
      const resolved = safeJoin(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
      if (!resolved) return sendText(res, 400, 'Invalid path');
      staticPath = resolved;
    }

    fs.stat(staticPath, (err, stat) => {
      if (err || !stat.isFile()) {
        // Don't serve the SPA shell for an unknown API path — a typo'd or removed
        // /api/* GET should 404 as JSON, not return HTML with a 200 that callers
        // then fail to JSON.parse.
        if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not found' });
        return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), { req });
      }
      sendFile(res, staticPath, { req });
    });
  } catch (err) {
    log('error', 'Unhandled request error:', err.stack || err.message);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Internal server error' });
  }
});

// ---------- Graceful shutdown ----------

function shutdown(signal) {
  log('info', `Received ${signal}, closing server…`);
  server.close(() => {
    log('info', 'Server closed cleanly.');
    process.exit(0);
  });
  setTimeout(() => {
    log('warn', 'Forcing exit after 10s.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', err => {
  log('error', 'uncaughtException:', err.stack || err.message);
  setImmediate(() => process.exit(1));
});
process.on('unhandledRejection', reason => {
  log('error', 'unhandledRejection:', reason);
  setImmediate(() => process.exit(1));
});

// ---------- Start ----------

function checkLoopbackPortAvailable(callback) {
  const probe = net.createServer();
  probe.once('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already occupied on 127.0.0.1.`);
      console.error('Stop the old FBBS portal process before starting a new one, then run: npm run doctor');
      process.exitCode = 1;
      return;
    }
    callback();
  });
  probe.once('listening', () => {
    probe.close(callback);
  });
  probe.listen(PORT, '127.0.0.1');
}

function startServer() {
  if (HOST === '0.0.0.0') {
    checkLoopbackPortAvailable(() => listenServer());
    return;
  }
  listenServer();
}

function listenServer() {
  server.once('error', err => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already occupied on ${HOST}.`);
      console.error('Stop the old FBBS portal process before starting a new one, then run: npm run doctor');
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    const banner =
`
================================================================
  FBBS Market Intelligence Portal
================================================================

  Listening on:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}
  Bind host:     ${HOST}
  Data dir:      ${DATA_DIR}
  Audit log:     ${AUDIT_LOG_PATH}
  Max upload:    ${(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB
  Bank upload:   ${(BANK_UPLOAD_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB
  Log level:     ${Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === LOG_LEVEL)}

  Press Ctrl+C to stop the server.
================================================================
`;
    console.log(banner);
    // Prime the coverage holdings index in the background so the first
    // inverse-query request doesn't pay the cold-parse cost. Failures here
    // don't fail the server — scoring falls back to call-report-only.
    setImmediate(() => {
      try {
        getCoverageHoldingsIndex();
      } catch (err) {
        log('warn', `Coverage holdings prime failed: ${err.message}`);
      }
    });

    if (AUTO_PUBLISH_ENABLED) {
      setInterval(() => {
        autoPublishTick().catch(err => log('error', 'Auto-publish tick crashed:', err.message));
      }, AUTO_PUBLISH_POLL_MS);
      log('info', `Folder-drop auto-publish armed: watching ${DROPBOX_DIR}/<today> every ${AUTO_PUBLISH_POLL_MS / 60000} min (FBBS_AUTO_PUBLISH=0 disables).`);
    }

    if (AUTO_FDIC_SYNC_ENABLED) {
      // First check 10 minutes after boot (stay out of startup's way), then 6-hourly.
      setTimeout(() => {
        autoFdicSyncTick().catch(err => log('error', 'FDIC auto-sync tick crashed:', err.message));
        setInterval(() => {
          autoFdicSyncTick().catch(err => log('error', 'FDIC auto-sync tick crashed:', err.message));
        }, AUTO_FDIC_SYNC_CHECK_MS);
      }, 10 * 60 * 1000);
      log('info', 'FDIC weekly auto-sync armed (FBBS_AUTO_FDIC_SYNC=0 disables).');
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  classifyFile,
  classifyFolderDropFile,
  hasPrivatePathSegment,
  isSameOriginWrite,
  sniffDateFromFilename,
  readPackageDir,
  collectAgencyPackageFiles,
  findPackageFileForSlot,
  sniffAgencyWorkbookSlot,
  findSwapCandidates,
  formatSwapCandidateLine,
  mapSwapHoldingPosition,
  scanFolderDrop,
  autoPublishTick,
  startServer
};
