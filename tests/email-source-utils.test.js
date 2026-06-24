// Characterization tests for server/email-source-utils.js — the pure .eml
// parsing helpers behind structured-notes + market-color ingest. No real .eml
// files, no network, no sqlite: every fixture is an inline string. These lock in
// CURRENT behavior (a safety net), they are not a spec.
'use strict';

const assert = require('assert');
const {
  attachmentFilenames,
  cleanEmailText,
  decodeHtmlEntities,
  emailBody,
  emailHtmlBody,
  emailHeader,
  emailSummary
} = require('../server/email-source-utils');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(err.stack || err.message); process.exitCode = 1; }
}

// --- emailHeader / unfolding -------------------------------------------------

test('emailHeader reads a simple header value, trimmed', () => {
  const eml = 'From: trader@example.com\nSubject: New Issue Note\n\nbody';
  assert.strictEqual(emailHeader(eml, 'Subject'), 'New Issue Note');
  assert.strictEqual(emailHeader(eml, 'From'), 'trader@example.com');
});

test('emailHeader unfolds a folded (continuation-line) header into one value', () => {
  // RFC 5322 folding: a CRLF followed by whitespace continues the header.
  const eml = 'Subject: This is a very long subject\r\n that wraps onto\r\n\ta second line\r\n\r\nbody';
  assert.strictEqual(
    emailHeader(eml, 'Subject'),
    'This is a very long subject that wraps onto a second line'
  );
});

test('emailHeader unfolds bare-LF folded headers too', () => {
  const eml = 'Subject: Part one\n continued\n\nbody';
  assert.strictEqual(emailHeader(eml, 'Subject'), 'Part one continued');
});

test('emailHeader returns empty string when the header is absent', () => {
  assert.strictEqual(emailHeader('Subject: hi\n\nbody', 'Reply-To'), '');
});

test('emailHeader is case-insensitive on the name', () => {
  const eml = 'subject: lowercased\n\nbody';
  assert.strictEqual(emailHeader(eml, 'Subject'), 'lowercased');
});

// --- decodeHtmlEntities ------------------------------------------------------

test('decodeHtmlEntities maps the supported named + numeric entities', () => {
  assert.strictEqual(
    decodeHtmlEntities('A&nbsp;&amp;&lt;b&gt;&quot;x&quot;&#39;&#43;'),
    'A &<b>"x"\'+'
  );
});

test('decodeHtmlEntities is a no-op on plain text and tolerates non-strings', () => {
  assert.strictEqual(decodeHtmlEntities('nothing special'), 'nothing special');
  assert.strictEqual(decodeHtmlEntities(null), '');
  assert.strictEqual(decodeHtmlEntities(undefined), '');
});

// --- decodeMimeWord (RFC 2047), exercised via emailSummary / attachmentFilenames

test('decodeMimeWord (via Subject) decodes a UTF-8 base64 =?...?B?= word', () => {
  // "Café ☕" UTF-8 base64.
  const encoded = Buffer.from('Café ☕', 'utf8').toString('base64');
  const eml = `Subject: =?utf-8?B?${encoded}?=\n\nbody`;
  assert.strictEqual(emailSummary(eml).subject, 'Café ☕');
});

test('decodeMimeWord (via Subject) decodes a ?Q? word: _ -> space and =XX hex', () => {
  // "A B=C" with _ for space and =3D for '='.
  const eml = 'Subject: =?utf-8?Q?A_B=3DC?=\n\nbody';
  assert.strictEqual(emailSummary(eml).subject, 'A B=C');
});

test('decodeMimeWord non-utf8 base64 charset decodes via latin1 branch', () => {
  // 0xE9 is 'é' in latin1; base64 of that single byte.
  const encoded = Buffer.from([0xe9]).toString('base64');
  const eml = `Subject: =?iso-8859-1?B?${encoded}?=\n\nbody`;
  assert.strictEqual(emailSummary(eml).subject, 'é');
});

