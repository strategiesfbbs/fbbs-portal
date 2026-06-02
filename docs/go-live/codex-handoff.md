# Handoff to Codex — Pre-Launch Review Worklist

> **From:** Claude · **Date:** 2026-06-02 · **Source:** [pre-launch-review.md](pre-launch-review.md) (full findings, file:line, evidence)
> **State:** `npm test` 17/17 · `npm audit` clean · no Critical issues. Claude already fixed
> the four cheapest 🔴 items (commit `f16bdfd`). This is the remaining engineering queue,
> ordered. Each item: where · problem · recommended fix · **done when**.

These are in your lane (server/parsers/deploy). I scoped out the publish-flow and
data-integrity work deliberately — you own publish semantics and have context I don't.
Where it says *"Claude can take this if you want"*, say the word and I'll draft a patch
for you to review (file ownership is relaxed, but I won't touch your hot paths unasked).

---

## ✅ Already fixed by Claude (don't redo) — commit `f16bdfd`
- **DAT-1** CSV formula-injection guard in both exporters (`portal.js` `csvEscape`, `server.js` `escapeCsvCell`).
- **SRV-3 (web.config part)** `nodeProcessCountPerApplication="1"` + iisnode `maxLogFileSizeInKB`/`maxTotalLogFileSizeInKB`.
- **OPS-1** iisnode log-size caps (same edit).
- **OPS-2** `engines.node` pinned `>=20 <25`.

---

## 🔴 Before launch

### SRV-1 — Same-day re-publish deletes the old slot file before validating the new one
- **Severity:** High · **Where:** `server/server.js:6213-6221` (unlink loop) vs `:6245-6248` (signature check)
- **Problem:** On a same-day re-upload the handler unlinks the existing file for each incoming slot, *then* validates each uploaded file. A failed magic-byte check returns 400 with the old good file already gone → the live package silently loses that slot.
- **Fix:** validate + classify **all** incoming files up front (before the unlink/archive block); reject the whole publish on any failure so the existing package is untouched.
- **Done when:** uploading a corrupt file as a same-day replacement returns 400 **and** the previously-published slot is still present in `data/current/`. Add a regression case to TEST-1.

### SRV-2 — Publish is non-atomic (crash / disk-full / recycle → half-written package)
- **Severity:** High · **Where:** `server/server.js:6126-6741`; per-file `fs.writeFileSync` loop `:6263`; `_meta.json` written last `:6676`
- **Problem:** Only the archive-rollover step is wrapped. A failure during the slot-write loop or the different-day archive rename leaves some new files, some old, and a stale/missing `_meta.json`; the cache then rebuilds from a half-written dir.
- **Fix:** stage the new package in a temp dir and atomically rename into place — mirror the bank importer's proven pattern at `bank-data-importer.js:480-498` (temp → backup → rename, rollback on failure). At minimum write `_meta.json` last as the commit point and restore the prior one on failure.
- **Done when:** a simulated mid-publish throw (e.g. inject an error after the first slot write) leaves the prior package fully intact. Pair with disk monitoring + a runbook note: *don't recycle the App Pool during the morning publish.*

### OPS-3 — Live-SQLite backup procedure (process/doc, not code)
- **Severity:** Medium · **Where:** `README.md:178`, [engineering-checklist](../internal-go-live-engineering-checklist.md):57
- **Problem:** `DATA_DIR` holds the only copy of coverage notes / strategies / billing / swap proposals. Copying a live SQLite file mid-write yields a corrupt backup.
- **Fix:** runbook must quiesce the app before copying, or use SQLite `VACUUM INTO` / `.backup` for the workspace DBs. Make "backup **and test a restore**" a launch gate.
- **Done when:** the engineering checklist + runbook specify a safe backup command and a verified restore.

---

## 🟠 Launch-with-condition (assign owner + date)

### Data-integrity gate — the highest-leverage 🟠 (DAT-2 … DAT-8)
The offering parsers anchor on header names (good); the importers and a couple of yield
heuristics are positional/decimal-guessing and fail **silently** on format drift (it
already happened once for Treasury). **Single best fix:** a **Package-QA "data sanity"
gate** that surfaces these instead of publishing confident-wrong numbers.
- **DAT-2** yield `≤1→×100` heuristic mis-states on drift — `agencies-parser.js:120`, `corporates-parser.js` (same). → warn when a yield is outside ~0.1%–25%.
- **DAT-3** Treasury content-sniffer false-match — `treasury-notes-parser.js:287-301`. → make CUSIP `912` prefix the primary signal; log the sniff decision to the publish audit.
- **DAT-4** `cost→commission` fabrication — `cd-offers-parser.js:291-292`. → range-check cost (80–110); warn+drop otherwise.
- **DAT-5** positional column-letters in `bank-data-importer.js:13-104,415,419` & `averaged-series-store.js:63-218`. → validate known header labels vs expected columns at import; abort on mismatch.
- **DAT-6** account-status owner→bank join mis-attaches on shared FDIC certs; unmatched rows silently dropped — `bank-account-status-store.js:502-639`. → require exact normalized-name match before fuzzy include; persist unmatched/conflict rows for review.
- **DAT-7** muni rating agency-swap by letter-case — `muni-offers-parser.js:83-114`. → use column order; blank the missing agency; warn on un-splittable runs.
- **DAT-8** `classifyFile()` keyword collisions — `server/server.js:468-530`. → default ambiguous files to *unclassified* (force slot pick); word-boundary match on `call`.
- **Done when:** Package QA shows out-of-band yield/price warnings, "N rows dropped", surfaced unmatched joins, and the Treasury auto-detect decision; importers abort loudly on column-label mismatch.
- *Claude can take the QA-sanity-gate + the parser warnings if you want — they're additive and outside your hot publish path.*

### SEC-1 — Admin gate covers only the 8 ingest routes
- **Severity:** Medium (policy now) · **Where:** `server/server.js:439-452`
- Every other destructive mutation (delete another rep's strategy/report/coverage note/contact, billing/swap state, peer groups, single account-status import) is open to any authed rep. Acceptable as policy for internal launch ([role matrix §3.4](role-matrix.md)).
- **Fix:** resolve [decision-sheet](decision-sheet.md) #7–#10, then add the chosen routes to `isAdminOnlyApiWrite()` or add owner checks. **Done when:** the decisions are encoded; don't market "role separation" until then.

### SEC-2 — Drop spoofable identity fallbacks in IIS mode
- **Severity:** Medium · **Where:** `server/rep-identity.js:79-89`
- Honors client-settable `auth-user` / `x-forwarded-user` if `x-iisnode-logon_user` is ever absent. **Fix:** in IIS mode trust only the iisnode-managed headers; confirm with IT that Windows-Auth + anonymous-disabled guarantees `LOGON_USER` on every request. **Done when:** a forged `auth-user` header can't set identity under `FBBS_AUTH_MODE=iis`.

### OPS-4 — `uncaughtException` keeps a poisoned process alive
- **Severity:** Medium · **Where:** `server/server.js:7951-7956`
- **Fix:** log then `process.exit(1)` (let iisnode respawn). **Done when:** an uncaught exception exits cleanly and iisnode restarts a fresh worker.

### OPS-5 — Confirm the IIS box is 64-bit with ≥4 GB free
- **Severity:** Medium · The multipart parser buffers the whole body in RAM; a 300 MB bank import peaks ~1–1.5 GB RSS. **Done when:** box specs confirmed in the runbook. (Stream-to-temp-file = SRV-4 backlog.)

### FE-1 — Admin UI fails open on `/api/me` error
- **Severity:** Medium (cosmetic; server still enforces) · **Where:** `public/js/portal.js:1370-1372` + `:1801-1805`
- A failed auth load defaults to `mode:'local'`, showing Upload/Admin to everyone. **Fix:** fail closed when the auth load fails and mode can't be confirmed. *Claude can take this (frontend).* **Done when:** an `/api/me` failure hides admin UI.

### TEST-1 — No HTTP-level test of the auth gate (your only access control)
- **Severity:** Medium · Add `tests/server-http.test.js`: boot on an ephemeral port with `FBBS_AUTH_MODE=iis` + a fake `FBBS_ADMIN_USERS`; assert (a) non-admin gets 403 on each of the 8 ingest routes, (b) empty allowlist → 403 not 200, (c) the 413 cap fires, (d) **same-day partial republish preserves untouched slots** (also guards SRV-1). **Done when:** the suite includes these and passes. *Claude can take this.*

### SRV-3b — finish the single-worker hardening (optional, cheap)
- `sqlite-db.js`: add `pragma('busy_timeout = 5000')` on open. `swap-store.js:155-168`: make the `SP-YYYY-NNNN` mint atomic (`INSERT … ON CONFLICT … RETURNING`). Future-proofs if the worker count is ever raised.

---

## 🟢 Backlog (does not block launch)
SRV-4 (stream large uploads), SRV-5 (CRLF-anchor multipart boundary), SEC-3 (admin-gate `/api/audit-log`?), FE-2 (escape CD restrictions chip), FE-3 (cap explorer table rows), FE-4 (global `unhandledrejection`), DAT-9 (Baird UTC date off-by-one), DAT-10 (Weekly CD Recap keeps stale earliest snapshot), OPS-6 (readiness `/api/health`), innerHTML lint rule. Full detail: [pre-launch-review.md §5](pre-launch-review.md).

---

## Suggested order for today
1. SRV-1 (cheap, prevents live data loss) → 2. TEST-1 (locks SRV-1 + the auth gate) →
3. SRV-2 (atomic publish) → 4. OPS-4, SEC-2 (cheap hardening) → 5. data-sanity gate (DAT-2/3/4 warnings first) → 6. OPS-3 + OPS-5 (runbook/box) → SEC-1 once the decision sheet is back.
