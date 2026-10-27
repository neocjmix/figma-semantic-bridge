# Figma Semantic Bridge user guide

[한국어](user-guide.ko.md) · [Installation and MCP](alpha-installation.en.md) · [Troubleshooting](user-scenarios.en.md)

Follow **Add source → Save region → Confirm sources and approve → Link specification → Share**.
Bring a Figma design into a local workspace, then pass your reviewed interpretation to a coding agent.

The app connects its editor automatically. Keep the Figma Desktop plugin connected when bringing in
new sources. Saved material remains available after closing Figma.

![Workspace and region review using a generated design](images/workflow.en.png)

## 1. Add a source

1. Create a workspace or open an existing one.
2. Select the Frame you want to work on in Figma.
3. Choose **Add source**, check the target and import limits, then **Start import**.

Start drawing regions when the image appears. Structure is saved next and attached when ready.
If you are editing a region, use **Save region** to allow attachment to finish.
Leave the Figma source unchanged during import so its image and nodes are easier to compare.

Start with the default settings. For larger sources, open **Settings** to raise the relevant limits.
New images use 2× scale and a maximum long edge of 4,096px; structure defaults to 200,000 nodes and
64 MB. See [Import and settings](acquisition-workflow.en.md) for the available ranges.

## 2. Draw and save a region

Draw on the canvas or choose **+ Add region**. Enter a **Component name** and choose **Save region**.
The app also finds source nodes that match the region's position.

A name and boundary are enough to start. Open **Region settings** when you need a role, parent
component or precise coordinates. The parent describes your intended implementation hierarchy;
it can differ from the Figma layer tree.

Select a saved region to move or resize it. Save or discard your draft before starting another edit.
Changing an approved region makes the updated interpretation ready for review again.

## 3. Check the linked nodes and approve

Check that the linked source nodes represent the design you mean. Choose **Confirm sources**, then
review the region's name and meaning and choose **Approve region**.

- **Confirm sources:** these nodes are the evidence for this region.
- **Approve region:** this name, boundary and role are ready to use in implementation.

![Source review tools using a generated design](images/source-review.en.png)

Use the source review tools when layers overlap or older designs remain in the file.
Open **Change source nodes** to search for alternatives or add a Figma selection.

| What you need | Tool |
| --- | --- |
| Inspect the layer directly | **Show in Figma** selects it and moves the viewport |
| See the selected layer's current appearance | **Compare current export** |
| Adjust the suggested nodes | Select or remove candidates in the source list, then **Save region** |
| Add a node from another branch | Select it in Figma, choose **Add current Figma selection**, then **Save region** |

Viewing an image or selecting a node leaves the approval decision with you. If a node is transparent
or covered by another layer, check the intended layer in Figma. Distant nodes can belong to one
region when they share the same imported source scope. For nodes outside that scope, import their
common Frame or use separate regions linked to the same specification.

Approve parent components too. Shared results include regions whose approved hierarchy is ready
for use.

## 4. Link a specification

Choose **Link specification** on an approved region. That region becomes the initial link target.

1. Select the source containing the requirements under **Specification source**.
2. Open **Choose original text** and select **Use original text** for the TEXT records you need.
3. Choose **Create specification**, then check the target components and relationship types.
4. Choose **Save specification**, then **Approve specification**.

Several text records retain their original wording in selection order. One specification can link
to several components through **Edit component links**. Approve those components first so the specification is ready to approve.
Use **New specification** to begin the next one.

The picker uses Figma TEXT records. Words inside images, comments and native annotations may not
appear here. If the requirements are in a separate Frame, add that Frame to the same workspace.

## 5. Share the reviewed result

Choose **Share** to review what is ready, then **Export JSON** or **Markdown**.
To connect a coding agent, use the app menu **Bridge → Copy MCP Configuration**.
The [installation and MCP guide](alpha-installation.en.md) explains setup.

Shared results include approved regions and specifications. If an item is missing, check its approval,
its parent's approval and the approval of its specification targets. MCP reads follow the same rules.
Keep the app open when an agent reads saved work; Figma can remain closed.

## Adjust and recover

| Situation | Next action |
| --- | --- |
| A region was split or deleted by mistake | **Undo**; use **Redo** to apply that edit again |
| A name, coordinate or source selection needs correction | Adjust the draft and **Save region**, or discard the changes |
| Import paused | Raise the relevant limit in **Settings**, then **Continue** |
| The app or plugin reconnected | Choose **Continue**, review the source recheck work and proceed |
| You want to work on a part before the whole import finishes | Open **Received sources → Review this part**; use **Prepare this part** for unfinished containers |
| Image export failed | Work with prepared structure and text; inspect the appearance in Figma |
| An action failed | Keep the draft, follow the guidance and retry; record the time and diagnostic reference if it repeats |

Continuing in the same valid connection reads from the next saved position. After reconnecting,
previously received nodes are checked again, which takes additional time. Existing material and
approvals remain available. Reviewing a part covers that part separately from the whole import.

See [successful paths, failures and recovery](user-scenarios.en.md) for alternative ways to finish.

## Review sources on another computer

**Source files** downloads and imports prepared structure, original text and a reference image.
The recipient creates and reviews their own regions. To restore your own regions, specifications
and approvals, back up the data folder using the [upgrade and backup guide](upgrade-guide.md).

Source files can contain work material. A small part may retain an image of the surrounding design,
so check the entire file before sharing. Current source files allow up to 80 MB. Older JSON capture
files allow up to 15 MB and open in a new workspace.

## Inspect error records

Choose **Bridge → Reveal Diagnostic Logs** in the app. The default directory is
`~/.figma-semantic-bridge/logs`. Server/browser records are in `server.ndjson`;
macOS app/WebView records are in `native.ndjson`. Open **Error details** on an error
message to find the diagnostic reference for the related request.

Records include action types, error codes, validation locations and timing. Source
text, images, pairing tokens and raw console arguments are excluded. Each log rotates
across at most five 5 MB files; records older than seven days are cleaned up.
For direct WebView inspection, use **Bridge → Enable Web Inspector**.
See [Local diagnostics](local-diagnostics.md#english) for log fields and filtering examples.

## Additional tools

**Workspace tools** contains the demo and refresh action. The demo uses generated material.
Changing language updates the interface while preserving source text and your own names.
Review AI and coding-agent proposals under **Review suggestions**. After applying a proposal, approve each
region and specification yourself. The manual workflow needs no model configuration.
External model requests require checking the destination and data scope, then agreeing for that request.

This is an alpha. Check your source access and organization’s data handling rules before use.
The [online validation record](https://github.com/neocjmix/figma-semantic-bridge/blob/main/docs/product-validation.md) describes executed checks and remaining external conditions.
