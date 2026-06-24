# FBBS Portal — Feature Backlog & Subagent Coverage
## Generated 2026-06-24 from a 30-agent coverage+ideation workflow (12 product lenses, adversarially filtered against shipped code)

> Every idea below was de-duped against what's already built and checked against the repo's hard constraints (2 npm deps, no build step, vanilla-JS SPA, LAN/IIS no-app-auth, Bloomberg/S&P licensing wall, no email/cron infra). Items already shipped were dropped. **status:** new · partial-extension · planned-in-docs · needs-owner-decision. **loopSafe:** safe for an unattended agent loop to build without an owner present.

---

## Subagent coverage verdict

The 9-agent roster cleanly covers every CODE layer of the portal — parsers, stores, router, AI, market data, SPA, CSS — plus verification and security review, with deployment/launchers/data-layout correctly marked leave-alone (intentionally-excluded, not gaps). The build-the-software surface is well-mapped and 1:1. What's missing is the meta/loop layer the user's 'step away and get continuous updates' goal actually depends on: there is no planner to choose and sequence the next safe task (today that job is a hand-written queue that the loop drains and then halts), no doc/spec-writer for the brainstorming and 'spec-instead-of-code for gated items' workflow the user wants, and no single owner for the CLI data-import ops. Add loop-planner (keystone), docs-spec-writer, and data-import-ops. Coding coverage: excellent. Autonomous-loop coverage: not yet self-sustaining.

**Loop readiness:** PARTIAL — the implementer agents can absolutely make continuous progress when handed well-scoped tasks (the overnight-queue run proved it: A1-A5 tests + D1/E2 specs landed green on a branch with no human intervention). But the loop is not self-sustaining: it relied on a human-authored TASK QUEUE with the 'already-done?' gate and HANDS-OFF list baked in, and its own FINAL SUMMARY shows it ENDS when that queue empties. The one missing piece is a loop-planner agent that regenerates the next safe task from the roadmap/ideas/spec docs + open work (dedup via grep + git log --all, honor HANDS-OFF, safest-additive-first). Add that and the existing roster, driven by /loop, can autonomously work across the whole site indefinitely; the docs-spec-writer and data-import-ops agents then widen what the loop can safely progress on (gated/brainstorm items and data ingestion) without risking the frozen deployment/data invariants.

### Recommended agents (CREATED 2026-06-24)
- **loop-planner** — Survey state and pick/sequence the next safe task for the unattended loop. Reads the roadmap/ideas/spec docs + open queue, greps the codebase and git log --all to dedup against shipped work, honors the HANDS-OFF list (Published-Dashboard slot, market-color-store dead code, launchers/web.config/data-layout/npm deps), then emits ONE next task with the right owner-agent, a safe-and-additive risk ordering (tests -> specs -> CSS -> careful cleanup), and a done-definition. Appends to / regenerates the work queue.
- **docs-spec-writer** — Author spec/design/brainstorm docs under docs/ (implementation specs for big/owner-gated items, roadmap updates, strategic product brainstorming grounded in company-portal-context.md) WITHOUT touching engine code. Produces the exact-math / where-it-slots-in / test-plan spec format the queue's D1/E2 used.
- **data-import-ops** — Own the CLI importers (scripts/import-bank-workbook|bond-accounting-folder|weekly-cd-worksheet.js) and portal-doctor.js: run an import against real source files, then sanity-check the derived artifacts (bank-data.sqlite row/period counts, bond-accounting manifest.json matched/unmatched, cd-history snapshots) and report. Read-only on the data/ layout itself.

### Coverage by area

| Area | Covered by | Status |
|---|---|---|
| Backend parsers | parser-dev | covered |
| SQLite stores | sqlite-store-dev | covered |
| Server/router | server-router-dev | covered |
| AI grounding layer | ai-grounding-dev | covered |
| Outbound market data | market-data-integrator | covered |
| SPA frontend | spa-frontend-dev | covered |
| CSS | css-stylist | covered |
| Verification | portal-verifier | covered |
| Security review | portal-security-reviewer | covered |
| CLI importers & ops scripts | portal-verifier, sqlite-store-dev, server-router-dev | partial |
| Docs / specs / brainstorming | — | gap |
| Planning / backlog triage / next-item selection | — | gap |
| Build/test tooling & plugin | portal-verifier | partial |
| Deployment / IIS / web.config / launchers | server-router-dev, portal-security-reviewer | intentionally-excluded |
| Data layout | server-router-dev | intentionally-excluded |

---

## Where the opportunity is (synthesis)

The richest, highest-confidence opportunity is the morning-workflow layer: the portal has already built every input helper (tasks, cold accounts, CD rollovers, offering-fits, the free live RV dashboard) but never synthesizes them into a single rep-facing "what do I do today" surface, nor pushes any of it actively. A Morning Call Sheet plus an on-load digest/nudge layer are pure synthesis over existing endpoints, loop-safe, and high impact — this is where idea-flow should concentrate. The second-richest vein is client-facing deliverables: reps retype already-computed numbers into Excel/email constantly, and the portal already has a proven server-side print-render pattern (swap-render, portfolio-review-render) plus copy-to-clipboard plumbing, so a Copy-pitch button and a generic Offering Sheet renderer are unusually high reuse-to-value. A third strong theme is making the trove of archived data answer trend questions — the RV engine only ever diffs today vs one prior day, yet 12+ quarters of bank financials, 559 CD snapshots, and 21 spread/curve archives sit unmined; archive-fed trend engines are mostly pure, node-testable, and loop-safe. Honest read on quality: the AI-layer ideas (light up the Sales Assistant, swap cover email, per-pick objection/counter) are well-scoped and grounded but each adds billable cost and must be admin-gated, so they're real but not free wins. The intraday inventory-state cluster (axe board, desk recap, sold history) is genuinely valuable but is a chain gated on one owner decision about a brand-new trader-write surface with compliance-retention implications — build none of it unattended. Compliance/supervision ideas (review gate, retention export, 2210 linter) are important but every one needs the firm's compliance owner to define the artifact before code; they are the clearest "needs owner decision" bucket. The weakest filler (coverage-book facelift, share-link convenience) was dropped or demoted. Net: there is plenty of high-signal, loop-safe work — roughly two-thirds of the kept backlog is safe for an unattended loop, which is exactly what the owner wants.

## Priority buckets
**Quick wins (S/M effort, med/high impact):** `WF-4` Package-publish 'what changed' banner _(S/high)_, `WF-5` Pre-call brief card on the tear sheet _(S/med)_, `CLI-1` Copy-to-clipboard 'pitch block' on dashboard picks and offering rows _(S/high)_, `INV-4` Desk inventory-shape self-view (concentration by sector/state/maturity) _(S/med)_, `SWP-5` Sent-proposal market-drift banner (did the buy leg re-price before execution?) _(S/med)_, `MKT-4` Muni/UST ratio heatmap by grade x tenor (from the MMD slot) _(S/med)_, `MKT-7` New-supply concentration tracker — issuer/state/sector saturation over time _(S/med)_, `AI-3` Per-pick objection + grounded counter on Sales Dashboard talking points _(S/med)_, `AI-8` AI-output provenance/disclosure stamp on generated narratives _(S/med)_, `RPT-4` Saved-view / report governance — mine vs shared, owner/admin rename+delete _(S/med)_, `REL-3` Shared freshness chip with a real STALE state on every explorer + dashboard _(S/med)_, `REL-5` Crash-safe rollback snapshots — TTL sweep + orphan detection for _publish_rollback_* dirs _(S/med)_, `UX-2` Turn dead empty-states into actionable cards + Home 'Getting started' checklist _(M/high)_, `BI-6` AOCI/HTM unrealized-loss & tangible-capital read via the keyless FDIC API _(S/med)_

**Strategic bets (bigger, worth it):** `BI-7` FFIEC CDR bulk importer — keep call-report periods fresh between FedFis workbooks _(L/high)_, `SWP-4` Cross-bank swap radar — which covered banks hold the same underearning bond/vintage _(L/high)_, `AI-7` Grounded 'Ask the package' retrieval-grounded Q&A box _(L/high)_, `CLI-2` Branded server-side Offering Sheet render (per CUSIP/basket, internal-use) _(M/high)_, `MKT-1` Spread History Lab — multi-day RV time series from the archive _(M/high)_, `REL-1` Parser yield-watch — cross-day row-count + field-coverage regression alarm _(M/high)_, `REL-6` Graceful-degradation contract test — assert every consumer survives a missing/garbage slot _(M/high)_, `WF-1` Morning Call Sheet — printable per-rep daily route _(M/high)_, `BI-3` Whole-book opportunity screener — rank ALL covered banks by funding/portfolio pressure _(M/high)_, `RPT-2` Offerings-fit report — bulk cross-join today's inventory against the whole book _(M/high)_

**Needs owner decision (paid/infra/compliance/new-write-surface):** `BI-7` FFIEC CDR bulk importer — keep call-report periods fresh between FedFis workbooks _(L/high)_, `AI-7` Grounded 'Ask the package' retrieval-grounded Q&A box _(L/high)_, `INV-1` Intraday inventory state layer (firm / reduced / sold / axed) _(M/high)_, `INV-2` Desk axe board — the trader's intraday push surface _(M/high)_, `INV-5` Sold/filled history -> daily desk recap of what moved _(M/med)_, `CMP-1` Supervisory review gate on client-facing swap proposals (FINRA 3110) _(M/high)_, `CMP-2` Communications/CRM retention export (SEC 17a-4 / FINRA 4511) _(M/high)_, `CMP-3` Per-bank supervisory review marker + supervision-coverage report _(M/high)_, `CMP-4` FINRA 2210 language linter for rep-authored supervised text (coaching) _(M/med)_, `REL-4` Self-checking SQLite backup + integrity tick for the irreplaceable stores _(M/high)_

**Loop-ready (safe for unattended build): 55 of 66 items.**

---

## Backlog by theme

### Rep morning workflow & active surfacing
_Synthesize the already-computed rep signals (tasks, cold accounts, rolling CDs, fits, live RV) into a single ranked call sheet plus in-portal nudges/digests/badges — no email/cron, pure reuse._

#### `WF-1` Morning Call Sheet — printable per-rep daily route  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** A rep's morning is scattered across Home tiles, Pulse, per-bank Today's Fits, the Sales Dashboard and the Rollover Wall. There is no single ranked 'who to call today and why' artifact. Every input already exists but the rep stitches it by hand each morning.
- **Sketch:** Free GET /api/me/call-sheet, rep-scoped via the acting-rep cookie, fans out over existing helpers: overdue/due-today tasks (listOverdueOpenTasks/listUpcomingOpenTasks), cold owned accounts (myColdAccounts in /api/me/work), this rep's banks with CDs rolling <=30d (/api/banks/:id/cd-rollover slice), best Today's Fit per top bank (findOfferingFitsForBank limit 1), stale opps. Server ranks; new #call-sheet page renders reason-chip cards with one suggested action, data-goto/data-cusip deep links, @media print. No new tables — same pattern as sdDeskRead.
- **Surface:** New #call-sheet page (index.html + portal.js) + GET /api/me/call-sheet reusing me/work + cd-rollover + offering-fits helpers.

