# Intraday Inventory-State Suite — Spec (INV-1 / INV-2 / INV-3 / INV-5)

Status: **proposed**. INV-1 is gated on an explicit owner decision (a new persistent trader-write surface with compliance-retention implications). INV-2 and INV-5 are inert until INV-1 lands. INV-3 (aging) is **loop-safe and ships standalone** — it reads only data already on disk and does not depend on INV-1.

Generated 2026-06-24 from `docs/feature-backlog-2026-06-24.md` (theme: "Trader / desk intraday & inventory state"). Grounded against the live registry, store, and routing code as of this branch.

---

## Problem / why

The portal publishes **one daily frozen snapshot** of the package and is then static until tomorrow. There is no shared intraday truth about availability, size, price, or whether the desk wants a block gone. Concrete failures the desk hits today:

- By mid-morning a rep can still pitch a block the trader filled at 9:30; nothing downstream knows it's gone.
- A trader cuts a price on a stale agency and reps keep quoting the published (worse) level.
- When a trader wants to *move* a position, they email reps one-by-one or shout across the desk. There is no in-portal "work these three names today."
- The desk has no view of which offerings are **stale** — a CUSIP sitting on the sheet six straight days at one price is mispriced/unwanted, exactly what should trigger an axe or markdown.
- Once a block is sold, there's no record of *what moved today* or a running internal turnover record by sector/rep.

Everything the portal renders for offerings flows through one registry (`buildAllOfferingsRows()` → `cusipSearchSources().normalize()` in `server/server.js`). That single chokepoint makes a thin overlay tractable: write a per-CUSIP state row, join it in one place, and every consumer (All Offerings, the six explorers, Today's Fits, the Sales Dashboard, swap inventory) inherits the truth for free.

---

## The four pieces and their dependency order

| Item | What | Loop-safe? | Depends on |
|---|---|---|---|
| **INV-3** Inventory aging | Archive-fed read: days-on-sheet, price drift, stale flag. | ✅ yes — pure read over `data/archive` | nothing |
| **INV-1** Inventory-state layer | New `inventory_state` table + store + gated write routes + read overlay + shared chip helper. | 🔒 **owner-gated** (new trader-write surface) | nothing in code; **owner decision** |
| **INV-2** Axe board | `#axe-board` page + `GET /api/axes` enriched with RV scores + who-to-call. | inert until INV-1 ships and desk marks axes | INV-1 |
| **INV-5** Desk recap of fills | EOD rollup of state transitions (firm→reduced→sold) by sector/rep. | inert until INV-1 ships + desk adopts marking sold | INV-1 |

**Recommended build order:** **INV-3 first** (independent, loop-safe, proves the archive-join math and the aging UI before any write surface exists). Then INV-1 once the owner answers the four decisions below. Then INV-2 (pure read over INV-1). Then INV-5 (last; needs both INV-1 *and* desk adoption of marking sold).

This ordering means real value ships **before** the owner-gated chain unblocks: the aging view is useful on its own, and its `cusipKey`-join + archive-walk plumbing is reused by INV-1's read overlay and INV-5's transition rollup.

---

## INV-3 — Inventory aging & turnover view (ship this first, standalone)

### Approach

New pure module `server/inventory-aging.js`, archive-fed, node-testable, zero new deps.

`computeInventoryAging({ archiveDates, rowsByDate, todayRows, today })`:
- `archiveDates` — the last N publish dates (caller passes `getArchiveList()` trimmed to the window).
- `rowsByDate` — map of `date → buildArchivedOfferingsRows(date)` output (caller hydrates; module stays I/O-free for testability).
- `todayRows` — `buildAllOfferingsRows()`.

Join every day's rows by `cusipKey(row.cusip)` (the **same** normalizer the RV engine's `computeMovers` uses — `cusipKey()` in `server/daily-dashboard-rv.js`, exported). Per CUSIP currently on the sheet:

```
firstSeen        = earliest archive date this cusipKey appears (consecutive run ending today)
daysOnSheet      = count of distinct package dates in the unbroken run up to today
firstPrice/Yield = price/yield on firstSeen
priceDriftBp     = (todayYield - firstSeenYield) * 100   // yield move in bp; price drift secondary
improved         = todayYield > firstSeenYield + 1bp     // cheaper to buyer = price came down
stale            = daysOnSheet >= 5 (business-day run) AND NOT improved
```

