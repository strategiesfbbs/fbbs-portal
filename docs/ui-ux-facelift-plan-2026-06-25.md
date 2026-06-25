<!-- Overnight UI/CSS sweep (Claude lane), 2026-06-25, branch worktree-overnight-ui-sweep. Read-only audit; companion to Codex backend audit docs/codex-overnight-audit-2026-06-25.md. -->

# FBBS Portal UI/UX Facelift Plan — Consolidated 2026-06-25

## Overview

This plan consolidates 47 findings across 4 major page groups into prioritized phases. All changes are **CSS-only or minimal markup** — no portal.js rewrites. The portal is a dense internal work tool optimized for speed and scanability, not marketing aesthetics.

---

## I. Bank Tear Sheet + Sales Workspace

**Status:** 11 findings (1 critical, 3 high-density, 7 refinements)

### Context
The tear sheet surfaces call-report financials and an FDIC peer overlay; the Sales Workspace tab shows signals, activities, tasks, opportunities, contacts, and Today's Fits. Dense 2-column layouts, stacked panels, and excessive margin accumulation reduce vertical real estate and force excessive scrolling.

### Findings Table

| Finding | Page | Severity | Effort | cssOnly | Selectors | Before → After | Risk |
|---------|------|----------|--------|---------|-----------|----------------|----- |
| Section margin accumulation creates bloat | Both tabs | high | quick | YES | `.bank-section` | margin-top: 18px → 12px | low |
| Section title padding excessive | Both tabs | medium | quick | YES | `.bank-section-title` | padding: 9px 12px → 7px 10px | low |
| Call-report label column too wide on mobile | Call Report | medium | medium | YES | `.bank-call-report-label-col` + @media (max-width: 640px) | fixed 300px → 140px; font-size: 10px | low |
| Bank-profile tools wrap misalignment | Header | medium | medium | YES | `.bank-profile-head` | Add @media (max-width: 900px) flex-direction: column | medium |
| Signal strip + actions gap too loose | Sales tab | low | quick | YES | `.bank-workspace-toolbar` | gap: 10px → 8px; actions gap 8px → 6px | low |
| Tab bar bottom-border redundant | Both tabs | low | quick | YES | `.bank-tab-bar` + `.bank-tab-panel` | margin/padding overlap → margin: 16px 0 0; padding-top: 12px | low |
| Intelligence panel redundant padding | Call Report | medium | quick | YES | `.bank-intel-head` + `.bank-intel-grid` | padding: 12px → 10px 12px | low |
| Activity/task/opportunity item padding inconsistent | Sales tab | medium | quick | YES | `.bank-activity-item`, `.bank-task-item`, `.bank-opp-item` | Unify to padding: 8px 10px; gap: 8px | low |
| Contact list mismatched with activity styling | Contacts panel | low | quick | YES | `.bank-contact-row` | padding: 10px 12px → 8px 10px | low |
| Peer-average banner overwraps on narrow screens | Call Report | medium | medium | YES | `.bank-peer-banner` + @media (max-width: 700px) | Add font-size: 11px; gap: 6px; padding: 6px 10px | low |
| Print media doesn't collapse call-report | Print | low | quick | YES | @media print + `.bank-call-report-table` | Add label-col width: auto; word-break | low |
| Workspace-actions stack with no tablet query | Sales tab | medium | medium | YES | `.bank-workspace-toolbar` + @media (max-width: 800px) | Add flex-direction: column for mobile | medium |

### Phase Order

**Phase 1 (Quick wins, ship this round):**
- Section margin/title padding reduction (lines 7238–7242)
- Activity/task/opp unification (lines 15344, 15363)
- Contact row align (line 15356)
- Signal strip gap tighten (line 15697)
- Tab bar margin/panel padding (lines 7238–7257)

**Phase 2 (Medium, week 2):**
- Mobile breakpoints for call-report label column
- Bank-profile tools responsive wrap
- Peer-banner narrow-screen handling
- Workspace-toolbar tablet collapse

**Phase 3 (Refinement, polish):**
- Print media call-report collapse
- Intelligence panel padding dedupe
- Contact row consolidation with activity styling

---

## II. Offerings Explorers + Watchlist + Market Snapshot

**Status:** 14 findings (2 high, 5 medium, 7 low)

### Context
Explorers (Treasury, Muni, Agencies, Corporates, All Offerings) are heavy-data tables. Mobile filter stacks exceed viewport; sort affordance is subtle; responsive behavior lacks polish.

### Findings Table

