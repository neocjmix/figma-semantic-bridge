# Feasibility gates and evidence protocol

This began as a pre-implementation protocol. The local vertical slice and 0.1.1
alpha were subsequently built; 0.2.0 adds the later acquisition and local transport changes. Gates
still determine **which claims are supported**, not whether code may exist. Do
not turn a synthetic test, scripted API action or owned Figma fixture into proof
for a different access role, original large file, independent human judgment or
released artifact. See [product validation](product-validation.md) and
[completion status](completion-status.md) for dated results and remaining inputs.

| Gate | Executed evidence | Still needed for the broader claim |
| --- | --- | --- |
| F0 — policy and permissions | Local plugin import, read-only owned synthetic Desktop workflows and source-only transfer were exercised. Public fixtures are synthetic. | Target organization's installation, data/egress and plugin policy; effective Dev-only user with **another owner's can-view file**. Owned or Full-seat success is not that combination. |
| F1 — live bidirectional bridge | MCP → local server → actual Figma plugin selection/navigation, disconnect/reconnect/cancellation and bounded captures ran. Current v3 encrypted plugin channel also passed a bounded owned native read path. | Do not infer all client/host versions, native export preemption or a different distribution channel. Test the exact candidate package and client claimed. |
| F2 — bounded performance | Generated large server/transport fixtures, selected native 101/1,001/5,001-node capture cohorts and smaller 0.2.0 source paths ran. | Native operation on the reported original 105,837-node file with permission, shape, time and **measured** peak plugin/server memory. Packet budgets do not bound native `children` or `exportAsync` allocation. |
| F3 — coordinate/rendering fidelity | Synthetic coordinate tests, a native 21-node fixture, sampled landmarks/patches and four current-node exports passed their recorded case matrix. | General rotations, masking, clipping, blends, external overlays, occlusion and every Figma rendering state are not established. Unsupported root mappings remain flagged. |
| F4 — grounding and semantic correctness | Deterministic geometry has a constructed 14-case source-set benchmark, and ambiguity/hidden-source regressions. | Representative permitted corpus, independent human source-set/spec labels and generalization analysis. A perfect constructed-case score is not semantic accuracy. |
| F5 — human productivity | Human-first UI and optional proposal mechanics exist. | Counterbalanced participant study including full completion, correction, omissions and rework. No model mock or scripted approval proves time saved. |
| F6 — security and safe handoff | Strict schemas, revisions, read-only source adapter, approved-only MCP context, pinned native/MCP TLS and mutually authenticated encrypted plugin records have focused tests/review. | Version-specific release/package verification and organization security signoff where required. Controls do not grant source-sharing permission or prove a human performed an API approval. |

## Repeatable measurement protocol

1. Record the **exact source revision, candidate asset and plugin/client versions**,
   permission role, file ownership, selected root and whether the data is generated,
   publicly permitted or private. Keep private IDs, images, text and tokens outside
   public fixtures and logs.
2. Distinguish browser tests with a synthetic WebSocket peer, loopback/MCP tests,
   scripted HTTP actions backed by a native plugin, real native UI interaction and
   independent human review. Do not merge their counts or claims.
3. For acquisition, record requested scope, planned fields, node/byte/time limits,
   observed counts, complete/partial status, error/retry, image size and separate
   stage timings. A partial prefix is not a full count. Measure peak memory with
   an actual profiler; otherwise report **not measured**. First-node latency,
   export-only time and cumulative server time are different metrics.
4. For coordinates, compare document-space geometry with actual PNG pixels on
   explicit supported cases, and record unsupported transforms or pixel effects.
   For matching, use independent expected source sets and count abstentions,
   ambiguities and false candidates; never substitute a geometric IoU for meaning.
5. For productivity, recruit experienced frontend participants, counterbalance
   manual/tool/AI task order and measure the finished artifact plus corrections,
   omissions and rework. Preserve failures and undecided source references.
6. For security, test hostile Figma text, malformed imports, unauthorized local
   clients, stale revisions, interrupted transfers, storage corruption and plugin
   replacement. Ensure no approved record changes through AI proposals or an
   incomplete source. Audit candidate dependencies and package provenance for
   the release under evaluation.

## Decision rule

F0–F4 support technical and permitted-source viability only for the observed
conditions. F5 supplies the product-value claim; F6 and artifact verification
support a release or enterprise-use decision. The owner may publish a labeled
alpha with narrower warnings, as happened for 0.1.1, without claiming all gates
passed. Source checks do not update older installed assets or authorize corporate use.
Every final package and release tag requires its own recorded verification; see
the [0.2.0 record](evaluation/release-0.2.0-acceptance.md) and attached artifact report.