Honest caveat baked into the output: **archive dates are irregular** (1–13 day gaps per the backlog). `daysOnSheet` counts *package appearances*, not calendar days — label the column "packages on sheet (N)" and carry the actual `firstSeen` date so the UI never implies daily cadence. A run is "unbroken" if the CUSIP appears in every archived package between `firstSeen` and today; a gap breaks the run (treat as a re-list).

Return `{ asOf, windowDays, items: [{ cusip, description, assetClass, page, daysOnSheet, firstSeen, firstYield, todayYield, priceDriftBp, improved, stale }], staleCount }`, sorted oldest-and-flat first.

### Where it slots in

- New module `server/inventory-aging.js` (pure).
- `GET /api/inventory/aging?window=21` in `server/server.js` — calls `getArchiveList()`, hydrates `rowsByDate` via `buildArchivedOfferingsRows(date)` (already used by `computeMovers` / the dashboard prior-package path), passes `buildAllOfferingsRows()` as today, returns the module output. Cache by package date (same pattern as the dashboard cache key — recompute when `getCurrentPackage().date` changes). Firm-wide read (Soft-A: the package is shared); **no rep-scope gate**.
- UI: an **Aging** tab/panel on `#all-offerings` (`portal.js`), sortable grid, oldest-and-flat first, `data-goto`/`data-cusip` deep links. A `stale` row gets an amber chip. When INV-1 later lands, this panel gains an "Axe this" action that inherits INV-1's gating — but **ship the read without it** to stay independent.

### Reuse
- `cusipKey()` — exported from `server/daily-dashboard-rv.js`.
- `buildArchivedOfferingsRows(date)` + `buildAllOfferingsRows()` + `getArchiveList()` — `server/server.js`.
- `percentileRank` (if a range-position column is wanted) — already in `daily-dashboard-rv.js`.

### Test plan (`tests/inventory-aging.test.js`, plain node)
- A CUSIP present in 6 consecutive fixture packages at the same yield → `daysOnSheet: 6`, `stale: true`.
- Same CUSIP but yield rose 15bp on day 6 → `improved: true`, `stale: false`.
- A CUSIP with a gap (missing one mid-window package) → run resets at the re-list; `daysOnSheet` counts only the post-gap run.
- A brand-new-today CUSIP → `daysOnSheet: 1`, `firstSeen == today`, not stale.
- Empty archive / today rows → `{ items: [], staleCount: 0 }`, no throw (degradation contract).

**Effort:** S–M. **Blast radius:** tiny — one pure module, one read route, one UI panel. No write path, no schema, no auth change.

---

## INV-1 — Intraday inventory-state layer (the gated keystone)

### Data model

New SQLite store `server/inventory-state-store.js`, through `sqlite-db.js` (bound params + whitelist identifiers, same discipline as `strategy-store.js` / `swap-store.js`). New DB file `data/bank-reports/inventory-state.sqlite` (CRM/desk family, **not** the re-importable bank-data DB).

```sql
CREATE TABLE IF NOT EXISTS inventory_state (
  cusip          TEXT NOT NULL,
  package_date   TEXT NOT NULL,         -- the daily package this state pins to (getCurrentPackage().date)
  status         TEXT NOT NULL,         -- firm | reduced | sold | axed  (taxonomy = OWNER DECISION #1)
  remaining_k    REAL,                  -- effective remaining size in $000; null = unknown/use published
  price_override REAL,                  -- sharper level the trader is working; null = use published
  axe_note       TEXT,                  -- free text shown on the axe board
  updated_by     TEXT NOT NULL,         -- resolved Windows username (auditActorForRequest)
  updated_at     TEXT NOT NULL,         -- ISO
  PRIMARY KEY (cusip, package_date)
);
CREATE INDEX IF NOT EXISTS idx_invstate_pkg ON inventory_state(package_date, status);
```

**Why `(cusip, package_date)` PK:** state is meaningful only against the snapshot it annotates. A new package next morning starts a clean slate (yesterday's "sold" doesn't suppress a fresh re-offer), and a CUSIP re-listed at a new price tomorrow is correctly un-sold. The latest state for a CUSIP is `WHERE cusip = ? AND package_date = ?` against today's package date — a point lookup, not a scan.

