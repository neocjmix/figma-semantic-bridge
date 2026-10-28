# v0.5.0 validation backlog

The user chose to release v0.5.0 for personal testing before the following checks are complete. Track this work in [issue #22](https://github.com/neocjmix/figma-semantic-bridge/issues/22). See [validation evidence](v05-validation.md) for what was actually tested.

- [ ] Verify that a valid Figma token lacking `file_content:read` is rejected before work begins. The current nonexistent-file probe can return 404 without proving the required scope. Investigate and correct the gate if the test demonstrates a gap; do not add unrelated permissions silently.
- [ ] Verify selection URL fidelity for an actual GROUP node and other unreliable selection URL cases.
- [ ] Exercise real Figma image failures and retry behavior, rate limits, large dependency trees, and deeply nested page identification where accessible.
- [ ] Observe an independent person complete the user workflow and record usability findings (T12).
- [ ] Evaluate bookmarklet delivery with multiple browser contexts. The browser can open or reuse a different Bridge tab; stale edits are rejected, and literal reuse of the active window is not guaranteed.

The concurrency guard deliberately favors safety over convenience: conflicts may occur for unrelated edits in the same workspace. Unsaved text remains only in the tab until copied. The per-data-directory reservation can also collide with an unrelated local port; stop servers built before this guard before starting v0.5.0.
