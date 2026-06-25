# FBBS Portal — Salesforce + Pershing Current State (2026-06-25)

A short north-star for the external-CRM data migration. Pairs with the full sweep
audit in [`portal-sweep-audit-2026-06-25.md`](portal-sweep-audit-2026-06-25.md)
and the Salesforce spec in [`salesforce-integration-spec-2026-06-24.md`](salesforce-integration-spec-2026-06-24.md).

## Salesforce — DONE (Claude)

Imported from the 2026-06-24 Salesforce export (`data/salesforce-export/2026-06-24/`, gitignored).

- **Contacts:** 1,736 imported into `bank_contacts`, cert-joined to banks
  (`Contact.AccountId → Account.Cert_Number__c → banks.cert_number → bankId`).
  98% of bank-type contacts auto-linked; RIA/general/junk land in a named
  `unmatched` bucket. Decision-maker classification + three compliance flags
  (`do_not_call` / `opt_out_email` / `email_bounced`) are stored (all false in
  this export). Carried on the tear-sheet Contacts panel.
- **Idempotent re-import:** `bank_contacts.salesforce_contact_id` (guarded
  migration + partial unique index + one-shot backfill from the original
  import's notes). Re-running the importer = 0 create / 0 update / 1,736
  unchanged.
- **Owner:** backfilled to the authoritative `bank_account_statuses.owner`,
  blank-only on the *effective* owner. That field was already 100% populated by
  the prior workbook (3,571 on the "A.W. Spellmeyer" catch-all, left as-is), so
  this was effectively a no-op (1 genuinely-blank bank). Replacing the catch-all
  with contact-derived owners would be a separate, owner-approved decision.
- **Status:** seeded/upgraded `bank_account_statuses.status` from SF
  (Client/Prospect), never overriding a worked status; applied 46
  (45 Open→Prospect, 1 seed).
- **Tooling:** `scripts/import-salesforce-export.js` (dry-run default; `--apply`
  + `--contacts`/`--owners`/`--statuses`). Pure parse/match in
  `server/salesforce-import.js`. Every apply writes a manifest under
  `data/salesforce-export/manifests/` + one `salesforce-import` line to
  `data/audit.log`. Tests: `tests/salesforce-import.test.js`.

## Pershing — IN PROGRESS (Codex)

Account-level Pershing integration is **Codex's vertical**, actively in progress
(uncommitted at the time of writing). Touch only by coordinating with Codex:
`server/pershing-store.js`, `scripts/import-pershing-export.js`, the Pershing
routes in `server/server.js`, the Pershing UI in `public/js/portal.js`/
`public/css/portal.css`, the Pershing signal in `server/bank-signals.js`, and
`tests/pershing-store.test.js`. See those files for the authoritative schema and
route shapes — this doc deliberately does not restate them so it can't drift.

The Pershing export joins a brokerage account to a bank
(`Account__c → Salesforce account → FDIC cert → bank`) and carries a
most-recent-trade date per brokerage account — an account-level **trade recency /
dormancy** signal.

## Explicit gap — no trade-level history yet

The current Pershing data is **account-level recency only** (one most-recent-trade
date per brokerage account). There is **no per-trade history** — no CUSIP / par /
side / price / trade-date rows — so the portal cannot yet measure what a bank
actually bought/sold, rep/desk activity per bank, or sector flow.

**Next required file:** a periodic Pershing **trades export** (one row per trade,
at least: brokerage account id, trade date, settlement date, CUSIP, par/quantity,
buy/sell side, price). With that, a trade-level store + rollups can power real
activity intelligence. The trade-level store, its ingest, and any UI are **Codex's
to design** (the account-level vertical is the prerequisite); this note only
records the gap and the input needed to close it.
