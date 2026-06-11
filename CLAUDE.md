# FBBS Market Intelligence Portal — Working Notes

Internal Node.js web app for First Bankers' Banc Securities, Inc. — publishes the daily document package and surfaces it via Explorer pages and Bank Tear Sheets. Built to run the same way on a laptop, a dedicated workstation, or behind IIS with iisnode.

For Institutional Use Only.

## Company / product context

Read `docs/company-portal-context.md` when brainstorming portal direction, Salesforce replacement, bank coverage workflows, strategy/task queues, billing queues, maps, or product-fit ideas. Keep that context strategic and non-sensitive; do not copy settlement instructions, account numbers, or private approval-packet details into the repo.

## Constraints to weigh against any change

- **Two npm deps** (`pdf-parse`, `better-sqlite3`). Excel parsing uses a pinned vendored SheetJS build at `vendor/sheetjs/xlsx-0.20.3/` via `server/xlsx.js` because the public npm `xlsx` package is stuck on a vulnerable 0.18.x line. `better-sqlite3` is a *native addon* — it ships prebuilt binaries (via `prebuild-install`) for common platform/Node-ABI combos, so `npm install` normally needs no compiler; the fallback is a `node-gyp` build, which on Windows would need Visual Studio build tools. Pin it and keep the install path prebuilt. This small dependency footprint is still deliberate — every new dependency makes deployment harder for a non-developer to babysit. Justify additions; prefer Node built-ins or shelling out to tools that exist on every box (e.g. `unzip`).
- **No built-in auth.** Trusted-LAN model. Production answer is IIS Windows Authentication. Don't add app-level auth without checking — the deployment story changes.
- **Plain Node, no build step.** No Webpack/Babel/TypeScript. The portal must start with `npm install && npm start` on a fresh machine. The launchers (`start-portal.bat`, `start-portal.command`) assume this.
- **Filesystem-as-database for the daily package.** No DB for the document package; archive/restore is `mv`-ing folders. Bank tear sheets are the one exception (SQLite).
- **Files prefixed with `_` are private metadata** — never serve them over `/current/` or `/archive/`. Both file-serving routes enforce this.

## Daily package — 10 slots

`dashboard` (HTML), `econ` (PDF), `relativeValue` (PDF), `treasuryNotes` (xlsx, parsed into Treasury Explorer), `cd` (PDF), `cdoffers` (PDF or Excel workbook), `munioffers` (PDF), `agenciesBullets` (xlsx), `agenciesCallables` (xlsx), `corporates` (xlsx).

Filename auto-classification lives in `classifyFile()` in `server/server.js`. Same-day re-publishes only replace the slots being re-uploaded (this was the v1.3.3 fix); different-day uploads roll the whole package into `data/archive/YYYY-MM-DD/`.

## Architecture map

