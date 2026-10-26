# Recovery feasibility: saved partial evidence and reconnect validation

Working-tree experiment for [ADR 0012](../adr/0012-recoverable-source-evidence.md).
This records deterministic adapter tests, not release or native Figma acceptance.
All input is generated synthetic data. No Figma document was read or modified by
these experiments, and no source content was sent to a model provider.

**결론:** 중단 전에 받은 자료는 보존하고 바로 조회할 수 있습니다. 하지만 재연결
뒤 원본이 그대로인지 확인하려면 필요한 원문과 하위 목록을 실제로 다시 읽어야
합니다. 이름과 크기가 같다는 이유로 내부 자료를 최신으로 취급할 수 없습니다.
전체 범위를 확인하는 복구는 한 번의 새 순회를 사용하고, 내용이 같은 묶음은 이미
저장한 자료로 전송을 줄입니다. 이는 Figma 읽기 자체를 생략하는 최적화가 아닙니다.

## Question and decision

Can an interrupted selected-subtree import resume after its plugin cursor is
lost, reuse existing bytes, detect arbitrary changes within required fields, and
still complete the original scope?

Yes, with a **new observed traversal and verified payload replay**. Historical
records remain immutable and immediately useful for inspection; the new traversal
reads the selected root and required descendants. Equal packets may reference
integrity-checked local bytes instead of transferring those records again.
Changed packets carry their actual new records. A new collection generation owns
the new observation times and completion frontier. Original approvals retain
their original evidence; changed evidence does not inherit them.

The existing plugin path supplies no immutable source revision. Even a full new
traversal is a live observation over an interval, not a guaranteed atomic snapshot.
The replay hash validates only fields already present in `StructureChunk`. It is
not a paint fingerprint or a whole-Figma-node equality claim.

## Executed tests

`tests/product-recovery-feasibility.test.ts` exercises the real `SelectiveReader`
and `StructureReader` against a generated, instrumented `CaptureHost`.
`tests/product-structure-replay.test.ts` exercises the new canonical-payload helper
and adapter replay path. The focused run passed **22/22 tests**: 11 new feasibility
and replay tests, plus the 11 existing structure-reader tests. The enclosing
change must still run its complete regression and native/package acceptance.

Covered cases:

- Same ID, name and bounding box with changed exact text, including empty text,
  Unicode and a CRLF/LF difference.
- Added and deleted children, moving a child between branches and reordered
  siblings. An unchanged root inventory fails to detect nested changes.
- A serialized partial prefix with verified complete branches and a remaining
  child count whose unreceived child IDs are still unknown.
- Reconnect replay that actually rereads the source before acknowledging equality;
  the old observation's bytes and time remain unchanged.
- Old partial-packet boundaries and increased node budgets: the new generation
  continues after the saved prefix instead of ending at the previous limit.
- Lost acknowledgement: the existing same-session last-packet replay avoids a
  duplicate traversal and preserves the original packet's observation interval.
- Rejection of source changes during a yielded read, cancellation, wrong cached
  bytes, wrong identity/count, malformed sequence and impossible time intervals.
- Hash stability across object key order, with provenance, exact text, ordered
  records, child counts, completeness and warnings included in the hash.

## Measured read cost

The fixture has 1 root, 10 groups and 100 TEXT leaves: **111 nodes**. Its page's
`children` getter throws, proving that neither path preloads the page. Counters
record actual synthetic getter and lookup calls; they are not wall-clock or
native-memory measurements.

| Operation for the whole selected scope | ID lookups | BBox reads | Name reads | Native child-array reads | Exact TEXT reads |
| --- | ---: | ---: | ---: | ---: | ---: |
| One fresh bounded traversal | 3 | 114 | 114 | 11 | 100 |
| Exhaustive recheck using existing selective commands | 768 | 881 | 881 | 11 | 100 |
| Fresh traversal with equal-payload replay | 3 | 114 | 114 | 11 | 100 |

The selective recheck enumerates each node's direct children, including observed
empty leaf inventories, and reads each required TEXT value. This avoids assuming
that an unfamiliar node type cannot contain children. It detects the same changed
record set as the full traversal, but repeated scope/parent guards add work.

For this fixture, an unchanged packet's response drops from **34,783 bytes to
442 bytes** with replay. The plugin still reads all 111 nodes and all 100 texts.
The local server must verify the saved payload before reconstructing a new packet.
This reduces wire transfer; it does not establish a memory, CPU or elapsed-time
improvement in native Figma. Content-addressed physical storage deduplication is
also a separate implementation choice, not demonstrated by this helper.

A separate historical-only experiment saved the root and 5 complete branches
(56 nodes), then read only the remaining 5 branches. It used 50 TEXT reads and
6 child-array reads. However, it deliberately missed changed text and a new child
inside a reused branch. Those old branches remain valid historical observations
with **freshness not revalidated**. This strategy therefore cannot satisfy a
request that requires detecting changes throughout the current selected scope.