#### `WF-2` On-load morning digest drawer — rep-scoped 'since you were last here'  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** A rep opening the portal hops across Home, Pulse, Sales Dashboard, and the walls to assemble their day. The shipped sdDeskRead brief is market-only — not rep-scoped, not actionable. There is no first-load 'what's new for me' surface, and scheduled/emailed delivery was deliberately dropped.
- **Sketch:** Dismissible drawer that auto-opens once per package-date per rep (last-seen package date in localStorage). One /api/me/digest fans out (each in its own try/catch, buildGlobalSearch pattern) to overdue/due-today tasks, cold accounts, the deterministic regime/top-standout/biggest-mover from the FREE /api/sales-dashboard read, triggered watchlist alerts, and this rep's CDs rolling <=30d. Each line a data-goto/data-cusip deep link. No Claude, no billing, no cron.
- **Surface:** New digest drawer in index.html/portal.js (mounts after loadCurrent) + /api/me/digest composing me/work helpers + the live sales-dashboard read + cd-rollover slice.

#### `WF-3` Sidebar live-count badges for time-sensitive queues  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** The sidebar is the sole nav but static — a rep can't see overdue tasks, strategies needing billed, or banks rolling this week without opening each page. The counts are all computed server-side already, and there is no nav-count or notification mechanism today.
- **Sketch:** Optional badgeKey per NAV_ITEM driven by one /api/me/nav-counts route bundling existing counts: overdue tasks -> My Work/Home; 'Needs Billed' strategies -> Strategies Queue; covered banks rolling <=14d -> CD Rollover Wall/Maturity Calendar. Refresh on the existing setupLivePolling visibility-gated loop; reuse .qa-badge CSS; rep-scoped with the standard scope-collapse.
- **Surface:** Sidebar render in portal.js (NAV_ITEMS + nav-link template) + GET /api/me/nav-counts calling existing strategy-store / cd-rollover / task helpers.

#### `WF-4` Package-publish 'what changed' banner  ·  S/high  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** setupLivePolling already detects re-publish but the toast just says 'package updated' — it doesn't say WHAT changed. The RV engine already computes cross-day movers and regimeShift on every load; that intelligence sits buried on the Sales Dashboard instead of being the publish event itself.
- **Sketch:** On the setupLivePolling publish-detected branch, alongside the toast, fetch the FREE /api/sales-dashboard read and render a richer dismissible banner: the asset-class regimeShift line, counts of new-today vs rolled-off, and the single biggest cheapened mover — each deep-linked. Folder-drop auto-publish and FDIC-sync could share it so the desk SEES automation fire. Reuses computeMovers/regimeShift/sdRegime output; just changes what's rendered on the publish edge.
- **Surface:** setupLivePolling (portal.js fingerprint-change branch) + a new banner element in index.html, reusing the free /api/sales-dashboard read. No backend change for the core.

#### `WF-5` Pre-call brief card on the tear sheet  ·  S/med  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** Before a call a rep wants the gist without scrolling: last conversation, soonest task, largest opp, what they hold, FDIC freshness, and the single best thing to pitch. The signal strip shows chips but not the synthesized 'last conversation + holdings + lead-with' read, so call prep is slow and inconsistent.
- **Sketch:** Collapsible 'Pre-call brief' on the tear-sheet header (both tabs) beyond buildBankSignalChips: most recent manual activity text (soft-delete filtered), soonest Open task + due date, largest open opp, top 1-2 holdings sectors (getBondAccountingForBank), the #1 Today's Fit as 'lead with', the FDIC-live flag, plus a 'Copy brief' clipboard button. Mostly a portal.js render fn over fields the page already loads.
- **Surface:** Tear-sheet header, both tabs (portal.js, alongside buildBankSignalChips); reuses /api/banks/:id payload + offering-fits. No new server route required.

#### `WF-6` Coverage cadence 'My Book' panel (+ admin rollup)  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** A rep covering 40-80 banks sees one at a time. The green/amber/red last-touch column exists only inside saved-view tables; there is no 'my whole book bucketed by recency band' picture, and no admin view of which reps are letting clients go cold.
- **Sketch:** Rep-scoped 'My Book' card: owned banks bucketed by last-touch recency (<=30/<=60/<=90/>90/never), grouped by account status, from lastActivityByBank + bank_coverage owner + account-status (already batched). Clicking a band lists banks deep-linked to tear sheets. Admin (?rep=all, gated by shouldEnforceRepScope like Pulse) sees per-rep % touched in 30d + cold-client count. CSS bars, no chart lib.
- **Surface:** New 'My Book' card on CRM Pulse or My Work reusing buildCrmDashboard data path + lastActivityByBank + account-status; admin rollup behind the existing rep-scope gate.
- **Constraint:** Admin rollup must reuse the existing shouldEnforceRepScope gate; no new auth surface.


### Client-facing deliverables (server-side render + copy)
_Turn already-grounded numbers into branded printables and copy-to-clipboard pitch blocks via the existing swap-render pattern, so reps stop retyping yields/CUSIPs into Excel and email._

#### `CLI-1` Copy-to-clipboard 'pitch block' on dashboard picks and offering rows  ·  S/high  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** Reps live in email. The Sales Dashboard already computes a per-pick benchmark line, watch caveat, best-buyer line and talkingPoint, but there is no zero-friction way to get that text into an email — they retype it, risking transcription errors on yields/CUSIPs.
- **Sketch:** Small 'Copy pitch' button on sdPickCard, the BOTD card, the Standouts hero, and All Offerings rows. New buildPitchText(card, audience) composes a plain-text block from fields the card already holds (CUSIP, description, coupon, maturity, YTW, net TEY, benchmark spread, talkingPoint), tagged 'For Institutional Use Only', audience-aware via the active tax lens. Reuse the existing navigator.clipboard.writeText path + toast. Pure front-end, no server work.
- **Surface:** portal.js buildPitchText + 'Copy pitch' buttons on sdPickCard / BOTD / Standouts / All Offerings rows, reusing the existing clipboard call.
- **Constraint:** Stays 'For Institutional Use Only'; no disclosure-wording or infra change.