- `server/server.js` (~9400 lines) — request router, multipart parser, upload handler, security headers, audit log, graceful shutdown. One process, no framework.
- `server/{cd-offers,brokered-cd,muni-offers,economic-update,agencies,corporates}-parser.js` — PDF/xlsx → structured JSON parsers. Each one is independent and unit-testable.
- `server/cd-history.js` + `cd-history-importer.js` — Weekly CD Recap (542+ daily snapshots in `data/cd-history/`).
- `server/sqlite-db.js` — shared SQLite access layer over the `better-sqlite3` native addon. Exposes `execSqlite(dbPath, sql)` (fire-and-forget DDL/DML), `querySqliteJson(dbPath, sql, [params])` (rows as plain objects), `runSqlite(dbPath, sql, [params])` (parameterized single write → `{ changes, lastInsertRowid }`), `transaction(dbPath, statements[])` (several parameterized writes atomically), and `withDatabase(dbPath, fn)` (one connection handed to a callback — for bulk work like the bank-workbook import that sets perf PRAGMAs and streams thousands of rows through one prepared INSERT). Opens/closes a handle per call — cheap because opening doesn't load the DB, and it avoids stale handles when an importer recreates a DB file in-process. All seven stores call through this; none shell out to the `sqlite3` CLI anymore.
- `server/bank-data-importer.js` + `bank-coverage-store.js` + `bank-account-status-store.js` — Bank Tear Sheets and account status workspace. All three go through `sqlite-db.js` with bound parameters; the legacy `sqlString()` / `sqlNumber()` interpolation helpers are gone. Only whitelist-validated identifiers (column / JSON-path / metric keys, operators, ORDER BY) are ever inlined — every user-supplied value binds. `bank-account-status-store.js` ingests the "Account + FDIC Cert" workbook, joins each row to a bank summary by FDIC cert (latest period wins ties), and surfaces the status (`Open`, `Prospect`, `Client`, `Watchlist`, `Dormant`) on every search result and the tear sheet.
- `server/strategy-store.js` — SQLite-backed Strategies Queue for Bond Swap, Muni BCIS, CECL Analysis, and Miscellaneous requests. Workflow statuses are `Open`, `In Progress`, `Completed`, and `Needs Billed`; completed/billed requests can be archived without deleting their bank history. Requests can be created from a bank tear sheet and worked from the Strategies tab.
- `server/pdf-text.js` — wraps `pdf-parse@1.1.1` with a custom page renderer that inserts spaces between adjacent text items and groups items within a small Y tolerance into one row. Every PDF call in `server/server.js` (CD offers, brokered CD, muni, economic update) goes through `extractPdfText()`.
- `public/index.html` (~3100 lines) — single-page app shell with all page templates inlined.
- `public/js/portal.js` (~20600 lines) — SPA. Heavy `innerHTML` usage; XSS protection comes from the `escapeHtml`-style helpers it uses to wrap untrusted strings before interpolation. The dashboard slot's iframe is sandboxed (`allow-scripts` only) so user-uploaded HTML can't reach back into the parent. Large enough now that a no-build modularization is underway — see `public/js/modules/`.
- `public/css/portal.css` — single stylesheet, ~14800 lines.
- `web.config` — IIS deployment via iisnode. Hides `data/`, `server/`, `node_modules/`, `iisnode/` segments. Cap is 100 MB at the IIS layer; app enforces tighter `MAX_UPLOAD_MB`.
- `tests/parser-regression.test.js` — single-file regression suite, run via plain `node`. No test framework.
- `server/averaged-series-store.js` — parses the FedFis "AVERAGED_SERIES" peer-group workbook into `{ peerGroups, metrics, series }` JSON. Pure fs + xlsx; output lands in `data/bank-reports/averaged-series/`.
- `server/bond-accounting-store.js` — ingests the bond-accounting bank list workbook + a folder of portfolio workbooks, joins each portfolio file to a bank by `P####` code → FDIC cert, copies the files into `data/bank-reports/bond-accounting/{matched,unmatched}/...`, and writes `manifest.json`. Tear sheets read this via `getBondAccountingForBank()`.
- `server/mbs-cmo-store.js` — stores MBS/CMO source uploads and parsed offer inventory under `data/mbs-cmo/`.
- `server/exec-summary-parser.js` + `server/exec-summary-store.js` — the **management-only Executive Summary** (Operations → Exec Summary tab; CEO/desk-head view). Parser turns the four daily exports (inventory & risk grid, TH trade activity, sector/issuer blotter, `…MARGIN CALC.xlsm`) into normalized JSON via vendored SheetJS; store computes capital / risk-DV01 / P&L / revenue / activity / capital-efficiency / exceptions + a **deterministic** CEO narrative, and persists one idempotent snapshot per COB date to `data/exec-summary/exec-summary.sqlite` (+ a `_<date>.json` copy). Routes (all **admin-gated** via `FBBS_ADMIN_USERS`, Tier-B internal-only): `GET /api/exec-summary[?date=]`, `GET /api/exec-summary/history`, `POST /api/exec-summary/upload` (4 files, field- or content-classified). Market overlay reuses the portal's Economic Update (`marketFromEconomicUpdate`) — no new feed. Rep names come from the shared firm roster (`server/rep-roster.js` → `SALESPERSON_MAP = REP_ROSTER`, the single source of truth, reusable by other pages); only the desk-level `TRADER_MAP` is still stubbed pending real desk codes. Tests: `tests/exec-summary-store.test.js`.
- `server/wirp-store.js` — stores the brokered-CD WIRP (forward-rate / rate-probability) workbook upload + parsed forward-path analysis under `data/bank-reports/`. Wired into `/api/brokered-cd/wirp/upload` (classified in `classifyFile()`); `recommendBrokeredCdTerms()` reads `loadWirpAnalysis()` to bias term recommendations off the forward curve.
- `server/swap-math.js` — pure-function bond swap math: day count (30/360 + Actual/Actual), accrued interest, TE-yield, breakeven, per-leg economics, FBBS desk-rule check, weighted-avg portfolio aggregation, end-to-end summary. No I/O — shared by the server route and the regression tests so the math is auditable.
- `server/swap-store.js` — SQLite store for the bond-swap proposal builder (`data/bank-reports/swap-proposals.sqlite`): proposals + legs + frozen snapshots. Sequence IDs `SP-YYYY-NNNN`. Once `send`ed, legs become read-only and the canonical record is the snapshot JSON (so re-renders of a sent proposal never silently shift as market data moves). Goes through `sqlite-db.js` like `strategy-store.js`.
- `server/swap-render.js` — server-side renderer for printable swap proposals (`/api/swap-proposals/:id/render`). Standalone HTML, inline styles, `@media print` for Save-as-PDF. Layout mirrors the FBBS Master Swap Template v4.6 print area.
- `scripts/import-weekly-cd-worksheet.js`, `scripts/import-bank-workbook.js`, `scripts/import-bond-accounting-folder.js` — one-off CLI importers.
- `public/js/modules/report-logic.js` — UMD module (node-testable): the pure engine behind the dynamic report builder — condition evaluation (type-aware operators), `aggregateValues`, `groupRows` (nested Then-by + per-group aggregates). Tests: `tests/report-logic.test.js`.

## CRM layer (2026-06-10, Phases 1–5)

Built on `bank_activities` in `bank-coverage.sqlite` (one table, two row species: system-audit rows and **manual rep-logged activities** — kinds `call/email/meeting/task/note` with `subject/body/activity_date/contact_id` columns, added by an idempotent PRAGMA-guarded migration).

