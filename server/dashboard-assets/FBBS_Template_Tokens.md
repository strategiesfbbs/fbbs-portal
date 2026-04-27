# FBBS Dashboard Template — Token Reference

Companion to `FBBS_Dashboard_TEMPLATE.html`. Lists every `{{TOKEN}}` placeholder, what it should be replaced with, and where the source data comes from.

**Total: 141 unique tokens, 148 placements.**

After tokens are filled, every `{{TOKEN}}` literal must be gone. Verify with:
```bash
grep -c "{{" FBBS_Dashboard_YYYYMMDD.html   # must return 0
```

---

## CONVENTIONS

- **String** — plain text or HTML-safe text (e.g. `"3.65%"`, `"FHLB 4.45% 3/26/31"`)
- **HTML block** — multi-element HTML fragment (table rows, card markup)
- **JS literal** — valid JavaScript (array literal `[...]`, number, etc.)
- **DIR** suffix — direction class for KPI cells: `up` | `dn` | `neutral`. Drives arrow color.
- All percentages display with `%` suffix already in the template — values like `3.763%` not `3.763`.
- Em-dashes display as `—` (U+2014) in HTML, but inside single-quoted JS strings use `\u2014`.

---

## SECTION 1 — HEADER & KPI GRID (24 tokens)

Filled from the daily Economic Update PDF.

### Date
| Token | Type | Example | Source |
|-------|------|---------|--------|
| `{{DATE}}` | String | `4/22/2026` | M/D/YYYY format. Used in 8 places (title, header subtitle, section headers, BCD commentary). |

### Header inventory badges
| Token | Type | Example | Source |
|-------|------|---------|--------|
| `{{MUNI_COUNT}}` | String | `23` | Total muni rows across BQ + Std + Taxable tables |
| `{{AGENCY_COUNT}}` | String | `13` | Total agency bullet + callable highlighted rows |
| `{{CORP_COUNT}}` | String | `23` | Corporate ideas count |
| `{{STRUCTURED_COUNT}}` | String | `1` | MBS/CMO offerings (0 if no offering) |

### Treasury KPIs (row 1)
| Token | Type | Example | Source |
|-------|------|---------|--------|
| `{{UST_2Y_DIR}}` | DIR | `dn` | Day direction class: `up` / `dn` / `neutral` |
| `{{UST_2Y}}` | String | `3.763%` | 2Y yield with % suffix |
| `{{UST_2Y_SUB}}` | String | `▼ 1.9bp today · wkly ▼0.2bp` | Day + weekly delta caption |
| `{{UST_5Y_DIR}}` / `{{UST_5Y}}` / `{{UST_5Y_SUB}}` | (same shape) | 5Y trio |
| `{{UST_10Y_DIR}}` / `{{UST_10Y}}` / `{{UST_10Y_SUB}}` | (same shape) | 10Y trio |
| `{{FED_DIR}}` | DIR | `neutral` | Direction for Fed Funds |
| `{{FED_EFF}}` | String | `3.64%` | Fed Funds effective rate |
| `{{FED_SUB}}` | String | `Target 3.50–3.75% · Unchanged` | Target range / move caption |

### Equity & risk KPIs (row 2)
| Token | Type | Example | Source |
|-------|------|---------|--------|
| `{{DJIA_DIR}}` / `{{DJIA}}` / `{{DJIA_SUB}}` | DIR / String / String | `dn` / `49,149` / `▼ 293 · futures ▲ 366` |
| `{{SP500_DIR}}` / `{{SP500}}` / `{{SP500_SUB}}` | DIR / String / String | `dn` / `7,064` / `▼ 45.1 · ▼ 0.6%` |
| `{{VIX_DIR}}` / `{{VIX}}` / `{{VIX_SUB}}` | DIR / String / String | `dn` / `18.90` / `▼ 0.60 · low vol regime` |
| `{{WTI_DIR}}` / `{{WTI}}` / `{{WTI_SUB}}` | DIR / String / String | `up` / `$89.97` / `▲ 0.30 · Iran tensions` |

