# FBBS Portal — Launch-Day Script (First Morning)

> A minute-by-minute checklist for the **first** morning reps use the portal. Doubles
> as Codex's go-live smoke test (readiness §3.3). Times are *offsets* from when you
> start — slot them against your real "package ready by" time (decision sheet #3).
> Run it once as a dry run the day before, then for real on launch morning.

**Date run:** __________ **Run by:** __________ **Pass / Fail:** ______

---

## Phase 0 — Pre-flight (the day before, or T-60 min)

| ✓ | Step | How to check | Expected |
|---|------|--------------|----------|
| ☐ | App is up | Browse `/api/health` | `200 OK` / healthy JSON |
| ☐ | Windows Auth working | Open the portal; look at the header | Shows **"Signed in"** + your name (not "Acting as", no picker caret) |
| ☐ | You're an admin | Header / try opening **Operations → Upload** | Upload tools are available (you're in `FBBS_ADMIN_USERS`) |
| ☐ | A non-admin is *not* | Have a rep try a publish (or simulate) | Blocked / Upload action not available |
| ☐ | Bank data present | **Banks → Bank Tear Sheets**, search a known bank | Tear sheet loads with call-report data |
| ☐ | Data dir + backup | Confirm `DATA_DIR=D:\FBBSPortalData` and it's in the backup job | Both true |

> If any Phase 0 row fails, **stop** and fix before launch — these are the 🔴 required items.

---

## Phase 1 — Publish (T-0)

| ✓ | Step | Where | Expected |
|---|------|-------|----------|
| ☐ | Gather today's source files | drop folder / inbox | All expected files present |
| ☐ | Publish | **Operations → Upload** (drag-drop) or **Folder drop → Scan → Publish** | Upload completes; no error banner |
| ☐ | Confirm auto-classification | the Upload result / slot list | Each file landed in the right slot (override any that didn't, re-publish) |

## Phase 2 — Package QA (T+5)

| ✓ | Step | Where | Expected |
|---|------|-------|----------|
| ☐ | Slot completeness | **Operations → Package QA** | **10/10 required slots** filled (optional slots may be empty) |
| ☐ | Row counts sane | Package QA counts | CD / Muni / Agency / Corporate / Treasury counts in normal range (not 0/garbled) |
| ☐ | Parser warnings | Package QA warnings | All warnings expected/benign (Treasury `grid1_*.xlsx` sparse = expected, see runbook §5.2) |
| ☐ | Package date | Package QA header | Date = **today** |

## Phase 3 — Spot-check the rep surface (T+8)

| ✓ | Step | Where | Expected |
|---|------|-------|----------|
| ☐ | Daily Intelligence renders | **FBBS → Daily Intelligence** | Snapshot + rule picks show; Treasuries/CDs/Munis/Agencies/Corporates have counts |
| ☐ | CD Explorer | **Offerings → CD Explorer** | Rows load; filter + one CSV export works |
| ☐ | Muni Explorer | **Offerings → Muni Explorer** | Rows load |
| ☐ | Agency Explorer | **Offerings → Agency Explorer** | Bullets + callables load |
| ☐ | Corporate Explorer | **Offerings → Corporate Explorer** | Rows load |
| ☐ | Treasury Explorer | **Offerings → Treasury Explorer** | Loads (sparse is OK per runbook §5.2) |
| ☐ | Bank tear sheet | **Banks → Bank Tear Sheets** → open a bank | Summary, account status, notes, holdings render |
| ☐ | My Work | **Home** | Clients / prospects / open strategies / overdue populate for the signed-in rep |
| ☐ | Strategy round-trip | tear sheet → **Open Strategy Request**, then **Strategies → Queue** | Create works; move Open → In Progress → Completed → Needs Billed; it appears in the billing queue |
| ☐ | Billing audited | **Operations → Admin** (audit log) | The strategy/billing events are logged |

## Phase 4 — Notify sales (T+10)

| ✓ | Step | Expected |
|---|------|----------|
| ☐ | Send "package is live" on the agreed channel (decision sheet #4) | Desk notified: date, any missing/delayed slot + ETA, anything notable |

## Phase 5 — Watch (first hour)

| ✓ | Step | Expected |
|---|------|----------|
| ☐ | Be reachable for the first reps | Answer "how do I…" using the [sales guide](training/sales-guide.md) |
| ☐ | Re-check audit log mid-morning | **Operations → Admin** — no failed writes / surprises |

---

## Issue log (record everything, even small)

| Time | What happened | Slot/Tab | Severity (block/note) | Action / owner |
|------|---------------|----------|------------------------|----------------|
|      |               |          |                        |                |
|      |               |          |                        |                |
|      |               |          |                        |                |

---

## If something breaks

| Symptom | First move | Ref |
|---|---|---|
| Publish returns 401/403 | Config issue — your user isn't in `FBBS_ADMIN_USERS`, or it's unset. Call IT. | role matrix §3.3 |
| A slot is missing | Publish without it; note ETA; re-publish that slot later (safe) | runbook §5.1 |
| Count 0 / garbled | Don't notify on that slot; re-export source & re-publish, or escalate to engineering | runbook §5.2 |
| Wrong file in a slot | Re-upload with the slot set manually | runbook §5.3 |
| Published the wrong day | Prior package in **Operations → Archive** (`D:\FBBSPortalData\archive\…`); rollback is filesystem-level — call IT | runbook §5.4 |

**Smoke-test verdict (for readiness §3.3):** ⬜ Pass ⬜ Pass-with-notes ⬜ Fail —
notes: ____________________________________________
