# User scenarios and recovery choices

> This is an **archived analysis of 0.2.0**. In 0.2.1 normal imports use chunked structure, automatic image/source binding and configurable budgets. See [current import/settings guidance](acquisition-workflow.en.md). Cross-session partial supplementation remains future work.

[한국어](user-scenarios.ko.md) · [User guide](user-guide.en.md) · [Import guide](acquisition-workflow.en.md) · [Proposed improvements](recovery-plan.en.md)

**0.2.0 Alpha · checked on 2026-10-26**

This analysis follows the current implementation and user interface, not planned
features. Completing the main task means **obtaining the required sources,
having a person review and approve their connections and meaning, and sharing
that context with a coding agent**. Viewing an image or reading a few layers is
a different, smaller outcome.

## Current state at a glance

- Small areas can go through import, review, approval and sharing.
- Large areas can follow the same workflow **once collection finishes**. An image
  is optional for a completed structure collection.
- A large collection can resume after a **pause**, under certain conditions.
  **Recovery after reconnecting** is different: saved parts do not restore the
  position from which reading can continue.
- Reading specific nodes or immediate children and reopening those observations
  is supported. **Using those reads to fill gaps in a failed full collection is not.**
- “Results are retained” therefore does not mean “those results let you continue
  the original task.” This is a real gap in the current product.

## How to interpret the outcomes

| Outcome | Meaning |
| --- | --- |
| Continue | Use the existing results for the next step without reading them again |
| Resume | Keep saved parts and read the remainder, subject to stated conditions |
| Restart | Records may remain, but a new read starts from the beginning |
| Change scope | A smaller area may work; this does not complete the original larger area |
| Current route blocked | The current results and available interface cannot finish that task |
| External condition required | Access, a permitted source, a valid backup or another prerequisite is needed |

A blocked task does not always block the whole app. Losing live Figma access can
leave previously saved, valid sources usable. Damaged local sources are a
separate case.

## 1. Opening the app and accessing sources

| Situation | Result | Available next step | Can the original task finish? |
| --- | --- | --- | --- |
| App and plugin connected; one readable container selected | Success: check its name and bounds, then choose what to import | Small capture, overview, full structure collection or specific-node reads | Yes, after completion and review |
| Figma plugin closed or disconnected | New reads and Show in Figma unavailable | Reconnect; meanwhile review, approve and share existing valid sources, or import a permitted source file | Existing sources: yes. New sources need connection restored |
| Editor or agent cannot connect to the app's local service | Workspace reads and writes unavailable | Start the app and repair the connection | Blocked until restored. Refresh does not recover unsaved input |
| Multiple areas or an unsupported target selected | Preparation rejected | Select one positive-sized container, such as a Frame or Group | Yes after correcting selection |
| Source file identity unavailable | New provenance-dependent reads rejected | Check the original file and local plugin execution path, or use permitted transferred sources | External condition required; no manual identity bypass |
| Plugin cannot run on another owner's view-only file | New live reads unavailable | Check account, file and organization permissions; alternatively receive an allowed source file produced through a supported route | External condition required; this exact account combination remains unverified |

Paying for Dev Mode does not establish that this app works on every view-only
file. An unverified access combination also does not prove that edit permission
is necessary. The app's default behavior does not modify the source design.

## 2. Importing a small screen's image and layers

The four choices under **Capture Figma selection** have different outcomes.

| Choice and outcome | What existing results allow | Recovery choice | Assessment |
| --- | --- | --- | --- |
| Both image and structure succeed | Save complete capture, then draw, review and approve | None needed | Continue |
| Structure only selected from the outset and succeeds | Review and approve using bounds, records and original text without an image | Use a separate image route if needed | Continue |
| Overview only selected from the outset and succeeds | Create draft from overview; save proposed regions and names | Collect and attach complete structure of the same area before approval | Drafting works; approval blocked for now |
| Both requested; image succeeds, structure fails or is partial | View and enlarge the received image; cannot save a complete capture | Restart structure read in the same connection, or start a separate large collection | No button turns this retained image directly into a region draft |
| Both requested; structure succeeds, image fails | Structure is retained, but saving the complete capture is blocked | Retry overview in the same connection; if no image is needed, start a new structure-only read | No button skips the failed image and saves just the existing structure |
| Small structure read reaches node, byte or time limit | Partial structure and reason are recorded; cannot add it to the editor | Switch to a large collection or explicitly select a smaller area | Repeating the same limit is not a solution; appending to the partial read is unsupported |
| User stops the import | Earlier completed results remain; late output is discarded | Start a new import | No retry button for the stopped task itself |
| App closes or plugin connection changes during reading | Earlier persisted observations and records may survive | Save results that remain fully ready; prepare a new task for unfinished live work | Cannot resume from the interruption point |

