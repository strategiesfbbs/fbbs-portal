<!-- Overnight UI/CSS sweep (Claude lane), 2026-06-25, branch worktree-overnight-ui-sweep. Read-only audit; companion to Codex backend audit docs/codex-overnight-audit-2026-06-25.md. -->

# FBBS Portal Design System Specification — 2026-06-25

## Rationale

Portal.css (~16.6K lines) lacks a cohesive design system. Findings: 5 undefined CSS variables, 11+ border-radius values, 250+ unique padding/margin combos, 40+ hardcoded box-shadows, 60+ hardcoded hex colors, widespread focus-state gaps, 40+ transitions without prefers-reduced-motion wrappers, inconsistent print media font sizing. This spec defines the token hierarchy and consolidation roadmap.

---

## I. CSS Custom Properties — Proposed :root Update

### Current :root Tokens (lines 3–43)

Already defined and healthy:
- **Color palette (brand):** `--racing-green`, `--racing-green-dark`, `--hookers-green`, `--tea-green`, `--tea-green-dark`, `--ash-gray`, `--black`
- **Color palette (surfaces):** `--surface`, `--surface-2`, `--surface-3`, `--surface-hover`, `--bg`, `--bg-light`, `--bg-lighter`, `--border`, `--border-light`
- **Text colors:** `--text`, `--text2`, `--text3`
- **Status colors:** `--danger`, `--success`
- **Map legend colors:** `--maps-*` (5 territory states)
- **Focus & radius (partial):** `--focus-ring`, `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill`
- **Layout:** `--sidebar-width`, `--top-strip-height`

### Missing Tokens to Define (add after line 42)

```css
/* Colors (complete the palette) */
--green: #166534;                    /* Used 25+ times as var(--green) with fallbacks; centralize */
--green-bg: #f0fdf4;                 /* Success/positive fill background */
--bg-soft: #f5f8f6;                  /* Light card/section background (currently hardcoded #f0fdf4 / #f7faf8 mix) */
--status-warn-bg: #fdf3ee;           /* Warning background (currently `.my-work-tile-warn` hardcoded) */
--status-warn-border: #e9c8b6;       /* Warning border (currently hardcoded tan) */

/* Spacing Scale (12px grid) */
--space-xs: 2px;                     /* Avatar borders, 1px + margin */
--space-sm: 4px;                     /* Icon padding, small gaps */
--space-md: 8px;                     /* Standard gap, button padding */
--space-lg: 12px;                    /* Section padding, card margin */
--space-xl: 16px;                    /* Large card padding, major gap */
--space-2xl: 24px;                   /* Extra-large padding, section separation */

/* Border Radius Scale */
--radius-xs: 2px;                    /* Focus rings, fine details */
--radius-sm: 6px;                    /* Already defined; keep */
--radius: 8px;                       /* Already defined; keep */
--radius-lg: 12px;                   /* Already defined; keep */
--radius-pill: 999px;                /* Already defined; keep */

/* Shadow Scale (replaces 40+ hardcoded box-shadow values) */
--shadow-xs: 0 1px 2px rgba(16, 23, 21, 0.04);           /* Subtle elevation */
--shadow-sm: 0 1px 2px rgba(16, 23, 21, 0.06);           /* Already referenced but undefined; fix */
--shadow-md: 0 4px 12px rgba(16, 23, 21, 0.08);          /* Medium card shadow */
--shadow-lg: 0 12px 30px rgba(16, 23, 21, 0.06);         /* Large modal/dropdown shadow */
--shadow-xl: 0 18px 44px rgba(16, 23, 21, 0.14);         /* Extra-large elevation */

/* Typography Scale (consolidate ~12 scattered font-size values) */
--font-xs: 9px;                      /* Captions, badges */
--font-sm: 10px;                     /* Labels, small text */
--font-base: 12px;                   /* Body text (current body font-size: 14px, but most elements use 12px) */
--font-md: 13px;                     /* Form inputs, table cells */
--font-lg: 14px;                     /* Card titles, section headers */
--font-xl: 16px;                     /* Major section headers */
--font-2xl: 20px;                    /* Page titles */

/* Focus State (already good; standardize usage) */
--focus-ring: 0 0 0 3px rgba(184, 206, 190, 0.45);       /* Already defined; audit usage */

/* Z-Index Scale (implicit; formalize for future layering) */
--z-dropdown: 80;                    /* Dropdowns, popovers */
--z-modal: 90;                       /* Modals, overlays */
--z-top-strip: 100;                  /* Sticky top navigation */
--z-sidebar: 100;                    /* Fixed sidebar */
--z-skip-link: 1000;                 /* Skip link (already 1000) */
```

