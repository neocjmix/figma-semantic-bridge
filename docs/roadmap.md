# Development roadmap — delivered source, release gates and future work

**0.3.0 source** adds durable partial evidence browsing, scoped branch
review, targeted acquisition of known incomplete containers and consented
revalidation after reconnect. **0.2.1 alpha** established one normal import,
2× overviews and configurable budgets; **0.2.0 alpha** added collection-backed
editing, selective reads, source transfer and local transport hardening. The
release verification report identifies the actual packaged source and assets.
[Product validation](product-validation.md) records executed evidence;
[completion status](completion-status.md) separates external dependencies.

## Delivered in the current source

1. **Local manual slice:** Figma plugin ↔ loopback server ↔ MCP, bounded capture,
   document-space regions, deterministic candidates, source review, semantic
   hierarchy, verbatim specifications, approved-only exports, undo/redo and local
   JSON persistence. A source document is not modified.
2. **Review aids:** captured-area and transient current-node PNG comparison,
   source navigation, observed hidden/opacity states and explicit confirmation.
   Optional AI produces validated pending proposals; manual work is independent
   of a model provider.
3. **One normal acquisition workflow:** overview drafts and acknowledged source
   packets persist independently. Partial metadata/text remain inspectable after
   interruption. Verified closed branches support scoped review on historical
   image context. A known incomplete container can be read without unrelated
   subtrees; the original full task stays incomplete. Continue resumes a valid
   cursor or starts a consented revalidation generation, compacting equal packets
   without claiming saved native getter work or an immutable version.
4. **Consolidated interfaces:** normal MCP discovery exposes task acquisition,
   progress, continuation and evidence queries; older tools remain callable for
   compatibility. Standard V2 source transfer supports complete collections,
   closed branches and complete bounded captures; older files remain readable.
5. **Local security controls:** mutually authenticated encrypted plugin records,
   pinned desktop/MCP TLS, stricter source/import bounds and reviewed approval
   gates. These current-source controls do not retroactively fix installed 0.1.1.

The [architecture](architecture.md), [pipeline](pipeline.md) and
[data model](data-model.md) describe this implemented design. ADRs document
decisions, including superseded proposals; dated evaluations retain their original
test results rather than being rewritten as later release proof.

## Verification order for each release

| Order | Owner | Required result |
| --- | --- | --- |
| 1. Candidate identity | Agent/repository owner | Keep application, plugin, package and documentation at the same candidate application version and supported protocol; preserve existing user data and a recoverable backup of the previous app. |
| 2. Source gates | Agent | Run the complete TypeScript/Node/build, fixture and browser suites on the final source; record exact counts and candidate revision. Use synthetic public data. |
| 3. Native/package checks | Agent with permitted local fixture | Build the final app/plugin from a clean candidate; verify pinned local connection, native dialogs, read-only acquisition, source transfer, MCP and restart using owned synthetic data. A prior development-plugin or API run is not package acceptance. |
| 4. Final artifact verification | Repository owner/agent | Verify clean commit, packaged asset hashes, signatures/declared notarization state, bundled licenses and upgrade/rollback instructions before a tag or upload. Record the actual release artifact, not a planned one. |
| 5. Publication decision | Repository owner | Decide whether remaining declared limits permit a labeled alpha. Publication, external sharing and corporate design use follow separate permission/policy decisions. |

Do not promote a prior passing suite after a later source change. Do not claim
the original 105,837-node real file, independent human semantic review, Dev-only
can-view account combination or native peak-memory bound from synthetic fixtures.

## Separate acceptance and research work

- **Access and organization policy (user/organization):** obtain an effective
  Dev-only account with another owner's can-view source and permission to run the
  local/private plugin; obtain target-organization installation/data/egress
  approval before corporate material. Existing owned-source success is narrower.
- **Original large-file acceptance (user-provided permitted source + agent):**
  run the reported 105,837-node scope only when authorized, with explicit node,
  byte, time and profiler measurements. The generated 105,837-node tests exercise
  transport/storage algorithms, not Figma's native allocation for that file.
- **Semantic quality and value (human participants):** representative screens,
  independent source/spec labels, error/ambiguity analysis and counterbalanced
  manual/tool/AI productivity measurements. Scripted approval is not a human
  study; mock model success is not model quality.
- **Later engineering proposals:** native field-selective structure acquisition
  with separately persisted text requirements, automatic composition across
  arbitrary incomplete branches, immutable/version-pinned cross-observation
  acquisition if a provider supports it, automatic source-change reconciliation,
  a general selective coverage ledger, deeper style/asset acquisition, full
  paint/occlusion analysis, other-platform installers, cloud collaboration and
  Figma Community distribution. Each needs a separate contract, ADR and tests.
  Electron is not required for the implemented AppKit macOS package.

## Development controls

Keep changes in bounded vertical slices, with runtime schemas, deterministic
fixtures and the relevant tests. Record observations and unsupported cases;
preserve source provenance, coordinates, exact text and approved human decisions.
Never commit pairing tokens, proprietary images, internal specifications or
identifiers. Treat source text as untrusted data, not agent instructions. A
release checklist and passed source tests do not grant permission to share a
third-party design.