---

## SECTION 2 — FIT MATRIX CARDS (21 tokens)

Three audience cards (C-Corp, S-Corp, RIA) × one blurb + three idea slots.

### C-Corp card
| Token | Type | Source |
|-------|------|--------|
| `{{CCORP_BLURB}}` | String | 1-2 sentence audience-fit narrative for C-Corp banks (21% bracket) |
| `{{CCORP_IDEA1_TITLE}}` | String | e.g. `FHLB 4.45% 3/26/31 callable — 4.43% YTM` |
| `{{CCORP_IDEA1_NOTE}}` | String | e.g. `CUSIP 3130B9WU0 · $100MM · headline 5yr ladder anchor.` |
| `{{CCORP_IDEA2_TITLE}}` / `{{CCORP_IDEA2_NOTE}}` | (same) | Idea 2 |
| `{{CCORP_IDEA3_TITLE}}` / `{{CCORP_IDEA3_NOTE}}` | (same) | Idea 3 |

### S-Corp card (same shape as C-Corp, prefix `SCORP_`)
`{{SCORP_BLURB}}`, `{{SCORP_IDEA1_TITLE}}`, `{{SCORP_IDEA1_NOTE}}`, `{{SCORP_IDEA2_TITLE}}`, `{{SCORP_IDEA2_NOTE}}`, `{{SCORP_IDEA3_TITLE}}`, `{{SCORP_IDEA3_NOTE}}`

### RIA card (same shape, prefix `RIA_`)
`{{RIA_BLURB}}`, `{{RIA_IDEA1_TITLE}}`, `{{RIA_IDEA1_NOTE}}`, `{{RIA_IDEA2_TITLE}}`, `{{RIA_IDEA2_NOTE}}`, `{{RIA_IDEA3_TITLE}}`, `{{RIA_IDEA3_NOTE}}`

**Selection rules:** every featured CUSIP must have ≥ $250K available. Pick on credit/structure/spread merit, not block size.

---

## SECTION 3 — INVENTORY STRIP (6 tokens)

Below the fit matrix; auto-counted summary cards.

| Token | Type | Example |
|-------|------|---------|
| `{{MUNI_INV_COUNT}}` | String | `26` (line items) |
| `{{MUNI_INV_NOTE}}` | String | `10 BQ + 15 standard + 1 taxable. Highlights: …` |
| `{{AGENCY_SHELF_COUNT}}` | String | `26` (highlighted structures) |
| `{{AGENCY_SHELF_NOTE}}` | String | `14 bullets + 12 callables. Deepest liquidity in 5yr callable ladder…` |
| `{{CORP_IDEAS_COUNT}}` | String | `34` |
| `{{CORP_IDEAS_NOTE}}` | String | `Representative IG spread list spanning financials…` |
| `{{CD_CURVE_COUNT}}` | String | `9` (curve points) |
| `{{CD_CURVE_NOTE}}` | String | `Bullet CD sweet spot 6mo–5yr at +15 to +28bp vs UST. Top: …` |

---

## SECTION 4 — STRATEGIES TAB (2 tokens, but big)

| Token | Type | Notes |
|-------|------|-------|
| `{{STRATEGIES_CONTEXT_NARRATIVE}}` | String | 4-7 sentence prose. Cover: oil/equity backdrop, UST curve moves, rate vol, MBA apps, Fed implied, VIX, redeployment theme. Use `<strong>` for emphasis. |
| `{{STRATEGY_CARDS_HTML}}` | HTML block | The full `<div class="strat-card">…</div>` markup for 5–6 cards. The template has an HTML comment showing the exact card shape just above this token. |