## Safe reconnect algorithm

1. Keep the original requested file/page/root, required fields and whole-scope
   completion requirement in the durable task. Do not derive a smaller goal from
   whichever records arrived before interruption.
2. Load and integrity-check saved packets. Make their records and verified closed
   branches available for inspection. Preserve missing fields, unknown child IDs,
   original times and incomplete whole-task status.
3. After Continue and any required cost decision, verify that the connected plugin
   can read the original file/page/root. Start a new collection generation and
   new observation interval. Retain the old image as its historical observation;
   a reconnect does not require exporting the same overview again.
4. For each prior saved packet, send only its verified payload digest and node
   count as a replay hint. The plugin performs the ordinary guarded traversal and
   aligns its packet boundary to that count where byte/time limits permit.
5. Hash the **actual newly read packet**. If its exact payload matches, return a
   compact receipt with new collection/sequence/times. Otherwise return the full
   actual packet. Do not skip live reads based on a matching root or old hash.
6. Reconstruct equal payloads only from the integrity-checked saved packet whose
   digest, identity and count match the receipt. Validate the reconstructed normal
   packet through the usual storage/ancestry/sequence/frontier checks. Persist
   before acknowledging or advancing the durable task.
7. Continue until all declared children of the original selected subtree are
   observed. Changed packet lengths, child counts or positions can reduce replay
   efficiency, but do not permit skipping records. A limit or source change keeps
   the new generation incomplete and preserves all earlier valid observations.
8. Completion means the new observation covers its declared selected subtree.
   It neither overwrites older evidence nor certifies an immutable current Figma
   revision. Approval and replacement of reviewed evidence remain separate.

The adapter keeps its existing byte, time, ancestry, source-change and cancellation
guards. A soft time or byte limit may yield fewer records than a replay hint;
that packet is sent normally. An old partial packet becoming the new tree's last
packet has a different completeness flag and therefore cannot be falsely replayed.

## Minimum useful contracts

- **Durable task:** original root/requirements, current generation, parent attempt,
  received evidence and outstanding coverage, plus the required user-visible cost
  decision before a costly new traversal. A session ID is not a durable cursor.
- **Partial evidence view:** only integrity-checked durable records, bounded pages,
  explicit exact-text availability, verified closed-subtree intervals and original
  observation provenance. A known count cannot invent missing IDs.
- **Replay hint/receipt:** versioned canonical payload hash and node count; a
  discriminated receipt binds the fresh collection, sequence, identity and times.
  Hash equality proves payload equality, not permission or source freshness outside
  the actual read.
- **Scoped review:** complete saved branches may be reviewed as their own explicit
  evidence. The parent task's remaining siblings stay incomplete. Branch derivation
  must preserve the original observation and cannot silently narrow a full-screen
  request to a few returned IDs.
- **Approval provenance:** historical approvals retain immutable bindings. New or
  changed bindings require review; partial/unknown required evidence cannot enter
  approved context as complete.


## Focused-part implementation check — 2026-10-27

`tests/product-source-part.test.ts` drives the real authenticated local HTTP/WS
path, `SelectiveReader` and `StructureReader` with synthetic native-getter
counters. The original task stops after three records: a root, a known incomplete
container and its first TEXT child. The target container contains six TEXT nodes;
an unrelated sibling contains forty.

After explicit consent to release the original paused cursor, acquiring the
focused part produces seven records. It reads the target's child array once and
its exact text six times; root and unrelated child-array reads and unrelated text
reads are all zero. Only the initial overview is exported. The original three
saved records retain their exact bytes and incomplete status; the original
selection is not reread or changed. This is a native-read saving for a smaller
explicit scope, not evidence of whole-source freshness.

Tests also reject unknown, leaf/root and moved-outside targets, preserve the
paused cursor on membership failure, and retain `partOf`, original context and
enclosing scope guards through restart/revalidation. MCP uses the same acquisition
tool for plan and part, with cursor-loss confirmation false by default.

The combined part, source-recovery, task-MCP, selective-branch and collection-server
run passed **31/31 tests**, including two pause/shutdown subtests. The retry tests
show one identical fast-busy packet retry after 250 ms with a reduced remaining
timeout, a pause after repeated busy rejection, no automatic timeout retry, and
no retry after pause/shutdown. This run is local synthetic integration only.

## Limits that remain

The experiments do not validate the reported 105,837-node production design,
native Figma peak memory, every source-change event, arbitrary paint/occlusion,
external organization policy or a Dev-only account reading another owner's file.
Figma may allocate an entire parent's native child array before packet limits can
apply. If the requested outcome requires an atomic revision, the current provider
cannot satisfy it. These boundaries must remain explicit in the implementation,
UI and release acceptance; a passed replay test is not evidence for them.
