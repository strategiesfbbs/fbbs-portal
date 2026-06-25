# Salesforce Export Integration — Spec & Parser Contract (2026-06-24)

**Status:** active build. **Authoritative for the Foundation + Contacts slice.**
**Owners (agreed split):**
- **Claude** — Foundation (`server/salesforce-import.js` pure module + `scripts/import-salesforce-export.js` CLI), Account/Contact/Rep profiling + cert-based matching, contact import into `bank_contacts`, owner/status backfill **proposal + dry-run**, parser/contact tests, this spec.
- **Codex** — Pershing/trade vertical (trade-recency store, active/dormant-client signal, trade UI, `bank-signals.js` changes, dormant-client reports). **Starts after this spec + the `server/salesforce-import.js` parser contract land.** Builds against the pure account index + rep resolver defined here.

Source data is staged (gitignored) at `data/salesforce-export/2026-06-24/raw/`; deep per-file profiles at `data/salesforce-export/2026-06-24/analysis/`.

---

## 1. The five files

| File | Rows (live) | What it is | Primary keys |
|---|---|---|---|
| `…ACCOUNT EXTRACT.csv` | 31,028 (≈240 cols) | Every SF account: **17,920 RIA · 9,200 BANK-CREDIT UNION · 3,868 GENERAL** | `Account_Id_18__c` (= `Id`), `Cert_Number__c`, `RecordTypeId`, `OwnerId`, `Status__c` |
| `…CONTACT EXTRACT.csv` | 2,110 (102 cols) | People at those accounts | `Id` (003…), `AccountId` (→ account), `OwnerId` |
| `…PERSHING EXTRACT.csv` | 2,351 | Brokerage trade-accounts + last-trade date (**Codex's vertical**) | `Account__c` (→ account), `Name` (Pershing acct #), `Most_Recent_Trade_Date__c` |
| `…REP EXTRACT.csv` | 36 | SF users → the OwnerId crosswalk | `User ID` (15-char), name, alias, active |
| `RECORD TYPES.csv` | 3 | `RecordTypeId` → GENERAL / RIA / BANK-CREDIT UNION | — |

**Record-type IDs:** `012Hs000000CFaFIAW`=GENERAL, `012Hs000000CFaKIAW`=RIA, `012Hs000000CFaPIAW`=BANK-CREDIT UNION.

---

## 2. The join graph (the spine)

```
Contact.AccountId ──► Account.Account_Id_18__c ──► Account.Cert_Number__c ──► banks.cert_number ──► banks.id (= portal bankId / SNL key)
Account.OwnerId / Contact.OwnerId ──(15-char prefix)──► REP.User ID ──► rep display name
Account.RecordTypeId ──► RECORD TYPES ──► GENERAL | RIA | BANK-CREDIT UNION
Pershing.Account__c ──► Account ──► cert ──► bank        (Codex)
```

**Exact mechanics (must be honored by every consumer):**
- **bankId ≠ cert.** Portal banks key on `banks.id` (SNL Institution Key). `banks.cert_number` is an indexed column. Resolver = `listBankSummaries(BANK_REPORTS_DIR)` (`server/bank-data-importer.js:635`, already exported) → build `cert → bankId` and `normalizedName → bankId`.
- **Cert normalization** (both sides) — strip commas, and for a pure-numeric value with trailing `.0`, take the integer string. Mirrors the portal's `normalizeCert` (`bank-account-status-store.js:86`). `"12,345.0"` → `"12345"`.
- **OwnerId 15-char prefix join.** SF IDs in the data carry a 3-char suffix (`005Vz000000RAo9IAG`); the REP file's `User ID` is 15-char (`005Vz000000RAo9`). Join on the 15-char prefix. All 18 contact owners + all account owners resolve this way.
- **Encoding:** the ACCOUNT export contains non-UTF-8 bytes (e.g. `0xae`/`®`). Decode UTF-8 with replacement (`errors='replace'` / latin-1 fallback). Never assume clean UTF-8.
- **Row count caveat:** `wc -l` over-counts (embedded newlines in address/description fields). Always parse with a real CSV reader; live contact count is **2,110**, not the 2,185 line count.

---

## 3. Feasibility verdict (deterministic, recomputed from the raw files)

**Contact → portal bank funnel:**

| Stage | Count | % of live |
|---|---:|---:|
| Live contacts | 2,110 | 100% |
| Have `AccountId` (resolves to an account) | 2,105 | 99.8% |
| Account carries a cert | 1,789 | 84.8% |
| **Cert exists in portal `banks` (AUTO-LINK)** | **1,760** | **83.4%** |
| — of *bank-type* contacts (1,793), auto-link rate | 1,760 | **98.2%** |

**Contacts by account type:** BANK-CREDIT UNION 1,793 · RIA 214 · GENERAL 98 · orphan 5.

**Verdict — cert-join is the strategy; name fallback is a thin safety net.**
- The cert path captures **98% of bank contacts**. Name fallback (`normalizeBankNameForMatch`, already in server.js) only needs to recover ~33 bank contacts whose cert is missing or not in the portal.
- The **214 RIA + 98 GENERAL contacts have no cert and no bank to attach to** — they are out of scope for `bank_contacts` (see §7 RIA decision). They land in the import's `unmatched` bucket, not lost.

**Cert overlap context (why not 100%):** SF has 9,196 cert-bearing bank/CU accounts; only **4,658 (50.7%)** of those certs exist in the portal `banks` table (5,571 distinct certs). The ~4,538 misses are overwhelmingly **credit unions** (NCUA charters, not in the FDIC-derived portal DB) and small banks outside the FedFis workbook. This does **not** hurt the contact import — FBBS's actual contacts cluster on covered banks (hence 98%). It *does* mean RIAs/CUs would need their own entity store to ever hold contacts.

---

## 4. Foundation — `server/salesforce-import.js` (pure, I/O-free, the parser contract)

No fs, no DB, no network — takes already-parsed CSV row arrays, returns plain objects. Fully unit-testable. **This is the contract Codex's Pershing vertical builds against** (it reuses `buildAccountIndex` + `buildRepResolver`).

```js
module.exports = {
  RECORD_TYPE_BY_ID,                  // { '012Hs…CFaPIAW': 'BANK-CREDIT UNION', … }
  normalizeCert(value) -> string,     // matches portal normalizeCert

  // OwnerId → rep, via 15-char prefix. repRows = parsed REP EXTRACT.
  buildRepResolver(repRows) -> (ownerId) => { userId, name, username, alias, active } | null,

  // accountRows = parsed ACCOUNT EXTRACT. Returns the shared index both verticals use.
  buildAccountIndex(accountRows) -> {
    byId: Map<accountId18, {
      id, cert, type,            // type ∈ GENERAL|RIA|BANK-CREDIT UNION
      name, state, ownerId,
      status, subchapterS, inactive
    }>,
    byCert: Map<cert, accountId18[]>
  },

  // contactRows = parsed CONTACT EXTRACT. Normalized, junk-stripped, owner-resolved.
  parseContacts(contactRows, { repResolver }) -> Array<{
    sfId, accountId, name, firstName, lastName,
    title, role, decisionMaker,      // role/decisionMaker from classifyTitle
    email, phone, mobile,
    ownerId, ownerName,
    doNotCall, optOutEmail, emailBounced,   // compliance — carried even when all-false today
    junk                              // true for @fbbsinc.com/@mibanc.com/@salesforce.com/@topsisconsulting.com & nameless rows
  }>,

  classifyTitle(title) -> { role, decisionMaker:boolean, category },
    // category ∈ ceo|president|cfo|coo|investment|cashier|treasurer|controller|lending|chair|other
    // substring/regex, NOT exact match (titles are free-text: President/CEO appears 6+ ways).

  // Resolve one contact to a portal bank. certToBankId/nameToBankId supplied by the CLI from listBankSummaries.
  matchContactToBank(contact, { accountIndex, certToBankId, nameToBankId }) ->
    { bankId|null, via:'cert'|'name'|null, accountType, reason },

  // Build the full import plan (no writes). existingKeys = Set of `${bankId}|e|${email}` / `${bankId}|n|${name}`.
  buildContactImportPlan(contacts, { accountIndex, certToBankId, nameToBankId, existingKeys }) -> {
    create:   [{ bankId, contact, via }],
    duplicate:[{ bankId, contact, key }],
    unmatched:[{ contact, reason }],     // RIA/GENERAL/no-cert/orphan
    stats: { total, create, duplicate, unmatched, viaCert, viaName, byReason }
  },

  // Proposals (read-only — see §6). Derive bank owner from CONTACT owners, not account owner.
  buildOwnerBackfillPlan({ accountIndex, contactsByBankId, certToBankId, currentOwners }) ->
    { proposals:[{ bankId, suggestedOwner, basis, currentOwner }], stats },
  buildStatusBackfillPlan({ accountIndex, certToBankId, currentStatuses }) ->
    { proposals:[{ bankId, suggestedStatus, sfStatus, currentStatus }], stats },
}
```

CSV parsing itself stays in the CLI (reuse the portal's `parseCsvText` or Node's stream + a tolerant decode); the module receives row-objects so it never touches the filesystem.

---

## 5. CLI — `scripts/import-salesforce-export.js`

The I/O shell around the pure module. **Default = dry-run.** Reuses existing store/importer functions; **edits no store or UI file.**

```
node scripts/import-salesforce-export.js [--dir <export dir>] [--apply] \
     [--contacts] [--owner-proposal] [--status-proposal] [--out <json>]
```
- Reads the 5 CSVs (tolerant decode) → `parseCsvText`.
- Builds `certToBankId` + `nameToBankId` from `listBankSummaries(BANK_REPORTS_DIR)`; builds `existingKeys` from `listAllContacts(BANK_REPORTS_DIR)`.
- Calls the pure module → prints a funnel summary (matches §3 table) + samples of each bucket.
- `--apply --contacts` → writes via the **existing** `createBankContact(BANK_REPORTS_DIR, summary, {...})` (`bank-coverage-store.js:720`); dedup on `bankId+email` / `bankId+name`; stamps `notes = "Salesforce <sfId> · imported 2026-06-24"` for traceability + soft idempotency.
- `--owner-proposal` / `--status-proposal` → **print the proposal + dry-run only** (no writes this slice; see §6). `--apply` on these is intentionally gated/no-op pending owner sign-off.
- `--out` writes the full machine-readable plan JSON to `data/salesforce-export/2026-06-24/analysis/` for review.

---

## 6. Target-surface mapping

| SF data | Portal target | Action |
|---|---|---|
| Contact name/first/last | `bank_contacts.name` | import |
| Contact `Title` | `bank_contacts.role` (+ `decisionMaker` derived) | import; classify, don't store junk |
| Contact `Email` | `bank_contacts.email` | import; strip 31 junk addresses |
| Contact `Phone` / `MobilePhone` | `bank_contacts.phone` (mobile if no phone) | import |
| Contact `OwnerId` | (owner backfill basis) | drives §owner proposal |
| Compliance (`DoNotCall`/`HasOptedOutOfEmail`/`IsEmailBounced`) | — (no column yet) | **all-false today**; see open decision #5 |
| `Account.Cert_Number__c` | join key → bankId | match only |
| `Account.Status__c` (505 Client / 716 Prospect) | `bank_account_statuses.status` | **proposal/dry-run** (don't override saved coverage) |
| Owner of the bank | `bank_coverage.owner` | **proposal/dry-run**, from **contact** owners, blank-only |
| `Account.Subchapter_S_Election__c` | (already on tear sheet from workbook) | redundant — skip |
| **All call-report financials / securities holdings** (≈200 cols: `AFS_*`, `HTM_*`, `TA_Mil__c`, ROA/ROE/NIM, Texas ratio, deposits, loans, Munis_*…) | — | **DROP — the portal's FedFis workbook is authoritative for banks; SF's copy is a stale duplicate** |
| Jigsaw / Discovery / LinkedIn / Pardot `pi__*` / `maps__*` | — | DROP (marketing noise; profiles confirm ~0–72% but no real signal) |
| SF-internal (`CreatedById`, `SystemModstamp`, `PhotoUrl`, `MasterRecordId`, `PersonActionCadence*`, `ActivityMetricId`…) | — | DROP |

**Owner backfill (proposal):** account `OwnerId` is 97% one admin (Spellmeyer) → unusable. Derive each bank's owner from the **modal owner of its contacts** (well-distributed). Propose only where `bank_coverage.owner` is currently blank; never stomp a saved owner. Output as a reviewable table + JSON; apply is a follow-up once signed off.

**Status backfill (proposal):** seed `Client`/`Prospect` from `Account.Status__c` for cert-matched banks that have **no** saved coverage/account status. `coverage.status` stays authoritative when present (per `effectiveAccountStatus`, server.js:2534).

---

## 7. Out of scope this slice / open decisions

**Codex handoff (do not build here):** Pershing/trade store, active-vs-dormant-client signal, trade-recency UI, `bank-signals.js` edits, dormant-client report. Codex reuses `buildAccountIndex` + `buildRepResolver` from this module; `Pershing.Account__c → accountIndex.byId → cert → bankId`, then rolls up max `Most_Recent_Trade_Date__c` per bank.

**Open decisions for the owner (recommendations in bold):**
1. **RIAs:** 17,920 RIA accounts + 214 RIA contacts have no cert and nowhere to live (portal is bank-only). **Recommend: defer** — park RIA/GENERAL contacts in the `unmatched` report; a future RIA entity store is its own build.
2. **Status authority:** **Recommend import-as-seed** (only where no status saved), never override a rep's manual coverage status.
3. **Owner source:** **Recommend contact-modal owner, blank-only backfill** (account owner is one admin).
4. **Existing name-matched contacts:** the old `/api/contacts/import` left some `notes='Imported from Salesforce'` rows. **Recommend additive + dedup** on `bankId+email`/`bankId+name` (safe to re-run); SF `Id` stamped in notes.
5. **Compliance columns:** `bank_contacts` has no DNC/opt-out column. All flags are false today, so **recommend deferring** the schema column to whoever owns `bank-coverage-store.js`; revisit when a re-export populates them.

---

## 8. Tests (`tests/salesforce-import.test.js`, plain `node`)

Pure-module unit tests, no fixtures needed beyond small inline rows:
- `normalizeCert` cases (`"12,345.0"`→`"12345"`, blanks, non-numeric).
- `buildRepResolver` — 15-char prefix join (with/without 3-char suffix), unknown owner → null.
- `classifyTitle` — President/CEO variants → ceo/president decision-maker; CFO variants; Investment Officer; junk title → other/non-DM.
- `buildAccountIndex` — record-type mapping, cert normalization, `byCert` collisions.
- `matchContactToBank` — cert hit, name fallback, RIA→unmatched with reason, orphan.
- `buildContactImportPlan` — dedup against `existingKeys`, junk-email strip, funnel `stats` equal the §3 numbers on the real export (a guarded integration check that skips if the raw export/DB is absent, like the FDIC tests).
