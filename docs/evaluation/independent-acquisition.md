# Independent acquisition validation — 2026-10-25

Scope: the first bounded slice of [ADR 0006](../adr/0006-image-first-lazy-acquisition.md).
This is a working-tree validation record, not a release or large-frame acceptance.
All test data are generated or synthetic. No corporate design, source screenshot,
token or private Figma identifier is included.

Update: the owned native Figma fixture now passed the new image-first/later-structure
path with 21 nodes and an 800 × 600 PNG, reused byte-for-byte without a second export.
The later chunked collection slice and current checks are recorded in
[chunked-source-collections.md](chunked-source-collections.md). The table below is
the earlier first-slice baseline, not the latest full test count.
The 2026-10-26 [collection-backed workflow record](collection-backed-workflow.md)
supersedes the later-slice backlog statements at the end of this dated report.

## Executed checks

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run check` | TypeScript, 256 Node tests, fixture/product plugins, web and server/MCP builds passed | Node 22.22.0; no standalone lint script is configured |
| `npm run test:e2e` | 35 browser tests passed | Installed Chrome, isolated headless profiles; Figma responses are synthetic |
| `npm run fixtures:validate` | Both manifests passed schema/provenance validation | Does not assert real Figma rendering |
| Expanded overview visual check | Synthetic 800 × 500 image inspected in a 1680px browser | Modal layout, close control and image presentation; not native pixels |

The new actual-HTTP browser test crosses browser → server → acquisition manager →
WebSocket → persistence. Only the Figma endpoint is emulated; the HTTP routes and
storage are real. It decodes a generated PNG, holds structure acquisition while the
overview remains visible, verifies exactly one image request, then saves complete
source records with unchanged original text, geometry and image bytes. A new store
instance and browser reload recover the same project.

## Correctness and lifecycle evidence

- Preflight pins one selected source without exporting an image or reading children.
  Stale revision/session and client abort during its final asynchronous read do not
  publish a prepared task. A task is listed only after its first journal is durable.
- Overview, structure, and both sequential orders request exactly their chosen steps.
  Loading structure later reuses the overview. Enlarging the image also uses existing
  bytes, with Escape and focus restoration tested.
- A completed image survives structure failure or partial traversal. Retry requests
  only the failed step; structure retry begins again rather than claiming continuation.
- Partial metadata cannot be committed or treated as complete. New matching, source
  confirmation and semantic approvals reject incomplete scopes. Legacy approved
  records remain readable/exportable; draft edits and proposal staging stay available.
- Wrong source identity, provenance, bounds and known root changes are rejected.
  Changes to unseen descendants and atomic image/structure consistency remain unknown.
- Progress counts are monotonic; unknown totals do not produce fabricated percentages.
  Cancellation, timeout, late replies, replacement sessions, source changes and server
  restart are covered by synthetic transport/manager tests.
- Deterministic persistence barriers verify that cancel cannot overwrite a terminal
  result while its journal is saving, commit cannot race that write, and shutdown
  waits for an initial launch write. A crash journal with all required durable
  observations reconciles without another native request.
- Completed captures are added only by explicit revision-checked save, with
  idempotent recovery. Separate observation times and consistency metadata survive
  disk, capture-bundle checksums/round trips and approved context export.
- Cached jobs, including committed ones, can be reopened and removed without changing
  project captures or annotations. UI locale keys and interpolation remain aligned.
- Existing `preview_node` progress is accepted without disconnecting its session.

## Reproduction

```sh
npm run check
npm run fixtures:validate
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e
```

Use Node 22 or newer. An installed supported Chromium or Playwright Chromium is
required for browser tests. Tests create temporary data directories; they do not
reuse the installed app's project store or pairing token.

Focused evidence lives in `tests/product-independent-acquisition.test.ts`,
`product-acquisition-server.test.ts`, `product-acquisition-lifecycle.test.ts`,
`product-broker-preview-progress.test.ts`, `product-source-completeness.test.ts`,
the capture-bundle tests, and `e2e/acquisition*.spec.ts`. Local logs and screenshots
remain in the ignored `.bridge-local` directory.

## Not established by these checks

The new commands have passed the owned small native fixture described above.
Earlier native one-shot capture evidence is not reused as proof of this workflow.
No 105,837-node full-frame result, natural long-export timeout, forced native
cancellation, memory ceiling, immutable revision consistency or broad production
file compatibility is claimed.

The existing small Snapshot path retains its limits. ADR 0007 now adds separate
large raw collections and selective local reads. Image-only annotation drafts,
selective first-time Figma field acquisition and large collection-backed annotations
remain later slices. Changing task scope is never recorded as
completion of the original scope. The installed 0.1.1 release was not replaced,
repackaged or published as part of this work.
