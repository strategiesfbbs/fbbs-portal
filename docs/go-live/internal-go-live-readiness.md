# FBBS Portal — Internal Go-Live Readiness

> **Status:** Draft · **Last updated:** 2026-06-02
> The single umbrella document for the internal launch. It joins the two work lanes:
> **Claude** (product / workflow / docs / roles spec) and **Codex** (auth / security /
> deployment / tests / smoke). Both lanes' core engineering and docs are now drafted;
> what remains is the FBBS [decision sheet](decision-sheet.md) and the smoke-test run.

---

## 0. Go / No-Go summary (fill at the end)

| Area | Owner | Status | Notes |
|---|---|---|---|
| Product & workflow docs | Claude | ✅ Drafted | Role matrix, workflow, runbook, training, boundary, launch-day script |
| Auth / roles hardening | Codex | ✅ Drafted (code shipped) | IIS auth mode, admin allowlist, override lockout — commit [`49d5e64`] |
| Admin / upload hardening | Codex | ✅ Drafted (code shipped) | 8 ingest routes admin-gated; admin-aware launch UI — commit [`bf65d6d`] |
| Deployment readiness | Codex | ✅ Drafted | README + web.config + [engineering checklist](../internal-go-live-engineering-checklist.md) |
| Smoke test (today's package) | Codex | ⬜ TODO | Run [launch-day-script.md](launch-day-script.md) end-to-end on a real package |
| Org decisions (decision sheet) | FBBS | ⬜ TODO | [decision-sheet.md](decision-sheet.md) — admin usernames is the config blocker |

**Recommendation:** ⬜ Go / ⬜ Go-with-conditions / ⬜ No-go — *(decide once the
[decision sheet](decision-sheet.md) is filled, the [pre-launch review](pre-launch-review.md)
🔴 items are closed, and the smoke test passes; see the tiered go/no-go in §8).*

> **Deep code review (2026-06-02):** see [pre-launch-review.md](pre-launch-review.md).
> No Critical issues; the codebase is well-built. 🔴 fix-before-launch items: ✅ **DAT-1**
> (CSV injection), ✅ **SRV-3** + **OPS-1** (web.config worker pin + log caps), ✅ **OPS-2**
> (pin Node) are **fixed**. **Remaining for Codex:** SRV-1 & SRV-2 (publish-flow
> robustness) and OPS-3 (live-SQLite backup procedure).

---

## 1. What the portal is (one paragraph)
An internal, trusted-LAN web app for FBBS: it publishes the daily document package and
surfaces it through Daily Intelligence, the Offerings explorers, Bank Tear Sheets, the
Strategies queue, swap-proposal builder, reports, and a coverage map. It is replacing
the **Salesforce day-to-day sales-coverage layer** — not custody/clearing/accounting,
and not anything client-facing.

---

## 2. Claude's lane — product, workflow, roles, training *(complete)*

| Deliverable | Document | Summary |
|---|---|---|
| **Role matrix** | [role-matrix.md](role-matrix.md) | 5 business roles mapped to actual routes; honest split of *code-enforced* (admin allowlist on 8 ingest routes; IIS identity) vs *policy-only*; gaps for Codex; go-live env recipe |
| **Sales workflow map** | [sales-workflow.md](sales-workflow.md) | Rep daily loop, manager oversight loop, strategy lifecycle, bond-swap sub-flow, "where do I go for…" index |
| **Go-live runbook** | [go-live-runbook.md](go-live-runbook.md) | Daily publish → Package QA → notify; exception handling; pre-launch checklist |
| **Launch-day script** | [launch-day-script.md](launch-day-script.md) | Minute-by-minute first-morning checklist; doubles as the smoke test |
| **Training (5 one-pagers)** | [training/](training/) | [sales](training/sales-guide.md) · [manager](training/manager-guide.md) · [admin-upload](training/admin-upload-guide.md) · [salesforce-replacement](training/salesforce-replacement.md) · [not-client-facing](training/not-client-facing.md) |
| **Client-facing boundary** | [client-facing-boundary.md](client-facing-boundary.md) | What could become client-facing, what stays internal forever, the bar before any external exposure |
| **Decision sheet** | [decision-sheet.md](decision-sheet.md) | One-page consolidation of every open FBBS decision |

### Key product findings the team should know
- The portal has **two enforced access tiers today** (authed rep · admin allowlist),
  not five. The five business roles collapse onto those plus **policy/training**. This
  is acceptable for a trusted-LAN internal launch — documented honestly in the role matrix.
- **`FBBS_ADMIN_USERS` must be set** for production, or ingest/publish is either wide
  open (local mode) or fully locked (IIS mode). This is a config go-live blocker.
- Cross-rep manager controls and several deletes/billing actions are **honor-system**
  today — fine for internal launch with training, tracked as optional code gates for Codex.

---

## 3. Codex's lane — engineering / security / deployment *(drafted — code shipped)*

Reference: [internal-go-live-engineering-checklist.md](../internal-go-live-engineering-checklist.md)
· commits [`49d5e64`](https://github.com/strategiesfbbs/fbbs-portal/commit/49d5e64)
"Add internal production auth guardrails" and
[`bf65d6d`](https://github.com/strategiesfbbs/fbbs-portal/commit/bf65d6d)
"Reflect admin permissions in launch UI".

### 3.1 Production auth readiness — ✅ shipped (`49d5e64`)
- `FBBS_AUTH_MODE=iis` activates IIS Windows identity: `REQUIRE_AUTH` on (401 on `/api/*`
  except `/api/health` without a resolved Windows user), `ALLOW_REP_OVERRIDE` off,
  `ALLOW_DEFAULT_REP` off.
- `/api/me` now returns an `auth` block (`mode`, `requireAuth`, `allowRepOverride`,
  `isAdmin`, `adminConfigured`) so the client knows the posture.
- `POST /api/me/override` returns `403 "Manual rep switching is disabled in production
  mode."` when override is off — the "Acting as" cookie is ignored in IIS mode.
- Covered by `tests/rep-identity.test.js`.

### 3.2 Admin & upload hardening — ✅ shipped (`49d5e64` + `bf65d6d`)
- `isAdminOnlyApiWrite()` + `rejectIfUnauthorized()` gate the **8 ingest/publish routes**
  to `FBBS_ADMIN_USERS` (401 if not logged in, 403 if not on the allowlist, 403 if the
  allowlist is empty). Enforced whenever IIS mode is on or an allowlist is configured.
- **Launch UI (`bf65d6d`):** the header reflects admin state — shows "Signed in" vs
  "Acting as", hides/disables the dead rep picker when override is off, and reflects
  admin permissions in the launch UI (CSS + `portal.js`). This closes role-matrix gap #2.

### 3.3 Go-live smoke test — ✅ local pass / ⬜ IIS pass
- Local pass recorded by Codex on 2026-06-02:
  [codex-full-audit-2026-06-02.md](codex-full-audit-2026-06-02.md).
- Covered Home, Daily Intelligence, all offering explorers, Bank Tear Sheets, Map,
  Saved Views, Strategies, Reports, Package QA, and Admin readiness against the real
  June 2 package.
- Remaining final action: run [launch-day-script.md](launch-day-script.md) end-to-end
  on the IIS box after Windows Auth, `FBBS_ADMIN_USERS`, and production `DATA_DIR` are
  applied.

### 3.4 Deployment readiness — ✅ drafted (`49d5e64`)
- `README.md` deployment steps updated: enable Windows Auth + disable anonymous, set
  `FBBS_AUTH_MODE=iis`, set `FBBS_ADMIN_USERS`, `DATA_DIR=D:\FBBSPortalData`.
- Config table + security-posture section rewritten; `web.config` comments updated.
- "Server And Data Operations" checklist (App Pool write access, audit-log retention,
  App Pool recycle, backup+restore test, disk monitoring) is in the engineering checklist.

### 3.5 Known gaps from code — open items for the role-gate follow-up
Still **honor-system** (any authed rep), acceptable for internal launch per the role
matrix, tracked for a later code gate:
- Cross-rep edits/deletes of coverage, notes, strategies, reports.
- Billing-queue mutations open to any rep.
- Swap send/execute open to any rep (pending the §6 policy decision).
- Audit log / Admin tab readable by any authed rep (pending §6 decision).

---

## 4. Combined readiness checklist

**Config / deployment (IT + Codex)** — *production switches DECIDED 2026-06-02; these
boxes are about applying them, plus the one remaining blank (the usernames):*
- [ ] `FBBS_AUTH_MODE=iis` (Windows Auth on; auth required; "Acting as" off)
- [ ] `FBBS_ADMIN_USERS=<approved upload/import users>` — real Windows short names (Publisher + Backup + import-runners). **Blank = nobody can publish (403).**
- [ ] `DATA_DIR=D:\FBBSPortalData` — folder exists and is in the backup job
- [ ] Upload limits (`MAX_UPLOAD_MB=50`, `BANK_UPLOAD_MAX_MB=300`) reviewed
- [ ] "Acting as" picker hidden/disabled in the UI when `allowRepOverride=false`

**Data (Publisher)**
- [ ] Real daily package published & passes Package QA
- [ ] Bank call-report + account-status workbooks imported (tear sheets populated)

**People (Manager)**
- [ ] Publisher + Backup trained on publish + QA
- [ ] Reps trained on the daily loop (sales guide)
- [ ] Sales-notify channel agreed & tested
- [ ] Escalation path documented

**Quality (Codex)**
- [ ] `npm test` green
- [ ] Smoke test passed end-to-end on today's package
- [ ] Audit-coverage gaps closed (or accepted)

---

## 5. Risk register (internal launch)

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Admin allowlist unset → publish open or locked | High | Set `FBBS_ADMIN_USERS`; verify in §4 | IT/Codex |
| Any rep can edit/delete others' records | Medium | Policy + training now; code gate later | Codex/Manager |
| Parser breaks on a source-format change | Medium | Package QA catches it; escalation path | Publisher/Codex |
| Multipart parser buffers full body in RAM (300 MB imports) | Low–Med | Run imports off-peak; streaming later (known issue) | Codex |
| Internal data treated as client-shareable | Medium | not-client-facing one-pager + training | Manager |

---

## 6. Decisions needed from FBBS (the ‹CONFIRM› list)

**Settled (Codex, 2026-06-02):** production runs IIS + Windows Auth
(`FBBS_AUTH_MODE=iis`), gated by `FBBS_ADMIN_USERS`, with `DATA_DIR=D:\FBBSPortalData`.
Those switches are no longer open questions.

Still open — all consolidated into the one-page **[decision sheet](decision-sheet.md)**
FBBS fills in. The nine items in brief: admin usernames (the config blocker), publisher
+ backup, package-ready time, sales-notify channel, source owner per file, billing owner,
swap send/execute policy, manager scope, non-daily import cadence.

---

## 7. How the two lanes merge into "final"
1. ✅ Codex's engineering shipped — §3 reflects commits `49d5e64` / `bf65d6d` + the engineering checklist.
2. ✅ Claude's product/workflow docs complete — §2.
3. ⬜ FBBS fills the **[decision sheet](decision-sheet.md)** (esp. `FBBS_ADMIN_USERS`).
4. ⬜ Codex runs the **[launch-day script](launch-day-script.md)** smoke test on a real package and records the result in §3.3.
5. ⬜ Set the §0 + §8 Go/No-Go. This file is the single record both agents and FBBS sign off on.

---

## 8. Go / No-Go scoring

Each item is tiered so we can decide what must be done **before** reps come on vs. what
can trail. "Launch with condition" = go live, but with a named owner + date to close it.

### 🔴 Required for launch (no-go if any is unchecked)
- [ ] `FBBS_AUTH_MODE=iis` live on the IIS box; `/api/me` shows `source: "iis"` — *IT/Codex*
- [ ] `FBBS_ADMIN_USERS` populated with real usernames; admin can publish, non-admin gets 403 — *IT/Codex*
- [ ] `DATA_DIR=D:\FBBSPortalData` set, writable by the App Pool, and **in the backup job** — *IT*
- [ ] A real daily package published and **Package QA shows 10/10 required slots** — *Publisher*
- [ ] Bank call-report + account-status workbooks imported (tear sheets populated) — *Publisher*
- [ ] `npm test` green; launch-day smoke test passed end-to-end — *Codex*
- [ ] Publisher + Backup have done a dry-run publish + QA — *Publisher*
- [ ] Decision sheet items #1–#4 answered (admin users, publisher/backup, ready-time, notify channel) — *FBBS*

### 🟡 Launch with condition (go, but assign an owner + close date)
- [ ] App restarts cleanly after an IIS App Pool recycle — *IT* — _condition if not yet tested_
- [ ] Backup **restore** tested (not just backup) — *IT*
- [ ] Reps trained on the daily loop; managers on oversight — *Manager* — _can be day-1 huddle_
- [ ] Escalation path documented (parser fail / missing file / server down) — *IT*
- [ ] Decision sheet items #5–#9 answered (billing owner, swap policy, audit visibility, manager scope, import cadence) — *FBBS*

### 🟢 Post-launch backlog (does not block go-live)
- [ ] Code-enforce manager-vs-rep scope (cross-rep edits/deletes) — *Codex*
- [ ] Gate billing-queue mutations and swap send/execute per the §6 policy — *Codex*
- [ ] Decide audit-log/Admin-tab visibility and gate if needed — *Codex*
- [ ] Soft-delete (vs hard-delete) for strategies/reports/coverage — *Codex*
- [ ] Stream large (300 MB) uploads instead of buffering in RAM (known issue) — *Codex*
- [ ] Disk-space monitoring on the data volume — *IT*

**Decision:** ⬜ Go / ⬜ Go-with-conditions / ⬜ No-go — owner: __________  date: __________
