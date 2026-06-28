# Trade Store — Handoff for the Wiring (2026-06-28)

The line-item trade vertical's **engine is built and on `main`.** Two integration
points were intentionally left off because they touch files in flight (the
uncommitted banks-page facelift in `portal.js`/`portal.css`, and `bank-signals.js`
which is Codex's). This is the clean pickup for those.

**Ownership note:** Claude took over and built the trade *engine* (store, importer,
validator, route, tests) per the owner's "build it out". Codex owns the *wiring*
below + the existing Pershing/dormant-report vertical it extends. Coordinate before
editing `bank-signals.js`.

---

## What's already built (on `main`)

| Piece | File | Commit |
|---|---|---|
| Store: schema, mapping, idempotent upsert, blotter + recency reads | `server/trade-store.js` | `7b4f172` |
| CLI importer + `--validate` export preflight | `scripts/import-trade-export.js` | `7b4f172` |
| 24-assertion test (synthetic fixture) + `npm test` wire-up | `tests/trade-store.test.js` | `7b4f172` |
| Read route `GET /api/banks/:id/trades` | `server/server.js` | `8c4e382` |

`trades` table co-locates in `pershing-accounts.sqlite`. Idempotent on
`salesforce_trade_id`. Bank resolved via `trade → pershing_account → bank_id`
(denormalized at import). Empty until the export is applied.

Exports available: `getTradesForBank`, `getTradeRecencyForBanks`,
`getTradeImportStatus`, `importTrades`, `buildPershingMapFromDb`.

---

## Data runbook (when the real export lands)

The SF audit confirmed the Trades object (139,352 rows) is **not** in the current
5-file export — pull a **Trade extract** (Bulk API/Data Loader, not a report; the
report is broken). Stage it next to the others, then:

```
npm run import:pershing -- --apply          # MUST run first (resolves the bank join)
npm run import:trade -- --validate          # PASS/FAIL preflight — do not proceed on FAIL
npm run import:trade -- --apply             # writes the trades table
```

`--validate` gates on: 0 importable rows, duplicate PKs, and <50% bank-join rate
(a low rate means the Pershing export is stale/missing). It also warns if the row
count is >20% off the expected ~139,352. This is the "validated, not just ran"
safety net — **do not cancel Salesforce on a failed preflight.**

Caveat: a Pershing re-import that changes bank matches leaves trade `bank_id`
denormalized-stale — re-run `import:trade --apply` after any Pershing re-import.

---

## Wiring 1 — Tear-sheet Trade History panel (`portal.js`, Sales Workspace tab)

Add a "Trade History" panel to the bank tear sheet's **Sales Workspace** tab
(alongside Activity/Tasks/Opportunities), consuming `GET /api/banks/:id/trades`.

- Render the `rollup` first (trade count, last trade / last buy / last sell dates,
  top sectors) as a compact strip — that's the at-a-glance "is this an active
  account" read.
- Then a paged blotter table: date · buy/sell · CUSIP · issuer · coupon · maturity
  · yield · price · qty · owner. Use `limit`/`offset` query params for paging
  (route caps `limit` at 1000).
- **Deep-link each CUSIP** to its native explorer via the existing
  `data-goto`/`data-cusip` plumbing (the same pattern All Offerings rows use), so a
  historical trade jumps to today's inventory for that security if present.
- Empty state: "No trade history imported yet" (the store returns `total: 0` until
  the export is applied) — mirror the existing self-explaining empty states.
- **Coordinate with the facelift:** this panel lives in the same tear-sheet render
  region the uncommitted Phase-1 facelift touches. Land the facelift first, then
  add this against the facelifted markup to avoid a merge tangle.

## Wiring 2 — `bank-signals.js` recency (Codex's file)

The existing `securities-pershing-dormant` signal reads
`rollup.latestTradeDate`/`daysSinceLatestTrade` from the **account-level** Pershing
stamp. Once trades are imported, prefer **line-item** recency:

- Call `getTradeRecencyForBanks(BANK_REPORTS_DIR, bankIds)` →
  `Map(bankId → { latestTradeDate, tradeCount })` and use `latestTradeDate` (a real
  `MAX(trade_date)`) when present, falling back to the Pershing stamp when the
  trade store is empty.
- This is the portal equivalent of SF **Flow #1 (Trade→Account "Most Recent
  Trade")**. Keep the fallback so nothing breaks before the export lands.
- The dormant-client report Codex planned gains true granularity here (last buy vs
  last sell, sector mix) from `getTradesForBank`'s rollup.

---

## Open question — multi-rep coverage (Flows #5/#6)

SF maintains a multi-rep **Account Team** per bank; the portal models a **single
owner**. The trade rows carry `owner_1_name`/`owner_2_name`, so per-trade
attribution is preserved, but bank-level multi-rep coverage is not. If the desk
needs primary+affiliate-rep credit per bank, that's a small separate CRM change —
not part of the trade store. Owner decision.

---

## Not in scope here

Email/calendar capture (the other real gap) is its own owner decision —
`docs/email-calendar-capture-memo-2026-06-28.md`. Pardot is decided: safe to drop.
Full context: `docs/salesforce-decommission-gap-2026-06-28.md` and the trade-store
spec `docs/salesforce-trade-store-spec-2026-06-28.md`.
