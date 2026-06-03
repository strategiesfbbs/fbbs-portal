---
description: Inspect today's daily package — which of the 10 slots are filled (from _meta.json and data/current/).
allowed-tools: Bash, Read
---
Report the state of the current daily document package. Read-only.

1. List `data/current/` and read `data/current/_meta.json`.
2. Map the present files to the 10 package slots: `dashboard` (HTML), `econ` (PDF), `relativeValue` (PDF), `treasuryNotes` (xlsx), `cd` (PDF), `cdoffers` (PDF/xlsx), `munioffers` (PDF), `agenciesBullets` (xlsx), `agenciesCallables` (xlsx), `corporates` (xlsx).
3. Present a table: slot | filename | as-of date | present?. Flag missing slots and any file in `current/` that didn't classify into a slot.
4. Report the package date from `_meta.json` and whether all slots share it.

The classification logic of record is `classifyFile()` in `server/server.js` — defer to it; this command only reports.
