# Data Contracts — Draft

## Implemented external source scopes (unreleased, 2026-10-26)

The runtime contracts in `src/shared/contracts.ts` are authoritative. Optional `Project.scopes` stores `EvidenceScope` records with kind `visual` or `collection`; IDs are unique across scopes and legacy snapshots. `Annotation.snapshotId` and each source reference may address either kind. Visual scopes contain an overview and proposed regions only. Collection scopes reference a complete immutable collection by ID, content hash, node/byte counts and observation time. An explicit equal-file/page/root/bounds attachment upgrades a visual scope once and invalidates earlier review. Every collection annotation requires human source-set confirmation. Original text remains exact and must resolve from the verified collection.

Selective inspections are separate immutable unreviewed observations. `fieldCoverage` distinguishes unread text, observed text and non-text records. Immediate-child completion does not mean descendant completion. Neither selective observations nor imported source transfers carry human approvals. The legacy Snapshot and capture-bundle size limits are unchanged.

Use versioned runtime-validated schemas. These are conceptual types, not frozen API signatures.

```ts
type Rect = { x: number; y: number; width: number; height: number };
type Origin = "human" | "ai";
type ReviewStatus = "proposed" | "approved" | "rejected";
type Role = "page" | "section" | "component" | "element" | "specification" | "ignore";
type MatchType = "exact" | "contained" | "partial" | "aggregate";

interface SourceNode {
  id: string;
  parentId?: string;
  type: string;
  name: string;
  bbox: Rect;
  text?: string;
  visible: boolean;
  rendering?: { opacity?: number; siblingIndex?: number };
  sourceFileKey: string;
  sourcePageId: string;
  childrenIds?: string[];
}
interface SourceReference {
  nodeId: string;
  matchType: MatchType;
  coverage?: number; // geometry only, not calibrated probability
}
interface Annotation {
  id: string; // independent from Figma node ID
  name: string;
  role: Role;
  bbox: Rect; // Figma document coordinates
  parentId?: string;
  childIds: string[];
  sourceRefs: SourceReference[];
  origin: Origin;
  reviewStatus: ReviewStatus;
  revision: number;
}
interface SpecRelation {
  targetAnnotationId: string;
  relationType: "describes" | "behavior" | "constraint" | "interaction" | "dependency";
  reviewStatus: ReviewStatus;
}
interface Specification {
  id: string;
  text: string; // exact extracted text
  sourceRefs: SourceReference[];
  relations: SpecRelation[];
  origin: Origin;
  reviewStatus: ReviewStatus;
}
```

## Required envelope
Persist schemaVersion, source file/page/scope identity, source revision/fingerprint if available, coordinate transform, annotations, specifications, provenance and unresolved questions. Track patch history for undo and audit.

## Invariants
- Semantic parent graph is acyclic; spatial overlap is allowed.
- Source node may be referenced by multiple annotations and vice versa.
- Specs link to multiple components and components to multiple specs.
- Missing/stale source references do not delete annotations.
- AI patches cannot silently overwrite approved human records.
- Original text remains verbatim; interpretation is separate.
- A geometry score is not semantic certainty.

## Schema implementation tasks
Define Zod/JSON Schema validators, migrations, stable ID strategy, patch operations, optimistic concurrency and import/export canonicalization. Test equal BBoxes, tolerance ties, rotations, clipping, hidden layers, conflicting specs and missing nodes.

## Implemented rendering evidence

`SourceNode.rendering` optionally records observed local `opacity` (finite 0..1)
and `siblingIndex` (the nonnegative index in the original captured child array).
New captures always emit the object, leaving unsupported or invalid opacity
unrecorded. Root sibling order is omitted: capture does not read external parents
or siblings. Sibling index is local context, not global paint order or an occlusion
proof. Old snapshots are not backfilled with assumed values.

The bounded ancestry index derives these states without changing source records:

| State | Evidence |
| --- | --- |
| `hidden` | An observed node or ancestor has `visible=false`. |
| `transparent` | An observed node or ancestor has `opacity=0`, with no observed hidden ancestor. |
| `unknown` | Opacity is missing along the observed chain, or an ancestor outside the capture is not the page boundary, without known hidden/zero-opacity evidence. |
| `potential` | Visibility and positive opacity are observed along the chain to the page boundary. Actual pixel contribution remains unverified. |

Hidden evidence takes precedence over transparency; either takes precedence over
unknown evidence. Tiny positive values are not multiplied into a false zero.
Automatic geometry matching excludes hidden and transparent subtrees. Their IDs,
geometry, exact text and rendering fields remain stored and manually selectable.
Clipping, masks, blending, external overlays and design age are not inferred from
these states. The scope and remaining limits are defined in
[ADR 0002](adr/0002-rendering-evidence-grounding.md).

## Implemented source review addition

