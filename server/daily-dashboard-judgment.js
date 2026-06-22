/**
 * daily-dashboard-judgment.js — Phase 2 of the native Sales Dashboard.
 *
 * The GROUNDED Claude judgment layer. Phase 1 (daily-dashboard.js) builds an
 * audience-segmented, availability-screened candidate set with the tax math
 * worked out. This module makes ONE billable Claude call that RANKS within that
 * set and writes prose — audience-balanced picks, a macro→pick connector
 * sentence per audience, a Bond-of-the-Day, and a Strategy-of-the-Day — then
 * GROUNDS every word of the reply back against the candidate set.
 *
 * Discipline (the whole point): the model produces JUDGMENT, never arithmetic.
 * It emits only CUSIP keys + prose; every number/economic field on the page is
 * re-attached server-side from OUR Phase-1 candidate. There is no code path that
 * copies a numeric field out of the model reply, so a wrong number is
 * structurally unreachable. Two walls drop any CUSIP the model shouldn't have
 * used: (1) not in the candidate set → hallucination; (2) not eligible for that
 * audience → the desk's tax-structure tagging, enforced server-side.
 *
 * Unbreakable by design: a model/API/no-key failure, a malformed reply, or thin
 * coverage never throws. groundDashboard(raw={}, …) deterministically backfills
 * every element (picks from the effYield-ranked pool, a credit/structure BOTD
 * that is never the biggest agency block, a dominant-theme SoD, a macro-derived
 * connector), so the page is always complete — just flagged `degraded`.
 *
 * Cost control mirrors offerings-pick.js / daily-summary.js: cached on disk by
 * package date (data/market/daily-dashboard.json); only generateDashboard()
 * makes the billable call. The model call goes through claude-client.js
 * (createMessage), injectable for tests.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const claudeClient = require('./claude-client');
const dailyDashboard = require('./daily-dashboard');   // Phase 1 candidate/tax layer
const dailySummary = require('./daily-summary');        // buildSummaryInput → macro context

const AUDIENCE_KEYS = dailyDashboard.AUDIENCE_KEYS;

const CACHE_FILENAME = 'daily-dashboard.json';
// The full audience-balanced reply (3 audiences × up to 5 picks + connectors +
// BOTD + SoD) runs ~1700 output tokens compact, but the model sometimes
// pretty-prints — give comfortable headroom so the JSON always completes.
const DASHBOARD_MAX_TOKENS = 4096;

const MIN_PER_AUDIENCE = 3;
const MAX_PICKS_PER_AUDIENCE = 5;
const MAX_PER_CLASS = 3;        // per audience
const SOD_MIN = 2;
const SOD_MAX_CUSIPS = 4;

const LEN = { headline: 80, rationale: 160, botdRationale: 400, sodTitle: 80, sodNarrative: 500, connector: 240 };

const SYSTEM_PROMPT =
  'You are a fixed-income desk analyst at First Bankers\' Banc Securities, Inc. ' +
  '(FBBS), building the morning Sales Dashboard for the firm\'s institutional ' +
  'bank-portfolio salespeople. The desk sells to three client tax structures, each ' +
  'called an "audience": ccorp (C-Corp bank, taxed ~21%), scorp (S-Corp bank, taxed ' +
  '~29.6%), and ria (RIA / money manager, taxable / pure relative-value — no muni ' +
  'gross-up, no bank-qualified mechanics).\n\n' +
  'You are given (1) a grounded MACRO context for today (Treasury curve, money-market ' +
  'rates, indices, headlines, economic releases, sales cues) and (2) a grounded ' +
  'CANDIDATE SET of securities the desk is offering. Every candidate carries a CUSIP ' +
  'and the desk\'s OWN worked numbers, including each audience\'s effective yield ' +
  '(eff: the taxable-equivalent yield a bank buyer grosses an exempt muni up to, ' +
  'otherwise the yield-to-worst).\n\n' +
  'YOUR JOB IS JUDGMENT, NOT ARITHMETIC. You RANK within the candidate set, choose ' +
  'which securities best fit each audience today, write a short prose rationale per ' +
  'pick, write one macro-to-pick connector sentence per audience, and choose a ' +
  'Bond-of-the-Day and a Strategy-of-the-Day. You NEVER compute, estimate, round, or ' +
  'restate a yield, price, coupon, maturity, spread, or size — those are shown to the ' +
  'user from the desk\'s data, not from your text. You NEVER name a CUSIP that is not ' +
  'in the candidate set, and you NEVER invent a security. The firm re-attaches its own ' +
  'numbers to whatever you select.\n\n' +
  'Binding desk rules:\n' +
  '- Audience balance: choose AT LEAST 3 and at most 5 picks for EACH of ccorp, scorp, ' +
  'and ria. Use a candidate for an audience ONLY if that audience key appears in that ' +
  'candidate\'s "aud" list.\n' +
  '- Diversify: no more than 3 picks from any one assetClass within a single audience.\n' +
  '- Rank each audience\'s picks by that audience\'s own effective yield and relative-' +
  'value merit, best first.\n' +
  '- Connector sentence format, EXACTLY: "<driver context> -> <why these picks fit ' +
  'this client today>" — one sentence, one " -> " arrow, tying today\'s macro story to ' +
  'that audience\'s picks.\n' +
  '- Bond of the Day (botd): pick on credit, structure, or spread MERIT — quality over ' +
  'liquidity. Do NOT anchor it on the single largest agency block just because it is ' +
  'liquid. It must be one CUSIP from the candidate set.\n' +
  '- Strategy of the Day (sod): one strategy THEME for today (e.g. "deep-discount ' +
  'agencies as effective bullets"), a short title plus a two-sentence narrative, with ' +
  '2 to 4 CUSIPs from the candidate set that express that theme.\n' +
  '- The effective yields shown are taxable-equivalent figures that EXCLUDE the TEFRA ' +
  'interest-expense haircut and the 20% C-corp bank-qualified disallowance (both are ' +
  'disclaimed separately on the page). Do not net, adjust, or mention netting them.\n' +
  '- Use the words "deep discount" only for a candidate whose dollar price is at or ' +
  'below 99.00.\n\n' +
  'For Institutional Use Only. Respond with STRICT JSON only — no prose outside the ' +
  'JSON, no code fence.';

// The compact output contract embedded in the user message. The model returns
// ONLY CUSIP keys + prose — never a number; grounding re-attaches OUR figures.
const OUTPUT_SHAPE_HINT = JSON.stringify({
  picks: {
    ccorp: [{ cusip: '<from securities>', headline: '<=8 words', rationale: '<one sentence <=160 chars>' }],
    scorp: [{ cusip: '...', headline: '...', rationale: '...' }],
    ria: [{ cusip: '...', headline: '...', rationale: '...' }],
  },
  connector: { ccorp: '<driver> -> <why these fit this client today>', scorp: '...', ria: '...' },
  botd: { cusip: '...', headline: '<=10 words', rationale: '<two sentences>' },
  sod: { title: '...', narrative: '<two sentences>', cusips: ['...', '...'] },
});

// ---------- small pure utilities ----------

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }
function cusipKey(v) { return String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase(); }
function clamp(v, n) { return String(v == null ? '' : v).slice(0, n); }
function fixed2(n) { return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : null; }

/** Best effective yield across audiences for a candidate (BOTD/SoD ranking). */
function bestEff(c) {
  let best = 0;
  for (const k of AUDIENCE_KEYS) {
    const e = c.econ && c.econ[k];
    if (e && e.effYield != null && e.effYield > best) best = e.effYield;
  }
  return best;
}

