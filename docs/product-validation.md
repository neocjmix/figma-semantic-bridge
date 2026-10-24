# Product implementation and validation log

This log records executed evidence rather than changing the requirements in the
architecture, pipeline or roadmap. The branch builds an executable local product;
it is not a release certification or a claim of completed Figma Desktop acceptance.

## Delivered slices

| Slice / tracking | Implemented behavior | Executed evidence |
| --- | --- | --- |
| P0 / #1–#4 | Authenticated plugin broker, bounded capture, canvas regions, deterministic matching, semantic tree, local persistence, MCP reads | Pure-function tests, loopback HTTP/WS, stdio MCP, actual Codex, Chrome editor and live Desktop capture/navigation |
| P1 / #5 | Verbatim spec extraction across snapshots, many-to-many links, approval, undo/redo, approved export | Domain/store/API tests and browser approval/export/reload |
| P2 / #6 | Optional OpenAI-compatible multimodal draft provider, bounded selected scopes, per-request external consent, protected proposal queue | Local fake HTTP provider, malformed response tests and browser consent controls; no external inference |
| Release / #7 | Self-contained macOS AppKit/WKWebView app, bundled Node/MCP/production assets, prebuilt local plugin, install/update guide | Installed-app startup, native file dialogs, Figma capture, bundled MCP and restart preservation verified; publication awaits license choice and final artifact freeze |

The manual slice was exercised before adding the provider. AI failures do not
disable annotation, source matching, review or export. Proposed content is never
approved merely by accepting a draft. Runtime validation rejects dangling sources,
cycles, invalid geometry and non-verbatim specifications. Approved ancestors and
approved spec targets determine what MCP consumers can see.

## Reproduce automated checks

```sh
npm ci
npm run check
npm run fixtures:validate
npm run test:e2e
npm run benchmark:product
npm run benchmark:local-pipeline
```

`check` runs TypeScript, all Node tests, both plugin builds, the React build and
server/MCP bundles. The browser suite needs Chromium (`npx playwright install
chromium` if unavailable); it uses `/usr/bin/chromium` when installed. Tests use
temporary directories, self-generated designs and local mock providers only.
CI first discovers an installed Google Chrome/Chromium executable and supplies
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; otherwise it installs Playwright Chromium
under a five-minute step limit. The initial hosted run passed code checks but
stalled in OS/browser dependency installation, so using the runner's existing
browser avoids making package-mirror availability a mandatory test dependency.

Latest full check on **2026-10-24: 196 Node tests passed, TypeScript passed, and
both plugins/web/server/MCP builds passed**. **27 browser tests passed** using the
installed Chrome in an isolated headless profile. Three rendering-review browser
cases cover manual hidden/transparent selection, new versus legacy unknown
evidence, and legacy pending hidden references without a stored rendering flag.
The four capture-transfer browser cases cover
capture transfer while disconnected, rejection before persistence, unsaved-work
protection and pending-request locks. The two fixture manifests also passed
schema/provenance validation in this final run. No standalone lint command is
configured; TypeScript, build and diff checks passed. Separately, normal Chrome was used for the demo,
live-capture and real capture-transfer workflows below. Hosted CI results belong
to the PR; this log records local runs.

The bilingual interface adds four browser cases for preference persistence,
unsaved annotation preservation, unchanged enum wire values, native language
messages and unavailable browser storage. Native installed-app checks separately
confirmed both menu/editor directions, mixed-language draft input, all four offline
guides, and an English choice surviving restart on a Korean system. The installed
Figma plugin retained its English choice after reopening; switching a connected
plugin back to Korean kept the same live session. The bundled MCP read the actual
selection, and all 15 pre-update project files plus the token remained unchanged.
See the sanitized [bilingual acceptance record](evaluation/bilingual-interface-acceptance.json).
The final clean commit and asset hashes are recorded separately by `release:verify`.

