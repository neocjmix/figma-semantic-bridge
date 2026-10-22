# Figma Semantic Bridge

**Status: planning / feasibility — no production implementation yet.**

Human-guided, AI-assisted semantic annotation and MCP bridge for Figma Desktop.

## Thesis
Figma's editing hierarchy is not a software component hierarchy. Large real-world files mix UI and specifications, and exhaustive REST/MCP traversal or multi-GB JSON exports are costly. Instead, developers visually annotate meaningful component regions, optionally starting from an LLM-generated draft. A deterministic engine matches these regions to original Figma nodes. Approved component structure, spec relations and provenance become a portable implementation context served to Codex via local MCP.

## Architecture
Figma Desktop plugin ↔ local server ↔ local web annotation UI + MCP clients.

Figma stays **read-only by default**. This is not an automatic production code generator.

## Planning documents
- [Project context](docs/context.md)
- [Architecture](docs/architecture.md)
- [Pipeline and algorithms](docs/pipeline.md)
- [Data model](docs/data-model.md)
- [Feasibility gates](docs/feasibility.md)
- [Public Figma test-file research (2026-10-23)](docs/research/public-figma-fixtures-2026-10-23.md)
- [Roadmap](docs/roadmap.md)
- [Codex instructions](AGENTS.md)

## Security and OSS
Never commit proprietary design screenshots, Figma dumps, specs, access tokens or company metadata. Public tests use synthetic or explicitly licensed fixtures. Remote inference on internal designs requires authorization.

License selection is pending. Public visibility is not an OSS license.
