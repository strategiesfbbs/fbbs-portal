# Salesforce Decommission — Readiness & Gap Analysis (2026-06-28)

Pairs a read-only Claude-in-Chrome audit of the live SF org with a code-grounded
check of what the portal actually has today. Goal: know exactly what must be
rebuilt/migrated before cancelling Salesforce and running the CRM internally.

**The one-line finding:** the *reps* barely use Salesforce (human logins months
apart; pipeline has 4 records, 2 are tests; 0 of 291 reports subscribed) — but the
*integrations and the 139,352-row Trades blotter are quietly load-bearing.* The
failure mode is cancelling on "looks unused" and losing the machine-fed assets.

Builds on, and does not replace, `docs/salesforce-integration-spec-2026-06-24.md`
(the active Foundation+Contacts+Pershing import). See the Claude/Codex split there.

---

## Org shape (from the audit)

A bond-desk CRM on a bank database. **Accounts = community banks** (31,028 rows;
~45 FDIC/call-report fields + product-fit checkboxes + coverage), with four bespoke
custom objects hanging off them:

| Object | Records | What it is |
|---|---|---|
| **Trades** | **139,352** | Historical bond blotter: CUSIP, issuer, coupon, maturity, yield, buy/sell, owner, Pershing acct |
| **Pershing Accounts** | 2,351 | Clearing-firm account link + last-trade date |
| **Financials** | — | Bank financial detail feeding Account |
| **Zoom Call Logs** | 3,417 | Meeting logs via an Apex scheduled job |

Plus 7 custom Flows (Topsis-built), Pardot/Account Engagement, Einstein Activity
Capture (MS Exchange), Salesforce Maps (0 licenses used), Action Plans (unused).

---

## Reconciliation — audit claim vs. verified portal state vs. action

Verdicts below are from reading the portal code, not assumptions.

| Capability | Portal today (verified) | Gap? | Action before cancel |
|---|---|---|---|
| **Trade blotter (139K line items)** | **Only account-level last-trade *recency*** — `pershing-store.js:38` stores `most_recent_trade_date`, no CUSIP/coupon/yield/side. `bank-signals.js:461` reads recency only. | **YES — biggest gap.** And the Trades object is **not in the current 5-file export.** | (1) Add a **Trades extract** to the SF export. (2) Build a line-item trade store + per-bank trade-history view. **Point of no return — do first.** Codex's Pershing vertical is recency-only today; this extends it. |
| **Product-fit / service flags** | **PARTIAL** — 20 service names **hardcoded** in `portal.js:243`, stored as free-text in `bank-account-status-store.js`, manually sourced. | **YES — not synced from SF.** | The ACCOUNT extract (240 cols) already staged carries the SF checkboxes. Add a **product-fit backfill** that maps SF flags → the portal `services`/`bankers_bank_services` fields (additive to the existing import). |
| **AFS securities / call-report financials** | **HAS IT** — `BANK_FIELDS` (`bank-data-importer.js:39-56`) has full AFS/HTM breakdowns, brokered-deposit ratio, growth ratios. | No | None. SF was a redundant copy of the FedFis workbook data. |
| **Strategies request form** | **HAS IT** — `strategy-store.js:10` supports Bond Swap, Muni BCIS, THO Report, CECL Analysis, Miscellaneous (exact match to the SF Flow). | No | Re-point the intake; no rebuild. |
| **Email + calendar auto-capture** (Einstein Activity Capture / Exchange — drives 16,838 Tasks + 9,050 Events) | **DOES NOT HAVE IT** — `MANUAL_ACTIVITY_KINDS` only (`bank-coverage-store.js:1100`); zero IMAP/Exchange/calendar sync. | **YES — behavioral.** | **Decide deliberately:** build a lightweight email/calendar capture, or consciously accept the loss. Today reps get auto-logging "for free"; manual-only is a real downgrade. |
| **Contacts** (2,110) | **BUILT** — `bank_contacts` + the SF CSV import path (the active spec). | No | One-time migrate (already designed). |
| **Tasks / follow-ups** | **BUILT** — task engine (due dates, buckets, My Work). | No (manual) | Note: SF Task volume is inflated by Activity Capture, not manual logging — don't read 16.8K as adoption. |
| **Opportunities / pipeline** | **BUILT** — opportunities object with stages. | No | SF pipeline = 4 rows (2 tests). Near-zero to migrate; portal replaces a thing reps never used. |
| **Reports / dashboards** | **PARTIAL** — CRM Pulse + Reports v2 + saved views. | Partial | Rebuild only the **~5 load-bearing** ones (FBBS Sales, FBBS Loans, Strategies, "All Trades w/ Pershing," Clients/Prospects). Drop ~286 samples/one-offs. |
| **7 custom Flows** (rollups, Pershing delete-cascade, Strategies intake, Task email alert, Account-Team sync) | Partial — Strategies intake exists; rollups/cascades are SF-side logic. | **YES — silent logic.** | Reverse-engineer each Flow and re-implement the data-sync logic, or it's lost silently on cancel. (Needs a Chrome drill-down — see below.) |
| **Zoom call logs** (3,417) | **DOES NOT HAVE IT.** | Optional | Export the history if it matters; no live integration needed unless Zoom analytics are wanted. |
| **Pardot / Account Engagement** | **DOES NOT HAVE IT.** | Decide | The always-on integration by login volume — but that's the *machine* syncing, not proof reps use the output. Decide if FBBS actually sends nurture/campaign email. |
| **Salesforce Maps** (0 licenses) | US Bank Map covers the need. | No | Paid-for-unused; drop. |
| **Action Plans** (unused) | — | Opportunity | Could template repeat workflows (onboarding, BCIS, CECL) into the Strategies Queue. Nice-to-have, not a blocker. |
| Cases / Quotes / Forecasts / Leads / Approvals | n/a — unused on a bond desk. | No | Drop. |

