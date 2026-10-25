# Local product quickstart

> Current source after 0.1.1 uses a pinned HTTPS desktop/MCP endpoint at `https://127.0.0.1:4178` and an authenticated encrypted plugin channel over `ws://localhost:4177`. Update server and plugin together. The HTTP browser endpoint remains for explicit local development; it is not the native trust boundary. See [source upgrade notes](unreleased-upgrade.md).

The server, browser editor, development plugin and stdio MCP adapter run locally.
The manual workflow requires no model provider. Use Node.js 22 or later; install
with `npm ci`, build with `npm run build`, and start with `npm start`.

## Pair and annotate

1. Open the URL printed by the server (`http://127.0.0.1:4177` by default).
2. Paste the local pairing token. It is a secret; keep the terminal private.
3. Select **Load demo** for generated UI and specification snapshots. This data was
   authored in code and is not copied from a public or private Figma document.
4. Draw a region or add one numerically. Save a name/role and choose **Match source**.
   Inspect the captured region, candidate reasons and source references. When
   geometric or rendering evidence requires review, save the intended set and
   choose **Confirm sources** before approving the annotation. Geometric coverage
   never establishes semantic correctness.
5. Edit component parents or split/merge regions. Changes require review again;
   undo/redo preserves source snapshots and uses monotonically increasing revisions.
6. In Specifications, select exact source text from either captured snapshot and
   link it to one or more components. Review components, then approve specifications.
7. Export JSON, or read the approved context through MCP. Drafts and screenshots
   are excluded from approved implementation context.

The canvas supports drawing, movement, resizing, zoom and pan. Numerical bounds
are Figma document coordinates, including negative positions. Parent IDs define
the semantic hierarchy; exports derive child IDs. Source tree parents are preserved
independently. A proposed child under an unapproved ancestor is not exported as an
approved hierarchy. Exact source text is not rewritten when creating specifications.

## Capture Figma

