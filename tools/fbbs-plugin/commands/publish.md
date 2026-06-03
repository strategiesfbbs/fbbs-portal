---
description: Helper for publishing/refreshing the daily package — classify candidate files and explain the publish path.
argument-hint: "[path to a folder of new files]"
allowed-tools: Bash, Read
---
Help stage a daily-package publish. Publishing itself happens through the running portal's upload route — this command preps and sanity-checks; it does not move or upload files.

1. If $ARGUMENTS is a folder, list its files and predict which slot each would classify into. Mirror `classifyFile()` in `server/server.js` — read it, don't re-implement it.
2. Flag anything that wouldn't classify, would collide with an existing slot, or fails the expected magic-byte type (PDF vs Excel vs HTML) for its slot.
3. Remind the operator of the publish rule: a same-day re-publish replaces only the re-uploaded slots; a different-day upload rolls the whole package into `data/archive/YYYY-MM-DD/`.
4. Surface the plan and let the operator drive the upload UI. Do not move or upload files yourself.
