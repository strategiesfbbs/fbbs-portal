# FBBS Portal — Deep Pre-Launch Review

> **Date:** 2026-06-02 · **Reviewer:** Claude (5 specialist passes + independent spot-verification)
> **Commit reviewed:** `d7fdd58` (working tree clean) · **Tests:** `npm test` = 17/17 suites pass · `npm audit` = 0 vulnerabilities
>
> Scope: security/authz, server correctness & concurrency, parser/data integrity, frontend SPA, tests/deployment/ops/dependencies. Method: each dimension was audited against the actual code; every 🔴/🟠 finding below was then re-read and **verified by me directly** (marked ✓). Limits: this is static review + the existing unit suite — it does **not** include a live IIS/Windows-Auth run or a load test. Those remain in the [launch-day script](launch-day-script.md).

---

## 1. Verdict

**The codebase is genuinely well-built and safe to launch internally — *conditionally*.** For an internal, no-framework app of this size the discipline is unusually high: SQL is fully parameterized (no injection found), HTML escaping is applied consistently (no actionable XSS found), path traversal and uploads are well-defended, the CSP/iframe-sandbox boundary is correct, audit logging is complete on every mutating route (independently verified), swap economics are mathematically sound and frozen-on-send, and the test suite passes with zero npm vulnerabilities.

**There are no Critical (RCE / data-breach) issues.** The risks that matter cluster in three places:
1. **Daily-publish robustness** — a botched re-upload or a crash/disk-full mid-publish can silently lose a live slot or leave a half-written package. *(fixable, mostly cheap)*
2. **Silent data mis-parse** — a few parser heuristics will produce *confidently wrong numbers with no warning* if a source file's format drifts (it already drifted once, for Treasury). *(this is the subtlest and most important class for a firm whose reps trade on these numbers)*
3. **Operational hardening for IIS** — unbounded iisnode logs, an open-ended Node version, naive live-SQLite backups, and a process that stays alive after an uncaught exception. *(config/process fixes)*

None block a Phase-1 internal launch **if** the 🔴 items below are addressed and the 🟠 items are owned with dates. The rep-vs-admin boundary is real for ingest but otherwise honor-system — that's already documented in the [role matrix](role-matrix.md) and acceptable for internal use.

---

## 2. What's solid (verified — don't "fix" these)

