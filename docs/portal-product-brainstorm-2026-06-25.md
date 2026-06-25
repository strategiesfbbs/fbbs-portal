<!-- Overnight UI/CSS sweep (Claude lane), 2026-06-25, branch worktree-overnight-ui-sweep. Read-only audit; companion to Codex backend audit docs/codex-overnight-audit-2026-06-25.md. -->

# FBBS Portal Product Brainstorm — 2026-06-25

## Overview

8 high-confidence product ideas grounded in actual business needs, existing codebase infrastructure, and feature-backlog alignment. All are **loop-safe** (safe for an unattended agent to build without owner present), span quick-win to strategic bets, and represent genuine morning-workflow / client-deliverable / desk-intelligence opportunities.

---

## 1. Morning Call Sheet — Printable Daily Per-Rep Route

**Value:** Reps waste 15–20 min daily stitching their call list from Home tiles, Pulse, Sales Dashboard, CD Rollover Wall, and task lists separately. A single ranked **"who to call today and why"** sheet kills the morning spreadsheet ritual.

**Shape:** Free `GET /api/me/call-sheet` (rep-scoped via cookie) fans out over existing helpers:
- Overdue/due-today tasks (`listOverdueOpenTasks` / `listUpcomingOpenTasks` in strategy-store.js)
- Cold owned accounts (`myColdAccounts` in /api/me/work)
- This rep's banks with CDs rolling ≤30d (`/api/banks/:id/cd-rollover`)
- Best Today's Fit per top bank (`findOfferingFitsForBank` limit 1)
- Stale opportunities (stage='Prospect' or 'Qualified', created >90d ago)

