# Sales Dashboard Wave 5 Spec — Spread Per Year Of Duration

Status: proposed only. Do not build until approved by the desk.

## Goal

Add a relative-value screen that answers: "Which short/intermediate offerings pay the most spread per year of duration risk?" This is a carry-density view, not a raw-yield or raw-spread rank.

The first version should be conservative:

- Include only offerings with effective workout tenor <= 10 years.
- Use the existing matched-benchmark spread already computed in `server/daily-dashboard-rv.js`.
- Use true effective duration only when the source row carries it; otherwise use the current workout-tenor proxy and label it as a proxy.
- Rank within broad asset classes so a CD does not crowd out every municipal or corporate comparison.

## Exact Math

For each candidate:

```text
durationYears =
  row.effectiveDuration
  ?? row.modifiedDuration
  ?? workoutTenor(row, asOf).effYears

spreadBps =
  candidate.rv.mmdSpreadBps for tax-exempt munis when MMD is available
  else candidate.rv.fdicSpreadBps for CDs when FDIC term rates are available
  else candidate.rv.ustSpreadBps

spreadPerYearDurationBps = spreadBps / durationYears
```

Eligibility:

- `durationYears > 0`
- `candidate.rv.effYears <= 10`
- `spreadBps != null`
- For structured notes, include only if `workoutBasis` is not `call` inside 18 months, or place them in their own "structured" bucket with a visible caveat.

Rounding:

- Store `durationYears` to 2 decimals.
- Store `spreadPerYearDurationBps` to 1 decimal.
- Keep `durationSource` as one of `effective`, `modified`, or `workout-proxy`.

## Engine Slot

Implement in `server/daily-dashboard-rv.js`.

Add fields to each candidate's `rv` object near the other relative-value metrics:

- `durationYears`
- `durationSource`
- `spreadForDensityBps`
- `spreadForDensitySource`
- `spreadPerYearDurationBps`

Add a builder after candidates are enriched:

```js
function durationDensityBoards(candidates) {
  // filter, group by display asset class, sort descending by spreadPerYearDurationBps
}
```

Attach to the returned RV payload:

```js
durationDensity: {
  maxTenorYears: 10,
  boards: [
    { key: 'muni', label: 'Munis', rows: [...] },
    { key: 'agency', label: 'Agencies', rows: [...] },
    { key: 'corporate', label: 'Corporates', rows: [...] },
    { key: 'cd', label: 'CDs', rows: [...] }
  ]
}
```

Do not involve Claude ranking. Claude prose can mention the result later, but the first implementation should be deterministic and fully grounded in parsed data.

## Data Requirements

No new upload slot is required.

Preferred source fields, if present in normalized inventory:

- `effectiveDuration`
- `modifiedDuration`
- `averageLife`

Current registry/candidate gaps:

- Treasury/CD/agency/corporate offer sheets generally do not carry true duration.
- The bond-accounting portfolio parser does carry `effectiveDuration` for holdings, not necessarily today's offerings.
- Until the offering feeds carry duration, the screen must label proxy duration clearly in the UI: "duration proxy: workout tenor."

## UI Surface

Add a compact section below Today's Standouts and above the full RV Leaders board:

Title: `Spread per year of duration`

Subtitle: `10y-and-in carry density; duration uses source duration where available, otherwise workout-tenor proxy.`

Each row:

- CUSIP / description
- asset class
- YTW
- spread source and spread bps
- duration years with source chip
- `bp/yr` score
- Open button using existing `data-goto` / `data-cusip` plumbing

Avoid using it as the main "Bond of the Day" driver until the duration-source mix is reviewed by the desk.

## Test Plan

Add tests in `tests/daily-dashboard-rv.test.js`:

- A 3.2-duration A corporate at +55 ranks above a 7.4-duration BBB at +85 because 17.2 bp/yr > 11.5 bp/yr.
- A 12-year candidate is excluded even if its score is high.
- A candidate with true `effectiveDuration` reports `durationSource: 'effective'`.
- A candidate without duration falls back to workout tenor and reports `durationSource: 'workout-proxy'`.
- Muni rows prefer MMD spread when MMD is supplied; otherwise they fall back to UST spread.
- CD rows prefer FDIC term spread when available.

## Open Decision

Desk approval needed on whether proxy duration is acceptable for go-live. Recommended label: "duration proxy" anywhere the value is not source-provided effective or modified duration.
