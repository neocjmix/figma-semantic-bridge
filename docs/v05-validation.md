# v0.5 verification status

This is an in-progress implementation, not a release sign-off. T01–T12 remain open until the full user-task acceptance is executed. Never treat fixture or API tests as evidence of actual Figma browser acceptance.

## Real Figma P0 (2026-10-28)

In Chrome on macOS using Figma web Dev Mode, 21 nodes from one selected frame and a variant on another page had selection URLs matching Figma MCP metadata. The sampled types included frames, a rectangle, text, instances and a variant. A real bookmarklet sent a selected URL and unique nonce to a named Bridge P0 tab; repeat and changed selections reused it. UI and Spec choices were demonstrated in the P0 harness. A GROUP example was not verified.

With a PAT limited to `file_content:read`, actual Figma REST returned node metadata, page ancestry and image URLs for a frame, text and variant across two pages. Incremental document depth located the selected node without its children in these examples. Rendered PNG downloads had the same aspect ratios as the node bounds. A nonexistent node returned HTTP 200 with null data; a nonexistent file returned 404, and an invalid token returned 403. Figma MCP retrieved explicit nodes independently of the current selection.

These observations cover one file, not every document or permission configuration. Scope-denial, 429, unreliable URL cases, large dependency trees and deep hierarchies remain unverified. The token gate's 404 probe has not yet been proven to reject a valid token without `file_content:read`.

## Automated checks

`npm run check` executes TypeScript, ten unit and integration tests and a production build. Mocked-Figma HTTP + MCP integration exercises two synthetic files, tree cycles, many-to-many relations, disk restart and semantic export equality. Simulated 401, 403, 404 and 429 responses leave regions unchanged and report the cause. Delayed image responses are tested against a resend and two separate workspaces. These tests are not proof of actual bookmarklet delivery.

## Browser and real REST, with synthetic delivery

In the in-app browser, navigating directly to a locally constructed receiver fragment (not executing the product bookmarklet) and choosing a kind imported actual Figma nodes with the user's scoped token. Two UI regions were renamed and nested using the parent selector; an attempted cycle was rejected. One actual Spec was linked to both UI regions and unlinking one edge retained the Spec and the other edge. An actual node from a second page appeared in a separate Canvas partition. Previews appeared for the sampled nodes. Screenshots were saved outside the repository. A page switch initially left an off-page region selected; the correction was retested after build and restart. The cycle error now identifies the cause.

With four actual nodes across those two pages, the keyboard-accessible parent selectors built a four-level tree, rejected a cycle, moved a subtree back to root without losing its child, and reordered roots. A Spec from the first page was linked to UI nodes on both pages. Browser reload retained the resulting order and two relationships. Selecting a Canvas region focused the name input immediately; typing and reloading retained the new name. Pointer drag and a second real file were subsequently verified as described below.

A 486-pixel-wide in-app browser screenshot exposed clipped tree names and editing controls. After adjusting responsive CSS, a fresh browser screenshot confirmed that names, selectors and the edit bar fit the viewport; long names are ellipsized.

In Chrome, pointer dragging a Spec onto a UI produced a ghost; repeating the drop did not duplicate the edge. Dragging a UI row onto another UI nested it, and attempting a cyclic drag reported the cycle and retained the tree. After the original PAT was revoked, a real bookmarklet import was rejected with the token re-entry prompt and the workspace file remained byte-for-byte unchanged. Cancelling initially exposed a missing bookmarklet href; the fix was checked with a simulated 401 in an isolated browser server.

A separate token supplied for the missing-scope test returned 404 for the nonexistent-file probe and 200 for an accessible file. Because the token's actual scope was not independently established before revocation, these results cannot establish missing-scope rejection; that gate remains open.

A second existing Figma file was opened read-only; its selected node URL matched an independently retrieved Figma MCP node ID. After replacing the revoked PAT, the installed product bookmarklet imported that actual node into a third Canvas partition. The region was renamed and the first file’s Spec was linked to it through the keyboard-accessible selector. After a server restart and browser reload, the two-file, three-page workspace, name, hierarchy and cross-file relationship remained. The replacement token was used successfully for a new explicit import; this was not a test of an automatic retry. The second file’s same source was then imported as a separate Spec, linked to UI nodes in each file, and deliberately deleted through its confirmation dialog. Both of its edges disappeared while the UI hierarchy and the other Spec’s links survived reload. Attempts to drag the first file’s Spec onto the second-file UI did not create the edge; the keyboard-accessible selector did. A cross-file pointer drop therefore remains unverified.

In an isolated mocked-Figma browser server, stopping the server during a name edit produced an actionable server-unavailable message. After restarting and reloading, the previously saved name remained intact; the unsaved edit was not queued.

An isolated browser fixture with 18 UI and 18 Spec regions exposed an overflow bug: both columns expanded the page instead of scrolling independently. After fixing the grid and flex height constraints, scrolling UI changed only its scroll position, scrolling Specs left UI unchanged, and both positions survived a Canvas/Regions tab switch.
Cancelling a simulated kind-choice dialog closed it without creating a region.

## Product bookmarklet and downstream handoff

In Chrome, the installed product bookmarklet opened the Bridge from an actual Figma selection. Selecting UI or Spec initiated the corresponding import, and a changed selection reused the bookmarklet-opened window. The same source was imported as both kinds. Chrome initially created a new tab rather than reuse a manually opened Bridge tab in a different browsing context; the new tab had no active workspace and rejected the selection. Storing only the active workspace ID in local browser storage addressed that first-use failure: after selecting the workspace in the manually opened tab, the next newly opened bookmarklet tab restored it and immediately offered the kind choice. A duplicate tab can still exist; this is a browser-context limitation and the literal already-open-window acceptance remains open.

The real two-file test workspace's exported JSON and stdio MCP output matched, contained four relations and references for all six surviving regions, and excluded the current token. The earlier export also excluded preview, bounds and text-hint fields. The official Figma MCP independently dereferenced one exported UI node and one exported Spec node while another node was selected in Figma.

## Clean clone

On macOS with Node 22, a fresh clone from GitHub at commit `feb096c` passed `npm ci`, `npm run check` and `npm start` on an isolated data directory and loopback port. A request to the running server showed the unauthenticated gate. Rerun this check if runtime code changes.

## Remaining acceptance

- T01: valid token, invalid and revoked token, restart and restricted file mode tested; actual missing-scope rejection remains unverified.
- T02: actual product bookmarklet, both kinds, repeated sends and changed selections exercised; cancellation passed with a simulated fragment. Manual-tab reuse remains open.
- T03: 21 sampled node URLs and a variant verified; GROUP remains open; a node from a second actual file was imported. Resend preservation is covered by controlled tests.
- T04: actual successful REST import and invalid-token behavior observed; other response codes were simulated in integration tests and need real-environment evidence where available.
- T05: actual previews and simulated delayed-response isolation tested; real failure/retry behavior remains open.
- T06–T09: actual two-page Canvas partition, focused name editing, pointer and keyboard nesting, cycle rejection, cross-page Spec drag/link, unlink and reload exercised. Independent scrolling and tab retention passed with simulated nodes; cross-file relation by selector, deliberate Spec deletion with its edges, and reload passed; cross-file pointer drop remains unverified.
- T10: real workspace JSON/MCP comparison and external Figma MCP UI/Spec dereferences passed for the sampled nodes; broader exclusions remain covered by tests.
- T11: clean clone/build/start, duplicate port, stopped-server preservation and a real revoked-token rejection tested; a fresh explicit import after replacement-token entry passed.
- T12: observed independent human task and qualitative findings.
