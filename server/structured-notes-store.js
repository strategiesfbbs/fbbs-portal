'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  attachmentFilenames,
  decodeHtmlEntities,
  emailBody,
  emailHtmlBody,
  emailSummary
} = require('./email-source-utils');

const INVENTORY_FILENAME = 'inventory.json';
const FILES_DIRNAME = 'files';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(original) {
  let name = path.basename(original || '').trim();
  name = name.replace(/[^A-Za-z0-9._\- ]/g, '_').replace(/_{2,}/g, '_').replace(/^\.+/, '');
  if (!name) name = 'file';
  if (name.length > 180) {
    const ext = path.extname(name);
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name;
}

function inventoryPath(baseDir) {
  return path.join(baseDir, INVENTORY_FILENAME);
}

function filesDir(baseDir) {
  return path.join(baseDir, FILES_DIRNAME);
}

function loadStructuredNotesInventory(baseDir) {
  ensureDir(baseDir);
  const empty = { uploadedAt: null, targetDate: null, sources: [], notes: [], warnings: [] };
  if (!fs.existsSync(inventoryPath(baseDir))) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath(baseDir), 'utf-8'));
    return {
      uploadedAt: parsed.uploadedAt || null,
      targetDate: parsed.targetDate || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
    };
  } catch (_) {
    return empty;
  }
}

function writeInventory(baseDir, inventory) {
  ensureDir(baseDir);
  fs.writeFileSync(inventoryPath(baseDir), JSON.stringify(inventory, null, 2));
}

function getStructuredNoteSourceFile(baseDir, fileId) {
  const inventory = loadStructuredNotesInventory(baseDir);
  const source = inventory.sources.find(row => row.id === fileId);
  if (!source || !source.storedFilename) return null;
  const filePath = path.resolve(filesDir(baseDir), source.storedFilename);
  const rel = path.relative(filesDir(baseDir), filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { ...source, path: filePath };
}

function emailCalendarDate(value) {
  const text = String(value || '').trim();
  const monthMap = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12'
  };
  let match = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (match) {
    const month = monthMap[match[2].toLowerCase()];
    if (month) return `${match[3]}-${month}-${String(Number(match[1])).padStart(2, '0')}`;
  }
  match = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b/);
  if (match) {
    const month = monthMap[match[1].toLowerCase()];
    if (month) return `${match[3]}-${month}-${String(Number(match[2])).padStart(2, '0')}`;
  }
  match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  }
  return '';
}

