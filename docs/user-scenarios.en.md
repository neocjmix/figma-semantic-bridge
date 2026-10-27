# Successful paths, failures and recovery

[한국어](user-scenarios.ko.md) · [User guide](user-guide.en.md) · [Import and settings](acquisition-workflow.en.md)

The main path is **Add source → Save region → Confirm sources and approve → Link specification → Share**.
Find your current situation below. “Available work” describes what you can still do while resolving it.

## When work proceeds normally

| Current state | Next action | Result |
| --- | --- | --- |
| First launch | Create a workspace and connect the Figma plugin | Ready to import the selected Frame |
| A Frame is selected in Figma | **Add source → Start import** | Image and source material saved locally |
| The image appears first | Draw, name and **Save region** | Draft regions while structure arrives |
| Structure is ready | Check each saved region's linked nodes | Review the link between source and region |
| The linked nodes are correct | **Confirm sources → Approve region** | Region ready for implementation context |
| An approved region has requirements | **Link specification → Choose original text → Create specification** | Draft with that region as its initial target |
| Text and targets are correct | **Save specification → Approve specification** | Requirements linked to reviewed regions |
| Review is complete | **Share → Export JSON / Markdown**, or MCP | Approved context delivered |

## Connection and import

| Situation | Available work | Recovery |
| --- | --- | --- |
| Figma is disconnected | Use saved sources and approved work | Open the plugin and connect with the app's pairing token |
| No source or multiple sources selected | Continue existing work | Select one intended Frame, then **Add source** |
| File, page or selection changed after preparation | Keep existing work and received material | Return to the intended source and prepare again |
| Node, byte or reading-time limit reached | Browse received material and review prepared parts | Raise the relevant limit in **Settings**, then **Continue** |
| Figma is busy or slow | Keep received material and existing work | Check Figma, then **Continue** |
| App restarted or plugin reconnected | Use saved material and approvals | **Continue**, review the source recheck work and proceed |
| Image failed; structure succeeded | Create and review regions using nodes and text | Inspect the appearance in Figma or import a suitable inner Frame |
| Image succeeded; structure stopped | Use image drafts, received nodes and complete parts | **Continue**, **Review this part**, or **Prepare this part** according to what you need |
| Only a needed small part is unfinished | Continue using other prepared parts | **Received sources → Prepare this part** |
| Source deleted or access changed | Read existing saved material | Return to an accessible source or add a new one |
| Disk is full | Keep successfully saved material | Free space and **Continue**; keep the source data folder intact |
| Saved material is damaged | Work that uses other material remains available | Restore a valid backup, or import fresh sources and review again |

The same valid connection continues from the saved position. After reconnecting, previously saved
nodes are also checked in Figma. Existing approvals and material remain, and the new observation is
saved separately. Figma may still be finishing an image export just after cancellation.

## Regions and source review

| Situation | Available work | Recovery |
| --- | --- | --- |
| Only the image draft is ready | Save region names and boundaries | Confirm and approve after structure is prepared |
| No nodes are linked | Keep the region draft | Find candidates again, browse nodes or add the Figma selection, then save |
| Distant branches belong to one component | Link them within the same imported source scope | Add the intended nodes individually, save and confirm |
| Required nodes are in another source scope | Use separate regions | Import their common Frame, or link separate regions to the same specification |
| An older layer is transparent or covered | Compare saved material and candidates | Use **Show in Figma** and **Compare current export** to choose the intended nodes |
| A region extends beyond a prepared part | Keep the draft region | Adjust its intended boundary or prepare broader sources |
| An approved region was edited | Keep its source material and review the update | Save, confirm sources when required, then approve |
| Parent region is awaiting approval | Edit and review the child | Approve the parent to include the hierarchy in shared results |
| Split or merge was a mistake | Restore the previous edit | **Undo**, with **Redo** available if needed |
| Child regions prevent deletion or splitting | Keep the existing regions | Reparent or remove the children first, then retry |
| Saving failed | Keep the current draft | Correct the input or source selection and save again; note the diagnostic reference if it repeats |

Overlap and layer order are review aids. The person decides the intended source and approves its
meaning. Approving a part remains separate from completing the whole import.

## Specifications, sharing and other edits

| Situation | Available work | Recovery |
| --- | --- | --- |
| Requirements are in another Frame | Keep current region work | Add that Frame to the workspace and select it under **Specification source** |
| No source text is available | Review and share regions | Prepare a source containing TEXT; inspect image text and comments separately |
| Original text failed to load | Keep saved specifications and other work | Select the text again; restore valid sources if material is damaged |
| A specification target awaits approval | Save the specification draft | Approve linked regions, then approve the specification |
| Draft edits prevent starting another task | Continue editing that draft | Save or discard the changes before switching |
| Another window or agent updated the workspace | Keep saved material | Preserve your draft intent, refresh, then apply it to the latest work |
| Shared results omit some items | Deliver the eligible approved result | Check region, parent and specification-target approvals |
| A source file failed to import | Keep the existing workspace | Select a valid file; download a fresh copy if damaged |
| Settings did not save | Continue with the previous settings | Use the displayed ranges; reopen settings after a conflict |
| AI drafting is unavailable | Continue manual annotation and review | Check supported sources and provider settings, or complete the same work manually |
| An old proposal cannot be applied | Keep the latest human edits | Reject it and prepare a new proposal from current sources |

Undo and Redo restore recent saved edits. They are separate from recovering unsaved input after
quitting or restoring all data from a backup. For full recovery, follow the
[upgrade and backup guide](upgrade-guide.md).

## Investigating an error

If an error repeats, record **the action, time and diagnostic reference shown on screen**.
Local diagnostics connect requests with their outcomes for investigation. The
[online QA record](https://github.com/neocjmix/figma-semantic-bridge/blob/main/docs/evaluation/guided-workflow-qa.md) describes what was verified.
An error report does not need source images, original text or a pairing token.

In this alpha, another owner's view-only file with a Dev-only account and performance on every
large work file require checks in those actual environments. These conditions are separate from
reviewing saved material.
