# ADR 0006 — Correctness-first acquisition with optional lazy reads

Status: accepted direction; first bounded acquisition slice implemented in the
working tree on 2026-10-25. Later delivery slices remain proposed.
Not released. The independent path has now passed an owned synthetic native Figma
check; [ADR 0007](0007-chunked-source-collections.md) adds separate chunked source
collections. Read that ADR for the later implemented boundary; the small Snapshot
workflow described here retains its existing limits.

## Implemented boundary

The editor prepares an explicit current selection before starting costly work.
The person chooses overview only, structure only, or either sequential order.
Separate `preview_capture` and `capture_metadata` plugin commands pin the original
file/page/root, preserve the current Figma selection and never edit the source.
An overview-only job can later load structure without rendering the PNG again.
The overview is viewable and enlargeable while structure remains unloaded.
Image-only region drawing and annotation drafts are **not** implemented yet.

The server persists each acquisition separately from project data, retains a
successful step after another fails, exposes stage/count/elapsed progress, and
supports cancellation and explicit failed-step retry. Structure retry starts from
the beginning; there is **no traversal cursor or chunk continuation** in this slice.
Interrupted jobs are recovered as interrupted unless all required observations
were already durably recorded. Live continuation requires the original session;
a completed cached acquisition can be saved while disconnected. The cache is
bounded to 12 jobs, 16 MB per job and 96 MB total. Finished records can be removed
without removing their saved project captures. Completed state is exposed only
after its journal write completes.

Only complete required observations can enter a project through the new workflow.
Overview-only, partial, failed and cancelled jobs cannot be saved as grounded
captures. New matching, source confirmation and semantic approval from incomplete
snapshots are blocked server-side; legacy already-approved records remain intact.
Image and structure observation times survive persistence, bundle transfer and
approved context export, with `separate-observations` consistency. Root metadata
checks catch known changes but do not prove unchanged descendants or an atomic
Figma revision. The editor discloses this before acquisition.

Existing size limits remain explicit: the editor requests at most 5,000 nodes,
2 MB metadata and a cooperative 5-second traversal; the API ceilings remain
10,000 nodes, 4 MB and 15 seconds. Independent overview requests allow a 2,048 px
long edge and 8 MB PNG, with a 55-second cooperative deadline and a 60-second
broker deadline. Native export cannot be forcibly stopped. Late/cancelled results
are discarded and the plugin remains busy until native work finishes. Calls to
Figma remain serialized. The legacy one-shot MCP capture command is unchanged.

**The reported 105,837-node full-frame capture is not solved by this slice.**
Continuation, partial-node/field fetching, cross-observation annotation references,
large-result storage and paged consumer queries require the later slices below.
Raising a node cap alone would still exceed other contracts. No UI label or
successful small synthetic fixture should be interpreted as large-frame acceptance.

See the [validation record](../evaluation/independent-acquisition.md) and the
[Korean](../acquisition-workflow.ko.md) / [English](../acquisition-workflow.en.md)
workflow guide. The remainder of this ADR describes the accepted direction and
future slices, not a list of already delivered features.

## Context

The user requested an image before expensive structure extraction, fetching only
the parts needed for a task, an explanation of likely costs before starting,
progress and cancellation for long work, and consideration of concurrency and
execution order. A single selected frame is not necessarily a small source scope.

The user clarified that speed and UX are subordinate to completing the requested
task correctly and without omissions. Lazy reads, caching, execution order and
concurrency are ways to reduce unnecessary cost and avoid exceeding provider
constraints while preserving that outcome. They are not reasons to reduce the task.

The original capture walks descendants before image export and returns one response
(`src/figma/capture.ts`). Reordering those statements alone would still make the
client wait for the whole response. The plugin permits one source operation at a
time (`plugins/semantic-bridge/code.ts`). Existing source-preview requests require
an already saved annotation and captured source node (`src/server/source-preview.ts`);
they cannot directly provide the first image of a new scope.

## Governing priorities and completion contract

Preserve source integrity and access boundaries, then meet the requested task's
correctness and completeness requirements. Within those constraints minimize
unnecessary API calls, repeated traversal/rendering, transferred bytes, retained
memory and CPU work. Optimize latency and interaction after these requirements.
Do not reject a slower or more expensive method merely because a faster incomplete
method exists. Do not promise zero operational risk without evidence.

Define the requested outcome before choosing a read plan: source scope and identity,
required fields and exact text, required image evidence and resolution, discovery
coverage, consistency requirements and human review. Reading three explicit IDs
and finding every possible source in a region are different completion contracts.
Fetching the three IDs cannot certify the latter. An unexamined branch remains
unfinished unless evidence establishes it is irrelevant to the requested result.

