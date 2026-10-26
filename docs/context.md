# Project context and design rationale

This explains the local product in 0.2.0. The
[validation log](product-validation.md) records executed checks; dated evaluations
and ADRs retain the evidence available at their dates. Published 0.1.1 binaries
do not acquire later source-build behavior merely because the repository changed.

## Why the bridge exists

An early real-world Figma file was too large for repeated REST/MCP traversal. A
plugin export was estimated at roughly 4 GB, shifting the problem to local parse
cost. Early bottom-up geometry and text grouping partly worked, but component
boundaries and specification meaning depend on implementation intent. Figma's
editing tree, spatial containment and a developer's semantic structure differ.

Figma Semantic Bridge stores a **human-reviewed interpretation beside the unchanged
source design**. A person draws and names regions, relates exact source nodes and
text, reviews ambiguity, then explicitly approves meaning. Deterministic geometry
suggests source candidates. Optional AI can submit proposals, but cannot replace
approved human records. MCP exposes bounded approved context to coding agents;
the product does not generate production code.

## Current evidence model

- A legacy `Snapshot` embeds a bounded source-node array and an optional PNG. An
  incomplete capture remains an observation, never complete source evidence.
- An overview-only `EvidenceScope` has image, bounds and provenance but no source
  tree. It can hold proposed regions. Matching, confirmation and approval wait
  for a matching complete collection.
- A collection-backed `EvidenceScope` points to validated local chunks covering
  one selected subtree, including a chosen branch when requested. It may have
  an independently timed overview or no image. Browser pages and exact text are
  read on demand; full-scope matching scans the verified collection.
- Selective ID and immediate-child reads are separate, unreviewed observations.
  They establish only requested fields or direct children. A complete branch
  does not cover its siblings. Source-only NDJSON transfer carries one complete
  collection and optional overview, never annotations or approvals.

The [data model](data-model.md) explains these contracts; runtime validators in
`src/shared/` and server/domain checks are authoritative. Image, structure and
selective reads are **separate live observations**, not an immutable Figma
revision. Geometric confidence is not semantic certainty. Visibility and local
opacity can exclude known hidden or zero-opacity candidates; positive opacity,
source order and a PNG do not prove pixel contribution, occlusion or design age.

## Product and access principles

1. Preserve file/page/root identity, document coordinates, exact original text,
   observation time, incomplete coverage and review status. Never silently
   truncate a source record into apparently complete evidence.
2. Keep Figma read-only by default. Explicit highlight/navigation can change
   selection and viewport, but never source node contents.
3. Read selected scopes under node, byte and time budgets. No whole-document JSON
   dump or page preload is required. Packet limits do **not** bound Figma's native
   child-array allocation or image export.
4. Treat source text as untrusted data. Keep source acquisition, human semantic
   decisions and agent consumption separate. Optional external model requests
   need request consent and applicable organization permission.
5. Keep local services loopback-bound and authenticated, and protect stored design
   data and backups. Current source uses an encrypted authenticated plugin channel
   and pinned desktop/MCP TLS. Browser HTTP development is a separate boundary.
6. Publish synthetic fixtures and CI data. MIT covers project-owned code and
   documentation, not rights to third-party Figma designs.

The intended live producer has a Dev seat and view access. Effective **Dev-only
access to another owner's can-view file** is still an external acceptance gate;
an owned fixture or editor account does not prove it. Consumers of a transferred
source bundle need no live Figma connection. File-key-based live provenance uses
the local/private plugin path, not a Figma Community distribution claim.

## Outside the current product claim

Independent semantic accuracy and productivity studies, enterprise policy
approval, native behavior of the reported original 105,837-node file, immutable
cross-observation version pinning, full paint/occlusion reconstruction, automatic
source reconciliation, whole-document analysis, cloud collaboration and production
code generation remain unestablished. See [feasibility](feasibility.md),
[roadmap](roadmap.md) and [completion status](completion-status.md).