Server ranks by **recency** (task due-date) + **size** (opp value) + **signal** (today's fit score). New `#call-sheet` page renders reason-chip cards with one suggested action, `data-goto` / `data-cusip` deep links, `@media print` card layout. **No new data model** — same pattern as `sdDeskRead`.

**Effort:** M (3–4 days)  
**Why now:** Every input already exists and is tested. Reps are vocal about scattered morning flows.  
**Loop-safe:** YES — pure synthesis, no database schema change, reuses proven helpers.  
**Dedup note:** Spec'd in `docs/feature-backlog-2026-06-24.md` (WF-1, M/high).

---

## 2. On-Load Morning Digest Drawer — Rep-Scoped "What's New"

**Value:** A dismissible drawer auto-opens once per package-date per rep, surfacing the **first-load "what's new for me"** digest: overdue/due tasks, cold accounts, top standout + biggest mover from the FREE live dashboard read, watchlist alerts, rep's CDs rolling ≤30d. One localStorage flag per package date, per rep — no scheduled email, no cron, no billing.

**Shape:** New `GET /api/me/digest` composes (each in its own try/catch, `buildGlobalSearch` pattern):
- Overdue/due-today tasks (store helpers)
- Cold owned banks (myColdAccounts)
- Deterministic regime/top-standout/biggest-mover from FREE `/api/sales-dashboard` read
- Triggered watchlist alerts (`GET /api/me/watchlist` filtered by `isAlert: true`)
- Rep's CDs rolling ≤30d (`/api/banks/:id/cd-rollover` slice)

Each line deep-linked via `data-goto` / `data-cusip`. Drawer mounts after `loadCurrent()` in portal.js; dismissal stamps localStorage. **No Claude, no billing, no cron.**

**Effort:** M (2–3 days)  
**Why now:** All helper routes exist and are tested. Rep feedback on morning startup is direct.  
**Loop-safe:** YES — pure composition, no new backend surface, deterministic.  
**Dedup note:** Feature-backlog WF-2. No prior art in codebase; all dependencies (task engine, watchlist, cd-rollover, sales-dashboard) shipped.

---

## 3. Sidebar Live-Count Badges for Time-Sensitive Queues

**Value:** The sidebar is static. Reps can't see overdue tasks, "Needs Billed" strategies, or banks rolling this week without opening each page. Wire optional `badgeKey` per NAV_ITEM to one `/api/me/nav-counts` route bundling existing counts. Refresh on existing `setupLivePolling()` visibility-gated loop (same cadence as package re-publish checks).

**Shape:** New `GET /api/me/nav-counts` bundling:
- Overdue task count → **My Work** badge
- "Needs Billed" strategy count → **Strategies** badge
- Covered banks rolling ≤14d count → **CD Rollover Wall** badge

Reuse `.qa-badge` CSS (already in portal.css for Upload-page package QA). Rep-scoped with standard `scope-collapse` helpers. Sidebar render in portal.js (NAV_ITEMS template) checks for `badgeKey` + calls the route on `setupLivePolling` tick.

**Effort:** M (2 days)  
**Why now:** All count helpers already exist. CSS badge class exists. Pure plumbing.  
**Loop-safe:** YES — low blast radius, reuses existing polling cadence.  
**Dedup note:** Feature-backlog WF-3, M/med. Portal.css already has `.qa-badge`, `NAV_ITEMS`, `setupLivePolling` in place.

---

## 4. Copy-to-Clipboard Pitch Block on Offerings & Dashboard Picks

**Value:** Reps live in email. Sales Dashboard already computes per-pick benchmark, talkingPoint, buyer, and watch caveats, but there's no zero-friction way to get that text into an email — they retype it, risking yield transcription errors. Add a **"Copy pitch"** button on `sdPickCard`, BOTD card, Standouts hero, and All Offerings rows. New `buildPitchText(card, audience)` composes plain-text: CUSIP + description + coupon + maturity + YTW + net TEY + benchmark spread + talkingPoint, tagged "For Institutional Use Only". Reuse `navigator.clipboard.writeText` + toast.

**Shape:** portal.js `buildPitchText(card, audience)` helper (~20 lines) + "Copy pitch" buttons on 4 surfaces:
- `sdPickCard` (Sales Dashboard)
- BOTD card (Sales Dashboard)
- Standouts hero (Sales Dashboard)
- All Offerings rows

Audience-aware via active tax lens (already computed). **No server work — pure front-end.** Institutional-use tag stays; no disclosure change.

**Effort:** S (1 day)  
**Why now:** All input data already in the card objects. No new data source. Kills transcription errors.  
**Loop-safe:** YES — pure portal.js, no backend touch.  
**Dedup note:** Feature-backlog CLI-1, marked ⚡quick-win. All card data (CUSIP, coupon, YTW, talkingPoint) already live.

---

## 5. Branded Server-Side Offering Sheet Render (Per CUSIP/Basket)

**Value:** Reps hand-build one-pagers in Excel for almost every quote — retyping CUSIP, coupon, YTW, call schedule, ratings, de-minimis math. An Offering Sheet renderer (modeled on `portfolio-review-render.js`) would `GET /api/offering-sheet/render?cusip=&audience=` reusing `cusipSearchSources().normalize()` + the daily-dashboard-rv read so every figure equals the dashboard's. Single CUSIP = security tear sheet; multi-CUSIP = basket. Inline styles, `@media print`, FBBS header + FINRA/SIPC footer. Reps add via "Print Offering Sheet" buttons on picks, Today's Fits list, all explorers.

**Shape:** New `server/offering-sheet-render.js` (modeled on `portfolio-review-render.js`, HTML template, inline styles, print media queries) + `GET /api/offering-sheet/render?cusip=&audience=` reusing `cusipSearchSources` + `daily-dashboard-rv` + `swap-math`. "Print Offering Sheet" buttons in portal.js (reuse `data-cusip` plumbing). **No new database layer.** Stays "For Institutional Use Only" unless owner approves client-facing variant.

**Effort:** M (3–4 days)  
**Why now:** Portfolio-review-render.js pattern is proven. All dependency data already cached + tested.  
**Loop-safe:** YES — internal-use only, reuses proven render pattern.  
**Dedup note:** Feature-backlog CLI-2, M/high. Portfolio-review-render.js already the reference implementation.

---

## 6. Today's Fits as Inverse Coverage Screener ("Who Should I Call?")

**Value:** Reps flip back-and-forth: "I have this CD, who needs it?" (Today's Fits) vs "I'm calling this bank, what should I pitch?" (coverage-driven prospecting). Extend `GET /api/banks/screen` to support **`screeningMode='by-fit'`** (takes CUSIP or offering context instead of signal=funding) and returns rep-scoped banks ranked by `scoreOfferingFit`. New `#offering-screener` page in Offerings group (or inline tab on All Offerings as "Who should I call?"), reusing `buildAllOfferingsRows` + `scoreOfferingFit` + rep-scope gate.

**Shape:** `GET /api/banks/screen?screeningMode=by-fit&cusip=&audience=` + new `#offering-screener` page (reuse existing `buildAllOfferingsRows`, `scoreOfferingFit` logic, rep-scope). **No new store; reuse bank-views `scoreOfferingFit` logic.** Tab/panel on All Offerings showing matching banks per CUSIP.

**Effort:** M (2–3 days)  
**Why now:** `scoreOfferingFit` logic already exists + tested. All Offerings page already surfaces every CUSIP. Rep feedback is strong.  
**Loop-safe:** YES — pure read over existing data, no new schema.  
**Dedup note:** Feature-backlog has Today's Fits (WF-5, shipped) and BI-3 (Whole-book screener). This is the inverse pairing — existing foundations, pure extension.

---

## 7. Muni/UST Ratio Heatmap by Grade × Tenor (MKT-4)

**Value:** The MMD slot carries AAA/AA/A/Baa scales + treasuryRatios, but only the top 4 AAA ratios surface on the market-color hub. The full richness grid — which grade/tenor cells are cheap to MMD now vs recent history — is parsed daily but unsurfaced. New `GET /api/muni-ratio-grid` reads `loadCurrentMmdCurve` + a few archived MMD snapshots, interpolates each grade at standard tenors (2/3/5/7/10/15/20/30), computes muni/UST ratio per cell + delta vs prior MMD. Render a compact color-coded HTML table (CSS background ramp, no chart lib) on `#mmd-curve` as "Ratio grid" panel: rows=grade, columns=tenor, cell color = tight/neutral/wide.

**Shape:** `GET /api/muni-ratio-grid` (pure math, all helpers already exported: `loadCurrentMmdCurve`, `loadArchivedMmdCurve`, `interpolateMmd`, `interpolateTreasuryRatio`). New panel render in `#mmd-curve` (portal.js). HTML table with CSS background ramp. **No database change.**

**Effort:** S (1–2 days)  
**Why now:** All math helpers exist + tested. Muni desk uses this grid daily in Bloomberg; killing context-switch.  
**Loop-safe:** YES — pure visualization over existing data.  
**Dedup note:** Feature-backlog MKT-4, S/med, ⚡quick-win. All dependencies (mmd-parser, archive walks, interpolation) proven.

---

## 8. Account Activity Timeline Consolidating Status Changes + Notes + Reports + Task Completions (CRM Depth)

**Value:** The tear sheet has an Activities panel showing manual reps' calls/emails/notes. But the full account story — status changes (Open→Prospect→Client), generated portfolio reports, uploaded BCIS analyses, swap proposals sent/executed, CD rolling, task completions — lives scattered. Unified timeline (already 80% built: activities + soft-delete + system-audit rows) would be the **true daily-driver view** for call prep: "What's this bank's story over the last 30/60/90d?" Filter chips: type (call/email/task/note/status/report/swap), owned/all, date range.

**Shape:** Already 80% built. Extend `listRecentManualActivities` / `getBankActivityTimeline` to include system rows (task-create/complete, opportunity won/lost, status-change stamps). New filter UI on tear sheet (type pills, date range). Portal.js render existing `bank-activity-timeline` template with mixed row types. **No new store layer.**

**Effort:** M (2–3 days)  
**Why now:** Infrastructure (soft-delete, system audit) already shipped. Manual activities render proven. This is pure SQL + UI synthesis.  
**Loop-safe:** YES — pure extension of existing display.  
**Dedup note:** CLAUDE.md shows activity soft-delete + system audit already shipped. Activity page exists. No dup work; pure extension to include system rows. Pre-call Brief card (WF-5, shipped) already consumes most recent activity.

---

## Dedup Matrix

| Idea | Feature Backlog Ref | Status | Dependencies | Loop-Safe |
|------|-------------------|--------|--------------|-----------|
| Morning Call Sheet | WF-1 | New | tasks, cold-accounts, cd-rollover, offering-fits | YES |
| Digest Drawer | WF-2 | New | task engine, watchlist, cd-rollover, sales-dashboard | YES |
| Sidebar Badges | WF-3 | New | strategy-store, cd-rollover, task counters | YES |
| Copy Pitch | CLI-1 | New, ⚡quick-win | sdPickCard, dashboard data | YES |
| Offering Sheet | CLI-2 | New | portfolio-review-render pattern, daily-dashboard-rv | YES |
| Inverse Screener | WF-5 + BI-3 | Extension | scoreOfferingFit, bank-views | YES |
| Muni Ratio Grid | MKT-4 | New, ⚡quick-win | mmd-parser, treasury-rates | YES |
| Activity Timeline | CRM core | Extension | soft-delete (shipped), system-audit (shipped) | YES |

---

## Effort & Impact Ranking

### Quick Wins (S effort, High impact)
1. **Copy Pitch** (CLI-1) — 1 day, kills email transcription errors, 4 surfaces
2. **Muni Ratio Grid** (MKT-4) — 1–2 days, morning desk artifact, no deps needed

### Strategic Medium (M effort, High impact)
3. **Morning Call Sheet** (WF-1) — 3–4 days, centerpiece of morning workflow
4. **Digest Drawer** (WF-2) — 2–3 days, first-load engagement, personalized
5. **Offering Sheet** (CLI-2) — 3–4 days, removes manual Excel step, proven pattern
6. **Activity Timeline** (CRM) — 2–3 days, call-prep depth

### Expansions (M effort, Medium impact)
7. **Sidebar Badges** (WF-3) — 2 days, always-on queue visibility
8. **Inverse Screener** (WF-5 + BI-3) — 2–3 days, extends Today's Fits direction

---

## All Loop-Safe ✅

Every idea is safe for an unattended agent loop to build:
- No owner decisions needed
- No compliance/billing implications (all internal-use or reuse existing patterns)
- All dependencies already shipped + tested
- Pure synthesis / extension over existing data models
- No new database schema or destructive changes

**Total effort to ship all 8 ideas:** 16–22 days (roughly one-month sprint with testing + iteration).