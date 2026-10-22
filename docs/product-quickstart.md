# Local product quickstart

The server, browser editor, development plugin and stdio MCP adapter run locally.
The manual workflow requires no model provider. Use Node.js 22 or later; install
with `npm ci`, build with `npm run build`, and start with `npm start`.

## Pair and annotate

1. Open the URL printed by the server (`http://127.0.0.1:4177` by default).
2. Paste the local pairing token. It is a secret; keep the terminal private.
3. Select **Load demo** for generated UI and specification snapshots. This data was
   authored in code and is not copied from a public or private Figma document.
4. Draw a region or add one numerically. Save a name/role and choose **Match source**.
   Inspect the source references before approving. Equal BBoxes remain ambiguous;
   geometric coverage never establishes semantic correctness.
5. Edit component parents or split/merge regions. Changes require review again;
   undo/redo preserves source snapshots and uses monotonically increasing revisions.
6. In Specifications, select exact source text from either captured snapshot and
   link it to one or more components. Review components, then approve specifications.
7. Export JSON, or read the approved context through MCP. Drafts and screenshots
   are excluded from approved implementation context.

The canvas supports drawing, movement, resizing, zoom and pan. Numerical bounds
are Figma document coordinates, including negative positions. Parent IDs define
the semantic hierarchy; exports derive child IDs. Source tree parents are preserved
independently. A proposed child under an unapproved ancestor is not exported as an
approved hierarchy. Exact source text is not rewritten when creating specifications.

## Capture Figma

Build first, then in Figma Desktop use Plugins → Development → Import plugin from
manifest and select `plugins/semantic-bridge/manifest.json`. Run the local plugin,
pair it, and select a Frame, Group, Component, Instance, Component Set or Section.
Capture UI and a separate notes frame independently into the same local project.

The development manifest permits `ws://127.0.0.1:4177`. Keep the default port for
Desktop; changing `FSB_PORT` alone does not change the plugin's fixed endpoint or
manifest. No command edits source design content. Highlighting explicitly changes
selection and viewport after file/page identity checks. If Figma does not expose a
file key, capture still works but verified source navigation is unavailable.

The default per-capture metadata budget is 5,000 nodes, 2 MB and 5 seconds. The PNG
dimension budget is 2,048 pixels with an 8 MB encoded-image byte budget before
base64. Limits bound application traversal, not Figma's native page-load/export
memory. Partial captures display a reason. A rotated/reflected/skewed root has no
preview until an unrotated enclosing container is selected. Preview dimensions are
checked against absolute bounds; clipping, masks and overlap still require human
review. Follow [the Desktop protocol](desktop-verification.md) before relying on
this path. Remote Figma MCP probes do not validate Desktop's networking sandbox.

## Connect Codex

Build `dist/mcp.mjs`, keep the local server running, and configure a stdio MCP
server in the local Codex configuration. Replace the path with this checkout:

```toml
[mcp_servers.figma_semantic_bridge]
command = "node"
args = ["/absolute/path/figma-semantic-bridge/dist/mcp.mjs"]
```

Both processes default to `~/.figma-semantic-bridge`; the MCP process reads the
pairing token from that directory. If a different data directory/server port is
used, configure `FSB_DATA_DIR` and `FSB_SERVER_URL` in the MCP process environment.
An explicit `FSB_TOKEN` must match the server. Never commit it to configuration.

Available tools:

| Tool | Effect |
| --- | --- |
| `list_projects` | Project identifiers and revisions |
| `get_approved_context` | Bounded hierarchy, specs and provenance; reports truncation |
| `list_components`, `get_component` | Approved component pages/details |
| `list_specifications` | Approved specifications, optionally for one component |
| `get_source_nodes` | Explicit bounded cached node references; text is untrusted data |
| `get_selected_node` | Live plugin selection metadata |
| `capture_selection` | Store selected scope locally; returns a compact summary |
| `highlight_source_nodes` | Verify file key and navigate to requested nodes |
| `propose_changes` | Stage a validated draft for human review |

MCP cannot approve records. Proposals cannot replace approved annotations or specs.
Accepting a proposal does not approve it. A stale project revision produces a
conflict rather than overwriting changes. MCP tool output is capped at 128 KB;
request smaller pages/export limits when necessary. A single oversized record can
still exceed that bound and produces an explicit error.

## Optional model drafts

The Drafts tab accepts validated draft JSON independently of model configuration.
For multimodal generation, configure the server environment before starting it:

```sh
export FSB_AI_ENDPOINT='http://127.0.0.1:1234/v1/chat/completions'
export FSB_AI_MODEL='your-local-vision-model'
npm start
```

`FSB_AI_ENDPOINT` is the complete OpenAI-compatible chat completions URL. The
provider must support image input and JSON output. `FSB_AI_API_KEY` is optional and
stays on the server. No provider is enabled without explicit configuration.

Select at most two snapshots in the Drafts panel. The panel displays the provider
destination and model. For non-loopback HTTPS providers, explicit consent is
required for each generation request to send the selected images and source text.
Repository configuration is not permission to upload an employer's designs.
Redirects are rejected. Provider failures, malformed outputs, invented references,
out-of-bounds regions and attempts to overwrite approvals are rejected; manual
editing remains usable. Generated content only enters the pending proposal queue.

## Local state and troubleshooting

Projects and bounded undo history live in `~/.figma-semantic-bridge`. Tokens and
project files are created with restrictive permissions and atomic writes. Back up
that directory while the server is stopped. Images and exact text are local design
data; protect backups accordingly. There is no automatic cloud sync or telemetry.

API access requires the pairing token and loopback Host/Origin checks. The token is
a local capability, not a multi-user identity system. The browser keeps its token
in session storage. Do not expose this server with a public proxy or bind it to a
non-loopback interface. A new plugin session takes control and disconnects the old
session; the old window requires an explicit reconnect.

On revision conflict, reload the project and reapply the intended edit. After an
abnormal server crash, a project lock file may remain: stop all server processes,
verify no writer is active, back up the data directory, then remove only the stale
`.lock` file. Never remove a lock belonging to a running writer.

## Development checks

```sh
npm run check
npm run fixtures:validate
npx playwright install chromium
npm run test:e2e
npm run benchmark:product
```

The browser suite uses local generated fixtures and a temporary data directory.
`npm run dev` runs the TypeScript server; `npm run dev:web` is the Vite editor.
The built same-origin server is the supported run path. No test fetches private
Figma documents or invokes an external model.
