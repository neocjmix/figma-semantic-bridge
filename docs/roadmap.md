# Development Plan — Feasibility → PoC → MVP → Release

**Execution model:** Codex-assisted implementation, human architectural approval, PR-based development. Estimates are hypotheses, not commitments.

## Phase 0 — Repository readiness
Deliver architecture, context, pipeline, schema draft, feasibility protocol, Codex instructions, issue templates and synthetic fixture rules. Choose license only after deliberate decision. **Exit:** documents coherent and first experiments reproducible.

## Phase 1 — Feasibility spikes
1. Figma plugin ↔ localhost ↔ MCP round trip, including reverse command and reconnect.
2. Bounded image/metadata extraction on large frames.
3. Image/document coordinate fidelity.
4. Geometric node-matching benchmark.
5. Enterprise policy review.
**Exit:** F0–F4 gate evidence, ADRs for transport and extraction, go/no-go decision.

## Phase 2 — Vertical-slice PoC
One selected Figma frame → local screenshot → draw a region → match source nodes → return node IDs through MCP. Persist/reload a single annotation. No LLM required. **Exit:** live demo, repeatable integration test, known limitations documented.

## Phase 3 — Human-first MVP
Add multi-region tree, reparent/split/merge, spec text selection and links, source highlighting, undo/redo, persistence, import/export, schema validation, bounded MCP reads and review status. **Exit:** one real permitted workflow completed without full-file dump.

## Phase 4 — AI-assisted workflow
Add optional multimodal region proposals, semantic grouping, spec relation suggestions, schema validation, diff/patch review, protected approved annotations and model-independent provider interface. **Exit:** human correction is demonstrably cheaper than manual annotation on target cases; failures degrade to manual mode.

## Phase 5 — Reliability and security
Stress large/complex Figma documents, caching/invalidation, plugin disconnect/reconnect, concurrency, malformed inputs, prompt injection, unauthorized localhost clients and CI fixtures. Add performance regression benchmarks and migration tests. **Exit:** F5/F6 evidence and release checklist.

## Phase 6 — OSS release
Choose and commit LICENSE; publish sanitized documentation and examples; install/run guide, compatibility matrix, threat model, changelog, versioned schemas, CI, tagged GitHub release. Publish Figma plugin through appropriate channel only after review; local dev plugin remains an option. **Exit:** third party can install using public instructions and synthetic fixture.

## Phase 7 — Internal adoption
Separate enterprise approval, internal plugin distribution, local server packaging, remote inference policy, telemetry restrictions and support ownership. Run pilot with approved designs, measure time saved and failure rate, then broaden rollout. **Exit:** approved internal workflow and documented rollback/support path.

## Backlog priorities
P0: bridge, bounded extraction, coordinates, deterministic matcher, manual annotation, persistence, MCP reads.
P1: spec graph, review UX, AI draft, diff and source highlight.
P2: source-change reconciliation, Electron packaging, sophisticated layout suggestions, cross-screen reuse.

## Development controls
- Each issue defines input/output, acceptance criteria and tests.
- PRs reference an issue, ADR if architecture changes, and automated test evidence.
- No giant autonomous Codex implementation without a bounded vertical slice.
- Avoid mixing public synthetic data and internal design artifacts.
- Require a human review for source access permissions and release security decisions.
