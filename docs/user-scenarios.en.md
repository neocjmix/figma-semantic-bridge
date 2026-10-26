# Workflows, interruptions and recovery

[한국어](user-scenarios.ko.md) · [User guide](user-guide.en.md) · [Import and settings](acquisition-workflow.en.md)

The app brings Figma evidence into a workspace where a person defines regions,
reviews meaning and approves the result. **Receiving an image, completing source
structure and human approval are separate steps.** These are the 0.3.0 Alpha workflows.

## Successful paths

| Situation | Available work | Next action |
| --- | --- | --- |
| Adding a source | Check target, budgets and risks | Start import |
| Image received first | Zoom, draw regions, save names and roles | Organize the needed regions |
| Structure still loading | Browse received nodes and text; edit proposals | Wait or pause |
| Whole structure ready | Search, match and review source even without an image | Confirm exact source nodes |
| Whole import unfinished; a subtree is complete | Review that part on the large image; copy the selected saved proposed region | Review this part |
| Needed container is unfinished | Read only that container and its descendants | Prepare this part |
| Exact sources confirmed | Review names, roles and relationships | Approve annotation |
| Annotations and specifications approved | Share approved context through MCP or a file | Deliver the needed result |

Approving a part does not complete the original whole-source request. If related
layers lie outside that part, obtain broader evidence. Overlapping images do not
automatically establish design age or which layer contributes visible pixels.

## Interrupted and failed acquisition

| Situation | Received evidence | Recovery | What is blocked |
| --- | --- | --- | --- |
| Node, byte or run budget reached | Saved image and packets remain | Raise Settings and Continue | Approval only for unprepared coverage |
| Paused in the same valid connection | Saved position remains usable | Continue from the next position | Coverage not yet prepared |
| Temporary delay or busy Figma | Completed packets remain | Resolve the cause and Continue | New reads temporarily |
| App restart or plugin reconnect | Saved evidence, edits and approvals remain | Continue, review the recheck cost, then confirm | Unverified coverage during new reads |
| Work on a needed part first | Original evidence remains | Prepare the part; confirm if the current reading position must be released | Original whole request stays incomplete |
| Image fails; structure succeeds | Source metadata and original text remain usable | Review structure or compare in Figma | Judgments requiring the missing image |
| Image succeeds; structure stops | Image drafts, saved nodes and complete parts remain usable | Continue or prepare the needed part | Confirmation and approval without sufficient evidence |
| Text, children or order changed | Previous observations and approvals remain | Review the new observation separately | Applying old approval automatically to new sources |
| Source deleted, inaccessible or on another page | Saved evidence remains readable | Return to the permitted source or add a new source | New reads of that source |
| Disk or record capacity exhausted | Successfully saved evidence remains | Free space or remove unused records, then Continue | New storage |
| Saved evidence damaged | Separate unaffected work remains | Restore a valid backup or acquire fresh evidence | Review and export depending on damaged evidence |

**Continue** does not resurrect a lost Figma reading position. After reconnecting,
previously received nodes are also rechecked. Matching content uses compact replies
to reduce repeated transfer. Old and new evidence are never merged into apparently
complete coverage without verification.

Figma image export may not stop immediately. Pause applies after the current
export or durable packet. Repeating a large render or merely increasing its wait
does not guarantee success.

## Review and approval gates

| Situation | Reason and next action |
| --- | --- |
| Only an image is available | Save proposed regions; prepare structure or a complete subtree |
| Region exceeds the part's source coverage | Outside evidence is missing. Prepare broader sources or explicitly adjust the intended region |
| Several candidates or overlapping design versions | Compare nodes and text; use Figma navigation and individual previews, then select exact sources |
| A saved ancestor is hidden or transparent | Known hidden evidence is retained and excluded from automatic candidates. Manual selection requires explicit comparison and confirmation |
| No source references | Select exact received nodes; prepare missing coverage if necessary |
| Unsaved edits | Save or discard them before changing workspace or source |
| Old approval exists but source was reread | The old approval stays with its old evidence. Review the new observation separately |

## Files and external access

- Browsing saved evidence and reviewing imported source files need no Figma connection.
- Source files may contain design images and original text. Share only with permission.
  A small part's context image may still include surrounding designs.
  Importing a source file does not approve annotations or specifications.
- Approved-context sharing includes approved evidence. Source-file transfer and
  full workspace backup serve different purposes.
- Multiple reads do not guarantee one immutable source revision, even within one
  selected region. Work requiring that guarantee is not satisfied by this path alone.
- Another owner's view-only file, organization policy and the original very large
  work file need validation in their actual access environments. These are separate
  from saved-evidence functionality.