// --- emailBody (multipart slicing + transfer-encoding) -----------------------

test('emailBody returns only the text/plain part and stops at the next --boundary', () => {
  const eml = [
    'Content-Type: multipart/alternative; boundary="BND"',
    '',
    '--BND',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'plain line one',
    'plain line two',
    '--BND',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>html part</p>',
    '--BND--'
  ].join('\r\n');
  const body = emailBody(eml);
  assert.ok(body.includes('plain line one'), 'keeps the plain text');
  assert.ok(body.includes('plain line two'), 'keeps both plain lines');
  assert.ok(!body.includes('html part'), 'does not bleed into the html part');
  assert.ok(!body.includes('--BND'), 'stops before the next boundary marker');
});

test('emailBody decodes a base64 Content-Transfer-Encoding text/plain part', () => {
  const payload = Buffer.from('Hello from base64', 'utf8').toString('base64');
  const eml = [
    'Content-Type: multipart/alternative; boundary="X"',
    '',
    '--X',
    'Content-Type: text/plain',
    'Content-Transfer-Encoding: base64',
    '',
    payload,
    '--X--'
  ].join('\r\n');
  assert.strictEqual(emailBody(eml).trim(), 'Hello from base64');
});

test('emailBody decodes quoted-printable soft breaks (=\\n) and =3D escapes', () => {
  // Default (no recognized transfer encoding) path also runs decodeQuotedPrintable.
  const eml = [
    'Content-Type: multipart/alternative; boundary="Q"',
    '',
    '--Q',
    'Content-Type: text/plain',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'price =3D 100 and a soft=',
    'wrap continues',
    '--Q--'
  ].join('\r\n');
  const body = emailBody(eml);
  assert.ok(body.includes('price = 100'), 'decodes =3D to =');
  assert.ok(body.includes('soft' + 'wrap continues'), `soft line break joins lines: ${JSON.stringify(body)}`);
});

test('emailBody falls back to the post-header block for a non-multipart message', () => {
  const eml = 'Subject: plain\nFrom: a@b.com\n\nThis is the body.\nSecond line.';
  const body = emailBody(eml);
  assert.ok(body.includes('This is the body.'));
  assert.ok(body.includes('Second line.'));
  assert.ok(!body.includes('Subject:'), 'headers excluded from the fallback body');
});

// --- emailHtmlBody -----------------------------------------------------------

test('emailHtmlBody returns the decoded text/html part when present', () => {
  const eml = [
    'Content-Type: multipart/alternative; boundary="B"',
    '',
    '--B',
    'Content-Type: text/plain',
    '',
    'plain',
    '--B',
    'Content-Type: text/html',
    '',
    '<table><tr><td>cell</td></tr></table>',
    '--B--'
  ].join('\r\n');
  const html = emailHtmlBody(eml);
  assert.ok(html.includes('<table>'), 'returns the html markup');
  assert.ok(html.includes('cell'));
  assert.ok(!html.includes('plain'), 'not the plain part');
});

test('emailHtmlBody returns empty string when there is no text/html part', () => {
  const eml = [
    'Content-Type: multipart/alternative; boundary="B"',
    '',
    '--B',
    'Content-Type: text/plain',
    '',
    'just plain',
    '--B--'
  ].join('\r\n');
  assert.strictEqual(emailHtmlBody(eml), '');
});

// --- cleanEmailText ----------------------------------------------------------

