# ADR 0002: bounded rendering evidence for source grounding

Status: Accepted for the initial Figma-assisted review slice on 2026-10-23.
Opacity evidence and on-demand node export comparison were accepted on 2026-10-24. See the later accepted slices below;
global paint order and occlusion proofs remain proposed.

User requirement confirmed on 2026-10-23: for ambiguous source composition, show
what the selected region represents visually and ask the human to confirm its
source set. A deterministic geometric choice alone is insufficient.
The user also requested using Figma itself for this review, rather than making
the web application reproduce every native inspection capability.

Preferred review workflow:

1. Start from the semantic region and its captured preview in the local app.
   Send the review context to the existing Figma bridge and inspect candidates
   on the actual Figma canvas/layers. Native navigation is an aid, not approval.
2. The human selects an intended source node in Figma and explicitly adds it to
   a local review set. Repeat for nodes in distant tree branches; selection changes
   alone never commit or approve the source set.
3. Dev Mode officially exposes one selected node at a time. Accumulate choices in
   the review set instead of requiring native multi-selection. Show/remove/reset
   the accumulated set independently of the current native selection.
4. Show the region, selected references and remaining uncertainty, then let the
   human confirm, adjust or leave unresolved. Store the decision in the bridge.
   Figma canvas inspection is primary; local candidate previews are supplementary.

The smallest slice can reuse existing `highlight_nodes` and `get_selection`
requests with explicit local-app buttons. A subsequent Inspect-panel UI can offer
Add current node and Confirm here after a bounded review-session protocol exists.
Bind native selection import to project revision, snapshot, host file key, page
and plugin session. Recheck revision/session after the asynchronous request.
Source confirmation is a separate human operation on the saved annotation revision;
it reviews captured references and does not assert that the live file is unchanged.
Reject stale native imports and stale annotation confirmations; preserve approved data.
Only captured node IDs can enter the current single-snapshot annotation contract;
uncaptured selections need an explicit bounded capture workflow, not silent
whole-page expansion or fabricated provenance. Changed source observations require
recapture/review, not overwriting old snapshots.