// ---------- prompt construction (pure) ----------

/** Project a flat Phase-1 candidate to the minimum the model needs to rank. */
function compactCandidate(c) {
  const eff = {};
  for (const k of AUDIENCE_KEYS) {
    const e = c.econ && c.econ[k];
    if (e && e.effYield != null) eff[k] = { y: round2(e.effYield), b: e.basis };
  }
  return {
    cusip: c.cusip,
    cls: c.assetClass,
    sector: c.sector || undefined,
    state: c.state || undefined,
    desc: String(c.description || '').slice(0, 90) || undefined,
    coupon: c.coupon,
    ytw: c.ytw,
    price: c.price,                                  // always sent — deep-discount rule keys off it
    maturity: c.maturity || undefined,
    call: c.callDate || undefined,
    availK: c.availabilityK,                         // BOTD quality>liquidity visibility
    bq: c.bq || undefined,
    exemptMuni: c.exemptMuni || undefined,
    aud: c.audiences,                                // the eligibility GATE
    eff,                                             // { ccorp:{y,b}, ... }
    deep: (c.price != null && c.price <= 99.0) || undefined,
  };
}

/** Trim the daily-summary macro context to prose-only drivers. Pure. */
function compactMacro(mi) {
  const m = mi || {};
  const take = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
  return {
    date: m.packageDate,
    treasuries: take(m.treasuries, 8),
    marketRates: take(m.marketRates, 6),
    bondIndices: take(m.bondIndices, 4),
    headlines: take(m.headlines, 5),
    releases: take(m.releases, 4),
    salesCues: take(m.salesCues, 3),
    offerings: m.offerings,
  };
}

