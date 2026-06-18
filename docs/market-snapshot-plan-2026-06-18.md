# Shared Market Snapshot — implementation plan (2026-06-18)

**Build status (COMPLETE for the disagreement bug):**
- `server/market-snapshot.js` (pure registry + `buildMarketSnapshot`, tests in `tests/market-snapshot.test.js`) + `GET /api/market-snapshot` (Economic Update canonical + live wire delta), agreed **desk-PDF-canonical + live-delta-chip** policy.
- Shared `#marketSnapshotStrip` band (`renderMarketSnapshotStrip` / `loadMarketSnapshotStrip`, container-id parameterized, one cached fetch) mounted on **Daily Intelligence, Economic Update, and Relative Value** — so those three rate tabs now show the SAME canonical 2s/10s / 10Y / SOFR with one as-of.
- **Relative Value duplicate UST removed:** the RV PDF's competing 2Y/10Y/2s10s headline tiles are gone; RV keeps its spread/pickup/TEY tiles + the per-term comparison table (its real job).
- **MMD** muni slope already relabeled "AAA 2s/10s" (separate fix) so it no longer collides with the Treasury label.

**Intentionally NOT adopted on Home / Market Color:** Home has a bespoke package-derived "Market Snapshot" showcase and Market Color shows clearly-labeled **live** wire cards — neither has the unlabeled same-number-different-value confusion the data tabs had, so adding the band there would be redundant clutter, not clarity.

**Remaining (optional polish, not the bug):** the old per-tab `dailyIntelSummary` tiles still render below the new band on Daily Intelligence (mild duplication) — retire them when convenient.

Original plan below.

Status: **plan for review, not yet built.** Two related fixes already shipped:
- `feat(market-color)` — Market Color articles now come from public RSS (commit 0677542).
- `fix(mmd)` — muni slope relabeled "AAA 2s/10s" so it stops colliding with the Treasury label (commit 51585f6).

## Problem (from the tile-by-tile audit)

The same market metric is rendered on multiple tabs from **different sources with different freshness**, so the numbers disagree:

| Metric | Tabs showing it | Sources behind them |
|---|---|---|
| UST 2Y/5Y/10Y/30Y, 2s/10s | Home, Daily Intelligence, Econ Update | Economic Update PDF (`_economic_update.json`) — **once-daily** |
| UST 2Y/10Y, 2s/10s | Relative Value | Relative Value PDF (`_relative_value.json`) — **once-daily, a 2nd desk snapshot** |
| UST 2Y/10Y, 2s/10s | Market Color wire | home.treasury.gov live curve (`/api/market/wire` → `market-rates.js`) — **live, 6h TTL** |
| SOFR / Prime / Fed Funds | Home, Daily Intel, Econ (PDF); Market Color (FRED live) | Econ PDF vs FRED |
| SPX / VIX / Crude | Home, Daily Intel, Econ | Econ PDF only |

Root cause of the 2s/10s spread reading 39.8 / 39 / 29 bp: **Econ PDF vs RV PDF vs live curve.** (The MMD +61bp was a 4th, separate thing — a muni curve mislabeled — now fixed.)

## Design decision (confirmed with desk)

**Desk PDF is canonical; live wire is shown as a delta chip.** The desk's vetted Bloomberg/desk-PDF number stays the headline on every shared tile. When a live value is available and differs, show a small `live: X (±Ybp · h:mm)` chip alongside it. We never silently overwrite the desk number with the slightly-different Treasury.gov/FRED value.

Rationale: the PDFs are the numbers the desk has reviewed and will quote to clients; the live wire is fresher but a different source. Showing both, clearly labeled, beats picking one and hiding the discrepancy.

## Architecture

### 1. Metric registry (single source of truth for "what is this tile")
A small declarative table, server-side, shared by the endpoint and tests:

```
ten_year:  { label: '10Y Treasury', unit: '%', dp: 2,
             canonical: econ.treasuries['10YR'].yield,
             live:      wire.rates.tenYear }
twos_tens: { label: '2s/10s', unit: 'bp', derived: canonical(ten_year) - canonical(two_year),
             live:  wire.rates.spread2s10sBp }
sofr:      { label: 'SOFR', canonical: econ.marketRates['SOFR'], live: wire.fred.sofr.value }
spx/vix/crude: canonical only (no live source)
```
(Exact `_economic_update.json` field paths to be pinned in step 1 against a real package — the parser shapes weren't fully verified in the audit.)

### 2. Server: `GET /api/market-snapshot`
Assembles one normalized object by merging the canonical package JSONs with the already-built `/api/market/wire` data:

```
{
  asOf: { desk: '2026-06-11', live: '2026-06-18T18:00:00Z' },
  metrics: {
    ten_year: { value: 4.18, unit: '%', source: 'Economic Update', asOf: '2026-06-11',
                live: { value: 4.20, asOf: '...', deltaBp: 2 } },
    twos_tens: { value: 39.8, unit: 'bp', source: 'Economic Update',
                 live: { value: 29, deltaBp: -11 } },
    ...
  }
}
```
- Reuses existing loaders (`loadCurrentEconomicUpdate`, `marketRates`/`marketWire`) — no new data sources, no parser changes.
- `live` omitted when the live source is unavailable/stale or has no mapping; `source` flips to live (with a `live` marker) only if the canonical PDF is missing that metric entirely.

### 3. Client: shared store + reusable tile/strip
- One `marketSnapshot` global, loaded once per nav (like `marketColorWire`), force-refreshed by the existing live-polling loop.
- A `renderSnapshotTile(key)` helper and a `MarketSnapshotStrip` component (the band each tab re-implements today). Tabs call the shared renderer instead of recomputing from their own slot JSON.
- Delta chip: headline = canonical; chip colored by sign; hidden when live is absent or equal.

## Migration order (incremental, each independently shippable)
1. **Server endpoint + registry**, no UI change. Verify values against a live package.
2. **Client store + shared tile/strip component** (render-only, not yet wired into tabs).
3. **Daily Intelligence** reads the shared strip first (it's the synthesis layer).
4. **Econ Update header tiles, Home showcase, Market Color wire** read the same store. Market Color keeps its live-only extras (CPI, unemployment, auctions, headlines).
5. **Relative Value**: drop its duplicate UST 2Y/10Y/2s10s tiles; RV keeps spreads/pickups/Muni TEY (its real job). Its rate context, if kept, reads the shared snapshot.
6. **MMD** stays muni-only (already relabeled).

## Testing
- Registry resolves every key against a fixture package (unit test).
- Snapshot-assembly test: fixture `_economic_update.json` + fixture wire → expected merged object (deltas, missing-metric fallback, live-down case).
- `tests/frontend-parse.test.js` covers the client wiring compiles.

## Non-goals (separate workstreams, not in this plan)
- CRM Pulse ↔ Home overlap (merge/slim) — different domain.
- Empty "Sales Dashboard" tab → hide/badge as optional.
- Inline ~39%-zoom source PDFs on Econ/RV → move behind the existing Download button.
- Market Color search → word-boundary / field-scoped matching ("SEC" shouldn't hit "SpaceX").
- Responsive sidebar / secondary-scroll-container issues.
- Tab reordering to follow the daily workflow.

These are tracked here so they aren't lost; pick them up as small independent PRs.
