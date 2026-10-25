# Acquiring images and structure separately — development version

[한국어](acquisition-workflow.ko.md) · [Existing user guide](user-guide.en.md) · [Design and remaining scope](adr/0006-image-first-lazy-acquisition.md)

This workflow was implemented in the working tree by 2026-10-26. It is **not in the
published 0.1.1 app or plugin**. Build the server, web editor and plugin from the
same source before using it. Existing alpha security and data-handling cautions
still apply.

The priority is completing the requested work without omissions. An available image
and fully acquired structure are distinct outcomes. Required reads can be deferred;
unread data cannot be treated as absent or complete.

## Recommended sequence

1. Open a workspace and save unsaved edits. Select one permitted container in the
   connected Figma file, then choose **Capture Figma selection**. This preparation
   reads selection identity and bounds only; it does not walk descendants or render an image.
2. Check the source name, type and bounds, then choose the acquisition order. Total
   nodes and duration are still unknown. Frame dimensions alone do not establish
   precise time or memory estimates.
3. Read the cost and limitation notices and choose **Start acquisition**. The task
   stays pinned to that source. Selecting another node in Figma does not silently
   change the task's target.
4. Inspect the stage, elapsed time and observed node/byte counts. There is no
   completion percentage when total work is unknown. Use **Enlarge overview** to
   inspect the received image; enlargement does not request another Figma export.
5. After an overview-only acquisition, either choose **Use overview as visual draft**
   to draw and save proposed regions now, or choose **Load source structure** for the
   bounded capture path. Loading structure reuses the PNG. A visual draft cannot be
   matched, confirmed or approved until a complete collection is explicitly attached.
6. For the bounded path, choose **Save complete capture** after all required steps
   finish. For a larger source, use **Raw source collection** and attach its complete
   result to the matching visual draft, or add the collection as a source-only scope.
   Image and structure remain separately timed observations in either case.

## Choosing the order

| Plan | When to use it | Result |
| --- | --- | --- |
| Overview, then structure | Inspect the screen first; structure from the same scope is also needed | Structure reading continues after the image arrives |
| Structure, then overview | Original text and node information are needed first | Structure is read before rendering the image |
| Overview only | Inspect the image before deciding to acquire structure | Only the visual observation is cached; structure can be added later |
| Structure only | Original text and structure are sufficient without an image | No PNG export; complete structure can be saved |

A successful step remains available when the other fails. **Retry overview** or
**Retry structure from the beginning** repeats only that step. Structure retry is
not continuation. Repeating an unchanged request that reaches the same limit will
not complete the full scope.

**Stop acquisition** cancels waiting and cooperative reads. It cannot forcibly
interrupt Figma's in-flight native rendering. The plugin may remain busy briefly
after the app marks its task stopped. Reloading or closing the editor is not a
replacement for Stop; started jobs remain on the server.

Use **Recent acquisition jobs** to revisit cached results. **Remove acquisition
record** deletes that task's cached observations. It leaves captures and annotations
already saved in the workspace intact. The cache holds at most 12 jobs across the
server; switch to another workspace to manage its cached jobs.

## Collecting a large source and reading only the parts needed

Use the workspace's **Raw source collection** panel. Its output is unreviewed raw
source, stored separately from existing captures, annotations and approved context.

1. Select a Figma container and prepare the collection. Check its scope, the
   200,000-node/64 MB limits and uncertain native cost before starting.
2. The plugin reads and saves at most 500 nodes/1 MB per batch. Resume does not
   reread acknowledged batches. Progress shows observed counts, bytes and elapsed
   time; no full count is performed merely to estimate a percentage.
3. Pause takes effect after the current batch is durable. A five-minute run budget
   pauses between batches. Resume is available within the same session, but a
   ten-minute idle expiry, source/page change or reconnect requires a new collection.
4. Once coverage, unique IDs and parent relationships pass validation, browse node
   metadata by page. Request exact source text only when needed; continue through
   long text explicitly. MCP also supports specific IDs, immediate children and
   separate text continuations.
5. History survives browser reload. Restarting the app does not resume a live Figma
   cursor. Incomplete data never becomes a queryable or approved complete source.

This path **collects the selected Figma subtree in full, then reads selected parts
from local storage**. To avoid whole-subtree acquisition when the task needs only
known IDs or a particular branch, use **Selective source inspection**. It can read
up to 100 explicit IDs with metadata or requested exact text, list one parent's
immediate children in bounded packets, and prepare a complete collection of a
chosen descendant container. An ID read proves only those IDs and fields; a child
inventory excludes descendants; a branch collection is complete only under that
branch. Native access to a wide parent's `children` may still allocate the full
array before a response packet is returned.

After a collection completes, choose **Add collection as source scope** to annotate
its document bounds without inventing an image, or **Attach to current visual draft**
when file, page, root and bounds match. A visual draft keeps its image and proposed
regions. The editor pages collection metadata, resolves selected source references
and original TEXT on demand, and marks the number of loaded bounds separately from
the full node count. Save a reference set, choose **Confirm sources** yourself, then
review the semantic annotation. Image/structure agreement is not assumed. A visual
draft cannot be approved before complete source attachment; a collection-backed
annotation always requires explicit human source confirmation before approval.

**Source evidence transfer** downloads one complete collection-backed scope as an
NDJSON file of at most 80 MB, with exact original text and an overview image if one
exists. Import verifies the checksum, end marker and full coverage before adding a
new, unreviewed scope to the current workspace. Annotations, specifications and
approvals are excluded. This is separate from the smaller Capture transfer bundle.
The file can contain sensitive source material; transfer it only through permitted
channels. The smaller embedded Snapshot path retains the limits below.

The server holds at most twelve collections/256 MB. Inspect errors instead of
repeating the same failed request. Capacity limits remain incomplete; timeout/busy
errors await manual resume. Failed cursor release retains the record so removal
can be retried or the plugin reconnected.

## Existing capture limits and what completion means

- The editor's structure read allows at most 5,000 nodes, 2 MB of metadata and a
  cooperative five-second traversal. Reaching a limit means **incomplete**. That
  result cannot be saved as a complete capture or receive a new approval.
- Overview PNGs allow a 2,048 px long edge and 8 MB. Small text in a large table may
  remain unreadable. Rendering has an independent time budget, but its actual
  native cost cannot be guaranteed beforehand.
- Image and structure are observations at different times. Unchanged position and
  name do not prove unchanged descendants or one immutable version. Avoid source
  edits during acquisition and compare the observations before review.
- An overview-only result can become a visual draft with proposed regions. Matching,
  source confirmation and approval remain locked until a matching complete collection
  is attached and the saved source set is reviewed by a person.
- Section images are unsupported. Choose structure only, or explicitly select an
  inner Frame for a separate image task. Reducing scope does not complete the
  originally requested whole-scope task.
- A complete collection can back the editor without making a fake inline Snapshot.
  Legacy Capture transfer does not carry it; use Source evidence transfer. Collection
  completion proves its chosen subtree, not unseen siblings or one immutable Figma
  revision. A real 105,837-node source remains unverified in native Figma.

See the [current collection-backed validation record](evaluation/collection-backed-workflow.md)
and the [earlier acquisition baseline](evaluation/independent-acquisition.md).
Synthetic browser checks do not establish real Figma large-frame performance.
