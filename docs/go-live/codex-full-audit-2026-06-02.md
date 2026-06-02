# Codex Full Audit + Sales Smoke — 2026-06-02

Scope: Claude's latest pre-launch review commits through `4eb9bbf`, Codex fixes in this pass, automated tests, and a browser smoke test as an internal sales user.

## Fixes Completed In This Pass

| Area | Result |
|---|---|
| SRV-1 same-day corrupt replacement | Added full upload preflight before current-package mutation. A corrupt same-day replacement now returns `400` before old slot files are touched. |
| SRV-2 publish rollback | Wrapped daily publish with a current-package snapshot/restore guard. If a write/parsing path throws after mutation starts, the prior current package is restored and cache invalidated. |
| SEC-2 IIS identity spoofing | In `FBBS_AUTH_MODE=iis`, rep identity now trusts only iisnode-managed Windows-auth headers, not client-spoofable `auth-user` / `x-forwarded-user`. |
| OPS-3 SQLite backup process | Engineering checklist + runbook now require a quiesced App Pool copy or SQLite online backup and a tested restore. |
| OPS-4 fatal process state | `uncaughtException` and `unhandledRejection` now log and exit so IIS/iisnode can respawn a clean worker. |
| FE-1 admin UI fail-closed | If `/api/me` fails, Upload/Admin hide instead of falling back to local-open UI. |
| SRV-3b SQLite lock tolerance | Every better-sqlite3 connection gets `busy_timeout = 5000`. |
| FE-2 restrictions chip | CD restriction text is escaped consistently. |
| FE-4 browser error backstop | Global frontend error/promise-rejection logging added with FBBS prefixes. |
| OPS-6 health readiness | `/api/health` now returns liveness plus data-folder writability, bank-data availability, and current-package readability checks. |
| TEST-1 HTTP guard coverage | Added `tests/server-http.test.js` covering IIS admin-ingest 403s and same-day corrupt replacement preservation. |

## Automated Verification

- `node --check server/server.js`
- `node --check public/js/portal.js`
- `node --check server/sqlite-db.js`
- `node --check tests/server-http.test.js`
- `npm test` passed, including the new HTTP suite:
  - parser regression
  - swap math/store/render
  - report/strategy/muni/peer/store/sqlite/bank-view/bond-accounting/log-rotation/MBS-CD-history/WIRP tests
  - rep identity: 16 passed
  - server HTTP: 3 passed

Expected test-suite noise remains: `pdf-parse` emits `Warning: TT: undefined function: 21` during PDF fixture parsing.

## Browser Smoke Test

Local server: `PORT=3001 npm start` against the real local `data/` folder.

Pages walked:
- Home
- Daily Intelligence
- Treasury Explorer
- CD Explorer
- Muni Explorer
- Agency Explorer
- Corporate Explorer
- Bank Tear Sheets
- US Bank Map
- Saved Views
- Strategies Queue
- Reports Workspace
- Package QA
- Admin / Internal Launch Readiness

Observed:
- No browser console errors or warnings during the walkthrough.
- Home showed 10 of 11 package files ready and populated market/account tiles.
- Daily Intelligence loaded the June 2 package with 7 rule picks and counts for Treasuries, CDs, Munis, Agencies, and Corporates.
- Explorers loaded real inventory counts: 316 Treasuries, 208 CDs, 28 Munis, 379 Agencies, 196 Corporates.
- CD Explorer filter interaction worked: min rate `4.25` reduced the grid to 3 CDs.
- Bank search found Alliance Bank results; opening a result loaded the tear sheet with account status, contacts, peer comparison, balance-sheet rows, strategy request, peer report, portfolio review, print, and CSV export affordances.
- Map loaded state/status filters and a Plotly map surface.
- Saved Views loaded Salesforce-style report tiles and Just me / Everyone scope controls.
- Reports Workspace loaded planned reports, peer averages, and portfolio-file metadata.
- Package QA showed 10/10 required slots with two existing publish/parser warnings.
- Admin readiness showed real local blockers: local auth mode, missing `FBBS_ADMIN_USERS`, app-local `DATA_DIR`, and existing package warnings.

