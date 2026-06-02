# What This Replaces from Salesforce

*Internal reference for the sales team and managers. For Institutional Use Only.*

The portal is taking over the **day-to-day sales-coverage layer** you used Salesforce
for. It is **not** a full CRM replacement and is not trying to be. Here's the map.

## ✅ Now in the portal (stop using Salesforce for these)

| Salesforce thing | Portal equivalent | Where |
|---|---|---|
| Strategy task board (Open / In Progress / Needs Billed / Completed) | **Strategies Queue** | Strategies → Queue |
| Account record (bank profile, status, owner) | **Bank Tear Sheet** | Banks → Bank Tear Sheets |
| Account status (Open / Prospect / Client / Watchlist / Dormant) | On every tear sheet & search result | Banks |
| Saved reports & account lists | **Saved Views** (filter, sort, CSV export) | Banks → Saved Views |
| Map of accounts by status | **Map** | Map |
| "Needs Billed" tracking | **Billing queue** (auto-filled when a strategy hits Needs Billed) | Strategies |
| Notes, follow-ups, activity history on an account | **Notes / next action / activity timeline** | Bank Tear Sheet |
| Client / prospect / overdue dashboards | **Home → "My Work"** | Home |
| Manual swap one-pager in Excel (`Master Swap Template v4.6`) | **Bond Swap proposal builder** | Strategies → Bond Swap |

## ⏳ Still partial / coming
- Cross-rep manager controls are **policy, not enforced** yet (any rep can edit any
  record — see the role matrix). Behave as if Salesforce sharing rules still apply.
- Contact management is lighter than Salesforce — basic contacts per bank, no full
  activity-per-contact history.

## ❌ NOT replaced — keep using the existing system
- Custody, clearing, trading, and portfolio **accounting** systems.
- Compliance retention / formal approval workflows.
- Email & calendar (no sync today).
- Anything client-facing — the portal is **internal only**.

## Why the change is worth it
- One bank record instead of hopping between Salesforce + spreadsheets + the daily email.
- Trade ideas (Daily Intelligence) sit next to the bank you'd pitch them to.
- Finished analysis can't silently skip billing — Needs Billed auto-queues.
- Swap one-pagers are built from live holdings, frozen on send, and audit-logged.

> **Rule of thumb:** if it's about *covering a bank, tracking a request, or billing
> finished work* → portal. If it's about *money movement, custody, compliance
> records, or anything a client sees* → the existing systems.
