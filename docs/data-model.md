# Data model and source-evidence invariants

This documents the 0.2.1 implementation, not a frozen third-party SDK.
`src/shared/contracts.ts`, `structure-collection.ts`, `selective-source*.ts`,
`source-transfer.ts` and `capture-bundle.ts` define the exact Zod contracts;
`src/core/project.ts` and server storage add cross-record validation. The project
data schema is still `1.0.0`, independent of the application version. Optional
new fields let existing projects load without silently changing their approvals.

## Persisted project and source kinds

`Project` has ID, name, schema version, monotonic revision and update time;
arrays of `snapshots` (at most 30), `annotations` and `specifications` (at most
2,000 each), `proposals` (at most 100), and optional `scopes` (at most 30). IDs
for legacy Snapshots and new scopes are unique together. Project JSON does not
contain a 200,000-node collection.

| Kind | What the project stores | What it establishes |
| --- | --- | --- |
| `Snapshot` | `source` file/page/root/revision/capture time, document `bounds`, 1–10,000 inline `SourceNode`s, nullable PNG, `completeness` and warnings. | A bounded selected subtree if complete; a limit-hit prefix remains incomplete. |
| Visual `EvidenceScope` | Same explicit source identity/bounds, PNG, visual task/observation time, no inline nodes and `collection=null`. | Image observation and proposed regions only. Matching, confirmation and new approval require structure. |
| Collection `EvidenceScope` | Source/bounds, optional separately timed PNG and a required immutable collection reference: ID, SHA-256 content hash, node/byte counts, observation time. | Verified complete traversal of its root and descendants, possibly a branch; no claim about its siblings or an atomic Figma revision. |

`Annotation.snapshotId` and `SourceReference.snapshotId` retain their wire names
for compatibility but may address either a legacy Snapshot or an EvidenceScope.
EvidenceScopes are created/attached only through trusted server routes with
revision and backing checks; generic mutation cannot forge completion. Attachment
requires equal file/page/root/bounds and resets existing visual-draft regions to
proposed with source review invalidated. A referenced collection cannot be
removed. Missing, altered or corrupt backing chunks block new review and
approved export. Back up project files **with** their referenced collection data.

## Exact source records and geometry

`SourceNode` stores `id`, nullable `parentId`, type, name, nullable axis-aligned
absolute `bbox`, optional exact `text`, `visible`, nullable `sourceFileKey`, page
ID and optional local `rendering` (`opacity`, `siblingIndex`). IDs are bounded to
160 characters, names to 1,000, and text to 50,000 JavaScript string code units.
Text over that limit is rejected rather than truncated or replaced with OCR.
Some non-rendered nodes have no positive-area box; annotation and scope rectangles
require finite positive width and height. The captured root's bounds must equal
the scope bounds. Figma source ancestry stays separate from semantic hierarchy.

Coordinates are Figma document coordinates, including negative positions. PNG
width/height and mapping are validated; an unsupported rotated/reflected/skewed
root or SECTION can retain metadata with `preview=null`. Descendant transforms,
masking, clipping and external overlays can make an AABB a poor visual silhouette.
Original text and coordinates are evidence, not instructions or inferred behavior.

`SourceNode.rendering` records observed local opacity in [0,1] and original
captured sibling index where available. The selected root has no outside-sibling
index. Derived review states are:

| State | Evidence | Limit |
| --- | --- | --- |
| `hidden` | Node or captured ancestor has `visible=false`. | Does not delete the source record. |
| `transparent` | Node or captured ancestor has observed `opacity=0`, absent known hidden evidence. | Does not explain why a PNG is blank. |
| `unknown` | Missing opacity or an unobserved ancestor outside the page boundary, absent stronger evidence. | Do not infer visibility. |
| `potential` | Visible and positive-opacity chain observed to the page boundary. | Not proof of contributed pixels or design age. |

Known hidden/transparent subtrees are excluded from automatic geometric matches,
but retain IDs, text and boxes for explicit human selection. Sibling index is
local order, not a general paint/occlusion proof. Legacy records are not
backfilled with invented opacity. See [ADR 0002](adr/0002-rendering-evidence-grounding.md).

## Semantic records and approval

An `Annotation` has independent ID, scope ID, name, role, document BBox, nullable
semantic `parentId`, zero-to-many source references, human/AI origin, proposed/
approved/rejected status and per-record revision. Children are **derived** from
parent links; there is no stored `childIds` field. Each reference includes scope
ID, node ID, match type (`exact`, `contained`, `partial`, `aggregate`) and optional
geometric coverage in [0,1]. One source may support multiple annotations and one
annotation may reference multiple sources. The semantic parent graph is acyclic;
spatial overlap is allowed.