Maintain a work ledger for planned/examined/pending scopes, requested fields,
validated chunks, failures, consistency evidence and outstanding human review.
Lazy means deferred work; all dependencies required for the requested result must
be resolved before that result is marked complete. Partial acquisition, consistent
source evidence and human semantic approval are separate dimensions. Confirmation
of a chosen source set does not prove that unexamined sources are absent.

When a per-request budget is exhausted, retain validated progress and continue in
bounded chunks if the task budget and source consistency permit it. Never equate
reaching a node limit with successful task completion. If further work cannot be
performed safely or within an agreed resource budget, report the exact unfinished
requirement and offer continuation, an equivalent provider path, or a user-chosen
scope change. Narrowing scope is a changed task, not automatic recovery. A partial
deliverable can be useful but must remain distinguishable from the original result.

Image-first is conditional: use it when the image helps the human define or inspect
the task. If the task already identifies its nodes/text, skip unnecessary overview
rendering. If complete structural discovery is necessary, an upfront bounded scan
of the requested scope may be more correct and less expensive than repeated lazy
searches. Never require an unrelated whole-document dump. Choose the order and
batching from dependencies and measured cost, not a fixed image-first rule.

## Provider constraints and cost planning

Separate documented provider limits, observed behavior in a specific environment,
suspected failure modes and our own application limits. Record evidence and unknowns;
do not turn a single successful sample into a claim that Figma has no limits, or a
single failure into a universal platform cap. Suspected limits justify a bounded
experiment or conservative scheduling, not silently omitting required data.

Plan within documented access/rate constraints. Reduce redundant requests, use
bounded batching, cache compatible results, and retry transient failures with
bounded backoff and server-directed waits where applicable. Avoid retry storms and
competing native exports. A fallback provider must supply the required fields,
provenance, coordinate mapping and consistency; switching providers is not success
if their results are not equivalent for the task. Credentials/permissions are not
bypassed to avoid limits.

Prefer fewer repeated operations, not the smallest individual response at any cost.
Thousands of tiny fetches can cost more quota and traversal than a bounded batch.
Keep a cumulative task budget and continuation state, in addition to message limits,
so a large task can finish through bounded work without growing memory unboundedly.

## Proposed acquisition model

Separate a visual observation from the source records retrieved for grounding:

1. Read the explicitly selected root's identity, bounds and supported transform.
   Do not count all descendants as a prerequisite to showing a cost estimate.
2. Export a bounded overview of the supported root without our plugin walking its
   descendant metadata. Return and persist the image observation independently.
   Figma still renders descendants internally; an early or cheap image is not
   guaranteed. Native export has no documented progress or abort parameter.
3. Permit image navigation, region drawing, naming and saving **ungrounded drafts**
   while structure is unloaded. Do not claim that image-only content is approved
   source-grounded context or that absent records represent empty space.
4. Retrieve structural summaries, exact text and detailed source observations when
   a task dependency or interaction needs them. Reuse locally cached, compatible
   observations; an unopened panel cannot defer data required to finish the task.
5. Verify task coverage and consistency, then review the fetched source set before
   claiming completion. Keep any unresolved coverage explicit rather than letting
   a human confirmation silently certify missing evidence.
   Preserve existing human decisions; never silently replace their source evidence.

The initial image needs its own observation contract, not a synthetic root-only
Snapshot treated as an ordinary capture. Before this slice, the incomplete-snapshot warning
did not disable matching or approval: a lone root could still be suggested as an
exact match. Introduce explicit acquisition state and server-side approval gates
before exposing image-only drafts. The initial slice must not alter approval of
existing immutable snapshots.

## What can be fetched lazily

| User action | Read plan | Boundary |
| --- | --- | --- |
| Open a supported selected frame | Root metadata and overview PNG | No recursive metadata traversal; renderer cost remains unknown. |
| Select a source in Figma or use a known source ID | Bounded metadata for that node and needed ancestry context | Identity, page and explicit scope must match; do not read all descendants by default. |
| Expand a tree item | Summaries of immediate children, returned in bounded batches | Plugin `children` returns an array, not native cursor pagination; wide parents can still be expensive. |
| Link specification text | Exact text for explicitly requested text nodes | Text not fetched is distinct from empty text; do not derive exact source text from OCR. |
| Inspect an ambiguous candidate | Current node image and relevant rendering context | Individual node export does not prove contribution to the saved composite. |
| Revisit a loaded area | Read compatible local cache | Cache availability and live freshness are separate states. |
| Draw an arbitrary region over the image | Query cached geometry; perform bounded source discovery if needed | Rectangle coordinates do not identify source IDs by themselves. |

Plugin ID lookup and immediate-child access support this split. An optional REST
adapter can request specific IDs with a bounded depth, for example
`GET /v1/files/:key/nodes?ids=<requested IDs>&depth=1`; omit neither the scope nor
the depth accidentally. REST requires separate authentication/permission and rate
limit handling. It is an alternative provider, not a prerequisite for the plugin
workflow and not a way around local transport/storage limits.

