/**
 * daily-dashboard-judgment.js — Phase 2 of the native Sales Dashboard.
 *
 * The GROUNDED Claude judgment layer. Phase 1 (daily-dashboard.js) builds an
 * audience-segmented, availability-screened candidate set with the tax math
 * worked out. This module makes ONE billable Claude call that RANKS within that
 * set and writes prose — audience-balanced picks, a macro→pick connector
 * sentence per audience, a Bond-of-the-Day, and a Strategy-of-the-Day — then
 * GROUNDS every displayed number back against the candidate set.
 *
 * Discipline (the whole point): the model produces JUDGMENT, never arithmetic.
 * It emits only CUSIP keys + prose; every number/economic field on the page is
 * re-attached server-side from OUR Phase-1 candidate. Numeric-looking model
 * prose is discarded and replaced with deterministic desk wording, so a wrong
 * number is structurally unreachable. Two walls drop any CUSIP the model
 * shouldn't have used: (1) not in the candidate set → hallucination; (2) not
 * eligible for that audience → the desk's tax-structure tagging, enforced
 * server-side.
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
const rvEngine = require('./daily-dashboard-rv');       // relative-value engine
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

const LEN = { headline: 80, rationale: 160, botdRationale: 400, sodTitle: 80, sodNarrative: 500, connector: 240, talkingPoint: 200, benchmark: 160 };

const SYSTEM_PROMPT =
  'You are a fixed-income desk analyst at First Bankers\' Banc Securities, Inc. ' +
  '(FBBS), building the morning Sales Dashboard for the firm\'s institutional ' +
  'bank-portfolio salespeople. The desk sells to three client tax structures, each ' +
  'called an "audience": ccorp (C-Corp bank, taxed ~21%), scorp (S-Corp bank, taxed ' +
  '~29.6%), and ria (RIA / money manager, taxable / pure relative-value — no muni ' +
  'gross-up, no bank-qualified mechanics).\n\n' +
  'You are given (1) a grounded MACRO context for today (Treasury curve, money-market ' +
  'rates, indices, headlines, economic releases, sales cues) and (2) a grounded ' +
  'CANDIDATE SET of securities the desk is offering. Every candidate carries a CUSIP, ' +
  'the desk\'s OWN worked numbers (yield-to-worst, price, coupon, maturity), each ' +
  'audience\'s effective yield (eff: the taxable-equivalent yield a bank buyer grosses ' +
  'an exempt muni up to, otherwise the YTW), AND a RELATIVE-VALUE read computed by the ' +
  'desk: ustSpreadBps (spread over the matched Treasury), rvScore (0-100, a risk-' +
  'ADJUSTED cheapness percentile that already docks long maturity, call risk, deep ' +
  'premiums and tiny blocks), deskCdSpreadBps (spread vs the desk\'s same-day brokered-CD ' +
  'term median) and perMonthBps (CDs), mmdSpreadBps (a ' +
  'muni\'s spread to the MMD scale for its grade — the desk\'s true muni cheapness) and ' +
  'ratioPct (muni/Treasury yield ratio), peerSpreadBps (vs same sector/maturity/rating peers), bucket ' +
  '(maturity band), rating, trend (new/wider/improved/repeat vs the prior run), and ' +
  'tradeFit (a small buyer-pattern signal from FBBS Pershing history by audience).\n\n' +
  'THE DESK SELLS RELATIVE VALUE, NOT RAW YIELD. Rank and choose on CHEAPNESS — spread ' +
  'to the matched Treasury / FDIC / peers and rvScore — NOT on the highest absolute ' +
  'yield. A long bond that only wins because it carries more yield is exactly what to ' +
  'AVOID; prefer the security that is mispriced for its maturity, structure and credit.\n\n' +
  'YOUR JOB IS JUDGMENT, NOT ARITHMETIC. You RANK within the candidate set, choose ' +
  'which securities best fit each audience today, write a short "why it screens" ' +
  'rationale and a one-line REP TALKING POINT per pick, write one macro-to-pick ' +
  'connector sentence per audience, and choose a Bond-of-the-Day and a Strategy-of-the-' +
  'Day. You NEVER compute, estimate, round, or restate a yield, price, coupon, ' +
  'maturity, spread, ratio or size — those are shown to the user from the desk\'s data, ' +
  'not from your text (you MAY refer to them qualitatively, e.g. "wide to the curve", ' +
  '"cheap to FDIC"). You NEVER name a CUSIP not in the candidate set, and never invent ' +
  'a security. The firm re-attaches its own numbers to whatever you select.\n\n' +
  'Binding desk rules:\n' +
  '- Audience balance: choose AT LEAST 3 and at most 5 picks for EACH of ccorp, scorp, ' +
  'and ria. Use a candidate for an audience ONLY if that audience key appears in that ' +
  'candidate\'s "aud" list.\n' +
  '- Diversify: no more than 3 picks from any one assetClass within a single audience.\n' +
  '- SPAN THE MATURITY CURVE: cover the short end (0–3y), the belly (3–7y) and the ' +
  'long end (7y+) when the inventory supports it — pick the best relative value in ' +
  'each band rather than clustering on the longest, highest-carry bonds. The byAudience ' +
  'list is already ordered to put the best idea in each band up front; lean on bands the ' +
  'audience actually trades (its tradeFit by maturity).\n' +
  '- Rank each audience\'s picks by RELATIVE VALUE for that client — the audSpreadBps / ' +
  'rvScore — best (cheapest) first within each band, NOT by raw effective yield.\n' +
  '- Use tradeFit as a TIE-BREAKER and talking-point clue only: it can favor CDs/munis/' +
  'government-agency paper for banks and CDs/munis/corporates/structured credit for RIAs ' +
  'when RV is close, but it must never rescue a rich or structurally weak bond.\n' +
  '- rationale = WHY IT SCREENS: one sentence on the cheapness (spread to Treasury / ' +
  'FDIC / peers, structure, rating, trend) — not a yield restatement.\n' +
  '- talkingPoint = a single ready-to-say line a rep can read to the client.\n' +
  '- Connector sentence format, EXACTLY: "<driver context> -> <why these picks fit ' +
  'this client today>" — one sentence, one " -> " arrow.\n' +
  '- Bond of the Day (botd): the single best RELATIVE VALUE on the run — credit/' +
  'structure/spread merit, quality over liquidity. Do NOT anchor it on the largest ' +
  'agency block just because it is liquid. One CUSIP from the candidate set.\n' +
  '- Strategy of the Day (sod): one relative-value THEME for today (e.g. "short CDs ' +
  'cheap to bills", "BQ munis screen well for S-corps", "agency bullets — clean spread, ' +
  'no call risk"), a short title plus a two-sentence narrative, with 2 to 4 CUSIPs that ' +
  'express it.\n' +
  '- Bank muni effective yields are the desk-computed net TEY when available ' +
  '(BQ/TEFRA-correct), not naive gross-up. Do not restate or recompute them.\n' +
  '- Use the words "deep discount" only for a candidate whose dollar price is at or ' +
  'below 99.00.\n\n' +
  'For Institutional Use Only. Respond with STRICT JSON only — no prose outside the ' +
  'JSON, no code fence.';

// The compact output contract embedded in the user message. The model returns
// ONLY CUSIP keys + prose — never a number; grounding re-attaches OUR figures.
const OUTPUT_SHAPE_HINT = JSON.stringify({
  picks: {
    ccorp: [{ cusip: '<from securities>', headline: '<=8 words', rationale: '<why it screens, <=160 chars>', talkingPoint: '<one line a rep can say, <=200 chars>' }],
    scorp: [{ cusip: '...', headline: '...', rationale: '...', talkingPoint: '...' }],
    ria: [{ cusip: '...', headline: '...', rationale: '...', talkingPoint: '...' }],
  },
  connector: { ccorp: '<driver> -> <why these fit this client today>', scorp: '...', ria: '...' },
  botd: { cusip: '...', headline: '<=10 words', rationale: '<two sentences>', talkingPoint: '...' },
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
// Claude may write persuasive prose, but it may not introduce quantified market
// claims. Harmless phrases like "five-year ladder" or "2026 maturity" can stay;
// bp/%/$/decimal yield-like claims fall back to deterministic desk wording.
const MODEL_NUMERIC_CLAIM = /[$€£¥]|\b\d+(?:\.\d+)?\s*(?:bp|bps|basis\s+points?|%|percent|pct)\b|[+-]?\d+\.\d+/i;
function modelProseHasNumber(v) { return MODEL_NUMERIC_CLAIM.test(String(v == null ? '' : v)); }
function safeModelProse(v) {
  const s = String(v == null ? '' : v).trim();
  return s && !modelProseHasNumber(s) ? s : '';
}
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
  const rv = c.rv || {};
  for (const k of AUDIENCE_KEYS) {
    const e = c.econ && c.econ[k];
    const netTey = c.exemptMuni && rv.netTey && rv.netTey[k] != null ? rv.netTey[k] : null;
    if (netTey != null) eff[k] = { y: round2(netTey), b: 'net TEY' };
    else if (e && e.effYield != null) eff[k] = { y: round2(e.effYield), b: e.basis };
  }
  const defined = obj => { const o = {}; for (const k in obj) if (obj[k] != null) o[k] = obj[k]; return o; };
  return defined({
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
    // Relative-value read the model RANKS on (never restated as numbers in prose).
    rvScore: rv.score,                               // 0-100 risk-adjusted cheapness
    bucket: rv.bucketLabel,
    rating: rv.ratingLabel && rv.ratingLabel !== 'NR' ? rv.ratingLabel : undefined,
    ustSpreadBps: rv.ustSpreadBps,
    deskCdSpreadBps: rv.deskCdSpreadBps,
    perMonthBps: rv.spreadPerMonthBps,
    ratioPct: rv.ratioPct,
    mmdSpreadBps: rv.mmdSpreadBps,
    mmdGrade: rv.mmdGrade,
    impliedGrade: rv.notchesCheap >= 1 ? rv.impliedGrade : undefined,
    moverBp: rv.moverBp,                              // cheapened/richened vs the prior run
    peerSpreadBps: rv.peerSpreadBps,
    audSpreadBps: rv.audSpreadBps && Object.keys(rv.audSpreadBps).length ? rv.audSpreadBps : undefined,
    tradeFit: rv.tradeFit && Object.keys(rv.tradeFit).length ? Object.fromEntries(Object.entries(rv.tradeFit).map(([k, v]) => [k, { score: v.score, reasons: v.reasons }])) : undefined,
    trend: rv.trend,
  });
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
    'RELATIVE VALUE for that client (rvScore / audSpreadBps / spread to Treasury, FDIC or ' +
    'peers) — NOT by the highest raw yield. Use tradeFit only as a tie-breaker when the RV ' +
    'case is close, and as a clue for buyer-fit language. A CUSIP is eligible for an audience ONLY if that ' +
    'audience key is in the candidate\'s "aud" list; the byAudience list is the desk\'s ' +
    'curve-spanning, trade-weighted relative-value ranking to start from (best idea in each ' +
    'maturity band first), but any "aud"-eligible candidate is allowed. SPAN THE CURVE — include ' +
    'short (0–3y), belly (3–7y) and long (7y+) ideas when present, not just the longest. No more ' +
    'than 3 picks of one assetClass within an audience. For each pick give a <=8-word headline, ' +
    'a one-sentence (<=160 char) rationale = WHY IT SCREENS (cite the cheapness qualitatively: ' +
    'spread to the curve / FDIC / peers, structure, rating, trend — not a yield restatement), ' +
    'and a one-line talkingPoint a rep can say to the client. Do not state a number the data ' +
    'does not show; do not say "deep discount" unless its price <= 99.00.\n' +
    '2. connector — for EACH audience: ONE sentence in EXACTLY this format: ' +
    '"<driver context from today\'s macro> -> <why these picks fit this client today>". One ' +
    'sentence, one " -> ", <=40 words.\n' +
    '3. botd — the single best RELATIVE VALUE on the run (credit/structure/spread merit; ' +
    'quality over liquidity; do NOT default to the largest agency block), with a <=10-word ' +
    'headline, a two-sentence rationale, and a talkingPoint.\n' +
    '4. sod — one relative-value theme (short title + two-sentence narrative) plus 2 to 4 ' +
    'CUSIPs that express it.\n\n' +
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
  properties: { cusip: { type: 'string' }, headline: { type: 'string' }, rationale: { type: 'string' }, talkingPoint: { type: 'string' } },
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
        properties: { cusip: { type: 'string' }, headline: { type: 'string' }, rationale: { type: 'string' }, talkingPoint: { type: 'string' } },
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

// ---------- deterministic, grounded prose from OUR relative-value read ----------
// These never read the model. They compose the benchmark comparison, the "why it
// screens" line, and a rep talking point straight from the rv object the engine
// attached — so the five per-recommendation fields are always present, with or
// without an AI read, and never carry a number the desk didn't compute.

function fmtBps(n) { return n == null ? null : `${n >= 0 ? '+' : ''}${n}bp`; }

/** "Benchmark comparison" line — class-appropriate (UST / FDIC / muni ratio / peers). */
function benchmarkLine(rv, cls) {
  if (!rv) return null;
  const parts = [];
  const c = String(cls || '').toLowerCase();
  if (/cd|certificate/.test(c)) {
    if (rv.ustSpreadBps != null) parts.push(`${fmtBps(rv.ustSpreadBps)} vs matched UST`);
    if (rv.deskCdSpreadBps != null) parts.push(`${fmtBps(rv.deskCdSpreadBps)} vs desk ${rv.cdTermMonths || ''}m median`);
    if (rv.spreadPerMonthBps != null) parts.push(`${rv.spreadPerMonthBps}bp/mo`);
  } else if (/muni/.test(c)) {
    if (rv.mmdSpreadBps != null) parts.push(`${fmtBps(rv.mmdSpreadBps)} vs ${rv.mmdGrade || 'AAA'} MMD${rv.mmdAssumedGrade ? '*' : ''}`);
    if (rv.enhanced) parts.push(`${fmtBps(rv.enhanced.spreadBps)} vs ${rv.enhanced.type === 'insured' ? 'insured' : 'AA'} MMD`);
    if (rv.audSpreadBps && rv.audSpreadBps.ccorp != null) parts.push(`TEY ${fmtBps(rv.audSpreadBps.ccorp)} vs UST (C-corp)`);
    if (rv.ratioPct != null) parts.push(`${rv.ratioPct}% muni/UST`);
    if (rv.peerSpreadBps != null) parts.push(`${fmtBps(rv.peerSpreadBps)} vs ${rv.ratingBucket || ''} peers`);
  } else {
    if (rv.ustSpreadBps != null) parts.push(`${fmtBps(rv.ustSpreadBps)} vs ${rv.benchmarkTenorYears || ''}y UST${rv.benchmarkYield != null ? ` (${rv.benchmarkYield}%)` : ''}`);
    if (rv.peerSpreadBps != null) parts.push(`${fmtBps(rv.peerSpreadBps)} vs peers`);
  }
  return parts.length ? parts.join(' · ') : null;
}

