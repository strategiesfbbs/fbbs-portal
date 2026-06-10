# FBBS Portal - Final Completion Push

> **Owner:** Codex first pass, Claude product review
> **Date:** 2026-06-03
> **Purpose:** One ranked work board for the final push from "portal is launchable"
> to "portal is the daily operating system reps and managers actually use."

This document consolidates the internal go-live pack, pre-launch review, Codex audit,
Reports data pipeline note, Salesforce gap review, and current code shape. It is not a
new idea backlog. It is the shortest useful finish line.

## 0. Completion rule

The portal is "complete enough" when FBBS can do these without leaving the portal for
ordinary daily coverage work:

1. Publish and QA the daily package.
2. Search offerings and answer "who should I call about this?"
3. Open a bank and answer "what fits this bank today?"
4. Run the core sales/manager reports.
5. Save/export repeatable report views.
6. Track strategy/billing work from request to completion.
7. See launch/admin readiness without a developer.

Do not expand into external-client access, clearing/custody/accounting replacement,
full Salesforce clone behavior, or app-level auth beyond the internal IIS posture unless
FBBS explicitly changes the deployment model.

## 1. Source notes

Primary sources used for this board:

- `docs/go-live/internal-go-live-readiness.md`
- `docs/go-live/pre-launch-review.md`
- `docs/go-live/codex-full-audit-2026-06-02.md`
- `docs/go-live/sell-more-bonds-flow.md`
- `docs/data-pipeline.md`
- `docs/company-portal-context.md`
- `README.md` Reports tab section
- Current code in `server/server.js`, `server/report-store.js`, and `public/js/portal.js`

Important current-state correction:

- The README Reports section still says report rows are not persisted yet. The current
  code has `server/report-store.js`, `data/bank-reports/reports.sqlite`, and `/api/reports`
  routes for saved definitions/hidden rows. Update the README during the final docs pass.
- The offer-to-bank idea is no longer missing from zero. The server has
  `/api/assistant/buyers`, and the UI currently exposes "Find buyers" on Agency rows.
  The final push should expand and harden it across the other offering surfaces and Daily
  Intelligence picks.

## 2. Final push scoreboard

| Rank | Workstream | Owner | Status | Completion test |
|---|---|---|---|---|
| 1 | Production go-live closeout | IT + Codex | Open | IIS box passes launch-day script, `/api/me` is IIS identity, admin can publish, non-admin cannot |
| 2 | Reports workspace finish | Codex + Claude | Partial | Each core report can run, export, save where appropriate, and reopen from Reports home |
| 3 | Offer -> banks sales flow | Codex + Claude | Partial | Reps can click a daily pick or offering row and get a ranked call list |
| 4 | Bank -> offers sales flow | Codex + Claude | Partial | Tear sheet assistant and product-fit panels show computed, actionable next steps |
| 5 | Manager operating reports | Claude + Codex | Partial | Manager can see pipeline, stale activity, billing, and rep rollups without manual CSV stitching |
| 6 | Data integrity and freshness | Codex | Partial | Package QA and Reports freshness call out stale/mismatched inputs before reps act |
| 7 | Role gates and policy hardening | FBBS + Codex | Deferred | Decisions #7-#10 are either accepted as policy or enforced in code |
| 8 | Documentation/training final sync | Claude | Partial | Runbook/training reflect actual routes, reports, roles, and README current state |

## 3. Required to finish internal launch

These are still launch-closeout items, not feature ideas.

| Item | Owner | Source | Acceptance check |
|---|---|---|---|
| Fill the go-live decision sheet | FBBS | `decision-sheet.md` | Admin usernames, publisher/backup, ready time, notify channel, import cadence are filled |
| Apply production env vars | IT + Codex | `internal-go-live-readiness.md` | `FBBS_AUTH_MODE=iis`, `FBBS_ADMIN_USERS`, and production `DATA_DIR` are live |
| Confirm admin/non-admin behavior | Codex | auth routes | Admin can publish/import; non-admin gets 403 on ingest routes |
| Run IIS launch-day smoke | Codex + Publisher | `launch-day-script.md` | Real package publish, Package QA, tear sheet, reports, map, strategies, and admin readiness pass |
| Backup and restore test | IT + Codex | runbook/checklist | Quiesced or SQLite-safe backup is restored and verified |
| Update README Reports state | Codex | current code | README no longer says saved report rows are only session/local storage |

## 4. Reports to finish or build

The Reports workspace should become the Salesforce replacement surface, not just a place
to run ad hoc one-offs.

