---
description: Start the portal dev server and verify the daily package + key pages render (preview tools, no manual checking).
argument-hint: "[page or route to focus on]"
allowed-tools: Bash, Read
---
Verify the FBBS portal renders correctly using the preview tools. Never ask the user to check manually — verify and share proof.

1. Ensure the server is running (`preview_start`; the app starts with `npm start` / `node server/server.js`, default PORT 3000).
2. Load the SPA shell, snapshot it, and confirm no console/server errors (`preview_console_logs`, `preview_logs`).
3. Spot-check the high-traffic surfaces: the daily-package dashboard, a Bank Tear Sheet, and the Bond Swap tab (Strategies → Bond Swap). Snapshot each.
4. If a change in this session touched a specific page, exercise it (`preview_click` / `preview_fill`) and snapshot to confirm the behavior.
5. Share proof: a `preview_screenshot` for visual changes, `preview_network` for API changes, or `preview_logs` for server changes.

If $ARGUMENTS names a page or route, focus the verification there.
