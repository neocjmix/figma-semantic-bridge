# Figma Desktop verification procedure

This is the repeatable host-integration procedure, not a list of all unfinished
work. The owned-fixture Desktop lifecycle, scale and supported geometry matrix
ran on 2026-10-24; [the validation log](product-validation.md) records the results.
[Completion status](completion-status.md) identifies the remaining account/file
and human-evaluation dependencies. A new permission/runtime combination needs its
own evidence; do not reinstall or rerun passed cases without a changed condition.

## Install and pair

1. Install Node.js 22 or newer. From this repository run `npm ci` then `npm run build`.
2. Run `npm start`. Keep the server terminal private: it prints the local web URL
   and a pairing token. Open `http://127.0.0.1:4177` and paste the token into the
   web app. The development plugin is fixed to port 4177. A different `FSB_PORT`
   also requires changing the plugin endpoint and its manifest before rebuilding.
3. In **Figma Desktop**, open the authorized file. For the existing baseline use
   https://www.figma.com/design/4dKjnCZ8lTY8fVXUugJGxP . Public research candidates
   must first pass their separate access, use and duplication checks.
4. Choose **Plugins → Development → Import plugin from manifest** and select
   `plugins/semantic-bridge/manifest.json`. If Desktop rejects the repository's
   development ID, create a new development plugin through Figma's dialog, retain
   its assigned ID in your local manifest and use this plugin's generated `code.js`
   and other manifest settings. The plugin has not been published to Community.
5. Run **Figma Semantic Bridge — Local**. Paste the same token into **Pairing token**
   and click **Connect**. Expect both plugin and web app to show connected. The
   plugin holds this token only in iframe memory and clears the input field.

