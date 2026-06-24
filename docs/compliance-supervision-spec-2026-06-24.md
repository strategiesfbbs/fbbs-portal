# Compliance & Supervision Suite — Spec

**Status: PROPOSED ONLY. Do NOT build CMP-1 through CMP-4 until the FBBS compliance owner / registered principal signs off on the artifacts called out under each item's OWNER DECISIONS. CMP-5 (audit-log integrity panel + segment seals) is the one loop-safe, pure-additive item and may be built without a compliance artifact, but its UI wording should still get a compliance read before go-live.**

Generated 2026-06-24 from the `CMP-*` backlog (`docs/feature-backlog-2026-06-24.md`, "Compliance, audit & supervision"). This document defines *options* for a FINRA-regulated broker-dealer; it does not decide them. Every regulatory framing below is the engineer's read and must be confirmed by the firm's compliance officer / WSPs before code lands.

## Why this is framed conservatively

FBBS is a full-service fixed-income broker-dealer for community banks (`docs/company-portal-context.md`). The portal has quietly become a candidate **system of record** for two regulated things:

1. **Client-facing communications** — the swap-proposal one-pager (`server/swap-render.js`) is a printed artifact that goes to a bank; CRM activity notes, opportunity descriptions, and Sales-Dashboard talking points are rep-authored text that can become "communications with the public" under FINRA 2210.
2. **Books-and-records** — the CRM (`bank-coverage.sqlite`) is replacing Salesforce as the durable record of rep-client contact, and the audit log (`data/audit.log`) is the append-only event record.

`docs/company-portal-context.md` explicitly lists "anything that requires permissioning by rep, compliance retention, immutable audit history, or formal approval workflow" under **"Be careful before replacing."** That is exactly this suite. So the governing principle here is: **the spec enumerates the implementable shapes; the compliance owner defines the artifact, the retention destination, the trigger, and the supervisor mapping — and code only follows.**

## Hard context this suite must respect (verified in repo)

- **Two npm deps only** (`pdf-parse`, `better-sqlite3`); SheetJS vendored. Everything below uses Node built-ins (`crypto`, `fs`, `stream`) + the existing `sqlite-db.js` layer. **No new dep.**
- **No email/SMTP, no cron.** Every "notify"/"export" surface must be in-portal, pull-only, or a download. No scheduled delivery. (Retention export is a streamed HTTP download, not an emailed report.)
- **Roles are only Admin and Rep** (`FBBS_ADMIN_USERS`, `server/rep-identity.js`). There is no "principal" role; this suite maps **registered principal → Admin** and surfaces that as an explicit OWNER DECISION on every item.
- **Trusted-LAN + IIS Windows Auth.** Identity = `LOGON_USER`. The shared-workstation caveat (CLAUDE.md security posture) means a supervisory sign-off is only as trustworthy as per-rep Windows logins — call this out wherever a sign-off attributes to a named principal.
- **Parameterized SQL + whitelist identifiers.** All writes bind values via `runSqlite`/`transaction`/`querySqliteJson` in `sqlite-db.js`. No string interpolation of user values.
- **Soft-delete, never hard-delete** (CLAUDE.md CRM layer). The activity model already stamps `deleted_at/deleted_by/delete_reason` and filters in `activitySelectSql`. The retention export must surface deleted rows *with* their reason — the model is already compliance-shaped.
- **Strict CSP** for served HTML outside `/current/`/`/archive/`; any new printable/served page uses inline styles like `swap-render.js`.

---

# CMP-5 — Audit-log integrity panel + tamper-evident segment seals  ·  M/med  ·  **LOOP-SAFE, pure-additive**

This is the one item with no compliance artifact to define first, so it leads. It is read-only over the existing log plus a single additive write at the one rotation point.

## Problem / why

`data/audit.log` is the firm's append-only event record (one JSON object per line, written by `appendAuditLog` at `server/server.js:8496`). Size-based rotation (`server/log-rotation.js` `rotateFileIfNeeded`, env `AUDIT_LOG_MAX_MB`/`AUDIT_LOG_KEEP`) shifts the active file to `.1`, `.1→.2`, etc. Two gaps a supervisor cannot answer today without grepping JSON-lines:

