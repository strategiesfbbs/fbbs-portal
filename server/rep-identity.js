'use strict';

// Rep identity resolution for the portal.
//
// Order of precedence (highest first):
//   1. `fbbs_rep_override` cookie — laptop/local-run override picked from the header dropdown.
//   2. IIS Windows auth — iisnode forwards LOGON_USER on the `x-iisnode-logon_user` header,
//      and also exposes `auth-user`. Domain prefix (`DOMAIN\\user`) is stripped.
//   3. `FBBS_DEFAULT_REP` env var — useful for shared workstation runs.
//
// The resolved record is `{ username, displayName, source }`. `username` is the canonical
// short handle (lower-case, no domain); `displayName` is what we show in the UI.
// `source` is one of `cookie | iis | env | none` so the UI can hint where it came from.

const REP_OVERRIDE_COOKIE = 'fbbs_rep_override';
const REP_OVERRIDE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — laptop persistence

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach(part => {
    const eq = part.indexOf('=');
    if (eq <= 0) return;
    const key = part.slice(0, eq).trim();
    if (!key) return;
    const rawValue = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch (_) {
      out[key] = rawValue;
    }
  });
  return out;
}

function stripDomain(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const slash = s.lastIndexOf('\\');
  if (slash >= 0) return s.slice(slash + 1);
  const at = s.indexOf('@');
  if (at > 0) return s.slice(0, at);
  return s;
}

function normalizeUsername(value) {
  return stripDomain(value).toLowerCase().replace(/\s+/g, '').slice(0, 80);
}

// Display-friendly name. Owners frequently come in as "MIKE JONES" — title-case those.
// Anything that already mixes case is left alone.
function prettifyDisplayName(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, ch => ch.toUpperCase());
}

function buildRep(username, displayName, source) {
  if (!username) return null;
  return {
    username,
    displayName: prettifyDisplayName(displayName || username),
    source: source || 'none'
  };
}

function resolveRequestRep(req, options = {}) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  const cookieValue = cookies[REP_OVERRIDE_COOKIE];
  const allowCookieOverride = options.allowCookieOverride !== false;
  if (allowCookieOverride && cookieValue && cookieValue !== '__none__') {
    const parsed = parseRepValue(cookieValue);
    if (parsed) return { ...parsed, source: 'cookie' };
  }
  // Explicit clear sentinel — no fallback to IIS/env. Lets a shared workstation say "act as nobody".
  if (allowCookieOverride && cookieValue === '__none__') return null;

  const iisHeader = req && req.headers
    ? (req.headers['x-iisnode-logon_user'] ||
       req.headers['x-iisnode-auth_user'] ||
       req.headers['auth-user'] ||
       req.headers['x-forwarded-user'])
    : null;
  if (iisHeader) {
    const display = stripDomain(iisHeader);
    const username = normalizeUsername(iisHeader);
    if (username) return buildRep(username, display, 'iis');
  }

  const envDefault = options.allowDefaultRep === false
    ? ''
    : (options.defaultRep || process.env.FBBS_DEFAULT_REP);
  if (envDefault) {
    const display = stripDomain(envDefault);
    const username = normalizeUsername(envDefault);
    if (username) return buildRep(username, display, 'env');
  }

  return null;
}

// Parse a value that may have been entered as "Mike Jones" or "mjones" or "Mike Jones|mjones".
function parseRepValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const pipe = raw.indexOf('|');
  let display = raw;
  let username = raw;
  if (pipe >= 0) {
    display = raw.slice(0, pipe).trim();
    username = raw.slice(pipe + 1).trim();
  }
  const canonical = normalizeUsername(username || display);
  if (!canonical) return null;
  return buildRep(canonical, display || username, 'cookie');
}

function buildRepOverrideCookie(value) {
  const encoded = value === null
    ? '__none__'
    : encodeURIComponent(String(value || '').slice(0, 240));
  const attrs = [
    `${REP_OVERRIDE_COOKIE}=${encoded}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${REP_OVERRIDE_MAX_AGE_SECONDS}`,
    'HttpOnly'
  ];
  return attrs.join('; ');
}

function clearRepOverrideCookieHeader() {
  return `${REP_OVERRIDE_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0; HttpOnly`;
}

// Owner strings on bank rows look like "MIKE JONES" or "MIKE JONES, JOHN SMITH" or
// "Mike Jones / John Smith". Split on commas, semicolons, slashes, and the literal word
// " and " — keep multi-word names intact.
function splitOwnerString(value) {
  return String(value || '')
    .split(/[,;\/|]|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function ownerStringContainsRep(ownerString, rep) {
  if (!rep || !rep.username) return false;
  const parts = splitOwnerString(ownerString);
  if (!parts.length) return false;
  const repKey = rep.username;
  const repDisplay = (rep.displayName || '').toLowerCase();
  for (const part of parts) {
    const partKey = normalizeUsername(part);
    if (partKey && partKey === repKey) return true;
    if (repDisplay && part.toLowerCase() === repDisplay) return true;
    // Loose match for "Mike Jones" vs "M Jones" — only when last names match exactly.
    if (repDisplay) {
      const repTokens = repDisplay.split(/\s+/).filter(Boolean);
      const partTokens = part.toLowerCase().split(/\s+/).filter(Boolean);
      if (repTokens.length && partTokens.length &&
          repTokens[repTokens.length - 1] === partTokens[partTokens.length - 1] &&
          repTokens[0][0] === partTokens[0][0]) {
        return true;
      }
    }
  }
  return false;
}

// Given a list of owner strings (e.g., the distinct values from bank_account_statuses.owner),
// return canonicalized rep candidates with hit counts.
function aggregateRepsFromOwnerStrings(ownerStrings) {
  const byUsername = new Map();
  ownerStrings.forEach(({ owner, count = 1 }) => {
    splitOwnerString(owner).forEach(part => {
      const username = normalizeUsername(part);
      if (!username) return;
      const existing = byUsername.get(username);
      const displayName = prettifyDisplayName(part);
      if (existing) {
        existing.count += count;
        if (!existing.displayName && displayName) existing.displayName = displayName;
      } else {
        byUsername.set(username, { username, displayName, count });
      }
    });
  });
  return [...byUsername.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.displayName.localeCompare(b.displayName);
  });
}

module.exports = {
  REP_OVERRIDE_COOKIE,
  aggregateRepsFromOwnerStrings,
  buildRepOverrideCookie,
  clearRepOverrideCookieHeader,
  normalizeUsername,
  ownerStringContainsRep,
  parseCookies,
  parseRepValue,
  prettifyDisplayName,
  resolveRequestRep,
  splitOwnerString
};
