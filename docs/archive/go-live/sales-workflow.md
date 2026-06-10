# FBBS Portal — Sales Team Workflow Map

> **Owner:** Claude (product/workflow lane) · **Status:** Draft for internal go-live · **Last updated:** 2026-06-02
> Describes how reps and managers actually move through the portal day to day. Every
> step references a real tab so this doubles as a navigation cheat-sheet. Tabs live
> under the left nav: **FBBS · Offerings · CDs · Banks · Map · Strategies · Operations.**

This is the "what does a normal day look like" companion to the
[role matrix](role-matrix.md). It's written so a new rep can follow it on day one
and a manager can use it as the basis for coaching and pipeline reviews.

---

## 1. The rep's daily loop (the core path the portal is built around)

```
  Open portal ─► Daily Intelligence ─► review rule picks ─► search a bank
       ▲                                                          │
       │                                                          ▼
  add note / set follow-up ◄─ create / update strategy ◄─ open tear sheet
```

### Step 1 — Start on **Home** ("Today on the desk")
- **Home** shows a market snapshot + **My Work**: *your* clients, prospects, open
  strategy requests, and overdue follow-ups (scoped to you by coverage owner).
- This is the rep's launchpad. If My Work shows overdue follow-ups, start there.
- *Note:* My Work is a convenience filter, not a lock — you can still open any bank.

### Step 2 — Read **Daily Intelligence** (FBBS section)
- Auto-generated market snapshot + **rule-based trading picks** built from today's
  published package (CD offers, munis, agencies, corporates, treasuries).
- Skim the picks for ideas that fit accounts you cover. Supporting detail lives in:
  - **Economic Update** — rates, futures, headlines, calendar (from the daily PDF)
  - **Relative Value** / **MMD Curve** — curve snapshot + talking points for client calls
  - **Market Color** — the morning trader emails

### Step 3 — Drill into the right **Offerings** explorer
Pick the explorer that matches the opportunity, filter, and note CUSIPs of interest:
- **CD Explorer** / **Weekly CD Recap** / **Brokered CD Rate Sheet** (funding & CD ideas)
- **Muni Explorer**, **Agency Explorer**, **Corporate Explorer**, **Treasury Explorer**
- **MBS/CMO Explorer**, **Structured Notes**
- Each explorer filters, sorts, and exports CSV (the CSV filename includes the package date).

### Step 4 — Search the bank (**Banks → Bank Tear Sheets**)
- Search by **name / city / FDIC cert / parent**.
- The tear sheet shows the call-report summary, **account status** (Open / Prospect /
  Client / Watchlist / Dormant), coverage owner, notes, contacts, product-fit flags,
  bond-accounting holdings, and any peer comparison.
- This is the single "bank record" the portal is replacing Salesforce accounts with.

### Step 5 — Act: **create or update a strategy request**
From the tear sheet, click **Open Strategy Request** (or work it from **Strategies → Queue**):
- **Type:** Bond Swap · Muni BCIS · THO Report · CECL Analysis · Miscellaneous
- **Status:** Open → In Progress → Completed → **Needs Billed**
- **Priority:** 1–5 · **Requested By** prefills to you · **Assigned To** defaults to "Strategies"
- Attach files (PDF / Excel / Word / CSV), add a summary and comments.
- For a swap, jump to **Strategies → Bond Swap** to build the multi-leg proposal,
  size buys, and produce the client one-pager (draft → send → execute).

### Step 6 — Record the touch: **note + follow-up**
- Back on the tear sheet, add a **note** and a **next action / follow-up** so the
  bank shows up correctly in My Work and in the manager's stale-follow-up view.
- Status changes, notes, uploads, and completed tasks all land on the bank's
  **activity timeline**.

> **Rep rule of thumb:** every meaningful interaction ends with *either* a strategy
> request, a note, or a follow-up date. That's what keeps the pipeline and the
> manager views honest — it's the discipline that replaces Salesforce task entry.

---

## 2. The manager's loop (oversight, not data entry)

A manager does everything a rep does, but **across all reps' books**. The portal
surfaces the same data; the manager just reads it at the team level.

