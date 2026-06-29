# FBBS Portal Navigation + Workspace Redesign Spec - 2026-06-26

This is the coordination spec for the portal's next structural UX track. It is
separate from the CSS facelift in `ui-ux-facelift-plan-2026-06-25.md`, which is
intentionally CSS-only or minimal markup. This track may touch `public/index.html`,
`public/js/portal.js`, and `public/css/portal.css`, so it should be sequenced
carefully and not mixed into facelift cleanup.

## Goal

Make the portal feel like a natural daily workspace instead of a set of stacked
document pages. The desk should be able to start from a bank, offering, market
headline, strategy request, or search result and immediately see the related
context and next action.

The product direction is workflow-first:

- Today: what changed, what matters, who needs attention.
- Markets and offerings: what is available, why it is attractive, who should be
  called.
- Banks and coverage: who owns the relationship, what signals are active, what
  should happen next.
- Work queues: what is open, blocked, completed, or needs billing.
- Operations: package/admin tools that remain hidden or gated when appropriate.

## Non-Goals

- Do not merge this into the current visual facelift branch/work.
- Do not break existing hash routes or saved bookmarks.
- Do not remove raw document access; move it behind contextual links when the
  replacement page is ready.
- Do not add app-level auth or per-rep permissioning as part of this redesign.
- Do not add new third-party dependencies for layout or navigation.
- Do not rebuild all pages at once.

## Current Constraints

- `VALID_PAGES` and `NAV_ITEMS` live in `public/js/portal.js`.
- The sidebar markup is currently static in `public/index.html`.
- `NAV_GROUP_BY_PAGE` separately maps routes to sidebar groups.
- Several operations pages are admin-gated or admin-oriented and should not be
  made more prominent for ordinary reps.
- The portal is used on ordinary 1366px-class office laptops; a permanent
  three-column layout plus the fixed sidebar will be cramped at that width.
- Existing pages rely heavily on `innerHTML` rendering. Context rails require
  careful selected-row state, event delegation, and caching.

## Route Preservation Contract

Every existing route in `VALID_PAGES` must continue to resolve:

`#home`, `#exec-summary`, `#daily-intelligence`, `#pulse`, `#econ`,
`#relativeValue`, `#mmd`, `#treasuryNotes`, `#cd`, `#cdoffers`,
`#munioffers`, `#sales-dashboard`, `#all-offerings`, `#watchlist`,
`#treasury-explorer`, `#cd-recap`, `#cd-internal`, `#explorer`,
`#muni-explorer`, `#agencies`, `#corporates`, `#mbs-cmo`,
`#structured-notes`, `#market-color`, `#banks`, `#contacts`, `#maps`,
`#reports`, `#peer-groups`, `#maturity-calendar`, `#cd-rollover`,
`#strategies`, `#bond-swap`, `#views`, `#archive`, `#upload`, `#package-qa`,
and `#admin`.

Navigation labels and group names may change. Route IDs should not change in
this track unless a compatibility alias is added first.

This route list has been verified against `VALID_PAGES` in `public/js/portal.js`
as of 2026-06-26. During Step 1, add a small frontend test assertion that the
route-preservation set and `VALID_PAGES` stay aligned, so future page additions
cannot silently drift from this contract.

Existing deep-link forms must continue to resolve too. This includes search and
selection seeding such as `?q=`, CUSIP-driven `data-cusip` navigation, archive
date routes, `?rep=all`, saved report autorun hashes, and any existing
page-specific query state. Step 2 is especially sensitive because the All
Offerings workbench must preserve CUSIP/search seeding and native explorer
deep links.

### Routed But Intentionally Off-Sidebar

These routes are part of the preservation contract but should not be forced into
the primary sidebar during Step 1:

