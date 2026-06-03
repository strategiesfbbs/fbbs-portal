---
description: Run the FBBS portal regression suites (npm test) and summarize any failures.
allowed-tools: Bash(npm test), Bash(npm run *), Read
---
Run the full FBBS portal test suite and report results.

1. Run `npm test` from the repo root. This runs every regression suite wired into `package.json` (parser-regression, swap-math, swap-store, swap-candidates, report-store, strategy-summary, muni-tax, peer-group-store, store-smoke, sqlite-db, swap-render, rep-identity, bank-views, bond-accounting-store, log-rotation, mbs-cmo-store, cd-history, wirp-store, server-http). They run on plain `node` — no test framework.
2. If everything passes, report a one-line PASS with the suite count.
3. If anything fails, name the failing test file, show the relevant assertion output, and propose the smallest fix. Don't apply a fix without confirmation unless the failure is clearly caused by a change made in this session.

This suite is the trunk-protection gate for both Claude Code and Codex — keep `main` green. Codex runs the identical `npm test`; this command is the Claude Code wrapper over it.
