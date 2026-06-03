#!/usr/bin/env node

const { execFile } = require('child_process');
const http = require('http');

const port = process.env.PORT || '3000';
const expectedBuild = 'swap-workflow-2026-05-13';
const minNodeMajor = 20;
const maxNodeMajor = 24; // engines: ">=20 <25" — above this, npm install may fall to a node-gyp build

function execFileText(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function getHealth(hostname) {
  return new Promise(resolve => {
    const req = http.get({ hostname, port, path: '/api/health', timeout: 3000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ hostname, statusCode: res.statusCode, json: JSON.parse(body), body });
        } catch (_) {
          resolve({ hostname, statusCode: res.statusCode, json: null, body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', err => resolve({ hostname, error: err.message }));
  });
}

// lsof (macOS/Linux): skip the header row; PID is the 2nd whitespace column.
function parseLsofListeners(stdout) {
  const body = stdout.split(/\r?\n/).filter(Boolean).slice(1);
  const pids = [...new Set(body.map(line => line.trim().split(/\s+/)[1]).filter(Boolean))];
  return { text: body.join('\n'), pids };
}

// netstat -ano (Windows): keep LISTENING rows for our port; PID is the LAST column.
function parseNetstatListeners(stdout, listenPort) {
  const portRe = new RegExp(':' + listenPort + '\\b');
  const lines = stdout.split(/\r?\n/).filter(line => /LISTENING/i.test(line) && portRe.test(line));
  const pids = [...new Set(lines.map(line => line.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)))];
  return { text: lines.join('\n'), pids };
}

// Enumerate the processes listening on `listenPort`, using a tool that exists on
// the host OS — lsof is Unix-only, so the Windows production box uses netstat.
async function listListeners(listenPort) {
  if (process.platform === 'win32') {
    const r = await execFileText('netstat', ['-ano']);
    return parseNetstatListeners(r.stdout, listenPort);
  }
  const r = await execFileText('lsof', ['-nP', `-iTCP:${listenPort}`, '-sTCP:LISTEN']);
  return parseLsofListeners(r.stdout);
}

async function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  let hasRuntimeProblem = false;
  const { text: listeners, pids } = await listListeners(port);

  console.log(`FBBS Portal Doctor`);
  console.log(`Port: ${port}`);
  console.log(`Expected build: ${expectedBuild}`);
  console.log(`Node: ${process.versions.node}`);
  console.log('');

  if (!Number.isFinite(nodeMajor) || nodeMajor < minNodeMajor) {
    hasRuntimeProblem = true;
    console.log(`WARNING: Node ${minNodeMajor}+ is required. Install the current Node.js LTS before running the portal.`);
    console.log('');
  } else if (nodeMajor > maxNodeMajor) {
    hasRuntimeProblem = true;
    console.log(`WARNING: Node ${nodeMajor} is newer than the tested range (${minNodeMajor}-${maxNodeMajor}). better-sqlite3 may have no prebuilt binary and fall back to a node-gyp compile (needs build tools). Install Node ${maxNodeMajor} LTS.`);
    console.log('');
  }

  try {
    require('better-sqlite3');
  } catch (err) {
    hasRuntimeProblem = true;
    console.log(`WARNING: better-sqlite3 could not be loaded. Run npm install with Node ${minNodeMajor}+.`);
    console.log(`Details: ${err.message}`);
    console.log('');
  }

  if (!listeners) {
    console.log(`No process is listening on port ${port}.`);
    console.log(`Start the portal with: npm start`);
    process.exitCode = 1;
    return;
  }

  console.log(`Listening processes:`);
  console.log(listeners);
  console.log('');

  if (pids.length > 1) {
    console.log(`WARNING: ${pids.length} processes are listening on port ${port}: ${pids.join(', ')}`);
    console.log(`Stop every old portal Terminal with Ctrl+C, or quit the listed Node processes in Activity Monitor.`);
    console.log('');
  }

  const health = await Promise.all([getHealth('localhost'), getHealth('127.0.0.1')]);
  for (const item of health) {
    if (item.error) {
      console.log(`${item.hostname}: ${item.error}`);
      continue;
    }
    const build = item.json && item.json.build;
    const marker = build === expectedBuild ? 'OK' : 'STALE';
    console.log(`${item.hostname}: HTTP ${item.statusCode} build=${build || '(missing)'} ${marker}`);
  }

  if (health.some(item => item.error || !item.json || item.json.build !== expectedBuild)) {
    process.exitCode = 1;
    console.log('');
    console.log(`At least one listener is serving an old build. Stop the stale Node process before reviewing the swap workflow.`);
  }

  if (hasRuntimeProblem) process.exitCode = 1;
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
