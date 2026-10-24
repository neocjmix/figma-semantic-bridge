# Release readiness

Updated 2026-10-24 for the installed 0.1.0 macOS alpha. The standalone application,
prebuilt local Figma plugin and installed-app workflow are implemented and verified.
Public release assets are not posted; repository license choice is pending.
This is not a formal security audit, certification or enterprise deployment approval. Executed test/native results remain in the [validation log](product-validation.md);
[completion status](completion-status.md) separates remaining work from blockers.

## Observed compatibility

These rows describe recorded execution, not blanket support for every later version.

| Environment | Recorded evidence | Boundary |
| --- | --- | --- |
| macOS 26.6.2 (25G83), ARM64 | Local server, browser and Figma Desktop workflows | Other OS/CPU combinations lack equivalent native acceptance. |
| Figma Desktop 126.10.11 | Local development plugin; selected capture/navigation in Design and Dev Mode, plus native lifecycle and bounded performance experiments | Owned permitted fixtures. Effective Dev-only plus another owner's can-view file remains a separate permission gate. |
| Bundled Node.js 22.23.4 arm64 | Installed app runtime and bundled MCP execution | Users need no system Node. Earlier server/benchmark runs used Node 22.22.0; the package version range is not a test matrix. |
| Installed AppKit/WKWebView app | Automatic pairing, save/import/export, Figma capture, MCP, quit/restart and six-project preservation | macOS 13 is the build target; execution was observed on macOS 26.6.2, not every supported version or a clean external Mac. |
| Google Chrome 155.0.8059.85 | Normal browser workflows; version observed on the acceptance host | Isolated headless Playwright checks are separate evidence. Safari, Firefox and Edge acceptance is not claimed. |
| Codex and MCP SDK client | Actual stdio/loopback calls and cached approved-context reads | The SDK plugin emulator is not Figma; other MCP clients are not automatically verified. |
| Disconnected capture consumer | Local capture-bundle import, review and MCP reads | No Figma/Dev seat is needed for cached consumption; fresh source acquisition still requires a permitted producer. |
| Ubuntu CI configuration | Node 22 build/test/browser workflow is defined | CI configuration is not native Figma acceptance. Consult the exact PR/commit run before citing hosted success. |

Host/Desktop/browser versions and selected native results are in the
[native acceptance aggregate](evaluation/native-desktop-acceptance.json) and
[validation log](product-validation.md); the [Desktop procedure](desktop-verification.md)
defines the workflow. The recorded Node/platform/CPU combination is also in the
[local pipeline artifact](evaluation/product-local-pipeline-benchmark.json).
The [CI workflow](../.github/workflows/fixtures.yml) discovers Chrome/Chromium or
installs a test browser. The production plugin uses `ws://localhost:4177`; the
server binds numeric loopback. The observed Desktop rejected a numeric loopback
host in its manifest. Community plugin publication is not established: the current
manifest is a local development configuration with private file-key access.