/**
 * Build the system + user messages for one dashboard request. Pure — mirrors
 * buildPicksPrompt / buildSummaryPrompt. `securities` is a CUSIP-keyed OBJECT so
 * the model's universe is a finite key set and grounding is Map.has(cusip).
 */
function buildDashboardPrompt(candidateSet, macroInput, meta) {
  const m = meta || {};
  const securities = {};
  for (const c of candidateSet.candidates) securities[c.cusip] = compactCandidate(c);
  const byAudienceCusips = {};
  for (const k of AUDIENCE_KEYS) byAudienceCusips[k] = (candidateSet.byAudience[k] || []).map(c => c.cusip);

  const userText =
    'Build the FBBS Sales Dashboard for ' + (m.date || (macroInput && macroInput.packageDate) || 'today') + '.\n\n' +
    'You are given MACRO (today\'s grounded market context — use it ONLY to write prose; it ' +
    'contains no securities to pick), byAudience (per-audience eligible CUSIPs, already desk-' +
    'ranked by that audience\'s effective yield), and securities (a CUSIP-keyed dictionary of ' +
    'the candidate details — the ONLY securities and numbers you may use).\n\n' +
    'Do ALL of the following, using ONLY CUSIPs that appear in securities:\n' +
    '1. picks — for EACH audience (ccorp, scorp, ria): choose 3 to 5 CUSIPs, best first by ' +
    'that audience\'s effective yield and relative-value merit. A CUSIP is eligible for an ' +
    'audience ONLY if that audience key is in the candidate\'s "aud" list; the byAudience list ' +
    'is the desk\'s top-ranked eligible CUSIPs to start from, but any "aud"-eligible candidate ' +
    'is allowed. No more than 3 picks of one assetClass within an audience. For ' +
    'each pick give a <=8-word headline and a one-sentence (<=160 char) rationale grounded in ' +
    'its eff yield / coupon / structure / sector / state versus the rest of the list. Do not ' +
    'state a number the data does not show; do not say "deep discount" unless its price <= 99.00.\n' +
    '2. connector — for EACH audience: ONE sentence in EXACTLY this format: ' +
    '"<driver context from today\'s macro> -> <why these picks fit this client today>". One ' +
    'sentence, one " -> ", <=40 words.\n' +
    '3. botd — ONE CUSIP chosen on credit/structure/spread merit (quality over liquidity; do ' +
    'NOT default to the largest agency block), with a <=10-word headline and a two-sentence ' +
    'rationale.\n' +
    '4. sod — one theme (short title + two-sentence narrative) plus 2 to 4 CUSIPs that express ' +
    'it.\n\n' +
    'Every "cusip" you return MUST appear in securities. Never write a number that is not in ' +
    'the data. Respond with STRICT JSON only (no prose, no code fence), exactly this shape:\n' +
    OUTPUT_SHAPE_HINT + '\n\n' +
    'MACRO (JSON):\n' + JSON.stringify(compactMacro(macroInput)) + '\n\n' +
    'BY-AUDIENCE eligible CUSIPs (desk-ranked):\n' + JSON.stringify(byAudienceCusips) + '\n\n' +
    'SECURITIES (JSON):\n' + JSON.stringify(securities);

  return { system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userText }] };
}

// ---------- parsing (tolerant; never throws) ----------

function emptySkeleton() {
  return { picks: { ccorp: [], scorp: [], ria: [] }, connector: {}, botd: null, sod: null };
}

/**
 * Best-effort repair of a JSON object truncated by a max_tokens cutoff: close a
 * dangling string, trim a partial trailing token, and append the closers for any
 * still-open [ / { in order. Used ONLY as a fallback when strict parse fails, so
 * a truncated reply still yields whatever complete picks it managed to emit
 * (each still re-validated through the CUSIP gate downstream). Pure.
 */
function closeTruncatedJson(s) {
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s;
  if (inStr) {
    if (esc) out = out.slice(0, -1);            // drop a dangling open escape (a lone trailing '\')
    out += '"';                                 // close a string cut mid-value
  }
  out = out.replace(/[,:]\s*$/, '');            // drop a dangling comma / colon
  // Strip a dangling object KEY ("key" with no value yet) — but ONLY in object
  // context. In array context the same `,"str"` is a complete final element, so
  // stripping it would silently delete a valid value (e.g. an sod.cusips entry).
  if (stack[stack.length - 1] === '{') out = out.replace(/,\s*"[^"\\]*"\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += (stack[i] === '{' ? '}' : ']');
  return out;
}