The small structure read defaults to **5,000 nodes, 2 MB and 5 seconds of
reading**. Retrying structure starts **from the beginning**. It keeps a successful
image, but does not append to the partial structure.

**Overview, then structure does not automatically open a drawing workspace while
structure is still loading.** The image can appear early, but Create draft from
overview is not available during that two-step task. To draw first, choose
**Overview only → Create draft from overview → a separate structure collection**.
If a two-step task already failed, starting that route reads the image again.

## 3. Collecting all layers in a large area

**Collect source structure** is separate from small captures. It allows up to
200,000 nodes and 64 MB, saved in parts of at most 500 nodes and 1 MB. Images are
acquired separately.

| Situation | Retained data and usable results | Next action | Assessment |
| --- | --- | --- | --- |
| Collection completes | Browse nodes and text, add to workspace, review, approve and share | Review without an image or attach to a matching image draft | Continue |
| User pauses | Saved parts and progress remain; node browsing and editor attachment are still unavailable | Resume collection with the same valid connection | Resume |
| One run reaches about five minutes | Automatically pauses between parts, retaining saved work | Resume under the same conditions | Resume; the entire collection does not have to finish within five minutes |
| Figma temporarily busy or a response times out | Becomes paused if the connection remains valid | Check the cause, then resume; already saved parts are not reread | Conditional resume; an unacknowledged response may be requested again |
| Idle for ten minutes, plugin reconnects or app restarts | Saved parts and records remain, but the read position cannot be restored | Start collection again, or newly collect a smaller required area | Reusing or supplementing this partial collection is blocked |
| Page changes or a source change is detected | Progress rejected to avoid mixing different sources or times | Check the source, collect again and review | Cannot append a new observation to the old partial result |
| Total node/byte limit exceeded, or one node's original text is too large | Cannot use as complete structure | Newly collect a smaller area if the task permits | Change scope; if the exact whole area is required, the current route is blocked |
| Duplicate, missing, invalid-parent or storage-integrity check fails | Not accepted as complete sources | Fix the cause and collect again, or restore a valid backup | Resume alone is not a guaranteed remedy |
| Another collection starts while a paused one retains its reading position | New collection may be blocked by the earlier task | Resume the earlier task, or delete its record if unwanted | New work can proceed after release. Deletion also removes saved parts; reconnecting loses resumability |
| Deletion cannot confirm that Figma released the earlier read | Record retained; deletion fails | Retry release/deletion, or reconnect the plugin if needed | New reads may be temporarily blocked |

Pause waits for the current part to finish reading and saving. It is not an
immediate stop or a maximum-memory guarantee. Figma may internally prepare a
wide parent's whole child array even though the app returns small responses.

**The distinction:** resuming within a valid connection exists. Opening a partial
collection for review after reconnecting, or fetching only its missing parts to
complete it, does not.

## 4. Reading specific layers or a smaller nested area

| Situation | Available result | Limit or recovery condition | Assessment |
| --- | --- | --- | --- |
| Explicit node IDs read successfully | Inspect their metadata and, if requested, exact text; reuse the same saved request | Does not cover their descendants; cannot attach these observations directly as approvable sources | Inspection goal complete; approval requires additional collection |
| All immediate children of one parent read | Inspect direct children and choose a required container | Does not include grandchildren or deeper layers | Exploration goal complete |
| Child-list reply lost while the same connection remains | Reopen saved pages and request the same position again | Figma's reading position must still be valid for continuation | Conditional retry |
| Child listing interrupted by reconnect or app restart | Reopen previously stored lists and text | Start a new inspection to read the remainder; past and new results are not automatically merged | Reading history works; continuation restarts |
| Nested-area collection finishes | Select its record under Collect source structure, add to workspace, review and approve | Excludes outside siblings; cannot directly attach a small branch to a larger image draft | That nested area's task can finish |
| After a failed large collection, separately read apparently missing IDs | Inspect those separate observations | Does not complete the failed collection; no cross-read merge, deduplication or missing-coverage determination | Original whole-area task remains blocked |
| Reopen a repeated request after the design changed | View the previous observation | Reuse does not check freshness; prepare a new inspection for fresh data | Restart if current data is needed |
| Node missing or moved outside the chosen area | Inspect the error and choose the right IDs or scope | Missing nodes are not silently skipped as a successful read | Correct the target |

