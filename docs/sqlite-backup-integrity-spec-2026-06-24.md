# Self-checking SQLite backup + integrity tick (REL-4)

Status: **proposed only — needs owner decisions (see bottom).** Do not build the
destination/retention/cadence policy until the owner answers; the engine itself is
loop-safe additive code, but the *value* of a backup is decided by the policy, not
the code, so this spec keeps them separate.

Spec author: docs-spec-writer agent, 2026-06-24. Grounded against the real modules
(`server/log-rotation.js`, `server/sqlite-db.js`, `server/server.js` go-live builder
+ tick/audit patterns, the three store modules). Verified `better-sqlite3@^12.10.0`
exposes both `db.backup()` and `VACUUM INTO` against SQLite 3.53.1 in this repo.

---

## Problem / why

The portal treats the daily document package as filesystem-as-database — recoverable
by `mv`-ing folders, and re-derivable by re-publishing. The bank financial DB
(`bank-data.sqlite`, ~136 MB) is large but **rebuildable** from the ~153 MB FedFis
workbook via `bank-data-importer.js`. None of those need a real backup.

But three SQLite stores hold **hand-entered, irreplaceable** state that exists nowhere
else and cannot be re-derived from any source file:

| Store | File (under `data/bank-reports/`) | What's irreplaceable |
|---|---|---|
| CRM | `bank-coverage.sqlite` | coverage status/priority/owner, **manual rep activities** (call/email/meeting/note timeline), tasks, opportunities/pipeline, contacts, watchlists, archival `bank_notes` |
| Strategies Queue | `bank-strategies.sqlite` | Bond Swap / Muni BCIS / CECL / Misc requests + their workflow history |
| Bond Swap | `swap-proposals.sqlite` | proposals, legs, and the **frozen sent-proposal snapshots** that are the canonical client-facing record |

A corrupted file, a fat-fingered `DELETE`, a bad in-place migration, or disk failure
loses months of CRM history and the firm's record of what was sent to clients —
exactly the SEC 17a-4 / FINRA 4511 communications-and-records material the company
context flags as the portal's compliance value (`docs/company-portal-context.md`).
Today there is **zero** in-portal backup or integrity verification for these files,
and the go-live panel can report "all green" while one of them is silently corrupt.

Two constraints shape the whole design:

1. **No cron, no email, no new npm dep.** Backups must ride the existing in-process
   tick/audit machinery and use only `better-sqlite3` (already a dep) + Node `fs`.
2. **The `data/` layout is frozen.** Anything that breaks `/api/archive` or Explorer
   date-routing breaks saved bookmarks. So backups go to a **new, additive** subtree
   that no existing reader walks (a `_`-prefixed dir is already the convention for
   "never served"), and the file-serving routes already refuse `_`-prefixed paths.

A subtle correctness point that rules out the naive answer: all three stores run
`PRAGMA journal_mode = WAL` (confirmed in `ensureCoverageDatabase` /
`ensureStrategyDatabase` / `ensureSwapDatabase`). A plain `fs.copyFileSync` of a WAL
database can capture a torn/stale copy that misses committed-but-not-checkpointed
pages. The backup **must** go through SQLite's own consistent-snapshot path
(`db.backup()` or `VACUUM INTO`), not a byte copy.

---

## Exact approach

### What gets backed up (the allowlist)

A small allowlist module — the single source of truth, mirroring how `MAP_FIELD_KEYS`
and `SLOT_NAMES` are centralized:

```js
// server/sqlite-backup.js
const PROTECTED_STORES = [
  { key: 'coverage',   filename: 'bank-coverage.sqlite' },
  { key: 'strategies', filename: 'bank-strategies.sqlite' },
  { key: 'swap',       filename: 'swap-proposals.sqlite' },
];
```

`bank-data.sqlite` is **deliberately excluded** (rebuildable; ~136 MB would dominate
the backup footprint and defeat retention). One line of code adds a future store if
one ever holds irreplaceable hand-entered state.

