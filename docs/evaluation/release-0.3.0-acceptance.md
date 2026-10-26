# 0.3.0 Alpha recovery acceptance

This record separates source tests, real Figma observations and release artifacts.
The release verifier attached to the final package is authoritative for its clean
source revision, exact bytes, dependency notices and signing state.

## Implemented contract

- Saved partial metadata and exact text remain queryable after restart.
- Closed saved subtrees have independent review coverage; their enclosing request
  remains incomplete. Source confirmation and human approval remain explicit.
- Known hidden/transparent ancestors, source parents, coordinates, exact text and
  observation times are preserved. Out-of-coverage regions cannot be confirmed or approved.
- Same-session continuation uses the reading position. Reconnection starts a new
  confirmed recheck of the pinned identity, with compact replies for identical packets.
- A known unfinished container can be acquired independently without reading its
  unrelated siblings or rerendering the image. Releasing a paused position requires confirmation.
- Existing observations, proposed regions and approvals are not overwritten by recovery.
- One source-file flow and task-oriented MCP discovery retain legacy-call/file compatibility.

## Executed source and browser checks

- Full TypeScript, Node regression and production build gates passed: 484 tests,
  including the final localization regression.
- All 51 browser cases passed in the final full run after the final UI wording
  changes. An earlier first attempt raced a production web rebuild and returned
  WEB_NOT_BUILT; the completed-build rerun passed.
- The Linux CI run exposed a compatibility-test setup race: an explicit API
  scope creation ran alongside automatic UI binding. Setup now completes before
  opening the editor, retaining the exact single-scope assertion. The six affected
  browser cases and typecheck passed after this test-only correction.
- Two public synthetic fixture manifests passed validation.
- Focused source-file integrity checks cover altered packet/tree structure,
  incomplete files, missing context-image bounds, hostile coverage and negative
  coordinate rounding. The plugin replay test executes the real built main code
  without browser-only text/crypto globals.

## Executed installed-candidate checks

On 2026-10-27, the 0.3.0 packaged macOS app and its installed local plugin read an
owned synthetic Figma frame in Dev Mode. No source design property was changed.

1. The settings screen limited the first import to four nodes. A 1,600 × 1,200
   image was retained and the partial records remained browsable.
2. The user-facing cost confirmation released the saved position and prepared
   only a known two-node unfinished container. Its independent review scope kept
   the original image and document coordinates; the whole request stayed incomplete.
3. After quitting and reopening the app, Continue explained the recheck cost.
   The new observation completed all 21 nodes, revalidated the four saved nodes
   and reused one identical packet through a compact response. Only one overview
   image observation was used across the tasks.
4. All 16 pre-existing project files, pairing credentials and pinned certificate
   were byte-for-byte unchanged. Original import settings were restored.
5. Both Korean and English native interface and offline user guides opened.
   The original Korean language setting was restored.
6. The bundled MCP runtime ran outside the checkout, advertised 13 tools including
   the four acquisition task tools, and read approved context without secret output.

This is bounded native recovery evidence, not the original production-file or a
human semantic-quality study. Final UI wording and guide corrections are included
in the subsequent clean release build. Exact publication, app/plugin byte identity,
mounted DMG, licenses and clean source provenance are established by the verification
JSON attached to the release, not by this pre-publication source record.

The [feasibility experiment](recovery-feasibility.md) measures synthetic getter
counts and packet size; it is not native Figma throughput or renderer memory.

## External boundaries

The original production file and native memory measurements remain
[#2](https://github.com/neocjmix/figma-semantic-bridge/issues/2).
Independent provider/human evaluation remains
[#6](https://github.com/neocjmix/figma-semantic-bridge/issues/6).
Another owner's effective Dev-only view permissions and organization approval remain
[#7](https://github.com/neocjmix/figma-semantic-bridge/issues/7).
Multiple plugin reads do not establish one immutable Figma revision. A retained
image is a historical observation; compact packet reuse still requires fresh Figma reads.
