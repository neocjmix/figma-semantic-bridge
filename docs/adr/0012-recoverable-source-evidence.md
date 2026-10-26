# ADR 0012 — Recoverable partial evidence and explicit acquisition requirements

Status: proposed, 2026-10-26. **Not implemented or an accepted release contract.**
Extends [ADR 0009](0009-selective-source-acquisition.md); does not retroactively
change the complete-collection semantics of ADRs 0007–0008 or existing approvals.
See the [user-facing plan](../recovery-plan.en.md) and
[current behavior](../user-scenarios.en.md).

## Problem

Validated partial chunks survive interruption but cannot be queried or used in
the editor. The live traversal cursor cannot survive session replacement. Separate
selective observations cannot supplement a failed collection. Two-step import UI
also gates use of an otherwise valid image or complete structure on the other step.

## Proposed boundaries

1. Keep immutable observations and their provenance, exact requested fields,
   observation times, integrity checks and bounded storage. A mutable acquisition
   task references observations; it does not amend a completed collection.
2. Persist explicit task requirements independently of current Figma cursors:
   selected subtree discovery, chosen branches, or explicitly requested IDs and
   fields. A known-ID success never completes discovery of an image region.
3. Track metadata, text, image and ordered immediate-child coverage separately.
   Represent unread, partial, verified-for-request, failed and freshness-unknown
   conditions explicitly. Missing text is never an empty observed string.
4. A partial evidence view may expose only verified durable records under bounded
   paging. It supports inspection and proposed annotations. Any partial matching
   result is labeled as limited to observed records and cannot certify discovery.
5. Derive outstanding traversal from verified parent inventories and fulfilled
   branch requirements. Existing child counts can establish a closed subtree in
   validated preorder packets, but cannot manufacture unobserved child IDs. Persist
   paged ordered inventories where recovery needs them; no native array is a
   durable cursor. No whole-page preload is required.
6. On reconnect, start a new acquisition and reuse old observations only with
   explicit consistency semantics. Re-enumerate relevant parent inventories to
   detect new/missing/moved children. Root name/bounds, counts, hashes of local
   bytes and user assertions are insufficient freshness proofs. Validate all
   fields required by the claimed reuse guarantee; budget uncertainty remains
   unresolved rather than being bypassed.
7. The current adapter supplies no immutable cross-read revision. A composed view
   can declare complete coverage of its recorded observations, with their separate
   times, only after all coverage requirements are satisfied. It cannot declare an
   atomic current Figma revision. If atomic consistency is mandatory, return an
   unsupported requirement unless a separately validated provider supplies it.
   Revalidation may cost as much as reacquisition; measure before choosing defaults.
8. Start new approval support at verified complete branches. Define additive,
   validated bindings that allow an existing visual draft to reference those
   branches without implying coverage of its whole image. Same file/page and
   document-coordinate checks are necessary but not sufficient for completeness.
   Multiple-branch components retain explicit discovery requirements. Do not
   merely remove the existing SOURCE_INCOMPLETE gate.
9. Historical approvals retain their original bindings. Changed evidence creates
   a new review revision; no automatic replacement or transfer of approval. Exports
   identify exact evidence requirements/observations, their coverage and freshness
   limits. Unknown or insufficient required evidence cannot enter approved context.
10. Keep old schemas and existing data readable. Introduce versioned additive
    contracts for partial/composed evidence rather than assigning new meanings to
    old completion flags. Legacy partial records gain only facts verifiable from
    their saved bytes. Continue loopback authentication, source read-only behavior,
    untrusted-text handling, response budgets and explicit external-model consent.

Exact schemas, indexes, retention/pinning and migration must be finalized after
the feasibility tests, before implementing the broad storage/editor refactor.

## One user workflow

The subsequent 2026-10-26 user requirement supersedes the plan's earlier proposal
to expose acquisition-goal modes and separate salvage/recovery buttons. Provide
one flow: Add source → edit regions/requirements → confirm sources → approve
meaning → share. Bind selected-area scope and derived field requirements to one
durable task. Agent requests may explicitly define IDs/fields; this is not an
ordinary-user ID-entry mode. Do not silently narrow discovery to those IDs.

The internal planner selects compatible saved evidence, required validation,
missing reads and read order. Prefer correctness and original-scope completion,
then reduce unnecessary native reads and repeated work within budgets. Unknown
cost is not proof that a strategy is globally optimal. Serialize heavy plugin
work; lazily read exact text and images only as required by the task.

Remove user-facing overview/structure/order selectors, small-versus-large versus
selective route selection, manual collection attachment/commit, ID/child-packet
controls and separate retry/restart/supplement choices. Do not preserve them as
an advanced-mode alternative. Save and bind valid observations automatically;
source conflicts remain separate. Preserve compatible file readers and agent
adapters behind the same orchestrator and validation policies. Use one standard
new-source transfer route with older-file import support. Consolidate redundant
agent acquisition tools into task requests, progress and evidence reads, with
compatibility adapters routed through the same task planner.

Expose one primary action for each state. Continue routes pause, interruption,
reconnect validation and necessary recovery through that orchestrator. Inspection
and evidence details remain in the same workspace. Retain pause, human source and
meaning judgments, explicit scope changes and consent for material new cost/risk
or external transfer. Restoration of a workspace must not initiate heavy new
reads before Continue. Bound safe transient retries; never duplicate an active
native render or repeatedly retry a deterministic budget/integrity failure.

Acceptance must demonstrate the entire ordinary journey without mode choice,
user-entered algorithmic limits, node IDs or hopping between raw acquisition
panels. Partial evidence and old approvals retain all earlier safety gates.

## Delivery and proof

Run reuse/change-detection feasibility and independent import-step salvage first;
they need not depend on each other. Then implement a minimal end-to-end slice of
durable partial browsing and requirements, followed by reconnect supplementation
and scoped review. Serialize heavy plugin work; local reads may proceed separately.

Acceptance includes hostile/missing/reordered evidence, lost acknowledgements,
crashes at persistence boundaries, same-ID changed content, inserted children
despite unchanged root metadata, unknown outside ancestors, invalidated approvals,
Unicode/empty/unread text, original task preservation, and old-project regression.
Exercise the full browser journey and a bounded owned native Figma fixture.
Synthetic checks do not establish the original production-file behavior, native
peak-memory bounds, independent human correctness or external account permissions.

If safe reconnect reuse cannot be established within budget, preserve historical
inspection and drafts, identify the exact unmet requirement, and offer explicit
reacquisition. This is a supported fallback, not a successful supplement claim.