Avoid one network request per node: deduplicate bounded batches, coalesce identical
in-flight requests and apply backpressure. Bound total cached records, bytes,
outstanding requests and job duration as well as individual responses. Merely
paging a previously downloaded whole-file JSON does not implement lazy acquisition.

## Region discovery and evidence completeness

The reviewed APIs are ID/tree based; no direct arbitrary-rectangle source query
was established. A small initial geometry index may help, but building a complete
index can itself require expensive traversal. Prioritize user-selected branches
or known IDs, maintain a bounded exploration frontier, and expose which branches
remain unexamined. Native Figma selection is a useful way to identify sources
without searching every branch; accumulate multiple explicit choices when needed.

Do not discard a subtree solely because its parent's BBox misses the region:
children may extend beyond non-clipping parents. Safe spatial pruning requires
appropriate evidence for the query's purpose; otherwise leave coverage unknown
and continue discovery where required within the agreed budget. If no safe path
remains, mark the task incomplete. Visible-pixel discovery and discovery of
all structural sources are different tasks.

Sources in distant tree branches may belong to the same semantic region. Hidden,
transparent and covered nodes must not be silently reclassified as nonexistent.
Skipping invisible instance descendants may accelerate a deliberately limited
query, but changes its coverage and cannot establish absence of old/hidden versions.
It is allowed only when those sources are outside the task's explicit evidence
requirements; it is not a default shortcut for difficult designs.
No automatic interpretation of version age or occlusion is introduced here.

Use explicit states such as unloaded, queued, loading, partial, complete-for-batch,
failed and stale. Batch completeness is relative to its IDs/subtrees/fields and
observation; it is not task completion or a claim about all visible pixels.
Only the original task contract determines task completion. Record omitted or
unfinished scopes and field availability, not just a node count. Finalization must
check the expected batch set, record identity/deduplication, required fields,
unfinished exploration frontier and compatible observation generation. Persist the
task's completed marker atomically only after those checks; receiving the last
currently queued response is not a sufficient completion condition.

## Identity and consistency

Bind each observation/job to file, page, root scope, plugin session, observation ID,
coordinate mapping, start/end timestamps and available source version evidence.
Unknown identity must fail closed for later live attachment rather than guessing.
Keep the preview's original document bounds and image scale with its bytes.

An image taken earlier and structure fetched later are not an atomic Figma revision.
Stable node IDs, unchanged root dimensions and local change notifications alone do
not prove identical descendant rendering. Detect and flag known changes; retain
uncertainty when consistency cannot be established. Reconnect invalidates resumable
live cursors until identity/freshness is rechecked. Cached images and drafts remain
available when Figma is disconnected; unfetched source data does not become available.

Store later source reads as immutable observations with explicit evidence links.
Do not append live records into a historical approved snapshot. A future schema
must support a semantic region referencing several compatible source observations
and invalidate only affected pending confirmations when evidence is changed.
Existing single-snapshot annotations need a specified migration before that slice.

Cache keys and reuse checks must include source identity, available version or
observation identity, scope, requested fields, coordinates and acquisition policy.
A source's relevant ancestor and sibling/overlay context is also an evidence
dependency when the requested result concerns rendering. Known changes invalidate
affected pending evidence and confirmations, not just the directly changed node.
A cached observation that cannot be revalidated remains historical evidence and
must not silently become evidence of the current source state.
A cached hash validates stored bytes, not current Figma freshness. For tasks that
require one source version, use a compatible version-pinned provider path where
available, or re-acquire/review as necessary. If consistency cannot be established,
keep the requirement unresolved; an unchanged node ID is insufficient.

## User controls before and during work

Preflight should be lightweight. Show scope, supported image mapping, proposed
overview resolution, likely readability and any known previous cost. Label node
count, time and memory as unknown unless measured; a huge bounding box is a warning
signal, not a reliable node-count or latency estimate. Optional bounded sampling
must disclose its own cost. Do not scan everything to decide whether to scan.

Offer applicable execution plans for the same requested result, explaining their
known/unknown costs and evidence coverage. Options can include **Overview first /
개요 이미지 먼저**, **Read required structure first / 필요한 구조 먼저 읽기** and
**Continue in batches / 나누어 계속 읽기**. Offer **Change task scope / 작업 범위 변경**
separately and explain what would no longer be covered. An explicit extended job
may follow an estimate and configured budget; no unbounded full-file mode is implied.
Make the risk relevant to the chosen action: image generation may
take time, overview text may be unreadable, later reads need an active connection,
and changing the source may require refreshing evidence. Present equivalent Korean
and English controls and preserve drafts across language changes.

