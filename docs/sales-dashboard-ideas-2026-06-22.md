# FBBS Sales Dashboard — Relative-Value Reframe: Idea Catalog

*Brainstorm doc for the desk owner + Codex (2026-06-22). Every signal below was checked against today's live package (`data/current/`, 06-22) and the 06-12 archive. This is a menu to react to, **not a build plan** — no Sales Dashboard work is committed off it yet.*

> **Owner decisions (2026-06-22):**
> 1. **Status: brainstorm only.** Hold all building until the owner has reacted to this catalog and synced with Codex. Nothing here is approved to implement yet.
> 2. **Retire the uploaded-HTML dashboard entirely.** The native `#sales-dashboard` becomes the one and only "Sales Dashboard" everywhere; remove the legacy uploaded-HTML `dashboard` page/slot completely (not just relabel it). This is more invasive than a nav tweak — it touches the daily-package slot machinery (`SLOT_NAMES`/`DOC_TYPES`/`UPLOAD_SLOTS` in server.js + portal.js, the home tile, upload + Package QA, `classifyFile()`, the sandboxed iframe viewer). Plan it as its own scoped change and coordinate with Codex, since the package layout is shared.
> 3. *(Open)* The dedicated tax-modeling lens (§4) errored mid-run; re-run available on request for deeper custom-rate / state / BQ / Sub-S depth.

---

## 1. The reframe

Today the dashboard ranks picks by effective yield, so a long-dated 4.9% bond always beats a genuinely cheap 5-year — exactly the owner's complaint. The shift: **rank on relative-value merit, not yield or tenor.** Surface what is *dislocated* — paying more spread than its peers, cheaper than its rating's MMD scale, beating Treasuries at its own tenor, or that *cheapened overnight* — and frame each on the tax basis the specific client cares about. The dashboard becomes a desk strategist, not a yield sorter.

---

## 2. Relative-value signals

### A. Spread-to-Treasury (agencies, corporates, CDs)

| Signal | Math | Data | Audiences | One-line example |
|---|---|---|---|---|
| **Agency callable spread-to-worst** — closes the blind spot: **442 of 487 agencies (91%) carry no `askSpread`; only the 45 bullets are pre-spread.** | Interpolate UST par curve at years-to-maturity and years-to-call; `spreadToMat=(ytm−USTmat)`, `spreadToCall=(ytnc−USTcall)`; headline `MIN()` so you never flatter the leg that won't happen. Rank per 2/3/5/7/10y bucket. | **have** — `ytm`+`ytnc` present on all 442 callables; curve interpolatable | all | "FHLMC 5.00 '31 callable 9/26: +61bp to maturity (spread-to-worst), widest 5y callable in today's book, beats the bullet at +30." |
| **CD cheap-to-Treasury pickup ladder** — recreates the old RV tab's *starred tenors*. | `pickupBp=(CD.rate−USTat(termMonths))×100`; best CD per bucket; **star ≥+10bp, flag RICH <0** (CD through the bill). Optional second leg: pickup vs FRED FDIC national-avg CD. | **have** — 180 CDs with `termMonths`+`rate`; the RV table already publishes `cdSpread` per tenor | ccorp, scorp | "Star strip: 1mo +25 · 18mo +9 · 48mo +10. AVOID 7/13/15mo and 10y — through Treasuries." |
| **Agency bullet vs same-tenor corp vs CD** — the spread-*product* decision. | Per tenor: agency bullet `askSpread` (pre-computed) vs median corp spread for the tier vs best CD pickup. Star the winning product per tenor by spread-per-quality. | **have** — 45 bullets pre-spread; corp cohorts; CD ladder | all | "5y: UST 4.27 \| best FHLB bullet +9 \| median A-corp +49 \| best 60mo CD +8 → CD adds nothing over the agency, skip it." |
| **Deep-discount callables as synthetic bullets** — call deeply out of the money. | Flag when `coupon ≤ USTmat − ~50-75bp` and price below par; headline `spreadToMat`, note "call ~0% — treat as bullet." Cross-check the existing maturity-calendar call-likelihood logic. | **have** — `coupon`/`askPrice`/`ytm` present | all | "FHLB 2.50 '30 @ 89: coupon ~180bp under market, call meaningless → effective 4y bullet, +38bp, call protection for free." |

