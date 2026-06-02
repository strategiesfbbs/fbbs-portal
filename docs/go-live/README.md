# docs/go-live — Internal Go-Live Pack

Documents for taking the FBBS portal live as an internal tool. Two work lanes:
**Claude** (product / workflow / roles / training) and **Codex** (auth / security /
deployment / tests / smoke).

**Start here:** [internal-go-live-readiness.md](internal-go-live-readiness.md) — the
umbrella doc that joins both lanes and holds the Go/No-Go and the open-decisions list.

| Document | Lane | What it is |
|---|---|---|
| [internal-go-live-readiness.md](internal-go-live-readiness.md) | Joint | Umbrella: readiness checklist, risks, decisions, Go/No-Go |
| [role-matrix.md](role-matrix.md) | Claude | 5 roles × portal capabilities; enforced-vs-policy; gaps for Codex |
| [sales-workflow.md](sales-workflow.md) | Claude | Rep & manager daily loops; strategy lifecycle; swap sub-flow |
| [go-live-runbook.md](go-live-runbook.md) | Claude | Daily publish → QA → notify; exceptions; pre-launch checklist |
| [client-facing-boundary.md](client-facing-boundary.md) | Claude | What could go client-facing; what stays internal; the bar |
| [training/](training/) | Claude | 4 one-pagers: sales, admin/upload, Salesforce-replacement, not-client-facing |

> Items marked **‹CONFIRM›** in the docs need an answer from FBBS — they're
> consolidated in [internal-go-live-readiness.md §6](internal-go-live-readiness.md#6-decisions-needed-from-fbbs-the-confirm-list).