| Route | Current access pattern | Notes |
| --- | --- | --- |
| `#econ` | Documents/current package link or direct hash | Raw Economic Update PDF viewer. |
| `#relativeValue` | Documents/current package link or direct hash | Raw Relative Value viewer. |
| `#treasuryNotes` | Documents/current package link or direct hash | Raw Treasury Notes workbook viewer path. |
| `#cdoffers` | Documents/current package link, jump search, or direct hash | Raw Daily CD Offerings PDF. Later should live as a contextual "View raw PDF" link from CD pages. |
| `#munioffers` | Documents/current package link, jump search, or direct hash | Raw muni offerings PDF. Later should live as a contextual "View raw PDF" link from Muni Explorer. |
| `#cd-internal` | Direct/internal deep link | Internal CD master path; preserve route even if it stays out of nav and jump search. |

### Retired Route

`#signals` / Signal Inbox is intentionally retired. Its useful account cues now
belong in Home/My Work, CRM Pulse, the tear-sheet Sales Workspace signals strip,
CD Rollover Wall, Saved Views, and future context rails. Do not add `#signals`
back to `VALID_PAGES` or the sidebar without a new product decision.

## Proposed Sidebar Map

This is the target information architecture. It is a grouping change first, not
a route rewrite.

| Group | Pages | Notes |
| --- | --- | --- |
| Today | Home, Daily Intelligence, CRM Pulse, Sales Dashboard, Market Color, MMD Curve | Renames the current broad "FBBS" drawer into a workflow-oriented morning group. Long term, these pages may converge, but do not force that in the nav pass. |
| Markets & Offerings | All Offerings, My Watchlist, Treasury Explorer, CD Explorer, Muni Explorer, Agency Explorer, Corporate Explorer, MBS/CMO Explorer, Structured Notes, Brokered CD Sheet, Weekly CD Recap | Keeps All Offerings as the primary entry point. Raw PDFs move to contextual "View raw PDF" links later, not as a first nav change. |
| Banks & Coverage | Bank Tear Sheets, Contacts, Saved Views, Reports, Peer Groups, Maturity Calendar, CD Rollover Wall, Map | Makes coverage work one coherent area. The standalone Map link should fold into this group. |
| Work Queues | Strategies Queue, Bond Swap | Later can add filtered queue links or badges, but "Needs Billed" should remain a Strategies filter/status, not a separate top-level route. |
| Operations | Upload, Package QA, Archive, Exec Summary, Admin | Keep admin-gated visibility behavior. Do not make management/admin pages louder for reps. |

## Sidebar Source of Truth

The current portal has multiple navigation structures that can drift:

- Static sidebar markup in `public/index.html`.
- `NAV_ITEMS` in `public/js/portal.js`, used by jump search.
- `NAV_GROUP_BY_PAGE` in `public/js/portal.js`, used for active-group expansion.
- Route handling through `VALID_PAGES`.

Step 1 should still be a contained nav reorg, but it must update these structures
together and make `NAV_GROUP_BY_PAGE` complete for every page that lives inside a
collapsible group.

Because rendering the full sidebar from `NAV_ITEMS` is a larger behavior change,
do not hide it as an "open question." Schedule it explicitly:

- **Step 1:** hand-align static sidebar markup, `NAV_ITEMS`, and
  `NAV_GROUP_BY_PAGE` for the new group map.
- **Step 1.5:** decide and implement sidebar source-of-truth unification before
  the pattern spreads to several redesigned pages. Preferred end state: sidebar
  labels/groups are generated from one data source, with route preservation and
  admin visibility checks covered by tests or a manual QA checklist.

## Workspace Layout Primitive

Introduce one reusable workspace primitive before redesigning individual pages:

```text
.workspace-3col
  .workspace-filter-rail
  .workspace-main
  .workspace-context-rail
```

Expected behavior:

- Desktop wide: filter rail, main table/list, context rail visible.
- Standard laptop: filter rail may compress; context rail may remain narrow only
  if content still fits cleanly.
- Below roughly 1200px: context rail becomes a slide-over drawer.
- Mobile/tablet: filters and context rail are drawers; main content remains the
  primary screen.
- Selection state persists in `sessionStorage` where useful, following the
  existing `bankTearSheetTab` pattern.

The primitive should be page-neutral. Avoid one-off grid systems for All
Offerings, Market Color, Strategies, and Reports.

## Context Rail Contract

