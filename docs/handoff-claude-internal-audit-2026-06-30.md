# Internal Audit Handoff — for Codex (2026-06-30)

Fresh code-state audit (30 agents: 9 parallel lanes + adversarial verification of every medium+ finding, plus a backlog reconciliation). Not a redo of `portal-sweep-audit-2026-06-25.md` / `portal-review-followups-2026-06-28.md` — this targets what's changed since, plus cross-cutting structural checks. 19 findings confirmed real after independent re-verification (0 false positives survived). Full raw output is no longer in any agent's context; this doc is the durable record.

**Already fixed in this branch:** the 2 CRITICAL nav bugs (Claude) plus the server-side contact compliance guard (Codex review follow-up). The remaining items below are still open backlog/review findings.

---

## Fixed by Claude (informational — no action needed)

### CRITICAL — local-section-nav bounced to Home instead of scrolling
- **Files:** `public/index.html:573` (Maturity Calendar nav), `public/index.html:3130` (Admin nav), `public/js/portal.js` (new click handler added ~line 1806)
- **Was:** the new `.local-section-nav` anchors (`#maturityCalSummary` etc., `#adminReadiness` etc.) were bare hash links with no click handler. The global `hashchange` listener resolves any fragment not in `VALID_PAGES` to `'home'` via `parseHashTarget()`, so clicking these bounced the user to Home instead of scrolling.
- **Fix:** added a delegated click handler (`.local-section-nav a[href^="#"]`) right before the `hashchange` listener registration in `portal.js` that does `e.preventDefault()` + `section.scrollIntoView({behavior:'smooth'})`, intercepting before the hash ever changes.
- **Verified live:** clicked both nav sets in a real preview — page stayed active (`p-maturity-calendar` / `p-admin`), hash untouched, scroll position moved to the target section. `npm test` green (incl. `frontend-parse.test.js`, which compiles `portal.js`).
- Codex review follow-up: the delegated click handler now calls `preventDefault()` even when a target section is not currently rendered (for example, an empty Maturity Calendar filter state), so local-section-nav clicks can never fall through to the global hash router.

### Medium — Compliance enforcement gap (do-not-call / opt-out)
- **Files:** `server/server.js:5272` (`handleLogBankActivity`, `POST /api/banks/:id/activity`), `tests/server-http.test.js`
- **Was:** client-side contact compliance badges/warnings were present, but a direct API call could still log a call against a do-not-call contact or an email against an opt-out/bounced contact.
- **Fix:** `handleLogBankActivity` now rejects `kind === 'call'` for `contact.doNotCall`, and rejects `kind === 'email'` for `contact.optOutEmail || contact.emailBounced`. HTTP regression coverage was added to the existing bank activity route test.
- **Verified:** full `npm test` passed after rerunning outside the sandbox so HTTP tests could bind localhost.

---

## Open findings — needs action

### Medium — Pershing trade-store data-quality gaps
- **File:** `server/pershing-store.js`
- `normalizeDate()` (~line 172) has no format validation — an unparseable trade date is truncated to its first 10 chars and stored verbatim; `validateMappedTrade()` (~479-486) only checks truthiness, not date format, so a garbage date is never rejected or warned on.
- No `warnings[]` array exists anywhere in the file, deviating from the documented parser convention (`CLAUDE.md`: "New parsers return `{ asOfDate, warnings, offerings, ... }`... warn, never crash").
- `buildTradeKey()` (~line 248) falls back to a SHA-256 hash of `(account, tradeDate, cusip, side, qty, price, netAmount)` when no `trade_id` is present. Two genuinely separate same-day fills with identical account/CUSIP/side/price/qty/net-amount will collide on that hash and the second is silently dropped as a "duplicate."
- Neither edge case (malformed date row, the duplicate-hash collision) is covered in `tests/pershing-store.test.js` or `tests/pershing-trades-auto-import.test.js`.
- **Fix shape:** add a `warnings[]` to the import summary; push a warning (not silent skip) for unparseable dates; consider widening `buildTradeKey()`'s fallback or accepting the small risk explicitly with a comment, since a real `trade_id` from Pershing should make this rare in practice — worth confirming with the actual export format before changing behavior.

### Medium — Race: trade import reads `pershing_accounts` before its own transaction
- **File:** `server/pershing-store.js:533`
- `importPershingTrades()` reads `pershing_accounts` (to build `accountToBank`) via a separate `querySqliteJson` call *before* opening the `withDatabase`/transaction that writes `pershing_trades`. If the account-recency workbook reimport (`DELETE FROM pershing_accounts` + re-`INSERT`) runs concurrently with a trade-CSV auto-import tick, trades can resolve `bank_id` against a stale or mid-mutation account set.
- **Fix shape:** either pull the account read inside the same transaction/connection as the trade write, or confirm (and comment) that the auto-publish/import mutex already serializes these two paths in practice — if so this may be a non-issue, but it isn't proven by the code today.