| What the manager checks | Where in the portal | What they're looking for |
|---|---|---|
| **Team pipeline** | Strategies → Queue (filter by type/status), Saved Views | Open & In-Progress work by rep; nothing stuck |
| **Needs Billed** | Strategies → Queue (status = Needs Billed) → Billing queue | Completed analysis that hasn't been invoiced yet |
| **Stale follow-ups** | Saved Views / per-rep coverage; Home "overdue" pattern | Banks with overdue next actions, prospects gone cold |
| **Coverage gaps** | Map, Saved Views, Peer Groups | Territory/status coverage; unassigned or thin coverage |
| **Recently touched** | Bank activity timelines | Whether reps are actually working their books |

Manager cadence (suggested — **‹CONFIRM›** with the desk lead):
- **Daily:** glance at Needs Billed and any priority-1 strategy requests.
- **Weekly:** full pipeline review by rep; clear stale follow-ups; confirm Weekly CD Recap.
- **Monthly:** coverage/territory review via Map + Saved Views.

> **Today's caveat (see role matrix §3.4):** the portal does **not** yet enforce
> "manager edits, rep can't." Any authed rep can technically edit any record. For
> internal launch this is managed by **training + the runbook**, not code. Codex's
> lane tracks the optional code gate.

---

## 3. The strategy lifecycle (shared language for reps + managers + billing)

```
   Open ──► In Progress ──► Completed ──► Needs Billed ──► (archived, billed)
                                              │
                                              ▼
                                   auto-enqueued to Billing queue
```

- **Open** — request logged, not started.
- **In Progress** — analyst/desk is working it.
- **Completed** — analysis done, deliverable produced.
- **Needs Billed** — triggers an automatic entry in the **Billing queue** so finished
  work doesn't disappear before it's invoiced. (This is the Salesforce "Needs Billed"
  board, now native.)
- **Archived** — completed/billed requests can be archived without losing the bank's
  history; they drop off the active queue but stay on the bank's timeline.

**Hand-off points:**
- Rep → Desk/Analyst: at **Open** (assigned to "Strategies").
- Desk → Ops/Billing: at **Needs Billed** (auto-enqueue).
- Ops/Billing → done: mark the billing item invoiced.

---

## 4. Bond swap proposal sub-flow (reps building client one-pagers)

For Bond Swap work specifically, **Strategies → Bond Swap**:

1. Pick a bank that has **bond-accounting holdings** (eligible-banks picker).
2. Review **suggested swaps** (the desk's hard rule auto-applies: a held bond can't
   mature before the swap's breakeven). Soft warnings are advisory only.
3. Or **build your own** by entering CUSIPs from holdings + today's inventory.
4. Use **Size** on a buy leg to balance proceeds (cash-neutral solver — advisory).
5. **Draft → Send** freezes the proposal into an immutable snapshot (the printed
   one-pager renders from that snapshot, so it never drifts as the market moves).
6. **Execute** marks it done and syncs the linked strategy request to Completed.

This replaces the manual `Master Swap Template v4.6.xlsx` workflow.

---

## 5. Quick "where do I go for…" index

| I want to… | Tab |
|---|---|
| See today's market & trade ideas | FBBS → **Daily Intelligence** |
| Look at rates / curve / talking points | FBBS → **Economic Update**, **Relative Value**, **MMD Curve** |
| Find CD / muni / agency / corp / MBS offerings | **Offerings → …Explorer** |
| Look up a bank | **Banks → Bank Tear Sheets** |
| See my book of clients/prospects | **Home** (My Work), **Banks → Saved Views** |
| Start analysis / log a request | tear sheet → **Open Strategy Request**, or **Strategies → Queue** |
| Build a client swap one-pager | **Strategies → Bond Swap** |
| Check what's waiting to be billed | **Strategies → Queue** (Needs Billed) / Billing queue |
| See coverage on a map | **Map** |
| Open a prior day's package | **Operations → Archive** |

---

## 6. Open questions to confirm with FBBS

1. Manager review cadence (daily/weekly/monthly) — is the suggested rhythm right?
2. Who owns "stale follow-up" cleanup — the rep, or the manager nudging the rep?
3. At launch, do reps build swap proposals themselves, or does the desk/trader?
4. Is "Assigned To = Strategies" the right default, or should it route to a named analyst?
