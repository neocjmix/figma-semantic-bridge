# Collection-backed editor and selective source workflow — 2026-10-26

This record describes the **unreleased source build**, not the installed 0.1.1
app/plugin or a release acceptance decision. Public tests and fixtures use
generated data. No corporate source image, original text, private Figma ID or
pairing token is included here. It supersedes the unfinished-editor statements
in the dated [2026-10-25 collection record](chunked-source-collections.md);
that record remains the evidence for the earlier chunk reader.

## Delivered behavior and completion boundaries

- An overview-only acquisition can create an explicit visual scope with a PNG,
  document bounds and source provenance but **no inline node array**. Human regions
  can be saved as proposed. Matching, source confirmation and semantic approval
  remain locked until a complete source collection is attached.
- A complete collection can become a source-only editor scope, or attach to a
  matching visual draft by file, page, root and bounds. Attachment retains the
  visual observation and its regions; image and structure retain separate times.
  Neither path fabricates a bounded `Snapshot` or treats a prefix as complete.
- Full-scope geometric matching streams verified chunks. The browser fetches
  bounded metadata pages, shows the loaded-bounds count against the full count,
  resolves chosen references and reads exact selected TEXT only. A collection
  annotation requires saved references and explicit human **Confirm sources**
  before **Approve annotation**. Specification approval still requires approved
  targets and verbatim source text.
- **Selective source inspection** can request up to 100 explicit IDs and chosen
  fields, one parent's immediate children in pages, or a full collection of one
  chosen branch. These live observations do not change project annotations or
  approvals. An ID response does not imply child coverage; a child page does not
  imply descendant coverage; a completed branch does not cover its siblings.
- **Source evidence transfer** streams one complete collection-backed scope to
  a bounded local NDJSON file (80 MB maximum), including exact text and an
  available overview image. Import verifies the checksum, footer and complete
  coverage before adding a fresh, unreviewed scope to the current workspace.
  It excludes annotations, specifications and approvals. Stopping an import near
  its commit point requires a workspace refresh to check whether it completed.

## Evidence executed to date

| Layer | Executed result | What it establishes |
| --- | --- | --- |
| TypeScript, Node and builds | Full post-integration `npm run check` passed: **365 Node tests**, TypeScript, both plugin builds and web/server/MCP builds; both synthetic fixture manifests validated | New contracts and product paths compile and pass local unit/integration checks; this does not exercise Figma |
| Browser | **44/44 full Chrome cases passed**; after the final transfer UI guard, its five integration cases passed again against the rebuilt web app | Real loopback HTTP/server/disk with synthetic WebSocket Figma replies covers visual proposal gate, collection attach, explicit confirmation/approval, exact Unicode TEXT continuation, source-only editor, NDJSON export/import and selective ID reads; older acquisition/collection UI paths still pass |
| Backend focused checks | **13/13 evidence-server checks and 6/6 source-transfer checks passed**, including synthetic 105,837-node full editor and transfer cases | Collection-backed server path and source transfer on generated data; the full check above passed subsequently |
| Native Figma Desktop Dev Mode | Isolated owned synthetic source passed two direct metadata IDs, nine immediate children across three pages with cached replay, and a two-node branch collection | New selective commands and branch cursor run through the actual development plugin in this bounded fixture |
| Native-backed HTTP path | An 800×600 overview became a visual draft, then a 21-node complete collection was attached; scripted API operations matched, invoked source confirmation and approval, exported approved context and requested current-node preview | The native plugin supplied observations for these HTTP/domain operations on an owned small source; the original selection stayed unchanged. This was not a human semantic review or a native-app test of the new editor UI |

The native run used an isolated local server and development plugin. The installed
0.1.1 application was not overwritten. The browser tests use an actual server and
persistent temporary directories, but their WebSocket Figma peer is synthetic.
The scripted native-backed HTTP path does not establish independent human review,
native rendering pixels or native large-file behavior. All checks listed above
completed. `git diff --check` passed as well. The final focused browser rerun
covers the last UI-only revision/context guard. No standalone lint script is
configured; TypeScript, tests and builds are the project gate.

## Unresolved external/provider boundaries

The reported original **105,837-node real file** has not been exercised through
this new native path. The synthetic large case tests software behavior, not that
file's permission, shape, native memory use or runtime. Figma's `children` API
returns a full immediate-child array; response paging cannot guarantee bounded
native allocation for an extremely wide parent. Native image export cannot be
preempted immediately. Page-change signals and matching bounds do not provide an
immutable Figma revision token, so image, source chunks and selective reads remain
separate observations rather than one atomic version. A version-pinned REST
alternative is not enabled and would need permitted credentials and separate
equivalence tests.

The transfer checksum protects local byte integrity and coverage, not authorship,
sharing permission or agreement with current Figma rendering. A complete source
scope is still unreviewed until a person confirms the intended source references
and approves the semantic meaning. The original Figma document is not edited by
this workflow.

## Reproduce the public automated portion

Use Node 22 or newer. An installed Chrome/Chromium or Playwright Chromium is
required for the browser tests. These commands use generated test data and
temporary local directories:

```sh
npm run check
npm run fixtures:validate
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npx playwright test e2e/acquisition.spec.ts e2e/collections.spec.ts \
  e2e/acquisition-integration.spec.ts e2e/collection-integration.spec.ts \
  e2e/evidence-scope-integration.spec.ts
```

The native portion requires the local development plugin and an explicitly
authorized synthetic Figma fixture; the automated browser emulator is not a
substitute. See [provider boundaries](../research/acquisition-provider-boundaries-2026-10-25.md)
and [ADR 0008](../adr/0008-collection-backed-editor.md) for the scope contract.
