# Completion status

Current status reviewed: 2026-10-26 KST; earlier native experiments retain their
2026-10-24 observation dates. This separates remaining implementation and verification
from external dependencies and future scope. It does not certify release readiness.
The [validation log](product-validation.md) records executed native observations;
the [roadmap](roadmap.md) and [feasibility gates](feasibility.md) remain requirements.
Historical fixture manifests keep their original observation dates. The released
baseline is [0.1.1 alpha](releases/0.1.1.md), published under MIT. The subsequent
[large-source workflow](evaluation/collection-backed-workflow.md) is implemented
and locally verified but remains an unreleased source change.

## Unreleased security candidate, 2026-10-26

The current source adds pinned local TLS for the native app/MCP and a mutually
authenticated, encrypted v3 Figma bridge. The published and installed 0.1.1
binaries remain unchanged; use the [source upgrade guide](unreleased-upgrade.md)
for the transport and matched app/plugin update requirements.

The rebuilt v3 plugin connected in actual Figma Desktop. An isolated owned
synthetic Dev Mode file passed two metadata IDs, nine immediate children across
three pages with cached replay, a two-node branch in one chunk, an 800×600
overview and a 21-node collection. Scripted source confirmation, approval,
approved export and current preview passed with the original selection unchanged.
The focused bridge/application regression suite passed 143 tests, including real
IPv6 relay confidentiality and tamper rejection. See the
[candidate validation record](product-validation.md#unreleased-security-candidate-2026-10-26).

Independent scoped security review and follow-up UI review found their reported
issues addressed. The final full check passed 406 Node tests, TypeScript and all
builds; the complete browser suite passed 49 cases. Native candidate open/save
dialogs also roundtripped a 21-node NDJSON source without transferring approval.
Package provenance is a separate release gate. These bounded observations do
not establish the original large-file workflow, independent human semantic
review or a new release.

## Agent-owned work complete for the accepted scope

The bounded local manual-review implementation and selected native acceptance
experiments are complete. The subsequently requested 0.1.0 macOS app is also
implemented and has passed installed-app workflow checks. The native analyzer UI relay defect was corrected,
and fresh native reports now complete the selected geometry scope and all three
previously captured Bonafide scopes. The lifecycle, performance, cancellation and
geometry experiments below are also closed. Broader acceptance dependencies are
the external account/policy/participant requirements below. License selection and
0.1.1 alpha publication are complete; its recorded release limits still apply.

This closes the selected experiments, not every feasibility gate or release
claim. In particular, the observed scopes do not satisfy the proposed ten-screen
representative corpus, independent semantic labels or human productivity study.

The actual application already uses atomic JSON storage; the architecture's open
SQLite/JSON wording is historical. Likewise, original Desktop-transport-pending
headings must be read alongside the later successful bounded capture/navigation
evidence. General pipeline ideas such as full style acquisition and reconciliation
are not implemented merely because the pipeline lists them.

Documentation preparation is complete in [release readiness](release-readiness.md):
observed compatibility, runtime/security boundaries, source-data risks and a release
checklist are available. Target-organization policy/signoff, the required account/file
combination and independent evaluations remain external dependencies; this is
not a formal security-audit certification.

## Completed installed 0.1.0 macOS alpha

The installed AppKit/WKWebView application ran with bundled Node 22.23.4 and
production assets. Automatic pairing, synthetic annotation save, native JSON and
Markdown save dialogs, two-capture bundle export/import, installed-bundle MCP and
actual Figma plugin import/capture succeeded. The native Figma capture contained
21 nodes with an 800×600 PNG. Existing six projects were preserved through explicit
migration from the task-owned development service. Quit stopped the app-owned
listener; restart retained token, project hashes and the saved annotation.
See the [installed-app aggregate](evaluation/alpha-desktop-acceptance.json).

This section records the original installed 0.1.0 experiment. The subsequent
0.1.1 bilingual app/DMG and local plugin were published with MIT and package
verification; see the [publication record](release-readiness.md#release-checklist).
macOS 13 is a build target, not a verified OS
execution result. Developer ID notarization and Figma Community publication are
not supplied by this alpha. The final clean-commit verifier records source revision
and asset hashes separately. The [0.1.0 note](releases/0.1.0.md) remains historical;
the [0.1.1 release note](releases/0.1.1.md) is the released baseline. New source
changes require their own package verification before a later release is claimed.

## Completed native geometry and rendering checks

These rows close the selected native case matrix and Section support decision.
They do not certify every Figma paint/transform combination or the full F3 gate.

| Completed check | Executed evidence | Interpretation limit |
| --- | --- | --- |
| Negative coordinates and scaled capture | Actual Desktop PNG 512×384 at scale 0.64; eight of eight measured landmark edges passed a 1px tolerance, maximum error 0.2px | One fixed synthetic scope/scale; edge sampling excludes corner antialiasing. |
| Clipping, mask and visibility samples | Fourteen of fourteen 9-pixel interior color patches passed: clip overflow, elliptical mask, hidden/zero-opacity ancestry, same-parent/different-branch coverage and outside-sibling exclusion | Sampled patches, not every pixel or a general occlusion classifier. |
| Preserved ambiguous grounding | Core analysis of the actual 21-node native capture found two hidden and two transparent sources, excluded four visual candidates and retained raw records. Both covered-source cases retained two exact candidates and ambiguity | Deterministic suggestions selected the earlier covered source in these cases; human source confirmation remains necessary. No independent semantic accuracy claim. |
| Four current node exports | Covered source: solid red 120×80 while the composite sample is blue. Mask target: full cyan 140×100 while the composite is ellipse-masked. Child of hidden ancestor: solid red 100×100. Local opacity-zero node: fully transparent 100×100. All expected pixels passed | Four direct observations, not a general rule for ancestor visibility/masks/blends. No source choice or approval follows automatically. |
| Unsupported roots | Native rotated-root capture preserved two metadata nodes and returned preview=null. SECTION preserved three metadata nodes and returned preview=null with an explicit metadata-only warning | Section PNG mapping remains unsupported. Select an unrotated inner Frame; do not raise limits, guess offsets or repeat Section exports. |

The public [native acceptance aggregate](evaluation/native-desktop-acceptance.json)
records these observations without source identifiers. Detailed evidence remains
in the ignored aggregate reports `native-lab-pixel-public-report.json`,
`native-lab-matching-public-report.json`, `native-lab-preview-pixel-public-report.json`
and `native-lab-unsupported-report.json`.
The native PNG checks used bytes matched to saved capture/export responses; local
matching checks did not make a new native call. No private source IDs or original
text are reproduced here. Existing Bonafide Frame/TEXT comparison evidence remains
separate from these generated-fixture observations.

## Completed native lifecycle and bounded performance

The agent-owned F1 lifecycle experiments, selected F2 performance matrix and
comparison-request cancellation work are closed. The public
[native acceptance aggregate](evaluation/native-desktop-acceptance.json) records
the native observations; the [validation log](product-validation.md) separates
browser/HTTP regressions from actual Figma execution.

| Completed check | Executed evidence | Interpretation limit |
| --- | --- | --- |
| Client cancellation and plugin close | Cancellation after observed broker pending cleared the request and kept the plugin connected. A separate pending native-window close returned PLUGIN_DISCONNECTED/503 and cleared pending | Three earlier close attempts completed first and are not cancellation evidence. No late native response was observed. |
| Controlled deadline and recovery | An isolated 50ms deadline returned PLUGIN_TIMEOUT/504 in 52.537ms; a fresh native selection succeeded, with revision zero and no snapshot committed. Reopening/pairing also produced two complete 5,001-node captures | This is an intentionally short deadline, not a natural/default-timeout observation. Native execution start and export preemption were not observed. Recovery captures are excluded from performance samples. |
| Two native files and session replacement | Distinct native file/session identities, stable replacement for ten seconds, old-plugin replacement notice and cleared token; explicit pairing restored connection and native highlight | Source identities remain private. Polling does not prove a WebSocket close code or exclude shorter interruptions. |
| Comparison Close/context cancellation | Browser AbortController cancels outstanding HTTP work on Close, context change and unmount; stale-response guards remain. Preview loading permits context navigation; ordinary actions cancel pending previews and retain their mutation lock. Strengthened browser assertions finish before the broker timeout, and cover fresh requests | Native export can continue until Figma returns. The regressions do not establish native preemption. |

Existing saved projects remained unchanged during the native lifecycle and
performance experiments. New temporary captures used dedicated test projects.

Exactly five plugin-session-cold and five warm measurements were collected per
size: **30 measured captures plus three excluded warmups, all 33 complete with
metadata and PNG, zero failures**. Fifteen distinct restarted plugin sessions
supplied the cold samples, with no earlier harness capture attempt in each session.

| Captured nodes | Cold median HTTP readiness | Warm median HTTP readiness |
| ---: | ---: | ---: |
| 101 | 74.101ms | 79.189ms |
| 1,001 | 341.937ms | 329.781ms |
| 5,001 | 1,513.245ms | 1,454.501ms |

Cold means the first capture attempt in a restarted plugin session with the page
already loaded; it does not mean OS/renderer/filesystem caches were cold. Timings
include transport, validation, persistence and serialization, but exclude source
selection/preflight and temporary-project creation. Limits were 6,000 nodes,
4,000,000 metadata bytes, 15 seconds and a 1,024px image dimension cap.
The report includes 100ms process-RSS samples, not actual peak/plugin-heap memory.
With five samples per cohort, nearest-rank p95 is the maximum, not a stable tail
estimate. No numerical pass threshold or arbitrary-design performance guarantee
is inferred. Export-only latency, first-node latency and wire bytes remain
unmeasured; none is silently substituted with cached analyzer replay.

## Completed constructed-geometry scoring

The [14-case geometry benchmark](evaluation/geometry-grounding.md) supplies the
synthetic source-set precision/recall report requested by issue #3. Literal
expected ID sets are written separately from matcher execution. It reports
TP=15, FP=0, FN=0; micro precision/recall/F1=1.0 and macro values=1.0 over the
11 cases with nonzero denominators. Two empty-space cases and one required
incomplete-scope abstention are counted separately. Four cases are ambiguous;
all 14 agree with the explicit ambiguity labels and remain deterministic under
two input-order permutations. These deliberately small construction cases are
regressions, not independent human semantic accuracy or real-file generalization.

## External dependencies

| Dependency | What is missing | Stop and resume condition |
| --- | --- | --- |
| Dev-only plus source can-view acceptance | A permitted file owned by someone else, an account with only the effective Dev seat for that file, and observed can-view/export policy | Owned-copy success is insufficient. Resume with that actual account/file combination; do not retry the disabled Open Collective Dev menu or request edit rights to manufacture a pass. |
| Representative corpus and independent F4 labels | Human agreement on representative sample/task selection and two frontend reviewers for independent source-set/spec-link judgments | Prepared rubric is ready; the three measured Community scopes do not meet the ten-screen target. No agent-generated interpretation counts as independent human ground truth, and fixture adoption counts are unchanged. |
| F5 productivity | Human participants and comparable manual/tool/AI tasks, including correction time | Counterbalance task order and retain failures. Mock provider success supplies neither model quality nor time saved. |
| F0 and enterprise adoption | Target organization's installation/data/egress policy and its security/deployment signoff | MIT and the owner's 0.1.1 alpha publication decision are complete. They do not authorize corporate rollout or internal-data transfer. |
| Original large production capture | Permitted access to the reported 105,837-node source and a reproducible selected scope | The generated large-case and owned native fixtures validate different layers; neither supplies that file's performance, shape or permissions. |

The fresh remote account check reports a Full seat, not a Dev-only identity.
That result does not independently identify the Desktop/browser session or supply
the missing account/file combination. Another Community duplicate would still be
an owned copy. No-Dev consumers already have the capture-bundle import path;
testing that path again does not establish live can-view acquisition.

## Separate scope expansions

The following need their own acceptance scope or ADR, rather than being treated as
defects that must all be implemented before finishing this local manual workflow:

- Independent REST acquisition with OAuth/PAT, quota handling and source alignment.
- Automatic occlusion/paint coverage, design-age classification or hidden-node reveal.
- Cross-snapshot annotation source sets, automatic source-change reconciliation,
  full-document analysis and guaranteed live synchronization.
- Electron or other-platform installers, cloud collaboration and Figma Community
  plugin distribution. The requested macOS app/DMG and prebuilt local plugin are
  implemented and the 0.1.1 alpha is published; later source changes are not part
  of those existing download assets.
- New schema-version migrations before a concrete schema change is defined, broad
  style/asset acquisition, and automatic production code generation.

## Completed cached Bonafide measurements

The existing `src/fixture-analysis/index.ts` was executed over three validated saved
product snapshots. Parent links reconstruct only their captured subtrees. No live
Figma request, original/copy edit, full-page traversal or semantic approval occurred.
The saved bundle's checksum validation and project validation ran before analysis;
input bytes were compared again afterward and remained unchanged.

Limits per scope were 1,000 nodes, 500,000 record bytes, 5 seconds and 250,000 pair
checks; geometric tolerance was 0.5 document pixels. All three cached traversals
and spatial passes completed. A repeat produced identical structure/spatial
metrics, and a separate all-pairs/parent-link oracle agreed on seven counts and
two ratios. Rectangle primitives were shared; the oracle is not a second renderer.

| Saved scope | Nodes / TEXT | Max depth | Equal / near-equal BBox pairs | Overlap pairs | Containment without ancestry | Direct parent not containing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Login | 270 / 85 | 9 | 52 / 53 | 1,744 | 186 / 1,634 | 5 / 269 |
| Notes Section | 21 / 7 | 3 | 0 / 0 | 59 | 0 / 43 | 0 / 20 |
| Inner explanation Frame | 2 / 1 | 1 | 0 / 0 | 1 | 0 / 1 | 0 / 1 |

The inner Frame overlaps the notes Section: 293 per-scope records represent **291
distinct captured source nodes**, not 293 independent nodes or a file total.
Login has 14 nodes with their own visible=false, and 213 BBoxes, including 67 TEXT,
have no positive-area overlap with its root. These are local visibility/AABB
diagnostics, not rendered visibility or semantic-error counts.

In these cached reports, Auto Layout count/ratio remain **not measured** because
product captures omit layoutMode; the adapter's null placeholder must not become
a measured zero. The fresh native reports below supply separate Auto Layout and
single-run analyzer timings without rewriting those historical unknowns. Native
export-only timing, peak memory, wire bytes, whole-file counts, current cloud
revision freshness and independent semantic precision/recall remain unmeasured.
These three scopes do not meet the proposed ten-screen mixed-content corpus target,
and neither analysis promotes a candidate's adoption status.

Private mode-600 artifacts are `bonafide-cached-fixture-analysis.json`,
`bonafide-semantic-review-template.json` and reproducible helper
`analyze-saved-bonafide.ts`, all under Git-ignored `.bridge-local/`. The aggregate
report contains no original text, names, node IDs, private file key or images.
See [metric definitions](fixture-analysis-metrics.md) for denominators and limits.

## Completed native aggregate analysis

Four fresh Desktop **Analyze selection** reports passed extraction and spatial
completeness checks after the UI relay correction. The public
[native analyzer aggregate](evaluation/native-fixture-analyzer.json) contains
counts and limits without source identifiers, text, names, hashes or images.

| Selected scope | Nodes / TEXT | Auto Layout / eligible | Extraction / spatial / total ms |
| --- | ---: | ---: | ---: |
| Synthetic geometry | 21 / 0 | 0 / 9 | 2 / 0 / 2 |
| Bonafide UI scope | 270 / 85 | 58 / 74 | 89 / 22 / 112 |
| Bonafide notes Section | 21 / 7 | 7 / 7 | 2 / 0 / 2 |
| Bonafide inner Frame | 2 / 1 | 1 / 1 | 0 / 0 / 0 |

Each Community native report matches its cached analysis in all 12 comparable
structural fields and every spatial field; page/root identities were checked
privately. Auto Layout count/ratio were excluded from that equality check because
cached SourceNode records do not contain layoutMode. The same analyzer produced
both sets, so agreement is consistency evidence, not an independent renderer or
semantic oracle. Input report bytes remained unchanged during validation.

All four reports record hidden-instance-child traversal enabled, with complete
bounded extraction. Their file keys remain null; no identity was backfilled.
Each timing is one native run, with millisecond clock granularity: a reported zero
does not mean instantaneous execution. These are not a cold/warm distribution or
product capture/export timings. SECTION metadata analysis does not add Section
PNG support. The nested inner Frame is still part of the notes Section, leaving
291 distinct previously captured Community nodes rather than a 293-node file total.
No whole-page traversal, source edit, semantic labeling or fixture-adoption change
was performed. The representative-corpus and human-evaluation gaps remain external
requirements for those broader claims.

## Native analyzer repeat procedure

Use the existing built `plugins/fixture-analyzer/manifest.json` development plugin
in Desktop; do not reinstall dependencies or invoke the product capture command
as a substitute. If not registered, import that manifest through the normal
development-plugin UI. Select one known Bonafide or synthetic-lab container and
choose **Analyze selection**, never **Analyze current page** for this experiment.
The analyzer needs no bridge pairing token or network access.

Its fixed native limits are 10,000 nodes, 2,000,000 record bytes, 5 seconds and
250,000 pair checks at 0.5px tolerance. Inspect extraction/spatial completeness
and `hiddenInstanceChildren`; auto-layout values come from actual node reads.
Use **Download report** to obtain `fixture-measurement.json`. Keep each newly
observed download separately in ignored local storage with mode 600 and record
observation time, host version, selected scope and cold/warm procedure separately.
Alternatively, collect the visible read-only **Aggregate measurement report**
textarea through the supported UI. Check it is the fresh result, not an earlier
same-named download. The report can contain source IDs and must stay private.

The analyzer manifest does not enable the product's private file-key API: a null
`source.fileKey` must stay unknown, with the separately observed file context
recorded locally. Do not backfill the report or change permissions to force it.
One successful run supplies scoped structural evidence. Repeated cold/warm runs
would be required for an analyzer timing comparison; the completed product capture
performance matrix above is a separate measurement. Independent semantic labels
still require the human evaluation described below.

## Independent labeling rubric ready for use

1. Freeze the local capture hashes and implementation task before evaluating.
   Two frontend reviewers work independently without matcher predictions or each
   other's labels. Retain reviewer identities privately and record uncertainty.
2. For each region, record bounds, intended meaning, acceptable alternative source
   sets, no-match cases and rationale. Do not force one component decomposition.
3. Classify UI copy, explanatory canvas TEXT, behavioral/policy rules, native
   annotations, comments, image-baked text and unknown separately. Record actual
   coverage; the proposed ten UI screens, five explanation regions and two rules
   are targets, not observations. Copied files may not contain original comments.
4. Record spec-to-UI links as relation-type/target pairs, including one-to-many and
   unsupported links. Preserve exact supporting text and source IDs locally.
5. Adjudicate while retaining disagreement. Freeze accepted alternatives before
   scoring. Choose the valid alternative with highest set-F1 and a stable tie
   rule; calculate precision and recall from that same set. Report TP/FP/FN per
   case, micro/macro summaries, and no-match/abstention outcomes separately.
6. Keep geometric candidate ambiguity separate from human uncertainty, and use
   not measured for zero denominators. Source matching and spec-link scores are
   separate. A later timed productivity study includes corrections and omissions.

No reviewers, labels, accuracy scores or human study results have been fabricated.
