# Overnight work queue — 2026-06-23

**Driver:** a self-paced local `/loop` (Claude Code) working through this file overnight.
**Branch:** `claude/overnight-2026-06-23` (created off `main` @ `c8413aa`).
**Baseline:** `npm test` GREEN at start (38 suites, EXIT 0).

## Morning review (for the human)
- See everything done: `git log --oneline main..claude/overnight-2026-06-23`
- Review the diff: `git diff main...claude/overnight-2026-06-23`
- Read the **Progress log** at the bottom of this file — every iteration appends one line.
- Nothing was pushed and nothing touched `main`. Merge what you like: `git checkout main && git merge --ff-only claude/overnight-2026-06-23` (or cherry-pick individual commits).
- Stop the loop anytime with `/loop-stop` (or just interrupt the session).

---

## WORKING RULES (read every iteration — these are guardrails, not suggestions)

1. **Branch only.** Commit to `claude/overnight-2026-06-23`. **Never commit to `main`. Never `git push`.** (Leave everything for morning human review.)
2. **Green gate, manually.** The `npm test` PreToolUse hook only fires on `main` commits — it will NOT protect this branch. So **run `npm test` yourself before every commit and only commit on EXIT 0.** If a change goes red and isn't a quick fix, `git checkout -- <files>` / revert it and move on. **Never commit red.**
3. **Small commits.** One task → one (or a few) focused commits, conventional subjects (`test(...)`, `style(css): ...`, `docs: ...`, `chore: ...`). Check the task's box and append a Progress-log line in the same or a trailing commit.
4. **"Already done?" gate.** Before building anything, `grep`/`rg` the codebase and `git log --all --oneline | grep` to confirm it isn't already shipped. **Much of the Sales-Dashboard-ideas and improvement-roadmap docs is ALREADY BUILT** (RV Waves 1–4, task engine, opportunities, soft-delete, contacts/SF-import). If it exists, **skip it and note so in the log.**
5. **Safe-and-additive bias.** Risk order, do safest first: **tests → well-specified CSS → careful cleanup → specs for big/gated items.** Do **not** speculatively build large or owner-gated features. For anything big, blocked, owner-gated, or ambiguous, **write a crisp spec doc instead of code.**
6. **HANDS OFF** (explicitly out of scope for unattended work):
   - Retiring the uploaded-HTML "Published Dashboard" slot — owner decision #2, Codex-coordinated, touches shared package-slot machinery (`SLOT_NAMES`/`classifyFile`/upload). Do not touch.
   - The "dead-but-passing" `market-color-store.js` + its test — left intentionally; do not delete.
   - Launchers, `web.config`/deployment, the `data/` layout, npm deps (stay at `pdf-parse` + `better-sqlite3`; SheetJS stays vendored), `_`-prefixed files. Per CLAUDE.md "things to leave alone."
7. **Blocked → skip-and-log.** If a task needs real data you can't reach, network, an owner decision, or is ambiguous, **skip it, write why in the Progress log, move on.** Never get stuck retrying.
8. **Verify.** UI/CSS changes: verify with the `preview_*` tools (reload, snapshot, screenshot) on the affected pages. Logic changes: `npm test` + targeted node runs. Don't claim something works you didn't observe.
9. **Keep iterations small** so context stays manageable; this file is the durable state across wake-ups. After finishing a task (commit done, box checked, log appended), schedule the next wake-up ~120s out and continue. When the **actionable** queue is exhausted, write a **FINAL SUMMARY** block at the top of this file, commit it, and **end the loop** (no further wake-up).

---

## TASK QUEUE (ordered; do top-down; check the box when committed)

### A — Test hardening (safest; additive; self-verifying) — do these first
- [x] **A1.** Add `tests/pdf-text.test.js` — characterization tests for `server/pdf-text.js` `extractPdfText()` page-render helpers: space insertion between adjacent text items, and Y-tolerance row grouping. Build a small **synthetic** page-item fixture (do NOT need a real PDF). Assert current behavior.
- [x] **A2.** Add `tests/portfolio-parser.test.js` — pure-helper tests for `server/portfolio-parser.js` (cashflow schema-v4 shaping, par-weighted WAL/duration aggregation that ignores fields some sheets omit). Small synthetic fixture. If it genuinely needs a real workbook, **skip → spec it** in a one-paragraph note instead.
- [x] **A3.** Extend `tests/swap-render.test.js` — add a structure assertion for a **sent**-proposal render path (renders from the frozen snapshot JSON; no I/O). Confirm the printed economics fields are present.
- [x] **A4.** Add tests for `server/bank-coverage-store.js` task + opportunity helpers (`bank_tasks` / `bank_opportunities`: create, status transitions Open→Done / stage moves, the overdue/upcoming Open-task helpers). Use a temp SQLite DB (copy the pattern from `tests/coverage-consolidation.test.js` / `tests/store-smoke.test.js`).
- [x] **A5.** Add edge-case tests to `tests/daily-dashboard-rv.test.js` for any untested branch: de-minimis **equality** = ordinary income, BQ q-factor **S-corp = 0**, and `impliedMmdGrade` notch direction. Grep the test first; only add genuinely-missing cases.

