# ADR 0008 — Explicit visual and collection-backed editor scopes

Status: implemented and locally verified in the unreleased source build on
2026-10-26. Extends ADRs 0006–0007. See the
[current validation record](../evaluation/collection-backed-workflow.md).

Keep the embedded `Snapshot` contract unchanged. Add optional `Project.scopes`
containing explicitly discriminated visual drafts or collection-backed evidence.
These scopes have image/bounds/provenance, observation times and an immutable
collection content digest, but no inline source-node array. Existing annotation
`snapshotId` and source-reference fields can address either source kind; IDs must
be unique across both. Existing embedded data and human approvals stay unchanged.

A saved overview can create a visual scope and proposed human regions immediately.
Visual scopes cannot supply source references or receive approval. An explicit
revision-checked attachment of a complete collection with equal file/page/root/
bounds upgrades that same scope once, preserving draft coordinates. Image and
structure remain separate observations. Every new collection annotation requires
explicit source-set confirmation; a human cannot certify missing source coverage.

Only trusted server routes create or attach these scopes. Source resolution uses
the collection store and verifies the bound content digest; callers cannot forge
completion through a generic project mutation. Removed or corrupt backing data
fails closed for new review and approved exports. Referenced collections cannot be
removed. Project JSON contains annotations and source references, not 200k nodes.

Matching scans every verified chunk in preorder, including out-of-parent-bounds
descendants. It retains bounded diagnostic candidates and ancestry state rather
than constructing a whole source array. Completion, exact-match ambiguity and
candidate overflow reflect the full scan. Selected references and exact source
text are resolved on demand for mutations, preview comparison and approved export.

The browser draws over a source surface (bounds/image) independently of its storage
kind. Collection search and text lookup use bounded pages. Source overlays represent
only fetched nodes, with that coverage disclosed. Native Figma selection can add
an explicit known node after captured membership and provenance checks. UI queries
must not silently fetch the complete collection or treat a loaded page as all data.

Portable large-source interchange uses a separate bounded chunk transfer format,
with complete validation before publishing a new scope. Legacy capture bundles
retain their original size/semantics. Interrupted imports never create approved or
complete evidence. Backups must carry both project records and bound source chunks.

Acceptance: image-only draft survives reload and rejects approval; full synthetic
105,837-node source can match a last-packet source, confirm, approve and export exact
provenance/text without growing inline Project nodes. Wrong binding, missing source,
stale revision, corrupt chunks, incomplete import and forged generic mutations fail.
Native and browser integration are verified separately. No source Figma writes or
external model transfer are introduced.