| Report | Current state | Build now | Acceptance check |
|---|---|---|---|
| Custom Bank List | Builder exists; server persistence exists; Save View enabled | Finish saved/reopen behavior, CSV, folders, pinned rows, filters over `BANK_FIELDS` | Create saved list, reload browser, reopen, export CSV with date in filename |
| Bank Peer Analysis | In-app report + CSV; Save View disabled | Enable save/reopen presets, add print/PDF, show stale peer-period warning | Bank report can be launched from tear sheet and reopened from Reports home |
| Portfolio Review Workbench | In-app report; CSV and Print/PDF available; tied to bond-accounting files | Tighten handout, expose unmatched/stale file warning, add strategy handoff for recommendations | Bank with portfolio file gets a print-ready review and actionable strategy handoff |
| Opportunity Report | In-app scan + CSV; not saved as repeatable report | Add saved presets for state/status/min-flags/saved-only; add drill-through to tear sheet and buyer flow | Manager can save "Midwest muni/CECL prospects" and rerun after new imports |
| Coverage Book | In-app coverage summary; CSV/print controls exist | Align with builder output controls, save report definition, include notes/contacts/product fit safely | Manager can print/export the active coverage book with detail rows |
| Billing Queue | In-app report + CSV; workflow owner/policy still open | Add aging buckets, invoice owner filter, and policy copy from decision sheet | Billing owner can work Needs Billed without reading raw Strategies rows |
| Manager Rollup | Partial via My Work, Saved Views, Maps | Build by-rep counts for statuses, stale banks, open strategies, Needs Billed, and reports run | Manager can answer "what needs attention by rep this week?" |
| Activity / No Contact | Not built as a formal task/activity report | Needs account activity timeline or task layer first | Report lists banks not touched in N days by rep/status |
| New / Changed Accounts | Not built | Track account-status history, then report status changes and new prospects/clients | Manager can see "new prospects/clients this month" |
| Contact Coverage Gap | Basic contacts exist; no report | Add contacts-by-role and missing-contact report | Export banks missing CFO/CEO/primary contact fields |
| Offer -> Banks Call List | API exists; UI only on Agency rows | Expand to CDs, munis, corporates, treasuries, MBS/CMO; add save/export | Click an offering and export ranked covered banks with rationale |
| Daily Pick Call List | Picks have page/CUSIP context but need stronger action wiring | Link each Daily Intelligence pick to explorer row and buyer call list | Morning pick becomes "open row" plus "who should I call?" |
| Scheduled Snapshots | Builder has disabled "Save & Schedule" | Defer until final core reports are stable | Explicitly marked Phase 2 with owner/date |

## 5. Sell-more-bonds product finish

These are the highest-leverage features after launch mechanics because they connect
today's inventory to the bank book.

### P1. Expand "Who should I call?"

Current: `/api/assistant/buyers` scores covered banks for product types
`agency`, `muni`, `cd`, `corporate`, `mbs`, and `treasury`, but the visible button is
currently wired on the Agency Explorer only.

Build:

- Add "Find buyers" on CD, Muni, Corporate, Treasury, and MBS/CMO rows where the row has
  enough offering detail.
- Add the same action to Daily Intelligence picks when a pick has a product type and CUSIP.
- Return/export score rationale, owner, status, location, and source offering.
- Add tests for buyer scoring and unsupported product types.

Acceptance check:

- A rep can start from any major offering surface and reach a ranked call list, then open a
  bank tear sheet from the drawer.

### P2. Finish "What fits this bank today?"

Current: Bank tear sheets include Sales Assistant prompts, deterministic product fits,
swap candidates, and strategy request handoff.

Build:

- Promote computed product-fit flags into the tear sheet summary instead of burying them
  behind the assistant panel.
- Make fit flags explain their source: call-report signal, holdings signal, current inventory,
  strategy history, or peer comparison.
- Let a rep turn a fit flag into a saved strategy/task with one click.
- Add stale data warnings when call-report, peer, or bond-accounting inputs are out of sync.

Acceptance check:

- Opening a covered bank gives a concise "Call about X because Y" view with a direct
  strategy handoff.

### P3. Lightweight opportunity pipeline

Current: Strategies Queue tracks work status, but not revenue pipeline stage, expected size,
probability, or close date.

Build:

- Add an opportunity object or strategy extension for stage, expected par/revenue, close date,
  probability, source signal, and linked offering/proposal/report.
- Auto-seed opportunities from swap proposals, buyer matches, and product-fit flags.
- Add manager forecast rollup report.

Acceptance check:

- Manager can see expected opportunity value and stage by rep/product without asking reps
  for spreadsheet updates.

## 6. Data/import/admin finish