### B. Muni relative-value (the owner's "good price relative to rating")

| Signal | Math | Data | Audiences | One-line example |
|---|---|---|---|---|
| **Cheap-to-its-own-grade** — the headline muni RV signal. | Map rating → MMD bucket (aaa/aa/a/baa). `cheapVsGradeBp=(ytw − interp(MMD[bucket], t))×100`. Flag ≥+20 cheap, ≥+35 standout. | **have** — verified: `_mmd.json.curve` carries `aaa/aa/a/baa/insured/preRefunded` per term 1-30y; munis carry `moodysRating/spRating/ytw/maturity` | ccorp, scorp, ria-muni | "GA AA 3% '36 @ 3.50% YTW = +41bp over the AA MMD scale at 9.5y — pays like a low-A, rated AA." |
| **"Yields like a lower grade" badge** — the discrete, say-it-on-the-phone version. | Find the lowest MMD bucket whose yield ≤ the bond's YTW; `notchesCheap = impliedGrade − actualGrade`. Badge when ≥1 notch. | **have** | all | "NE AAA 4% '37 @ 3.40% → yields like single-A, rated AAA (+2 notches cheap)." |
| **Muni/UST ratio cheapness by tenor** — rate-level-independent. | `ratioPct=ytw/UST(t)×100`; compare to `_mmd.json.treasuryRatios` AAA benchmark (2Y 57 / 5Y 62 / 10Y 67 / 30Y 87). Flag `ratioPct ≥ aaaRatio+8`. | **have** — ratios verified present | ccorp, scorp, ria-muni | "IA AA '42 at 86% of UST vs ~80% on the AAA scale at that tenor — cheap on ratio AND grade." |
| **Credit-enhancement re-score** — price insured/state-aid paper at its *enhanced* grade. | If `creditEnhancement` set: BAM/AG/AGM → benchmark vs `curve[].insured`; ST-AID/INTERCEPT/PSF/Q-SBLF → AA floor. Show a shield chip + cheapness to the *enhanced* scale. | **have** — `creditEnhancement` parsed; MMD has a dedicated `insured` column | ccorp, scorp, ria-muni | "AG-insured IA '30 @ 2.93% = +26bp cheap to the *insured* MMD scale, not just +40 to AAA." |
| **Same-state / same-grade ladder outlier** — the local cheap lot. | Cohort = (state, ratingBucket); fit yield-vs-tenor (linear regression, n≥4); flag `residual ≥ +12bp`. Thin cohorts → nearest-tenor peer diff. | **have** — intra-inventory only; MI n=28, WI/TX n=12 form clean ladders | ccorp, scorp, ria-muni | "Cheapest on the MI AA curve at ~12y: +12bp vs the same-state ladder fit." |

### C. Peer / cross-sectional outliers (corporates)

| Signal | Math | Data | Audiences | One-line example |
|---|---|---|---|---|
| **Peer-cohort spread outlier** — the cleanest "this one sticks out." | Cohort = `creditTier + benchmark` (n≥5); `outlierBp = askSpread − cohortMedian`. Flag ≥+20bp. Tie-break by `availableSize`. | **have** — verified cohorts: A\|10Y n=36, BBB\|10Y n=31, A\|5Y n=24, BBB\|5Y n=18 — plenty deep | ria, ccorp | "BBB/5Y cohort (n=18) median +64bp; one name at +182 = +118 over median, >2x the cohort." |
| **Spread-per-year-of-duration** (10yr-and-in) — carry *density*, not raw spread. | Restrict to ≤10y; `efficiency = spreadBp / duration` (effective dur if present, else modified-dur proxy, labeled). Rank per asset class. | **partial** — spread present; duration is a proxy unless a sector sheet carries it | all | "3.5y A-corp +55 / 3.2dur = 17bp/yr beats a 9y BBB +85 / 7.4dur = 11bp/yr — most spread per year of risk." |
| **OAS regime backdrop** — turns a number into a call. | FRED IG/HY OAS (bp) + 90-obs history percentile; tag the whole section "spreads RICH/CHEAP/NEUTRAL vs market." **Index-level only — never per-CUSIP OAS** (licensing). | **have** — `fred-series.js` IG/HY OAS with history | ria, ccorp | "IG OAS 92bp, 30th pctile of its 90-day range (tight) → the cohort isn't cheap broadly; the +182 outlier is where value is." |

