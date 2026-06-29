/**
 * market-snapshot-title.js — Claude-generated Home market snapshot headline.
 *
 * The numeric Home snapshot stays deterministic. This tiny AI layer only writes
 * the short title beside/under the primary number, cached by package date so
 * the page read path is free and stable.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const claudeClient = require('./claude-client');

const CACHE_FILENAME = 'market-snapshot-title.json';
const TITLE_MAX_TOKENS = 180;
const MAX_TITLE_CHARS = 72;

const SYSTEM_PROMPT =
  'You are a fixed-income desk editor at First Bankers\' Banc Securities, Inc. (FBBS). ' +
  'Write one concise headline for the Home page Market Snapshot. Ground it only in the supplied data. ' +
  'Prefer the clearest daily driver: rate move, curve shape, Fed/funding tone, volatility, credit, equities, or supply. ' +
  'Do not invent facts or numbers. Do not use hype, jokes, emojis, Markdown, or the phrase "sets the tone". ' +
  'For Institutional Use Only.';

const TITLE_TOOL = {
  name: 'emit_market_snapshot_title',
  description: 'Return the one short Home market snapshot title.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'A polished 3-7 word title, under 72 characters, grounded in the supplied market data.'
      },
      reason: {
        type: 'string',
        description: 'Brief internal reason for which market driver was selected.'
      }
    },
    required: ['title']
  }
};

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pickRows(rows, fields, limit) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit || rows.length).map(row => {
    const out = {};
    for (const f of fields) if (row && row[f] != null) out[f] = row[f];
    return out;
  });
}

function compactMetric(metric) {
  if (!metric || metric.value == null) return null;
  const out = {
    label: metric.label,
    value: metric.value,
    unit: metric.unit || '',
    source: metric.source || null
  };
  if (metric.live && metric.live.value != null) {
    out.liveValue = metric.live.value;
    if (metric.live.deltaBp != null) out.liveDeltaBp = metric.live.deltaBp;
  }
  return out;
}

function buildTitleInput(econ, meta, snapshot) {
  const e = econ || {};
  const m = meta || {};
  const s = snapshot || {};
  const metrics = s.metrics || {};
  const metricOrder = ['two_year', 'five_year', 'ten_year', 'thirty_year', 'twos_tens', 'sofr', 'prime', 'fed_funds', 'spx', 'vix', 'crude'];
  return {
    packageDate: m.date || e.asOfDate || (s.asOf && s.asOf.desk) || null,
    asOf: s.asOf || { desk: e.asOfDate || null, live: null },
    snapshotMetrics: metricOrder.map(key => compactMetric(metrics[key])).filter(Boolean),
    treasuryChanges: pickRows(e.treasuries, ['label', 'tenor', 'yield', 'dailyChange', 'weeklyChange'], 8),
    fundingRates: pickRows(e.marketRates, ['label', 'value', 'priorClose', 'change'], 8),
    marketMoves: pickRows(e.marketData, ['label', 'value', 'priorClose', 'change'], 10),
    creditMoves: pickRows(e.bondIndices, ['label', 'value', 'priorClose', 'change'], 10),
    headlines: (Array.isArray(e.headlines) ? e.headlines : []).slice(0, 6),
    releases: pickRows(e.releases, ['event', 'dateTime'], 6),
    salesCues: pickRows(e.salesCues, ['title', 'body'], 4),
    offerings: {
      total: num(m.offeringsCount),
      muni: num(m.muniOfferingsCount),
      treasuryNotes: num(m.treasuryNotesCount),
      agencies: num(m.agencyCount),
      corporates: num(m.corporatesCount),
    }
  };
}

function buildTitlePrompt(input) {
  const userText =
    'Generate one Home page Market Snapshot title for ' + (input.packageDate || 'today') + '.\n\n' +
    'Rules:\n' +
    '- 3 to 7 words.\n' +
    '- Under 72 characters.\n' +
    '- Mention the market driver, not a generic label.\n' +
    '- Do not include a period.\n' +
    '- Do not repeat "10Y Treasury sets the tone".\n\n' +
    'DATA (JSON):\n' + JSON.stringify(input);
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }]
  };
}

function cachePath(marketDir) {
  return path.join(marketDir, CACHE_FILENAME);
}

function getCachedTitle(marketDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(marketDir), 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.title) return parsed;
  } catch (_) { /* absent or unreadable */ }
  return null;
}