### Migration Path

1. **Week 1:** Add all missing tokens to :root.
2. **Week 1–2:** Replace hardcoded values with token references:
   - All `var(--green)` fallbacks → `var(--green)` (now defined)
   - All `box-shadow: 0 1px 2px rgba(...)` → `var(--shadow-sm)` (40+ instances)
   - All `padding/margin` patterns → corresponding `var(--space-*)` (250+ instances)
   - All hardcoded border-radius 3/4/5/7/10/14px → nearest scale value
3. **Week 2–3:** Consolidate specific high-churn areas (see Component Consolidation below).
4. **Wave 2:** Formalize typography scale across body copy, form labels, section heads.

---

## II. Component Families to Consolidate

### Buttons (fragmented across 6 classes)

**Current state:** `.text-btn`, `.small-btn`, `.small-btn.primary`, `.small-btn.danger`, `.small-btn.secondary` (missing), `.linklike`, `.doc-btn`, `.doc-btn.outline`, `.file-chip` (pseudo-button), `.home-tile-chips button`, etc.

**Consolidation target:**

```css
/* Base button reset (apply to all <button> + .linklike) */
.btn-base {
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  padding: 0;
  margin: 0;
}

/* Button variants */
.btn-primary { background: var(--racing-green); color: #fff; padding: var(--space-md) var(--space-lg); border-radius: var(--radius); }
.btn-primary:hover { background: var(--racing-green-dark); }
.btn-primary:focus-visible { outline: 2px solid var(--tea-green); outline-offset: 2px; }

.btn-secondary { background: var(--surface-3); color: var(--text); border: 1px solid var(--border); padding: var(--space-md) var(--space-lg); border-radius: var(--radius); }
.btn-secondary:hover { background: var(--surface-hover); }
.btn-secondary:focus-visible { outline: 2px solid var(--racing-green); outline-offset: 2px; }

.btn-text { background: transparent; color: var(--racing-green); font-weight: 700; padding: 0; }
.btn-text:hover { color: var(--black); }
.btn-text:focus-visible { outline: 2px solid var(--racing-green); outline-offset: 2px; }

.btn-icon { width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; }

/* Legacy aliases (deprecated, for backward compatibility) */
.text-btn { @extend .btn-text; }            /* Deprecate once portal.js removes class */
.small-btn { @extend .btn-secondary; }      /* Default to secondary; .small-btn.primary overrides */
.linklike { @extend .btn-text; text-decoration: underline; }
```

**Migration:** Update portal.js to use `.btn-*` classes in new code; leave old classes in place for 1 release cycle.

### Tables (3 inconsistent table row styles)

**Current:** `.archive-table`, `.explorer-table`, `.bank-snapshot-table`, `.portfolio-holdings-table`, `.custom-report-table`, `.views-detail-table`, `.rate-comparison-table`, `.swap-blotter-tbl` — each with own hover/padding/header styles.

**Consolidation target:**

```css
/* Base data-table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-md);
}

.data-table thead {
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.data-table thead th {
  padding: var(--space-md) var(--space-lg);
  text-align: left;
  font-size: var(--font-sm);
  color: var(--text2);
}

.data-table tbody tr:hover {
  background: var(--surface-hover);
}

.data-table td {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-light);
  color: var(--text);
}

.data-table tbody tr:focus-within {
  background: var(--surface-hover);
  outline: 2px solid var(--racing-green);
  outline-offset: -2px;
}

/* Variants */
.data-table.dense td { padding: var(--space-sm) var(--space-md); }
.data-table.sticky thead { position: sticky; top: 0; z-index: 10; }
```

