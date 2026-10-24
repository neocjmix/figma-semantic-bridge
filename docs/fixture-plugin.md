# Bounded fixture measurements

This development plugin evaluates one explicitly chosen container or the current
page. It does not alter document nodes, annotations, selection, or viewport. It
does not make network requests. The same TypeScript analyzer is bundled for the
Figma MCP Plugin API. Building the bundles does **not** establish that either
runner has executed successfully in Figma Desktop.

## Figma Desktop procedure

The analyzer supports Dev Mode inspection as well as Design mode. For the
product permission gate, use a Dev-only account with view access to a permitted
source file; see [the separate acceptance procedure](desktop-verification.md#dev-seat-and-view-access-acceptance).
Running against a duplicate that you own is useful for fixture analysis but
cannot establish Dev-only access. Do not ask the author for edit permission just
because the remote Plugin API execution service rejects a read request.

1. Run `npm ci` and `npm run build:fixture-plugin` from the repository root.
2. Verify the source file's duplication and test-use terms. For Community files,
   obtain a permitted copy through **Open in Figma**. Record the original URL,
   copy URL, license evidence, observed version/date, and attribution locally.
   A numeric Community resource ID is not a design file key.
3. In Figma Desktop, import
   `plugins/fixture-analyzer/manifest.json` through **Plugins → Development →
   Import plugin from manifest**. If the client requires a generated development
   plugin ID, create a development plugin locally and retain its assigned ID in
   the local manifest; do not publish it as part of this evaluation.
4. Open the intended page and select one Frame, Group, Component, Component Set,
   Instance, or Section. Start with one representative screen and adjoining
   explanatory region before increasing scope. Run the development plugin and
   choose **Analyze selection**. No selection is an error, not permission to
   analyze the document.
5. Inspect the report's extraction and spatial completeness fields. A budget
   stop means a partial observation. Do not use its observed node count as the
   total for the selected scope. Split the scope into disjoint children and run
   again; record scope IDs to prevent duplicate counting.
6. Use **Analyze current page** only when page-wide measurement is intended.
   It uses the same limits and does not load any other pages. For each page,
   retain a separate result. A file total requires complete, non-overlapping
   coverage of every page, including hidden layers. Otherwise record
   `not measured` for the file total.
7. Download the aggregate JSON to a local ignored directory such as
   `.fixture-local/`. Record Figma Desktop version, OS, selection IDs, file
   revision (if exposed), date, and whether the run was cold or warm. Repeat
   at least five times in both cold and warm conditions when comparing timings; keep each run and record the cache/restart procedure.
8. Inspect the matching canvas scope manually. Record observed UI screens,
   explanatory TEXT, state variations, and source hierarchy separately from
   evaluator interpretations of component boundaries or spec associations.
   This analyzer counts TEXT nodes without reading their characters. It cannot
   prove that a text node is a specification. Do not commit original images,
   source text, or node exports without verified redistribution rights.

Defaults are 10,000 nodes, 2,000,000 serialized record bytes, 5 seconds, and
250,000 spatial pair checks with 0.5 Figma-document-pixel tolerance. The time
budget is cooperative: a synchronous Plugin API getter cannot be interrupted.
Figma's own page loading and its native memory allocation remain outside these
budgets. The runner temporarily sets `skipInvisibleInstanceChildren` to `false`
and restores its prior value, including after errors. This is a runtime traversal
setting, not a canvas edit. If a runtime does not expose the flag, the report's
`hiddenInstanceChildren` coverage is `not measured`; do not treat it as proven
complete hidden-layer coverage. Native children handles are visited branch by branch; the plugin does
not request `loadAllPagesAsync`, `findAll`, REST document JSON, or image exports.

## Recorded Desktop execution

On 2026-10-24, Figma Desktop 126.10.11 on macOS 26.6.2 completed four native
**Analyze selection** runs: a 21-node synthetic geometry scope and three permitted
Community-copy scopes containing 270, 21 and 2 nodes. All extraction and spatial
passes completed within the default budgets. The Community Auto Layout counts
were respectively 58/74, 7/7 and 1/1 eligible nodes. The nested two-node Frame is
already included in the 21-node Section; these are not disjoint file totals.
See the content-free [native analyzer aggregate](evaluation/native-fixture-analyzer.json)
and [completion record](completion-status.md#completed-native-aggregate-analysis).

An observed Desktop relay initially left the UI waiting after analysis. The UI
now accepts its immediate parent or the top window only when the latter has the
exact origin `https://www.figma.com` or `https://figma.com`. Focused
[built-UI tests](../tests/fixture-plugin-build.test.ts) cover those accepted paths,
unrelated-sender rejection, result display and button recovery. The native
result/download observations are separate from those simulated-window tests.

The original reports retained null file keys and measured hidden-instance-child
traversal as included; identities were not backfilled. Only the chosen subtrees
were analyzed, without page-wide traversal or source edits. SECTION structural
analysis is supported; it does not establish a mapped Section PNG for the product.
These are single native observations, not a cold/warm analyzer benchmark, whole-file
coverage, Dev-only permission acceptance, independent semantic labels or a
representative ten-screen corpus. Fixture adoption status is unchanged.

## Figma MCP procedure

Load the `figma-use` skill before each `use_figma` invocation. First discover only
page IDs; do not inspect every page's children:

```js
return figma.root.children.map(page => ({ id: page.id }));
```

Select an observed page and root ID. Read `dist/fixture-analyzer.mcp.js` as the
script prefix and append the following code, substituting those actual IDs:

```js
return await FixtureAnalyzer.analyzeFigmaScope(figma, {
  pageId: "OBSERVED_PAGE_ID",
  rootId: "OBSERVED_ROOT_ID",
});
```

Use one call per page; the wrapper switches page at most once. It verifies that
the root belongs to the requested page. It neither changes document nodes nor
creates a copy. The Figma service can still reject the operation because of
permissions, unsupported files, or access limitations. Preserve such failures as
access evidence and mark structural measurements `not measured`.

The report's serialized payload size describes application data, **not** total
network traffic. Plugin/process peak memory, Figma internal page-loading memory,
network transfer bytes, and image-export latency are `not measured` unless an
external profiler independently measures them. A Node.js synthetic benchmark is
not evidence of Figma Desktop performance or the F1 bridge feasibility gate.
