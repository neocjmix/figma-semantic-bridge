# ADR 0007 — Chunked source collections outside project snapshots

Status: implemented in the unreleased working tree, 2026-10-25; extends ADR 0006.

This vertical slice acquires the entire explicitly selected subtree into a
separate, unreviewed source collection. It does not lift the 10,000-node Snapshot
contract or put a whole-file dump into Project JSON. The collection is associated
with a workspace but is not an annotation source or approved coding context.

The plugin retains one bounded traversal session and returns at most 500 records
and 1 MB per chunk. Sequence numbers are replayable until the next chunk is
requested. A server acknowledges progress by durably journaling the chunk before
requesting its successor. Source/page/session identity, root metadata, unique IDs,
preorder parent relationships and declared child counts are checked. A collection
is complete only after the traversal frontier closes with no missing or duplicate
records. Limits mean paused/incomplete, never a smaller successful scope.

The task is bounded to 200,000 nodes and 64 MB of metadata. Local disk chunks are
independent of the 48 MB project file. The server exposes byte-bounded pages of
node metadata, explicit node-ID or immediate-child queries and exact original text
continuations. It never silently truncates text or labels unseen children absent.
Only complete collections are exposed to consumer queries in this first slice;
partial chunk files remain acquisition progress, not a usable completed source.

Page-scoped change notifications invalidate the plugin cursor without loading all
pages. Root metadata is checked at chunk boundaries. Notifications are asynchronous
and cannot prove an immutable revision: even complete coverage is labelled a live
session observation. Reconnect/restart invalidates continuation; retained completed
collections remain historical data. The user's strict same-revision requirement,
if present, is unresolved by this provider. A version-pinned REST adapter requires
separate credentials and evidence of equivalent fields and rendering.

Figma `children` returns a full array, so output chunking is not native child
pagination or a memory guarantee. Cache each encountered child array once for the
active traversal, serialize Figma requests, and release the cursor on terminal
completion or explicit removal. A pause retains its cursor for at most ten idle
minutes in the same plugin session. Change notifications, page switches and
session replacement invalidate it. A five-minute run budget pauses between chunks;
manual resume starts another bounded run. Timeouts and native busy responses pause
without automatic retries. Failed cursor release keeps ownership until acknowledged
or the session changes. Do not invoke full-page loading or edit the source.

The collection store is bounded to twelve records and 256 MB across workspaces.
Chunk files and manifests use private permissions, hashes, file/directory fsync
and atomic replacement. Source queries are limited to 200 nodes and 96 KB, with
text removed from metadata responses. Exact text is fetched separately in at most
4,000 UTF-16 code units per response; continuation never splits a surrogate pair.
Server restart marks unfinished traversals interrupted rather than resuming a
potentially changed live tree. Completed historical collections remain readable.

Acceptance: a known synthetic 105,837-node inventory is preserved exactly across
bounded chunks and durable reload; duplicate/reordered/missing chunks, source
changes, stop, restart and interrupted continuation cannot create a complete
collection. Queries and long Unicode text reassemble exactly under response
budgets. Existing small-capture annotation and approval behavior remains unchanged.
An owned native fixture passed 21-node image-first/later-structure acquisition and
5,001-node traversal in eleven chunks. The reported real 105,837-node frame,
native renderer bounds and immutable-revision consistency remain unverified.
See [the validation record](../evaluation/chunked-source-collections.md).

This slice makes large raw-source acquisition and selective local reads available.
Image-only annotation drafts, collection-backed matching/approval and large portable
bundle interchange need subsequent contracts; the UI must state that boundary.
