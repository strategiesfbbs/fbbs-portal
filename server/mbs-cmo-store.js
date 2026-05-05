'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const INVENTORY_FILENAME = 'inventory.json';
const FILES_DIRNAME = 'files';
const ALLOWED_EXTENSIONS = new Set(['.xlsm', '.xlsx', '.xlsb', '.xls', '.pdf', '.eml', '.png', '.jpg', '.jpeg']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function inventoryPath(baseDir) {
  return path.join(baseDir, INVENTORY_FILENAME);
}

function filesDir(baseDir) {
  return path.join(baseDir, FILES_DIRNAME);
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

function loadMbsCmoInventory(baseDir) {
  ensureDir(baseDir);
  const empty = { uploadedAt: null, sources: [], offers: [], warnings: [] };
  const filePath = inventoryPath(baseDir);
  if (!fs.existsSync(filePath)) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      uploadedAt: parsed.uploadedAt || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      offers: Array.isArray(parsed.offers) ? parsed.offers : [],
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

function getMbsCmoSourceFile(baseDir, fileId) {
  const inventory = loadMbsCmoInventory(baseDir);
  const source = inventory.sources.find(row => row.id === fileId);
  if (!source || !source.storedFilename) return null;
  const filePath = path.resolve(filesDir(baseDir), source.storedFilename);
  const rel = path.relative(filesDir(baseDir), filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { ...source, path: filePath };
}

function saveMbsCmoUpload(baseDir, uploadFiles) {
  ensureDir(baseDir);
  ensureDir(filesDir(baseDir));

  const inventory = loadMbsCmoInventory(baseDir);
  const uploadedAt = new Date().toISOString();
  const warnings = [];
  const newSources = [];
  const newOffers = [];

  uploadFiles.forEach(file => {
    const ext = path.extname(file.filename || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      warnings.push(`${file.filename || 'File'} was skipped because it is not an MBS/CMO source type.`);
      return;
    }

    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(file.filename);
    const storedFilename = `${id}-${safeName}`;
    fs.writeFileSync(path.join(filesDir(baseDir), storedFilename), file.data);

    const source = {
      id,
      filename: safeName,
      storedFilename,
      extension: ext.replace('.', ''),
      size: file.data.length,
      uploadedAt
    };
    newSources.push(source);

    try {
      if (['.xlsm', '.xlsx', '.xlsb', '.xls'].includes(ext)) {
        newOffers.push(...parseWorkbook(file.data, source, warnings));
      } else if (ext === '.pdf') {
        newOffers.push(...parsePdfText(file.pdfText || '', source, warnings));
      } else if (ext === '.eml') {
        newOffers.push(...parseEmail(file.data.toString('utf-8'), source, warnings));
      }
    } catch (err) {
      warnings.push(`${safeName}: ${err.message}`);
    }
  });

  const next = {
    uploadedAt,
    sources: [...newSources, ...inventory.sources],
    offers: [...newOffers, ...inventory.offers],
    warnings: [...warnings, ...inventory.warnings].slice(0, 100)
  };
  writeInventory(baseDir, next);

  return {
    ...next,
    uploadedSources: newSources,
    uploadedOffers: newOffers,
    uploadWarnings: warnings
  };
}

function cellDisplay(sheet, address) {
  const cell = sheet[address];
  if (!cell) return null;
  if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w).trim();
  return cell.v;
}

function sheetRange(sheet) {
  if (!sheet || !sheet['!ref']) return null;
  try { return XLSX.utils.decode_range(sheet['!ref']); } catch (_) { return null; }
}

function headerKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildHeaderMap(sheet, rowIndex) {
  const range = sheetRange(sheet);
  const map = new Map();
  if (!range) return map;
  for (let col = range.s.c; col <= range.e.c; col++) {
    const raw = cellDisplay(sheet, XLSX.utils.encode_cell({ r: rowIndex, c: col }));
    if (!raw) continue;
    map.set(headerKey(raw), col);
  }
  return map;
}

function rowValue(sheet, headers, row, candidates) {
  for (const key of candidates) {
    const col = headers.get(key);
    if (col == null) continue;
    const value = cellDisplay(sheet, XLSX.utils.encode_cell({ r: row, c: col }));
    if (!isMissingValue(value)) return value;
  }
  return null;
}

function isMissingValue(value) {
  if (value == null) return true;
  const text = String(value).trim();
  return !text || /^#N\/A/i.test(text) || /^#VALUE!/i.test(text) || /^-+$/.test(text);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && isFinite(value)) return value;
  let text = String(value).trim();
  if (isMissingValue(text)) return null;
  const frac = text.match(/^(\d+)-(\d+)$/);
  if (frac) return parseInt(frac[1], 10) + (parseInt(frac[2], 10) / 32);
  text = text.replace(/[$,%]/g, '').replace(/,/g, '');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return isFinite(n) ? n : null;
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && isFinite(value) && value > 20000) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (isMissingValue(text)) return null;
  let m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = text.match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${m[1].padStart(2, '0')}-01`;
  }
  const d = new Date(text);
  return isNaN(d) ? text : d.toISOString().slice(0, 10);
}

function normalizeCusip(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8,9}$/.test(text) ? text : null;
}

function inferProductType(fields) {
  const text = Object.values(fields).filter(Boolean).join(' ').toLowerCase();
  if (/\bcmo\b|pac|sequential|planned amortization|companion|pt cmo|agncy cmo/.test(text)) return 'CMO';
  if (/\bmbs\b|mortgage|mtge|single family|pool|fncl|gnr|fhr/.test(text)) return 'MBS';
  return 'MBS/CMO';
}

function sourceRef(source) {
  return [{ id: source.id, filename: source.filename, extension: source.extension, size: source.size }];
}

function makeOffer(source, values) {
  return {
    id: crypto.randomUUID(),
    sourceType: values.sourceType || source.extension.toUpperCase(),
    productType: values.productType || inferProductType(values),
    description: values.description || '',
    cusip: normalizeCusip(values.cusip),
    coupon: toNumber(values.coupon),
    price: toNumber(values.price),
    bid: toNumber(values.bid),
    ask: toNumber(values.ask),
    yield: toNumber(values.yield),
    wal: toNumber(values.wal),
    duration: toNumber(values.duration),
    spread: toNumber(values.spread),
    wac: toNumber(values.wac),
    factor: toNumber(values.factor),
    originalFace: toNumber(values.originalFace),
    currentFace: toNumber(values.currentFace),
    available: values.available || null,
    settleDate: normalizeDate(values.settleDate),
    issueDate: normalizeDate(values.issueDate),
    maturityDate: normalizeDate(values.maturityDate),
    principalWindow: values.principalWindow || '',
    collateral: values.collateral || '',
    topGeo: values.topGeo || '',
    loans: toNumber(values.loans),
    note: values.note || '',
    emailSubject: values.emailSubject || '',
    emailFrom: values.emailFrom || '',
    emailDate: values.emailDate || '',
    sourceFiles: sourceRef(source),
    createdAt: source.uploadedAt
  };
}

function parseWorkbook(buffer, source, warnings) {
  const workbook = XLSX.read(buffer, { cellFormula: true, cellDates: false });
  const sheetName = workbook.SheetNames.find(name => name.toLowerCase() === 'bbg_link') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const range = sheetRange(sheet);
  if (!sheet || !range) return [];

  let headerRow = -1;
  let headers = new Map();
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 20); row++) {
    const map = buildHeaderMap(sheet, row);
    if (map.has('security_des') || map.has('id_cusip') || map.has('yld_cnv_bid')) {
      headerRow = row;
      headers = map;
      break;
    }
  }
  if (headerRow === -1) {
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 20); row++) {
      const map = buildHeaderMap(sheet, row);
      if (map.has('cusip')) {
        headerRow = row;
        headers = map;
        break;
      }
    }
  }
  if (headerRow === -1) {
    warnings.push(`${source.filename}: no Bloomberg-style header row was found.`);
    return [];
  }

  const offers = [];
  for (let row = headerRow + 1; row <= range.e.r; row++) {
    const cusip = rowValue(sheet, headers, row, ['cusip', 'id_cusip']);
    const description = rowValue(sheet, headers, row, ['security_des', 'name', 'description', 'ticker']);
    if (!normalizeCusip(cusip) && !description) continue;

    const raw = {
      sourceType: 'Bloomberg Workbook',
      cusip,
      description,
      productType: rowValue(sheet, headers, row, ['mtg_compliance_code', 'security_typ', 'market_sector_des']),
      collateral: rowValue(sheet, headers, row, ['property_type', 'collateral_type', 'mtg_pool_type']),
      coupon: rowValue(sheet, headers, row, ['cpn', 'coupon']),
      issueDate: rowValue(sheet, headers, row, ['issue_dt', 'issue_date']),
      maturityDate: rowValue(sheet, headers, row, ['maturity', 'maturity_date', 'mty']),
      factor: rowValue(sheet, headers, row, ['current_factor', 'factor']),
      currentFace: rowValue(sheet, headers, row, ['current_amount', 'current_balance', 'mtg_factorable_current_amt']),
      bid: rowValue(sheet, headers, row, ['bid', 'px_bid']),
      ask: rowValue(sheet, headers, row, ['ask', 'px_ask']),
      price: rowValue(sheet, headers, row, ['ask', 'px_ask', 'price']),
      yield: rowValue(sheet, headers, row, ['yld_cnv_bid', 'yield', 'yld_ytm_bid']),
      spread: rowValue(sheet, headers, row, ['i_sprd_bid', 'i_sprd_ask', 'i_spread', 'spread']),
      wal: rowValue(sheet, headers, row, ['mtg_wal', 'wal', 'avg_life']),
      duration: rowValue(sheet, headers, row, ['dur_adj_mid', 'eff_dur_mid', 'duration']),
      wac: rowValue(sheet, headers, row, ['wac', 'mtg_wac']),
      loans: rowValue(sheet, headers, row, ['num_loans', 'loans']),
      topGeo: rowValue(sheet, headers, row, ['geo_region', 'top_geo']),
      settleDate: rowValue(sheet, headers, row, ['settle_dt', 'settlement_date', 'settle']),
      principalWindow: rowValue(sheet, headers, row, ['principal_window', 'prin_win']),
      note: rowValue(sheet, headers, row, ['notes', 'comment'])
    };
    const offer = makeOffer(source, { ...raw, productType: inferProductType(raw) });
    offers.push(offer);
  }

  if (!offers.length) warnings.push(`${source.filename}: workbook opened, but no active MBS/CMO rows were found.`);
  return offers;
}

function lineAfter(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}(?![A-Za-z])\\s+([^\\n]+)`, 'i');
  const match = text.match(re);
  return match ? match[1].trim() : null;
}

function parsePdfText(text, source, warnings) {
  if (!text || !text.trim()) {
    warnings.push(`${source.filename}: PDF text could not be extracted.`);
    return [];
  }
  const value = re => {
    const match = text.match(re);
    return match ? match[1].trim() : null;
  };
  const baseRow = rowName => {
    const escaped = rowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = text.split(/\n/).map(row => row.trim()).find(row => {
      const match = row.match(new RegExp(`^${escaped}(?![A-Za-z])\\s+(.+)`, 'i'));
      return match && !/^table\b/i.test(match[1]) && /[0-9]/.test(match[1]);
    })?.replace(new RegExp(`^${escaped}(?![A-Za-z])\\s+`, 'i'), '');
    if (!line) return null;
    const parts = line.split(/\s+/).filter(Boolean);
    return parts.length >= 4 ? parts[3] : parts[0] || null;
  };

  const cusip = value(/\bCUSIP:\s*([A-Z0-9]{8,9})/i) || value(/\bCUSIP\s+([A-Z0-9]{8,9})/i);
  const note =
    value(/\n([^\n]{3,90})\nFBBSinc\.com/i) ||
    value(/\bNotes?\s+([^\n]{3,160})/i) ||
    path.basename(source.filename, path.extname(source.filename));
  const rawType = lineAfter(text, 'Type');
  const raw = {
    sourceType: 'PDF Offering',
    cusip,
    description: note,
    productType: rawType,
    coupon: lineAfter(text, 'Coupon'),
    issueDate: lineAfter(text, 'Issue Date'),
    maturityDate: lineAfter(text, 'Maturity Date'),
    factor: lineAfter(text, 'Factor'),
    price: value(/\bPrice:\s*([\d.\-]+)\b/i) || baseRow('Price'),
    yield: baseRow('Yield'),
    wal: baseRow('Avg Life'),
    spread: baseRow('Spread (Bps)') || baseRow('Spread'),
    originalFace: lineAfter(text, 'Original Face'),
    currentFace: lineAfter(text, 'Current Face'),
    settleDate: value(/\bSettlement Date:\s*([0-9/]+)\b/i),
    principalWindow: baseRow('Principal Window'),
    loans: lineAfter(text, 'Pool Count'),
    note
  };

  if (!raw.cusip && !raw.description) {
    warnings.push(`${source.filename}: no CUSIP or description was found.`);
    return [];
  }
  return [makeOffer(source, { ...raw, productType: inferProductType(raw) })];
}

function unfoldEmailHeaders(text) {
  return text.replace(/\r\n[ \t]+/g, ' ').replace(/\n[ \t]+/g, ' ');
}

function emailHeader(text, name) {
  const match = unfoldEmailHeaders(text).match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function emailBody(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const plainPart = normalized.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?:\n--[^\n]+|$)/i);
  if (plainPart) return plainPart[1].trim();
  const idx = normalized.search(/\n\n/);
  return idx === -1 ? normalized : normalized.slice(idx).trim();
}

