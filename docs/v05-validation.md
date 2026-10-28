# v0.5 verification status

This is an in-progress implementation, not a release sign-off. T01–T12 remain open until the full user-task acceptance is executed. Never treat fixture or API tests as evidence of actual Figma browser acceptance.

## Real Figma P0 (2026-10-28)

In Chrome on macOS using Figma web Dev Mode, 21 nodes from one selected frame and a variant on another page had selection URLs matching Figma MCP metadata. The sampled types included frames, a rectangle, text, instances and a variant. A real bookmarklet sent a selected URL and unique nonce to a named Bridge P0 tab; repeat and changed selections reused it. UI and Spec choices were demonstrated in the P0 harness. A GROUP example was not verified.

With a PAT limited to `file_content:read`, actual Figma REST returned node metadata, page ancestry and image URLs for a frame, text and variant across two pages. Incremental document depth located the selected node without its children in these examples. Rendered PNG downloads had the same aspect ratios as the node bounds. A nonexistent node returned HTTP 200 with null data; a nonexistent file returned 404, and an invalid token returned 403. Figma MCP retrieved explicit nodes independently of the current selection.

These observations cover one file, not every document or permission configuration. Scope-denial, 429, unreliable URL cases, large dependency trees and deep hierarchies remain unverified. The token gate's 404 probe has not yet been proven to reject a valid token without `file_content:read`.

## Automated checks

`npm run check` executes TypeScript, nine unit and integration tests and a production build. Mocked-Figma HTTP + MCP integration exercises two synthetic files, tree cycles, many-to-many relations, disk restart and semantic export equality. Delayed image responses are tested against a resend and two separate workspaces. These tests are not proof of actual bookmarklet delivery.

## Browser and real REST, with synthetic delivery

In the in-app browser, navigating directly to a locally constructed receiver fragment (not executing the product bookmarklet) and choosing a kind imported actual Figma nodes with the user's scoped token. Two UI regions were renamed and nested using the parent selector; an attempted cycle was rejected. One actual Spec was linked to both UI regions and unlinking one edge retained the Spec and the other edge. An actual node from a second page appeared in a separate Canvas partition. Previews appeared for the sampled nodes. Screenshots were saved outside the repository. A page switch initially left an off-page region selected; the implementation was corrected and still requires a post-build browser retest.

## Remaining acceptance

- T01: actual missing-scope rejection and full security/redaction checks.
- T02–T05: actual product bookmarklet import, repeats, failed image and error paths.
- T06–T09: browser task journey, coordinate separation, pointer and keyboard tree operations, ghost unlink and restart.
- T10: actual product export to external Figma MCP and output exclusions across all scenarios.
- T11: clean-clone installation and collision recovery.
- T12: observed independent human task and qualitative findings.
