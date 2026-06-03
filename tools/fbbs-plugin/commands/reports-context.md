---
description: Load the Reports/Data Analytics source map without duplicating semantic-layer context.
argument-hint: "[report, data source, or analytics question]"
allowed-tools: Bash, Read
---
Prepare FBBS Reports context for a Claude/Codex handoff or Data Analytics workflow.

1. Read `tools/fbbs-plugin/context/reports-data-analytics.md`.
2. Read `docs/data-pipeline.md` and the `README.md` "Reports tab" section.
3. If $ARGUMENTS names a specific report, route, metric, or source file, read the relevant
   implementation files from the source map instead of summarizing the whole portal.
4. Output:
   - the controlling source files for the request;
   - the current portal workflow or route involved;
   - verification steps (`npm test` and any route-specific preview checks);
   - whether this should become a Data Analytics semantic-layer update.

Do not write or duplicate a semantic layer in this command. If the request needs canonical
metrics, grains, joins, source precedence, caveats, or reusable report semantics, invoke the
Data Analytics semantic-layer workflow and use the bridge note only as source intake.