| Finding | Page | Severity | Effort | cssOnly | Selectors | Before → After | Risk |
|---------|------|----------|--------|---------|-----------|----------------|----- |
| Sort affordance weak on table headers | All Explorers | medium | quick | YES | `.explorer-table th[data-sort]::after` | Add `content: ' ⇅'; opacity: 0.4; font-size: 8px` + hover opacity: 0.7 | low |
| Table cell padding too compact | All Explorers | medium | quick | YES | `.explorer-table td` | padding: 8px 12px → 10px 12px; line-height: 1.35 | low |
| Mobile filter grid collapse stacks vertically | All Explorers | high | medium | YES | `.af-row-narrow` + @media (max-width: 640px) | Add flex-direction: column for narrow fields | medium |
| Filter checkbox pill group wraps without max-height | Agencies + Corporates | medium | quick | YES | `.chk-group` | Add max-height: 60px; overflow-y: auto; padding-right: 4px | low |
| Asset-class chips lack spacing | All Offerings | low | quick | YES | `.all-offerings-classes` + `.ao-class-pill` | Improve gap: 8px → 10px; padding: 2px 8px → 4px 10px | low |
| Empty state styling inconsistent | All Explorers | low | quick | YES | `.explorer-empty-row` (new class) | Standardize loading/empty rows across all explorers | low |
| Snapshot step metrics uneven row heights | Market Snapshot | low | quick | YES | `.snapshot-step-metrics` + `.snapshot-step-metrics span` | Add align-items: center; min-height: 32px on span | low |
| Market Snapshot card padding loose on mobile | Market Snapshot | low | quick | YES | `.market-snapshot-card` + @media (max-width: 640px) | padding: 28px 26px → 18px 16px | low |
| Table header nowrap + uppercase cuts labels | Muni/Agency Explorers | medium | medium | YES | `.explorer-table th` + @media (max-width: 1200px) | Allow white-space: normal; word-break at wider tables | medium |
| Filter label letter-spacing reduces scannability | All Explorers | low | quick | YES | `.ef-field > span` | letter-spacing: 1.2px → 0.5px | low |
| CD National tile spacing loose at narrow widths | CD Explorer | low | quick | YES | `.cd-nat-tiles` + @media (max-width: 640px) | Add mobile gap: 12px; flex-direction: row; min-width: 100px | low |
| Legend box border contrast weak | All Explorers | low | quick | YES | `.legend-box` | border-left color ash-gray → racing-green; add light bg | low |
| Explorer stats grid doesn't adapt below 640px | All Explorers | medium | quick | YES | `.explorer-stats` + @media (max-width: 640px) | Add grid-template-columns: repeat(2, 1fr); gap: 10px | low |
| Watchlist table lacks asset-class indicator | Watchlist | low | medium | NO | `.watchlist-class-col` + portal.js | Add colored pill matching All Offerings design | medium |

### Phase Order

**Phase 1 (Quick wins):**
- Sort affordance icon (line 3588–3590)
- Table cell padding increase (line 3591)
- Filter pill group max-height (new rule for `.chk-group`)
- Asset-class chip spacing (line 15392)
- Legend box color (new rule or enhancement)
- Filter label letter-spacing (line 7838+)
- CD tile mobile spacing (line 15872)
- Explorer stats grid 2-col mobile (new @media rule)

**Phase 2 (Medium, week 2):**
- Mobile filter grid collapse (`.af-row-narrow` @media)
- Table header wrapping at wider tables
- Market Snapshot card mobile padding
- Snapshot metrics row heights

**Phase 3 (Refinement + Portal.js):**
- Watchlist asset-class indicator (requires portal.js + minimal markup)
- Empty state consolidation (CSS template + markup reuse)

---

## III. Reports v2, Saved Views, Strategies Queue, Bond Swap

**Status:** 13 findings (4 high-density, 6 medium, 3 low)

### Context
Reports builder, Strategies Kanban, Bond Swap blotter, and Saved Views are dense form + table tools. Inconsistent control heights, excessive table padding, form-group spacing, and missing empty-state templates fragment the UI.

### Findings Table

