# Fixture analysis metric contract

The analyzer measures one explicit Page or container subtree. It does not infer semantic components, classify UI copy versus specifications, or run the historical bottom-up text/LLM boundary algorithm. Public reports contain aggregate metadata only. `extractScope` is a separate reusable adapter boundary; its bounded scalar records retain original node IDs, parent IDs, absolute BBoxes and visibility without exporting names or text. Product spec extraction must preserve exact source text in its separate authorized local store.

## Scope and completeness

- Root depth is **0** and the root itself is counted. A Page run includes its PAGE node. DOCUMENT is never traversed.
- All structure metrics describe the visited pre-order prefix. `extraction.complete: false` means these are **not** whole-scope totals. `scopeNodeCount` then says `not measured`; `structure.nodeCount` remains the observed lower bound.
- `wholeFileNodeCount` always says `not measured`. To obtain totals, deliberately enumerate page IDs, run one bounded Page at a time, record every page and revision, and aggregate only complete disjoint scopes. Nested scopes must never be summed. Distinguish PAGE-inclusive node counts from scene-node counts and report unvisited pages explicitly.
- `spatial.complete` describes the analyzed prefix only, independently of extraction completeness. A complete spatial pass on a truncated extraction is not a complete scope measurement.
- Source revision can be null: repeated reads are not transactionally pinned snapshots. A designer changing the file during a run can invalidate comparisons.

## Denominators and geometry

| Field | Definition |
| --- | --- |
| `typeCounts` | Counts by exact source node type, including the selected root. |
| `maxDepth`, `meanDepth` | Maximum and arithmetic mean of scope-relative depth over all observed nodes. |
| `frameGroupComponentInstanceRatios` | Each named type count divided by all observed nodes. COMPONENT_SET is separate, not folded into COMPONENT. |
| `autoLayoutRatio` | Active `layoutMode` count divided by FRAME, COMPONENT, COMPONENT_SET and INSTANCE count; null if there are no eligible containers. Active means a reported mode other than NONE/null (including GRID). |
| `textNodeRatio` | TEXT count divided by all observed nodes. This does not identify specification text. |
| `textNodesPerMillionSquarePixels` | TEXT count / selected root's positive BBox area × 1,000,000. Page roots have no inferred canvas area, so `not measured`. This is node density, not glyph coverage. |
| `hiddenNodeCount` | Nodes whose own `visible` property is false; not inherited/rendered visibility. Descendants of a hidden ancestor may have `visible: true`. |
| `boundedNodeCount` | Nodes with positive-width, positive-height absolute BBoxes; missing/zero-area boxes are excluded from pair geometry. Invalid non-finite/negative boxes fail validation. |
| `exactEqualBoxPairCount` | Unordered pairs with exactly equal x, y, width, height, counted by exact hashing. |
| `exactEqualBoxNodeRatio` | Bounded nodes participating in at least one exact pair / bounded nodes. Computed independently of pair budget. |
| `nearEqualBoxPairCount`, `nearEqualBoxNodeRatio` | All four rectangle edges differ by at most `tolerancePx`; includes exact pairs. Ratio uses participating bounded nodes, not pair count. |
| `overlapPairCount`, `overlapPairRatio` | Positive intersection area; touching edges do not overlap. Ratio denominator is all possible unordered bounded-node pairs, n(n−1)/2. |
| `containmentPairCount` | Exactly one direction satisfies tolerant containment. Mutual tolerant containment is ambiguous equivalence and excluded, preventing equal-box parent cycles. |
| `containmentWithoutAncestryRatio` | One-way geometric containment pairs whose outer node is not an original ancestor / one-way containment pairs. This is disagreement, not proof of an erroneous tree. |
| `directParentNotContainingRatio` | Valid bounded child/parent edges where parent fails tolerant containment / examined bounded child/parent edges. Parents outside the selected scope are excluded. |

The sweep sorts by x and skips pairs that cannot overlap or contain at the selected tolerance. `pairChecks` is the actual candidate pair work, not the denominator of overlap rates. Dense overlapping documents can still have quadratic candidates: `maxPairChecks` stops that work. When spatial pairs are capped, reported pair counts are observed lower bounds and the corresponding rates say `not measured`; exact hash and direct-parent statistics remain independently complete over the extracted prefix.

Absolute BBoxes are axis-aligned rectangles. They do not represent rotated silhouettes, masked/clipped rendered area or occlusion. Hidden nodes are included by the adapter when the runtime supports disabling hidden-instance skipping; the wrapper records an explicit limitation otherwise. No geometric score expresses semantic certainty.

## Budgets, timing, bytes and memory

Default budgets are 10,000 nodes, 2,000,000 serialized record bytes, 5,000 ms, and 250,000 candidate pair checks. Runtime validation also enforces hard option ceilings of 100,000 nodes, 20,000,000 record bytes, 60,000 ms and 2,000,000 pair checks. Budgets apply to the explicit scope only. Re-run a smaller selected container when capped; this version does not resume a cursor or infer the missing remainder.

Traversal is iterative, retaining native children handles only along the active branch and bounded lightweight records. The host may allocate a sibling array when `.children` is read; node/record limits do not bound Figma's internal document memory. No `loadAllPagesAsync`, recursive whole-document `findAll`, REST file dump or image export is used.

`extractionMs` covers traversal/property reads, record validation/serialization and optional cooperative yields. `spatialMs` covers spatial analysis. `totalMs` covers analyzer execution through report construction before final JSON-size accounting. The live runner uses `Date.now` with millisecond resolution; sub-millisecond work can measure 0 ms. Generated benchmarks use `performance.now`. These timings exclude page navigation/loading, editor launch, transport and UI download. Budgets are checked between node/property and pair reads, so a blocked Figma API call cannot be preempted.

`recordNdjsonUtf8` is the exact size of the bounded scalar records encoded as JSON lines, including one LF per record. This records the cost of the local metadata representation; those records are **not** sent by the aggregate-only plugin. `reportJsonUtf8` is the aggregate JSON's UTF-8 size including its own size field, without a trailing LF. Neither is network transfer: `networkTransfer` says `not measured` because Figma/MCP transport and internal page-loading bytes are not exposed.

Plugin heap and server peak memory say `not measured`. Serialized bytes are not heap bytes. Generated Node benchmarks separately record `process.memoryUsage()` snapshots and process-wide cumulative `process.resourceUsage().maxRSS`; these include startup/generator/previous cases, are not peak analyzer heap, and do not establish Desktop memory behavior.

## Verification boundary

`npm test` uses generated synthetic nodes and mocked adapters. It checks deterministic geometry against a brute-force oracle, equal-box guards, ancestry disagreement, deep iterative traversal, limits, timing stops, UTF-8 byte accounting and privacy of aggregate outputs. Passing these tests is not a successful Figma Desktop integration test, nor an F0–F6 feasibility gate pass. See [manual plugin procedure](fixture-plugin.md) and the dated evaluation reports for actual live measurements.