The native performance record contains 30 measured captures (five restarted
plugin-session-cold and five warm per size) plus three excluded warmups, all
complete. Native pending cancellation, window close, controlled 50ms timeout,
recovery and two-file replacement were observed. These are bounded experiments,
not OS-cold, native-preemption or peak-memory guarantees. The analyzer's corrected
Desktop UI relay also delivered four complete selected-scope reports, including
all three cached Community scopes; see the [native analyzer aggregate](evaluation/native-fixture-analyzer.json).
Installed-app evidence is additionally recorded in the
[alpha acceptance aggregate](evaluation/alpha-desktop-acceptance.json). The latest
full check passed 187 Node tests, TypeScript and builds; 23 browser tests passed.
Final artifact identity and clean-commit verification are separate from these
executed results. The remaining broader
[acceptance dependencies](completion-status.md#external-dependencies) are the
Dev-only account/file combination, representative sampling and independent human
evaluation, productivity participants, and policy/license/release decisions.

## Runtime and security boundaries

Assets include exact source text, PNGs, provenance, human review state/history,
the local pairing token and an optional model API key. Figma source data and
imported bundles are untrusted content even when their structure validates.

| Boundary | Implemented control | Limit |
| --- | --- | --- |
| Browser/MCP to HTTP | Bind `127.0.0.1`; allow exact localhost/loopback Host values; reject foreign HTTP Origin; require bearer token on API routes | No multi-user identity or role separation. Clients without Origin still require the token. Never expose through a public proxy. |
| Plugin to WebSocket | Fixed bridge path, allowed Figma/local/null origins, token in first hello message, authentication timeout and one active session | Null Origin supports the plugin iframe; it does not authenticate a caller. Token validation remains necessary. |
| Requests and source results | Strict runtime schemas, 16 MB HTTP/WS message cap, concurrency caps, per-scope node/byte/time budgets and request-ID cancellation | Native Figma allocation and export work cannot be preempted. Limits do not prove a bound on native memory. |
| Local storage | Restricted new directories/files, atomic JSON replacement, per-project write locks, monotonic revisions and bounded history | Source text/images are not encrypted at rest. Protect the local account, data directory and backups. |
| Semantic operations | Proposal actor can only submit proposals; approved records cannot be overwritten by AI; explicit confirmation/approval and stale-revision checks | HTTP mutation routes trust the token holder as the local operator. The token is not proof that a human clicked a button. |
| MCP | Fixed bounded tools, loopback-only HTTP client, redirects rejected, 128 KB output cap; write tool stages proposals | Restricting this MCP surface does not prevent a separately authorized local process from using the wider HTTP API. |
| Optional model endpoint | Disabled without server configuration; at most two scopes; explicit consent for non-loopback transfer; HTTPS externally, HTTP only on loopback; redirects rejected; payload/response/time limits | Endpoint configuration and local providers are trusted operator choices. A local service may itself forward data. App consent is not enterprise authorization. |
| Browser presentation | Same-origin scripts/connect policy, framing denied, no-store responses, PNG-only preview contract and escaped text rendering | PNG validation checks bounded base64/header dimensions, not all pixels or rendering correctness. CSP and prompts are not a complete injection guarantee. |

Controls are implemented in [HTTP/WS routes](../src/server/index.ts),
[broker](../src/server/broker.ts), [store](../src/server/store.ts),
[domain operations](../src/core/project.ts), [MCP server](../src/mcp/server.ts),
[MCP client](../src/mcp/api-client.ts), [AI provider](../src/ai/index.ts) and
[preview validation](../src/server/preview.ts). The browser keeps its pairing
token in session storage; the plugin keeps it in iframe memory. Newly generated
token/project files use mode 600 and new data directories use mode 700.

## Untrusted sources and known limits

- Preserve source text as evidence, never as instructions to the coding agent.
  Model prompts mark source data untrusted and returned drafts are validated, but
  downstream agents and reviewers still need to reject instructions embedded in
  design text. No arbitrary source-script execution tool is exposed by this MCP.
- Imported bundle checksums detect changed contents, not authorship, ownership,
  licensing or freshness. Import creates a new workspace without approvals.
  A public URL or valid PNG does not grant redistribution rights.
- Source confirmation is a choice of references; semantic approval is a separate
  decision. Geometry, positive opacity and current node PNGs do not prove visible
  contribution, old/new design identity or behavioral requirements.
- SECTION capture is metadata-only. Rotated/reflected/skewed root image mappings
  are unsupported. Current node exports are transient and separately timed;
  descendants, paints and external ancestor changes are not fully fingerprinted.
- One plugin session is active. Cached observations can be stale; null file
  identities remain unavailable for verified navigation. Automatic reconciliation
  and source repair are not implemented.
- Project JSON plus history is capped at 48 MB and history at 20 states; browser
  project reads are not a streaming database. Oversized exact source records may
  require a smaller scope rather than silent truncation.
- Source PNGs, exact text, copies, credentials and internal specifications stay
  outside Git and public CI. The repository uses generated public test fixtures.
  No corporate design transfer to an external model is assumed or authorized here.

## Release checklist

Prepared artifacts and procedures:

- [x] [Install/manual/MCP/optional-AI guide](product-quickstart.md),
  [Desktop acceptance procedure](desktop-verification.md), and compatibility limits above.
- [x] [Runtime ADR](adr/0001-local-product-runtime.md),
  [rendering/review ADR](adr/0002-rendering-evidence-grounding.md),
  [capture-transfer ADR](adr/0003-portable-capture-bundles.md), schemas and migration boundaries.
- [x] Runtime/security boundary summary and source-data handling limits above;
  this preparation does not replace a release security review.
- [x] Reproducible check commands and CI configuration. On the exact proposed
  release commit run `npm ci`, `npm run check`, `npm run fixtures:validate`, and
  `npm run test:e2e` with an available Chromium browser. Record that commit and
  results; previous runs are not certification of a later artifact.
- [x] Current scope and known limitations documented; independent semantic-label
  rubric and [remaining acceptance work](completion-status.md) are separated from
  generated tests and remote fixture creation.

Installed alpha preparation:

- [x] App/DMG/application ZIP, official bundled Node 22.23.4, prebuilt plugin,
  offline instructions, checksums and dependency notices are generated.
- [x] Installed startup, pairing, native file dialogs, Figma import/capture,
  bundled MCP, conflict rejection, explicit migration and restart preservation
  were exercised. Current public source targets passed private-identifier scanning.
- [x] ad-hoc signing, absent Developer ID/notarization, local plugin distribution
  and unverified macOS 13/Dev-only boundaries are documented accurately.

Remaining publication steps:

- [ ] Repository owner chooses LICENSE and includes it in the public release.
- [ ] After license inclusion, fix the final posting commit, tag and actual public
  download links. The bundled verification JSON records clean-commit source
  revision and inspected asset SHA values; do not pre-fill future results here.

For the final candidate, run the complete `npm run package:macos` on a clean
commit, then `npm run release:verify -- --require-clean`. This rejects dirty or
mismatched provenance. A prior successful candidate is not the final artifact.

The current package is version `0.1.0`; npm's private flag does not mean the macOS
application is unimplemented. Company installation/data/egress approval,
Dev-only can-view acceptance if advertised, and independent F4/F5 evaluation remain
separate deployment/claim requirements. This alpha has no Developer ID notarization
or Community listing; these declared limits are not silently treated as completed.
Future schema migrations, other-platform installers and cloud deployment remain
separate scope decisions.
