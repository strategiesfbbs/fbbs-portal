# Codex Overnight Audit — Backend/Data/Reporting

Date: 2026-06-25  
Scope: Salesforce/Pershing data readiness, Bank Tear Sheet data flow, Signal/My Work/Pulse/report consistency, API/test coverage.

This is the implementation handoff for the next Codex or Claude Code session. It intentionally avoids account numbers and other sensitive details.

## What was cleaned up before the audit

- `a083aaa feat(pershing): surface account trade recency`
  - Adds the account-level Pershing import/store, tear-sheet footprint panel, My Work tile, dormant report, and Signal Inbox support.
- `c4cce33 docs: add portal sweep audit findings`
  - Preserves the broad 8-lane UI/code/report/swap/docs audit at `docs/portal-sweep-audit-2026-06-25.md`.
- `ef897fc fix(security): admin-gate contact import`
  - Adds `/api/contacts/import` to the admin-gated write list and server HTTP coverage.
  - This commit also picked up a current-state doc and bond-swap validation additions that were already staged in the workspace.
- `354a87c fix(swap): enforce maturity guard on send`
  - Wires the new swap maturity-vs-settle validation into the actual send path.
  - Corrects `docs/current-state-2026-06-25.md` now that the Pershing account-recency work is committed.

Targeted verification already run:

- `node tests/pershing-store.test.js` — passed.
- `node tests/bank-signals.test.js` — passed.
- `node tests/salesforce-import.test.js` — passed.
- `node tests/frontend-parse.test.js` — passed.
- `node tests/server-http.test.js` — passed after localhost permission.
- `node tests/swap-math.test.js` — passed.

Run full `npm test` before merging further changes.

## Data facts to build from

The provided Pershing export is account-level only. Columns:

`Account__c`, `CreatedById`, `CreatedDate`, `Id`, `IsDeleted`, `LastModifiedById`, `LastModifiedDate`, `LastReferencedDate`, `LastViewedDate`, `Most_Recent_Trade_Date__c`, `Name`, `Owner_1__c`, `Owner__c`, `SystemModstamp`.

It does **not** contain CUSIP, par/amount, price, buy/sell side, yield, settlement date, security description, or trade history rows.

Latest import/dry-run facts:

- 2,350 Pershing account rows.
- 567 matched rows.
- 485 matched portal banks.
- 1,783 unmatched/no-cert rows.
- 2,190 rows with a most-recent-trade date.
- 160 rows without a trade date.
- Oldest trade date: 2013-01-10.
- Latest trade date: 2026-05-29.
- Dormant matched banks at 365+ days or missing date: 299.
- Dormant matched banks at 180+ days or missing date: 334.

Concrete example from the user request:

- `The Missouri Bank, Warrenton, MO` is matched to Pershing account-level data.
- It has 2 linked Pershing accounts, latest account-level trade date 2026-05-19.
- The current file still cannot answer CUSIP / amount / price for that bank.

## Highest-priority next implementation batch

### 1. Rename Pershing wording to account recency

Why: UI/report text can sound like a trade ledger, but we only have account-level latest trade date.

Suggested changes:

- Rename report label from `Pershing Dormant Trade Report` to `Pershing Account Recency Report`.
- Rename CSV from `pershing_dormant_trades_...csv` to `pershing_account_recency_...csv`.
- Change helper text to say: "Account-level latest trade date only; no CUSIP/par/price history in the current export."
- Consider renaming the tear-sheet panel from `Trade Footprint` to `Pershing Account Footprint` until trade-level data exists.

Files:

- `public/js/portal.js`
- `public/css/portal.css` only if label-width/layout needs adjustment.
- `docs/current-state-2026-06-25.md`

Tests:

- `node tests/frontend-parse.test.js`

### 2. Write the Pershing trade-history import spec

Why: User explicitly wants date, CUSIP, amount, price, and purchase-style analytics. We need the right upstream export before building UI.

Create `docs/pershing-trades-import-spec-2026-06-25.md` with:

- Required CSV/XLSX headers:
  `trade_id`, `pershing_account_number`, `trade_date`, `settlement_date`, `side`, `cusip`, `security_description`, `security_type`, `issuer`, `coupon`, `maturity_date`, `call_date`, `quantity_or_par`, `price`, `yield_to_maturity`, `yield_to_worst`, `principal`, `accrued_interest`, `commission_or_markup`, `net_amount`, `rep_code`, `rep_name`, `trade_status`, `cancel_correct_indicator`, `as_of_date`.
- Proposed table: `pershing_trades` in a separate SQLite file or a second table in `pershing-accounts.sqlite`.
- Join logic: `pershing_account_number` -> `pershing_accounts.pershing_account_number` -> `bank_id`.
- Idempotency key: stable `trade_id`; fallback `account + trade_date + cusip + side + quantity/par + price + net_amount`.
- First UI: `/api/banks/:id/pershing/trades` and a tear-sheet table with date, side, CUSIP, par, price, yield, coupon, maturity, description.
- First analytics: sector/state/security-type/maturity-bucket purchase preferences, then "pitch similar current offerings."

### 3. Surface contact compliance flags everywhere reps act

Why: Salesforce compliance flags are stored but not visible in the tear-sheet action paths.

Suggested changes:

