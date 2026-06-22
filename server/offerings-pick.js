/**
 * offerings-pick.js — "Pick of the day": a Claude-curated shortlist of the most
 * compelling securities in today's cross-asset inventory, for the desk's reps.
 *
 * Discipline (same as daily-summary.js): the NUMBERS come from the portal's own
 * normalized All Offerings rows — Claude never computes a yield, price, or
 * spread. It only RANKS a server-built candidate set and writes a one-line
 * "why" for each pick. Every CUSIP it returns is validated back against the
 * candidate set; anything it didn't actually see is dropped, and the displayed
 * yield/coupon/maturity/price are re-attached from OUR row, not the model's.
 *
 * Cost control mirrors the desk read: the picks only change when the package
 * changes, so the result is cached on disk keyed by the package date
 * (data/market/daily-picks.json). getCachedPicks() is a plain read; only
 * generatePicks() makes the billable API call. Model call goes through
 * claude-client.js (createMessage), injectable for tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const claudeClient = require('./claude-client');

const CACHE_FILENAME = 'daily-picks.json';
const PICKS_MAX_TOKENS = 1400;
const PER_CLASS_CANDIDATES = 12;   // top-N by yield per asset class fed to Claude
const MAX_CANDIDATES = 90;         // hard cap on the prompt's candidate list
const MIN_PICKS = 5;
const MAX_PICKS = 8;

const SYSTEM_PROMPT =
  'You are a fixed-income desk analyst at First Bankers\' Banc Securities, Inc. (FBBS), ' +
  'helping the firm\'s institutional bank-portfolio salespeople shop today\'s inventory. ' +
  'You are given a JSON list of securities the desk is offering, each with a CUSIP and ' +
  'the desk\'s own yield/coupon/price/maturity. Pick the most compelling relative-value ' +
  'ideas across asset classes. Use ONLY the CUSIPs and numbers provided — never invent a ' +
  'CUSIP, a figure, or a security that is not in the list. For Institutional Use Only.';

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function rowYield(row) {
  const ytm = num(row && row.ytm);
  const ytnc = num(row && row.ytnc);
  if (ytm != null && ytnc != null) return Math.min(ytm, ytnc);
  if (ytm != null) return ytm;
  if (ytnc != null) return ytnc;
  return num(row && row.yield);
}

function cusipKey(v) {
  return String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

/**
 * Reduce the full All Offerings row list to a compact, grounded candidate set:
 * only rows with a CUSIP and a usable yield, bucketed by asset class, top-N by
 * yield per class, capped overall. Returns { candidates, byCusip } where
 * byCusip maps the normalized CUSIP back to the full original row. Pure.
 */
function buildCandidateSet(rows) {
  const byClass = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const cusip = cusipKey(row && row.cusip);
    const yld = rowYield(row);
    if (cusip.length < 6 || yld == null) continue;
    const cls = (row.assetClass || 'Other').trim() || 'Other';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(row);
  }

  const candidates = [];
  const byCusip = new Map();
  for (const [, list] of byClass) {
    list.sort((a, b) => (rowYield(b) || 0) - (rowYield(a) || 0));
    for (const row of list.slice(0, PER_CLASS_CANDIDATES)) {
      const cusip = cusipKey(row.cusip);
      if (byCusip.has(cusip)) continue;
      byCusip.set(cusip, row);
      candidates.push({
        cusip,
        assetClass: row.assetClass || 'Other',
        sector: row.sector || '',
        state: row.state || '',
        description: String(row.description || '').slice(0, 120),
        coupon: num(row.coupon),
        yield: rowYield(row),
        price: num(row.price),
        maturity: row.maturity || null,
      });
    }
  }
  // Keep the prompt bounded; highest-yielding across all classes win the cap.
  candidates.sort((a, b) => (b.yield || 0) - (a.yield || 0));
  const capped = candidates.slice(0, MAX_CANDIDATES);
  return { candidates: capped, byCusip };
}

/** The system + user messages for one picks request. Pure. */
function buildPicksPrompt(candidates, meta) {
  const m = meta || {};
  const userText =
    'Choose the ' + MIN_PICKS + ' to ' + MAX_PICKS + ' most compelling securities for ' +
    (m.date || 'today') + ' from the candidate list below. Spread the picks across asset ' +
    'classes when the relative value supports it; do not pick more than three from any one ' +
    'class. For each pick, write a single-sentence rationale grounded in its yield, coupon, ' +
    'maturity, sector, or state versus the rest of the list — no invented numbers.\n\n' +
    'Respond with STRICT JSON only (no prose, no code fence), shape:\n' +
    '{"picks":[{"cusip":"<one CUSIP from the list>","headline":"<=8 words","rationale":"<one sentence>"}]}\n\n' +
    'CANDIDATES (JSON):\n' + JSON.stringify(candidates);
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  };
}

