/**
 * FBBS Market Intelligence Portal — Internal Web App
 *
 * Serves the portal UI and accepts daily document uploads:
 *   • Market Intelligence Dashboard (HTML)
 *   • Economic Update (PDF)
 *   • Brokered CD Rate Sheet (PDF)
 *   • Daily CD Offerings (PDF)   ← also parsed into structured Offerings
 *
 * Dependencies: pdf-parse (for extracting text from the CD Offers PDF).
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
const fs = require('fs');
const path = require('path');
const { extractPdfText } = require('./pdf-text');

const { parseCdOffersText } = require('./cd-offers-parser');
const { parseBrokeredCdRateSheetText } = require('./brokered-cd-parser');
const { parseMuniOffersText } = require('./muni-offers-parser');
const { parseEconomicUpdateText } = require('./economic-update-parser');
const { parseAgenciesFiles } = require('./agencies-parser');
const { parseCorporatesFiles } = require('./corporates-parser');
const {
  getBankDatabaseStatus,
  getBankFromDatabase,
  importBankWorkbook,
  listBankSummaries,
  searchBankDatabase
} = require('./bank-data-importer');
const {
  addBankNote,
  getBankCoverage,
  listSavedBanks,
  removeBankNote,
  removeSavedBank,
  upsertSavedBank
} = require('./bank-coverage-store');
const {
  defaultAccountStatus,
  getBankAccountStatuses,
  importBankAccountStatusWorkbook,
  upsertBankAccountStatus
} = require('./bank-account-status-store');
const {
  ensureCdHistoryDir,
  saveCdHistorySnapshot,
  summarizeWeeklyCdHistory
} = require('./cd-history');

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
const CD_HISTORY_DIR = path.join(DATA_DIR, 'cd-history');
const BANK_REPORTS_DIR = path.join(DATA_DIR, 'bank-reports');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_UPLOAD_MB, 10) || 50) * 1024 * 1024;
const BANK_UPLOAD_MAX_BYTES = (parseInt(process.env.BANK_UPLOAD_MAX_MB, 10) || 300) * 1024 * 1024;

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;

// ---------- Logging ----------

function log(level, ...args) {
  if (LOG_LEVELS[level] < LOG_LEVEL) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(prefix, ...args);
}

// ---------- Setup ----------

[DATA_DIR, CURRENT_DIR, ARCHIVE_DIR, CD_HISTORY_DIR, BANK_REPORTS_DIR].forEach(dir => {
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
  '.xls':  'application/vnd.ms-excel',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8'
};

const SLOT_NAMES = ['dashboard', 'econ', 'cd', 'cdoffers', 'munioffers', 'agenciesBullets', 'agenciesCallables', 'corporates'];
const OFFERINGS_FILENAME = '_offerings.json';
const MUNI_OFFERINGS_FILENAME = '_muni_offerings.json';
const ECONOMIC_UPDATE_FILENAME = '_economic_update.json';
const AGENCIES_FILENAME = '_agencies.json';
const CORPORATES_FILENAME = '_corporates.json';
const META_FILENAME = '_meta.json';
const BANK_WORKBOOK_FILENAME = 'current-bank-call-reports.xlsm';
const BANK_STATUS_WORKBOOK_FILENAME = 'current-bank-account-statuses.xlsb';

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

function sendFile(res, filePath, { download = false } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }
    const headers = {
      'Content-Type': getContentType(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    };
    if (download) {
      headers['Content-Disposition'] =
        `attachment; filename="${path.basename(filePath).replace(/"/g, '')}"`;
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

function classifyFile(filename, explicitSlot) {
  if (explicitSlot && SLOT_NAMES.includes(explicitSlot)) return explicitSlot;
  if (!filename) return null;
  const lower = filename.toLowerCase();

  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'dashboard';

  // Agencies + Corporates: Excel files. Route by filename keyword.
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    if (lower.includes('corporate') || lower.includes('corp_')) return 'corporates';
    if (lower.includes('callable') || lower.includes('call')) return 'agenciesCallables';
    if (lower.includes('bullet')) return 'agenciesBullets';
    return 'agenciesBullets';  // ambiguous → default; user can drop into the right slot
  }

  if (lower.endsWith('.pdf')) {
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

function looksLikeHtml(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const head = buffer.slice(0, 512).toString('utf-8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
}

function validateUploadSignature(file, slot) {
  if (!file || !file.data) return 'Upload is missing file data.';
  if (slot === 'dashboard') {
    return looksLikeHtml(file.data) ? null : `${file.filename} does not look like an HTML dashboard file.`;
  }
  if (['econ', 'cd', 'cdoffers', 'munioffers'].includes(slot)) {
    return looksLikePdf(file.data) ? null : `${file.filename} does not look like a PDF file.`;
  }
  if (['agenciesBullets', 'agenciesCallables', 'corporates'].includes(slot)) {
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
            if (SLOT_NAMES.includes(fieldName)) {
              explicitSlot = fieldName;
            } else {
              const m = fieldName.match(/(?:file[_-]?)?(dashboard|econ|cdoffers|munioffers|agenciesBullets|agenciesCallables|corporates|cd)/i);
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
              explicitSlot
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

async function extractOfferings(pdfBuffer) {
  try {
    const result = await extractPdfText(pdfBuffer);
    const parsed = parseCdOffersText(result.text || '');
    return parsed;
  } catch (err) {
    log('warn', 'Offerings extraction failed:', err.message);
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
    cd: null,
    cdoffers: null,
    munioffers: null,
    agenciesBullets: null,
    agenciesCallables: null,
    corporates: null,
    publishedAt: null,
    publishedBy: null,
    offeringsCount: null,
    muniOfferingsCount: null,
    agencyCount: null,
    agencyFileDate: null,
    corporatesCount: null,
    corporatesFileDate: null
  };

  const assignedFromMeta = new Set();
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

  if (meta.date) pkg.date = meta.date;
  if (meta.publishedAt) pkg.publishedAt = meta.publishedAt;
  if (meta.publishedBy) pkg.publishedBy = meta.publishedBy;
  if (typeof meta.offeringsCount === 'number') pkg.offeringsCount = meta.offeringsCount;
  if (typeof meta.muniOfferingsCount === 'number') pkg.muniOfferingsCount = meta.muniOfferingsCount;
  if (typeof meta.agencyCount === 'number') pkg.agencyCount = meta.agencyCount;
  if (meta.agencyFileDate) pkg.agencyFileDate = meta.agencyFileDate;
  if (typeof meta.corporatesCount === 'number') pkg.corporatesCount = meta.corporatesCount;
  if (meta.corporatesFileDate) pkg.corporatesFileDate = meta.corporatesFileDate;
  if (Array.isArray(meta.brokeredCdTerms)) pkg.brokeredCdTerms = meta.brokeredCdTerms;
  if (meta.brokeredCdAsOfDate) pkg.brokeredCdAsOfDate = meta.brokeredCdAsOfDate;

  return pkg;
}

function getCurrentPackage() {
  return readPackageDir(CURRENT_DIR, { dateIfMissingMeta: null });
}

function getArchiveList() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs.readdirSync(ARCHIVE_DIR)
    .filter(d => {
      const full = path.join(ARCHIVE_DIR, d);
      return fs.statSync(full).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    })
    .sort()
    .reverse()
    .map(dir => readPackageDir(path.join(ARCHIVE_DIR, dir), { dateIfMissingMeta: dir }));
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

function searchBanks(query, limit = 12) {
  try {
    const data = searchBankDatabase(BANK_REPORTS_DIR, query, limit);
    if (!data || !Array.isArray(data.results)) return data;
    const statuses = getBankAccountStatuses(BANK_REPORTS_DIR, data.results.map(row => row.id));
    return {
      ...data,
      results: data.results.map(summary => enrichBankSummary(summary, statuses))
    };
  } catch (err) {
    log('warn', 'Bank search failed:', err.message);
    return null;
  }
}

function getBankById(id) {
  try {
    const data = getBankFromDatabase(BANK_REPORTS_DIR, id);
    if (!data || !data.bank || !data.bank.summary) return data;
    const statuses = getBankAccountStatuses(BANK_REPORTS_DIR, [data.bank.id]);
    return {
      ...data,
      bank: {
        ...data.bank,
        summary: enrichBankSummary(data.bank.summary, statuses)
      }
    };
  } catch (err) {
    log('warn', `Could not read bank detail ${id}:`, err.message);
    return null;
  }
}

function effectiveAccountStatus(summary, statuses) {
  if (!summary || !summary.id) return defaultAccountStatus(summary);
  const stored = statuses && statuses.get(String(summary.id));
  let status = stored || defaultAccountStatus(summary);
  const coverage = getBankCoverage(BANK_REPORTS_DIR, summary.id).saved;
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

function enrichBankSummary(summary, statuses) {
  if (!summary) return summary;
  return {
    ...summary,
    accountStatus: effectiveAccountStatus(summary, statuses)
  };
}

function getBankDataStatus() {
  return getBankDatabaseStatus(BANK_REPORTS_DIR);
}

function getBankSummaryForCoverage(bankId) {
  const data = getBankById(bankId);
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
    return sendJSON(res, 200, { note });
  } catch (err) {
    log('error', 'Bank note add failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Could not add bank note' });
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
    const target = path.join(BANK_REPORTS_DIR, BANK_STATUS_WORKBOOK_FILENAME);
    fs.writeFileSync(target, file.data);
    appendAuditLog({
      event: 'bank-account-status-import',
      sourceFile: sanitizeFilename(file.filename),
      importedCount: metadata.importedCount,
      unmatchedCount: metadata.unmatchedCount
    });
    return sendJSON(res, 200, { success: true, metadata });
  } catch (err) {
    log('error', 'Bank account status upload failed:', err.message);
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Bank account status import failed' });
  }
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
    const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf-8');
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

  let priorMeta = readMetaFile(CURRENT_DIR);
  const existingBeforeUpload = fs.existsSync(CURRENT_DIR)
    ? fs.readdirSync(CURRENT_DIR).filter(f => f !== '.gitkeep' && f !== '.DS_Store')
    : [];

  // Determine which slots this upload is touching
  const incomingSlots = new Set();
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
          cdoffers:          [OFFERINGS_FILENAME],
          munioffers:        [MUNI_OFFERINGS_FILENAME],
          agenciesBullets:   [AGENCIES_FILENAME],
          agenciesCallables: [AGENCIES_FILENAME],
          corporates:        [CORPORATES_FILENAME]
        };
        for (const f of existing) {
          if (f === META_FILENAME || f === 'audit.log') continue;
          const classifiedSlot = f.startsWith('_')
            ? Object.entries(perSlotJson).find(([, jsons]) => jsons.includes(f))?.[0]
            : classifyFile(f);
          if (classifiedSlot && incomingSlots.has(classifiedSlot)) {
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

  // Save uploaded files and sniff dates. All slots are single-file (later wins).
  const saved = [];
  const bySlot = {};
  const slotFilenames = {};
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

    // Single-file per slot within THIS upload: later upload replaces earlier.
    if (bySlot[slot]) {
      try { fs.unlinkSync(path.join(CURRENT_DIR, bySlot[slot])); } catch (_) {}
      saved.splice(saved.findIndex(s => s.type === slot), 1);
    }
    fs.writeFileSync(target, file.data);
    bySlot[slot] = safeName;
    slotFilenames[slot] = safeName;
    dateSniffs[slot] = sniffDateFromFilename(file.filename);
    saved.push({ filename: safeName, type: slot, size: file.data.length });
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

  // Extract offerings from the CD Offers PDF if present.
  let offeringsCount = null;
  let offeringsWarnings = [];
  let offeringsAsOfDate = null;
  let cdHistorySnapshot = null;
  const cdOffersFile = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'cdoffers');
  if (cdOffersFile) {
    const extracted = await extractOfferings(cdOffersFile.data);
    if (extracted && Array.isArray(extracted.offerings)) {
      offeringsCount = extracted.offerings.length;
      offeringsWarnings = extracted.warnings || [];
      offeringsAsOfDate = extracted.asOfDate;
      const offPayload = {
        asOfDate: extracted.asOfDate,
        extractedAt: new Date().toISOString(),
        sourceFile: slotFilenames.cdoffers,
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
        log('info', `Extracted ${offeringsCount} offerings from CD Offers PDF`);
      } catch (err) {
        log('error', 'Failed to write offerings JSON:', err.message);
      }
    } else {
      log('warn', 'CD Offers PDF was uploaded but no offerings were extracted');
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

  const packageDate = offeringsAsOfDate || brokeredCdAsOfDate || muniOfferingsAsOfDate || uniqueDates[0] || todayStamp();

  const mergedOfferingsCount      = incomingSlots.has('cdoffers')    ? offeringsCount      : (priorMeta.offeringsCount ?? null);
  const mergedMuniOfferingsCount  = incomingSlots.has('munioffers')  ? muniOfferingsCount  : (priorMeta.muniOfferingsCount ?? null);
  const mergedAgencyCount         = touchesAgencies ? agencyCount        : (priorMeta.agencyCount ?? null);
  const mergedAgencyFileDate      = touchesAgencies ? agencyFileDate     : (priorMeta.agencyFileDate ?? null);
  const mergedCorporatesCount     = incomingSlots.has('corporates')  ? corporatesCount     : (priorMeta.corporatesCount ?? null);
  const mergedCorporatesFileDate  = incomingSlots.has('corporates')  ? corporatesFileDate  : (priorMeta.corporatesFileDate ?? null);
  const mergedBrokeredCdTerms     = incomingSlots.has('cd')          ? brokeredCdTerms     : (priorMeta.brokeredCdTerms ?? null);
  const mergedBrokeredCdAsOfDate  = incomingSlots.has('cd')          ? brokeredCdAsOfDate  : (priorMeta.brokeredCdAsOfDate ?? null);

  // Merged slot filenames: preserve prior filenames for untouched slots
  const mergedSlotFilenames = { ...(priorMeta.slotFilenames || {}), ...slotFilenames };

  const meta = {
    date: packageDate,
    publishedAt: new Date().toISOString(),
    publishedBy: 'Portal User',
    offeringsCount:      mergedOfferingsCount,
    muniOfferingsCount:  mergedMuniOfferingsCount,
    agencyCount:         mergedAgencyCount,
    agencyFileDate:      mergedAgencyFileDate,
    corporatesCount:     mergedCorporatesCount,
    corporatesFileDate:  mergedCorporatesFileDate,
    brokeredCdTerms:     mergedBrokeredCdTerms,
    brokeredCdAsOfDate:  mergedBrokeredCdAsOfDate,
    slotFilenames:       mergedSlotFilenames
  };
  fs.writeFileSync(path.join(CURRENT_DIR, META_FILENAME), JSON.stringify(meta, null, 2));

  appendAuditLog({
    event: 'publish',
    packageDate,
    publishedBy: meta.publishedBy,
    files: saved.map(s => ({ type: s.type, filename: s.filename, size: s.size })),
    offeringsCount,
    cdHistorySnapshot,
    muniOfferingsCount,
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
      agencies: agencyWarnings,
      corporates: corporatesWarnings
    }
  });

  log('info', 'Published package:', saved.map(s => `${s.type}=${s.filename}`).join(', '));
  sendJSON(res, 200, {
    success: true,
    saved,
    meta,
    economicUpdateWarnings,
    offeringsCount,
    offeringsWarnings,
    cdHistorySnapshot,
    muniOfferingsCount,
    muniOfferingsWarnings,
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

  try {
    // --- API ---

    if (pathname === '/api/current' && req.method === 'GET') {
      return sendJSON(res, 200, getCurrentPackage() || {});
    }

    if (pathname === '/api/archive' && req.method === 'GET') {
      return sendJSON(res, 200, getArchiveList());
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(res, 200, { status: 'ok', now: new Date().toISOString() });
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

    if (pathname === '/api/cd-recap/weekly' && req.method === 'GET') {
      const anchorDate = query.get('anchorDate');
      return sendJSON(res, 200, summarizeWeeklyCdHistory(CD_HISTORY_DIR, { anchorDate }));
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

    if (pathname === '/api/bank-coverage' && req.method === 'GET') {
      return sendJSON(res, 200, { savedBanks: listSavedBanks(BANK_REPORTS_DIR) });
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
      return sendJSON(res, 200, {
        ...coverage,
        accountStatus: summary ? effectiveAccountStatus(summary, statuses) : null
      });
    }

    if (bankCoverageMatch && req.method === 'DELETE') {
      const bankId = safeDecodeURIComponent(bankCoverageMatch[1]);
      if (!bankId) return sendJSON(res, 400, { error: 'Invalid bank ID' });
      removeSavedBank(BANK_REPORTS_DIR, bankId);
      appendAuditLog({ event: 'bank-coverage-remove', bankId });
      return sendJSON(res, 200, { success: true });
    }

    const bankNoteMatch = pathname.match(/^\/api\/bank-coverage\/notes\/([^/]+)$/);
    if (bankNoteMatch && req.method === 'DELETE') {
      const noteId = safeDecodeURIComponent(bankNoteMatch[1]);
      if (!noteId) return sendJSON(res, 400, { error: 'Invalid note ID' });
      removeBankNote(BANK_REPORTS_DIR, noteId);
      appendAuditLog({ event: 'bank-note-remove', noteId });
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

    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'API endpoint not found' });
    }

    // --- File serving: current package ---

    if (pathname.startsWith('/current/')) {
      const filename = pathname.slice('/current/'.length);
      if (filename.startsWith('_')) return sendText(res, 404, 'Not found');
      const filePath = safeJoin(CURRENT_DIR, filename);
      if (!filePath) return sendText(res, 400, 'Invalid path');
      const download = query.get('download') === '1';
      return sendFile(res, filePath, { download });
    }

    // --- File serving: archive ---

    if (pathname.startsWith('/archive/')) {
      const rest = pathname.slice('/archive/'.length);
      const slash = rest.indexOf('/');
      if (slash === -1) return sendText(res, 404, 'Not found');
      const date = rest.slice(0, slash);
      const filename = rest.slice(slash + 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendText(res, 400, 'Invalid date');
      if (filename.startsWith('_')) return sendText(res, 404, 'Not found');
      const filePath = safeJoin(ARCHIVE_DIR, date, filename);
      if (!filePath) return sendText(res, 400, 'Invalid path');
      const download = query.get('download') === '1';
      return sendFile(res, filePath, { download });
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

function startServer() {
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
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  classifyFile,
  sniffDateFromFilename,
  readPackageDir,
  collectAgencyPackageFiles,
  findPackageFileForSlot,
  startServer
};
