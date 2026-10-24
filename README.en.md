# Figma Semantic Bridge 0.1.1 Alpha

[한국어](README.md) · [User guide — English](docs/user-guide.en.md) · [사용자 가이드 — 한국어](docs/user-guide.ko.md)

**A local app for people to annotate the meaning and requirements of Figma screens,
then share approved context with coding agents.**

The Apple Silicon (M1 or later) app targets macOS 13 or later and includes official
Node.js 22.23.4, the production local server, web editor, MCP server and a prebuilt
Figma plugin. Users do not need Node.js, npm, a source checkout or a separate
development server. The actual 0.1.1 local update and execution were exercised on macOS 26.6.2;
execution on macOS 13 has not been verified.

**0.1.1 bilingual alpha candidate package and local update verified; public release
pending.** Publication awaits the owner's license choice and final publication artifacts.
Public download URLs are planned and are not available yet.

[Detailed installation and setup](docs/alpha-installation.en.md)
· [한국어 설치 가이드](docs/alpha-installation.md)
· [Release notes](docs/releases/0.1.1.md)
· [0.1.1 update acceptance aggregate](docs/evaluation/release-0.1.1-acceptance.json)

## What the app does

1. Capture an image and source-node observations from a selected, bounded Figma Frame.
2. Mark meaningful regions and define their names and semantic hierarchy.
3. Connect exact Figma nodes and original specification text. Inspect ambiguous or
   overlapping sources in Figma and compare individual node images when needed.
4. Review and approve the meaning, requirements and provenance, then export
   JSON/Markdown or provide the approved context to coding agents through MCP.

The app does not edit the source Figma design or generate finished application
code. Geometry does not determine semantic correctness. AI proposals cannot
overwrite human approvals.

## Interface language

Choose **English** or **한국어** with **Language / 언어** at the top right.
The browser remembers an explicit choice; its initial default follows `navigator`
language, and unavailable storage falls back to the current session. The macOS app
initially uses the OS's first preferred language and synchronizes its native menu
with the embedded editor. The Figma plugin saves its own independent choice.

**Language changes only interface text. Project names, human annotations, Figma
node names, original text, specifications and approved content are never translated
or changed by the language switch.** Follow the [English](docs/user-guide.en.md) or
[Korean](docs/user-guide.ko.md) user guide for the complete review workflow.

The 0.1.1 installed-candidate checks covered language persistence, live switching,
all four offline guides and preservation of existing data. See the
[0.1.1 acceptance record](docs/evaluation/release-0.1.1-acceptance.json)
for the actual observations and limitations.

## Installation files

| File | Purpose |
| --- | --- |
| `figma-semantic-bridge-0.1.1-macos-arm64.dmg` | Installation image for copying the app to Applications |
| `figma-semantic-bridge-0.1.1-macos-arm64.zip` | ZIP distribution of the same app |
| `figma-semantic-bridge-plugin-0.1.1.zip` | Prebuilt plugin for local import into Figma Desktop |
| `figma-semantic-bridge-0.1.1-INSTALLATION.md` | Offline installation guide for users and agents |
| `figma-semantic-bridge-0.1.1-INSTALLATION.en.md` | English installation and MCP setup guide |
| `figma-semantic-bridge-0.1.1-USER-GUIDE.ko.md` / `figma-semantic-bridge-0.1.1-USER-GUIDE.en.md` | Korean and English workflow guides |
| `SHA256SUMS` | SHA-256 values for the downloaded artifacts |
| `figma-semantic-bridge-0.1.1-release.json` | Version, platform, runtime and signing metadata |

GitHub's automatically generated **Source code** archive is not the end-user
installer. Intel Mac, Windows and Linux desktop apps are outside this alpha.

The app is ad-hoc signed and **has no Apple Developer ID distribution signature or
notarization**. macOS or organizational policy may prevent execution. Installation
agents must not disable Gatekeeper or remove quarantine attributes. A person must
perform any required OS confirmation; stop if organizational policy prohibits use.

## First use