/** Parse the model's JSON reply (tolerant of a stray code fence). Returns []. */
function parsePicks(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const brace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (brace > 0 || lastBrace < s.length - 1) {
    if (brace >= 0 && lastBrace > brace) s = s.slice(brace, lastBrace + 1);
  }
  try {
    const obj = JSON.parse(s);
    const picks = obj && Array.isArray(obj.picks) ? obj.picks : (Array.isArray(obj) ? obj : []);
    return picks.filter(p => p && p.cusip);
  } catch (_) {
    return [];
  }
}

/**
 * Validate Claude's picks against the candidate set and re-attach OUR numbers.
 * Drops any CUSIP the model didn't actually see. Pure.
 */
function groundPicks(rawPicks, byCusip) {
  const out = [];
  const seen = new Set();
  for (const p of rawPicks) {
    const cusip = cusipKey(p.cusip);
    const row = byCusip.get(cusip);
    if (!row || seen.has(cusip)) continue;
    seen.add(cusip);
    out.push({
      cusip,
      assetClass: row.assetClass || 'Other',
      type: row.type || '',
      page: row.page || 'all-offerings',
      description: row.description || '',
      sector: row.sector || '',
      state: row.state || '',
      coupon: num(row.coupon),
      yield: rowYield(row),
      price: num(row.price),
      maturity: row.maturity || null,
      headline: String(p.headline || '').slice(0, 80),
      rationale: String(p.rationale || '').slice(0, 400),
    });
    if (out.length >= MAX_PICKS) break;
  }
  return out;
}

function cachePath(marketDir) {
  return path.join(marketDir, CACHE_FILENAME);
}

/** Read the cached picks record, or null if absent/unreadable. */
function getCachedPicks(marketDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(marketDir), 'utf-8'));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.picks)) return parsed;
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
 * Generate (and cache) the pick of the day for the current package. Billable —
 * only call on an explicit refresh. Returns the cached record unchanged when it
 * already matches the package date and `force` is not set. Throws when no key is
 * configured, the API call fails, or the model returns no usable pick.
 *
 * opts: { marketDir (required), rows, meta, force?, apiKey?, model?,
 *         createMessageImpl?, now?, log? }
 */
async function generatePicks(opts) {
  const o = opts || {};
  if (!o.marketDir) throw new Error('generatePicks requires opts.marketDir');
  const createMessage = o.createMessageImpl || claudeClient.createMessage;
  const log = o.log || (() => {});
  const meta = o.meta || {};
  const packageDate = meta.date || null;

  if (!o.force) {
    const cached = getCachedPicks(o.marketDir);
    if (cached && cached.packageDate && cached.packageDate === packageDate) {
      return { ...cached, cached: true };
    }
  }

  const { candidates, byCusip } = buildCandidateSet(o.rows);
  if (!candidates.length) {
    throw new Error('No offerings with a usable yield to pick from');
  }

  const { system, messages } = buildPicksPrompt(candidates, meta);
  const result = await createMessage({
    apiKey: o.apiKey,
    model: o.model,
    system,
    messages,
    maxTokens: PICKS_MAX_TOKENS,
    effort: 'medium',
    log,
  });

  const picks = groundPicks(parsePicks(result.text), byCusip);
  if (!picks.length) {
    throw new Error('The model returned no pick that matched today\'s inventory');
  }

  const record = {
    packageDate,
    picks,
    candidateCount: candidates.length,
    model: result.model,
    generatedAt: new Date(o.now != null ? o.now : Date.now()).toISOString(),
    usage: result.usage || null,
  };
  let cacheError = null;
  try {
    writeCache(o.marketDir, record);
  } catch (err) {
    cacheError = err && err.message ? err.message : String(err);
    log('warn', `Daily picks generated but cache write failed: ${cacheError}`);
  }
  log('info', `Daily picks generated for package ${packageDate || '(unknown)'} (${picks.length} picks) via ${record.model}`);
  return { ...record, cached: false, ...(cacheError ? { cacheError } : {}) };
}

module.exports = {
  rowYield,
  buildCandidateSet,
  buildPicksPrompt,
  parsePicks,
  groundPicks,
  getCachedPicks,
  generatePicks,
  CACHE_FILENAME,
  SYSTEM_PROMPT,
  MIN_PICKS,
  MAX_PICKS,
};