Covered cases include disconnect/reconnect/replacement/cancellation, exact and
aggregate matching, equal/overlapping BBoxes and tolerance boundaries, coordinate
round trips, source-file identity, hierarchy integrity, many-to-many specifications,
atomic persistence, stale revisions, approval invalidation/protection, oversized
messages/previews, bounded extraction and provider schema/reference failures.
MCP tests spawn the actual stdio adapter and talk through the actual HTTP server
to a synthetic WebSocket plugin emulator. That emulator is not Figma Desktop.
New cancellation regressions verify MCP-to-HTTP cancellation and HTTP-close
cancellation for selection/highlight requests, cancellation before capture dispatch
while the project is being read, pending-request cleanup, rejection of late replies
and successful subsequent requests. These are SDK/loopback tests
with synthetic WebSocket responses. Native Desktop cancellation and recovery were
subsequently exercised in the autonomous acceptance run below.

Additional adapter regressions cover negative nested coordinates, half-scale
exports, fractional bounds with rounded image dimensions, reflected/skewed roots,
and masks/clipping with hidden ancestry. They verify preserved source geometry,
coordinate conversion and explicit preview warnings using synthetic PNG headers.
Those tests do not verify rendered pixels; the later native pixel checks below do.

## Installed macOS 0.1.0 alpha, 2026-10-24

The application was installed in `/Applications` and ran with its bundled official
Node **22.23.4 arm64** and production assets. Its AppKit/WKWebView editor paired
automatically. Native GUI actions saved a synthetic annotation, exported JSON and
Markdown through native save dialogs, exported a two-capture bundle and imported
that file through the native open dialog. These are actual installed-app actions,
separate from the headless browser suite. The offline guide window also opened;
final structured-guide GUI review belongs to the final rebuilt candidate.

Figma imported the manifest from the installed app's Resources. The existing
owned synthetic scope was captured in Desktop Dev Mode: **21 complete metadata
nodes and an 800×600 PNG**, without source edits. The installed app's Node and
MCP bundle successfully called `list_projects` and `get_approved_context`.

An incompatible earlier checkout service was rejected correctly. The operator
explicitly stopped and backed up only the task-owned old LaunchAgent before
migration; the app did not terminate an unrelated listener. All six protected
existing projects retained their hashes. Cmd-Q removed the app-owned port 4177
listener. Restart restored automatic pairing, the same token and project hashes,
and the saved annotation view. No independent human approval or source mutation
is inferred from these synthetic operator actions.

The [content-free installed-app aggregate](evaluation/alpha-desktop-acceptance.json)
records this evidence. The host was macOS 26.6.2 (25G83), Apple Silicon, with
Figma Desktop 126.10.11. macOS 13 is the deployment target, not a tested oldest OS.
Developer tools were already present; the observed process used bundled Node,
but this is not a clean-machine or quarantined-download acceptance claim.

The app is ad-hoc signed, without Developer ID distribution signing or Apple
notarization. Its plugin uses local development import, not a Community listing.
These are declared alpha limits. Public release assets have not been posted;
license choice is pending. The final clean commit and artifact hashes are recorded
only after full repackaging and `release:verify -- --require-clean`; the current
Earlier 187-test/23-browser results are executed evidence, not guessed future commit checks.

## Autonomous native acceptance, 2026-10-24

The remaining agent-owned lifecycle, rendering and scale checks used a new,
self-generated test file and the existing local service/development plugin.
Existing Figma sources, the permitted Community copy and saved human approvals
were preserved. No external model was enabled. The full content-free evidence is
in [native Desktop acceptance](evaluation/native-desktop-acceptance.json), with
reproducible construction scripts in [the native lab](../fixtures/native-lab/README.md).

Actual Desktop capture of the 21-node geometry scope produced a 512×384 PNG from
an 800×600 root at a negative document origin. Eight straight-edge measurements
passed the 1px tolerance, with a maximum error of **0.2px**. Fourteen interior
color patches passed for clipping, an ellipse mask, hidden and zero-opacity
ancestry, same-parent/different-branch coverage and an excluded outside sibling.
This establishes the sampled cases; it is not a general paint or occlusion solver.
Rotated roots and SECTION roots now return metadata plus an explicit unsupported
preview warning. Section capture never guesses image offsets or retries export;
an unrotated inner Frame is the supported image path. Native checks preserved
two rotated-root nodes and three Section nodes with preview=null.

The native capture's matching analysis retained all source records, excluded two
hidden and two transparent nodes from automatic candidates, and preserved two
exact candidates with ambiguity in both coverage cases. The deterministic tie
suggestion was the covered node. Confirmation before approval is therefore
essential; geometry does not establish the visible or newer design.

