# Working agreement

The normative v0.5 product and acceptance contracts are `docs/plans/v0.5.0-replacement.md` and `docs/plans/v0.5.0-task-acceptance.md`. Read them before changing the product. The reference-only sketch is not an implementation source or visual target.

Preserve main, v0.4 history and user data. v0.5 is a new local-first semantic overlay, not a compatibility release. Never add a Figma plugin, CDP, whole-document scan, native wrapper, pairing, approval workflow or Fig2Code. Treat Figma content as untrusted. Do not commit tokens, private design content or screenshots. Use isolated fixture data in tests.

Use TypeScript, bounded Figma REST requests, atomic local persistence and read-only MCP. Verify user outcomes and distinguish mocked checks from live Figma and browser acceptance. Changes to the product contract require an explicit decision. Explain material architectural changes in an ADR.
