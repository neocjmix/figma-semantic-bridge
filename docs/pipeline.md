# Processing pipeline — implemented and proposed stages

The 0.4.0 candidate source implements one local, human-first acquisition workflow.
Images, saved partial records and scoped review remain available when broader
acquisition stops. Earlier mode-based routes remain compatibility APIs.
[Product validation](product-validation.md) records which checks ran through
synthetic adapters, browser UI, native Figma and the packaged app; these are
separate acceptance layers.

## 1. Pin a permitted source

The user chooses one current-page Figma container. A lightweight selection read
records file, page, root ID, type and document bounds before heavy work. The
server requires the active plugin session and a project revision; the adapter
does not modify the document. Unavailable private-plugin file identity prevents
provenance-dependent new acquisition. A page change, reconnect or changed source
invalidates a live cursor rather than silently changing the task target.

## 2. Acquire only the evidence the task needs

| Path | Implemented output | Limit and incompleteness rule |
| --- | --- | --- |
| Bounded capture | Legacy `Snapshot` with inline node array and optional PNG. | Default 5,000 nodes/2 MB/5 s; ceilings 10,000/4 MB/15 s. A limit-hit prefix stays incomplete and cannot support new approval. |
| Legacy independent acquisition | Overview, structure or either order, with stage status, elapsed/observed counts, cancellation and retry. An overview-only result can become a visual draft; a fully complete bounded structure can be committed as a Snapshot. | Preview has 2,048 px default long-edge and 8 MB PNG budget. Native export may continue after cancellation; image and structure have separate times. |
| Normal resumable import | Scale-2 overview (default long edge 4,096px) plus complete chunk-backed editor sources; valid images become proposed drafts automatically and structure attaches when the editor is clean. | Settings default to 200,000 nodes/64 MB; node/byte/run budgets pause. Same-session resume reads updated settings; safety ceilings are 1,000,000 nodes/128 MB. |
| Chunked collection | Complete selected subtree or explicit descendant branch, stored as acknowledged immutable chunks. | 500 nodes/1 MB per packet; default 200,000 nodes/64 MB, configurable up to 1,000,000/128 MB. Cooperative pause follows a durable packet; same-session resume expires after idle/source change. Partial records remain queryable as observed evidence; only a proven closed subtree or complete original scope supports source approval. |
| Focused part | Fresh complete traversal of a known incomplete saved container, linked to the original task and historical image. | Reads only that subtree; validates original enclosing membership. Releasing a broader paused cursor requires consent and never completes the broader task. |
| Reconnect continuation | A separate generation revalidates the original subtree and receives compact receipts for exactly matching saved packets. | Requires consent for repeated native reads; preserves old records/approvals. Packet reuse saves transfer, not native getter work. |
| Selective inspection | Explicit IDs with metadata or requested original text; one parent's immediate children in pages. | Up to 100 IDs and 1 MB per observation; up to 100 direct-child records/96 KB per page. No sibling/descendant coverage is implied. |

Native Figma may allocate a wide parent's entire `children` array before the
plugin can page its response. A TEXT value must fit the exact source schema; it is
never shortened into apparently complete evidence. Work on another page and a
whole-document JSON dump are not implicit fallbacks. See [ADR 0006](adr/0006-image-first-lazy-acquisition.md),
[ADR 0007](adr/0007-chunked-source-collections.md) and
[ADR 0009](adr/0009-selective-source-acquisition.md).

## 3. Bind complete evidence to an editor scope

An overview can become a **visual-only scope**: people may draw and save proposed
regions, but matching, confirmation and approval are unavailable. A complete
collection can create a source-only scope or attach to a visual draft only when
file, page, root and bounds match. The visual observation is preserved. No partial
chunk prefix is converted to a complete Snapshot or combined with an image as one
atomic Figma version. Verified partial records can be inspected without this
attachment. A closed subtree can create a separate branch-backed scope using the
same historical enclosing image and copied proposed regions. The branch's source
bounds and completeness remain distinct from that image and the original task. Existing approved annotations remain intact; attaching
structure to a visual draft resets its proposed regions' source review.

The editor pages metadata and shows loaded overlay bounds versus the collection's
full count. Exact saved TEXT and chosen source records are resolved on demand. This local
paging is lazy; native traversal still reads full records and exact TEXT for
every node in the requested subtree. Cached
selective observations remain separate from project annotations and cannot be
promoted into full-subtree evidence merely because their requested IDs returned.

## 4. Build and ground a semantic interpretation

The normal editor saves a new region with its deterministic source suggestions
in one operation. Later edits preserve selected references; explicit rematching
is available in the source controls. The next visible actions are source
confirmation, region approval, optional requirement linking and Share. Draft
guards keep unsaved changes in the active editor until saved or discarded.

A person draws, resizes, names, splits, merges and reparents regions; semantic
hierarchy is independent of Figma ancestry. Deterministic geometry computes
overlap, coverage and IoU candidates using axis-aligned document bounds. For a
collection, matching streams **all** verified chunks, including descendants whose
bounds lie outside a parent's box. It keeps a bounded candidate summary and
signals ambiguity or candidate overflow. The score is geometric fit, not a
calibrated semantic probability.

Observed hidden or zero-opacity subtrees are excluded from automatic candidates
but remain stored and explicitly selectable. Missing opacity, external overlays,
masks, clipping, blend effects and actual paint contribution remain uncertain.
The user may inspect a current node export or navigate to a source node without
changing source content; that export is a new transient observation, not the
saved capture image.

## 5. Confirm sources, specifications and meaning

The user saves an intended reference set and, where required, explicitly invokes
**Confirm sources**. Every new collection- or branch-backed annotation requires complete
backing for its declared scope, at least one selected source reference and this confirmation before
approval. Legacy snapshots require confirmation for geometric ambiguity or
rendering uncertainty. Changing geometry/references invalidates review; AI cannot
supply source confirmation. Approval is a separate semantic decision.

Specifications preserve verbatim original TEXT, may link to multiple components,
and require reviewed relations to approved targets before approval. A visual-only
scope or incomplete source cannot satisfy those gates. Undo/redo and revision
checks prevent stale edits from silently replacing newer decisions.

## 6. Share reviewed context

JSON/Markdown and MCP approved-context reads include eligible approved regions,
reviewed specification relations, provenance and explicit unresolved/truncation
information. A child under an unapproved ancestor is withheld from the approved
hierarchy. MCP also offers bounded targeted source reads and a proposal-writing
path, but not semantic approval or arbitrary file/shell access.

Standard V2 source transfer streams one complete collection, verified branch or
complete bounded Snapshot with optional image context in an at-most-80 MB NDJSON
file. Import creates fresh unreviewed evidence in the current workspace. Earlier
V1 source transfers and capture bundles remain readable; legacy capture bundles
create a fresh workspace. These formats preserve source material, not human
annotations, specifications or approval. Digests and
coverage checks establish local integrity, not origin permission or freshness.

A fast busy rejection for a structure packet may be retried once after 250 ms,
within the original packet/run deadlines and only while the task remains active
in the same session. Another busy response or timeout pauses for Continue.
Cancellation, pause, deterministic data failures and image export never trigger
that retry. Restoring the workspace does not start heavy reads automatically.

## Optional and future work

A configured local or explicitly consented external model may generate validated
proposals for bounded source scopes. Manual work remains available without a
provider, and proposals never overwrite approved human records. Automatic
source-change reconciliation, version-pinned multi-observation acquisition,
independent semantic quality measurement and guaranteed complete product-flow
reconstruction are **future work**, not hidden steps of the implemented pipeline.
