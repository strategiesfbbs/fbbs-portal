# Cloud + Remote-Access Migration — prep & roadmap (2026-06-26)

Status: **brainstorm / prep for review — nothing built.** This is the decision-and-scoping doc to hand IT, compliance, and the desk before any migration work starts. Written off a brainstorming session; the AI angle was the original prompt, but the real driver surfaced as **remote access** (below).

## TL;DR

- IT's instinct ("go external cloud if we keep using AI") is directionally right, but the **real driver is remote access** — reps want the portal on phones and laptops from conferences, hotels, anywhere. AI itself does **not** require public hosting (it's just outbound HTTPS to Anthropic, already wired in `server/claude-client.js`).
- Going public **deletes the foundation the whole portal is built on.** Today the entire security model is one line from `CLAUDE.md`: *"No built-in auth. Trusted-LAN model. Production answer is IIS Windows Authentication."* The LAN gives us identity, perimeter, and transport trust for free. ~70–80% of this project is re-buying those three things.
- **Email/password is a fine primary login — but add MFA, and don't store passwords ourselves.** Use a managed identity provider. Internal reps only, admin-provisioned, no self-registration.
- **Don't try to make the entire ~20K-line SPA great on a phone.** Pick the handful of conference use-cases and make *those* mobile-first; everything else stays laptop-grade.
- Compliance (Reg S-P, SEC 17a-4, FINRA WSP, Bloomberg redistribution) is the **gating** workstream, not a cleanup pass. We already have `docs/compliance-supervision-spec-2026-06-24.md` to build on.

## The reframe (why this is bigger than "add hosting")

| Today (LAN/IIS) | Public cloud | What we have to build |
|---|---|---|
| Identity = Windows Auth via iisnode headers (`server/rep-identity.js` trusts them) | No Windows. Header trust is invalid. | Real app auth via a managed IdP |
| Perimeter = the office firewall | Open internet | WAF + DDoS + TLS + MFA |
| Transport trust = "it's on our LAN" | Hostile networks (conference WiFi) | HTTPS everywhere, hardened sessions |
| No users/roles table, no CSRF, no rate limiting — *"deferred to the LAN/IIS posture"* | All of that is now exposed | Sessions, throttling, abuse controls |
| Deploy = copy files; a non-developer babysits it | Needs real ops | CI/CD, monitoring, backups/DR, an owner |

The good news: the **roles already exist and are enforced server-side** — `shouldEnforceRepScope()`, `FBBS_ADMIN_USERS`, `*-scope-collapsed` auditing. They just need to hang off the new identity source instead of Windows. The Admin/Rep model survives intact.

## Decisions (settle these first — they drive everything)

| # | Decision | Lean | Why |
|---|---|---|---|
| 1 | Public site vs. private (VPN) | **Public** | Reps want it on phones at conferences; a VPN client on a phone defeats "just works anywhere." |
| 2 | Cloud provider | **Azure** | Aligns with the Windows/Entra shop; Entra External ID gives auth out of the box. |
| 3 | Build auth vs. managed IdP | **Managed IdP** (Entra External ID / Auth0 / Cognito) | Don't own a password store. Get MFA + passkeys + reset + lockout + SOC 2 for free. |
| 4 | MFA | **Yes** — TOTP minimum, passkeys as the mobile upgrade | Single-factor on customer financial data on the public internet is an exam finding. |
| 5 | Self-registration | **Off** — admin provisions rep accounts | Internal reps only = bounded, known user set = small attack surface. |
| 6 | How Claude is reached | **Claude in our own cloud tenant** (Bedrock / Vertex / Azure) | Keeps prompt data under our existing cloud contract instead of a public API key. |
| 7 | Mobile scope | **A few conference use-cases mobile-first**, rest laptop-only | The dense desk SPA will never be good on a 380px screen; don't try. |

## Login: email/password is fine — with two guardrails

1. **Add MFA.** It runs on the phone the rep already carries, so it doesn't fight "access anywhere." Conference WiFi is the most hostile network our reps touch (rogue hotspots, phishing). Two mobile-friendly paths:
   - **Email/password + authenticator app (TOTP)** — conventional, well understood.
   - **Passkeys (Face ID / fingerprint)** — *better* than typing a password on a phone; phishing-resistant; mobile-native. Offer as the upgrade, keep email/password as fallback.