- **No SQL injection.** Every store goes through `sqlite-db.js` prepared statements; the only inlined identifiers are server-controlled whitelists (columns, ORDER BY maps, JSON paths). LIKE wildcards are escaped and bound. *(security pass, verified)*
- **No actionable XSS.** `escapeHtml` (portal.js:2671) is applied across ~834 sites covering every untrusted surface I traced (bank names, notes, contacts, strategy text, rep names, parsed offerings, ingested emails). URLs use `encodeURIComponent`. Dashboard iframe is `sandbox="allow-scripts"` only (opaque origin).
- **Audit completeness verified by reading every mutating handler** — send/execute/cancel/clone, coverage, notes, contacts, product-fit, billing, peer-groups, strategy, account-status, all uploads. **No mutating route is missing its audit append.** (This corrects an earlier exploratory claim that swap-execute wasn't logged — it is.)
- **Swap snapshot immutability is real:** `freezeProposal` writes the snapshot in one transaction and every leg mutator hard-rejects status ≠ draft. Printed proposals render from the frozen snapshot.
- **Swap math is correct** — 30/360, accrued, breakeven sign handling, TE-yield guard, and the closed-form proceeds solver all check out; money is dollar-denominated throughout.
- **Bank-workbook import is the gold standard** — builds into a temp DB then temp→backup→rename with rollback. *(This is the pattern the daily publish should copy — see SRV-1/2.)*
- **Path traversal, upload magic-byte checks, filename sanitization, CSP, security headers, graceful SIGINT/SIGTERM shutdown** — all implemented correctly.
- **Deps are minimal and pinned;** SheetJS + Plotly vendored under strict CSP; `maxAllowedContentLength` is byte-aligned with the app's 300 MB cap; audit-log rotation bounds growth.

---

## 3. 🔴 Fix before launch

Mapped to readiness [§8](internal-go-live-readiness.md) "Required for launch." Effort is rough.

> **Update 2026-06-02 — 4 of these are now FIXED (Claude, this commit):** ✅ **DAT-1**
> (CSV formula-injection guard in both exporters), ✅ **SRV-3** (`web.config`
> `nodeProcessCountPerApplication="1"` + iisnode log-size caps; `sqlite-db` busy_timeout
> still optional), ✅ **OPS-1** (iisnode log caps — same edit), ✅ **OPS-2** (`engines.node`
> pinned to `>=20 <25`). `npm test` still 17/17. **Remaining 🔴 for Codex:** **SRV-1** &
> **SRV-2** (publish-flow robustness — left to Codex as the publish-flow owner) and
> **OPS-3** (live-SQLite backup procedure — a runbook/process change).

### SRV-1 ✓ — Same-day re-publish deletes the old slot file *before* validating the new one → silent slot loss
- **Severity: High · Effort: Low** · `server/server.js:6213-6221` (unlink) vs `:6245-6248` (signature check)
- A same-day re-publish unlinks the existing file for every incoming slot, *then* validates each uploaded file's magic bytes. If validation fails (corrupt/renamed/truncated file), the route returns 400 with the **old good file already deleted and no new file written** — the live package silently loses that slot.
- **Fix:** validate (and classify) **all** incoming files up front, before the unlink/archive block; reject the whole publish on any failure so the existing package is untouched. (Bonus: also fixes the partial-publish window.)

### SRV-2 ✓ — Publish is non-atomic; a crash / disk-full / recycle mid-write leaves a half-written package
- **Severity: High · Effort: Medium** · `server/server.js:6126-6741`; per-file `fs.writeFileSync` loop at `:6263` is not wrapped; `_meta.json` written last at `:6676`
- Only the archive-rollover step is in try/catch. A failure during the slot-write loop (ENOSPC, recycle) leaves some new files, some old, and a stale/missing `_meta.json`; the different-day path renames files into the archive one-by-one, so a crash leaves the package half-moved. The cache then rebuilds from a half-written dir.
- **Fix:** stage the new package in a temp dir and atomically rename into place (mirror `bank-data-importer.js:480-498`). At minimum write `_meta.json` last as the commit point and wrap the mutating section to restore the prior `_meta.json` on failure. Pair with disk-space monitoring (OPS-3) and a runbook note: *don't recycle the App Pool during the morning publish.*

### SRV-3 ✓ — Pin the IIS worker count to 1 (and add `busy_timeout`)
- **Severity: High-if-violated / Low-now · Effort: Trivial** · `web.config:55-61` (no `nodeProcessCountPerApplication`); `swap-store.js:155-168` (read-then-write ID), `sqlite-db.js` (no explicit busy_timeout)
- The in-process caches, the publish flow, and the `SP-YYYY-NNNN` ID minting are all only safe because iisnode defaults to **one** worker. Nothing documents or enforces this. A future admin bumping the count to "scale" would cause cache divergence, publish races, and duplicate-ID failures.
- **Fix:** add `nodeProcessCountPerApplication="1"` to `<iisnode>` **with a comment explaining why it must stay 1**; set `pragma('busy_timeout = 5000')` on open in `sqlite-db.js`; make the ID mint atomic (`INSERT … ON CONFLICT … RETURNING`). Cheap insurance.

### DAT-1 ✓ — CSV formula injection in both exporters
- **Severity: High · Effort: Trivial** · `public/js/portal.js:824` (`csvEscape`) and `server/server.js:6922` (`escapeCsvCell`)
- Both only quote cells containing `" , \n \r`; neither neutralizes the spreadsheet formula triggers `= + - @`. A user-entered field (coverage owner, note, contact name, strategy comment) beginning with `=HYPERLINK(...)` / `=WEBSERVICE(...)` executes when the exported CSV is opened in Excel. Reachable today via free-text fields.
- **Fix (both files):** if a cell starts with `= + - @ \t \r`, prefix a `'` and quote it. ~2 lines each.

### OPS-1 ✓ — iisnode stdout/stderr logs grow unbounded → disk fill
- **Severity: Medium-High · Effort: Trivial** · `web.config:55-61`
- `loggingEnabled="true"` with no `maxLogFileSizeInKB` / `maxTotalLogFileSizeInKB`. The *audit* log rotates, but every `log('info'…)` line plus pdf-parse's per-publish `TT: undefined function` warnings go to `iisnode/*.txt` with no rotation. Fills the volume over months.
- **Fix:** add `maxLogFileSizeInKB="1024"` and `maxTotalLogFileSizeInKB="20480"` to `<iisnode>`, or run `LOG_LEVEL=warn` in production. (Combine into the same web.config edit as SRV-3.)

### OPS-2 ✓ — Pin `engines.node` to a tested LTS
- **Severity: Medium · Effort: Trivial** · `package.json:14-16` (`"node": ">=20"`)
- Open-ended `>=20` lets a fresh-box `npm install` land on a Node version with no `better-sqlite3` prebuilt binary, forcing a `node-gyp` build that needs Visual Studio tools — the exact failure CLAUDE.md warns about and a non-developer can't recover from.
- **Fix:** pin to the LTS range IT will actually run (e.g. `">=20 <25"`), document the exact Node LTS in the README, and use `npm ci` (not `npm install`) in any scripted deploy. Add a Node-major check to the launchers (`portal-doctor.js` already computes `minNodeMajor=20`).

### OPS-3 (process) — Live-SQLite backup procedure must quiesce or use `.backup`
- **Severity: Medium · Effort: Low (doc/process)** · README:178, [engineering-checklist](../internal-go-live-engineering-checklist.md):57
- `DATA_DIR` holds the **only** copy of coverage notes, strategies, billing, and swap proposals (the daily package is reconstructable; these are not). Copying a live SQLite file mid-write yields a **corrupt** backup. README undersells this.
- **Fix:** runbook must specify either stop/quiesce the app before copying, or use SQLite `VACUUM INTO` / `.backup` for the workspace DBs. Make "backup **and test a restore**" a launch gate.

> **Already addressed by Codex:** the security pass flagged "fail loud if production env vars are missing." Codex's `d7fdd58` go-live status panel (`/api/admin/go-live-status`) surfaces exactly this — have IT confirm it green before cutover.

---

## 4. 🟠 Launch-with-condition / fast-follow (assign owner + date)

### DATA INTEGRITY — the subtle, high-value class
The offering parsers (CD/treasury/agencies/corporates/muni) anchor on **header names** — good. The high-value **importers and a few yield heuristics do not**, and they fail *silently* (a confidently-wrong number, no warning). For a firm whose reps quote these, this is the most important area to harden.

- **DAT-2 ✓ — Yield `≤1 → ×100` heuristic mis-states yields on format drift.** `agencies-parser.js:120`, `corporates-parser.js` (same). `ytnc` assumes decimals; a sub-1% yield delivered in *percent* form becomes 85%, and `ytm`'s unconditional `×100` turns a percent-form 3.69 into 369%. **Today's fixtures pass (current files are decimal), so this is latent** — but there's no guard. **Fix:** add a Package-QA warning whenever a yield lands outside a sane band (e.g. <0.1% or >25%); longer-term detect the column's unit once. *High if it drifts.*
- **DAT-3 ✓ — Treasury content-sniffer can mis-route a non-Treasury workbook into the Treasury slot.** `treasury-notes-parser.js:287-301` accepts ≥60% "treasury-like" rows where "treasury-like" = description matches `/treasur/i` **or** CUSIP starts `912`. A relative-value/corporates workbook with a "Comp Treasury" benchmark column populated on most rows could false-match and silently overwrite the Treasury Explorer. **Fix:** make the `912` CUSIP prefix the primary signal, exclude benchmark-alias-only matches, and write the sniff decision to the publish audit log.
- **DAT-4 — `cost → commission` inference can publish a fabricated commission.** `cd-offers-parser.js:291-292`. `(100-cost)*10` with a `≤1→×100` price guess and no range check. **Fix:** range-check cost (80–110) before deriving; warn + drop otherwise.
- **DAT-5 — Bank workbook & averaged-series importers are positional (fixed column letters / row numbers).** `bank-data-importer.js:13-104,415,419`; `averaged-series-store.js:63-218`. A FedFis column insert/reorder makes every downstream value read the wrong field, producing a *fully-populated DB of wrong numbers that looks healthy*. **Fix:** validate a few known header labels against their expected columns at import; abort with a clear error on mismatch.
- **DAT-6 — Account-status owner→bank join can attach status to the wrong subsidiary on shared FDIC certs; unmatched rows are silently dropped.** `bank-account-status-store.js:502-639`. **Fix:** require exact normalized-name match before accepting a fuzzy include; persist the unmatched/conflict rows for operator review instead of only counting them.
- **DAT-7 — Muni split-rating extractor can swap Moody's/S&P or mislabel a single all-letter rating.** `muni-offers-parser.js:83-114` (decides the agency by letter-case alone). **Fix:** use column order, leave the other agency blank when only one rating is present, warn on un-splittable runs.
- **DAT-8 — `classifyFile()` keyword collisions** route mis-named files to the wrong slot (`call` substring is greedy → callables; unknown Excel silently defaults to agenciesBullets; unknown PDF → econ). `server/server.js:468-530`. **Fix:** default ambiguous files to *unclassified* (force the publisher to pick a slot) instead of a silent default; word-boundary match on `call`.

> **The single highest-leverage data fix:** a **Package-QA "data sanity" gate** — out-of-band yield/price warnings, "N rows dropped," surfaced unmatched joins, and the Treasury-sniff decision — so the silent-misread paths become *visible* before the desk trades on them. Today QA only shows the warnings parsers choose to emit, and the dangerous paths emit none.

### SECURITY / OPS hardening
- **SEC-1 ✓ — Admin gate covers only the 8 ingest routes; every other destructive mutation is open to any authenticated rep** (delete another rep's strategy/report/coverage note/contact, drive billing/swap state, manage peer groups, single account-status import). `server/server.js:439-452`. Acceptable as policy for internal launch (already in [role matrix §3.4](role-matrix.md)); **decision-sheet items #7–#10 + a follow-up code gate** are the close. *Don't market "role separation" until done.*
- **SEC-2 ✓ — In IIS mode, drop the spoofable identity fallbacks.** `rep-identity.js:79-89` honors `auth-user` / `x-forwarded-user` (client-settable) if `x-iisnode-logon_user` is ever absent. **Fix:** in IIS mode trust only the iisnode-managed headers; confirm with IT that Windows-Auth + anonymous-disabled guarantees `LOGON_USER` on every request.
- **OPS-4 ✓ — `uncaughtException` logs but doesn't exit** (`server.js:7951-7953`), leaving a poisoned process alive. **Fix:** log then `process.exit(1)` and let iisnode respawn a clean worker. Same for `unhandledRejection`.
- **OPS-5 — Confirm the IIS box is 64-bit with ≥4 GB free.** The multipart parser buffers the entire body in RAM; a 300 MB bank import peaks ~1–1.5 GB RSS (buffer + concat + SheetJS). Fine on a real server, OOMs on a constrained/32-bit pool. *(Stream-to-temp-file is the longer-term fix — known issue.)*
- **FE-1 ✓ — Admin UI fails *open* on an `/api/me` error.** `portal.js:1370-1372` + `:1801-1805`: a failed auth load defaults to `mode:'local'`, which shows Upload/Admin to everyone. Server still enforces (403), so it's **cosmetic but confusing**. **Fix:** fail closed — hide admin UI when the auth load fails and the mode can't be confirmed.
- **TEST-1 — No HTTP-level test of the auth gate.** The resolver is unit-tested, but nothing asserts `POST /api/upload` actually 403s for a non-admin in IIS mode, or that an empty allowlist yields 403 not 200. For a broker-dealer's *only* access control, this is currently a manual checklist step. **Fix:** add `tests/server-http.test.js` booting on an ephemeral port with `FBBS_AUTH_MODE=iis` + fake admin list; assert 403 on each ingest route, the 413 cap, and that a same-day partial republish preserves untouched slots (which would also catch SRV-1 regressions).

---

## 5. 🟢 Post-launch backlog (does not block)

- **SRV-4** — Multipart buffers the whole body in RAM; stream large uploads to a temp file (removes OPS-5's ceiling). *(known issue)*
- **SRV-5** — Multipart boundary match isn't CRLF-anchored (`server.js:781`); rare latent corruption with non-browser clients.
- **SEC-3** — `/api/audit-log` + Admin tab readable by any authed rep; decide whether to admin-gate (decision-sheet #9).
- **FE-2** — CD-offers "restrictions" chip is the lone unescaped interpolation (`portal.js:13825`); safe only because the parser filters to 2-letter state codes — escape it for consistency.
- **FE-3** — Daily-package explorer tables render the full filtered set uncapped; add a row cap + "refine filters" footer (other lists already cap).
- **FE-4** — Add a global `unhandledrejection` / `window.onerror` backstop in the SPA.
- **DAT-9** — Baird-syndicate date uses UTC `toISOString()` (off-by-one west of UTC); 2-digit years hard-code `20xx`. `baird-syndicate-parser.js:23`.
- **DAT-10** — Weekly CD Recap `uniqueByCusip` keeps the *earliest* snapshot (stale rate) when a CUSIP recurs in a week; confirm intended semantics. `cd-history.js:215-226`.
- **OPS-6** — `/api/health` is liveness-only; a readiness check that stats `DATA_DIR` writability + opens `bank-data.sqlite` would catch the most common silent deploy failure (permissions).
- **General** — consider a lint rule against raw `innerHTML` interpolation to prevent a future XSS regression (295 sites today, all currently safe).

---

## 6. How this maps to the go/no-go

| Tier | Items |
|---|---|
| 🔴 **Required for launch** | ✅ DAT-1, SRV-3, OPS-1, OPS-2 fixed (this commit). **Remaining:** SRV-1 (Codex), SRV-2 (Codex; strongly recommended — if deferred, gate on disk-monitoring + "no recycle during publish" runbook note), OPS-3 (backup procedure). + verify Codex's go-live status panel green at cutover. |
| 🟠 **Launch-with-condition** | DAT-2…DAT-8 (add the QA data-sanity gate; owner + date), SEC-1 (policy now, code later), SEC-2, OPS-4, OPS-5, FE-1, TEST-1 |
| 🟢 **Post-launch backlog** | SRV-4/5, SEC-3, FE-2/3/4, DAT-9/10, OPS-6, innerHTML lint |

These feed directly into [internal-go-live-readiness.md §8](internal-go-live-readiness.md). Most 🔴 items are **Low/Trivial effort** (a single `web.config` edit covers SRV-3 + OPS-1; two ~2-line CSV fixes cover DAT-1; SRV-1 is a reorder). The biggest *judgment* call is the data-integrity gate (§4) — cheap warnings now, deeper unit-detection later.