**Strategy cards structure (repeat for each card):**
```html
<div class="strat-card[ featured]">  <!-- add "featured" class for Strategy of the Day -->
  <div class="card-header">
    <div class="card-header-top">
      <div class="strat-title">{title}</div>
      <span class="featured-badge">★ Strategy of the Day</span>  <!-- only on first card -->
    </div>
    <div class="buyer-row">
      <span class="buyer-badge tag-scorp">S-Corp Bank</span>  <!-- include only applicable -->
      <span class="buyer-badge tag-ccorp">C-Corp Bank</span>
      <span class="buyer-badge tag-ria">RIA / Money Manager</span>
    </div>
  </div>
  <div class="card-body">
    <p>{2-3 sentence rationale referencing today's market levels}</p>
    <div class="detail-row">
      <div class="detail-chip dc-highlight"><span class="dc-label">YTM</span><span class="dc-val">4.43%</span></div>
      <!-- 4-7 chips total. Use dc-warn class for "Avoid" chips. -->
    </div>
    <div class="cusip-row">CUSIP <span>{cusip}</span> · {details}</div>  <!-- optional -->
  </div>
</div>
```

**Suggested 5-card set:** (1) Strategy of the Day, (2) Callable Agency Ladder, (3) Muni Barbell, (4) CD + Agency Bullet Blend, (5) IG Corporate Sector Rotation. Add (6) Taxable Muni feature when applicable.

---

## SECTION 5 — RELATIVE VALUE TAB (8 tokens)

### Chart datasets (JS literals — must be valid JS arrays of length 10)
| Token | Type | Example | Notes |
|-------|------|---------|-------|
| `{{RV_UST_DATA}}` | JS literal | `[3.70, 3.68, 3.67, 3.72, 3.78, 3.79, 3.85, 3.90, 4.09, 4.29]` | Length = 10. Labels: 6Mo, 9Mo, 12Mo, 18Mo, 2Yr, 3Yr, 4Yr, 5Yr, 7Yr, 10Yr |
| `{{RV_CD_DATA}}` | JS literal | `[3.95, 3.95, 3.95, 3.95, 3.95, 3.95, 4.05, 4.05, null, null]` | Use `null` for terms with no supply |
| `{{RV_AGENCY_DATA}}` | JS literal | `[3.76, 3.77, 3.78, 3.80, 3.81, 3.85, 3.91, 3.98, 4.19, 4.44]` | |
| `{{RV_CORP_DATA}}` | JS literal | `[3.93, 3.92, 3.92, 3.94, 3.95, 4.05, 4.17, 4.28, 4.52, 4.85]` | AA Corp |

### Comparison tables
| Token | Type | Notes |
|-------|------|-------|
| `{{RV_CD_VS_UST_ROWS}}` | HTML block | One `<tr>` per term: `Term | CD Yield | UST | Spread | Verdict`. Use `class="spd-pos"` / `"spd-neg"` on Spread cell. |
| `{{RV_MUNI_TEY_ROWS}}` | HTML block | One `<tr>` per term: `Term | Muni YTW | TEY @21% | TEY @29.6%`. Add `class="ytw"` to TEY cell to highlight. |
| `{{RV_CORP_SPREAD_ROWS}}` | HTML block | One `<tr>` per term: `Term | Corp Yield | vs. UST` (use `spd-pos`/`spd-neg`). |
| `{{RV_KEY_TAKEAWAY}}` | String | 2-3 sentence summary of where curve value lives today. |

---

## SECTION 6 — MUNICIPALS TAB (24 tokens)

### MMD grid (3 cells)
| Token | Type | Example |
|-------|------|---------|
| `{{MMD_5Y_LABEL}}` | String | `2031` (year of the 5yr point) |
| `{{MMD_5Y}}` | String | `2.50%` |
| `{{MMD_5Y_RATIO}}` | String | `64% of UST 5Y ratio` |
| `{{MMD_10Y_LABEL}}` / `{{MMD_10Y}}` / `{{MMD_10Y_RATIO}}` | (same shape) |
| `{{MMD_20Y_LABEL}}` / `{{MMD_20Y}}` / `{{MMD_20Y_RATIO}}` | (same shape) |

