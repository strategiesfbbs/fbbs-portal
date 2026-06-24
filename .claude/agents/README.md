# FBBS Portal — project subagents

Project-scoped Claude Code subagents, defined per the **real** architecture of this
repo (plain Node, no build, vanilla-JS SPA, SQLite via `better-sqlite3`, 2 npm deps).
They are specialists you delegate a layer-specific slice of work to; the main session
orchestrates across them. Every agent is told to read `CLAUDE.md` / `AGENTS.md` first —
those files (and the security posture / dependency rules in them) are authoritative and
override any external brief.

> These were created from `FBBS_CLAUDE_CODE_HANDOFF.md`, but that handoff assumed a
> fictional Next.js/TypeScript/Tailwind stack and largely re-specced features that already
> exist. The agents below are scoped to what this app actually is, not to that brief.

## Roster

| Agent | Owns | Use when |
|---|---|---|
| `parser-dev` | `server/*-parser.js`, `pdf-text.js`, vendored SheetJS | a desk file format changes / a parser misreads / new slot parsing |
| `sqlite-store-dev` | `server/*-store.js` via `sqlite-db.js` | new tables/columns, CRM/queue store helpers, idempotent migrations |
| `server-router-dev` | `server/server.js` (routes, upload, security, audit) | new API routes, package/slot machinery, gating, auto-publish |
| `spa-frontend-dev` | `portal.js`, `index.html`, `modules/*.js` | new pages/tabs, grids, deep-links, client-side filters/CSV |
| `css-stylist` | `public/css/portal.css` only | facelifts, tokens, focus/hover/print states, dead-CSS pruning |
| `ai-grounding-dev` | `claude-client.js` + grounded AI consumers | new AI narratives/rankings, grounding/validation, billable-call caching |
| `market-data-integrator` | `market-*`, `fred-series`, `fdic-*` | new keyless outbound feeds, cache/TTL/stale logic, wire/snapshot wiring |
| `portal-verifier` | tests / smoke / preview | confirm a change works (reports; doesn't build) |
| `portal-security-reviewer` | read-only audit | before merging security-sensitive changes |

## Conventions baked into every agent
- No new npm deps (frozen at `pdf-parse` + `better-sqlite3`; SheetJS vendored). No TS/Next/Tailwind/React.
- Run `npm test` (plain `node` + `node:assert`, no framework) before declaring done.
- Commit small on the working branch; **never push or commit to `main`** unless told.
- Verify UI/CSS in the browser via the **`fbbs-portal-dev`** launch config (port 3210 — runs from this working tree; the `fbbs-portal` config on 3200 runs a different copy).
- Bloomberg/S&P market data is **not** redistributable to the LAN portal (licensing wall); any paid integration is an owner decision.
