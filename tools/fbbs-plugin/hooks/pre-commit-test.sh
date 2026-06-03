#!/bin/bash
# FBBS portal trunk guard.
# Fires on PreToolUse(Bash). Acts ONLY when the Bash command is a `git commit`
# AND the current branch is `main`: runs `npm test` and blocks the commit
# (exit 2) if the suite fails. Any other Bash command passes straight through.
#
# Matches the dual-agent rule in CLAUDE.md: keep `main` green. This guard runs
# in Claude Code only; Codex must run `npm test` itself before committing.
set -uo pipefail

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
else
  cmd=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

# Only intercept git commit invocations.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[ "$branch" = "main" ] || exit 0

echo "FBBS trunk guard: running npm test before committing to main..." >&2
logfile="${TMPDIR:-/tmp}/fbbs-pretest.log"
if npm test >"$logfile" 2>&1; then
  echo "FBBS trunk guard: tests passed; allowing commit." >&2
  exit 0
fi

echo "FBBS trunk guard: npm test FAILED — commit blocked. Last 30 lines:" >&2
tail -n 30 "$logfile" >&2
exit 2
