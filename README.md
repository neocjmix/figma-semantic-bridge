# Figma Semantic Bridge

**Status: executable local MVP; automated browser/HTTP/WebSocket/MCP tests are available. Actual Figma Desktop acceptance and release gates remain pending.**

Human-guided, AI-assisted semantic annotation and MCP bridge for Figma Desktop.

## Thesis
Figma's editing hierarchy is not a software component hierarchy. Large real-world files mix UI and specifications, and exhaustive REST/MCP traversal or multi-GB JSON exports are costly. Instead, developers visually annotate meaningful component regions, optionally starting from an LLM-generated draft. A deterministic engine matches these regions to original Figma nodes. Approved component structure, spec relations and provenance become a portable implementation context served to Codex via local MCP.

## Architecture
Figma Desktop plugin ↔ local server ↔ local web annotation UI + MCP clients.

Figma stays **read-only by default**. This is not an automatic production code generator.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run check
npm start
```

Open `http://127.0.0.1:4177` and pair with the token printed in the local terminal.
Choose **Load demo** to use the self-generated screen and separate specification
notes without a Figma account. Draw component regions, save and match their source
nodes, link verbatim specification text, and explicitly approve the results.

For live captures, import `plugins/semantic-bridge/manifest.json` as a development
plugin in Figma Desktop, pair it with the same token, and select one container.
The local editor's **Capture selection** adds its image and bounded metadata.

- [Installation, MCP setup and optional AI](docs/product-quickstart.md)
- [Exact Desktop verification protocol](docs/desktop-verification.md)
- [Executed checks, measurements and remaining gates](docs/product-validation.md)
- [Runtime decision record](docs/adr/0001-local-product-runtime.md)

## Planning documents
- [Project context](docs/context.md)
- [Architecture](docs/architecture.md)
- [Pipeline and algorithms](docs/pipeline.md)
- [Data model](docs/data-model.md)
- [Feasibility gates](docs/feasibility.md)
- [Public Figma test-file research (2026-10-23)](docs/research/public-figma-fixtures-2026-10-23.md)
- [Real-world fixture evaluation and measured results](docs/fixture-evaluation-results.md)
- [Fixture registry and schema](fixtures/README.md)
- [Read-only analyzer / Figma Desktop instructions](docs/fixture-plugin.md)
- [Roadmap](docs/roadmap.md)
- [Codex instructions](AGENTS.md)

## Security and OSS
Never commit proprietary design screenshots, Figma dumps, specs, access tokens or company metadata. Public tests use synthetic or explicitly licensed fixtures. Remote inference on internal designs requires authorization.

License selection is pending. Public visibility is not an OSS license.

## Fixture tooling

Requires Node.js 22 or later. Run `npm ci`, `npm run check`, and
`npm run fixtures:validate`. `npm run benchmark:fixtures` regenerates local
synthetic benchmark observations. Public candidate manifests contain metadata
only; automated tests never fetch Figma documents.
