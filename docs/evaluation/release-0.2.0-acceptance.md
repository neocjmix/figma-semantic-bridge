# 0.2.0 alpha verification record

Date: 2026-10-26. This records the user-facing documentation/interface candidate.
The final release's attached verification JSON independently binds the packaged
source commit, clean-tree status and asset hashes. Earlier versioned evaluations
retain their original counts and observations.

## Source and interface checks

- `npm run check`: 408 Node tests passed without skips, TypeScript passed, and
  fixture plugin, product plugin, web, server and MCP builds succeeded.
- Complete Chrome/Playwright suite: 49 cases passed. These use synthetic data and
  loopback servers/peers, not real Figma files. They cover save/review/approval,
  original text, cancelled/late responses, transfers and live language changes.
- Known system errors and warnings are translated independently of original
  Figma text. Translation tests retain interpolation and source text exactly.
- Four guide screenshots come from the generated demo with no live Figma or
  existing user profile. The screenshot script blocks nonlocal requests.
- Offline guides use escaped Markdown, inert reference links and explicitly
  supplied bounded PNGs. Setup HTML includes matching-language update/backup
  instructions; user HTML includes the acquisition guide. No external image
  loading or script execution is enabled.
- Current guide links and feature/limit statements were checked against the
  source schemas. Architecture/pipeline/model docs distinguish implemented
  behavior from proposed work and historical evaluations.

## Installed candidate observations

- Candidate app ZIP/DMG/plugin verification passed: mounted DMG, ad-hoc signatures,
  package/runtime version, licenses, file allowlists, guide/image hashes,
  authenticated API, persistence, capture transfer and bundled MCP.
- The compiled native policy, locale and transfer self-tests passed, including
  Unicode NDJSON above 15 MB and preservation of an existing destination on invalid input.
- The documented `rsync -a --delete` update command was run on an isolated copy
  of the installed 0.1.1 app. Signature/version checks passed and app/plugin folder
  identities were preserved. A merge-only `ditto` copy left stale sealed resources
  and failed signature verification; the upgrade guide was corrected before publication.
- The installed 0.1.1 app/data were privately backed up. App-root and registered
  plugin-directory identities were preserved during replacement with the 0.2.0
  candidate. Existing 15 project files, token and local certificate pin retained
  their exact hashes. Native and plugin Korean preferences were retained.
- The native WKWebView opened the pinned HTTPS editor automatically. The existing
  Figma development-plugin registration ran the updated bilingual plugin and
  connected in an owned synthetic Dev Mode file. Language changes between Korean
  and English preserved the live connection; Korean was restored afterward.
- The installed bundled MCP exposed 21 tools, listed the 15 existing projects,
  read the actual selected container and captured 21 nodes with an 800×600 PNG.
  The capture was complete and native selection was unchanged. A cached approved
  context call returned successfully with zero approved annotations in the new
  test workspace; no human meaning was approved by this test.
- All four native Korean/English setup/user guides opened. Both user guides
  displayed their embedded synthetic screenshots. Setup guides included the
  corresponding update/backup instructions. A native Save panel also wrote a
  valid 310-byte approved JSON export with zero annotations/specifications from
  the unapproved test workspace. No external AI was enabled.
- Existing Codex MCP configuration was backed up and updated to the installed
  bundled runtime and pinned HTTPS endpoint. Other configuration entries were
  preserved. The exact executable/arguments/environment were checked through a
  fresh MCP SDK connection; an already running client's configuration reload is
  separate from this filesystem update.

These observations describe the installed candidate. Final clean-commit rebuilds
and uploaded bytes are identified by the release's verification JSON, not by
reassigning this candidate's dirty-source provenance. Artifact checks use
`npm run release:verify -- --require-clean`.

## Acceptance boundaries

The original 105,837-node work file, native peak memory, another owner's view-only
file with an effective Dev-only account, independent semantic review and human
productivity remain separate acceptance work. Current-node images do not resolve
occlusion or identify which design version is intended. No external model request
or edit to an original Figma document is part of this release check.