The manifest uses `documentAccess: "dynamic-page"`, `allowedDomains: ["none"]`
and `devAllowedDomains: ["ws://localhost:4177"]`. The [official manifest reference](https://developers.figma.com/docs/plugins/manifest/) permits `ws` and development
localhost ports. Desktop 126.10.11 on macOS rejected the numeric loopback host in the manifest; the plugin uses localhost while the server remains bound to 127.0.0.1. That documented support does not prove a particular Desktop
version or company policy permits the connection. If blocked, record the exact
Desktop version and console error; do not broaden the allow-list or expose the
server externally as a workaround.

The local development manifest also sets `enablePrivatePluginApi: true` to enable
host-provided `figma.fileKey`, as documented in the [manifest reference](https://developers.figma.com/docs/plugins/manifest/#enableprivatepluginapi-boolean).
Close and rerun the plugin after a manifest change. Verify that new selection and
capture results carry the host identity before testing navigation. This flag is
documented for private/local development plugins, not public Community plugins.
An existing snapshot with a null identity stays non-navigable; do not backfill it
from a URL or silently rewrite approved records. Use a newly captured scope.

## Dev seat and view access acceptance

This is a product requirement: a developer must be able to use the bridge with
a **Dev seat and `can view` access**, without source edit permission or a Full
seat. Dev Mode inspection plugins can read the document, export images, show
iframe UIs and communicate with the local bridge. See the [official Dev Mode
API guide](https://developers.figma.com/docs/plugins/working-in-dev-mode/) and
[seat definitions](https://help.figma.com/hc/en-us/articles/19813618057623-Dev-Mode-for-admins).

Both local manifests declare `"dev"` with the `"inspect"` capability. Automated
tests run the bundled plugin entrypoints against synthetic nodes that reject
document writes, and verify selection/capture/aggregate analysis. They do not
emulate Figma's license or permission enforcement. On 2026-10-23, actual Desktop
Dev Mode ran the local Inspect plugin, captured 56 nodes and a 1440×900 PNG, and
navigated to a source node through MCP. Metadata and PNG matched the earlier
Design-mode capture. That run used the owned synthetic file, so the **Dev-only
account plus can-view permission acceptance remains pending**.

1. Use an authorized Dev-only account with `can view` access to an existing source
   file. Record the seat, file role and whether copy/export is restricted. Do not
   grant edit access, change seats or change the source file to make this pass.
2. Confirm the account can enter Dev Mode and launch the existing local inspection
   plugin there. Record host version and actual `editorType`/mode if observable.
   Pair its Inspect-panel UI with the running local server.
3. Select one small frame; perform selection metadata, bounded capture and PNG
   export through the local bridge. Then verify local annotation/review/export
   and MCP approved reads. An export-policy denial must remain explicit.
4. Verify host-provided file identity, then test source highlighting separately.
   Record whether page/selection/viewport APIs work in this read-only runtime;
   never replace this test with document modifications or inferred identity.
   If the authorized scope already contains hidden instance children, also test
   an explicit saved reference to one, followed by selection metadata and a new
   bounded capture when the target is a container. Record host behavior without
   changing source visibility. The adapter temporarily permits hidden-instance
   reads and restores the original traversal setting; synthetic proxy tests do
   not establish the native selection/viewport result.
5. Run the lifecycle checks below and record the exact scope/result. An owned
   duplicate is useful for fixture acquisition, but proves neither Dev-only
   access to someone else's file nor the absence of an edit-permission dependency.

An edit-access rejection from the separate remote Figma Plugin API execution
service is evidence about that service/account, not this local adapter's access
requirement. Do not request source editor rights as the default workaround.

## Execute the human-first scenario

1. Select exactly one Frame, Group, Component, Component Set, Instance or Section.
   Start with the synthetic dashboard frame `1:2` on page `0:1`. A page, empty
   selection or multiple selections is rejected; there is no whole-file fallback.
2. Create a project in the web app and capture the current Figma selection. Expect
   one snapshot with the selected root and its descendants, source IDs and a PNG.
   For the unchanged baseline dashboard this is 56 nodes, including the FRAME
   root. If the document changed, record the actual count instead of forcing it.
3. Draw a component region over the table or filters, name it, match source nodes
   and inspect the candidates. Equal boxes may be ambiguous. Inspect in Figma,
   add intended native selections one at a time and save the local set. Confirm
   ambiguous sources before approving the component's meaning. Source confirmation
   and semantic approval are distinct; neither changes the original Figma tree.
4. Select the baseline notes frame `1:58` in Desktop and capture it into the same
   project. It is a second scope, not a replacement for the dashboard. The unchanged
   baseline contains 17 nodes including the root. Select its exact source text and
   link one specification to several dashboard annotations. Review the relation
   types and approve the intended records.
5. Reload the browser and restart the server. Confirm that snapshots, source
   references, hierarchy, exact spec text, relations and approval status survive.
6. Configure Codex with the repository's stdio MCP runner. Call `get_selected_node`
   while the plugin is connected; then call `get_approved_context` for the project.
   Expect approved components/spec relations with source references. Proposed or
   rejected records must not silently appear as approved implementation context.
7. Call `highlight_source_nodes` with the snapshot's `fileKey`, `pageId` and known source IDs. Expect only page navigation,
   source selection and viewport movement. No source node, text, layout or annotation
   is created or changed in the Figma document. A different connected file or a host
   that does not expose `figma.fileKey` must reject navigation before node lookup.

## Lifecycle and error checks

| Action | Expected result |
| --- | --- |
| Close plugin during a source request | Server returns disconnect/cancellation error; stored annotations remain readable. |
| Reopen plugin and reconnect | A fresh session replaces the stale one; new requests succeed. |
| Stop/restart local server | Plugin shows reconnecting with bounded exponential backoff. If the token changed, reconnect explicitly using the new token. |
| Enter wrong token | Pairing is rejected; no source command executes; reconnect requires a corrected token. |
| Cancel or let a capture request time out | Late results cannot complete another request. Native `exportAsync` cannot be forcibly interrupted; no document mutation occurs. |
| Run plugin in two files | Server has one active session; verify the indicated file/selection before capturing. The replaced plugin disconnects without retrying. Explicit Connect selects that file again. |
| Highlight a saved reference while a different file is connected | Reject `WRONG_FILE`; coincidentally identical page/node IDs must not navigate the other file. Missing host file identity rejects `FILE_IDENTITY_UNAVAILABLE`. |
| Capture a very large selection with a low node/byte limit | Snapshot clearly reports an incomplete prefix; never treat it as the total scope count. |
| Disconnect plugin, then read approved context | Saved data remains available; live selection/capture fails explicitly. |

## Coordinate and bounded-performance checks

PNG export requests `contentsOnly: true` and `useAbsoluteBounds: true`, retaining
the selected root's absolute BBox as the document-to-image rectangle. Pixel width
and height come from the returned PNG IHDR, not guessed dimensions. The adapter
withholds previews whose dimensions disagree with the requested mapping. A root
with rotation, reflection or skew gets metadata but no preview; select an unrotated
enclosing frame. Descendant rotation, masks and clipping remain AABB limitations
and are surfaced as snapshot warnings. Overlapping siblings outside the selected
subtree are deliberately absent from the image and node index.

Test nested frames at negative and positive document positions, resized preview
scales, clipped overflowing children and masked elements. Mark visible corners
in the web editor and compare highlights in Figma. Record measured pixel error and
unsupported cases. Do not call F3 passed merely because algebraic transform tests pass.

Defaults are 5,000 nodes, 2 MB of serialized source-node metadata, 5 seconds of
cooperative traversal and 2,048px maximum image edge. Runtime ceilings are 10,000
nodes, 4 MB metadata, 15 seconds and 4,096px. PNG bytes have a separate 8 MB cap.
Time checks happen between reads and around export; Figma's native page loading,
export allocation and a blocked synchronous getter cannot be preemptively bounded.
Text exceeding the record/byte limit is not silently truncated into a valid spec.

For meaningful performance comparisons, keep at least five cold and five warm runs
per selected-scope size. Record node count, completion reason, metadata/PNG bytes,
time to preview, errors and Desktop/OS versions. Use an actual profiler for peak
plugin/server memory; otherwise record `not measured`. Keep authorized originals
and measurements outside the public repository. Desktop results should update the
existing feasibility evidence, not replace the synthetic automated tests.