function writeCache(marketDir, record) {
  fs.mkdirSync(marketDir, { recursive: true });
  const tmp = path.join(marketDir, `${CACHE_FILENAME}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, cachePath(marketDir));
}

function sanitizeTitle(title) {
  let out = String(title || '').replace(/\s+/g, ' ').trim();
  out = out.replace(/^["'`]+|["'`]+$/g, '').trim();
  out = out.replace(/^[#*_>\-\s]+|[#*_\s]+$/g, '').trim();
  out = out.replace(/[.!?]+$/g, '').replace(/[#*_\s]+$/g, '').trim();
  if (!out || /sets the tone/i.test(out)) return '';
  if (out.length > MAX_TITLE_CHARS) {
    const words = out.split(' ');
    let clipped = '';
    for (const word of words) {
      const next = clipped ? `${clipped} ${word}` : word;
      if (next.length > MAX_TITLE_CHARS) break;
      clipped = next;
    }
    out = clipped || out.slice(0, MAX_TITLE_CHARS).trim();
  }
  return out;
}

function treasuryChange(input, tenor) {
  const row = (input.treasuryChanges || []).find(r => r && r.tenor === tenor);
  return row ? num(row.dailyChange) : null;
}

function marketMove(input, labels) {
  const wants = labels.map(label => label.toLowerCase());
  return (input.marketMoves || []).find(r => r && wants.includes(String(r.label || '').toLowerCase())) || null;
}

function fallbackTitle(input) {
  const titleInput = input || {};
  const t2 = treasuryChange(titleInput, '2YR');
  const t10 = treasuryChange(titleInput, '10YR');
  const vix = marketMove(titleInput, ['VIX']);
  const spx = marketMove(titleInput, ['SPX', 'S&P 500']);
  const tenMoveBp = t10 != null ? Math.round(t10 * 100) : null;
  const twoMoveBp = t2 != null ? Math.round(t2 * 100) : null;
  if (tenMoveBp != null && Math.abs(tenMoveBp) >= 3) {
    return tenMoveBp > 0 ? 'Long Rates Lead Higher' : 'Long Rates Ease Lower';
  }
  if (twoMoveBp != null && Math.abs(twoMoveBp) >= 3) {
    return twoMoveBp > 0 ? 'Front End Firms Up' : 'Front End Leads Lower';
  }
  if (vix && num(vix.change) != null && Math.abs(num(vix.change)) >= 1) {
    return num(vix.change) > 0 ? 'Volatility Moves Back Up' : 'Volatility Cools Off';
  }
  if (spx && num(spx.change) != null && Math.abs(num(spx.change)) >= 25) {
    return num(spx.change) > 0 ? 'Risk Tone Improves' : 'Risk Tone Softens';
  }
  return 'Daily Market Snapshot';
}

function inputHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input || {})).digest('hex').slice(0, 16);
}

async function generateTitle(opts) {
  const o = opts || {};
  if (!o.marketDir) throw new Error('generateTitle requires opts.marketDir');
  const createMessage = o.createMessageImpl || claudeClient.createMessage;
  const log = o.log || (() => {});
  const input = buildTitleInput(o.econ, o.meta, o.snapshot);
  const packageDate = input.packageDate;

  if (!o.force) {
    const cached = getCachedTitle(o.marketDir);
    if (cached && cached.packageDate && cached.packageDate === packageDate) {
      return { ...cached, cached: true };
    }
  }

  const { system, messages } = buildTitlePrompt(input);
  const result = await createMessage({
    apiKey: o.apiKey,
    model: o.model,
    system,
    messages,
    maxTokens: TITLE_MAX_TOKENS,
    effort: 'low',
    tools: [TITLE_TOOL],
    toolChoice: { type: 'tool', name: TITLE_TOOL.name },
    log,
  });
  const toolInput = result.toolInput || {};
  const modelTitle = sanitizeTitle(toolInput.title || result.text);
  const title = modelTitle || fallbackTitle(input);
  const record = {
    packageDate,
    title,
    reason: toolInput.reason ? String(toolInput.reason).slice(0, 240) : null,
    inputHash: inputHash(input),
    model: result.model,
    generatedAt: new Date(o.now != null ? o.now : Date.now()).toISOString(),
    usage: result.usage || null,
  };
  let cacheError = null;
  try {
    writeCache(o.marketDir, record);
  } catch (err) {
    cacheError = err && err.message ? err.message : String(err);
    log('warn', `Market snapshot title generated but cache write failed: ${cacheError}`);
  }
  log('info', `Market snapshot title generated for package ${packageDate || '(unknown)'} via ${record.model}`);
  return { ...record, cached: false, ...(cacheError ? { cacheError } : {}) };
}

module.exports = {
  buildTitleInput,
  buildTitlePrompt,
  fallbackTitle,
  generateTitle,
  getCachedTitle,
  sanitizeTitle,
  CACHE_FILENAME,
  SYSTEM_PROMPT,
};