If 0.1.0 is already installed, skip repeated first-time setup and follow the
[0.1.0 → 0.1.1 update procedure](docs/alpha-installation.en.md#9-backup-update-and-restore).
Keep the existing application directory in place, quit normally before replacing
its contents, and preserve projects, the token, language choices and Figma's plugin path.

1. Once published, obtain the release artifacts and `SHA256SUMS`, then verify their
   checksums. A supplied local candidate can be checked before publication, but it
   is not a public download.
2. Open the DMG, copy `Figma Semantic Bridge.app` to `/Applications`, and launch it.
   Its embedded editor pairs automatically; no separate browser token entry is needed.
3. Use **Load demo** to check the editor, saving and restart without a Figma account.
4. Choose **Reveal Figma Plugin**, or extract the plugin ZIP to a stable location.
   In Figma Desktop, use **Plugins → Development → Import plugin from manifest**
   and select that folder's `manifest.json`.
5. Use the app's **Copy Pairing Token**, paste it into the plugin's **Pairing token**
   field, then choose **Connect**. Treat the token as a password; never put it in
   chat, logs or URLs.
6. Select a small Frame in a Figma file you may use, then choose
   **Capture Figma selection** in the app.
7. Draw and save a region, inspect its source candidates, add exact nodes as needed,
   and save again. **Confirm sources** records a person's review of the source set.
   **Approve annotation** is the separate review of its meaning and structure.
8. Connect exact specification text and reviewed relations, then export approved
   context or connect a coding agent through MCP below.

The [user guide](docs/user-guide.en.md) covers ambiguity, distant layer branches,
old or hidden variants, stale captures and offline review. The
[installation guide](docs/alpha-installation.en.md) covers Figma menu differences,
existing-service conflicts, import/export, backups, updates and removal.

**Plugin distribution:** this alpha uses local Figma Desktop development import.
Users do not compile the plugin. Its source-file identity implementation depends
on Figma private-plugin APIs; it is not presented as a published Community plugin.
Organizational internal distribution requires separate registration and permission checks.

## Ask an AI agent to install it

Provide this request together with the repository or eventual release link:

> Install Figma Semantic Bridge 0.1.1 Alpha and prepare it for use. Read README.en.md
> and docs/alpha-installation.en.md first. Inspect my OS/CPU, existing installation,
> data and port 4177 use. Verify the release artifact checksums, then install the app
> and prebuilt Figma plugin. Preserve projects and existing MCP configuration, and
> never print pairing tokens. Actually check demo save/restart, a read-only capture
> of a permitted Figma Frame, JSON export/capture import, and MCP project listing
> and approved-context reads. Do not send company designs to external AI or approve
> meaning or sources for me. Ask me only for required OS confirmation, login or file
> access. Record successful steps, real blockers, data location and how to restart.

Copying files alone is not installation acceptance. Run the guide's checklist and
leave unverified steps marked as unverified.

## MCP connection

Keep the app running and register this command and argument in your MCP client.
No system Node installation or token copied into the configuration is required.

```json
{
  "mcpServers": {
    "figma-semantic-bridge": {
      "command": "/Applications/Figma Semantic Bridge.app/Contents/Resources/runtime/node",
      "args": ["/Applications/Figma Semantic Bridge.app/Contents/Resources/app/mcp.mjs"]
    }
  }
}
```

This JSON is an example for clients using that format. The
[installation guide](docs/alpha-installation.en.md) includes Codex TOML, preserving
existing configuration and checking actual tool calls. The MCP server reads the
token from the default data directory. Start with `list_projects` and
`get_approved_context`; an empty context before approval can be expected.

## Data and alpha boundaries

- Projects, images, original text and review history are stored in
  `~/.figma-semantic-bridge`. Replacing the app does not delete that folder.
  Backups include sensitive source content and the token; protect them locally.
- The authenticated service binds only to `127.0.0.1:4177`. Do not expose it to
  the network or place it behind a public proxy.
- Capture is bounded by the selected scope. It does not require whole-file JSON
  dumps or full-page preloading. Reviewing imported captures requires neither
  Figma nor Dev Mode.
- SECTION captures are metadata-only. Use an unrotated inner Frame for an image.
  Overlap, nonzero opacity or a single-node export cannot establish the latest
  variant or actual pixel contribution.
- Another owner's view-only file with a Dev-only account remains an unverified
  access combination. Success on owned test files does not establish that permission case.
- Independent user accuracy/productivity studies, company policy approval,
  Apple notarization and Figma Community publication are not claimed complete.
  The packaged app keeps external AI generation disabled by default.

[Validation record](docs/product-validation.md)
· [Completion status and external dependencies](docs/completion-status.md)
· [Release boundaries and security notes](docs/release-readiness.md)

## Observed 0.1.1 candidate behavior

**198 Node tests, TypeScript and production builds, 27 browser scenarios, two fixture
manifests and native policy/locale self-tests passed.** Checks exercised the extracted
app ZIP, mounted DMG, plugin ZIP, version agreement and offline guide contents.

The update preserved application/plugin directory identity, 15 existing project
files and the token. Native observations confirmed automatic pairing, retained Korean
preferences, mixed-language unsaved input during switching, four offline guides and
reuse of the existing Figma manifest registration. The plugin retained its connected
session while changing language. The installed bundled MCP read an actual selected
node; the original Figma source remained unchanged.
The previous 0.1.0 saved synthetic capture with 21 nodes also opened read-only,
with its project file unchanged.

The [0.1.1 record](docs/evaluation/release-0.1.1-acceptance.json) describes the candidate
installed before the final documentation commit. The separately generated
`figma-semantic-bridge-0.1.1-verification.json` binds the final clean revision to the
rebuilt artifacts' hashes. These native observations are not reassigned to a newly
generated package.

## Previous 0.1.0 installed-app observations

The installed `/Applications/Figma Semantic Bridge.app` used its bundled Node to
exercise embedded-editor pairing, synthetic annotation save, native JSON/Markdown
save dialogs and a two-capture bundle export/import. Its bundled plugin manifest
was imported into Figma; an owned synthetic file in Dev Mode produced 21 nodes and
an 800×600 PNG. The installed MCP bundle served `list_projects` and
`get_approved_context`.

An incompatible existing development service was rejected. Only the explicitly
identified test service was stopped and backed up during migration; six existing
projects were preserved. Quitting removed the app-owned port-4177 listener, and
restart preserved the token, projects and saved annotation. These are installed-app
observations, not independent semantic evaluations or a first-download test on
another Mac. See the validation record for the dated automated checks; final
publication revision and artifact checksums are fixed separately. These observations
remain historical; the independent 0.1.1 results appear above and in the
[0.1.1 release notes](docs/releases/0.1.1.md).

## Develop and package from source

This section is for source contributors. End users do not need these commands.
Development requires Node.js 22 or later. macOS app packaging requires an Apple
Silicon Mac and already installed and authorized Command Line Tools.

```sh
npm ci
npm run check
npm run fixtures:validate
npm run test:e2e
npm run package:plugin
npm run package:macos
npm run release:verify
```

For a final release, run the full `npm run package:macos` from a clean commit,
then `npm run release:verify -- --require-clean`. Check that the verification
report links the source revision to the actual asset hashes. Do not use
`--skip-build` for the final candidate.

Use `npm start` for the development server and `npm run dev:web` for the UI
development server. The release app contains static production UI assets and does
not use Vite's development server. Packaging outputs go to `dist/releases/`.
Before publishing, verify the license, exact commit, signing status, package
checks and artifact hashes.

## Project documentation

- [English workflow guide](docs/user-guide.en.md) · [한국어 사용자 가이드](docs/user-guide.ko.md)
- [Installation and MCP](docs/alpha-installation.en.md) · [Developer quickstart](docs/product-quickstart.md)
- [Context](docs/context.md) · [Architecture](docs/architecture.md) · [Pipeline](docs/pipeline.md)
- [Data model](docs/data-model.md) · [Roadmap](docs/roadmap.md) · [Feasibility](docs/feasibility.md)
- [App packaging decision](docs/adr/0004-packaged-macos-alpha.md)
- [Rendering evidence and human review](docs/adr/0002-rendering-evidence-grounding.md)
- [Capture transfer](docs/adr/0003-portable-capture-bundles.md)
- [Public fixture research](docs/research/public-figma-fixtures-2026-10-23.md) · [Fixture tools](docs/fixture-plugin.md)
- [Agent working agreement](AGENTS.md)

Some reference documents remain in Korean. Workflow and installation guides are
provided in both languages. Reference links outside those guides point to source
repository documents and may not be included in standalone or plugin packages.

Never commit source designs, internal specifications or pairing tokens. The
repository's license awaits the owner's selection; public availability alone
does not grant a license. See the distribution's `THIRD-PARTY-NOTICES.md` and
original license files for bundled third-party software.
