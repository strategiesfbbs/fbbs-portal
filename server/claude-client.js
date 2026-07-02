/**
 * claude-client.js — minimal raw-HTTPS wrapper for the Anthropic Messages API.
 *
 * The portal's npm footprint is deliberately two deps (pdf-parse,
 * better-sqlite3), so this does NOT pull in @anthropic-ai/sdk — it calls
 * POST /v1/messages with Node's global fetch, the same playbook the other
 * outbound integrations use (market-rates.js / fred-series.js): no dependency,
 * a hard timeout, dormant until a key is configured. The API key comes from
 * ANTHROPIC_API_KEY (env wins) or a one-line data/market/anthropic-api-key.txt
 * the launcher wires into the env at startup (see server.js).
 *
 * Defaults to claude-opus-4-8. Summaries are short (well under the streaming
 * threshold) so this is a single non-streaming request — no SSE handling.
 */
'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 1024;
const FETCH_TIMEOUT_MS = 60000;

/** True when an Anthropic API key is available (arg wins, else env). */
function resolveApiKey(apiKey) {
  const key = apiKey != null ? apiKey : (process.env.ANTHROPIC_API_KEY || '');
  return String(key).trim();
}

function isConfigured(apiKey) {
  return resolveApiKey(apiKey).length > 0;
}

/** Concatenate the text blocks of a Messages API response into one string. */
function extractText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  return blocks
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
    .trim();
}

/**
 * The `input` of the first tool_use block, or null. When a call forces a tool
 * (tool_choice), the API returns the model's arguments as an ALREADY-PARSED
 * object here — well-formed JSON guaranteed by the platform, so callers that
 * need reliable structured output use this instead of parsing extractText().
 */
function extractToolInput(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  const block = blocks.find(b => b && b.type === 'tool_use' && b.input && typeof b.input === 'object');
  return block ? block.input : null;
}

/** The name of the first tool_use block, or null — pairs with extractToolInput
 * so multi-tool callers (sales-assistant) can tell WHICH tool the model chose. */
function extractToolName(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : [];
  const block = blocks.find(b => b && b.type === 'tool_use' && b.input && typeof b.input === 'object');
  return block && typeof block.name === 'string' ? block.name : null;
}

/**
 * One Messages API call. Returns { text, model, stopReason, usage }.
 * Throws on a missing key, a non-2xx response, a network/timeout failure, or a
 * safety refusal (stop_reason 'refusal') — the caller decides how to surface it.
 *
 * opts: { system?, messages (required), apiKey?, model?, maxTokens?, effort?,
 *         fetchImpl?, timeoutMs?, log? }
 */
async function createMessage(opts) {
  const o = opts || {};
  const apiKey = resolveApiKey(o.apiKey);
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  if (!Array.isArray(o.messages) || !o.messages.length) {
    throw new Error('createMessage requires a non-empty messages array');
  }
  const fetchImpl = o.fetchImpl || fetch;
  const timeoutMs = o.timeoutMs != null ? o.timeoutMs : FETCH_TIMEOUT_MS;
  const log = o.log || (() => {});

  const body = {
    model: o.model || DEFAULT_MODEL,
    max_tokens: o.maxTokens != null ? o.maxTokens : DEFAULT_MAX_TOKENS,
    messages: o.messages,
  };
  if (o.system) body.system = o.system;
  if (o.effort) body.output_config = { effort: o.effort };
  // Optional forced tool-use for reliable structured output. Additive — only
  // engaged when a caller passes tools; the platform serializes the model's
  // arguments as well-formed JSON, surfaced via extractToolInput().
  if (Array.isArray(o.tools) && o.tools.length) body.tools = o.tools;
  if (o.toolChoice) body.tool_choice = o.toolChoice;

  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = (errJson && errJson.error && errJson.error.message) || '';
    } catch (_) { /* body not JSON */ }
    log('warn', `Anthropic API responded ${res.status}${detail ? ': ' + detail : ''}`);
    throw new Error(`Anthropic API responded ${res.status}${detail ? ': ' + detail : ''}`);
  }

  const message = await res.json();
  if (message && message.stop_reason === 'refusal') {
    throw new Error('Anthropic API declined the request (refusal)');
  }
  return {
    text: extractText(message),
    toolInput: extractToolInput(message),
    toolName: extractToolName(message),
    model: (message && message.model) || body.model,
    stopReason: (message && message.stop_reason) || null,
    usage: (message && message.usage) || null,
  };
}

module.exports = {
  createMessage,
  isConfigured,
  extractText,
  extractToolInput,
  extractToolName,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  DEFAULT_MODEL,
};