Official docs support read-only Inspect UIs, selection reads and selection events:
[Dev Mode](https://developers.figma.com/docs/plugins/working-in-dev-mode/),
[single-selection limit](https://developers.figma.com/docs/plugins/accessing-document/).
Actual Desktop Dev Mode capture and single-node navigation succeeded on the owned
synthetic fixture. Dev-only account access to someone else's file remains unverified. Native human
selection must remain usable if programmatic highlighting is rejected. Do not
draw review rectangles, change opacity/visibility, reorder layers or save review
metadata into the source document.

A semantic region can combine nodes from distant branches of the original tree.
Old and new designs can also occupy identical coordinates while one is transparent
or covered. Source identity, geometric fit and visible contribution must therefore
remain separate facts; none establishes that a node is the current design version.

Behavior at the initial 2026-10-23 decision (superseded by accepted slices below):

- An annotation supports multiple source references within one captured snapshot.
  Matching retains unrelated branches and removes descendants only when a chosen
  original ancestor already covers them. Uncaptured branches remain unavailable.
- Matching excludes `visible=false` nodes and their captured descendants. The
  source schema has no opacity, paint order or per-node clipping/mask evidence.
  Ancestors outside the selected subtree and outside overlays are unobserved.
- Equal BBoxes produce a deterministic depth/ID suggestion and `ambiguous=true`.
  The project now retains up to 200 candidates, ambiguity and warnings in optional
  `sourceReview` evidence. The web UI shows composite crops, native navigation,
  explicit selection import and searchable/paged access to all captured nodes.
- Masks, clipping and transforms currently produce capture-wide warnings. BBoxes
  and a flattened preview cannot establish which overlapping node supplies pixels.

Implemented initial contract:

- Native selection import returns one validated reference without mutating saved
  annotations. Additions accumulate in the local draft; Save persists the set.
  Node ID, name, type and BBox must match the captured scope. This check cannot
  detect every live text or rendering change; it is not a content fingerprint.
- `confirm_annotation_sources` is human-only and binds to annotation revision.
  Ambiguous, unconfirmed grounding cannot be approved. Source, geometry or snapshot
  edits, rematching, splitting and merging invalidate confirmation. Name, role and
  parent edits retain source confirmation but reopen semantic approval.
- Incoming review fields cannot forge confirmation. AI proposals discard them.
  Legacy approved annotations remain unchanged; legacy proposed records receive
  diagnostics when edited, matched or reviewed. The schema addition is optional.
- Local previews crop the captured composite. They do not isolate overlapping
  nodes or show a hidden version. Confirmation remains a human judgment, not a
  claim of pixel verification. Native inspection provides additional context.

Remaining decisions, in implementation order:

- The review surface must show the captured region crop alongside candidate evidence,
  using the native Figma canvas/selection and a local source set. Equal-position BBox
  outlines are not distinguishing evidence: fetch bounded, on-demand per-node
  previews through read-only export where supported. Never reveal a hidden source
  by editing its visibility/opacity. A blank or unavailable preview stays explicit.
  Allow confirm, adjust, or leave unresolved; absence of a response is not approval.
  Record the snapshot, reviewed candidates and chosen references with human review.
  Visual/model suggestions may assist comparison but cannot bypass confirmation
  or authorize sending source images to an external provider.
- Keep raw source records, coordinates, exact text, parent IDs and provenance even
  when a node is excluded from automatic visual candidates. Manual source selection
  remains available, with its reason and review state separate from geometric fit.
- Add bounded optional evidence for local opacity, observed ancestor visibility and
  opacity, original sibling order, and relevant transform/clip/mask/paint properties.
  Derive effective visibility only where observed ancestry supports it. A missing
  field or ancestor means unknown, never an assumed opaque or visible node.
- Exclude a certainly hidden or zero-opacity node from automatic visual candidates.
  Preserve separate states for hidden, transparent, potentially visible and unknown;
  these states describe rendering evidence, not component meaning or design age.
- Mark full occlusion only when later paint coverage is provably opaque over the
  entire relevant region, respecting actual paint order, transforms, clipping,
  masks, effects and blending. Partial coverage and unsupported paint behavior stay
  uncertain. Bounding-box containment alone cannot prove occlusion.
- Use a conservative first implementation for demonstrably opaque simple geometry.
  Preserve covering-node references and the proof conditions. Do not infer “old” or
  “new” from position, node ID, layer name, opacity or order.
- Compare ambiguous candidates with source paths, rendering evidence, original-node
  navigation and explicit selection. Replace the first-500 manual cutoff with
  bounded search/pagination so later captured candidates remain reviewable.
- Keep selection-scoped capture and existing node/time/byte budgets. Evidence is
  scoped to the captured subtree; unseen ancestors and external overlays remain
  unknown. Do not expand to a whole-page dump to resolve an uncertain match.
- Define additive schema fields, runtime validation, persistence/export behavior
  and migration before implementation. Existing snapshots retain unknown evidence;
  recapture must not invent historical opacity or paint order. Stable node IDs
  identify sources but must not substitute for visual order.

Required verification:

- Unrelated branches contribute to one semantic region without rewriting ancestry.
- Local opacity zero and a captured zero-opacity ancestor exclude visual candidates
  while preserving source records; an absent ancestor remains unknown.
- Partial opaque coverage remains uncertain; complete coverage is accepted only
  when all supported proof conditions hold. Masks/effects/blends fail conservatively.
- Same-position old/new candidates remain ambiguous until human review; changing
  IDs without changing actual paint order does not change rendering conclusions.
- Overlays outside the captured subtree are reported as outside the evidence scope.
- Ambiguity and candidate reasons survive API persistence, reload and review; large
  candidate sets stay bounded and searchable beyond the first 500 source nodes.
- An ambiguous suggestion cannot become reviewed grounding until the human confirms
  the displayed source set; unavailable previews and unresolved choices stay open.
- One-at-a-time native selections accumulate across unrelated branches without
  auto-approval. Remove/reset, disconnect, changed revision and wrong-file selection
  cannot accidentally confirm a stale or different region.

Synthetic tests establish these contracts. Native Figma rendering and Dev Mode
permissions require separate read-only execution evidence. This proposal does not
claim native support or authorize edits to original Figma documents.

## Accepted opacity evidence slice 2026-10-24

The next additive slice records optional `SourceNode.rendering` with observed
`opacity` (finite 0..1) and `siblingIndex` (nonnegative original child-array index).
Capture always emits the rendering object, even when no supported opacity property
exists. Existing snapshots have no fields backfilled. Root sibling order is omitted;
reading external parents, siblings or whole pages is not part of this slice.
Sibling index is local ordering context, not global paint order or occlusion proof.

A pure bounded ancestry index reports hidden, transparent, unknown or potential.
Hidden means an observed node or ancestor has visible=false; transparent means an
observed opacity is exactly zero. Missing opacity or an unobserved non-page
ancestor means unknown. Potential means positive opacity and visibility along the
observed chain to the page boundary; actual pixel contribution remains uncertain.
Do not multiply tiny positive opacity values into a false zero. Automatic geometry
matching excludes hidden/transparent nodes, preserving their full source data and
manual selection. No state identifies design age or proves coverage by another node.

Source review adds an optional `renderingReviewRequired` flag, separate from
geometric ambiguity. Manual hidden/transparent references require confirmation.
For captures carrying the new rendering evidence, unknown selected references also
require confirmation. Legacy unknown observations keep their existing approval
behavior and remain visibly unknown; already approved data is never rewritten.
Changing the selected references recomputes this flag and invalidates confirmation.
Both semantic approval and UI controls require confirmation when this flag or
geometric ambiguity is true. Original records, export and capture-bundle transfer
retain all evidence. Unit, HTTP/browser and private live-capture tests distinguish
synthetic rules from actual Figma rendering observations.

Occlusion proofs, paint properties and cross-snapshot annotation references remain
subsequent slices. Current node comparison is accepted below. An export dimension mismatch stays rejected;
no guessed padding offset or increased image budget may manufacture registration.

## Accepted on-demand node export comparison 2026-10-24

The official [node export API](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/)
and [export settings](https://developers.figma.com/docs/plugins/api/ExportSettings/)
support direct read-only export. They do not establish removal of external ancestor
effects or exact Section image-origin registration. The [mask API](https://developers.figma.com/docs/plugins/api/properties/nodes-ismask/)
also makes sibling context relevant. These limits motivate comparison rather than
claiming that isolated pixels prove contribution to the saved composite.

The next minimal slice compares the saved composite crop with an explicitly
requested **current node export**. It is supplementary evidence for human review,
not an automatic occlusion classifier. The export uses contentsOnly=true and
useAbsoluteBounds=true on one already captured node. It does not clone, toggle,
reorder or write any Figma node, change selection, or load another page. PAGE,
DOCUMENT, SLICE and SECTION targets are excluded. The user navigates to the captured page
through the existing Show in Figma action when necessary.

SECTION capture is explicitly metadata-only: preserve its bounded source nodes,
return `preview=null` with an unsupported-coordinate-mapping warning, and do not
call native image export. A SECTION current-node request is rejected before export.
The observed Section dimension mismatch has no verified image-origin correction;
neither guessed padding nor a larger image budget establishes registration.
An explicitly selected unrotated inner Frame is the supported image path. Existing
saved snapshots are not changed by this support restriction.

The request binds project revision, annotation, captured node ID and live plugin
session. The server supplies file/page/node identity from saved source data. The
plugin checks current file/page and node ancestry, reads only that node's scalar
metadata before and after export, and rejects observed changes. The server compares
name, type, parent, BBox, exact TEXT, visibility and captured opacity when present.
Local sibling order is not re-read. Passing these checks is not a revision or
style fingerprint: changes in descendants, paints, masks or external ancestors may
remain undetected. Label both capture time and export time; never replace the
snapshot image or describe the new image as the captured historical state.

Limits are fixed at one export, maximum dimension 1024px, PNG 2 MB and a cooperative
5-second deadline, inside the existing broker timeout/cancellation. No metadata
subtree traversal or speculative exports occur. Native export memory and runtime
cannot be preempted or bounded before completion; late/cancelled results are
discarded. Reject unsupported transforms or dimension mismatch, with no padding
guess or automatic retry. Hidden/transparent sources may produce blank PNGs or
errors; do not change their properties to reveal them or infer a reason from blank
pixels. Outside siblings are excluded, while ancestor/mask/blend effects remain
unverified. The live image is displayed independently, not overlaid as registered
pixel evidence.

The response is transient and local. It adds no project/snapshot/review fields,
history entries, approvals, bundle contents or MCP approved context. Clear it on
project, capture, selected annotation, project revision or plugin session change;
ignore late responses from stale views. Opening an export never adds or confirms
a source reference. Existing source-confirmation and semantic-approval gates stay
unchanged. Test plugin reads/budgets/cancellation, HTTP identity/session/revision
validation and no writes, UI stale response behavior, and a real read-only export.