1. **Is the chain intact / un-gapped?** No per-day count, no detection of time-ordering inversions or day gaps.
2. **Was a rotated segment edited after roll?** A `.1`/`.2` file could be altered on disk and nothing would detect it. (CLAUDE.md frames this as *tamper-evident, not preventive* — we can detect after-the-fact edits, not stop them on a writable share.)

## Exact approach

### Seal write (the only behavior change — at the single roll point)

`rotateFileIfNeeded` in `server/log-rotation.js` is the **single** place a segment becomes immutable (the active file is renamed to `.1`). Add a seal step there:

- When the active file is renamed to `${filePath}.1`, compute `SHA-256` of that newly-frozen segment's bytes (`crypto.createHash('sha256')` over the file content; the file is already small-bounded by `maxBytes`, default 10 MB).
- Append a seal record to `data/audit-seals.json` (sibling of the log):
  ```json
  { "segment": "audit.log.1", "sha256": "<hex>", "sealedAt": "<ISO>",
    "bytes": <n>, "lineCount": <n>, "firstAt": "<ISO>", "lastAt": "<ISO>",
    "supersedes": "audit.log.1@<priorSealedAt>" }
  ```
- Because rotation **shifts** filenames (`.1→.2`), a seal must be keyed by *content identity at seal time*, not by the moving filename. Store the seal under a stable content key (the sha256 itself, or a monotonic segment index persisted in `audit-seals.json`) and carry the *current* filename as a hint only. On verify, match a segment file to a seal by recomputing its hash and looking the hash up — filename drift then never breaks verification. **This is the one subtle correctness point in CMP-5: seal by hash, locate by hash.**
- Best-effort + synchronous, matching `rotateFileIfNeeded`'s existing contract ("any fs error during the shift is swallowed; a rotation hiccup must never block the thing being logged"). A seal-write failure logs and continues; a missing seal renders **amber ("unsealed")**, never blocks logging.

