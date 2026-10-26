# Local source quickstart — 0.2.0

This is for contributors running the **current source**, not a substitute for
the [0.2.0 user guide](user-guide.en.md),
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
