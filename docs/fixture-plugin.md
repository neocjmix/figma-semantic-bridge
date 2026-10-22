# Bounded fixture measurements

This development plugin evaluates one explicitly chosen container or the current
page. It does not alter document nodes, annotations, selection, or viewport. It
does not make network requests. The same TypeScript analyzer is bundled for the
Figma MCP Plugin API. Building the bundles does **not** establish that either
runner has executed successfully in Figma Desktop.

## Figma Desktop procedure

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