/**
 * The substring from the first open bracket through its matching close (depth
 * back to 0), string-aware — i.e. the largest well-formed JSON value at the head
 * of the text, ignoring any trailing prose. null if it never balances. Pure.
 */
function balancedJsonPrefix(s) {
  let depth = 0, inStr = false, esc = false, started = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') { depth++; started = true; }
    else if (ch === '}' || ch === ']') { depth--; if (started && depth === 0) return s.slice(0, i + 1); }
  }
  return null;
}

/** Parse the model's JSON reply, tolerant of code fences / leading prose / trailing prose / truncation. */
function parseDashboard(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const brace = s.indexOf('{');
  if (brace < 0) return emptySkeleton();
  const fromBrace = s.slice(brace);                  // first '{' through end of reply
  const prefix = balancedJsonPrefix(fromBrace);      // the head JSON value, trailing prose ignored
  let obj;
  try {
    obj = JSON.parse(prefix != null ? prefix : fromBrace);
  } catch (_) {
    // No balanced prefix → a max_tokens cutoff left an unbalanced tail; salvage
    // it (close open strings/brackets) so whatever complete picks it emitted survive.
    try { obj = JSON.parse(closeTruncatedJson(fromBrace)); }
    catch (__) { return emptySkeleton(); }
  }
  return normalizeRaw(obj);
}

/**
 * Coerce a parsed reply object (from text parsing OR a forced-tool input) into
 * the canonical { picks:{ccorp,scorp,ria}, connector, botd, sod } skeleton.
 * Tolerates a flat picks array whose entries carry an `audience` field. Pure.
 */
function normalizeRaw(obj) {
  if (!obj || typeof obj !== 'object') return emptySkeleton();
  let picks = obj.picks;
  if (Array.isArray(picks)) {
    const bucketed = { ccorp: [], scorp: [], ria: [] };
    for (const p of picks) {
      const a = p && (p.audience || p.aud);
      const keys = Array.isArray(a) ? a : [a];
      for (const k of keys) if (bucketed[k]) bucketed[k].push(p);
    }
    picks = bucketed;
  }
  if (!picks || typeof picks !== 'object') picks = { ccorp: [], scorp: [], ria: [] };

  return {
    picks: {
      ccorp: Array.isArray(picks.ccorp) ? picks.ccorp : [],
      scorp: Array.isArray(picks.scorp) ? picks.scorp : [],
      ria: Array.isArray(picks.ria) ? picks.ria : [],
    },
    connector: obj.connector && typeof obj.connector === 'object' ? obj.connector : {},
    botd: obj.botd && typeof obj.botd === 'object' ? obj.botd : null,
    sod: obj.sod && typeof obj.sod === 'object' ? obj.sod : null,
  };
}

// Forced-tool schema for reliable structured output: the platform serializes
// the model's arguments as well-formed JSON, eliminating the hand-written-JSON
// malformation the text path has to salvage. Same contract as OUTPUT_SHAPE_HINT.
const PICK_ITEM = {
  type: 'object',
  properties: { cusip: { type: 'string' }, headline: { type: 'string' }, rationale: { type: 'string' } },
  required: ['cusip'],
};
const DASHBOARD_TOOL = {
  name: 'emit_sales_dashboard',
  description: 'Return the curated FBBS Sales Dashboard selections (picks per audience, a connector sentence per audience, a Bond-of-the-Day, and a Strategy-of-the-Day). Use ONLY CUSIPs from the provided candidate set.',
  input_schema: {
    type: 'object',
    properties: {
      picks: {
        type: 'object',
        properties: { ccorp: { type: 'array', items: PICK_ITEM }, scorp: { type: 'array', items: PICK_ITEM }, ria: { type: 'array', items: PICK_ITEM } },
        required: ['ccorp', 'scorp', 'ria'],
      },
      connector: {
        type: 'object',
        properties: { ccorp: { type: 'string' }, scorp: { type: 'string' }, ria: { type: 'string' } },
        required: ['ccorp', 'scorp', 'ria'],
      },
      botd: {
        type: 'object',
        properties: { cusip: { type: 'string' }, headline: { type: 'string' }, rationale: { type: 'string' } },
        required: ['cusip'],
      },
      sod: {
        type: 'object',
        properties: { title: { type: 'string' }, narrative: { type: 'string' }, cusips: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'cusips'],
      },
    },
    required: ['picks', 'connector', 'botd', 'sod'],
  },
};

// ---------- grounding (the trust boundary) ----------

