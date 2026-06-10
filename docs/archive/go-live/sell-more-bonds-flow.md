# Sell More Bonds — Smoke Test + Flow & Report-Gap Analysis

> **Owner:** Claude (product/workflow lane) · **Date:** 2026-06-02
> Two parts: (1) a **live smoke test** tracing the revenue flows on the real June-2 data,
> and (2) the product analysis the question asked for — **what Salesforce reports we
> can't run yet**, **portal optionality**, and **how to make swaps / tear sheets / offers
> flow together so FBBS sells more bonds.** Complements Codex's
> [full audit](codex-full-audit-2026-06-02.md) (page-load smoke + broad Salesforce gap list);
> this one is the *revenue-flow* lens.

---

## 1. Smoke test — what I ran and verified

**Method:** booted the app locally (port 3100) against the real `data/` folder and traced
the APIs end-to-end (not just page loads). **Result: healthy.** Every read endpoint
returned `200`, **no failed network requests**, no console errors (matches Codex's walk).

**Real data flowing today (June-2 package):**
- Inventory: **208 CDs · 28 munis · 379 agencies · 196 corporates · 316 treasuries**; brokered-CD across 11 terms.
- Daily Intelligence: **7 rule picks** with reasons + 2 known gaps (structured products, MBS/CMO).
- Bank book: **135 MB** call-report DB; **82 banks** with bond-accounting holdings; account-status workbook joined (status, owner, affiliate, services).
- Swap engine: **1,124-item** buy-side inventory built from today's package.

**Crown jewel — the Bond Swap suggester works and is the strongest sell-more engine.**
For one bank (Alton, 93 holdings) it returned **5 kept + 5 dropped** swap ideas. Each idea
pairs a **held bond** (book/market value, gain/loss, yield, months-to-maturity) with a
**specific offering from today's package** (`sourceRef: _agencies.json` / `_muni_offerings.json`),
plus full economics (annual income pickup, breakeven months, realized G/L, net benefit to
horizon), the **hard desk rule** (held can't mature before breakeven), soft warnings, and a
plain-English **fit summary** ("fills 2032 Agency ladder gap; stays near the sold bond
maturity"). This proves the data and math to **match the bank book to live inventory already
exist** — it's just scoped to swaps, one bank at a time.

**What's solid beyond the swap engine:** tear sheets carry account status + coverage owner +
affiliate + bankers'-bank services + holdings + peer comparison; the 8 saved views cover the
status/billing slices; Package QA shows 10/10 slots; the map and explorers all load real counts.

---

## 2. The core finding: offerings and the bank book are two separate worlds

The single biggest "flow" gap. Today the **only** bridge between *today's offerings* and
*the bank book* is the swap suggester, and it runs **one direction, swaps only** (bank →
matching offerings). Everything else is disconnected:

- **No offer → banks matcher.** Given a CD at 3.90% 1-mo, an FFCB bullet, or a BQ muni in KS,
  nothing answers *"which of my banks should I call about this?"* Reps do it in their heads.
- **Daily Intelligence picks don't connect.** A pick already carries a **CUSIP**, a target
  **`audience`** (e.g. `["C-Corp Bank","Bank"]`), and its source **`page`** — but `linksTo` is
  `null`. You can't click a pick to open the offering, and it can't resolve to "my banks that
  fit this audience."
- **Product-fit is a manual tag,** not an auto signal — `productFit` is whatever a rep typed on
  the coverage panel, not computed from the bank's balance sheet or holdings.

**Why it matters for selling bonds:** the firm publishes ~1,100 buy-side line items every
morning. The constraint on selling them isn't inventory or analytics — it's *connecting each
line item to the handful of banks that would buy it, fast, before the rep moves on.* The swap
engine shows that connection is computable. Generalizing it is the highest-leverage move in
this document.

---

## 3. Reports a rep runs in Salesforce that the portal can't yet

The 8 saved views (`clients`, `prospects`, `open`, `watchlist`, `needs-billed`,
`billing-pending`, `my-book`, `stale-follow-ups`) cover **account status + billing** well.
The sales-reporting gaps, specifically:

| Salesforce report a rep/manager runs | Portal today | What's missing |
|---|---|---|
| **Opportunity / pipeline** (stage, $ size, close date, probability, forecast rollup) | Strategies Queue = *workflow* (Open→Billed), no $ or stage | A revenue-bearing pipeline object + manager forecast |
| **Activity report** (calls/meetings/emails logged; "my activity this week"; "banks not touched in N days") | `stale-follow-ups` ≈ coverage next-action only | Logged activities + "no-contact-in-N-days" by rep |
| **Segmentation lists** — Sub-S vs C-Corp · by state/territory · by asset tier · CECL prospects · BQ-muni buyers · CD maturity wall · high securities/assets headroom | Peer/Opportunity Scan exists in Reports workspace (client-side, ad hoc) | These as **saved, repeatable, per-rep** reports + CSV |
| **New / changed** ("new prospects this month", "status → Client", "recently onboarded") | none | Change-over-time reporting |
| **Manager rollups & dashboards** (counts/pipeline/activity **by rep**, scheduled delivery) | My Work is per-rep; managers read views manually | By-rep rollups + report subscriptions (scheduled CSV/PDF) |
| **Contact-level** ("contacts by role", "banks missing a CFO contact") | Basic contacts per bank | Contact reporting / coverage-gap reports |

> Codex's audit lists most of these at the object level; the table above is the **rep's-eye
> "report I'd actually run"** version, which is what maps to adoption.

---

## 4. Make it flow → sell more bonds (prioritized by impact ÷ effort)

The theme: **reuse the swap engine's proven bank↔inventory plumbing** (holdings, tax rate,
ladder gaps, desk rules) instead of building new machinery.

### P1 — Connect offerings to the book (highest leverage, mostly reuse)
1. **"Who should I call?" — Offer → Banks matcher.** Given an offering (or a Daily Intelligence
   pick CUSIP), return the rep's banks that fit, scored:
   - **Muni:** in-state (issuerState = bank state) · Sub-S→TE value, C-Corp→taxable · BQ-eligible buyers (the muni `section: "BQ"` field already exists) · fills a ladder gap from holdings.
   - **CD / funding:** banks with a **CD maturity wall** (CDs rolling off — derivable from holdings + the 553-snapshot CD history) → redeploy or re-fund.
   - **Agency/corp:** ladder-gap fit + securities/assets headroom + structure preference.
   - *Reuse:* the suggester already computes ladder gaps, tax treatment, and holdings per bank — this is that logic inverted (offer-first instead of bank-first).
2. **Wire Daily Intelligence picks to action.** Make each pick **click-through** to its explorer
   row (it already knows `page` + `cusip`) and to **"my banks that fit this audience"** (the
   `audience` segment already rides on the pick). Turns the morning read into a call list.

### P2 — Capture and forecast the funnel
3. **Opportunity pipeline** — a lightweight revenue-bearing idea (distinct from the strategy
   *workflow*) with stage / $ size / close / probability, **fed automatically** from swap
   proposals and matched offers, with a **manager forecast rollup**. Strategies→Needs-Billed
   already captures the *back* of the funnel (realized); this captures the *front*.
4. **Triggers / alerts** pushed to My Work or a daily digest: CD maturity wall per bank, bonds
   **maturing/called soon**, **gain/loss harvest** windows, new prospect, status change. These
   are the events that *start* a sales call.

### P3 — Reporting & activity depth
5. **Expand saved views** with the §3 segmentation + new/changed reports, and add **scheduled
   CSV/PDF snapshots** (report subscriptions) so managers get them without logging in.
6. **Lightweight activity/task layer** — log calls/meetings, "not contacted in N days," tied to
   banks/contacts (the missing Salesforce activity surface).
7. **Auto "Opportunities" panel on the tear sheet** — replace manual product-fit tags with
   computed flags (CD funding candidate, swap candidate, BQ-muni buyer, CECL/ALM candidate)
   from the balance sheet + holdings.

---

## 5. Optionality — what the portal can become

The strategic point: **the data is already in the building** — holdings, 1,100 daily offerings,
call-report metrics, account status, peer groups, CD history. The value isn't more data; it's
**connecting** it. Every item above is *additive* (new read endpoints + UI over existing
stores), reuses the swap engine's plumbing, and needs no new dependency. It also stays inside
the internal-only boundary ([client-facing-boundary.md](client-facing-boundary.md)) — none of
this is client-facing.

This consolidates and prioritizes ideas already floated in
`docs/company-portal-context.md` (product-fit flags, next-best-action, opportunity pipeline) and
Codex's "Worth Considering After Internal Launch" list — into the order most likely to move
bonds sold.

---

## 6. Verified vs recommended (so nothing is overstated)

- **Verified by the smoke test (facts):** §1 — the app is healthy on real data, and the swap
  suggester genuinely pairs holdings to today's inventory with full economics. The disconnects
  in §2 (picks `linksTo: null`, no offer→bank matcher, manual product-fit) are **confirmed in
  the code/API**, not assumed.
- **Recommendations (not built):** §3 report gaps and §4 flow items. None of these block the
  internal go-live — they're the post-launch roadmap to drive volume.

### Smallest first step for Codex (if we pursue P1)
A read-only `GET /api/offerings/:cusip/matching-banks?rep=` that reuses the swap suggester's
per-bank fit logic (state / tax / BQ / ladder-gap / holdings) inverted to offer-first, returning
scored banks. Everything else in P1 is UI over that one endpoint. Advisory-only, like the swap
sizer — the rep still decides.
