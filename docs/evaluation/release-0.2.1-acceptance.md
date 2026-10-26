# 0.2.1 import/settings acceptance — 2026-10-26

This records executed checks for the configurable-budget, 2× overview and single
normal import change. It does not claim the broader ADR 0012 recovery model.
Final artifact provenance is the clean-commit verification report attached to
the release; the native checks below initially used the matched candidate app
and plugin, followed by final artifact installation checks.

## Source and browser evidence

- `npm run check`: 414 tests passed, zero failures/skips, TypeScript and all builds.
- Chrome browser suite: 41 cases passed. Twelve UI cases for retired mode/raw
  acquisition controls and four manual/selective UI journeys were replaced by
  eight normal-import/settings/automatic-write journeys. Legacy acquisition,
  selective HTTP/MCP and approval contracts remain in the Node suite. Review,
  exact-text, transfer, stale-response and localization/browser regressions remain.
- The synthetic 6,001-node real-HTTP/encrypted-socket/disk path paused at exactly
  5,000 nodes; raising settings completed 6,001 with sequences 0–12, one original
  child-array read, one image export and exact Unicode/CRLF text preserved.
- Settings tests cover unauthenticated access, unsafe values, stale revisions,
  defensive copies and reload. Browser cases cover both languages, automatic
  source-write locks, unsaved edits, image failure and persisted settings.

Synthetic browser/adapter evidence is not a native Figma memory or performance measurement.

## Installed candidate and actual Figma

Used the owned rendering/lifecycle fixture with an unchanged selected 800×600
Frame. The installed app and registered local plugin were updated together.

1. Opened the actual Korean Settings dialog; observed scale 2, long edge 4,096px,
   default 200,000 nodes/64 MB and duration/wait/retention controls.
2. Through native UI, set the source budget to 10, created a named synthetic
   workspace, added the selected source and started the normal import.
3. Actual Figma produced a **1,600×1,200 PNG**. The UI paused at **10 nodes / one
   durable part** and saved one visual scope automatically.
4. Through native UI, raised the budget to 100 and used Continue. It completed
   **21 nodes / two durable parts** and upgraded the same single visual scope to
   collection-backed evidence. Figma selection was unchanged; no source design
   content was written. No semantic approval was performed by the smoke test.
5. Restored the 200,000-node/2× defaults using the Settings dialog and cleared the
   copied pairing token through the native bridge menu.
6. Fresh bundled MCP: version 0.2.1, 21 tools, actual live selection and existing
   generated-demo approved context (two annotations) read successfully. No external
   model was enabled or called.
7. All fifteen original project files, pairing token and local certificate pin
   retained their hashes. One additional, unapproved synthetic workspace holds
   the acceptance result. The prior app and full data were backed up privately.

## Package and remaining boundaries

Candidate ZIP/DMG/plugin packaging and the release verifier passed, including
signatures, bundled guides/images, license/notices, authenticated service and MCP.
The final public report must separately identify clean source and downloaded
assets; candidate checks alone are not proof of publication.

Cross-session supplementation, partial-collection editor access, atomic Figma
revision guarantees, the original reported 105,837-node production file, measured
native peak memory, effective Dev-only/view-only foreign ownership, independent
human semantic/productivity evaluation and organization approval remain outside
these checks. Keep issues #2, #6 and #7 open for their respective acceptance work.
