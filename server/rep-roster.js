'use strict';

// FBBS salesperson roster — the firm's current rep codes mapped to display names.
//
// This is the single source of truth for rep-code -> name lookups across the
// portal (Executive Summary revenue tables, reports, any future code-keyed view).
// Provided by the firm 2026-06-05. Codes are the salesperson codes that appear in
// trade/activity exports (e.g. the TH activity sheet's `Salesperson` column).
//
// Entries that read like a pairing (e.g. "Glasser/Hagemann", "Mac & Gio") are
// team/partnership codes the firm books jointly — kept verbatim.
//
// NOTE: desk-level trader codes (08-TRSY, 30-PRICD, ...) are a DIFFERENT code
// space and live with the Exec Summary's TRADER_MAP, not here.

const REP_ROSTER = {
  F14: 'Jim Courrier',
  F18: 'A.W. Spellmeyer',
  F20: 'Dan Hagemann',
  F21: 'Mac & Gio',
  F22: 'Gio Rozo',
  F23: 'Bobby Scheetz',
  F25: 'Courtney Kiefer',
  F26: 'Glasser/Hagemann',
  F30: 'John Waugh',
  F33: 'Brian Roscoe',
  F36: 'Dave Glasser',
  F40: 'Mark Crihfield',
  F41: 'Joe Crifasi',
  F45: 'Ryan Kane',
  F53: "Michael D'Addabbo",
  F54: 'Ted Warley',
  F57: 'Mac McGinnis',
  F61: 'Duane Kerner',
  F62: 'Bryce Martin',
  F70: 'Ardi Baniahmad',
  F71: 'Josh Benner',
  F72: 'Meghan Greenwood',
  F80: 'Crihfield/Crifasi',
  K34: 'Michael Lauth',
  K50: 'Greg Bernard',
  K55: 'Bernard/Lewis',
  K60: 'Jim Lewis',
  K64: 'Lewis/Krei',
  L33: 'L1 Hart & Co',
  O44: 'Edward Krei',
};

// Normalize a raw code the way exports may carry it (trailing spaces, lower case).
function normalizeRepCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Resolve a rep code to its display name. Falls back to the normalized code when
// unknown, or to `fallback` if provided.
function repName(code, fallback) {
  const key = normalizeRepCode(code);
  if (key && REP_ROSTER[key]) return REP_ROSTER[key];
  if (fallback !== undefined) return fallback;
  return key || null;
}

// True when the code is in the roster.
function isKnownRep(code) {
  return Boolean(REP_ROSTER[normalizeRepCode(code)]);
}

module.exports = {
  REP_ROSTER,
  normalizeRepCode,
  repName,
  isKnownRep,
};
