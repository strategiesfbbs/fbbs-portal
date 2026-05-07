# FBBS Market Intelligence Portal — Working Notes

Internal Node.js web app for First Bankers' Banc Securities, Inc. — publishes the daily document package and surfaces it via Explorer pages and Bank Tear Sheets. Built to run the same way on a laptop, a dedicated workstation, or behind IIS with iisnode.

For Institutional Use Only.

## Company / product context

Read `docs/company-portal-context.md` when brainstorming portal direction, Salesforce replacement, bank coverage workflows, strategy/task queues, billing queues, maps, or product-fit ideas. Keep that context strategic and non-sensitive; do not copy settlement instructions, account numbers, or private approval-packet details into the repo.

## Constraints to weigh against any change

- **Two npm deps only** (`pdf-parse`, `xlsx`). This is a deliberate choice — every new dependency makes deployment harder for a non-developer to babysit. Justify additions; prefer Node built-ins or shelling out to tools that exist on every box (e.g. `sqlite3`, `unzip`).
- **No built-in auth.** Trusted-LAN model. Production answer is IIS Windows Authentication. Don't add app-level auth without checking — the deployment story changes.
- **Plain Node, no build step.** No Webpack/Babel/TypeScript. The portal must start with `npm install && npm start` on a fresh machine. The launchers (`start-portal.bat`, `start-portal.command`) assume this.
- **Filesystem-as-database for the daily package.** No DB for the document package; archive/restore is `mv`-ing folders. Bank tear sheets are the one exception (SQLite).
- **Files prefixed with `_` are private metadata** — never serve them over `/current/` or `/archive/`. Both file-serving routes enforce this.

## Daily package — 10 slots

`dashboard` (HTML), `econ` (PDF), `relativeValue` (PDF), `treasuryNotes` (xlsx), `cd` (PDF), `cdoffers` (PDF or Excel workbook), `munioffers` (PDF), `agenciesBullets` (xlsx), `agenciesCallables` (xlsx), `corporates` (xlsx).

Filename auto-classification lives in `classifyFile()` in `server/server.js`. Same-day re-publishes only replace the slots being re-uploaded (this was the v1.3.3 fix); different-day uploads roll the whole package into `data/archive/YYYY-MM-DD/`.

## Architecture map