The context rail is an assembly layer over existing portal data. It should not
be a new intelligence engine.

Base states:

- Empty: no row selected; explain the next action in one short line.
- Loading: selected entity known; related context is loading.
- Ready: compact summary, related data, and action buttons.
- Partial: show available context and a small warning if one source fails.
- Error: scoped to the rail; never break the main table/list.

Suggested helper:

```text
mountContextRail({
  page,
  entityType,
  entityId,
  seed,
  loaders,
  actions
})
```

Implementation notes:

- Debounce selection changes.
- Cache rail payloads by `page + entityType + entityId`.
- Abort or ignore stale requests when the user arrow-clicks through rows.
- Never fire several endpoint calls for every hover; use click/keyboard
  selection as the activation event.
- Keep action buttons grounded in existing workflows: open tear sheet, open
  native explorer, add watchlist item, create opportunity, log activity, export.

## Existing Data to Reuse

Use the existing plumbing before adding endpoints:

- Global search: `GET /api/search/global`.
- CUSIP search/deep links: `GET /api/search/cusip` plus existing
  `data-goto` / `data-cusip` handling.
- All Offerings inventory: `GET /api/offerings/all`.
- Watchlist: `GET/POST/DELETE /api/me/watchlist`.
- Bank-specific fits: `GET /api/banks/:id/offering-fits`.
- CD rollover: `GET /api/cd-rollover-wall` and `GET /api/banks/:id/cd-rollover`.
- CRM dashboard / Pulse data: `GET /api/crm/dashboard`.
- Bank tasks and opportunities: existing bank task/opportunity routes.
- Recent banks: local persisted recent-bank storage in the SPA.

Likely new read endpoint for Step 2:

- Offering-to-bank matches for a selected offering/CUSIP. This should reuse the
  same scoring concepts as Today's Fits rather than inventing a separate model.
  Concretely, this is the inverse of the existing
  `findOfferingFitsForBank()` / `scoreCoverageBankForOffering` flow: loop the
  same scorer over the covered-bank set for one selected offering.

## Page Rollout Plan

### Step 0 - Spec and Coordination

This document. No behavior changes.

Hand Claude this document for review before Step 1 if Claude is actively working
in `public/index.html`, `public/js/portal.js`, or `public/css/portal.css`.

### Step 1 - Sidebar Reorg

Scope:

- Rename/reorder sidebar groups around the proposed map.
- Keep all existing `#page` hashes working.
- Keep existing query-param, date, CUSIP, and saved-report deep links working.
- Keep admin/operations visibility behavior unchanged.
- Keep raw document pages reachable, even if removed from the primary sidebar
  later.
- Update `NAV_ITEMS`, `NAV_GROUP_BY_PAGE`, and static sidebar markup together.
- Make `NAV_GROUP_BY_PAGE` complete for every page inside a collapsible group.
- Add a small route-preservation test assertion against `VALID_PAGES`.

Avoid:

- Context rail work.
- Page redesigns.
- Command palette.
- New endpoints.

Validation:

- `npm test`.
- Manual route smoke: click each sidebar group and representative links.
- Global jump search still resolves old and new labels.
- Deep links still seed search/selection state, especially CUSIP and `?q=`
  paths.
- Admin-gated items and admin-only behaviors stay hidden for a non-admin rep.

### Step 1.5 - Sidebar Source-of-Truth Unification

Status: implemented in `public/js/portal.js` as `NAV_GROUPS` plus
`NAV_OFF_SIDEBAR_ITEMS`. The static sidebar in `public/index.html` is now only a
mount point, and the visible sidebar, jump search items, and active-group route
map derive from the same nav model.

Scope:

- Decide whether the sidebar should be generated from `NAV_ITEMS` or from a
  new small nav model that also feeds jump search.
- Remove or reduce duplicated group metadata so static markup, jump search, and
  active-group expansion do not drift.
- Keep all Step 1 route, deep-link, and admin visibility guarantees.

This should happen before Step 3. It may happen before Step 2 if Step 1 reveals
that the static sidebar and `NAV_ITEMS` are costly to keep aligned.

