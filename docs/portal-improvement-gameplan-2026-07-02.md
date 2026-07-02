# Portal Improvement Game Plan — 2026-07-02 (morning review)

Product of the 2026-07-01 full-portal review: 13 parallel review lanes produced **142
code-grounded findings** (6 critical, 35 major, 68 minor, 33 polish) plus 63 roadmap
items. Overnight, **~120 of the findings were fixed** across 11 implementation batches
plus a hand-finished tail (see "What shipped" below); this doc is the curated plan for
everything that should NOT be rushed — for owner review and prioritization.

Everything here is deduped against `docs/feature-backlog-2026-06-24.md`,
`docs/portal-review-followups-2026-06-28.md`, `docs/salesforce-decommission-gap-2026-06-28.md`,
and the 2026-06-30 internal audit.

---

## What shipped overnight (context for the plan)

- **All 6 criticals fixed** (3 by Codex, 3 by the batch fleet): dead "Follow-up due"
  task creation, rep-scoped Pulse Recent Activity querying after a firm-wide LIMIT,
  Save View silently overwriting the last-opened saved report, AFS/HTM shares always
  printing 100%, THC snake_case module statuses dropped on import.
- **~30 majors fixed**, including: typo-search no longer wipes the open tear sheet;
  browser Back works across sidebar navigation; the signal strip now shows on the
  tear sheet's default tab; the coverage Save button gets a real dirty state; Won/Lost
  needs a confirm; DNC/opt-out flags are editable in the UI and DNC contacts can't be
  hard-deleted; saved reports carry Created By + ownership guards server-side; the
  SF **Trade History panel is live on the tear sheet** (empty until the import runs);
  Pulse gained an admin Me/Firm toggle and a My Pipeline work list; the map refreshes
  after coverage saves and its legend counts follow the active territory filters;
  Market Color auto-refreshes, links headlines out, and can't blank its cache on a
  bad RSS parse; the desk-vs-live market-snapshot band is remounted on Sales Dashboard.
- **Fragility pass**: request-sequence tokens on bank search / tax lens / rollover /
  maturity / contacts; catch-path guards that were blanking the wrong bank's panels;
  guarded localStorage reads; escapeHtml on explorer filter options.
- **CSS/a11y pass**: 6 undefined tokens defined; `--text3` lifted to AA contrast
  (~242 declarations); `--warn-*` tokens; focus-visible rings on Home tiles and
  saved-view rows; print output drops blank CRM forms and duplicate THC panels;
  reduced-motion coverage; rep picker no longer vanishes at 901–1100px.
- `npm test` fully green; live preview verified (console clean, tokens live,
  behaviors spot-tested).

**Deliberately NOT fixed (still open, by design):** SF product-fit flag backfill
(needs the real 240-column extract to validate the mapping); peer-cohort switch
re-render refactor; a pipeline *report type* in the Reports workspace (Pulse list
shipped instead); the two orphaned page templates (`cd-internal`, `treasuryNotes` —
owner call: link from Package QA or delete); full contact soft-delete parity.

---

## Tier 1 — Do next (high value, unblocked, days not weeks)

1. **Run the Salesforce Trades migration end-to-end.** The portal side is done: store,
   route, tests, and (as of tonight) the tear-sheet Trade History panel. What's missing
   is the data: pull the **Trade__c extract** (139,352 rows — NOT in the current 5-file
   export), validate 18-char IDs as join keys, run `scripts/import-trade-export.js`.
   This is the decommission's "point of no return" item. (Owner: needs SF org access.)
2. **Banks landing → master-detail "My Coverage" workspace.** Phase 2 of the banks
   facelift (planned 2026-06-27, owner-gated then; the search/views groundwork from
   tonight — restore bar, non-destructive search, faster views — feeds it). Left rail =
   rep's book sorted by stale-touch/tasks/pipeline; right = the existing tear sheet.
3. **Composite tear-sheet hydration + timeline v2.** Opening a bank fires ~10 requests;
   the timeline/last-touch logic still reads one 50-row window (tonight's server-side
   `lastManualTouch` patched the worst symptom). One `GET /api/banks/:id/workspace`
   endpoint + server-side timeline filtering/paging kills the whole bug class and makes
   the tear sheet feel instant.
4. **One responsive data-table component + sort affordance.** The two biggest items
   held from 06-28 for Codex's All Offerings workbench — the workbench landed 06-25,
   so this is unblocked. One `.data-table-responsive` wrapper (sticky identity column,
   card fallback <900px) rolled across every grid, plus the shared sorted-header
   caret/aria-sort helper.
5. **Shared freshness/stale-badge component.** One `freshnessStamp()` chip standardizing
   "Updated/As of/COB/File dated" across explorers, Exec Summary, MBS/CMO — reusing the
   `market-snapshot.js` `{asOf: {desk, live}}` contract. Kills the most-cited
   cross-surface confusion.