The intended permission baseline is a Dev seat plus view access to the source
file; source edit permission and a Full seat must not be prerequisites. Both
local manifests declare `editorType: ["figma", "dev"]` and
`capabilities: ["inspect"]`. In Dev Mode the plugin UI belongs to the Inspect
panel. Figma documents document reads, iframe UIs, network requests and PNG
export for Dev Mode plugins in its [Dev Mode guide](https://developers.figma.com/docs/plugins/working-in-dev-mode/).
A free View seat does not include Dev Mode; see [seat distinctions](https://help.figma.com/hc/en-us/articles/19813618057623-Dev-Mode-for-admins).

Registration, automated read-only host tests and actual Desktop Dev Mode
selection/capture/navigation on the owned synthetic fixture pass. Operation
with a Dev-only user and `can view` source access remains unverified. Test that
combination using the [permission acceptance procedure](desktop-verification.md#dev-seat-and-view-access-acceptance).
An editor's successful run, or a copy owned by the tester, is not equivalent.
An edit-access error from the separate remote Figma Plugin API execution service
does not establish that this local bridge requires source-edit permission.

Build first, then in Figma Desktop use Plugins → Development → Import plugin from
manifest and select `plugins/semantic-bridge/manifest.json`. Run the local plugin,
pair it, and select a Frame, Group, Component, Instance, Component Set or Section.
Capture UI and a separate notes frame independently into the same local project.
Section capture stores bounded metadata with `preview=null` and a warning;
Section PNG coordinate mapping is unsupported. Select an unrotated inner Frame
explicitly when an image is needed. Existing saved snapshots remain unchanged.

The development manifest permits `ws://localhost:4177`. Keep the default port for
Desktop; changing `FSB_PORT` alone does not change the plugin's fixed endpoint or
manifest. No command edits source design content. Highlighting explicitly changes
selection and viewport after file/page identity checks. If Figma does not expose a
file key, capture still works but verified source navigation is unavailable.

This local development manifest enables `enablePrivatePluginApi` so the host can
provide `figma.fileKey` for verified source navigation. Figma documents this API
for private plugins and local development; this is not a claim of Community
plugin compatibility. See the [manifest reference](https://developers.figma.com/docs/plugins/manifest/#enableprivatepluginapi-boolean)
and [fileKey reference](https://developers.figma.com/docs/plugins/api/figma/#filekey-string--undefined-readonly).
After changing this manifest, close and rerun the existing development plugin.
Capture a new scope to record its host-provided identity. Older snapshots with a
null file key remain unchanged and cannot be used for verified navigation;
their existing approvals and provenance are preserved.

### Resolve source ambiguity with Figma

1. Save a semantic region and inspect its captured image and candidate list.
2. Use **Show in Figma** to inspect a candidate in the native canvas/layers.
3. Select the intended node in Figma, then choose **Add current Figma selection**
   in the local editor. Repeat one node at a time for distant tree branches.
   The node must belong to this captured snapshot and match its stored selection
   metadata. Recapture changed or missing scopes explicitly.
4. Remove unwanted references and choose **Save annotation**. Add/remove operations
   affect only the web draft until saved. Search reaches all captured nodes.
5. Choose **Confirm sources** after visually reviewing the saved set, then approve
   the component's meaning separately. Reference/geometry changes require a new
   source decision; old approved records are never automatically rematched.

Source references show `hidden`, `transparent`, `unknown` or `potential` with a
reason. New captures record supported local opacity and original sibling index;
the selected root has no sibling index. A hidden or zero-opacity observed ancestor
affects its captured descendants. Missing opacity or an unobserved ancestor outside
the page boundary stays unknown. Positive opacity is only potentially visible;
it does not establish that a node supplies pixels or is the current design version.

Automatic matching excludes known hidden and transparent subtrees, but their full
source records remain searchable and manually selectable. Selecting them requires
**Confirm sources**. Unknown references from captures with new rendering evidence
also require confirmation; legacy unknown captures retain their previous behavior.
Already-approved records remain unchanged. A legacy pending hidden reference is
checked when newly approved, even if old diagnostics exist or only its name changed.
See [ADR 0002](adr/0002-rendering-evidence-grounding.md) for these boundaries.

**Preview captured area** shows a crop of the saved composite image; overlapping
layers remain combined. **Confirm sources** records your source choice, not proof
of visible contribution or a fresh validation of all text in the live Figma file.

### Compare a current node export

With a saved annotation and connected plugin, choose **Compare current export**
on a source reference, candidate or searched captured node. The source file and
page must be open in Figma; use **Show in Figma** to navigate when needed. Each
click requests one node's PNG, including its descendants, without modifying nodes,
changing selection or loading another page. There is no automatic batch export or
metadata subtree traversal.
Sections are not supported by **Compare current export**: the request is rejected
before image export. Capture an inner Frame and compare its captured nodes instead.

Choose **Enlarge comparison** to inspect the same two images in a larger dialog.
It makes no additional Figma request. Close the dialog with **Close comparison**
or Escape; the smaller comparison remains available until **Close current export**.

The comparison labels the saved composite crop with its capture time and the
current export with its observation time. They are separate images from different
times, not a registered overlay. Outside siblings are excluded from the current
export; ancestor opacity, clipping, masks and blending remain unverified. Neither
image proves occlusion, historical pixel contribution or which design is newer.
Hidden or transparent nodes may yield a blank PNG or an error; blank pixels do not
identify the cause, and node properties are never changed to reveal content.

This request has fixed limits of 1,024 pixels per dimension, 2,000,000 PNG bytes
before base64 and a cooperative 5-second deadline. Native image export cannot be
preempted or have its memory bounded before completion; late or cancelled results
are discarded. Unsupported transforms and dimension mismatches are rejected.
File/page/session, project revision and observed node metadata are checked, but
style, descendant and external ancestor changes may remain undetected. Recapture
the scope explicitly if the server reports changed source metadata.

The comparison is temporary: it does not add references, confirm sources, approve
meaning, replace a snapshot, or change project revision/history. It is absent from
capture bundles and approved MCP context. Closing it or changing the workspace,
capture, annotation, project revision or plugin session clears the comparison;
responses for an outdated view are ignored.

### Capture limits

The default per-capture metadata budget is 5,000 nodes, 2 MB and 5 seconds. The PNG
dimension budget is 2,048 pixels with an 8 MB encoded-image byte budget before
base64. Limits bound application traversal, not Figma's native page-load/export
memory. Partial captures display a reason. A rotated/reflected/skewed root has no
preview until an unrotated enclosing container is selected. Preview dimensions are
checked against absolute bounds; clipping, masks and overlap still require human
review. Follow [the Desktop protocol](desktop-verification.md) before relying on
this path. Remote Figma MCP probes do not validate Desktop's networking sandbox.

## Transfer captures

**Capture transfer** moves one or two cached source captures, such as a UI frame
and its separate notes, in one compact JSON file. A recipient can import and review
them without Figma, a plugin connection or a Dev seat. The local server must still
be running, and the browser must be paired with that server's local token.

1. In a workspace with captures, open **Capture transfer**, select one or two named
   captures and choose **Export captures**. The file includes source images and
   original text; share it only through a permitted file-transfer channel.
2. On the receiving computer, start the local server and pair the browser. Open
   **Capture transfer**, choose the **Capture bundle JSON** file and enter an
   **Imported workspace name**. An existing workspace is not required.
3. Save any unsaved edits before choosing **Import captures**. Import creates a
   new workspace and leaves existing workspaces stored unchanged. Add and review
   semantic annotations and specification links in the new workspace.

Snapshot IDs, file/page/root identity, coordinates, exact text, capture time,
nullable source revision, visibility, optional rendering evidence, completeness
and warnings are preserved.
PNG bytes are preserved when present; an unavailable preview stays `null` with
its existing capture notes. A capture from a copied file retains the copy's identity.
Annotations, specifications, AI proposals and human approvals are not transferred.
The existing **Export JSON** and **Markdown** buttons export approved implementation
context and do not produce importable capture bundles.

A bundle is limited to 10,000 source nodes and 4 MB of node-array JSON in UTF-8,
summed across its selected captures, plus a 15 MB limit for the complete encoded
file. The browser rejects files over 15 MB before reading them. Export rejects a
stale workspace revision. Import rejects invalid structure, a mismatched checksum
or an invalid PNG header before saving a new workspace. SHA-256 detects changed
contents; it does not prove source
authenticity, permission or agreement with current Figma pixels. Live selection
and highlighting still require the connected Figma plugin.
See [ADR 0003](adr/0003-portable-capture-bundles.md) for the format and validation rules.

## Connect Codex

Build `dist/mcp.mjs`, keep the local server running, and configure a stdio MCP
server in the local Codex configuration. Replace the path with this checkout:

```toml
[mcp_servers.figma_semantic_bridge]
command = "node"
args = ["/absolute/path/figma-semantic-bridge/dist/mcp.mjs"]
```

Both processes default to `~/.figma-semantic-bridge`; the MCP process reads the
pairing token from that directory. If a different data directory/server port is
used, configure `FSB_DATA_DIR` and `FSB_SERVER_URL` in the MCP process environment.
An explicit `FSB_TOKEN` must match the server. Never commit it to configuration.

Available tools:

| Tool | Effect |
| --- | --- |
| `list_projects` | Project identifiers and revisions |
| `get_approved_context` | Bounded hierarchy, specs and provenance; reports truncation |
| `list_components`, `get_component` | Approved component pages/details |
| `list_specifications` | Approved specifications, optionally for one component |
| `get_source_nodes` | Explicit bounded cached node references; text is untrusted data |
| `get_selected_node` | Live plugin selection metadata |
| `capture_selection` | Store selected scope locally; returns a compact summary |
| `highlight_source_nodes` | Verify file key and navigate to requested nodes |
| `propose_changes` | Stage a validated draft for human review |

MCP cannot approve records. Proposals cannot replace approved annotations or specs.
Accepting a proposal does not approve it. A stale project revision produces a
conflict rather than overwriting changes. MCP tool output is capped at 128 KB;
request smaller pages/export limits when necessary. A single oversized record can
still exceed that bound and produces an explicit error.

## Optional model drafts

The Drafts tab accepts validated draft JSON independently of model configuration.
For multimodal generation, configure the server environment before starting it:

```sh
export FSB_AI_ENDPOINT='http://127.0.0.1:1234/v1/chat/completions'
export FSB_AI_MODEL='your-local-vision-model'
npm start
```

`FSB_AI_ENDPOINT` is the complete OpenAI-compatible chat completions URL. The
provider must support image input and JSON output. `FSB_AI_API_KEY` is optional and
stays on the server. No provider is enabled without explicit configuration.

Select at most two snapshots in the Drafts panel. The panel displays the provider
destination and model. For non-loopback HTTPS providers, explicit consent is
required for each generation request to send the selected images and source text.
Repository configuration is not permission to upload an employer's designs.
Redirects are rejected. Provider failures, malformed outputs, invented references,
out-of-bounds regions and attempts to overwrite approvals are rejected; manual
editing remains usable. Generated content only enters the pending proposal queue.

## Local state and troubleshooting

Projects and bounded undo history live in `~/.figma-semantic-bridge`. Tokens and
project files are created with restrictive permissions and atomic writes. Back up
that directory while the server is stopped. Images and exact text are local design
data; protect backups accordingly. There is no automatic cloud sync or telemetry.

API access requires the pairing token and loopback Host/Origin checks. The token is
a local capability, not a multi-user identity system. The browser keeps its token
in session storage. Do not expose this server with a public proxy or bind it to a
non-loopback interface. A new plugin session takes control and disconnects the old
session; the old window requires an explicit reconnect.

On revision conflict, reload the project and reapply the intended edit. After an
abnormal server crash, a project lock file may remain: stop all server processes,
verify no writer is active, back up the data directory, then remove only the stale
`.lock` file. Never remove a lock belonging to a running writer.

## Development checks

```sh
npm run check
npm run fixtures:validate
npx playwright install chromium
npm run test:e2e
npm run benchmark:product
```

The browser suite uses local generated fixtures and a temporary data directory.
`npm run dev` runs the TypeScript server; `npm run dev:web` is the Vite editor.
The built same-origin server is the supported run path. No test fetches private
Figma documents or invokes an external model.