### Step 2 - All Offerings Workbench

Status: implemented. All Offerings now uses the reusable
`.workspace-3col` / `.workspace-filter-rail` / `.workspace-main` /
`.workspace-context-rail` primitive, with page-specific `ao-*` classes layered
on top. Follow-up hardening is also in: below the workspace breakpoint the
context rail opens as a shared slide-over drawer instead of dropping below the
table; row selection updates the active row and debounces buyer scoring instead
of re-rendering the full table; stale buyer requests are aborted; muni rows
carry explicit `bq` / `taxStatus` fields; unverified BQ status is shown
neutrally; partial CRM context is surfaced; and non-admin buyer scopes collapse
to the acting rep when rep scoping is enforced.

Scope:

- Add the reusable workspace primitive.
- Convert All Offerings into filter rail + main grid + context rail.
- Add click/keyboard row selection.
- Show selected offering summary in the rail.
- Add "who should I call?" or matched-bank context using existing scoring where
  possible.
- Preserve existing filters, table sort, CSV export, star/watchlist behavior,
  and native explorer deep links.

This is the first meaningful `portal.js` structural change. Start this only
after Step 1 is merged or clearly paused.

Before Step 2, land or explicitly skip any in-flight facelift work that targets
All Offerings and explorer selectors such as `.explorer-table`,
`.all-offerings-classes`, `.ao-class-pill`, and explorer filter stacks. This
avoids two agents editing the same CSS region with different goals.

### Step 3 - Reuse the Rail

Status: started. Strategies Queue is the first reuse page: it now uses the
shared workspace primitive with a filter rail, board main pane, and selected
request context rail. The rail reuses existing strategy status, archive,
billing, bank-link, file, and detail workflows.

Candidate pages:

- Bank Tear Sheet Sales Workspace: right rail for Today's Fits, rollover, tasks,
  and opportunities.
- Strategies Queue: selected request detail, bank context, billing/status
  actions.
- Market Color: selected headline/feed item, relevant rates, related offerings
  or sectors.
- Reports/Views: selected report/view, filters, export/save actions.

Do not redesign all four pages in one pass. Adopt the primitive one page at a
time.

### Step 4 - Command Palette

Use `GET /api/search/global` to create a keyboard-driven command palette,
likely `Cmd/Ctrl+K`.

Scope:

- Grouped global results: banks, contacts, views, reports, peer groups, pages,
  and CUSIPs.
- Keyboard navigation.
- Reuse existing `activateJumpResult` behavior where possible.

This can happen after Step 1, but it should not compete with the All Offerings
workbench in the same files at the same time.

## Claude Handoff Points

Tap Claude at these points:

1. **Now / before Step 1:** ask Claude to review this spec only, especially the
   nav map, route-preservation contract, and sequencing.
2. **After Step 1 branch/diff exists:** ask Claude for a focused nav review:
   "Do these groups and labels match the agreed spec, and did any route or admin
   visibility behavior regress?"
3. **Before Step 2 implementation:** ask Claude to sanity-check the All Offerings
   rail data inventory and identify any existing helper that prevents duplicate
   scoring work.
4. **After Step 2 works locally:** ask Claude for a UX/code review of selection
   state, responsive behavior, and whether the rail feels reusable.

Do not ask Claude and Codex to simultaneously edit `portal.js` and
`portal.css` for this track. One agent should own a specific step; the other
should review or work on a separate non-overlapping branch.

Suggested ownership:

- Codex owns Step 1 and Step 2 unless explicitly reassigned.
- Claude reviews Step 1 and Step 2 diffs.
- Claude can own Step 4, the command palette, on a separate branch once Step 1
  is stable because it is additive and can reuse the existing global search and
  activation plumbing.

## Acceptance Criteria for the Track

- A rep can find daily work faster from the sidebar.
- Existing bookmarks keep working.
- All Offerings becomes the first proof that a row can open useful related
  context without leaving the page.
- The right rail uses existing portal data and fails softly.
- The layout remains usable on standard office laptop widths.
- The pattern can be reused page-by-page without inventing new layout systems.
