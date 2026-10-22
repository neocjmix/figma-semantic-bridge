# Product implementation and validation log

This log records executed evidence rather than changing the requirements in the
architecture, pipeline or roadmap. The branch builds an executable local product;
it is not a release certification or a claim of completed Figma Desktop acceptance.

## Delivered slices

| Slice / tracking | Implemented behavior | Executed evidence |
| --- | --- | --- |
| P0 / #1–#4 | Authenticated plugin broker, bounded capture, canvas regions, deterministic matching, semantic tree, local persistence, MCP reads | Pure-function tests, real loopback HTTP/WS clients, stdio MCP process, Chromium editor flow |
| P1 / #5 | Verbatim spec extraction across snapshots, many-to-many links, approval, undo/redo, approved export | Domain/store/API tests and browser approval/export/reload |
| P2 / #6 | Optional OpenAI-compatible multimodal draft provider, bounded selected scopes, per-request external consent, protected proposal queue | Local fake HTTP provider, malformed response tests and browser consent controls; no external inference |
| Release / #7 | Install guide, development plugin build, runtime bundles, CI browser checks | Local build and test commands; Desktop/policy/license/release gates remain open |

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
```

`check` runs TypeScript, all Node tests, both plugin builds, the React build and
server/MCP bundles. The browser suite needs Chromium (`npx playwright install
chromium` if unavailable); it uses `/usr/bin/chromium` when installed. Tests use
temporary directories, self-generated designs and local mock providers only.

Executed on this development branch: **83 Node tests passed, 5 Chromium browser
tests passed, TypeScript passed, both plugins/web/server/MCP builds passed, and
both fixture manifests passed schema/provenance checks**. The server's final
encoded-ID/error-message adjustments were followed by its 13 focused passing
tests and TypeScript. Browser screenshots were visually inspected using only the
generated demo. Hosted CI results belong to the PR; this log records local runs.

Covered cases include disconnect/reconnect/replacement/cancellation, exact and
aggregate matching, equal/overlapping BBoxes and tolerance boundaries, coordinate
round trips, source-file identity, hierarchy integrity, many-to-many specifications,
atomic persistence, stale revisions, approval invalidation/protection, oversized
messages/previews, bounded extraction and provider schema/reference failures.
MCP tests spawn the actual stdio adapter and talk through the actual HTTP server
to a synthetic WebSocket plugin emulator. That emulator is not Figma Desktop.

## Actual Figma observations

The previously verified synthetic file is
`https://www.figma.com/design/4dKjnCZ8lTY8fVXUugJGxP`. A new read-only remote Plugin
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

## Gate status and next acceptance work

| Gate | Status | Missing evidence |
| --- | --- | --- |
| F0 enterprise permission | Not evaluated | Target installation/local-network/data-handling policy; no inference permission assumed |
| F1 Desktop bridge | Local transport and MCP process verified; Desktop pending | Follow install/pair/capture/highlight/disconnect/reconnect protocol in `desktop-verification.md` |
| F2 bounded performance | Generated adapter scale checks and small live native export measured | Authorized large real frame, native memory and failure rate |
| F3 coordinates | Pure transforms/browser overlay tests; small live dimensions match | Desktop pixel landmarks, scale/pan, masks/clipping and nested transformed nodes |
| F4 matching | Deterministic generated cases verified | Labeled real-world corpus precision/recall and semantic ambiguity rates |
| F5 productivity | Not measured | Timed manual/tool/AI-assisted human study including corrections |
| F6 security | Token/origin/bounds/approval/proposal checks executed | Actual Codex installation plus second client, target environment review and release signoff |

The next concrete action is the [Desktop acceptance protocol](desktop-verification.md).
It states the exact commands, selected nodes, expected results and evidence to
record; it requires access to a user's running Desktop installation. No such
installation was available in this execution environment, so that end-to-end
acceptance remains open instead of being marked successful.

No public candidate became a verified structural fixture during product work.
The five research candidates remain conditional candidates with the access and
license caveats in the [fixture report](fixture-evaluation-results.md). Only the
synthetic Figma file was inspected live; automated product tests use generated
data. No public/private Figma source text, PNG or full-document dump was added.

## Known limits

- One active plugin session. Captures are immutable observations, not guaranteed
  Figma revisions; automatic source-change reconciliation is deferred.
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
- License selection, packaged installer, source reconciliation, migration across
  future schema versions and plugin publication remain release/backlog work.
