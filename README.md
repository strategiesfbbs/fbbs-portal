# FBBS Market Intelligence Portal

Internal web app for publishing the daily FBBS document package:

- **Market Intelligence Dashboard** (HTML)
- **Economic Update** (PDF)
- **Brokered CD Rate Sheet** (PDF)
- **Daily CD Offerings** (PDF) — also parsed into a **searchable CD Offerings Explorer**
- **Muni Offerings** (PDF) — also parsed into a **searchable Muni Offerings Explorer**
- **Agencies** (Excel — bullets + callables) — parsed into a **searchable Agencies Explorer**
- **Corporates** (Excel) — parsed into a **searchable Corporates Explorer**

Built on Node.js with two npm dependencies (`pdf-parse` for PDF text extraction, `xlsx` for Excel parsing). Runs the same way on a laptop, a dedicated workstation, or behind IIS.

---

## Quick start (single user, same as the prototype)

### 1. Install Node.js (one-time)

Grab the LTS from [nodejs.org](https://nodejs.org), run the installer, accept defaults. Restart if prompted.

### 2. Install dependencies (one-time)

From the project folder, run once:

```
npm install
```

This installs `pdf-parse` (used to extract CD offerings from the daily PDF). Everything else is Node built-ins.

### 3. Launch

- **Windows:** double-click `start-portal.bat`
- **Mac:** double-click `start-portal.command`
- **From a terminal:** `npm start` (or `node server/server.js`)

### 4. Open

Browse to [http://localhost:3000](http://localhost:3000).

### 5. Publish the daily package

1. Click **Upload**
2. Drop the daily files into their slots — filenames are auto-detected, you'll get a warning if something's in the wrong slot. The portal currently supports eight slots: Dashboard, Economic Update, Brokered CD Sheet, CD Offerings, Muni Offerings, Agencies Bullets, Agencies Callables, and Corporates.
3. Click **Publish Package**

Yesterday's files are archived automatically; the home page updates immediately.

---

## Deployment paths

Pick whichever matches your setup. The same code runs in all three.

### Option A — Single user, local only

Exactly the Quick Start above. The portal lives on your machine. Only you can reach it.

### Option B — Dedicated workstation on the internal network

Use this if you want the team to be able to view (or publish) from their own desks without IT getting involved.

1. Pick an always-on PC or small server on the network.
2. Install Node.js LTS on it.
3. Copy this folder to that machine.
4. Launch the portal. Leave the window open (or set it up as a Windows service — see below).
5. Find that machine's network name or IP (`hostname` on Windows, or `ipconfig`).
6. Everyone on the network visits `http://<that-machine>:3000`.

Windows service (so the portal restarts automatically after reboots): tell IT you want the app installed as a service. The simplest tool is [NSSM](https://nssm.cc/) (non-sucking service manager):

```
nssm install FBBSPortal "C:\Program Files\nodejs\node.exe" "C:\path\to\fbbs-portal\server\server.js"
nssm set FBBSPortal AppDirectory "C:\path\to\fbbs-portal"
nssm set FBBSPortal AppEnvironmentExtra PORT=3000 DATA_DIR=D:\FBBSPortalData
nssm start FBBSPortal
```

### Option C — Internal IIS server

Use this if your IT team already operates an internal IIS farm and wants this integrated there.

1. IT installs Node.js LTS and the [iisnode](https://github.com/Azure/iisnode) module on the server.
2. IT copies this folder to the IIS site's physical path (e.g. `C:\inetpub\wwwroot\fbbs-portal`).
3. IT creates an Application in IIS Manager pointing at that folder — `web.config` is included and does the rest.
4. IT grants the App Pool identity write access to the `data\` subfolder (or points `DATA_DIR` to a shared location — see below).
5. Optional: IT enables **Windows Authentication** on the site, which restricts access to domain users with no app-level changes.

**Recommended for IIS:** set `DATA_DIR` to a path *outside* the app folder so future code updates don't risk the archive. Example: `DATA_DIR=D:\FBBSPortalData`. Set that as an environment variable on the App Pool.

---

## Configuration

All settings are environment variables. None are required; defaults are sensible.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind interface — `0.0.0.0` = all, `127.0.0.1` = localhost only |
| `DATA_DIR` | `<app>/data` | Where uploaded packages are stored |
| `MAX_UPLOAD_MB` | `50` | Per-request upload cap |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

Examples:

```bash
# Run on port 8080, bind to all interfaces
PORT=8080 npm start

# Localhost-only, data stored elsewhere
HOST=127.0.0.1 DATA_DIR=/var/fbbs-data npm start
```

Windows (`cmd`):

```
set PORT=8080
set DATA_DIR=D:\FBBSPortalData
npm start
```

---

## How it works

### File storage

No database. Everything lives in plain folders:

```
<DATA_DIR>/
├── current/              ← today's package (uploaded files + generated JSON + _meta.json)
│   ├── FBBS_Dashboard_....html
│   ├── 20260423.pdf
│   ├── FBBS_Brokered_CD_Rate_Sheet_....pdf
│   ├── 20260423_CD_Offers.pdf
│   ├── _offerings.json
│   ├── _muni_offerings.json
│   ├── _agencies.json
│   ├── _corporates.json
│   └── _meta.json
└── archive/
    ├── 2026-04-22/       ← yesterday's package (same structure)
    ├── 2026-04-21/
    └── …
```

You can open these folders directly to back things up or inspect what's there.

### Auto-archive

When a new day's package is uploaded, yesterday's files roll to `archive/YYYY-MM-DD/` automatically. A same-day re-publish (correcting a file, say) just overwrites the current set — it doesn't create a new archive entry.

### Auto-detection

Files are classified by filename (the slot label from the upload form wins if there's a conflict):

- `.html` or `.htm` → Dashboard
- `.pdf` with `CD_Offer`, `Daily_CD`, or similar → CD Offerings
- `.pdf` with `CD_Rate`, `Brokered_CD`, or similar → CD Rate Sheet
- Any other `.pdf` → Economic Update

Drop something into the wrong slot and you'll get a heads-up toast before you publish.

---

## API endpoints

Handy if the team ever wants to script publishing or pull data elsewhere.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe — returns `{status, now}` |
| `GET` | `/api/current` | JSON describing the current published package |
| `GET` | `/api/archive` | JSON array of all archived days |
| `GET` | `/api/offerings` | Structured CD offerings from the current package (pass `?date=YYYY-MM-DD` for an archived day) |
| `GET` | `/api/muni-offerings` | Structured Muni offerings from the current package (pass `?date=YYYY-MM-DD` for an archived day) |
| `GET` | `/api/agencies` | Structured Agency offerings (bullets + callables unified) from the current package (pass `?date=YYYY-MM-DD` for an archived day) |
| `GET` | `/api/corporates` | Structured Corporate bond offerings from the current package (pass `?date=YYYY-MM-DD` for an archived day) |
| `GET` | `/api/audit-log` | Publish history, newest first (pass `?limit=N`, default 200, max 1000) |
| `POST` | `/api/upload` | Multipart/form-data upload — field names `dashboard`, `econ`, `cd`, `cdoffers`, `munioffers`, `agenciesBullets`, `agenciesCallables`, `corporates` |
| `GET` | `/current/<file>` | Serves a file from the current package (`?download=1` to force download) |
| `GET` | `/archive/<YYYY-MM-DD>/<file>` | Serves a file from that archived day |

Files prefixed with `_` (e.g. `_meta.json`, `_offerings.json`) are internal metadata and are not served over `/current/` or `/archive/`.

---

## CD Offerings Explorer

When you publish the Daily CD Offerings PDF, the server extracts every row into structured data and writes it to `data/current/_offerings.json`. The **CD Offerings Explorer** page (in the top nav) provides:

- **Search** by issuer name or CUSIP
- **Filters** by term, minimum rate, issuer state, coupon frequency, and "hide CDs with restrictions"
- **Sortable columns** — click any column header to sort
- **Restriction chips** in red highlight states where a CD cannot be purchased
- **CSV export** of the filtered/sorted view (filename includes the package date)

Each offering record has this shape (matches the plan's `Offering` model; easy to migrate to SQLite later):

```json
{
  "term": "3m",
  "termMonths": 3,
  "name": "BANK OF BARODA",
  "rate": 3.85,
  "maturity": "2026-07-27",
  "cusip": "06063HXV0",
  "settle": "2026-04-27",
  "issuerState": "NY",
  "restrictions": ["MT"],
  "couponFrequency": "at maturity"
}
```

Archived offerings are available at `/api/offerings?date=YYYY-MM-DD` — a building block for future historical-comparison views.

---

## Muni Offerings Explorer

When you publish the Muni Offerings PDF, the server extracts every row across the three sections (Bank Qualified, Municipals, Taxable Munis) into structured records and writes them to `data/current/_muni_offerings.json`. The **Muni Offerings Explorer** page provides:

- **Search** by issuer name or CUSIP
- **Filters** by section (BQ / Municipals / Taxable), state, minimum coupon, minimum YTW, callable vs non-callable, and rating coverage (both agencies / Moody's / S&P / unrated)
- **Sortable columns** — click any column header to sort
- **Section pills** color-coded for quick visual grouping
- **Moody's and S&P ratings** rendered as separate chips (Moody's green, S&P amber)
- **Spread chips** shown in the YTW column for taxable bonds priced on a spread to treasuries (e.g. `+40/5YR`)
- **Credit enhancement** chips (BAM, AG, PSF-GTD, Q-SBLF, AG / ST INTERCEPT, etc.)
- **CSV export** of the filtered/sorted view

Each muni offering record has this shape:

```json
{
  "section": "Municipals",
  "moodysRating": "Aaa / Aa3",
  "spRating": "AAA / A (NEG)",
  "quantity": 110,
  "issuerState": "TX",
  "issuerName": "DICKINSON TX INDEP SCH DIST",
  "issueType": "UT GO",
  "coupon": 5.000,
  "maturity": "2027-02-15",
  "callDate": null,
  "ytw": 2.500,
  "ytm": 2.501,
  "price": 101.984,
  "spread": null,
  "settle": "2026-04-24",
  "couponDate": "2026-08-15",
  "cusip": "253363E50",
  "creditEnhancement": "PSF-GTD"
}
```

Archived muni offerings are available at `/api/muni-offerings?date=YYYY-MM-DD`.

---

## Agencies Explorer

When traders send agency bonds (typically as `bullets_MM_DD_YY.xlsx` + `callables_MM_DD_YY.xlsx`), drop both files into the Agencies slot on the Upload page. The server parses both workbooks, unifies them under a single schema, and writes the results to `data/current/_agencies.json`. The **Agencies Explorer** page provides:

- **Search** by CUSIP or issuer ticker
- **Structure** multi-select (Bullet / Callable)
- **Issuer** multi-select — auto-discovered from the data (FFCB, FHLB, FNMA, FHLMC, FHLM, FAMCA, FAMC, IBRD, TVA, etc.)
- **Call type** multi-select — auto-discovered from the data (Anytime, Quarterly, Monthly, Annual, Semi-Annual, Onetime, etc.)
- **Maturity range** (date from / to)
- **Next call range** (date from / to)
- **Coupon range** (min / max %)
- **YTM range** (min / max %)
- **YTNC range** (min / max %)
- **Price range** (min / max)
- **Min quantity** (MM)
- **Sortable columns** — click any header
- **Clear-all-filters** button
- **CSV export** of the filtered/sorted view

Each agency offering record has this shape — differing fields stay nullable rather than being dropped:

```json
{
  "structure": "Callable",
  "ticker": "FFCB",
  "cusip": "3133ENAF7",
  "coupon": 1.0,
  "maturity": "2026-10-07",
  "availableSize": 1.44,
  "askPrice": 98.834,
  "ytm": 3.664,
  "ytnc": 1.071,
  "askSpread": null,
  "benchmark": null,
  "nextCallDate": "2026-05-01",
  "callType": "Anytime",
  "notes": null,
  "settle": "2026-04-27",
  "costBasis": 98.784,
  "commissionBp": 0.5
}
```

Bullet records null out `nextCallDate`, `callType`, `notes`, `settle`, `costBasis`; callable records null out `askSpread` and `benchmark`. The home page and admin log show both "uploaded on X" and "file dated Y" dates so you can tell at a glance whether the traders' file is current.

**Yield normalization:** YTM is stored as percent (3.664%, not 0.03664). YTNC uses a heuristic — values ≤ 1 are treated as decimals and multiplied by 100; values > 1 are assumed to already be in percent form. This matches how traders' files mix the two formats inside the same YTNC column.

Archived agencies are available at `/api/agencies?date=YYYY-MM-DD`.

---

## Admin / Publish Log

The **Admin** page shows a reverse-chronological list of every publish:

- Timestamp, package date, publisher name
- Which files were included (dashboard, econ, cd, cdoffers)
- Offering count extracted
- Any validation warnings from that publish (e.g. "files appear to be from different dates")
- Parser warnings are also preserved in the generated JSON files (`_offerings.json`, `_muni_offerings.json`, `_agencies.json`, `_corporates.json`) so future reviews can see whether extraction skipped or questioned any rows

The log is stored as an append-only JSON-lines file at `data/audit.log` — one line per publish, each line a complete JSON record. It can be tailed, grepped, shipped to a SIEM, or rotated however IT prefers. Delete the file to clear the log; no restart required.

---

## Date-mismatch validation

On every upload, the server sniffs the date from each filename and cross-checks against the internal "as of" date parsed from the CD Offers PDF. If anything doesn't line up, the publish still succeeds (a same-day correction is a valid workflow) but the response includes a `dateWarnings` array, which is:

1. Shown as an amber toast immediately after publish
2. Recorded in the audit log, visible on the Admin page

---

## Stopping the portal

- **Local / dedicated PC:** press `Ctrl+C` in the terminal window, or just close it.
- **Windows service:** `nssm stop FBBSPortal`
- **IIS:** stop the Application Pool, or `iisreset`.

Uploaded data is untouched — it stays in `DATA_DIR`.

---

## Troubleshooting

**"Node is not recognized"**
Install/reinstall Node from nodejs.org and restart the machine.

**"Port 3000 is already in use"**
Set `PORT` to something else: `PORT=3001 npm start`.

**Uploads fail silently**
Check the terminal/log for the actual error. Common cause: `data/` isn't writable by the process (on IIS, give the App Pool identity write permission).

**Files upload but don't appear**
Refresh the page. The portal polls on load and after each publish.

**"Upload exceeds maximum allowed size"**
Bump `MAX_UPLOAD_MB`. If deployed on IIS, also bump `maxAllowedContentLength` in `web.config`.

---

## Security posture

This portal has **no built-in authentication**, matching your current "trusted internal network" answer. Before changing that:

- **Easiest path to add auth:** deploy on IIS (Option C) and turn on Windows Authentication in IIS Manager. No code changes needed.
- **If adding auth in code later:** the router is centralized in `server/server.js` — a middleware function at the top of the `createServer` handler is the right place.
- Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`) are set on every response.
- Path traversal is blocked for both `/current/` and `/archive/` file serving, and the static-asset handler stays inside `public/`.
- Uploads are capped (default 50 MB per request). Filenames are sanitized before being written to disk.

---

## What changed from the prototype

### v1.0 — hardening and bug fixes

- Home and upload counters correctly show **4** documents (were stuck at 3 after CD Offerings was added)
- Server classifier recognizes CD Offerings in every code path (prototype missed it in one branch)
- Client classifier updated to match the server, so wrong-slot warnings fire correctly
- Path traversal protection on `/current/` and `/archive/` file routes (prototype only had it for static assets)
- Configurable upload size cap with graceful 413 response instead of OOM risk
- Streaming file responses instead of loading whole files into memory
- Filename sanitization before writing to disk
- Config via environment variables (`PORT`, `HOST`, `DATA_DIR`, `MAX_UPLOAD_MB`, `LOG_LEVEL`)
- Proper logging with timestamps and levels
- Graceful shutdown on `SIGINT`/`SIGTERM`
- Hash-based deep-linking (`/#archive`, `/#dashboard`, etc. — bookmarkable pages)
- IIS `web.config` with iisnode handler, hidden-segment protection for `data/` and `server/`, and raised content-length cap
- Better upload reset — drop zones return to their original "Drop HTML File" / "Drop PDF File" text instead of a generic "Drop File"

### v1.4 — corporates

- **Corporates slot (8th item)** — new upload card accepting `corporates_*.xlsx`. Parser handles all ~200 corporate bonds including Moody's + S&P ratings, sector, payment rank, coupon/maturity, YTM/YTNC, price, amount outstanding (`550MM`, `3MMM`).
- **Credit tier classification** — every bond gets a tier (AAA/AA, A, BBB, HY, NR) derived from ratings. Filter by specific tier or broad "IG only" / "HY only".
- **Corporates Explorer page** — filters include: search by issuer/CUSIP/ticker, credit tier, callable yes/no, sector multi-select, payment rank multi-select, ticker multi-select (scrollable — 65+ issuers), maturity range, next-call range, coupon/YTM/price ranges, minimum qty. 14 sortable columns, CSV export.
- **Color-coded tier pills** — AAA/AA in blue, A in green, BBB in amber, HY in red, NR in gray. Moody's and S&P ratings rendered as separate chips.
- **Sector chips and payment rank chips** — Subordinated bonds highlighted in red to distinguish from Sr Unsecured.
- **Audit log extended** with a Corporates count column alongside CDs, Munis, Agencies.
- **`/api/corporates`** endpoint (current + archived by date).

### v1.3.3 — same-day partial re-publish bugfix

- **Fixed a critical bug** in same-day re-publishes that was silently deleting other slots. If you uploaded the daily package in the morning and then traders sent agencies/corporates mid-day, the second upload would wipe all slots that weren't part of the new upload.
- Now same-day re-publishes **selectively replace only the slots being uploaded**; all other slots survive. Meta counts (CDs, Munis, Agencies, Corporates) and filenames are merged from the prior publish.
- Different-day uploads still archive the entire prior package wholesale (unchanged).

### v1.3.2 — sidebar navigation

- **Replaced the wrapping top-nav with a left sidebar.** Nav links are now grouped into four sections (Home / Publications / Explorers / Management) with section titles, icons, and an active-state indicator on the left edge.
- **Brand and letterhead moved into the sidebar** so the main content area is no longer pushed down by ~150px of chrome.
- **Slim top strip** above the content shows the date and quick external links (Portfolio Accounting, NETX Investor).
- **Responsive collapse**: below 900px the sidebar hides behind a hamburger toggle and slides in as an overlay with a dimmed backdrop. Tapping a link auto-closes on mobile.
- More horizontal room for the explorer tables on laptops.
- Active-state of the current page is now always set correctly, including for the Home page.

### v1.3.1 — agencies bugfix: two separate upload slots

- **Split the single Agencies slot into two distinct slots**: "Agencies — Bullets" and "Agencies — Callables" on the Upload page. The previous multi-file approach allowed only one file to stick — the second overwrote the first.
- Server now has seven named slots total: `dashboard`, `econ`, `cd`, `cdoffers`, `munioffers`, `agenciesBullets`, `agenciesCallables`. Both agency slots are parsed together by the same extractor — result unchanged (both structures land in the same combined `_agencies.json` that powers the Agencies Explorer).
- Filename classifier now routes `bullets_*.xlsx` to the bullets slot and `callables_*.xlsx` to the callables slot. Ambiguous xlsx filenames default to bullets.
- Home page now shows two Agencies cards; both report the combined 342-offering count so it's clear the explorer has everything.
- Publish page counter bumped from 6 to 7 items.

### v1.3 — agencies (bullets + callables)

- **Agencies slot (6th document)** — accepts multiple `.xlsx` files in one upload (bullets + callables from traders)
- **Agencies parser** — reads both Excel sheets, unifies them into one array with a `structure` field ('Bullet' | 'Callable'), nullable differing columns so no data is dropped. Handles both coupon (percent) and yield (decimal) conventions, and a heuristic for YTNC values that arrive in mixed formats
- **Agencies Explorer page** — 13 filters including multi-select issuer and call type (both auto-discovered from the data), date ranges for maturity and next call, min/max ranges for coupon/YTM/YTNC/price, min quantity, CUSIP/ticker search; sortable columns; clear-filters button; CSV export
- **Home card and admin log show both dates** — "uploaded on X · file dated Y" — since the trader filename's date can differ from the upload date
- **`/api/agencies`** endpoint (current + archived by date)
- Filename date sniffing extended to handle 2-digit year patterns like `04_24_26`
- Upload handler now supports multi-file slots alongside single-file slots, maintaining backward compatibility for all existing daily-package slots
- Two npm dependencies now: `pdf-parse` and `xlsx` (both stable, no native deps)

### v1.2 — muni offerings

- **Muni Offerings slot (5th document)** — new upload card, filename auto-detection, dedicated PDF viewer page, archive integration
- **Muni parser** — handles the Municipal Offerings PDF across all three sections (Bank Qualified, Municipals, Taxable Munis) including split ratings ("Aaa / Aa3", "AAA / A (NEG)"), multi-token credit enhancements ("AG / ST INTERCEPT"), and taxable bonds priced on a spread (e.g. `+40/5YR`) rather than a yield
- **Muni Offerings Explorer page** — searchable, sortable, filterable, exportable; filters by section, state, coupon, YTW, callable, and ratings coverage
- **Separate Moody's / S&P rating chips** — visually distinct (green / amber) so you can spot split-rated bonds at a glance
- **Cross-date validation extended** — also checks the muni PDF's internal as-of date against the CD PDF's as-of date and the filename dates
- **Audit log now records muni offering count** and the Admin page shows CDs and Munis in separate columns
- **`/api/muni-offerings`** endpoint (current + archived by date)
- **CSV export** works for both explorers independently

### v1.1 — structured data and audit trail

- **Offerings Explorer page** — parses the Daily CD Offers PDF on every publish into 140+ structured offering records and exposes a searchable, sortable, filterable, exportable table. See the [Offerings Explorer](#offerings-explorer) section.
- **Admin / Publish Log page** — audit trail of every publish visible in-app
- **`data/audit.log`** — append-only JSON-lines file on the server, one record per publish
- **Date-mismatch validation** — warns if the 4 uploaded files appear to be from different dates
- **Package date auto-detection** — the package's date now comes from the CD Offers PDF's internal "as of" date (falls back to filename sniffing, then to today), not just today's server date
- **Structured offerings JSON** — written alongside the PDFs, accessible at `/api/offerings` and `/api/offerings?date=YYYY-MM-DD`
- **Internal metadata protection** — files prefixed with `_` are never served to clients over `/current/` or `/archive/`
- One new dependency: `pdf-parse` (for extracting text from the CD Offers PDF). Install via `npm install` before first launch.

---

*Built for First Bankers' Banc Securities, Inc. — For Institutional Use Only*