function decodeQuotedPrintable(text) {
  return String(text || '')
    .replace(/=\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanEmailOfferText(text) {
  const lines = decodeQuotedPrintable(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^--/.test(line))
    .filter(line => !/^Content-(Type|Transfer-Encoding|ID|Disposition):/i.test(line))
    .filter(line => !/^boundary=/i.test(line))
    .filter(line => !/^\[cid:/i.test(line))
    .filter(line => !/^CAUTION:/i.test(line));

  const useful = [];
  for (const line of lines) {
    if (/^(Thanks|Thank you|Regards|CONFIDENTIALITY NOTICE|This e-mail)/i.test(line)) break;
    if (/^(Brian Roscoe|Direct:|www\.FBBSinc\.com|1714 Deer Tracks Trail)/i.test(line)) break;
    useful.push(line);
    if (useful.length >= 10) break;
  }
  return useful.join('\n');
}

function parseEmail(text, source) {
  const subject = emailHeader(text, 'Subject') || path.basename(source.filename, path.extname(source.filename));
  const body = cleanEmailOfferText(emailBody(text));
  const amount =
    (body.match(/\$?\s*[\d,.]+\s*mm\+?\s+available/i) || [])[0] ||
    (body.match(/[\d,.]+\s*\/\s*[\d,.]+\s*mm\+?/i) || [])[0] ||
    '';
  const settle =
    (body.match(/\bT\+?\d+\s+Settle\b/i) || [])[0] ||
    (body.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+settle\b/i) || [])[0] ||
    '';
  const markup = (body.match(/Shown\s+w\/\s*\$?[\d.]+/i) || [])[0] || '';
  const coupon = (body.match(/\b(\d+(?:\.\d+)?)%\s+(?:off|of)\b/i) || [])[1] || null;
  const raw = {
    sourceType: 'Email Offer',
    productType: /cmo|pac|pt structure|mandatory redemption/i.test(`${subject} ${body}`) ? 'CMO' : 'MBS/CMO',
    description: subject,
    coupon,
    available: amount,
    settleDate: settle,
    note: body.slice(0, 1600),
    emailSubject: subject,
    emailFrom: emailHeader(text, 'From'),
    emailDate: emailHeader(text, 'Date')
  };
  return [makeOffer(source, raw)];
}

module.exports = {
  getMbsCmoSourceFile,
  loadMbsCmoInventory,
  saveMbsCmoUpload
};