### MMD scale strip (10-point AAA scale)
| Token | Type | Example |
|-------|------|---------|
| `{{MMD_AS_OF_SHORT}}` | String | `4/21` (close date short form) |
| `{{MMD_AS_OF_DATE}}` | String | `4/21/2026` (close date full) |
| `{{MMD_1Y}}` | String | `2.37%` |
| `{{MMD_SCALE_2Y}}` | String | `2.34%` |
| `{{MMD_3Y}}` | String | `2.35%` |
| `{{MMD_SCALE_5Y}}` | String | `2.50%` |
| `{{MMD_7Y}}` | String | `2.64%` |
| `{{MMD_SCALE_10Y}}` | String | `2.91%` |
| `{{MMD_15Y}}` | String | `3.32%` |
| `{{MMD_SCALE_20Y}}` | String | `3.89%` |
| `{{MMD_25Y}}` | String | `4.17%` |
| `{{MMD_30Y}}` | String | `4.27%` |

### Bond of the Day
| Token | Type | Example |
|-------|------|---------|
| `{{BOTD_HEADLINE}}` | String | `Clive IA UT GO · 2.200% Cpn · 6/1/2037 · 3.650% YTM · Aa1 rated · Non-callable · $525K available` |
| `{{BOTD_TEY}}` | String | `5.19%` (placeholder; JS overwrites on render) |
| `{{BOTD_TEY_RATE}}` | String | `29.6` (default tax rate displayed) |
| `{{BOTD_NARRATIVE}}` | String | 1-2 sentence rationale |
| `{{BOTD_CUSIP}}` | String | `188864H70` |
| `{{BOTD_SETTLE}}` | String | `4/23/2026` |
| `{{BOTD_YTW_JS}}` | JS literal | `3.650` (number, no quotes — used by `renderTEYColumns()` to compute live TEY) |

### Muni table bodies
| Token | Type | Notes |
|-------|------|-------|
| `{{BQ_MUNI_ROWS}}` | HTML block | One `<tr>` per row. **12 columns:** Issuer, St, Cpn, Maturity, Call, **TEY (`<td class="tey-cell" data-ytm="X.XXX" data-ytw="X.XXX">—</td>`)**, YTW (`class="ytw"`), YTM, Price, Rating, Enhancement, Qty. **Both `data-ytw` and `data-ytm` required.** |
| `{{STD_MUNI_ROWS}}` | HTML block | Same 12-column structure as BQ |
| `{{TAXABLE_MUNI_ROWS}}` | HTML block | **11 columns:** Issuer, St, Cpn, Maturity, Call, YTW, YTM, Price, Rating, CUSIP, Qty. YTW may be a spread quote (`+40/5YR`) for taxables. |

**Enhancement pill examples:**
```html
<span class="pill pill-blue">BAM</span>
<span class="pill pill-green">PSF-GTD</span>
<span class="pill pill-blue">AG · ST INTERCEPT</span>
<span class="pill pill-blue">Q-SBLF</span>
```
Use `—` (em-dash) for unenhanced bonds.

---

## SECTION 7 — AGENCIES TAB (3 tokens)

| Token | Type | Notes |
|-------|------|-------|
| `{{AGENCY_BULLET_ROWS}}` | HTML block | **8 columns:** Issuer (FHLB/FFCB/FNMA/FHLM), Cpn, Maturity, YTM (`class="ytw"`), Spread (`spd-pos`/`spd-neg`), Benchmark (e.g. `5Y UST`), Avail, CUSIP |
| `{{AGENCY_CALLABLE_ROWS}}` | HTML block | **9 columns:** Issuer, Cpn, Final Mty, Next Call, Call Type (Quarterly/Monthly/Anytime), YTNC, YTM (`class="ytw"`), Avail, CUSIP |
| `{{AGENCY_NOTE}}` | String | 2-3 sentence narrative on top callable picks of the day. |

