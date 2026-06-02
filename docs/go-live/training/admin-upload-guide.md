# FBBS Portal — One-Page Admin / Upload Guide

*For the Publisher (Trader/Admin). Internal tool — For Institutional Use Only.*

## Your job
Publish the daily package on time and confirm it's clean before the desk relies on
it. In production the portal knows who you are from your **Windows login** (no "Acting
as" picker), and you can publish because your Windows username is on the **admin
allowlist** (`FBBS_ADMIN_USERS=<approved upload/import users>`). If publish ever says
*"Admin permission required"* or *"Admin allowlist is not configured"* — that's a config
issue, call IT, don't work around it.

## Publish the daily package (Operations → Upload)
1. **Drop today's files** into the Upload tab (or use the **Folder drop → Scan → Publish**).
2. The portal **auto-sorts each file into its slot** by filename. If one lands in the
   wrong slot, **override the slot manually** and re-publish.
3. Up to **12 slots**: Sales Dashboard, Economic Update, Relative Value, MMD Curve,
   Treasury Notes, Brokered CD Sheet, Daily CD Offerings, Muni Offerings, Baird
   Syndicate, Agency Bullets, Agency Callables, Corporates.

### Two rules that save you
- **Same-day fix = safe.** Re-uploading one corrected file replaces **only that slot** —
  it won't wipe the rest of today.
- **Never upload tomorrow's files early.** A *different-day* upload **archives today's
  whole package** and starts a new day.

## Always run Package QA next (Operations → Package QA)
Before you tell the desk it's live, confirm:
- [ ] Every expected slot is **present**.
- [ ] **Row counts** look normal (not 0 / not wildly low).
- [ ] **Parser warnings** read OK (skim them — some are benign, some mean the file format changed).
- [ ] Package **date is today**.

## When something's off
| Problem | Do this |
|---|---|
| A file is late | Publish without it; tell the desk; re-publish that slot when it arrives. |
| Count is 0 / garbled | Don't call it good. Re-export the source & re-publish, or escalate to engineering. |
| Wrong file in a slot | Re-upload with the slot set manually. |
| Published the wrong day | Prior package is in **Operations → Archive** (on disk at `D:\FBBSPortalData\archive\YYYY-MM-DD\`); rollback is filesystem-level — call IT. |
| **Treasury looks sparse** | Expected since 2026-06-01 — the daily Treasury file is now a generic Bloomberg `grid1_*.xlsx` ask export. Not a bug. |

## Notify the desk
Once QA passes, send the "package is live" message (‹channel›): date, any
missing/delayed slot + ETA, anything notable.

## Non-daily imports (off-peak, not every morning)
Bank call-report workbook, account-status, peer-group, bond-accounting, MBS/CMO,
WIRP — all admin-gated, can be up to 300 MB. Run on their own cadence
(‹CONFIRM› — typically quarterly). These rebuild tear sheets, the map, and reports.

## Don't touch without asking
The launchers, the data-folder layout, and the dependency footprint are tuned for
non-developer operation — see `CLAUDE.md`. Config (env vars, IIS, backups) is IT's.
