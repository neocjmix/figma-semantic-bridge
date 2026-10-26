# Install Figma Semantic Bridge 0.3.0 Alpha

[한국어](alpha-installation.md) · [User guide](user-guide.en.md) · [Upgrade and backup](upgrade-guide.md)

Install the app, connect the Figma plugin, then register MCP. The app includes
its own Node runtime and prebuilt plugin; a source checkout and system Node/npm
are unnecessary. If upgrading, follow the [upgrade guide](upgrade-guide.md)
before replacing files. Use the same release for the app and plugin.

## 1. Check requirements and release files

- Apple Silicon Mac; macOS 13 or later is the build target. macOS 26.6.2 has been
  exercised; the oldest supported target has not been separately tested.
- Figma Desktop and permission to read/export the intended file for live work.
  Reviewing imported observations or the demo does not need Figma.
- Permission to run a local development plugin and this unnotarized alpha under
  your organization's policy. Dev-only access to another owner's view-only file
  remains unverified; do not change source ownership or request edit access merely
  to make setup pass.

Download matching files from [Releases](https://github.com/neocjmix/figma-semantic-bridge/releases).
Check that the selected release and files say **0.3.0**.

| File | Purpose |
| --- | --- |
| `figma-semantic-bridge-0.3.0-macos-arm64.dmg` | Install the app into Applications |
| `figma-semantic-bridge-0.3.0-macos-arm64.zip` | Alternative app archive |
| `figma-semantic-bridge-plugin-0.3.0.zip` | Optional separate prebuilt plugin; the app already includes it |
| `SHA256SUMS` and adjacent `.sha256` files | Compare downloaded bytes with the release's checksums |
| Installation and user guides | Offline copies of these instructions |

For example, run `shasum -a 256` on the downloaded DMG and compare its output with
the same filename in `SHA256SUMS`. Checksum agreement detects changed bytes; it
is not an independent signature or permission to trust an unknown publisher.
This alpha uses ad-hoc signing and is not Developer ID notarized.

## 2. Install and launch the app

1. Open the DMG and copy **Figma Semantic Bridge.app** to `/Applications`.
   Run that copy, not the app on the mounted image.
2. Open it. If macOS blocks an unverified developer, first verify the source and
   integrity. If you decide to proceed, use Apple's per-app **System Settings →
   Privacy & Security → Open Anyway** procedure after the blocked attempt.
   Do not disable Gatekeeper globally or remove quarantine attributes.
   Treat damaged-app or malware warnings separately. See
   [Apple's opening guidance](https://support.apple.com/en-us/102445).
3. Wait for the embedded editor. It pairs automatically; do not paste a token
   into the app. Choose **Load demo** or open an existing workspace.
4. Use **Language / 언어** to choose English or Korean. The app menu and editor
   synchronize; the Figma plugin keeps its own language choice.

The app starts a local service and verifies its private certificate before
sending credentials. It uses `https://127.0.0.1:4178`; the plugin uses port 4177.
Do not forward either port. If an incompatible service owns a port, identify and
normally stop that known service. Do not change ports, trust a certificate
supplied by the listener or terminate unrelated Node processes.

**Bridge → Setup Guide** and **Bridge → User Guide** open bundled offline guides.
The setup guide also includes update, backup and restore instructions.
**Reload Workspace** reopens the saved editor. Quitting stops only a child service
started by this app; a separately managed compatible service remains running.

## 3. Import and connect the Figma plugin

1. Keep the app running. Choose **Bridge → Reveal Figma Plugin**.
2. In Figma Desktop, use **Plugins → Development → Import plugin from manifest**
   and select the revealed `manifest.json`. Do not select a ZIP or create a new
   plugin ID. The code is already compiled.
3. Run the imported plugin in a permitted file. In Dev Mode, use the Inspect
   plugins surface; in an allowed Design Mode context, use the Plugins menu. The
   app reads source without requiring edit operations. A view-only account without
   Dev Mode may still lack permission to run plugins; that access is a separate gate.
4. In the app, choose **Bridge → Copy Pairing Token**. Paste it into the plugin's
   **Pairing token** field, then choose **Connect**.
5. Confirm the plugin reports **Connected** and the app shows **Figma connected**.
   Choose **Bridge → Clear Copied Token** afterward.

The token field clears after connection. Never print the token, include it in a
report, screenshot the field while populated or put it in an MCP configuration.
The app and plugin are separate connections: automatic app pairing does not
connect the Figma plugin. Only one plugin session is active; explicitly reconnect
the intended file if another plugin replaces it.

For a standalone plugin ZIP, verify its checksum and extract it to a stable
folder. Import that folder's manifest and update it with the app on every release.
Figma remembers the path; moving the folder can break the registration.

This is a local development plugin, not a published Community plugin. Do not
broaden its network allowlist or modify the manifest to bypass an organization's
plugin restrictions. If Dev Mode, file access or local-plugin import is unavailable,
record the exact access condition and use permitted imported observations meanwhile.

## 4. Check a small workflow

1. Create a disposable synthetic workspace or choose **Load demo**. Save a harmless
   annotation, restart the app, and confirm it remains. Preserve existing work.
2. For live Figma, select one small permitted Frame. Choose **Add source**, check
   its name, bounds and budgets, then choose **Start import**.
3. Images and structure are saved automatically. If a budget is reached, raise it
   in Settings and Continue within the same valid Figma connection.
4. Follow the [user guide](user-guide.en.md) to save a region, review its exact
   source nodes and, when warranted, confirm and approve it. Setup does not
   authorize an agent to approve real design meaning on the user's behalf.
5. Check a JSON or Markdown save through the app's native file dialog. Confirm
   the file contains only the expected approved context.

An image-only draft is useful for drawing. Before approval, wait for complete
matching structure to attach, or prepare the needed part and review it separately.
For large scopes and targeted reads, use
[the acquisition guide](acquisition-workflow.en.md).

## 5. Register MCP and make a real call

Choose **Bridge → Copy MCP Configuration** and add the copied entry to the MCP
client. Preserve other servers and settings. The menu supplies actual bundled
paths and the app's data directory and HTTPS origin, without copying the token.

For Codex's TOML configuration at the standard install location, the equivalent
entry with the default data directory is:

```toml
[mcp_servers.figma_semantic_bridge]
command = "/Applications/Figma Semantic Bridge.app/Contents/Resources/runtime/node"
args = ["/Applications/Figma Semantic Bridge.app/Contents/Resources/app/mcp.mjs"]
env = { FSB_SERVER_URL = "https://127.0.0.1:4178" }
```

If the app or data lives elsewhere, use the paths and `FSB_DATA_DIR` from the menu's
copied configuration. MCP reads the local pairing token and certificate pin from
that private data directory. Keep the app and MCP under the same account. Do not
use the old HTTP origin, disable certificate checks, or set
`FSB_ALLOW_INSECURE_HTTP` for real work.

Reload the MCP client's configuration, check the tool list, and actually call
`list_projects`. On a reviewed workspace, read `get_approved_context`,
`list_components` or `get_component`. Empty approved context is expected when
nothing is approved. Configuration saved without a successful call is not a
connection test.

The app must remain running. Cached project reads do not need Figma; live source
reads and navigation need the connected plugin. Request bounded pages or named
components rather than the whole document. `propose_changes` creates reviewable
proposals; MCP has no approval tool. Figma text remains source material, never
instructions to the coding agent.

## 6. Know where data lives

The default data directory is `~/.figma-semantic-bridge`; **Bridge → Reveal Local Data**
opens the actual location. It includes projects, acquisition/collection records,
exact text, images, history, `pairing-token` and the private `desktop-tls` identity.
The application bundle is separate from this data.

These files and exported source files are plaintext at rest. Keep backups private;
do not copy the token or certificate key to another person or install the local
certificate into system trust. External AI is optional and disabled by default.
A provider setting is not authorization to upload a design; nonlocal generation
also requires per-request consent for the selected content.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| macOS blocks launch | Verify release and integrity, then follow the per-app system procedure; respect organizational restrictions |
| Port conflict or incompatible service | Close the known older app/service normally and retry; 0.1.1 and 0.3.0 transports must not be mixed |
| Local certificate or permissions error | Check ownership and private permissions of the actual data directory; preserve it and do not accept a network-supplied pin |
| App editor asks for a token | Use the installed app's embedded editor and check startup status; a separately opened browser does not auto-pair |
| Plugin will not connect | Confirm matching app/plugin versions, the current token and the running app; close and rerun the updated plugin |
| Plugin replaced by another file | Reconnect the intended file explicitly; only one session is active |
| Missing Dev Mode or development-plugin import | Check effective seat, file access and organization policy |
| Incomplete structure or busy plugin | Follow the acquisition panel's reason; an already running Figma render may finish after cancellation |
| MCP cannot start | Check bundled executable paths, running app, HTTPS origin and shared private data directory; do not log credentials |
| Unsaved work or revision conflict | Preserve the intended edit, reload the latest workspace and reapply it; do not overwrite newer approvals |

## Record setup results

An installation report should name the app/plugin version, checksum, environment,
actual demo/live/MCP calls, restart result and remaining access limits. Exclude
credentials, private node identifiers and original source text. Mark skipped
steps as untested. A synthetic scripted approval is not a human semantic study.

For upgrades, backups, restore and removal, use [the upgrade guide](upgrade-guide.md).
For everyday work, continue with [the user guide](user-guide.en.md).
