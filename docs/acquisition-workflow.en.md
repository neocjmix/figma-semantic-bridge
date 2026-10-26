# Bring in only the source you need

[한국어](acquisition-workflow.ko.md) · [User guide](user-guide.en.md) · [Install](alpha-installation.en.md)

Choose the scope and evidence your task needs. View the image first and read its
structure later, or read only known nodes or a chosen branch. **Unread nodes are
not treated as absent, and partial results are never marked complete.**

## Choose a path

| Task | Use | What completion covers |
| --- | --- | --- |
| Review a small screen and its nodes | Capture Figma selection | The selected container's full subtree within the read limits |
| Mark regions on a large screen first | Overview only → Create draft from overview | Image observation only; source confirmation and approval remain unavailable |
| Read all structure under a large area | Collect source structure | The selected root and every descendant, excluding outside siblings |
| Inspect a few known nodes | Read selected source nodes | Only requested IDs and fields |
| Discover a parent's immediate children | Read child nodes | Direct children only, excluding further descendants |
| Read one needed branch completely | Prepare nested area collection | The chosen branch root and all descendants |

When narrowing a read, record that narrower task scope. Completing one branch
does not complete a request for the original larger screen.

## 1. Import a small screen or overview

1. Open a workspace and save unsaved edits. Connect the Figma plugin, select one
   container in Figma and choose **Capture Figma selection**.
2. Check its name, bounds and import guidance. Structure has not been counted or
   rendered yet, so total nodes and time are unknown. Canvas dimensions alone
   cannot provide a reliable time estimate.
3. Choose **What to bring in**, then **Start import**.

| Choice | When to use it |
| --- | --- |
| Overview, then structure | View the screen first and read the same area's structure |
| Structure, then overview | Original text and node information come first |
| Overview only | Decide which structure you need after seeing the image |
| Structure only | Work from original text and structure without an image |

The job stays bound to the source shown in its preparation panel. Changing the
Figma selection does not redirect it. Image and structure are separate
observations; avoid editing the design during import and compare the two results.

The panel shows the stage, elapsed time, nodes and bytes received. It does not
show a completion percentage when the total is unknown. **Enlarge overview**
uses the image already received and does not ask Figma to render again.

- When the required stages are complete, choose **Save complete capture**. A
  structure-only capture can be saved without an image.
- After an overview-only import, use **Create draft from overview** to mark
  proposed regions. Matching, confirmation and approval need complete source
  structure attached later.
- **Load source structure** reuses the PNG but uses the small-capture limits.
  For a larger structure, use **Collect source structure** below.

A successful stage remains available if another fails. **Retry overview** or
**Restart structure read** reruns only that stage. Structure retries start from
the beginning. If the same limit keeps cutting off the read, choose an explicit
smaller scope or switch to structure collection rather than repeating it.

## 2. Collect larger structures and attach an image

Open **Collect source structure** and check the selected Figma container. Read
the node/data limits and native Figma cost guidance before starting.

- Save up to **500 nodes or 1 MB per part**, with **200,000 nodes and 64 MB total**.
  No up-front full count is performed; progress uses received nodes, bytes and time.
- Pause takes effect after the current part is saved. One run pauses between
  parts after five minutes. Resume does not reread parts already saved.
- Resume requires the same valid plugin session and source. Ten minutes idle,
  page changes, reconnection or app restart can lose the traversal state and
  require a new collection.
- Completion requires coverage, uniqueness and parent-relation checks. Only a
  completed structure can support workspace source matching, confirmation and approval.

Use **Add source structure to workspace** to work without an image, or **Attach to
current image draft** when file, page, root and bounds match. The image and region
drafts remain, but matching metadata does not prove the same design version.
Every annotation attached to a collection needs explicit human **Confirm sources**
on its saved node set before approval.

Browse the saved node list in pages and load original text only when selecting
a node. Loaded canvas boundaries and the total collected node count are shown
separately. A boundary absent from the current view is not necessarily missing
from the stored structure.

## 3. Read specific nodes and branches

Prepare an inspection under **Read selected source nodes**.

- **Node details only** reads metadata for up to 100 IDs. Choose **Node details and
  text** to include the requested TEXT content.
- **Read child nodes** takes a parent ID and lets you request subsequent pages.
  Each response includes up to 100 direct children, not their descendants.
- **Prepare nested area collection** completely reads the chosen container's subtree. Once
  complete, it can be used as source structure like the larger collection above.

A cached identical request can be reused without rereading Figma. Cache reuse is
not proof of the current design; start a new inspection after changes. Figma can
allocate a wide parent's entire native `children` array internally, so response
pagination does not impose the same bound on Figma's native memory.

## Stop, recover and clean up

**Stop import from Figma** stops waiting and cooperative reads. A Figma image
export already running cannot stop immediately. Late results are ignored, and
the plugin may remain busy briefly. Closing or refreshing the window does not
replace the stop action.

Find previous results in **Recent imports**. **Delete import record** removes
that cache, keeping saved captures and annotations. A record used by an image
draft or a collection referenced by a workspace cannot be deleted. Collection
storage is limited to 12 records and 256 MB across the server; import records
are limited to 12. Open another workspace to clean up its unused records.

If cursor release is unconfirmed, the app retains the record needed for retry.
Retry release/removal for that job or reconnect the plugin and start again. Do
not repeatedly retry a size limit, damaged data or changed session as if it were
only a slow response.

## Limits and decisions

| Item | Limit or boundary |
| --- | --- |
| Small-capture structure | Default 5,000 nodes, 2 MB and cooperative 5 seconds; exceeding a limit stays incomplete |
| Overview | Longest side 2,048 px, 8 MB; use original text for fine text in a large table |
| Current-node comparison | 1,024 px, 2 MB and cooperative 5 seconds; outside siblings excluded |
| Source file | One complete structure and optional image, up to 80 MB NDJSON; no annotations, specifications or approvals |
| Small-capture transfer | Up to two captures, 10,000 nodes and 4 MB node metadata combined, 15 MB file |
| Section or transformed root | Keep structure without an unsupported image, or explicitly select an unrotated inner Frame |

Application time and response limits do not guarantee Figma page-loading time,
render duration or peak memory. This workflow does not need Figma REST API or a
PAT. REST alternatives or concurrent native renders are not applied automatically.

Use **Source files** for source transfers. Import checks hashes, the final marker
and complete structure before adding an unreviewed source area. This does not
transfer approvals or back up a workspace. Continue with the
[user guide](user-guide.en.md) for source review and approval.
