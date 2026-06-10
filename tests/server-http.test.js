'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

let passed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function request(port, { method = 'GET', path: requestPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartFile(fieldName, filename, content) {
  const boundary = `----fbbs-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`),
    Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
    Buffer.isBuffer(content) ? content : Buffer.from(String(content)),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return {
    body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
  };
}

async function waitForHealth(port, child) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 10000) {
    if (child.exitCode != null) {
      throw new Error(`server exited before health check; code=${child.exitCode}`);
    }
    try {
      const res = await request(port, { path: '/api/health' });
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('server did not become healthy');
}

async function withServer(extraEnv, fn) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-http-test-'));
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'error',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    await waitForHealth(port, child);
    await fn({ port, dataDir, child });
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return output;
}

test('same-day corrupt replacement preserves existing current slot', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const first = multipartFile('dashboard', 'dashboard.html', '<!doctype html><html><body>old dashboard</body></html>');
    const published = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: first.headers,
      body: first.body
    });
    assert.strictEqual(published.status, 200, published.text);
    const dashboardPath = path.join(dataDir, 'current', 'dashboard.html');
    assert.ok(fs.readFileSync(dashboardPath, 'utf8').includes('old dashboard'));

    const corrupt = multipartFile('dashboard', 'dashboard.html', 'not really html');
    const rejected = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: corrupt.headers,
      body: corrupt.body
    });
    assert.strictEqual(rejected.status, 400, rejected.text);
    assert.ok(fs.readFileSync(dashboardPath, 'utf8').includes('old dashboard'));
  });
});

test('dateless current package archives using existing file date', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const currentDir = path.join(dataDir, 'current');
    const oldPath = path.join(currentDir, 'FBBS_Dashboard_20260501.html');
    fs.writeFileSync(oldPath, '<!doctype html><html><body>old dateless dashboard</body></html>');
    const oldDate = new Date('2026-05-01T12:00:00');
    fs.utimesSync(oldPath, oldDate, oldDate);

    const next = multipartFile('dashboard', 'dashboard.html', '<!doctype html><html><body>new dashboard</body></html>');
    const published = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: next.headers,
      body: next.body
    });
    assert.strictEqual(published.status, 200, published.text);
    assert.ok(fs.existsSync(path.join(dataDir, 'archive', '2026-05-01', 'FBBS_Dashboard_20260501.html')));
    assert.ok(fs.readFileSync(path.join(currentDir, 'dashboard.html'), 'utf8').includes('new dashboard'));
    assert.strictEqual(fs.existsSync(oldPath), false);
  });
});

test('iis admin ingest routes reject non-admins before parsing', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port }) => {
    const ingestRoutes = [
      '/api/upload',
      '/api/folder-drop/publish',
      '/api/mbs-cmo/upload',
      '/api/banks/upload',
      '/api/bank-account-statuses/upload',
      '/api/banks/averaged-series/upload',
      '/api/banks/bond-accounting/upload',
      '/api/brokered-cd/wirp/upload',
      '/api/exec-summary/upload'
    ];
    for (const route of ingestRoutes) {
      const res = await request(port, {
        method: 'POST',
        path: route,
        headers: { 'x-iisnode-logon_user': 'FBBS\\ordinaryrep' },
        body: ''
      });
      assert.strictEqual(res.status, 403, `${route}: ${res.status} ${res.text}`);
    }
  });
});

test('iis exec summary reads reject non-admins', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port }) => {
    for (const route of ['/api/exec-summary', '/api/exec-summary/history']) {
      const res = await request(port, {
        method: 'GET',
        path: route,
        headers: { 'x-iisnode-logon_user': 'FBBS\\ordinaryrep' }
      });
      assert.strictEqual(res.status, 403, `${route}: ${res.status} ${res.text}`);
    }
  });
});

test('iis upload fails closed when admin allowlist is empty', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: '' }, async ({ port }) => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: { 'x-iisnode-logon_user': 'FBBS\\adminuser' },
      body: ''
    });
    assert.strictEqual(res.status, 403, res.text);
  });
});

