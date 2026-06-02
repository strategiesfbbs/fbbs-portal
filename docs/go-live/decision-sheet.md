# FBBS Portal — Go-Live Decision Sheet

> **One page. Fill the blanks, hand it back.** Every other go-live doc points here for
> the org-specific answers. Item #1 is the only one that blocks the *config*; the rest
> shape operations and policy. Print it, write on it, or fill it inline.

**Filled by:** ______________________  **Date:** __________

---

## A. Config & people (needed to turn it on)

| # | Decision | Answer | Feeds |
|---|----------|--------|-------|
| 1 | **`FBBS_ADMIN_USERS`** — Windows usernames allowed to publish & import. **Blank = nobody can publish (403).** | `________, ________, ________` | env / role matrix |
| 2 | **Daily Publisher** (primary) | ____________________ | runbook |
| 2b | **Backup Publisher** (must also be in #1) | ____________________ | runbook |
| 3 | **"Package ready by" time** (the deadline reps count on) | ________ (time zone: ____) | runbook |
| 4 | **Sales-notify channel** (how the desk hears "it's live") | ⬜ Email ⬜ Teams ⬜ Verbal ⬜ Other: ______ | runbook |

## B. Operations

| # | Decision | Answer | Feeds |
|---|----------|--------|-------|
| 5 | **Source-file owner per slot** — who to chase when a file is late | see grid below | runbook |
| 6 | **Non-daily import cadence** (bank call-report / account-status / peer / bond-accounting) | ⬜ Quarterly ⬜ Other: __________ | runbook |

**Item 5 grid** (fill the owner for any slot that has a regular sender):

| Slot | Source owner | | Slot | Source owner |
|---|---|---|---|---|
| Sales Dashboard | __________ | | Daily CD Offerings | __________ |
| Economic Update | __________ | | Muni Offerings | __________ |
| Relative Value | __________ | | Baird Syndicate | __________ |
| MMD Curve | __________ | | Agency Bullets/Callables | __________ |
| Treasury Notes | __________ | | Corporates | __________ |
| Brokered CD Sheet | __________ | | | |

## C. Policy (shapes who-can-do-what; defaults are fine for internal launch)

| # | Decision | Answer | Default if unanswered | Feeds |
|---|----------|--------|------------------------|-------|
| 7 | **Billing owner** — who works "Needs Billed" → invoiced? | ⬜ Same as Manager ⬜ Separate person: ______ | Manager/desk handles it (policy) | role matrix |
| 8 | **Swap send/execute** — who may send/execute a proposal? | ⬜ Any rep ⬜ Rep who owns the account ⬜ Manager/Trader only | Any authed rep (today's behavior) | role matrix |
| 9 | **Audit log / Admin tab** visibility | ⬜ All reps ⬜ Admins only | All authed reps (today's behavior) | role matrix |
| 10 | **Manager scope** — may managers *edit* reps' records? | ⬜ Edit ⬜ View only | View-by-policy; any rep can edit in code | role matrix |

---

### How answers flow into the system
- **#1** → set `FBBS_ADMIN_USERS=<answers>` on the IIS App Pool (comma-separated Windows short names). **This is the one config go-live blocker.**
- **#2–#6** → Claude updates the [runbook](go-live-runbook.md) and [training](training/) to replace the `‹CONFIRM›` placeholders with the real names/times.
- **#7–#10** → if any answer is stricter than today's "any authed rep," it becomes a Codex code-gate task (role-matrix §5 / readiness §8 🟢 backlog). If left at default, it stays policy + training for the internal launch.

> Nothing here is irreversible. #7–#10 can launch at the defaults and tighten later;
> only #1 must be set before the first publish.
