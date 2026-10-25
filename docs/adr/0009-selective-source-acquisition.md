# ADR 0009 — Selective current-page source reads

Status: 2026-10-25 proposal; a narrower variant was implemented on 2026-10-26.
Extends [ADR 0006](0006-image-first-lazy-acquisition.md) and
[ADR 0007](0007-chunked-source-collections.md). The detailed command/ledger design
below is historical where it differs from the implementation. Current commands
are `read_source_nodes` and `read_source_children` (up to 100 children per packet),
plus complete branch collection through the chunk reader. Explicit observations
are stored separately and never imply whole-frame coverage. See the
[current verification](../evaluation/collection-backed-workflow.md); a general
cross-observation coverage ledger remains a separate design, not a delivered claim.

## Decision and scope

Offer three distinct operations for a pinned, current-page source scope:

1. Read metadata for explicit node IDs, with exact text only when requested.
2. Enumerate one parent's immediate children as bounded response packets, without
   descending into them or reading their text.
3. Collect a user-chosen container branch in full with the existing
   `StructureReader` and durable chunk store.

The requester defines the result before acquisition: known IDs and required fields,
one or more branch inventories, or discovery of an entire frame. Completing a
known-ID request never proves that no other source exists. Completing a branch
collection proves only coverage under that branch root; the containing frame and
unopened sibling branches remain unexamined. No existing 10,000-node Snapshot limit,
200,000-node/64 MB collection limit, review gate, or source consistency claim changes.
Only explicitly required evidence may make a **task** complete. An exhausted budget
leaves its requirement pending rather than silently reducing the task scope.

Use a complete stored collection first when it already covers the requested IDs
and fields. Live selective reads are additional observations, not edits to a
Snapshot, approved annotation, or completed collection. This ADR does not make
partial collections queryable or approved coding context.

## Provider evidence and limits