Four explicit current-node exports were decoded and all 43,600 pixels matched
the expected colors/alpha. In this fixture, a covered node exported red while
the saved composite was blue; a masked target exported its full cyan rectangle;
a child of a hidden ancestor exported red; and a node with its own zero opacity
exported fully transparent. These are observations of these nodes, not general
guarantees about ancestors or masks. Normal Chrome also displayed the blue/red
comparison in the enlarged dialog without adding, confirming or approving a
reference. Close, annotation/context change and unmount now abort the outstanding
HTTP preview request; stale-response guards remain. Native export itself may
continue. Three browser regressions cover Close, annotation change and saving
while an export is pending, followed by fresh exports and preserved approved
records. Final review found that the original annotation-change test waited for
the 20-second broker timeout because the global busy state disabled navigation.
The strengthened test first failed on that disabled button; preview requests now
use their own loading/cancellation state. Starting an ordinary action cancels a
pending preview and retains the normal mutation lock. The annotation-change case
now passes in 733ms, with two-second interaction/cancellation assertions and an
eight-second total test deadline. All seven comparison cases passed; the full
23-case browser suite passed in 29.5 seconds.

### Lifecycle observations

- Actual client cancellation after broker pending observation cleared pending
  work, returned a fresh native selection and left the new test project empty.
- Closing the actual plugin during a pending capture returned PLUGIN_DISCONNECTED.
  Three earlier requests in that attempt finished before closure and are not
  counted as in-flight cancellation. Reopen/pair and a fresh 5,001-node capture
  succeeded. An earlier close between requests remains an inconclusive attempt.
- An isolated temporary loopback server with a **50ms configured capture deadline**
  returned HTTP 504 / PLUGIN_TIMEOUT after observed native dispatch. Pending work
  cleared, a subsequent native selection succeeded and the test project remained
  revision 0 with zero snapshots. The normal LaunchAgent was restored. This tests
  configured-deadline handling; it does not claim a naturally stalled 20-second
  export, preemption of native work, or direct observation of a late native reply.
- Two actual open synthetic files supplied different file identities and plugin
  sessions. The replacement session stayed active for ten seconds. The old UI
  required explicit reconnection, and a wrong-file navigation request left the
  current selection unchanged. Secure re-pairing restored the original file.

### Bounded native performance

Each size has five warm captures after one excluded warmup, and five captures
that were the first capture attempt in a newly opened plugin session. All fifteen
cold sessions are distinct. The document was already loaded: neither OS cache
nor Figma renderer coldness is claimed. All **30 measured plus 3 warmup captures**
completed with exact node counts and 600×600 PNGs. Failure count was zero for
this fixed cohort. Later recovery captures are excluded from its distribution.

| Captured nodes | First-capture median / maximum | Warm median / maximum | Node JSON bytes |
| ---: | ---: | ---: | ---: |
| 101 | 74.101 / 85.303 ms | 79.189 / 94.701 ms | 27,680 |
| 1,001 | 341.937 / 349.058 ms | 329.781 / 360.166 ms | 254,565 |
| 5,001 | 1,513.245 / 1,693.769 ms | 1,454.501 / 1,499.481 ms | 1,512,506 |

These are request-to-parsed-HTTP-response times, including local persistence and
serialization. Five-sample nearest-rank p95 equals the maximum. Limits were 6,000
nodes, 4MB node metadata, a cooperative 15 seconds and 1,024px images. Per-process
RSS was sampled about every 100ms; it is neither true peak memory nor plugin heap.
Export-only time, first-node latency and native internal allocations are not
exposed by this protocol. This closes the bounded sample experiment without
claiming universal latency targets or whole-document loading control.

### Native fixture analyzer

The existing analyzer was registered once and run through Desktop's Dev Mode
Inspect panel. Its first native run exposed an iframe relay bug: the UI ignored
results sent from Figma's top window and stayed in the analyzing state. The fix
accepts the existing parent sender or the top sender with an exact trusted Figma
origin, while rejecting unrelated sources and lookalike origins. Three bundled-UI
regressions reproduce success/error delivery and the untrusted-message boundary.
Reopening the built plugin completed the actual analysis and local JSON download.

