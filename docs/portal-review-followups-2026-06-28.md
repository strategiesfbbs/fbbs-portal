# Portal Review — Follow-ups & Design Notes (2026-06-28)

Source: a Claude-in-Chrome end-to-end UX/product review that drove the whole app
(Home → Offerings → Banks → Strategies → Reports → Operations → Archive),
read-only. The app came out strong; defects clustered into three buckets:
(1) data tables that don't degrade below ~900px, (2) missing sort affordance,
(3) cross-surface date/count inconsistencies.

This doc records what shipped, what was deliberately held, and the design for the
bigger bets so they can be picked up later without re-deriving the review.

---

## Shipped (commit `af93450`, 2026-06-28)

Four self-contained quick wins. Verified in a live preview; `npm test` green.

1. **Float precision in parser warnings.** `warnYieldBand()` in
   `server/agencies-parser.js` and `server/corporates-parser.js` interpolated the
   raw float, so Package QA showed `ytnc 30.829999999999995%`. Now rounded to 2dp.
2. **Strategies Queue hero number.** `renderStrategyBoard()` (`public/js/portal.js`)
   showed the **Open** count under the hero while the subtitle counted **active**
   requests — so "0 Open" sat next to "1 active request". The hero number, a new
   `#strategiesCountLabel`, and the subtitle now all follow the same scope
   (Active / Total / Archived). The per-status breakdown still lives in the count pills.
3. **Inline US Bank Map clipped render.** The inline `#mapsPlot` drew before its
   flex container had its final size, leaving it clipped (only the upper Midwest,
   no full-country fit). Added a deferred `Plotly.Plots.resize()` after
   `Plotly.react()` resolves — the same fix `openMapsFullView()` already applied to
   the full-view plot. Confirmed: SVG now fills its container (ratio 1.0) at any width.
4. **Upload page label clarity.** Relabeled "Current Files" → "Current Package"
   (hero stat + quality bar) so the published-package status reads distinctly from
   the "Folder Drop" / "Today's folder" intake panel below it. The counts were
   always correct (`10/10` = published package, `0 publishable` = empty intake
   folder) — only the labeling implied a contradiction.

---

## Held — collides with Codex's in-flight All Offerings workbench

Do **not** touch these until Codex lands the All Offerings workbench (the UI
facelift was paused for exactly this — see memory `overnight-ui-sweep-2026-06-25`).
Touching the offerings grids now risks a merge mess. Pull Codex's markup first,
then do these as one shared-component pass (see "Bigger bets" below).

- **Responsive data tables below ~900px.** Headers wrap to one letter per line
  (`STATE` → S/T/A/T/E), `DESCRIPTION/COUPON/YIELD/SECTOR` break mid-word, and on
  mobile the grid never switches to cards — yield/price/actions scroll off-screen.
  Same root issue on All Offerings, Contacts, Sales Dashboard idea boards, and
  tear-sheet sub-tables.
- **Missing sort affordance.** Clicking a sortable header (`allOfferingsSort`,
  `agencySort`, `corpSort`, …) re-sorts but shows no active-column highlight and no
  asc/desc caret. App-wide.
- **Hero stat vs filter.** All Offerings shows a static "1,148 across 7 asset
  classes" card next to the filtered "223" — the big number should follow the
  current filter state.

---

## Bigger bets (design notes — build later)

### 1. One responsive data-table component (fix tables once)

**Problem:** every grid (`#allOfferingsBody`, `#contactsBody`, explorer tables,
Sales Dashboard idea boards, tear-sheet sub-tables) is a bespoke `<table>` that
overflows below ~900px with no graceful fallback.

**Design:** a shared wrapper class (no framework — this is the no-build SPA) that:
- wraps each table in a horizontal-scroll container with a **sticky first column**
  (the security/bank name) so identity never scrolls away;
- freezes the key economic columns (yield/price) via `position: sticky`;
- at a `mobile` breakpoint, swaps `display` to a **card layout** (label/value pairs)
  via CSS only, reading the same DOM — no JS re-render.

Pure CSS in `public/css/portal.css` keyed off a single `.data-table-responsive`
class added to each grid's container. Roll across all grids in one pass **after**
Codex's workbench lands (it will likely restructure `#allOfferingsBody`).

### 2. Sortable-header affordance

Add an active-column class + caret to every sortable `<th>`. The sort state already
exists per page (`allOfferingsSort`, `agencySort`, `corpSort`, plus the views/report
sorts). A shared helper `renderSortHeader(th, key, sortState)` that toggles
`aria-sort` + a `.sorted-asc`/`.sorted-desc` class (CSS caret via `::after`) keeps it
consistent and accessible. Wire it into each grid's header render.