`figma.getNodeByIdAsync(id)` resolves an ID in the current document or returns
`null`; it is not a page-scoped lookup. Only the current page is guaranteed fully
loaded under dynamic page loading. The adapter must check the returned node's
parent chain against the pinned current page and requested scope, while never
calling `loadAllPagesAsync`, explicitly loading another page, or changing
page/selection.
An async lookup of an arbitrary ID may itself access data from another page before
the ancestry check; accepting only IDs previously observed under the current-page
root is the stricter first UI path. [Figma node lookup](https://developers.figma.com/docs/plugins/api/figma/),
[dynamic page access](https://developers.figma.com/docs/plugins/accessing-document/).

`children` returns the full, newly allocated, read-only array of immediate children
in back-to-front order. Figma documents no native pagination for this property and
warns that repeated recursive `children` traversal can be slow in large files.
Packetizing our response limits transport and serialized output, **not** that native
array allocation or traversal cost. `findAll`/`findAllWithCriteria` are not a
bounded continuation contract for ordered, complete immediate children.
[Figma children](https://developers.figma.com/docs/plugins/api/properties/nodes-children/).

`TextNode.characters` is the raw string. Reading it only on an explicit text
request keeps metadata exploration text-free; packetization cannot prevent the
plugin from first receiving the full native string. The current `SourceNode` schema
allows at most 50,000 JavaScript string code units, so a longer exact value must fail explicitly
until a separately designed long-text observation exists. Never truncate it or
substitute OCR. [Figma characters](https://developers.figma.com/docs/plugins/api/properties/TextNode-characters/),
[`SourceNodeSchema`](../../src/shared/contracts.ts).

`PageNode.on('nodechange')` reports page node creation, deletion and property
changes. It supports invalidating an active read, but asynchronous notifications,
root checks and timestamps do not establish one immutable Figma revision.
[Figma page events](https://developers.figma.com/docs/plugins/api/properties/PageNode-on/).
`figma.fileKey` is restricted to private plugins and Figma-owned resources; the
current local manifest requests that API. If it is unavailable in a deployment,
provenance-dependent live attachment fails closed rather than inventing a key.
[Figma fileKey](https://developers.figma.com/docs/plugins/api/figma/),
[`manifest.json`](../../plugins/semantic-bridge/manifest.json).

## Minimum command and response contract to implement

These are proposed contracts, not current shared schemas. The server binds every
request to its pinned plugin session and sends `fileKey`, `pageId`, `scopeRootId`
and a request/observation ID. The plugin confirms file, current page, scope-root identity
and ancestry before and after the read. All commands remain serialized through the
existing bridge generation/cancellation gate. A page change, node-change epoch,
generation change, timeout or cancellation prevents publication of an unverified
result. Reads temporarily set `skipInvisibleInstanceChildren=false` and restore
its previous global value in `finally`.

| Operation | Request and bounded result | Completion statement |
| --- | --- | --- |
| `read_source_nodes` | Explicit IDs (initially at most 100), `fields: ['metadata']` or `['metadata','text']`; return per-ID source metadata without `text` for metadata-only reads, plus per-field availability and errors. Cap serialized response at 1 MB. Reject IDs outside pinned ancestry, duplicates, and an over-budget result rather than omitting records. | Only the listed IDs and returned fields were observed. |
| `list_source_children` | Explicit parent ID inside scope; one session cursor owns one native `parent.children` array. Return up to 200 ordered, text-free child summaries and at most 96 KB per packet, with parent identity, total child count, packet sequence, next sequence, and replay of the last packet. A zero-child parent returns an explicit empty, complete inventory. | `childrenComplete` only after every declared child ID/order is durably received and validated; descendant trees remain unknown. |
| `prepare_branch_collection` | Explicit previously observed container ID plus project revision/session and parent observation reference; verify it remains below the pinned scope, has positive bounds and matches the plugin's source metadata. Start the existing `read_structure_chunk` traversal at that ID without changing selection. | Existing collection frontier closes only for this branch root; `CollectionView.source.nodeId` is the actual branch root. |

The current plugin mapper in [`structure-reader.ts`](../../src/figma/structure-reader.ts)
reads `characters` for every `TEXT` node. Reuse that mapper for full branch
collections, but introduce a distinct text-free metadata projection for the first
two operations; merely deleting `text` after mapping would still read the native
string. For `fields: ['metadata','text']`, read exact `characters` only on requested
text nodes. A requested empty string is `loaded` with `text: ''`; omitted/unread
text is `unloaded`, and non-text nodes are `not-applicable`. Keep these states
separate from `null` and from read failure. Preserve original name, coordinates,
visibility and parent. A direct ID lookup may omit the optional sibling index;
do not read the parent's whole `children` array merely to manufacture it. An
explicit child inventory supplies exact sibling order. Reject schema overflow
without truncation.

The current server [`prepare`](../../src/server/structure-collections.ts) pins the
Figma selection. Add a separate explicit-ID preparation path rather than changing
that behavior. It must obtain the source description from the plugin, not trust a
client-supplied name, type or bounds. The collection store already accepts a root
whose `parentId` is outside the collected subtree; record the containing scope
separately so the UI cannot label it as a whole-frame inventory. A child-list cursor
and the `StructureReader` DFS cursor share one plugin-side ownership budget: do not
retain both native child arrays at once. Release on completion/removal, source
change, bridge generation replacement, and bounded idle expiry. Keep the final
packet replayable until it is acknowledged or the cursor is released. Resume/replay is
valid only in the same session/epoch. A lost reply may replay the last packet; a
missing or older sequence cannot advance or finish coverage.

## Coverage and immutable observations

Store each validated read as an append-only observation linked to the project,
source file/page, requested scope root, actual node or parent, plugin session and
generation, start/end times, page-change epoch, requested fields, response bytes,
and its predecessor/parent observation. Record status separately for each ID's
metadata and text and each parent's child inventory: `unloaded`, `partial`,
`complete-for-request`, `failed` or `stale`. A child inventory records its ordered
IDs, declared count and acknowledged packet sequences. A branch collection records
its own root, chunks, frontier and `complete-for-subtree` state. The ledger must
represent unexamined sibling branches and outstanding human review, not just a
loaded node count. Persist a completion marker only after all expected IDs, fields
or child packets are verified; an empty pending queue is not proof of coverage.

Do not insert these observations into an existing Snapshot or amend a completed
collection's bytes. Existing approved human annotations and their source links
remain unchanged. A future review/reference contract may explicitly attach a new
observation to an annotation; that requires its own migration and approval rules.
Store historical observations even when later reads change, but mark their live
freshness as unknown/stale. A stored digest proves local byte integrity, not source
freshness. Several live observations cannot be promoted to one whole-frame version
without an equivalent immutable revision guarantee; absent that guarantee, the UI
must disclose `separate observations` and the exact remaining task requirements.

The first UI flow is: pin selected frame and optional overview; inspect explicit
IDs or expand only a chosen parent's immediate children; choose a child branch for
full collection when the task requires its descendants; read exact text only for
specified text nodes; review the ledger and source evidence before claiming the
defined task complete. A region drawn on the image alone does not identify all
contributing nodes, and children can extend outside a parent's box. Such a task
needs an explicit discovery plan or remains incomplete.

## Verification before implementation is declared complete

Use synthetic, read-only plugin mocks to prove metadata/child inspection never
touches `characters`, document writes, selection, or unrelated page children;
hidden instance descendants are included and the skip flag is restored on every
exit. Test exact empty/Unicode text and over-limit errors, ordered wide-parent
pagination/replay, one-cursor ownership/TTL, cancellation and page/generation
invalidation, scope ancestry rejection, durable ledger recovery, and that a
complete branch leaves its containing frame unexamined. Then run a bounded owned
native Figma fixture check. The reported real 105,837-node frame and immutable
same-revision acquisition remain unverified by this proposal.