function normalizeDate(value, fallbackYear = new Date().getFullYear()) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!match) return '';
  let year = match[3] ? Number(match[3]) : fallbackYear;
  if (year < 100) year += 2000;
  return `${year}-${String(Number(match[1])).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function splitValues(text) {
  return String(text || '')
    .replace(/\s{2,}/g, ' | ')
    .split('|')
    .map(v => v.trim())
    .filter(Boolean);
}

function findLine(lines, label) {
  const re = new RegExp(`^${label}:?\\s*(.*)$`, 'i');
  const idx = lines.findIndex(line => re.test(line));
  if (idx === -1) return { index: -1, values: [] };
  const rest = (lines[idx].match(re) || [])[1] || '';
  return { index: idx, values: splitValues(rest) };
}

function collectSection(lines, label, stopLabels) {
  const start = findLine(lines, label).index;
  if (start === -1) return [];
  const stopRe = new RegExp(`^(${stopLabels.join('|')}):`, 'i');
  const values = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (stopRe.test(line)) break;
    if (!line || /^\*+\s*See Redemption/i.test(line)) continue;
    if (/Redemption Schedule|This note has a par value/i.test(line)) break;
    if (/%|x\s*\(|Floor:|Cap:|NON Bail/i.test(line)) {
      if (/^(Floor:|Cap:|\*\*)/i.test(line) && values.length) {
        values[values.length - 1] = `${values[values.length - 1]} ${line}`.trim();
      } else {
        values.push(line);
      }
    }
  }
  return values;
}

function fieldValues(lines, label) {
  return findLine(lines, label).values;
}

// A field value that is really just a leftover label fragment — e.g. the stray
// "s:" split off a "Moody's / S&P:" header, or a bare "Issuer" / "Rating:" — must
// not surface as data. Detected by shape, not value, so it generalizes.
const LABEL_FRAGMENT_RE = /^(issuer|ratings?|term|maturity|settlement|settle|coupon|first\s*pay|first\s*call|pricing(?:\s*date)?|cusip|price)\s*:?\s*$/i;

function isLabelFragment(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (LABEL_FRAGMENT_RE.test(v)) return true;
  // Short alpha fragments ending in a colon are split debris (e.g. "s:" from "S&P:").
  return /^[A-Za-z]{0,3}:$/.test(v);
}

// Generic cleaner: blank a value that is only a label fragment, keep real data.
function cleanFieldValue(value) {
  return isLabelFragment(value) ? '' : String(value || '').trim();
}

// A real rating carries a recognizable agency grade. Anything else (a label
// fragment, an empty cell, stray punctuation) is treated as "no rating" so a
// CUSIP without a matched rating shows blank instead of garbage.
const RATING_GRADE_RE = /(?:Aaa|Aa\d|A\d|Baa\d?|Ba\d?|B\d|Caa\d?|Ca|AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|NR|WR)/;

function cleanRating(value) {
  const v = cleanFieldValue(value);
  return v && RATING_GRADE_RE.test(v) ? v : '';
}

function priceValues(lines) {
  const { index } = findLine(lines, 'Price');
  if (index === -1) return [];
  const text = (lines[index].replace(/^Price:\s*/i, '') || '').trim();
  return (text.match(/\$?\d+(?:\.\d+)?(?:\s*\([^)]*\))?/g) || []).map(v => v.trim());
}

function classifyStructure(coupon, firstCall, term, firstPay) {
  const text = `${coupon || ''} ${firstCall || ''} ${term || ''} ${firstPay || ''}`.toLowerCase();
  if (text.includes('zero')) return 'Zero Coupon';
  if (text.includes('usisso') || text.includes('floor') || text.includes('cap')) return 'Steepener';
  if (/n\/a\s*\(bullet\)|\bbullet\b/.test(text)) return 'Bullet';
  if (text.includes('non bail')) return 'Callable Fixed - Non Bail-In';
  return firstCall && !/n\/a/i.test(firstCall) ? 'Callable Fixed' : 'Fixed';
}

function parsePrice(value) {
  const match = String(value || '').match(/\$?\s*([\d.]+)/);
  return match ? Number(match[1]) : null;
}

function sourceRef(source) {
  return [{ id: source.id, filename: source.filename, extension: source.extension }];
}

function makeNote(row, source, summary, attachments, index) {
  const coupon = row.coupon || '';
  const firstCall = row.firstCall || '';
  const term = row.term || '';
  const idSeed = `${source.id}-${row.cusip || index}`;
  return {
    id: crypto.createHash('sha1').update(idSeed).digest('hex').slice(0, 16),
    issuer: row.issuer || '',
    rating: row.rating || '',
    term,
    structure: classifyStructure(coupon, firstCall, term, row.firstPay),
    coupon,
    settlementDate: normalizeDate(row.settlement || row.settle, 2026),
    maturityDate: normalizeDate(row.maturity, 2026),
    firstPay: row.firstPay || '',
    firstCall,
    pricing: row.pricing || '',
    cusip: String(row.cusip || '').toUpperCase(),
    price: parsePrice(row.price),
    priceText: row.price || '',
    attachment: attachments.find(name => row.cusip && name.includes(row.cusip)) || '',
    note: summary.subject || '',
    emailSubject: summary.subject || '',
    emailFrom: summary.from || '',
    emailDate: summary.date || '',
    emailSentDate: source.sentDate || emailCalendarDate(summary.date),
    sourceFiles: sourceRef(source),
    createdAt: source.uploadedAt
  };
}

// Strip tags + decode entities from one HTML table cell to its plain text.
function htmlCellText(inner) {
  return decodeHtmlEntities(String(inner || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a label cell ("First Pay:", "Coupons:") to a lookup key.
function normalizeLabel(value) {
  return String(value || '').replace(/[:\s]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse the email's HTML <table> into { label -> [value cells] }. Each offering
// grid is one <tr> per field (Issuer, Ratings, …, CUSIP, Price); cell[0] is the
// label and the rest are one cell per note, so columns align 1:1 with the CUSIP
// row by construction — no whitespace-splitting ambiguity. Returns null when the
// email has no usable HTML table (caller falls back to the text/plain grid).
function htmlTableFields(text) {
  const html = emailHtmlBody(text);
  if (!html) return null;
  const byLabel = new Map();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => htmlCellText(c[1]));
    if (!cells.some(Boolean)) continue;
    const label = normalizeLabel(cells[0]);
    if (!label || byLabel.has(label)) continue;
    byLabel.set(label, cells.slice(1));
  }
  const pick = (...aliases) => {
    for (const alias of aliases) {
      if (byLabel.has(alias)) return byLabel.get(alias);
    }
    return [];
  };
  const cusips = pick('cusip').map(v => (v.match(/[A-Z0-9]{9}/i) || [])[0]).filter(Boolean);
  if (!cusips.length) return null;
  return {
    issuer: pick('issuer').map(cleanFieldValue),
    rating: pick('ratings', 'rating').map(cleanRating),
    term: pick('term'),
    settlement: pick('settlement', 'settle'),
    maturity: pick('maturity'),
    coupon: pick('coupons', 'coupon'),
    firstPay: pick('first pay'),
    firstCall: pick('first call'),
    pricing: pick('pricing date', 'pricing'),
    cusip: cusips,
    price: pick('price').map(v => String(v).trim())
  };
}

// Fallback grid: the whitespace-padded text/plain part. Columns here can merge
// when a long value eats its trailing padding, so this is only used when the
// email has no HTML table.
function textBodyFields(text) {
  const body = decodeHtmlEntities(emailBody(text))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '');
  const lines = body.split('\n')
    .map(line => line.replace(/\t/g, ' ').trim())
    .filter(Boolean);
  const cusips = fieldValues(lines, 'CUSIP').map(v => (v.match(/[A-Z0-9]{9}/i) || [])[0]).filter(Boolean);
  if (!cusips.length) return null;
  const coupons = collectSection(lines, 'Coupon', ['First Pay', 'First Call', 'Pricing', 'Pricing Date', 'CUSIP', 'Price']);
  return {
    issuer: fieldValues(lines, 'Issuer').map(cleanFieldValue),
    rating: [...fieldValues(lines, 'Ratings'), ...fieldValues(lines, 'Rating')].map(cleanRating),
    term: fieldValues(lines, 'Term'),
    settlement: [...fieldValues(lines, 'Settlement'), ...fieldValues(lines, 'Settle')],
    maturity: fieldValues(lines, 'Maturity'),
    coupon: coupons,
    firstPay: fieldValues(lines, 'First Pay'),
    firstCall: fieldValues(lines, 'First Call'),
    pricing: [...fieldValues(lines, 'Pricing Date'), ...fieldValues(lines, 'Pricing')],
    cusip: cusips,
    price: priceValues(lines)
  };
}

function parseStructuredNotesEmail(text, source, warnings = []) {
  const summary = emailSummary(text, source.filename);
  const fields = htmlTableFields(text) || textBodyFields(text);
  if (!fields || !fields.cusip.length) return [];

  const attachments = attachmentFilenames(text);
  const cusips = fields.cusip;

  const notes = cusips.map((cusip, index) => makeNote({
    issuer: fields.issuer[index] || (fields.issuer.length === 1 ? fields.issuer[0] : ''),
    rating: fields.rating[index] || '',
    term: fields.term[index] || '',
    settlement: fields.settlement[index] || '',
    maturity: fields.maturity[index] || '',
    coupon: fields.coupon[index] || '',
    firstPay: fields.firstPay[index] || '',
    firstCall: fields.firstCall[index] || '',
    pricing: fields.pricing[index] || '',
    cusip,
    price: fields.price[index] || ''
  }, source, summary, attachments, index));

  if (!notes.length) warnings.push(`${source.filename}: no structured note rows were parsed.`);
  return notes;
}

function removeStoredSourceFiles(baseDir, sources) {
  for (const source of sources || []) {
    if (!source || !source.storedFilename) continue;
    const filePath = path.join(filesDir(baseDir), source.storedFilename);
    const resolved = path.resolve(filePath);
    const rel = path.relative(filesDir(baseDir), resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    try {
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    } catch (_) {}
  }
}

function saveStructuredNotesUpload(baseDir, uploadFiles, options = {}) {
  ensureDir(baseDir);
  ensureDir(filesDir(baseDir));

  const inventory = loadStructuredNotesInventory(baseDir);
  const uploadedAt = new Date().toISOString();
  const targetDate = String(options.targetDate || '').trim();
  const replace = Boolean(options.replace);
  const warnings = [];
  const newSources = [];
  const newNotes = [];

  for (const file of uploadFiles || []) {
    if (!/\.eml$/i.test(file.filename || '')) continue;
    const text = file.data.toString('utf8');
    const summary = emailSummary(text, file.filename);
    const sentDate = emailCalendarDate(summary.date);
    if (targetDate && sentDate !== targetDate) {
      warnings.push(`${file.filename}: skipped because email date ${sentDate || 'unknown'} does not match ${targetDate}.`);
      continue;
    }
    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(file.filename);
    const storedFilename = `${id}-${safeName}`;
    fs.writeFileSync(path.join(filesDir(baseDir), storedFilename), file.data);
    const source = {
      id,
      filename: safeName,
      storedFilename,
      extension: 'eml',
      size: file.data.length,
      sentDate,
      uploadedAt
    };
    newSources.push(source);
    try {
      newNotes.push(...parseStructuredNotesEmail(text, source, warnings));
    } catch (err) {
      warnings.push(`${safeName}: ${err.message}`);
    }
  }

  if (replace) {
    removeStoredSourceFiles(baseDir, inventory.sources);
  }

  const next = {
    uploadedAt,
    targetDate: targetDate || inventory.targetDate || null,
    sources: replace ? newSources : [...newSources, ...inventory.sources],
    notes: replace ? newNotes : [...newNotes, ...inventory.notes],
    warnings: (replace ? warnings : [...warnings, ...inventory.warnings]).slice(0, 100)
  };
  writeInventory(baseDir, next);
  return { ...next, uploadedSources: newSources, uploadedNotes: newNotes, uploadWarnings: warnings };
}

module.exports = {
  getStructuredNoteSourceFile,
  emailCalendarDate,
  loadStructuredNotesInventory,
  parseStructuredNotesEmail,
  saveStructuredNotesUpload
};
