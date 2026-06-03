---
description: Search the shared mailbox for trader offering/update emails (intraday remaining-qty roadmap; read-only triage).
argument-hint: "[search terms or date range]"
allowed-tools: Read
---
Triage trader emails from the connected Gmail mailbox for the daily-package / intraday-update workflow.

This supports the daily-upload-automation roadmap item (scrape trader emails for remaining-quantity updates). It is **read-only triage** today — automated ingestion into the portal is deferred until the IIS/Windows-auth deployment story lands (see `docs/company-portal-context.md` → "Replacement Boundaries": don't add email capture until the auth posture is settled).

1. Use the Gmail MCP tools (`search_threads` / `get_thread`) to find recent trader/offering emails. Default to the last 2 days unless $ARGUMENTS narrows it.
2. For each, summarize: sender, security/CUSIP if present, offering or remaining-quantity signal, and timestamp.
3. Output a compact table the operator can act on.

Do NOT modify the mailbox or any portal data. Do NOT copy settlement instructions, account numbers, or private contact details into the repo.
