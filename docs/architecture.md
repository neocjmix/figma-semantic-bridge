# Architecture

## Local peer authentication (unreleased)

[ADR 0010](adr/0010-plugin-mutual-authentication.md) defines the mutually
authenticated, encrypted plugin channel on Figma's supported localhost endpoint.
[ADR 0011](adr/0011-pinned-desktop-service.md) covers native/MCP TLS pinning for every
connection and executable web resource. Pairing tokens never enter the plugin
wire protocol. Native/MCP trust comes from a private local certificate, never from
an unauthenticated health response. HTTP browser development remains an explicit
separate boundary. See [upgrade notes](unreleased-upgrade.md).

## Current acquisition and editor implementation (unreleased, 2026-10-26)

[ADR 0008](adr/0008-collection-backed-editor.md) separates visual-only drafts and collection-backed scopes from legacy embedded snapshots. The local JSON project stores image/bounds/provenance and references to immutable chunk files. The editor pages metadata and explicitly resolves selected original text; matching streams the complete selected tree. Approval and approved MCP reads verify backing integrity. [ADR 0009](adr/0009-selective-source-acquisition.md) adds explicit-ID metadata/text and immediate-child observations, plus complete collection capture of a chosen descendant branch. These are distinct from subtree-complete evidence. Source-only NDJSON interchange validates every chunk, content digest, footer and EOF before attaching a new scope.

Figma native operations remain serialized to preserve cursor ownership and avoid duplicate expensive work. Independent local display and cached reads need no new provider call. A stopped/restarted plugin cannot rehydrate an old live cursor as an unchanged revision. Browser lists, selected text and overlays have bounded pages; they never imply that an unloaded node is absent.

```text
Figma Desktop document
  ↕ Figma Plugin API
Figma plugin: selected scope, node metadata, image export, navigation
  ↕ local bridge (transport validated by feasibility PoC)
Node.js / TypeScript local server
  ├─ plugin session broker and scoped cache
  ├─ spatial index / deterministic grounding
  ├─ annotation and specification storage
  ├─ local HTTP API
  └─ MCP server
     ↙                         ↘
React web annotation UI       Codex / other MCP agents
```

## Responsibilities
**Plugin:** minimal document adapter; bounded reads and exportAsync; node highlighting; plugin lifecycle reporting. No persistent annotation store or heavy inference.

**Local server:** request IDs, timeouts, reconnect, cache, spatial matching, validation, storage, MCP tools, safe patch application.

**UI:** pan/zoom image, draw/rescale/reparent regions, split/merge, spec links, review and undo/redo.

**Agent:** bounded context reads and proposed changes; cannot silently edit approved annotations.

## Network and lifecycle
Figma plugins are user-launched, not background daemons. Main plugin sandbox and UI iframe have distinct network capabilities. Verify localhost HTTP, WebSocket versus polling, CORS, manifest permissions and session recovery in actual Figma Desktop. When disconnected, cached annotations remain readable; live source queries return explicit errors.

## Security
Bind loopback only by default; authenticate local bridge; enforce origins and CSRF/DNS-rebinding defenses; validate all MCP inputs and limit traversal, bytes, time and concurrency. Never expose arbitrary shell/file operations via MCP. Treat Figma text as untrusted prompt-injection material. External model processing of internal designs is opt-in and company-policy gated.

## Initial stack
TypeScript monorepo, Figma Plugin API, Node.js server, React/Vite UI, MCP TypeScript SDK, runtime schema validation. Begin with web UI; evaluate Electron only if installation or OS integration requires it. Persistence choice (SQLite vs JSON) remains open.

## Source of truth
Figma owns visual source. Local annotation store owns human-reviewed semantic interpretation. Application implementation remains a separate concern.
