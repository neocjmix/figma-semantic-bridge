# Local source quickstart — 0.2.1

This is for contributors running the **current source**, not a substitute for
the [0.2.1 user guide](user-guide.en.md),
[Korean user guide](user-guide.ko.md),
[acquisition workflow](acquisition-workflow.en.md) or
[upgrade guide](upgrade-guide.md). The published 0.1.1 app/plugin has a different
bridge protocol and does not contain the later collection-backed workflow. Update
the local server, imported plugin and packaged app as one matched version.

## Build and run locally

Use Node.js 22 or newer and synthetic or otherwise explicitly permitted source
data. The same source build supplies the server, web UI, MCP adapter and plugin.

```sh
npm ci
npm run check
npm run fixtures:validate
npm start
```

The development server binds loopback at `http://127.0.0.1:4177` and creates the
pinned HTTPS desktop/MCP endpoint at `https://127.0.0.1:4178`. Its terminal shows
the local pairing token: treat that terminal as private and never put the token in
chat, screenshots, URLs, fixtures or commits. The browser development route uses
the token and exact localhost/Origin checks. Packaged AppKit/WKWebView and MCP
use the private local certificate pin for each HTTPS connection. The Figma plugin
uses the v3 mutually authenticated, encrypted channel over the exact manifest
`ws://localhost:4177` allowance. See
[architecture](architecture.md), [ADR 0010](adr/0010-plugin-mutual-authentication.md)
and [ADR 0011](adr/0011-pinned-desktop-service.md).

Import `plugins/semantic-bridge/manifest.json` through Figma Desktop's
**Plugins → Development → Import plugin from manifest**. This is a local/private
development plugin path using the host's private file-key API; it is not a Figma
Community listing. A connected plugin reads the current page and selected scope.
Neither metadata reads nor image export edit the design. Explicit highlight
changes only selection and viewport. The effective Dev-only plus another owner's
can-view file remains unverified; follow the
[Desktop permission procedure](desktop-verification.md#dev-seat-and-view-access-acceptance)
before claiming that access combination.

The manual product workflow is in the [user guide](user-guide.en.md). The
[acquisition guide](acquisition-workflow.en.md) explains bounded Snapshots,
overview-only proposed drafts, complete chunked collections, selective ID/child
reads, branch acquisition and source-only NDJSON transfer. These have separate
completion semantics: a partial collection, unloaded source page or visual-only
draft cannot become approved evidence merely because some records arrived.

## MCP and optional proposals

The built `dist/mcp.mjs` is a stdio MCP server. By default it reads the token and
private certificate pin from `~/.figma-semantic-bridge` and connects to the
numeric loopback HTTPS endpoint. Use `FSB_DATA_DIR` to point at an isolated local
data directory; if changing the server endpoint, configure `FSB_SERVER_URL` to
the matching pinned HTTPS origin. HTTP for MCP requires the explicit
development-only `FSB_ALLOW_INSECURE_HTTP=1` opt-in. Do not hardcode the token in
an MCP configuration. MCP offers bounded approved-context and targeted source
reads, live selection/navigation and proposal staging; it cannot approve human
meaning. Source text returned to an agent is untrusted data, not instructions.

The tool list presents one source-task workflow alongside approved-context reads,
selection/navigation and proposal staging. It advertises 13 tools; earlier
capture, raw-collection and selective-inspection names remain callable for existing
clients but are omitted from discovery. New agents should use these four tools:

| Tool | Use |
| --- | --- |
| `acquire_source_task` | Default `action=prepare` pins the selected container without image export or traversal. Supply the project revision and current plugin session. After explaining the target and limits, explicitly start the returned `taskId` with `action=start`; `action=pause` preserves received data. For a known incomplete saved container, `action=part-plan` checks the effect of focusing on it and `action=part` reads only that part, leaving the original task incomplete. |
| `get_source_task` | Omit `taskId` to list saved tasks, current connection and import settings. Include it for progress, recovery lineage and the next continuation plan. This performs no Figma read. |
| `continue_source_task` | Resume the original task. If the cursor was lost, read the continuation plan and obtain the user's authorization for the displayed recheck cost before setting `confirmRevalidation=true`. The default is false. Follow the returned task ID when recovery creates a new generation. |
| `read_source_evidence` | Read saved metadata pages, exact text segments or a complete saved branch descriptor with `kind=metadata`, `text` or `branch`. Partial imports remain queryable. These are historical, unreviewed records; no Figma read or approval occurs. |

Use `list_projects` for the current project revision and `get_source_task` for the
current plugin session before preparing or continuing. Source text pagination
uses UTF-16 offsets; follow `nextOffset` until null. A complete saved branch does
not complete the parent import or establish current Figma freshness. A recheck
may reread every required node even when equal saved packets reduce transfer.
The agent must not infer permission for this additional work from a timeout or
automatically set the confirmation argument. Existing session authorization can
be used when it explicitly covers the displayed recheck.

A focused part preserves its enclosing source identity and historical image. If
the broader import has a paused reading position, starting the part releases it;
continuing the broader import later requires a recheck. The part plan reports
this consequence, and `confirmRevalidation` remains false until authorized.
Completing the part does not mark its siblings or the original full task complete.

Manual annotation works without an AI provider. An optional OpenAI-compatible
provider must be deliberately configured; external transfer of selected images
and text needs per-request consent and applicable organization authorization.
Generated output is a validated pending proposal, never an automatic approval.

## Validation boundaries

```sh
npm run check
npm run fixtures:validate
npm run test:e2e
```

The browser suite uses an actual loopback server with synthetic fixtures or a
synthetic WebSocket Figma peer. It is not live Figma Desktop acceptance. The
[validation log](product-validation.md) separates those tests, bounded owned
native-plugin observations, scripted HTTP operations, installed-app checks and
unverified large/private account cases. A new release also needs a clean-commit
package and asset verification; passing this quickstart does not publish it.

Project JSON, source chunks, images, exact text, history, observations and the
pairing token are local sensitive data under the configured data directory.
Back up that directory only while all writers are stopped. Preserve collection
chunks with the Project files; moving only the JSON project can make approved
source evidence unavailable. Do not run against corporate/client designs or
share a transfer file without permission from the source owner and organization.
