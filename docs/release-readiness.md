# Release readiness

Current source: **0.4.0 alpha**. The guided workflow and private local
diagnostics are implemented; [candidate QA](evaluation/guided-workflow-qa.md)
records 495 source tests and 64 passing browser cases after the coordinate-entry
fix. The native candidate completed owned synthetic Dev Mode import, region/source
review, cross-source specifications, actual Save dialogs and local diagnostic checks.
The second candidate package passed its verifier before the final release-note
update. Native precision-input, horizontal/vertical split, Undo and restart checks
passed without errors; the original approved region/specification was restored.
Final ZIP, mounted DMG, plugin, licenses, signatures and hashes are identified by
the verification JSON attached to the release. Earlier candidate checks do not
identify changed final bytes.

The offline app and plugin documentation now includes the Korean/English
troubleshooting scenarios and local diagnostics. The offline user HTML contains
the current language's acquisition, troubleshooting and diagnostic instructions;
the release verifier compares their bytes and rendering with the packaged source.

Current setup and workflow instructions are in
[the installation guide](alpha-installation.en.md), [user guide](user-guide.en.md)
and [diagnostic guide](local-diagnostics.md). The
[0.3.0 recovery acceptance record](evaluation/release-0.3.0-acceptance.md) and
[0.2.0 verification record](evaluation/release-0.2.0-acceptance.md) retain their
historical evidence. Final release provenance comes from the verification JSON
attached to the clean-commit package.

## Historical 0.2.0 release boundary

The app and plugin must be updated together; MCP uses the bundled runtime and
pinned HTTPS origin. The [upgrade guide](upgrade-guide.md) covers backup, path
preservation, matched plugin replacement and recovery. Current source includes
the authentication/encryption and capture-input fixes tracked in #11–#13.
Versioned 0.1.1 assets remain unchanged and carry their original limitations.

For every release, run the full source gates, rebuild a clean commit and verify
ZIP, mounted DMG, plugin, source revision, hashes, bundled licenses and signing
state. Do not reuse a previous package report for different bytes. This alpha
uses ad-hoc signing without Apple notarization. Organization approval, Dev-only
can-view access, native production-scale memory and independent human evaluations
remain separate adoption/claim gates. Historical tables below describe their
stated older versions rather than superseding this current summary.

## Observed compatibility — published 0.1.1 baseline

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
host in its manifest. The intended distribution is individual installation from
the local manifest, not a Figma Community listing. The manifest's development-only
localhost access and private file-key API fit that path; Community publication is
not a prerequisite for this alpha. Organization policy can still prohibit local
plugin imports, and another owner's can-view file with a Dev-only seat remains an
unverified permission combination.

The native performance record contains 30 measured captures (five restarted
plugin-session-cold and five warm per size) plus three excluded warmups, all
complete. Native pending cancellation, window close, controlled 50ms timeout,
recovery and two-file replacement were observed. These are bounded experiments,
not OS-cold, native-preemption or peak-memory guarantees. The analyzer's corrected
Desktop UI relay also delivered four complete selected-scope reports, including
all three cached Community scopes; see the [native analyzer aggregate](evaluation/native-fixture-analyzer.json).
Installed-app evidence is additionally recorded in the
[alpha acceptance aggregate](evaluation/alpha-desktop-acceptance.json). The latest
0.1.1 candidate check passed 198 Node tests, TypeScript and builds; 27 browser
tests passed. See the [0.1.1 acceptance record](evaluation/release-0.1.1-acceptance.json)
for the tested package and its limits.
Final artifact identity and clean-commit verification are separate from these
executed results. The remaining broader
[acceptance dependencies](completion-status.md#external-dependencies) are the
Dev-only account/file combination, representative sampling and independent human
evaluation, productivity participants, and policy/license/release decisions.

## Runtime and security boundaries

The table and pre-publication findings below describe **published 0.1.1**.
Subsequent source changes add native/MCP certificate pinning, encrypted plugin
messages and capture-input preflight bounds. They require their own complete
verification and a new release; issue closure does not update installed binaries.
See [candidate upgrade notes](upgrade-guide.md).

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

The local-only distribution narrows exposure to this Mac; it does not authenticate
whichever process holds port 4177. The pre-publication source review found that
both the desktop startup probe and the paired plugin can disclose the pairing
token to an impersonating local listener, and the plugin can then return selected
Figma content to that listener. No remote website-only exploit or live takeover
was demonstrated. The installed Zod 3.25.76 also has an advisory affecting
malformed collection validation; the app's bundle-import path gives this a
local, user-mediated availability impact. These findings need remediation and
fresh verification before use with sensitive work data. The public alpha is for
owned synthetic and non-sensitive evaluation only. Track the desktop listener
in [#11](https://github.com/neocjmix/figma-semantic-bridge/issues/11), the
plugin bridge peer in [#12](https://github.com/neocjmix/figma-semantic-bridge/issues/12),
and capture validation in [#13](https://github.com/neocjmix/figma-semantic-bridge/issues/13).

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

The tracked public-candidate registry contains links, license observations and
aggregate results, not redistributed design files or screenshots. A permitted
real-file copy is acquired only for a manual test and retained under the ignored
`.fixture-local/` directory; see [fixture handling](../fixtures/README.md).
The owner approved public disclosure of the tracked synthetic Figma URL and
file key for this release. MIT covers project-owned code
and docs through the new LICENSE; it does not relicense external
Figma files or replace bundled third-party notices.

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

Publication record and remaining fixes:

- [x] Add MIT to source and package metadata; the packaging scripts include the
  LICENSE and preserve third-party notices.
- [x] Include the exact MIT text in the final app and plugin archives; inspect
  both packages through `npm run release:verify -- --require-clean`.
- [x] Open public issues [#11](https://github.com/neocjmix/figma-semantic-bridge/issues/11),
  [#12](https://github.com/neocjmix/figma-semantic-bridge/issues/12) and
  [#13](https://github.com/neocjmix/figma-semantic-bridge/issues/13), link them in
  release warnings and limit this alpha to non-sensitive evaluation.
- [x] Record the owner's decision to disclose the tracked synthetic Figma URL.
- [x] Publish tag [`v0.1.1-alpha`](https://github.com/neocjmix/figma-semantic-bridge/releases/tag/v0.1.1-alpha)
  and its actual download assets. The attached verification JSON records the clean
  source revision and inspected asset SHA values.
- [x] Fix the source paths reported in #11–#13 with pinned native/MCP TLS,
  mutually authenticated encrypted plugin records, early collection bounds and
  the compatible Zod upgrade. Focused regressions and independent bypass review
  are recorded in the [current validation log](product-validation.md).
- The fixes are included in 0.2.0. Its clean-commit package verification is
  recorded with that release. Existing 0.1.1 download assets remain affected;
  closing a source-fix issue does not update an installed application.

For the final candidate, run the complete `npm run package:macos` on a clean
commit, then `npm run release:verify -- --require-clean`. This rejects dirty or
mismatched provenance. A prior successful candidate is not the final artifact.

The historical baseline is `0.1.1`; the current source version is `0.3.0`. npm's
private flag does not mean the macOS application is unimplemented. Company installation/data/egress approval,
Dev-only can-view acceptance if advertised, and independent F4/F5 evaluation remain
separate deployment/claim requirements. This alpha has no Developer ID notarization
or Community listing; these declared limits are not silently treated as completed.
Future schema migrations, other-platform installers and cloud deployment remain
separate scope decisions.