- Add badges for `doNotCall`, `optOutEmail`, and `emailBounced` in tear-sheet contact rows.
- Add warnings/disabled action styling in the activity contact picker.
- Add flags to Contacts directory rows and CSV export.
- Keep badges concise: "Do not call", "No email", "Email bounced".

Files:

- `public/js/portal.js`
- `public/css/portal.css`
- Possibly `tests/frontend-parse.test.js` only by running, not editing.

Tests:

- `node tests/salesforce-import.test.js`
- `node tests/frontend-parse.test.js`

### 4. Replace or retire the legacy Upload-page contact import

Why: `/api/contacts/import` is now admin-gated, but it still uses the older name-matching importer and drops Salesforce IDs/compliance flags. The canonical importer is `scripts/import-salesforce-export.js` plus `server/salesforce-import.js`.

Options:

- Preferred: route the Upload-page flow through the canonical parser/import plan.
- Simpler: remove/disable the Upload-page one-file import button and point admins to the canonical CLI until a full UI wrapper is built.

Files:

- `public/js/portal.js`
- `server/server.js`
- `scripts/import-salesforce-export.js`
- `server/salesforce-import.js`
- `tests/salesforce-import.test.js`
- `tests/server-http.test.js`

### 5. Fix stale tear-sheet state and validate contact IDs

Why: Changing banks can briefly render previous-bank CRM arrays; a stale contact selector could post a cross-bank `contactId`.

Suggested changes:

- Clear `selectedBankContacts`, `selectedBankActivities`, `selectedBankTasks`, `selectedBankOpportunities`, `selectedBankProductFit`, and Pershing state before first render of a newly selected bank.
- Refresh Activity after contacts load so the contact selector cannot lag.
- Server-side: when `recordManualActivity` receives `contactId`, confirm the contact belongs to the same `bankId`; reject or clear it otherwise.

Files:

- `public/js/portal.js`
- `server/bank-coverage-store.js`
- `server/server.js`
- `tests/bank-coverage-crm.test.js`
- `tests/server-http.test.js`

## Consistency fixes after the first batch

### Pershing owner scoping

Problem: My Work and the dormant report use coverage owner plus Pershing owner text; Signal Inbox only gathers Pershing rollups for coverage-owned banks. Secondary Pershing owner is parsed but not included in dormant rollups.

Fix:

- Add one shared helper for Pershing owner text including coverage owner, primary owner, secondary owner, and account owner.
- Feed Signal Inbox a dedicated Pershing-owned bank set instead of only coverage-owned `savedBanks`.
- Ignore free-text `owner` filter when non-admin rep scope is enforced, matching Account Touch behavior.

Files:

- `server/pershing-store.js`
- `server/server.js`
- `server/bank-signals.js`
- `tests/pershing-store.test.js`
- `tests/server-http.test.js`

### Migrated task assignee matching

Problem: consolidation copied display names into `bank_tasks.assigned_to`, but task helpers compare against normalized usernames.

Fix:

- Normalize migrated `assigned_to` to username when possible.
- Preserve the display value in `assigned_display`.
- Make task helper filters tolerate display-name assignees for old rows.

Files:

- `server/bank-coverage-store.js`
- `tests/coverage-consolidation.test.js`
- `tests/bank-coverage-crm.test.js`
- `tests/server-http.test.js`

### Account universe consistency

Problem: Clients/prospects come from account-status views, while cold accounts/account-touch/signals start from saved coverage rows. That can hide banks that exist in account statuses but not coverage.

Fix:

- Add a shared account-universe helper based on `bank_account_statuses`, joined to coverage metadata.
- Use it for cold accounts, account-touch, and cold coverage signals.

Files:

- `server/server.js`
- `server/bank-account-status-store.js`
- `server/bank-coverage-store.js`
- `tests/server-http.test.js`

### Activity Summary wording/scope

Problem: `activity-by-bank` reads as "my logged activity by bank," but currently means activity on my covered banks.

Fix:

- Either rename it in UI to "Activity on covered banks" or add actor-scoped by-bank aggregation.

### Strategy ownership/count consistency

Problem: My Work counts `Needs Billed`; Pulse only counts `Open` and `In Progress`. Strategy request form can leave `requestedBy` blank.

Fix:

- Default `requestedBy` to acting rep server-side.
- Decide whether `Needs Billed` is active work or a separate billing queue count, then align My Work and Pulse labels.

## Unmatched-data review queue

Pershing unmatched rows are retained/countable but not surfaced.

Suggested next step:

- Add `/api/pershing/unmatched` for admins only.
- Return counts by reason: no account link, no cert, cert not in bank data, deleted/invalid.
- Add a CSV download on Upload/Admin status.

This is lower priority than the trade-history spec but valuable for cleanup.

## Suggested next-session prompt

```text
Read docs/codex-overnight-audit-2026-06-25.md and implement the first batch only:
1. Rename Pershing UI/report wording from trade-history language to account-recency language.
2. Add docs/pershing-trades-import-spec-2026-06-25.md with the required trade export schema and planned store/API/UI.
3. Add contact compliance badges/warnings in tear-sheet Contacts, activity contact picker, Contacts directory, and CSV export.
4. Do not touch broad layout/CSS polish beyond what those badges require.
Run targeted tests, then npm test if the changes touch server logic.
```

## Coordination with Claude

Leave broad UI/CSS layout polish, dead CSS pruning, and visual cleanup to Claude's website sweep. Codex should handle data correctness, route behavior, import semantics, and tests.

