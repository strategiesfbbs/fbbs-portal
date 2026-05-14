# Reports data pipeline — peer averages + bond accounting

What feeds the freshness banner on `#reports`:

> Peer averages: 2026Q1 · imported May 11, 2:56 PM · 80 metrics · 640 peer rows · **Manage**
> Portfolio files: 82 matched · 10 P-code only · 10 unmatched · **Manage**

Both lines are **live**, not hardcoded. The values flow through
`/api/banks/status` → `bankDataStatus` (browser cache) → `reportsFreshnessHtml()`
([public/js/portal.js:5355](../public/js/portal.js)). The Manage links route to
working import screens — neither is a stub.

## Peer averages line

| Banner field | Source on the server |
|---|---|
| `2026Q1` | `getAveragedSeriesStatus().metadata.latestPeriod` |
| `imported May 11, 2:56 PM` | `.metadata.importedAt` (ISO, formatted client-side via `formatImportedDate`) |
| `80 metrics` | `.dataset.metricCount` |
| `640 peer rows` | `.dataset.seriesRowCount` |

**Source workbook:** FedFis ships `AVERAGED_SERIES_SNL_TEAR_SHEET.vNN.NN.xlsm`
(~150MB). The "AVERAGED_SERIES" sheet has one row per (metric × period × peer
group). Each cohort row also encodes the peer-group definition (asset range,
agricultural-loan range, Sub-S status, region) used to map a bank to the right
peer comparison.

**Import path:**

1. Rep clicks **Manage** on the peer-averages line → `#reports/data` → renders
   `reportsDataHtml(false)` and mounts `#averagedSeriesImportPanel`.
2. Rep picks the workbook in the import card and clicks **Import Peer Averages**
   → POST `/api/banks/averaged-series/upload` (multipart).
3. [server/server.js](../server/server.js) routes to
   `handleAveragedSeriesUpload` → `saveAveragedSeriesWorkbook` (parser).
4. [server/averaged-series-store.js](../server/averaged-series-store.js) parses
   the xlsm, writes the canonical xlsm to
   `data/bank-reports/averaged-series/current-averaged-series.xlsm` and the
   parsed dataset to `peer-series.json` (peer groups × metrics × series).
5. `getAveragedSeriesStatus(BANK_REPORTS_DIR)` reads both files on demand and
   exposes the metadata + counters used by the banner.

**Where it's consumed:**

- Bank tear sheets (`getBankById` injects `peerComparison` per bank).
- Bank map page (`MAP_FIELD_KEYS` projection uses peer-relative deltas).
- Reports `Bank Peer Analysis` template.

## Portfolio files line

| Banner field | Source |
|---|---|
| `82 matched` | `getBondAccountingStatus().matchedCount` |
| `10 P-code only` | `.pCodeMatchedCount` |
| `10 unmatched` | `.unmatchedCount` |

**Source materials:** the bond-accounting workbook bundle from THC Analytics has
two parts:

- A bank-list workbook (`BankList (NN).xlsx`) — one row per bank with the bank's
  internal `P####` code, name, and address.
- A folder of per-bank portfolio workbooks (one xlsm per bank, filenames like
  `13206(Account)_BANK OF GREELEYVILLE_20260430_P1054.xlsm`).

**Import path:**

1. Rep clicks **Manage** on the portfolio-files line → `#reports/data/files`
   → renders the files table; or `#reports/data` for the import panel.
2. Rep uploads the bank-list workbook + selects the portfolio-folder export
   → POST `/api/banks/bond-accounting/upload`.
3. [server/bond-accounting-store.js](../server/bond-accounting-store.js):
   - Joins each portfolio file to a bank by `P####` → FDIC cert → SNL bank id.
   - Copies matched files to `data/bank-reports/bond-accounting/matched/`.
   - Files where the P-code is in the bank list but no SNL match → `pcode-only/`.
   - Files with neither P-code nor SNL match → `unmatched/`.
   - Writes `manifest.json` (the data the banner counters read from).
4. `getBondAccountingStatus()` returns counts + import timestamp.

**Where it's consumed:**

- Bank tear sheets (`getBondAccountingForBank` exposes the per-bank holdings).
- Sales assistant "Find Buyers" + swap candidate detection (the coverage
  holdings index in [server/server.js](../server/server.js#L2460) is built from
  this manifest).
- Bond Swap proposal builder (the sell-side CUSIP picker reads
  `getBondAccountingForBank` → parsed portfolio rows).

## Manage links — verified routes

| Link | Hash | Renders | Server endpoint exercised |
|---|---|---|---|
| Peer averages · Manage | `#reports/data` | Averaged-Series Import + Bond Accounting Import panels | `/api/banks/averaged-series/upload`, `/api/banks/bond-accounting/upload` |
| Portfolio files · Manage | `#reports/data/files` | Matched Portfolio Files table (92 of 92 today, with P-code-only and unmatched filters) | (read-only — `getBondAccountingStatus` + filter) |

Both verified working against the live preview on 2026-05-13.

## What's missing

- **No re-import indicator on the banner.** If the FedFis workbook is older
  than the latest call-report period (e.g. peer averages dated 2026Q1 but
  fresh tear sheets are 2026Q2), the rep wouldn't know to refresh. Worth a
  small "stale" amber pill driven by comparing `.latestPeriod` to
  `getBankDatabaseStatus().latestPeriod`.
- **Peer averages workbook size.** The ~150MB xlsm is large; upload UX
  could show a progress bar. Today it shows a static "Importing…" status.
- **Bond accounting unmatched files have no review screen.** The `unmatched/`
  folder is on disk but no UI surfaces the list with a way to manually map
  the P-code → bank id. Reps would need to fix the source workbook instead.
