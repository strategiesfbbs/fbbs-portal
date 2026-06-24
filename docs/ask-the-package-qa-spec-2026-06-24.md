# AI-7 — Grounded "Ask the package" Q&A box (spec)

Status: **proposed only — needs owner decision before any build.** This is a paid, free-text AI surface; it must not ship until the owner funds it, sets a cost ceiling, scopes the grounded corpus, and signs off on the no-advice (FINRA) answer boundary. The engine design below is written so that, once those calls are made, the build is purely additive and follows the portal's existing AI discipline 1:1.

Effort: **L.** Blast radius: **medium** — one new pure module + one new GET route + one new SPA page; no schema change, no new npm dep, no change to any existing parser/store/explorer. The risk is not the code size; it is that this is the first *open-ended* prompt surface in the portal (every existing consumer asks Claude a fixed question over a fixed candidate set), so the corpus-selection, grounding, and FINRA guardrails carry the weight.

Loop-safety: **owner-gated, NOT loop-safe.** An unattended agent must not turn this on: it spends real money on every question and it is the surface most likely to wander into advice/recommendation territory. Build the deterministic skeleton + tests in the loop if desired; do not wire the billable route or expose the page without the owner present.

---

## 1. Problem / why

The portal has parsed, validated, cross-asset data on disk every morning — today's 10-slot package, the All Offerings registry (`cusipSearchSources()`), the relative-value read (`daily-dashboard-rv.js`), the bank tear sheets, and the CRM timeline — but a rep can only get at it by knowing **which page** answers their question. "What agency callables matured-by 2030 are cheapest to the curve today?" "Is there anything in-state for a Texas C-corp bank?" "Which of my banks have CDs rolling in 30 days?" — every one of these is answerable from data already in memory, but the rep has to navigate to the right explorer, set the right filters, and read it off. There is no single place to *ask* the package a question in plain English and get a grounded answer with a link back to the surface that proves it.

The desk already pays for a Claude budget (`server/claude-client.js`, configured + live on this box). The three existing consumers (`daily-summary.js`, `offerings-pick.js`, the Sales Dashboard trio) prove the discipline works: Claude only ranks/explains, every number is re-attached from our own parsed data, every CUSIP is validated back against the candidate set, and a no-key/failure/hallucination path degrades deterministically instead of throwing. "Ask the package" applies that same skeleton to a free-text retrieval-grounded Q&A — the natural next AI surface, explicitly logged in `docs/feature-backlog-2026-06-24.md` as `AI-7` (strategic bet, `needs-owner-decision`).

What makes it harder than the existing consumers, and why it needs a spec rather than a loop task:

1. The question is **open-ended**, so we cannot pre-build one fixed candidate set. We need a *retrieval* layer that picks the right slice of the corpus per question — without adding a vector DB or any new dependency.
2. A free-text answer surface is where FINRA exposure lives. The portal is "For Institutional Use Only," but an open Q&A box can be coaxed into "should I buy this?" / "is this suitable for my client?" — and the firm cannot have the portal generate investment advice or suitability conclusions. The boundary has to be designed in, not bolted on.

---

## 2. Exact approach

### 2.1 Retrieval without a vector DB (the corpus + selection)