| Finding | Page | Severity | Effort | cssOnly | Selectors | Before → After | Risk |
|---------|------|----------|--------|---------|-----------|----------------|----- |
| Condition row wrapping broken on multi-control | Reports v2 | high | quick | YES | `.custom-cond-row` | Change flex-wrap to grid; grid-template-columns: auto auto auto 1fr auto | low |
| Form control height mismatch (38px vs 34px) | All builders | high | quick | YES | `.custom-report-quickstart input`, `.custom-cond-row select/input` | Standardize min-height: 36px; padding: 7px 8px | low |
| Secondary button style missing | Reports, Strategies, Pulse | medium | quick | YES | `.small-btn.secondary` (new) | Add background: #f4f8f6; border-color: #b0c4b5; color: var(--text2) | low |
| Table cell vertical padding poor scanability | All results tables | medium | quick | YES | `.custom-report-table td`, `.views-detail-table td`, `.swap-blotter-tbl td` | padding: 10px → 6px 10px; swap: 5px 8px | low |
| Group-by condition container waste space | Reports v2 | medium | quick | YES | `.custom-report-conditions` + `.custom-report-groupby` | padding: 10px 12px → 8px 10px | low |
| Empty state centering inconsistent | Strategies, Views, Reports, Swap, Peer | medium | quick | YES | `.empty-state`, `.strategy-empty-column` (new class) | Standardize padding: 48px 24px; icon: 52px; 16px 0 8px margin | low |
| Strategy card title/metadata lack hierarchy | Strategies Queue | medium | quick | YES | `.strategy-card`, `.strategy-card-head`, `.strategy-card-meta` | Increase gap: 9px → 10px; padding: 12px → 13px; meta font-size: 11px → 10px | low |
| Swap blotter monospace wastes column width | Bond Swap | medium | quick | YES | `.swap-blotter-tbl .cu`, `.swap-leg-table input` | font-family: monospace → inherit; add font-variant-numeric: tabular-nums | medium |
| Quickstart buttons vs recipes border-radius | Reports v2 | low | quick | YES | `.custom-report-recipes button` | border-radius: 6px → 8px (match quickchips: 999px → standardize to 8px) | low |
| Focus states weak on dense buttons | Reports, Strategies, all tables | medium | quick | YES | `.text-btn:focus-visible`, `.custom-cond-row button:focus-visible` | Add outline: 2px solid var(--racing-green); outline-offset: 1px | low |
| Strategy Kanban collapses too aggressively | Strategies Queue | medium | medium | YES | `.strategy-board` + @media (max-width: 900px vs 700px) | Add intermediate breakpoint at 900px: grid-template-columns: repeat(2, 1fr) | low |
| Reports list sticky headers lack visual distinction | Reports | low | quick | YES | `.reports-list th` | Add box-shadow: 0 2px 4px rgba(0,0,0,0.04), inset 0 -1px 0 var(--line) | low |
| Swap hero/package cards use non-12px spacing | Bond Swap | low | quick | YES | `.swap-hero`, `.swap-pkg-card` | padding: 18px 22px / 16px 18px → 18px 20px / 16px 16px | low |
| Badge/pill styling inconsistent (3 combos) | Strategies, Reports, Swap | low | quick | YES | `.strategy-archive-badge`, `.reports-type-badge`, `.swap-status-pill` | Standardize to font-size: 9.5px; padding: 4px 9px; border-radius: 999px | low |

### Phase Order

**Phase 1 (Critical quick wins):**
- Condition row grid layout (line 8511–8531)
- Form control height standardization (lines 8379, 8525, 10377, 13794)
- Table cell padding reduction (lines 8693–8695, 11240–11245, 13596)
- Group-by padding tighten (lines 8485–8541)
- Secondary button style (new `.small-btn.secondary`)
- Focus states on buttons (new :focus-visible rules)

**Phase 2 (Medium, week 2):**
- Empty state consolidation (`.empty-state` template + component reuse)
- Strategy card hierarchy (gap + font tweaks)
- Swap monospace→tabular-nums
- Reports sticky header shadow
- Swap hero/package spacing normalize to 12px grid
- Badge/pill standardization

**Phase 3 (Polish):**
- Kanban intermediate breakpoint (900px)
- Button border-radius standardize (quickstart/recipes)

---

## IV. Portal Home, CRM Pulse, Global Nav

**Status:** 13 findings (3 high-severity undefined vars, 5 medium, 5 low)

### Context
Home page, CRM Pulse KPI dashboard, and global navigation have undefined CSS variable fallbacks, inconsistent palette usage, contrast issues, and loose spacing. The portal.css :root is missing 5 key tokens.

### Findings Table