---

## SECTION 8 — CDS TAB (15 tokens)

### Sweet spot grid
| Token | Type | Notes |
|-------|------|-------|
| `{{CD_SWEET_SPOT_GRID}}` | HTML block | 5 cells. Each cell: `<div class="cd-cell[ best]"><div class="cd-term">{label}</div><div class="cd-rate">{rate}</div><div class="cd-vs">{spread}</div></div>`. Use `cd-cell best` for the highlighted picks (gets ★ in label). |

### Best rate highlight box
| Token | Type | Example |
|-------|------|---------|
| `{{CD_BEST_RATE_LABEL}}` | String | `★ Best Rate on Curve — Morgan Stanley Pvt Bank 4yr & 5yr at 4.05%` |
| `{{CD_BEST_RATE_NARRATIVE}}` | String | 1-2 sentence why-it-matters |
| `{{CD_BEST_RATE_DETAILS}}` | String | CUSIPs, maturities, settle dates |

### Warn box
| Token | Type | Example |
|-------|------|---------|
| `{{CD_WARN_TITLE}}` | String | `Watch 7yr & 10yr CDs:` |
| `{{CD_WARN_BODY}}` | String | Rationale for avoiding the warned tenors |

### CD bar chart
| Token | Type | Example | Notes |
|-------|------|---------|-------|
| `{{CD_CHART_LABELS}}` | JS literal | `['6 Mo', '12 Mo', '18 Mo', '2 Yr', '3 Yr', '4 Yr ★', '5 Yr ★']` | Length must equal data array length |
| `{{CD_CHART_CD_DATA}}` | JS literal | `[3.95, 3.95, 3.95, 3.95, 3.95, 4.05, 4.05]` | |
| `{{CD_CHART_CD_COLORS}}` | JS literal | `['#2E9E6B','#2E9E6B','#2E9E6B','#2E9E6B','#2E9E6B','#1a6b48','#1a6b48']` | One color per bar; darker green for highlighted picks |
| `{{CD_CHART_UST_DATA}}` | JS literal | `[3.70, 3.67, 3.72, 3.78, 3.79, 3.85, 3.90]` | |

### Best Issuers tables
| Token | Type | Notes |
|-------|------|-------|
| `{{CD_SHORT_END_ROWS}}` | HTML block | Short end (≤12mo). 5 cols: Term, Top Issuer, Rate (`class="ytw"`), Cpn Freq, CUSIP |
| `{{CD_CORE_RANGE_ROWS}}` | HTML block | Core range (18mo–5yr). Same 5 cols. Use ★ in Term to mark best picks. |

---

## SECTION 9 — CORPORATES TAB (3 tokens)

| Token | Type | Notes |
|-------|------|-------|
| `{{CORP_CONTEXT_NARRATIVE}}` | String | 2-3 sentence market opportunity narrative. **Spell out "IG Credit Default Swap index (CDX IG)" on first reference.** |
| `{{CORPORATE_ROWS}}` | HTML block | One `<tr data-sector="...">` per bond. **`data-sector` MUST be one of:** Financial, Industrial, Technology, Communications, Consumer, Utilities. **10 columns:** Issuer, Tkr, Coupon, Maturity, Next Call, YTM (`class="ytw"`), Spread (`spd-pos`/`spd-neg`), Moody/S&P, `<span class="sector-badge">{sector}</span>`, Avail. Group by sector with HTML comments. |
| `{{CORP_FOOTER_NOTE}}` | String | Footer disclaimer about run size, e.g. `Representative best-spread selections from 197 total IG bonds. All Baa3/BBB- or better.` |

---

## SECTION 10 — BROKERED CDS TAB (24 tokens)

### Top commentary
| Token | Type | Notes |
|-------|------|-------|
| `{{BCD_COMMENTARY}}` | String | 4-6 sentence prose on CD curve, FHLB/SOFR/UST spreads, Fed pricing, supply conditions. |

