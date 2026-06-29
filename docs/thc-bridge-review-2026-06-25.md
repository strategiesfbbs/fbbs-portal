<!-- THC bridge review (Claude UI/product lane), 2026-06-25. Read-only review for Codex/owner.
     Grounded in: server/thc-summary-store.js (import contract) + the rendered THC surfaces
     (tear-sheet panel, Strategy Queue fields, Reports Data Sources card, Portfolio Review
     sanitization) + external research on THC Analytics (Thomas Ho Company). No code changed. -->

# THC Bridge Review — Sales-Safe Operating Layer over THC Analytics (2026-06-25)

## Scope & method

Requested by Codex: compare the portal's new THC bridge against what THC Analytics (Thomas
Ho Company) offers an admin user, and recommend how the portal should expose THC to **sales**
reps without leaking raw holdings, CUSIPs, account numbers, pledged, or safekeeping detail.

Grounded in the **actual contract** (`server/thc-summary-store.js`) and rendered surfaces, not
the feature description. THC capability claims are grounded in public research (sources at end);
where a THC specific is inferred vs. documented, it's marked.

### What's already built (and good)
- **Hard sales-safe boundary** — `importThcSummaryPayload()` recursively scans the whole
  payload and **rejects** on any forbidden *key*: `account*`, `cusip(s)`, `holdings`,
  `positions`, `rawHoldings/Positions`, `pledged`, `safekeeping` ([thc-summary-store.js:9](server/thc-summary-store.js)).
- **Contract** carries: bank/cert match, `cycle`/`asOfDate`, per-module `reportStatus`
  (alm/eve/ear/assumption/bondAccounting/portfolio/incomeRisk/tradeSimulation),
  portfolio `metrics` (book/market value, UGL, yields, WAC/WAL, eff. duration), `posture`
  (alm/policy/summary), `sectorAllocation`, `maturityCallWall`, `scenarioResults`
  (shockBp/metric/value/change/withinPolicy), `tradeSimulation` (id/status/date/summary).
- **Tear-sheet THC Report Status panel**, **Strategy Queue THC fields** (5), **Reports →
  Data Sources** admin-gated import, **"Request THC Update"** → `THO Report` strategy request,
  **Portfolio Review** server-side sanitized for non-admins (holdings/swap screens stripped,
  aggregate ladder + `rateShockProxy` kept).

The boundary model is right. The gaps are about **depth of the sales story** (EVE/NII, trade-sim
impact), **a couple of real leak vectors**, and **workflow closure** between THC admins and reps.

---

## 1. THC features to MIRROR for sales users

| THC capability | Sales-safe portal mirror | Why it matters to a rep |
|---|---|---|
| **IncomeRisk / NII (EaR)** — flagship NII + peer module (Kasasa partner) | NII-at-risk %, 12-mo NII Δ%, peer percentile — as posture + a NII scenario ladder | "Your earnings are X% exposed to +200bp" is the #1 funding/swap hook |
| **EVE / EaR ALM** | EVE %Δ ladder (−300…+400bp) + within-policy flag | Canonical IRR talking point; drives extend/shorten swaps |
| **Trade simulation / what-if** | Portfolio-level **before/after impact** block (§5) | Directly seeds a Bond Swap proposal |
| **Liquidity** | Liquidity posture (Adequate/Watch) + on-BS liquidity %, contingent-funding adequacy | Direct cue for the brokered-CD/funding desk |
| **CECL (loan-level)** | CECL **readiness/status only** (not loan detail) | Ties to the existing CECL strategy queue type |
| **Peer analytics** | EVE/NII/book-yield **percentile vs peer group** | Best objective talking point; reuses peer-report bars |
| **Key-rate-duration / scenario** | Already partly present — standardize as EVE + NII ladders | Non-parallel-shift story for callable/extension risk |

**Keep mirroring at "posture + % + readiness," never the dollar base or model internals.**

## 2. Keep ADMIN-ONLY in THC (do not mirror to sales)

- Raw holdings / positions / CUSIPs / account numbers / pledged / safekeeping *(already enforced — keep)*.
- **Deep THC links & login** (`adminLink`, per-report `link`) — see leak vector in §4.
- **Assumption-set detail**: deposit betas, decay rates, prepay speeds, model version. Sales sees
  *that* an assumption set is current, not its values (ALCO-sensitive).
