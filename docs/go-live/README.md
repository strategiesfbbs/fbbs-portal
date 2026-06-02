# docs/go-live — Internal Go-Live Pack

Documents for taking the FBBS portal live as an internal tool. Two work lanes:
**Claude** (product / workflow / roles / training) and **Codex** (auth / security /
deployment / tests / smoke).

**Start here:** [internal-go-live-readiness.md](internal-go-live-readiness.md) — the
umbrella doc that joins both lanes and holds the Go/No-Go and the open-decisions list.

**FBBS:** the one thing we need from you is the **[decision-sheet.md](decision-sheet.md)** —
one page of blanks (admin usernames, publisher, ready-time, notify channel, policy).

| Document | Lane | What it is |
|---|---|---|
| [internal-go-live-readiness.md](internal-go-live-readiness.md) | Joint | Umbrella: readiness, risks, **tiered Go/No-Go (§8)**, both lanes' status |
| [pre-launch-review.md](pre-launch-review.md) | Claude | **Deep code review** — what's solid, 🔴 fix-before-launch, 🟠 conditions, 🟢 backlog |
| [codex-handoff.md](codex-handoff.md) | **Codex acts** | Ordered engineering worklist from the review (file:line · fix · done-when) |
| [codex-full-audit-2026-06-02.md](codex-full-audit-2026-06-02.md) | **Codex** | Full follow-up audit, fixes completed, browser smoke results, Salesforce gap list |
| [sell-more-bonds-flow.md](sell-more-bonds-flow.md) | Claude | Revenue-flow smoke test + Salesforce report gaps + prioritized "make it flow to sell more bonds" roadmap |
| [decision-sheet.md](decision-sheet.md) | **FBBS fills** | One-page checklist of every open org decision |
| [launch-day-script.md](launch-day-script.md) | Joint | Minute-by-minute first-morning checklist (= the smoke test) |
| [role-matrix.md](role-matrix.md) | Claude | 5 roles × capabilities; **Phase 1 mapping (§2.1)**; enforced-vs-policy; gaps |
| [sales-workflow.md](sales-workflow.md) | Claude | Rep & manager daily loops; strategy lifecycle; swap sub-flow |
| [go-live-runbook.md](go-live-runbook.md) | Claude | Daily publish → QA → notify; exceptions; pre-launch checklist |
| [client-facing-boundary.md](client-facing-boundary.md) | Claude | What could go client-facing; what stays internal; the bar |
| [training/](training/) | Claude | 5 one-pagers: sales, **manager**, admin/upload, Salesforce-replacement, not-client-facing |

**Codex engineering (sibling folder):**
[../internal-go-live-engineering-checklist.md](../internal-go-live-engineering-checklist.md)
— production identity, admin allowlist, smoke tests, server/data ops (shipped in commits
`49d5e64`, `bf65d6d`).

> Items marked **‹CONFIRM›** in the docs all map to the [decision sheet](decision-sheet.md).
