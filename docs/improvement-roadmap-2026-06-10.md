# Portal Improvement Roadmap — Full Review 2026-06-10

Output of a full-portal review (server, frontend, data folders, CRM gap analysis vs Salesforce,
and external-API research) oriented around the product goal: **one daily workspace that combines
a Salesforce-class CRM + a Bloomberg/TMC-ICE-class offer portal + an S&P-Global-class bank-data
terminal** for FBBS fixed-income sales covering community banks.

Verified against the live code 2026-06-10 (several candidate findings were checked and dropped:
the offer→buyers drawer already exists and is wired into all six explorers; current-package slot
JSON is already memoized via `currentSlotCache`; `getCurrentPackage`/`getArchiveList` are cached).

---

## A. External data & API push (the headline opportunity)

Today every byte enters the portal by manual file upload. The portal has **zero outbound HTTP
calls**. Node's built-in `fetch` means most of the below need **no new npm deps**.

### A1. US Treasury + FRED rates module — FREE, ~1 day  ⭐ do first
- Treasury Daily Par Yield Curve: no-auth XML/CSV from home.treasury.gov; fiscaldata.treasury.gov
  has clean no-key JSON REST. FRED (St. Louis Fed — local!) gives full daily history of
  `DGS1MO…DGS30`, SOFR, Fed Funds with a free API key.
- Powers: always-on baseline curve in Treasury Explorer, date-stamped curve in swap proposals,
  WIRP context, exec-summary/econ market overlay fallback. Removes a whole class of
  "the PDF didn't parse / upload was missed" blindness.
- Shape: one ~50-line `server/rates-fetcher.js` with on-disk cache under `data/market/`,
  fetched on demand + daily; zero licensing risk.

### A2. FDIC BankFind API + FFIEC CDR bulk — FREE, ~1 week  ⭐ kills the 153 MB workbook ritual
- FDIC `/financials` (api.fdic.gov): 1,100+ Call Report variables per bank per quarter — assets,
  deposits, capital ratios, ROA/ROE/NIM, loan mix, securities composition incl. HTM/AFS and
  unrealized G/L. Keyed by **FDIC cert — already our join key**. JSON/CSV, no key required.
- FFIEC CDR bulk download: the complete Call Report (full RC-B securities schedules with
  maturity/pledged detail — better swap-engine context than FedFis summaries) as one quarterly
  tab-delimited ZIP. Free account for the web service; **NOTE: the PWS is REST-only — legacy SOAP
  retired 2026-02-28**, don't copy old SOAP wrappers.
- Shape: `server/fdic-fetcher.js` + a quarterly FFIEC ZIP importer reusing the existing
  `withDatabase()` bulk path into `bank-data.sqlite`. The FedFis AVERAGED_SERIES peer analytics
  are the only piece not replaced (keep that upload, or recompute peers in-portal).

### A3. Microsoft Graph shared-mailbox ingestion — $0 incremental, 2–3 days + IT consent
- The already-brainstormed "trader emails the files → portal publishes" lane, implemented with
  plain Node `fetch` instead of Power Automate. Shared mailbox needs no license (≤50 GB);
  app-to-app read uses an Entra app registration with `Mail.Read` *application* permission +
  client-credentials OAuth. **Hardening:** scope with an Exchange Application Access Policy
  (`New-ApplicationAccessPolicy`) or the app can read every mailbox in the tenant.
- Reuses the existing folder-drop `classifyFile()` pipeline. Also the path to intraday
  remaining-qty updates from trader emails.
- Blocker is organizational (tenant-admin consent), not technical — **start the IT ask now**.

### A4. Bloomberg TOMS own-inventory feed — contract conversation, start now
- **The desk's own inventory (CUSIP, our price/qty, descriptions) is the firm's data, not
  Bloomberg's.** TOMS supports sanctioned EOD/intraday position & inventory exports and
  "APIs for Your Positions and Transactions" for TOMS customers. This is the only integration
  that fixes the daily offering-sheet uploads *at the source* — could replace all six desk
  sheet uploads.
