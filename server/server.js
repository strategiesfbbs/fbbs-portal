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
 * Dependencies: pdf-parse (for extracting PDF text) and xlsx (for workbook parsing).
 *               Everything else is Node built-ins.
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
const { extractPdfText } = require('./pdf-text');

const { parseCdOffersText, parseCdOffersWorkbook } = require('./cd-offers-parser');
const { parseBrokeredCdRateSheetText } = require('./brokered-cd-parser');
const { parseMuniOffersText } = require('./muni-offers-parser');
const { parseEconomicUpdateText } = require('./economic-update-parser');
const { parseMmdCurveText } = require('./mmd-parser');
const { parseTreasuryNotesWorkbook } = require('./treasury-notes-parser');
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
const {
  getMarketColorSourceFile,
  loadMarketColorInbox,
  saveMarketColorUpload
} = require('./market-color-store');
const {
  loadCdInternalInventory,
  saveCdInternalUpload
} = require('./cd-internal-store');
const { emailSummary } = require('./email-source-utils');
const {
  getBankDatabaseStatus,
  getBankFromDatabase,
  importBankWorkbook,
  listBankSummaries,
  queryBankMapDataset,
  searchBankDatabase
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
  addBankNote,
  getBankCoverage,
  getSavedBankCoverageMap,
  listSavedBanks,
  removeBankNote,
  removeSavedBank,
  upsertSavedBank
} = require('./bank-coverage-store');
const {
  defaultAccountStatus,
  countBankAccountStatuses,
  getBankAccountStatusImportStatus,
  getBankAccountStatuses,
  importBankAccountStatusWorkbook,
  listBankAccountStatuses,
  upsertBankAccountStatus
} = require('./bank-account-status-store');
const {
  addStrategyRequestFile,
  createStrategyRequest,
  getStrategyRequestFile,
  listStrategyRequests,
  updateStrategyRequest
} = require('./strategy-store');
const {
  ensureCdHistoryDir,
  saveCdHistorySnapshot,
  summarizeWeeklyCdHistory
} = require('./cd-history');
const swapMath = require('./swap-math');
const swapStore = require('./swap-store');
const { renderProposalHtml } = require('./swap-render');

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
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_UPLOAD_MB, 10) || 50) * 1024 * 1024;
const BANK_UPLOAD_MAX_BYTES = (parseInt(process.env.BANK_UPLOAD_MAX_MB, 10) || 300) * 1024 * 1024;
const BANK_CACHE_MAX_ENTRIES = 200;

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;
const PORTAL_BUILD = 'swap-workflow-2026-05-13';

// ---------- Logging ----------

function log(level, ...args) {
  if (LOG_LEVELS[level] < LOG_LEVEL) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(prefix, ...args);
}

// ---------- Setup ----------

