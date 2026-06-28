# Salesforce Trade Blotter → Portal Trade Store (Spec, 2026-06-28)

**Status:** spec for Codex. The trade vertical is Codex's per the
2026-06-24 ownership split (`docs/salesforce-integration-spec-2026-06-24.md`).
This extends the existing `server/pershing-store.js` (account-level recency) with
the line-item blotter. Claude wrote this spec; **Codex owns the build.**

**Why:** the SF `Trade__c` object (139,352 rows) is the single irreplaceable
asset on decommission (`docs/salesforce-decommission-gap-2026-06-28.md`). The
portal currently holds only account-level last-trade *recency*
(`pershing_accounts.most_recent_trade_date`), not the trades themselves.

---

## 1. Source

A **new** SF export, additive to the current 5-file set:
`…TRADE EXTRACT.csv` (~139,352 rows). The existing
`…PERSHING EXTRACT.csv` (2,351) stays — trades join through it.

**Export mechanics (from the SF drill-down — non-obvious):**
- **Use the Bulk API / Data Loader, not a report.** The "All Trades with Pershing
  Accounts" report is broken ("report definition is obsolete") and the 139K-row
  list view won't render.
- **Export the real keys, not the formula fields.** `Account_Id__c` and
  `Trade_Id_18__c` are formulas — export the record's own 18-char `Id` and
  `Pershing_Account__c` and re-derive the rest.
- **Export Pershing Accounts + Trades together.** Master-detail means a deleted
  Pershing Account hard-deletes its trades (Flow #4) — snapshot both at once.
- Trades are historical/bulk-loaded (sampled record was a 2013 muni loaded
  11/2024), so this is a one-time backfill + periodic top-up, not a live feed.

---

## 2. Schema — `trades` table (new, in `pershing-accounts.sqlite`)

Co-locate with `pershing_accounts` so the join is one DB. Field mapping from
`Trade__c`:

| Portal column | SF field | Type | Notes |
|---|---|---|---|
| `salesforce_trade_id` | record `Id` (18-char) | TEXT PRIMARY KEY | Idempotency key — mirrors `bank_contacts.salesforce_contact_id` |
| `salesforce_pershing_id` | `Pershing_Account__c` | TEXT NOT NULL | FK → `pershing_accounts.salesforce_pershing_id` |
| `trade_name` | `Name` | TEXT | Auto-number (e.g. T-0348573) |
| `cusip` | `CUSIP__c` | TEXT | Text(9) |
| `issuer` | `Issuer__c` | TEXT | |
| `description` | `Description__c` | TEXT | |
| `buy_sell` | `Buy_Sell__c` | TEXT | picklist |
| `callable` | `Callable__c` | TEXT | picklist |
| `typecode` | `TYPECODE__c` | TEXT | sector/type code |
| `coupon` | `Coupon__c` | REAL | percent |
| `yield` | `Yield__c` | REAL | percent |
| `price` | `Price__c` | REAL | |
| `qty` | `Qty__c` | INTEGER | par |
| `activity_date` | `Activity_Date__c` | TEXT | ISO date |
| `trade_date` | `Trade_Date__c` | TEXT | ISO date — the recency driver |
| `settlement_date` | `Settlement_Date__c` | TEXT | |
| `maturity` | `Maturity__c` | TEXT | |
| `owner_1_id` / `owner_1_name` | `Owner_1__c` | TEXT | Lookup(User) → rep resolver |
| `owner_2_id` / `owner_2_name` | `Owner__c` | TEXT | second owner |
| `bank_id` | (derived) | TEXT | denormalized via the join below, for fast per-bank queries |
| `imported_at` / `source_file` | — | TEXT | provenance |

Indexes: `(salesforce_pershing_id)`, `(bank_id)`, `(cusip)`, `(trade_date)`,
`(bank_id, trade_date)`.

**Idempotency:** upsert on `salesforce_trade_id` (re-import = unchanged), exactly
the pattern the contact import already uses.

---

## 3. The join spine (there is no direct Trade→Account link)

```
trades.salesforce_pershing_id
  → pershing_accounts.salesforce_pershing_id
  → pershing_accounts.bank_id   (already resolved cert→bankId at Pershing import)
  → banks.id
```

`bank_id` on `pershing_accounts` is already populated by the existing import, so a
trade resolves to a bank in one hop. Denormalize `bank_id` onto each trade row at
import time (re-derive on Pershing re-import if a match changes) so the tear-sheet
query is a single indexed lookup, not a 3-way join over 139K rows.

Owner names resolve through the same `buildRepResolver` (15-char OwnerId prefix)
the contact/account import already uses.

---

## 4. Consumers

1. **Per-bank trade history** on the tear sheet (Sales Workspace, near the existing
   FDIC/portfolio data): a paged, sortable blotter — date, buy/sell, CUSIP, issuer,
   coupon, maturity, yield, price, qty, owner — filterable by side/date/sector.
   This is the view the portal does **not** have today.
2. **Recency rollup (replaces Flow #1).** Derive each bank's last-trade date from
   `MAX(trade_date)` over its trades, superseding the imported
   `pershing_accounts.most_recent_trade_date` when trades are present. The existing
   `bank-signals.js` `securities-pershing-dormant` signal then reads real
   line-item recency instead of the account stamp.
3. **Dormant/active-client reporting** (Codex's planned report) gains true
   trade-level granularity — last buy vs last sell, sector mix, owner activity.

---

## 5. Flow re-implementation (most are already handled — see decommission gap doc)

- **#1 Trade→Account** → §4.2 rollup. Trivial.
- **#2 Financial→Account** → **superseded.** Portal sources the same FDIC
  call-report fields from the FedFis workbook (`bank-data-importer.js`), not SF
  Financial records. No rebuild.
- **#4 Pershing cascade-delete** → model as FK; export Pershing+Trades together.
- **#5/#6 Account Team→coverage** → portal coverage is single-owner today; SF
  carries a multi-rep Account Team. **Open question** (§6) — small scope.
- **#7 Task email alert** → folds into the broader email-capture decision (the
  portal has no outbound email). Not part of this store.
- **#3 Strategies screen** → already the Strategies Queue.

---

## 6. Open question — multi-rep coverage (small)

SF Flows #5/#6 maintain a multi-rep **Account Team** roster on each bank; the
portal models a **single owner** (`bank_coverage.owner` /
`bank_account_statuses.owner`). If the desk needs multiple reps credited per bank
(primary + affiliate rep, as the SF "Affiliate Rep / Account Team" fields suggest),
that's a separate small CRM change — not part of the trade store. Confirm with the
owner whether single-owner is sufficient; the SF data has the team rosters if needed.

---

## 7. Pardot — decided

Per the drill-down: Account Engagement is a **dormant sync connector**, not a
sending engine (admin = Topsis, ~130 list-emails ever, all data objects access-
locked, only the integration user active). **Safe to drop** — no client email
stream to migrate. Confirm with whoever nominally owns marketing before fully
cutting, since the connector is technically live.
