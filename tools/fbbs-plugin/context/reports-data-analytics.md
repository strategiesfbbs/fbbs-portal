# FBBS Reports + Data Analytics context bridge

Use this note when work touches the portal Reports workspace, report data imports, saved reports,
or Data Analytics reports about FBBS bank/portfolio data.

This is a routing and source map, not a Data Analytics semantic layer. Do not copy metric
definitions, SQL grains, joins, caveats, or dashboard logic into this plugin as durable
analytics semantics. If a Data Analytics semantic layer exists for FBBS Reports, read it first.
If none exists and the task is repeatable, create or refresh that semantic layer through the
Data Analytics user-context workflow, using the sources below as seed material.

## Boundary

- FBBS plugin owns project orientation, commands, repo source pointers, and local verification.
- Data Analytics owns semantic-layer registry entries, canonical metric/table definitions,
  report-building workflow, visual/report artifact rules, and source-backed analysis checks.
- Portal runtime owns the live implementation and data. Verify against code and current data
  before making analytical claims.
- Do not add npm dependencies or widen CSP to support reporting context. Keep the portal's
  plain-Node/no-build posture.
- Do not persist private packet details, settlement instructions, account numbers, or private
  approval-packet content into plugin context or semantic layers.

## Start here

Read in this order for Reports/Data Analytics work:

1. `AGENTS.md` or `CLAUDE.md` for repo constraints and current architecture.
2. `docs/data-pipeline.md` for the Reports freshness/data-import flow.
3. `README.md` section "Reports tab" for routes and user-facing report surfaces.
4. `docs/company-portal-context.md` for strategic/product context only.
5. The relevant live implementation files listed below.

## Source map

Portal Reports workspace:

- `public/js/portal.js`
  - `renderReportsWorkspace()`
  - `reportsDataHtml()`
  - `reportsFreshnessHtml()`
  - `runReportBuilder()`
  - report-specific render/export helpers near the Reports section
- `public/css/portal.css` for Reports layout and visual states.
- `public/index.html` for SPA shell containers.

Reports APIs and persistence:

- `server/server.js`
  - Reports persistence routes: `/api/reports`, `/api/reports/hidden`,
    `/api/reports/:id`
  - import routes: `/api/banks/averaged-series/upload`,
    `/api/banks/bond-accounting/upload`
  - status route feeding freshness: `/api/banks/status`
- `server/report-store.js` for saved report definitions and hidden reports.
- `server/averaged-series-store.js` for peer-group workbook parsing and status.
- `server/bond-accounting-store.js` for portfolio workbook matching, manifests, and status.
- `server/bank-data-importer.js`
  - `BANK_FIELDS` is the source of truth for call-report field labels/types.
  - `MAP_FIELD_KEYS` is only a curated map projection, not the full metric universe.
- `server/bank-coverage-store.js`, `server/bank-account-status-store.js`, and
  `server/strategy-store.js` for coverage/status/workflow context used by reports.

Data files:

- `data/bank-reports/bank-data.sqlite` is the derived call-report store.
- `data/bank-reports/current-bank-call-reports.xlsm` is the source workbook.
- `data/bank-reports/averaged-series/peer-series.json` is the parsed peer-series dataset.
- `data/bank-reports/averaged-series/current-averaged-series.xlsm` is the peer source workbook.
- `data/bank-reports/bond-accounting/manifest.json` records matched, p-code-only, and
  unmatched portfolio files.
- `data/bank-reports/bond-accounting/matched/` contains matched portfolio workbook copies.

Tests:

- `tests/report-store.test.js`
- `tests/peer-group-store.test.js`
- `tests/bond-accounting-store.test.js`
- `tests/bank-views.test.js`
- `tests/store-smoke.test.js`
- `tests/server-http.test.js`

## When to invoke Data Analytics

Use Data Analytics when the user asks to:

- produce an analytical report, scorecard, dashboard, recommendation, KPI readout, or chart;
- explain a metric movement or compare bank/portfolio cohorts;
- design repeatable report semantics for peer averages, bank segmentation, portfolio reviews,
  coverage books, billing queues, or Salesforce-replacement reporting;
- create or refresh a semantic layer for FBBS Reports.

For those tasks, run the Data Analytics user-context preflight first, then use the relevant
Data Analytics workflow. The FBBS plugin can point to repo sources, but it should not become
the durable semantic registry.

## Semantic-layer seed checklist

When creating or refreshing an FBBS Reports semantic layer, include pointers to:

- call-report source and derived SQLite store;
- `BANK_FIELDS` labels/types and any whitelist used for a specific surface;
- peer averaged-series workbook shape and parsed JSON shape;
- bond-accounting bank-list and portfolio workbook matching rules;
- saved report definition store and supported report types;
- route/source precedence for Reports freshness, tear sheets, map, and saved views;
- known caveats from `docs/data-pipeline.md`, especially stale peer averages and unmatched
  bond-accounting files.

Keep the semantic layer concise and source-backed. Link back to this bridge and the source
files instead of copying long implementation notes.

## Verification

For code changes, run `npm test`. For Reports UI changes, also start the portal and verify the
specific hash route touched, commonly `#reports`, `#reports/data`, or `#reports/data/files`.
For Data Analytics artifacts, verify source-backed claims against the controlling source files
or live parsed data before handing off.
