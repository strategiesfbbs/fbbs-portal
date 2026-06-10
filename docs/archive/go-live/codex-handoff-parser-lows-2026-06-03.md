# Handoff to Codex — parser/classification behavior fixes (from the 2026-06-03 review)

**Context.** The 2026-06-03 multi-agent review ([final-review-2026-06-03.md](final-review-2026-06-03.md)) produced 29 confirmed findings. Claude Code has fixed and pushed **all 10 mediums + 9 safe lows** (origin/main `0f056e5`). The six findings below were **deliberately deferred to Codex** because each changes parser or classification *behavior*, and verifying them safely needs **representative source files** (trader workbooks / desk PDFs) as test fixtures — doing them blind risks silently breaking ingestion right before go-live.

Each item lists the precise fix (including refinements the review's adversarial verifiers caught — read those, they correct the naive fix), the **fixtures you'd want**, and the risk. They're independent; take them in any order. Add a regression case to `tests/parser-regression.test.js` for each.

---

## L15 — Agencies & corporates parsers assume the header is row 1 (silent total data loss)
**Files:** `server/agencies-parser.js:128,131,200-202`, `server/corporates-parser.js:164,167`

**Problem.** Both call `XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: null })` (object mode) and derive headers from `Object.keys(rows[0])`. Object mode treats the *first* row as the header. Any title/as-of/banner row above the real column headers (common in desk exports) makes `buildHeaderMap()` find none of the required columns → the sheet returns `[]` with only a soft warning. One extra title row = an empty Agencies/Corporates Explorer for the day, easy for a rep to miss.

**Fix.** Mirror the **treasury parser's** header scan (it already does this right). In `parseSheet` (agencies) and `parseCorporatesSheet` (corporates): read with `{ header: 1, raw: true, defval: null }` (array-of-arrays), scan the first ~30 rows for the row whose `buildHeaderMap` covers the required canonical columns, treat that as the header, build records from rows below it.
- **Critical refinement:** the per-row `row ${i+2}` warning offsets currently assume the header is row 1 — **recompute them from the detected header index**, or the warnings point at the wrong rows.

**Fixtures needed:** a real `bullets`, `callables`, and `corporates` workbook **with a banner/title row above the headers**, plus the current clean ones (to prove no regression).

**Risk:** medium — switching object-mode → `header:1` changes the whole row-indexing path. Keep `defval`/`raw` behavior and the existing per-row required-field checks.

---

## L19 — Internal CD cost workbook misclassified to `agenciesBullets` (sensitive-data exposure)
**File:** `server/server.js:478-497,534-541,556,6746-6749`

**Problem.** `looksLikeInternalCdWorkbook()` (recognizes `master`/`cost`/`commission`/`spreadsheet` names) is consulted by `classifyFolderDropFile()` to **exclude** internal workbooks — but the **primary multipart upload path** classifies via `classifyFile()`, which does *not* consult it. `classifyFile()`'s xlsx branch has no keyword for those names, so it hits the catch-all `return 'agenciesBullets'`. An internal commission/cost spreadsheet can be routed into the Agencies Bullets slot, **served in the public daily package**, and parsed as agency offerings.

**Fix.** Add an internal-CD short-circuit to `classifyFile()`'s xlsx branch — but **placement matters**:
- Place it **AFTER** the existing cdoffers keyword check (after `server.js:491`), **not** before it. The naive placement regresses the legitimate `CDs - Cost.xlsx` route (it matches `cost`, so it'd wrongly return `null` instead of `cdoffers`).
- Correct minimal fix: after the cdoffers block, `if (looksLikeInternalCdWorkbook(filename)) return null;` (returning `null` = unclassifiable → skipped at publish with the existing "Could not classify" log, matching `classifyFolderDropFile`).

**Fixtures needed:** the actual internal cost/commission workbook filename(s) the desk uses, plus a real `CDs - Cost.xlsx` (the false-positive guard) and a normal agencies workbook.

**Risk:** low — `null` means "silently skipped" (desired) rather than misrouted. Confirm no other legitimate slot file name trips `looksLikeInternalCdWorkbook`.

---

## L20 — Stale prior-day package merges into today when `_meta.json` is missing/dateless
**File:** `server/server.js:6755-6757,6775-6783`

**Problem.** The archive-rollover decision sets `archiveDate` from `priorMeta.date` only if `_meta.json` exists, else defaults to `todayStamp()`. If `CURRENT_DIR` holds prior-day files but `_meta.json` is absent or its `date` is empty (corrupt write, manual placement, interrupted publish, restore-without-meta), `archiveDate === todayStamp()` → the "same day" branch → yesterday's docs bleed into today's package and never archive (breaks archive history + date-routed Explorer bookmarks). Silent.

**Fix.** When `CURRENT_DIR` is non-empty but no usable meta date exists, **derive** a fallback instead of assuming today. Replace `if (!archiveDate) archiveDate = todayStamp();` (line 6780) with: scan existing non-`_` slot files for `sniffDateFromFilename(f)` and/or take the newest file mtime's `YYYY-MM-DD`; use `todayStamp()` only when nothing derivable. Apply the same derivation to `existingPackageDate` (line 6756) so the agencies pre-check agrees.

**Fixtures needed:** mostly unit-testable — simulate a `CURRENT_DIR` with dated slot files and no `_meta.json`. A couple of real slot filenames (to confirm `sniffDateFromFilename` patterns) help.

**Risk:** medium — a misleading embedded date in a static template name could pick a wrong archive date. Mitigate by **preferring mtime**, using filename sniff only when files agree.

---

## L17 — `bank-data-importer` falls back to a hardcoded `sheet9.xml` worksheet path
**File:** `server/bank-data-importer.js:172-196,385,413-421`

**Problem.** `findWorksheetPath()` resolves `ALL_DATA` via `xl/workbook.xml` + rels, but on any parse failure / different sheet name it falls through to a literal `return 'xl/worksheets/sheet9.xml'`. If the ~153MB source workbook's sheet ordering shifts (Excel re-save, added sheet), the streamer parses the wrong sheet; permissive downstream filtering then yields an empty/wrong ~136MB bank DB powering tear sheets + the US Bank Map.

**Fix (two low-risk hardening steps):**
1. In `findWorksheetPath` — when `ALL_DATA` can't be resolved by name, **throw** an explicit `Error('Could not locate ALL_DATA worksheet in workbook')` instead of returning `sheet9.xml`. The streaming reject path + `writeBankDatabase`'s backup-swap already abort safely, preserving the prior DB.
2. In `handleBankDataUpload` — reject with 400 when `metadata.bankCount===0` / `rowCount===0` ("No bank rows parsed — wrong worksheet or unexpected layout").

**Fixtures needed:** a real bank workbook (or a trimmed copy) where `ALL_DATA` is **not** the 9th sheet, plus the current one (to prove the happy path still resolves by name). This is the hardest to fixture (153MB source) — a hand-built minimal xlsm with a reordered `ALL_DATA` sheet is the pragmatic test.

**Risk:** low-medium — removing the fallback drops a safety net for a legitimately-malformed-but-importable workbook where the hand-rolled rels regex fails yet `sheet9` happens to be `ALL_DATA`. Weigh whether to keep the fallback *with a loud warning* vs. throwing.

---

## L16 — `findAsOfDate` matches any date cell adjacent to the word "date"
**File:** `server/treasury-notes-parser.js:160-173`

**Problem.** The as-of detector accepts the first parseable date whenever the previous cell or the cell itself matches `/as\s*of|date/i`. "date" appears in many headers (`Settle Date`, `Maturity Date`, `Trade Date`), so a pre-header label or a bleeding header row can stamp the package with the wrong as-of date into `_treasury_notes.json`.

**Fix.** Two passes: **first** accept only a date whose cell-or-left-neighbor matches explicit `/as\s*of/i` (plus the existing embedded `as of: <date>` regex); **second** (only if the first found nothing) fall back to the current `/date/i` neighbor match. Keep the filename fallback (lines 57-58). Optionally narrow the window to `rows.slice(0, headerIndex)` so the header row itself is excluded. Pure-function change confined to `findAsOfDate`.

**Fixtures needed:** a treasury export whose pre-header band contains a `*Date` label near a parseable date (the failing case). Note the current fixtures rely on the filename sniff / embedded `as of` form, so they won't catch this — a new fixture is required.

**Risk:** low — local to `findAsOfDate`; existing fixtures should stay green.

---

## L14 — Economic-update event names paired to dates/times by array index
**File:** `server/economic-update-parser.js:179-201`

**Problem.** On the non-inline path, event names and date/time stamps are collected into independent `pendingNames[]` / `pendingDates[]` and zipped by index (`pendingNames.forEach((event,index)=>...pendingDates[index]...)`). If one date is dropped or one name is filtered as boilerplate, every subsequent name pairs with the **wrong** date/time — plausible-looking (right dates, wrong events) and easy to miss on the dashboard.

**Fix.** Stop fabricating index-zipped pairings. The real PDF fully decouples names from dates (no usable adjacency), so the safe minimal fix is: keep the inline path as-is; for non-inline `pendingNames`, emit `{ event, dateTime: null }` instead of `pendingDates[index]`. Push a warning when `pendingDates.length !== pendingNames.length` so the mismatch is visible. `portal.js:2806` already renders a falsy `dateTime` as `'Watch'`, and `calendarDateParts` tolerates empty.

**Fixtures needed:** a real economic-update PDF that exercises the **non-inline** path (separate name/date lines) — the one where counts differ (the review saw 27 dates vs ~15 names).

**Risk:** low — non-inline rows show "Watch"/no time instead of a *wrong* time. Confirm the inline path (correct pairings) is untouched.

---

### Notes for whoever picks these up
- All six are **confirmed** findings with adversarial verification; the fixes above already incorporate the verifiers' corrections to the naive approach.
- The repo's test gate is `npm test` (plain `node`, no framework) — keep `main` green; the Claude-side trunk-guard hook only runs in Claude Code, so run `npm test` yourself before committing.
- Constraints unchanged: 2 npm deps, no build step, SheetJS stays vendored, `_`-prefixed files never served.