### 3. Shared freshness / stale-badge component

**Problem (the most-cited cross-surface issue):** "Updated / Uploaded / File dated /
As of / COB / TODAY" all coexist, and the on-screen values don't reconcile —
header June 28 vs package June 26 vs MMD doc June 25 vs Exec Summary COB June 3 vs
MBS/CMO "Updated May 1". Several of these are **expected** (Exec Summary and MBS/CMO
are independent manual uploads with their own cadence, not fed by the daily package),
but the UI gives the reader no way to tell "fresh" from "silently stale".

**Design:**
- A single `freshnessStamp({ label, asOf, packageDate })` helper that renders one
  consistent chip: `Data as of <date> · Package <date>`, and adds a **visible
  `stale` badge** when the panel's `asOf` lags the current package date by more than
  its expected cadence.
- `server/market-snapshot.js` already models this exact canonical-vs-live `asOf`
  split (`{ asOf: { desk, live } }`) — reuse that pattern as the contract.
- Standardize explorer subtitles (currently `extractedAt`/`uploadedAt` rendered
  ad hoc per explorer) onto this one component. **This is the deferred
  "explorer-subtitle standardization" quick win** — held back because it touches all
  six explorers and is cleaner as one component than six one-off edits.
- Exec Summary and MBS/CMO get an explicit "independent upload — last refreshed X"
  framing so their staleness reads as informational, not broken.

### 4. Package QA (33) vs Upload (31) warning-count reconciliation

**Deferred from the quick-win batch** because the two numbers come from different
sources and reconciling risks being wrong without tracing both:
- Package QA aggregates per-slot parser `warnings[]` across every slot JSON.
- Upload's `qualitySummary.warnings` (`public/js/portal.js` ~line 1384) is computed
  separately and appears to scope a subset.

**Fix:** make both read the **same** aggregation (one `countPackageWarnings(pkg)`
helper), or, if they intentionally scope differently, label each ("33 parser
warnings across all slots" vs "31 in required slots"). Decide which, then unify.

### 5. Contacts list virtualization

`loadContactsDirectory()` renders all 1,736 `bank_contacts` rows into
`#contactsBody` at once — heavy DOM. Add windowing (render visible rows + a buffer,
recycle on scroll). Pure-JS windowing keeps the no-build constraint. Also covers the
Sales Dashboard idea boards if they grow.

### 6. Real typeahead on the Bank Tear Sheet search

The tear-sheet search placeholder ("Start typing a bank name…") implies typeahead
but requires clicking SEARCH, while the global omnisearch (`setupNavSearch`) *is*
instant typeahead. Reuse the omnisearch debounce/dropdown pattern on the tear-sheet
search so the two behave consistently.

### 7. Product-Fit marker legend

The dotted-circle markers next to ALM/CECL/ACH/etc. on the Sales Workspace read like
loading spinners — you can't tell "not subscribed" from "unknown/loading". Define a
clear three-state icon set (held / not-held / unknown) plus a small inline legend,
and reuse the vocabulary anywhere status markers appear.

### 8. Contacts → Bank affordance (minor)

The Contacts "Bank" cell **already** jumps to the tear sheet
(`data-contact-bank` handler, `public/js/portal.js` ~18541), but it's styled as a
plain `.text-btn` so it doesn't read as clickable. Same for omnisearch contact
results (already routed). Pure styling: make these read as links. No logic change.

---

## What's genuinely good (keep & extend — don't sand off in a redesign)

- **Deep-linking everywhere** — row "Open" → explorer pre-filtered to the CUSIP;
  filter state in URLs (CD Rollover, Bond Swap); Archive "View" → exact dated PDF.
  Extend the same to Contacts→Bank and Map→Tear Sheet.
- **The omnisearch jump bar** (banks + contacts + CUSIPs + pages, grouped). Best-in-
  class for an internal tool. Consider a focus shortcut + arrow-key nav.
- **Today's Fits + Portfolio Idea Engine** — today's inventory scored against a
  specific bank's book, deterministic, with honest guardrails. The crown jewel.
- **Package QA as a first-class data-quality surface** — row-level parser warnings
  build trust in the numbers.
- **Density done right** — Sales Dashboard, tear-sheet KPI-vs-peer cards, the muni
  tax-settings panel. Respects a power user who lives in the app.
- **Self-explaining empty states** and the **"Acting as" rep scoping** model.
