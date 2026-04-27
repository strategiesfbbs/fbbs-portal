# FBBS Dashboard — Pre-Flight Checklist
# Run this verification BEFORE delivering any dashboard output.
# ============================================================

## STRUCTURAL CHECKS (must all pass)

### Tab/Panel Integrity
- [ ] 8 tab buttons exist with correct data-tab attributes: strategies, relval, munis, agencies, cds, corps, brokeredcds, mbscmo
- [ ] 8 panel divs exist with matching IDs: panel-strategies, panel-relval, panel-munis, panel-agencies, panel-cds, panel-corps, panel-brokeredcds, panel-mbscmo
- [ ] Only panel-strategies has class="panel active" (no style="display:none")
- [ ] All other 7 panels have style="display:none" inline

### Search Inputs (per-tab, NOT global)
- [ ] id="muniSearch" input exists inside panel-munis with oninput="filterMuniRows()"
- [ ] id="corpsSearch" input exists inside panel-corps with oninput="filterCorpRows()"
- [ ] NO globalSearch element anywhere in the file
- [ ] NO search-wrap div in the sales bar
- [ ] id="muniSearchCount" exists exactly once
- [ ] id="corpSearchCount" exists exactly once

### Sector Filter Buttons
- [ ] All 7 buttons have data-sector attributes: all, Financial, Industrial, Technology, Communications, Consumer, Utilities
- [ ] "All" button has data-sector="all" (lowercase)
- [ ] Filter buttons and corpsSearch are wrapped in a single flex container (not separate divs)

### Critical Element IDs (all must exist exactly once)
- [ ] topPicksGrid
- [ ] audienceLabel
- [ ] audienceSelect
- [ ] taxRateSlider
- [ ] taxRateDisplay
- [ ] muniSearch
- [ ] muniSearchCount
- [ ] corpsSearch
- [ ] corpSearchCount
- [ ] corpsTable
- [ ] muniBadge
- [ ] muniInvCount
- [ ] botdTEY
- [ ] botdRateLabel
- [ ] muniSearchable (BQ tbody)
- [ ] stdMuniTableBody (Standard tbody)
- [ ] taxableMuniTableBody (Taxable tbody)
- [ ] cdChart (canvas)
- [ ] bcdChart (canvas)

## JAVASCRIPT CHECKS

### switchTab Function
- [ ] Hides panels with p.style.display='none' (NOT p.style.display='')
- [ ] Shows active panel with panel.style.display='block' (NOT panel.style.display='')
- [ ] Triggers filterMuniRows() when switching to munis tab
- [ ] Triggers filterCorpRows() when switching to corps tab
- [ ] Triggers chart builds for relval, cds, brokeredcds tabs

### Filter Functions
- [ ] filterMuniRows() reads from document.getElementById('muniSearch') — NOT getSearch()
- [ ] filterCorpRows() reads from document.getElementById('corpsSearch') — NOT getSearch()
- [ ] filterCorpRows() reads btn.dataset.sector for active sector
- [ ] getSearch() returns empty string (legacy stub only)

### refreshSalesTools
- [ ] Calls renderTopPicks() and renderTEYColumns() ONLY
- [ ] Does NOT call filterMuniRows() or filterCorpRows()

### TEY Calculation (YTW-based — permanent rule)
- [ ] Every `.tey-cell` has a `data-ytw="X.XXX"` attribute (value matches the row's YTW column)
- [ ] `renderTEYColumns()` reads `cell.dataset.ytw` (with fallback to `data-ytm` only for legacy rows)
- [ ] TEY formula is `ytw / (1 - rate/100)` — NEVER `ytm / (1 - rate/100)`
- [ ] Bond of the Day uses `botdYtw` variable (not `botdYtm`)
- [ ] For callable premium munis, displayed TEY reflects YTW (lower) not YTM (higher)

### TEFRA / Disallowance Disclaimer (mandatory)
- [ ] Short-form disclaimer appears in the sales bar near the tax-rate selector, stating the formula and that TEFRA haircut / disallowance are excluded
- [ ] Full-form disclaimer appears in the footer, covering:
  - TEY = YTW ÷ (1 − marginal tax rate)
  - Excludes TEFRA interest-expense haircuts
  - Excludes the 20% C-Corp disallowance on bank-qualified holdings
  - Directs bank buyers to consult their own tax/portfolio advisors

### onSearch
- [ ] Is a no-op (empty function body or comment)

### PICKS_DATA
- [ ] No raw apostrophes (') inside single-quoted string values
- [ ] All tab values are valid panel names
- [ ] All audience arrays contain only "scorp", "ccorp", "ria"

## DATA CHECKS

### Placeholders
- [ ] Zero {{placeholder}} tokens remain in the output file
- [ ] Date appears in title, header subtitle, and all section headers

### Compliance
- [ ] No "CRA eligible" or "CRA reinvestment credit" anywhere
- [ ] No "0% risk weight" applied to agency GSEs
- [ ] No "implicit government backing" language
- [ ] No "no concentration limits" language
- [ ] Taxable munis not pitched as tax plays
- [ ] Bond of the Day is tax-exempt (not taxable)
- [ ] "IG CDS" spelled out as "IG Credit Default Swap index (CDX IG)" on first reference

### Bond Selection (permanent — quality & RV over liquidity)
- [ ] Bond of the Day available size is ≥ $250K
- [ ] Strategy of the Day featured CUSIP(s) all have ≥ $250K available
- [ ] All Strategy card CUSIP rows show ≥ $250K availability
- [ ] All PICKS_DATA entries reference bonds with ≥ $250K availability
- [ ] All fit matrix idea CUSIPs have ≥ $250K availability
- [ ] Strategy of the Day is NOT anchored solely on the day's largest agency block (i.e., headline pick is chosen on credit / structure / spread merit, not block size)
- [ ] Featured bonds are sized within or near the typical $25K–$5MM FBBS trade range, not $40MM+ institutional blocks (unless spread/structure overwhelmingly justify)

### Tag Balance
- [ ] script tags: equal open and close count
- [ ] style tags: equal open and close count
- [ ] No unclosed div tags in panel sections

## QUICK BASH VERIFICATION (run these commands)

```bash
# Placeholder check (should return 0)
grep -c "{{" output.html

# Global search check (should return 0)
grep -c "globalSearch" output.html

# Search input check (should return 1 each)
grep -c 'id="muniSearch"' output.html
grep -c 'id="corpsSearch"' output.html

# Panel display check (should return 7 — all non-strategies panels)
grep -c 'style="display:none"' output.html

# Duplicate ID check
grep -oP 'id="[^"]*"' output.html | sort | uniq -d
# (should return nothing)

# Apostrophe in PICKS_DATA check
sed -n '/PICKS_DATA/,/\];/p' output.html | grep "why:" | grep "'"
# (review any matches — apostrophes in single-quoted strings will break JS)

# YTW-based TEY check (should be equal — every tey-cell needs data-ytw)
grep -c 'class="tey-cell"' output.html
grep -c 'data-ytw=' output.html

# JS uses YTW not YTM for TEY (should return a match)
grep -c 'cell.dataset.ytw' output.html

# TEFRA / disallowance disclaimer check (should be ≥ 1)
grep -ic 'tefra' output.html
grep -ic 'disallow' output.html
```