No embeddings, no new dep. The corpus is **already structured and small** (one trading day's package + standing inventories + the bank universe), so retrieval is keyword/registry selection over the existing in-memory reads, exactly the pattern `buildGlobalSearch()` (server.js ~9955) and `cusipSearchSources()` (server.js ~7807) already use. The retriever's job is to assemble a **bounded, grounded context dict** — the same kind of compact, pre-grounded object `dailySummary.buildSummaryInput()` and `offeringsPick.buildCandidateSet()` produce — and hand only that to the model.

New pure module `server/ask-package.js` (modeled cell-for-cell on `offerings-pick.js`: pure `buildContext` / `buildPrompt` / `parse` / `ground` + injectable `createMessage` + a billable generate). The server passes it the already-loaded reads; the module never does I/O except its own cache file.

**Grounded corpus (the retrieval sources), all already loaded server-side:**

| Domain | Source helper (exists) | What it contributes |
|---|---|---|
| Cross-asset inventory | `buildAllOfferingsRows()` → rows with `{cusip, assetClass, sector, state, coupon, yield, ytm, ytnc, maturity, price, availabilityK, callDate, moody, sp}` | Every security on offer today, one row shape |
| Relative-value read | `daily-dashboard-rv.js` `buildRelativeValue()` via the FREE live dashboard (`dailyDashboardJudgment.buildLiveDashboard`) | Per-CUSIP `rv` (spreads, score, bucket, trend, net TEY), Standouts, movers, regime |
| Market backdrop | `dailySummary.buildSummaryInput(econ, meta)` | Treasury curve, 2s/10s, marketRates, headlines, offering counts — already the grounded macro input |
| MMD / curve | `loadCurrentMmdCurve()`, `marketRates.getLatestYieldCurve()`, `fredSeries.getFredIndicators()` | Muni scale, official par curve, rate benchmarks |
| Banks / CRM | `searchBanks(q)`, `getBankById(id)`, `lastActivityByBank()`, `findOfferingFitsForBank(id)`, the task/CD-rollover slices | Per-bank facts and rep-scoped coverage signals |

**Selection algorithm (deterministic, pre-model):**

```
buildContext(question, sources, { rep, maxRows }) →
  1. Normalize the question the same way buildGlobalSearch does
     (lowercase, strip non-alphanumerics, split into terms).
  2. Detect intent facets by keyword (a small static map, NOT NLP):
       - asset-class words  → muni/agency/corporate/cd/treasury/mbs/structured
       - filter words       → "in-state", a 2-letter state token, "callable",
                              "matures by <year>", "min yield", "BQ", "tax-exempt"
       - audience words     → "c-corp"/"s-corp"/"ria"/"bank" → tax lens
       - bank/CRM words     → a bank name match via searchBanks, "my banks",
                              "rolling"/"maturing" (CD rollover), "cold"/"no touch"
       - CUSIP-shaped token  → pin that security (cusipSearchSources rejoin)
  3. From buildAllOfferingsRows + the rv read, FILTER to rows matching the
     detected facets, then rank by rv.score (fallback yield) and slice to
     maxRows (default 40, hard cap 60 — same bound as offerings-pick).
  4. Attach the macro dict (buildSummaryInput) + the relevant rv sections
     (regime, top standouts) ALWAYS — small and cheap, gives the model context.
  5. If a bank/CRM facet fired AND the request is rep-scoped, attach the
     per-bank facts for the matched bank(s) ONLY (getBankById projection +
     fits + rollover slice), rep-scoped via the acting-rep cookie.
  Returns { context, byCusip, facets, banksTouched } — byCusip is the
  grounding wall (normalized CUSIP → our full row), exactly like
  offeringsPick.buildCandidateSet's byCusip.
```

If no facet fires (a vague/off-topic question), `buildContext` returns the macro dict + top Standouts only, and the answer path is allowed to come back "I can answer that from today's offerings, the relative-value read, or your bank coverage — try naming an asset class, a state, or a bank." This is the deterministic *can't-answer-from-data* fallback; it never calls the model with an empty corpus.

**Why this is enough and why no vector DB:** the corpus is one day's worth of structured rows (hundreds, not millions), already in memory, already keyed by CUSIP/state/sector/maturity. Keyword-faceted filtering over typed fields is *more* precise than semantic similarity for this data ("matures by 2030" is an exact predicate, not a fuzzy match), costs nothing, and adds no dependency — honoring the two-npm-dep rule and the "prefer Node built-ins" constraint. A vector store would be a new dependency, a new persisted index to keep fresh on every publish, and worse at the numeric/categorical predicates that dominate these questions.

### 2.2 Prompt / tool-use shape

Forced tool-use for reliable structured output, same as `DASHBOARD_TOOL` in `daily-dashboard-judgment.js` (`tools` + `toolChoice` → `extractToolInput()` returns a platform-serialized object — no fragile text parsing). The model receives the question + the bounded context dict and must answer **only** from it.

```
ANSWER_TOOL = {
  name: 'answer_from_package',
  input_schema: {
    answer:    string,                      // 2-5 sentence plain-English answer
    citedCusips: [string],                  // CUSIPs it referenced (validated)
    citedSurfaces: [ { page, label } ],     // which explorer/page proves it
    answerable: boolean,                    // false → it could not answer from the data
    refusalReason: string (optional)        // 'no-data' | 'out-of-scope' | 'advice-request'
  }
}
```

System prompt (extends the existing FBBS desk-analyst system prompt verbatim, then adds the hard rails):

- "You answer questions about FBBS's own offerings and bank-coverage data **using ONLY the JSON context provided.** Never invent a CUSIP, a yield, a price, a bank, or a figure not in the context. If the context does not contain the answer, set `answerable:false` with `refusalReason:'no-data'` — do not guess."
- "**You do not give investment advice, recommendations, or suitability opinions.** Describe what the data shows (yields, spreads, what is cheap to its benchmark, what the desk is offering). Do NOT say a security is a buy/sell, is 'good for' a specific investor, or is 'suitable.' If asked for a recommendation or suitability call, set `answerable:false`, `refusalReason:'advice-request'`, and answer only with the factual data the desk can show. For Institutional Use Only."
- Numbers/CUSIP discipline restated: "Quote figures exactly as given; the system re-attaches them, so describe rather than restate precise numbers when unsure."

Model: default `claude-opus-4-8` via `claudeClient.createMessage`, `maxTokens ~700`, `effort: 'medium'`, hard timeout from the client. One non-streaming call per question.

### 2.3 Answer grounding + citation (the trust boundary)

`ground(toolInput, byCusip, facets)` — the same two-wall idea as `groundDashboard`/`groundPicks`:

1. **Drop hallucinated CUSIPs.** Every CUSIP in `citedCusips` must exist in `byCusip` (the context's grounding wall). Any the model invented is dropped; if a question pinned a specific CUSIP and it survives, re-attach OUR `{description, yield, ytm/ytnc, coupon, maturity, price, rv}` from the row — never the model's restatement.
2. **Build citations from OUR rows, not the model's `citedSurfaces`.** For each surviving cited CUSIP, derive the deep-link target from the row's own `page`/`type` (the existing `data-goto`/`data-cusip` plumbing) so "Open" lands on the native explorer that proves the claim. For bank/CRM answers, the citation is the tear sheet (`getBankById` id). The model's free-text `citedSurfaces` is advisory only and is reconciled against the page registry.
3. **Honor the refusal flags.** `answerable:false` (or zero surviving citations on a question that demanded securities) returns the deterministic can't-answer text plus, where possible, a "here's what I *can* show you" pointer (the faceted rows we retrieved), so a refusal is still useful.
4. **Never throws.** No key, API failure, malformed/truncated tool input (reuse `closeTruncatedJson`/tolerant parse from `daily-dashboard-judgment.js`), or empty corpus → a deterministic answer: either the faceted-rows summary ("Here are the agency callables maturing by 2030, sorted by spread to the curve: …" — a templated list straight from the retrieved rows) or "I can't answer that from today's data." `degraded:true` + `flags[]` mirror the dashboard's contract.

The deterministic faceted-rows summary is important: for a large class of questions (filter-and-rank over inventory), the retriever already has the exact answer, so even with **no model call** the box returns a useful, fully-grounded list. The model is the prose layer on top — when it is configured and the question is more than a filter — never the source of truth.

### 2.4 Where it slots in (files / functions / routes)

- **New `server/ask-package.js`** — pure: `buildContext`, `buildPrompt`, `parseAnswer`, `groundAnswer`, `answerableFromFacets` (the deterministic fallback composer), `getCachedAnswer`/`writeCache` (optional, see cost controls), `generateAnswer({ question, sources, rep, force?, createMessageImpl?, log? })`. Exports the pure pieces for tests, like every other AI module. **No I/O except its own cache file**; the route passes in all reads.
- **New routes in `server/server.js`** (in the existing `/api/*` dispatch block, next to the sales-dashboard routes ~10468):
  - `GET /api/ask-package/suggestions` — **free, never billable.** Returns 4-6 example questions + the live facet vocabulary (asset classes/states present today) so the UI can offer chips. Pure read over `buildAllOfferingsRows`.
  - `POST /api/ask-package` — **billable; admin-gated** (see 2.5). Body `{ question }`. The handler loads the same reads the Sales Dashboard GET already loads (`buildAllOfferingsRows`, the live RV dashboard, `loadCurrentEconomicUpdate`, `loadCurrentMmdCurve`, `marketRates.getLatestYieldCurve`, `fredSeries.getFredIndicators`), resolves the acting rep, calls `askPackage.generateAnswer({...})`, audits, and returns `{ answer, citations, answerable, degraded, flags, model, usage }`.
- **New SPA page `#ask` (portal.js + index.html + portal.css)** — a single text box, suggestion chips, an answer card with the prose + a "Sources" row of `data-goto`/`data-cusip` Open buttons + the "For Institutional Use Only" + AI-provenance stamp (ties into `AI-8`). Placed in the Offerings (or a new "Assistant") nav group. Reuses `escapeHtml`-style wrappers for all interpolation (the SPA's standing XSS rule). Non-admin users do not see the page (the same UI hiding that already hides billable refresh buttons).

### 2.5 Cost controls + admin-gating + audit

- **Admin-gated, like every other billable `/refresh`.** Add `/api/ask-package` to `isAdminOnlyApiWrite()` (server.js ~673) so it joins `daily-summary/refresh`, `offerings-pick/refresh`, `sales-dashboard/refresh` behind the `FBBS_ADMIN_USERS` gate. Non-admin POSTs get the existing 403; the page is hidden in the non-admin SPA. *(Owner can choose to widen to all reps — see Open Questions; the engine doesn't care, the gate is one list.)*
- **Per-question billing, so a hard ceiling matters.** Unlike the cache-by-package-date consumers (one call per package), a Q&A box bills **per question**. Controls:
  - `maxTokens ~700` + `MAX_ROWS ~40/60` cap on context → bounded input + output tokens.
  - **Deterministic-first short-circuit:** if the question is a pure filter-and-rank that `answerableFromFacets` can satisfy, the route can return the deterministic list **without a model call** (config flag `ASK_PACKAGE_DETERMINISTIC_ONLY=1` forces this for a zero-cost mode the owner may prefer at first).
  - **Optional same-question cache** keyed by `(packageDate + normalized question)` so a repeated question in the same package is free on re-ask (`data/market/ask-package-cache.json`, small LRU). Off by default if the owner wants every ask to be fresh.
  - **Soft daily-call budget** read from a config var (`ASK_PACKAGE_DAILY_MAX`, default e.g. 200): the route counts `ask-package` audit events for the current day and, past the ceiling, falls back to deterministic-only with a banner ("AI budget reached for today; showing the data-only answer"). No cron needed — it's a tail-read of `audit.log`, same mechanism the go-live status already uses.
- **Audit every call**, following the dashboard pattern: `appendAuditLog({ event: 'ask-package', rep, packageDate, questionLength, facets, answerable, citedCount, degraded, model, usage })` on success; `ask-package-skipped` (no key / over budget / deterministic-only) and `ask-package-failed` (model/API error) on the off-paths. **Never log the raw question verbatim if it could carry client-identifying free text** — log length + detected facets, not the body (compliance-conservative default; owner can opt into full-text logging if retention requires it).
- **Go-live status:** add an `ask-package` line to `buildGoLiveStatus` (configured? budget remaining? deterministic-only mode?) so the desk can see the surface's state on the Upload page.

### 2.6 Response + UI shape

```jsonc
// POST /api/ask-package  →
{
  "ok": true,
  "configured": true,
  "question": "agency callables maturing by 2030 cheapest to the curve",
  "answer": "Three agency callables in today's package mature on or before 2030; ranked by spread to the matched Treasury, FHLB 5.10 2030 screens widest at +42bp to the curve, then …",
  "answerable": true,
  "citations": [
    { "cusip": "3130A...", "page": "agencies", "label": "FHLB 5.10 06/2030", "yield": 5.10, "rvScore": 71, "spreadBps": 42 }
  ],
  "degraded": false,
  "flags": [],
  "model": "claude-opus-4-8",
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "provenance": "AI-assisted; figures from today's parsed package. For Institutional Use Only."
}
```

A refusal:

```jsonc
{
  "ok": true, "answerable": false, "refusalReason": "advice-request",
  "answer": "I can show you the data — yields, spreads, and what's cheap to its benchmark — but I can't make a buy/sell or suitability recommendation. Here are the in-state munis you asked about, with their levels: …",
  "citations": [ /* the faceted rows, still grounded */ ],
  "degraded": false
}
```

UI: one answer card; prose at top; a "Sources" strip of Open buttons (existing deep-link plumbing); the provenance/disclosure stamp at the bottom; suggestion chips above the box from `/api/ask-package/suggestions`. CSS bars/cards only, no chart lib, no new vendor asset.

---

## 3. Reuse (existing helpers — verified present)

- `server/claude-client.js`: `createMessage` (with `tools`/`toolChoice`), `extractToolInput`, `isConfigured` — the whole model layer.
- Grounding/parse pattern: `groundPicks`/`buildCandidateSet`/`parsePicks` (`offerings-pick.js`); `groundDashboard`/`parseDashboard`/`closeTruncatedJson`/`DASHBOARD_TOOL` (`daily-dashboard-judgment.js`).
- Grounded macro input: `dailySummary.buildSummaryInput`.
- Corpus reads: `cusipSearchSources()`, `buildAllOfferingsRows()`, `buildArchivedOfferingsRows()`, `dailyDashboardJudgment.buildLiveDashboard()` (free RV read), `loadCurrentEconomicUpdate()`, `loadCurrentMmdCurve()`, `loadCurrentRelativeValueSnapshot()`, `marketRates.getLatestYieldCurve()`, `fredSeries.getFredIndicators()`.
- Retrieval/normalization: `buildGlobalSearch()`'s normalize+term-match logic; `searchBanks()`, `getBankById()`, `findOfferingFitsForBank()`, `lastActivityByBank()`.
- Gating/audit: `isAdminOnlyApiWrite()`, `rejectIfUnauthorized()`, `shouldEnforceRepScope()`, `enforcedRollupRep()`, `appendAuditLog()`, the go-live `buildGoLiveStatus`.
- SPA: the `data-goto`/`data-cusip` deep-link plumbing, `escapeHtml` wrappers, the existing AI-card + provenance markup (AI-8).

---

## 4. Constraints respected / bent

**Respected:**
- **Two npm deps.** No vector DB, no embeddings lib, no SDK — retrieval is keyword/registry selection over in-memory structured rows; the model call is the existing raw-HTTPS wrapper.
- **Plain Node, no build.** Pure module + one route + vanilla-JS page.
- **AI discipline.** Claude only explains/ranks; every number re-attached from our rows; every CUSIP validated against the corpus; admin-gated billable POST; deterministic "can't answer from data" + faceted-rows fallback; never throws.
- **Bloomberg/S&P wall.** Corpus is the desk's own parsed data + keyless public sources already in the portal; no redistribution of licensed market data; answers link out (EMMA/issuer) rather than republish.
- **No email/cron.** Budget enforcement is an audit-log tail-read, not a scheduler.
- **Strict CSP / Soft-A.** No new vendor asset; the package corpus is firm-wide (Soft-A), the bank/CRM slice is rep-scoped via the acting-rep cookie + the existing scope-collapse.
- **Security.** Parameterized SQL only via the existing store helpers (the module does no SQL itself); free-text question is treated as untrusted input — used only as a model prompt and for keyword matching, never interpolated into SQL or HTML unescaped.

**Bent / new ground (call these out to the owner):**
- This is the **first open-ended prompt** in the portal. Every existing consumer asks a fixed question over a fixed candidate set; here the *question* is user-supplied. The grounding wall (CUSIP/byCusip validation + our-numbers re-attach) still holds, but a free-text answer is harder to bound than a JSON pick list — hence the explicit no-advice rail and the recommendation-refusal path.
- **Per-question billing** breaks the "one call per package" cost model of the other three consumers. The daily budget + deterministic-first short-circuit + optional same-question cache are the mitigations, but the owner must accept a variable bill.

---

## 5. Test plan (plain-node, fixture-driven, no network)

New `tests/ask-package.test.js`, run by plain `node` like the other AI module tests (`tests/offerings-pick.test.js`, `tests/daily-dashboard-judgment.test.js`), with an **injected `createMessageImpl`** so nothing hits the network.

Retrieval (`buildContext`, pure):
- A question naming an asset class + "matures by 2030" filters `buildAllOfferingsRows` fixtures to exactly the matching rows and caps at `MAX_ROWS`.
- An "in-state" + 2-letter-state question filters munis to that state.
- A CUSIP-shaped token pins that security and includes its `rv` block.
- A vague/off-topic question fires no facet → returns macro + Standouts only, and the answerable-from-facets composer is invoked.

Grounding (`groundAnswer`, the trust boundary):
- A model reply citing a CUSIP **not** in the corpus → that citation is dropped (hallucination wall).
- A model reply citing a real CUSIP → the returned citation carries OUR `yield`/`rv`, not the model's restated number.
- `answerable:false` from the model → deterministic can't-answer text, with the faceted rows still attached as citations.

Guardrails / robustness:
- A recommendation/suitability question (e.g. "should I buy this for my client?") → the deterministic refusal path returns `refusalReason:'advice-request'` and **no buy/sell verb** in the deterministic text; assert the output contains only descriptive data.
- No key (`createMessageImpl` simulates unconfigured) → deterministic faceted-rows answer, `degraded:true`, never throws.
- Malformed/truncated tool input → tolerant parse salvages or falls back deterministically; never throws.
- Empty corpus (no package) → deterministic "can't answer," never throws.

Budget/cost (route-level, can live in the smoke or a small route test):
- `ASK_PACKAGE_DETERMINISTIC_ONLY=1` → no `createMessage` call is made (assert the injected impl is never invoked) and a grounded list still returns.
- Past `ASK_PACKAGE_DAILY_MAX` → route falls back to deterministic-only.

Not part of `npm test` by default if it needs a temp server; the pure-module tests are. Consider one assertion in `scripts/go-live-smoke.js` that the free `GET /api/ask-package/suggestions` returns the live facet vocabulary.

---

## 6. Open questions / OWNER DECISIONS

1. **Fund a billable free-text Q&A surface at all?** This is the first per-question (variable-cost) AI surface — every existing consumer bills once per package. Decision: yes/no, and if yes, set **(a)** the daily call ceiling (`ASK_PACKAGE_DAILY_MAX`, e.g. 200) and **(b)** whether to launch in **deterministic-only / zero-cost mode first** (the retriever answers filter-and-rank questions with no model call; the model is enabled later). Recommendation: ship deterministic-only first, enable the model after a week of watching the audit log.

2. **Who can use it?** Admin-only (like the other billable refreshes — the safe default, smallest blast radius) or all reps? If all reps, the bank/CRM slice must stay rep-scoped via the existing scope-collapse, and the cost ceiling matters more. Recommendation: admin-only for the first cut; widen by flipping one allowlist line once cost is understood.

3. **The no-advice (FINRA) boundary — acceptable answer set.** The hard rail this spec builds in: the box **describes data** (yields, spreads, what's cheap to its benchmark, what's on offer, coverage facts) and **refuses** anything that reads as a buy/sell recommendation or a suitability/appropriateness opinion ("should I buy", "is this good for my client", "is this suitable"). Owner/compliance must confirm: **(a)** this descriptive-only boundary is the right line; **(b)** the exact refusal wording; **(c)** whether the "For Institutional Use Only" + AI-provenance stamp (AI-8) is sufficient disclosure on every answer; **(d)** whether the firm wants any rep-authored question or AI answer **retained for supervision** (SEC 17a-4 / FINRA 4511) — which would change the audit policy below from "log facets, not the body" to "retain full question + answer."

4. **Scope of the grounded corpus.** This spec proposes: today's package + standing inventories + the RV read + market backdrop **firm-wide** (Soft-A), and the bank/CRM slice **rep-scoped**. Owner to confirm whether CRM/bank-coverage data should be in the corpus at all (it widens the FINRA surface — answering about a specific client's holdings is closer to advice), or whether v1 should be **inventory + market only** (the safest scope) with bank/CRM added later behind its own decision. Recommendation: **inventory + market only for v1.**

5. **Audit retention of question text.** Default in this spec is conservative — log question *length* + detected *facets*, never the raw free-text body (it could carry client-identifying or rep-sensitive content). If compliance requires supervisable full-text retention (tied to decision 3d), flip to logging the full question + the returned answer into the audit stream. Owner/compliance call.

6. **Same-question caching.** Cache `(packageDate + normalized question)` to make re-asks free, or always bill fresh? Caching cuts cost but means two reps asking the "same" question get a byte-identical answer (fine for grounded data; worth a nod). Recommendation: enable the small cache; it never serves across package dates.
