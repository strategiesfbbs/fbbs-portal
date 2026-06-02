# FBBS Portal — Role Matrix

> **Owner:** Claude (product/workflow lane) · **Pairs with:** Codex's auth/roles hardening
> **Status:** Draft for internal go-live · **Last updated:** 2026-06-02
> Items marked **‹CONFIRM›** need a decision from FBBS before this is final.

This document defines the roles we expect on the portal, maps each to what the
app actually does, and — most importantly — separates **what the portal enforces
in code today** from **what is currently honor-system** (policy only). The second
column is the work Codex is picking up in the auth/roles lane; this matrix is the
target it should converge to.

---

## 1. How to read this

The portal does **not** have five technical roles today. In code there are only
**two enforced tiers**:

1. **Authenticated rep** — anyone the server can identify (via Windows login in
   production, or the "Acting as" picker / `FBBS_DEFAULT_REP` on a laptop).
2. **Admin** — a rep whose username is in the `FBBS_ADMIN_USERS` allowlist.

The five business roles below (Sales Rep, Sales Manager, Trader/Admin,
Ops/Billing, System Admin) are how the **organization** thinks about access. For
internal go-live they collapse onto those two enforced tiers plus **policy/training**
("you can technically do X, but the runbook says don't"). That is acceptable for a
trusted-LAN internal launch and is called out honestly throughout. Where a role
boundary is *policy only* today, the matrix marks it **⚠︎ policy**.

Legend used in the matrix:

| Mark | Meaning |
|------|---------|
| ✅ | Allowed, and appropriate for this role |
| 👁 | Read/view only |
| ⚠︎ policy | Technically possible for any authenticated rep today — boundary is enforced by training/runbook, **not** code |
| 🔒 gap | *Should* be restricted to this role but is **not enforced** today — flagged for Codex |
| ➖ | Not applicable / not used by this role |

---

## 2. The five roles

| Role | Who this is at FBBS | Primary job on the portal |
|------|---------------------|----------------------------|
| **Sales Rep** | Coverage reps working their book of banks | Daily intelligence, bank search, tear sheets, strategy requests, notes/follow-ups, build swap proposals for their accounts |
| **Sales Manager** | Desk/sales lead overseeing reps | Everything a rep does **across all reps' books** — pipeline review, Needs Billed oversight, stale follow-ups, strategy queue triage |
| **Trader/Admin (Publisher)** | Trader/ops person who publishes the daily package | Publish the daily document package, run Package QA, import bank/market workbooks |
| **Ops/Billing** | Person who invoices completed strategy work | Work the billing queue ("Needs Billed" → invoiced), confirm completion history |
| **System Admin (IT)** | IT / deployment owner | Server config, IIS/Windows auth, env vars, `DATA_DIR`, backups, audit-log review, admin allowlist membership |

> **‹CONFIRM›** — Are Ops/Billing and Sales Manager **distinct people**, or do
> reps self-bill and the desk lead also bills? This changes whether the
> billing-queue boundary is worth enforcing in code or stays policy. Default
> assumption below: Manager and Ops/Billing exist as roles but may be the same
> 1–2 people at launch.

---

## 3. What the portal enforces TODAY (the honest baseline)

These are facts from the code (`server/server.js`, `server/rep-identity.js`), not
aspirations.

### 3.0 Production configuration (LOCKED by Codex, 2026-06-02)
The production deployment is committed to these three switches. The rest of this
section explains what each one *does*; treat them as decided, not optional:

```ini
FBBS_AUTH_MODE=iis                 ; Windows-login identity; forces auth; "Acting as" OFF
FBBS_ADMIN_USERS=<approved upload/import users>   ; the Publisher/Backup + import-runners
DATA_DIR=D:\FBBSPortalData         ; all data (current, archive, SQLite, audit.log) lives here
```

**What flips on automatically with `FBBS_AUTH_MODE=iis`:**
- `REQUIRE_AUTH` → on: every `/api/*` except `/api/health` returns **401** without a
  resolved Windows user. There are no anonymous reps in production.
- `ALLOW_REP_OVERRIDE` → **off**: the "Acting as" picker is disabled. A rep **is** their
  Windows login and cannot switch identity. (UI should hide the dead control — Codex.)