- **Logging:** `POST /api/banks/:bankId/activity` + Log Activity form on the bank tear sheet (type pills, contact picker, filter chips; the "All" chip hides audit rows). Store fns: `recordManualActivity`, `lastActivityByBank`, `activityCountsByRep`, `activityCountsByBank`, `listRecentManualActivities`.
- **Surfacing:** saved views (`bank-views.js`) join a color-coded `lastActivityDate` column (green ≤30d / amber ≤60d / red); view tables have persisted per-view column sort; `/api/me/work` adds `myColdAccounts` (owned banks, no manual touch in 30d) and Home MY WORK shows the matching tile.
- **Reports v2:** custom-bank builder has stackable AND conditions over every dataset field + Group By/Then-by with Count/Sum/Avg/Min/Max (persisted inside the saved definition's filters blob — no schema change); rail is Templates / Recently Ran / My Custom Reports + folders; three seeded starter templates. New Sales report types: `activity-by-rep` (`GET /api/reports/activity-summary`, by-rep or by-bank) and `account-touch` (`GET /api/reports/account-touch`, "no touch in N days").
- **CRM Pulse:** `#pulse` (NOT the `#dashboard` daily-package slot) renders `GET /api/crm/dashboard` — KPIs, clients/prospects by state, strategies by type, recent activity, 14-day follow-ups; rep-scoped via the acting-rep cookie, `?rep=all` for firm-wide; CSS bars, no chart lib.
- **Deliberately dropped:** scheduled/emailed report delivery (no email/cron infra; two-npm-dep rule). The Save & Schedule button stays disabled.
- `tests/frontend-parse.test.js` compiles `portal.js` + every `public/js/modules/*.js` in `npm test` — a syntax error in the no-build SPA now fails CI instead of shipping a blank page.
- **Activity soft-delete (compliance):** `DELETE /api/banks/:id/activity/:activityId?reason=` requires a reason and stamps `deleted_at/deleted_by/delete_reason` instead of removing the row; every read path filters deleted rows centrally in `activitySelectSql`. Don't add hard deletes back.

## Wave-1 improvement push (2026-06-10)

From the full review in `docs/improvement-roadmap-2026-06-10.md` (read it before starting Wave-2 work — FDIC/FFIEC importer, task engine, opportunities, Graph mailbox are next):

- `server/market-rates.js` — the portal's **first outbound integration**: fetches the no-key home.treasury.gov daily par yield curve XML, caches under `data/market/` (6h TTL, stale-on-failure, never throws). `GET /api/market/yield-curve` serves it; Treasury Explorer shows an official-curve banner; `loadMarketOverlay()` (server.js) prefers the package's Economic Update and falls back to the official curve for the exec-summary market overlay. Tests: `tests/market-rates.test.js` (fixture-driven, no network).
- `server/market-wire.js` — live Market Wire (2026-06-11): official headlines (Federal Reserve / FDIC / SEC press-release RSS, 30m TTL, per-feed outage keeps that feed's cached items) + CPI-YoY / unemployment from the keyless BLS API (12h TTL — unregistered tier is 25 calls/day; the request spans 3 years so January prints still find the prior-year CPI month). `GET /api/market/wire` adds a 10Y/2Y/2s10s summary from the cached Treasury curve; the Home "Market Wire" section auto-refreshes every 15min while visible. Same playbook as `market-rates.js`: keyless public-domain sources only (Bloomberg/S&P licensing wall — link out, never republish), cache under `data/market/`, stale-on-failure, never throws. Treasury auction stops/bid-to-cover + the upcoming calendar ride along from the keyless TreasuryDirect TA_WS API (1h TTL; bills fall back highYield → highInvestmentRate → highDiscountRate). Tests: `tests/market-wire.test.js`. The SPA also runs visibility-aware live polling (`setupLivePolling()` in portal.js): a 3-min fingerprint poll of `/api/current` re-runs `loadCurrent()` + the active inventory page's loader when the desk re-publishes (toast shown; no-change polls never re-render), and CRM Pulse force-refreshes every 5 min while open.
- **CUSIP-first global search:** `GET /api/search/cusip?q=` scans all current-package slot JSONs + MBS/CMO + structured-notes inventories (`cusipSearchSources()` in server.js); the nav jump search appends security hits for CUSIP-shaped queries and deep-links to the right explorer with `?q=` pre-seeded.
- **Bloomberg licensing wall (from the API research):** the desk's *own* TOMS inventory is firm data and may be auto-published to the portal (pursue the feed with the Bloomberg rep); terminal/Excel-derived *market data* (BVAL, DES fields) must NOT be redistributed to the LAN portal — Designated-Authorized-Computer restriction.
- Muni explorer CUSIPs link out to MSRB EMMA; explorer subtitles show an "Updated h:mm" freshness stamp from the slot JSON's `extractedAt`/`uploadedAt`; tear-sheet website field renders as a link.
- Launch-era docs moved to `docs/archive/go-live/`.

## Wave-2 improvement push (2026-06-11)

- **Task engine** (`bank_tasks` in `bank-coverage.sqlite`): future-dated follow-ups per bank — title/body/due_date/priority/assignee, status `Open/Done/Cancelled` with completion stamps. Routes: GET+POST `/api/banks/:id/tasks`, PATCH `/api/bank-tasks/:id`, GET `/api/me/tasks` (overdue/due-today/upcoming buckets). UI: tear-sheet Tasks panel, "Follow-up due" date on the Log Activity form (logs the call AND creates the task), My Work "My Tasks" tile, Pulse open/overdue-task KPIs. Task create/complete write system rows (`task-create`/`task-complete`) to the bank timeline. Distinct from the past-tense `task` activity kind and from `next_action_date`.
- **Opportunities / pipeline** (`bank_opportunities`): the *selling* side (Strategies Queue stays fulfillment) — product, est value, stage `Prospect→Qualified→Proposed→Won/Lost`, close date, owner; `stage_changed_at`/`closed_at` stamps. Routes: GET+POST `/api/banks/:id/opportunities`, PATCH `/api/bank-opportunities/:id`, GET `/api/reports/pipeline` (rep-scoped, `?rep=all`). `pipelineSummary()` (open $ by stage/product/owner + won/lost this quarter) rides on `/api/crm/dashboard`; Pulse shows a Pipeline card; tear sheet has an Opportunities panel with inline stage moves. Won/Lost land on the bank timeline (`opportunity-won/lost`).
- **FDIC BankFind live check** (`server/fdic-bankfind.js`): free keyless api.fdic.gov headline financials by FDIC cert, 24h disk cache under `data/market/fdic/`. `GET /api/banks/:id/fdic-check` compares the FDIC's latest quarter to the workbook period; tear sheet shows an "FDIC live" bar that flags when a newer quarter is out (the cue to refresh the 153MB workbook import). Tests: `tests/fdic-bankfind.test.js`.
- **FDIC bulk quarterly sync** (`server/fdic-bulk-sync.js`): admin Upload-page button → `POST /api/admin/fdic-sync` (`?dryRun=1` first; confirm dialog shows counts). Fetches the newest broadly-filed quarter for ALL filers (~4,400, one API page), maps ~30 RIS fields → `BANK_FIELDS` keys, and **adds** that period to each cert-matched bank in `bank-data.sqlite` — it never overwrites an existing period, so the FedFis workbook stays authoritative and its next full import (which rebuilds the DB) supersedes the stopgap rows. New-period rows carry `values.source = 'fdic'` and carry forward identity text only (never numbers). Summary period/assets/deposits bump only when genuinely newer. Tests: `tests/fdic-bulk-sync.test.js`. The deeper FFIEC bulk-ZIP importer (full RC-B schedules) remains on the roadmap if/when the workbook should be fully replaced.

## Wave-3 improvement push (2026-06-11)

- **All Offerings (cross-asset explorer):** `GET /api/offerings/all` — every security in today's package + MBS/CMO + structured-notes inventories, normalized to one row shape via per-source `normalize()` on the `cusipSearchSources()` registry (server.js). The `#all-offerings` page (heads the Offerings nav group) has asset-class chips, search, min-yield / matures-by filters, sortable grid, CSV export; each row's Open button deep-links to the native explorer via the shared `data-goto`/`data-cusip` plumbing. New asset classes only need a registry entry.
- **Contacts directory + Salesforce import:** `#contacts` page (Banks group) lists every `bank_contacts` row firm-wide, joined to bank names (`GET /api/contacts?q=` searches contact AND bank fields); rows link to tear sheets. `POST /api/contacts/import` (`?dryRun=1` first) ingests a Salesforce contact-export CSV — flexible header detection, Account Name → bank match by normalized display/legal name (ambiguous rejected with reason), dedup by bank+email / bank+name — via an Upload-page button with a confirm dialog. This is the SF history migration path.
- **Watchlists:** `watchlist_items` in `bank-coverage.sqlite` (per-rep, kind `security`|`bank`, UNIQUE per rep). `GET/POST/DELETE /api/me/watchlist`; GET re-joins securities against today's inventory (live yield/price + offered-today flag). ☆ on All Offerings rows, ☆ Watch on the tear sheet, `#watchlist` page.
- **Single-source nav (2026-06-11):** the sidebar is the one navigation; the top strip is hamburger + date + jump search + External Tools + rep picker only. The old top-strip primary links / Offerings / Operations dropdowns are gone (they had gone stale vs. the sidebar), and Strategies Queue + Bond Swap got a sidebar Strategies section. Office-locations lines were removed from the SPA footer and both printable renderers (FINRA/SIPC disclosure stays). New pages only need a sidebar entry.
- **Deliberately deferred:** the 6-explorer factory refactor and the server.js router extraction — high-churn internal refactors planned as a dedicated pass (coordinate with Codex first); the All Offerings registry already gives the cross-asset behavior additively.

## Data layout

```
data/
├── current/              ← today's package (slot files + _meta.json + per-slot _*.json)
├── archive/YYYY-MM-DD/   ← prior days, same shape
├── cd-history/           ← per-day CD-offer snapshots, fed into Weekly CD Recap
├── bank-reports/
│   ├── current-bank-call-reports.xlsm  (~153 MB source workbook)
│   ├── bank-data.sqlite                (~136 MB derived DB)
│   ├── bank-coverage.sqlite            (notes + saved-coverage workspace)
│   ├── bank-strategies.sqlite          (Strategies Queue requests)
│   ├── averaged-series/                (FedFis peer-group workbook + parsed JSON)
│   ├── bond-accounting/                (manifest.json + matched/unmatched portfolio copies)
│   └── swap-proposals.sqlite           (Bond Swap proposals — header + legs + frozen snapshots)
├── mbs-cmo/             ← MBS/CMO source uploads + parsed inventory
└── audit.log             ← append-only JSON-lines, one record per publish
```

`DATA_DIR` env var redirects everything outside the app folder — recommended for IIS so upgrades don't risk the archive.

## Config (env vars; all optional)

`PORT` (3000), `HOST` (`0.0.0.0`), `DATA_DIR`, `MAX_UPLOAD_MB` (50), `BANK_UPLOAD_MAX_MB` (300), `LOG_LEVEL` (`info`), `AUDIT_LOG_MAX_MB` (10), `AUDIT_LOG_KEEP` (5).

## Security posture (current)

- Path traversal blocked via `safeJoin()` for `/current/`, `/archive/`, and static assets.
- `_`-prefixed files refused at both routes.
- Filenames sanitized via `sanitizeFilename()` before any disk write.
- Magic-byte signature check on every uploaded file (`looksLikePdf` / `looksLikeExcel` / `looksLikeHtml`).
- Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: SAMEORIGIN`, and `Content-Security-Policy` (scoped — strict CSP is applied to the SPA shell + APIs; uploaded dashboard HTML served from `/current/*` or `/archive/*` gets a sandbox CSP so direct opens stay isolated while still allowing scripts).
- Dashboard iframe carries `sandbox="allow-scripts"` (no `allow-same-origin`) — its JS still runs but it gets an opaque origin and can't call our APIs.
- Mutating `/api/*` requests are blocked when browser same-origin signals indicate a cross-site write.
- Streaming file responses (`fs.createReadStream` + pipe).
- Graceful shutdown on SIGINT/SIGTERM.

What's intentionally *not* there: app-level auth, CSRF tokens, rate limiting, log rotation. All deferred to the LAN/IIS posture.

## Bond Swap proposal builder (Strategies → Bond Swap tab)

Multi-leg swap-proposal tool aimed at producing the client-facing one-pager FBBS reps currently build in `Master Swap Template v4.6.xlsx`. Backend is live (commits Apr/May 2026); UI tab is the next commit.

**Hard rule (the only auto-filter on suggested swaps):** the held bond can't mature *before* the breakeven — the loss can't be recouped from a bond that's already gone. The Build-your-own (manual CUSIP entry) flow bypasses this; rep + account can override with intent.

**Soft thinking points** (warnings only, never filters): breakeven > 12mo · held maturity < 12mo · no annual yield pickup. Every swap and portfolio is different — the desk decides per situation. Defaults live in `swapMath.DEFAULT_FBBS_RULES`.

**Portfolio Idea Engine (the Bond Swap home for bond-accounting banks).** `GET /api/swap-proposals/suggested?bankId=` is now a server-side port of the standalone "FBBS Portfolio Idea Engine" prototype — it runs the desk's Portfolio Filtering workflow off the already-parsed bond-accounting holdings + the workbook's cashflow series, and returns a full report. The response carries `kept` (the screened swap candidates, full list), `dropped` (hard-rule failures), `packages` (auto-suggested multi-sell baskets — see below), `knobs`, `profile`, `runoff`, `hero`, and `findings` (server-composed prose cards). The UI ([portal.js](public/js/portal.js)) renders a knobs bar, an Opportunity Summary hero, the multi-bond package cards, a portfolio snapshot, sector bars, a maturity/runoff table, the top-12 candidate cards, an interactive selectable **blotter** with live package totals + CSV export, and the narrative findings.

- **Knobs** (all optional query params; defaults shown): `taxRate` (from the bank's Sub-S election — 21% C-corp / 29.6% Sub-S), `cof` (1.5), `bq` (0.20 BQ / 1.00 non-BQ), `reinvestRate` (target YTW; blank = 5.00% default), `maxPctLoss` (4.0), `maxDollarLoss` (10, $000), `minPar` (100, $000), plus `minPickup` / `smallGlPct`.
- **TEY for exempt munis.** Held exempt-muni yields are gross-up'd to a taxable-equivalent basis via `swapMath.municipalTeYield()` — the verified FBBS form `(YTW − COF·t·q)/(1−t)` — *before* comparing to the reinvestment target, so munis screen like-for-like against taxable reinvestment. **Validated cell-for-cell against `Master Swap Template v4.6.xlsx`** (BL/BJ columns): the `q` (BQ disallowance) factor follows the template's `CQ` — C-Corp BQ 0.20 / non-BQ 1.00, **S-Corp BQ 0** / non-BQ 1.00 — derived server-side from the bank's Sub-S election + the rep's BQ choice.
- **Income pickup & breakeven match the master template** (Hand Income / BM-BO columns): income given up = `(Book Value + Accrued) × effective yield`, income gained = `Proceeds (Market Value + Accrued) × reinvest target`, breakeven = `−G/L ÷ (net annual income ÷ 12)`. `reinvestTargetEconomics()` computes this; `addedAnnualIncome` and `reinvestBreakevenYears` derive from it (not a market-value shortcut).
- **The model is a pure sell-side screen** (matches the prototype): every idea is *sell this underearning bond, reinvest the proceeds at the target rate*. **All sectors are screened** — including MBS/CMO/CMBS/SBA/ABS, which aren't in `SWAP_SECTOR_MAP` and so surface as generic reinvest ideas (no matched-buy attempt). Amortizing sectors never solve YTM from price (the bullet formula is wrong for them) — they use the file's book yield or are skipped. The screen, in the prototype's order: position ≥ `minPar`; any realized loss within `maxPctLoss`% and `maxDollarLoss`$ (gains pass — we keep small gains too); **not maturing within 12 months**; then effective yield (TEY for munis) **below the reinvest target** (`pickup = target − eff > 0`). Candidates are **ranked lowest effective yield first**. Each carries `tags[]` (`below-reinvest`/`small-gain`/`small-loss`/`yield-pickup`), `held.{effYield,teYield,gainLossPct,isExemptMuni,wal,effDuration}`, `pickupVsReinvest`, `addedAnnualIncome`, and `reinvestBreakevenYears` (= |%loss|/annual pickup).
- **Reinvestment target** = a single **flat rate the rep sets**, default **5.00%** (the prototype's default). Returned as `reinvestTarget` + `reinvestTargetSource` (`knob`|`default`). It is *not* derived from inventory — the engine doesn't need the daily package to produce ideas.
- **Matched buy is an "available today" hint, not the idea.** Each candidate's economics are the sell-and-reinvest-at-target numbers (`reinvestTargetEconomics`, effective-yield basis). When a concrete same-sector offering in today's package beats the held book yield, it's attached (`offering.generic = false`, `availableToday: true`, `yieldPickupVsBook` set) so "Build proposal from this" can seed a real buy leg; otherwise `offering.generic = true` ("Reinvest at X% target", no CUSIP). The hard rule (held maturity ≥ breakeven) is still the only thing that *drops* a candidate (into `dropped[]`).
- **Auto-suggested multi-sell packages (`packages[]`).** Beyond the one-bond-per-card screen, the engine bundles several underearning `kept` lots — **across sectors** — into a single multi-leg swap that reinvests the combined proceeds into one **best-fit buy** (`pickPackageBuy()` scores every mapped-sector offering with the same `scoreOfferingFit` ladder-gap logic the per-bond engine uses, requiring `yield ≥ reinvestTarget`; falls back to a generic reinvest-at-target leg). `buildSwapPackages()` (server.js) greedily admits worst-earners-first, keeping a lot only while the WHOLE package clears `swapMath.summarizeReinvestPackage()`'s three gates: **(1)** net annual income pickup > 0, **(2)** breakeven ≤ `packageBreakevenCap` (default 24mo, vs the 12mo single-bond desk soft-cap — looser because packages blend small gains in), **(3)** every sold bond matures ≥ the package breakeven, plus net-benefit-to-horizon > 0. Package economics are summable: income given up + realized G/L + proceeds are per-member sums, income gained = `Σproceeds × buyYield`, breakeven = `Σloss ÷ (pickup ÷ 12)`. Capped at `packageMaxLegs` (default 8) lots so it stays an actionable one-pager. Each package = `{ id, title, sectorsSold, sells: [full candidate objects], offering, economics, breakevenCapMonths }`. The UI ([portal.js](public/js/portal.js) `renderSwapPackages`) shows a card with the gate stats + sell table; **"Build proposal"** (`buildProposalFromPackage`) seeds **one sell leg per lot** (CUSIP-aware — multiple tax-lots of the same CUSIP each become a leg, unlike the blotter's `buildProposalFromCandidates` which dedups) + the targeted buy sized to proceeds. The math is unit-tested in [tests/swap-math.test.js](tests/swap-math.test.js).
- **Runoff pipeline** comes from the workbook's `cashflow data` sheet (parsed by [portfolio-parser.js](server/portfolio-parser.js) into `parsedHoldings.cashflow`, schema v4): projected base-balance decline at 6/12/24mo (calls + amortization + maturities) vs. stated-maturity runoff.
- **Missing held yields are solved from price.** Muni sheets often leave the raw `Bk YTW` column blank (only the TE column is filled), so the screen falls back to `swapMath.yieldFromPriceAndMaturity(bookPrice, coupon, maturity)` to get a nominal book YTW, then grosses it up with `municipalTeYield`. Net effect: a muni whose TE yield *exceeds* the reinvest target is correctly a KEEP (not surfaced); only genuinely-underearning munis appear.
- Portfolio weighted averages (WAL/duration/coupon/yields) are par-weighted over only the holdings that report the field (some sector sheets omit WAL — don't dilute with zeros).

**Tax rate:** auto-derived from the bank's `Subchapter S Election?` field (already parsed on every tear sheet). `No` → 21% (C-corp), `Yes` → 29.6% (Sub-S). Rep can override per proposal.

**Settle date:** T+1 business day from the proposal date by default (`swapMath.defaultSettleDate`). T+2 for munis. Rep can override.

**Status lifecycle:** `draft → sent → executed → cancelled`. On `send` the legs freeze and the canonical record becomes the `swap_proposal_snapshots.snapshot_json` row — re-renders never silently shift as market data moves. Revisions clone into a new SP-YYYY-NNNN.

**Send is gated by a completeness check.** `buildProposalSnapshot()` enriches legs (derives blank yields/duration from price+coupon+maturity) *before* freezing, so the immutable snapshot — and the printed sent proposal that renders from it — matches what the rep approved in the live editor. `send` then runs `swapMath.validateLegsForSend(sells, buys)` on those enriched legs and returns `400 { error, issues[] }` if any leg lacks the data its printed economics need (par, maturity, prices, a usable yield), rather than freezing a proposal full of `—`. The leg add/update routes range-check numeric inputs via `swapMath.validateLegInput()` (rejects e.g. negative par, a 150% coupon) before writing; empty stub rows still pass so the add-then-fill workflow is unaffected.

**Automated buy sizing (proceeds-balancing solver).** `swapMath.solveBuyParForProceeds({ sells, buys, flexIndex, settleDate, targetNetCash, parIncrement })` sizes one buy leg's par so total buy proceeds match total sell proceeds (cash-neutral) or hit a target net-cash difference — the "Solver" reps run by hand in the Excel template. Proceeds = market value + accrued, both linear in par, so it's a closed-form solve (no iteration). Exposed read-only at `GET /api/swap-proposals/:id/size-buy?flexLegId=&targetNetCash=&parIncrement=` (defaults: sole buy leg, 0, 1000). **Advisory only** — it returns a `suggestedPar` the rep applies through the normal PATCH-leg path so the hard/soft swap rules still re-evaluate; the route never mutates. `flexLegId` is required when there are multiple buy legs. **UI:** each buy leg row in the builder (draft only) has a **"Size"** button (`sizeBuyLeg()` in `portal.js`) that calls this route for that leg, shows the cash-neutral suggestion + resulting net cash in a confirm, and on accept PATCHes the par.

**Routes (server/server.js):**

```
GET    /api/swap-proposals/eligible-banks      banks with bond-accounting holdings (picker)
GET    /api/swap-proposals/suggested?bankId=X  Portfolio Idea Engine → { kept, dropped, packages, knobs, profile, runoff, hero, findings, reinvestTarget } (opt knobs: taxRate, cof, bq, reinvestRate, maxPctLoss, maxDollarLoss, minPar, packageBreakevenCap, packageMaxLegs)
GET    /api/swap-proposals/holdings?bankId=X   parsed portfolio for CUSIP search
GET    /api/swap-proposals/inventory[?state=]  daily-package buy-side offerings (CUSIP search)
GET    /api/swap-proposals/:id/size-buy        advisory proceeds-balancing buy par (read-only)
GET    /api/swap-proposals                     list (bankId/status filters)
POST   /api/swap-proposals                     create draft
GET    /api/swap-proposals/:id                 fetch full record
PATCH  /api/swap-proposals/:id                 update header (draft only)
POST   /api/swap-proposals/:id/legs            add leg
PATCH  /api/swap-proposals/:id/legs/:legId     update leg
DELETE /api/swap-proposals/:id/legs/:legId     remove leg
POST   /api/swap-proposals/:id/send            freeze + write snapshot
POST   /api/swap-proposals/:id/execute         mark sent → executed (syncs linked strategy → Completed)
POST   /api/swap-proposals/:id/cancel          cancel
POST   /api/swap-proposals/:id/clone           clone a sent/cancelled proposal into a new draft
GET    /api/swap-proposals/:id/render          printable HTML (uses snapshot if sent)
```

Every mutating route writes to `data/audit.log`.

## Known issues / open work

- **Multipart parser buffers entire body in RAM.** OK for 50 MB; the 300 MB bank-workbook ceiling is heavier — switch to streaming if/when memory pressure shows.
- **All 6 parser/classification behavior lows are resolved** (verified in code 2026-06-09; this completes the 2026-06-03 review — all 10 mediums + 9 safe lows + L14-L20 are on origin/main): L15 agencies/corporates header-row scan, L16 treasury `findAsOfDate`, L17 bank-importer sheet9 fallback, L19 internal-CD misclassify, L20 stale-package merge, and **L14 econ-update date pairing**. Note on L14: `parseEconomicEvents()` intentionally emits `dateTime: null` + a count-mismatch warning for non-inline releases (rendered as "Watch") *by design* — the real PDF decouples event names from date rows with no usable adjacency, so any index-zip pairing produced plausible-but-wrong dates. This is the agreed fix, not a stub. Worth a final go-live smoke test of L14/L15/L17 against real desk files (a non-inline econ PDF, a banner-row workbook, a reordered-sheet xlsm); full spec in `docs/archive/go-live/codex-handoff-parser-lows-2026-06-03.md`.

_(Resolved since this list was written: `getCurrentPackage()` / `getArchiveList()` are now cached and invalidated via `invalidatePackageCache()` on upload success; the audit-log read is a tail-read (`readFileTail()`), not whole-file; the audit log now rotates by size — `server/log-rotation.js`, env `AUDIT_LOG_MAX_MB` / `AUDIT_LOG_KEEP`; the bank-search account-status enrichment batches its coverage/status lookups once per query, so the old `effectiveAccountStatus()` N+1 no longer applies.)_

## Conventions

- Logging: `log('info' | 'warn' | 'error' | 'debug', ...)`. Goes to stdout/stderr; iisnode captures it on Windows.
- Audit log entries: `{ event, ...payload, at: <ISO> }`, one JSON object per line in `data/audit.log`.
- Archive folder names are strictly `YYYY-MM-DD`; readers regex-validate before trusting.
- Internal JSON files mirror the slot names: `_offerings.json`, `_muni_offerings.json`, `_treasury_notes.json`, `_agencies.json`, `_corporates.json`, `_economic_update.json`, plus `_meta.json` for package-level metadata.
- All explorer CSV exports include the package date in the filename.
- New parsers should return `{ asOfDate, warnings, offerings, ... }` — the publisher injects `extractedAt`/`uploadedAt` and source filenames before writing.

## Branch / workflow

- Single trunk: `main`. Both Codex and Claude Code commit here. Keep commits small and self-contained so the other agent can `git log` and pick up where you left off.
- Tests: `npm test` (runs `tests/parser-regression.test.js`, `tests/swap-math.test.js`, `tests/swap-store.test.js`).
- Start: `npm start` or `node server/server.js`, or double-click the platform launcher.
- Shared Claude Code plugin: `tools/fbbs-plugin/` (marketplace at `.claude-plugin/marketplace.json`). Install with `/plugin marketplace add .` then `/plugin install fbbs@fbbs-tools`. Commands: `/fbbs:test`, `/fbbs:verify`, `/fbbs:package-status`, `/fbbs:publish`, `/fbbs:trader-emails`, `/fbbs:reports-context`. A `PreToolUse(Bash)` hook runs `npm test` and blocks any `git commit` on `main` that fails — Claude Code only, so Codex must keep running `npm test` before committing. See `tools/fbbs-plugin/README.md` (also carries the feature-backlog work split).

## Dual-agent workflow (Codex + Claude Code)

- This repo is edited by both Codex (CLI/IDE) and Claude Code. Both agents read this file as their primary context — `AGENTS.md` is a mirror of `CLAUDE.md`. Update one, copy to the other.
- **Single working branch.** All commits go to `main`. Worktree branches under `claude/*` and `codex/*` are scratch space for in-progress work; merge or fast-forward back to `main` when done and don't leave them lingering on origin.
- **Pull → check origin → edit → commit → push.** Before starting any non-trivial change:
  1. `git fetch origin` and inspect `origin/main` vs. local HEAD.
  2. If the user describes a feature that sounds in-scope, search the codebase AND `git log --all` for evidence the other agent already started it. Don't re-implement what's already on a branch — extend or fix it.
  3. After committing, push immediately (`git push origin HEAD:main`) so the other agent sees the change. Do not leave commits sitting unpushed.
- **Commit small.** One feature or fix per commit so the other agent can review or revert without untangling.
- **Don't leave large uncommitted working trees** — the other agent can't see them. If you pause mid-feature, commit a checkpoint with a message that says so.

## Vendoring third-party assets (strict CSP)

Routes outside `/current/` and `/archive/` ship a strict Content-Security-Policy: `default-src 'self'`, `script-src 'self'`, `connect-src` defaults to `'self'`. CDN script tags and runtime fetches to other origins are blocked, including subtle ones like Plotly's topojson load (`cdn.plot.ly/usa_110m.json`).

If a feature needs a JS library or static asset (Plotly, Leaflet, geo data, fonts), download a pinned version into `public/vendor/<name>-<version>.<ext>` and serve from `'self'`. Do NOT widen the CSP. The "one npm dep" rule covers npm only — vendored static assets in `public/vendor/` are fine, but call them out in the commit message and keep them version-pinned. Server-side vendored libraries should be pinned under `vendor/<name>/<version>/` with a small wrapper module.

## US Bank Map page

The `/maps` SPA tab renders a Plotly choropleth + filterable bank list. It is intentionally a thin client over the bank tear sheet data:

- **Data source:** `data/bank-reports/bank-data.sqlite` (the `banks` table). The same `bank-data-importer.js` that powers tear sheets writes the rows.
- **Field source:** `BANK_FIELDS` in `server/bank-data-importer.js` is the single source of truth for labels and types. The map projects a curated whitelist of `BANK_FIELDS` keys (`MAP_FIELD_KEYS`) on the server; the resulting `{ key, label, type, section }` definitions ship with the API response so the client filter UI is fully data-driven.
- **Latest period:** `queryBankMapDataset()` walks each bank's `detail_json.periods[]` via SQL `json_each` and projects values from the entry whose `period` matches `summary_json.period`. Same blob the tear sheet reads.
- **Period filter:** auto-detects the latest reporting year from `MAX(json_extract(summary_json, '$.period'))` and filters to `<year>Q*`. When a 2026Q1 workbook is imported, the filter switches to `2026Q*` automatically; no code change needed.
- **Cache:** `mapBankCache` in `server/server.js` holds the projected dataset. `invalidateMapBankCache()` is called from `handleBankDataUpload` after a successful workbook import.
- **Adding a metric to the map:** add the `BANK_FIELDS` key to `MAP_FIELD_KEYS` in `server/bank-data-importer.js`. Nothing else.
- **Vendored assets:** `public/vendor/plotly-2.27.0.min.js` (~3.5 MB) and `public/vendor/usa_110m.json` (~49 KB). `Plotly.setPlotConfig({ topojsonURL: '/vendor/' })` keeps geo loads inside `'self'`.

## Things to leave alone unless asked

- The launchers' UX (`start-portal.{bat,command}`). They're tuned for non-developers double-clicking from Finder/Explorer.
- The dependency footprint — npm should stay at `pdf-parse` + `better-sqlite3`; SheetJS stays vendored and pinned. If you need a third npm package, raise it explicitly.
- The README's deployment options (A/B/C). They've been validated against the IT team's posture.
- The data folder layout. Anything that breaks `/api/archive` or the Explorer date-routing breaks the bookmarks people have already saved.
