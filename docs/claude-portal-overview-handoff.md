# Claude Handoff: FBBS Portal Overview

This handoff explains what the FBBS Market Intelligence Portal is, what it currently does, and how it should relate to the standalone daily dashboard redesign.

## Portal Purpose

The portal is an internal Node.js web app for First Bankers' Banc Securities, Inc. It publishes the daily market document package, parses key trader/economic files into structured data, and gives the team searchable explorer pages, market snapshots, bank tear sheets, coverage workflows, and strategy queues.

The portal is intended for institutional/internal use on a trusted LAN or behind IIS with Windows Authentication. It is not a public client portal and does not currently include app-level authentication.

## Current Product Role

The portal is becoming the daily workspace for:

- Uploading today's market package.
- Viewing the current daily documents.
- Browsing prior archived packages.
- Searching structured offerings.
- Reviewing a home-page Market Snapshot.
- Exploring bank records and tear sheets.
- Managing coverage/status notes.
- Managing strategy requests and billing states.
- Replacing lightweight Salesforce reporting/workflow surfaces over time.

For the dashboard redesign, treat the portal as the source of truth for raw uploaded data and repeatable interactive views.

## Daily Package Uploads

The portal currently supports ten daily package slots:

| Slot | File type | Role |
|---|---|---|
| Dashboard | HTML | Standalone daily dashboard |
| Economic Update | PDF | Parsed into structured market/economic data |
| Relative Value | PDF | Viewed in portal; future relative-value extraction target |
| Treasury Notes | Excel | Parsed into Treasury Notes Explorer |
| Brokered CD Sheet | PDF | Parsed for brokered CD all-in terms/ranges |
| Daily CD Offerings | PDF or Excel | Parsed into CD Offerings Explorer |
| Muni Offerings | PDF | Parsed into Muni Offerings Explorer |
| Agencies Bullets | Excel | Parsed into Agencies Explorer |
| Agencies Callables | Excel | Parsed into Agencies Explorer |
| Corporates | Excel | Parsed into Corporates Explorer |

Same-day re-publishes replace only the uploaded slots. Different-day uploads roll the prior package into `data/archive/YYYY-MM-DD/`.

## Portal Explorers

Current explorer-style pages include:

- CD Offerings Explorer.
- Muni Offerings Explorer.
- Agencies Explorer.
- Corporates Explorer.
- Treasury Notes Explorer.
- Weekly CD Recap / CD history.
- Bank Tear Sheets.
- US Bank Map.
- Strategies Queue.

These pages are where raw tables, filters, sorting, search, and CSV exports should live.

## Home Page / Market Snapshot

The home page has been moving toward a "Market Snapshot" model. The intended role is to summarize the day's parsed uploads into an aesthetic but useful view of where the market is that day.

The Market Snapshot should eventually pull from all uploaded data sources:

- Economic Update.
- Relative Value.
- Treasury Notes.
- Brokered CD Sheet.
- CD Offerings.
- Muni Offerings.
- Agencies.
- Corporates.

The home page should surface the overall picture. The dashboard should turn that picture into sales strategy.

## Data Flow

High-level flow:

1. User uploads daily files through the portal.
2. Server classifies files by upload slot and/or filename.
3. Files are saved into `data/current/`.
4. Parsers extract structured JSON where supported.
5. Parsed JSON is written as private `_*.json` files.
6. The SPA reads APIs that expose structured data.
7. Explorer pages, Market Snapshot, and source viewers update from the current package.
8. Older packages are archived under `data/archive/YYYY-MM-DD/`.

Private `_` metadata files are never served directly over `/current/` or `/archive/`.

## Main Code Areas

| Area | Path |
|---|---|
| Server/router/upload handling | `server/server.js` |
| SPA shell/templates | `public/index.html` |
| SPA behavior | `public/js/portal.js` |
| Styling | `public/css/portal.css` |
| Parser tests | `tests/parser-regression.test.js` |
| Daily current package | `data/current/` |
| Daily archive | `data/archive/YYYY-MM-DD/` |
| Company/product context | `docs/company-portal-context.md` |

Parser modules live in `server/*-parser.js`.

## Architecture Constraints

Important constraints:

- Plain Node.js.
- No build step.
- Only two npm dependencies: `pdf-parse` and `xlsx`.
- Filesystem-as-database for the daily package.
- SQLite is used for bank tear sheets, coverage, account statuses, and strategy queues.
- No app-level auth.
- Keep strict CSP; vendor static assets locally if needed.
- Do not serve `_`-prefixed private metadata files.
- Keep deployment simple: `npm install && npm start`.

Avoid adding new npm dependencies unless there is a strong reason and the user approves the deployment tradeoff.

## Bank / Coverage Workspace

The portal also includes a growing bank coverage workspace:

- Bank tear sheets from imported call-report data.
- Account status import and matching by FDIC cert.
- Coverage notes/statuses.
- Recently viewed/recent records surfaces.
- Strategy Queue for Bond Swap, Muni BCIS, CECL Analysis, and miscellaneous requests.
- US Bank Map powered by the local bank database.

This matters because future sales strategy can eventually tie market opportunities to specific bank profiles, statuses, geography, holdings, or product fit.

## Relationship To Legacy Dashboard

The old dashboard examples duplicate many portal responsibilities:

- Full product tables.
- Large hardcoded charts.
- Broad market data summaries.
- Inventory counts.
- CUSIP tables by product.

Going forward:

- The portal should own uploaded source data, structured tables, search, filters, archives, downloads, and exports.
- The dashboard should own daily interpretation, CUSIP-specific sales ideas, customer-type reasoning, risks, and call language.

The dashboard should link back to portal pages rather than embed full raw tables.

## Recommended Near-Term Portal Additions

To support the dashboard redesign cleanly, add:

- Structured Notes Explorer.
- Brokered CD/Funding Explorer.
- More complete Relative Value page.
- Muni tax-equivalent controls.
- Saved/preset explorer filters by customer type.
- Strategy JSON/API generated from parsed uploads.

Possible future strategy record shape:

```json
{
  "audience": "S-Corp Bank",
  "product": "Agency Callable",
  "cusip": "example",
  "rank": 1,
  "reason": "Why this fits today",
  "risk": "Main objection or suitability concern",
  "talkingPoint": "Suggested sales language",
  "sourceSlot": "agenciesCallables",
  "sourceFile": "uploaded workbook name",
  "portalTarget": "/#agencies?filter=..."
}
```

## Claude Starting Point

When beginning the dashboard/portal split:

1. Read this file.
2. Read `docs/claude-dashboard-strategy-handoff.md`.
3. Read `docs/company-portal-context.md`.
4. Inspect current upload/explorer behavior in `server/server.js`, `public/index.html`, and `public/js/portal.js`.
5. Prefer moving raw data views into portal explorer pages before simplifying dashboard output.

## Product Principle

The portal is the searchable market and coverage operating system.

The dashboard is the daily sales strategy memo generated from that operating system.
