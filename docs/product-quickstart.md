# Local source quickstart — 0.4.0

This is for contributors running the **current source**, not a substitute for
the [user guide](user-guide.en.md),
[Korean user guide](user-guide.ko.md),
[acquisition workflow](acquisition-workflow.en.md) or
[upgrade guide](upgrade-guide.md). Keep the local server, imported plugin and
packaged app on one matched version.

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

## Follow the product flow

1. Create or open a workspace. In Figma, select a permitted frame. Choose
   **Add source**, check its target and cost notice, then **Start import**.
2. Draw and name a region. **Save region** prepares links for a new region when
   its source is ready. Inspect the named source nodes, **Confirm sources**, then
   **Approve region**. Saved manual references survive later geometry edits;
   **Change source nodes** contains rematching, manual search and Figma selection.
3. From an approved region, choose **Link specification**. It preselects that
   region as the target. **Specification source** selects the source of the exact
   wording, including another imported source. Save and approve the specification.
4. Open **Share** to inspect the result and download JSON or Markdown, or follow
   the MCP instructions. Save or discard pending changes before moving to another
   editor or sharing.

Role, parent and numeric geometry are under **Region settings**. Split, merge,
source-transfer files and recovery remain available as secondary tools.
The [user guide](user-guide.en.md) covers these paths. The
[acquisition guide](acquisition-workflow.en.md) explains partial-source browsing,
prepared parts and continuation after reconnect. Image-only drafts can be saved;
source confirmation and approval require complete evidence for the chosen scope.

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
In-app generation currently accepts older bounded Snapshots, not normal
collection-backed imports. Use manual editing or submit a structured agent proposal
for a normal import. Generated output is a validated pending proposal, never an
automatic approval.

## Local diagnostics

The packaged app exposes **Bridge → Reveal Diagnostic Logs**. The default folder
is `~/.figma-semantic-bridge/logs`; an isolated `FSB_DATA_DIR` has its own `logs`
subdirectory. `server.ndjson` records request IDs, normalized routes, operation
names, duration and errors. `native.ndjson` records desktop lifecycle, WebView and
file-save events. Browser and WebView failures include sanitized application
stack locations; arbitrary console arguments are excluded.

```sh
tail -f ~/.figma-semantic-bridge/logs/server.ndjson
tail -f ~/.figma-semantic-bridge/logs/native.ndjson
```

Reproduce in a synthetic workspace, note the time and action, and match the UI's
**diagnostic reference** with `requestId` in the logs. Server validation errors
include fixed reasons or schema paths, not request bodies or source values.
Design text, images, node names, tokens and external model content are excluded.
Logging is best effort, private to the local account, bounded by file size and
retention, and never uploaded automatically. Preserve the relevant rotated files
when investigating an older incident.

For direct inspection, choose **Bridge → Enable Web Inspector** on supported
macOS versions. This enables WebKit inspection; use Safari's Develop menu to
inspect the app. The local logs remain available without opening an inspector.
Development browser consoles also emit local metadata diagnostics through the
authenticated API. Keep pairing-token terminal output private; it is separate
from these diagnostic files.

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
