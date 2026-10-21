# Architecture

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
