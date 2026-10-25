# Fixture registry and measurement conventions

The registries contain source links, permission evidence, observations and aggregate
results. They do not contain third-party Figma documents, screenshots or copied
specification text. A public URL does not establish a license. `rawRedistributionApproved`
is false for every current entry, including those whose Community page displays
CC BY 4.0. Source use, actual duplication and third-party asset rights are separate
checks.

## Publication and local acquisition

The tracked public-candidate fixtures are links, our evaluation notes and aggregate
measurements, not copies of the designs. The demo pixels are generated from
self-authored HTML. No third-party `.fig`, source JSON, screenshot or exact source
text is required to build, package or run CI. Keep these metadata and synthetic
fixtures tracked; excluding them for a design-file license would discard useful
test evidence without removing any redistributed design file.

Acquire a real test file only when a specific manual Figma test needs it. First
check that file's current license, attribution and copy/test terms. For a permitted
Community file, use Figma's **Open in Figma** to make a personal copy; an ordinary
shared file needs its own permission basis. Keep any downloaded `.fig`, captured
PNG, source JSON/text, analyzer report and copy identity under the ignored
`.fixture-local/` directory. Do not put them in `fixtures/`, package assets or CI,
and do not edit the author's original. The existing `.gitignore` excludes
`.fixture-local/` and `*.fig`; it does not erase files already tracked by Git.

The synthetic registry includes a user-supplied Figma design URL and file key.
The owner approved disclosure of that link and key for the 0.1.1 alpha source
release. This approval does not grant permission to redistribute the design file,
its screenshots or any third-party assets.

- [public/manifest.json](public/manifest.json): five conditional public candidates.
  No public candidate has a measured node scope in this evaluation.
- [synthetic/manifest.json](synthetic/manifest.json): the existing small Figma baseline,
  retained as `limited-use` for functional checks.
- [manifest.schema.json](manifest.schema.json): version `1.0.0`, JSON Schema draft 7.
- [public/evaluation/candidate-comparison.md](public/evaluation/candidate-comparison.md):
  candidate comparison, evidence limits and promotion conditions.
- [synthetic/live-figma-measurements.json](synthetic/live-figma-measurements.json):
  actual official Figma MCP Plugin API observations, not a Desktop/local-bridge run.
- [synthetic/benchmark-results.json](synthetic/benchmark-results.json): generated
  in-process synthetic trees, a different data source from the live Figma file.

Run from the repository root:

```sh
npm ci
npm run fixtures:validate
npm test
npm run typecheck
```

The validator checks the schema, URL/file identity consistency, unique fixture IDs
and qualitative dimensions. Tests reject missing measurement evidence, numeric
Community IDs masquerading as file keys and candidates claiming verified structure.
This validates record shape and consistency; it does not independently verify a
license, observation or source document.

## Reading results

Every manifest metric is either `measured` with value, unit, scope, method and evidence,
or `not measured` with a reason. Unknown values must not become zero. Source-description
claims and LLM interpretations are explicitly separate from observations.
`verification.status` is a fixture adoption state; `structureVerified` requires at
least one complete bounded Plugin API analysis with a report, and refers only to
the listed scopes. `validated` additionally requires image review and, for public
files, observed license evidence and successful duplication with a recorded copy
key. A scope's `complete` flag refers to its stated inspection method, not the whole
file. A date-only `checkedAt` records day precision; do not invent a time when one
was not logged.

Each analysis includes its root at depth 0. The live page result includes the PAGE
node: 80 nodes = 1 PAGE + 3 FRAME + 20 RECTANGLE + 56 TEXT. The frame results include
their FRAME roots. Do not sum the page result and its overlapping frame results.
The analyzer leaves the whole-file count `not measured`; a bounded page result and
an earlier page inventory are not an atomic, versioned document traversal.

Ratios have different denominators. Container and text ratios divide by all scope
nodes. Auto Layout divides by FRAME, COMPONENT, COMPONENT_SET and INSTANCE counts.
Equal/near-equal BBox
ratios count participating nodes divided by nodes with valid BBoxes; near-equal
includes exact equality. Overlap divides positive-area intersecting pairs by all
possible bounded-node pairs. Containment excludes mutual containment to avoid
equal-box cycles. Ancestry disagreement is a geometric diagnostic, not semantic
boundary accuracy. The analyzer records its tolerance and budget with each result.

A PAGE has no positive-area BBox, so per-area text density is `not measured` there;
the text-node fraction remains measured. AABBs do not resolve masks, clipping,
rotated silhouettes or visual occlusion. Hidden nodes are included. If extraction
or pair analysis stops at a budget, only the visited scope prefix/pairs are known;
never extrapolate them to the page or file.

Byte counts describe UTF-8 serialized records/reports. They are not heap memory,
actual network transfer or Figma's internal loading cost. Plugin memory and network
transfer remain `not measured`. Live timing uses two smoke observations per scope with a
millisecond clock; a 0 ms phase is below timer resolution. These values are not
cold/warm performance baselines.

## Repeating and promoting a fixture

Use the [read-only plugin procedure](../docs/fixture-plugin.md) to inspect
one explicit Page/Frame at a time. Record original and duplicate file identities,
page/root IDs, observation time, analyzer version and budgets. Record an immutable
source revision when available; otherwise keep it unknown. Freeze an authorized
local copy before longitudinal performance comparisons. A mutable public URL alone
does not make successive runs identical.

Promote a public candidate only after confirming permitted use/duplication and
examining both images and nodes for editable UI, explanatory text, flow/state
variety and meaningful hierarchy mismatches. Keep human-reviewed semantic labels
separate from geometric statistics. Public regression CI uses generated synthetic
structures; permitted real-file measurement is an explicit local/manual step.
