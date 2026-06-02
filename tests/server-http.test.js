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
      '/api/brokered-cd/wirp/upload'
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