## Current Launch Blockers

Code-side blockers from Claude's red list are now addressed or documented with a launch process.

Remaining no-go items are environment/process decisions:
- Fill [decision-sheet.md](decision-sheet.md), especially `FBBS_ADMIN_USERS`.
- Apply IIS env vars on the production box: `FBBS_AUTH_MODE=iis`, `FBBS_ADMIN_USERS`, `DATA_DIR=D:\FBBSPortalData`.
- Confirm `/api/me` shows `source: "iis"` and Admin readiness is green except accepted package warnings.
- Run the launch-day script on the IIS box.
- Perform and record a safe backup restore test.
- Confirm target package-ready time, publisher/backup, and sales notification channel.

## Salesforce Gaps / What We Are Leaving Behind

These are the main differences from a full Salesforce operating layer.

### Not Yet In The Portal
- True permission model by role, territory, manager hierarchy, or record owner.
- Field-level security and audit policy controls comparable to Salesforce profiles/permission sets.
- Formal task objects with assigned owner, due date, reminders, recurrence, comments, and completion history independent of strategies/coverage rows.
- Email/calendar sync, logged calls, meetings, Outlook/Gmail activity capture, and automatic timeline entries.
- Opportunity/pipeline objects with stages, close dates, expected revenue, probability, forecast rollups, and manager forecast views.
- Campaigns, call lists, marketing touches, mail merges, and engagement history.
- Salesforce-style dashboards with configurable charts, subscriptions, scheduled delivery, and drill-down report folders.
- Chatter/mentions/team collaboration feeds.
- Approval workflows, compliance signoff, e-signature, client-facing distribution tracking, and immutable compliance retention.
- Duplicate management, merge tools, data-quality rules, and required-field validation by workflow stage.
- Attachment/document library per bank beyond current strategy deliverables and portfolio/report files.
- Mobile app/offline mode and push notifications.
- API/integration layer for downstream systems, data warehouse sync, or bulk CRM migration.
- Full contact relationship model: multiple contacts, roles, influence, activity-per-contact history, bounced emails, assistant info, and household/company relationship mapping.
- Territory/coverage planning with quotas, call-frequency expectations, and manager coaching scorecards.
- Entitlement-style client portal controls for external users.

### Present But Lighter Than Salesforce
- Notes and activity: useful internally, but not a complete activity management system.
- Contacts: basic bank contacts exist, but not Salesforce-level relationship intelligence.
- Saved Views/Reports: strong for bank data, but not a full ad hoc report builder across every object.
- My Work: helpful rep surface, but not a full task/reminder engine.
- Strategies Queue: replaces a key Salesforce workflow, but is narrower than generic CRM opportunities/cases/tasks.
- Billing Queue: operationally valuable, but not integrated to accounting/invoicing.
- Manager oversight: visible through views/reports, but enforcement is still policy-first.

### Worth Considering After Internal Launch
- Lightweight task/reminder layer tied to banks, contacts, strategies, and reps.
- Manager dashboard for stale prospects, overdue follow-ups, Needs Billed, and rep activity.
- Owner/manager route gates once FBBS decides policy in the decision sheet.
- Contact activity timeline and email/log-call capture.
- Opportunity-style pipeline for revenue-bearing ideas separate from strategies.
- Report subscriptions and scheduled CSV/PDF snapshots.
- Data-quality queue for unmatched account-status rows, duplicate banks, and stale owner assignments.
- "Next best action" prompts that combine Daily Intelligence, bank profile, holdings, and current coverage status.
- Bank-specific sales playbooks: brokered CDs, swaps, muni BCIS, CECL, liquidity, securities-to-assets gaps.
- A formal client-facing roadmap with MFA, per-client authorization, compliance approval, watermarking, and download audit.
