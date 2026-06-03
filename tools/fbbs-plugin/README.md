# `fbbs` — shared Claude Code plugin for the Market Intelligence Portal

Shared slash commands + a trunk-protection hook so Claude Code and Codex drive the
repo the same way. The plugin's commands are thin wrappers over things that already
exist in the repo (`npm test`, `classifyFile()`, the preview tools) — so Codex, which
can't load a Claude Code plugin, runs the *same underlying actions* directly.

## Install (per developer machine)

The marketplace lives at the repo root (`.claude-plugin/marketplace.json`). From inside
Claude Code, with this repo as the working directory:

```
/plugin marketplace add .
/plugin install fbbs@fbbs-tools
```

(Or from the CLI: `claude plugin marketplace add .` then `claude plugin install fbbs@fbbs-tools`.)

Update after pulling changes: `/plugin marketplace update`.

## Commands

| Command | What it does |
|---|---|
| `/fbbs:test` | Runs the full `npm test` regression suite and summarizes failures. The trunk gate. |
| `/fbbs:verify [page]` | Starts the dev server and verifies the daily package + key pages render via the preview tools (no manual checking). |
| `/fbbs:package-status` | Read-only report of which of the 10 daily-package slots are filled, from `_meta.json` + `data/current/`. |
| `/fbbs:publish [folder]` | Pre-flights a publish: classifies candidate files into slots, flags collisions/type mismatches. Does not upload. |
| `/fbbs:trader-emails [query]` | Read-only triage of trader/offering emails via the Gmail MCP (intraday remaining-qty roadmap). |
| `/fbbs:reports-context [topic]` | Loads the Reports/Data Analytics source map and explains whether the work belongs in portal code, plugin context, or a Data Analytics semantic layer. |

## Reports + Data Analytics handoff

`tools/fbbs-plugin/context/reports-data-analytics.md` is the shared source map for
Reports work. It points Claude Code and Codex at the portal files, stores, tests, and
verification routes that matter for Reports, while keeping durable analytics semantics in
the Data Analytics semantic-layer workflow.

Use `/fbbs:reports-context` before report-builder changes, peer/bond-accounting import work,
or Data Analytics prompts about FBBS bank and portfolio reporting. If the work needs canonical
metric definitions, grains, joins, caveats, or source precedence, create or refresh the Data
Analytics semantic layer instead of copying that content into this plugin.

## Hook — trunk guard

`hooks/pre-commit-test.sh` fires on `PreToolUse(Bash)`. It acts **only** when the Bash
command is a `git commit` **and** the branch is `main`: it runs `npm test` and blocks the
commit (exit 2) on failure. Every other Bash command passes through untouched.

This runs in **Claude Code only**. Codex doesn't load the plugin, so Codex must keep
running `npm test` itself before committing — same rule, enforced by discipline on that side.

## Gmail connector

`/fbbs:trader-emails` uses the Gmail MCP connector already available at the session level —
no extra wiring needed to *read*. `.mcp.json.example` is a template if you ever want the
plugin to declare its own Gmail MCP server; rename it to `.mcp.json` and fill in the
endpoint/token. Automated mailbox **ingestion into the portal** stays deferred until the
IIS/Windows-auth deployment story lands (see `docs/company-portal-context.md` → "Replacement
Boundaries").

---

## Next steps & work split (feature backlog)

Lanes per the current dual-agent split (Claude Code owns portal UI + product/workflow docs;
Codex owns auth/deploy/tests/data-layer plumbing). All features stay inside the hard
constraints: plain Node + SQLite + vendored client assets, no new npm deps, no build step.

### Claude Code (portal UI / product)
1. **Bank Coverage Home** — rep landing page: My Clients / My Prospects / My Open Tasks /
   Recently Viewed / Overdue next actions. Reads existing account-status + strategy + tear-sheet stores.
2. **Peer-comparison chart on tear sheets** — surface the already-parsed `averaged-series`
   peer-group data as a bank-vs-peer trend chart (Plotly is already vendored). High impact, zero new deps.
3. **Product-fit flags on tear sheets** — CD-funding / muni-BCIS / ALM-IRR / portfolio-accounting
   badges derived from call-report metrics.
4. **Saved Views UI** — Dynamic Clients, Dynamic Prospects, CECL Prospects, Needs Billed,
   Open Account List; CSV-exportable (date-in-filename convention).
5. **Portfolio analytics view** — maturity ladder / runoff visualization from the existing
   bond-accounting holdings + runoff pipeline.

### Codex (auth / deploy / tests / data layer)
1. **`FBBS_ADMIN_USERS` / Windows-auth posture** — the config blocker gating per-rep data
   isolation; prerequisite for anything that scopes views to "my" banks.
2. **Saved-views query layer** — server-side saved-query definitions + endpoints behind the UI above.
3. **Account activity timeline store** — aggregate status changes + notes + uploads + report
   generations + task completions per bank.
4. **Test coverage** for every new endpoint (the `npm test` suite is the shared gate).
5. **Gmail ingestion plumbing** — build-after-auth; the durable pipeline from shared mailbox
   to dated dropbox folder.

### Shared
- This plugin (`tools/fbbs-plugin/`) and the `npm test` gate.
- Keep `CLAUDE.md` / `AGENTS.md` in sync (they mirror each other).