test('cross-site mutating writes are blocked; same-origin and header-absent pass', async () => {
  await withServer({}, async ({ port }) => {
    const blocked = /Cross-site write request blocked/;
    const post = (headers) => request(port, {
      method: 'POST', path: '/api/me/override',
      headers: { 'Content-Type': 'application/json', ...headers }, body: '{}'
    });
    // sec-fetch-site: cross-site -> blocked
    const crossFetch = await post({ 'sec-fetch-site': 'cross-site' });
    assert.strictEqual(crossFetch.status, 403, crossFetch.text);
    assert.ok(blocked.test(crossFetch.text), crossFetch.text);
    // mismatched Origin host -> blocked
    const crossOrigin = await post({ Origin: 'http://evil.example.com' });
    assert.strictEqual(crossOrigin.status, 403, crossOrigin.text);
    assert.ok(blocked.test(crossOrigin.text), crossOrigin.text);
    // same-origin Origin -> passes the guard (route handles it, not a cross-site 403)
    const sameOrigin = await post({ Origin: `http://127.0.0.1:${port}` });
    assert.ok(!blocked.test(sameOrigin.text), `same-origin should pass: ${sameOrigin.status} ${sameOrigin.text}`);
    // no origin signals at all -> default-allow (trusted-LAN posture)
    const bare = await post({});
    assert.ok(!blocked.test(bare.text), `header-absent should pass: ${bare.status} ${bare.text}`);
  });
});

test('my-work surfaces cold accounts; views join lastActivityDate', async () => {
  // Seed the coverage store directly (the activity/coverage POST routes need the
  // full bank-data workbook, which this harness doesn't carry), then exercise
  // the read-only routes the Phase 2 UI consumes.
  const coverageStore = require('../server/bank-coverage-store');
  await withServer({ FBBS_DEFAULT_REP: 'Test Rep' }, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    const touched = { id: 'HT-1', displayName: 'Touched Bank', city: 'Alton', state: 'IL', certNumber: '111' };
    const cold = { id: 'HT-2', displayName: 'Cold Bank', city: 'Pana', state: 'IL', certNumber: '222' };
    coverageStore.upsertSavedBank(reportsDir, touched, { status: 'Client', owner: 'Test Rep', nextActionDate: '2020-01-01' });
    coverageStore.upsertSavedBank(reportsDir, cold, { status: 'Prospect', owner: 'Test Rep' });
    // Fresh manual touch on HT-1 (yesterday) keeps it out of the cold list.
    const fresh = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    coverageStore.recordManualActivity(reportsDir, { bankId: 'HT-1', kind: 'call', subject: 'Check-in', activityDate: fresh });

    const work = await request(port, { path: '/api/me/work' });
    assert.strictEqual(work.status, 200, work.text);
    const coldList = work.json.myColdAccounts;
    assert.ok(coldList && typeof coldList.thresholdDays === 'number', 'myColdAccounts envelope present');
    const coldIds = coldList.items.map(i => i.bankId);
    assert.ok(coldIds.includes('HT-2'), 'never-touched bank is cold');
    assert.ok(!coldIds.includes('HT-1'), 'freshly-touched bank is not cold');
    assert.strictEqual(coldList.items.find(i => i.bankId === 'HT-2').lastActivityDate, '');

    const view = await request(port, { path: '/api/bank-views/stale-follow-ups?rep=all' });
    assert.strictEqual(view.status, 200, view.text);
    assert.ok(view.json.columns.includes('lastActivityDate'), 'follow-ups view exposes lastActivityDate');
    const row = view.json.rows.find(r => r.bankId === 'HT-1');
    assert.ok(row, 'stale follow-up present');
    assert.strictEqual(row.lastActivityDate, fresh);
  });
});

test('unknown /api GET returns 404 JSON, not the SPA shell; unknown non-api path serves the SPA', async () => {
  await withServer({}, async ({ port }) => {
    const api = await request(port, { path: '/api/does-not-exist' });
    assert.strictEqual(api.status, 404, api.text);
    assert.ok(api.json && /not found/i.test(api.json.error || ''), api.text);
    assert.ok(!/<!doctype html>/i.test(api.text), 'API 404 must not be the HTML shell');
    // A non-api unknown path still falls back to the SPA shell (client routing).
    const spa = await request(port, { path: '/some/client/route' });
    assert.strictEqual(spa.status, 200, spa.text);
    assert.ok(/<!doctype html>/i.test(spa.text), 'non-api path should serve index.html');
  });
});

async function main() {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      console.error(`FAIL  ${t.name}`);
      console.error(err.stack || err.message);
      process.exitCode = 1;
    }
  }
  console.log(`server-http tests: ${passed} passed.`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