The app reads up to 100 explicit IDs per request, or up to 100 immediate children
per page. The coding-agent explicit-ID tool allows up to 40 per call. None of
these operations completes gaps in an earlier failed collection.

## 5. Connecting an image and source structure

| Situation | Result and next action | Can the task finish? |
| --- | --- | --- |
| Image draft and complete structure share file, page, selected root and bounds | Attach while retaining the image and draft regions; save sources, confirm and approve | Yes; manually check the independently timed observations |
| Looks similar, but file, selected root or bounds differ | Attachment rejected; collect the correct area or add a separate source | Cannot directly attach to this draft |
| Only a small area of a large image has been completely collected | Use the small area independently | Does not resolve the large image's incomplete sources |
| Replace previously attached structure with a newer collection | Add a new source scope and review again | No automatic migration of existing regions or approvals |
| Structure complete, no image available | Review with coordinates, layers and text | Yes; inspect Figma directly where visual judgment is needed |
| Section or unsupported root rotation/transform prevents an image | Collect structure only, or explicitly choose an appropriate inner Frame for the image | Structure work can continue; choosing a different Frame also changes the source scope |

## 6. Reviewing overlapping or scattered layers

| Situation | Successful path | Limit or failure | What is blocked? |
| --- | --- | --- | --- |
| One semantic component spans distant branches | Select several nodes within the same acquired area for one region | A region cannot mix references from separate source scopes | Newly collect a common container, or review separate regions. If that common area cannot be acquired, the original single-region task is blocked |
| Older design hidden or at zero opacity | Record retained, excluded from automatic position candidates; explicitly select and confirm if intended | Hidden state does not establish design age | Continue if a person can decide |
| Older opaque design covered by a newer layer | Inspect exact nodes in Figma and compare current images | Position, order and image do not automatically establish visible contribution or intended version | Withhold that approval if a person cannot decide; other regions can continue |
| Current image comparison succeeds | Use saved and current images to inform source review | Merely viewing does not approve; outside siblings may be absent from the node image | Continue after review |
| Current image fails or is blank | Show in Figma; inspect saved image, records and text; reacquire if the source changed | Cannot automatically determine why it is blank | Comparison alone may fail. Withhold the affected approval if evidence is insufficient |
| Automatic candidates excessive or wrong | Search the complete stored sources and choose intended nodes manually | Position score is not semantic probability; loaded canvas bounds do not establish full coverage | Manual review may complete the task |

Current image comparison is available for **small saved captures and regions
backed by complete structure collections**. It requires live Figma access because
it requests a new image. An image-only draft has no source nodes to compare yet.
Source content stays unchanged; **Show in Figma** changes selection and viewport.

## 7. Saving, approving and linking requirements

| Situation | Available work | Final approval and sharing |
| --- | --- | --- |
| Image-only draft | Save proposed regions and names | Blocked until matching complete structure is attached |
| Incomplete small capture already in a workspace from an earlier version or imported file | Inspect saved records and make proposals | New matching, confirmation and approval blocked. The current import UI also prevents newly saving such an incomplete capture |
| Complete sources and chosen references saved | Confirm sources where required, then approve meaning | Supported; every collection-backed region needs explicit source confirmation |
| Unsaved input | Save first; some imports, attachment and confirmation actions are disabled | Continue after saving; unsaved input survival across app close or refresh is not guaranteed |
| Another window or agent changes the saved workspace | Preserve editing intent separately, reload current workspace and reapply | That write is blocked until conflict is resolved; blind retry does not overwrite newer work |
| Name, geometry or references of an approved region edited | Save and review meaning again | Meaning approval is needed again; geometry/reference changes also require source confirmation again |
| Requirements exist in actual TEXT layers | Select verbatim text, save target relations and approve targets first | Share after reviewing and approving the requirement and its links |
| Words exist only inside an image, comment or separate native annotation | Inspect manually in Figma | Current text extraction does not establish these as captured TEXT; OCR and comment acquisition are not implemented alternatives |
| Only part of a text has loaded, or a single layer exceeds the storage limit | Finish available text paging; treat oversized source text as a separate limit | Cannot approve a shortened string as the complete original |
| AI provider absent, failing or producing poor proposals | Continue all manual workflows; reject proposals or request new ones | AI is optional; accepting a proposal does not approve meaning |
| External AI transfer not consented to | Continue manual review without external transfer | The manual workflow can finish the task; corporate-source transfer also requires the organization's permission |

Complete sources mean the entirety of **the chosen collection area**, not the
whole file or proof of a layer's intended product meaning.

## 8. Sharing, offline work and backups