---

## Must do before cancellation — ranked

1. **Export + model the Trades blotter (139K) and Pershing accounts.** The single
   irreplaceable asset. Requires a **new Trades extract** (not in today's export)
   plus a portal line-item trade store and per-bank trade-history view. Validate
   the export with 18-char IDs as join keys before anything else. **Point of no return.**
2. **Reverse-engineer the 7 Flows** and re-implement their data-sync logic
   (Trade→Account / Financial→Account rollups, Pershing delete-cascade, Task email
   alert). Silent loss risk.
3. **Decide Einstein Activity Capture + Pardot.** Both are genuinely running.
   Email/calendar auto-capture is a capability the portal lacks — rebuild a
   lightweight version or accept the loss, consciously.
4. **Backfill product-fit flags** from the SF ACCOUNT extract into the portal
   services fields (additive to the existing import).
5. **Rebuild the ~5 load-bearing reports/dashboards.**

**Data to preserve (export with Account/Owner relationships intact):** Trades,
Pershing Accounts, Accounts (full custom field set), Contacts, Tasks/Events
history, Financials, Zoom logs, and `ContentVersion` (sweep attachments). Export
the 7 Flow definitions as metadata documentation. Use Data Loader / Weekly Export
keyed on the 18-char IDs (`Account_Id_18__c` already exists).

**Suggested sequence:** export + validate Trades/Pershing/Accounts → port Flow
logic + product-fit backfill + key reports → **30-day parallel run** with Pardot/
Exchange still feeding SF as a safety net → cut over.

---

## Next Chrome drill-downs that unblock the migration spec

Neither the audit author nor the portal code can see these — they need another
read-only SF session:

1. **Trades object field list + export feasibility.** Open Object Manager → Trades:
   capture every field API name + type, the relationship to Account and Pershing,
   and confirm a Data Loader export of all 139,352 rows is possible. This is the
   schema for the new portal trade store — the #1 blocker.
2. **The 7 Flows, documented.** Open each Flow (Setup → Flows) and record its
   trigger, criteria, and actions, so the rollup/cascade/alert logic can be
   re-implemented. Note which are record-triggered vs scheduled.
3. **Pardot reality check.** Is FBBS actually *sending* nurture/campaign email, or
   just syncing? Look at recent email sends / engagement, not just the connector.
