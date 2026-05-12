'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const INVENTORY_FILENAME = 'inventory.json';
const FILES_DIRNAME = 'files';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(original) {
  let name = path.basename(original || '').trim();
  name = name.replace(/[^A-Za-z0-9._\- ]/g, '_').replace(/_{2,}/g, '_').replace(/^\.+/, '');
  return name || 'file';
}

function inventoryPath(baseDir) {
  return path.join(baseDir, INVENTORY_FILENAME);
}

function filesDir(baseDir) {
  return path.join(baseDir, FILES_DIRNAME);
}

function loadCdInternalInventory(baseDir) {
  ensureDir(baseDir);
  const empty = { uploadedAt: null, sources: [], offerings: [], warnings: [] };
  if (!fs.existsSync(inventoryPath(baseDir))) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath(baseDir), 'utf-8'));
    return {
      uploadedAt: parsed.uploadedAt || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      offerings: Array.isArray(parsed.offerings) ? parsed.offerings : [],
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

function headerKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const keys = new Set((rows[i] || []).map(headerKey));
    if (keys.has('cusip') && (keys.has('name') || keys.has('issuer')) && keys.has('rate')) return i;
  }
  return -1;
}

function buildMap(row) {
  const aliases = {
    term: ['term'],
    maturity: ['maturity', 'mty'],
    underwriter: ['underwriter', 'uw'],
    name: ['name', 'issuer', 'institution', 'bank'],
    description: ['description', 'desc'],
    rate: ['rate', 'apy', 'coupon'],
    cusip: ['cusip', 'security'],
    settle: ['settle', 'settlement', 'settlement_date'],
    fdicNumber: ['fdic_number', 'fdic_cert', 'cert', 'fdic'],
    domiciled: ['domiciled', 'state', 'issuer_state', 'st'],
    restrictions: ['restrictions', 'restricted_states', 'not_available_in']
  };
  const keys = (row || []).map(headerKey);
  const map = {};
  for (const [field, options] of Object.entries(aliases)) {
    const idx = keys.findIndex(key => options.includes(key));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[$,%]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return `${year}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

function parseRestrictions(value) {
  return clean(value).split(/[,;/]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function parseCdInternalWorkbook(buffer, source, warnings = []) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const rows = [];
  for (const sheetName of workbook.SheetNames || []) {
    const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const headerIndex = findHeaderRow(sheetRows);
    if (headerIndex === -1) continue;
    const map = buildMap(sheetRows[headerIndex]);
    for (let i = headerIndex + 1; i < sheetRows.length; i += 1) {
      const row = sheetRows[i] || [];
      const get = key => map[key] == null ? '' : row[map[key]];
      const cusip = clean(get('cusip')).toUpperCase();
      if (!/^[A-Z0-9]{9}$/.test(cusip)) continue;
      rows.push({
        id: crypto.createHash('sha1').update(`${source.id}-${cusip}`).digest('hex').slice(0, 16),
        term: clean(get('term')),
        maturity: toIsoDate(get('maturity')),
        underwriter: clean(get('underwriter')),
        name: clean(get('name')),
        description: clean(get('description')),
        rate: toNumber(get('rate')),
        cusip,
        settle: toIsoDate(get('settle')),
        fdicNumber: clean(get('fdicNumber')),
        domiciled: clean(get('domiciled')).toUpperCase(),
        restrictions: parseRestrictions(get('restrictions')),
        sourceFile: source.filename,
        createdAt: source.uploadedAt
      });
    }
  }
  if (!rows.length) warnings.push(`${source.filename}: no internal CD rows were parsed.`);
  return rows;
}

function saveCdInternalUpload(baseDir, uploadFiles) {
  ensureDir(baseDir);
  ensureDir(filesDir(baseDir));
  const inventory = loadCdInternalInventory(baseDir);
  const uploadedAt = new Date().toISOString();
  const warnings = [];
  const newSources = [];
  const newOfferings = [];

  for (const file of uploadFiles || []) {
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.filename || '')) continue;
    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(file.filename);
    const storedFilename = `${id}-${safeName}`;
    fs.writeFileSync(path.join(filesDir(baseDir), storedFilename), file.data);
    const source = { id, filename: safeName, storedFilename, extension: path.extname(safeName).slice(1), size: file.data.length, uploadedAt };
    newSources.push(source);
    try {
      newOfferings.push(...parseCdInternalWorkbook(file.data, source, warnings));
    } catch (err) {
      warnings.push(`${safeName}: ${err.message}`);
    }
  }

  const next = {
    uploadedAt,
    sources: [...newSources, ...inventory.sources],
    offerings: [...newOfferings, ...inventory.offerings],
    warnings: [...warnings, ...inventory.warnings].slice(0, 100)
  };
  writeInventory(baseDir, next);
  return { ...next, uploadedSources: newSources, uploadedOfferings: newOfferings, uploadWarnings: warnings };
}

module.exports = {
  loadCdInternalInventory,
  parseCdInternalWorkbook,
  saveCdInternalUpload
};