### Medium — Test coverage gaps on money-adjacent routes
- `GET /api/banks/:id/trades` (`server.js:11741`) and `GET /api/maturity-calendar` (`server.js:12303`) have no route-level HTTP tests — only underlying store functions are unit-tested. The maturity calendar's bucket/owner/call-vs-maturity-split logic (`maturityCalendarBucketLabel`, `maturityCalendarSplitTotals`, `maturityCalendarOwnerFor`, `buildMaturityCalendar`) is real business logic worth a direct test.

### Medium — Contacts pagination is client-side only
- **File:** `public/js/portal.js:19010`
- The new Contacts-directory pagination (in the still-uncommitted diff) slices a fully-loaded, unpaginated `GET /api/contacts` result client-side. Fine at the current 1,736 rows; flag if that list is expected to keep growing — server-side limit/offset would be the next step.

### Low — Pershing archive-move skips the filename-safety helpers
- **File:** `server/server.js:10050`/`10081-10109` (`pershingTradeDropDestPath`, `importAndArchivePershingTradeFile`)
- Uses raw `path.join(dir, name)` for the archive destination instead of routing through `sanitizeFilename()`/`safeJoin()` before `fs.renameSync()`. Low severity today (filenames come from a controlled local drop folder, not an HTTP body), but inconsistent with the rest of the codebase's stated invariant. Cheap to fix for consistency.

### Low — AI hallucination-guard regex gap
- **File:** `server/daily-dashboard-judgment.js:150`
- `MODEL_NUMERIC_CLAIM` (the regex that strips unverified numbers from AI prose before it's shown) only matches currency/bp/%/decimal-suffixed numbers — a bare integer with no unit ("trading at 99 today", "pays 6 a year") slips through ungrounded. Narrow but real gap in the two-wall numeric-claim discipline.

---

## CLAUDE.md drift — please fix or hand back, your call on ownership

These are documentation-only, but several are actively misleading (describing removed mechanisms as live):

1. **`SLOT_NAMES` count is wrong.** CLAUDE.md says "all twelve slot keys"; `server/server.js:458` has **11** entries and does not include `dashboard`.
2. **The uploaded-HTML "Published Dashboard" slot is fully gone, but CLAUDE.md still describes it as live**, including its sandboxed-iframe security mechanism (`sandbox="allow-scripts"`, sandbox CSP on `/current/*`/`/archive/*`). It was deleted in commit `c8413aa` ("Refine sales dashboard and retire uploaded dashboard", 2026-06-23) — `classifyFile()`, `uploadSlotFromFieldName()`, and `looksLikeHtml()` itself are all gone. CLAUDE.md's Security posture section and Architecture map both need this mechanism removed from the description, and the Wave-4 "deliberately deferred... fully retiring the uploaded-HTML Published Dashboard slot" line is now stale — it's already retired, not deferred.
3. **`server/offerings-pick.js` was deleted** in commit `3329ac2` ("feat(picks): one daily-pick surface — retire the orphaned Pick of the Day", 2026-06-29), but CLAUDE.md's AI-layer section still lists it as one of "three grounded, cache-by-package-date consumers."
4. **A 4th billable AI consumer isn't documented at all:** `server/market-snapshot-title.js` exists, is correctly admin-gated (`/api/market-snapshot/title/refresh` is in `isAdminOnlyApiWrite`), has its own tests — just missing from the "Claude / AI layer" section.

Suggest whoever touches CLAUDE.md next folds these in — small diff, high value since both of us read this file as primary context.

---

## Backlog reconciliation (for context, not action)

- `docs/feature-backlog-2026-06-24.md`'s `CLI-1` (copy-pitch) and `CLI-2` (branded Offering Sheet render) are **fully shipped** but the doc still lists them as open/new.
- `docs/salesforce-decommission-gap-2026-06-28.md`'s #1 blocker (no per-trade Pershing history) is **structurally closed, operationally open**: `server/trade-store.js` has the right schema/join/route/tests, but is empty until the real 139K-row SF `Trade__c` export is pulled and imported, and no tear-sheet UI reads it yet. **Don't confuse this with the separate, already-live Pershing daily-CSV trade feature** (`pershing-store.js`'s `pershing_trades`, the one with the live tear-sheet panel) — similar names, two different systems.
- Top still-open, highest-leverage backlog items (full list + reasoning in this session's memory, ask if useful): run the real SF trade import, Morning Call Sheet (`WF-1`), whole-book opportunity screener (`BI-3`), Spread History Lab (`MKT-1`), cross-bank swap radar (`SWP-4`).

## New ideas (not yet in any backlog doc)

All keyed off the now-real `pershing_trades` line-item data — see this session's memory (`fbbs-internal-audit-2026-06-30`) for full sketches: CUSIP Flow Radar (cross-bank "who else traded this"), a Rep Activity Scorecard (logged CRM activity vs. actual trades — surfaces undocumented-contact risk), trade-implied coverage-owner reconciliation, a trade-velocity "going quiet" signal, a FINRA 2121 best-execution spot-check against the archived RV/MMD/Treasury benchmark, per-bank sector/issuer flow rollup, and an admin-only AI-usage ledger from `audit.log`.