---

## 3. Trends & movers (archive-driven — ~20 prior days available)

Verified: **200/200 corporates CUSIP-match the 06-12 archive; 115 moved ≥2bp.** Day gaps are irregular (1-13d) — every signal must stamp "vs {prior date} ({N} days ago)."

| Signal | Math | Data | Why it matters |
|---|---|---|---|
| **Cross-day spread movers** (cheapened / richened) | Join by CUSIP; `dSpread = today − prior`. Positive = cheapened. Surface \|dSpread\|≥3-5bp. On 06-22 the whole curve sold off ~14bp — **only the spread delta** isolates which names actually got cheaper. Munis (spread null) fall back to YTW-minus-UST. | **have** | The owner's explicit "actual trends" ask — strips out the parallel curve move that inflates raw yields. |
| **Asset-class regime shift** — diff the desk's own RV table | Diff `_relative_value.json` per tenor across days; mean delta per class. Flag "CD spreads compressed ~10bp — cheap-CD window closing" / "munis cheapened ~15bp/tenor." | **have** — RV table verified diffable | Strategist-level "the trade has moved," drives the macro→pick connector. |
| **New on offer today** | `today CUSIPs − prior CUSIPs`, filtered through the *same RV lens* (new AND attractive, not just new), capped at the $250K floor. | **have** | Freshest pitch; new paper prices to move. |
| **Supply-concentration radar** | Group new-today by state (muni) / sector (corp); flag a bucket ≥30% of new supply. **Verified: 9 of 23 new munis are WI (39%) — a real Wisconsin issuance wave.** | **have** | Concentrated supply = negotiating leverage + likely cheapening; ties to in-state-muni boost. |
| **Rolled-off alert + substitute** | `prior − today`; for each gone CUSIP find nearest live substitute (class, ±12mo, adjacent rating, min yield diff). Prioritize watchlisted/featured names. Split matured vs pulled. | **have** | Reps get caught quoting dead inventory. |
| **Curve regime read** (from econ deltas) | `_economic_update.json` carries `dailyChange`/`weeklyChange` per tenor → 2s10s/5s30s slope move *without a second source*. Map regime → which part of curve to sell. | **have** | Bear-flattener → front-end is the value; bull-steepener → lock 7-10y duration. |
| **Curve-kink scanner** | Bucket by maturity; kink = bucket whose pickup over its two neighbors exceeds a threshold; diff vs prior to see if the dislocation is opening or closing. Add carry-and-roll. | **have** | The single maturity that "sticks out" for carry. Effort L. |
| **"What changed" desk-read digest** | Deterministically assemble top movers + regime + new-supply + roll-offs, score by normalized \|delta\|, cap 6 bullets, feed the CUSIP-validated facts to the existing judgment layer for prose. | **have** — wraps `daily-dashboard-judgment.js` | The morning brief that replaces opening the dashboard cold. |

---

## 4. Audience & tax model

