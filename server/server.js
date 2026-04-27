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
const url = require('url');
const { PDFParse } = require('pdf-parse');

const { parseCdOffersText } = require('./cd-offers-parser');
const { parseMuniOffersText } = require('./muni-offers-parser');
const { parseAgenciesFiles } = require('./agencies-parser');
const { parseCorporatesFiles } = require('./corporates-parser');
const { generateDashboard, TEMPLATE_PATH } = require('./dashboard-generator');

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
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'audit.log');
const MAX_UPLOAD_BYTES = (parseInt(process.env.MAX_UPLOAD_MB, 10) || 50) * 1024 * 1024;

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

[DATA_DIR, CURRENT_DIR, ARCHIVE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log('info', 'Created data directory:', dir);
  }
});

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
const AGENCIES_FILENAME = '_agencies.json';
const CORPORATES_FILENAME = '_corporates.json';
const META_FILENAME = '_meta.json';
const DASHBOARD_DRAFT_META_FILENAME = '_dashboard_draft.json';

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
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const parsed = parseCdOffersText(result.text || '');
    return parsed;
  } catch (err) {
    log('warn', 'Offerings extraction failed:', err.message);
    return null;
  }
}

async function extractMuniOfferings(pdfBuffer) {
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const parsed = parseMuniOffersText(result.text || '');
    return parsed;
  } catch (err) {
    log('warn', 'Muni offerings extraction failed:', err.message);
    return null;
  }
}

// ---------- Package reading ----------