const TREND_WORDS = { wider: 'wider to the curve vs the prior run', improved: 'a better entry than the prior run', new: 'new on the run today', richer: 'richer than the prior run', repeat: 'a repeated standout' };

/** Deterministic "why it screens" — RV score + dominant benchmark + trend. */
function whyScreensLine(row) {
  const rv = row.rv;
  const cls = row.assetClass || 'Security';
  if (!rv) return `${cls} on today's run.`;
  const bits = [];
  if (rv.score != null) bits.push(`relative value ${rv.score}/100`);
  const bm = benchmarkLine(rv, cls);
  if (bm) bits.push(bm);
  if (rv.trend && TREND_WORDS[rv.trend]) bits.push(TREND_WORDS[rv.trend]);
  return bits.length ? `${cls} — ${bits.join('; ')}.` : `${cls} on today's run.`;
}

/** Deterministic rep talking point keyed off the cheapest-screening benchmark. */
function talkingPointLine(row) {
  const rv = row.rv;
  if (!rv) return 'Screens cheap for its maturity and structure on today\'s run.';
  const c = String(row.assetClass || '').toLowerCase();
  if (/cd|certificate/.test(c) && rv.deskCdSpreadBps != null) {
    return `This ${rv.cdTermMonths || ''}-month CD pays about ${fmtBps(rv.deskCdSpreadBps)} over today's brokered-CD median for its term${rv.ustSpreadBps != null ? ` and ${fmtBps(rv.ustSpreadBps)} over the matched Treasury` : ''} — hard to beat for insured short money.`;
  }
  if (/muni/.test(c)) {
    if (rv.mmdSpreadBps != null && rv.mmdSpreadBps > 0) {
      return `This name is about ${fmtBps(rv.mmdSpreadBps)} cheap to the ${rv.mmdGrade || 'AAA'} MMD scale at its maturity${rv.audSpreadBps && rv.audSpreadBps.ccorp != null ? `, ~${fmtBps(rv.audSpreadBps.ccorp)} over Treasuries on a C-corp taxable-equivalent basis` : ''}.`;
    }
    if (rv.audSpreadBps && rv.audSpreadBps.ccorp != null) {
      return `On a taxable-equivalent basis this works out to roughly ${fmtBps(rv.audSpreadBps.ccorp)} over the matched Treasury for a bank book.`;
    }
  }
  if (rv.ustSpreadBps != null) {
    return `You pick up about ${fmtBps(rv.ustSpreadBps)} over the matched Treasury here${rv.peerSpreadBps != null && rv.peerSpreadBps > 0 ? `, and it's cheap to its ${rv.bucketLabel || ''} peers` : ''}.`;
  }
  return 'Screens cheap for its maturity and structure on today\'s run.';
}

