# FBBS Portal — Client-Facing Future Boundary

> **Owner:** Claude (product/workflow lane) · **Status:** Draft for strategy review · **Last updated:** 2026-06-02
> Defines what *could* eventually be exposed to clients, what must **stay internal
> forever**, and the compliance/security bar that would have to be cleared before
> **any** external exposure. This is a planning document — **nothing here authorizes
> external access today.** See [training/not-client-facing.md](training/not-client-facing.md)
> for the rule that applies right now.

The portal today is an **internal, trusted-LAN tool** with no app-level auth (Windows
identity on the FBBS network). That posture is correct for internal use and is the
single biggest reason nothing is client-facing yet.

---

## 1. Three tiers

### Tier A — Could become client-facing (with work)
These are *deliverables* the firm already produces for clients; the portal just makes
them. Exposing them externally is a product decision plus a security/compliance project,
not a quick toggle.

| Candidate | Why it's plausible | What it still needs |
|---|---|---|
| **Swap proposal one-pager** (frozen snapshot) | Already a client deliverable; immutable on send; audit-logged | Rep/compliance review gate; delivery outside the app (not portal login) |
| **Portfolio review / report PDFs** | Client-oriented outputs | Same review gate; certified-data sign-off |
| **A client's own holdings / statements** | Clients have a right to their data | A *separate* authenticated client portal — not this app |
| **Curated market commentary** (Relative Value, MMD talking points) | Sales-ready, non-sensitive | Editorial/compliance review before publishing externally |

> Even for Tier A, the realistic path is **"the portal generates it, a person reviews
> it, and it's delivered through an approved channel"** — *not* giving clients a login.

### Tier B — Internal forever (never client-facing)
| Item | Why it must stay internal |
|---|---|
| Account **status** (Open / Prospect / **Watchlist** / **Dormant**) and coverage owner | Internal categorization; reputational/relationship risk if seen |
| Rep **notes**, follow-ups, activity timeline | Internal commentary, candid by design |
| **Pipeline & Strategies queue** | Internal sales operations |
| **Billing queue / Needs Billed** | Internal financial ops |
| **The full bank universe** (every bank's call-report data, peers, map) | A client should only ever see *their own* data, never the book |
| Audit log / admin tools / Package QA | Operational internals |
| Daily Intelligence **rule picks** & internal trade reasoning | Internal desk thinking, not advice to push at clients raw |

### Tier C — Out of scope for the portal entirely
Custody, clearing, trading execution, portfolio **accounting**, and formal compliance
records stay in their existing systems. The portal references/links; it does not
become the system of record for these.

---

## 2. The bar to clear before ANY external exposure

If FBBS ever decides to expose Tier A externally, treat it as a **new project** with
its own review. Minimum gates:

1. **Authentication & identity** — real client auth (not the internal Windows model);
   account-to-client scoping so a client can *only* see their own data; session
   security review.
2. **Authorization / data isolation** — hard, code-enforced boundaries (the current
   "any authed rep sees everything" model is the opposite of what a client portal needs).
3. **Network posture** — moving off the trusted-LAN assumption: TLS, hardening,
   rate limiting, abuse protection, a security review / pen test. (These are the
   "intentionally not there" items in `CLAUDE.md`'s security posture.)
4. **Compliance** — data retention, supervision/archiving of anything client-visible,
   disclosures, certified-vs-indicative data labeling, and sign-off from compliance.
5. **Content review workflow** — no internal field (status, notes, owner, pipeline)
   can leak into a client view; explicit allowlist of client-visible fields.
6. **Separate surface** — strongly prefer a **distinct client app** that reads a
   curated, client-scoped slice, rather than bolting external access onto the internal
   portal. Mixing the two surfaces is where data-leak risk concentrates.

> **‹CONFIRM with compliance/IT›** — none of the above should be scoped or built
> without compliance and IT leading. This document only frames the decision.

---

## 3. Recommendation for now

- **Keep the portal internal.** It's delivering its value as the desk's workspace.
- **Deliver Tier A items as documents** (reviewed PDFs/one-pagers), through existing
  approved channels — not by granting portal access.
- **Defer any client portal** until there's a real business case; when there is,
  build it as a separate, client-scoped surface with the §2 bar met.

This keeps the go-live focused on the internal launch while leaving a clean, honest
path for a future client-facing decision.