All three resolve under `BANK_REPORTS_DIR` (= `data/bank-reports/`), which already
follows `DATA_DIR`. The store modules export their filename constants
(`COVERAGE_DATABASE_FILENAME`, `STRATEGY_DATABASE_FILENAME`,
`SWAP_DATABASE_FILENAME`) — the allowlist can import those constants instead of
re-typing the strings, so a future rename can't drift.

### Where backups land

```
<backupRoot>/
├── coverage/
│   ├── bank-coverage-2026-06-24T0930.sqlite
│   ├── bank-coverage-2026-06-23T0930.sqlite
│   └── ...
├── strategies/
│   └── bank-strategies-<stamp>.sqlite
├── swap/
│   └── swap-proposals-<stamp>.sqlite
└── _backup-state.json          ← last run, last integrity result, rotation counts
```

- **Default `backupRoot` = `path.join(DATA_DIR, '_backups')`.** A new `_`-prefixed
  top-level dir under `DATA_DIR`. It does NOT touch `data/current`, `data/archive`,
  `data/bank-reports`, or any path an existing reader walks, so the frozen-layout
  invariant holds. `_`-prefix means both file-serving routes already refuse to serve
  it (defense in depth — it should never be web-reachable anyway).
- **Owner override `FBBS_BACKUP_DIR`** (env var, optional) redirects `backupRoot`
  to an operator-supplied path — e.g. a mapped network share or a second physical
  disk. This is the lever for off-box durability (**OWNER DECISION #1**). If unset,
  same-disk default applies and the go-live panel says so explicitly (see below).
- Timestamp format `YYYY-MM-DDTHHmm` (filesystem-safe, lexically sortable — same
  spirit as the `YYYY-MM-DD` archive convention; readers never parse these names,
  so the extra `T` precision is free).

### The backup engine (`server/sqlite-backup.js`, pure-ish, node-testable)

Modeled directly on `log-rotation.js`: pure `fs`/`better-sqlite3`, no server
coupling, best-effort, **never throws into a tick**, unit-tested against a temp dir.
It takes `backupRoot` as an argument (like `rotateFileIfNeeded` takes `filePath`) so
tests drive it without `DATA_DIR`.

**`backupOneStore(srcPath, destDir, { keep })` → result object.** For one store:

1. If `srcPath` doesn't exist, return `{ skipped: 'missing-source' }` (a fresh box
   that has never created the CRM DB has nothing to back up — not an error).