`sourceReview` records up to 200 candidate diagnostics, ambiguity, warnings,
optional rendering-review requirement, `unconfirmed|confirmed` and confirmation
time. Geometric candidate scores are not semantic confidence. A new collection-
backed annotation needs complete verified backing, selected references and
explicit source-set confirmation before approval. A legacy Snapshot needs
confirmation when geometric or rendering evidence calls for it. Changing a
reference set, BBox or source scope invalidates its confirmation. A stale
project/annotation revision cannot confirm an old decision. AI proposals cannot
provide source confirmation or silently overwrite approved human work.

A `Specification` contains 1–100,000 code units of verbatim original text,
one-to-many source references, many-to-many typed relations to annotations,
origin, review status and revision. A new approved specification needs approved
targets and reviewed relations. Exact text is checked against its saved source
records; display formatting does not replace it. Approved-context packaging
withholds an approved child beneath an unapproved semantic ancestor and a spec
without an exportable approved target. It reports unresolved/truncated output
instead of presenting omitted data as complete.

## Large and selective observations outside Project JSON

Import resource settings are separately persisted with their own revision. They change future reads/resumes, not saved observations or approvals. Normal collection records may refer to their overview acquisition and record a node/byte/time/user/busy pause reason.

Collection packets are preorder records with root/bounds/file/page identity,
timestamps, ordered sequence, per-node direct-child counts and a closed-frontier
completion flag. Each packet is at most 500 nodes/1 MB; one collection has a safety ceiling of
1,000,000 nodes/128 MB (default operating budgets: 200,000 nodes/64 MB). The store validates unique IDs, ancestry, exact counts,
bytes, order and complete traversal before exposing a descriptor. There are at
most twelve cached collections/512 MB locally. Pause takes effect after a durable
packet; same-session resume is time-limited. A server restart or changed plugin
session cannot rehydrate a live Figma cursor as an unchanged source revision.

Selective inspection pins one file/page/root and stores immutable, digest-checked
unreviewed observations separately from Project. Explicit-ID reads request up to
100 IDs with metadata or exact text, at most 1 MB per observation. Immediate-child
reads return up to 100 text-free records and 96 KB per page, with an ordered cursor
and explicit `childrenComplete` only after all direct children were received.
An ID read does not establish child coverage; an immediate-child inventory does
not establish descendant coverage. An explicit branch collection covers only that
branch. Stored inspection history is bounded (twelve inspections/32 MB total).
The proposed general cross-observation coverage ledger in
[ADR 0009](adr/0009-selective-source-acquisition.md) is not implemented.

For complete collections, local metadata queries return at most 200 records per
request under a 96 KB response-page budget. They omit original text but include
its length. Exact text is requested by node ID in up-to-4,000-code-unit segments;
offsets do not split a UTF-16 surrogate pair. Selected full source records can be
resolved under a separate bounded response. These pages are views of verified
storage, not a claim that the browser loaded every node.

## Transfer, previews and trust

The legacy capture-bundle format moves one or two bounded Snapshots in a compact
JSON file (10,000 aggregate nodes, 4 MB node JSON, 15 MB file). Import creates a
**new workspace** with no annotations, specs, proposals or approval. The separate
source-transfer NDJSON format moves one complete collection, exact text and an
available overview (80 MB file maximum). Import verifies each chunk, checksum,
footer, EOF and complete coverage before adding a fresh unreviewed scope to the
**current workspace**. Neither digest establishes authorship, permission or
agreement with today's Figma pixels. See [ADR 0003](adr/0003-portable-capture-bundles.md)
and [ADR 0008](adr/0008-collection-backed-editor.md).

A current-node PNG comparison is a transient read, not persisted in Project or
approved context. It verifies current file/page/session, saved node membership
and selected metadata, with a 1,024-pixel-per-dimension, 2 MB PNG and cooperative
5-second limit. It does not fingerprint descendants, paints or external ancestors,
and native export cannot be preempted before completion. Comparison never changes
references, revision, confirmation or semantic approval.

The local pairing token, original text, PNGs and backups are sensitive. Project
revisions and strict schemas protect consistency, not human identity. Approved
operations are authorized by the local token holder; a scripted API confirmation
is not proof that a person understood the design. Figma content is untrusted data
for both optional model calls and downstream coding agents.
