# Codex handoff — CSS facelift (2026-06-23)

We're doing a light, **non-redesign** polish pass on `public/css/portal.css`, matching the
editorial vocabulary the home page already established (uppercase racing-green kickers, big
stat numbers, soft pill buttons, generous whitespace, calm neutrals). The user likes the
current design — this is *refinement*, not a rebuild.

The work is split so Claude and Codex don't collide in the single ~16k-line stylesheet.
**This doc is your half (Codex): search bars + tabs.** Claude owns the foundation tokens
(already landed) and the Sales Dashboard facelift.

## Region ownership — DO NOT cross these lines

| Region | Owner | Notes |
|---|---|---|
| `:root` token block (top of `portal.css`) | **Claude — done, on main** | Don't edit. Use the new tokens. |
| All search-input rules (the 13 below) | **Codex (you)** | |
| Tab styles (`.bank-tab-bar`, jump-search dropdown chrome) | **Codex (you)** | |
| `.sd-*` Sales Dashboard block (~line 15810→EOF) | **Claude** | Don't touch. |
| Market-snapshot strip styles | **Claude** | Don't touch. |

If you need a new shared rule, append it in or next to the search/tab cluster — **do not add
anything to `:root`** (Claude owns it; a concurrent edit there is the one guaranteed conflict).

## Foundation already on main (commit `a35042f`) — build on these

```css
--line: var(--border);          /* #dbe6df — was undefined; var(--line, #ddd) rendered off-palette */
--accent: var(--racing-green);  /* #003F2A — was rendering the off-palette #1a3a2a fallback */
--focus-ring: 0 0 0 3px rgba(184, 206, 190, 0.45);
--radius-sm: 6px;
--radius: 8px;
--radius-lg: 12px;
--radius-pill: 999px;
```

Defining `--line`/`--accent` already fixed the wrong-green tabs and the broken
`.bank-search-row input` border app-wide. Your job is to make the treatment *consistent and
intentional*, not just un-broken.

---

## Workstream A — Search bars (the bigger one)

**Problem:** 13 separate search-input rules with mismatched height/radius/font/focus and no
leading icon. Find them here:

| Selector | ~line |
|---|---|
| `.rep-picker-search input` | 652 |
| `.cd-opportunity-search input` (+ `:focus`) | 1738 / 1749 |
| `.af-search-field` / `.corp-search-row .af-search-field input` | 3837 / 3846 |
| `.home-strategy-search input` | 5026 |
| `.global-search-row input` (+ `:focus`) | 5457 / 5469 |
| `.bank-search-row input` | 6059 |
| `.reports-peer-search input` | 8947 |
| `.portal-jump input` (+ `:focus`) — the nav "Jump to a page or tool…" | 407 / 418 |
| `.coverage-book-actions input[type="search"]` | ~14399 |

**Goal:** one shared baseline. The lowest-risk path (no markup edits across dozens of
templates) is a **grouped selector** that sets the shared properties, with each existing rule
keeping only its layout overrides (flex/grid/width). Something like:

```css
/* Shared search-input baseline — appended in the search cluster */
.rep-picker-search input,
.cd-opportunity-search input,
.af-search-field input,
.home-strategy-search input,
.global-search-row input,
.bank-search-row input,
.reports-peer-search input,
.portal-jump input {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-lighter);
  color: var(--text);
  font: inherit;            /* kill the 12.5 / 13 / 15px drift */
  font-size: 13px;
  height: 36px;
  padding: 0 12px 0 34px;   /* room for the leading icon */
  /* leading magnifier — inline SVG data-URI is CSP-cleared (img-src 'self' data:) */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238c9a92' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: 10px center;
  background-size: 15px;
}
/* unified focus — replaces the per-rule box-shadows */
.rep-picker-search input:focus,
/* …same list… */
.portal-jump input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
  outline: none;
}
```

Notes / gotchas:
- `.bank-search-row input` is intentionally bigger (15px, taller) — it's the primary tear-sheet
  search. Keep it a touch larger if it reads better; just make it *deliberately* the large
  variant rather than an accident. Your call after you see it.
- The `.portal-jump` input lives in the top strip (36px strip height is fine; it's currently
  34px — verify it still fits after the bump, nudge strip padding if needed).
- Some of these are `type="search"` and get a native clear "x" in WebKit — fine, leave it.
- **Verify the data-URI icon renders** (CSP allows it, but check the preview — a malformed
  URI just shows nothing). The stroke color `%238c9a92` is `--text3`.
- Don't regress placeholder color; if any rule sets `::placeholder`, fold it into the group.

**Verify:** reload the preview and eyeball at least three: the nav jump bar (home, top strip),
the Banks tear-sheet search (`#banks`), and the Reports peer search. Confirm icon + focus ring
are consistent and nothing overflows.

---

## Workstream B — Tabs (smaller)

**Target:** `.bank-tab-bar` (~15549) and its `button` / `button.active` rules. The active
underline now uses `--accent` correctly (brand green) thanks to the token fix — but it has no
hover state and the underline is abrupt.

Polish:
```css
.bank-tab-bar button {
  /* keep existing layout; add: */
  transition: color .15s ease, border-color .15s ease;
}
.bank-tab-bar button:hover {
  color: var(--text);
  border-bottom-color: var(--border);
}
.bank-tab-bar button.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
}
```

If you spot other tab-like rows (e.g. any `…-tab-bar` / segmented controls) reusing the same
pattern, bring them onto `--accent` too — but **leave anything `.sd-*`** (Claude's).

**Verify:** open a bank tear sheet (`#banks` → search a bank → open) and hover/click between
the "Call Report & Portfolio" and "Sales Workspace" tabs. Underline should ease in and sit in
brand green.

---

## Workflow (per CLAUDE.md dual-agent rules)

1. `git fetch origin && git pull --rebase origin main` **before you start and before every
   push** — Claude is pushing Sales-Dashboard commits to `main` in parallel. Your regions are
   disjoint from Claude's, so rebases should auto-merge cleanly; if git ever flags a conflict
   inside `:root` or `.sd-*`, you edited the wrong region — back out.
2. Commit small: one commit for search bars, one for tabs. Conventional `style(css): …` subject.
3. `npm test` must pass before commit (the PreToolUse hook enforces it for Claude Code; you run
   it manually). These are CSS-only changes, so it should stay green — but the frontend-parse
   test compiles `portal.js`, so don't let an stray edit there slip in.
4. There are **pre-existing uncommitted edits** in `index.html` + `portal.js` (moving the Sales
   Dashboard nav entry into the FBBS group). Leave them alone — stage only `portal.css` for your
   commits (`git add public/css/portal.css`).
5. Push to `main` immediately after each commit so Claude rebases onto your work.

## Definition of done

- All search inputs share one baseline (height, radius, font, leading icon, focus ring),
  on-palette, verified in the preview on ≥3 pages.
- Tabs have a hover state and an eased brand-green underline.
- `npm test` green; only `portal.css` touched in your commits.