Four explicit scopes were measured without reading a full page: the synthetic
geometry scope and three existing Bonafide scopes. All extraction/spatial passes
completed, and hidden-instance coverage was reported as included. Bonafide Login
has 270 nodes / 85 TEXT and **58 of 74 eligible Auto Layout containers**; the notes
Section has 21 nodes / 7 TEXT and **7 of 7**; the inner explanation Frame has
2 nodes / 1 TEXT and **1 of 1**. The structural and spatial results agree with
the corresponding cached analysis. The inner Frame overlaps the notes scope,
so these are 291 distinct captured nodes, not a whole-file total or 293 independent
examples. File identity was unavailable to this analyzer and remains null.
See [the aggregate report](evaluation/native-fixture-analyzer.json).

These fresh host reads close the missing Auto Layout measurement. They do not
turn the sample into a ten-screen corpus or supply independent semantic labels.
Original text, private IDs and downloaded reports stay outside the public tree.

## Bounded opacity evidence

The accepted opacity slice in [ADR 0002](adr/0002-rendering-evidence-grounding.md)
records optional local opacity and original sibling index. New captures emit a
rendering object even when opacity is unsupported; external parent/sibling reads
and inferred opacity are excluded. Rendering fields count toward the existing
metadata budget and survive persistence, exports and capture transfer.

The new evidence tests include a 10,000-deep iterative ancestry chain, zero-opacity
ancestor exclusion, positive-opacity underflow prevention, strict optional fields,
confirmation invalidation and legacy approval compatibility. An independent review
found a legacy pending hidden-reference approval bypass; a failing regression was
added and the approval transition now recomputes rendering requirements. Already
approved records remain unchanged. Five existing local projects and their approved
exports matched protected pre-change baselines after the final build and restart.

A real Bonafide inner explanation Frame captured 2 nodes with observed opacity=1,
local TEXT siblingIndex=0 and a 658×81 PNG. Its external ancestor was not read, so
the UI correctly showed unknown and blocked semantic approval pending confirmation.
Normal Chrome Show in Figma selected the captured TEXT in Desktop Dev Mode.
Two actual stdio MCP calls preserved the new source fields and excluded the
unapproved annotation from approved context. These observations do not establish
zero-opacity exclusion in a real file, precise pixel alignment or Dev-only can-view
permissions; those limits remain separate from the synthetic tests.

Observed ancestry produces `hidden`, `transparent`, `unknown` or `potential`.
Hidden takes precedence over zero opacity; either remains known even when another
part of the ancestry is unobserved. Missing opacity or an unobserved non-page
ancestor stays unknown. Positive values are not multiplied into a false zero.
Automatic candidates exclude known hidden/transparent subtrees while raw source
records and manual selection remain available. Local order and positive opacity
do not prove paint coverage, pixel contribution or design age.

`renderingReviewRequired` adds a confirmation condition alongside geometric
ambiguity. Manual hidden/transparent references require confirmation, as do unknown
references in captures carrying the new rendering evidence. Legacy unknown approval
behavior is preserved. New approval transitions recalculate the rendering condition
even when a legacy pending annotation already has saved diagnostics; name-only edits
cannot bypass it. Already-approved records are unchanged on load/export.

Synthetic regressions cover inherited state precedence, missing evidence, tiny
positive opacity, iterative bounded ancestry, strict host property access, original
sibling positions, traversal budgets and the legacy pending approval case. These
checks establish capture and review contracts, not native rendering or occlusion.

## Current node export comparison

The accepted comparison slice adds one explicit current-page `preview_node` export
and an authenticated transient `source-preview` response. The UI compares a saved
composite crop and current node/subtree PNG with separate timestamps. Viewing an
image never adds, confirms or approves a reference. Snapshot contents, project
revision/history, portable bundles and MCP approved context are unchanged.

Twelve plugin regressions cover bounded scalar reads, source/selection write traps,
current-page identity, metadata/ancestry changes, unsupported transforms, PNG limits,
deadline and cancellation. Nine HTTP/WebSocket cases cover captured-node restrictions,
file/page/text/geometry/opacity checks, session/revision races, malformed responses
and disk preservation. Cancellation includes a late-response/ping barrier followed
by a successful fresh request. Synthetic PNG headers in adapter/server tests verify
contracts, not decoded rendering. Four browser cases use valid generated PNGs to
verify distinct equal-position images, transparent output, stale success rejection,
revision clearing and preservation of references/approvals.

