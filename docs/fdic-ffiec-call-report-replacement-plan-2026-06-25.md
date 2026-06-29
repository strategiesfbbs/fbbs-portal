# FDIC/FFIEC Call Report Replacement Plan

Status: first implementation pass, 2026-06-25.

## Objective

Move bank financial refreshes away from the manually uploaded S&P/FedFis/SNL-style workbook and toward public, deterministic FDIC/FFIEC sources. The legacy workbook upload stays available as a fallback until field parity and peer analytics are proven.

This work must stay boring on purpose: no AI layer, no hidden generated mappings, no new npm dependency, no destructive rebuild, and no overwrite of any existing period.

## Primary Sources Checked

- FDIC BankFind Suite API documentation: `https://api.fdic.gov/banks/docs`
- FDIC BankFind financials endpoint: `https://api.fdic.gov/banks/financials`
- FDIC financial field definitions: `https://api.fdic.gov/banks/docs/risview_properties.yaml`
- FDIC OpenAPI definition: `https://api.fdic.gov/banks/docs/swagger.yaml`
- FFIEC CDR bulk download page: `https://cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx`

Relevant source facts:

- BankFind currently exposes public quarterly financial information through `/banks/financials`.
- The OpenAPI definition says `fields` is a comma-delimited uppercase list and normal `limit` max is 10,000; if a request asks for more than 250 variables, max limit falls to 500.
- FDIC's field-definition YAML is the authoritative local registry for RIS field names, titles, descriptions, and source mappings.
- The FFIEC CDR bulk page provides Call Reports for all commercial banks as tab-delimited or XBRL bulk downloads.

## Current Portal Field Inventory

`BANK_FIELDS` in `server/bank-data-importer.js` defines 90 portal fields used by tear sheets, maps, saved views, reports, peer comparisons, and product-fit logic.

Current first-pass FDIC coverage from `server/fdic-bulk-sync.js`:

| Coverage bucket | Count | Notes |
| --- | ---: | --- |
| FDIC BankFind financials mapped now | 43 | Direct RIS fields, simple ratios, or simple sums over public RIS fields. |
| Identity fields carried forward on additive FDIC periods | 18 | Text fields copied from the bank's latest existing portal period so fresh FDIC numeric periods render cleanly. Numeric values are never carried forward. |
| Remaining workbook/FFIEC fields | 29 | Mostly AFS/HTM securities sector detail and ratios that need FFIEC RC-B or later confirmed FDIC mappings. |

## Coverage Matrix

### Replaceable from FDIC BankFind financials now

Mapped in the importer registry:

- Headline balance sheet: total assets, deposits, loans, loans/deposits, loans/assets, total borrowings, pledged securities.
- Securities headline: AFS total fair value, HTM total fair value, total securities/assets, securities fair value/book value, realized securities gain/loss.
- Loan mix: real estate, farmland, agricultural production, C&I, consumer loans as percentages of loans.
- Capital: equity capital, Tier 1 capital, Tier 1 risk-based ratio, total risk-based ratio, leverage ratio, dividends, dividends/net income.
- Profitability: ROA, ROE, yield on earning assets, cost of funds, NIM, efficiency ratio, net income.
- Asset quality: loan loss reserve/loans, NPLs/loans, loan loss reserve, provision, net charge-offs/loans.
- Liquidity and operating fields: brokered deposits/deposits, large deposits amount, non-interest-bearing deposits/deposits, long-term assets/assets, fiduciary assets, employees, offices.

These are safe for the additive FDIC sync because the source field list is explicit and fixture-tested.

### Replaceable from FDIC Institution API later

These are identity/contact fields, not quarterly numeric call-report facts:

- Legal/display name, city, state, FDIC cert, regulator, county, address, ZIP, website, phone where present.

The current FDIC sync carries these forward instead of replacing them because it only calls `/financials`. A no-workbook future should add an institution-identity refresh path from `/institutions` and preserve portal-specific IDs separately.

### Replaceable from FFIEC bulk

Needed for full workbook parity:

- Detailed AFS and HTM sector splits: Treasuries, agencies, munis, pass-through RMBS, other RMBS/CMO, CMBS, all MBS, other debt.
- RC-B maturity buckets and richer securities detail for portfolio-fit signals.
- Ratios whose safest source is schedule-level raw values rather than a precomputed vendor field.
- Any fields that require exact Call Report line-code lineage for audit review.

Build this as the next step only after agreeing on the exact line-code registry. Reuse the proposed shape in `docs/ffiec-bulk-importer-spec-2026-06-23.md`.

### Workbook/vendor-only or derived for now

Keep the fallback workbook for:

- SNL Institution Key and SNL parent identifiers.
- Vendor buckets such as total asset range and ag-loan range.
- Subchapter S flag, unless the desk supplies a separate authoritative internal source.
- FedFis averaged peer-group series until the portal computes peer cohorts internally.
- Any vendor-derived ratios whose public source formula has not been verified.

### Portal-owned CRM fields

Do not mix into the public call-report importer:

- Account status, priority, owner, activities, tasks, opportunities, contacts, saved views, reports, watchlists, strategies, and account-status overlays.

These live in separate SQLite stores and should remain independent of rebuildable public call-report data.

## Import Semantics

Both FDIC and future FFIEC imports must keep the existing safety model:

- Match by FDIC cert.
- Add a period only when the bank does not already have it.
- Never overwrite or patch an existing period.
- Carry forward identity text only when needed for display.
- Never carry forward numeric values.
- Set `values.source` to `fdic` or `ffiec`.
- Update summary period/assets/deposits only when the appended period is genuinely newer.
- Record admin/audit metadata and a readable stamp under `data/market/fdic/` or `data/market/ffiec/`.

## First Safe Build

Implemented now:

- Expanded the FDIC field registry for confidently mapped fields.
- Added `fieldCoverage` reporting to dry runs and real sync responses.
- Added an FDIC sync stamp at `data/market/fdic/fdic-sync-state.json`.
- Updated Upload/Admin language to position FDIC sync as the call-report refresh path and workbook upload as fallback.
- Extended fixture-driven tests with no live network.

## Next Build

Before writing an FFIEC importer:

1. Create an explicit `FFIEC_FIELD_MAP` registry with Call Report schedule and line code per `BANK_FIELDS` key.
2. Start with RC, RI, RC-R, and RC-B only.
3. Use extracted tab-delimited fixtures in tests; keep live FFIEC downloads out of CI.
4. Add `POST /api/admin/ffiec-sync?dryRun=1` before any write route.
5. Keep the workbook upload visible as fallback until a real side-by-side parity report passes for several quarters.
