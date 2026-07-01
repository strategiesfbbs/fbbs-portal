# FFIEC CDR Bulk Importer Spec

Status: initial importer implemented 2026-07-01. It is still admin-triggered and additive; FedFis remains the authoritative rebuild path until the FFIEC field map is proven over real quarterly downloads.

## Goal

Add a quarterly FFIEC Call Report bulk-ZIP importer that can refresh bank financial periods without the 153 MB FedFis workbook ritual. This should complement, not immediately replace, the current FedFis import path.

The importer must be additive:

- Never overwrite an existing FedFis period.
- Add a newer FFIEC period when the FDIC cert matches an existing bank.
- Preserve the current `bank-data.sqlite` shape so tear sheets, maps, saved views, and reports keep working.

## Source

Use the FFIEC CDR Public Web Service REST path only. Do not copy legacy SOAP examples; FFIEC retired the old SOAP PWS on 2026-02-28.

Expected flow:

1. Download the quarterly Call Report bulk ZIP.
2. Extract tab-delimited schedules with Node built-ins plus platform `unzip` if needed, matching the project's no-new-dependency posture.
3. Parse only the schedules required for the first release.
4. Map by FDIC cert.
5. Append period rows into `bank-data.sqlite` through the existing `withDatabase()` bulk-write path.

## First-Release Schedules

Start with headline fields already used by the portal:

- Identity: FDIC cert, legal name, city, state, ZIP, primary regulator if available.
- Balance sheet: total assets, total deposits, loans, securities.
- Earnings: ROA, ROE, net interest margin where available.
- Capital: tier/risk-based capital ratios where available.
- Securities composition: AFS/HTM totals and unrealized gain/loss where available.
- RC-B maturity buckets where reliably present.

The exact line-code mapping should live in a small registry, not be scattered through parsing code:

```js
const FFIEC_FIELD_MAP = {
  totalAssets: { schedule: 'RC', code: 'RCON2170' },
  totalDeposits: { schedule: 'RC', code: 'RCON2200' }
};
```

Only map fields that have a corresponding `BANK_FIELDS` key or a deliberately added new key.

## SQLite Write Path

Reuse `server/sqlite-db.js`:

- Use `withDatabase(dbPath, fn)` for one connection over the whole import.
- Set the same bulk-write PRAGMAs used by `bank-data-importer.js`.
- Prepare INSERT statements once.
- Wrap each import in a transaction.

Do not use the `sqlite3` CLI and do not add a new SQLite library.

## Additive Period Semantics

For each cert-matched bank:

1. Load existing bank identity and periods from `bank-data.sqlite`.
2. If the FFIEC period already exists, skip it.
3. If the FFIEC period is newer, append it with `values.source = 'ffiec'`.
4. Carry forward identity text only when the FFIEC source omits it.
5. Never carry forward numeric fields.
6. Update summary period/assets/deposits only when the appended period is genuinely newer.

This mirrors the existing `fdic-bulk-sync.js` safety model: stopgap public data fills newer periods, while the next authoritative FedFis workbook import can still rebuild the database.

## Server API

Admin-only routes:

- `POST /api/admin/ffiec-sync?dryRun=1`
- `POST /api/admin/ffiec-sync`

Dry run returns:

- source quarter
- matched cert count
- skipped existing-period count
- unmatched cert count
- field coverage summary
- warnings

Real run writes:

- import audit event
- `data/market/ffiec/ffiec-sync-state.json`
- optional source metadata under `data/market/ffiec/`

No automatic schedule in v1. Keep it admin-triggered until the mapping is trusted.

## Tests

Add fixture-driven tests with no network:

- Small ZIP fixture or extracted TSV fixture covering two banks and two schedules.
- Cert match appends a new period.
- Existing period is not overwritten.
- Unmatched cert is counted and skipped.
- Numeric blanks stay null and do not carry forward.
- Summary period updates only for genuinely newer periods.
- Dry run produces counts without writing.
- Import uses `values.source = 'ffiec'`.

Suggested file: `tests/ffiec-bulk-importer.test.js`.

## Operational Notes

Keep FedFis peer-group averaged series separate for now. The FFIEC importer can replace headline bank periods, but it does not automatically replace FedFis peer analytics unless the portal later computes peers internally.

This is a good Wave-2 build after the desk confirms whether the goal is "newer stopgap quarters" or "full FedFis replacement."

Live/source configuration for the initial build:

- `FFIEC_BULK_DIR` or `FFIEC_BULK_FILE`: local downloaded tab-delimited or ZIP files.
- `FFIEC_CALL_REPORT_FILE` + `FFIEC_UBPR_FILE`: explicit local files for the two single-period products.
- `FFIEC_CALL_REPORT_URL` + `FFIEC_UBPR_URL`: explicit downloadable URLs when the FFIEC PWS/account flow is configured.

The public FFIEC bulk page exposes the right products, but its period/download controls are ASP.NET postback driven. The importer deliberately avoids brittle viewstate scraping; configure the files/URLs above or extend the source loader once the PWS REST account instructions are available.
