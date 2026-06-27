# Internal Go-Live Engineering Checklist

This checklist is for the first internal-only FBBS portal launch. It assumes IIS
Windows Authentication, trusted network/VPN access, and no client-facing traffic.

## Production Identity

- Confirm the physical access pattern before relying on per-rep boundaries:
  each rep should reach the portal from their own machine/session with their own
  Windows login. If several reps share one workstation logged in as one Windows
  account, IIS forwards the same `LOGON_USER` for all of them and the portal
  cannot distinguish the reps.
- Set `FBBS_AUTH_MODE=iis` on the App Pool. This turns on required auth for
  non-public APIs, disables the `fbbs_rep_override` cookie, and refuses the
  local `FBBS_DEFAULT_REP` fallback.
- Set `FBBS_ADMIN_USERS` on the App Pool to the usernames allowed to
  publish/import data, refresh billable AI reads, open management views, and see
  firm-wide CRM rollups. Usernames are normalized by stripping domain/email
  suffixes and lowercasing, so `FBBS\Jane Smith`, `jsmith@fbbs.com`, and
  `jsmith` should be represented by the normalized admin username.
- Enable Windows Authentication in IIS and disable anonymous access. The app's
  `web.config` declares:
  - `<windowsAuthentication enabled="true" />`
  - `<anonymousAuthentication enabled="false" />`
  - `promoteServerVars="LOGON_USER,AUTH_USER"`
  iisnode forwards those server variables to Node as
  `x-iisnode-logon_user` / `x-iisnode-auth_user`, which
  `server/rep-identity.js` reads.
- Add the portal host to the Local Intranet zone on rep machines, preferably by
  GPO. Without that browser/GPO setting, Integrated Windows Auth may not
  auto-send credentials; users may see a native login prompt or fall through to
  anonymous if IIS is misconfigured.
- From a rep's own machine, confirm `/api/me` resolves the signed-in Windows
  user with `source: "iis"` and `auth.isAdmin: false`.
- From an admin's own machine, confirm `/api/me` resolves the signed-in Windows
  user with `source: "iis"` and `auth.isAdmin: true`.
- Confirm the header shows `Signed in` and the manual rep picker does not open.
- Confirm old `fbbs_rep_override` cookies are ignored in production mode.
- Confirm each sales rep's Windows username matches the owner names used in the
  account-status workbook closely enough for My Work and saved views.

## IIS Smoke Commands

Run this block on the IIS server after the App Pool has the production
environment variables and Windows Authentication is enabled. Use the real
internal URL in place of `https://portal.example.local`.

1. As an approved admin Windows user, open:
   - `GET /api/me`
   - Expected: `rep.source` is `"iis"`, `rep.username` is the normalized Windows
     username, `auth.mode` is `"iis"`, `auth.requireAuth` is `true`,
     `auth.allowRepOverride` is `false`, and `auth.isAdmin` is `true`.
2. As a non-admin Windows user, open:
   - `GET /api/me`
   - Expected: same IIS identity fields, but `auth.isAdmin` is `false`.
3. As an admin, open:
   - `GET /api/admin/go-live-status`
   - Expected checks:
     - `auth-mode` is `ok`
     - `admin-users` is `ok`
     - `data-dir` is `ok` when `DATA_DIR` is outside the app folder
     - `upload-temp` is `ok` unless stale crash leftovers remain
   - The response intentionally reports the number of admin users, not the
     `FBBS_ADMIN_USERS` list.
4. Confirm anonymous/API lockout from a machine or tool that does not send
   Windows credentials:
   - `GET /api/health` should return `200`
   - `GET /api/crm/dashboard` should return `401`
5. Confirm admin publish:
   - Publish a small known-good daily package from **Operations → Upload**.
   - Expected: publish succeeds and audit log actor matches the admin Windows
     identity.
6. Confirm non-admin publish denial:
   - From a non-admin Windows session, attempt the same publish or `POST
     /api/upload`.
   - Expected: `403 Admin permission is required for this action.`

