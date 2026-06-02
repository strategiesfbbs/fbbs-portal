# FBBS Portal — Internal Go-Live Runbook

> **Owner:** Claude (product/workflow lane) · **Status:** Draft for internal go-live · **Last updated:** 2026-06-02
> The daily operating procedure for keeping the portal live: who publishes, by
> when, who checks it, and what to do when something is missing or a parser warns.
> **‹CONFIRM›** marks org-specific facts (names/times) FBBS must fill in.

This is the *operations* runbook. The *server/deployment* runbook (IIS, env vars,
backups) is Codex's lane — see [internal-go-live-readiness.md](internal-go-live-readiness.md)
for how the two fit together.

---

## 1. Roles for daily operations

| Role | Person (‹CONFIRM›) | Responsibility |
|---|---|---|
| **Publisher** (Trader/Admin) | ‹name› | Publishes the daily package; first to check Package QA |
| **Backup Publisher** | ‹name› | Publishes when the primary is out (must also be on `FBBS_ADMIN_USERS`) |
| **QA checker** | ‹name — often the Publisher‹ | Confirms the package is complete & clean before reps rely on it |
| **Sales notifier** | ‹name / channel› | Tells the desk "package is live" (email / Teams / verbal) |
| **Escalation** | ‹name / IT› | Owns parser failures, missing source files, server issues |

> Smallest viable setup: one Publisher who also does QA and pings the desk, plus a
> named backup. That's fine for launch.

---

## 2. Daily timeline (target)

| Time (‹CONFIRM›) | Step | Who |
|---|---|---|
| ‹e.g. 7:45 AM CT› | Source files have arrived in the drop folder / inbox | (automation / Publisher) |
| ‹e.g. 8:00 AM CT› | **Publish** today's package | Publisher |
| ‹e.g. 8:05 AM CT› | **Package QA** — confirm slots & counts | QA checker |
| ‹e.g. 8:10 AM CT› | **Notify sales** the package is live | Sales notifier |
| Throughout day | Re-publish individual slots if updated files arrive | Publisher |

> **‹CONFIRM›** the target "package ready by" time. Reps should know the deadline so
> they don't start their day on stale data.

---

## 3. Publish procedure

The package has up to **12 slots**: Sales Dashboard (HTML), Economic Update (PDF),
Relative Value (PDF), MMD Curve, Treasury Notes (xlsx), Brokered CD Sheet,
Daily CD Offerings, Muni Offerings, Baird Syndicate Munis, Agency Bullets,
Agency Callables, Corporates.

**Two ways to publish (Operations → Upload):**

1. **Drag-and-drop upload** — drop the day's files into the Upload tab. The portal
   auto-classifies each file by name into the right slot (`classifyFile`). You can
   override the slot if a file is mis-detected.
2. **Folder drop** — files land in the configured drop folder; use **Scan** to
   preview what will publish, then **Publish**.

**Key behaviors to know:**
- **Same-day re-publish replaces only the slots you re-upload.** Dropping a corrected
  Muni file at 11 AM does **not** wipe the morning's CD or agency slots.