/**
 * Re-attach OUR numbers to a candidate row, reading ONLY headline/rationale/
 * talkingPoint prose from the model. The relative-value read (benchmark, caveat,
 * buyer, score) and the deterministic fallbacks for every prose field come from
 * the desk's own rv object — never the model. `audKey` null → attach the full
 * per-audience econ map (BOTD/SoD). deepDiscount is COMPUTED from our price.
 */
function attachRow(row, audKey, headline, rationale, source, rationaleMax, talkingPoint, flags) {
  const rv = row.rv || null;
  if (source === 'model' && flags && [headline, rationale, talkingPoint].some(modelProseHasNumber)) {
    flags.add('model-prose-number-dropped');
  }
  const h = source === 'model' ? safeModelProse(headline) : headline;
  const r = source === 'model' ? safeModelProse(rationale) : rationale;
  const t = source === 'model' ? safeModelProse(talkingPoint) : talkingPoint;
  const why = (r && String(r).trim()) ? clamp(r, rationaleMax || LEN.rationale) : clamp(whyScreensLine(row), rationaleMax || LEN.rationale);
  const tp = (t && String(t).trim()) ? clamp(t, LEN.talkingPoint) : clamp(talkingPointLine(row), LEN.talkingPoint);
  // Audience-specific buyer-fit note from OUR Pershing trade history (qualitative,
  // never a number). Only the reason for THIS audience — not the cross-audience union.
  const fitRow = audKey && rv && rv.tradeFit ? rv.tradeFit[audKey] : null;
  const buyerFit = (fitRow && Array.isArray(fitRow.reasons) && fitRow.reasons.length)
    ? clamp(fitRow.reasons[0].charAt(0).toUpperCase() + fitRow.reasons[0].slice(1) + '.', 120)
    : null;
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
    rv,
    benchmark: clamp(benchmarkLine(rv, row.assetClass), LEN.benchmark),
    caveat: rv && Array.isArray(rv.caveats) && rv.caveats.length ? clamp(rv.caveats[0], 200) : null,
    buyer: rv && Array.isArray(rv.buyerTypes) && rv.buyerTypes.length ? rv.buyerTypes[0] : null,
    deepDiscount: row.price != null && row.price <= 99.0,
    buyerFit,
    headline: clamp(h, LEN.headline),
    rationale: why,
    talkingPoint: tp,
    source,
  };
}