### 4 KPI mini-cells
| Token | Type | Example |
|-------|------|---------|
| `{{BCD_KPI1_DIR}}` | DIR | `neutral` |
| `{{BCD_KPI1_LABEL}}` | String | `10s/2s Spread` |
| `{{BCD_KPI1_VAL}}` | String | `+51bp` |
| `{{BCD_KPI1_SUB}}` | String | `UST 10Y 4.272% − 2Y 3.763% · Steeper` |
| `{{BCD_KPI2_*}}` / `{{BCD_KPI3_*}}` / `{{BCD_KPI4_*}}` | (same shape) | Common labels: `10s/3mo Spread`, `Fed Funds Futures 1Y`, `CD vs FHLB Sweet Spot` |

### CD indication tables
| Token | Type | Notes |
|-------|------|-------|
| `{{BCD_BULLET_ROWS}}` | HTML block | **6 cols:** Term, All-In Cost Range, Mid, vs FHLB Topeka (`spd-pos`/`spd-neg`), vs SOFR, vs UST. Typical 11 rows: 3mo, 6mo, 9mo, 12mo, 18mo, 2yr, 3yr, 4yr, 5yr, 7yr, 10yr. |
| `{{BCD_CALLABLE_ROWS}}` | HTML block | **4 cols:** Term, All-In Cost Range, Premium vs Bullet, Lock-Out (Yes/No). |

### BCD chart (line chart, 11 points)
| Token | Type | Example | Notes |
|-------|------|---------|-------|
| `{{BCD_CHART_CD_DATA}}` | JS literal | `[3.975,3.975,4.000,4.000,4.025,4.025,4.025,4.075,4.100,4.150,4.275]` | 11 points: 3mo–10yr |
| `{{BCD_CHART_FHLB_DATA}}` | JS literal | `[3.87,3.84,3.86,3.87,3.91,3.94,3.96,4.02,4.07,4.31,4.55]` | FHLB Topeka |
| `{{BCD_CHART_SOFR_DATA}}` | JS literal | `[3.67,3.68,3.67,3.67,3.63,3.58,3.54,3.55,3.58,3.68,3.83]` | |
| `{{BCD_CHART_UST_DATA}}` | JS literal | `[3.68,3.70,3.68,3.66,3.71,3.75,3.77,3.83,3.88,4.06,4.27]` | |

---

## SECTION 11 — TOP PICKS JS ARRAY (1 token, but critical)

| Token | Type | Notes |
|-------|------|-------|
| `{{PICKS_DATA_JS}}` | JS literal | A complete JS array literal `[...]`. Drives the audience-aware Top Picks grid. |

**Required entry shape:**
```js
{ type: 'Callable Agency', audience: ['ccorp','scorp'],
  title: 'FHLB 4.45% 3/26/31 \u2014 $100MM block',
  yld: '4.43%',
  why: 'CUSIP 3130B9WU0 \u00b7 Call 6/26/26 \u00b7 5yr ladder anchor \u00b7 20% risk weight',
  tab: 'agencies' }
```

**Hard rules:**
- `audience` values: any subset of `'scorp'` / `'ccorp'` / `'ria'`. Empty array `[]` hides the pick.
- `tab` values: `strategies` / `relval` / `munis` / `agencies` / `cds` / `corps` / `brokeredcds` / `mbscmo`
- **NO RAW APOSTROPHES** inside single-quoted JS strings. Use `\u2019` for `'` and `\u2014` for `—`. A stray apostrophe kills ALL JavaScript on the page.
- Every CUSIP referenced must have ≥ $250K available.
- Aim for 8–14 entries spanning all 3 audiences; the JS slices the first 6 matching for the active audience.

---

## SECTION 12 — FOOTER (no tokens)

The TEFRA / disallowance disclaimer text is hardcoded in the template footer. Verify it survives every edit pass:

