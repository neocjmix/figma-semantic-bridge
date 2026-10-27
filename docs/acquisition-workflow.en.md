# Source import and settings

[한국어](acquisition-workflow.ko.md) · [User guide](user-guide.en.md) · [Install](alpha-installation.en.md)

**0.4.0 Alpha** has one normal import route. The app pins the selected source,
prepares its image and structure, and saves received evidence automatically.
Users do not choose an acquisition strategy or read order. Source designs stay unchanged.

## Add a source and review

1. Open a workspace and select one permitted Figma container.
2. Choose **Add source** and check its name, bounds and budgets. This does not
   render or traverse the whole source. Total nodes and duration are still unknown.
3. Choose **Start import**. Prepare the image, then read structure in parts of at
   most 500 nodes and 1 MB. Heavy Figma reads run serially.
4. The received image appears automatically in the same workspace. Save proposed
   regions before structure finishes. Image failure does not discard valid structure.
5. Complete structure attaches automatically. Save unsaved region edits first;
   attachment waits for them. Once the source is ready, choose **Save region**, check
   its linked nodes, then **Confirm sources → Approve region**.
6. The import shows **Source ready** when complete. Open **Import details** for
   detailed counts and the image. Choose **Link specification** on an approved
   region for requirements, then **Share** to check the approved result.

Image and structure are separate observations. Avoid editing the source during
import and compare the results. Structural completeness does not settle the
meaning of overlapping layers.

## Adjustable settings

Open **Settings**, change values, and choose **Save settings**. Settings persist
in local app data and apply to the next import or resume. Existing images and
approved sources remain unchanged. **Image quality** and **Source reading limits**
are shown first; expand **Connection timing** to adjust waits.

| Setting | Default | Supported range |
| --- | --- | --- |
| Image scale | 2× | 0.25–4× |
| Image long edge | 4,096px | 256–8,192px |
| Image bytes | 8 MB | 0.1–9 MB |
| Image wait | 55 seconds | 1–300 seconds |
| Source nodes | 200,000 | 1–1,000,000 |
| Source bytes | 64 MB | 1–128 MB |
| Run duration before pause | 300 seconds | 1–1,800 seconds |
| Structure response wait | 20 seconds | 1–120 seconds |
| Paused connection retention | 10 minutes | 1–30 minutes |

New default overviews double both axes: a previous 800×600 image becomes
1,600×1,200; a large overview capped at 2,048px becomes capped at 4,096px. That is
approximately four times as many pixels. Scale and long-edge cap apply together.
Use original text to inspect small wording in a large table.

Higher budgets can increase Figma memory, time and disk usage. Packet, integrity,
approval and file-format protections remain separate. Response budgets do not
bound native child-array allocation or image-rendering peak memory.

## Reaching a budget

- Node, byte and run budgets **pause** the import. They do not discard saved
  parts or silently complete a smaller scope. Use **Settings → adjust budget → Continue**.
- A valid same-source connection continues from the next unread node or part
  without rerendering the image. Byte budgeting reserves the maximum next packet,
  so it can pause slightly before the configured byte limit.
- Pause waits for the current image export or durable part. Run budgets do not
  guarantee an immediate stop or total completion time.
- Retention changes apply when the next packet is read, not retroactively to an
  expired reading position.

**5,000 nodes is not a failure threshold for normal imports.** Legacy bounded
captures retain their 5,000-node default and 10,000-node storage ceiling for file/API
compatibility. New normal imports do not use that route.

## Connection changes and failures

| Situation | Next action |
| --- | --- |
| Paused, same connection | Keep the source unchanged and Continue within configured retention |
| Temporary delay or busy Figma | Check the cause and Continue in the same valid connection |
| Reconnect or app restart | Continue explains the cost before rechecking the pinned source. Existing images, records and approvals remain unchanged |
| Source deleted or in another file/page | New reads stop; saved evidence remains available. Return to the permitted source or restore a valid backup |
| Image failure | Read the warning; complete structure remains usable without an image |
| Incomplete structure | Browse saved nodes and exact text. Review a fully read part separately, or prepare a known unfinished container |
| Corrupt evidence or different provenance | Obtain valid evidence or restore backup; repeated requests cannot make invalid data complete |

After reconnection, saved nodes are read from Figma again. Matching content uses
compact replies to avoid repeat transfer, but the underlying Figma reads still
occur. Names and bounds cannot establish unchanged text or descendants. Earlier
observations and approvals remain immutable; the retained image is not freshly
verified. No single immutable Figma revision is guaranteed.

## Work with a part

Open **Received sources** to search saved nodes and choose **Read original text**.
These local queries need no Figma connection. Unread text is distinct from empty text.
A fully read part opens with **Review this part**, retaining the large image.
The currently selected, saved proposed region on that image is copied. Existing
regions and approvals remain unchanged.

For a known unfinished container, choose **Prepare this part** to read only its
subtree. This read also saves the original text within that part; later text
queries use the local saved records.
If this requires releasing an earlier paused reading position, the app explains
that continuing the original task will require a recheck and asks for confirmation.
The original whole-source task stays incomplete. If the selected part also stops,
its own **Received sources** remain available, and **Continue** resumes that part first.

Part review does not cover outside siblings or overlapping layers. A region beyond
the displayed source coverage cannot be approved. Obtain a sufficiently broad
source for a component spanning several branches. Source confirmation and meaning
approval remain separate human decisions.

## Check error records

Note the action and time. If the message has a diagnostic reference under
**Error details**, keep that reference too. **Bridge → Reveal Diagnostic Logs**
opens local records of request routes, operations, duration, error codes and
validation reasons. WebView errors and console warnings are recorded here as well.
Logs exclude source wording, images and tokens.

The default folder is `~/.figma-semantic-bridge/logs`. Size and retention policies
rotate these records, so inspect them soon after the error. For direct WebView
inspection, use **Bridge → Enable Web Inspector**. See
[Local diagnostics](local-diagnostics.md) for detailed instructions.

## Browse, clean up and transfer

Review complete-source metadata and exact text on demand. Loaded canvas bounds
are not the full node count. Agent explicit-ID and immediate-child reads remain
separate observations, not a whole-area completion claim.

Use **Saved import records** to delete unused records. Workspace-bound source
structure and images are protected. Deletion removes that interrupted evidence
and is not a backup. Manage other workspaces' records in their workspaces.

Image acquisition cache: up to twelve records / 96 MB. Structure cache: up to
twelve / 512 MB. Source-file transfer carries complete structure and any image
in at most 80 MB NDJSON. Raising acquisition budgets can produce evidence too
large for that file format: distinguish reviewed-context sharing from source
transfer and full backup. Legacy small bundles allow two captures / 15 MB and
carry no annotations or approvals. See the [user guide](user-guide.en.md) and
[backup instructions](upgrade-guide.md).