/**
 * Re-attach OUR numbers to a candidate row, reading ONLY headline/rationale from
 * the model. `audKey` null → attach the full per-audience econ map (BOTD/SoD);
 * otherwise attach that audience's econ. deepDiscount is COMPUTED from our price.
 */
function attachRow(row, audKey, headline, rationale, source, rationaleMax) {
  return {
    cusip: row.cusip,
    assetClass: row.assetClass || 'Other',
    sector: row.sector || '',
    state: row.state || '',
    page: row.page || 'all-offerings',
    description: row.description || '',
    coupon: num(row.coupon),
    ytw: num(row.ytw),
    price: num(row.price),
    maturity: row.maturity || null,
    callDate: row.callDate || null,
    availabilityK: num(row.availabilityK),
    bq: !!row.bq,
    exemptMuni: !!row.exemptMuni,
    eff: audKey ? (row.econ && row.econ[audKey]) || null : (row.econ || null),
    deepDiscount: row.price != null && row.price <= 99.0,
    headline: clamp(headline, LEN.headline),
    rationale: clamp(rationale, rationaleMax || LEN.rationale),
    source,
  };
}

function backfillRationale(cand, audKey) {
  const e = cand.econ && cand.econ[audKey];
  const y = e && e.effYield != null ? fixed2(e.effYield) : fixed2(cand.ytw);
  const basis = (e && e.basis) || 'yield';
  return `Auto-selected: top ${basis} ${cand.assetClass || 'security'} for this audience` + (y ? ` at ${y}%.` : '.');
}

/** Single CUSIP gate for a model pick under one audience. Null = dropped. */
function groundPick(p, audKey, byCusip, eligible, flags) {
  const cusip = cusipKey(p && p.cusip);
  if (!cusip) return null;
  const row = byCusip.get(cusip);
  if (!row) { flags.add('dropped-unknown-cusip'); return null; }
  if (!eligible[audKey] || !eligible[audKey].has(cusip)) { flags.add('dropped-audience-ineligible'); return null; }
  return attachRow(row, audKey, p && p.headline, p && p.rationale, 'model');
}

/** Assemble one audience: ground model picks, dedup, ≤3/class, backfill to ≥3. */
function groundAudiencePicks(rawPicks, audKey, candidateSet, byCusip, eligible, flags) {
  const out = [];
  const seen = new Set();
  const classCount = new Map();
  const classOf = g => g.assetClass || 'Other';
  const atCap = cls => (classCount.get(cls) || 0) >= MAX_PER_CLASS;
  const bump = cls => classCount.set(cls, (classCount.get(cls) || 0) + 1);

  for (const p of (Array.isArray(rawPicks) ? rawPicks : [])) {
    if (out.length >= MAX_PICKS_PER_AUDIENCE) break;
    const g = groundPick(p, audKey, byCusip, eligible, flags);
    if (!g || seen.has(g.cusip)) continue;
    if (atCap(classOf(g))) { flags.add('dropped-class-cap'); continue; }
    seen.add(g.cusip); bump(classOf(g)); out.push(g);
  }

  if (out.length < MIN_PER_AUDIENCE) {
    const pool = candidateSet.byAudience[audKey] || [];
    // Pass 1 — backfill respecting the per-class cap.
    for (const cand of pool) {
      if (out.length >= MIN_PER_AUDIENCE) break;
      if (seen.has(cand.cusip) || atCap(cand.assetClass || 'Other')) continue;
      out.push(attachRow(cand, audKey, '', backfillRationale(cand, audKey), 'backfill'));
      seen.add(cand.cusip); bump(cand.assetClass || 'Other'); flags.add('backfilled');
    }
    // Pass 2 — floor-of-3 wins over the class cap (a present page beats a short one).
    for (const cand of pool) {
      if (out.length >= MIN_PER_AUDIENCE) break;
      if (seen.has(cand.cusip)) continue;
      out.push(attachRow(cand, audKey, '', backfillRationale(cand, audKey), 'backfill'));
      seen.add(cand.cusip); flags.add('backfilled');
    }
  }
  if (out.length < MIN_PER_AUDIENCE) flags.add('coverage-short');
  return out;
}