Show stage, elapsed time, connection state, collected records/bytes, completed
requested targets and known remaining work. Use indeterminate progress when the
total is unknown; never turn a safety node cap into a misleading percentage.
ETA is optional and must state uncertainty. Also show completed requirements,
remaining evidence and whether the requested result is complete, incomplete,
blocked or cancelled. Retain the image and drafts when a structure fetch fails.
Offer retry of the failed part, continued bounded work, explicit scope change,
stop and continued editing of already available content. Progress UI supports
correct decisions; it does not redefine success as a responsive screen.

Cancellation stops queued work and cooperative traversal; it cannot promise to
interrupt an in-flight native export. Distinguish **Stop requested / 중단 요청됨**
from a confirmed stopped job. Detach the user's wait and ignore stale results while
keeping the plugin operation occupied until native work actually finishes. Do not
start another heavy export under the pretense that the first was terminated.
Retain only validated partial observations with explicit partial status.

## Ordering and concurrency

Schedule required dependencies first, with optional preview-first ordering for
visual tasks. Background discovery must eventually finish if required by the
task, even if the user never opens that branch. Speculative prefetch is optional
and justified only by expected reuse/cost savings. Keep it bounded, low priority,
deduplicated and cancellable; scrolling must not enqueue the entire document.

Overlap independent local work: display/edit the available image while fetching a
requested source, and validate/store received chunks while the next bounded batch
is scheduled with backpressure. Keep source-dependent approval after validation.

Initially serialize Figma source operations. Current plugin busy handling and the
global `skipInvisibleInstanceChildren` policy make blind `Promise.all` unsafe;
concurrent calls do not establish parallel native execution or faster export.
Compare a small controlled concurrency experiment only after measurement and
explicit state isolation. Accept concurrency only if it preserves results,
consistency, cancellation and provider resource limits; faster execution alone is
insufficient. Optional REST requests need their own bounded concurrency,
rate-limit handling and version checks before results can be associated with images.

## Delivery slices and acceptance

1. **Task completeness and independent image feasibility:** establish the completion
   contract, work ledger and unresolved-evidence gates; independent selected-root
   image response for visual tasks, explicit
   unloaded structure, preserved image/drafts on later failure, preflight and honest
   elapsed/stage/cancellation UI. Test the actual native export path separately.
2. **Known-node lazy reads:** bounded batch lookup plus immediate-child summaries,
   exact-text demand loading, deduplication/cache, explicit partial coverage and
   source-grounding approval gates. First avoid claiming complete arbitrary-region
   discovery. Test distant selected sources and changed/missing IDs.
3. **Bounded region discovery:** resumable exploration and local spatial index,
   out-of-parent children, masks/overlays/hidden evidence and uncertainty display.
   High-resolution details use supported actual node/subframe exports. Cropping a
   low-resolution overview does not add detail; arbitrary high-resolution image
   tiles are a separate feasibility question and must not create source Slice nodes.
4. **Larger jobs:** chunk transport, independently stored observations, paged local
   queries, bounded queues/cache and coordinated timeout/size contracts. Evaluate
   optional REST and native JSON export on bounded scopes; do not simply raise all
   defaults or feed a giant result into the existing full-project response path.

Primary acceptance is a correct, complete result for the defined task with intact
provenance and human decisions. On bounded synthetic fixtures, compare lazy/chunked
acquisition with independently specified expected sources/fields, including distant
branches, out-of-parent children, hidden/transparent versions and same-position
overlays. Verify that partitioning, ordering, retry or concurrency cannot drop or
duplicate records, silently skip failed chunks, accept stale evidence or mark a
budget-limited task complete. Reconstructing the required result must preserve exact
text and coordinates. Human review remains necessary for semantic/visual ambiguity.

Then evaluate API calls, repeated reads/exports, memory/bytes, cancellation,
disconnect/reconnect, source changes, readable details, independent retry, save/reload,
bundle compatibility and bounded MCP queries. First usable image time and time to
ground a region are secondary metrics; improved speed cannot offset a correctness
regression. Synthetic tests must cover uncertain totals and unloaded versus empty
data. Native timing and renderer behavior require separately recorded authorized
executions; no native performance or zero-risk claim is made by this ADR.

## References checked for this proposal

- [Figma node lookup](https://developers.figma.com/docs/plugins/api/figma/)
- [Immediate children and traversal cost](https://developers.figma.com/docs/plugins/api/properties/nodes-children/)
- [Search criteria](https://developers.figma.com/docs/plugins/api/properties/nodes-findallwithcriteria/)
- [Invisible instance children](https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren/)
- [Read-only export](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/)
- [REST node IDs, depth and version](https://developers.figma.com/docs/rest-api/file-endpoints/#get-file-nodes)
- [REST rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)

These API capabilities support the proposed experiments; they do not establish
native performance, corporate access policy or compatibility of all Figma files.