[DATA_DIR, CURRENT_DIR, ARCHIVE_DIR, DROPBOX_DIR, CD_HISTORY_DIR, BANK_REPORTS_DIR, MBS_CMO_DIR, STRUCTURED_NOTES_DIR, MARKET_COLOR_DIR, CD_INTERNAL_DIR].forEach(dir => {
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

const SLOT_NAMES = ['dashboard', 'econ', 'relativeValue', 'mmd', 'treasuryNotes', 'cd', 'cdoffers', 'munioffers', 'agenciesBullets', 'agenciesCallables', 'corporates'];
const DOC_TYPES_LABELS = {
  dashboard: 'FBBS Sales Dashboard',
  econ: 'Economic Update',
  relativeValue: 'Relative Value',
  mmd: 'MMD Curve',
  treasuryNotes: 'Treasury Notes',
  cd: 'Brokered CD Sheet',
  cdoffers: 'Daily CD Offerings',
  munioffers: 'Muni Offerings',
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

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendFile(res, filePath, { download = false, sandboxHtml = false, filename = '' } = {}) {
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
    const headers = {
      'Content-Type': getContentType(filePath),
      'Content-Length': stat.size,
      'Cache-Control': noStoreAppShell ? 'no-store' : 'no-cache'
    };
    if (download) {
      const downloadName = path.basename(filename || filePath).replace(/["\r\n]/g, '');
      headers['Content-Disposition'] =
        `attachment; filename="${downloadName}"`;
    }
    if (sandboxHtml && /\.html?$/i.test(filePath)) {
      headers['Content-Security-Policy'] = 'sandbox allow-scripts';
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', e => {
      log('error', 'Stream error for', filePath, e.message);
      try { res.destroy(); } catch (_) {}
    });
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
    if (lower.includes('cd_offer') || lower.includes('cdoffer') ||
        lower.includes('daily_cd') || lower.includes('daily cd') ||
        lower.includes('cd offering') || lower.includes('cd_offering') ||
        lower.includes('new issue cd') || lower.includes('new issue cds') ||
        lower.includes('cds - cost')) {
      return 'cdoffers';
    }
    if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
    if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
    if (lower.includes('bullet')) return 'agenciesBullets';
    return 'agenciesBullets';  // ambiguous → default; user can drop into the right slot
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
    if (/^\d{8}\.pdf$/.test(lower)) return 'econ';
    return 'econ';
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
  if (['econ', 'relativeValue', 'cd', 'munioffers'].includes(slot)) {
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF file.`;
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

          const nameMatch = headerStr.match(/name="([^"]+)"/i);
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
              const m = fieldName.match(/(?:file[_-]?)?(dashboard|econ|relativeValue|treasuryNotes|cdoffers|munioffers|agenciesBullets|agenciesCallables|corporates|cd)/i);
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
      } catch (_) {}
    }
  }

  if (pkg.relativeValueRowsCount == null) {
    const rvPath = path.join(dirPath, RELATIVE_VALUE_FILENAME);
    if (fs.existsSync(rvPath)) {
      try {
        const rv = JSON.parse(fs.readFileSync(rvPath, 'utf-8'));
        if (Array.isArray(rv.rows)) pkg.relativeValueRowsCount = rv.rows.length;
      } catch (_) {}
    }
  }

  return pkg;
}

let currentPackageCache = null;
let archiveListCache = null;

function invalidatePackageCache() {
  currentPackageCache = null;
  archiveListCache = null;
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
  const offPath = path.join(CURRENT_DIR, OFFERINGS_FILENAME);
  if (!fs.existsSync(offPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(offPath, 'utf-8'));
  } catch (e) {
    log('warn', 'Could not read offerings file:', e.message);
    return null;
  }
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
  const offPath = path.join(CURRENT_DIR, MUNI_OFFERINGS_FILENAME);
  if (!fs.existsSync(offPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(offPath, 'utf-8'));
  } catch (e) {
    log('warn', 'Could not read muni offerings file:', e.message);
    return null;
  }
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
  const p = path.join(CURRENT_DIR, TREASURY_NOTES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    log('warn', 'Could not read treasury notes file:', e.message);
    return null;
  }
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
  const p = path.join(CURRENT_DIR, AGENCIES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    log('warn', 'Could not read agencies file:', e.message);
    return null;
  }
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
  const p = path.join(CURRENT_DIR, CORPORATES_FILENAME);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    log('warn', 'Could not read corporates file:', e.message);
    return null;
  }
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
    return cacheSet(bankDetailCache, bankId, {
      ...data,
      bank: {
        ...data.bank,
        summary: enrichBankSummary(data.bank.summary, statuses, coverageMap),
        bondAccounting: getBondAccountingForBank(BANK_REPORTS_DIR, data.bank.id),
        peerComparison: getPeerComparisonForBank(data.bank)
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
  const cdRows = Array.isArray(cd && cd.offerings) ? cd.offerings : [];
  const muniRows = Array.isArray(muni && muni.offerings) ? muni.offerings : [];
  const treasuryRows = Array.isArray(treasury && treasury.notes) ? treasury.notes : [];
  const agencyRows = Array.isArray(agencies && agencies.offerings) ? agencies.offerings : [];
  const corporateRows = Array.isArray(corporates && corporates.offerings) ? corporates.offerings : [];
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
    index.set(bankId, {
      reportDate: parsed.asOfDate || row.reportDate || '',
      totalPositions: parsed.aggregates ? parsed.aggregates.totalPositions : 0,
      sectorCounts: parsed.sectorCounts || {},
      cusipSet: new Set(cusips.map(c => c.toUpperCase())),
      bookYieldYtw: parsed.totals ? parsed.totals.bookYieldYtw : null,
      marketYieldYtw: parsed.totals ? parsed.totals.marketYieldYtw : null
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

function swapEconomics(held, offering, map, pickYield, asOfDate) {
  const bookYield = numericValue(held.bookYieldYtm ?? held.bookYieldYtw);
  if (bookYield === null || pickYield === null) return null;
  const par = numericValue(held.par) || 0;
  const bookValue = numericValue(held.bookValue) || (par && numericValue(held.bookPrice) !== null ? par * numericValue(held.bookPrice) / 100 : par);
  const marketValue = numericValue(held.marketValue) || (par && numericValue(held.marketPrice) !== null ? par * numericValue(held.marketPrice) / 100 : par);
  if (!bookValue || !marketValue) return null;

  const gainLoss = numericValue(held.gainLoss);
  const realizedGainLoss = gainLoss !== null ? gainLoss : marketValue - bookValue;
  const horizonYears = Math.max(0.1, holdingHorizonYears(held, offering, asOfDate));
  const annualIncomeGivenUp = bookValue * bookYield / 100;
  const annualBuyIncome = marketValue * pickYield / 100;
  const annualIncomePickup = annualBuyIncome - annualIncomeGivenUp;
  const interestGivenUp = -annualIncomeGivenUp * horizonYears;
  const buyIncome = annualBuyIncome * horizonYears;
  const netInterestToHorizon = annualIncomePickup * horizonYears;
  const netBenefitToHorizon = netInterestToHorizon + realizedGainLoss;
  const lossToEarnBack = realizedGainLoss < 0 ? -realizedGainLoss : 0;
  const breakevenMonths = lossToEarnBack > 0 && annualIncomePickup > 0
    ? lossToEarnBack / (annualIncomePickup / 12)
    : null;
  const price = offeringPrice(offering, map.type);
  const replacementPar = price && price > 0 ? marketValue / price * 100 : null;

  return {
    horizonYears: Number(horizonYears.toFixed(2)),
    realizedGainLoss: roundMoney(realizedGainLoss),
    interestGivenUp: roundMoney(interestGivenUp),
    buyIncome: roundMoney(buyIncome),
    annualIncomePickup: roundMoney(annualIncomePickup),
    netInterestToHorizon: roundMoney(netInterestToHorizon),
    netBenefitToHorizon: roundMoney(netBenefitToHorizon),
    breakevenMonths: breakevenMonths === null ? null : Number(breakevenMonths.toFixed(1)),
    replacementPar: replacementPar === null ? null : Math.round(replacementPar)
  };
}

// Find swap candidates by walking the bank's parsed holdings against today's
// inventory. The desk has exactly ONE hard rule for auto-suggested swaps:
// the held bond can't mature before the breakeven (otherwise the loss can't
// be recouped before the bond is gone). Everything else — breakeven cap,
// maturity floor, requiring annual pickup — is a soft "thinking point"
// returned as warning chips on the candidate, not a filter reason.
// Every swap and portfolio is different; the rep decides per situation.
//
// `options.includeRejected = true` returns `{ kept, dropped, rules }` where
// kept candidates may carry warnings and dropped only contains hard-rule
// failures. The Build-your-own (manual) flow bypasses this entirely and
// lets the rep build any swap they want.
function findSwapCandidates(parsedHoldings, inventory, options = {}) {
  const empty = options.includeRejected ? { kept: [], dropped: [] } : [];
  if (!parsedHoldings || !parsedHoldings.sectors || !inventory || !inventory.rows) return empty;
  const minHeldYieldGap = options.minHeldYieldGap ?? 1.0;
  const minPickupVsBook = options.minPickupVsBook ?? 0.5;
  const rules = options.rules || swapMath.DEFAULT_FBBS_RULES;
  const limit = Math.max(1, parseInt(options.limit, 10) || 5);
  const kept = [];
  const dropped = [];
  const fitProfile = buildInvestmentFitProfile(parsedHoldings, inventory.asOfDate);

  for (const [sector, holdings] of Object.entries(parsedHoldings.sectors)) {
    const map = SWAP_SECTOR_MAP[sector];
    if (!map) continue;
    const rows = inventory.rows[map.rowsKey];
    if (!Array.isArray(rows) || !rows.length) continue;
    const candidateRows = (sector.includes('Muni') && inventory.rows.stateMunis && inventory.rows.stateMunis.length)
      ? inventory.rows.stateMunis
      : rows;
    const sourceRef = (sector.includes('Muni') && inventory.rows.stateMunis && inventory.rows.stateMunis.length)
      ? '_muni_offerings.json#stateMunis'
      : map.sourceRef;

    for (const held of holdings) {
      const bookYld = held.bookYieldYtm ?? held.bookYieldYtw;
      const mktYld = held.marketYieldYtw ?? held.marketYieldYtm;
      if (bookYld == null || mktYld == null) continue;
      const heldGap = mktYld - bookYld;
      if (heldGap < minHeldYieldGap) continue;

      const pick = pickBestOffering(candidateRows, map.yieldKey, held.cusip ? String(held.cusip).toUpperCase() : null, {
        fitProfile,
        held,
        sector,
        map,
        minYield: bookYld + minPickupVsBook
      });
      if (!pick) continue;
      const pickup = pick.yld - bookYld;
      if (pickup < minPickupVsBook) continue;
      const economics = swapEconomics(held, pick.row, map, pick.yld, inventory.asOfDate);
      if (!economics) continue;

      const monthsToMaturity = swapMath.monthsUntilMaturity(held.maturity, inventory.asOfDate);
      const ruleEval = swapMath.evaluateSwapAgainstRules({
        breakevenMonths: economics.breakevenMonths,
        monthsToMaturity,
        annualIncomePickup: economics.annualIncomePickup,
        rules
      });

      const parWeight = (held.par || 0) / 1000;
      const breakevenPenalty = economics.breakevenMonths === null ? 0 : Math.min(economics.breakevenMonths, 120) * 2;
      const netBenefitScore = Math.max(economics.netBenefitToHorizon || 0, 0) / 1000;
      const candidate = {
        sector,
        held: {
          cusip: held.cusip || '',
          description: held.description || '',
          par: held.par || 0,
          bookValue: held.bookValue || 0,
          marketValue: held.marketValue || 0,
          bookYield: Number(bookYld.toFixed(3)),
          marketYield: Number(mktYld.toFixed(3)),
          gainLoss: held.gainLoss || 0,
          maturity: held.maturity || '',
          monthsToMaturity: monthsToMaturity == null ? null : Number(monthsToMaturity.toFixed(1))
        },
        offering: {
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
          structure: pick.row.structure || ''
        },
        yieldPickupVsBook: Number(pickup.toFixed(2)),
        economics,
        rule: {
          hardPass: ruleEval.hardPass,
          hardReason: ruleEval.hardReason,
          warnings: ruleEval.warnings
        },
        priority: parWeight * pickup + netBenefitScore - breakevenPenalty + ((pick.fit && pick.fit.score) || 0)
      };

      if (ruleEval.hardPass) kept.push(candidate);
      else dropped.push(candidate);
    }
  }
  kept.sort((a, b) => b.priority - a.priority);
  dropped.sort((a, b) => b.priority - a.priority);
  const trimmedKept = kept.slice(0, limit);
  if (options.includeRejected) {
    return { kept: trimmedKept, dropped: dropped.slice(0, 20), rules };
  }
  return trimmedKept;
}

function formatSwapCandidateLine(c) {
  const heldDescr = c.held.description ? c.held.description.slice(0, 36) : c.held.cusip;
  const parK = c.held.par ? `$${Math.round(c.held.par / 1000)}K` : '';
  const heldLeft = `${c.held.cusip || 'held'} ${heldDescr}`.trim();
  const heldYld = `${c.held.bookYield.toFixed(2)}% book / ${c.held.marketYield.toFixed(2)}% market${parK ? ` · ${parK}` : ''}`;
  const econ = c.economics || {};
  const breakeven = econ.breakevenMonths !== null && econ.breakevenMonths !== undefined ? ` · breakeven ${econ.breakevenMonths.toFixed(1)} mo` : '';
  const net = econ.netBenefitToHorizon ? ` · est. net $${Math.round(econ.netBenefitToHorizon / 1000)}K` : '';
  return `${heldLeft} (${heldYld}) → ${c.offering.label} · +${c.yieldPickupVsBook.toFixed(2)}% pickup${breakeven}${net}`;
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
    noteLines.push(`Swap: ${top.held.cusip} (${top.held.bookYield.toFixed(2)}% book) → ${top.offering.label} · +${top.yieldPickupVsBook.toFixed(2)}% pickup`);
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

function scoreCoverageBankForOffering(bank, productType, offering, holdingsForBank) {
  const status = String(bank.accountStatusLabel || 'Open');
  const base = BUYER_STATUS_BASE[status] || 0;
  if (base <= 0) return null;

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

function findBuyerCandidates({ productType, offering, limit = 10 }) {
  if (!BUYER_PRODUCT_TYPES.has(productType)) {
    const err = new Error('Unsupported product type');
    err.statusCode = 400;
    throw err;
  }
  const mapData = getMapBankData();
  if (!mapData || !Array.isArray(mapData.banks)) {
    return { offeringHeadline: buyerOfferingHeadline(productType, offering), buyers: [], coverageCount: 0, notice: 'Bank dataset not loaded.' };
  }
  const coverage = mapData.banks.filter(b => b.accountStatusLabel && b.accountStatusLabel !== 'Open');
  const holdingsIndex = getCoverageHoldingsIndex();
  const scored = coverage
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
  return {
    offeringHeadline: buyerOfferingHeadline(productType, offering),
    coverageCount: coverage.length,
    buyers: scored,
    notice: coverage.length === 0 ? 'No banks have an active coverage status — every bank is set to Open.' : ''
  };
}

async function handleBuyerCandidates(req, res) {
  try {
    const body = await readJsonBody(req, 64 * 1024);
    const productType = String(body.productType || '').trim().toLowerCase();
    if (!BUYER_PRODUCT_TYPES.has(productType)) return sendJSON(res, 400, { error: 'Unsupported product type' });
    const offering = (body.offering && typeof body.offering === 'object') ? body.offering : {};
    const limit = Number(body.limit) || 10;
    const result = findBuyerCandidates({ productType, offering, limit });
    return sendJSON(res, 200, result);
  } catch (err) {
    log('warn', 'Buyer candidates failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not score buyer candidates' });
  }
}

let mapBankCache = null;

function getPeerComparisonForMap() {
  const index = getPeerComparisonIndex();
  if (!index) return null;
  const period = index.periods[0] || '';
  return {
    peerGroup: index.peerGroup,
    period,
    bankPeriod: '',
    periodAligned: false,
    byKey: index.byPeriod.get(period) || {}
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
}

// Tear-sheet peer comparison: maps BANK_FIELDS keys to FedFis "Averaged Series"
// peer-group averages so the call-report sections can render a Peer Avg column.
// The peerLabels regex set mirrors PEER_ANALYSIS_METRICS in public/js/portal.js —
// keep the two in sync when adding metrics.
const PEER_TEAR_SHEET_METRICS = [
  { key: 'loansToDeposits', higherIsBetter: null, peerLabels: [/loans?\s*\/\s*deposits?/i, /loans?.*deposits?/i] },
  { key: 'liquidAssetsToAssets', higherIsBetter: true, peerLabels: [/liquid assets?.*assets/i] },
  { key: 'wholesaleFundingReliance', higherIsBetter: false, peerLabels: [/wholesale funding/i] },
  { key: 'securitiesToAssets', higherIsBetter: true, peerLabels: [/securities.*assets/i, /total securities.*\/.*assets/i] },
  { key: 'yieldOnSecurities', higherIsBetter: true, peerLabels: [/yield on securities/i] },
  { key: 'netInterestMargin', higherIsBetter: true, peerLabels: [/net interest margin/i] },
  { key: 'roa', higherIsBetter: true, peerLabels: [/^roa\b/i, /return on assets/i, /return on avg/i] },
  { key: 'efficiencyRatio', higherIsBetter: false, peerLabels: [/efficiency ratio/i] },
  { key: 'tier1RiskBasedRatio', higherIsBetter: true, peerLabels: [/tier 1.*risk/i] },
  { key: 'texasRatio', higherIsBetter: false, peerLabels: [/texas ratio/i] },
  { key: 'nplsToLoans', higherIsBetter: false, peerLabels: [/npls?.*loans/i, /nonperforming.*loans/i] },
  { key: 'longTermAssetsToAssets', higherIsBetter: false, peerLabels: [/long.?term assets?.*assets/i] }
];

let peerComparisonCache = null;

function peerSeriesNumericValue(seriesRow) {
  if (!seriesRow) return null;
  for (const field of ['percent', 'value', 'amount']) {
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
      const peerValue = peerSeriesNumericValue(seriesRow);
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

function getPeerComparisonForBank(bank) {
  const index = getPeerComparisonIndex();
  if (!index) return null;
  const latest = bank && Array.isArray(bank.periods) ? bank.periods[0] : null;
  const bankPeriod = latest && latest.period ? latest.period : '';
  const period = index.periods.includes(bankPeriod) ? bankPeriod : (index.periods[0] || '');
  const byKey = index.byPeriod.get(period) || {};
  return {
    peerGroup: index.peerGroup,
    period,
    bankPeriod,
    periodAligned: Boolean(bankPeriod) && period === bankPeriod,
    byKey
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
    invalidateBankCaches();
    return sendJSON(res, 200, { saved, accountStatus });
  } catch (err) {
    log('error', 'Bank coverage save failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not save bank coverage' });
  }
}

async function handleSaveBankAccountStatus(req, res) {
  try {
    const body = await readJsonBody(req);
    const bankId = String(body.bankId || '').trim();
    if (!bankId) return sendJSON(res, 400, { error: 'Bank ID is required' });

    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });

    const accountStatus = upsertBankAccountStatus(BANK_REPORTS_DIR, summary, {
      status: body.status,
      source: 'manual'
    });
    const existingCoverage = getBankCoverage(BANK_REPORTS_DIR, bankId).saved;
    let saved = existingCoverage;
    if (existingCoverage) {
      saved = upsertSavedBank(BANK_REPORTS_DIR, summary, { status: accountStatus.status });
    }
    appendAuditLog({
      event: 'bank-account-status-save',
      bankId,
      status: accountStatus.status
    });
    invalidateBankCaches();
    return sendJSON(res, 200, { accountStatus, saved });
  } catch (err) {
    log('error', 'Bank account status save failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not save bank status' });
  }
}

async function handleAddBankNote(req, res, bankId) {
  try {
    const body = await readJsonBody(req);
    const summary = getBankSummaryForCoverage(bankId);
    if (!summary) return sendJSON(res, 404, { error: 'Bank not found' });

    upsertSavedBank(BANK_REPORTS_DIR, summary, body.coverage || {});
    const note = addBankNote(BANK_REPORTS_DIR, bankId, body.text);
    appendAuditLog({
      event: 'bank-note-add',
      bankId,
      noteId: note && note.id
    });
    invalidateBankCaches();
    return sendJSON(res, 200, { note });
  } catch (err) {
    log('error', 'Bank note add failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not add bank note' });
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
    return sendJSON(res, 200, { request });
  } catch (err) {
    log('error', 'Strategy request create failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not create strategy request' });
  }
}

async function handleUpdateStrategyRequest(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const request = updateStrategyRequest(BANK_REPORTS_DIR, id, body);
    if (!request) return sendJSON(res, 404, { error: 'Strategy request not found' });
    appendAuditLog({
      event: 'strategy-request-update',
      strategyId: request.id,
      bankId: request.bankId,
      requestType: request.requestType,
      status: request.status
    });
    return sendJSON(res, 200, { request });
  } catch (err) {
    log('error', 'Strategy request update failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not update strategy request' });
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
  const seen = new Map();
  for (const row of manifest.matches) {
    if (!row || !row.bankId) continue;
    const id = String(row.bankId);
    if (seen.has(id)) continue;
    const summary = getBankSummaryForCoverage(id);
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
  const sells = legs.filter(l => l.side === 'sell');
  const buys = legs.filter(l => l.side === 'buy');
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
  const result = findSwapCandidates(ctx.parsedHoldings, ctx.inventory, {
    includeRejected: true,
    rules,
    limit: parseInt(query.get('limit'), 10) || 5
  });
  return sendJSON(res, 200, {
    bankId,
    bankName: ctx.summary.displayName || ctx.summary.name || 'Bank',
    isSubchapterS: ctx.summary.subchapterS === 'Yes',
    taxRate: ctx.summary.subchapterS === 'Yes' ? 29.6 : 21,
    holdingsAvailable: true,
    holdingsReportDate: ctx.parsedHoldings.asOfDate || '',
    holdingsTotalPositions: ctx.parsedHoldings.aggregates ? ctx.parsedHoldings.aggregates.totalPositions : 0,
    kept: result.kept,
    dropped: result.dropped,
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

function handleSwapHoldings(res, bankId) {
  const ctx = getSwapBankContext(bankId);
  if (!ctx) return sendJSON(res, 404, { error: 'Bank not found' });
  if (!ctx.parsedHoldings) return sendJSON(res, 200, { available: false });
  const positions = [];
  for (const [sector, rows] of Object.entries(ctx.parsedHoldings.sectors || {})) {
    for (const row of rows) {
      positions.push({
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
        modifiedDuration: row.modifiedDuration || null,
        averageLife: row.averageLife || null,
        gainLoss: row.gainLoss || 0,
        bookValue: row.bookValue || null,
        marketValue: row.marketValue || null
      });
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
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
  try {
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
      const slot = classifyFolderDropFile(filename);
      const reference = !slot && isReferenceDropFile(filename);
      return {
        filename,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        slot,
        label: slot ? (DOC_TYPES_LABELS[slot] || slot) : folderDropReferenceLabel(filename),
        companionRole: folderDropCompanionRole(filename),
        date: sniffDateFromFilename(filename),
        reference,
        ignored: filename.startsWith('.') || filename.startsWith('_') || (!slot && !reference)
      };
    })
    .filter(row => !row.filename.startsWith('.') && row.filename !== '.DS_Store');

  const publishable = entries.filter(row => row.slot && !row.ignored);
  const references = entries.filter(row => row.reference && !row.ignored);
  const ignored = entries.filter(row => row.ignored || (!row.slot && !row.reference));
  const slots = {};
  publishable.forEach(row => {
    if (!slots[row.slot]) slots[row.slot] = [];
    slots[row.slot].push(row);
  });

  const warnings = [];
  if (!publishable.length) warnings.push('No publishable portal files were found in this folder.');
  const touchesAgencies = Boolean(slots.agenciesBullets || slots.agenciesCallables);
  if (touchesAgencies && (!slots.agenciesBullets || !slots.agenciesCallables)) {
    warnings.push('Agency publishing needs both the bullets and callables workbooks unless the other file already exists in today’s current package.');
  }
  const dates = [...new Set(publishable.map(row => row.date).filter(Boolean))];
  if (dates.length > 1) warnings.push(`Files appear to reference multiple dates: ${dates.join(', ')}.`);
  if (references.length) warnings.push(`${references.length} reference/internal file${references.length === 1 ? '' : 's'} found. They will stay in the folder and will not replace package slots yet.`);

  return {
    date,
    folderPath,
    created: true,
    publishable,
    references,
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
  const marketEmails = emailFiles.filter(file => !structuredEmails.includes(file));

  const result = {
    cdInternal: null,
    structuredNotes: null,
    marketColor: null
  };

  if (cdInternalFiles.length) {
    result.cdInternal = saveCdInternalUpload(CD_INTERNAL_DIR, cdInternalFiles);
  }
  if (structuredEmails.length) {
    result.structuredNotes = saveStructuredNotesUpload(STRUCTURED_NOTES_DIR, structuredEmails);
  }
  if (marketEmails.length) {
    result.marketColor = saveMarketColorUpload(MARKET_COLOR_DIR, marketEmails);
  }
  return result;
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
      afterPublish: () => ingestFolderDropReferences(scan)
    });
  } catch (err) {
    log('error', 'Folder drop publish failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Folder drop publish failed' });
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

async function publishPackageFiles(files, res, options = {}) {
  let priorMeta = readMetaFile(CURRENT_DIR);
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
  if (touchesAgencies) {
    const missingAgencyUploads = ['agenciesBullets', 'agenciesCallables']
      .filter(slot => !incomingSlots.has(slot));
    const existingPackageDate = priorMeta.date || (existingBeforeUpload.length > 0 ? todayStamp() : null);
    const currentPackageWillArchive = existingBeforeUpload.length > 0 && existingPackageDate !== todayStamp();
    const missingCanUseCurrentFiles = !currentPackageWillArchive &&
      missingAgencyUploads.every(slot => findPackageFileForSlot(CURRENT_DIR, slot, priorMeta));

    if (missingAgencyUploads.length > 0 && !missingCanUseCurrentFiles) {
      return sendJSON(res, 400, {
        error: 'Agency uploads require both Bullets and Callables files. Add both agency Excel files and publish again.'
      });
    }
  }

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
      if (!archiveDate) archiveDate = todayStamp();

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
    return sendJSON(res, 500, { error: 'Failed to rotate existing package' });
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
      return sendJSON(res, 400, { error: signatureError });
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
    return sendJSON(res, 400, { error: 'No uploaded files could be classified' });
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
        log('info', `Extracted ${offeringsCount} offerings from Daily CD Offerings upload`);
      } catch (err) {
        log('error', 'Failed to write offerings JSON:', err.message);
      }
    } else {
      log('warn', 'Daily CD Offerings file was uploaded but no offerings were extracted');
    }
  }

  // Extract muni offerings from the Muni Offerings PDF if present.
  let muniOfferingsCount = null;
  let muniOfferingsWarnings = [];
  let muniOfferingsAsOfDate = null;
  const muniOffersFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'munioffers');
  if (muniOffersFile) {
    const extracted = await extractMuniOfferings(muniOffersFile.data);
    if (extracted && Array.isArray(extracted.offerings)) {
      muniOfferingsCount = extracted.offerings.length;
      muniOfferingsWarnings = extracted.warnings || [];
      muniOfferingsAsOfDate = extracted.asOfDate;
      const offPayload = {
        asOfDate: extracted.asOfDate,
        extractedAt: new Date().toISOString(),
        sourceFile: slotFilenames.munioffers,
        warnings: muniOfferingsWarnings,
        offerings: extracted.offerings
      };
      try {
        fs.writeFileSync(
          path.join(CURRENT_DIR, MUNI_OFFERINGS_FILENAME),
          JSON.stringify(offPayload, null, 2)
        );
        log('info', `Extracted ${muniOfferingsCount} muni offerings from Muni Offers PDF`);
      } catch (err) {
        log('error', 'Failed to write muni offerings JSON:', err.message);
      }
    } else {
      log('warn', 'Muni Offerings PDF was uploaded but no offerings were extracted');
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
    if (agencySelection.missingSlots.length > 0) {
      return sendJSON(res, 400, {
        error: 'Agency uploads require both Bullets and Callables files. Add both agency Excel files and publish again.'
      });
    }

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
    agencyWarnings = parsed.warnings;
    agencySources = parsed.sources;
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
  const mergedMuniOfferingsCount  = incomingSlots.has('munioffers')  ? muniOfferingsCount  : (priorMeta.muniOfferingsCount ?? null);
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
      referenceIngest = options.afterPublish();
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

  if (isMutatingApiRequest(req, pathname) && !isSameOriginWrite(req)) {
    return sendJSON(res, 403, { error: 'Cross-site write request blocked' });
  }

  try {
    // --- API ---

    if (pathname === '/api/current' && req.method === 'GET') {
      return sendJSON(res, 200, getCurrentPackage() || {});
    }

    if (pathname === '/api/archive' && req.method === 'GET') {
      return sendJSON(res, 200, getArchiveList());
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(res, 200, { status: 'ok', now: new Date().toISOString(), build: PORTAL_BUILD });
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

    if (pathname === '/api/market-color' && req.method === 'GET') {
      return sendJSON(res, 200, loadMarketColorInbox(MARKET_COLOR_DIR));
    }

    const marketColorFileMatch = pathname.match(/^\/api\/market-color\/files\/([^/]+)$/);
    if (marketColorFileMatch && req.method === 'GET') {
      const fileId = safeDecodeURIComponent(marketColorFileMatch[1]);
      if (!fileId) return sendText(res, 400, 'Invalid market color file ID');
      const file = getMarketColorSourceFile(MARKET_COLOR_DIR, fileId);
      if (!file || !fs.existsSync(file.path)) return sendText(res, 404, 'Not found');
      return sendFile(res, file.path, { download: true, filename: file.filename });
    }

    if (pathname === '/api/cd-internal' && req.method === 'GET') {
      return sendJSON(res, 200, loadCdInternalInventory(CD_INTERNAL_DIR));
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
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(html);
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

    const strategyMatch = pathname.match(/^\/api\/strategies\/([^/]+)$/);
    if (strategyMatch && req.method === 'POST') {
      const id = safeDecodeURIComponent(strategyMatch[1]);
      if (!id) return sendJSON(res, 400, { error: 'Invalid strategy request ID' });
      return await handleUpdateStrategyRequest(req, res, id);
    }

    if (pathname === '/api/bank-coverage' && req.method === 'GET') {
      return sendJSON(res, 200, { savedBanks: listSavedBanks(BANK_REPORTS_DIR) });
    }

    if (pathname === '/api/bank-account-statuses' && req.method === 'GET') {
      const filters = {
        q: query.get('q'),
        status: query.get('status'),
        service: query.get('service'),
        sort: query.get('sort'),
        limit: query.get('limit')
      };
      return sendJSON(res, 200, {
        accountStatuses: listBankAccountStatuses(BANK_REPORTS_DIR, filters),
        resultCount: countBankAccountStatuses(BANK_REPORTS_DIR, filters),
        importStatus: getBankAccountStatusImportStatus(BANK_REPORTS_DIR)
      });
    }

    if (pathname === '/api/bank-coverage' && req.method === 'POST') {
      return await handleSaveBankCoverage(req, res);
    }

    const bankCoverageNoteMatch = pathname.match(/^\/api\/bank-coverage\/([^/]+)\/notes$/);
    if (bankCoverageNoteMatch && req.method === 'POST') {
      const bankId = safeDecodeURIComponent(bankCoverageNoteMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      return await handleAddBankNote(req, res, bankId);
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
        accountStatus: summary ? effectiveAccountStatus(summary, statuses, coverageMap) : null
      });
    }

    if (bankCoverageMatch && req.method === 'DELETE') {
      const bankId = safeDecodeURIComponent(bankCoverageMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      removeSavedBank(BANK_REPORTS_DIR, bankId);
      appendAuditLog({ event: 'bank-coverage-remove', bankId });
      invalidateBankCaches();
      return sendJSON(res, 200, { success: true });
    }

    const bankNoteMatch = pathname.match(/^\/api\/bank-coverage\/notes\/([^/]+)$/);
    if (bankNoteMatch && req.method === 'DELETE') {
      const noteId = safeDecodeURIComponent(bankNoteMatch[1]);
      if (!noteId) return sendJSON(res, 400, { error: 'Invalid note ID' });
      removeBankNote(BANK_REPORTS_DIR, noteId);
      appendAuditLog({ event: 'bank-note-remove', noteId });
      invalidateBankCaches();
      return sendJSON(res, 200, { success: true });
    }

    if (pathname === '/api/bank-account-status' && req.method === 'POST') {
      return await handleSaveBankAccountStatus(req, res);
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
      return sendJSON(res, 200, data);
    }

    if (pathname === '/api/banks/averaged-series/upload' && req.method === 'POST') {
      return await handleAveragedSeriesUpload(req, res);
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
        return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
      }
      sendFile(res, staticPath);
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
});
process.on('unhandledRejection', reason => {
  log('error', 'unhandledRejection:', reason);
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
  startServer
};
