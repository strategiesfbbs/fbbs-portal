# Trade History Intelligence Brainstorm (2026-06-26)

Purpose: turn the full Pershing trade tape into a relative-value and customer-pattern
layer for daily picks, bank tear sheets, RIAs / money managers, and rep call lists.

This is a product and implementation brainstorm, not an approved build plan.

Implementation seed added 2026-06-26: `server/trade-fit.js` now builds
recency-weighted product-structure, size, and price appetite from `pershing_trades`
and feeds it into the Sales Dashboard relative-value engine as a small nudge.
The nudge can favor current buyer appetite such as deep-discount callable agencies
or 5-10y final CMOs, but it still cannot override the core relative-value score.

## Live Data Check

The row-level trade table is present in `data/bank-reports/pershing-accounts.sqlite`
as `pershing_trades`.

Current import shape:

- 130,338 total trades.
- 106,993 buys and 23,345 sells.
- 2014-06-24 through 2026-06-24.
- 61,146 trades matched to portal bank IDs.
- 130,338 rows have quantity/par, price, and maturity date.
- 121,971 rows have YTM; zero rows currently carry source YTW.
- `yield_source='estimated'` is common, so analytics should label historical yield
  as estimated unless the upstream file later supplies transaction yield.
- `principal` is empty/zero in the current import; sizing should use
  `ABS(quantity_or_par)` unless a better notional field is added upstream.

Fixed-income buy mix by security type:

| Type | Buy trades | Par / quantity | Avg par | Avg life | Avg price | Avg yield |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GOVTSEC | 12,018 | 9.91B | 824,938 | 4.51y | 98.600 | 2.854% |
| MUNIDEBT | 35,499 | 9.09B | 256,159 | 8.21y | 103.589 | 2.746% |
| MONEYMKT | 47,059 | 6.56B | 139,344 | 2.16y | 99.991 | 3.036% |
| ASSTBACK | 1,922 | 2.61B | 1.36M | 19.05y | 102.038 | 2.935% |
| CORPDEBT | 7,491 | 1.37B | 183,148 | 7.27y | 98.083 | 4.685% |

Recent buys show the current-cycle shift:

- 2026 YTD: government paper has the largest par volume, followed by CDs, munis,
  ABS/MBS, then corporates.
- 2026 average corp life is longer than 2024-2025, while 2026 government buys
  average roughly 6 years.
- CD and muni purchase sizes cluster in sub-$250K clips; government and ABS/MBS
  show much larger block behavior.

The existing `server/trade-fit.js` profile already segments historical buys into
C-corp bank, S-corp bank, and RIA / non-bank buckets. It currently uses coarse
asset class, maturity band, state, and issuer demand as a light nudge inside
`server/daily-dashboard-rv.js`.

## What This Should Become

Build a Trade Intelligence Engine with two separate jobs:

1. Measure what the bond is worth today.
2. Measure who historically buys that kind of bond, in that kind of market.

Relative value should remain the primary ranking spine. Trade history should not
rescue rich paper. It should answer "who should care?" and "how should I pitch
this?" when two or three current offerings screen similarly.

## Historical Enrichment

Every historical trade should be normalized into a richer analytical row:

- Customer/account: bank ID, bank state, owner, status, tax type, assets, deposits,
  loan/deposit ratio, liquidity signals, RIA/non-bank bucket.
- Security: CUSIP, issuer, security type, sector, state, coupon, price, maturity,
  call date, effective life / average life proxy, par, side.
- Trade economics: clean price, YTM/YTW when available, estimated yield fallback,
  dollar principal if available, markup/commission if available.
- Matched market: interpolated Treasury at effective life, spread to Treasury,
  2s10s / 5s30s curve, FRED IG/HY OAS for credit backdrop, FDIC CD rate for CDs,
  MMD scale / muni-UST ratio for munis where archive data exists.
- Market regime: Fed hiking/paused/cutting proxy, rates rising/falling over 30/90d,
  curve inverted/steepening/flattening, credit spreads rich/cheap, muni ratios
  rich/cheap, inflation/labor trend.

The current portal only has archived economic/MMD/relative-value package files
from May/June 2026, plus current market caches. For 2014-2026 historical market
enrichment, we need a durable historical benchmark store. Treasury curves are the
first priority because they let us convert almost every trade into a spread.

## Customer Pattern Model

For each bank, RIA bucket, rep, tax audience, and optionally state/region:

- Typical par size: median, p75, p90, max, and by product.
- Product mix: CD, muni, agency/Treasury, corporate, MBS/CMO.
- Maturity / average-life comfort: band shares and weighted-average life.
- Yield behavior: absolute yield target, yield percentile bought in that period,
  spread-to-Treasury target after historical enrichment.
- Price behavior: discount/par/premium preference.
- Structure behavior: callable tolerance, bullet preference, BQ preference,
  premium-call avoidance, long-duration tolerance.
- Sector/state preference: muni state, issuer type, corporate sector if parsed,
  agencies/FHLB/FNMA/FHLMC, CD issuers.
- Timing behavior: buys after selloffs, buys in inverted curves, extends when
  the Fed is near peak, rotates to CDs when CD pickup is positive.
- Repeat behavior: repeat issuers, repeat CUSIPs, repeat maturity shelves.

This produces facts like:

- "This C-corp bank usually buys CDs and 1-5y government paper in $100K-$500K
  clips, but it has also bought MO/TX munis when BQ-adjusted value was compelling."
- "This S-corp profile is much more muni-heavy and more willing to buy 10y+ paper."
- "This RIA/non-bank bucket buys CDs and munis most often, with strongest maturity
  demand in 3-7 years."