/** "Quality over liquidity": exclude the biggest agency block, prefer credit/structure tiers. */
function pickBotdDeterministic(candidateSet, floorK) {
  const pool = candidateSet.candidates.filter(c => c.availabilityK == null || c.availabilityK >= floorK);
  if (!pool.length) return null;
  const isAgency = c => /agency/i.test(c.assetClass || '');
  // Exclude the single most-liquid agency block (the "don't anchor BOTD on the
  // biggest agency block" rule). Unknown size counts as MOST liquid (Infinity),
  // not least — otherwise an unpublished-size block would never be excludable and
  // could win BOTD over a known smaller one purely because its size is hidden.
  let excludeCusip = null, mx = -Infinity;
  for (const c of pool) {
    if (!isAgency(c)) continue;
    const s = c.availabilityK == null ? Infinity : c.availabilityK;
    if (s > mx) { mx = s; excludeCusip = c.cusip; }
  }
  const tierOf = c => {
    const cls = (c.assetClass || '').toLowerCase();
    if (/muni/.test(cls)) return c.exemptMuni ? 0 : 1;
    if (/corp/.test(cls)) return 2;
    return 3; // agency / treasury / mbs / structured
  };
  const ranked = pool
    .filter(c => c.cusip !== excludeCusip)
    .sort((a, b) => tierOf(a) - tierOf(b) || bestEff(b) - bestEff(a) || (a.cusip < b.cusip ? -1 : 1));
  if (ranked.length) return ranked[0];
  return pool.slice().sort((a, b) => bestEff(b) - bestEff(a))[0]; // degenerate: only the excluded block
}

function groundBotd(rawBotd, candidateSet, byCusip, flags, floorK) {
  const cusip = cusipKey(rawBotd && rawBotd.cusip);
  const row = cusip ? byCusip.get(cusip) : null;
  const valid = row && (row.availabilityK == null || row.availabilityK >= floorK);
  if (valid) return attachRow(row, null, rawBotd.headline, rawBotd.rationale, 'model', LEN.botdRationale);
  flags.add('botd-backfilled');
  const cand = pickBotdDeterministic(candidateSet, floorK);
  if (!cand) return null;
  return attachRow(cand, null, '', `Auto-selected on credit and structure merit: ${cand.description || cand.assetClass}.`, 'backfill', LEN.botdRationale);
}

/** Deterministic strategy theme when the model's SoD is thin. */
function deterministicSod(candidateSet) {
  const pool = candidateSet.candidates;
  const deepAgencies = pool.filter(c => /agency/i.test(c.assetClass || '') && c.price != null && c.price <= 99.0);
  if (deepAgencies.length >= 2) {
    return {
      title: 'Deep-discount agencies as effective bullets',
      narrative: 'Sub-market-coupon agency paper priced below par behaves like an effective bullet to its call. The discount accretes to par, adding return on top of the coupon for RW20% capital.',
      rows: deepAgencies.slice().sort((a, b) => (a.price || 0) - (b.price || 0)).slice(0, SOD_MAX_CUSIPS),
    };
  }
  const byClass = new Map();
  for (const c of pool) {
    const k = c.assetClass || 'Other';
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(c);
  }
  let bestClass = null, bestScore = -1;
  for (const [k, list] of byClass) if (list.length > bestScore) { bestScore = list.length; bestClass = k; }
  const rows = (byClass.get(bestClass) || []).slice().sort((a, b) => bestEff(b) - bestEff(a)).slice(0, SOD_MAX_CUSIPS);
  return {
    title: `Top ${bestClass || 'relative'} value today`,
    narrative: `The desk's strongest ${bestClass || 'relative-value'} offerings on today's run by effective yield. A clean way to add the exposure at attractive levels.`,
    rows,
  };
}

function groundSod(rawSod, candidateSet, byCusip, flags) {
  let title = clamp(rawSod && rawSod.title, LEN.sodTitle);
  let narrative = clamp(rawSod && rawSod.narrative, LEN.sodNarrative);
  const seen = new Set();
  const rows = [];
  for (const rc of (Array.isArray(rawSod && rawSod.cusips) ? rawSod.cusips : [])) {
    if (rows.length >= SOD_MAX_CUSIPS) break;
    const cusip = cusipKey(rc);
    if (!cusip || seen.has(cusip)) continue;
    const row = byCusip.get(cusip);
    if (!row) continue;
    seen.add(cusip); rows.push(row);
  }
  let source = 'model';
  if (rows.length < SOD_MIN || !title) {
    flags.add('sod-backfilled'); source = 'backfill';
    const det = deterministicSod(candidateSet);
    if (!title) title = clamp(det.title, LEN.sodTitle);
    if (!narrative) narrative = clamp(det.narrative, LEN.sodNarrative);
    for (const row of det.rows) {
      if (rows.length >= SOD_MAX_CUSIPS) break;
      if (seen.has(row.cusip)) continue;
      seen.add(row.cusip); rows.push(row);
    }
  }
  return { title, narrative, securities: rows.map(r => attachRow(r, null, '', '', source)), source };
}