```
Tax-equivalent yields … YTW divided by (1 − marginal tax rate). Figures exclude TEFRA
interest-expense haircuts and the 20% C-Corp disallowance on bank-qualified holdings.
Bank buyers should consult their own tax and portfolio advisors…
```

---

## QUICK SOURCE-TO-TOKEN MAP

For each input file, here are the tokens it feeds:

### `YYYYMMDD_Economic_Update.pdf`
`DATE`, all `UST_*`, all `*_DIR` for KPIs, `FED_*`, `DJIA*`, `SP500*`, `VIX*`, `WTI*`, `STRATEGIES_CONTEXT_NARRATIVE`, `BCD_COMMENTARY`, `BCD_KPI1-4_*`, `RV_KEY_TAKEAWAY` (partial), `RV_*_DATA` UST entries, `BCD_CHART_UST_DATA`, `BCD_CHART_SOFR_DATA`

### `YYYYMMDD__FBBS_Offerings.pdf`
`MUNI_COUNT` (partial), `MUNI_INV_*`, `BQ_MUNI_ROWS`, `STD_MUNI_ROWS`, `TAXABLE_MUNI_ROWS`, `BOTD_*` (selection), `STRATEGY_CARDS_HTML` (muni cards)

### `MMD_YYYYMMDD.pdf`
All `MMD_*` tokens (15 total), `MMD_AS_OF_*`, `RV_MUNI_TEY_ROWS`

### `YYYYMMDD_CD_Relative_Value.pdf`
`CD_SWEET_SPOT_GRID`, `CD_BEST_RATE_*`, `CD_WARN_*`, `CD_CHART_*`, `CD_SHORT_END_ROWS`, `CD_CORE_RANGE_ROWS`, `RV_CD_DATA`, `RV_CD_VS_UST_ROWS`, `CD_CURVE_*`

### `FBBS_Brokered_CD_Rate_Sheet_*.pdf`
`BCD_COMMENTARY`, `BCD_KPI1-4_*`, `BCD_BULLET_ROWS`, `BCD_CALLABLE_ROWS`, `BCD_CHART_CD_DATA`, `BCD_CHART_FHLB_DATA`

### `bullets_MM_DD_YY.xlsx`
`AGENCY_BULLET_ROWS`, `AGENCY_COUNT` (partial), `AGENCY_SHELF_*` (partial), `RV_AGENCY_DATA` (partial), some `STRATEGY_CARDS_HTML` and `PICKS_DATA_JS` entries

### `callables_MM_DD_YY.xlsx`
`AGENCY_CALLABLE_ROWS`, `AGENCY_NOTE`, `AGENCY_COUNT` (partial), `AGENCY_SHELF_*` (partial), most `STRATEGY_CARDS_HTML` callable entries, most `PICKS_DATA_JS` callable entries

### `corporates_MM_DD_YY.xlsx`
`CORPORATE_ROWS`, `CORP_CONTEXT_NARRATIVE`, `CORP_COUNT`, `CORP_IDEAS_*`, `CORP_FOOTER_NOTE`, `RV_CORP_DATA`, `RV_CORP_SPREAD_ROWS`, IG corp entries in `STRATEGY_CARDS_HTML` and `PICKS_DATA_JS`

### Cross-file synthesis (desk judgment)
`STRATEGIES_CONTEXT_NARRATIVE`, `STRATEGY_CARDS_HTML` (synthesizes across all sources), `PICKS_DATA_JS`, `CCORP_BLURB`/`SCORP_BLURB`/`RIA_BLURB`, all 9 fit-matrix idea slots, `AGENCY_NOTE`, `RV_KEY_TAKEAWAY`, `BOTD_*` (selection)

---

## VERIFICATION

After filling all tokens, run:
```bash
WORK=./output/FBBS_Dashboard_YYYYMMDD.html
test "$(grep -c '{{' "$WORK")" -eq 0 || echo "FAIL: unfilled placeholders"
```

Plus the full `FBBS_Dashboard_PREFLIGHT.md` checklist.
