'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { emailSummary } = require('./email-source-utils');

const INBOX_FILENAME = 'inbox.json';
const FILES_DIRNAME = 'files';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(original) {
  let name = path.basename(original || '').trim();
  name = name.replace(/[^A-Za-z0-9._\- ]/g, '_').replace(/_{2,}/g, '_').replace(/^\.+/, '');
  return name || 'file';
}

function inboxPath(baseDir) {
  return path.join(baseDir, INBOX_FILENAME);
}

function filesDir(baseDir) {
  return path.join(baseDir, FILES_DIRNAME);
}

function loadMarketColorInbox(baseDir) {
  ensureDir(baseDir);
  const empty = { updatedAt: null, sources: [], items: [], warnings: [] };
  if (!fs.existsSync(inboxPath(baseDir))) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(inboxPath(baseDir), 'utf-8'));
    return {
      updatedAt: parsed.updatedAt || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
    };
  } catch (_) {
    return empty;
  }
}

function writeInbox(baseDir, inbox) {
  ensureDir(baseDir);
  fs.writeFileSync(inboxPath(baseDir), JSON.stringify(inbox, null, 2));
}

function getMarketColorSourceFile(baseDir, fileId) {
  const inbox = loadMarketColorInbox(baseDir);
  const source = inbox.sources.find(row => row.id === fileId);
  if (!source || !source.storedFilename) return null;
  const filePath = path.resolve(filesDir(baseDir), source.storedFilename);
  const rel = path.relative(filesDir(baseDir), filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { ...source, path: filePath };
}

function inferTags(text) {
  const haystack = String(text || '').toLowerCase();
  const tags = [];
  if (/fed|fomc|rate|yield|treasur|inflation|cpi|ppi/.test(haystack)) tags.push('rates');
  if (/credit|spread|bond|issuance|debt/.test(haystack)) tags.push('credit');
  if (/equity|stock|futures|s&p|nasdaq|dow/.test(haystack)) tags.push('equities');
  if (/oil|energy|tariff|iran|china|geopolit/.test(haystack)) tags.push('macro');
  if (/bank|deposit|loan|liquid/.test(haystack)) tags.push('banks');
  return tags.length ? tags.slice(0, 4) : ['market color'];
}

function makeMarketColorItem(text, source) {
  const summary = emailSummary(text, source.filename);
  const preview = summary.body
    .split('\n')
    .filter(line => !/^CAUTION:/i.test(line))
    .slice(0, 8)
    .join(' ')
    .slice(0, 700);
  return {
    id: crypto.createHash('sha1').update(`${source.id}-${summary.subject}`).digest('hex').slice(0, 16),
    subject: summary.subject || source.filename,
    from: summary.from || '',
    emailDate: summary.date || '',
    preview,
    tags: inferTags(`${summary.subject} ${preview}`),
    sourceFile: { id: source.id, filename: source.filename, extension: source.extension },
    createdAt: source.uploadedAt
  };
}

function saveMarketColorUpload(baseDir, uploadFiles) {
  ensureDir(baseDir);
  ensureDir(filesDir(baseDir));

  const inbox = loadMarketColorInbox(baseDir);
  const uploadedAt = new Date().toISOString();
  const warnings = [];
  const newSources = [];
  const newItems = [];

  for (const file of uploadFiles || []) {
    if (!/\.eml$/i.test(file.filename || '')) continue;
    const id = crypto.randomUUID();
    const safeName = sanitizeFilename(file.filename);
    const storedFilename = `${id}-${safeName}`;
    fs.writeFileSync(path.join(filesDir(baseDir), storedFilename), file.data);
    const source = { id, filename: safeName, storedFilename, extension: 'eml', size: file.data.length, uploadedAt };
    newSources.push(source);
    try {
      newItems.push(makeMarketColorItem(file.data.toString('utf8'), source));
    } catch (err) {
      warnings.push(`${safeName}: ${err.message}`);
    }
  }

  const next = {
    updatedAt: uploadedAt,
    sources: [...newSources, ...inbox.sources],
    items: [...newItems, ...inbox.items],
    warnings: [...warnings, ...inbox.warnings].slice(0, 100)
  };
  writeInbox(baseDir, next);
  return { ...next, uploadedSources: newSources, uploadedItems: newItems, uploadWarnings: warnings };
}

module.exports = {
  getMarketColorSourceFile,
  loadMarketColorInbox,
  saveMarketColorUpload
};