## Tier 2 — Salesforce decommission blockers (need owner/Codex coordination)

6. **Reverse-engineer the 7 SF Flows** (Trade→Account rollups, Pershing delete-cascade,
   Strategies intake, Task email alert, Account-Team sync). Silent-logic loss on cancel.
   Needs a read-only SF session to document each Flow, then re-implement portal-side.
7. **Product-fit/service flag backfill** from the SF ACCOUNT extract's checkboxes into
   the portal services fields (additive import plan, dry-run-first). Held tonight only
   because the column mapping must be validated against the real extract.
8. **Email/calendar capture decision.** SF auto-logged ~26K tasks/events via Exchange;
   the portal is manual-only. The memo (`docs/email-calendar-capture-memo-2026-06-28.md`)
   frames build-vs-accept-loss. Decide consciously before cutover.
9. **Rebuild the ~5 load-bearing SF reports** as first-class portal report types —
   including a Pipeline report type in the Reports workspace (route exists, rep-scoped,
   currently only surfaced on Pulse).

## Tier 3 — High-value product bets (sequence after Tiers 1–2)

10. **Per-bank "next best action" queue.** Evolve the signal strip into a ranked agenda
    (overdue task → CD-rollover call cue → best Today's Fit → stale-touch nudge), each
    with its one-click action inline. The chips + data all exist.
11. **Pipeline workspace v2.** Kanban-by-stage, edit-everything, close-reason capture,
    per-rep manager rollups, stage-aging (stage_changed_at already stamped).
12. **THC v2 (Codex-coordinated contract change).** Structured `tradeSimulation.impact`
    units fix, `nextCycleDue`, peer percentiles, EVE/NII CSS ladder mini-bars with
    policy markers, cycle-history archive for "your EVE sensitivity is rising" trend,
    and the trade-sim → Bond Swap proposal handoff.
13. **Morning Call Sheet / unified Today queue** (`WF-1` in the backlog). One dense band
    replacing the seven overlapping My Work tiles: tasks + rollovers + fits + movers.
14. **Home density pass.** Below My Work, Home is still landing-page shaped (sticky
    scroll showcase). Replace with the operational daily brief.
15. **Map: saved territories + corridor prospecting.** Persist map filter state in the
    hash/saved views; "I'm driving St. Louis → Springfield Thursday — build my call
    sheet" routing on top of the radius search.
16. **Trade-data intelligence** (from the 06-30 audit ideas, now that `pershing_trades`
    is real): CUSIP Flow Radar ("who else traded this bond"), rep activity scorecard
    (logged CRM activity vs actual trades — a FINRA angle), trade-velocity "going
    quiet" signal, FINRA 2121 price-reasonableness spot-check vs archived benchmarks.

## Tier 4 — Platform hygiene (schedule as dedicated passes)

17. **Unified fetch-lifecycle helper** (token + abort + loading/error states) — tonight
    added the 4th and 5th hand-rolled race-guard patterns; consolidate before more drift.
    Pair with **escape-by-default HTML templating** (1,377 manual escapeHtml sites) and
    **centralized acting-rep invalidation** (setRepOverride's manual list has drifted twice).
18. **server.js router extraction + shared validation layer** (~13.4K lines now).
    Deliberately deferred high-churn refactor — coordinate with Codex first.
19. **CSS debt:** dead-CSS prune (retired Coverage Workspace, mc-reader, etc.), component
    consolidation (~14 table systems), semantic status-token re-theme — **blocked on the
    official FBBS palette the owner was uploading week of 2026-06-30.**
20. **portal.js modularization continuation** (~29K lines; `public/js/modules/` pattern).
21. **Audit log v2** (event catalog, queryable admin surface, retention) + a **rep-scope
    contract test matrix** over every rollup endpoint.
22. **Docs drift cleanup:** CLAUDE.md still says SLOT_NAMES has twelve keys (it has 11),
    documents the deleted uploaded-HTML dashboard slot/iframe and `offerings-pick.js`,
    and omits `market-snapshot-title.js` as a 4th billable AI consumer.

## Owner decisions queued (quick answers unblock work)

- **Palette:** upload the official FBBS colors → unlocks Tier 4 #19 and the amber/green
  token migrations.
- **Orphaned templates** (`cd-internal`, `treasuryNotes`): link them from Package QA or
  delete them?
- **SF org access** for the Trades extract + Flow documentation (Tier 1 #1, Tier 2 #6).
- **Pardot/Einstein:** confirm whether nurture email is actually used (gap doc #3).
- **Pulse "Open strategies" definition:** tonight both Home and Pulse count
  Open + In Progress + **Needs Billed** — confirm that's the desk's definition.