## Admin Allowlist

- Confirm an admin can publish the daily package.
- Confirm a non-admin cannot call these production data-write endpoints:
  - `POST /api/upload`
  - `POST /api/folder-drop/publish`
  - `POST /api/mbs-cmo/upload`
  - `POST /api/banks/upload`
  - `POST /api/bank-account-statuses/upload`
  - `POST /api/banks/averaged-series/upload`
  - `POST /api/banks/bond-accounting/upload`
  - `POST /api/brokered-cd/wirp/upload`
- Confirm a non-admin `GET /api/crm/dashboard?rep=all` returns 200 but is
  scoped to that rep. Check `audit.log` for `crm-dashboard-scope-collapsed`.
- Confirm an admin `GET /api/crm/dashboard?rep=all` returns the firm-wide
  dashboard.
- Confirm an anonymous/no-identity request to a protected `/api/*` route returns
  401. `/api/health` should remain 200; it is the only public API path.
- Confirm non-admins do not see the Upload/Admin/Exec Summary nav entries,
  billable AI refresh buttons, or the Views page Everyone/Just-me firm-wide
  toggle.

## Daily Package Smoke Test

- Publish today's files.
- Open Package QA and confirm `10/10` required slots filled.
- Open Daily Intelligence and confirm Treasuries, CDs, Munis, Agencies, and
  Corporates have expected counts.
- Spot-check Treasury, CD, Muni, Agency, and Corporate explorers.
- Confirm parser warnings are either expected or resolved before notifying sales.
- Confirm same-day republish preserves untouched slots.

## Sales Workflow Smoke Test

- Sign in as or simulate one sales rep.
- Confirm My Work populates clients, prospects, open strategies, overdue
  follow-ups, and recently touched records.
- Search for a known bank and open its tear sheet.
- Add/update a note, contact, product-fit item, and strategy request.
- Move a strategy through Open, In Progress, Completed, and Needs Billed.
- Confirm billing queue changes are audited.
- Export one saved view as CSV.

## Server And Data Operations

- Set `DATA_DIR` outside the app folder.
- Confirm App Pool identity has read/write access to `DATA_DIR`.
- Confirm **Operations → Admin → Go-live status** or
  `GET /api/admin/go-live-status` shows:
  - `process.authMode: "iis"`
  - `data.dataDirExternal: true`
  - `data.uploadTemp.staleCleanupHours: 24`
  - `data.uploadTemp.staleEntries: 0` after a clean restart
- Confirm `AUDIT_LOG_MAX_MB` and `AUDIT_LOG_KEEP` match retention expectations.
- Confirm app restarts cleanly after an IIS App Pool recycle.
- Back up `DATA_DIR` safely and test one restore copy before launch:
  - Preferred simple launch procedure: stop or recycle the App Pool, wait for the
    worker to exit, copy `D:\FBBSPortalData`, then start the App Pool again.
  - If the app must stay online, do not copy live `*.sqlite` files directly; use
    SQLite's online backup support (`VACUUM INTO` / `.backup`) for
    `bank-coverage.sqlite`, `bank-strategies.sqlite`,
    `swap-proposals.sqlite`, and the other workspace DBs.
  - Restore test means opening the restored copy with the portal or a SQLite
    integrity check, not just confirming files exist.
- Confirm disk-space monitoring exists for the data volume.
- `_uploads` under `DATA_DIR` is scratch space for streaming multipart uploads.
  The app removes completed request temp files immediately and, on startup,
  removes stale `_uploads` entries older than 24 hours. Do not include `_uploads`
  in restore validation except to confirm stale entries are not accumulating.

## Known Boundaries For Internal Launch

- This is not a client-facing portal yet.
- Client-visible content, per-client permissions, MFA, and formal compliance
  approval workflows are future external-launch work.
- Internal notes, strategy comments, billing queues, and uploaded source files
  should be treated as internal-only.