test('cleanEmailText strips style/script/tags, drops header/boundary/cid lines, collapses ws', () => {
  const raw = [
    '<style>.x{color:red}</style>',
    '<script>alert(1)</script>',
    '<p>Hello&nbsp;&amp;   welcome</p>',
    'Content-Type: text/plain',
    'Content-Transfer-Encoding: base64',
    'boundary=ABC',
    '--ABC',
    '[cid:image001.png]',
    'real    text   here'
  ].join('\n');
  const lines = cleanEmailText(raw);
  const joined = lines.join('\n');
  assert.ok(!joined.includes('color:red'), 'style contents removed');
  assert.ok(!joined.includes('alert(1)'), 'script contents removed');
  assert.ok(!/[<>]/.test(joined), 'tags stripped');
  assert.ok(lines.includes('Hello & welcome'), `entities decoded + ws collapsed: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('real text here'), 'inner whitespace collapsed');
  assert.ok(!lines.some(l => /^Content-/.test(l)), 'Content-* lines dropped');
  assert.ok(!lines.some(l => /^boundary=/.test(l)), 'boundary= line dropped');
  assert.ok(!lines.some(l => /^--/.test(l)), 'boundary marker line dropped');
  assert.ok(!lines.some(l => /^\[cid:/.test(l)), 'cid line dropped');
});

test('cleanEmailText drops blank lines (filter Boolean)', () => {
  const lines = cleanEmailText('one\n\n   \ntwo');
  assert.deepStrictEqual(lines, ['one', 'two']);
});

// --- emailSummary ------------------------------------------------------------

test('emailSummary returns subject/from/date/body from a full message', () => {
  const eml = [
    'Subject: Morning Note',
    'From: Desk <desk@fbbs.com>',
    'Date: Tue, 24 Jun 2026 08:00:00 -0500',
    'Content-Type: text/plain',
    '',
    'Line A',
    'Line B'
  ].join('\n');
  const s = emailSummary(eml);
  assert.strictEqual(s.subject, 'Morning Note');
  assert.strictEqual(s.from, 'Desk <desk@fbbs.com>');
  assert.strictEqual(s.date, 'Tue, 24 Jun 2026 08:00:00 -0500');
  assert.ok(s.body.includes('Line A') && s.body.includes('Line B'));
  assert.strictEqual(typeof s.body, 'string');
});

test('emailSummary falls back to the filename (sans extension) when no Subject header', () => {
  const eml = 'From: x@y.com\n\nbody only';
  const s = emailSummary(eml, '/inbox/2026-06-24 New Issue.eml');
  assert.strictEqual(s.subject, '2026-06-24 New Issue');
});

test('emailSummary fallback subject is empty when no Subject and no filename', () => {
  const s = emailSummary('From: x@y.com\n\nbody');
  assert.strictEqual(s.subject, '');
});

// --- attachmentFilenames -----------------------------------------------------

test('attachmentFilenames extracts quoted + unquoted names and dedups', () => {
  const text = [
    'Content-Disposition: attachment; filename="offerings.xlsx"',
    'Content-Disposition: attachment; filename=plain.pdf',
    'Content-Disposition: attachment; filename="offerings.xlsx"'
  ].join('\n');
  assert.deepStrictEqual(attachmentFilenames(text), ['offerings.xlsx', 'plain.pdf']);
});

test('attachmentFilenames strips path components via basename', () => {
  const text = 'Content-Disposition: attachment; filename="/var/tmp/sub/dir/report.pdf"';
  assert.deepStrictEqual(attachmentFilenames(text), ['report.pdf']);
});

test('attachmentFilenames decodes RFC 2231 filename* with UTF-8\'\' prefix + percent-encoding', () => {
  // filename*=UTF-8''na%C3%AFve%20file.pdf  -> "naïve file.pdf"
  const text = "Content-Disposition: attachment; filename*=UTF-8''na%C3%AFve%20file.pdf";
  assert.deepStrictEqual(attachmentFilenames(text), ['naïve file.pdf']);
});

test('attachmentFilenames decodes a MIME-word encoded attachment name', () => {
  const encoded = Buffer.from('résumé.pdf', 'utf8').toString('base64');
  const text = `Content-Disposition: attachment; filename="=?utf-8?B?${encoded}?="`;
  assert.deepStrictEqual(attachmentFilenames(text), ['résumé.pdf']);
});

test('attachmentFilenames returns [] when there are no filename params', () => {
  assert.deepStrictEqual(attachmentFilenames('Content-Type: text/plain\n\nbody'), []);
});

console.log(`email-source-utils: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
