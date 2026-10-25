# Processing Pipeline

## Implemented large-source path (unreleased, 2026-10-26)

An overview can be saved first and used for proposed annotation drafts. Prepare an explicit selective inspection when only known IDs or immediate children are needed. Choose a descendant container for complete branch capture, or collect the selected root in acknowledged chunks. A complete collection is explicitly attached to an equal-source visual draft or opened as its own scope. All chunks participate in matching; selected exact text and metadata are loaded only on demand. Human source confirmation precedes approval. Approved context remains bounded; a separate source-only NDJSON stream carries large collections without flattening them into legacy snapshots. See [the current verification](evaluation/collection-backed-workflow.md).

Each stage has independently testable inputs, outputs and fallback behavior.

## Stage 1 — Bounded acquisition
**Input:** selected Figma frame/page or explicit region. **Method:** export preview, extract lightweight node IDs/types/parents/BBoxes/text/visibility, chunk and cache; preserve coordinate transform. **Output:** preview + source scope + node index. Never require complete JSON dump.

## Stage 2 — Human annotation
**Input:** preview and existing annotations. **Method:** rectangles, pan/zoom, snap, name, split/merge, hierarchy edits, undo/redo. Geometric containment suggests hierarchy but does not dictate it. **Output:** editable semantic tree.

## Stage 3 — AI draft (optional)
**Input:** bounded image, text/geometry, approved annotations and requested granularity. **Method:** multimodal structured proposal for UI/spec/ignore regions, names, parents and ambiguities. Convert image to document coordinates. Validate schema, bounds and cycles. Propose patches, never silently replace approved human decisions. **Output:** reviewable AI suggestions. **Fallback:** manual mode.

## Stage 4 — Deterministic source grounding
**Input:** annotation BBoxes and original source tree/index. **Method:** spatial indexing (R-tree or equivalent), tolerant containment, IoU/coverage, original ancestry tie-breaks, equal-box cycle guards, candidate scoring. Prefer one fitting node when valid; otherwise a minimal covering set of nodes. **Output:** zero-to-many original node references and ambiguity diagnostics. Geometric score is not semantic confidence.

## Stage 5 — Specification extraction and linking
**Input:** marked spec regions and exact source text. **Method:** separate UI copy from explanatory notes using geometry, visual context and optional LLM; preserve verbatim text; propose many-to-many describes/behavior/constraint/interaction/dependency edges. Proximity is a hint, not proof. **Output:** spec records, relations and unresolved questions.

## Stage 6 — Human review
**Input:** proposed boundaries, source matches and spec links. **Method:** accept/reject/edit, highlight source nodes, batch approve, maintain history, validate hierarchy and references. **Output:** approved model with explicit unresolved items.

## Stage 7 — Context packaging
**Input:** approved model and selected source details. **Method:** versioned schema validation, provenance, normalized coordinates and compact exports; styles/assets loaded on demand. **Output:** component hierarchy, specification graph, source mapping and open questions.

## Stage 8 — MCP exposure
**Input:** persisted model and optional active plugin. **Method:** bounded read tools for scopes, components, specs, node details and previews; controlled proposal-writing tools with review requirements. **Output:** stable context for Codex and other clients. Disconnected live queries fail explicitly.

## Stage 9 — Change reconciliation
**Input:** prior approved model and refreshed source. **Method:** stable node IDs first, then bounded geometry/text fingerprints; flag stale, missing and uncertain references; human approves repairs. **Output:** reviewable diff. Not guaranteed automatic synchronization.

## Stage 10 — Implementation handoff
**Input:** approved semantic contract and unknowns. **Method:** export JSON and readable implementation context with provenance and source references; targeted MCP follow-up. **Output:** developer/agent-ready design context, not automatically generated production code.

## Algorithm cautions
Tolerance can make containment non-antisymmetric; use deterministic tie-breaking. Meaning is continuous and hierarchical, not a universal binary boundary. Earlier bottom-up text aggregation may remain a bounded heuristic, not the only segmentation mechanism.