`log-rotation.js` is currently server-decoupled (pure fs, unit-testable). Keep it that way: pass `crypto` work inline (it's a Node built-in, no coupling) and keep the function signature additive (`rotateFileIfNeeded(filePath, { maxBytes, keep, sealPath })` — when `sealPath` is omitted, behavior is byte-identical to today, so nothing else that calls it changes).

### Integrity scan (read-only)

New admin-gated `GET /api/admin/audit-integrity` (server.js, beside the existing admin audit read). Reuses `readFileTail` (server.js:8527) for the active file and reads rotated segments directly. Returns:

```json
{
  "segments": [
    { "file": "audit.log", "active": true, "sealState": "live",
      "lines": 1240, "parseErrors": 0, "firstAt": "...", "lastAt": "...",
      "orderInversions": 0 },
    { "file": "audit.log.1", "sealState": "ok|amber|red",
      "recordedSha256": "...", "currentSha256": "...",
      "lines": 9981, "parseErrors": 0, "dayGaps": ["2026-05-30→2026-06-02"],
      "orderInversions": 2 }
  ],
  "perDay": [{ "day": "2026-06-23", "events": 412 }],
  "summary": { "state": "ok|warn|fail", "sealedSegments": 4, "unsealed": 1, "tampered": 0 }
}
```

Per segment: every line parses as JSON with an `at` timestamp; count `parseErrors`; flag time-ordering inversions (a line whose `at` precedes the prior line's `at`) and day gaps; for rotated segments recompute SHA-256 and compare to the recorded seal → **green** (matches), **amber** (no recorded seal — e.g. rotated before this feature shipped), **red** (recorded seal exists and does NOT match — after-the-fact edit detected).

Roll the worst per-segment state into `summary.state` and surface it as an additive `statusCheck` in `buildGoLiveStatus` (server.js:2725; helper `statusCheck` at 2721) so a red seal shows on the go-live panel.

### UI

Extend the existing Admin audit page with an "Audit integrity" panel above the raw log: per-segment green/amber/red badge, per-day event-count bars (reuse the Pulse CSS-bar technique — no chart lib), and a list of flagged inversions/gaps. Admin-gated (the audit page already is).

## Reuse (verified helpers)

- `rotateFileIfNeeded` — `server/log-rotation.js` (the single roll point; add the seal write here).
- `appendAuditLog`, `readAuditLog`, `readFileTail` — `server/server.js:8496/8509/8527`.
- `statusCheck`, `buildGoLiveStatus` — `server/server.js:2721/2725`.
- `crypto` — Node built-in (already used elsewhere, e.g. `crypto.randomUUID()` in `bank-coverage-store.js`).
- Admin gate — `rejectIfUnauthorized`/`isAdminOnlyApiWrite` (server.js:690) for the route; or read-gate via the existing admin-page pattern (server.js:10655-10666).

## Constraints respected / bent

- **Respected:** crypto is built-in (no dep); seal write is additive at the one rotation point and a no-op when `sealPath` is unset (behavior-neutral for every existing caller); panel is read-only; framed as tamper-*evident*, not preventive.
- **Bent:** none. This is the cleanest item in the suite.

## Test plan (plain-node, fixture-driven)

`tests/log-rotation.test.js` (extend) + `tests/audit-integrity.test.js` (new):
- Roll a temp log → a seal record is written; its sha256 matches the frozen segment's bytes.
- Editing a sealed segment on disk → verify reports `red` for that segment.
- A segment with no recorded seal → `amber`, never `red`.
- `sealPath` omitted → `rotateFileIfNeeded` output is byte-identical to current behavior (regression guard).
- Out-of-order `at` lines → counted as `orderInversions`; a multi-day gap → reported in `dayGaps`.
- A malformed (non-JSON) line → counted in `parseErrors`, does not throw.
- Filename-drift case: roll twice so a sealed segment moves `.1→.2`; verify still matches it by hash.

## Effort / blast radius

**M / low blast radius.** One additive arg on a pure fs helper, one new read-only route, one panel. Loop-safe.

### OWNER DECISIONS (CMP-5 — minimal)
1. **Seal cadence sufficiency.** Seals are computed at *rotation* (size-based). Between rolls the active file is unsealed (amber by design — it is still being appended). Confirm tamper-evidence at roll-time is acceptable, or whether the owner wants a periodic checkpoint seal of the active file too (still no cron — could piggyback on `buildGoLiveStatus` reads).
2. **`audit-seals.json` durability.** It lives in `DATA_DIR` next to the log. Confirm it is in the backup/retention scope (it is itself a compliance artifact — if it is lost, sealed segments revert to amber). Pairs with backlog REL-4 (DB/file backup).

---

# CMP-1 — Supervisory review gate on client-facing swap proposals (FINRA 3110)  ·  M/high  ·  **OWNER DECISION REQUIRED**

## Problem / why

Reps freeze and `send` a client-facing swap proposal entirely on their own action. The send path is `draft → sent → executed` (`SWAP_STATUSES` at `server/swap-store.js:33`; `handleSendSwapProposal` at server.js ~6700; `freezeProposal` at swap-store.js ~498; `markExecuted` at swap-store.js ~651). The audit row (`swap-proposal-send`) carries only the rep's username. There is **no recorded principal sign-off** before the one-pager reaches a bank — a FINRA Rule 3110 supervisory-review trail is absent on the most client-facing artifact in the portal.

## Exact approach (two implementable shapes — owner picks)

The send path is the canonical, immutable record (once `sent`, `swap_proposal_snapshots.snapshot_json` is the source of truth). Touching it has the **highest blast radius in the suite**, so the spec defines two shapes and the owner chooses:

### Shape A — HARD gate before execute (recommended if WSPs require pre-use review)
Insert a **`Pending Review`** state. New lifecycle: `draft → pending_review → approved → executed` (plus `cancelled` / `returned`).
- On **send**, still `freezeProposal` (the snapshot must be immutable for the principal to review the exact artifact), but set status to `pending_review` instead of `sent`. Execute is blocked until an admin approves.
- New admin-gated `#review-queue` page (Operations group): lists `pending_review` proposals, renders the read-only artifact via the existing `server/swap-render.js`, and exposes **Approve** / **Return** (with note) actions.
- Approve → status `approved`, stamps `reviewed_by/reviewed_at/review_note` + a `snapshot_sha256` (SHA-256 of `snapshot_json` so the approval is bound to the exact bytes reviewed). Then execute is permitted.

### Shape B — ADVISORY (recommended if review is documented post-hoc)
Keep `draft → sent → executed` unchanged (no gate), but **record** a supervisory review as a first-class event: an admin opens a sent proposal and clicks **Mark reviewed**, which stamps `reviewed_by/reviewed_at/review_note/snapshot_sha256` and writes a `swap-proposal-reviewed` audit row. Unreviewed-but-executed proposals surface on a coverage report (overlaps CMP-3). This does **not** change the canonical send/execute path — far lower blast radius.

### Storage (both shapes)
Additive, PRAGMA-guarded migration on `swap-proposals.sqlite` mirroring `migrateBankActivityColumns` (`server/bank-coverage-store.js:200` — `PRAGMA table_info` then idempotent `ALTER TABLE ... ADD COLUMN`):
```
reviewed_by TEXT, reviewed_at TEXT, review_note TEXT, snapshot_sha256 TEXT, review_state TEXT
```
For Shape A, `review_state` extends `SWAP_STATUSES` (a `Set` at swap-store.js:33) with the new statuses; for Shape B, `review_state` is an orthogonal flag and `SWAP_STATUSES` is untouched.

### Routes
- Shape A: `POST /api/swap-proposals/:id/approve`, `POST /api/swap-proposals/:id/return` (admin-gated). Execute route (`/execute`) gains a guard: 409 unless `approved`.
- Shape B: `POST /api/swap-proposals/:id/review` (admin-gated).
- Both: audited via `appendAuditLog` (`swap-proposal-reviewed` / `swap-proposal-returned`), capturing `reviewed_by`, `snapshot_sha256`, and the bound proposal id.

### UI
Read-only render reuses `swap-render.js`. Sidebar badge for the review queue (Shape A) via the existing nav-count pattern (backlog WF-3). The printed/sent artifact may carry a "Reviewed by <principal> on <date>" line **only if the owner wants it client-visible** — see OWNER DECISIONS.

## Reuse (verified helpers)
- `SWAP_STATUSES`, `freezeProposal`, `markExecuted`, `cloneProposalToDraft` — `server/swap-store.js`.
- `buildProposalSnapshot`, `handleSendSwapProposal`, `ensureSwapStrategyLink` — `server/server.js` (~6616/6700).
- `swap-render.js` for the read-only review view.
- `migrateBankActivityColumns` PRAGMA-guarded pattern — `bank-coverage-store.js:200`.
- Admin gate — `rejectIfUnauthorized` / `isAdminOnlyApiWrite` (server.js:690); `crypto` for `snapshot_sha256`.

## Constraints respected / bent
- **Respected:** no new dep; no email (queue is in-portal, badge-driven); admin = the only elevated role; snapshot stays immutable.
- **Bent / risk:** Shape A **changes the canonical send/execute lifecycle** of a client-facing artifact — not safe to build unattended and must not regress the existing snapshot-freeze guarantee. The shared-workstation caveat means "reviewed_by" is only as trustworthy as per-rep Windows logins.

## Test plan
`tests/swap-store.test.js` (extend) + route tests:
- Shape A: send moves to `pending_review`; execute before approve → 409; approve stamps `reviewed_by/at` + `snapshot_sha256` = hash of the frozen `snapshot_json`; return re-opens or flags per the chosen rule.
- `snapshot_sha256` is bound to the exact snapshot bytes (changing the snapshot would change the hash — but it can't, it's frozen; assert equality).
- Non-admin approve → 403.
- Shape B: review stamps fields without altering `status`; the send/execute regression suite still passes unchanged.

## Effort / blast radius
**M effort; Shape A = high blast radius (lifecycle change), Shape B = low.** Owner-gated either way.

### OWNER DECISIONS (CMP-1)
1. **Hard gate (Shape A) vs advisory record (Shape B)** — does the firm's WSP require principal review *before* the proposal can be executed/sent to the client, or is documented post-hoc review acceptable?
2. **Does Admin = "registered principal" satisfy the WSPs?** (Roles are only Admin/Rep. If a specific Series-24 named principal must sign, confirm the `FBBS_ADMIN_USERS` allowlist is restricted to actual principals.)
3. **What exactly is "client-facing" and triggers the gate?** Only the printed/sent swap one-pager? Or also the `/render` print, the swap cover email (backlog AI-2), the offering sheet (backlog CLI-2)? The trigger definition scopes the whole gate.
4. **Is the reviewer's name printed on the client artifact**, or is the review an internal-only record?
5. **What is the retention destination of the review record** — is the SQLite row + audit line sufficient, or must it be exportable into the firm's books-and-records system (then CMP-2 is a dependency)?

---

# CMP-2 — Communications/CRM retention export (SEC 17a-4 / FINRA 4511)  ·  M/high  ·  **OWNER DECISION REQUIRED**

## Problem / why

As the CRM replaces Salesforce it is becoming the system of record for rep-client communications. There is **no scoped "produce everything for this bank / this rep / this date range" export** — including the compliance-correct soft-deleted activities with their deletion reason — for a regulatory request (SEC 17a-4 books-and-records; FINRA 4511 recordkeeping). The data model is already compliance-shaped (soft-delete with `deleted_at/deleted_by/delete_reason`); it just isn't surfaced.

## Exact approach

New admin-gated **streaming** export route:
```
GET /api/admin/retention-export?bankId=&rep=&from=&to=&format=jsonl|csv
```
- **Streamed**, not buffered (the multipart RAM caveat in CLAUDE.md is a reminder to stream large bodies): emit records one at a time. Use `fs.createReadStream`/manual chunked `res.write` for the audit lines and `querySqliteJson` page-by-page (or `withDatabase` for a single connection) for the SQLite rows. Mirrors the existing streaming file-response pattern.
- **Scope** (one of bank / rep / date-range, or a combination): every `bank_activities` row **including soft-deleted ones** (so the export must NOT use `activitySelectSql`, which filters deleted rows — it needs a parallel select that *includes* `deleted_at/deleted_by/delete_reason`), plus tasks, opportunity stage changes, contacts, and the matching `audit.log` lines for the scope.
- **Manifest header** (first JSON-lines record): scope params, per-table row counts, generated-at, generating admin username, and a **SHA-256 of the payload** (Node `crypto`) so the export is self-verifying. Audit the export itself (`retention-export`) with the scope and the payload hash.
- **Format:** `jsonl` (one record per line, lossless — recommended default for a regulatory production) or `csv` (per-table, flattened) for human review.

### What the route deliberately does NOT do
- No email/SMTP — it's an HTTP download the admin saves. (Respects the no-email rule.)
- No WORM / immutable storage — that is an IT/archival concern outside the portal. The export *produces* the record; where it is retained is the owner's call (see decisions).

## Reuse (verified helpers)
- `querySqliteJson` / `withDatabase` — `server/sqlite-db.js`.
- Soft-delete columns + the existing `activitySelectSql` (as the *template* for the parallel deleted-inclusive select) — `bank-coverage-store.js:831/930`.
- `readAuditLog` / `readFileTail` for the in-scope audit lines — server.js:8509/8527.
- `crypto` for the payload hash; `fs`/`stream` for streaming.
- Admin gate — `rejectIfUnauthorized`/`isAdminOnlyApiWrite` (server.js:690).

## Constraints respected / bent
- **Respected:** no new dep; streamed (no RAM blow-up); admin-gated; no email; soft-delete model surfaced exactly as designed.
- **Bent / risk:** the **export schema must match the firm's books-and-records obligations** — building the wrong shape is worse than nothing (an examiner-facing artifact that omits a required field). This is why it is owner-gated despite being technically additive and infra-free.

## Test plan
`tests/retention-export.test.js` (new, fixture DB):
- Bank-scoped export includes soft-deleted activities with their `delete_reason` (proves it bypasses the deleted-filter).
- Manifest row counts equal the emitted record counts; the recorded SHA-256 matches a re-hash of the payload.
- Date-range scoping excludes out-of-range rows; rep-scoping excludes other reps' rows.
- `csv` and `jsonl` both round-trip the same record set.
- The export writes a `retention-export` audit line capturing scope + payload hash.

## Effort / blast radius
**M effort; low *code* blast radius** (read-only streaming route) **but high *correctness* stakes** (regulatory artifact). The build is gated on the schema decision, not on the code.

### OWNER DECISIONS (CMP-2)
1. **Exact record schema / required fields** for the firm's 17a-4 / 4511 obligations — which tables, which columns, what ordering, what metadata. **This must be signed off before code; the wrong shape is a liability.**
2. **Does the LAN/IIS model satisfy retention itself, or is external infra required?** SEC 17a-4 historically implies WORM/non-rewritable storage and (for some firms) a Designated Third Party. The portal can *generate* the export but cannot itself provide WORM on a writable share. Confirm whether the export-to-download is the deliverable, or whether a durable archival pipeline is also needed (which the LAN/IIS model lacks — that's an IT decision, out of portal scope).
3. **Retention period & destination** of the generated export files (and whether the portal should keep copies under `data/` — if so, they join the backup scope).
4. **Who may run the export** — Admin only (assumed), and whether a non-admin compliance role is ever needed (would require a role-model change — currently out of scope).

---

# CMP-3 — Per-bank supervisory review marker + supervision-coverage report  ·  M/high  ·  **OWNER DECISION REQUIRED**

## Problem / why

A desk principal must periodically review rep activity and **document that the review happened** (FINRA 3110). The portal holds all the raw activity (`bank_activities`) but offers no place to record "I reviewed bank X's rep activity through <date>." The supervision currently leaves no trail — the exact thing examiners test.

## Exact approach

The `bank_activities` table is already a **two-species** table (system-audit rows + manual rep-logged kinds `call/email/meeting/task/note`). Add a **third species**: a `supervisory-review` kind.
- **Creatable ONLY by admins** (the supervisor mapping), from the tear-sheet activity panel and (if CMP-1 ships) the review queue. Carries `actor_username` = admin, `body` = review note, and a `reviewed_through` date (reuse the existing `activity_date` column for the through-date, or add one nullable column via the same PRAGMA-guarded `migrateBankActivityColumns` pattern).
- Rendered as a **distinct timeline chip** (visually separated from rep activity) so the supervision trail is legible and not mistaken for a rep's own note.
- Goes through the existing `recordManualActivity` path (`bank-coverage-store.js:985`) but with the kind whitelisted separately and admin-gated at the route — do **not** add `supervisory-review` to `MANUAL_ACTIVITY_KIND_SET` (that set is the rep-loggable whitelist); use a parallel admin-only insert so a rep can never self-certify a supervisory review.

### Coverage report
New admin-gated `GET /api/reports/supervision-coverage`: per rep/bank, the **last supervisory review date vs the last rep activity date** (the supervision analogue of the cold-accounts report) + a "banks needing review" tile (e.g. rep activity since the last supervisory review, or no review in N days). Reuses `lastActivityByBank` (`bank-coverage-store.js`) for the rep-activity side and a new `lastSupervisoryReviewByBank` helper for the review side. Admin-gated; rep-scope collapse via `shouldEnforceRepScope` does not apply (this is inherently a supervisor's firm-wide view) — but it must be **admin-only**, never rep-visible.

## Reuse (verified helpers)
- `bank_activities` two-species table + `recordManualActivity` (`bank-coverage-store.js:985`) and `activitySelectSql` (831) for reads.
- `migrateBankActivityColumns` PRAGMA-guarded ALTER (`bank-coverage-store.js:200`) if a `reviewed_through` column is added.
- `lastActivityByBank` for the cold-accounts analogue.
- Admin gate — server.js:690; the report rail's admin-gated pattern.

## Constraints respected / bent
- **Respected:** additive third row-species on an existing table (no new table, no new dep); admin = supervisor; soft-delete applies (a supervisory review is never hard-deleted).
- **Bent / risk:** this **creates a compliance-evidence record whose meaning is defined by the firm's WSPs** — what "reviewed" attests to, how often, and what scope must be confirmed before the marker exists. A marker that means something different from what the WSP requires is worse than none.

## Test plan
`tests/supervision-coverage.test.js` (new):
- An admin can create a `supervisory-review` row; a rep route cannot (403 / kind rejected).
- The coverage report lists banks where rep activity post-dates the last supervisory review.
- A `supervisory-review` row is soft-deletable (carries `deleted_at` etc.) and disappears from the coverage read.
- `lastSupervisoryReviewByBank` returns the latest non-deleted review per bank.

## Effort / blast radius
**M effort; low blast radius** (additive species on an existing table). Owner-gated on the WSP meaning, not the code.

### OWNER DECISIONS (CMP-3)
1. **What does a "supervisory review" attest to**, at what cadence, and over what scope (per bank? per rep? per period)? The WSP defines the marker's semantics.
2. **Admin = supervisor confirmed?** (Same two-role question as CMP-1.)
3. **"Needs review" threshold** — N days since last review, or "any rep activity since last review," or both.
4. **Retention** — does this marker need to flow into the CMP-2 export (it should, since it's 3110 evidence)?

---

# CMP-4 — FINRA 2210 language linter for rep-authored supervised text (coaching)  ·  M/med  ·  **OWNER DECISION REQUIRED**

## Problem / why

Reps type free text that can become supervised/client-facing communication: activity notes, opportunity descriptions, swap-proposal client notes, strategy bodies, Sales-Dashboard talking points. FINRA Rule 2210 forbids promissory/exaggerated/misleading language ("guaranteed," "risk-free," "will outperform," "can't lose"). There is **no nudge** today.

## Exact approach

New pure, node-testable UMD module **`public/js/modules/comms-lint.js`**, following the exact pattern of `public/js/modules/muni-tax.js` and `report-logic.js` (verified UMD wrapper: `(function(root, factory){ ... root.Fbbs... = api })`). Exposes `lintText(text) → [{ severity, span:[start,end], ruleId, matched, suggestion }]` over a **pinned phrase ruleset** (hard rules = promissory/guarantee/risk-free; soft rules = superlatives/comparatives needing substantiation).

- **Coaching only, never blocking.** Wire inline as an amber under-field banner on supervised textareas in `portal.js` (Log Activity body, opportunity description, swap client note, strategy body, copied talking points). The rep can still submit — the linter advises.
- **Server-side reuse on supervised send.** Because it's a UMD module, the same `comms-lint.js` is `require()`-able server-side: on swap send (and, if CMP-1 ships, into the review record), run `lintText` over the client-facing free-text fields and attach any **hard-flag** hits to the proposed review record / audit row so a supervisor sees them. No second ruleset to maintain.
- Compile coverage is automatic: `tests/frontend-parse.test.js` already compiles `portal.js` + every `public/js/modules/*.js` in `npm test`, so a syntax error in the new module fails CI.

### What it is NOT
Not an AI call (the ruleset is deterministic and pinned — no billing, no Claude). Not a blocker. Not a substitute for principal review (it's pre-screen coaching that *feeds* CMP-1/CMP-3).

## Reuse (verified helpers)
- UMD module pattern — `public/js/modules/muni-tax.js`, `report-logic.js` (verified headers).
- `tests/frontend-parse.test.js` compile coverage (CLAUDE.md CRM layer).
- Server-side `require()` of the same module (Node consumes the UMD `module.exports`).
- Inline-banner wiring reuses existing supervised textareas in `portal.js`.

## Constraints respected / bent
- **Respected:** pure JS, no dep, no AI/billing; coaching not blocking; one ruleset shared client+server.
- **Bent / risk:** **the phrase list is the load-bearing compliance artifact.** A plausible-but-wrong list shipped unattended is a net negative (false confidence or nuisance). It must get one pass from the firm's compliance owner before go-live. **This is why CMP-4 is owner-gated despite being technically pure-additive and infra-free** — the *code* is loop-safe; the *content* is not.

## Test plan
`tests/comms-lint.test.js` (new, plain node):
- "guaranteed return" / "risk-free" / "can't lose" → hard severity with correct span + ruleId.
- A clean institutional sentence → no flags.
- Soft superlatives ("best," "outperform") → soft severity, not hard.
- Case-insensitive + word-boundary matching (no false hit inside "outperformance-adjusted" if the rule targets the verb — define boundaries in the ruleset).
- The same module loaded server-side returns identical results for identical input (client/server parity).

## Effort / blast radius
**M effort; low *code* blast radius** (one pure module + inline hooks). Gated on the **phrase-list content**, not the wiring.

### OWNER DECISIONS (CMP-4)
1. **The phrase ruleset itself** — hard vs soft tiers, the exact terms, and suggested replacements. **Must be authored/reviewed by compliance before go-live.** (Engineering ships the *engine*; compliance owns the *list*.)
2. **Which textareas count as "supervised"** (i.e., where the banner appears and where the server-side pass runs). Same "what is client-facing" question as CMP-1.
3. **Coaching-only confirmed** (advisory under-field banner, never blocks submit), or does compliance want hard flags to block the swap **send** until acknowledged?
4. **Where hard-flag hits are recorded** — only in the (CMP-1) review record, also in the audit log, or surfaced to the supervisor's CMP-3 coverage view?

---

# Cross-cutting OWNER DECISIONS (apply to the whole suite)

These are the calls the compliance owner / registered principal must make **before any of CMP-1–4 is built**. They are listed once here and referenced per item above.

1. **Supervisor role under a two-role model.** Roles are only **Admin** and **Rep**. Every supervisory action in this suite maps **principal → Admin**. Confirm that the `FBBS_ADMIN_USERS` allowlist is (or will be) restricted to actual registered principals, and that "Admin" is an acceptable proxy for the named-principal sign-off the WSPs require. *If a true principal role is required, that is a role-model change explicitly deferred in `company-portal-context.md` and out of this suite's scope.*
2. **The definition of "client-facing."** This single definition drives the CMP-1 gate trigger and the CMP-4 supervised-textarea set. Candidates: the printed/sent swap one-pager (`swap-render.js`), the `/render` print, the swap cover email (AI-2), the offering sheet (CLI-2), Sales-Dashboard talking points copied into client comms. Compliance must enumerate which surfaces are 2210/3110-in-scope.
3. **The regulatory artifact & retention destination for each item** — what record satisfies the obligation (a SQLite row? an audit line? a streamed export?), and where it is retained (in-portal under `data/`? exported to the firm's books-and-records system? WORM storage the LAN/IIS model does not provide?).
4. **Whether CMP-2 retention needs infra the LAN/IIS model lacks.** The portal can *generate* a self-hashing export download with no new infra; it cannot itself provide WORM/non-rewritable archival or a Designated Third Party. Confirm whether export-to-download is the deliverable or whether an external archival pipeline (IT-owned, out of portal scope) is also required.
5. **Shared-workstation trust.** Per the security posture, IIS identifies the Windows session, not the person. A supervisory sign-off attributed to a named principal is only trustworthy with per-rep Windows logins. Confirm the deployment uses per-rep logins before relying on attribution in any of these records.

# Build sequencing recommendation

- **Build now (loop-safe):** CMP-5 only. Pure-additive, no compliance artifact required (give the panel wording a compliance read before go-live).
- **Build after one compliance artifact each (lowest blast radius first):** CMP-4 (engine now / list from compliance) → CMP-3 (additive species) → CMP-2 (schema sign-off) → CMP-1 Shape B (advisory) → CMP-1 Shape A (lifecycle change — only if WSPs require a hard pre-execute gate; highest blast radius, build last with the owner present).
- **Dependency:** CMP-1's review record and CMP-3's supervisory marker should both flow into the CMP-2 export (they are 3110/4511 evidence). Decide CMP-2's schema before, or in lockstep with, CMP-1/CMP-3.