function normalizeArrows(s) {
  return String(s == null ? '' : s).replace(/\s*(?:-->|—>|–>|=>|->|→|⟶)\s*/g, ' -> ');
}

/** Short grounded driver clause from today's macro for connector synthesis. */
function macroDriver(macroInput) {
  const mi = macroInput || {};
  const t = (mi.treasuries || []).find(x => /\b10\s*(?:y|yr|-yr|year)/i.test(String((x && (x.tenor || x.label)) || '')));
  if (t && t.yield != null) {
    // dailyChange is a percentage-point delta (same scale as yield, e.g. 0.035 =
    // 3.5bp) — convert to bp for display, and round the yield to 2dp.
    const d = num(t.dailyChange);
    const bp = d != null ? Math.round(d * 100) : null;
    const dTxt = bp != null ? ` (${bp >= 0 ? '+' : ''}${bp}bp)` : '';
    const y = fixed2(t.yield);
    return `10Y at ${y != null ? y : t.yield}%${dTxt}`;
  }
  const h = (mi.headlines || [])[0];
  if (h) return clamp(typeof h === 'string' ? h : (h.title || h.text || h.headline || ''), 90);
  return "Today's market backdrop";
}

function groundConnectors(rawConn, picks, macroInput, audiences, flags) {
  const driver = macroDriver(macroInput);
  const labelByKey = {};
  for (const a of (audiences || [])) labelByKey[a.key] = a.label;
  const out = {};
  for (const k of AUDIENCE_KEYS) {
    let s = clamp(normalizeArrows(rawConn && rawConn[k]).trim(), LEN.connector);
    if (!s.includes(' -> ')) {
      flags.add('connector-synthesized');
      const top = (picks[k] || [])[0];
      const y = top && top.eff && top.eff.effYield != null ? `${fixed2(top.eff.effYield)}%` : 'attractive levels';
      const lead = top
        ? `${labelByKey[k] || k} picks lead with ${top.assetClass} near ${y} today`
        : `${labelByKey[k] || k} picks selected for today`;
      s = `${driver} -> ${lead}`;
    } else {
      // Collapse any extra arrows so the single-arrow invariant holds.
      const idx = s.indexOf(' -> ');
      const left = s.slice(0, idx).trim();
      const right = s.slice(idx + 4).split(' -> ').join(' ').trim();
      s = `${left} -> ${right}`;
    }
    out[k] = clamp(s, LEN.connector);
  }
  return out;
}

const DEGRADE_FLAG = /backfill|synthes|coverage-short/;

/**
 * Ground a (possibly empty/malformed) model reply against the Phase-1 candidate
 * set into a complete, fully-grounded dashboard. Never throws. Pure given inputs.
 */
function groundDashboard(raw, candidateSet, macroInput) {
  const flags = new Set();
  const r = raw && typeof raw === 'object' ? raw : emptySkeleton();
  const byCusip = new Map(candidateSet.candidates.map(c => [c.cusip, c]));
  // The audience-eligibility wall is the candidate's ACTUAL tax-structure tagging
  // (audiencesForRow), NOT the truncated per-audience top-N (byAudience), which is
  // only a ranking/backfill aid. Using byAudience here would falsely reject a
  // genuinely-eligible pick the model ranked beyond the top-N for that audience.
  const eligible = {};
  for (const k of AUDIENCE_KEYS) {
    eligible[k] = new Set(candidateSet.candidates.filter(c => (c.audiences || []).includes(k)).map(c => c.cusip));
  }

  const picks = {};
  for (const k of AUDIENCE_KEYS) {
    picks[k] = groundAudiencePicks(r.picks && r.picks[k], k, candidateSet, byCusip, eligible, flags);
  }
  const botd = groundBotd(r.botd, candidateSet, byCusip, flags, candidateSet.floorK);
  const sod = groundSod(r.sod, candidateSet, byCusip, flags);
  const connector = groundConnectors(r.connector, picks, macroInput, candidateSet.audiences, flags);

  const coverage = {};
  for (const k of AUDIENCE_KEYS) coverage[k] = picks[k].length;
  const flagList = [...flags];
  const degraded = flagList.some(f => DEGRADE_FLAG.test(f));

  return { audiences: candidateSet.audiences, picks, connector, botd, sod, coverage, degraded, flags: flagList };
}

// ---------- cache (atomic, by package date) ----------

function cachePath(marketDir) { return path.join(marketDir, CACHE_FILENAME); }

