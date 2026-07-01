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

// Like request(), but resolves the raw response Buffer instead of decoding
// as UTF-8 text — required for binary payloads (e.g. .xlsx) where text
// decode/re-encode would corrupt bytes.
function requestBinary(port, { method = 'GET', path: requestPath = '/', headers = {}, body = null } = {}) {
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestChunked(port, { method = 'POST', path: requestPath = '/', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers
    }, res => {
      const responseChunks = [];
      res.on('data', chunk => responseChunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(responseChunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.once('error', reject);
    for (const chunk of chunks) req.write(chunk);
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

function testPdf(marker) {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n`);
}

function uploadTmpEntries(dataDir) {
  const dir = path.join(dataDir, '_uploads');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function seedBankData(dataDir, banks, latestPeriod = '2026Q1') {
  const bankImporter = require('../server/bank-data-importer');
  const reportsDir = path.join(dataDir, 'bank-reports');
  bankImporter.writeBankDatabase({
    metadata: {
      importedAt: '2026-07-01T12:00:00.000Z',
      sourceFile: 'server-http-bank-fixture.xlsx',
      latestPeriod,
      bankCount: banks.length,
      rowCount: banks.length,
      fields: bankImporter.BANK_FIELDS
    },
    banks: banks.map(bank => {
      const period = bank.period || latestPeriod;
      const summary = {
        id: bank.id,
        displayName: bank.displayName,
        name: bank.name || bank.displayName,
        city: bank.city || '',
        state: bank.state || '',
        certNumber: bank.certNumber || '',
        parentName: '',
        primaryRegulator: bank.primaryRegulator || 'FDIC',
        period,
        totalAssets: bank.totalAssets || 1000,
        totalDeposits: bank.totalDeposits || 800
      };
      return {
        id: bank.id,
        summary,
        periods: [{
          period,
          endDate: period === '2026Q1' ? '3/31/2026' : '',
          values: { ...summary, period }
        }]
      };
    })
  }, reportsDir);
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

async function withServer(extraEnv, fn, options = {}) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-http-test-'));
  if (options.setupDataDir) options.setupDataDir(dataDir);
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

function makeUploadTemp(dataDir, relPath, ageMs = 0) {
  const filePath = path.join(dataDir, '_uploads', relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'temp');
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, when, when);
  }
  return filePath;
}

test('same-day corrupt replacement preserves existing current slot', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const first = multipartFile('econ', 'economic-update.pdf', testPdf('old econ'));
    const published = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: first.headers,
      body: first.body
    });
    assert.strictEqual(published.status, 200, published.text);
    const econPath = path.join(dataDir, 'current', 'economic-update.pdf');
    assert.ok(fs.readFileSync(econPath, 'utf8').includes('old econ'));

    const corrupt = multipartFile('econ', 'economic-update.pdf', 'not really pdf');
    const rejected = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: corrupt.headers,
      body: corrupt.body
    });
    assert.strictEqual(rejected.status, 400, rejected.text);
    assert.ok(fs.readFileSync(econPath, 'utf8').includes('old econ'));
  });
});

test('dateless current package archives using existing file date', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const currentDir = path.join(dataDir, 'current');
    const oldPath = path.join(currentDir, '20260501.pdf');
    fs.writeFileSync(oldPath, testPdf('old dateless econ'));
    const oldDate = new Date('2026-05-01T12:00:00');
    fs.utimesSync(oldPath, oldDate, oldDate);

    const next = multipartFile('econ', 'economic-update.pdf', testPdf('new econ'));
    const published = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: next.headers,
      body: next.body
    });
    assert.strictEqual(published.status, 200, published.text);
    assert.ok(fs.existsSync(path.join(dataDir, 'archive', '2026-05-01', '20260501.pdf')));
    assert.ok(fs.readFileSync(path.join(currentDir, 'economic-update.pdf'), 'utf8').includes('new econ'));
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
      '/api/banks/bank-1/bond-accounting/upload',
      '/api/brokered-cd/wirp/upload',
      '/api/exec-summary/upload',
      '/api/contacts/import',
      '/api/daily-summary/refresh',
      '/api/sales-dashboard/refresh'
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

test('iis audit log reads reject non-admins', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port }) => {
    const denied = await request(port, {
      path: '/api/audit-log',
      headers: { 'x-iisnode-logon_user': 'FBBS\\ordinaryrep' }
    });
    assert.strictEqual(denied.status, 403, denied.text);

    const allowed = await request(port, {
      path: '/api/audit-log',
      headers: { 'x-iisnode-logon_user': 'FBBS\\adminuser' }
    });
    assert.strictEqual(allowed.status, 200, allowed.text);
    assert.ok(Array.isArray(allowed.json), allowed.text);
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

test('multipart upload rejects declared oversized bodies before parsing', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const boundary = '----fbbs-too-large';
    const res = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String((50 * 1024 * 1024) + 1)
      }
    });
    assert.strictEqual(res.status, 413, res.text);
    assert.ok(/Upload exceeds maximum allowed size/.test(res.text), res.text);
    assert.deepStrictEqual(uploadTmpEntries(dataDir), []);
  });
});

test('multipart upload rejects oversized chunked bodies and removes temp files', async () => {
  await withServer({ MAX_UPLOAD_MB: '1' }, async ({ port, dataDir }) => {
    const upload = multipartFile('econ', 'economic-update.pdf', Buffer.alloc(1024 * 1024, 0x61));
    const chunks = [];
    for (let offset = 0; offset < upload.body.length; offset += 65536) {
      chunks.push(upload.body.slice(offset, offset + 65536));
    }
    const res = await requestChunked(port, {
      method: 'POST',
      path: '/api/upload',
      headers: upload.headers,
      chunks
    });
    assert.strictEqual(res.status, 413, res.text);
    assert.ok(/Upload exceeds maximum allowed size/.test(res.text), res.text);
    assert.deepStrictEqual(uploadTmpEntries(dataDir), []);
  });
});

test('multipart upload removes temp files after successful publish', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const upload = multipartFile('econ', 'economic-update.pdf', testPdf('streamed econ'));
    const res = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: upload.headers,
      body: upload.body
    });
    assert.strictEqual(res.status, 200, res.text);
    assert.deepStrictEqual(uploadTmpEntries(dataDir), []);
  });
});

test('multipart upload removes temp files after validation failure', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const upload = multipartFile('econ', 'economic-update.pdf', 'not a pdf');
    const res = await request(port, {
      method: 'POST',
      path: '/api/upload',
      headers: upload.headers,
      body: upload.body
    });
    assert.strictEqual(res.status, 400, res.text);
    assert.deepStrictEqual(uploadTmpEntries(dataDir), []);
  });
});

test('multipart upload removes temp files after thrown import handler error', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    const upload = multipartFile('bankWorkbook', 'banks.xlsx', fakeZip);
    const res = await request(port, {
      method: 'POST',
      path: '/api/banks/upload',
      headers: upload.headers,
      body: upload.body
    });
    assert.ok(res.status >= 400, res.text);
    assert.deepStrictEqual(uploadTmpEntries(dataDir), []);
  });
});

test('startup removes stale upload temp files and nested stale directories', async () => {
  const oldMs = 48 * 60 * 60 * 1000;
  await withServer({}, async ({ dataDir }) => {
    assert.strictEqual(fs.existsSync(path.join(dataDir, '_uploads', 'stale.tmp')), false);
    assert.strictEqual(fs.existsSync(path.join(dataDir, '_uploads', 'nested')), false);
    assert.ok(fs.existsSync(path.join(dataDir, '_uploads')), '_uploads root should be preserved');
  }, {
    setupDataDir(dataDir) {
      makeUploadTemp(dataDir, 'stale.tmp', oldMs);
      const nested = makeUploadTemp(dataDir, path.join('nested', 'child.tmp'), oldMs);
      const when = new Date(Date.now() - oldMs);
      fs.utimesSync(path.dirname(nested), when, when);
    }
  });
});

test('startup preserves fresh upload temp files', async () => {
  await withServer({}, async ({ dataDir }) => {
    assert.ok(fs.existsSync(path.join(dataDir, '_uploads', 'fresh.tmp')));
  }, {
    setupDataDir(dataDir) {
      makeUploadTemp(dataDir, 'fresh.tmp');
    }
  });
});

test('startup tolerates missing upload temp directory', async () => {
  await withServer({}, async ({ dataDir }) => {
    assert.strictEqual(fs.existsSync(path.join(dataDir, '_uploads')), false);
  });
});

test('startup upload temp cleanup failure does not prevent health', async () => {
  if (process.platform === 'win32') return;
  const oldMs = 48 * 60 * 60 * 1000;
  let stalePreserved = false;
  const output = await withServer({ LOG_LEVEL: 'warn' }, async ({ dataDir }) => {
    const uploadDir = path.join(dataDir, '_uploads');
    const stale = path.join(uploadDir, 'stale-locked.tmp');
    stalePreserved = fs.existsSync(stale);
    fs.chmodSync(uploadDir, 0o755);
    assert.ok(stalePreserved, 'stale file should remain when cleanup cannot remove it');
  }, {
    setupDataDir(dataDir) {
      const stale = makeUploadTemp(dataDir, 'stale-locked.tmp', oldMs);
      const uploadDir = path.dirname(stale);
      fs.chmodSync(uploadDir, 0o555);
    }
  });
  if (stalePreserved) {
    assert.match(output, /Upload temp cleanup file remove failed/, output);
  }
});

test('iis crm rollups collapse non-admin all/other-rep scope to self', async () => {
  const coverageStore = require('../server/bank-coverage-store');
  const statusStore = require('../server/bank-account-status-store');
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    const jimBank = { id: 'AUTH-1', displayName: 'Jim Client', city: 'Austin', state: 'TX', certNumber: '101' };
    const danBank = { id: 'AUTH-2', displayName: 'Dan Client', city: 'Springfield', state: 'MO', certNumber: '202' };
    seedBankData(dataDir, [jimBank, danBank]);
    statusStore.upsertBankAccountStatus(reportsDir, jimBank, { status: 'Client', owner: 'Jim Lewis' });
    statusStore.upsertBankAccountStatus(reportsDir, danBank, { status: 'Client', owner: 'Dan Hagemann' });
    coverageStore.upsertSavedBank(reportsDir, jimBank, { status: 'Client', owner: 'Jim Lewis' });
    coverageStore.upsertSavedBank(reportsDir, danBank, { status: 'Client', owner: 'Dan Hagemann' });
    coverageStore.createBankOpportunity(reportsDir, {
      bankId: 'AUTH-1',
      product: 'Bond Swap',
      estValue: 25000,
      owner: 'jimlewis',
      ownerDisplay: 'Jim Lewis'
    });
    coverageStore.createBankOpportunity(reportsDir, {
      bankId: 'AUTH-2',
      product: 'CD',
      estValue: 50000,
      owner: 'danhagemann',
      ownerDisplay: 'Dan Hagemann'
    });
    coverageStore.recordManualActivity(reportsDir, {
      bankId: 'AUTH-1',
      kind: 'call',
      subject: 'Jim call',
      activityDate: '2026-06-01',
      actorUsername: 'jimlewis',
      actorDisplay: 'Jim Lewis'
    });
    coverageStore.recordManualActivity(reportsDir, {
      bankId: 'AUTH-2',
      kind: 'call',
      subject: 'Dan call',
      activityDate: '2026-06-01',
      actorUsername: 'danhagemann',
      actorDisplay: 'Dan Hagemann'
    });

    const jimHeaders = { 'x-iisnode-logon_user': 'FBBS\\jimlewis' };
    const adminHeaders = { 'x-iisnode-logon_user': 'FBBS\\adminuser' };

    const me = await request(port, { path: '/api/me', headers: { ...jimHeaders, cookie: 'fbbs_rep_override=Dan%20Hagemann%7Cdanhagemann' } });
    assert.strictEqual(me.status, 200, me.text);
    assert.strictEqual(me.json.rep.username, 'jimlewis');
    assert.strictEqual(me.json.rep.source, 'iis');
    assert.strictEqual(me.json.auth.allowRepOverride, false);
    assert.strictEqual(me.json.auth.isAdmin, false);

    const dashboard = await request(port, { path: '/api/crm/dashboard?rep=all', headers: jimHeaders });
    assert.strictEqual(dashboard.status, 200, dashboard.text);
    assert.strictEqual(dashboard.json.rep.username, 'jimlewis');
    assert.strictEqual(dashboard.json.kpis.totalClients, 1);
    assert.deepStrictEqual(dashboard.json.byState.map(r => r.state), ['TX']);

    const bankView = await request(port, { path: '/api/bank-views/clients?rep=all', headers: jimHeaders });
    assert.strictEqual(bankView.status, 200, bankView.text);
    assert.strictEqual(bankView.json.meta.rep.username, 'jimlewis');
    assert.deepStrictEqual(bankView.json.rows.map(r => r.bankId), ['AUTH-1']);

    const pipeline = await request(port, { path: '/api/reports/pipeline?rep=all', headers: jimHeaders });
    assert.strictEqual(pipeline.status, 200, pipeline.text);
    assert.strictEqual(pipeline.json.rep.username, 'jimlewis');
    assert.strictEqual(pipeline.json.pipeline.open.count, 1);
    assert.strictEqual(pipeline.json.pipeline.open.value, 25000);

    const activity = await request(port, { path: '/api/reports/activity-summary?from=2026-01-01&reps=danhagemann', headers: jimHeaders });
    assert.strictEqual(activity.status, 200, activity.text);
    assert.strictEqual(activity.json.rep.username, 'jimlewis');
    assert.deepStrictEqual(activity.json.rows.map(r => r.rep), ['jimlewis']);

    const touch = await request(port, { path: '/api/reports/account-touch?days=20&owner=Dan', headers: jimHeaders });
    assert.strictEqual(touch.status, 200, touch.text);
    assert.strictEqual(touch.json.rep.username, 'jimlewis');
    assert.deepStrictEqual(touch.json.rows.map(r => r.bankId), ['AUTH-1']);

    const adminDashboard = await request(port, { path: '/api/crm/dashboard?rep=all', headers: adminHeaders });
    assert.strictEqual(adminDashboard.status, 200, adminDashboard.text);
    assert.strictEqual(adminDashboard.json.rep, null);
    assert.strictEqual(adminDashboard.json.kpis.totalClients, 2);

    const auditPath = path.join(dataDir, 'audit.log');
    const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';
    assert.ok(audit.includes('crm-dashboard-scope-collapsed'), audit);
    assert.ok(audit.includes('bank-views-run-scope-collapsed'), audit);
    assert.ok(audit.includes('pipeline-scope-collapsed'), audit);
  });
});

test('iis mode rejects api requests with no windows identity (anonymous lockout)', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port }) => {
    // /api/health is the only public path — still served without an identity.
    const health = await request(port, { path: '/api/health' });
    assert.strictEqual(health.status, 200, health.text);
    // A protected route with no forwarded Windows login is refused, not served anonymously.
    const denied = await request(port, { path: '/api/crm/dashboard' });
    assert.strictEqual(denied.status, 401, denied.text);
    // The same route resolves once IIS forwards the logon user.
    const ok = await request(port, { path: '/api/crm/dashboard', headers: { 'x-iisnode-logon_user': 'FBBS\\adminuser' } });
    assert.strictEqual(ok.status, 200, ok.text);
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

test('iis mode requires a same-origin signal for mutating writes', async () => {
  await withServer({ FBBS_AUTH_MODE: 'iis', FBBS_ADMIN_USERS: 'adminuser' }, async ({ port }) => {
    const blocked = /Cross-site write request blocked/;
    const body = JSON.stringify({ kind: 'security', refId: '123456AB9', label: 'Test bond', assetClass: 'Muni', page: 'muni-explorer' });
    const baseHeaders = {
      'Content-Type': 'application/json',
      'x-iisnode-logon_user': 'FBBS\\adminuser'
    };
    const bare = await request(port, {
      method: 'POST',
      path: '/api/me/watchlist',
      headers: baseHeaders,
      body
    });
    assert.strictEqual(bare.status, 403, bare.text);
    assert.ok(blocked.test(bare.text), bare.text);

    const sameOrigin = await request(port, {
      method: 'POST',
      path: '/api/me/watchlist',
      headers: { ...baseHeaders, 'sec-fetch-site': 'same-origin' },
      body
    });
    assert.strictEqual(sameOrigin.status, 200, sameOrigin.text);
  });
});

test('new go-live read APIs return JSON envelopes without seeded data', async () => {
  await withServer({ ANTHROPIC_API_KEY: '' }, async ({ port, dataDir }) => {
    writeJson(path.join(dataDir, 'current', '_meta.json'), { date: '2026-06-22' });
    const routes = [
      '/api/daily-summary',
      '/api/sales-dashboard',
      '/api/cd-rollover-wall?window=90',
      '/api/maturity-calendar?window=90',
      '/api/offerings/all'
    ];
    for (const route of routes) {
      const res = await request(port, { path: route });
      assert.strictEqual(res.status, 200, `${route}: ${res.status} ${res.text}`);
      assert.ok(res.json && typeof res.json === 'object', `${route}: JSON envelope`);
    }
  });
});

test('sales dashboard GET treats degraded and pre-RV caches as stale', async () => {
  const seedPackage = dataDir => {
    writeJson(path.join(dataDir, 'current', '_meta.json'), { date: '2026-06-22' });
    writeJson(path.join(dataDir, 'current', '_agencies.json'), {
      offerings: [
        { cusip: '3130AAAA1', ticker: 'FHLB', structure: 'Bullet', coupon: '4.50', ytm: '4.70', askPrice: '99.50', maturity: '2029-06-15', availableSize: 1 },
        { cusip: '3130BBBB2', ticker: 'FFCB', structure: 'Bullet', coupon: '4.75', ytm: '4.85', askPrice: '100.00', maturity: '2030-06-15', availableSize: 1 },
        { cusip: '3130CCCC3', ticker: 'FHLMC', structure: 'Bullet', coupon: '5.00', ytm: '5.05', askPrice: '99.25', maturity: '2031-06-15', availableSize: 1 }
      ]
    });
    writeJson(path.join(dataDir, 'market', 'market-color-feed.json'), {
      fetchedAt: '2026-06-22T13:00:00.000Z',
      feeds: {
        'cnbc-markets': {
          fetchedAt: '2026-06-22T13:00:00.000Z',
          items: [{ title: 'Treasury yields rise as investors watch Fed data', url: 'https://example.com/markets', summary: '', publishedAt: '2026-06-22T12:55:00.000Z', tags: ['rates'] }]
        }
      }
    });
    writeJson(path.join(dataDir, 'market', 'market-wire-indicators.json'), {
      fetchedAt: '2026-06-22T13:00:00.000Z',
      indicators: {
        cpiYoY: { value: 3.1, period: 'May 2026', source: 'BLS CPI-U' },
        unemployment: { value: 4.0, period: 'May 2026', source: 'BLS' }
      }
    });
  };

  await withServer({ ANTHROPIC_API_KEY: '' }, async ({ port, dataDir }) => {
    seedPackage(dataDir);
    writeJson(path.join(dataDir, 'market', 'daily-dashboard.json'), {
      packageDate: '2026-06-22',
      picks: {},
      connector: {},
      rv: { leaders: [] },
      degraded: true,
      modelError: 'simulated failure'
    });
    const res = await request(port, { path: '/api/sales-dashboard' });
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.json.stale, true, res.text);
    assert.strictEqual(res.json.cached, false, res.text);
    assert.ok(res.json.dashboard && res.json.dashboard.aiGenerated === false, res.text);
    assert.ok(Array.isArray(res.json.sources), 'sales dashboard sources present');
    assert.ok(res.json.sources.some(s => s.key === 'agency' && s.ready && s.count === 3), 'agency source count present');
    assert.ok(Array.isArray(res.json.catalysts), 'sales dashboard catalysts present');
    assert.ok(res.json.catalysts.some(c => c.kind === 'news' && /Treasury yields/i.test(c.text)), 'market color catalyst present');
    assert.ok(res.json.catalysts.some(c => c.kind === 'data' && /CPI YoY 3.1%/.test(c.text)), 'data catalyst present');
  });

  await withServer({ ANTHROPIC_API_KEY: '' }, async ({ port, dataDir }) => {
    seedPackage(dataDir);
    writeJson(path.join(dataDir, 'market', 'daily-dashboard.json'), {
      packageDate: '2026-06-22',
      picks: {},
      connector: {}
    });
    const res = await request(port, { path: '/api/sales-dashboard' });
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.json.stale, true, res.text);
    assert.strictEqual(res.json.cached, false, res.text);
    assert.ok(res.json.dashboard && res.json.dashboard.rv, res.text);
  });
});

test('go-live status includes AI, integration, and process readiness sections', async () => {
  await withServer({ ANTHROPIC_API_KEY: '', FRED_API_KEY: '' }, async ({ port, dataDir }) => {
    writeJson(path.join(dataDir, 'current', '_meta.json'), { date: new Date().toISOString().slice(0, 10) });
    const res = await request(port, { path: '/api/admin/go-live-status' });
    assert.strictEqual(res.status, 200, res.text);
    assert.ok(Array.isArray(res.json.checks) && res.json.checks.length, 'checks present');
    assert.ok(res.json.checks.some(check => check.id === 'ai-cache'), 'AI cache check present');
    assert.ok(res.json.checks.some(check => check.id === 'market-cache'), 'market cache check present');
    assert.ok(res.json.ai && Array.isArray(res.json.ai.caches), 'AI cache detail present');
    assert.ok(res.json.integrations && Array.isArray(res.json.integrations.marketCaches), 'integration cache detail present');
    assert.ok(res.json.process && res.json.process.build && res.json.process.node, 'process detail present');
    assert.ok(res.json.checks.some(check => check.id === 'upload-temp'), 'upload temp check present');
    assert.ok(res.json.data && res.json.data.uploadTemp, 'upload temp detail present');
    assert.strictEqual(res.json.data.uploadTemp.staleCleanupHours, 24, 'upload temp cleanup age documented');
    assert.ok(!Array.isArray(res.json.data.uploadTemp.files), 'upload temp details should not expose filenames');
  });
});

test('all offerings preserves blank YTNC as null and ranks bullets by YTM', async () => {
  await withServer({}, async ({ port, dataDir }) => {
    const currentDir = path.join(dataDir, 'current');
    writeJson(path.join(currentDir, '_meta.json'), { date: '2026-06-22' });
    writeJson(path.join(currentDir, '_agencies.json'), {
      offerings: [
        {
          cusip: '3130B6R24',
          ticker: 'FHLB',
          structure: 'Bullet',
          coupon: 3.875,
          ytm: 4.054,
          ytnc: '',
          maturity: '2027-06-04',
          askPrice: 99.833,
          availableSize: 4.37
        }
      ]
    });
    writeJson(path.join(currentDir, '_corporates.json'), {
      offerings: [
        {
          cusip: '855244BG3',
          issuerName: 'STARBUCKS CORP',
          sector: 'Consumer',
          coupon: 4,
          ytm: 4.153,
          ytnc: null,
          maturity: '2029-01-01',
          askPrice: 100,
          availableSize: 1500
        }
      ]
    });

    const res = await request(port, { path: '/api/offerings/all' });
    assert.strictEqual(res.status, 200, res.text);
    const agency = res.json.rows.find(r => r.cusip === '3130B6R24');
    const corp = res.json.rows.find(r => r.cusip === '855244BG3');
    assert.ok(agency, 'agency row present');
    assert.strictEqual(agency.ytnc, null);
    assert.strictEqual(agency.yield, 4.054);
    assert.strictEqual(agency.availabilityK, 4370);
    assert.ok(corp, 'corporate row present');
    assert.strictEqual(corp.ytnc, null);
    assert.strictEqual(corp.yield, 4.153);
    assert.strictEqual(corp.availabilityK, 1500);
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
    seedBankData(dataDir, [touched, cold]);
    coverageStore.upsertSavedBank(reportsDir, touched, { status: 'Client', owner: 'Test Rep' });
    coverageStore.upsertSavedBank(reportsDir, cold, { status: 'Prospect', owner: 'Test Rep' });
    // An overdue open task makes HT-1 a "stale follow-up" (the post-consolidation
    // successor to next_action_date).
    coverageStore.createBankTask(reportsDir, { bankId: 'HT-1', title: 'Follow up', dueDate: '2020-01-01' });
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

test('tear sheet fetch and coverage save stay reachable for a bank with stale financials', async () => {
  // The current-bank freshness filter (bank-data-importer.js) is meant to
  // keep zombie/M&A rows out of discovery surfaces (search/maps/reports),
  // not to 404 a bank a rep already knows by ID and is actively covering.
  await withServer({}, async ({ port, dataDir }) => {
    const current = { id: 'FR-1', displayName: 'Current Bank', city: 'Alton', state: 'IL', certNumber: '111' };
    // Three quarters behind latestPeriod (2026Q1) — well outside the
    // 1-quarter freshness window, so this bank is "stale" for search/maps.
    const stale = { id: 'FR-2', displayName: 'Long-Covered Bank', city: 'Pana', state: 'IL', certNumber: '222', period: '2025Q1' };
    seedBankData(dataDir, [current, stale]);

    const tearSheet = await request(port, { path: '/api/banks/FR-2' });
    assert.strictEqual(tearSheet.status, 200, tearSheet.text);
    assert.strictEqual(tearSheet.json.bank && tearSheet.json.bank.id, 'FR-2');

    const save = await request(port, {
      method: 'POST',
      path: '/api/bank-coverage',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankId: 'FR-2', status: 'Client', owner: 'Test Rep' })
    });
    assert.strictEqual(save.status, 200, save.text);

    // Discovery surfaces still exclude it by default.
    const search = await request(port, { path: '/api/banks/search?q=Long-Covered' });
    assert.strictEqual(search.status, 200, search.text);
    assert.ok(!search.json.results.some(r => r.id === 'FR-2'), 'stale bank stays out of search results');
  });
});

test('bank activity route rejects contact IDs from another bank', async () => {
  const bankImporter = require('../server/bank-data-importer');
  const coverageStore = require('../server/bank-coverage-store');
  await withServer({}, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const banks = [
      { id: 'ACT-1', displayName: 'Activity One Bank', city: 'Alton', state: 'IL', certNumber: '101' },
      { id: 'ACT-2', displayName: 'Activity Two Bank', city: 'Pana', state: 'IL', certNumber: '202' }
    ].map(summary => ({
      id: summary.id,
      summary: { ...summary, name: summary.displayName, period: '2026Q1' },
      periods: [{ period: '2026Q1', endDate: '2026-03-31', values: { name: summary.displayName, city: summary.city, state: summary.state, certNumber: summary.certNumber } }]
    }));
    bankImporter.writeBankDatabase({
      metadata: { importedAt: '2026-06-25T00:00:00.000Z', sourceFile: 'test', latestPeriod: '2026Q1', bankCount: 2, rowCount: 2, fields: bankImporter.BANK_FIELDS },
      banks
    }, reportsDir);
    const validContact = coverageStore.createBankContact(reportsDir, banks[0].summary, { name: 'Valid Contact' });
    const otherContact = coverageStore.createBankContact(reportsDir, banks[1].summary, { name: 'Other Contact' });
    const headers = { 'Content-Type': 'application/json' };
    const baseBody = { kind: 'call', subject: 'Check-in', activityDate: '2026-06-25' };

    const bad = await request(port, {
      method: 'POST',
      path: '/api/banks/ACT-1/activity',
      headers,
      body: JSON.stringify({ ...baseBody, contactId: otherContact.id })
    });
    assert.strictEqual(bad.status, 400, bad.text);
    assert.match(bad.json.error, /does not belong/i);

    const good = await request(port, {
      method: 'POST',
      path: '/api/banks/ACT-1/activity',
      headers,
      body: JSON.stringify({ ...baseBody, contactId: validContact.id })
    });
    assert.strictEqual(good.status, 200, good.text);
    assert.strictEqual(good.json.activity.contactId, validContact.id);

    const doNotCall = coverageStore.createBankContact(reportsDir, banks[0].summary, {
      name: 'Do Not Call Contact',
      doNotCall: true
    });
    const blockedCall = await request(port, {
      method: 'POST',
      path: '/api/banks/ACT-1/activity',
      headers,
      body: JSON.stringify({ ...baseBody, contactId: doNotCall.id })
    });
    assert.strictEqual(blockedCall.status, 400, blockedCall.text);
    assert.match(blockedCall.json.error, /do not call/i);

    const emailOptOut = coverageStore.createBankContact(reportsDir, banks[0].summary, {
      name: 'Email Opt Out Contact',
      optOutEmail: true
    });
    const blockedEmail = await request(port, {
      method: 'POST',
      path: '/api/banks/ACT-1/activity',
      headers,
      body: JSON.stringify({ ...baseBody, kind: 'email', contactId: emailOptOut.id })
    });
    assert.strictEqual(blockedEmail.status, 400, blockedEmail.text);
    assert.match(blockedEmail.json.error, /email/i);

    const auditPath = path.join(dataDir, 'audit.log');
    const auditEntries = fs.existsSync(auditPath)
      ? fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
      : [];
    assert.ok(auditEntries.some(entry =>
      entry.event === 'bank-activity-blocked' &&
      entry.bankId === 'ACT-1' &&
      entry.contactId === doNotCall.id &&
      entry.kind === 'call' &&
      entry.reason === 'do-not-call'
    ), JSON.stringify(auditEntries));
    assert.ok(auditEntries.some(entry =>
      entry.event === 'bank-activity-blocked' &&
      entry.bankId === 'ACT-1' &&
      entry.contactId === emailOptOut.id &&
      entry.kind === 'email' &&
      entry.reason === 'email-opt-out'
    ), JSON.stringify(auditEntries));
  });
});

test('reports xlsx export streams a real workbook with numeric cells and a formula-injection guard', async () => {
  await withServer({}, async ({ port }) => {
    const XLSX = require('../server/xlsx');
    const headers = ['Bank', 'Assets', 'Note'];
    const rows = [
      ['Acme Bank', 123456.78, 'normal text'],
      ['Zero Bank', 0, '=SUM(1,2)']
    ];
    const res = await requestBinary(port, {
      method: 'POST',
      path: '/api/reports/export/xlsx',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetName: 'Custom Bank Report', filename: 'custom_bank_report_2026-06-30.xlsx', headers, rows })
    });
    assert.strictEqual(res.status, 200, res.buffer.toString('utf8').slice(0, 300));
    assert.strictEqual(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(res.headers['content-disposition'], /attachment; filename="custom_bank_report_2026-06-30\.xlsx"/);
    assert.ok(res.buffer.length > 0, 'response body is a non-empty binary buffer');

    const workbook = XLSX.read(res.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets['Custom Bank Report'];
    assert.ok(sheet, 'sheet is present under the requested name');
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.deepStrictEqual(table[0], headers);
    assert.strictEqual(table[1][0], 'Acme Bank');
    assert.strictEqual(typeof table[1][1], 'number', 'money value round-trips as a number, not display text');
    assert.strictEqual(table[1][1], 123456.78);
    assert.strictEqual(table[2][1], 0, 'a legitimate zero survives (not coerced to blank)');
    assert.strictEqual(table[2][2], "'=SUM(1,2)", 'a formula-shaped string is neutralized with a leading quote, not left executable');

    const empty = await request(port, {
      method: 'POST',
      path: '/api/reports/export/xlsx',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers: [], rows: [] })
    });
    assert.strictEqual(empty.status, 400, empty.text);
    assert.match(empty.json.error, /no data/i);
  });
});

test('activity-summary and account-touch report routes aggregate manual activities', async () => {
  const coverageStore = require('../server/bank-coverage-store');
  await withServer({}, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    const a = { id: 'AR-1', displayName: 'Alpha Bank', city: 'Alton', state: 'IL', certNumber: '11' };
    const b = { id: 'AR-2', displayName: 'Beta Bank', city: 'Pana', state: 'MO', certNumber: '22' };
    seedBankData(dataDir, [a, b]);
    coverageStore.upsertSavedBank(reportsDir, a, { status: 'Client', owner: 'Jim Lewis' });
    coverageStore.upsertSavedBank(reportsDir, b, { status: 'Prospect', owner: 'Dan Hagemann' });
    const today = new Date().toISOString().slice(0, 10);
    coverageStore.recordManualActivity(reportsDir, { bankId: 'AR-1', kind: 'call', subject: 'c1', activityDate: today, actorUsername: 'jim', actorDisplay: 'Jim Lewis' });
    coverageStore.recordManualActivity(reportsDir, { bankId: 'AR-1', kind: 'email', subject: 'e1', activityDate: today, actorUsername: 'jim', actorDisplay: 'Jim Lewis' });
    coverageStore.recordManualActivity(reportsDir, { bankId: 'AR-2', kind: 'call', subject: 'c2', activityDate: '2020-06-01', actorUsername: 'dan', actorDisplay: 'Dan Hagemann' });

    // By-rep view, current month: jim has 1 call + 1 email; dan's 2020 call is outside the window.
    const byRep = await request(port, { path: '/api/reports/activity-summary' });
    assert.strictEqual(byRep.status, 200, byRep.text);
    const jim = byRep.json.rows.find(r => r.rep === 'jim');
    assert.ok(jim, 'jim aggregated');
    assert.strictEqual(jim.call, 1);
    assert.strictEqual(jim.email, 1);
    assert.strictEqual(jim.total, 2);
    assert.ok(!byRep.json.rows.some(r => r.rep === 'dan'), 'out-of-window rep excluded');

    // By-bank view over an explicit window that includes both.
    const byBank = await request(port, { path: '/api/reports/activity-summary?view=bank&from=2020-01-01' });
    assert.strictEqual(byBank.status, 200, byBank.text);
    const alpha = byBank.json.rows.find(r => r.bankId === 'AR-1');
    assert.ok(alpha && alpha.displayName === 'Alpha Bank' && alpha.total === 2, byBank.text);

    // Account touch at 30 days: beta's last touch was 2020 → neglected; alpha touched today → excluded.
    const touch = await request(port, { path: '/api/reports/account-touch?days=30' });
    assert.strictEqual(touch.status, 200, touch.text);
    const ids = touch.json.rows.map(r => r.bankId);
    assert.ok(ids.includes('AR-2'), 'stale bank included');
    assert.ok(!ids.includes('AR-1'), 'freshly-touched bank excluded');
    const beta = touch.json.rows.find(r => r.bankId === 'AR-2');
    assert.ok(beta.daysSinceContact > 1000, 'days since contact computed');

    // Status filter narrows the touch report.
    const clientsOnly = await request(port, { path: '/api/reports/account-touch?days=30&statuses=Client' });
    assert.strictEqual(clientsOnly.json.rows.length, 0, 'beta is a Prospect, filtered out');
  });
});

test('crm dashboard aggregates KPIs, by-state, activity, and follow-ups', async () => {
  const coverageStore = require('../server/bank-coverage-store');
  const statusStore = require('../server/bank-account-status-store');
  await withServer({}, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    const cd1 = { id: 'CD-1', displayName: 'TX Client', city: 'Austin', state: 'TX', certNumber: '1' };
    const cd2 = { id: 'CD-2', displayName: 'TX Prospect', city: 'Waco', state: 'TX', certNumber: '2' };
    const cd3 = { id: 'CD-3', displayName: 'MO Client', city: 'Alton', state: 'MO', certNumber: '3' };
    seedBankData(dataDir, [cd1, cd2, cd3]);
    statusStore.upsertBankAccountStatus(reportsDir, cd1, { status: 'Client', owner: 'Jim Lewis' });
    statusStore.upsertBankAccountStatus(reportsDir, cd2, { status: 'Prospect', owner: 'Jim Lewis' });
    statusStore.upsertBankAccountStatus(reportsDir, cd3, { status: 'Client', owner: 'Dan Hagemann' });
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    coverageStore.upsertSavedBank(reportsDir, cd1, { status: 'Client', owner: 'Jim Lewis' });
    // Upcoming follow-up = an open task due within the 14-day horizon.
    coverageStore.createBankTask(reportsDir, { bankId: 'CD-1', title: 'Quarterly review', dueDate: soon });
    coverageStore.recordManualActivity(reportsDir, { bankId: 'CD-1', kind: 'call', subject: 'Quarterly check-in', actorUsername: 'jim', actorDisplay: 'Jim Lewis' });

    const res = await request(port, { path: '/api/crm/dashboard' });
    assert.strictEqual(res.status, 200, res.text);
    const d = res.json;
    assert.strictEqual(d.kpis.totalClients, 2);
    assert.strictEqual(d.kpis.totalProspects, 1);
    const tx = d.byState.find(r => r.state === 'TX');
    assert.ok(tx && tx.clients === 1 && tx.prospects === 1, JSON.stringify(d.byState));
    assert.strictEqual(d.recentActivities.length, 1);
    assert.strictEqual(d.recentActivities[0].bankName, 'TX Client');
    assert.strictEqual(d.recentActivities[0].kind, 'call');
    assert.ok(d.upcomingFollowups.some(f => f.bankId === 'CD-1' && f.nextActionDate === soon), 'upcoming follow-up listed');
    assert.strictEqual(d.rep, null, 'no acting rep → firm-wide');
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

test('swap proposal create supports manual RIA clients without a bank record', async () => {
  await withServer({}, async ({ port }) => {
    const body = JSON.stringify({
      clientName: 'Oak Hill Wealth',
      taxStatus: 'RIA / Money Manager',
      taxRate: 0,
      isSubchapterS: null,
      preparedFor: 'Oak Hill Wealth',
      title: 'Bond Swap — Oak Hill Wealth'
    });
    const created = await request(port, {
      method: 'POST',
      path: '/api/swap-proposals',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    assert.strictEqual(created.status, 200, created.text);
    assert.match(created.json.proposal.bankId, /^manual-ria-/);
    assert.strictEqual(created.json.proposal.preparedFor, 'Oak Hill Wealth');
    assert.strictEqual(created.json.proposal.taxRate, 0);
    assert.strictEqual(created.json.proposal.isSubchapterS, null);

    const fetched = await request(port, { path: `/api/swap-proposals/${created.json.proposal.id}` });
    assert.strictEqual(fetched.status, 200, fetched.text);
    assert.strictEqual(fetched.json.proposal.preparedFor, 'Oak Hill Wealth');
  });
});

test('swap proposal lifecycle: send-gating, strategy link, execute/cancel guards, relink', async () => {
  // Seed proposals straight into the server's swap store (the create route needs
  // the bank workbook, which this harness doesn't carry). The server reads the
  // same sqlite file, so the lifecycle routes operate on what we seed.
  const swapStore = require('../server/swap-store');
  await withServer({}, async ({ port, dataDir }) => {
    const reportsDir = path.join(dataDir, 'bank-reports');
    const base = { proposalDate: '2026-06-18', settleDate: '2026-06-19', horizonYears: 3 };

    // Incomplete legs → send is blocked with a structured issues[] list.
    const incomplete = swapStore.createProposal(reportsDir, { bankId: 'BANK-X', ...base });
    swapStore.addLeg(reportsDir, incomplete.proposal.id, { side: 'sell', cusip: 'S0', par: 100000 });
    swapStore.addLeg(reportsDir, incomplete.proposal.id, { side: 'buy', cusip: 'B0', par: 100000 });
    const blocked = await request(port, { method: 'POST', path: `/api/swap-proposals/${incomplete.proposal.id}/send` });
    assert.strictEqual(blocked.status, 400, blocked.text);
    assert.ok(Array.isArray(blocked.json.issues) && blocked.json.issues.length, 'send returns issues[] for incomplete legs');

    // Complete legs → send freezes + links a Strategies-queue entry.
    const p = swapStore.createProposal(reportsDir, { bankId: 'BANK-X', ...base });
    swapStore.addLeg(reportsDir, p.proposal.id, { side: 'sell', cusip: 'SELL1', par: 100000, coupon: 2.5, maturity: '2031-06-15', bookPrice: 99.5, marketPrice: 95.0 });
    swapStore.addLeg(reportsDir, p.proposal.id, { side: 'buy', cusip: 'BUY1', par: 100000, coupon: 4.5, maturity: '2031-06-15', marketPrice: 100.0 });
    const sent = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/send` });
    assert.strictEqual(sent.status, 200, sent.text);
    assert.strictEqual(sent.json.proposal.status, 'sent');
    assert.ok(sent.json.proposal.strategyId, 'send links a strategy even without a bank summary (minimal fallback)');

    // Re-send is blocked once frozen.
    const resend = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/send` });
    assert.strictEqual(resend.status, 409, 'cannot re-send a sent proposal');

    // Execute once; second execute is blocked (status no longer 'sent').
    const exec = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/execute` });
    assert.strictEqual(exec.status, 200, exec.text);
    assert.strictEqual(exec.json.proposal.status, 'executed');
    const exec2 = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/execute` });
    assert.strictEqual(exec2.status, 409, 'cannot execute twice');

    // An executed (booked) proposal cannot be cancelled.
    const cancelExecuted = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/cancel` });
    assert.strictEqual(cancelExecuted.status, 409, 'executed proposals cannot be cancelled');

    // Relink: a draft is rejected (the link is created on send); an
    // already-linked proposal returns 200 idempotently with its strategyId.
    const draft = swapStore.createProposal(reportsDir, { bankId: 'BANK-Y', ...base });
    const relinkDraft = await request(port, { method: 'POST', path: `/api/swap-proposals/${draft.proposal.id}/relink-strategy` });
    assert.strictEqual(relinkDraft.status, 409, 'cannot relink a draft');
    const relinkLinked = await request(port, { method: 'POST', path: `/api/swap-proposals/${p.proposal.id}/relink-strategy` });
    assert.strictEqual(relinkLinked.status, 200, relinkLinked.text);
    assert.strictEqual(relinkLinked.json.proposal.strategyId, sent.json.proposal.strategyId, 'relink is idempotent on a linked proposal');

    // Unknown proposal → 404 on a lifecycle route.
    const missing = await request(port, { method: 'POST', path: '/api/swap-proposals/SP-9999-9999/send' });
    assert.strictEqual(missing.status, 404, missing.text);
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