**Recommended audience set** (replaces today's 3):
- **C-Corp 21%** — BQ math matters most here.
- **S-Corp 29.6%** — Sub-S gross-up.
- **RIA / high-bracket individual 40.8%** (37% fed + 3.8% NIIT) **+ a custom panel**: editable federal rate, state rate, buyer state. This is the owner's explicit "custom tax rates" ask.

**Two tax fixes that add real depth:**

1. **BQ-correct TEY with the TEFRA disallowance baked in.** Today's `YTW/(1−t)` *overstates* tax-equivalent yield — the judgment layer already admits it excludes the TEFRA cost of carry. Use the verified, cell-validated `swap-math.municipalTeYield`: `effYield = (YTW − COF·t·q)/(1−t)`, with `q` = BQ disallowance (C-Corp BQ 0.20 / non-BQ 1.00; **S-Corp BQ 0** / non-BQ 1.00). Show the haircut as a small "−Xbp TEFRA" note so BQ paper *visibly* beats non-BQ.
   - *Verified example:* BQ muni YTW 3.15%, C-Corp, COF 1.5%, q=0.20 → 3.91% (−8bp TEFRA). Same YTW non-BQ → 3.59% (−40bp). **BQ wins by ~32bp** — now legible on the card.

2. **In-state double-exempt for the RIA/individual.** Two munis with identical YTW are *not* equivalent to a taxed-state resident. With the custom panel: in-state → `YTW/(1−fed)`; out-of-state → owes ~`YTW·stateRate`. Rank in-state up by that advantage.
   - *Example:* WI muni 4.03% for a WI resident at 37%+7.65% → 6.40% double-exempt; an out-of-state bond costs ~31bp of state tax. (Inventory is WI/MI/IA/TX-heavy today — matches are realistic.) **partial** — needs the custom buyer-state input.

**The reframe per audience** (same picks, different WHY): C-Corp/S-Corp muni picks lean on TEY + MMD-cheapness (after the BQ caveat); RIA picks lean on spread-to-cohort and never quote a bank TEY. Add a de-minimis tax flag (§ below) that flips a discount muni from "bargain" to "ordinary-income trap" per the taxable audience.

**De-minimis flag** (S effort, real money): `threshold = 100 − 0.25·yearsToMaturity`; `price < threshold` (equality = ordinary income, per the 06-11 math audit) → amber "accretion taxed ordinary"; else green "LT cap-gain." Verified: GA 3% '36 @ 95.98 breaches (97.62 threshold); the long MI 4%s are safe. Two bonds that look identical on a yield sort get opposite tax flags.

---

## 5. Scoring & presentation

**Composite Relative-Value Score (0-100)** — the spine. Per row, up to 4 normalized sub-scores, renormalized over whichever are available:
- `0.40` spread-cheapness (z-score vs `(class, tier, maturity-bucket)` cohort)
- `0.30` cheap-to-curve (YTW − interpolated benchmark, vs class median pickup)
- `0.20` rating-adjusted (munis: YTW/TEY − MMD tier yield)
- `0.10` structure bonus (deep-discount-to-call / clean bullet)
- *(optional 5th, low weight: recent-cheapening percentile from the cross-day diff)*

Output `rvScore` + a **dominant-driver string** ("+28bp vs BBB 5-7y peers"). A BBB 5y at +28 (cohort median +14) scores ~85 and tops the RIA list even though a 20y agency yields more. **Effort L — this is the centerpiece.**

Everything else hangs off the score:
- **"Today's Standouts" hero** — top 3-5 by `rvScore` across *all* asset classes (issuer-deduped), each with its one-line WHY. Minimum-score threshold so a flat day honestly shows fewer rather than manufacturing standouts.
- **Outlier chips** — 2-3 per row, the score's signals as glanceable badges ("+14bp cheap to AA MMD", "best CD pickup 18mo", "widened 12bp since 6/12"). Reusable on All Offerings + tear-sheet Today's Fits.
- **BOTD / SoD on merit** — Bond-of-Day = highest-`rvScore` quality name (keep the "exclude the largest liquid block" guard); Strategy-of-Day = the day's dominant driver *theme* ("credit cheapening: 3 IG corps +20-28bp as OAS widened"), not "top class by yield."
- **Compact KPI/driver strip** — extend the shared market-snapshot band with a muni/credit row: MMD AAA 2/5/10/30, muni/UST ratios, IG/HY OAS, 2s10s daily move. Frames *why* today's standouts are cheap.
- **"Why this scores" expandable** — per pick, the cohort, the median, this bond's spread, the MMD tier, the curve pickup — every number re-attached from data (same discipline as the swap engine). Makes the score defensible on a client call.
- **Per-audience narrative** — Claude names the dislocation *and* the trade logic for that tax structure; keep the single `→` connector invariant, numbers re-attached server-side.

**Nav cleanup** (S, UX): make the native `#sales-dashboard` *be* "Sales Dashboard"; demote the legacy uploaded-HTML "Published Dashboard" (the optional `#dashboard` slot) to Operations → Package QA. Single-source the brand. Slot stays optional in the package; only its prominent nav entry moves.

---

## 6. Prioritized roadmap

### Quick wins (have the data, high impact)
| Idea | Why it stands out | Data | Effort | Impact |
|---|---|---|---|---|
| **Agency callable spread-to-worst** | Lights up 91% of the agency book that has zero spread visibility today | have | M | high |
| **CD cheap-to-UST star/AVOID ladder** | Recreates the old RV tab; tells reps which tenors to push and which are *through* Treasuries | have | S | high |
| **Cross-day spread movers** | The owner's "actual trends" ask; 200/200 corp overlap verified | have | M | high |
| **RV-table regime-shift banner** | "Cheap-CD window closing / munis cheapened" — strategist read in one line | have | S | high |
| **Cheap-to-grade + "yields like a lower grade" badge** | The owner's core muni ask, as a discrete say-it-out-loud signal | have | S-M | high |
| **Muni/UST ratio cheapness** | Rate-level-independent RV; ratios already published | have | M | high |
| **Peer-cohort spread outlier** | "+118bp over its cohort" — cleanest stands-out signal | have | M | high |
| **New-today + WI supply radar** | 9 new WI munis = negotiating leverage; freshest pitch | have | S-M | high |
| **BQ-correct TEFRA TEY + de-minimis flag** | Fixes overstated tax math; BQ visibly worth ~32bp | have | S-M | high |
| **"Today's Standouts" hero + outlier chips** | The lead surface; what a rep reads first | have (needs score) | M | high |

### Bigger bets
| Idea | Why | Data | Effort | Impact |
|---|---|---|---|---|
| **Composite RV score** | The spine everything ranks on — replaces the yield sort | have | L | high |
| **Desk-read digest** (wraps judgment layer) | The morning brief; fuses every cross-day signal | have | M | high |
| **Curve-kink + carry-and-roll scanner** | The single maturity that sticks out for carry | have | L | med |
| **In-state double-exempt + custom tax panel** | The owner's "custom rate" ask for RIA/individual | partial | M | med |
| **Spread-per-year-of-duration** | Carry density inside 10y | partial (dur proxy) | M | med |
| **Premium-vs-discount structure pairing** | Same curve, audience-specific call (bank vs RIA) | have | M | med |

---

## 7. Data gaps / open questions

- **Effective duration** is not reliably parsed across sectors → the spread-per-year-of-duration screen leans on a modified-duration proxy. Decision: ship with the labeled proxy, or wire effective duration from the bond-accounting/sector sheets where present?
- **CD spread is computed, not parsed** (no spread field) — fine via UST interpolation, but the CD curve has gaps at odd tenors; interpolation quality at 7/13/15mo should be sanity-checked against the desk's own RV table.
- **Per-CUSIP OAS is off-limits** (Bloomberg/BVAL licensing). The OAS backdrop is index-level only (FRED IG/HY) — confirm that framing is enough for the desk.
- **Custom tax panel** needs three new inputs (buyer state, fed rate, state rate) and a state-tax table; the in-state advantage is approximate (taxes the coupon, ignores state treatment of OID/premium amortization). Acceptable for a sales-color tool?
- **Archive day gaps are irregular (1-13d)** — every trend signal must disclose the comparison window; a 13-day "overnight move" is misleading if unlabeled. Need a desk rule: skip the mover strip if the prior package is >5 business days stale, or always show with the gap?
- **Muni same-state ladder fit** needs n≥4 per (state, grade) cohort — thin states (n<4) fall back to nearest-tenor peer; confirm that's acceptable vs suppressing the signal.
- **S-Corp BQ q=0** (full disallowance) per Vainisi — worth a desk confirmation that this is the firm's standing interpretation before it drives a visible TEY number.

Relevant files for Codex: `server/daily-dashboard.js` (candidate/tax layer), `server/daily-dashboard-judgment.js` (Claude ranking), `server/swap-math.js` (`municipalTeYield` — reuse, don't reinvent the TEY), `server/market-rates.js` (UST interpolation), `server/fred-series.js` (OAS), `data/current/_relative_value.json` + `_mmd.json` (the two pre-computed RV/scale tables that make most "quick wins" cheap to build).
