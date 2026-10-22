# ADR 0001: local product runtime and provisional Desktop transport

Status: implemented incrementally; Figma Desktop transport acceptance remains pending.

The product responsibilities in `docs/architecture.md` remain unchanged. This ADR
records implementation decisions needed for the first executable vertical slice.

- Node.js HTTP and WebSocket server binds `127.0.0.1`, port 4177 by default. React/Vite
  builds a same-origin local editor. There is no hosted service or automatic egress.
- A random local pairing token protects API and plugin sessions. WebSockets authenticate
  in their first message, not a URL; unpaired peers expire. Host/Origin validation,
  bounded messages, request IDs, timeouts and disconnect handling are mandatory.
- Figma main sandbox reads and exports the selected container; its UI iframe owns the
  WebSocket. The plugin handles only a fixed command union. Selection/highlighting
  changes editor navigation only. No command mutates source document content.
- WebSocket is a testable provisional transport, not a claim that the target user's
  Desktop allows it. Real HTTP/WS clients and browser execution exercise the local
  path; Desktop permissions/network behavior require the recorded manual protocol.
- A project holds independently bounded snapshots so UI and a separate specification
  frame can be captured without reading their entire parent page. References include
  snapshot IDs to avoid conflating repeated node IDs or mutable captures.
- JSON persistence uses atomic replacement and restrictive permissions. Optimistic
  project revisions prevent silent stale edits. History stores semantic state, not
  repeated copies of images. SQLite remains unnecessary for this local slice.
- Parent IDs are canonical; exports derive child IDs to avoid inconsistent duplicate
  hierarchy state. Runtime schemas and cross-reference checks enforce integrity.
- The MCP stdio process talks to the authenticated loopback API. Its write surface
  only submits proposals; review remains an explicit human action in the editor.
- AI providers are optional and disabled by default. Synthetic/mock providers can
  verify the proposal contract without transferring design content externally.
  The server alone configures an OpenAI-compatible endpoint; non-loopback HTTPS
  inference additionally requires per-request consent. Output is a pending proposal
  validated against the same source, geometry, hierarchy and approval invariants.
  The server checks the original revision again after asynchronous inference.
- MCP listing endpoints paginate approved records on the server, independently of
  full export text budgets. Capture/proposal tools receive image-free summaries
  so a successful write cannot appear to fail merely because cached previews make
  the complete project too large for the MCP client.

Evidence and remaining gate status are recorded in the product validation log. This
ADR does not mark F0–F6 passed, choose a repository license, or authorize private
design uploads to external models.
