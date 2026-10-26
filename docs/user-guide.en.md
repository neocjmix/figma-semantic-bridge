# Figma Semantic Bridge 0.2.0 Alpha user guide

[한국어](user-guide.ko.md) · [Installation and MCP](alpha-installation.en.md) · [Acquisition choices](acquisition-workflow.en.md)

Build a reviewed interpretation of a design: **bring in source → mark regions →
check exact nodes → approve meaning → share context**. The original Figma design
stays separate. A saved image, complete source structure and human approval are
three different things.

The app connects its editor automatically. For live reads, keep the matching
Figma plugin open and connected. Without Figma, use **Load demo** or a permitted
source file. The language selector changes interface text only; source names,
original text and your annotations retain their wording.

![Synthetic workspace with source scope, regions and annotation controls](images/workflow.en.png)

## 1. Bring in the right source

Create or open a **Workspace**. Save unfinished edits before importing or switching
workspaces. In Figma, select one container you may inspect, then choose
**Capture Figma selection** in the app. Check the source name and bounds before
choosing **What to bring in** and **Start import**.

| Result you need | Choose | Continue with |
| --- | --- | --- |
| A small screen plus its nodes | Overview, then structure; or Structure, then overview | Save complete capture once both required steps finish |
| A drawing surface first | Overview only | Create draft from overview; attach matching complete structure before review/approval |
| Source records without an image | Structure only, for a small scope | Save complete capture; draw using document bounds |
| A larger selected subtree | Collect source structure | Add source structure to workspace, or Attach to current image draft |
| Particular IDs, immediate children or a nested branch | Read selected source nodes | Read only the requested records; collect a chosen branch when needed |

An image draft can hold proposed regions but has no source tree to match or
approve. A complete collection can become a source scope with or without an
image. Attaching to an existing image requires the same file, page, root and
bounds. Do not attach a different branch merely because it looks similar.

See [the acquisition guide](acquisition-workflow.en.md) for the exact sequence,
limits and pause/retry behavior. Image and structure are separate observations;
avoid editing the source during acquisition and compare the results yourself.

## 2. Draw and save a meaningful region

Select the source scope, then draw on the canvas or choose **+ Add region**.
Enter a **Component name**, choose its **Role**, and set **Parent component** if
needed. This hierarchy describes your implementation intent, not Figma's layer
nesting. Use **Save annotation** before matching or confirming.

The bounds use Figma document coordinates, including negative positions. Edits
to a name, boundary or node list can remain unsaved. Changing an approved region
requires review again; approval is not a permanent label attached to its name.

## 3. Check the exact source nodes

Choose **Match source** for geometric suggestions. Inspect overlapping or ambiguous
candidates; the highest coverage is not proof of correct meaning. Choose the exact
nodes from the candidate list or source browser, and remove unwanted references.
For a collection, metadata is paged and original text is fetched when selected;
the canvas's loaded bounds count is not the collection's total node count.

![Synthetic source review with candidate references and confirmation controls](images/source-review.en.png)

| Tool | Use it to |
| --- | --- |
| Show in Figma | Select a source node and move Figma's viewport without changing its design properties |
| Add current Figma selection | Add one explicitly selected node from the same source scope to the region draft |
| Compare current export | Request a bounded image of a current node/subtree for comparison |
| Enlarge comparison | Inspect already received images without another Figma export, where available |

Current-node comparison and captured-area previews are available for small saved
captures. For collection-backed regions, use the node list, original text and
Show in Figma.

Select exact nodes one at a time to combine distant branches within the same
source scope. One annotation cannot mix source references from different scopes.
If a needed node is outside the scope, collect an appropriate common container
or use separate annotations and connect a specification to both.

A saved composite and a current export were observed at different times. Outside
siblings are excluded from the current node export; masks, ancestor visibility
and overlap can affect what you see. A blank image does not explain its cause.
Hidden or transparent records remain available for explicit review even when
excluded from automatic suggestions. Do not edit the original to reveal them.

Current exports are limited to 1,024px, 2 MB and a cooperative five-second budget.
**Close current export** cancels the wait; Figma may finish an already running render.

