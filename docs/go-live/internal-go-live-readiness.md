# FBBS Portal — Internal Go-Live Readiness

> **Status:** Draft · **Last updated:** 2026-06-02
> The single umbrella document for the internal launch. It joins the two work lanes:
> **Claude** (product / workflow / docs / roles spec) and **Codex** (auth / security /
> deployment / tests / smoke). Claude's sections are filled in below; Codex's sections
> are stubbed with anchors so the engineering findings drop straight in.

---

## 0. Go / No-Go summary (fill at the end)

| Area | Owner | Status | Notes |
|---|---|---|---|
| Product & workflow docs | Claude | ✅ Drafted | Role matrix, workflow, runbook, training, boundary |
| Auth / roles hardening | Codex | ⬜ TODO | IIS auth, admin allowlist, role gates |
| Admin / upload hardening | Codex | ⬜ TODO | Admin-only actions, audit coverage |
| Deployment readiness | Codex | ⬜ TODO | web.config, env, DATA_DIR, IIS Windows Auth |
| Smoke test (today's package) | Codex | ⬜ TODO | Full publish→QA→explorers→banks→strategies→reports |
| Org decisions (the ‹CONFIRM› list) | FBBS | ⬜ TODO | See §6 |

**Recommendation:** ⬜ Go / ⬜ Go-with-conditions / ⬜ No-go — *(decide once Codex's
lanes and the ‹CONFIRM› list are closed).*

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
| **Training (4 one-pagers)** | [training/](training/) | [sales-guide](training/sales-guide.md) · [admin-upload-guide](training/admin-upload-guide.md) · [salesforce-replacement](training/salesforce-replacement.md) · [not-client-facing](training/not-client-facing.md) |
| **Client-facing boundary** | [client-facing-boundary.md](client-facing-boundary.md) | What could become client-facing, what stays internal forever, the bar before any external exposure |

### Key product findings the team should know
- The portal has **two enforced access tiers today** (authed rep · admin allowlist),
  not five. The five business roles collapse onto those plus **policy/training**. This
  is acceptable for a trusted-LAN internal launch — documented honestly in the role matrix.
- **`FBBS_ADMIN_USERS` must be set** for production, or ingest/publish is either wide
  open (local mode) or fully locked (IIS mode). This is a config go-live blocker.
- Cross-rep manager controls and several deletes/billing actions are **honor-system**
  today — fine for internal launch with training, tracked as optional code gates for Codex.

---

## 3. Codex's lane — engineering / security / deployment *(to be filled by Codex)*

<!-- CODEX: drop your findings under each heading. Claude's role matrix §5 is the
     spec for the role-gate work; the runbook §8 lists the deployment preconditions. -->

### 3.1 Production auth readiness
- _Codex: current rep-identity flow review; plan to switch prod identity to IIS/Windows;
  lock down "Acting as" for normal reps; role gates for admin/upload/report/billing._

### 3.2 Admin & upload hardening
- _Codex: which actions must become admin-only; missing audit events; ingest-route review._

### 3.3 Go-live smoke test
- _Codex: results of the repeatable launch checklist run against today's package._

### 3.4 Deployment readiness
- _Codex: web.config, README deploy steps, env vars, upload limits, DATA_DIR; IIS/Windows
  Auth path confirmed; production env/settings checklist._

### 3.5 Known gaps from code
- _Codex: precise "not ready / partial / safe for internal launch" list by route/page._

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

Still open — these unblock "final":

1. **The usernames for `FBBS_ADMIN_USERS`** = the "approved upload/import users":
   Publisher + Backup + whoever runs the quarterly imports (Windows short names).
   *This is the last blank in the production config.* *(runbook, role matrix)*
2. **Daily "package ready by" time** + publish/QA/notify clock. *(runbook)*
3. **Source-file owner per slot** (who to chase when late). *(runbook)*
4. **Sales-notify channel.** *(runbook)*
5. **Ops/Billing**: separate person or same as manager? → billing-queue gating. *(role matrix)*
6. **Swap send/execute**: restricted (rep-owns / manager) or open? *(role matrix)*
7. **Audit log / Admin tab**: admin-only or visible to all reps? *(role matrix)*
8. **Manager scope**: can managers edit reps' records, or view only? *(role matrix)*
9. **Non-daily import cadence** (bank/account-status/peer). *(runbook)*

---

## 7. How the two lanes merge into "final"
1. Codex fills §3 and the engineering items in §4–§5.
2. FBBS answers §6.
3. We set the §0 Go/No-Go.
4. This file becomes the single "Internal Go-Live Readiness" record both agents and FBBS sign off on.
