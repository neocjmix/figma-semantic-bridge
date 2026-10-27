# v0.5 UX prototype — reference only

> **PROTOTYPE IS EVIDENCE, NOT SPECIFICATION.** The product contract is [v0.5 replacement plan](../docs/plans/v0.5.0-replacement.md). This file records what the conversational interactive sketch was used to explore. It is NOT an implementation template, design system, visual target, code source, or acceptance oracle.

The user reviewed an interactive single-file HTML sketch in the planning conversation and judged the direction acceptable. The sketch is an experimental artifact, not a product sign-off. Do not infer approval of visual design, layout dimensions, color palette, DOM, CSS, event handling, state shape, or incomplete/buggy interactions.

## Accepted interaction concepts to carry forward
- Workspace gate before the editor.
- Two peer views: Canvas and Regions.
- Canvas partitions by Figma file/page; transferred image previews keep spatial relationships.
- Immediate naming on selection and continuous autosave.
- Regions shows two independently scrolling columns: UI hierarchy and Spec catalog.
- UI can nest under UI without depth limit; Spec references appear as ghosts under multiple UI entries while remaining in the Spec catalog.
- JSON/MCP provides semantic labels, hierarchy, relationships and Figma references; not raw source text, image, or Fig2Code implementation.

## Explicitly NOT accepted from the sketch
- Specific appearance, typography, color, spacing, dimensions, icons, or responsive behavior.
- Specific sample content, artificial Figma identifiers, localStorage persistence, synthetic images or mock-send button.
- The sketch's pointer/drag/drop behavior as correct or complete; it is exploratory, not production-ready.
- Any behavior that contradicts the plan, particularly incomplete reorder, accessibility, error handling, cross-page selection or persistence.
- Treating screenshot similarity or pixel matching as a test of success.

## Codex instruction
Design and implement independently from the normative plan and user-task acceptance scenarios. Do **not** copy the sketch's source, DOM, CSS or state model, or run screenshot-diff tests against it. A materially different UI is preferred if it better satisfies the user tasks. If the sketch conflicts with the product contract, the contract wins. The sketch's exact HTML file was supplied in the planning conversation and is not needed as a build/runtime dependency.

The prototype may be attached as a separate non-build artifact later; do not introduce it into application imports, CI, bundling or deployment.