The runtime contract in `src/shared/contracts.ts` adds optional
`Annotation.sourceReview`: up to 200 geometric candidates (node ID, coverage, IoU,
reason), ambiguity, warnings, optional `renderingReviewRequired`,
`unconfirmed | confirmed` status and a nullable confirmation time. The annotation's
snapshot, BBox and source references identify the evidence and chosen set.
Rendering review is separate from geometric ambiguity and semantic `reviewStatus`.

Only an explicit human confirmation operation can create confirmed evidence;
project and annotation revisions reject stale decisions. A changed source set,
BBox or snapshot invalidates it. Approval requires confirmation when either
`ambiguous` or `renderingReviewRequired` is true. Manually selected hidden or
transparent references require rendering review. Unknown references also require
it when the snapshot carries the new rendering evidence; legacy unknown captures
retain their previous approval behavior.

Every new transition to approved recalculates rendering review from captured
references, including legacy pending annotations with already-saved diagnostics.
A name-only edit cannot bypass that check. Unchanged geometry and references retain
an existing human source confirmation. Already-approved records remain unchanged
on load or export. AI proposals cannot supply source confirmation. See
[ADR 0002](adr/0002-rendering-evidence-grounding.md) for the rendering limitations.

## Transient current node export

`POST /api/projects/:id/source-preview` accepts only `expectedRevision`,
`annotationId`, `expectedSessionId` and `nodeId`. The annotation must be saved and
the node must belong to its captured snapshot. The server derives file/page/node
identity from that snapshot and sends one `preview_node` plugin command. The
command exports that node and its descendants with `contentsOnly=true` and
`useAbsoluteBounds=true`; it does not traverse descendant metadata, modify source
nodes, change selection or load another page. PAGE, DOCUMENT, SLICE and SECTION
are excluded from current node export. A SECTION capture still preserves bounded
metadata, but stores `preview=null` with an unsupported-mapping warning; an inner
Frame must be explicitly captured for an image. Old snapshots are not rewritten.

`SourcePreviewResult` contains project/revision/annotation/snapshot/session IDs
and a `NodePreviewResult`: file/page IDs, the observed `SourceNode`, `observedAt`,
PNG `preview` and warnings. The saved crop uses `snapshot.source.capturedAt`;
the returned image is a separate current observation, not a replacement or
historical rendering of that snapshot.

The plugin checks current identity, ancestry and node metadata before and after
export. The server compares name, type, parent, BBox, exact text, visibility and
captured opacity when present, then rechecks project revision and session. Sibling
order is not re-read. This is not a style or subtree fingerprint: changes to
descendants, paints and external ancestors may remain undetected. Outside siblings
are excluded from export; ancestor opacity, clipping, masks, blending and actual
pixel contribution or occlusion remain unverified.

Limits are one explicit export, at most 1,024 pixels per dimension, 2,000,000 PNG
bytes before base64, and a cooperative 5-second deadline within broker cancellation
and timeout handling. Native export memory and runtime cannot be bounded or
preempted before completion; late/cancelled results are discarded. Unsupported
transforms and dimension mismatches are rejected, without guessed offsets.

No result is persisted to a project, snapshot, source review or history; project
revision, references, confirmation and semantic approval remain unchanged. Bundles
and approved MCP context exclude the result. The web view clears it on project,
capture, annotation, revision or plugin-session change and ignores stale responses.
See [ADR 0002](adr/0002-rendering-evidence-grounding.md) for the evidence boundaries.

## Implemented capture bundle

`src/shared/capture-bundle.ts` defines the strict portable capture contract:

```ts
interface CaptureBundle {
  kind: "figma-semantic-bridge.capture-bundle";
  version: "1.0.0";
  exportedAt: string;
  snapshots: Array<{ snapshot: Snapshot; sha256: string }>;
}
```

One compact UTF-8 JSON file contains one or two explicitly selected snapshots.
Each Snapshot uses the existing runtime contract in `src/shared/contracts.ts` and
is preserved unchanged: IDs, file/page/root provenance, capture time, nullable
revision, BBoxes, exact text, visibility, optional rendering evidence, PNG bytes or
`null`, completeness and warnings.
Copied files retain their own provenance. The format has no semantic annotation,
specification, proposal, approval or credential fields; unknown fields are rejected.

The codec in `src/server/capture-bundle.ts` hashes each snapshot's recursively
key-sorted JSON with SHA-256, preserving array order and scalar values. It validates
the digests, existing project identity/ancestry/completeness invariants, root BBox
equality with snapshot bounds, and PNG base64/header dimensions. This checks data
integrity, not authenticity, permission, rendering fidelity or live source freshness.
The aggregate limits are 10,000 nodes, 4,000,000 UTF-8 bytes of serialized node arrays
and 15,000,000 UTF-8 bytes for the complete serialized bundle.

Export is read-only and requires an expected project revision. Import always creates
a new local project identity at revision 0 with empty annotations, specifications
and proposals; it cannot merge into or replace an existing workspace. Consumers
need a running, paired local server, but no Figma connection or Dev seat for import
and local review. Approved-context export remains a separate contract. See
[ADR 0003](adr/0003-portable-capture-bundles.md) for the route contracts and boundaries.