After adding an enlarged native dialog, TypeScript and the web build passed and
the four comparison browser cases passed again. The dialog test checks modal focus,
Escape/Close focus restoration, larger image dimensions and no extra export or
project mutation. The earlier full 20-case browser run remains a separate record.

Actual Desktop Dev Mode and normal Chrome exported the already captured Bonafide
inner Frame as a decoded **658×81 PNG**, displayed next to its saved composite.
A separate TEXT export returned **530×17 / 5,950 bytes**. Native selection, session,
project JSON including history, source confirmation and semantic approval remained
unchanged. Six protected local projects and their approved exports matched the
pre-change baselines. These live calls used the owned Community copy; they do not
prove external can-view/Dev-only permissions, hidden/masked export semantics or
occlusion. No source property was changed and no AI provider was enabled.

Fixed limits are 1,024px, 2,000,000 PNG bytes and a cooperative five seconds.
Figma's native export cannot be preempted or memory-bounded before completion.
Metadata checks are not a rendering fingerprint: descendant, paint and external
ancestor changes may remain undetected. Outside siblings are excluded. The four
selected native observations above cover specific hidden-ancestor, mask, coverage
and zero-opacity cases; they do not establish general ancestor opacity, clipping,
mask or blending guarantees. Blank output has no automatically assigned cause.
SECTION now returns metadata without requesting an image export; no guessed
offset or larger budget is used.

## Portable capture transfer

[ADR 0003](adr/0003-portable-capture-bundles.md) adds one or two explicitly selected
captures to a versioned compact JSON file. Import validates identity, ancestry,
completeness, root bounds, PNG headers and canonical SHA-256 checksums before
creating a fresh workspace. It never imports annotations, specifications,
proposals or approvals. The original workspace and its history are unchanged.
Checksums detect corruption, not authenticity or source rendering fidelity.

Ten core regressions began failing, then passed after implementation. Four new
HTTP integration cases cover disconnected persistence, authentication/Host/Origin,
stale export, size limits, tampering and semantic-field injection. Four browser
cases include compact download, import before selecting a workspace, original
approved-export preservation and prevention of losing unsaved local input.

Normal Chrome exported the two permitted Bonafide observations and imported the
107,382-byte JSON while the actual Figma plugin was disconnected. All 291 nodes,
92 TEXT records, original identifiers, coordinates, warnings, Login PNG and nullable
notes preview matched the original snapshots exactly. HTTP and persisted disk
matched. Reload preserved the imported workspace; three stdio MCP calls read both
cached scopes and confirmed empty approved context. Three older approved
workspaces and the source capture workspace retained their protected baselines.
No external AI provider was enabled.

The second real scope was a separate User stories section: 21 nodes, 7 TEXT,
4,841 node-JSON bytes, complete metadata. Native Desktop title, numbers and three
story sentences were visually compared with the captured text. No semantic
relationship was automatically inferred or approved. Its PNG exceeded the
1,024px request budget and was rejected. A later diagnostic measured 1,098×701
against expected 1,024×627.76 for the 1,119×686 Section bounds. The cause and image
origin remain unverified. `complete=true` describes traversal, not successful preview.
The rejection and missing preview survived transfer without being hidden.

## Actual Figma observations

### Dev-only permission requirement

The permission baseline is a Dev seat plus `can view` file access, with no
source-edit dependency. Both local manifests now register Dev Mode inspection.
Two new tests run their bundled entrypoints with synthetic source nodes that
reject writes: the bridge reads selection and captures exact text/PNG, and the
fixture analyzer returns aggregate metrics. Both restore the Dev Mode default
hidden-instance traversal flag after the request. These tests failed on missing
Dev registration before the manifest fix, then passed with the full 92-test run.

The later locked-host continuation found and fixed a hidden-instance read gap:
captured manual references could fail navigation because Dev Mode's default
`skipInvisibleInstanceChildren=true` makes those nodes unavailable. Highlight,
selection metadata and initial capture-root reads now temporarily permit access
and restore the previous setting on success, validation failure and cancellation.
Six new regressions failed before their respective fixes and now pass, including
highlight → actual synthetic selection change → metadata/capture with source
property writes prohibited. This is adapter evidence, not native permission or
selection/viewport proof. Together with four coordinate cases, the full suite is
reached 102 tests at that checkpoint.