2. **Don't build the password store.** "Email/password" done correctly = salted hashing, login throttling/lockout, reset-by-email, breach detection, session/token management. That's a real auth surface we've never owned and it cuts against the "two deps, a non-developer babysits it" philosophy. Hand it to a managed IdP — it's also a SOC 2 vendor we can point compliance at instead of explaining a homegrown table.

`server/rep-identity.js` gets rewired to read identity from the IdP token; everything above it (roles, scope enforcement, audit) is unchanged.

## Internal-only (confirmed 2026-06-26) — what it buys us

No client-facing access for now. The audience is a small, fixed set of rep accounts. That simplifies the build in concrete ways:

- **Smaller, known attack surface** — admin-provisioned accounts, no self-registration, no public sign-up funnel to defend. We can enumerate every legitimate user.
- **Aggressive controls become practical** — impossible-travel / anomalous-login alerts, optional device registration, per-account session revoke. Easy when the user list is ~dozens, not thousands.
- **Lighter Reg S-P posture** — no customer-facing portal exposing clients' own data to them over the web. Customer data still lives on a public host, so the safeguards rule (encryption, access control, MFA, audit) still fully applies — but there's no client-consent/notice workstream for a client login.
- **Auth stays simple** — one IdP, one app, one role split (Admin/Rep). No B2B/B2C tenant separation, no per-client data partitioning.

**Caveat:** IP allowlisting is *not* a usable control for the mobile case — reps log in from random conference/hotel IPs — so **MFA carries the access-control load.** Keep IP intelligence as alerting, not as a gate.

This is a "for now" decision. Any future client-facing feature reopens the auth + compliance surface (client consent/notice, tenant isolation, possibly different IdP config) and should get its own review.

## Workstreams

### 1. Identity & access — the big lift (most of the project)
- Managed IdP integration (OIDC); email/password + MFA; passkeys optional.
- Rewire `server/rep-identity.js` from Windows-header trust to IdP token.
- Session management + secure cookies; mobile-friendly refresh tokens with idle timeout + **remote session revoke** (a forgotten phone must be killable).
- Admin provisioning flow for rep accounts; no self-signup.
- Keep Admin/Rep + `shouldEnforceRepScope` + scope-collapse auditing as-is.

### 2. Compliance & governance — the GATING workstream
Must clear before build, not after. We're a FINRA/SIPC BD moving customer + firm financial data to a third party.
- **Reg S-P** (privacy of customer financial info) — data-flow review, likely client notice.
- **SEC 17a-4 / FINRA 4511** books & records — retention on non-rewriteable (WORM) storage. `audit.log` is append-only but **rotates by size** (`AUDIT_LOG_MAX_MB`) — that rotation may conflict with retention. Needs a compliance answer. (See `docs/compliance-supervision-spec-2026-06-24.md`.)
- **FINRA WSP / cybersecurity program** updates covering the new architecture + AI vendor.
- **Bloomberg / market-data redistribution** — the "Designated Authorized Computer" restriction we already flag in `CLAUDE.md` gets *worse* on a public cloud. Re-confirm with the Bloomberg rep before any TOMS/BVAL-derived data goes up.
- **Vendor due diligence** — SOC 2 + DPA for cloud provider and IdP; commercial terms (ideally zero-data-retention) for Claude.
- **Penetration test** before go-live.

### 3. AI governance (the original prompt)
- **Route Claude through our own cloud tenant** (Bedrock/Vertex/Azure) so prompt data stays under our cloud contract — single most important AI-compliance move.
- API keys move from a file/env on disk into a **secrets manager** (Key Vault).
- **Prompt-data policy / DLP** — define what customer/firm data is allowed into a prompt. Our existing discipline helps a lot: *"Claude only ranks/explains; every number re-attached from our own data"* means we can keep raw figures out of prompts.
- Cost/abuse controls already exist (billable refresh routes are admin-gated) — keep + monitor.
- Log AI calls for supervision.

