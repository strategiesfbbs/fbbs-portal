# Claude Handoff: Dashboard Strategy Redesign

This handoff captures the user's goal for the standalone daily dashboard after the FBBS portal started absorbing the raw daily uploads, structured parsers, explorer pages, and home-page Market Snapshot.

## User Goal

The user wants to remove redundant information from the generated daily dashboard because the portal now owns the daily document package, upload workflow, market snapshot, and searchable explorer pages.

The dashboard should become an in-depth daily sales strategy brief for every type of customer. Sales reps should be able to open it and quickly answer:

- What should I call on today?
- Which customer type fits this idea?
- Which CUSIP should I mention?
- Why does this trade make sense today?
- What are the risks or objections?
- Where in the portal can I find the full inventory or supporting source document?

The user currently uploads all trader documents and economic information each day. The dashboard generator parses roughly 16-20 documents daily, but much of the generated dashboard now duplicates what the portal can show faster and more conveniently.

## Files Reviewed

Reviewed examples from the legacy dashboard archive:

- `/Users/donkey/Documents/Claude/FBBS Daily Dashboard/dashboard/archive/2026-05-01.html`
- `/Users/donkey/Documents/Claude/FBBS Daily Dashboard/dashboard/archive/2026-05-04.html`
- `/Users/donkey/Documents/Claude/FBBS Daily Dashboard/dashboard/archive/2026-05-05.html`

These files are dense, self-contained HTML dashboards with embedded styles, scripts, charts, market tables, offering tables, audience filters, daily picks, and strategy cards.

## Strategic Direction

Separate responsibilities cleanly:

- The portal should be the source of truth for uploaded files, structured data, searchable tables, filters, exports, and current package status.
- The dashboard should be the daily sales interpretation layer: recommended ideas, audience fit, reasoning, talking points, and caution flags.

The dashboard should not try to be a second portal.

## What To Remove From The Dashboard

Move or keep these in the portal instead:

| Current dashboard content | Better portal home |
|---|---|
| Full CD offering tables | CD Offerings Explorer |
| Full muni offering tables | Muni Offerings Explorer |
| Tax-equivalent yield grids | Muni Explorer or Relative Value tools |
| Full agency bullet inventory | Agencies Explorer |
| Full agency callable inventory | Agencies Explorer |
| Full corporate inventory | Corporates Explorer |
| Full Treasury note inventory | Treasury Notes Explorer |
| Brokered CD/FHLB/SOFR/UST comparison tables | Relative Value or funding-rate explorer |
| Structured note inventory tables | Future Structured Notes Explorer |
| Large hardcoded chart arrays | Home Market Snapshot or Relative Value page |
| Broad market recap tables | Home Market Snapshot |
| Inventory count cards | Portal upload status and Market Snapshot |
| Repeated source-document summaries | Source viewer/explorer pages |

The dashboard may still mention representative levels or highlights, but it should not embed full inventory tables.

## What To Keep In The Dashboard

The reviewed dashboards already have a useful strategic skeleton. Keep and sharpen these parts:

- Audience selector/customer type logic.
- Bond of the Day.
- Strategy of the Day.
- Top Picks.
- C-Corp bank fit.
- S-Corp bank fit.
- RIA/money manager fit.
- Product-specific strategy cards.
- CUSIP-specific recommendations.
- Reasoning paragraphs.
- Risk, call, liquidity, tax, and suitability notes.
- Sales talking points.

These are the parts that help sales reps act.

## Recommended New Dashboard Shape

The daily dashboard should become a compact but deep "Daily Sales Strategy Brief."

Suggested sections:

1. Daily Market Read
   - 5 bullets maximum.
   - Curve direction, spread tone, CD pressure, muni/agency/corp opportunity, and main caution.

2. Best Ideas By Customer Type
   - C-Corp banks.
   - S-Corp banks.
   - Credit unions, if applicable.
   - RIAs/money managers.
   - Liquidity/cash buyers.
   - Tax-sensitive buyers.
   - Funding/issuing banks, if the brokered CD sheet supports it.

3. Top CUSIPs To Pitch
   - CUSIP.
   - Product type.
   - Target customer.
   - Yield/spread/context.
   - Why now.
   - Risk/objection.
   - Suggested sales language.

4. Customer-Specific Playbooks
   - "For S-Corp banks: lead with..."
   - "For C-Corp banks: focus on..."
   - "For RIAs: appropriate only when..."
   - Include specific CUSIPs and reasoning.

5. Do Not Pitch / Use Caution
   - Long CDs that are not competitive versus Treasuries.
   - Callable structures where call risk dominates pickup.
   - Taxable munis where the customer does not get enough relative value.
   - Structured products outside appropriate/suitable customer types.
   - Anything stale, misdated, or inconsistent across uploaded files.

6. Portal Links
   - Link to the relevant explorer or uploaded source.
   - Replace "here is the whole table" with "open the filtered explorer."

## Portal Work That Supports This

The portal already has much of the source-of-truth layer. Missing or likely-needed portal additions:

- Structured Notes Explorer.
- Brokered CD / funding-rate explorer.
- Better Relative Value page that combines Economic Update, Treasury Notes, CDs, agencies, munis, corporates, and brokered CD data.
- Muni tax-equivalent controls inside the Muni Explorer.
- Saved filters or preset views such as:
  - S-Corp Bank Ideas
  - C-Corp Bank Ideas
  - RIA Carry
  - Short Liquidity
  - BQ Munis
  - Callable Agencies
  - Treasury Alternatives
- A strategy-data endpoint or generated JSON file that the dashboard can consume.

## Suggested Implementation Phases

### Phase 1: No-Regret Cleanup

- Remove full inventory tables from the generated dashboard.
- Keep only the top few strategic picks per product.
- Replace long chart/table sections with summary cards and portal links.
- Keep the audience selector, but make it filter strategy ideas instead of raw inventory.
- Keep file size and generated HTML smaller.

### Phase 2: Portalize Missing Raw Data

- Add Structured Notes Explorer.
- Add Brokered CD/Funding Explorer.
- Expand Relative Value/Market Snapshot to cover the data currently duplicated in dashboard charts.
- Add "open in portal" links from dashboard cards.

### Phase 3: Generate Strategy From Portal Data

- Have the portal produce or expose a daily strategy JSON object after uploads are parsed.
- Dashboard generator should consume that structured data instead of reparsing all source documents independently.
- Strategy rows should include:
  - audience
  - product
  - CUSIP
  - rank
  - reason
  - risk
  - talking point
  - source slot/source file
  - portal route/filter target

## Acceptance Criteria

The redesigned dashboard is successful when:

- A sales rep can identify 5-10 actionable calls in under two minutes.
- Every highlighted idea has a target customer type and a reason.
- Every CUSIP-level idea has a clear source path back to the portal.
- The dashboard does not duplicate full portal explorer tables.
- Uploading today's files updates the portal first, then the dashboard uses the parsed portal data.
- The dashboard feels like strategy, not document storage.

## Product Principle

The portal answers: "Show me everything and let me filter it."

The dashboard answers: "What should I do with it today?"
