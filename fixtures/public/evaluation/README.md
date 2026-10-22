# Real-world fixture evaluation

This evaluation extends the existing synthetic baseline; it does not replace it.
See [candidate comparison](candidate-comparison.md), [registry](../manifest.json),
and [access attempts](figma-access-attempts.json). The original Work research is
[preserved](../../../docs/research/public-figma-fixtures-2026-10-23.md).

## Evidence rules

- A Community description establishes what the author claims, not what is inside
  the editable canvas. A cover image is not a node inspection.
- A visible license or Open in Figma button does not establish successful duplication.
- A successful Plugin API read verifies only its recorded scope and observation time.
  A truncated traversal is a lower-bound sample, never a full-page or file total.
- A spatial containment mismatch is a geometric diagnostic, not a semantic error.
- An LLM assessment is an interpretation and remains unapproved until human review.
- No public candidate source JSON, original text collection, `.fig`, or screenshot
  is committed. The registry contains provenance, aggregate results and limitations.

## Why these experiments match the architecture

The historical approach reconstructed a tolerant BBox containment tree, then climbed
from text leaves and asked an LLM whether independent semantic groups or a UI/spec
transition had appeared. Equal boxes and tolerance can make geometric containment
non-antisymmetric; semantic boundaries also depend on the implementation task.
The analyzer therefore reports overlap, equal-box ambiguity and original-ancestry
disagreement independently. It does not create a semantic hierarchy or classify
text as a specification from geometry alone. Human annotations and many-to-many
spec links remain the product's authoritative interpretation layer.

This is a bounded F2/F4 experiment, not evidence that F1's Desktop/local-server/MCP
bridge works. The official remote Figma MCP execution environment differs from
the eventual Desktop plugin and local transport. Their timings are not interchangeable.

## Follow-up acceptance protocol

1. Confirm the resource's current license, attribution and third-party asset
   restrictions. Record original URL, author, observation date and copied file key
   separately. Perform an authorized duplicate in Figma Desktop if needed; verify
   the copy's node identities. Do not assume comments survive duplication.
2. Enumerate page identities only. Select a small UI flow with adjacent explanation;
   run the bounded analyzer on one frame or selected page. Increase limits only
   deliberately. Record every limit, truncation reason and source revision (or
   explicitly unknown revision). Do not sum overlapping scope counts.
3. Review a preview with its node outline. Classify UI copy, canvas spec TEXT,
   native annotations, comments and text baked into images separately. Proposed
   coverage target: ten UI screens across distinct flows, five explanatory text
   regions and two behavioral/policy rules; record actual counts even when smaller.
4. Have a frontend developer label ambiguous boundaries and spec-to-UI links.
   Keep original text and IDs locally with permission. Record multiple valid
   interpretations, no-match cases and one-to-many associations. Geometry is not
   semantic ground truth. No external inference on private copies by default.
5. Repeat cold/warm selected-scope runs at least five times per size; report median,
   range, failures, first-node latency, extraction and spatial analysis separately.
   Profile Desktop/plugin/server memory with an actual profiler; if unavailable,
   keep `not measured`. JSON payload size is not heap size or wire traffic.
6. Benchmark source grounding against reviewed labels (precision/recall, ambiguous
   candidate frequency, deterministic tie behavior). Compare annotation-only and
   AI-assisted review time including corrections. F4/F5 pass criteria remain open.
7. Promote a candidate only after rights, editable-node access, image-plus-structure
   review and required mixed-content coverage are all evidenced. Otherwise retain
   `candidate` or `limited-use`; do not fill missing metrics with zero.

## Technical limits

Plugin API page loading is controlled by Figma; our traversal and output budgets
cannot cap the editor's own loading or memory. AABB measurements do not model
rotated polygon geometry, clipping, masks or effective visibility. Equal/near
boxes are ambiguity signals, not duplicates of semantic components. Spatial
metrics exclude invalid/zero-area boxes and document their denominator. Measured
node density is not a measurement of explanatory/spec text density. Public files
can change without a pinned revision, so retain observation time and revalidate.