- **A different-day upload rolls the whole current package into the archive**
  (`D:\FBBSPortalData\archive\YYYY-MM-DD\` in production) and starts a fresh day. Don't
  upload tomorrow's files "to get ahead" — it will archive today.
- Every publish writes an **audit-log** entry (who, when, which slots, warnings, counts),
  visible in **Operations → Admin**.

> **Production note:** publishing requires being on the `FBBS_ADMIN_USERS` allowlist
> (see [role matrix §3.3](role-matrix.md)). If publish returns *"Admin permission is
> required"* or *"Admin allowlist is not configured,"* that's a config issue — escalate
> to IT, don't work around it.

---

## 4. Package QA procedure (Operations → Package QA)

After publishing, **always** open Package QA before telling the desk it's live.

Check, slot by slot:
1. **Completeness** — is every expected slot present for today? A missing slot shows
   as empty/absent.
2. **Row counts** — do the parsed counts look sane vs. a normal day (CD offers, muni
   offers, agencies, corporates, treasury notes)? A count of 0 or wildly low usually
   means a parse problem, not an empty market.
3. **Parser warnings** — each parser returns `warnings[]`. Read them. Some are benign
   ("3 rows skipped, no CUSIP"); some mean the file format changed.
4. **As-of date** — confirm the package date is **today** (not yesterday's file re-run).

QA passes when: all expected slots present, counts in normal range, no blocking
warnings, date correct. Then proceed to notify sales.

---

## 5. Exception handling

### 5.1 A file is missing
- **Decision:** publish the package **without** the missing slot rather than holding
  the whole package. Reps would rather have 11 of 12 on time.
- Note the gap when you notify sales ("Corporates not in yet — will republish when it
  arrives"). Re-publish just that slot later (same-day re-publish is safe, §3).
- If a **core** slot is missing (Daily CD Offerings, Economic Update), escalate to the
  source owner immediately — **‹CONFIRM›** who that is per file.

### 5.2 Parser warnings or a zero/low count
- Open the slot's explorer and eyeball the data. If it looks right despite the warning,
  proceed and note it.
- If it's clearly broken (0 rows, garbled columns), **do not** notify sales that slot is
  good. Re-export the source and re-publish, or escalate to engineering (Codex lane) —
  a source-format change may need a parser fix.
- **Known quirk (don't re-flag as a bug):** since 2026-06-01 the Treasury daily file
  arrives as a generic `grid1_*.xlsx` Bloomberg ask export (raw ask, no size, no
  as-of). The folder-drop now content-sniffs it. If Treasury Notes looks sparse, this
  is expected — confirm against the raw file before escalating.

### 5.3 Wrong file in a slot (mis-classified)
- Re-upload via the Upload tab and **manually set the correct slot**, or re-drop with a
  clearer filename. Same-day re-publish replaces just that slot.

### 5.4 Published the wrong day / need to roll back
- Because a different-day upload archives the prior package, the previous day is in
  **Operations → Archive**, on disk at `D:\FBBSPortalData\archive\YYYY-MM-DD\` (production
  `DATA_DIR`). Recovery is filesystem-level (move the folder back) — escalate to
  IT/engineering; it's not a one-click undo in the UI.

---

## 6. Notify sales

Once QA passes, send the "package is live" signal (‹CONFIRM› channel: email / Teams /
verbal). Include:
- Package date.
- Any slot that's missing or delayed and when it'll be back.
- Anything notable in Daily Intelligence worth flagging.

---

## 7. End-of-day / housekeeping

- Glance at **Operations → Admin** (audit log) to confirm the day's publishes look
  right and nothing failed silently.
- Bank workbook / account-status / peer / bond-accounting imports are **not daily** —
  run them on their own cadence (‹CONFIRM› — typically quarterly when new call-report
  data lands). These are also admin-gated and 300 MB-capable; do them off-peak.

---

## 8. Pre-launch checklist (one-time, before reps come on)

Production config is decided (Codex, 2026-06-02) — the boxes below are about *applying*
it on the IIS box, not deciding it:

- [ ] `FBBS_AUTH_MODE=iis` set (Windows Auth on; "Acting as" picker off; auth required) — *IT/Codex*
- [ ] `FBBS_ADMIN_USERS=<approved upload/import users>` set — real Publisher + Backup +
      import-runner Windows short names. **Without this, nobody can publish (403).** — *IT/Codex*
- [ ] `DATA_DIR=D:\FBBSPortalData` set, the folder exists, and it's in the backup job — *IT/Codex*
- [ ] A real daily package has been published and passes Package QA — *Publisher*
- [ ] Bank call-report + account-status workbooks imported (tear sheets populated) — *Publisher*
- [ ] Publisher + Backup have done a dry-run publish and QA — *Publisher*
- [ ] Sales-notify channel agreed and tested — *Manager*
- [ ] Reps know the "package ready by" time and where My Work lives — *Manager*
- [ ] Escalation path (parser failure / missing file / server down) is written down — *IT*

---

## 9. Open questions to confirm with FBBS

1. Target "package ready by" time, and the publish/QA/notify clock in §2.
2. Named Publisher + Backup (and their Windows usernames for the allowlist).
3. Source-file owner for each slot (who to chase when a file is late).
4. Sales-notify channel.
5. Cadence for the non-daily bank/account-status/peer imports.
