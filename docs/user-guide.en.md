# Figma Semantic Bridge 0.1.1 alpha user guide

[한국어](user-guide.ko.md) · [Installation and MCP setup](alpha-installation.en.md) · [README](../README.en.md)

For the unreleased source-build workflow, see [separate image and structure
acquisition](acquisition-workflow.en.md). It includes visual drafts, complete
collection-backed editing, selective reads and source evidence transfer; none of
these changes is in the published 0.1.1 app described below.

Installation and user guides are packaged together. Links to other documents,
including README, validation and release records, refer to the source repository
and may be unavailable in standalone documents or the plugin ZIP.

Use this app to record a human-reviewed interpretation of a Figma design without
editing the original. Capture a small screen, connect meaningful regions to exact
source nodes, review their meaning, then share approved context with coding agents.
The installed app pairs its embedded editor automatically. Use the app's
**Copy Pairing Token** only when pairing the Figma plugin.

**The [0.1.1 public alpha](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.1.1-alpha) is MIT licensed.**
Until known local-service authentication and capture-import validation issues
are fixed, evaluate only with your own synthetic or non-sensitive files. Do not
use corporate or client designs or import untrusted capture bundles. The open
issues are [#11](https://github.com/neocjmix/figma-semantic-bridge/issues/11),
[#12](https://github.com/neocjmix/figma-semantic-bridge/issues/12) and
[#13](https://github.com/neocjmix/figma-semantic-bridge/issues/13). See the
installation guide for artifacts and tested boundaries.
This is a workflow guide, not evidence of independent semantic-expert accuracy
or a completed human productivity study.

## Interface language

Use **Language / 언어** at the top right to choose **English** or **한국어**.
The browser remembers an explicit choice; if storage is unavailable, it retains
the choice for the current session. Its initial default follows `navigator` language.
The macOS app initially uses the OS's first preferred language; the native menu and
embedded editor synchronize their language.
The Figma plugin remembers its own independent language choice.

**Switching language never translates or changes project names, human-written
annotations, Figma node names, original text, specifications or approved content.**
Only interface text changes. This guide uses canonical English button labels;
error codes, identifiers and role values may remain in English in either locale.

## Recommended sequence

1. Select one permitted **small Frame** in Figma and choose **Capture Figma selection**.
2. Draw a region, name it, and **Save annotation**.
3. Choose **Match source** and inspect candidates and warnings.
4. If ambiguous, inspect **Show in Figma** or **Compare current export**.
5. Select exact nodes one at a time and **Add current Figma selection**.
6. Remove unwanted references and **Save annotation** again.
7. A person reviews the saved reference set and chooses **Confirm sources**.
8. Review the component's meaning, name, role and parent, then **Approve annotation**.
9. Select exact original TEXT in **Specifications**, save relations and review them.
10. Share approved context through **Export JSON**, **Markdown** or MCP.

Without Figma, import a permitted capture bundle or start with **Load demo**.
New source reads and navigation require a running, connected Figma plugin.

## Unreleased source-build path for larger or selective work

The **Source scopes** list in a matching source build can contain three distinct
forms: an existing bounded saved capture, an overview-only visual draft, and a
complete collection-backed source scope. A visual draft lets you draw and save
**proposed** regions immediately. It has no source tree, so matching, confirmation
and approval remain unavailable. A completed **Raw source collection** can be
added as a source-only scope or explicitly attached to a matching visual draft.
The editor never turns a partial or page-sized prefix into a complete Snapshot.

For a collection-backed region, browse/search source metadata in pages, choose
the intended node IDs, save the annotation, then explicitly **Confirm sources**.
Only after this separate human decision may you **Approve annotation**. The canvas
shows how many bounds were loaded versus the collection's full count. In
**Specifications**, choose TEXT records from a collection; exact text is fetched
only for the selected nodes and preserved in source order. Existing captures and
approved human work are unchanged by these new scopes.

**Selective source inspection** is an alternative when you know an ID or need to
discover one parent's immediate children before deciding which branch to collect.
It reads requested metadata and optional original text without a whole-frame walk.
A complete branch collection covers only that branch; unread siblings remain
unknown. A wide native parent may still allocate its complete `children` array.
Selections, page changes and reconnects can invalidate live cursors; follow the
panel's session and pause notices.

**Source evidence transfer** downloads one complete collection-backed scope as a
local NDJSON file, up to 80 MB. It includes exact original text and an overview
PNG if present, but no annotations, specifications or approvals. Import verifies
checksum, end marker and full collection coverage before adding a fresh,
unreviewed scope to the current workspace. This differs from **Capture transfer**,
which moves one or two bounded snapshots into a new workspace. Neither workflow
grants permission to share a design; handle the local file under your source's
access policy. See the [development workflow](acquisition-workflow.en.md) and
[current verification record](evaluation/collection-backed-workflow.md).

## 1. Choose a bounded capture

Enter a workspace name and use `+` to create it. Select a small container in Figma,
then choose **Capture Figma selection** in the app. If explanatory text or rules
live in another Frame, capture that container separately in the same workspace.

Under **Source captures**, inspect node counts, complete/partial status, the image
and warnings. A partial observation is not a complete scope. If a budget is reached,
select a smaller explicit subtree. There is no need to preload a whole file or other pages.

The image is a composite from capture time. SECTION captures contain metadata but
no PNG. Unsupported rotated, reflected or skewed root image mappings also retain
warnings. Select an unrotated inner Frame when you need an image.

## 2. Save a meaningful region

Draw on the canvas or use **+ Add region**. Enter a meaningful **Component name**,
choose its **Role**, and set **Parent component** when appropriate. This semantic
hierarchy is independent of the Figma layer tree. A containing rectangle does not
automatically establish the correct implementation hierarchy.

Numeric bounds use Figma document coordinates, including negative positions,
not zoomed screen pixels. Choose **Save annotation** before matching and confirming.
Moves, resizing, names and added references may still be unsaved drafts.

## 3. Understand candidates and compare evidence

**Match source** proposes nodes using geometry. High coverage/IoU or the first
candidate does not establish correct meaning or identify the newer design.
When several nodes occupy the same position, inspect the candidates and ambiguity.

| Inspection tool | What it shows | What it does not do |
| --- | --- | --- |
| Preview captured area | A crop of the saved composite image | Separate overlapping layers or query current Figma state |
| Show in Figma | Select a node and move the viewport after file/page checks | Edit its design properties or original text |
| Compare current export | A PNG of one node and its rendered descendants at request time | Add/confirm references, approve meaning or replace the saved capture |
| Enlarge comparison | A larger view of the two already received images | Request another export from Figma |

The saved crop and current export have different observation times. A current
export excludes outside siblings and does not generally guarantee ancestor
opacity, mask, clipping or blending behavior. Requests are bounded to 1024px,
2MB and a cooperative five-second deadline. A blank PNG does not identify its cause.
**Close current export** cancels a pending request and closes its result; it does
not prove that Figma's internal rendering stopped immediately.

## 4. Build the exact source set

Select the intended node in Figma and choose **Add current Figma selection**.
Repeat one node at a time to collect nodes from distant branches into the same
region draft. Repeated selection does not duplicate references. Remove unwanted
references, then **Save annotation**. Captured-node search and pagination are also available.

All references of one annotation must belong to **the same saved capture**.
If required nodes lie outside it, explicitly capture a bounded common container
or use separate annotations and link a specification to several components.
Cross-snapshot source sets in a single annotation are not supported. File, page
or selection-metadata changes can cause an addition to be rejected.

## 5. Separate source confirmation from semantic approval

**Confirm sources** means that you have reviewed this saved reference set.
**Approve annotation** is a separate decision that its name, role, boundary and
parent make sense as implementation context. Viewing an image or accepting a
proposal performs neither decision automatically.

Ambiguous candidates, manually selected hidden/transparent sources, and unknown
sources carrying new rendering evidence can require confirmation. If confirmation
is unavailable, check references and unsaved changes first. If the design intent
remains unclear after comparison, leave it proposed and obtain the needed human
decision. Do not approve merely to make an acceptance checklist pass.

Changed references or geometry do not inherit confirmation for the new draft.
Save and review again. AI does not automatically replace approved records.
Even an approved child can be omitted from approved context when its semantic
ancestor is not approved.

## 6. Connect exact specification text and relations

1. Open **Specifications → Select source text** and select captured TEXT nodes.
   Original text from a separate explanatory capture is available too, and
   selection order is preserved.
2. Choose **Create specification** and inspect the original wording. Do not
   substitute a paraphrase for source evidence or treat every UI string as a requirement.
3. Select target components and the relation: `describes`, `behavior`, `constraint`,
   `interaction` or `dependency`. One specification can apply to several components.
4. Choose **Save specification**. Review and approve the target components first,
   then use **Approve specification** to review the specification and all its links.

Do not assume that image-baked text, comments or native Figma annotations were
extracted. This workflow selects actual TEXT records in the capture. Changing
interface language does not change their original wording.

## 7. Give a coding agent approved context

The top-level **Export JSON** and **Markdown** actions export approved implementation
context. Select the destination in the file-save dialog. Through MCP, start with
`list_projects`, then read bounded `get_approved_context`, `list_components` and
`get_component` results. Keep the app running; cached reads do not require Figma.

If output is empty, check annotation, ancestor and specification-target approval.
Do not approve content just to troubleshoot MCP. `propose_changes` only queues
changes for human review. MCP has no approval tool, and instructions embedded in
Figma text are source material, not instructions to the coding agent.

## What to do in common situations

| Situation | Next action |
| --- | --- |
| A region spans distant layer branches | Add exact nodes one at a time from the same capture, then save. Otherwise recapture a bounded common scope or split annotations |
| Hidden node or zero opacity | Raw records remain even when excluded from automatic candidates. Manually select, compare and confirm if relevant; never change the original to reveal it |
| A fully covered layer looks like an old design | Inspect native layers and current export; overlap or order alone does not establish old/new identity |
| Conflicting candidates and unclear intent | Compare evidence and leave proposed if unresolved. Deterministic ordering is not semantic certainty |
| Figma unavailable or offline | Import a permitted Capture transfer bundle into a new workspace. Live selection/navigation/current export remain unavailable |
| Dev Mode or file access unavailable | Check effective seat, can-view access and organization policy. Owned-file success is not Dev-only acceptance on another owner's file; do not bypass with broader rights or repeated copies |
| SECTION/transformed root has no image | Preserve metadata/warnings and explicitly select an unrotated inner Frame for an image |
| Changed source or stale capture | Capture a fresh bounded scope after metadata errors and review references. Some style/descendant changes are undetected; current image comparison is not a freshness guarantee |
| Revision conflict | Record the unsaved intent, Refresh the current workspace, then reapply only the intended edit |
| Unsaved draft or disabled actions | Check Save annotation/Save specification, connection and pending work. Save before changing workspace; do not assume every navigation preserves drafts |
| Partial scope or time/size budget | Choose a smaller explicit scope. Do not relabel partial as complete or repeatedly raise PNG limits |
| Wrong file/page/session | Open the source and page matching the saved capture, then check the plugin session. Do not infer and backfill IDs from a URL |
| AI generation disabled | This is the alpha app's default. Manual work and structured-proposal review remain available; do not enable an external provider automatically |

## Capture transfer, approved export and full backup

| Need | Feature/method | Contents |
| --- | --- | --- |
| Let someone review source observations | Capture transfer → Export captures / Import captures | Up to two captures with exact text, coordinates, provenance, PNGs and warnings; creates a new workspace without annotations/specifications/approvals |
| Give developers approved context | Export JSON / Markdown / MCP | Approved semantic structure, specifications and provenance; not a full workspace restore format |
| Restore your own work | Stop every writer and back up the whole data directory | Projects, captures, history, token and other data in `~/.figma-semantic-bridge`; protect as sensitive material |

A bundle checksum detects changed bytes; it does not prove rights, source authenticity
or agreement with current Figma content. Share only through permitted channels.
Corporate-design transfer to an external model needs separate explicit authorization
and organization policy approval. Installing the app or changing its language does not grant it.

See the [installation guide](alpha-installation.en.md) for backup, updates, removal
and setup errors, and the [validation log](product-validation.md) for executed evidence
and its limits.