**Actual Dev-only account acceptance is pending.** The earlier Desktop success
used an editable synthetic file; an owned duplicate would also fail to establish
this permission boundary. Follow the [Dev seat/view-access protocol](desktop-verification.md#dev-seat-and-view-access-acceptance)
for host identity, capture/export, navigation and lifecycle. The remote Figma
Plugin API execution service's edit-access rejection on a public candidate is
not evidence of this local product's intended permission requirement.

After Dev Mode access became available on 2026-10-23, the actual Desktop Inspect
panel launched the existing local plugin and connected to the bridge. Chrome
captured the selected synthetic frame: 56 nodes, complete scope and a 1440×900 PNG.
Metadata, bounds, warnings and PNG exactly matched the earlier Design-mode capture;
HTTP and saved disk state agreed. Current-session MCP highlighted a rectangle and
then read that same selected node. The native UI remained in Dev Mode. No source
content was edited. This proves actual Dev Mode operation on the owned fixture,
not the still-open Dev-only/can-view permission boundary.

The public Open Collective candidate was then opened in Desktop with the explicit
message that the user could only view and comment. Its **View → Switch to Dev Mode**
menu was disabled. The local plugin could not be tested in that file's Dev Mode;
the cause of that Figma access state was not established. No edit access was
requested and no sharing, seat or source-content changes were made.

### Figma-assisted source review

Match diagnostics now survive save/reload and approved export. The editor shows
the selected region and candidate crops from the captured composite, offers native
Figma navigation, and accumulates explicit single-node selections in a local draft.
The native-import endpoint verifies file/page/captured ID/name/type/BBox and checks
project revision and plugin session before and after the asynchronous request.
It does not mutate saved annotations, approvals or history.

Ambiguous grounding requires an explicit revision-bound human confirmation before
semantic approval. Source/geometry changes clear confirmation; AI cannot supply it.
Legacy approved records remain unchanged. Source search/pagination reaches all
captured nodes, and truncated candidate diagnostics display a limit warning.

Nine core regressions cover persistence, approval gating, stale/empty confirmation,
AI protection, invalidation, legacy records and candidate bounds. Eight new
HTTP/WebSocket/disk cases cover valid import, rejection, concurrent project changes,
session replacement and cancellation including late responses. These use synthetic
data. Composite crops do not isolate covered layers. The bounded opacity slice
above adds observed state and local sibling order. Current node export comparison
is implemented as described above; global paint-order and occlusion proofs remain
open in ADR 0002.

The new review flow also ran through normal Chrome and actual Desktop Dev Mode on
the synthetic fixture. A saved region had 42 candidates and ambiguous grounding.
Two different native selections accumulated in its web draft; a repeated selection
was deduplicated. Disk state remained unchanged until Save. Approval was visibly
disabled until Confirm sources, after which the synthetic test annotation was
approved separately. Current-session MCP returned the confirmed set and matched
HTTP approved export. Browser reload and server restart preserved it; all three
earlier approved workspaces retained identical state and exports. These decisions
were agent-operated synthetic acceptance, not independent end-user semantic signoff.

### Desktop and Chrome acceptance, 2026-10-23

The bundled development plugin ran in Figma Desktop 126.10.11 on macOS 26.6.2.
Actual Codex MCP, HTTP and the Chrome editor completed selected-scope captures of
the authorized synthetic UI and notes frames: **56 and 17 nodes**, with
**1440×900 and 560×900 PNGs**. A low-node-budget capture returned exactly three
nodes and an explicit incomplete-prefix reason; a subsequent full capture
returned the expected 17 nodes. No source design content was edited.

Chrome exercised region editing, exact source matching, hierarchy, verbatim
specification links, approval, JSON download and reload. The live scenario saved
three approved components, one specification and two relations. Downloaded JSON,
HTTP export, disk state, SDK stdio and actual Codex MCP results agreed. Browser
reload and server restart preserved source text, annotations and approvals.
These approvals were entered by the agent for synthetic acceptance; they are not
independent end-user semantic review or productivity evidence.

Eight straight-edge pixel landmarks matched predicted positions with **0 px
error at 1 px sampling**, excluding rounded corners. Overlays were visually
inspected at Fit/100%, 125% and after a 40 px pan. This is narrow registration
evidence for the tested unrotated scopes, not completion of F3.

Explicit disconnect, wrong-token rejection, server stop/start with automatic
reconnect, and plugin close/reopen followed by successful fresh selection were
observed. Saved context remained readable while disconnected. Closing the plugin
while a source request was in flight was not exercised in that run; the later
2026-10-24 [lifecycle observations](#lifecycle-observations) cover pending close
and recovery.

Source navigation initially failed safely because the host did not expose
`figma.fileKey`. Setting `enablePrivatePluginApi: true` in this local development
plugin's manifest restored the host-provided identity. A new capture then
supported both MCP `highlight_source_nodes` and Chrome **Show in Figma**.
A deliberately wrong requested file key was rejected without changing selection.
That run did not verify replacement between two real open files; the later
2026-10-24 lifecycle observations record actual two-file replacement. Earlier
approved captures with a null file key remain unchanged; navigation requires a
new capture with verified host identity. Support outside this tested development
plugin runtime is not established.

AI remained disabled throughout the Desktop/browser acceptance runs; no source
design was sent to an external model provider. Evidence containing source
content remains local and is excluded from the public repository.

### Earlier remote Plugin API probe

The previously verified synthetic file is identified only in private local
evidence. A new read-only remote Plugin
API probe used the product's PNG export options (`contentsOnly: true`,
`useAbsoluteBounds: true`, scale capped at 2,048 px). No document content or
selection was changed. The three known scopes were traversed separately under a
500-node cap. Only aggregate metrics were saved.

| Root | Nodes / TEXT | Absolute BBox (x,y,w,h) | PNG dimensions / bytes | Traversal / export |
| --- | --- | --- | --- | --- |
| `1:2` | 56 / 41 | 120,120,1440,900 | 1440×900 / 55,940 B | 52 / 500 ms |
| `1:58` | 17 / 14 | 1635,120,560,900 | 560×900 / 41,772 B | 2 / 119 ms |
| `1:75` | 6 / 1 | 1635,1070,560,220 | 560×220 / 5,002 B | 1 / 34 ms |

These are single observations including remote API overhead. They are not Desktop
performance thresholds or pixel-level registration measurements. PNG dimensions
match the source bounds in these unrotated cases. Plugin heap/peak native memory,
Desktop transport bytes, first-node latency and live rotated/masked/clipped pixel
accuracy are **not measured**.

The fully bundled product adapter (71,982 characters) was rejected before execution
by the remote connector's 50,000-character code limit. The smaller direct API probe
therefore verifies native reads/export settings, not execution of that whole bundle
in the remote runtime. No alternate validation implementation was substituted.
Print the reproducible script with `node scripts/print-native-figma-probe.mjs` and
run it read-only against the same file through the official Figma tool. Details are
in [the measurement artifact](evaluation/product-native-figma-probe.json).

## Generated scale measurements

`npm run benchmark:product` uses the actual product capture adapter against lazily
generated API-shaped nodes, then runs the deterministic matcher. With a 2,000-node
budget, generated scopes of 100, 1,000 and 10,000 nodes visited exactly 100, 1,000
and 2,000 nodes. The 10,000-node scope was explicitly incomplete. A separate full
10,000-node bounded run captured 2,620,900 metadata bytes in 122.554 ms; matching
20 exact regions had median 15.756 ms per query, including index construction.

This Node.js benchmark has no Figma renderer, image export or Desktop transport.
Sampled heap differences are signed and garbage-collection-dependent, not peak
memory. Timings are observations, not CI pass/fail budgets. Machine/runtime and all
rows are recorded in [the generated benchmark](evaluation/product-generated-benchmark.json).

`npm run benchmark:local-pipeline` additionally exercises a real isolated loopback
HTTP server, WebSocket plugin emulator and temporary disk store. Each of four
cases runs one warmup and five measured repetitions, with a fresh project for
capture → one exact text-region match → simulated approval → read/export. Every
run checks bounded capture, source text/provenance and HTTP/disk/export equality.

| Generated scope / capture cap | Capture HTTP median | Full chain median |
| --- | ---: | ---: |
| 100 / 2,000 | 6.572 ms | 24.795 ms |
| 1,000 / 2,000 | 19.457 ms | 80.133 ms |
| 10,000 / 2,000 | 36.405 ms | 144.025 ms |
| 10,000 / 10,000 | 186.703 ms | 742.132 ms |

The full chain includes assertions; adapter time is nested in capture HTTP time.
Client/server/emulator share one Node process. The approved output has one
annotation and one source node. JSON payload/file sizes are not network wire
bytes. Native Figma, image export, browser rendering, peak memory, large approved
contexts and human review are excluded. No performance threshold is inferred.
See [the complete measurements](evaluation/product-local-pipeline-benchmark.json).

## Gate status and next acceptance work

| Gate | Status | Missing evidence |
| --- | --- | --- |
| F0 enterprise permission | Not evaluated | Target installation/local-network/data-handling policy; no inference permission assumed |
| F1 Desktop bridge | Live capture/navigation/MCP/source review, native pending cancel/close and recovery, configured-deadline timeout and two-file replacement verified | Effective Dev-only account with another owner's can-view source file |
| F2 bounded performance | Native 101/1,001/5,001-node matrix: five first-session and five warm samples each, 30 measured captures, zero failures | Native export-only/first-node/true-peak allocation instrumentation is unavailable in the current protocol; no universal performance threshold claimed |
| F3 coordinates | Supported negative-origin/scaled, clipping, mask, hidden/transparent, overlap cases passed pixel checks; rotated/Section roots explicitly unsupported | Broader paint/transform cases are compatibility expansion, not a claim of complete renderer equivalence |
| F4 matching | Deterministic generated cases verified | Labeled real-world corpus precision/recall and semantic ambiguity rates |
| F5 productivity | Not measured | Timed manual/tool/AI-assisted human study including corrections |
| F6 security | Token/origin/bounds/approval/proposal checks, actual Codex/SDK and native lifecycle executed; documented runtime boundaries | Target environment review and independent release signoff |

The [completion status](completion-status.md) separates closed agent-owned work,
external acceptance dependencies and future scope. The [Desktop protocol](desktop-verification.md)
remains the procedure for a newly available account/file combination. Do not
repeat passed local installation, sample duplication or native test matrices as
if they supplied the missing permission or independent human evidence.

Native fixture analysis now covers the permitted Bonafide Community copy's Login,
notes Section and inner explanation Frame. Their whole-file coverage and independent
semantic corpus promotion remain unestablished. The five research candidates retain
their dated access/license caveats in the [fixture report](fixture-evaluation-results.md).
The original view-only Open Collective file was inspected without structural
extraction because its Dev Mode menu was disabled.
Automated product tests use generated data. No original source text, PNG or
full-document dump was added to the public repository.

## Known limits

- Source grounding stores optional observed opacity and local sibling order.
  Captured hidden and zero-opacity ancestry is excluded from automatic matching,
  but missing observations and ancestors outside the captured scope remain unknown.
  Equal BBoxes preserve ambiguity; manual hidden/transparent references and unknown
  references from new captures add a separate rendering-confirmation requirement.
  Positive opacity and local order cannot prove occlusion or distinguish design age.
  Composite crops do not isolate equal-position layers. Current node export is a
  separately timed inspection aid, not a rendering revision or occlusion proof.
  Native selection import and current export have different metadata checks;
  neither fingerprints every descendant/style. Paint coverage proofs remain
  deferred in [ADR 0002](adr/0002-rendering-evidence-grounding.md).
- One active plugin session. Captures are immutable observations, not guaranteed
  Figma revisions; automatic source-change reconciliation is deferred.
- Existing captures without a host-provided file key cannot navigate back to
  source. Recapture after enabling supported identity access; do not backfill
  approved provenance from a pasted or inferred URL.
- Native `exportAsync` cannot be preempted. Late results are ignored after
  cancellation, but native work and memory may continue until Figma returns.
- Project JSON plus bounded history has a 48 MB storage cap. Existing images are
  cached once per project, but whole local project reads are still used for the
  browser; this MVP is not a database-backed large-project streaming editor.
- MCP pages/projections avoid transferring preview images. A single record larger
  than output limits returns an explicit error; reduce scope rather than silently
  truncate verbatim specification text.
- External model quality, provider compatibility beyond mocked OpenAI-compatible
  responses, inference cost and annotation time saved are not measured.
- The macOS app/DMG and prebuilt local plugin are implemented and exercised as
  described above. License choice and final public posting remain release work;
  source reconciliation, future schema migrations, other-platform installers and
  Figma Community publication remain separate scope.