function readPackageDir(dirPath, { dateIfMissingMeta = null } = {}) {
  if (!fs.existsSync(dirPath)) return null;
  const files = fs.readdirSync(dirPath).filter(f => !f.startsWith('_'));
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
  for (const f of files) {
    const type = classifyFile(f);
    if (type && !pkg[type]) pkg[type] = f;
  }
  const metaPath = path.join(dirPath, META_FILENAME);
  if (fs.existsSync(metaPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (m.date) pkg.date = m.date;
      if (m.publishedAt) pkg.publishedAt = m.publishedAt;
      if (m.publishedBy) pkg.publishedBy = m.publishedBy;
      if (typeof m.offeringsCount === 'number') pkg.offeringsCount = m.offeringsCount;
      if (typeof m.muniOfferingsCount === 'number') pkg.muniOfferingsCount = m.muniOfferingsCount;
      if (typeof m.agencyCount === 'number') pkg.agencyCount = m.agencyCount;
      if (m.agencyFileDate) pkg.agencyFileDate = m.agencyFileDate;
      if (typeof m.corporatesCount === 'number') pkg.corporatesCount = m.corporatesCount;
      if (m.corporatesFileDate) pkg.corporatesFileDate = m.corporatesFileDate;
    } catch (e) {
      log('warn', 'Could not read meta in', dirPath, '-', e.message);
    }
  }
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

function getSalesDashboardStatus() {
  const current = getCurrentPackage() || {};
  const draftPath = path.join(CURRENT_DIR, DASHBOARD_DRAFT_META_FILENAME);
  let draft = null;
  if (fs.existsSync(draftPath)) {
    try { draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8')); } catch (_) {}
  }
  return {
    templatePresent: fs.existsSync(TEMPLATE_PATH),
    currentDashboard: current.dashboard || null,
    draft,
    availableData: {
      cds: !!loadCurrentOfferings(),
      munis: !!loadCurrentMuniOfferings(),
      agencies: !!loadCurrentAgencies(),
      corporates: !!loadCurrentCorporates()
    },
    counts: {
      cds: current.offeringsCount || 0,
      munis: current.muniOfferingsCount || 0,
      agencies: current.agencyCount || 0,
      corporates: current.corporatesCount || 0
    }
  };
}

function updateMeta(updater) {
  const metaPath = path.join(CURRENT_DIR, META_FILENAME);
  let meta = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (_) {}
  }
  meta = updater(meta || {}) || meta;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

function generateSalesDashboardDraft() {
  const stamp = (getCurrentPackage() || {}).date || todayStamp();
  const filename = `FBBS_Sales_Dashboard_DRAFT_${stamp.replace(/-/g, '')}.html`;
  const outputPath = path.join(CURRENT_DIR, filename);
  const result = generateDashboard({ currentDir: CURRENT_DIR, outputPath });
  const draft = {
    filename,
    generatedAt: new Date().toISOString(),
    date: result.date,
    counts: result.counts,
    report: result.report
  };
  fs.writeFileSync(path.join(CURRENT_DIR, DASHBOARD_DRAFT_META_FILENAME), JSON.stringify(draft, null, 2));
  appendAuditLog({
    event: 'dashboard-draft',
    packageDate: result.date,
    publishedBy: 'Portal User',
    files: [{ type: 'dashboardDraft', filename, size: fs.statSync(outputPath).size }],
    warnings: result.report.passed ? [] : ['Dashboard draft preflight has warnings']
  });
  return draft;
}

function publishSalesDashboardDraft() {
  const draftPath = path.join(CURRENT_DIR, DASHBOARD_DRAFT_META_FILENAME);
  if (!fs.existsSync(draftPath)) {
    const err = new Error('No dashboard draft has been generated yet');
    err.statusCode = 404;
    throw err;
  }
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8'));
  const source = safeJoin(CURRENT_DIR, draft.filename);
  if (!source || !fs.existsSync(source)) {
    const err = new Error('Dashboard draft file is missing');
    err.statusCode = 404;
    throw err;
  }
  const stamp = (draft.date || todayStamp()).replace(/-/g, '');
  const finalName = `FBBS_Sales_Dashboard_${stamp}.html`;
  const target = safeJoin(CURRENT_DIR, finalName);
  fs.copyFileSync(source, target);

  const meta = updateMeta(m => {
    const slotFilenames = { ...(m.slotFilenames || {}), dashboard: finalName };
    return {
      ...m,
      date: m.date || draft.date || todayStamp(),
      publishedAt: new Date().toISOString(),
      publishedBy: 'Portal User',
      slotFilenames
    };
  });

  fs.writeFileSync(path.join(CURRENT_DIR, DASHBOARD_DRAFT_META_FILENAME), JSON.stringify({
    ...draft,
    publishedAt: new Date().toISOString(),
    publishedFilename: finalName
  }, null, 2));

  appendAuditLog({
    event: 'dashboard-publish',
    packageDate: meta.date,
    publishedBy: 'Portal User',
    files: [{ type: 'dashboard', filename: finalName, size: fs.statSync(target).size }],
    warnings: []
  });

  return { filename: finalName, meta };
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

  // Determine which slots this upload is touching
  const incomingSlots = new Set();
  for (const f of files) {
    const s = classifyFile(f.filename, f.explicitSlot);
    if (s) incomingSlots.add(s);
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
        try {
          const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          archiveDate = m.date;
        } catch (_) {}
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
        log('info', 'Archived prior package to', archiveDate);
      } else {
        // Same day: selectively remove ONLY the files whose slots are being
        // re-uploaded. Per-slot internal json ("_offerings.json", etc.) are
        // also cleared so the re-upload can write fresh ones.
        const perSlotJson = {
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

  // Extract offerings from the CD Offers PDF if present.
  let offeringsCount = null;
  let offeringsWarnings = [];
  let offeringsAsOfDate = null;
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

  // Collect from both agency slots.
  const agencyFiles = [];
  const bulletsUpload = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'agenciesBullets');
  const callablesUpload = files.find(f => classifyFile(f.filename, f.explicitSlot) === 'agenciesCallables');
  if (bulletsUpload) {
    agencyFiles.push({ filename: sanitizeFilename(bulletsUpload.filename), buffer: bulletsUpload.data });
  }
  if (callablesUpload) {
    agencyFiles.push({ filename: sanitizeFilename(callablesUpload.filename), buffer: callablesUpload.data });
  }

  if (agencyFiles.length > 0) {
    const parsed = parseAgenciesFiles(agencyFiles);
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
      log('info', `Extracted ${agencyCount} agency offerings from ${agencyFiles.length} file(s)`);
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
  if (muniOfferingsAsOfDate && dateValues.length > 0 && !dateValues.includes(muniOfferingsAsOfDate)) {
    dateWarnings.push(`Muni Offerings document is dated ${muniOfferingsAsOfDate}, but filenames suggest ${dateValues.join(', ')}.`);
  }
  if (offeringsAsOfDate && muniOfferingsAsOfDate && offeringsAsOfDate !== muniOfferingsAsOfDate) {
    dateWarnings.push(`CD Offers (${offeringsAsOfDate}) and Muni Offerings (${muniOfferingsAsOfDate}) are dated differently inside the PDFs.`);
  }

  const packageDate = offeringsAsOfDate || muniOfferingsAsOfDate || uniqueDates[0] || todayStamp();

  // Carry forward meta fields from the prior publish for any slot NOT touched
  // by this upload (supports independent upload channels on the same day).
  let priorMeta = {};
  const priorMetaPath = path.join(CURRENT_DIR, META_FILENAME);
  if (fs.existsSync(priorMetaPath)) {
    try { priorMeta = JSON.parse(fs.readFileSync(priorMetaPath, 'utf-8')); } catch (_) {}
  }

  const mergedOfferingsCount      = incomingSlots.has('cdoffers')    ? offeringsCount      : (priorMeta.offeringsCount ?? null);
  const mergedMuniOfferingsCount  = incomingSlots.has('munioffers')  ? muniOfferingsCount  : (priorMeta.muniOfferingsCount ?? null);
  const touchedAgencies           = incomingSlots.has('agenciesBullets') || incomingSlots.has('agenciesCallables');
  const mergedAgencyCount         = touchedAgencies ? agencyCount        : (priorMeta.agencyCount ?? null);
  const mergedAgencyFileDate      = touchedAgencies ? agencyFileDate     : (priorMeta.agencyFileDate ?? null);
  const mergedCorporatesCount     = incomingSlots.has('corporates')  ? corporatesCount     : (priorMeta.corporatesCount ?? null);
  const mergedCorporatesFileDate  = incomingSlots.has('corporates')  ? corporatesFileDate  : (priorMeta.corporatesFileDate ?? null);

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
    slotFilenames:       mergedSlotFilenames
  };
  fs.writeFileSync(path.join(CURRENT_DIR, META_FILENAME), JSON.stringify(meta, null, 2));

  appendAuditLog({
    event: 'publish',
    packageDate,
    publishedBy: meta.publishedBy,
    files: saved.map(s => ({ type: s.type, filename: s.filename, size: s.size })),
    offeringsCount,
    muniOfferingsCount,
    agencyCount,
    agencyFileDate,
    corporatesCount,
    corporatesFileDate,
    warnings: dateWarnings,
    parserWarnings: {
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
    offeringsCount,
    offeringsWarnings,
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
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  res.on('finish', () => {
    const ms = Date.now() - start;
    log('debug', req.method, parsed.pathname, '→', res.statusCode, `(${ms}ms)`);
  });

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

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
      const date = parsed.query.date;
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

    if (pathname === '/api/muni-offerings' && req.method === 'GET') {
      const date = parsed.query.date;
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
      const date = parsed.query.date;
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
      const date = parsed.query.date;
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

    if (pathname === '/api/audit-log' && req.method === 'GET') {
      const limit = Math.min(parseInt(parsed.query.limit, 10) || 200, 1000);
      return sendJSON(res, 200, readAuditLog({ limit }));
    }

    if (pathname === '/api/sales-dashboard/status' && req.method === 'GET') {
      return sendJSON(res, 200, getSalesDashboardStatus());
    }

    if (pathname === '/api/sales-dashboard/generate' && req.method === 'POST') {
      if (!fs.existsSync(TEMPLATE_PATH)) {
        return sendJSON(res, 500, { error: 'FBBS dashboard template is missing from the portal package' });
      }
      const draft = generateSalesDashboardDraft();
      return sendJSON(res, 200, { success: true, draft });
    }

    if (pathname === '/api/sales-dashboard/publish' && req.method === 'POST') {
      try {
        const published = publishSalesDashboardDraft();
        return sendJSON(res, 200, { success: true, published });
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      return await handleUpload(req, res);
    }

    // --- File serving: current package ---

    if (pathname.startsWith('/current/')) {
      const filename = pathname.slice('/current/'.length);
      if (filename.startsWith('_')) return sendText(res, 404, 'Not found');
      const filePath = safeJoin(CURRENT_DIR, filename);
      if (!filePath) return sendText(res, 400, 'Invalid path');
      const download = parsed.query.download === '1';
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
      const download = parsed.query.download === '1';
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
  startServer
};
