# What Is NOT Client-Facing Yet

*Critical internal reminder. For Institutional Use Only. Read this before sharing anything.*

## The one rule
> **The portal is an internal, trusted-LAN tool. Nothing in it is approved for
> clients to see or use. Do not give clients access, screen-share it live, or send
> raw exports outside the firm without compliance sign-off.**

## Why this matters right now
- **No client-grade access control.** Login is by FBBS Windows identity on the
  internal network. There's no per-client permissioning, no external-login security
  review, no rate limiting. It is built for a trusted LAN, not the open internet.
- **It mixes internal-only data.** Tear sheets, coverage owners, account status
  (Prospect/Watchlist/Dormant), pipeline, billing, and rep notes are **internal
  commentary**. A client should never see how they're categorized or what's in the
  notes field.
- **Data is "as published," not certified.** Daily figures come from parsed source
  files and can carry parser warnings. Internally we sanity-check via Package QA;
  that's not the same as a client-certified statement.

## What you *can* share (the normal way)
- A **printed/PDF swap proposal one-pager** or portfolio review **after** the usual
  rep review — these are designed as client deliverables and render from a frozen
  snapshot. Share them the way you'd share any FBBS deliverable, not by giving portal
  access.
- Market commentary you'd already say on a call — sourced from your own judgment, not
  by forwarding internal screens.

## What you must NOT share
- Direct portal access or logins to anyone outside FBBS.
- Screens showing **account status, coverage owner, notes, pipeline, or billing**.
- Raw **CSV exports** of bank/coverage data.
- Another bank's data to a client (the portal shows the whole universe internally).

## If a client asks "can I get into your portal?"
Answer: *"It's our internal desk tool — what you'd get from it is the analysis and
proposals we prepare for you, and I can send those directly."* Then loop in your
manager/compliance if they want more.

## The boundary, in one line
**Internal workspace → produces client deliverables.** The *deliverables* go to
clients (through normal review). The *workspace* does not.

See [client-facing-boundary.md](../client-facing-boundary.md) for the longer-term
view of what could become client-facing and what never will.