- The ask for the Bloomberg rep, verbatim: *"automated delivery of our own TOMS
  inventory/offerings to our internal server — file drop or API."* Normal dealer request
  (it's how dealer retail bond pages get populated). Lead time = contract cycles, so open it
  in parallel with everything else.
- **Hard wall to respect:** Desktop API / Excel BDP-BDH data is contractually locked to the
  entitled user's "Designated Authorized Computer." Auto-publishing terminal-derived *market
  data* (BVAL, DES fields, etc.) to the LAN portal violates the license. SAPI is the sanctioned
  server path but is negotiated mid-4-to-5-figures and still entitlement-checked; B-PIPE is
  six figures — not for us.

### A5. Cheap market-context tier (opportunistic)
- **FINRA developer platform** (developer.finra.org): free firm onboarding via our Super Account
  Administrator; TRACE corporate/agency aggregate stats free → "market tone" tiles on #pulse /
  exec summary, TRACE prints context next to corporate offerings. OAuth2 client-credentials.
- **MSRB EMMA:** no public API; RTRS feed ≈ $11k/yr — defer. **Day-one freebie: link every muni
  CUSIP in the muni explorer out to its EMMA page** (one-line change, zero license risk).
- **Moment (moment.com):** REST CUSIP enrichment (reference + evaluated pricing incl. CDs and
  munis) priced for fintech budgets — the paid upgrade for CUSIP-first lookups when free tier
  is exhausted. **ICE Bonds (ex-TMC):** FIX/Data API as a participant — real but heavy; revisit
  after TOMS conversation resolves.

---

## B. CRM completion (what's left to credibly turn off Salesforce)

Gap analysis verdict: activity logging, coverage statuses, saved views, activity reports and
#pulse are solid. Four gaps block a credible cutover; the rest is polish.

### B1. Task engine — the biggest gap (M)
- Today: one `next_action_date` per bank + past-tense `task` activities. No future-dated tasks,
  no per-task status, no multiple open tasks per bank, no assignee.
- Build: `bank_tasks` table (title, body, due_date, assigned_to, status Open/Done/Snoozed,
  priority, created_by) in `bank-coverage.sqlite`; CRUD routes; "My Tasks / due today / overdue"
  in My Work and #pulse; create-task from tear sheet and from an activity ("log call → set
  follow-up task" in one motion).

### B2. Opportunities / pipeline (M)
- Strategies Queue is request *fulfillment*, not a sales funnel. No deal value, stage, or
  close date anywhere; the context doc explicitly lists "Product opportunity" as a target entity.
- Build: `bank_opportunities` (product, description, est_value, stage
  Prospect→Qualified→Proposed→Won/Lost, close_date, owner); pipeline section on #pulse
  (pipeline $ by stage / by rep / by product); link opportunities ↔ strategy requests and
  swap proposals (a sent swap proposal IS a pipeline event).

### B3. Compliance-grade activity trail (S–M)
- Activities are hard-deletable today (`DELETE /api/banks/:id/activity/:activityId`) — auditors
  at a regulated BD will object. Move to soft-delete (`deleted_at`, reason, actor), filter
  deleted by default, audit-log the deletion, add "export audit trail for date range".

### B4. Contacts upgrade + Salesforce migration path (M)
- `bank_contacts` exists (name/role/phone/email/is_primary/notes + CRUD) but: no owner rep, no
  firm-wide contacts directory page, no bulk import, no dedup.
- Build: firm-wide Contacts page (search across banks), CSV bulk importer that accepts
  **Salesforce export files** (accounts, contacts, activity history) so the SF history comes
  with us at cutover. This is the migration enabler.

### B5. Polish tier
- Unified per-bank timeline (activities + notes + status changes + strategies + uploads in one
  chronological stream — the data exists, the merged view doesn't).
- Note editing (edit history) + firm-wide activity/note search.
- Rep master table (`rep-roster.js` is the seed) instead of freeform owner strings;
  territory/state defaults for new prospects.

---

## C. Offer-portal UX (toward Bloomberg/ICE)

### C1. CUSIP-first global search (S–M)  ⭐ quick win, big rep value
- Today a rep must guess the asset class, open that explorer, then search. Add a global search
  (top strip) that checks all current-package slot JSONs + MBS/CMO inventory + bank holdings for
  a CUSIP and deep-links to the right explorer with the filter pre-filled. The `data-cusip`
  deep-link plumbing already exists from Daily Intelligence picks.

### C2. Unified cross-asset explorer framework (M–L)
- Six explorers (treasury/CD/muni/agencies/corporates/MBS-CMO) are 6× copies of the same
  load→filter→sort→render flow (~3K duplicated lines, `portal.js` ~15750–18400). Extract a
  config-driven explorer factory into `public/js/modules/` — new asset classes become config,
  and a true cross-asset "show me anything >5%, <3yr" view becomes possible.

### C3. Watchlists (M)
- Star an offering or bank from any grid → persistent per-rep watchlist page (tiny sqlite
  table). No alerts/email needed in v1 — just "my list, refreshed with today's package."

### C4. Explorer → proposal bridge (S–M)
- Checkbox rows in any explorer → "seed swap-proposal buy leg(s)" (the blotter on the suggested
  page already does this for sells; extend the pattern to the buy side from explorers).

### C5. Small wins
- Data-freshness bar per explorer ("Offerings as of <uploadedAt>") from `_meta.json`.
- Bank `website` field rendered as a clickable link on the tear sheet (it's plain text today).
- Muni CUSIP → EMMA outbound links (see A5).
- Peer-cohort picker on the tear sheet itself (today you must round-trip via #banks).
- Tear-sheet attachments panel (per-bank docs under `data/bank-reports/<bankId>/attachments/`).

---

## D. Code health (so the above stays buildable)

1. **Router extraction (M).** `server/server.js` is ~9,760 lines with a flat ~130-route
   dispatcher (~line 8680+). Extract a declarative route table (`server/routes.js`) — no
   framework needed — and group handlers by feature. Do this *before* the API push adds more
   routes.
2. **Error-handler wrapper (S).** ~187 hand-rolled `try/catch → sendJSON` blocks; one
   `withErrorHandler()` wrapper normalizes them.
3. **Frontend state + modularization (M, ongoing).** ~856 functions and ~130 top-level globals
   in `portal.js`; only ~3 modules extracted. Priorities: explorer factory (C2) and a bank
   tear-sheet state container (~50 globals).
4. **Schema discipline (S).** Formalize the ad-hoc ALTER-TABLE migrations with a
   `schema_version` row; add index on `bank_activities(bank_id, at DESC)`; unique index on
   contacts `(bank_id, email)`.
5. **Silent catches (S).** Several `catch (_) {}` swallow errors (server.js ~460, 483, 720,
   1220, 1254) — add `log('debug', …)`.
6. **Parser unit tests (S each).** ~20 server modules have no dedicated tests (covered only by
   the end-to-end regression suite) — prioritize cd-offers, brokered-cd, muni-offers,
   bank-data-importer, bank-coverage-store.
7. Known/deferred: streaming multipart (300 MB RAM ceiling) — becomes less urgent once A2
   removes the giant workbook upload.

## E. Hygiene

- Move `docs/go-live/` (18 stale launch-era files incl. a 66 KB final review) to
  `docs/archive/go-live/`; keep `company-portal-context.md`, `data-pipeline.md` live.
- `git gc` (one garbage blob in `.git/objects`).
- Add a retention policy for `data/dropbox/` staging folders (85 MB, 13 dated folders).

---

## Suggested sequencing

**Wave 1 — free + fast (this week):**
A1 Treasury/FRED module · C1 CUSIP global search · C5 small wins (EMMA links, website link,
freshness bars) · B3 activity soft-delete · D4/D5 schema + logging touch-ups · E hygiene.

**Wave 2 — the data push (1–2 weeks):**
A2 FDIC/FFIEC importer · B1 task engine · B2 opportunities/pipeline · A3 Graph mailbox build
(once IT consent lands).

**Wave 3 — structural (2–3 weeks):**
C2 unified explorer factory · D1 router extraction · B4 contacts directory + Salesforce
importer · C3 watchlists.

**Parallel business track (start today, zero code):**
Bloomberg rep → TOMS own-inventory feed (A4) · IT → Entra app consent for the shared mailbox
(A3) · FINRA SAA → developer-platform onboarding (A5) · revisit ICE/Moment/MSRB after.
