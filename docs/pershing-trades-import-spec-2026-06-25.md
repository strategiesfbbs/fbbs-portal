# Pershing Trade-History Import Spec (2026-06-25)

Purpose: define the upstream Pershing export needed before the portal can answer
trade-level questions such as date, CUSIP, par/amount, price, buy/sell side,
yield, and purchase preferences by bank.

The current Pershing integration is account-level recency only. It stores one
latest trade date per brokerage account and cannot reconstruct individual trades.

## Required export fields

The first supported CSV/XLSX export should provide one row per trade with these
headers, using stable values where Pershing has them:

| Header | Required | Notes |
| --- | --- | --- |
| `trade_id` | Preferred | Stable Pershing trade identifier. Required for clean idempotency when available. |
| `pershing_account_number` | Yes | Joins to `pershing_accounts.pershing_account_number`. |
| `trade_date` | Yes | Trade date, normalized to `YYYY-MM-DD`. |
| `settlement_date` | Preferred | Normalized to `YYYY-MM-DD`. |
| `side` | Yes | Buy, sell, maturity, call, redemption, cancel/correct where available. |
| `cusip` | Yes | Security identifier. |
| `security_description` | Preferred | Human-readable description. |
| `security_type` | Preferred | Treasury, Agency, Muni, Corporate, CD, MBS/CMO, etc. |
| `issuer` | Preferred | Issuer or obligor. |
| `coupon` | Preferred | Numeric coupon percent where available. |
| `maturity_date` | Preferred | Normalized to `YYYY-MM-DD`. |
| `call_date` | Optional | First/next call date, normalized to `YYYY-MM-DD`. |
| `quantity_or_par` | Yes | Par/face for fixed income; quantity for other rows. |
| `price` | Yes | Executed clean price when available. |
| `yield_to_maturity` | Preferred | Percent yield at execution. |
| `yield_to_worst` | Preferred | Percent yield at execution. |
| `principal` | Preferred | Dollar principal. |
| `accrued_interest` | Preferred | Dollar accrued interest. |
| `commission_or_markup` | Preferred | Dollar commission/markup/markdown if carried. |
| `net_amount` | Preferred | Settlement net amount. |
| `rep_code` | Preferred | Desk/rep code from Pershing if available. |
| `rep_name` | Preferred | Human-readable rep name if available. |
| `trade_status` | Preferred | Open, settled, cancelled, corrected, etc. |
| `cancel_correct_indicator` | Preferred | Needed to suppress or reverse cancelled/corrected rows. |
| `as_of_date` | Yes | Export/run date for snapshot lineage. |

## Storage proposal

Use the existing Pershing database unless file size or retention becomes a
problem:

- Database: `data/bank-reports/pershing-accounts.sqlite`
- Existing table: `pershing_accounts`
- New table: `pershing_trades`

Proposed core columns:

```sql
CREATE TABLE pershing_trades (
  trade_key TEXT PRIMARY KEY,
  trade_id TEXT,
  pershing_account_number TEXT NOT NULL,
  bank_id TEXT,
  trade_date TEXT NOT NULL,
  settlement_date TEXT,
  side TEXT,
  cusip TEXT NOT NULL,
  security_description TEXT,
  security_type TEXT,
  issuer TEXT,
  coupon REAL,
  maturity_date TEXT,
  call_date TEXT,
  quantity_or_par REAL,
  price REAL,
  yield_to_maturity REAL,
  yield_to_worst REAL,
  principal REAL,
  accrued_interest REAL,
  commission_or_markup REAL,
  net_amount REAL,
  rep_code TEXT,
  rep_name TEXT,
  trade_status TEXT,
  cancel_correct_indicator TEXT,
  as_of_date TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  source_file TEXT
);
```

Recommended indexes:

- `idx_pershing_trades_bank_date` on `(bank_id, trade_date DESC)`
- `idx_pershing_trades_account_date` on `(pershing_account_number, trade_date DESC)`
- `idx_pershing_trades_cusip` on `(cusip)`
- `idx_pershing_trades_security_type` on `(security_type)`

## Join logic

1. Normalize `pershing_account_number`.
2. Join to `pershing_accounts.pershing_account_number`.
3. Copy the matched `bank_id` into each trade row at import time.
4. Keep unmatched trade rows with blank `bank_id` and count them in the import
   summary so upstream account mismatches are visible.

If the account-level Pershing export has not been imported yet, the trade import
can still stage rows, but bank-level UI should report that account mapping is
missing.

## Idempotency

Primary key:

- Prefer stable `trade_id` when present.

Fallback deterministic key:

```text
pershing_account_number
+ trade_date
+ cusip
+ side
+ quantity_or_par
+ price
+ net_amount
```

Hash the fallback tuple after normalizing dates, numbers, side text, and CUSIP.
The importer should upsert by `trade_key` so repeated exports are safe.

Cancellation/correction handling:

- Preserve every raw row initially.
- Exclude rows with cancelled status from "active trade" analytics unless there
  is a clear correction pair.
- Add a follow-up rule once the first real export shows the exact Pershing
  cancel/correct values.

## First API

Add a bank-scoped read route:

```text
GET /api/banks/:id/pershing/trades?from=&to=&limit=&side=&securityType=&cusip=
```

Response shape:

```json
{
  "bankId": "B-123",
  "status": {
    "available": true,
    "tradeCount": 42,
    "latestTradeDate": "2026-05-29",
    "unmatchedTradeCount": 3
  },
  "trades": []
}
```

Keep this separate from `GET /api/banks/:id/pershing`, which should remain the
account-footprint/recency endpoint.

## First UI

Add a Sales Workspace panel below Pershing Account Footprint:

- Date
- Side
- CUSIP
- Par/quantity
- Price
- YTW or YTM
- Coupon
- Maturity
- Description

Default to newest 25 active trades with filters for side, security type, and
date range. Include a clear empty state if the account-recency file exists but
the trade-history export has not been imported.

## First analytics

Start with deterministic rollups before adding AI or recommendation prose:

- Purchase/sale mix by side.
- Security-type mix by count and par.
- Maturity buckets: under 1y, 1-3y, 3-5y, 5-10y, 10y+.
- Coupon bands and price bands.
- State/sector preference for munis when source fields are available.
- Most recent CUSIPs and repeat issuers.

Then use those rollups to support "pitch similar current offerings" by matching
current inventory against observed type, maturity, coupon, and yield preferences.

## Tests

Add focused tests before enabling the UI:

- Parser accepts CSV and XLSX with the required headers.
- Re-import is idempotent by `trade_id`.
- Fallback key dedupes repeated rows when `trade_id` is missing.
- Bank join works through `pershing_accounts`.
- Unmatched rows are preserved and counted.
- `/api/banks/:id/pershing/trades` filters by date, side, security type, and
  CUSIP.