**Open question — transition history:** the PK upsert overwrites the row, so the table holds only *current* state, not the firm→reduced→sold path. INV-5 (desk recap) needs the transitions. Two options, both surfaced as OWNER DECISION #3:
- **(a) Append-only transitions table** `inventory_state_events(id, cusip, package_date, from_status, to_status, remaining_k, price_override, note, actor, at)` written on every change; `inventory_state` becomes a materialized "latest" view (or is dropped in favor of `MAX(at)` over events). This is the **compliance-retention-correct** shape — a fill record is then a retained, ordered, never-overwritten record, mirroring the `bank_activities` soft-delete philosophy ("don't add hard deletes back"). Recommended **if** the owner decides a sold/fill record is a books-and-records artifact.
- **(b) Overwrite-only** `inventory_state` + the `data/audit.log` line as the only transition trail. Cheaper; INV-5 then rolls up from the audit log (`readAuditLog`/`readFileTail`) instead of a table. Acceptable **only if** the owner decides fills are operational, not retained records.

Store functions (all parameterized):
- `ensureInventoryDatabase(dir)` — `CREATE TABLE IF NOT EXISTS` + PRAGMA-guarded migration (mirrors `strategy-store.js` line 78's `PRAGMA table_info` add-column pattern).
- `setInventoryState({ cusip, packageDate, status, remainingK, priceOverride, axeNote, updatedBy })` — validate `status` against a **whitelist constant** `INVENTORY_STATUSES` (never inline user status text), `INSERT … ON CONFLICT(cusip,package_date) DO UPDATE` (and, under option (a), also append an event row in the same `transaction()`).
- `getInventoryStateMap(packageDate)` — `{ cusipKey → stateRow }` for the read overlay (one query, cached per package date; invalidate on write).
- `clearInventoryState({ cusip, packageDate, updatedBy })` — sets status back to `firm`/deletes (records an event under option (a)).
- `listAxes(packageDate)` — `WHERE package_date = ? AND status = 'axed'`.
- `listTransitions(packageDate)` — for INV-5 (option (a) only).

### Status taxonomy (OWNER DECISION #1)

Proposed default set, mirroring how the read overlay should behave:
- `firm` — default / no annotation (a CUSIP with no row is implicitly `firm`).
- `reduced` — still available but smaller; `remaining_k` carries the effective size, used to re-screen the ≥$250K Sales Dashboard floor.
- `sold` — gone; **greyed/dropped** from Today's Fits and the dashboard candidate set.
- `axed` — desk wants it gone; **floats up** with `axe_note` and optional sharper `price_override`. Feeds INV-2.

The owner must confirm these four labels and their semantics (e.g. is there a `priced`/`subject` state? does `axed` imply still-firm-but-pushed, or can a block be both reduced *and* axed?). The taxonomy is a whitelist constant; adding/renaming a status is a one-line change but changes downstream rendering — pin it before INV-2/INV-5 build on it.

### Write routes (admin/trader-gated, audited)

```
POST   /api/inventory/:cusip/state    { status, remainingK?, priceOverride?, axeNote? }
DELETE /api/inventory/:cusip/state    (reset to firm)
GET    /api/inventory/state           full state map for today's package (read overlay debugging / the chip layer)
```

**Gating:** add the two mutating paths to `isAdminOnlyApiWrite()` (`server/server.js` line 673) so they inherit the existing admin allowlist gate (`rejectIfUnauthorized` → `FBBS_ADMIN_USERS` / IIS auth, 401/403). Roles are **only Admin and Rep** — "trader" is not a new role. **OWNER DECISION #2:** who writes state?
- **(a) Admin-only** — simplest, reuses the existing gate verbatim, no new auth surface. The trader/desk-head is added to `FBBS_ADMIN_USERS`. Recommended default given the two-role constraint.
- **(b) A "trader" capability** — would require a new role or a per-user allowlist (`FBBS_TRADER_USERS`), i.e. a *new auth surface*, which CLAUDE.md says not to add without changing the deployment model. Avoid unless the owner explicitly wants traders who are not admins to write state.

Every write calls `appendAuditLog({ event: 'inventory-state-set', cusip, packageDate, status, remainingK, priceOverride, ...auditActorForRequest(req) })` (and `inventory-state-cleared` on DELETE). The actor comes from `auditActorForRequest(req)` (resolved Windows identity) — never client-supplied.

`:cusip` is validated (CUSIP-shaped, uppercased) before any DB touch; `status` binds against the whitelist; numeric inputs range-checked (no negative `remaining_k`).

### Read overlay (the single join point)

Overlay state in **one place** so every surface inherits it. The cleanest seam is `buildAllOfferingsRows()` (`server/server.js` line 7890), which already loops every normalized row:

```js
function buildAllOfferingsRows() {
  const stateMap = getInventoryStateMap(getCurrentPackage().date || '');   // cached per package date
  const rows = [];
  for (const source of cusipSearchSources()) {
    for (const raw of source.rows) {
      const n = source.normalize(raw);
      const st = stateMap.get(cusipKey(raw.cusip));   // null = implicitly firm
      rows.push({
        assetClass: source.typeLabel, type: source.type, page: source.page,
        cusip: String(raw.cusip || '').trim(), ...n,
        // additive, non-breaking — every existing consumer ignores unknown fields
        invStatus: st ? st.status : 'firm',
        invRemainingK: st && st.remaining_k != null ? st.remaining_k : null,
        invPriceOverride: st && st.price_override != null ? st.price_override : null,
        invAxeNote: st ? st.axe_note : null,
      });
    }
  }
  return rows;
}
```

Because `buildAllOfferingsRows()` is the source for All Offerings, `findOfferingFitsForBank()`, the Sales Dashboard candidate set (`buildCandidateSet` via the dashboard route), the swap inventory route, and CUSIP search, **the overlay reaches every surface from this one edit**. Downstream behavior:
- **`findOfferingFitsForBank()`** (line 4321): skip `invStatus === 'sold'` rows (alongside the existing `row.yield == null` skip). Today's Fits stops pitching filled blocks.
- **Sales Dashboard `availabilityK`**: when `invRemainingK != null`, use it in place of the published `availabilityK` so a `reduced` block correctly fails/passes the ≥$250K floor. (One change in `daily-dashboard.toCandidate` / the candidate's availability read.)
- **`buildArchivedOfferingsRows(date)`**: optionally join historical state for trend/recap, keyed by that date — but the *primary* overlay is on the live rows.

**Effective-yield with `price_override`:** if a trader's sharper price should re-derive the displayed yield, that's a math call (re-solve YTW off the override price). Default: surface `price_override` as a chip ("desk: 99.50") and **do not** silently recompute the engine yield — keep the published number canonical, show the override as a delta (same policy as the market-snapshot band: desk number canonical, live shown as a chip). Recomputing yield from an override is a follow-on, not part of INV-1.

### Shared status-chip helper (reused across all surfaces)

One helper in `portal.js`: `renderInvStatusChip(row)` → returns a small chip from `row.invStatus` (+ note/override/remaining). Mounted via the existing `data-cusip` plumbing in: All Offerings rows, each explorer row/detail (treasury/muni/agency/corp/MBS/CD), Today's Fits picks, Sales Dashboard pick cards, and the swap-inventory picker. `sold` → grey/strike; `axed` → accent chip with the note; `reduced` → "≈$Xk left". CSS in `portal.css` (`.inv-chip*`), reusing the existing chip scale/tokens.

### Reuse
- `sqlite-db.js` (`execSqlite`/`runSqlite`/`querySqliteJson`/`transaction`) — store layer.
- `isAdminOnlyApiWrite()` + `rejectIfUnauthorized()` — gating, no new auth code.
- `auditActorForRequest()` + `appendAuditLog()` — actor + audit.
- `cusipKey()` (daily-dashboard-rv.js), `buildAllOfferingsRows()`, `getCurrentPackage()`, `findOfferingFitsForBank()` — the join + consumers.
- Migration pattern: `PRAGMA table_info(...)` add-column guard (strategy-store.js:78); sequence/upsert pattern (swap-store.js).

### Constraints respected / bent
- **Two-npm-dep rule:** respected — `better-sqlite3` via `sqlite-db.js`, no new dep.
- **Parameterized SQL + whitelist identifiers:** respected — values bind; `status` validated against `INVENTORY_STATUSES`; `:cusip` shape-validated.
- **No new auth model:** respected under DECISION #2(a) (admin-only); **bent** under #2(b) (a trader allowlist is a new auth surface — flag to owner).
- **Soft-A boundary:** the package/inventory is firm-wide shared, so the *read* overlay is firm-wide (no rep-scope). Only the *write* is gated (admin). Consistent with the boundary.
- **Filesystem-as-DB for the package:** bent in spirit — this is a *second* SQLite exception alongside tear sheets, but it's deliberately a separate annotation DB, never touching the frozen package files. Worth calling out: the daily snapshot stays immutable on disk; intraday truth lives in the side table.

### Test plan (`tests/inventory-state-store.test.js`, plain node, temp DATA_DIR)
- Set `axed` with a note → `getInventoryStateMap` returns it; `listAxes` includes it.
- Upsert same `(cusip, package_date)` from `firm`→`reduced`→`sold` → latest wins (option b) / event chain recorded (option a).
- New package date → prior-day `sold` not returned for today's date.
- Invalid `status` (not in whitelist) → rejected, nothing written.
- Negative `remaining_k` → rejected.
- Overlay join unit test (pure): given a state map + synthetic offering rows, assert `invStatus`/`invRemainingK` attach by `cusipKey` and a non-matching CUSIP defaults to `firm`.

**Effort:** M. **Blast radius:** medium — new store + DB file, one edit in the hot `buildAllOfferingsRows()` path (additive fields, but it's the registry every offering surface reads), one shared chip helper touching ~6 render sites, two gated routes. The registry edit is the risk: keep the added fields additive and guard `getInventoryStateMap` to never throw (return empty map on any error) so a DB hiccup degrades to "all firm" rather than breaking every explorer.

---

## INV-2 — Desk axe board (pure read over INV-1; build after INV-1)

### Approach

A CUSIP with `status === 'axed'` + `axe_note` (+ optional `price_override`) **is** an axe. New `#axe-board` page (Offerings nav group) renders `GET /api/axes`.

`GET /api/axes` (firm-wide read; cache by package date):
1. `listAxes(getCurrentPackage().date)` from the store.
2. Join each axed CUSIP back to its live registry row (`buildAllOfferingsRows()` indexed by `cusipKey`) for description/coupon/maturity/yield/price.
3. Enrich each with its **RV score + spreads** so the board shows *why it screens cheap* — reuse the dashboard's free deterministic RV read: pass the axed candidates through `buildRelativeValue(...)` / `rvForCandidate(...)` from `daily-dashboard-rv.js` (same path the free `GET /api/sales-dashboard` live read uses — `buildLiveDashboard`). Attach `rvScore`, `ustSpreadBps`/`mmdSpreadBps`/`fdicSpreadBps`, `bucket`.
4. Group by asset class.

Response: `{ asOf, packageDate, axes: [{ cusip, description, assetClass, page, yield, price, priceOverride, axeNote, updatedBy, updatedAt, rvScore, spread, bucket }] }`.

UI: grouped cards, each axe shows the note, the sharper level (if any), the RV "why cheap" line, a CSV export, and a **"Who should I call?"** action reusing `findOfferingFitsForBank` inverse logic (the same scorer Today's Fits uses) to list covered banks that fit the axed CUSIP — rep-scoped via the acting-rep cookie (covered-first), so a rep sees their own call list. A **Home badge tile** ("3 axes today") is the in-portal push (no email/cron — it's a render off the same GET on load, refreshed by the existing `setupLivePolling` visibility-gated loop).

### Reuse
- `listAxes()` (inventory-state-store), `buildAllOfferingsRows()` + the INV-1 overlay, `cusipKey()`.
- `buildRelativeValue` / `rvForCandidate` / `buildLiveDashboard` (daily-dashboard-rv.js + daily-dashboard-judgment.js) — RV enrichment, free and deterministic.
- `findOfferingFitsForBank` — who-to-call.
- `setupLivePolling` + `.qa-badge` CSS — the Home badge.

### Test plan
- `GET /api/axes` with two axed CUSIPs → both returned, joined to registry rows, each carries `rvScore`.
- An axed CUSIP no longer in today's package (re-published without it) → omitted (or flagged "no longer offered"), never a broken row.
- No axes → `{ axes: [] }`, page renders the empty-state, no throw.

**Effort:** M. **Blast radius:** low — pure read + one new page; **but inert until INV-1 ships and the desk actually marks axes.** Build only after INV-1 is approved.

**Constraints:** RV enrichment stays the free deterministic engine (no Claude, no billing). Who-to-call honors rep-scope (`enforcedRollupRep` if `?rep=all` is ever exposed). No Bloomberg/S&P data — all numbers from our own parsed package + the keyless Treasury/FRED curves the RV engine already uses.

---

## INV-5 — Sold/filled history → daily desk recap (build last)

### Approach

New pure `server/desk-recap-fills.js`. Inputs depend on INV-1's DECISION #3:
- **Option (a) transitions table:** `listTransitions(packageDate)` → reduce `firm→reduced→sold` events into fill events (size delta = `remaining_k` decrease, or full size on `sold`).
- **Option (b) audit-log only:** scan `inventory-state-set` audit lines for the package date (`readAuditLog`/`readFileTail`), reconstruct deltas from successive `remaining_k`/`status` values per CUSIP.

`buildDeskRecap({ events, rows, repRoster })` rolls up:
- **Par/size moved by sector** (join the fill CUSIP to its registry row's `sector`/`assetClass`).
- **By rep** — join `updated_by` → `REP_ROSTER` (`server/rep-roster.js`, the single firm-roster source) for display names.
- **Fastest movers** (shortest firm→sold elapsed).
- **Still firm at EOD** — carryover that feeds tomorrow's INV-3 aging.

`GET /api/desk-recap?date=` → an EOD card on Home/Pulse. Archived per `package_date`, it becomes a multi-day turnover series over time.

### Reuse
- `listTransitions()` (option a) **or** `readAuditLog`/`readFileTail` (option b).
- `REP_ROSTER` / `SALESPERSON_MAP` (rep-roster.js).
- `buildAllOfferingsRows()` for sector join; CSS-bar render (Pulse pattern), no chart lib.

### Test plan
- Three fixture fill events across two sectors + two reps → correct par-by-sector and par-by-rep rollups.
- An axed-but-not-sold CUSIP → counted in "still firm", not in fills.
- Empty day → `{ fills: [], bySector: [], byRep: [] }`, no throw.

**Effort:** M. **Blast radius:** low (pure read), **but doubly inert** — needs INV-1 *and* desk adoption of marking blocks sold. A turnover/fill record leans toward the compliance-retention boundary (see DECISION #3). **Build last in the chain.**

---

## Build sequencing summary (what's loop-safe vs owner-gated)

1. **INV-3 (loop-safe, ship now)** — pure archive read, no write surface, no auth change. Proves the `cusipKey` archive-join and the aging UI. *An unattended loop can build this.*
2. **— OWNER GATE —** Answer DECISIONS #1–#4 below before any of INV-1/2/5.
3. **INV-1 (owner-gated)** — store + gated writes + overlay + chip. The keystone; nothing below works without it. *Not safe unattended* (new persistent trader-write surface + retention question).
4. **INV-2 (after INV-1)** — pure read; inert until axes exist.
5. **INV-5 (last)** — pure read; inert until INV-1 + desk adoption.

Everything INV-2/INV-5 reads is additive and read-only, so once INV-1 lands they are low-risk. The single high-stakes, non-additive decision is INV-1's existence and shape.

---

## Open questions / OWNER DECISIONS

1. **Status taxonomy.** Confirm the four statuses (`firm` / `reduced` / `sold` / `axed`) and their exact semantics. Is there a `priced`/`subject` state? Can a block be both `reduced` and `axed`? This is a whitelist constant that INV-2/INV-5 rendering depends on — pin it before they build.
2. **Who may write state.** Admin-only (reuses the existing `FBBS_ADMIN_USERS` gate, no new auth surface — **recommended** under the two-role constraint) **vs** a new "trader" capability/allowlist (a *new auth surface* CLAUDE.md says not to add without changing the deployment model). If only some traders should write but they aren't admins, the deployment model has to change — that's an owner/IT call.
3. **Is a sold/fill record a retained compliance record?** This decides the data model: an **append-only transitions table** (books-and-records-correct, mirrors the `bank_activities` no-hard-delete philosophy — **recommended if** fills are a retained record) **vs** an overwrite-only state row with the `audit.log` as the only transition trail (cheaper; INV-5 rolls up from the log). This touches the immutable-audit boundary and must be answered before INV-1's schema is fixed.
4. **Ship INV-3 (aging) now, ahead of the gated chain?** It is the only loop-safe piece, depends on nothing, and delivers a real desk view (stale-offering detection) while INV-1's owner decisions are pending. **Recommended: yes — ship INV-3 standalone, without the "Axe this" button**, then add the button when INV-1 lands. The owner should confirm there's no objection to the aging read shipping before the write layer exists.
