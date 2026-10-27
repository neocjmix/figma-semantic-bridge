# Project context and design rationale

This describes the 0.4.0 candidate source. Normal imports use a 2× overview and
chunked structure with adjustable budgets. Saved partial evidence remains usable
for inspection; complete saved branches support scoped review. Continue resumes a
valid cursor or, after consent, creates a new generation that rechecks the original
scope. See [ADR 0012](adr/0012-recoverable-source-evidence.md) and
[ADR 0013](adr/0013-configurable-import-budgets.md). The
[validation log](product-validation.md) records executed checks and distinguishes
source, synthetic, native and released-package evidence.

## Guided review and local diagnostics

The 0.4.0 editor follows source import, region save, source confirmation, semantic
approval, specification linking and Share. A saved new region with no chosen
references prepares deterministic candidates when its source is complete. Later
edits preserve existing source choices; rematching is an explicit secondary action.
Source confirmation and meaning approval remain separate human decisions.

Pending region, specification and proposal input is saved or discarded before a
conflicting operation. Specification source selection is independent from the
canvas source, and Share reports the approved result returned by the export API.
Coordinates, role, hierarchy, manual matching and recovery remain available behind
secondary controls. In-app model generation still accepts only older bounded
captures; collection-backed imports support manual work and agent proposals.

Private local diagnostics record normalized request/operation timing, fixed error
reasons, validation paths and application call locations. Arbitrary console/error
text, design content and credentials are excluded. Native logs remain available
when the API is down; logs are bounded and best effort, not a complete audit trail.
See [ADR 0014](adr/0014-guided-workflow-and-local-diagnostics.md),
[local diagnostics](local-diagnostics.md) and the
[guided-workflow QA record](evaluation/guided-workflow-qa.md).

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
- Partial collection records expose verified received metadata, exact saved text,
  observed child counts and closed-subtree coverage. They remain historical and
  unreviewed. Missing records never become complete source by inference.
- A branch-backed `EvidenceScope` binds one verified closed subtree, optionally
  retaining the enclosing image and copied proposed regions. Its review covers
  that branch, not the image's unseen siblings or the original whole-source task.
- A known incomplete saved container can be acquired separately without traversing
  unrelated siblings. Releasing a broader paused cursor requires cost consent;
  the broader task remains incomplete and its saved records remain intact.
- Selective ID and immediate-child reads remain unreviewed compatibility
  observations. They establish only requested fields or direct children. Standard
  source transfer carries complete evidence and optional image context, never
  annotations or approvals; previous file formats remain readable.

Native subtree traversal still reads complete source records, including exact
TEXT. Browser text queries are lazy reads of saved local data. Choosing a smaller
part reduces native work; reconnect freshness for a whole scope still requires
reading that scope again. Exact packet reuse reduces transfer, not Figma getters.

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
