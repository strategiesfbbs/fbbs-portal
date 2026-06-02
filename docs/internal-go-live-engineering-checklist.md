# Internal Go-Live Engineering Checklist

This checklist is for the first internal-only FBBS portal launch. It assumes IIS
Windows Authentication, trusted network/VPN access, and no client-facing traffic.

## Production Identity

- Enable Windows Authentication in IIS and disable anonymous access.
- Set `FBBS_AUTH_MODE=iis` on the App Pool.
- Confirm `/api/me` resolves the signed-in Windows user with `source: "iis"`.
- Confirm the header shows `Signed in` and the manual rep picker does not open.
- Confirm old `fbbs_rep_override` cookies are ignored in production mode.
- Confirm each sales rep's Windows username matches the owner names used in the
  account-status workbook closely enough for My Work and saved views.

## Admin Allowlist

- Set `FBBS_ADMIN_USERS` to the usernames allowed to publish/import data.
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
- Confirm `AUDIT_LOG_MAX_MB` and `AUDIT_LOG_KEEP` match retention expectations.
- Confirm app restarts cleanly after an IIS App Pool recycle.
- Back up `DATA_DIR` and test one restore copy before launch.
- Confirm disk-space monitoring exists for the data volume.

## Known Boundaries For Internal Launch

- This is not a client-facing portal yet.
- Client-visible content, per-client permissions, MFA, and formal compliance
  approval workflows are future external-launch work.
- Internal notes, strategy comments, billing queues, and uploaded source files
  should be treated as internal-only.
