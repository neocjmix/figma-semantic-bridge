# Data Contracts — Draft

Use versioned runtime-validated schemas. These are conceptual types, not frozen API signatures.

```ts
type Rect = { x: number; y: number; width: number; height: number };
type Origin = "human" | "ai";
type ReviewStatus = "proposed" | "approved" | "rejected";
type Role = "page" | "section" | "component" | "element" | "specification" | "ignore";
type MatchType = "exact" | "contained" | "partial" | "aggregate";

interface SourceNode {
  id: string;
  parentId?: string;
  type: string;
  name: string;
  bbox: Rect;
  text?: string;
  visible: boolean;
  sourceFileKey: string;
  sourcePageId: string;
  childrenIds?: string[];
}
interface SourceReference {
  nodeId: string;
  matchType: MatchType;
  coverage?: number; // geometry only, not calibrated probability
}
interface Annotation {
  id: string; // independent from Figma node ID
  name: string;
  role: Role;
  bbox: Rect; // Figma document coordinates
  parentId?: string;
  childIds: string[];
  sourceRefs: SourceReference[];
  origin: Origin;
  reviewStatus: ReviewStatus;
  revision: number;
}
interface SpecRelation {
  targetAnnotationId: string;
  relationType: "describes" | "behavior" | "constraint" | "interaction" | "dependency";
  reviewStatus: ReviewStatus;
}
interface Specification {
  id: string;
  text: string; // exact extracted text
  sourceRefs: SourceReference[];
  relations: SpecRelation[];
  origin: Origin;
  reviewStatus: ReviewStatus;
}
```

## Required envelope
Persist schemaVersion, source file/page/scope identity, source revision/fingerprint if available, coordinate transform, annotations, specifications, provenance and unresolved questions. Track patch history for undo and audit.

## Invariants
- Semantic parent graph is acyclic; spatial overlap is allowed.
- Source node may be referenced by multiple annotations and vice versa.
- Specs link to multiple components and components to multiple specs.
- Missing/stale source references do not delete annotations.
- AI patches cannot silently overwrite approved human records.
- Original text remains verbatim; interpretation is separate.
- A geometry score is not semantic certainty.

## Schema implementation tasks
Define Zod/JSON Schema validators, migrations, stable ID strategy, patch operations, optimistic concurrency and import/export canonicalization. Test equal BBoxes, tolerance ties, rotations, clipping, hidden layers, conflicting specs and missing nodes.