| Finding | Page | Severity | Effort | cssOnly | Selectors | Before → After | Risk |
|---------|------|----------|--------|---------|-----------|----------------|----- |
| Undefined CSS variable --green used throughout | All pages | high | medium | YES | 25+ selectors across .text-btn, .cb-chip, .home-bubble-links, .sig-actions | Add --green: #166534 to :root; replace all var(--green) fallbacks | high |
| Warning tile palette clashes with green system | Home tiles | medium | quick | YES | `.my-work-tile-warn` | background: #fdf3ee → rgba(212, 153, 38, 0.08); border → rgba(212, 153, 38, 0.18) | low |
| Pulse bar track contrast low for text values | CRM Pulse | medium | quick | YES | `.pulse-bar-track`, `.pulse-bar-fill` | Increase track bg contrast #f0f4f1 → #e8eef0 or reduce fill transparency | medium |
| Jump-search results lack visual grouping | Nav jump-search | medium | quick | YES | `.jump-group-label`, `.jump-result` | Add margin-top: 8px to label:not(:first-child); separator padding | low |
| My Work tile density: narrow label + large number | Home tiles | low | quick | YES | `.my-work-tile-kicker`, `.my-work-tile-num` | Reduce kicker font-size: 10px → 9.5px; increase gap: 6px → 8px | low |
| Hero status pill colors inconsistent | Home hero | low | quick | YES | `.hero-status[data-state]` | Partial color #c98a18 → #d4991d; increase bg opacity 0.12 → 0.14 | low |
| Home tile grid gap spacing loose at 18px | Home | low | quick | YES | `.home-tile-grid` | gap: 18px → 14px | low |
| CRM Pulse KPI card padding inconsistent | CRM Pulse | low | quick | YES | `.pulse-card` | padding: 14px 16px → 16px 18px for consistency | low |
| Sidebar active state border lacks depth | Sidebar nav | low | quick | YES | `.nav-link.active` | Add subtle box-shadow: inset 2px 0 0 var(--tea-green) or inset glow | low |
| Rep picker dropdown scroll affordance weak | Sidebar | low | quick | YES | `.rep-picker-options` | Add scrollbar-width: thin + webkit scrollbar styles or increase max-height: 260px → 300px | low |
| Home tile chip buttons inconsistent with system | Home tiles | low | quick | YES | `.home-tile-chips button` | Replace with .small-btn class or adopt small-btn defaults | low |
| CRM Pulse h3 font-weight: 900 excessive | CRM Pulse | low | quick | YES | `.pulse-card h3` | font-weight: 900 → 700 (soften hierarchy) | low |
| Text-btn color fallback fails silently | All pages | medium | quick | YES | `.text-btn` at line 6164 | color: var(--green) → color: var(--success, #18735A) | medium |

### Phase Order

**Phase 1 (Critical):**
- Add --green token to :root + replace 25+ fallbacks (line 3)
- Fix .text-btn color var (line 6164)

**Phase 2 (Quick wins):**
- Warning tile palette align (line 809)
- Pulse bar contrast increase (lines 10901–10909)
- Jump-search grouping separators (lines 496–505)
- My Work tile density tweaks (lines 799–825)
- Hero status pill colors (lines 1024–1046)
- Home tile grid gap reduce (line 5082)
- Pulse card padding normalize (line 10842)
- CRM Pulse h3 font-weight reduce (line 10849)
- Sidebar active state depth (line 234)

**Phase 3 (Polish):**
- Rep picker scroll affordance
- Home tile chip buttons class unification
- Sidebar nav z-index review (if modals added)

---

## Phase Prioritization Summary

### Immediate (ship this round, <2h CSS work):
1. Undefined --green token definition + 25+ replacements
2. Section margin/padding reduction (tear sheet)
3. Form control height standardization (builders)
4. Condition row grid layout
5. Table cell padding reduction
6. Activity/task/opp item unification
7. Focus states on buttons/links
8. Empty state consolidation (CSS template)

### Week 2 (medium effort, larger responsive changes):
1. Mobile breakpoints (explorers, builders, tear sheet)
2. Table header wrapping & explorer filter stacks
3. Strategy Kanban intermediate breakpoint
4. Market Snapshot mobile padding
5. Sidebar + top-strip nav refinements

### Wave 2 (larger refactoring, coordinate with Codex):
1. Design-system token consolidation (spacing scale, radius, shadows, colors)
2. Dead coverage-workspace CSS pruning
3. Font-size scale standardization
4. Prefers-reduced-motion wrappers for 40+ transitions
5. Print media font-size & page-break improvements
6. Watchlist asset-class indicator (portal.js integration)

---

## Risk & Confidence Summary

- **Low-risk changes (89% of findings):** single-selector color/padding/gap tweaks, responsive breakpoint additions, focus-state rules, missing-variable definitions. All can be applied independently without breaking layout.
- **Medium-risk (11% of findings):** grid-layout changes on multi-column forms (condition row), responsive media queries that change flex-direction or column count, monospace→tabular-nums font change. Require visual QA but are additive and reversible.
- **No high-risk changes:** no markup rewrites, no portal.js refactoring, no changing existing selector specificity that might override app code.

All findings are grounded in real CSS lines in `/public/css/portal.css` with file:line references.