### B — CSS facelift (well-specified; CSS-only; low blast radius). Spec: `docs/codex-handoff-css-facelift-2026-06-23.md`
> This is nominally "Codex's half." Doing it on this branch avoids the shared-`main` collision the handoff warns about; flag it for merge-coordination in the morning. **First** `grep` `origin/main` / `git log --all` to confirm Codex hasn't already landed `style(css): search...` — if they have, **skip.**
- [ ] **B1.** Workstream A — consolidate the 13 search-input rules to one shared baseline (height/radius/font/leading-icon/focus ring) per the handoff's grouped-selector approach. Keep `.bank-search-row input` as the deliberate large variant. **Verify in preview** on ≥3 pages (nav jump bar, `#banks` tear-sheet search, Reports peer search): icon renders, focus ring consistent, nothing overflows. `npm test` (frontend-parse compiles portal.js — don't let a stray JS edit slip in). One commit, `portal.css` only.
- [ ] **B2.** Workstream B — `.bank-tab-bar` hover state + eased brand-green (`--accent`) active underline. **Verify in preview**: open a bank tear sheet, hover/click between "Call Report & Portfolio" and "Sales Workspace". One commit.

### C — Safe cleanup
- [ ] **C1.** Prune **provably-dead** coverage-workspace CSS in `portal.css` (CLAUDE.md flags it as dead but scattered through shared rules). **Only** remove a rule whose class/selector has **zero** references across `public/index.html` + `public/js/portal.js` + `public/js/modules/*.js` (grep-prove each before deleting). Conservative — when uncertain, leave it and note in the log. **Verify in preview** that affected pages still render. `npm test`.

### D — Sales Dashboard (mostly SHIPPED; owner said "brainstorm only, hold building, sync first")
- [x] **D1.** Do **not** build features here. Write `docs/sales-dashboard-wave5-spec-2026-06-23.md` — a tight implementation spec for ONE genuinely-open Wave-5 item: **spread-per-year-of-duration** (carry density, ≤10y, labeled modified-duration proxy per the data-gap note). Cover: exact math, where it slots into `server/daily-dashboard-rv.js`, registry/candidate fields needed, UI surface, and a test plan. **Spec only — no engine change** (pending owner approval). Confirm via grep it isn't already implemented first.

### E — Roadmap Wave-2 (mostly SHIPPED or org/contract-blocked)
- [x] **E1.** Verify-and-log: confirm via grep that task engine / opportunities / soft-delete / contacts+SF-import are already shipped (they are) → record "done, skipped" in the log. Record that Graph mailbox (A3) and Bloomberg TOMS (A4) are **org/contract-blocked** — out of scope for unattended work.
- [x] **E2.** Write `docs/ffiec-bulk-importer-spec-2026-06-23.md` — design spec for the deferred FFIEC CDR bulk-ZIP importer (roadmap A2): REST-only PWS (legacy SOAP retired — don't copy old wrappers), reuse the `withDatabase()` bulk path into `bank-data.sqlite`, RC-B schedule → `BANK_FIELDS` mapping, **additive-period** semantics mirroring `fdic-bulk-sync.js` (never overwrite FedFis periods), and a fixture-driven test plan. **Spec only.**

### F — If the queue empties and there's still night left
- [ ] **F1.** Loop back to **A**: pick another server module with no dedicated `tests/*.test.js` (e.g. `exec-summary-parser.js`, a thin `rep-roster.js` check, a parser edge case not in `parser-regression.test.js`) and add focused characterization tests. Keep going, safest-work-first, until stopped.

---

## FINAL SUMMARY
Codex follow-up on 2026-06-24 handled the low-risk A/D/E path from the queue:

- A1-A5 completed as focused test hardening. Added dedicated `pdf-text`, `portfolio-parser`, and CRM helper tests; extended swap-render and daily-dashboard RV edge coverage; wired the new tests into `npm test`.
- D1 completed as a spec only: `docs/sales-dashboard-wave5-spec-2026-06-23.md`. Grep confirmed spread-per-year-of-duration is not implemented yet; only CD spread-per-month exists.
- E1 completed as verify-and-log. Task engine, opportunities, activity soft-delete, and contacts/Salesforce import are already shipped. Graph mailbox and Bloomberg TOMS remain org/contract-blocked.
- E2 completed as a spec only: `docs/ffiec-bulk-importer-spec-2026-06-23.md`.
- B/C were not executed in this pass: CSS facelift remains optional, and dead CSS pruning was deliberately deferred.
- Verification: `npm test` passed after granting loopback permission for the HTTP regression tests.

---

## Progress log
_(append one dated line per iteration: `- HH:MM — <task id> — <commit sha> — <one line>` or `- HH:MM — <task id> — SKIPPED — <why>`)_

- 21:?? — setup — queue created on branch claude/overnight-2026-06-23; baseline npm test green.
- 08:34 — A1-A5 — VERIFIED — added focused characterization tests for PDF text rendering, portfolio parsing, CRM tasks/opportunities, swap-render sent snapshots, and Sales Dashboard RV edge cases; npm test passed.
- 08:34 — D1 — VERIFIED — wrote spread-per-year-of-duration Wave-5 spec; grep confirmed only CD spread-per-month exists today.
- 08:34 — E1 — VERIFIED — task engine, opportunities, soft-delete, and Salesforce contacts import are already shipped; Graph mailbox and Bloomberg TOMS remain blocked outside unattended code work.
- 08:34 — E2 — VERIFIED — wrote FFIEC CDR bulk-ZIP importer spec; npm test passed.
