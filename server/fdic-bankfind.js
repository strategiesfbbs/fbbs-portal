/**
 * fdic-bankfind.js — live bank fundamentals from the FDIC BankFind Suite API.
 *
 * api.fdic.gov is free and keyless and serves 1,100+ Call Report (RIS)
 * variables per institution per quarter, keyed by FDIC cert — the portal's
 * existing join key. This module fetches a small headline set for one bank
 * and caches it on disk, so the tear sheet can show "what the FDIC has"
 * next to the quarterly workbook import and flag when a newer quarter is
 * available. It is deliberately read-alongside, not a replacement importer
 * (that's the FFIEC bulk lane in the roadmap).
 *
 * No deps — Node fetch + JSON. Never throws: failures return the cached
 * copy (stale:true) or null.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.fdic.gov/banks/financials';
// Headline RIS fields, all $000 except the ratios:
//   ASSET total assets · DEP total deposits · EQ equity capital ·
//   LNLSNET net loans & leases · SC total securities ·
//   ROA return on assets % · ROE return on equity % · NIMY net interest margin %
const FIELDS = 'CERT,REPDTE,ASSET,DEP,EQ,LNLSNET,SC,ROA,ROE,NIMY';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // quarterly data — once a day is plenty
const FETCH_TIMEOUT_MS = 15000;

// '20260331' → '2026Q1' (same shape as the workbook's summary period).
function repdteToPeriod(repdte) {
  const s = String(repdte || '');
  if (!/^\d{8}$/.test(s)) return '';
  const quarter = Math.ceil(Number(s.slice(4, 6)) / 3);
  return `${s.slice(0, 4)}Q${quarter}`;
}

function mapFinancialRow(row) {
  if (!row) return null;
  return {
    period: repdteToPeriod(row.REPDTE),
    repdte: String(row.REPDTE || ''),
    totalAssets: row.ASSET != null ? Number(row.ASSET) : null,
    totalDeposits: row.DEP != null ? Number(row.DEP) : null,
    equity: row.EQ != null ? Number(row.EQ) : null,
    netLoans: row.LNLSNET != null ? Number(row.LNLSNET) : null,
    securities: row.SC != null ? Number(row.SC) : null,
    roa: row.ROA != null ? Number(Number(row.ROA).toFixed(2)) : null,
    roe: row.ROE != null ? Number(Number(row.ROE).toFixed(2)) : null,
    nim: row.NIMY != null ? Number(Number(row.NIMY).toFixed(2)) : null,
  };
}

// Parse the BankFind response envelope into newest-first financial rows.
// Pure — unit-tested against a fixture.
function parseFinancialsResponse(json) {
  const rows = json && Array.isArray(json.data) ? json.data : [];
  return rows
    .map(entry => mapFinancialRow(entry && entry.data))
    .filter(row => row && row.period);
}

async function fetchFdicFinancials(cert, fetchImpl) {
  const url = `${API_BASE}?filters=CERT:${encodeURIComponent(cert)}&fields=${FIELDS}` +
    '&sort_by=REPDTE&sort_order=DESC&limit=2&format=json';
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'fbbs-portal/fdic-bankfind' },
  });
  if (!res.ok) throw new Error(`FDIC API responded ${res.status}`);
  return res.json();
}

function cachePath(cacheDir, cert) {
  return path.join(cacheDir, `cert-${String(cert).replace(/[^0-9]/g, '')}.json`);
}

function readCache(cacheDir, cert) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(cacheDir, cert), 'utf-8'));
    if (parsed && Array.isArray(parsed.rows)) return parsed;
  } catch (_) { /* absent or unreadable — refetch */ }
  return null;
}

function writeCache(cacheDir, cert, cache) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = `${cachePath(cacheDir, cert)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, cachePath(cacheDir, cert));
}

function buildSnapshot(rows, meta) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    source: 'FDIC BankFind Suite (api.fdic.gov)',
    latest: rows[0],
    previous: rows[1] || null,
    fetchedAt: meta.fetchedAt || null,
    stale: Boolean(meta.stale),
  };
}

/**
 * Latest FDIC quarterly headline financials for one cert, disk-cached
 * (default 24h TTL). Returns { source, latest, previous, fetchedAt, stale }
 * or null. Never throws.
 *
 * opts: { cacheDir (required), ttlMs?, fetchImpl?, now?, log? }
 */
async function getFdicSnapshot(cert, opts) {
  const cacheDir = opts && opts.cacheDir;
  if (!cacheDir) throw new Error('getFdicSnapshot requires opts.cacheDir');
  const certNum = String(cert || '').replace(/[^0-9]/g, '');
  if (!certNum) return null;
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now != null ? opts.now : Date.now();
  const log = opts.log || (() => {});

  const cache = readCache(cacheDir, certNum);
  if (cache && cache.fetchedAt && now - Date.parse(cache.fetchedAt) < ttlMs) {
    return buildSnapshot(cache.rows, { fetchedAt: cache.fetchedAt });
  }

  try {
    const rows = parseFinancialsResponse(await fetchFdicFinancials(certNum, fetchImpl));
    if (!rows.length) {
      // Cert unknown to the FDIC (thrift-only, foreign branch, bad cert) —
      // cache the empty answer too so we don't re-ask every render.
      writeCache(cacheDir, certNum, { fetchedAt: new Date(now).toISOString(), rows: [] });
      return null;
    }
    const fresh = { fetchedAt: new Date(now).toISOString(), rows };
    writeCache(cacheDir, certNum, fresh);
    return buildSnapshot(fresh.rows, { fetchedAt: fresh.fetchedAt });
  } catch (err) {
    log('warn', `FDIC fetch failed for cert ${certNum}:`, err.message);
    if (cache) return buildSnapshot(cache.rows, { fetchedAt: cache.fetchedAt, stale: true });
    return null;
  }
}

module.exports = {
  getFdicSnapshot,
  parseFinancialsResponse,
  repdteToPeriod,
};