#### `CLI-2` Branded server-side Offering Sheet render (per CUSIP/basket, internal-use)  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** Reps hand-build a one-pager in Excel/Word for almost every quote — re-typing CUSIP, coupon, YTW, call schedule, ratings, and de-minimis/TEY math by hand, so numbers drift from what the portal computed.
- **Sketch:** server/offering-sheet-render.js modeled on portfolio-review-render.js (FBBS header + FINRA/SIPC footer, inline styles, @media print). GET /api/offering-sheet/render?cusip=&audience= reuses cusipSearchSources().normalize() + the daily-dashboard-rv read so every figure equals the dashboard's. Single-CUSIP = security tear sheet; multi-CUSIP = basket. 'Print Offering Sheet' buttons via shared data-cusip plumbing. The per-bank Today's Fits pitch sheet becomes a thin wrapper on this module. Keep 'For Institutional Use Only'.
- **Surface:** New server/offering-sheet-render.js + GET /api/offering-sheet/render (modeled on the portfolio-review-render route); 'Print Offering Sheet' buttons in portal.js.
- **Constraint:** Loop-safe ONLY if it stays 'For Institutional Use Only' (matching portfolio-review-render's footer). Any client-shareable variant needs owner/compliance sign-off.

#### `CLI-3` Daily 'Desk Read' printable — the live Sales Dashboard as a one-pager  ·  M/high  ·  planned-in-docs — 🤖loop-safe
- **Problem:** The old standalone pipeline produced a daily shareable HTML dashboard; the native page replaced the DATA but reps lost the shareable artifact and now screenshot the page. A 'client-facing print/share view' is an explicitly deferred Wave-5 item.
- **Sketch:** Render the already-computed FREE live RV dashboard (buildLiveDashboard/buildRvSections — Standouts, per-audience picks with benchmark/buyer/talkingPoint, BOTD, SoD, desk-read brief) through a branded server-side HTML view at GET /api/sales-dashboard/render?audience=&tax_ccorp=&tax_scorp=. Reuses the SAME never-billable deterministic read, so the printable is staleness-proof like the page. Stamp package date + FINRA/SIPC footer; 'Print desk read' button on the header.
- **Surface:** New render module fed by the existing /api/sales-dashboard live payload + GET /api/sales-dashboard/render; 'Print desk read' button in loadSalesDashboard. No new computation.
- **Constraint:** Loop-safe defaulting to 'For Institutional Use Only' (the Wave-5 framing). A truly client-shareable version is an owner decision on disclosure wording — keep the default institutional.

#### `CLI-4` Portfolio Review handout — add a recommended-action page from the Idea Engine  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** The Portfolio Review render is a clean holdings snapshot; the Idea Engine separately produces ranked swap candidates + packages with full economics. They live apart, so a printed handout shows holdings but NOT the desk's recommended moves.
- **Sketch:** Extend portfolio-review-render.js with an optional second section gated by GET /api/portfolio-review/render?withIdeas=1&bankId=, calling the SAME suggested-swaps path to render top 3-5 kept candidates + the best auto-suggested package (sells, matched buy, net income pickup, breakeven months) as a 'Suggested portfolio actions' page after the holdings table. Keep the existing internal-only disclosure.
- **Surface:** server/portfolio-review-render.js (add ideas section) + extend the existing GET /api/portfolio-review/render with ?withIdeas=1 reusing the suggested-swaps server path; 'with ideas' option on the Print/PDF button.
- **Constraint:** Loop-safe because it keeps the existing internal-only screen disclosure ('desk review controls final recommendation'). Do not flip to client-facing without owner sign-off.


### Trader / desk intraday & inventory state
_A new manual inventory-state layer (firm/reduced/sold/axed) and the axe board / desk recap / aging views that ride on it — high value, gated on one owner decision plus desk adoption._

#### `INV-1` Intraday inventory state layer (firm / reduced / sold / axed)  ·  M/high  ·  partial-extension — 🔒owner-decision
- **Problem:** The portal publishes one daily snapshot then is frozen until tomorrow. By mid-morning a rep can still pitch a block the desk filled at 9:30, or a trader cut a price on a stale agency and nobody downstream knows. There is no shared intraday truth about availability, size, or whether the desk wants it gone.
- **Sketch:** One SQLite table inventory_state(cusip, package_date, status, remaining_k, price_override, axe_note, updated_by, updated_at) in server/inventory-state-store.js through sqlite-db.js. Admin/trader-gated POST /api/inventory/:cusip/state, audited. Read path: buildAllOfferingsRows/normalize + buildArchivedOfferingsRows join the latest state row and overlay a status badge + effective remaining_k. One shared chip helper reused via data-cusip across All Offerings, explorers, Today's Fits, Sales Dashboard, swap inventory. SOLD greys/drops from fits; AXED floats up with the note.
- **Surface:** New server/inventory-state-store.js + 3 routes; overlay in buildAllOfferingsRows/normalize; one shared chip helper in portal.js reused across surfaces.
- **Constraint:** Introduces a brand-new persistent trader-write surface whose status taxonomy and whether a sold/fill record carries compliance retention touch the immutable-audit-history boundary. Desk-process + retention decision, not pure additive code. Gates the whole INV chain.

#### `INV-2` Desk axe board — the trader's intraday push surface  ·  M/high  ·  partial-extension — 🔒owner-decision
- **Problem:** When a trader wants to move a position they email reps individually or shout across the desk. There is no in-portal place for the desk to say 'work these three names today,' and reps have no single 'what is the desk pushing right now' view.
- **Sketch:** Builds on INV-1: a CUSIP with status='axed' + axe_note (+ optional sharper price) is an axe. New #axe-board page (Offerings group) renders GET /api/axes — all axed CUSIPs for today's package, enriched through normalize() + the RV score/spread from daily-dashboard-rv so each axe shows WHY it screens cheap, grouped by asset class. 'Who should I call?' reuses findOfferingFitsForBank. On-load Home badge as the in-portal alert. CSV export.
- **Surface:** GET /api/axes + #axe-board page; reuses inventory-state-store, daily-dashboard-rv RV scores, findOfferingFitsForBank, a Home badge tile.
- **Constraint:** Pure read over INV-1's data but inert until INV-1 lands and the desk marks axes — and INV-1 itself needs an owner decision. Build only after INV-1 is approved.

#### `INV-3` Inventory aging & turnover view (days-on-sheet, price drift)  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** The desk has no view of which offerings are stale. A CUSIP on the sheet 6 straight days at the same price is mispriced or unwanted — exactly what a trader needs flagged for an axe or markdown. The data is on disk in data/archive but nothing mines it for a turnover read.
- **Sketch:** Pure read over the archive. server/inventory-aging.js scans data/archive/<date>/_*.json via buildArchivedOfferingsRows across the last N dates, joins by cusipKey (same join computeMovers uses), computes per-CUSIP daysOnSheet, firstSeen, priceDriftBp, and a stale flag (>=5 business days, no price improvement). GET /api/inventory/aging; render a sortable Aging tab/panel on All Offerings, oldest-and-flat first. The optional 'Axe this' button would inherit INV-1's gating; ship the read standalone.
- **Surface:** server/inventory-aging.js (pure, archive-fed, node-testable) + GET /api/inventory/aging + Aging tab/panel on #all-offerings.
- **Constraint:** Pure additive read over data already on disk; ship without the 'Axe this' button to stay independent of INV-1.

#### `INV-4` Desk inventory-shape self-view (concentration by sector/state/maturity)  ·  S/med  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** The Exec Summary has a real position/risk grid but it is admin-gated and fed by four separate uploads. There is no lightweight always-on read of the shape of what we are currently offering — concentration by sector, state, maturity, issuer — the first thing a trader eyeballs for over-exposure or a thin part of the curve.
- **Sketch:** Pure aggregation over buildAllOfferingsRows (cross-asset, carries sector/state/maturity/availabilityK). server/inventory-shape.js computes breakdowns by asset class, maturity bucket (reuse RV MATURITY_BUCKETS), muni state concentration, top issuers, and gaps ('nothing offered 7-10yr agency today'). GET /api/inventory/shape; render a compact CSS-bar panel (like Pulse) on the upload/go-live page. Zero new data.
- **Surface:** server/inventory-shape.js (pure) + GET /api/inventory/shape + a CSS-bar panel on the upload/exec area.
- **Constraint:** Smallest and cleanest of the desk set. Verify it reads firm-wide (package is Soft-A shared) so it doesn't collide with rep-scope gating.

#### `INV-5` Sold/filled history -> daily desk recap of what moved  ·  M/med  ·  partial-extension — 🔒owner-decision
- **Problem:** Once a CUSIP is marked sold, the desk has raw material for a 'what moved today' recap and a running record of fills by sector/rep — a queryable internal turnover record it has never had in-portal.
- **Sketch:** Inventory-state transitions (firm->reduced->sold) stamp updated_at/updated_by + a size delta = a fill event. Pure server/desk-recap-fills.js rolls up today's fills: par moved by sector, by rep (join updated_by -> REP_ROSTER), fastest movers, and 'still firm at EOD' carryover feeding tomorrow's aging. GET /api/desk-recap?date= surfaces an EOD card on Home/Pulse; archived per package_date it becomes a multi-day series.
- **Surface:** server/desk-recap-fills.js (pure, reads inventory-state transitions + REP_ROSTER) + GET /api/desk-recap + EOD card on Home/Pulse.
- **Constraint:** Inert without INV-1 (owner-gated) AND desk adoption of marking sold. A turnover/fill record leans toward the compliance-retention boundary. Build last in the chain.


### Bank client intelligence & analytics
_Mine the 12-quarter store and FDIC API deeper: trajectory/streak signals, percentile-vs-cohort, whole-book opportunity screener, holdings-derived rate shock, AOCI/HTM capital read._

#### `BI-1` Quarterly Trajectory Engine — turn the 12-period store into trend signals  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** bank-data.sqlite stores up to 12 quarters per bank but every signal reads ONLY current-vs-prior (latestPeriodValues returns periods[0]/[1]; brokered-CD deltas are single-quarter). A one-quarter delta is noisy; a rep can't see loans/deposits climbing 4 quarters running or deposits bleeding 3. The trajectory is the call-trigger and sits unused.
- **Sketch:** Pure server/bank-trajectory.js: trajectoryFor(periods, metricKeys) computes per-metric least-squares slope over 4-8 periods, streak length, acceleration (latest delta vs trailing-avg). Reuse PEER_METRICS higherIsBetter for favorable/watch tone. Wire typed signals into buildBankIntelligence; reuse the existing CSS sparkline pattern inline in renderBankPerformanceSnapshot. No new data, no deps, no Claude.
- **Surface:** Bank tear sheet signals strip + Call Report snapshot table; engine server/bank-trajectory.js.

#### `BI-2` Cohort percentile/quartile ranking — not just above/below mean  ·  M/high  ·  partial-extension — 🤖loop-safe
- **Problem:** peer-averages computes a straight arithmetic AVG per cohort; the tear sheet shows above/below-mean deltas. 'NIM 0.4pts below peer average' is far weaker than 'bottom of the cohort.' The mean hides the distribution; the per-bank values are already queried inside the cohort.
- **Sketch:** Extend computeCohortAverages to also return the sorted per-metric value array (members already selected — json_group_array or compute in JS), then the subject bank's percentile + quartile. Tear sheet renders a percentile pill per metric color-coded by higherIsBetter; add a 'peer outliers' rollup of worst/best-decile metrics. Pure SQL+JS; works vs user-curated peer groups too.
- **Surface:** Bank tear sheet peer-comparison rows + Peer Groups page; server/peer-averages.js extension.
- **Constraint:** Additive to an existing pure module; distribution recompute bounded by cohort size.

#### `BI-3` Whole-book opportunity screener — rank ALL covered banks by funding/portfolio pressure  ·  M/high  ·  partial-extension — 🤖loop-safe
- **Problem:** buildBrokeredCdOpportunity produces a 0-15 funding-pressure score per bank but only runs when a rep opens one tear sheet. There's no way to ask 'across my book, which 10 banks screen hardest for a brokered-CD call this quarter?' The offerings-fit 'who should I call' exists, but nothing ranks banks by their OWN balance-sheet pressure.
- **Sketch:** Refactor buildBrokeredCdOpportunity's core into a pure batch-callable scorer in server/bank-opportunity-score.js. New GET /api/banks/screen?signal=funding|portfolio&owner=&minScore= iterating the bank set rep-scoped via shouldEnforceRepScope/enforcedRollupRep (Pulse gating), returning a ranked call list with the top driving signal per bank. New #bank-screener page with signal chips + owner filter + inline Log activity/Create task.
- **Surface:** New #bank-screener page + /api/banks/screen; refactor of buildBrokeredCdOpportunity into server/bank-opportunity-score.js.
- **Constraint:** Must reuse enforcedRollupRep so non-admin runs collapse to the signed-in rep's owned banks. Name it distinctly from the existing single-bank CD screen tool.

#### `BI-4` Portfolio rate-shock from holdings — fallback when THC scenario rows are absent  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The portfolio review shows +300/-300bp rate-shock ONLY when the THC workbook carries scenario rows. Most bond-accounting files lack those rows, so the strongest ALM talking point silently disappears — yet every holding carries effectiveDuration/marketValue and swap-math has the duration math.
- **Sketch:** server/portfolio-shock.js: when scenario rows are missing, synthesize dMV ~ -effectiveDuration x dy x marketValue per holding (derive duration via swap-math.modifiedDurationFromYield for rows missing eff dur), summed across the book at +/-100/200/300bp. Surface as the SAME scenario card the THC path feeds, clearly labeled 'estimated from holdings (first-order)' vs 'THC scenario'. Feeds the existing rate-shock priority + auto ALM/IRR strategy request.
- **Surface:** Bank tear sheet -> Portfolio Review (render + in-app panel); engine server/portfolio-shock.js.
- **Constraint:** Additive fallback; must label estimated-vs-THC provenance so the first-order approximation isn't mistaken for a true EVE/EaR run.

#### `BI-5` Securities-mix X-ray vs cohort + AFS/HTM split + concentration  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** The tear sheet renders dollar amounts for a 5-bucket Securities Mix + a balance-sheet bar + a securitiesToAssets peer value, but NO per-sector % vs cohort median, NO AFS-vs-HTM split ratio, NO concentration read — even though BANK_FIELDS already imports the full AFS+HTM sector breakdown.
- **Sketch:** server/securities-mix.js: build AFS/HTM sector % mix, an AFS/HTM repositionability ratio, and an HHI-style concentration read (model after exec-summary issuer-concentration). Cross with the cohort to emit 'munis 8% of book vs 22% cohort median — underweight, screen BQ in-state'. Render a stacked CSS bar with gap-vs-peers callouts that deep-link into the matching explorer; feed Today's Fits + buildAssistantProductFits. The deferred runoff-gap Product Fit angle (runoff-dollar/book-yield) is better scoped to the swap-engine baskets (SWP-3).
- **Surface:** Bank tear sheet Call Report tab — upgrade the Securities Mix card; server/securities-mix.js feeding buildBankIntelligence + Today's Fits.

#### `BI-6` AOCI/HTM unrealized-loss & tangible-capital read via the keyless FDIC API  ·  S/med  ·  partial-extension — ⚡quick-win
- **Problem:** The FDIC BankFind pull fetches only 8 headline fields — no unrealized AFS/HTM losses, no tangible-capital-net-of-AOCI. The post-2022 community-bank story IS the unrealized loss in AFS (AOCI) and HTM — the exact pain that makes a bank receptive to a tax-loss swap. The FDIC API serves these keyless on the cert we already join.
- **Sketch:** Extend the FIELDS string with AFS/HTM fair-value-vs-amortized-cost and AOCI RIS variables (24h cache + never-throws unchanged). Compute estimated AFS+HTM unrealized loss and AOCI-haircut tangible equity. The existing 'FDIC live' bar gains a line ('Est. HTM unrealized loss ~$X (Y% of tier-1) — frame swaps as adds, not sells'). Verify exact RIS field codes against the live FDIC schema at build time and drop non-public fields gracefully.
- **Surface:** Bank tear sheet FDIC-live bar; server/fdic-bankfind.js field extension.
- **Constraint:** Free keyless FDIC only. loopSafe=false: requires build-time verification of exact public RIS field codes — an unattended loop can't confirm the schema and risks shipping wrong/blank capital figures, high-stakes for a client conversation.

#### `BI-7` FFIEC CDR bulk importer — keep call-report periods fresh between FedFis workbooks  ·  L/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** Bank financials only refresh on the 153MB FedFis workbook ritual, so tear sheets, the trajectory engine, peer percentiles and the screener can all be a quarter or two stale. fdic-bulk-sync fills headline fields but has no RC-B securities maturity buckets. A full FFIEC CDR bulk-ZIP importer is specced but unbuilt.
- **Sketch:** Build to docs/ffiec-bulk-importer-spec: REST PWS bulk ZIP -> extract TSV with platform unzip (mirrors bank-data-importer's shell-out, no new dep) -> parse first-release RC/RI/RC-R/RC-B incl. maturity buckets -> map by FDIC cert via FFIEC_FIELD_MAP -> append period rows with values.source='ffiec' through withDatabase(), never overwriting a FedFis period. Admin POST /api/admin/ffiec-sync with ?dryRun=1. Fixture-driven tests, no network.
- **Surface:** Upload/Admin page button (admin-gated) -> /api/admin/ffiec-sync; new server/ffiec-bulk-importer.js + FFIEC_FIELD_MAP.
- **Constraint:** OWNER DECISION required (the spec says so): stopgap-additive vs full FedFis replacement. Large L build with an explicit owner gate, external REST integration, and RC-B field-mapping accuracy that warrants an owner present.


### Bond swap & portfolio strategy depth
_Extend the pure Idea Engine with what-if grids, ladder-fill and income-replacement baskets, cross-bank swap radar, and sent/executed proposal drift + back-check reads._

#### `SWP-1` What-if sensitivity matrix on the Idea Engine (reinvest-rate + loss-budget grid)  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** Reps run the Idea Engine at one reinvest target and one loss budget, then guess what happens if rates move 25bp or the bank realizes half the loss. CFO pushback ('show me this holds up if rates move') can't be answered without re-running knob-by-knob.
- **Sketch:** The engine is pure math through reinvestTargetEconomics + summarizeReinvestPackage. Run buildSwapPortfolioReport across a small rep-chosen grid (reinvest target -50/-25/0/+25/+50bp; 2-3 loss-budget tiers) and return a compact matrix: per cell kept-count, executable volume, added annual income, blended breakeven. Render as a small heatmap above the blotter. Add a 'reinvest at the live curve at this tenor' cell from market-rates.js. A loop over the existing engine — no new primitives.
- **Surface:** GET /api/swap-proposals/suggested gains ?sweep=1 (or /api/swap-proposals/sensitivity); rendered in the Idea Engine view.
- **Constraint:** Cap grid size to keep per-request cost bounded since each cell re-runs the screen.

#### `SWP-2` Ladder-fill section — turn gap-year detection into buy suggestions  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The engine already computes maturity-ladder gap years and the findings warn 'Potential cash-flow gaps around 2029, 2031...' — but that insight dead-ends as a sentence. The rep can't act on it. The desk's value-add is building a smooth ladder; the engine only screens what to SELL.
- **Sketch:** Reuse profile.gapYears + buildAllOfferingsRows. For each gap year, filter today's offerings whose maturity (or workout date) lands in that year, score with scoreOfferingFit (already boosts gap-year fits), rank by RV score from daily-dashboard-rv else yield. Return a 'Ladder fill' section: per gap-year, top 2-3 CUSIPs with data-cusip deep links + a 'Build buy leg' action seeding a buy-only proposal. No sell required — the deploy-cash pitch.
- **Surface:** New additive section in GET /api/swap-proposals/suggested (like packages[]); card group in the Bond Swap page.
- **Constraint:** Additive read-only section reusing existing scorer + registry; seeds a draft only on explicit rep action.

#### `SWP-3` Income-replacement basket from the cashflow runoff series  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The engine shows projected runoff at 6/12/24mo + a reinvestment-pipeline finding but stops at 'here's how much cash is coming back.' The desk conversation is 'you have $4.2MM rolling off in 12 months at 2.3%; here's a basket replacing that income at 5.0% — net +$113K/yr.' That synthesis exists in pieces but isn't assembled.
- **Sketch:** Combine three engine pieces: runoff.run12/run24 dollars, the par-weighted book yield of lots maturing/calling in the window, and the All Offerings registry. Size a replacement basket to runoff dollars via scoreOfferingFit ranking + solveBuyParForProceeds, compute income-given-up vs income-gained with reinvestTargetEconomics conventions. Present 'replace your 12-mo runoff' as a ready basket with 'Build proposal'. A buy-side companion to the existing sell-side packages[]. Absorbs the Product Fit runoff-gap idea.
- **Surface:** New additive section in GET /api/swap-proposals/suggested (alongside packages[]/runoff); card in the Idea Engine view.
- **Constraint:** Degrades cleanly when no cashflow sheet (runoff.hasCashflow false-guards); builds a draft only on rep action.

#### `SWP-4` Cross-bank swap radar — which covered banks hold the same underearning bond/vintage  ·  L/high  ·  new — 🤖loop-safe
- **Problem:** The Idea Engine runs one bank at a time. When a rep finds a great sell-and-reinvest idea, there's no way to ask 'who ELSE that I cover holds this CUSIP or this low-coupon vintage and could do the identical swap?' The bond-accounting store has parsed holdings for every bank with a portfolio file — the biggest untapped lever for repeating a winning idea.
- **Sketch:** Build a one-pass cached index (invalidated on bond-accounting re-import, like buildCdRolloverUniverse) of CUSIP -> [{bankId, par, bookYield}] across all matched banks. New GET /api/swap-radar/cusip/:cusip (or ?coupon&sector&maxYield&maturityBefore for a vintage scan) returns covered banks holding that exposure, rep-scoped via the acting-rep cookie (covered-first, like the Rollover Wall). 'Who else holds this?' action on Idea Engine candidate cards. The inverse of Today's Fits, for swaps.
- **Surface:** New cached index + GET /api/swap-radar (reuses bond-accounting-store + rep-scope helpers); action button on Idea Engine candidate cards and the blotter.
- **Constraint:** Exposes cross-bank holdings — non-admin ?rep=all MUST collapse to the signed-in rep via enforcedRollupRep; firm-wide stays admin-gated. Highest blast radius of the swap set: wire the scope guard on the new route, not just the index.

#### `SWP-5` Sent-proposal market-drift banner (did the buy leg re-price before execution?)  ·  S/med  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** On send the legs freeze and the snapshot becomes canonical, but between 'sent' and 'executed' (days) the buy-leg offering's yield can move or the offering can be pulled. The rep gets no signal the proposal they're about to execute is now off-market — they find out only when the trade desk pushes back.
- **Sketch:** On the proposal detail/render route for status='sent', join each frozen buy-leg CUSIP back against today's All Offerings registry (same rejoin watchlists/CUSIP search use). Compute yield/price drift vs the snapshot and a 'still offered today?' flag. Show a non-blocking banner: 'Buy leg CUSIP X now 4.85% vs 5.00% on the proposal (-15bp) — reconfirm' or 'no longer in today's package.' Pure read, no mutation. Mirrors the Sales Dashboard stale banner.
- **Surface:** GET /api/swap-proposals/:id (or :id/render) adds a driftCheck block for sent proposals; banner in the proposal view.
- **Constraint:** Read-only diff against live inventory; non-blocking advisory banner, never mutates the frozen snapshot.


### Market data trend surfaces from the archive
_The RV engine only diffs one prior day; assemble multi-day spread/CD/curve/muni-ratio/supply trends from data already archived on disk._

#### `MKT-1` Spread History Lab — multi-day RV time series from the archive  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The RV engine only diffs TODAY vs ONE prior package. The desk has 21+ archived daily packages each with a full _relative_value.json (per-tenor cd/agency/muni/corp spreads net of UST) but nobody can see the multi-week trend. 'Are agency spreads at the wide end of their range or grinding tighter?' has no answer in the portal.
- **Sketch:** New GET /api/spread-history walks getArchiveList, calls loadArchivedRelativeValueSnapshot(date) per date + loadCurrentRelativeValueSnapshot, assembles a per-tenor cd/agency/muni/corp Spread series, computes latest/min/max/median/percentile-of-range (reuse percentileRank). New #spread-history page (Offerings group) renders SVG polyline sparklines (FRED card pattern) + a 'current vs 21-day range' bar. Cache by package date.
- **Surface:** New #spread-history SPA page (Offerings group) + GET /api/spread-history.
- **Constraint:** Archive-gap caveat: dates are irregular (1-13d gaps); label the series by actual dates, not assumed daily cadence.

#### `MKT-2` CD Rate Curve Trend — exploit the 559 daily CD-history snapshots  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** There are 559 daily CD-offer snapshots spanning 2.5 years, but the only consumer is the Weekly CD Recap (7-day window). That multi-year proprietary term-structure dataset is unused. A funding rep can't answer 'where are 2Y brokered CD rates vs 6 months ago' or 'is the 3m/5y CD curve steepening.'
- **Sketch:** Add summarizeCdRateTrend(historyDir, {terms, lookbackDays}) to cd-history.js next to summarizeWeeklyCdHistory, reusing medianRatesByTerm to get a median rate per term per snapshot, sampled weekly to stay cheap -> {term:[{date,medianRate}]}. New GET /api/cd-rate-trend?lookback=180. New 'CD Rate Trend' panel on #cd-recap: one SVG line per key term (3m/6m/1y/2y/3y/5y) + a 'now vs N-days-ago' term-structure overlay. Deterministic, no Claude, no new dep.
- **Surface:** New panel on the Weekly CD Recap page (#cd-recap) + GET /api/cd-rate-trend; new summarizeCdRateTrend() in server/cd-history.js.
- **Constraint:** Weekly sampling keeps the 559-file walk cheap; cache by package date.

#### `MKT-3` Curve & rate regime timeline — the desk's own Treasury/SOFR history  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The market-snapshot band shows today's canonical 2Y/5Y/10Y/30Y/2s10s/SOFR from the daily Economic Update PDF, but there's no view of HOW the curve moved over the archive. Reps and the strategist read regime from the trend, not a point. We archive _economic_update.json per package date — a clean multi-week curve+funding history never assembled.
- **Sketch:** New GET /api/curve-history walks getArchiveList, reads loadArchivedEconomicUpdate(date), pulls treasuries[] tenor yields + key marketRates into series. Surface on Daily Intelligence under the snapshot strip: a 2s10s/3m10s steepness timeline + per-tenor mini-lines (SVG) + a 'curve shape now vs N days ago' two-polyline overlay (today solid, prior dashed). Uses the desk's own canonical numbers — no source-disagreement risk.
- **Surface:** GET /api/curve-history + a timeline section on Daily Intelligence under the market-snapshot band.
- **Constraint:** Read-only, uses canonical desk numbers (consistent with the market-snapshot policy). Archive-gap labeling applies.

#### `MKT-4` Muni/UST ratio heatmap by grade x tenor (from the MMD slot)  ·  S/med  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** The MMD slot carries AAA/AA/A/Baa scales + treasuryRatios, but the strategist KPI strip surfaces only AAA ratios at 2/5/10/30. The desk's real screen is the classic muni richness grid — which grade/tenor cells are cheap to MMD now and vs recent history. The full grid is parsed daily but only four cells are shown.
- **Sketch:** New GET /api/muni-ratio-grid reads loadCurrentMmdCurve + a few loadArchivedMmdCurve(date) points, interpolates each grade at standard tenors (2/3/5/7/10/15/20/30) reusing interpolateMmd + interpolateTreasuryRatio, computes muni/UST ratio per cell + delta vs the prior archived MMD. Render a compact color-coded HTML table (CSS background ramp, no chart lib) on #mmd-curve: rows=grade, cols=tenor.
- **Surface:** New 'Ratio grid' panel on #mmd-curve + GET /api/muni-ratio-grid (all helpers already exported).

#### `MKT-5` Per-CUSIP spread-history sparkline on explorer / All Offerings rows  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** computeMovers CUSIP-joins today vs ONE prior package, but a rep looking at a single muni/agency in the explorer can't see whether THIS bond's spread-to-Treasury has been widening over the last several archived packages. The data exists per CUSIP per day — it's just never joined across more than two days.
- **Sketch:** New GET /api/security/spread-history?cusip= walks getArchiveList, uses buildArchivedOfferingsRows(date) to find the CUSIP per day, recomputes matched-Treasury spread per day with the same workout-tenor interpolation. Returns {date,yield,spreadBps}. Render an inline SVG sparkline + 'spread N bp wider/tighter over M days' chip in the All Offerings drawer / explorer detail, deep-linked via data-cusip. Degrade for thin series.
- **Surface:** GET /api/security/spread-history + sparkline in All Offerings row drawer and muni/agency/corp explorer detail.
- **Constraint:** Requires extracting/exporting the matched-Treasury spread calc currently inline in rvForCandidate so the route reuses it (interpolateCurve + workoutTenor are exported; the spread step is not). Behavior-neutral export.

#### `MKT-6` Carry & roll-down scanner — par-curve roll estimate on the RV engine  ·  M/med  ·  planned-in-docs — 🤖loop-safe
- **Problem:** The RV composite docks long maturity and call risk but never CREDITS roll-down — the return a bond earns aging down a positively-sloped curve. On a steep front end this is a real, sellable edge and it's pure math off the cached Treasury par curve. No carry/roll field exists in the RV block.
- **Sketch:** Add pure computeRollDown(candidate, curve) to daily-dashboard-rv.js: take workout tenor, interpolate the par curve there and ~1Y shorter, 1Y roll-down = yield_now - yield_minus_1y, plus carry (coupon) -> total 1Y carry+roll. Attach rollBps + a 'carry+roll' chip via chipsFor. Add a maturity-bucketed 'best carry+roll' mini-board to #sales-dashboard (reuse sdBuckets). Treasury-grounded, deterministic, free on every GET.
- **Surface:** New rollBps field in buildRelativeValue + a 'Carry & Roll' board on #sales-dashboard (reuse sdBuckets/sdBoardTable).
- **Constraint:** Roll-down is a par-curve-derived estimate (no OAS/convexity — Bloomberg/BVAL license wall). Must label it 'par-curve roll estimate' on the UI, same disclosure pattern as the duration-proxy decision.

#### `MKT-7` New-supply concentration tracker — issuer/state/sector saturation over time  ·  S/med  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** computeMovers surfaces today's supply-concentration radar but ONLY as a one-day snapshot. The desk wants the trend: 'heavy Texas muni supply 4 packages running' or 'agency callable supply drying up' — where pricing pressure (and rep opportunity) is building. Per-day archived offerings JSONs hold every issuer/state/sector but are never aggregated across days.
- **Sketch:** New GET /api/supply-trend walks getArchiveList + buildArchivedOfferingsRows(date), counts per archived day by asset class, muni state, and sector -> {bucket:[{date,count}]}. Surface a 'Supply trend' panel in the Sales Dashboard 'What changed' area (reuse sdRegime markup): top rising/falling supply buckets with a count sparkline, deep-linked via data-goto. Pairs with the one-day radar to give it memory.
- **Surface:** GET /api/supply-trend + a 'Supply trend' panel in the Sales Dashboard 'What changed' section.


### AI / Claude prose layer (grounded, billable)
_Light up documented swap points — Sales Assistant narrative, swap cover email, per-pick objection/counter, exec-summary prose, weekly recap — always grounded, deterministic fallback, admin-gated /refresh._

#### `AI-1` Light up the Sales Assistant's documented LLM swap point  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The bank tear-sheet Sales Assistant is fully deterministic — fixed bullet phrasing of signals/fits/swap candidates. The most rep-facing surface in the portal doesn't use the Claude budget the desk already pays for, so reps hand-translate the readout into a human call-open.
- **Sketch:** Wrap buildBankAssistantResponse exactly as its own comment instructs: keep the deterministic build as grounding/fallback, add server/bank-assistant-narrative.js on the offerings-pick skeleton (buildInput = curated context dict only, never the raw bank blob; forced tool-use callOpen/twoAngles/oneAsk; ground() re-attaches every number/CUSIP and drops any product/CUSIP not in fits/swapCandidates). Billable admin-gated /refresh, cache per (bankId + package date + period). No-key/failure/hallucination returns the existing deterministic callNote (degraded:true). Existing 'Log as activity'/'Build swap' buttons just work.
- **Surface:** Bank tear sheet -> Sales Workspace -> Sales Assistant panel. New server/bank-assistant-narrative.js + the existing buildBankAssistantResponse caller.
- **Constraint:** Billable route must be admin-gated like /api/sales-dashboard/refresh; cache keyed by bankId+package date+period to bound cost. Deterministic build stays fallback + grounding source.

#### `AI-2` Claude-drafted client cover email from a sent swap proposal  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** After sending a multi-leg swap proposal, the rep hand-writes the cover email around numbers the frozen snapshot already holds — retyping prose around figures the system computed.
- **Sketch:** 'Draft cover email' action on a sent proposal beside /render. server/swap-email-draft.js: buildInput from swap_proposal_snapshots.snapshot_json ONLY (immutable). Forced tool-use returns {subject, greeting, body, signoff} with figure placeholders; ground() splices the actual snapshot numbers so the model never emits a figure. FINRA-safe system prompt ('For Institutional Use Only, state only what the snapshot supports'); output is a copy-to-clipboard draft + the FINRA/SIPC disclaimer. No SMTP. Cache by proposal id + snapshot hash (one-time cost).
- **Surface:** Bond Swap -> sent-proposal view; new /api/swap-proposals/:id/draft-email mirroring the existing /render route.
- **Constraint:** No SMTP (respects no-email rule) — copyable draft only. Grounds strictly off the immutable snapshot, never live market data. Disclaimer footer required; billable route admin-gated.

#### `AI-3` Per-pick objection + grounded counter on Sales Dashboard talking points  ·  S/med  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** The Sales Dashboard already has Claude write a per-pick rationale + talkingPoint, but on the phone the bank pushes back ('too long', 'we don't do BQ', 'spread thin vs last week'). Reps want the likely objection AND a data-grounded counter ready, not just the pitch.
- **Sketch:** Extend DASHBOARD_TOOL with two optional per-recommendation fields: likelyObjection and counter. The RV engine already computes everything a counter needs (rvBps/score, de-minimis, BQ-worth bp, TEFRA haircut, trend diff, workout-tenor spread, supply concentration); require the counter to cite one. attachRow/groundDashboard re-attach real figures so it can't fabricate; deterministic fallback fills counter from rv so it's always present and failure-safe. No new route — rides the existing free GET + billable /refresh; renders as an expandable line under each sdPickCard talking point.
- **Surface:** Sales Dashboard pick cards (sdPickCard). daily-dashboard-judgment.js (DASHBOARD_TOOL + grounding).
- **Constraint:** Additive to an existing billable /refresh — no new cost surface. Counter must cite an existing RV field; deterministic fallback keeps it failure-proof.

#### `AI-4` On-load 'My desk this week' rep recap (in-portal, no cron)  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** No narrative weekly review for reps or the desk head. CRM Pulse shows live KPIs but nobody synthesizes 'what moved' — accounts touched, what went cold, opps advanced/stalled, what's overdue. Scheduled/emailed digests were dropped, so the recap must live in-portal.
- **Sketch:** Grounded narrative recap card on Home / Pulse, generated on-demand (button), cached per (rep + ISO week). buildInput pulls ONLY existing rep-scoped aggregates (activityCountsByRep/listRecentManualActivities this week vs last, overdue/upcoming tasks, pipelineSummary stage moves, myColdAccounts, won/lost rows). Claude writes a 5-6 sentence desk-voice recap + 3 prioritized 'do this Monday' bullets each carrying a bankId. ground() re-attaches every count/dollar. Rep-scoped via the acting-rep cookie/enforcedRollupRep. No cron — generates on open or shows last week's cached card with a refresh affordance.
- **Surface:** Home MY WORK and/or CRM Pulse — new recap card. New server/desk-recap-ai.js + /api/me/recap.
- **Constraint:** No cron/email — in-portal on load/refresh only. Rep-scoped; firm-wide (?rep=all) admin-gated. Distinct from INV-5 (fills recap) — this is the CRM weekly prose recap.

#### `AI-5` Claude prose layer for the management Exec Summary  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** The admin-only Exec Summary computes capital/risk-DV01/P&L/revenue/activity and a DETERMINISTIC CEO narrative. It's accurate but reads like template fill-in and can't phrase a 'what changed vs last COB' paragraph well.
- **Sketch:** Optional Claude pass over the FULLY COMPUTED exec-summary object + the prior COB snapshot (already persisted one-per-date), rewriting into 2-3 exec paragraphs + a 'vs prior COB' delta paragraph. buildInput is computed metrics + deltas only; the model emits prose with placeholders, ground() splices real numbers so it can't invent a P&L. buildNarrative stays always-present fallback + grounding source (degraded:true on failure). GET stays free (cached prose if present, deterministic otherwise); new admin /api/exec-summary/narrative/refresh is the billable path, audited.
- **Surface:** Operations -> Exec Summary (admin-gated). exec-summary-store buildNarrative + a new narrative consumer; new admin refresh route.
- **Constraint:** Admin-gated, Tier-B internal-only. Deterministic narrative remains source of truth + fallback. Sensitive management surface — keep grounding airtight.

#### `AI-6` Strategy-request triage + draft-completion-note assistant  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** Strategy requests arrive as free text and sit in the queue. The analyst reads each cold to infer the ask, and on completion hand-writes the billing/close-out note. No AI help summarizing the request or drafting the close-out.
- **Sketch:** Two grounded touches on existing strategy-store rows. (1) 'Summarize ask' distills the free-text body + the linked bank's tear-sheet context into a 2-line brief + suggested status + request-type sanity check. (2) On Completed/Needs Billed, 'Draft completion note' turns the request + any linked swap proposal economics into a close-out paragraph for the billing queue. Both follow the skeleton (structured input only, ground() re-attaches metrics/CUSIPs), cache per (requestId + status). Billable on click, admin-gated.
- **Surface:** Strategies -> Strategies Queue (request detail + status-change flow). New server/strategy-assist.js + two small routes.
- **Constraint:** Billable + admin-gated. Grounds off the strategy row + already-parsed bank/proposal data; no new data source.

#### `AI-7` Grounded 'Ask the package' retrieval-grounded Q&A box  ·  L/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** A rep wants a quick natural-language answer ('cheapest AA muni inside 7y to MMD today?', 'which of my banks have CDs rolling in 90 days?') and today must hunt across explorers, the rollover wall, and the snapshot band. There is no Q&A surface anywhere.
- **Sketch:** A retrieval-then-ground box (header jump-bar area or #ask page). It does NOT free-roam: a router classifies the question into a fixed set of already-built domains and calls the matching function (buildAllOfferingsRows+RV, buildCdRolloverUniverse, buildMarketSnapshot, searchBanks, pipelineSummary/buildCrmDashboard). Matched rows (capped) go to Claude with forced tool-use returning {answer, citedCusips[], citedBankIds[]}; ground() re-attaches every number and rejects any CUSIP/bankId not retrieved. Renders with data-goto/data-cusip. Rep-scope collapse applies to CRM-domain questions.
- **Surface:** New #ask page + header jump-bar 'Ask' affordance. New server/portal-qa.js (router + ground) reusing existing domain functions.
- **Constraint:** Owner decision: whether reps (not just admins) run billable questions, and a per-session cap — per-question cost can't be cached by package date like other AI surfaces. Largest blast radius (new page + router + jump-bar). Strictly retrieval-grounded.

#### `AI-8` AI-output provenance/disclosure stamp on generated narratives  ·  S/med  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** The portal puts Claude-generated prose in front of reps and (via talking points) potentially clients. Machine-generated content informing a recommendation should carry a clear 'AI-assisted, generated <date> from <package>, numbers re-verified' disclosure, and a supervisor should be able to tell AI prose from the deterministic engine.
- **Sketch:** Shared renderAiProvenance(meta) badge in portal.js on every AI card: 'AI-assisted - generated <date> - package <pkgDate> - figures re-verified from FBBS data', driven by metadata consumers already emit (aiGenerated, package date, cache generated-at, degraded/flags). When a rep copies an AI talking point into a supervised textarea, auto-prepend a compliance-safe attribution. Add model id to the audited *-refresh rows if absent. Pure presentation reuse of audited metadata.
- **Surface:** Shared provenance badge in portal.js on Daily Intelligence / Pick-of-Day / Sales Dashboard cards + attribution-on-copy into supervised textareas.
- **Constraint:** Pure presentation + reuse of existing audited metadata. Keep wording neutral/factual; a compliance owner can refine exact disclosure text later.


### Reporting & analytics builder
_Join CRM facts onto the bank dataset for one-pass targeting reports, add a bulk offering-fits call-sheet report, report snapshots/diff, governance, and a branded report renderer._

#### `RPT-1` Cross-dataset report builder — join CRM recency, tasks, pipeline $ onto the bank dataset  ·  M/high  ·  partial-extension — 🤖loop-safe
- **Problem:** The custom-bank report builder fetches /api/banks/map, which joins coverage status/owner + account status but NOT activity recency, open-task counts, or open-opp $. So a rep can't build the one targeting report that drives selling ('owned Sub-S banks in IL/MO, deposit-growth, no touch in 60d, no open opp') in a single pass.
- **Sketch:** Thin server join (extend buildMapBankList or new /api/reports/bank-dataset) LEFT-joining per-bank CRM facts whose store helpers exist: lastActivityByBank (daysSinceTouch), activityCountsByBank, overdue/upcoming tasks (count + earliest due), per-bank rollup from pipelineSummary (open-opp count + $). Emit as additional fields[] entries (section:'CRM', type date/number/money) so they drop into the existing condition/column/group-by UI — report-logic.js type-dispatches operators, zero front-end engine work. Rep-scope the CRM columns through enforcedRollupRep.
- **Surface:** server.js buildMapBankList add the activity/task/pipeline joins; portal.js loadCustomBankReport gets the extra fields for free.
- **Constraint:** Additive join over existing store helpers + existing rep-scope plumbing; no new dep, no schema change. Foundational — RPT-3/RPT-6 build on this joined dataset.

#### `RPT-2` Offerings-fit report — bulk cross-join today's inventory against the whole book  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The desk has per-single-bank inverse-buyer logic (Today's Fits) but no BULK report answering 'across my whole book, which banks are the best fit for what's offered today, ranked and exportable as a call sheet.' Planning a morning means opening tear sheets one at a time.
- **Sketch:** New report type 'offering-fits'. GET /api/reports/offering-fits scores every covered bank against today's buildAllOfferingsRows with the EXISTING scoreCoverageBankForOffering rules, rolled up: each bank's top 1-3 matching offerings + best score, filterable by asset class/min-yield/owner/state, group-by rep or state. Rows deep-link via data-goto/data-cusip to tear sheet and explorer. Becomes a printable call sheet via the report renderer.
- **Surface:** server.js reuse scoreCoverageBankForOffering over coverage banks + buildAllOfferingsRows. report-store REPORT_TYPES += 'offering-fits'. #reports rail + output reuses customBankReportOutputHtml.
- **Constraint:** Reuses an existing, tested scorer + registry; additive report type, no new dep. Highest reuse-to-value ratio of the reporting set. Pairs with WF-1.

#### `RPT-3` Branded server-side report renderer (printable / Save-as-PDF)  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** Custom-bank, activity, and pipeline reports export only as CSV — no clean branded printable (title, run date, filter summary, grouped/subtotaled table, FINRA/SIPC footer). Reps paste CSV into Excel and reformat by hand. The desk has a proven server-side print pattern (swap-render, portfolio-review-render).
- **Sketch:** New server/report-render.js modeled on swap-render.js: GET /api/reports/:id/render produces a standalone inline-styled @media-print page (Save-as-PDF = the zero-dep export). Group-by reports render as nested sections with subtotal rows. A 'Print / Save PDF' button on report output. For grouped server-side output it benefits from a headless report-logic.js runner; otherwise scope to render-from-current-client-run.
- **Surface:** New server/report-render.js next to swap-render.js; route beside /api/swap-proposals/:id/render. Button in portal.js report outputs.
- **Constraint:** CSP-safe served-HTML, no new dep, no PDF library. Grouped server-side render benefits from a headless runner — without it, scope to a render-from-client-run variant to stay loop-safe.

#### `RPT-4` Saved-view / report governance — mine vs shared, owner/admin rename+delete  ·  S/med  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** Custom saved views are silently firm-visible. As reps accumulate definitions the rail becomes a junk drawer of half-named other-people's reports a rep can't mark 'the desk's official prospect list' vs 'my scratch filter,' and can't clean up.
- **Sketch:** report_definitions already stores created_by; add a 'visibility' column (mine | shared, default mine) via a PRAGMA-guarded migration mirroring migrateReportHiddenPerRep. Split the #reports rail into 'My Custom Reports' (created_by == me) and 'Shared with the desk' (visibility=shared). Owner-or-admin can rename / set shared / delete via the existing PATCH/DELETE routes with an added owner-or-admin authorization check. NO new auth model.
- **Surface:** report-store.js additive visibility column + migration + listReportDefinitions filter. server.js PATCH/DELETE get an owner/admin guard. portal.js #reports rail split.
- **Constraint:** Authorization check on existing routes + one additive PRAGMA-guarded column — does NOT add an auth/users/roles system; reuses created_by + FBBS_ADMIN_USERS.

#### `RPT-5` Report snapshots + week-over-week diff  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** Every report is a live point-in-time read with no memory — reps can't answer 'which banks crossed my deposit-growth threshold this quarter' or 'what moved in my pipeline since last week.' The report builder has no snapshot persistence.
- **Sketch:** 'Pin snapshot' on a run custom report -> POST stores the resolved bankId-keyed row set + timestamp as a JSON blob in a new report_snapshots table in reports.sqlite (size cap/rotation). A 'Compare to...' picker diffs current vs a chosen snapshot: entered/exited/per-metric delta. For financial metrics, optionally strip the parallel shift like computeMovers. Render a tri-section diff table. Diff math in a new node-testable module beside report-logic.js.
- **Surface:** server/report-store.js snapshot CRUD (same sqlite-db bound-param pattern). New route beside /api/reports. portal.js custom-bank output gets the picker + diff renderer. No new dep.
- **Constraint:** Additive table + JSON blobs, no new dep; capped/rotated like the audit log.

#### `RPT-6` Activity-log analytics — weekly trend buckets + deposit-weighted coverage-gap heatmap  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** The activity-summary report gives flat per-rep counts — managers can't see week-over-week trend, or which high-deposit/high-priority banks get zero touches. The richest behavioral dataset (every logged call/email/meeting) is barely mined.
- **Sketch:** Extend activity-summary (or add /api/reports/activity-analytics) to (1) bucket counts into trailing weekly columns (4-8 weeks) shown via the CSS-bar technique Pulse already uses; (2) cross per-bank activity counts against deposit tier (joined dataset) + priority to surface a coverage-gap view weighted by deposit size. Admin-gated firm-wide via enforcedRollupRep.
- **Surface:** server.js activity-summary / account-touch handlers extended with weekly buckets + deposit-weighted gap mode, reusing activityCountsByRep/activityCountsByBank + the joined dataset (RPT-1). portal.js #reports output reuses renderCrmDashboard CSS bars.
- **Constraint:** Additive query shaping over existing helpers + existing admin-gating; deposit-weighted gap mode depends on RPT-1's joined dataset.


### Reliability, data quality & observability
_Catch silent failures: parser row-count regression alarm, rep-facing health badge, DB backup/integrity, rollback-snapshot sweep, degradation contract tests, freshness chips, reliability ledger._

#### `REL-1` Parser yield-watch — cross-day row-count + field-coverage regression alarm  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** A parser silently extracting fewer rows after a desk PDF/xlsx layout tweak is the portal's most dangerous failure: count>0 and warnings=[] so it passes every gate. Package QA only flags 'parsed 0 rows'; a muni parser pulling 12 offerings instead of ~80 ships green and reps quote off a half-missing book.
- **Sketch:** server/parser-baselines.js (pure, node-testable): given today's per-slot counts + a trailing window of prior counts (from the last ~10 publish audit entries or archive _*.json), compute a per-slot median and flag any slot whose count dropped >40% vs trailing median, or whose key-field coverage (% rows with non-null yield/CUSIP) fell below a floor. Surface as a 'parser-regression' statusCheck in buildGoLiveStatus, a flag column in Package QA, and a publish-response warning. Pure thresholds.
- **Surface:** server/parser-baselines.js (new pure module) + buildGoLiveStatus checks array + Package QA renderer.
- **Constraint:** Pure module + additive statusCheck + read-only QA column. No new dep, low blast radius.

#### `REL-2` Rep-facing data-health badge — ambient degraded-portal signal in the sidebar  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** The only health surface is buildGoLiveStatus — admin-gated and pull-only (you must open Upload to learn the package is 3 days stale, a market cache is dead, or the AI cache is from a prior package). A rep working the floor has no signal the data under them is stale, so they quote off it confidently.
- **Sketch:** GET /api/health/summary — a rep-safe subset of go-live (package date==today?, parser-regression flag, market cache dead?, AI cache stale-for-package?) returning {state, reasons:[...]}. A colored dot + count badge at the bottom of the sidebar, refreshed off the existing setupLivePolling 3-min cadence; click opens a popover of human-readable reasons, each deep-linking via data-goto. Non-admins see only rep-safe reasons; the full admin panel stays gated. Pure read. Supersedes the broader 'freshness rail' idea by carving the rep-safe subset directly.
- **Surface:** New /api/health/summary (reuses buildGoLiveStatus internals, stripped to rep-safe fields) + sidebar badge in portal.js + setupLivePolling hook.
- **Constraint:** Read-only endpoint reusing existing aggregation. Must expose only rep-safe fields, keep the admin panel gated.

#### `REL-3` Shared freshness chip with a real STALE state on every explorer + dashboard  ·  S/med  ·  partial-extension — ⚡quick-win 🤖loop-safe
- **Problem:** Explorers show an 'Extracted h:mm' subtitle and the snapshot band shows desk/live as-of, but each page does its own thing and none turns RED when the data is actually stale. A rep on the Treasury Explorer during a holiday has no consistent cue they're looking at Friday's curve on a Tuesday — the exact failure the RV staleness-proofing was built to prevent, but only the dashboard got it.
- **Sketch:** A single shared renderFreshnessChip(asOf, {expectedDate, staleAfterHours}) helper in portal.js that classifies fresh/aging/stale against the package date + wall clock and renders a uniform chip (green 'as of today 9:14a' / amber 'yesterday' / red 'STALE - package is 3 days old'). Mount in the existing subtitle slots of each explorer (treasury/muni/agency/corp/MBS/CD) and the Sales Dashboard, fed by extractedAt/uploadedAt already in each slot JSON + the package date. One helper, no server change.
- **Surface:** New shared helper in portal.js + call sites in each explorer's subtitle render + Sales Dashboard header. Frontend only.
- **Constraint:** Pure frontend, reuses data already in each payload, no server change, no new dep. Lowest blast radius.

#### `REL-4` Self-checking SQLite backup + integrity tick for the irreplaceable stores  ·  M/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** bank-data.sqlite is re-importable, but bank-coverage.sqlite (the Salesforce-replacement work product), bank-strategies.sqlite, and swap-proposals.sqlite (sent proposals with frozen snapshots — compliance records) are irreplaceable rep work with no backup and no integrity story. A corrupt page or a network-share eviction mid-write could silently lose months of CRM history.
- **Sketch:** server/db-guardian.js using better-sqlite3's native db.backup(dest) (no new dep) + PRAGMA integrity_check. A weekly tick (clone the autoFdicSyncTick stamp-check pattern; FBBS_DB_BACKUP=0 disables) runs integrity_check on each CRM/swap/strategy DB and writes a timestamped consistent copy to data/bank-reports/_backups/<db>-YYYY-MM-DD.sqlite (rolling last N). integrity_check failures audited + a 'fail' statusCheck; last-backup-age >8d a 'warn'. CLI escape hatch scripts/backup-dbs.js.
- **Surface:** server/db-guardian.js + tick wiring alongside autoFdicSyncTick + 2 statusChecks in buildGoLiveStatus + scripts/backup-dbs.js.
- **Constraint:** Module + CLI are loop-safe; wiring the auto-tick cadence + retention sizing (disk volume of multiple copies, acceptable cadence for a compliance record) is an owner/IT call. Build the module + CLI loop-safely; defer the auto-tick to an owner.

#### `REL-5` Crash-safe rollback snapshots — TTL sweep + orphan detection for _publish_rollback_* dirs  ·  S/med  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** publishPackageFiles creates data/_publish_rollback_<pid>_<ts> before every publish and removes it only in the same process's finally. A SIGKILL or power loss mid-publish leaks the snapshot forever — and under iisnode a restarted worker has a new PID, so it never cleans the old one. Over months these full-package copies fill the volume, and a leaked snapshot is invisible evidence a publish was interrupted.
- **Sketch:** On startup and each autoPublishTick, scan DATA_DIR for _publish_rollback_* dirs older than a short TTL (e.g. 30 min) whose PID is not the current live process: log + audit ('rollback-orphan-detected', with the dir mtime) and rm it. Add the orphan count as a 'warn' statusCheck ('1 interrupted publish detected — verify today's package'). ~30 lines, fs-only, no new dep.
- **Surface:** snapshotCurrentPackageDir / publishPackageFiles + a sweep fn called from startup and autoPublishTick + 1 statusCheck.
- **Constraint:** fs-only sweep + additive statusCheck. Gate the sweep on TTL AND pid != process.pid so it never deletes a snapshot the current process is mid-publish on.

#### `REL-6` Graceful-degradation contract test — assert every consumer survives a missing/garbage slot  ·  M/high  ·  new — 🤖loop-safe
- **Problem:** CLAUDE.md repeatedly promises 'never throws / always backfills / degraded:true' but go-live-smoke seeds a happy synthetic package and asserts only the good path. There's no automated proof the portal degrades gracefully when a slot is missing, a PDF is unparseable, or an xlsx is truncated. A regression making loadSalesDashboard or an explorer throw on a missing mmd slot would ship green.
- **Sketch:** tests/degradation.test.js (plain node) driving the pure layers with broken inputs — empty candidate set, slot JSON with rows:[], a candidate missing yield/CUSIP, missing mmd curve, stale priorMap — asserting each returns a degraded-but-valid shape rather than throwing. Then extend go-live-smoke with a second boot seeding ONE corrupt slot, asserting the SPA shell + /api/sales-dashboard + explorers still return 200 with a degraded flag, not 500. Converts the prose guarantees into enforced contracts. No app code change.
- **Surface:** tests/degradation.test.js (chained into npm test) + a corrupt-slot scenario in scripts/go-live-smoke.js.
- **Constraint:** Test-only additions chained into the existing npm test / smoke chain, no app code change, no new dep.

#### `REL-7` Reliability ledger + automation-health on the go-live panel  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** Auto-publish, auto-FDIC-sync, and the three billable AI refreshes all write failure/skip audit entries, but nobody watches the audit log between go-live cuts. A folder-drop skipping on a slot collision for days, or an AI refresh failing every morning, only surfaces if an admin scrolls the raw Admin audit view.
- **Sketch:** Extend buildGoLiveStatus (already a 50-entry audit read) to scan a deeper recent window for failure/skip signatures (folder-auto-publish-skipped, *-refresh-failed, auto-FDIC errors), bucket by category over N days with per-category counts + last-occurrence + last error, and surface a 'Recent automation health' block on the #upload panel (rolls into the ok|warn|fail badge). Also expose a richer GET /api/admin/reliability-ledger card above the raw log. Reuses readAuditLog/readFileTail, no schema change. Optionally assert in go-live-smoke.
- **Surface:** buildGoLiveStatus additive audit-signature scan + the #upload go-live panel + new /api/admin/reliability-ledger card. Admin-gated.
- **Constraint:** Additive to admin-only functions already reading the audit tail; interprets signatures the system already writes; keep the deeper tail bounded so it stays cheap on a rotated multi-MB log.


### Compliance, audit & supervision
_Supervisory review gate, retention export, 2210 linter, audit integrity seals, supervision-coverage marker, AI provenance stamp — mostly compliance-owner-gated artifacts._

#### `CMP-1` Supervisory review gate on client-facing swap proposals (FINRA 3110)  ·  M/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** Reps freeze and 'send' client-facing swap proposals with no recorded principal sign-off. The send path goes draft->sent->executed entirely on the rep's own action; the audit row carries only the rep's username. There is no FINRA 3110 supervisory-review trail before a one-pager reaches a bank.
- **Sketch:** Insert a 'Pending Review' state between sent and executed in swap-store SWAP_STATUSES. On send, freeze the snapshot but hold execute behind an admin Approve/Return action from a new admin-gated #review-queue page. Add reviewed_by/reviewed_at/review_note + snapshot hash via a PRAGMA-guarded migration. Reuse swap-render for the read-only view, appendAuditLog ('swap-proposal-reviewed'), existing admin gating, a sidebar badge. No email.
- **Surface:** New admin-gated #review-queue page (Operations) + a review-state gate in swap-store send/execute and the server.js swap routes; SPA queue UI.
- **Constraint:** Roles stay Admin/Rep (principal maps to Admin). Owner decision: hard-gate-before-execute vs advisory, and whether Admin='registered principal' satisfies their WSPs. Changes the canonical send/execute path on the client-facing artifact — not safe unattended.

#### `CMP-2` Communications/CRM retention export (SEC 17a-4 / FINRA 4511)  ·  M/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** The CRM is becoming the system of record for rep-client communications as it replaces Salesforce. There is no scoped 'produce everything for this bank / rep / date range' export — including the compliance-correct soft-deleted activities with their deletion reason — for a regulatory request.
- **Sketch:** Streaming GET /api/admin/retention-export?bankId=|rep=|from=|to=&format=jsonl|csv emitting an ordered record: every bank_activities row INCLUDING soft-deleted ones (deleted_at/deleted_by/delete_reason), tasks, opportunity stage changes, contacts, plus matching audit.log lines for the scope. JSON-lines with a manifest header (scope, row counts, generated-at, SHA-256 of payload via Node crypto). Reuse querySqliteJson, audit-log helpers, fs.createReadStream. The soft-delete model is already compliance-shaped — this surfaces it.
- **Surface:** New admin-gated streaming export route reading bank-coverage-store + audit.log; small admin #retention page.
- **Constraint:** No new dep. The export format/fields must match the firm's books-and-records obligations; building the wrong shape is worse than nothing. Owner/compliance sign-off on the schema before build.

#### `CMP-3` Per-bank supervisory review marker + supervision-coverage report  ·  M/high  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** A desk principal must periodically review rep activity and document that the review happened (FINRA 3110). The portal holds all the raw activity but offers no place to record 'I reviewed bank X's rep activity through this date', so the supervision leaves no trail — the thing examiners test.
- **Sketch:** Add a 'supervisory-review' kind as a new system row-species in bank_activities (actor=admin username, body=review note, reviewed_through date), creatable ONLY by admins from the tear-sheet activity panel and the review queue. Render as a distinct timeline chip. Admin GET /api/reports/supervision-coverage lists per rep/bank last supervisory review vs last rep activity (the supervision analogue of cold-accounts) + a 'banks needing review' tile. Reuse the two-species activity table + recordManualActivity pattern.
- **Surface:** Tear-sheet activity panel (admin-only control) + supervision-coverage report in the admin Reports rail + new store helpers in bank-coverage-store.js.
- **Constraint:** Reuses the existing activity table additively; Admin=supervisor under the two-role model. But it creates a compliance evidence record whose meaning is defined by the firm's WSPs — owner/compliance must confirm the model first.

#### `CMP-4` FINRA 2210 language linter for rep-authored supervised text (coaching)  ·  M/med  ·  needs-owner-decision — 🔒owner-decision
- **Problem:** Reps type free text that can become supervised/client-facing communication: activity notes, opportunity descriptions, swap-proposal client notes, strategy bodies, talking points. FINRA 2210 forbids promissory/exaggerated language ('guaranteed', 'risk-free', 'will outperform'). There is no nudge today.
- **Sketch:** A pure node-testable UMD module public/js/modules/comms-lint.js (muni-tax.js / report-logic.js pattern) with a pinned hard/soft phrase ruleset returning {severity, span, ruleId, suggestion}. Wire inline as an amber under-field banner on supervised textareas; on swap send, run the same module server-side and attach hard-flag hits to the (proposed) review record. Coaching only, no blocking. Reuse the module-loading + frontend-parse.test.js compile coverage.
- **Surface:** New public/js/modules/comms-lint.js + inline hooks on supervised textareas in portal.js; optional server-side pass folded into swap send.
- **Constraint:** Pure JS, no dep. The phrase list is the load-bearing part and is a compliance/WSP artifact — must get one pass from the firm's compliance owner before go-live. A plausible-but-wrong list unattended is a net negative.

#### `CMP-5` Audit-log integrity panel + tamper-evident segment seals  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** data/audit.log is the firm's append-only event record. A supervisor can't confirm the chain is intact and un-gapped without grepping JSON-lines, and size-based rotation means a rolled segment could be edited with no detection.
- **Sketch:** Extend the existing Admin audit page with an integrity panel powered by GET /api/admin/audit-integrity: scan the active log + rotated segments, verify every line parses as JSON with a timestamp, report per-day event counts, flag time-ordering inversions / day gaps, and compute a SHA-256 'seal' per rotated segment (Node crypto) written into data/audit-seals.json at roll time in log-rotation.js. Per-segment green/amber/red badge = on-disk segment still matches its recorded seal. Reuse rotateFileIfNeeded (the single roll point), readFileTail, the existing Admin page.
- **Surface:** Admin page integrity panel + GET /api/admin/audit-integrity + a seal write inside log-rotation.js rotateFileIfNeeded.
- **Constraint:** crypto built-in, no dep. Read-only panel + additive write at the one rotation point; doesn't change logging/rotation behavior. Frame as tamper-evident (detects after-the-fact edits), not preventive.


### UX, search, navigation & accessibility
_Command palette with action verbs, cross-surface recents/pins, grid keyboard+a11y, density toggle, actionable empty-states, tablet-friendly tear sheet._

#### `UX-1` Command palette — extend the Cmd/Ctrl+K jump bar with ACTION verbs + overlay  ·  M/high  ·  partial-extension — 🤖loop-safe
- **Problem:** Reps live in the app all day but the fast paths are navigation-only. The jump bar does grouped global search but carries no action verbs (Log activity, New task, Create swap proposal, Refresh dashboard), so every common action means navigating to a page first.
- **Sketch:** The keyboard hook and arrow/Enter nav already exist (Cmd/Ctrl+K and bare '/' focus navSearchInput; activateJumpResult + arrow handling). Genuinely additive: (1) render the jump dropdown as a centered overlay when invoked by shortcut; (2) a second result species data-jump-kind='action' from a static const, ranked above fuzzy page matches when the query starts with a verb; (3) wire each action through existing functions/deep-links (pure-nav -> goTo; drawer -> openBuyersDrawer/openOfferingFitsDrawer; 'Log Activity' navigates to a bank first since it renders inside the tear sheet).
- **Surface:** Header jump bar / overlay (index.html shell + portal.js setupNavSearch/activateJumpResult/keydown).
- **Constraint:** Frontend-only, additive; reuses existing buildGlobalSearch/activateJumpResult and existing function openers.

#### `UX-2` Turn dead empty-states into actionable cards + Home 'Getting started' checklist  ·  M/high  ·  new — ⚡quick-win 🤖loop-safe
- **Problem:** The feature surface has grown faster than reps discover it (the explicit discoverability pain). Empty states are dead text — 'No client or prospect accounts yet', 'No open opportunities', My Work tiles that just say 'None.' — so a new rep sees a wall of empties and no next step.
- **Sketch:** Upgrade the centralized empty-state strings into cards: one sentence of what-this-is plus a primary button wired through existing data-goto plumbing (no-opportunities -> a tear-sheet Opportunities panel; cold-accounts tile -> 'Who should I call'). Add a dismissible Home 'Getting started' checklist (set my rep, open my coverage, log first activity, star a security) driven by data already in /api/me/work; each item self-checks, card auto-hides when complete, dismissal in localStorage. No new endpoints.
- **Surface:** Home + every empty-state renderer (portal.js, /api/me/work, data-goto).
- **Constraint:** Pure reuse of existing My Work data + data-goto; no server work, additive, low blast radius.

#### `UX-3` Generalize recent-banks into cross-surface Recent + Pinned navigation  ·  M/med  ·  partial-extension — 🤖loop-safe
- **Problem:** A rep bounces between tear sheets, the Sales Dashboard, and the swap builder dozens of times a day; every return is a fresh search or sidebar hunt. Recents exist (BANK_RECENT) but are banks-only and rendered only on Home.
- **Sketch:** Generalize the localStorage recent-banks pattern into a single 'fbbs.recent.v2' list pushed from existing navigation choke points (navigateToHash, goTo) recording {page,label,cusip?,bankId?,ts}, de-duped, capped ~12. Surface two ways with zero server work: (1) the jump bar / palette EMPTY-query state shows Recent + Pinned; (2) a collapsible 'Jump back in' strip under the sidebar header. Pinning is a star toggle to 'fbbs.pinned.v2'. Reuse the existing private-mode localStorage try/catch guards.
- **Surface:** Sidebar + jump-bar empty-state (portal.js goTo/navigateToHash, setupNavSearch, renderHomeRecents).
- **Constraint:** Pure client-side localStorage; reuses existing nav choke points.

#### `UX-4` Keyboard + screen-reader navigation for the data grids  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** The fast-scanning surfaces (All Offerings blotter, explorers, Reports results, CD recap) are mouse-only. A rep comparing dozens of offerings can't arrow through rows, can't Enter to deep-link the focused security, can't type a few chars to jump. It's also an accessibility gap.
- **Sketch:** One reusable gridKeyboard(tableEl) helper: ArrowUp/Down moves a [data-active] highlight via roving tabindex, Enter triggers the row's existing Open button (already data-goto/data-cusip), Home/End jump, debounced type-ahead matches first-cell text. Apply to All Offerings, explorers, Reports results. Add aria-rowindex + a single aria-live region announcing the focused row's issuer/yield. Port the arrow pattern already working in the jump dropdown.
- **Surface:** All Offerings / explorers / Reports grids (portal.js table renderers + new shared helper).
- **Constraint:** Additive helper layered on existing rendered tables; closes a real a11y gap without touching data or deployment.

#### `UX-5` Density toggle (Comfortable / Compact) for the blotter-heavy grids  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** The desk's core scan surfaces (All Offerings, explorers, Reports results, swap blotter, CD recap) ship one fixed row height/font. A trading desk wants more rows per screen; a shared tablet or older rep wants bigger. There's no toggle and the stylesheet hard-codes sizes everywhere.
- **Sketch:** Add a :root scale of vars (--cell-fs, --row-pad, --table-fs) and refactor ONLY the highest-traffic table blocks (All Offerings grid, explorer grids, report results, swap blotter) to consume them. A header toggle flips data-density='compact|comfortable' on <html>, persisted to localStorage; a few [data-density=compact] overrides shrink the vars. Default comfortable so nothing changes until opt-in.
- **Surface:** Global header control + scoped portal.css table blocks.
- **Constraint:** CSS/frontend-only, default-off. Effort risk: 957 font-size declarations in the 14800-line sheet — the refactor MUST be scoped to the named blocks, not swept globally, or it balloons.

#### `UX-6` Tablet-friendly tear sheet & Sales Workspace (coarse-pointer breakpoint)  ·  M/med  ·  new — 🤖loop-safe
- **Problem:** Reps visiting community banks want the tear sheet, Today's Fits, and Log Activity on a tablet, but those surfaces were built mouse-first. Existing breakpoints target phones; tap targets and drawer ergonomics on a ~768-1024px portrait tablet aren't tuned — type pills, contact pickers, inline stage selects are small and side drawers can exceed the viewport.
- **Sketch:** Add a coarse-pointer tablet band (@media (max-width:1024px) and (pointer:coarse)) that bumps Log Activity type pills, contact picker, and opportunity stage selects to >=44px; stacks the tear-sheet Status/Priority/Owner save row full-width; converts the action drawers (Today's Fits etc.) into full-height bottom-sheets on coarse pointers. Pure CSS, no JS logic change. Pairs with the density data-attribute hook.
- **Surface:** Bank tear sheet + Sales Workspace + action drawers (portal.css tear-sheet/drawer blocks).
- **Constraint:** CSS-only, additive responsive band (no pointer:coarse rules exist today). Verify on a real tablet before relying on it (no coarse-pointer test harness exists).
