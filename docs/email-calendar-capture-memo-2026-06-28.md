# Decision Memo — Email/Calendar Capture After Salesforce (2026-06-28)

**The fork in the road from the SF decommission.** Salesforce's Einstein Activity
Capture auto-logs every rep's email + calendar (MS Exchange) onto records — it's
why SF has 16,838 Tasks and 9,050 Events with almost no manual entry. The portal
has **zero** capture: all activity is manually rep-logged
(`bank-coverage-store.js` `MANUAL_ACTIVITY_KINDS`). Cancelling SF removes the
auto-logging reps get "for free." This is the one genuine capability downgrade.

This is an **owner decision**, not a build I should pick unattended — each option
trades effort against the portal's deployment posture (2 npm deps, plain Node, no
outbound-email/cron infra, LAN/IIS, non-developer maintainer). Lay out below.

---

## Why it matters (and why it might not)

SF *captured* the data but reps never opened SF to see it — so the capture's value
was never realized in their workflow. The lesson isn't "rebuild Einstein"; it's
**surface activity context on the tear sheet reps already look at.** Whatever we
pick, the captured email/meeting has to land on the bank tear sheet, not in a
separate inbox nobody opens.

So the real question is narrower than "match Einstein": *how much auto-capture is
worth the integration cost, given reps will only benefit if it shows up on the
tear sheet?*

---

## Option A — Full Microsoft Graph / Exchange integration (true parity)

Poll each rep's Exchange mailbox + calendar via the Microsoft Graph API; match
messages/events to banks by contact email (the `bank_contacts` emails we already
import) and auto-create activity rows.

- **Pro:** real parity — email *and* calendar, fully automatic, zero rep effort.
- **Con:** the heaviest lift and the biggest posture change. Needs an Azure app
  registration, delegated/application OAuth, per-rep consent or an
  application-permission grant over mailboxes, token refresh, and a polling loop
  (the portal has no scheduler beyond the existing startup ticks — reuse that
  pattern). The Graph *HTTP calls* are dep-free (raw HTTPS, like
  `claude-client.js`), so the 2-dep rule survives — but the **auth + IT approval**
  is the real cost, and mailbox-wide access is a security-review item.
- **Effort:** high. **Gating:** owner + IT (mailbox access policy).

## Option B — Lightweight forward-to-log inbox (pragmatic middle) — recommended Phase 1

A shared mailbox reps **bcc/forward** client emails to. The portal already parses
`.eml` files (`server/email-source-utils.js`, the market-color/structured-notes
ingest) — reuse that: ingest each forwarded `.eml`, match `From`/`To` against
`bank_contacts` emails → create an `email` activity on that bank, dedup by
message-id.

- **Pro:** no per-rep OAuth, no mailbox-wide access, reuses existing `.eml`
  parsing, and it fits the behavioral lesson — reps forward the email *that
  matters* (an action they already half-do) instead of nothing being captured.
  Opt-in per message keeps noise/compliance low.
- **Con:** not fully automatic (reps must forward), and **no calendar capture.**
  Misses anything a rep forgets to forward.
- **Effort:** low–medium (an ingest watcher + contact-email match + an activity
  write — all patterns the portal already has).
- **Gating:** a shared mailbox + a way to drop `.eml` into a watched folder
  (the existing folder-drop machinery can carry it).

## Option C — Accept manual-only (status quo)

Do nothing; rely on the existing one-click Log Activity form.

- **Pro:** zero effort, zero new surface, cleanest posture.
- **Con:** the documented downgrade — and plausibly *why reps disengaged from SF
  in the first place* (logging felt like overhead). Manual-only risks the same
  fate for the portal's CRM.
- **Mitigation if chosen:** make manual logging frictionless (it already is — type
  pills + contact picker on the tear sheet) and lean on the auto *system* activity
  the portal already records (publishes, tasks, opportunities) so the timeline
  isn't empty even without email.

---

## Recommendation

**Phase 1: Option B.** It captures the high-value emails onto the tear sheet at low
cost and without a mailbox-access security review, and it respects the "reps won't
do extra clicks" lesson better than C. **Phase 2: revisit Option A** only if
adoption shows reps want full auto-capture and calendar — at which point the Graph
integration is justified and can go through IT with evidence. Avoid committing to
A's cost before knowing reps will use the output (the exact mistake SF made).

Whatever is chosen, wire the captured activity into the **existing tear-sheet
activity timeline** — not a separate inbox.

**Not deciding is also a decision:** ship the trade store + cut SF with Option C
implicitly, and you accept the capture loss. Worth a conscious call, not a default.