- **Loan-level CECL**, deposit/product **profitability**, FTP curves.
- **Dollar EVE/NEV base, capital / Tier-1, AOCI-to-capital dollars** — sales gets **% sensitivity
  + posture**, not the capital figures (board/ALCO-sensitive).
- Regulatory exam packets, full ALCO board packages.

## 3. Fields to ADD to the sales-safe summary JSON contract

Additive to `normalizeSummaryRecord()` — all aggregate/posture, no position rows.

- **`reportStatus`**: add **`cecl`** and **`liquidity`** module rows; ensure **`incomeRisk`** renders
  (it's in `REPORT_TYPES` but appears absent from the readiness cards — verify).
- **`metrics`** (aggregate, sales-safe): `niiAtRiskPct`, `nii12moChangePct`, `eveChangePctUp300`,
  `pctUnderwater` (% of book below par), `pctFloating`, `avgPricePctOfPar`, `taxEquivBookYield`.
  *(Omit anything capital-relative — keep AOCI/capital as posture text, not a number.)*
- **`scenarioResults[]`**: add **`kind`** (`'eve' | 'nii' | 'ear'`), `pctChange`, `policyLimitPct`,
  `exception` (bool). Lets the UI render two clean ladders (EVE, NII) instead of free-text `metric`.
- **`tradeSimulation.impact`** (the big one — §5).
- **`peer`**: `peerGroupLabel`, `evePercentile`, `niiPercentile`, `bookYieldPercentile`.
- **`posture`**: add `liquidity`, `cecl` text; **`nextCycleDue`** (date) for staleness math.
- **Provenance (admin-only display)**: `assumptionsAsOf`, `modelVersion`, `preparedBy`.

## 4. Report / status / workflow gaps

**Boundary hardening (treat as correctness, not polish):**
- **Value-level scrub.** The forbidden check is **key-name only** — a CUSIP or account number pasted
  into a free-text `summary`/`notes`/`posture.summary` passes. Add a value scrubber that
  rejects/redacts CUSIP-shaped (9-char alnum w/ check digit) and account-number-shaped tokens in
  all free-text fields. This is the one real hole in the "no raw THC to sales" promise.
- **Server-side gate the deep links.** `getThcSummaryForBank()` returns `adminLink` and
  `reportStatus[].link` in full; gating is client-side. Strip both for non-admins **server-side**
  (same pattern as `sanitizePortfolioReviewForRep`). Links to THC = admin-only access.

**Workflow closure:**
- **No import dry-run.** Add `?dryRun=1` parity with the contacts/FDIC importers — preview match
  counts and, critically, **which record/path tripped the forbidden-key reject** (today it's
  all-or-nothing with one path string; admins can't see which bank to fix).
- **"Request THC Update" never closes.** On a newer-cycle import, match incoming records to open
  `THO Report` strategy requests (bank + advancing cycle) and flag them **fulfilled / newer cycle
  available** so the rep gets the handoff back.
- **No staleness surfacing.** Add per-report stale chip (asOf vs `nextCycleDue`) + a desk roll-up
  ("N banks: ALM stale / policy-exception IRR / open THC request").
- **Latest-only manifest.** Import overwrites; no cycle history. Archive prior manifests (like
  `cd-history`) to trend EVE/NII sensitivity across cycles — a strong "your risk is rising" story.
- **Not in CRM/Pulse or signals.** No THC signals chip on the tear-sheet signal strip, no Pulse KPI.

## 5. Trade-simulation outputs most useful for reps (no raw holdings)

THC's what-if is the highest-value piece, but today the contract only carries
`tradeSimulation{ id, status, date, summary }` (free text). Replace/augment with a structured,
**portfolio-level** before/after block — the portal already speaks this language (Bond Swap):

```
tradeSimulation.impact = {
  theme,                 // "Extend short USTs into 5y agencies"
  yieldPickupBp,         // +18
  durationChange, walChange,
  annualIncomeChange,    // aggregate $ (no lot detail)
  niiImpactBp,           // or annual $
  eveImpactPct,          // change to EVE sensitivity
  breakevenMonths,
  realizedGainLoss,      // AGGREGATE $ only
  lotsAffected,          // COUNT, never CUSIPs
  parTraded,             // aggregate $
  withinPolicyAfter,     // bool
  proposalReady          // → "Build proposal" handoff
}
```

Principle: **portfolio-level deltas + a one-line theme + counts**, never position rows. This maps
1:1 onto the existing Bond Swap proposal economics (income pickup, breakeven, duration), so a rep
can go THC sim → portal proposal in one click.

## 6. UI ideas from THC that fit the existing portal

- **EVE / NII ladder mini-bars** across the shock set, with policy-limit markers — CSS-only, reuse
  the Pulse-bar pattern (no chart lib, respects the strict CSP / no-CDN rule). Slots into the
  existing scenario list on the tear-sheet THC panel.
- **Posture stoplight** (green/amber/red for IRR / liquidity / policy) — reuse the `hero-status`
  pill + signal-chip pattern on the Sales Workspace signal strip.
- **Before/after comparison card** (current vs proposed portfolio metrics, two columns) for the
  trade-sim impact — mirrors the Portfolio Review / Bond Swap layout.
- **Readiness matrix with cycle/staleness coloring** — extend the existing readiness cards with the
  activity-recency color bands (green ≤cycle / amber / red stale).
- **Peer percentile bars** — reuse the peer-report bar component.
- **Pulse "ALM watch" tile** — banks with policy-exception IRR posture / stale ALM / open THC requests.

---

## Prioritized recommendations

### Must Have
1. **Structured `tradeSimulation.impact`** (§5) — highest sales-enablement value; one-click to a
   Bond Swap proposal. Portfolio-level deltas + theme + counts only.
2. **EVE + NII story**: render `incomeRisk`/NII readiness, add NII-at-risk metric, standardize
   `scenarioResults` into EVE + NII ladders (`kind`/`pctChange`/`policyLimit`/`exception`).
3. **Close the two leak vectors**: (a) value-level CUSIP/account scrub of free-text fields;
   (b) server-side strip of `adminLink` / `reportStatus[].link` for non-admins.
4. **Add `liquidity` + `cecl` report-status & posture** — wires THC into the funding desk and the
   existing CECL strategy workflow.

### Should Have
5. **Import dry-run** (`?dryRun=1`) with forbidden-key path reporting — parity with other importers.
6. **THC signals chip + Pulse KPIs** (policy-exception IRR, stale ALM, open THC requests).
7. **Close the loop** on "Request THC Update" when a newer cycle imports (mark fulfilled, notify rep).
8. **Staleness / `nextCycleDue`** chips + desk roll-up.
9. **Peer percentile** context (EVE/NII/book-yield vs peer group).
10. **THC summary cycle history** (archive prior manifests → trend sensitivity).

### Later
11. **Bond Swap ↔ THC trade-sim ID** provenance link (both directions).
12. **"THC coverage" status** in the bank list / US map (current / stale / none).
13. Aggregate sales-safe portfolio descriptors (`% underwater`, `% floating`, `avg price % of par`,
    tax-equivalent book yield) on the panel.
14. High-level **profitability** talking point (portfolio contribution / book yield vs peer) — only
    if it stays aggregate.

---

## Sources (THC Analytics research)
- [Thomas Ho Company Limited](https://thcdecisions.com/) — ALM/CECL, THC Loan Desk, 50+ report library
- [About — Thomas Ho Company](https://v2.thcdecisions.com/v2/about.asp) — ALM with loan-level CECL (2018), key-rate-duration, securities valuation
- [Kasasa × THC IncomeRisk partnership](https://www.prnewswire.com/news-releases/kasasa-announces-partnership-with-the-thomas-ho-company-for-income-risk-assessments-301812727.html) — IncomeRisk: NII drivers, risk/return, peer comparison
- [Ho–Lee model](https://en.wikipedia.org/wiki/Ho%E2%80%93Lee_model) — THC's interest-rate-modeling heritage

*Read-only review — no code changed. Implementation belongs to Codex's backend lane (contract +
routes) with the UI surfaces in the shared facelift lane once the All-Offerings workbench lands.*