2. Run a consistent online backup to a temp file in `destDir`, then atomic-rename
   into place. Two viable mechanisms (**OWNER/IMPL DECISION #4**, recommendation
   below):
   - **`VACUUM INTO`** via the existing `withDatabase()` from `sqlite-db.js`:
     ```js
     withDatabase(srcPath, (db) => db.exec(`VACUUM INTO '${tmp}'`));
     ```
     Produces a fully-checkpointed, defragmented, single-file copy (no `-wal`/`-shm`
     sidecars to ship). The destination path is the only interpolated value and it's
     server-generated (never user input) — but it still gets the standard single-quote
     escape, and a `safeJoin`-style guard keeps it inside `destDir`.
   - **`db.backup(destPath)`** (better-sqlite3's online backup API, returns a Promise):
     copies page-by-page, can back up a live DB without blocking writers for long.
   - **Recommendation: `VACUUM INTO`.** It slots into the existing `withDatabase`
     helper with one line, yields a clean standalone file (no WAL sidecars to manage
     in retention), and these DBs are small (CRM is the largest and is well under the
     bank DB). `db.backup()` is the better tool only if write-contention during the
     copy ever becomes a problem — note for the future, not v1.
3. Rotate: keep the newest `keep` files in `destDir`, delete the rest. Reuse the
   **exact rotation discipline of `log-rotation.js`** but by mtime/name sort rather
   than numbered suffixes (timestamped filenames make "keep newest N, unlink the
   rest" the natural form). Best-effort `unlinkSync` in a `try/catch`, oldest-first.
4. Return `{ key, bytes, durationMs, kept, pruned, path }` (or `{ error }`).

**`runBackup(backupRoot, { keep })` → summary.** Iterates `PROTECTED_STORES`,
calls `backupOneStore` for each, aggregates, writes `_backup-state.json`
(`{ lastRunAt, results:[...], integrity:{...} }`), returns the summary. Each store
is isolated in its own `try/catch` (the `buildGlobalSearch` fan-out pattern) so a
single bad file never aborts the other two backups.

### The integrity check (cheap, runs more often than backups)

```js
// server/sqlite-backup.js
function integrityCheck(srcPath, { quick = true } = {}) {
  // PRAGMA quick_check (fast, ~struct + index sanity) by default;
  // PRAGMA integrity_check (full, slower, full page scan) on demand.
  return withDatabase(srcPath, (db) => {
    const rows = db.pragma(quick ? 'quick_check' : 'integrity_check');
    const ok = rows.length === 1 && String(rows[0].quick_check ?? rows[0].integrity_check) === 'ok';
    return { ok, messages: ok ? [] : rows.map(r => Object.values(r)[0]) };
  });
}
```

- **`quick_check`** is the per-tick default — bounded cost, catches the
  overwhelming majority of corruption (page/index structure) without a full scan.
- **`integrity_check`** (full page scan) runs (a) right after each backup, on the
  *backup copy* — so the integrity result describes what we actually saved, and a
  corrupt source is caught before it silently overwrites the last good backup; and
  (b) on demand via the admin route with `?full=1`.
- `quick_check` over all three live stores is what surfaces on the go-live panel.

**Verify-the-backup ordering:** integrity-check the source first; if the source is
already corrupt, still write the backup but stamp `sourceCorrupt:true` in the result
and **do not prune** the rotation set (the older, possibly-good backups are now more
valuable than ever). This is the rotation analog of `log-rotation.js` choosing not
to drop a record when the rename fails.

### Where it slots in (server.js wiring — additive only)

Constants near the other `DATA_DIR`-derived paths (~line 202-216):

```js
const BACKUP_DIR = process.env.FBBS_BACKUP_DIR
  ? path.resolve(process.env.FBBS_BACKUP_DIR)
  : path.join(DATA_DIR, '_backups');
const BACKUP_KEEP = clampInt(process.env.FBBS_BACKUP_KEEP, 14, 1, 90);   // default 14
const BACKUP_ENABLED = process.env.FBBS_BACKUP !== '0';
```

**(a) On-publish hook (the primary cadence, no cron needed).** A package publish is
the natural "the desk is active and something changed" beat. After a *successful*
publish, kick a backup. The cleanest place is right after the existing
`invalidatePackageCache()` call in `publishPackageFilesUnsafe` (line ~9654) — fire it
**non-blocking** so it never delays the publish response or holds `publishBusy`:

```js
invalidatePackageCache();
// ... existing publish-success path ...
if (BACKUP_ENABLED) {
  setImmediate(() => {
    try {
      const summary = sqliteBackup.runBackup(BACKUP_DIR, { keep: BACKUP_KEEP, reportsDir: BANK_REPORTS_DIR });
      appendAuditLog({ event: 'sqlite-backup', trigger: 'on-publish', ...summary });
    } catch (err) { log('warn', 'SQLite backup (on-publish) failed:', err.message); }
  });
}
```

**(b) Startup tick + daily safety net.** Same arming pattern as `autoFdicSyncTick`
(server.js ~11777): first run ~10 min after boot (stay out of startup's way), then a
24h `setInterval`, **stamp-guarded** by `_backup-state.json.lastRunAt` so a restart
loop can't spam backups and so a box that publishes every day doesn't double-back-up.
`FBBS_BACKUP=0` disables (mirrors `FBBS_AUTO_PUBLISH=0` / `FBBS_AUTO_FDIC_SYNC=0`).

```js
async function backupTick() {
  try {
    let lastRunAt = readBackupState().lastRunAt || null;
    if (lastRunAt && Date.now() - Date.parse(lastRunAt) < BACKUP_EVERY_MS) return; // 20h guard
    const summary = sqliteBackup.runBackup(BACKUP_DIR, { keep: BACKUP_KEEP, reportsDir: BANK_REPORTS_DIR });
    appendAuditLog({ event: 'sqlite-backup', trigger: 'tick', ...summary });
  } catch (err) { log('warn', 'SQLite backup tick failed:', err.message); }
}
```

The on-publish path and the tick share `runBackup`, which is idempotent within a
short window via the stamp guard — so on a normal publishing day the on-publish
backup runs and the tick no-ops; on a quiet day (no publish) the tick covers it.

**(c) Admin route — manual trigger + restore-prep.** Mirrors `/api/admin/fdic-sync`
exactly (same admin gate: `(IS_IIS_AUTH_MODE || ADMIN_USERS.size > 0) && !auth.isAdmin → 403`):

```
POST /api/admin/sqlite-backup            run all three backups now → summary
GET  /api/admin/sqlite-backup            list current backup files per store (name, bytes, mtime) + last state
GET  /api/admin/sqlite-backup/integrity[?full=1]   run quick_check (or integrity_check) over the three live stores
```

All three are admin-gated, audited (`sqlite-backup` / `sqlite-backup-integrity`),
and read-only with respect to the live DBs (backup creates files in `_backups/`;
integrity opens read-only). There is **no restore route** — restore is a deliberate,
out-of-band operator action (see Restore procedure); the portal never auto-restores.

**(d) Go-live panel surface.** Add two `statusCheck` entries to the `checks` array in
`buildGoLiveStatus` (server.js ~2779), computed from `_backup-state.json` and a live
`quick_check`, reusing the existing `ageLabel` / `importAgeState` helpers:

```js
statusCheck(
  'sqlite-backup',
  'CRM/strategy/swap backups',
  backupState.lastRunAt ? importAgeState({ available:true, importedAt: backupState.lastRunAt }, 2) : 'fail',
  backupState.lastRunAt
    ? `Last backup ${ageLabel(backupState.lastRunAt)} → ${BACKUP_DIR}${backupOffBox ? '' : ' (SAME DISK — set FBBS_BACKUP_DIR for off-box copies)'}`
    : 'No backup has run yet — irreplaceable CRM/strategy/swap data is unprotected.'
),
statusCheck(
  'sqlite-integrity',
  'Store integrity',
  integrityAllOk ? 'ok' : 'fail',
  integrityAllOk ? 'quick_check passed on coverage, strategies, swap.' : `Integrity check FAILED: ${failedStores.join(', ')}.`
),
```

The same-disk caveat is surfaced as a `warn`-flavored detail string even when state
is `ok`, so an admin who never set `FBBS_BACKUP_DIR` is reminded every time they open
the panel that same-disk backups don't survive a disk failure.

### Response shape (admin route + state file)

```jsonc
// GET /api/admin/sqlite-backup
{
  "backupDir": "/data/_backups",
  "offBox": false,
  "keep": 14,
  "lastRunAt": "2026-06-24T13:30:11.402Z",
  "stores": [
    { "key": "coverage",   "filename": "bank-coverage.sqlite",
      "backups": [ { "name": "bank-coverage-2026-06-24T0930.sqlite", "bytes": 245760, "mtime": "..." } ],
      "count": 14, "newestAt": "...", "oldestAt": "...",
      "lastResult": { "bytes": 245760, "durationMs": 31, "kept": 14, "pruned": 1, "sourceCorrupt": false } },
    { "key": "strategies", "...": "..." },
    { "key": "swap",       "...": "..." }
  ],
  "integrity": { "coverage": { "ok": true }, "strategies": { "ok": true }, "swap": { "ok": true } }
}
```

### UI shape

Minimal, admin-only — this is plumbing, not a rep surface:

- The two new go-live checks render in the existing `#upload` go-live panel rows (no
  new markup — they're just two more `checks[]` entries the panel already iterates).
- A small "Backups" sub-card on the Upload/Admin page: per-store newest-backup age +
  count, a "Back up now" button (`POST /api/admin/sqlite-backup`), a "Run full
  integrity check" button (`GET .../integrity?full=1`), and the same-disk/off-box
  caveat line. All admin-gated; non-admins never see it (consistent with hiding
  Upload/Admin/Exec Summary).

---

## Reuse (existing helpers, not new primitives)

- **`server/sqlite-db.js` `withDatabase(dbPath, fn)`** — the exact "one connection,
  do work, close" helper the bank-workbook bulk import uses; `VACUUM INTO` and
  `quick_check` run through it. No new SQLite access pattern.
- **`server/log-rotation.js`** — the rotation/retention discipline (keep N,
  best-effort unlink oldest, never throw, unit-test against temp dir) is copied in
  spirit; the new module is its sibling.
- **Tick arming** — `autoFdicSyncTick` (server.js ~9020) is the template: stamp-file
  guard (`_backup-state.json` ↔ `auto-sync-state.json`), 10-min-after-boot start,
  `FBBS_*=0` disable, `appendAuditLog` on each run, `log('warn', …)` on failure.
- **`appendAuditLog`** (server.js ~8496) — every backup/integrity run writes one
  audit line, same `{ event, ...payload, at }` shape as `fdic-sync` / `folder-auto-publish`.
- **`buildGoLiveStatus` + `statusCheck` + `ageLabel` + `importAgeState`**
  (server.js ~2725, ~2639, ~2687) — the new freshness/integrity checks reuse these
  verbatim; no new status framework.
- **Admin gate** — copy the `/api/admin/fdic-sync` 403 guard verbatim.
- **Store filename constants** — `COVERAGE_DATABASE_FILENAME` /
  `STRATEGY_DATABASE_FILENAME` / `SWAP_DATABASE_FILENAME` are already exported; import
  them so the allowlist can't drift from the real filenames.
- **`_`-prefix + `safeJoin`** — existing "never served / never escape" conventions
  cover the new `_backups/` tree.

No new npm dependency (`better-sqlite3` is already a dep, ships prebuilt). No build
step. No email/cron. No new auth surface.

---

## Constraints respected / bent

**Respected:**
- Two-npm-dep rule — zero new deps; uses `better-sqlite3` + Node `fs` only.
- Frozen `data/` layout — backups go to a NEW additive `_backups/` subtree (or an
  operator path); nothing an existing reader walks is touched; `/api/archive` and
  Explorer date-routing are untouched.
- Plain Node, no build — pure module, mirrors `log-rotation.js`.
- LAN/IIS, roles Admin/Rep only — the only new routes are admin-gated; no app login,
  no users/roles table, no new identity surface. Reps never see backups.
- Audit + tick patterns — rides `appendAuditLog` and the existing `setInterval`
  arming; no new infra type.
- WAL correctness — backup goes through SQLite's consistent-snapshot path, never a
  byte copy, so a WAL-mode DB is captured cleanly.
- Bloomberg/S&P licensing — N/A (no market data involved).

**Bent / honest caveats:**
- **Same disk by default.** Without `FBBS_BACKUP_DIR` the backups sit on the same
  physical disk as the live DBs — protection against *logical* loss (bad DELETE,
  corrupt migration, accidental `DROP`) but **not** against disk/host failure. This
  is surfaced loudly on the go-live panel and is **OWNER DECISION #1**. The "real"
  off-box answer needs an operator-supplied path; the portal can't invent one without
  the no-cron/no-infra rule being bent (no rsync daemon, no cloud SDK).
- **No automatic restore.** Restore is intentionally a manual, audited, out-of-band
  operator step (below), not a route — automating restore would mean the portal can
  overwrite the live CRM DB programmatically, which is a bigger blast radius than the
  problem warrants.
- **Cadence is event/tick-driven, not guaranteed-daily.** Absent cron, "daily" is a
  best-effort 24h tick plus an on-publish trigger. On a box that's off overnight and
  not publishing, a calendar day could be skipped. Acceptable given the data changes
  during the working day when the server is up and publishing — but it's
  **OWNER DECISION #2** whether that's sufficient.

---

## Restore procedure (operator runbook — document, don't automate)

Restore is rare, high-stakes, and out-of-band. Documented in this spec and in a
short `data/_backups/RESTORE.md` written on first backup:

1. **Stop the portal** (Ctrl+C / stop the IIS app pool). Never restore under a live
   server — it has open handles on the WAL DB.
2. Identify the newest **good** backup for the affected store: check
   `_backups/<store>/` (newest by name/mtime) and confirm
   `GET /api/admin/sqlite-backup/integrity?full=1` reported `ok` for it, or run
   `sqlite3 <backup> "PRAGMA integrity_check;"` on the copy out-of-band.
3. **Move the live file aside, don't delete it** —
   `mv data/bank-reports/bank-coverage.sqlite bank-coverage.sqlite.bad-<date>`
   (plus its `-wal`/`-shm` sidecars if present). Forensics may want the corrupt file.
4. Copy the chosen backup into place under the live filename
   (`cp _backups/coverage/bank-coverage-<stamp>.sqlite data/bank-reports/bank-coverage.sqlite`).
   The backup is a clean `VACUUM INTO` single file — no sidecars to copy.
5. Restart the portal. The store's `ensure…Database` migration re-applies
   `journal_mode = WAL` and is idempotent/PRAGMA-guarded, so opening the restored
   file is safe.
6. Verify on the go-live panel (integrity `ok`) and spot-check the data in the UI.
7. Note the gap: any CRM activity/task/opportunity/proposal entered *between* the
   chosen backup and the failure is lost — quantify it from the audit log
   (`appendAuditLog` records every mutating CRM/swap action) so reps can re-enter.

**Restore-drill ownership is OWNER DECISION #3** — a backup that has never been
test-restored is a hope, not a backup. The spec recommends a quarterly drill (restore
into a scratch `DATA_DIR`, confirm row counts) owned by whoever owns the box.

---

## Test plan (plain-node, fixture-driven, no network)

New `tests/sqlite-backup.test.js` (plain `node`, no framework — same style as the
other suites; wire into `npm test`). Drives `server/sqlite-backup.js` against a
temp dir built with `better-sqlite3` directly (no `DATA_DIR`, no live server):

1. **Backs up a WAL DB consistently.** Create a temp WAL store, write rows without an
   explicit checkpoint, run `backupOneStore`, open the backup, assert all rows present
   (proves it's not a torn pre-checkpoint byte copy).
2. **Produces a standalone single file.** Assert the backup file exists and there are
   no `-wal`/`-shm` sidecars next to it (VACUUM INTO property).
3. **Rotation keeps newest N.** Run `runBackup` N+3 times (with monotonic stamps),
   assert exactly `keep` files remain and the oldest were pruned — the
   `log-rotation.js` analog.
4. **Missing source is skipped, not fatal.** Point at a non-existent store file;
   assert `{ skipped:'missing-source' }` and that the other stores still back up.
5. **`integrityCheck` passes a clean DB / fails a corrupt one.** Clean DB →
   `{ ok:true }`. Corrupt a copy (truncate / flip a page header byte) → `{ ok:false }`
   with messages; assert the corrupt source is NOT pruned from the rotation set
   (`sourceCorrupt` guard).
6. **`quick_check` vs `integrity_check` selectable** via the `quick` flag.
7. **State file shape.** After `runBackup`, `_backup-state.json` parses and carries
   `lastRunAt`, per-store `results`, and `integrity`.
8. **Never throws.** A store file with bad permissions / a destDir that can't be
   written returns `{ error }` in the summary rather than throwing (best-effort, like
   `rotateFileIfNeeded`).
9. **Allowlist excludes `bank-data.sqlite`.** Assert `PROTECTED_STORES` contains
   coverage/strategies/swap and NOT `bank-data.sqlite` (guards against someone adding
   the 136 MB rebuildable DB and blowing up retention).

`go-live-smoke.js` gets one added assertion: `GET /api/admin/sqlite-backup` returns
the three stores' status (admin path; the smoke harness already authenticates as
admin for `/api/admin/go-live-status`).

---

## Effort / blast radius

- **Effort:** M. New `~180-line` pure module + ~5 wiring points in server.js (consts,
  on-publish hook line, tick + arming, 3 routes, 2 go-live checks, small admin
  sub-card in portal.js/index.html/css). The engine is the bulk and is independently
  testable.
- **Blast radius:** Low for the engine (purely additive new files + a new `_backups/`
  dir; touches no existing reader, no existing schema, no existing route). The only
  edits to hot code are: one non-blocking `setImmediate` line in the publish path
  (must not hold `publishBusy` or delay the response — that's the one place to be
  careful), the tick arming block (copy of the FDIC pattern), and two `checks[]`
  entries. No migration, no data-layout change, no dep change.
- **Loop-safe vs owner-gated:** The **engine + tests + integrity tick are loop-safe**
  (additive, no infra, no policy). The **policy is owner-gated** — destination
  (same-disk vs operator path), retention depth, whether tick+publish cadence is
  acceptable, and restore-drill ownership are calls only the owner can make. An
  unattended loop could safely land the module, tests, the same-disk default, and the
  go-live integrity surface; it should NOT decide off-box destination or claim the
  cadence is "compliant" without the owner.

---

## Open questions / OWNER DECISIONS

1. **Backup destination + durability (the big one).** Default is same-disk
   (`DATA_DIR/_backups`), which protects against logical loss but NOT disk/host
   failure. Does the owner want to set `FBBS_BACKUP_DIR` to an off-box path (mapped
   network share / second disk / IT backup-swept folder)? If staying same-disk, the
   owner accepts that a disk failure loses both the live DB and its backups — the
   go-live panel will say so on every view. **No code can fix this without an
   operator-supplied path** (the no-cron/no-infra rule forbids the portal running its
   own off-box sync).

2. **Retention depth + cadence sufficiency.** Default `FBBS_BACKUP_KEEP=14` (≈14
   publishing days). Deeper retention (e.g. keep-30, or keep-N-daily + keep-M-weekly
   thinning) costs disk but widens the recovery window for a corruption noticed late.
   And: is **on-publish + 24h tick** (no cron) an acceptable cadence, accepting that a
   day with no publish and an overnight-off box could skip a calendar day? Owner to
   confirm depth and that the cadence meets any records-retention expectation.

3. **Restore-drill ownership.** A never-test-restored backup is unproven. Who owns a
   periodic restore drill (recommended quarterly: restore into a scratch `DATA_DIR`,
   confirm row counts), and is that cadence acceptable? This is a process decision,
   not code.

4. **Mechanism: `VACUUM INTO` vs `db.backup()`** (impl detail, owner FYI). Spec
   recommends `VACUUM INTO` (one-line via `withDatabase`, clean standalone file, no
   WAL sidecars, fits these small DBs). `db.backup()` (online, page-by-page, lower
   write-contention) is the fallback if write-blocking during the copy ever matters —
   not expected at current DB sizes. Owner only needs to weigh in if they have a
   preference; otherwise the implementer takes the recommendation.

5. **Compliance framing (defer to compliance owner).** These backups are also a
   17a-4 / 4511 records-protection control for the swap-proposal snapshots and CRM
   communications timeline. Should the backup state/audit be part of the firm's
   documented supervisory/retention controls, or is it purely operational DR? This
   overlaps the broader CMP-* compliance bucket and should be confirmed with the
   firm's compliance owner before it's described as a compliance control anywhere
   client- or examiner-facing.