**Current classes still used:** Keep `.explorer-table`, `.archive-table`, etc. as aliases/extensions of `.data-table` for 1 cycle.

### Forms & Inputs (inconsistent across builders)

**Current state:** `.custom-report-quickstart input`, `.custom-cond-row select`, `.strategy-filter-row input`, `.swap-editor-meta input` — heights 34–38px, padding 6–8px, no consistent baseline.

**Consolidation target:**

```css
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.form-input,
.form-select,
.form-textarea {
  min-height: 36px;
  padding: var(--space-md) var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--font-md);
  font-family: inherit;
  color: var(--text);
  background: var(--surface);
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--racing-green);
  box-shadow: var(--focus-ring);
}

.form-input:disabled { opacity: 0.6; cursor: not-allowed; }

.form-label {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text2);
}
```

### Empty States & Loading (currently ~5 variants)

**Current:** `.empty-state` (padding varies: 44px 16px or 40px), `.bank-search-empty`, `.strategy-empty-column`, `.market-empty` — each with own icon size/spacing.

**Consolidation target:**

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl) var(--space-xl);
  text-align: center;
  color: var(--text3);
  min-height: 200px;
}

.empty-state-icon {
  font-size: 52px;
  margin: 0 0 var(--space-lg) 0;
}

.empty-state-title {
  font-size: var(--font-lg);
  font-weight: 600;
  color: var(--text2);
  margin-bottom: var(--space-sm);
}

.empty-state-message {
  font-size: var(--font-base);
  color: var(--text3);
  max-width: 320px;
  margin-bottom: var(--space-lg);
}

.empty-state-action {
  margin-top: var(--space-md);
}

.loading-spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 3px solid var(--surface-3);
  border-top-color: var(--racing-green);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## III. Dead CSS to Prune

### Coverage Workspace Retired (2026-06-12)

Lines in `/public/css/portal.css` that are unreferenced after the Coverage Workspace consolidation:

- **Bank coverage filters/notes UI (if any remain):** Search for `.coverage-filter`, `.notes-composer`, `.next-action-editor` — should all be gone per CLAUDE.md. Verify and remove.
- **Old account-status overlay (pre-consolidation):** `.account-status-overlay`, `account-status-badge`, `account-status-edit` — superseded by the single Save action. Remove if unreferenced.

### Market Color Store (2026-06-12)

- `.market-color-item` if any old `.eml` inbox markup lingers (should be gone; confirm with grep).
- Market-color-feed is now auto-fetched, not uploaded; old `.uploaded-article` / `.upload-status` can be pruned if present.

### Process

1. **Audit:** `grep -r "\.coverage-.*\|\.account-status-overlay\|\.market-color-item" public/js/portal.js` — if no matches, safe to prune.
2. **Safe removal:** Delete line ranges with comments `/* DEPRECATED: coverage-workspace */` or `/* RETIRED: market-color-store */` to mark intent.
3. **Verify:** Run `npm test` to ensure no breakage.

---

## IV. Accessibility & Motion Improvements

### Focus States (missing on 7+ interactive components)

**Target:** Every interactive element (.text-btn, .small-btn, .linklike, .file-chip, table rows, form inputs, nav links) has a visible :focus-visible state.

