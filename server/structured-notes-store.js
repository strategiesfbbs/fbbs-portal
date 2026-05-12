'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  attachmentFilenames,
  decodeHtmlEntities,
  emailBody,
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
  const empty = { uploadedAt: null, sources: [], notes: [], warnings: [] };
  if (!fs.existsSync(inventoryPath(baseDir))) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath(baseDir), 'utf-8'));
    return {
      uploadedAt: parsed.uploadedAt || null,
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
    sourceFiles: sourceRef(source),
    createdAt: source.uploadedAt
  };
}

function parseStructuredNotesEmail(text, source, warnings = []) {
  const summary = emailSummary(text, source.filename);
  const body = decodeHtmlEntities(emailBody(text))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '');
  const lines = body.split('\n')
    .map(line => line.replace(/\t/g, ' ').trim())
    .filter(Boolean);
  const cusips = fieldValues(lines, 'CUSIP').map(v => (v.match(/[A-Z0-9]{9}/i) || [])[0]).filter(Boolean);
  if (!cusips.length) return [];

  const attachments = attachmentFilenames(text);
  const coupons = collectSection(lines, 'Coupon', ['First Pay', 'First Call', 'Pricing', 'Pricing Date', 'CUSIP', 'Price']);
  const fields = {
    issuer: fieldValues(lines, 'Issuer'),
    rating: [...fieldValues(lines, 'Ratings'), ...fieldValues(lines, 'Rating')],
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

function saveStructuredNotesUpload(baseDir, uploadFiles) {
  ensureDir(baseDir);
  ensureDir(filesDir(baseDir));

  const inventory = loadStructuredNotesInventory(baseDir);
  const uploadedAt = new Date().toISOString();
  const warnings = [];
  const newSources = [];
  const newNotes = [];

  for (const file of uploadFiles || []) {
    if (!/\.eml$/i.test(file.filename || '')) continue;
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
      uploadedAt
    };
    newSources.push(source);
    try {
      newNotes.push(...parseStructuredNotesEmail(file.data.toString('utf8'), source, warnings));
    } catch (err) {
      warnings.push(`${safeName}: ${err.message}`);
    }
  }

  const next = {
    uploadedAt,
    sources: [...newSources, ...inventory.sources],
    notes: [...newNotes, ...inventory.notes],
    warnings: [...warnings, ...inventory.warnings].slice(0, 100)
  };
  writeInventory(baseDir, next);
  return { ...next, uploadedSources: newSources, uploadedNotes: newNotes, uploadWarnings: warnings };
}

module.exports = {
  getStructuredNoteSourceFile,
  loadStructuredNotesInventory,
  parseStructuredNotesEmail,
  saveStructuredNotesUpload
};