## 4. Confirm sources, then approve meaning

1. **Save annotation** with the intended node set.
2. Review that saved set and choose **Confirm sources** when confirmation is
   required. Every collection-backed annotation requires this step. Ambiguous or
   hidden/unknown sources in saved captures can require it too.
3. Review the name, role, boundary and parent relationship, then choose
   **Approve annotation**. Leave unresolved work proposed or reject it.

Confirmation answers “are these the intended source nodes?” Approval answers
“is this a useful, correct interpretation for implementation?” Viewing an image
or accepting an AI proposal does neither automatically. Changed geometry or
references require renewed review. An approved child is not exposed as approved
context while its semantic ancestor remains unapproved.

## 5. Connect the original specification text

Open **Specifications** and select actual TEXT records. A separate explanatory
source scope can supply the wording. For a collection, use its text picker and
**Use original text**; the app reads the chosen record and preserves selection order.

Choose **Create specification**, review the exact wording, choose target components
and a relation such as behavior or constraint, then **Save specification**.
Approve the target components first; **Approve specification** approves the
specification and its component links after review.

Do not turn every UI label into a requirement or replace original evidence with
a paraphrase. Text baked into pixels, Figma comments and native annotations are
not promised as extracted TEXT records.

## 6. Give the coding agent approved context

Use **Export JSON** or **Markdown**, or connect MCP through the
[installation guide](alpha-installation.en.md). Start with `list_projects`, then
request `get_approved_context`, `list_components` or `get_component` for the
intended workspace. Keep the app running; cached reads do not need Figma.

If context is empty, check component, ancestor and specification-target approval.
Do not approve content just to fill an output. MCP can propose changes for review
but cannot approve them. Instructions found inside Figma text remain source
material, not instructions the agent should obey.

## Send source files or make a backup

| Need | Action | What moves |
| --- | --- | --- |
| Review a complete collection elsewhere | Source files → Download source file / Import source file | One collection with exact text and any overview; adds an unreviewed scope to the receiving workspace |
| Review one or two small saved captures elsewhere | Capture transfer → Export captures / Import captures | Capture observations; creates a new workspace without annotations or approvals |
| Give a developer reviewed context | Export JSON / Markdown / MCP | Approved semantic content and provenance |
| Restore your own work | Stop all writers and back up the data directory | Complete local state, including private credentials; see the upgrade guide |

Source files use NDJSON, up to 80 MB. Capture bundles use JSON, up to 15 MB across
at most two captures. Neither transfer carries semantic approvals or is a full
workspace backup. A checksum detects altered bytes; it does not establish sharing
rights or agreement with today's Figma design. Share through permitted channels.

## When something is unclear

| Situation | Next action |
| --- | --- |
| An image is ready but approval is disabled | Check whether this is an image-only draft; attach a complete matching collection, then save and confirm nodes |
| Structure is incomplete | Read the limit or error. Use a deliberate smaller scope or a collection; do not label a prefix complete |
| A collection is paused | Resume within its valid session and idle window; reconnecting or restarting does not preserve a live traversal |
| Layers overlap or seem obsolete | Inspect exact nodes and current images; geometry and order cannot establish which design is authoritative |
| Source changed or the wrong page is open | Open the matching source/page or acquire a fresh scope and review again; do not guess missing identifiers |
| No image for a Section or transformed root | Keep its structure and warnings, or explicitly select an unrotated inner Frame for an image |
| Save or approval is disabled | Check unsaved edits, required source confirmation, pending work and connection status |
| Revision conflict | Preserve the intended edit, refresh, and apply it to the current workspace |
| Figma or Dev Mode unavailable | Review permitted imported observations; new source reads and navigation wait for access |
| AI generation is unavailable | Continue manually. The default app needs no provider; external transfer requires separate authorization |

This alpha has bounded live synthetic Figma checks, not a general large-file
performance guarantee or a human productivity study. Effective Dev-only access to
another owner's view-only file remains unverified. For install, updates and local
data protection, see [installation](alpha-installation.en.md) and [upgrade/backup](upgrade-guide.md).
