# Guided workflow QA record

## Scope

Verify one normal path from source import to reviewed regions, exact specifications and shared
context, plus recoverable mistakes. Public fixtures and guide images use generated material.
Browser and API results are separate from actual Figma and native macOS UI acceptance.

## Decisions

- Keep one visible next action through import, region review, specification linking and sharing.
- Saving a region with no chosen nodes prepares source candidates when complete source is
  available. Existing choices survive geometry edits; explicit matching can replace them.
  Human source confirmation and semantic approval remain explicit decisions.
- Put coordinates, role, hierarchy, split/merge and optional proposal tools behind secondary controls.
- Keep a single editable draft at a time. Saving or discarding it makes the next task available.
- Link specifications from an approved region with that region selected as the initial target.
  Choose specification text sources independently from the canvas source.
- Use one Share entry point for approved JSON and Markdown. Source transfer stays separate because
  it carries source material rather than reviewed interpretation.
- Record local diagnostics for request outcomes and browser/native failures, excluding source
  text, images and credentials. Expected recovery errors are tested explicitly.

## Browser matrix

| Area | Required evidence |
| --- | --- |
| Normal path, English and Korean | Normal chunked import; save and automatic source matching; confirm; approve; contextual specification; exact source text; JSON and Markdown; reload |
| Editing recovery | Collection-backed split; merge; delete; undo; redo; fresh source review after geometry changes |
| Draft safety | Specification and annotation drafts survive attempted navigation, other mutations and failed saves |
| Source preparation | Image-first draft, delayed automatic binding, image failure, adjustable budgets, pause/continue |
| Reconnect and partial evidence | Saved metadata/text after restart; explicit recheck consent; complete-part review and focused-part preparation |
| Transfer | Valid source download/import, older formats, corrupt/oversized files, cancellation and delayed responses |
| Settings | Save and restore defaults, range validation, persistence, conflict handling |
| Proposals | Invalid and stale proposals, accept/reject, approved record protection, provider disclosure and per-request consent |
| Diagnostics | Correlated failed requests, reason codes, browser console/runtime events and privacy sentinels |
| Accessibility and locale | Keyboard-accessible dialogs, focus return, narrow layout, language changes preserve drafts and original text |

## Issues found during verification

- A region dragged while the next-action panel changed height acquired the wrong document
  coordinates. The canvas now retains the coordinate transform from the start of the gesture.
  The zoomed/panned move-and-resize regression passed after the fix. Saved values are checked
  exactly after reload; pointer input allows one rendered pixel of rounding.
- Dragging a second saved region could replace a different unsaved region. The current draft
  now retains its identity; the regression checks both the visible draft and unchanged storage.
- A saved manual source selection could be replaced during a later geometry edit. The regression
  retains one deliberately chosen node and verifies that it survives the next save.
- Rejecting a saved specification while its relationships were edited could discard those edits.
  Reject now waits for save/discard, and rejection, reapproval, deletion and Undo are exercised.
- The browser's implicit favicon request produced a misleading `WEB_NOT_BUILT` error on a working
  app. Local network inspection identified `/favicon.ico`; the server now handles it without an
  error and distinguishes missing static resources from a missing app build.
- Native testing exposed a coordinate-entry error that the browser reproduced with sequential
  keystrokes: `-780.25` became `0780.25`. Coordinate inputs now retain unfinished signs and decimal
  points while the canvas keeps its last valid number. The regression also verifies fractional
  values without display rounding and exact persistence after saving and reloading.

These corrections address failures exposed by running the workflow and inspecting its diagnostic
records. Changes to test selectors only reveal controls that moved into secondary sections.

## Execution status

On 2026-10-27, the complete browser suite passed **64/64 tests in 1.8 minutes** against the
0.4.0 source and web build, using Node 22 and installed Google Chrome on macOS. This includes the
coordinate-typing regression discovered during native QA, reproduced before the fix and verified
afterward. No product behavior was changed to bypass a failure.

```sh
npm run build:web
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npx playwright test --timeout=20000
```

