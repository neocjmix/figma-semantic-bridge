# Chunked source collections: verification and blockers

2026-10-25, unreleased working tree. Extends [ADR 0007](../adr/0007-chunked-source-collections.md).
Public evidence is synthetic. Private identifiers, images, pairing credentials and
corporate source data remain outside the repository.

**Later implementation:** visual drafts, collection-backed editor scopes,
selective live reads/branch collection and source evidence transfer were added on
2026-10-26. The “remaining engineering work” below is the **2026-10-25 baseline**,
not the current implementation status. See the
[current collection-backed verification](collection-backed-workflow.md).

## Delivered behavior

The selected subtree is acquired in serial batches of at most 500 nodes and 1 MB.
The server verifies identity, sequence, duplicate IDs, preorder parent relations
and exact child-count closure before publishing a complete source collection.
Every acknowledged batch is durable. A lost reply can replay the last packet;
resume does not restart acknowledged work. Capacity failure is incomplete.

Preflight explains uncertain native cost, explicit 200,000-node/64 MB ceilings and
separate observation consistency. Progress shows observed counts, bytes and elapsed
time. Cooperative pause settles the current batch first. Each run pauses after five
minutes; manual resume requires the same session and a cursor still within its
ten-minute idle lifetime. Known source changes invalidate it. Busy and timeout errors
pause without retry loops; failed cursor release preserves ownership for recovery.

Completed collections support bounded local metadata pages, explicit node-ID and
immediate-child queries, and exact Unicode text continuation through HTTP and MCP.
Text is not included in metadata pages. These reads add no Figma request. Raw data
is clearly unreviewed and never appears in `get_approved_context` automatically.
Existing project captures, approved annotations and project revisions are unchanged.

## Executed evidence

Final gates: `npm run check` passed TypeScript, **292 Node tests** and all builds;
the installed-Chrome browser suite passed **39/39**; both fixture manifests passed;
`git diff --check` passed. No standalone lint script is configured. The initial
full run exposed three outdated test hosts missing PageNode event subscriptions;
their mocks were updated without weakening the read-only source-write assertions.

- Reader: synthetic 105,837-node traversal; complete 200,000-node boundary;
  200,001-node and 64 MB rejection; replay, cancellation and source invalidation.
- Store: synthetic 105,837-node inventory in 212 packets, durable restart and all
  metadata pages; exact long Unicode text reassembly. Missing/duplicate/reordered
  records, invalid ancestry/provenance, forged completion, corruption, orphan packets,
  manifest-write failure, path/symlink and quota cases are covered.
- Actual HTTP/server/MCP: source preparation, complete-only reads, pause/resume,
  restart interruption, busy retry, timeout replay and failed-release ownership.
- Browser: three focused UI scenarios plus browser → actual server → synthetic
  WebSocket → durable disk. The real-route test pauses after packet zero, resumes
  packet one, reads metadata/exact text, reloads and confirms project preservation.
- Built Dev Mode plugin: synthetic read-only host denies document writes while
  selection, bounded capture, chunk reading and cursor release execute.
- **Native Figma Desktop, owned synthetic lab in Dev Mode:** independent 800 × 600
  overview followed by 21 exact structure records, with identical reused PNG bytes;
  a separate 21-node collection; then **5,001 nodes in eleven chunks**, 1,531,920
  recorded bytes, all paged IDs unique and present. That collection took 1,757 ms
  in this single run; this is an observation, not a performance guarantee.

Native checks used an isolated data directory and temporary local development
plugin. Only selection/viewport navigation and reads occurred. The original
selection, installed 0.1.1 application and installed plugin were restored; the
temporary development registration was removed. No production project was used
for this test. The working tree was not released or packaged over the installed app.

Reproduction: Node 22, `npm run check`, `npm run fixtures:validate`, then
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e`.
Native evidence requires the actual plugin and an authorized fixture; unit/browser
emulation does not replace it. Local logs are in ignored `.bridge-local/collections-*`;
private native reports are in `.bridge-local/acquisition-native/`.

## Actual blockers and their implications

| Boundary | Classification | Consequence / next evidence |
| --- | --- | --- |
| The reported work frame with 105,837 nodes is not selected in the available native session, and its file URL/key was not supplied with the photo | External acceptance dependency | Test that authorized scope before claiming real production-scale success; the known owned fixture proves 5,001 native nodes only |
| Plugin observations have no established immutable-revision token | Provider consistency boundary | Page-change invalidation detects known changes but cannot certify image and structure as one atomic revision; a strict requirement stays unresolved |
| Figma `children` returns a full array; native export has no documented abort/progress parameter | Provider cost boundary | Output chunks limit transport/storage, not every native allocation or render; do not promise zero risk or hard time/memory bounds |
| Version-pinned REST alternative | Unimplemented optional provider with access dependency | Requires permitted credentials and explicit field/rendering-equivalence and rate-limit tests; it is not silently enabled |

Official API evidence and the distinction between documented behavior and inference
are in [provider boundaries](../research/acquisition-provider-boundaries-2026-10-25.md).

## Remaining engineering work as of 2026-10-25 (superseded)

- Large collections are raw source inventory, **not** full large-frame editor
  support. Collection-backed region matching, human confirmation, approval and
  portable capture bundles need a shared observation/reference contract and migration.
  They must not be simulated by marking a 10,000-node prefix complete.
- First-time Figma reads still acquire the selected subtree's required fields.
  Selective ID/child/text queries currently save local response and consumer cost;
  they do not avoid that initial traversal. True branch/field-on-demand acquisition
  needs an explicit coverage ledger so unread branches remain unknown.
- Image-only annotation drafts remain unsupported. The overview can be viewed and
  enlarged immediately, but the existing annotation editor requires a complete
  bounded Snapshot.

The engineering items in this historical section were completed by the
[2026-10-26 workflow](collection-backed-workflow.md). The provider and original-file
acceptance boundaries above remain. Current behavior is described in the bilingual UI and
[Korean](../acquisition-workflow.ko.md)/[English](../acquisition-workflow.en.md) guides.