- `ALLOW_DEFAULT_REP` → off: `FBBS_DEFAULT_REP` is ignored (that's a laptop-only convenience).

`FBBS_ADMIN_USERS` **is** the role boundary in production: it's the allowlist of
"approved upload/import users" — i.e. whoever is permitted to publish the daily package
and run the bank/account-status/peer/bond-accounting/MBS/WIRP imports. Everyone else is
a normal authenticated rep. The actual usernames are the one remaining ‹CONFIRM› (Windows
short names — see §7).

`DATA_DIR=D:\FBBSPortalData` means the archive, current package, all SQLite stores, and
`audit.log` live at `D:\FBBSPortalData\…` — relevant for backups and for the runbook's
rollback step.

### 3.1 Identity resolution (`server/rep-identity.js`, `server/server.js:401`)
The server figures out "who you are" in this precedence order:

1. **`fbbs_rep_override` cookie** — the "Acting as" picker. **Local/laptop only.**
   Disabled automatically in production (see `ALLOW_REP_OVERRIDE` below).
2. **IIS Windows login** — `LOGON_USER` forwarded by iisnode
   (`x-iisnode-logon_user`); domain prefix stripped. **This is the production identity.**
3. **`FBBS_DEFAULT_REP` env var** — shared-workstation fallback. Local only.
4. **None** — request is anonymous.

### 3.2 Auth modes (`server/server.js:186–194`)

| Env var | Effect |
|---------|--------|
| `FBBS_AUTH_MODE` | `local` (default) vs `iis` / `windows` / `production`. The latter set turns on "IIS auth mode." |
| `FBBS_REQUIRE_AUTH=1` | Force login required even outside IIS. (Auto-on in IIS mode.) When on, **every `/api/*` except `/api/health` returns 401 without an identified rep.** |
| `FBBS_ALLOW_REP_OVERRIDE` | The "Acting as" picker. **Off automatically in IIS mode.** On a laptop, set `=0` to also disable it. |
| `FBBS_ADMIN_USERS` | Comma/space/semicolon list of usernames that are admins (normalized, domain-stripped). |

### 3.3 The only code-enforced role boundary today: **Admin-gated ingest** (`server/server.js:427–452`)

When IIS auth mode is on **or** an admin allowlist is configured, these **8 routes
require an admin** (401 if not logged in, 403 if logged in but not on the allowlist):

```
POST /api/upload                              (publish daily package)
POST /api/folder-drop/publish                 (publish from the drop folder)
POST /api/mbs-cmo/upload                       (MBS/CMO source upload)
POST /api/banks/upload                         (300 MB bank call-report workbook)
POST /api/bank-account-statuses/upload         (account-status workbook)
POST /api/banks/averaged-series/upload         (peer-group workbook)
POST /api/banks/bond-accounting/upload         (bond-accounting folder)
POST /api/brokered-cd/wirp/upload              (WIRP CD source)
```

> **Important:** Production runs in IIS mode (§3.0), so if `FBBS_ADMIN_USERS` is
> **empty** these routes return `403 "Admin allowlist is not configured."` — **nobody
> can publish or import until the allowlist is set.** That's why populating
> `FBBS_ADMIN_USERS=<approved upload/import users>` is the one config go-live blocker.
> (For reference, in non-IIS *local* mode an empty allowlist leaves these routes open
> to anyone — which is why the pilot box in §6 also sets it.)

### 3.4 Everything else is open to any authenticated rep
There is **no** code boundary today between Sales Rep / Sales Manager / Ops/Billing
for the rest of the API. Any identified rep can:

- Create / edit / **delete** strategy requests and reports (`/api/strategies`, `/api/reports`)
- Add / remove bank coverage, notes, contacts, product-fit flags (`/api/bank-coverage/*`)
- Create, send, execute, cancel swap proposals (`/api/swap-proposals/*`)
- Enqueue and update the billing queue (`/api/billing-queue`)
- Create / edit / archive peer groups (`/api/peer-groups`)
- Import single account-status rows (`/api/bank-account-status`)
- Change their own "Acting as" identity when the override is enabled (`/api/me/override`)

A cross-site-write guard (same-origin check) protects all mutating `/api/*`
routes, but that is CSRF protection, **not** a role boundary.

### 3.5 "My Work" is scoping, not security
The Home page "My Work" (clients / prospects / open strategies / overdue
follow-ups) is filtered to the current rep by matching the bank **owner string**
(`server/rep-identity.js` `ownerStringContainsRep`). This is a *convenience view*,
not an access control — a rep can still search and open any bank.

---

## 4. Target permission matrix

Rows are capabilities (grouped by portal area). Columns are the five roles.
The **"Enforced today?"** column is the honest status. Aim: at internal go-live,
the ✅/👁 pattern below is achieved by **code** for the Admin/ingest boundary and
by **policy + training** for the rest, with the 🔒 gaps tracked for Codex.

### 4.1 Daily package & market intelligence (read)

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| View Daily Intelligence, Explorers, Recap, Market Color, MMD, Relative Value | ✅ | ✅ | ✅ | 👁 | 👁 | Open to all authed reps |
| Open the Archive (prior packages) | ✅ | ✅ | ✅ | 👁 | 👁 | Open to all authed reps |

### 4.2 Daily package & data ingest (write) — **the admin boundary**

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| Publish daily package (`/api/upload`, folder-drop) | ➖ | ⚠︎ policy | ✅ | ➖ | ✅ | **Code-enforced (admin allowlist)** |
| Import bank call-report workbook (300 MB) | ➖ | ➖ | ✅ | ➖ | ✅ | **Code-enforced (admin)** |
| Import account-status / peer / bond-accounting / MBS / WIRP | ➖ | ➖ | ✅ | ➖ | ✅ | **Code-enforced (admin)** |
| Run Package QA review | 👁 | 👁 | ✅ | 👁 | 👁 | Read endpoint, open to all |

> Manager marked **⚠︎ policy** on publish: a manager *could* be added to the
> admin allowlist as a backup publisher — that's a membership decision, not a
> separate code path.

### 4.3 Banks, coverage, notes

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| Search banks, open tear sheets | ✅ | ✅ | ✅ | ✅ | 👁 | Open to all authed reps |
| Add/edit coverage, notes, contacts, product-fit (own banks) | ✅ | ✅ | ✅ | ⚠︎ policy | ➖ | ⚠︎ no per-rep ownership check — 🔒 gap |
| Edit/delete **another rep's** coverage/notes | ⚠︎ policy | ✅ | ✅ | ⚠︎ policy | ➖ | 🔒 gap — any rep can today |
| Save & share Saved Views | ✅ | ✅ | ✅ | 👁 | ➖ | Open to all authed reps |
| Create/edit/archive Peer Groups | ⚠︎ policy | ✅ | ✅ | ➖ | ➖ | 🔒 gap — any rep can today |

### 4.4 Strategies queue & swap proposals

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| Create a strategy request (from tear sheet or queue) | ✅ | ✅ | ✅ | ⚠︎ policy | ➖ | Open to all authed reps |
| Update status (Open→In Progress→Completed→Needs Billed) | ✅ | ✅ | ✅ | ⚠︎ policy | ➖ | Open to all authed reps |
| **Delete** a strategy request | ⚠︎ policy | ✅ | ✅ | ➖ | ➖ | 🔒 gap — hard delete open to any rep |
| Archive a completed/billed strategy | ✅ | ✅ | ✅ | ✅ | ➖ | Open to all authed reps |
| Build / edit a swap proposal (draft) | ✅ | ✅ | ✅ | ➖ | ➖ | Open to all authed reps |
| **Send / Execute** a swap proposal | ✅ | ✅ | ✅ | ➖ | ➖ | Open to all authed reps — confirm desk policy |

> **‹CONFIRM›** — Should *sending/executing* a swap proposal be limited (e.g. to
> the rep who owns the account, or require a manager/trader)? Today any authed rep
> can. This is a policy call with a possible code follow-up for Codex.

### 4.5 Billing queue

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| See items auto-enqueued when a strategy hits "Needs Billed" | 👁 | ✅ | 👁 | ✅ | ➖ | Open to all authed reps |
| Mark a billing item invoiced / update its state | ⚠︎ policy | ✅ | ⚠︎ policy | ✅ | ➖ | 🔒 gap — any rep can today |

### 4.6 System & audit

| Capability | Sales Rep | Manager | Trader/Admin | Ops/Billing | SysAdmin | Enforced today? |
|---|---|---|---|---|---|---|
| View Admin / audit log (`/api/audit-log`) | ➖ | 👁 | 👁 | ➖ | ✅ | Open to all authed reps — 🔒 consider gating |
| Change "Acting as" identity | ✅ (local only) | ✅ (local) | ✅ (local) | ✅ (local) | ✅ | **Code-enforced off in IIS** |
| Set env / IIS auth / admin allowlist / backups | ➖ | ➖ | ➖ | ➖ | ✅ | OS/server level — outside the app |

---

## 5. Gaps for Codex (auth/roles lane)

In rough priority order for *internal* go-live. None of these block a trusted-LAN
launch, but they're the difference between "trusted LAN" and "least privilege."

1. **Blocker (config, not code):** Set `FBBS_ADMIN_USERS` and `FBBS_AUTH_MODE=iis`
   in production. Without the allowlist, ingest routes are either wide open (local
   mode) or fully locked (IIS mode). → Codex's deployment checklist.
2. **Lock down "Acting as" in production.** Already automatic in IIS mode
   (`ALLOW_REP_OVERRIDE` off). Verify the picker is hidden/disabled in the UI when
   `auth.allowRepOverride === false` so reps don't see a dead control.
3. **Audit-log visibility.** `/api/audit-log` and the Admin tab are open to any
   authed rep today. Decide if that's fine internally or should be admin-only.
4. **Manager-vs-rep scope (policy → optional code).** Editing/deleting *another
   rep's* coverage, notes, strategies, billing items is unrestricted. For internal
   launch this can stay policy; later, add an owner check or a "manager" tier.
5. **Hard-delete routes** (`DELETE /api/strategies/:id`, `/api/reports/:id`,
   coverage deletes) are open to any rep. Consider soft-delete or manager-gating.

> These map directly onto Codex's "Add/prepare role gates for admin/upload/report/billing
> tools" and "Identify which actions must become admin-only" items. This matrix is
> the spec for that work.

---

## 6. Go-live config

### Production (DECIDED — Codex, 2026-06-02)
```ini
FBBS_AUTH_MODE=iis                 ; Windows-login identity; forces auth; "Acting as" OFF
FBBS_ADMIN_USERS=<approved upload/import users>   ; ‹CONFIRM› the real Windows short names,
                                   ;   comma-separated (Publisher + Backup + import-runners)
DATA_DIR=D:\FBBSPortalData         ; all data lives under D:\FBBSPortalData\…
MAX_UPLOAD_MB=50
BANK_UPLOAD_MAX_MB=300
```
The only blank left is the **usernames** for `FBBS_ADMIN_USERS`. The three switches
themselves are locked.

### Laptop / pilot workstation (no IIS) — for the dry run before the IIS box is wired up
```ini
FBBS_AUTH_MODE=local
FBBS_DEFAULT_REP=Mike Jones     ; who this shared box acts as
FBBS_ALLOW_REP_OVERRIDE=1       ; keep the picker so testers can switch reps
FBBS_ADMIN_USERS=mjones         ; still set this so ingest routes are gated in the pilot
DATA_DIR=D:\FBBSPortalData       ; point at the same prod data dir only if intentional
```

> The pilot config exists only to rehearse publish/QA before IIS is live. The moment
> the IIS box is the real server, the production block above is authoritative.

---

## 7. Open questions to confirm with FBBS

1. **The actual usernames for `FBBS_ADMIN_USERS`** — the "approved upload/import users":
   the daily Publisher + Backup, plus anyone who runs the quarterly bank/account-status/
   peer/bond-accounting imports. (Windows short names, comma-separated.) *This is the
   last blank in the production config — §6.*
2. Is **Ops/Billing** a separate person from the Sales Manager? → billing-queue gating decision.
3. Should **swap send/execute** be restricted (rep-owns-account, or manager/trader only)?
4. Should the **audit log / Admin tab** be admin-only, or visible to all reps internally?
5. Are managers expected to **edit reps' records**, or only view them? → manager tier scope.
