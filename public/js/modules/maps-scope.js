(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FbbsMapsScope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Pure scope/owner policy behind the US Bank Map. No DOM, no fetch —
  // portal.js wires it to mapsState and the node tests drive it directly.
  //
  // The map's scope is DERIVED, never stored: it is a function of the owner
  // filter string and the acting rep. The one stored bit is `ownerPinned`:
  //   true  = the user explicitly chose All or a specific other rep — the map
  //           must NOT follow acting-rep switches;
  //   false = system default or an explicit "My territory" — following armed.

  function normalizeOwnerName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function ownerIdentityKey(value) {
    return normalizeOwnerName(value).replace(/[^a-z0-9]+/g, '');
  }

  function splitOwnerString(value) {
    return String(value || '')
      .split(/[,;\/|]|\s+and\s+/i)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function ownerNameMatches(candidate, ownerFilter) {
    const wantedName = normalizeOwnerName(ownerFilter);
    const wantedKey = ownerIdentityKey(ownerFilter);
    const candidateName = normalizeOwnerName(candidate);
    const candidateKey = ownerIdentityKey(candidate);
    if (!wantedName || !candidateName) return false;
    return candidateName === wantedName || (wantedKey && candidateKey === wantedKey);
  }

  function ownerStringMatches(rawOwner, ownerFilter) {
    if (!ownerFilter) return true;
    const raw = String(rawOwner || '').trim();
    if (!raw) return false;
    if (ownerNameMatches(raw, ownerFilter)) return true;
    const parts = splitOwnerString(raw);
    return (parts.length ? parts : [raw]).some(part => ownerNameMatches(part, ownerFilter));
  }

  function repOwnerNames(rep) {
    if (!rep) return [];
    return [rep.displayName, rep.username]
      .map(value => String(value || '').trim())
      .filter(Boolean);
  }

  /** 'all' | 'mine' | 'rep' from the owner filter + the acting rep. */
  function resolveScope(owner, rep) {
    const filter = String(owner || '').trim();
    if (!filter) return 'all';
    const names = repOwnerNames(rep);
    return names.some(name => ownerNameMatches(filter, name)) ? 'mine' : 'rep';
  }

  /**
   * Territory after an acting-rep switch. Follow-mode policy: re-point only
   * when the user hasn't pinned a choice (ownerPinned=false). `newOwner` is
   * the already-resolved coverage-owner string for the new rep ('' if none).
   * Returns { owner, ownerPinned, changed }.
   */
  function territoryAfterRepSwitch(territory, newOwner) {
    const t = territory || {};
    if (t.ownerPinned) {
      return { owner: String(t.owner || ''), ownerPinned: true, changed: false };
    }
    const owner = String(newOwner || '');
    return { owner, ownerPinned: false, changed: owner !== String(t.owner || '') };
  }

  /** Territory produced by each explicit scope action (the policy table). */
  function territoryForScope(kind, opts) {
    const o = opts || {};
    if (kind === 'all') return { owner: '', ownerPinned: true };
    if (kind === 'mine') return { owner: String(o.owner || ''), ownerPinned: false };
    // 'rep': an explicitly picked owner. If it happens to be the acting rep,
    // treat it as "My territory" so following stays armed.
    const owner = String(o.owner || '');
    const isSelf = o.rep ? resolveScope(owner, o.rep) === 'mine' : false;
    return { owner, ownerPinned: !isSelf };
  }

  function formatCount(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /**
   * Scope banner text. scope: 'all'|'mine'|'rep'; ownerLabel: the owner filter
   * string; scopedCount: banks passing the owner filter alone; universeCount:
   * all current banks. Pure strings — portal.js adds the action link.
   */
  function scopeBannerText(scope, ownerLabel, scopedCount, universeCount) {
    if (scope === 'all') {
      return `Viewing all current banks · ${formatCount(universeCount)}`;
    }
    const label = String(ownerLabel || '').trim() || 'Selected rep';
    const kind = scope === 'mine' ? 'territory' : 'book';
    return `Viewing ${label} ${kind} · ${formatCount(scopedCount)} of ${formatCount(universeCount)} current banks`;
  }

  /** Hero subtitle universe stats — never filter-dependent. */
  function universeSubtitle(stats) {
    const s = stats || {};
    const parts = [];
    if (s.latestPeriod) parts.push(`Period ${s.latestPeriod}`);
    parts.push(`${formatCount(s.currentBankCount)} current banks`);
    if (s.staleBankCount > 0) parts.push(`${formatCount(s.staleBankCount)} stale/inactive hidden`);
    parts.push(`${formatCount(s.mappedCount)} mapped`);
    const unmapped = Math.max(0, Number(s.currentBankCount || 0) - Number(s.mappedCount || 0));
    if (unmapped > 0) parts.push(`${formatCount(unmapped)} without map location`);
    return parts.join(' · ');
  }

  return {
    normalizeOwnerName,
    ownerIdentityKey,
    splitOwnerString,
    ownerNameMatches,
    ownerStringMatches,
    repOwnerNames,
    resolveScope,
    territoryAfterRepSwitch,
    territoryForScope,
    scopeBannerText,
    universeSubtitle
  };
});
