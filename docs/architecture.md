# Architecture — local source and human review

This describes the 0.2.1 architecture. The normal editor now uses one image-plus-chunked import with locally persisted resource settings; earlier bounded/mode-based APIs remain compatibility paths. See [ADR 0013](adr/0013-configurable-import-budgets.md). Versioned 0.1.1 assets remain a
separate historical baseline. [ADRs](adr/) explain decisions and
[product validation](product-validation.md) distinguishes actual native, browser,
synthetic and package checks.

```text
Current Figma page (unchanged source document)
  ↕ Figma Plugin API: selected identity, bounded records, PNG export, explicit navigation
Figma plugin: one live session and cursor owner
  ↕ ws://localhost:4177/bridge; v3 mutual proof + sealed ordered records
Node.js loopback server
  ├─ plugin broker, preflight/acquisition, selective reads, collection cursors
  ├─ validated project JSON + immutable chunk/observation caches
  ├─ deterministic geometry, source review and approved export
  ├─ authenticated HTTP API for the local browser/development path
  └─ pinned HTTPS desktop/MCP endpoint when packaged
        ↙ React/WKWebView human editor        ↘ stdio MCP for coding agents
```

## Source boundaries

The plugin is a read adapter: it reads the current page and selected subtree,
returns exact metadata/text, exports bounded PNGs, and performs explicit
highlight/navigation. Highlight changes selection and viewport only. It does not
store annotations, edit Figma nodes, load all pages or run inference. Selection
preflight pins file/page/root/bounds before expensive work. Plugin lifecycle and
page changes invalidate live cursors; one authenticated session controls requests.
Native `children` can allocate an entire immediate-child array, and native
`exportAsync` cannot be forcibly preempted. Response packets and time budgets are
application bounds, not native peak-memory guarantees.

The server owns session/revision checks, request cancellation, result validation,
durable writes and source integrity. `ProjectStore` uses atomic local JSON files,
revisioned operations and bounded undo/redo; SQLite is **not** an open persistence
choice for this version. Acquisition jobs, collection chunks and selective
observations have separate caches and retention limits. A completed collection's
project reference is bound to its content hash and source identity; mutations,
approval and approved exports fail closed if required backing evidence is missing
or corrupt. Referenced collections cannot be removed. Backups must include both
project JSON and its bound collection chunks.

The UI edits semantic regions, hierarchy and specification relations. It can
show a visual-only draft with proposed annotations, or attach a complete source
collection to the same file/page/root/bounds without pretending that image and
structure were atomic. Collection-backed source search, overlays and original
TEXT use bounded pages; loaded overlays are labeled against the full node count.
Saved source sets require explicit confirmation before new collection-backed
approval. Optional model output enters a proposal queue and never silently
changes approved records. The MCP surface reads bounded approved context and
live targeted source data, and can stage proposals; it cannot approve meaning.

## Distinct storage and interchange contracts

| Contract | Stored evidence | Completion claim |
| --- | --- | --- |
| Legacy `Snapshot` | Bounded inline nodes, provenance, optional PNG, completeness flag | Only its captured selected subtree when `complete=true`; partial prefixes cannot support new approval. |
| Visual `EvidenceScope` | Overview PNG, bounds/provenance, no inline nodes | Visual observation only; annotations remain proposed. |
| Collection `EvidenceScope` | Immutable complete selected-subtree chunk reference, optional independently timed overview | Structural coverage of that root and descendants; never unseen siblings or one immutable Figma revision. |
| Selective inspection | Immutable ID/field or direct-child observations, separately cached and unreviewed | Only explicit IDs/fields or the enumerated parent's immediate children. |
| Capture bundle / source transfer | Up to two bounded Snapshots / one complete collection plus optional overview | Local byte/coverage validation, not authenticity, permission or semantic approval. |

`src/shared/contracts.ts`, `structure-collection.ts`, `selective-source.ts` and
`source-transfer.ts` define the exact runtime schemas. The primary budgets are
5,000 nodes/2 MB/5 s for legacy bounded metadata capture; normal import defaults to
200,000 nodes/64 MB and allows settings up to 1,000,000 nodes/128 MB, with
500 nodes/1 MB per collection packet; up to 100 selective IDs or 100
direct children per response; and an 80 MB source-transfer file. These are
different contracts. Exact 50,000-code-unit TEXT records are rejected on overflow,
not shortened. See [data model](data-model.md) and
[collection verification](evaluation/collection-backed-workflow.md) for full limits.

## Local trust boundaries

The Figma manifest permits the exact `ws://localhost:4177` endpoint. V3 uses the
pairing token only as a pre-shared key for mutual challenge proofs and directional
session keys; the token itself is not sent in the handshake. Post-handshake
commands, results and control records are encrypted, authenticated and sequenced.
The packaged AppKit/MCP client pins a private local certificate for each HTTPS
connection to the numeric loopback endpoint. The browser's explicit HTTP
development route remains loopback- and token-protected but is not the packaged
native trust channel. See [ADR 0010](adr/0010-plugin-mutual-authentication.md),
[ADR 0011](adr/0011-pinned-desktop-service.md) and the
[security boundary record](release-readiness.md).

The local token is a single-operator capability, not multi-user identity or proof
of a human click. Source text and imported files are untrusted content. The server
validates schemas, source membership, revisions and response budgets, and limits
optional external model transfer. Permission to inspect or share a design comes
from its owner and organization, not from a checksum or MIT license.

## Known limits and future architecture

Figma supplies no immutable source revision across image export, chunk traversal
and selective reads. Root/page checks and change epochs catch observed changes,
not every paint, descendant or external-ancestor change. Axis-aligned BBoxes,
visibility and local opacity cannot establish actual pixel occlusion or semantic
correctness. Effective Dev-only can-view access to another owner's file, native
performance on the reported original 105,837-node file, independent human
accuracy/productivity and organization policy remain outside the executed proof.
Automatic reconciliation, cloud collaboration, a version-pinned REST alternative
and other-platform installers require separate design and acceptance work.