| Situation | Available route | Recovery or qualification |
| --- | --- | --- |
| Source connections and meaning approved | Share approved context through JSON, Markdown or a coding agent | An approved child under an unapproved semantic ancestor is withheld; check ancestry and review status |
| Shared output empty or partial | Check approvals, requirement targets and omission/size notices | Empty can be correct. Agent reads can be paged; a bounded result is not necessarily the whole context |
| Continue without Figma | Review, approve and share valid saved complete sources | New source/current-image reads and Show in Figma need connection |
| Receive a valid source file | Import source file adds unreviewed sources to the current workspace | App-specific file, up to 80 MB; arbitrary Figma files and PNGs are not substitutes |
| Receive a small capture bundle | Review in a new workspace | Carries observations, not annotations, requirements or approvals |
| Source file truncated or corrupt | Import rejected; request a valid replacement | Cannot upload missing fragments to complete the earlier failed import |
| Disk space or record-count limit reached | Remove unwanted records, free space and retry | In-use collections cannot be deleted. Deleting records removes partial data too and is not a backup |
| Workspace's required source data missing or corrupt | Restore a valid backup containing all required data | New approval and sharing blocked; other writes may also be affected. A newly collected different source is not automatically substituted |
| Stored collection validation fails during app startup | Restore a valid backup and investigate the cause | The local service may not start, blocking the whole editor. Do not treat blind deletion of source data as recovery |
| App update or device migration | Stop all writing services and back up/restore the full data folder | Approved-context exports and source-transfer files are not full workspace recovery backups |

Source files and small capture bundles **do not transfer review or approval**.
Approved-context exports convey reviewed implementation context, not a full
source archive or restorable workspace. Share source material only within the
owner's and organization's allowed scope.

## 9. If a collection is interrupted now

1. **Large collection paused, same connection retained?** Resume without editing
   the source or switching pages, within ten minutes of inactivity.
2. **Connection changed or app restarted?** The saved partial result cannot be
   continued to completion. If the whole original area is needed, collect anew.
3. **Small capture hit a limit?** Start a large collection rather than repeat the
   same limited read. Its partial records are not migrated automatically.
4. **Can a smaller area truly satisfy the task?** Newly collect and review that
   area completely. Do not report outside areas as completed.
5. **Only an image and some nodes remain?** Viewing the image or separate
   inspection history may work. Combining them into approvable sources is
   currently blocked.

The current app does not automatically fall back to Figma REST APIs after a
failure. Image rendering and structure reading follow the selected order rather
than running concurrently. An image render already started in Figma cannot stop
immediately and may remain busy briefly after cancellation; check that it has
settled instead of sending repeated new requests.

## 10. Gaps that require implementation

These are missing capabilities, not incorrect user settings.

| Needed capability | User problem it would solve |
| --- | --- |
| Open partial collections with explicit usable coverage | Even retained parts currently cannot be reviewed or used in the editor |
| Distinguish received and missing portions; fetch only what is needed | Reconnection forces repeated reading and leaves missing coverage unresolved |
| Validate and merge separate observations | Specific-node reads cannot supplement a full collection; different times and areas must not be combined blindly |
| Use successful evidence after another import step fails | An available image cannot become a draft, or available structure cannot be saved because an image failed |
| Track smaller areas against the original task | Avoid mistaking local success for whole-task completion and reduce draft rework |

Treating unread data as absent, or simply enabling approval on incomplete sources,
would not resolve these gaps safely.

## Evidence and limits

The interface, storage, resume and approval conditions in source
`e6bc5baf90c7bac886801417a2828f7a096c427f` were compared with existing tests.
This audit reran **124 related automated tests** and **22 Chrome browser tests**,
all passing. Tests use synthetic data. No production Figma file was deliberately
interrupted while preparing this document. The original approximately
106,000-node file, Figma native peak memory and the effective Dev-only account
with another owner's view-only file were not newly validated by this analysis.

Implementation references: [import interface](../web/AcquisitionPanel.tsx),
[collection interface](../web/CollectionPanel.tsx),
[targeted-read interface](../web/SelectiveSourcePanel.tsx),
[import handling](../src/server/acquisition.ts),
[resume handling](../src/server/structure-collections.ts),
[stored-source access conditions](../src/server/structure-collection-store.ts),
[source binding and checks](../src/server/evidence-scopes.ts),
[approval rules](../src/core/project.ts),
[current-image comparison](../src/server/source-preview.ts).

The existing user guides incorrectly restricted current image comparison to small
captures. Both language versions were corrected to reflect the implementation.
