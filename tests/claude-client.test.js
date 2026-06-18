// Tests for server/claude-client.js — the raw-HTTPS Messages API wrapper.
// Uses a fake fetchImpl; no network, no key required.
'use strict';

const assert = require('assert');
const claude = require('../server/claude-client');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('isConfigured: arg wins, then env, else false', () => {
  assert.strictEqual(claude.isConfigured('sk-test'), true);
  assert.strictEqual(claude.isConfigured('  '), false);
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual(claude.isConfigured(), false);
  if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
});

test('extractText concatenates only text blocks', () => {
  const text = claude.extractText({ content: [
    { type: 'thinking', thinking: 'x' },
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world' },
  ] });
  assert.strictEqual(text, 'Hello world');
});

test('createMessage builds the correct request and parses text', async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return okResponse({ model: 'claude-opus-4-8', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'a summary' }], usage: { input_tokens: 10 } });
  };
  const out = await claude.createMessage({
    apiKey: 'sk-test', system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 500, effort: 'medium', fetchImpl,
  });
  assert.strictEqual(captured.url, claude.ANTHROPIC_URL);
  assert.strictEqual(captured.init.method, 'POST');
  assert.strictEqual(captured.init.headers['x-api-key'], 'sk-test');
  assert.strictEqual(captured.init.headers['anthropic-version'], claude.ANTHROPIC_VERSION);
  const body = JSON.parse(captured.init.body);
  assert.strictEqual(body.model, 'claude-opus-4-8');
  assert.strictEqual(body.max_tokens, 500);
  assert.strictEqual(body.system, 'sys');
  assert.deepStrictEqual(body.output_config, { effort: 'medium' });
  assert.strictEqual(out.text, 'a summary');
  assert.strictEqual(out.usage.input_tokens, 10);
});

test('createMessage throws without a key', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(
    claude.createMessage({ messages: [{ role: 'user', content: 'hi' }], fetchImpl: async () => okResponse({}) }),
    /not configured/);
  if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
});

test('createMessage throws on a non-2xx response with the API message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
  await assert.rejects(
    claude.createMessage({ apiKey: 'sk-test', messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    /429.*rate limited/);
});

test('createMessage throws on a safety refusal', async () => {
  const fetchImpl = async () => okResponse({ stop_reason: 'refusal', content: [] });
  await assert.rejects(
    claude.createMessage({ apiKey: 'sk-test', messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    /refusal/);
});

(async () => {
  for (const { name, fn } of tests) {
    try { await fn(); passed++; }
    catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
  }
  console.log(`claude-client tests: ${passed} passed.`);
})();