| Item | Owner | Why | Acceptance check |
|---|---|---|---|
| Reports freshness stale pill | Codex | Peer averages can lag latest call-report period | Banner warns when peer period and bank period differ |
| Bond-accounting unmatched review | Codex + Claude | `unmatched/` and p-code-only files need operator visibility | Reports data page lists unmatched files and status |
| Peer workbook upload progress | Codex | 150 MB upload currently shows static importing state | User sees progress or at least a clearer long-running state |
| Package QA data sanity gate | Codex | Pre-launch review identified silent mis-parse risks | QA surfaces suspicious yields/prices, rows dropped, sniff decisions, unmatched joins |
| Import cadence banner | Claude + Codex | Non-daily bank/peer/portfolio imports need owner/cadence | Admin/Reports shows last import and expected cadence from decision sheet |
| SQLite backup runbook proof | IT + Codex | Live DBs hold coverage, strategies, swaps, reports | Restore test result is recorded in go-live readiness |

## 7. Role/policy finish

Do this after FBBS answers decision sheet items #7-#10.

| Policy area | Current behavior | Final decision path |
|---|---|---|
| Cross-rep edits/deletes | Any authed rep can mutate many records | Accept as internal policy or code-gate by owner/manager/admin |
| Billing queue | Any authed rep can work queue | Gate to billing owner/manager if FBBS chooses stricter policy |
| Swap send/execute | Any authed rep can send/execute | Gate to owner/trader/manager if FBBS chooses stricter policy |
| Audit/Admin visibility | Any authed rep can read admin surfaces | Gate to admins if FBBS chooses stricter policy |
| Soft delete | Some deletes are hard deletes | Add archive/restore pattern for strategies/reports/coverage |

Acceptance check:

- Every stricter-than-current policy answer has either code enforcement or explicit launch
  training that says it is policy-only.

## 8. Data Analytics integration

The shared plugin now has `tools/fbbs-plugin/context/reports-data-analytics.md`, which is
a source map. It must not become the semantic layer.

Final Data Analytics tasks:

1. Create one FBBS Reports semantic layer through the Data Analytics user-context workflow.
2. Seed it from the Reports context bridge, `docs/data-pipeline.md`, `BANK_FIELDS`, and live
   Reports store/API files.
3. Keep canonical metric definitions, grains, joins, source precedence, caveats, and report
   semantics in that semantic layer.
4. Keep the FBBS plugin limited to commands, source pointers, and handoff guidance.
5. Use Data Analytics reports for analysis artifacts, but verify claims against portal code
   and current parsed data.

Acceptance check:

- Future Data Analytics report prompts about FBBS Reports find one registered semantic layer,
  not duplicated context scattered across the plugin and repo docs.

## 9. Suggested build order

### Sprint A: close launch

1. Fill decision sheet.
2. Apply IIS env vars and run launch-day smoke.
3. Record backup restore test.
4. Update README Reports state.
5. Ship Reports freshness stale pill.

### Sprint B: finish Reports workspace

1. Make save/reopen behavior consistent for core report types.
2. Add output parity: CSV where expected, Print/PDF where useful, disabled controls only where
   intentionally deferred.
3. Add unmatched bond-accounting review.
4. Add Bank Peer saved presets and stale peer warning.
5. Add manager rollup report.

### Sprint C: sell-more-bonds flow

1. Expand "Find buyers" across all offering surfaces.
2. Wire Daily Intelligence picks to explorer rows and buyer lists.
3. Promote computed product-fit flags on tear sheets.
4. Add strategy/opportunity handoff from fit flags and buyer rows.

### Sprint D: Salesforce replacement depth

1. Add opportunity pipeline.
2. Add activity/no-contact report.
3. Add new/changed account report.
4. Add contact coverage-gap report.
5. Add report scheduling/subscriptions if managers still need them after saved reports land.

## 10. Claude review checklist

Claude should review this board for product/workflow priority, especially:

- Which reports reps actually run weekly vs. which are manager-only.
- Whether Billing Queue belongs in Reports, Strategies, or both.
- Whether opportunity pipeline should be a new object or a Strategy extension.
- Which "Find buyers" rationale is persuasive enough for traders/reps.
- Which report outputs need print/PDF versus CSV only.
- Training language for policy-only permissions until code gates are added.

## 11. Codex acceptance checklist

Before calling the portal completion push done:

- [ ] `npm test` passes.
- [ ] Launch-day smoke passes on IIS.
- [ ] Reports home can reopen saved reports from the server store.
- [ ] Core report exports use CSV injection-safe escaping.
- [ ] Reports freshness warns on stale peer/portfolio inputs.
- [ ] Offer -> banks buyer drawer works beyond Agencies.
- [ ] Tear sheet product-fit flags are computed and actionable.
- [ ] The README and go-live docs match current code.
- [ ] Data Analytics has one FBBS Reports semantic layer registered, or the missing layer is
      explicitly recorded as a remaining setup task.