- `server/server.js` (~1666 lines) — request router, multipart parser, upload handler, security headers, audit log, graceful shutdown. One process, no framework.
- `server/{cd-offers,brokered-cd,muni-offers,economic-update,agencies,corporates}-parser.js` — PDF/xlsx → structured JSON parsers. Each one is independent and unit-testable.
- `server/cd-history.js` + `cd-history-importer.js` — Weekly CD Recap (542+ daily snapshots in `data/cd-history/`).
- `server/bank-data-importer.js` + `bank-coverage-store.js` + `bank-account-status-store.js` — Bank Tear Sheets and account status workspace. All three shell out to the `sqlite3` CLI with string-interpolated SQL via `sqlString()` / `sqlNumber()` helpers. Escaping is correct as written but fragile — every new query site must go through those helpers. **Targeted for `better-sqlite3` migration.** `bank-account-status-store.js` ingests the "Account + FDIC Cert" workbook, joins each row to a bank summary by FDIC cert (latest period wins ties), and surfaces the status (`Open`, `Prospect`, `Client`, `Watchlist`, `Dormant`) on every search result and the tear sheet.
- `server/strategy-store.js` — SQLite-backed Strategies Queue for Bond Swap, Muni BCIS, CECL Analysis, and Miscellaneous requests. Workflow statuses are `Open`, `In Progress`, `Completed`, and `Needs Billed`; completed/billed requests can be archived without deleting their bank history. Requests can be created from a bank tear sheet and worked from the Strategies tab.
- `server/pdf-text.js` — wraps `pdf-parse@1.1.1` with a custom page renderer that inserts spaces between adjacent text items and groups items within a small Y tolerance into one row. Every PDF call in `server/server.js` (CD offers, brokered CD, muni, economic update) goes through `extractPdfText()`.
- `public/index.html` (1443 lines) — single-page app shell with all page templates inlined.
- `public/js/portal.js` (4400 lines) — SPA. Heavy `innerHTML` usage; XSS protection comes from the `escapeHtml`-style helpers it uses to wrap untrusted strings before interpolation. The dashboard slot's iframe is sandboxed (`allow-scripts` only) so user-uploaded HTML can't reach back into the parent.
- `public/css/portal.css` — single stylesheet, ~4000 lines.
- `web.config` — IIS deployment via iisnode. Hides `data/`, `server/`, `node_modules/`, `iisnode/` segments. Cap is 100 MB at the IIS layer; app enforces tighter `MAX_UPLOAD_MB`.
- `tests/parser-regression.test.js` — single-file regression suite, run via plain `node`. No test framework.
- `scripts/import-weekly-cd-worksheet.js`, `scripts/import-bank-workbook.js` — one-off CLI importers.

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
│   └── bank-strategies.sqlite          (Strategies Queue requests)
└── audit.log             ← append-only JSON-lines, one record per publish
```

`DATA_DIR` env var redirects everything outside the app folder — recommended for IIS so upgrades don't risk the archive.

## Config (env vars; all optional)

`PORT` (3000), `HOST` (`0.0.0.0`), `DATA_DIR`, `MAX_UPLOAD_MB` (50), `BANK_UPLOAD_MAX_MB` (300), `LOG_LEVEL` (`info`).

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

## Known issues / open work

- **Bank module's SQL pipe.** `bank-data-importer.js`, `bank-coverage-store.js`, and `bank-account-status-store.js` currently spawn `sqlite3` per query. Slow, requires sqlite3 on PATH, easy to slip an unescaped value past `sqlString()`. `better-sqlite3` is the planned swap. The same pattern bites in `effectiveAccountStatus()` — it spawns one `sqlite3` per search result via `getBankCoverage()`. Should be batched the way `getBankAccountStatuses()` already is before search latency becomes user-visible.
- **Audit log read-whole-file every request.** Fine at 24 KB; needs rotation or tail-streaming before it grows.
- **`getCurrentPackage()` / `getArchiveList()` re-read every API hit.** Should be cached and invalidated from `handleUpload`'s success path.
- **Multipart parser buffers entire body in RAM.** OK for 50 MB; the 300 MB bank-workbook ceiling is heavier — switch to streaming if/when memory pressure shows.

## Conventions

- Logging: `log('info' | 'warn' | 'error' | 'debug', ...)`. Goes to stdout/stderr; iisnode captures it on Windows.
- Audit log entries: `{ event, ...payload, at: <ISO> }`, one JSON object per line in `data/audit.log`.
- Archive folder names are strictly `YYYY-MM-DD`; readers regex-validate before trusting.
- Internal JSON files mirror the slot names: `_offerings.json`, `_muni_offerings.json`, `_agencies.json`, `_corporates.json`, `_economic_update.json`, plus `_meta.json` for package-level metadata.
- All explorer CSV exports include the package date in the filename.
- New parsers should return `{ asOfDate, warnings, offerings, ... }` — the publisher injects `extractedAt`/`uploadedAt` and source filenames before writing.

## Branch / workflow

- Single trunk: `main`. Both Codex and Claude Code commit here. Keep commits small and self-contained so the other agent can `git log` and pick up where you left off.
- Tests: `npm test` (runs `tests/parser-regression.test.js`).
- Start: `npm start` or `node server/server.js`, or double-click the platform launcher.

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

If a feature needs a JS library or static asset (Plotly, Leaflet, geo data, fonts), download a pinned version into `public/vendor/<name>-<version>.<ext>` and serve from `'self'`. Do NOT widen the CSP. The "two npm deps" rule covers npm only — vendored static assets in `public/vendor/` are fine, but call them out in the commit message and keep them version-pinned.

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
- The "two deps only" footprint — `pdf-parse` + `xlsx`. If you need a third, raise it explicitly.
- The README's deployment options (A/B/C). They've been validated against the IT team's posture.
- The data folder layout. Anything that breaks `/api/archive` or the Explorer date-routing breaks the bookmarks people have already saved.
