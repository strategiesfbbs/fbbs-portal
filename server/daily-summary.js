/**
 * daily-summary.js — a desk-voice narrative of today's package, written by Claude.
 *
 * The daily package is already parsed into structured JSON (Economic Update +
 * the per-slot offering counts in _meta.json). This module distills that into a
 * compact, grounded prompt and asks Claude for a short salesperson-facing read:
 * market tone, rates/curve, credit & equities, what's on offer, and the calls to
 * make. It is STRICTLY grounded — the prompt forbids inventing numbers.
 *
 * Cost control: the summary only changes when the package changes, so the result
 * is cached on disk keyed by the package date (data/market/daily-summary.json).
 * Generation never happens on a plain read — getCachedSummary() reads the cache;
 * generateSummary() makes the (billable) API call and rewrites it. The model
 * call goes through claude-client.js (createMessage), injectable for tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const claudeClient = require('./claude-client');

const CACHE_FILENAME = 'daily-summary.json';
const SUMMARY_MAX_TOKENS = 1200;

const SYSTEM_PROMPT =
  'You are a fixed-income desk analyst at First Bankers\' Banc Securities, Inc. (FBBS), ' +
  'writing a short daily market read for the firm\'s institutional bank-portfolio salespeople. ' +
  'Be concise, concrete, and factual. Use ONLY the numbers and facts in the data provided — ' +
  'never invent or estimate figures, and omit anything the data does not support. ' +
  'Write in plain professional prose with short Markdown section headers. For Institutional Use Only.';

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Reduce the loaded Economic Update JSON + package meta into the compact,
 * already-grounded structure the prompt is built from. Pure.
 */
function buildSummaryInput(econ, meta) {
  const e = econ || {};
  const m = meta || {};
  const pick = (arr, fields) =>
    (Array.isArray(arr) ? arr : []).map(row => {
      const out = {};
      for (const f of fields) if (row && row[f] != null) out[f] = row[f];
      return out;
    });

  return {
    packageDate: m.date || e.asOfDate || null,
    treasuries: pick(e.treasuries, ['label', 'tenor', 'yield', 'dailyChange', 'weeklyChange']),
    marketRates: pick(e.marketRates, ['label', 'value', 'priorClose', 'change']),
    marketData: pick(e.marketData, ['label', 'value', 'priorClose', 'change']),
    bondIndices: pick(e.bondIndices, ['label', 'value', 'priorClose', 'change']),
    headlines: (Array.isArray(e.headlines) ? e.headlines : []).slice(0, 6),
    releases: pick(e.releases, ['event', 'dateTime']),
    salesCues: pick(e.salesCues, ['title', 'body']),
    offerings: {
      total: num(m.offeringsCount),
      muni: num(m.muniOfferingsCount),
      treasuryNotes: num(m.treasuryNotesCount),
      agencies: num(m.agencyCount),
      corporates: num(m.corporatesCount),
    },
    brokeredCdTerms: pick(m.brokeredCdTerms, ['label', 'mid']),
  };
}

/** The system + user messages for one summary request. Pure. */
function buildSummaryPrompt(input) {
  const userText =
    'Write the daily market read for ' + (input.packageDate || 'today') + ".\n\n" +
    'Cover, each as a short Markdown section (`## Heading`):\n' +
    '1. Market tone — the one-paragraph read of the day from the headlines and moves.\n' +
    '2. Rates & curve — key Treasury yields and the 2s/10s shape, with notable daily/weekly moves.\n' +
    '3. Credit & equities — credit spreads, major indices, and risk indicators.\n' +
    '4. On offer today — what the desk is showing (offering counts by sector and brokered-CD levels).\n' +
    '5. Calls to make — 2-4 concrete prospecting angles for reps, grounded in the above.\n\n' +
    'Keep the whole thing under ~350 words. Do not add a preamble or sign-off.\n\n' +
    'DATA (JSON):\n' + JSON.stringify(input);
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  };
}

function cachePath(marketDir) {
  return path.join(marketDir, CACHE_FILENAME);
}

/** Read the cached summary, or null if absent/unreadable. */
function getCachedSummary(marketDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(marketDir), 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.summary) return parsed;
  } catch (_) { /* absent or unreadable */ }
  return null;
}

function writeCache(marketDir, record) {
  fs.mkdirSync(marketDir, { recursive: true });
  const tmp = path.join(marketDir, `${CACHE_FILENAME}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, cachePath(marketDir));
}

/**
 * Generate (and cache) the summary for the current package. Billable — only
 * call on an explicit refresh. Returns the cached record unchanged when it
 * already matches the package date and `force` is not set. Throws when no key
 * is configured or the API call fails (the route turns that into a status).
 *
 * opts: { marketDir (required), econ, meta, force?, apiKey?, model?,
 *         createMessageImpl?, now?, log? }
 */
async function generateSummary(opts) {
  const o = opts || {};
  if (!o.marketDir) throw new Error('generateSummary requires opts.marketDir');
  const createMessage = o.createMessageImpl || claudeClient.createMessage;
  const log = o.log || (() => {});

  const input = buildSummaryInput(o.econ, o.meta);
  const packageDate = input.packageDate;

  if (!o.force) {
    const cached = getCachedSummary(o.marketDir);
    if (cached && cached.packageDate && cached.packageDate === packageDate) {
      return { ...cached, cached: true };
    }
  }

  const { system, messages } = buildSummaryPrompt(input);
  const result = await createMessage({
    apiKey: o.apiKey,
    model: o.model,
    system,
    messages,
    maxTokens: SUMMARY_MAX_TOKENS,
    effort: 'medium',
    log,
  });

  const record = {
    packageDate,
    summary: result.text,
    model: result.model,
    generatedAt: new Date(o.now != null ? o.now : Date.now()).toISOString(),
    usage: result.usage || null,
  };
  let cacheError = null;
  try {
    writeCache(o.marketDir, record);
  } catch (err) {
    cacheError = err && err.message ? err.message : String(err);
    log('warn', `Daily summary generated but cache write failed: ${cacheError}`);
  }
  log('info', `Daily summary generated for package ${packageDate || '(unknown)'} via ${record.model}`);
  return { ...record, cached: false, ...(cacheError ? { cacheError } : {}) };
}

module.exports = {
  buildSummaryInput,
  buildSummaryPrompt,
  getCachedSummary,
  generateSummary,
  CACHE_FILENAME,
  SYSTEM_PROMPT,
};
