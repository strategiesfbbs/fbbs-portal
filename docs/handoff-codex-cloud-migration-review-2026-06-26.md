# Handoff → Codex: review the cloud + remote-access migration prep (2026-06-26)

**Ask:** review `docs/cloud-remote-access-migration-prep-2026-06-26.md` and push back. This is a **brainstorm/prep doc, not an implementation** — no code was written, no branch, working tree untouched by it. I want your read on the codebase-grounded claims before any of it firms up.

## Context (what changed and why)

Owner + IT are weighing moving the portal **off the on-prem LAN/IIS model to a publicly-reachable cloud site**. Stated trigger was "keep using AI," but the real driver is **remote access** — reps want it on phones/laptops at conferences. Confirmed scope: **internal reps only for now** (no client-facing access). This would invert the core `CLAUDE.md` constraint (*"No built-in auth. Trusted-LAN model. Production answer is IIS Windows Authentication."*).

Agreed direction in the doc: public site + WAF/TLS/MFA; **email/password + MFA via a managed IdP** (Entra External ID / Auth0 / Cognito), not a homegrown password store; admin-provisioned accounts, no self-registration; **Claude routed through our own cloud tenant** (Bedrock/Vertex/Azure) instead of a public API key.

## What I want your eyes on (your lanes — backend/data/infra correctness)

1. **Auth rewrite feasibility.** The doc claims `server/rep-identity.js` can be rewired from IIS-Windows-header trust to a managed-IdP token while the roles/scope layer rides on top unchanged (`shouldEnforceRepScope`, `FBBS_ADMIN_USERS`, `*-scope-collapsed` auditing). Is that actually clean, or are there other Windows-identity assumptions baked into `server.js` / the cross-site-write guard / the rep-override cookie that I missed?

2. **Single-writer SQLite vs. cloud hosting.** Doc says scale vertically (one instance), can't fan out N instances because of the SQLite writer. Confirm that's the right call given the 7+ stores through `sqlite-db.js`, and flag anything that would break behind a load balancer (session affinity, in-process caches like `mapBankCache` / `getCurrentPackage` cache / the RV/dashboard caches).

3. **WORM retention vs. `audit.log` rotation.** Doc flags that SEC 17a-4 WORM retention may conflict with the size-based rotation in `server/log-rotation.js` (`AUDIT_LOG_MAX_MB`/`AUDIT_LOG_KEEP`). You own the audit/log path — is this a real conflict, and does it intersect `docs/compliance-supervision-spec-2026-06-24.md`?

4. **Data/storage + DR.** Persistent storage for the filesystem package (`data/current`, `data/archive`), the SQLite DBs, and the ~153MB workbook must be non-ephemeral + backed up. Does this align with `docs/sqlite-backup-integrity-spec-2026-06-24.md`, or does cloud hosting change those assumptions?

5. **The 300MB RAM-buffered multipart upload.** Already a known issue; over the WAN at internet latency it's worse. Is this a Phase-1 blocker or can it ride along to a later phase?

6. **Anything I got wrong about the architecture** in the prep doc — correct it.

## Not asking for

- Any code. This is review/validation of the plan only.
- Re-litigating the decisions table (provider, IdP, MFA, internal-only) — those are owner/IT calls, already leaning as noted. Flag *technical* problems with them, not preferences.

## Repo / workflow notes

- Doc is uncommitted on branch `codex-thc-bridge-cleanup` along with other in-progress work (THC bridge cleanup, portal import updates) — **don't assume a clean tree.** The two new docs (`cloud-remote-access-migration-prep-2026-06-26.md`, this file) are the only cloud-migration artifacts; nothing else touched.
- Guardrails unchanged: 2 npm deps · no build step · SQLite via `sqlite-db.js` only · strict CSP · keep `CLAUDE.md`/`AGENTS.md` in sync.
- Leave your review as a section appended to the prep doc or a sibling `docs/` note, whichever you prefer.

## Open questions for IT/compliance (tracked in the prep doc, not for Codex to answer)

Cloud provider confirm (Azure assumed) · Entra tenant to extend vs. net-new IdP · compliance read on WORM-vs-rotation · Bloomberg redistribution to a public host · ops owner post-migration.