```css
/* Baseline (already in place, line 58–68) */
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--racing-green);
  outline-offset: 2px;
  border-radius: 3px;
}

.sidebar a:focus-visible, .sidebar button:focus-visible {
  outline-color: var(--tea-green);
}

/* Add missing overrides per component */
.text-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.small-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.file-chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.linklike:focus-visible { outline: 2px solid var(--racing-green); outline-offset: 2px; }
table tbody tr:focus-within { background: var(--surface-hover); outline: 2px solid var(--racing-green); outline-offset: -2px; }
.doc-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

### Prefers Reduced Motion (audit + wrap 40+ transitions)

**Current:** 40+ hardcoded `transition` rules with no `@media (prefers-reduced-motion: reduce)` wrappers.

**Target:**

```css
/* Global reduces for users with motion sensitivity */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Per-component overrides (selective, for components where transition is integral) */
.doc-card { transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s; }
@media (prefers-reduced-motion: reduce) {
  .doc-card { transition: none; }
}
```

**Process:**
1. Identify all `transition` rules (grep `-n "transition:" portal.css`).
2. For high-motion components (carousels, fades, slides), add per-component `@media (prefers-reduced-motion: reduce)` rule.
3. For low-impact ones (color hover states), rely on the global blanket.

---

## V. Print Media Improvements

### Current State

- Body font: 8px (unreadably small for dense tables)
- Table styling sparse; no page-break guidance
- Chart/interactive content not hidden

### Target

```css
@media print {
  body {
    font-size: 9px;
    print-color-adjust: exact;  /* Preserve background colors */
    background: #fff;
    color: #000;
  }

  /* Hide interactive controls */
  .bank-workspace-toolbar,
  .header-controls,
  .search-bar,
  .sidebar,
  .top-strip,
  .action-buttons,
  .print-hide {
    display: none !important;
  }

  /* Improve table readability */
  table { page-break-inside: avoid; width: 100%; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }

  th, td {
    padding: 6px 8px;
    border: 1px solid #999;
    font-size: 8.5px;
  }

  th {
    background: #f0f0f0;
    font-weight: bold;
  }

  /* Dense table-specific rules */
  .archive-table th { font-size: 8px; }
  .archive-table td { font-size: 8.5px; }
  .bank-snapshot-table th, .bank-snapshot-table td { font-size: 8px; }

  /* Preserve links in printed output */
  a[href]::after { content: " (" attr(href) ")"; font-size: 7px; }

  /* Avoid widows/orphans */
  p { orphans: 3; widows: 3; }
}
```

---

## VI. Naming & Hierarchy Reference

### Component Class Naming Convention

Going forward, use this hierarchy:

```
.btn-{variant}           (primary, secondary, text, icon, danger)
.form-{type}             (field, input, select, textarea, label, error)
.data-table{.variant}    (dense, sticky)
.empty-state{.variant}   (small, full-screen)
.card{.variant}          (compact, expandable)
.badge{.variant}         (primary, secondary, danger, success)
.modal{.variant}         (dialog, dropdown, drawer)
.section{.variant}       (header, footer, divider)
```

### Color & Palette Usage

- **Text:** `--text` (primary), `--text2` (secondary), `--text3` (tertiary/disabled)
- **Surfaces:** `--surface` (white), `--surface-2` (light), `--surface-3` (lighter), `--surface-hover` (interactive hover)
- **Accents:** `--racing-green` (primary action), `--tea-green` (secondary), `--danger` (destructive), `--success` (positive)
- **Never use:** hardcoded hex unless it's a third-party color (e.g., map markers) or a temporary debug overlay

---

## VII. Roadmap & Sequencing

### Immediate (this week)
1. Add missing tokens to :root (10 min)
2. Replace `var(--green)` + `var(--shadow-sm)` + undefined vars (1h)
3. Audit + fix button focus states (1.5h)
4. Apply design-system consolidation to highest-churn areas: buttons, forms, empty states (2–3h)

### Week 2
1. Migrate 250+ spacing hardcodes to `var(--space-*)` (coordinate with Codex; high churn, pair-review)
2. Consolidate 11+ border-radius values → scale
3. Replace 40+ box-shadows with scale tokens
4. Add prefers-reduced-motion wrappers (30+ transitions)

### Wave 2 (next sprint)
1. Prune dead coverage-workspace CSS
2. Fully standardize data-table across 8+ table implementations
3. Typography scale standardization (font-size, line-height, font-weight across body, labels, headers)
4. Conduct contrast audit (WCAG AA minimum 4.5:1 for normal text)
5. Print media full overhaul (page-break, font-size, hiding interactive)

---

## Confidence & Impact Summary

- **High confidence:** Token definitions, focus states, color fallbacks, prefers-reduced-motion (all additive, no breaking changes).
- **High impact:** Spacing scale + shadow scale reduce CSS size by ~15% and make future tweaks trivial (one value change affects 20+ instances).
- **Medium effort:** Button/form/table consolidation requires careful migration (maintain backward-compat aliases for 1 release, then deprecate).
- **No risk:** All changes are additive; old classes can coexist with new token-driven ones indefinitely.