/** Single CUSIP gate for a model pick under one audience. Null = dropped. */
function groundPick(p, audKey, byCusip, eligible, flags) {
  const cusip = cusipKey(p && p.cusip);
  if (!cusip) return null;
  const row = byCusip.get(cusip);
  if (!row) { flags.add('dropped-unknown-cusip'); return null; }
  if (!eligible[audKey] || !eligible[audKey].has(cusip)) { flags.add('dropped-audience-ineligible'); return null; }
  return attachRow(row, audKey, p && p.headline, p && p.rationale, 'model', LEN.rationale, p && p.talkingPoint, flags);
}

/**
 * Assemble one audience's picks: ground the model's picks, then backfill to SPAN
 * THE MATURITY CURVE — the best idea in each not-yet-covered maturity band (the
 * pool is curve-ordered best-in-band first), so the dashboard always offers short,
 * belly and long ideas instead of clustering on long-bond carry. Backfilling that
 * merely reaches the per-audience floor is a degradation (the model under-
 * delivered); backfilling for curve breadth ABOVE the floor is the intended
 * design and does NOT mark the read degraded. When the pool carries no band info
 * (a Phase-1 set), the curve target collapses to the MIN floor — legacy behavior.
 */
function groundAudiencePicks(rawPicks, audKey, candidateSet, byCusip, eligible, flags) {
  const out = [];
  const seen = new Set();
  const classCount = new Map();
  const classOf = g => g.assetClass || 'Other';
  const atCap = cls => (classCount.get(cls) || 0) >= MAX_PER_CLASS;
  const bump = cls => classCount.set(cls, (classCount.get(cls) || 0) + 1);
  const bucketOf = g => (g && g.rv && g.rv.bucket) || null;
  const coveredBuckets = new Set();

  // 1. Ground the model's picks (drop hallucinations / wrong-audience / class-cap).
  for (const p of (Array.isArray(rawPicks) ? rawPicks : [])) {
    if (out.length >= MAX_PICKS_PER_AUDIENCE) break;
    const g = groundPick(p, audKey, byCusip, eligible, flags);
    if (!g || seen.has(g.cusip)) continue;
    if (atCap(classOf(g))) { flags.add('dropped-class-cap'); continue; }
    seen.add(g.cusip); bump(classOf(g)); out.push(g);
    if (bucketOf(g)) coveredBuckets.add(bucketOf(g));
  }

  const pool = candidateSet.byAudience[audKey] || [];
  // Curve target: cover the populated maturity bands, up to the per-audience max.
  // No band info → collapses to the MIN floor (Phase-1 set / unit tests).
  const populatedBuckets = new Set(pool.map(bucketOf).filter(Boolean));
  const curveTarget = Math.min(MAX_PICKS_PER_AUDIENCE, Math.max(MIN_PER_AUDIENCE, populatedBuckets.size));

  // 2. Curve-coverage backfill — one best-in-band idea per uncovered band first.
  for (const cand of pool) {
    if (out.length >= curveTarget) break;
    if (seen.has(cand.cusip)) continue;
    const b = bucketOf(cand);
    if (!b) continue;                                          // no band info → adds no curve value here
    if (coveredBuckets.has(b)) continue;                       // one per band before doubling up
    if (atCap(cand.assetClass || 'Other')) continue;
    const belowFloor = out.length < MIN_PER_AUDIENCE;
    out.push(attachRow(cand, audKey, '', '', 'backfill'));
    seen.add(cand.cusip); bump(cand.assetClass || 'Other');
    if (b) coveredBuckets.add(b);
    // Below the floor = the model under-delivered (degrade); above = intended breadth.
    flags.add(belowFloor ? 'backfilled' : 'curve-filled');
  }

  // 3. Hard floor — ensure ≥ MIN even when bands/classes are thin.
  if (out.length < MIN_PER_AUDIENCE) {
    for (const cand of pool) { // respect the per-class cap first
      if (out.length >= MIN_PER_AUDIENCE) break;
      if (seen.has(cand.cusip) || atCap(cand.assetClass || 'Other')) continue;
      out.push(attachRow(cand, audKey, '', '', 'backfill'));
      seen.add(cand.cusip); bump(cand.assetClass || 'Other'); flags.add('backfilled');
    }
    for (const cand of pool) { // floor-of-MIN wins over the class cap
      if (out.length >= MIN_PER_AUDIENCE) break;
      if (seen.has(cand.cusip)) continue;
      out.push(attachRow(cand, audKey, '', '', 'backfill'));
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
  // Best RELATIVE VALUE first (the rv composite), then a credit/structure tilt,
  // then effective yield as a final tie-break — quality over liquidity.
  const rvBpsOf = c => (c.rv && c.rv.rvBps != null ? c.rv.rvBps : -Infinity);
  const ranked = pool
    .filter(c => c.cusip !== excludeCusip)
    .sort((a, b) => rvBpsOf(b) - rvBpsOf(a) || tierOf(a) - tierOf(b) || bestEff(b) - bestEff(a) || (a.cusip < b.cusip ? -1 : 1));
  if (ranked.length) return ranked[0];
  return pool.slice().sort((a, b) => bestEff(b) - bestEff(a))[0]; // degenerate: only the excluded block
}

function groundBotd(rawBotd, candidateSet, byCusip, flags, floorK) {
  const cusip = cusipKey(rawBotd && rawBotd.cusip);
  const row = cusip ? byCusip.get(cusip) : null;
  const valid = row && (row.availabilityK == null || row.availabilityK >= floorK);
  if (valid) return attachRow(row, null, rawBotd.headline, rawBotd.rationale, 'model', LEN.botdRationale, rawBotd.talkingPoint, flags);
  flags.add('botd-backfilled');
  const cand = pickBotdDeterministic(candidateSet, floorK);
  if (!cand) return null;
  return attachRow(cand, null, '', `Best relative value on the run by the desk's risk-adjusted screen: ${cand.description || cand.assetClass}.`, 'backfill', LEN.botdRationale);
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
  if ([rawSod && rawSod.title, rawSod && rawSod.narrative].some(modelProseHasNumber)) {
    flags.add('model-prose-number-dropped');
  }
  let title = clamp(safeModelProse(rawSod && rawSod.title), LEN.sodTitle);
  let narrative = clamp(safeModelProse(rawSod && rawSod.narrative), LEN.sodNarrative);
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
  if (rows.length < SOD_MIN || !title || !narrative) {
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
    if (modelProseHasNumber(rawConn && rawConn[k])) flags.add('model-prose-number-dropped');
    let s = clamp(normalizeArrows(safeModelProse(rawConn && rawConn[k])).trim(), LEN.connector);
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

const DEGRADE_FLAG = /backfill|synthes|coverage-short|model-prose/;

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

// ---------- relative-value assembly ----------

/**
 * Build the candidate-set shape groundDashboard expects from the RV analysis:
 * enriched candidates (carrying .rv) and per-audience lists already ranked by
 * the tax-aware relative-value spread that audience earns.
 */
function buildGroundingSet(candidateSet, rvAnalysis) {
  const byCusip = rvAnalysis.byCusip;
  const byAudience = {};
  for (const k of AUDIENCE_KEYS) {
    byAudience[k] = (rvAnalysis.byAudience[k] || []).map(cu => byCusip.get(cu)).filter(Boolean);
  }
  return {
    candidates: rvAnalysis.candidates,
    byAudience,
    audiences: candidateSet.audiences,
    floorK: candidateSet.floorK,
    coverageOk: candidateSet.coverageOk,
  };
}

/** Attach OUR numbers + deterministic RV prose to a section list (no model text). */
function attachSection(list) { return (Array.isArray(list) ? list : []).map(c => attachRow(c, null, '', '', 'rv')); }

/**
 * The relative-value sections rendered on the dashboard — every entry grounded
 * the same way as a pick (carries rv, benchmark, caveat, buyer, talkingPoint).
 */
function buildRvSections(rvAnalysis) {
  const byBucket = {};
  for (const [k, b] of Object.entries(rvAnalysis.byBucket || {})) {
    byBucket[k] = { label: b.label, count: b.count, top: attachSection(b.top) };
  }
  const trendList = key => attachSection((rvAnalysis.trends[key] || []).map(cu => rvAnalysis.byCusip.get(cu)).filter(Boolean));
  const mv = rvAnalysis.movers;
  const movers = mv ? {
    priorDate: mv.priorDate,
    daysAgo: mv.daysAgo,
    curveMoveBp: mv.curveMoveBp,
    matched: mv.matched,
    cheapened: attachSection(mv.cheapened),
    richened: attachSection(mv.richened),
    newToday: attachSection(mv.newToday),
    // rolled-off names came from the PRIOR package and aren't candidates today —
    // carry just the identity so the rep isn't caught quoting dead inventory.
    rolledOff: (mv.rolledOff || []).map(r => ({ cusip: r.cusip, description: r.description, assetClass: r.type, ytw: r.ytw })),
    supply: mv.supply || [],
  } : null;
  const inventory = (Array.isArray(rvAnalysis.inventory) ? rvAnalysis.inventory : []).map(b => ({
    key: b.key,
    label: b.label,
    page: b.page,
    count: b.count || 0,
    eligibleCount: b.eligibleCount || 0,
    bqCount: b.bqCount || 0,
    deepDiscountCount: b.deepDiscountCount || 0,
    top: attachSection(b.top),
  }));
  return {
    benchmarks: rvAnalysis.benchmarks,
    strategist: rvAnalysis.strategist || null,
    inventory,
    standouts: attachSection(rvAnalysis.standouts),
    leaders: attachSection(rvAnalysis.leaders),
    cheapToTreasury: attachSection(rvAnalysis.cheapToTreasury),
    cdBoard: attachSection(rvAnalysis.cdBoard),
    muniValue: attachSection(rvAnalysis.muniValue),
    creditYield: attachSection(rvAnalysis.creditYield),
    bankCapital: attachSection(rvAnalysis.bankCapital),
    byBucket,
    movers,
    trends: {
      new: trendList('new'),
      wider: trendList('wider'),
      improved: trendList('improved'),
      repeated: trendList('repeated'),
    },
  };
}

/**
 * The FREE, deterministic dashboard for the read-only GET: full relative-value
 * sections + deterministic (RV-grounded) picks/connector/BOTD/SoD, with NO model
 * call and NO disk write. Same record shape as a generated read, flagged
 * aiGenerated:false. Throws only for zero candidates.
 *
 * opts: { rows, econ, meta, curve?, fred?, mmd?, priorMap?, tradeProfile?, taxRates?, floorK? }
 */
function buildLiveDashboard(opts) {
  const o = opts || {};
  const meta = o.meta || {};
  const packageDate = meta.date || (o.econ && o.econ.asOfDate) || null;
  const candidateSet = dailyDashboard.buildCandidateSet(o.rows, { taxRates: o.taxRates || null, floorK: o.floorK, asOf: packageDate });
  if (!candidateSet.candidates.length) throw new Error('No audience-eligible offerings to build a dashboard from');
  const rvAnalysis = rvEngine.buildRelativeValue({
    candidateSet, curve: o.curve || null, fred: o.fred || null, mmd: o.mmd || null,
    priorRows: o.priorRows || null, priorMeta: o.priorMeta || null, rvTable: o.rvTable || null, priorRvTable: o.priorRvTable || null, cof: o.cof,
    asOf: packageDate, priorMap: o.priorMap || null, tradeProfile: o.tradeProfile || null,
  });
  const groundingSet = buildGroundingSet(candidateSet, rvAnalysis);
  const macroInput = dailySummary.buildSummaryInput(o.econ, meta);
  const grounded = groundDashboard(emptySkeleton(), groundingSet, macroInput);
  return {
    packageDate,
    picks: grounded.picks,
    connector: grounded.connector,
    botd: grounded.botd,
    sod: grounded.sod,
    coverage: grounded.coverage,
    coverageOk: candidateSet.coverageOk,
    audiences: candidateSet.audiences,
    rv: buildRvSections(rvAnalysis),
    benchmarks: rvAnalysis.benchmarks,
    candidateCount: candidateSet.candidates.length,
    floorK: candidateSet.floorK,
    droppedBelowFloor: candidateSet.droppedBelowFloor,
    model: null,
    aiGenerated: false,
    degraded: grounded.degraded,
    flags: grounded.flags,
  };
}

// ---------- cache (atomic, by package date) ----------

function cachePath(marketDir) { return path.join(marketDir, CACHE_FILENAME); }

/**
 * The prior package's per-CUSIP snapshot for trend detection: the snapshot
 * embedded in the cached read, returned only when it is for a DIFFERENT package
 * date than today's (so same-day re-refreshes don't diff against themselves).
 */
function loadPriorSnapshot(marketDir, packageDate) {
  const cached = getCachedDashboard(marketDir);
  if (cached && cached.snapshot && cached.packageDate && cached.packageDate !== packageDate) {
    return cached.snapshot;
  }
  return null;
}

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
 * opts: { marketDir (required), rows, econ, meta, curve?, fred?, mmd?, priorMap?,
 *         tradeProfile?, taxRates?, floorK?, force?, noCache?,
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

  const candidateSet = dailyDashboard.buildCandidateSet(o.rows, { taxRates: o.taxRates || null, floorK: o.floorK, asOf: packageDate });
  if (!candidateSet.candidates.length) {
    throw new Error('No audience-eligible offerings to build a dashboard from');
  }

  // Relative-value enrichment — the deterministic ranking core. The model ranks
  // WITHIN this RV-ordered set; it never moves a benchmark.
  const rvAnalysis = rvEngine.buildRelativeValue({
    candidateSet, curve: o.curve || null, fred: o.fred || null, mmd: o.mmd || null,
    priorRows: o.priorRows || null, priorMeta: o.priorMeta || null, rvTable: o.rvTable || null, priorRvTable: o.priorRvTable || null, cof: o.cof,
    asOf: packageDate, priorMap: o.priorMap || null, tradeProfile: o.tradeProfile || null,
  });
  const groundingSet = buildGroundingSet(candidateSet, rvAnalysis);

  const macroInput = dailySummary.buildSummaryInput(o.econ, meta);
  const { system, messages } = buildDashboardPrompt(groundingSet, macroInput, meta);

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

  const grounded = groundDashboard(raw, groundingSet, macroInput);

  const record = {
    packageDate,
    picks: grounded.picks,
    connector: grounded.connector,
    botd: grounded.botd,
    sod: grounded.sod,
    coverage: grounded.coverage,
    coverageOk: candidateSet.coverageOk,
    audiences: candidateSet.audiences,
    rv: buildRvSections(rvAnalysis),
    benchmarks: rvAnalysis.benchmarks,
    snapshot: rvAnalysis.snapshot,            // persisted for next-day trend diffing
    aiGenerated: !!(model && !modelError),
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
  // uncached rather than 5xx'ing. Custom tax lenses are one-off reads and do not
  // replace the shared package-date cache. Only missing-marketDir / zero-candidates throw.
  let cacheError = null;
  if (!o.noCache) {
    try {
      writeCache(o.marketDir, record);
    } catch (err) {
      cacheError = err && err.message ? err.message : String(err);
      log('warn', `Sales dashboard cache write failed (${cacheError}); returning uncached`);
    }
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
  buildGroundingSet,
  buildRvSections,
  buildLiveDashboard,
  loadPriorSnapshot,
  benchmarkLine,
  whyScreensLine,
  talkingPointLine,
  getCachedDashboard,
  generateDashboard,
  CACHE_FILENAME,
  SYSTEM_PROMPT,
  MIN_PER_AUDIENCE,
  MAX_PICKS_PER_AUDIENCE,
  MAX_PER_CLASS,
  SOD_MAX_CUSIPS,
};
