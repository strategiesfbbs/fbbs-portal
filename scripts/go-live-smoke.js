'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.once('error', reject);
  });
}

async function waitForHealth(port, child) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 10000) {
    if (child.exitCode != null) {
      throw new Error(`Portal exited before health check; code=${child.exitCode}`);
    }
    try {
      const res = await request(port, '/api/health');
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Portal did not become healthy');
}

function seedSyntheticPackage(dataDir) {
  const currentDir = path.join(dataDir, 'current');
  const today = new Date().toISOString().slice(0, 10);
  writeJson(path.join(currentDir, '_meta.json'), {
    date: today,
    publishedAt: new Date().toISOString(),
    econ: 'Economic_Update.pdf',
    relativeValue: 'Relative_Value.pdf',
    mmd: 'MMD.pdf',
    treasuryNotes: 'Treasury_Notes.xlsx',
    cd: 'Brokered_CD.pdf',
    cdoffers: 'CD_Offers.xlsx',
    munioffers: 'Muni_Offerings.pdf',
    agenciesBullets: 'Agencies_Bullets.xlsx',
    agenciesCallables: 'Agencies_Callables.xlsx',
    corporates: 'Corporates.xlsx'
  });
  writeJson(path.join(currentDir, '_agencies.json'), {
    offerings: [{
      cusip: '3130B6R24',
      ticker: 'FHLB',
      structure: 'Bullet',
      coupon: 3.875,
      ytm: 4.054,
      ytnc: '',
      maturity: '2027-06-04',
      askPrice: 99.833,
      availableSize: 4.37
    }]
  });
  writeJson(path.join(currentDir, '_corporates.json'), {
    offerings: [{
      cusip: '855244BG3',
      issuerName: 'STARBUCKS CORP',
      sector: 'Consumer',
      coupon: 4,
      ytm: 4.153,
      ytnc: null,
      maturity: '2029-01-01',
      askPrice: 100,
      availableSize: 1500
    }]
  });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbbs-go-live-smoke-'));
  const port = await getFreePort();
  seedSyntheticPackage(dataDir);
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'error',
      ANTHROPIC_API_KEY: '',
      FRED_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  const checks = [];
  try {
    await waitForHealth(port, child);

    const html = await request(port, '/');
    assert.strictEqual(html.status, 200, html.text);
    assert.ok(/FBBS Market Intelligence Portal/i.test(html.text), 'SPA shell rendered');
    checks.push('SPA shell');

    const current = await request(port, '/api/current');
    assert.strictEqual(current.status, 200, current.text);
    assert.ok(current.json && current.json.date, 'current package date present');
    checks.push('current package');

    const status = await request(port, '/api/admin/go-live-status');
    assert.strictEqual(status.status, 200, status.text);
    assert.ok(status.json && Array.isArray(status.json.checks), 'go-live checks present');
    assert.ok(status.json.ai && Array.isArray(status.json.ai.caches), 'AI status present');
    assert.ok(status.json.process && status.json.process.build, 'process status present');
    checks.push('go-live status');

    const offerings = await request(port, '/api/offerings/all');
    assert.strictEqual(offerings.status, 200, offerings.text);
    const agency = offerings.json.rows.find(row => row.cusip === '3130B6R24');
    assert.ok(agency, 'agency row present');
    assert.strictEqual(agency.ytnc, null);
    assert.strictEqual(agency.yield, 4.054);
    checks.push('all offerings yield normalization');

    const dashboard = await request(port, '/api/sales-dashboard');
    assert.strictEqual(dashboard.status, 200, dashboard.text);
    assert.ok(dashboard.json && dashboard.json.ok, 'sales dashboard envelope');
    // Free, live relative-value read — deterministic, no billable call. The RV
    // sections (leaders / per-bucket bests) prove the engine ran.
    const sd = dashboard.json.dashboard;
    assert.ok(sd && sd.rv, 'sales dashboard live relative-value read');
    assert.ok(Array.isArray(sd.rv.leaders), 'sales dashboard RV leaders board');
    assert.ok(sd.rv.byBucket && typeof sd.rv.byBucket === 'object', 'sales dashboard maturity buckets');
    assert.ok(sd.benchmarks && typeof sd.benchmarks.treasury === 'boolean', 'sales dashboard benchmarks block');
    checks.push('sales dashboard relative-value read');

    for (const route of ['/api/daily-summary', '/api/cd-rollover-wall?window=90', '/api/maturity-calendar?window=90']) {
      const res = await request(port, route);
      assert.strictEqual(res.status, 200, `${route}: ${res.status} ${res.text}`);
      assert.ok(res.json && typeof res.json === 'object', `${route}: JSON response`);
      checks.push(route);
    }

    console.log(`go-live smoke: ${checks.length} checks passed on port ${port}`);
    checks.forEach(check => console.log(`  ok  ${check}`));
  } catch (err) {
    console.error(output);
    throw err;
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