## Scoring Model

Keep two explicit scores:

### 1. Relative Value Score

Already mostly lives in `server/daily-dashboard-rv.js`.

Inputs:

- UST spread at matched effective life.
- MMD spread / implied grade for munis.
- Muni-UST ratio cheapness.
- FDIC CD rate pickup.
- Peer-cohort spread.
- Risk penalties: long life, call risk, premium, tiny blocks, weak credit.
- Archive movers where available.

### 2. Buyer Pattern Score

Expand `server/trade-fit.js`.

Inputs:

- Asset-class match.
- Maturity / average-life band match.
- Size match.
- Price/coupon/structure match.
- State / issuer / sector match.
- Historical spread/yield target match once market enrichment exists.
- Current bank-specific fit when launched from a tear sheet.
- Audience-level fit when launched from Sales Dashboard.

Composite ranking should be conservative:

```text
finalScore = relativeValueScore
           + small buyerPattern nudge
           + bank-specific fit nudge when a bank is selected
```

No current offering should become a pick if it is rich to benchmark simply because
customers historically bought that type of bond.

## AI Pitch Layer

The AI should receive only a compact, grounded packet:

- Current CUSIP and offering facts.
- Current RV facts.
- Historical buyer-pattern facts.
- Similar historical purchase examples, aggregated or capped.
- Market-regime comparison.
- Caveats.

The model can write:

- Headline.
- "Why it screens."
- "Who to call."
- "What to say."
- "What objection to expect."
- One fallback substitute if the bond is sold.

Every number, CUSIP, yield, spread, and customer pattern should be re-attached
from server-side data, following the existing `daily-dashboard-judgment.js` and
`offerings-pick.js` discipline.

## Product Surfaces

### Sales Dashboard

- Picks by C-corp banks, S-corp banks, and RIAs remain.
- Add buyer-pattern reasons under each pick.
- Add "historical demand" chips: size fit, maturity fit, sector fit, repeat issuer,
  in-state muni demand, buys this structure in inverted curves.

### Pick of the Day

Make BOTD explain both:

- Why this bond is cheap today.
- Why the desk has historical buyers for it.

### All Offerings

Add sortable/chippable columns:

- RV score.
- Buyer-fit score.
- Likely audience.
- Typical buyer size.
- Historical demand band.
- "Who should I call?" action.

### Bank Tear Sheet

Add a Trade Memory panel:

- Product mix.
- Size comfort.
- Maturity comfort.
- Recent purchases.
- Favorite issuers/sectors/states.
- Last purchase by product.
- Current offerings that look like past purchases.

### Today's Fits

Current `findOfferingFitsForBank()` can become trade-history aware:

- Filter/boost current offerings by this bank's actual historical behavior.
- Surface "similar to what they bought on YYYY-MM-DD" without overexposing raw
  private detail in AI prompts.

### Rep Workspace

New page or dashboard card:

- "Best current bonds by historical buyer pool."
- "Banks that have bought this sector before."
- "Accounts due for a similar replacement."
- "RIA accounts that buy this maturity/sector pattern."

## Implementation Path

### Phase 1: Deterministic Trade Analytics

- Add `server/trade-history-analytics.js`.
- Compute rollups from `pershing_trades`.
- Add bank-level and audience-level profiles.
- Use quantity/par for size.
- Label YTM as estimated when `yield_source='estimated'`.
- Add tests with synthetic trade rows.

Suggested APIs:

- `GET /api/trade-history/summary`
- `GET /api/banks/:id/trade-profile`
- `GET /api/trade-history/audiences`

### Phase 2: Historical Treasury Benchmark Store

- Add a local historical Treasury curve store.
- Backfill daily curves for 2014-present from an approved public source.
- Interpolate each trade to maturity/effective life.
- Store or cache `ust_yield_at_trade` and `ust_spread_bps`.

Suggested module:

- `server/historical-market-store.js`

### Phase 3: Buyer Pattern Scoring

- Expand `server/trade-fit.js` from coarse audience profile to:
  - size match
  - price band match
  - life band match
  - historical spread band match
  - bank-specific profile
  - RIA/non-bank profile
- Keep the score small relative to RV.

### Phase 4: Current Offering Match

- Enrich `buildRelativeValue()` output with expanded buyer fit.
- Add buyer-fit chips to Sales Dashboard and All Offerings.
- Upgrade `findOfferingFitsForBank()` to consume bank trade profiles.

### Phase 5: AI Narrative

- Add a grounded "trade memory" block to the existing daily dashboard judgment
  packet.
- Add admin-gated refresh only if prose is billable.
- Keep deterministic fallbacks.

## Open Questions

- Can the upstream trade file provide source YTW, principal, commission/markup,
  sector, and call date? Current import has estimated YTM but no source YTW.
- Should non-bank/unmatched Pershing rows all be treated as RIA/money-manager, or
  should they be further segmented?
- Do we want historical Treasury backfill in the portal, or should a one-time CSV
  of historical curves be dropped into `data/market/`?
- How much raw bank-specific trade detail can be shown to reps versus summarized
  for compliance/readability?
- Should AI see bank names and exact historical trades, or only aggregated
  profiles and capped examples?

## Recommended First Build

Start with Phase 1 and a small part of Phase 3:

1. Build bank-level and audience-level trade profiles.
2. Add size, maturity, product, state, issuer, and price-band scoring.
3. Feed that into Sales Dashboard and Today's Fits as qualitative chips.
4. Then backfill historical Treasury curves and graduate from "bought similar
   bonds" to "bought similar relative value in similar markets."

This gets visible value quickly and keeps the deeper market-regime work from
blocking the first useful release.