function getCachedDashboard(marketDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(marketDir), 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.picks && typeof parsed.picks === 'object' && parsed.connector) {
      return parsed;
    }
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
 * Generate (and cache) the sales dashboard for the current package. Billable —
 * only call on an explicit refresh. Returns the cached record unchanged when it
 * already matches the package date and `force` is not set.
 *
 * Throws ONLY for a missing marketDir or zero usable candidates. A model/API/
 * no-key failure is CAUGHT and grounded against an empty reply, so the result is
 * always a complete (possibly degraded) dashboard — never a 5xx.
 *
 * opts: { marketDir (required), rows, econ, meta, taxRates?, floorK?, force?,
 *         apiKey?, model?, createMessageImpl?, now?, log? }
 */
async function generateDashboard(opts) {
  const o = opts || {};
  if (!o.marketDir) throw new Error('generateDashboard requires opts.marketDir');
  const createMessage = o.createMessageImpl || claudeClient.createMessage;
  const log = o.log || (() => {});
  const meta = o.meta || {};
  const packageDate = meta.date || (o.econ && o.econ.asOfDate) || null;

  if (!o.force) {
    const cached = getCachedDashboard(o.marketDir);
    if (cached && cached.packageDate && cached.packageDate === packageDate) {
      return { ...cached, cached: true };
    }
  }

  const candidateSet = dailyDashboard.buildCandidateSet(o.rows, { taxRates: o.taxRates || null, floorK: o.floorK });
  if (!candidateSet.candidates.length) {
    throw new Error('No audience-eligible offerings to build a dashboard from');
  }

  const macroInput = dailySummary.buildSummaryInput(o.econ, meta);
  const { system, messages } = buildDashboardPrompt(candidateSet, macroInput, meta);

  let raw = emptySkeleton();
  let model = null, usage = null, modelError = null;
  try {
    const result = await createMessage({
      apiKey: o.apiKey, model: o.model, system, messages,
      maxTokens: DASHBOARD_MAX_TOKENS, effort: 'medium', log,
      tools: [DASHBOARD_TOOL],
      toolChoice: { type: 'tool', name: DASHBOARD_TOOL.name },
    });
    // Prefer the forced-tool input (platform-serialized, always well-formed);
    // fall back to parsing the text if a model ever answers in prose.
    raw = result.toolInput ? normalizeRaw(result.toolInput) : parseDashboard(result.text);
    model = result.model;
    usage = result.usage || null;
  } catch (err) {
    modelError = err && err.message ? err.message : String(err);
    log('warn', `Dashboard model call failed (${modelError}); building deterministic dashboard`);
  }

  const grounded = groundDashboard(raw, candidateSet, macroInput);

  const record = {
    packageDate,
    picks: grounded.picks,
    connector: grounded.connector,
    botd: grounded.botd,
    sod: grounded.sod,
    coverage: grounded.coverage,
    coverageOk: candidateSet.coverageOk,
    audiences: candidateSet.audiences,
    degraded: grounded.degraded,
    flags: grounded.flags,
    modelError,
    candidateCount: candidateSet.candidates.length,
    floorK: candidateSet.floorK,
    droppedBelowFloor: candidateSet.droppedBelowFloor,
    model,
    generatedAt: new Date(o.now != null ? o.now : Date.now()).toISOString(),
    usage,
  };
  // A storage failure (disk full, read-only volume) must not throw away an
  // already-computed (and possibly already-billed) dashboard — return it
  // uncached rather than 5xx'ing. Only missing-marketDir / zero-candidates throw.
  let cacheError = null;
  try {
    writeCache(o.marketDir, record);
  } catch (err) {
    cacheError = err && err.message ? err.message : String(err);
    log('warn', `Sales dashboard cache write failed (${cacheError}); returning uncached`);
  }
  log('info',
    `Sales dashboard generated for package ${packageDate || '(unknown)'} ` +
    `(coverage ${grounded.coverage.ccorp}/${grounded.coverage.scorp}/${grounded.coverage.ria}` +
    `${grounded.degraded ? ', auto-completed' : ''}) via ${model || 'deterministic'}`);
  return { ...record, cached: false, ...(cacheError ? { cacheError } : {}) };
}

module.exports = {
  compactCandidate,
  compactMacro,
  buildDashboardPrompt,
  parseDashboard,
  normalizeRaw,
  groundPick,
  groundDashboard,
  pickBotdDeterministic,
  getCachedDashboard,
  generateDashboard,
  CACHE_FILENAME,
  SYSTEM_PROMPT,
  MIN_PER_AUDIENCE,
  MAX_PICKS_PER_AUDIENCE,
  MAX_PER_CLASS,
  SOD_MAX_CUSIPS,
};
