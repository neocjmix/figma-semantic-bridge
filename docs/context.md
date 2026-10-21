# Project Context and Design Rationale

## Origin
A real-world Figma file proved unexpectedly enormous. Initial traversal through Figma REST API and MCP seemed endless. Exporting JSON with a plugin resulted in an estimated ~4 GB dump, improving repeated network access but introducing massive parsing cost.

An early automatic algorithm used tolerant BBox containment plus original Figma ancestry to deterministically reconstruct a spatial tree. From text leaves it climbed ancestors, collecting text and asking an LLM whether multiple independent semantic groups appeared. A second stopping criterion detected transitions between rendered UI and explanatory specification text. Original node references were preserved.

This partly worked, but semantic boundaries are continuous, hierarchical and dependent on implementation intent. A skilled frontend developer can visually identify meaningful component boundaries and decomposition far more efficiently. Designers' editing mental model should not be forced to match developer architecture.

## Product thesis
Create a **separate semantic interpretation layer** over unchanged Figma designs. Humans can draw, split, merge and name components and link spec text. An LLM can draft these annotations; humans correct and approve. Deterministic geometry grounds annotations to actual Figma nodes. MCP gives Codex approved context without exhaustive source traversal.

## Core distinctions
- Original Figma editing tree ≠ spatial containment tree ≠ semantic component hierarchy.
- Specification associations are a graph, not necessarily a tree.
- Visual region ≠ necessarily a reusable React component or state ownership boundary.
- Geometric match quality ≠ semantic certainty.
- Missing behavior cannot be recovered as fact from pixels.

## Principles
1. Human approval is authoritative; AI must not overwrite approved decisions.
2. Manual, AI-assisted and AI-first workflows use the same schema.
3. Preserve node IDs, original text, coordinates, scope and provenance.
4. Read bounded regions and cache; avoid whole-file dumps.
5. Deterministic geometry and validation; LLM for ambiguous semantics.
6. Explicit unknowns and reviewable ambiguity.
7. Local-first and source read-only by default.
8. Portable contracts and agent-agnostic MCP.
9. Synthetic public fixtures; protect corporate designs.

## Out of scope for first release
Production code generation, complete product-flow reconstruction, designer-side layer refactoring, cloud collaboration, guaranteed automatic change reconciliation and whole-file automatic analysis.