Local execution evidence is in `.bridge-local/guided-browser-coordinate-final.log`. Eleven guided scenarios
also retain their `local-diagnostics.ndjson` in `.bridge-local/browser-results/`; their summary is
`.bridge-local/guided-diagnostics-summary.json`. These are local generated-data artifacts, not
public design fixtures.

The eleven scenarios produced **1,752 diagnostic records**. Eight scenarios, including both complete
Korean and English paths, had **zero error records**. Three intentional-failure scenarios produced
nine expected error records: invalid region bounds, injected console/JavaScript/rejected-promise
failures, and a simulated temporary Share failure. There were no unexpected errors in these logs.

Current test entry points: `e2e/guided-workflow.spec.ts`, the other `e2e/*.spec.ts` suites,
`npm run check` and `npm run fixtures:validate`.

The browser harness runs against an isolated local server and temporary data directory. Its Figma
adapter is generated, while HTTP, encrypted WebSocket messages, source traversal, PNG validation,
storage, mutations, export and browser rendering use the production code. The normal-path tests
use the current chunked source route, not only the older demo snapshot route.

Intentional failures include invalid region bounds, stale proposals, interrupted imports, rejected
source responses, failed exports, settings conflicts and synthetic console/runtime errors. The
guided suite attaches local NDJSON records to the test results. An invalid save must expose the
same request ID in its response, user-visible error details and `http.error`/`http.complete` records.
Browser diagnostics must identify console, JavaScript and rejected-promise events while excluding
the sentinel source text, pairing token and actual workspace ID.

The four guide images were regenerated with `scripts/capture-guide-screenshots.ts` and inspected
in Korean and English. All 28 relative links in the two guides and two scenario documents resolve
in the checkout. This does not replace checking the contents of the final distributable packages.

## Source and package checks

The final source suite passed **495 Node tests**. Related plugin-package and
offline-guide tests passed **15/15**, including file allowlists, exact content and
checksums, inert HTML and the selected diagnostic language. The second 0.4.0
candidate package passed its verifier before the final release-note update.
Final clean-commit package verification and publication remain separate gates.

## Actual native 0.4.0 candidate checks

These actions ran in the installed macOS app with the matching local plugin and
two owned synthetic Figma files in Dev Mode. They are separate from the generated
browser adapter tests above.

- Imported a 21-node frame and a 56-node frame. Saved a region with one automatically
  selected source, used **Show in Figma**, confirmed the source and approved the region.
- Created a specification from exact text in the other imported source with the
  originating region selected as its initial target. Save and approval succeeded.
- Used native Save dialogs to write JSON (**7,826 bytes**) and Markdown (**7,867 bytes**).
  Each contained one region and one specification; exact wording and the cross-source
  relationship were checked.
- An intentionally invalid boundary produced an error with the same request ID in
  the UI, server log and native log. The draft survived and corrected bounds saved.
  **Reveal Diagnostic Logs** opened Finder. Both Korean and English offline guides
  displayed troubleshooting and diagnostic instructions.
- Reopened the second candidate and loaded revision 7 with both sources and the
  approved region/specification. Sequential keyboard input retained `-780.25`;
  dimensions `120.1` by `100.1` saved at revision 8.
- Horizontal split → Undo produced revisions 9 → 10; vertical split → Undo produced
  11 → 12. A further Undo at revision 13 restored the original approved region at
  `x=-780`, `y=-480`, `width=120`, `height=100` and its specification. No errors were
  recorded during these native coordinate, split and Undo actions.

All **42 baseline data files** remained unchanged, excluding the runtime lock file.
The exercised source material was synthetic; no private file/node identifiers,
credentials or corporate content are included in this report. A candidate result
does not identify the final uploaded bytes: the clean-commit release verifier and
publication record bind those assets to the final revision.

## External boundaries

Generated source adapters do not prove native performance or peak memory on the reported
105,837-node work file. They also do not prove another owner's view-only/Dev-only access,
organization approval, independent semantic accuracy or productivity.