### 4. Perimeter & network security (re-buying the firewall)
- TLS everywhere + managed certificates.
- **WAF + DDoS** in front.
- Public, but lock down: optional IP intelligence / impossible-travel alerts (bounded user set makes this easy), rate limiting on auth + APIs.
- Keep the **strict CSP** and the **sandboxed dashboard iframe** — already solid; do not widen.

### 5. Hosting & data
- Containerize the plain-Node / no-build app (the no-build constraint is an *asset* here).
- `better-sqlite3` is a native addon — pin Node ABI / base image so it stays prebuilt.
- **Persistent, backed-up storage** for the filesystem package (`data/current`, `data/archive`), the SQLite DBs, and the ~153MB bank workbook — NOT ephemeral container disk. (See `docs/sqlite-backup-integrity-spec-2026-06-24.md`.)
- **Single-writer SQLite ⇒ scale vertically, not horizontally.** Fine for a desk of reps, but document it — can't just spin up N instances.
- Large uploads: 300MB workbook over the WAN, and the multipart parser **buffers the whole body in RAM** (already a known issue) — revisit at internet latency/scale.

### 6. Ops / DevOps (the "non-developer babysits it" era ends)
- CI/CD pipeline (today deploy = copy files).
- Centralized logging/monitoring/alerting (today `log()` → stdout captured by iisnode).
- Staging vs. prod environments; patching / vuln management.
- A named ops owner.

## Mobile scope — make the conference flows first-class, not the whole SPA

The portal is a dense desk tool (~20K-line `portal.js`, ~15K-line `portal.css`, wide tables everywhere). Most of it won't be usable on a phone, and trying to make all of it responsive is a money pit. Make the **conference use-cases** mobile-first and leave the rest laptop-grade:

**Mobile-first (the booth/lobby moments):**
- Look up a **bank tear sheet** mid-conversation.
- Check **today's offerings / a specific CUSIP** (global search → explorer).
- Pull a **rate / market snapshot number** for a talking point.
- **Log an activity** ("talked to X at the booth") — fast capture.

**Laptop-only (don't fight the small screen):**
- 300MB workbook import / admin upload.
- Bond Swap proposal builder (three-pane).
- Reports v2 grid, dense blotters, the full explorers.

## Phased roadmap

**Phase 0 — decisions + compliance sign-off (no code).** Settle the decisions table; get compliance/legal + Bloomberg + vendor-risk answers. *Gate: do not start Phase 1 without this.*

**Phase 1 — lift-and-shift + real auth.** Containerize, stand up on the chosen cloud, wire the managed IdP (email/password + MFA), rewire `rep-identity.js`, put WAF/TLS/secrets in front, route Claude through the cloud tenant. Persistent storage + backups. Laptop-first; same UI. *Outcome: the existing portal, reachable from anywhere, securely.*

**Phase 2 — mobile-optimize the conference flows.** Make the four mobile-first use-cases above genuinely good on a phone. Passkeys. Remote session revoke. *Outcome: the portal is usable from a conference floor.*

**Phase 3 — hardening + ops maturity.** Pen test, monitoring/alerting polish, DR drill, supervision/AI-call logging review. *Outcome: examiner-ready.*

## Open questions for IT / compliance / desk

1. Confirmed cloud provider? (Azure assumed.)
2. Existing identity tenant we can extend (Entra), or net-new IdP?
3. ~~Any client-facing access ever planned, or internal reps only forever?~~ **RESOLVED 2026-06-26: internal reps only for now** (see "Internal-only" below). Revisit before any client-facing feature — it would materially reopen the auth + compliance surface.
4. Compliance's read on WORM retention vs. our size-based `audit.log` rotation.
5. Bloomberg rep's answer on redistribution to a public-cloud host.
6. Who owns ops post-migration?

## Non-goals (explicitly out of scope here)
- Rewriting the app off plain-Node / no-build — the small footprint is an asset; keep it.
- Adding a third npm dependency to do auth — use a managed IdP service, not a library we babysit.
- Making the entire SPA responsive — see mobile scope.
- Horizontal scale-out — single-writer SQLite makes vertical the right answer for this user count.
