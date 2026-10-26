# Plan for interrupted imports, source reuse and targeted completion

[한국어](recovery-plan.ko.md) · [Current scenarios](user-scenarios.en.md)

**Plan dated 2026-10-26 · distinguishes 0.2.1 delivery from proposed follow-up work.**


0.2.1 implements the single normal import, automatic use/binding of successful observations, image/resource settings and same-connection budget increase/resume first. Cross-session supplementation, partial-structure browsing and per-region coverage remain proposed work.

The goal is to **continue using received evidence after interruption, acquire the
remaining required evidence, and finish human review and approval**. Correctly
finishing the original task takes priority over apparent speed or success.

**Product rule: provide one workflow.** Users do not choose acquisition modes,
read order or cache strategy. The app chooses a correct route with less unnecessary
Figma work and repetition. This is not a claim of fastest performance for every file.

## Intended workflow

**Add source → work on regions and requirements → confirm sources → approve meaning
→ share**

1. Select a Figma area and use **Add source**. Open permitted source files through
   the same entry point. Input origin differs; the subsequent workflow does not.
2. The app checks saved evidence and plans necessary reads. The default scope is
   the entire selected area, with explicit discovery and required-field coverage.
   There is no separate acquisition-mode selector. Show the target, baseline
   limits and known risks on the start screen before heavy reads begin.
3. Open the same workspace immediately. Received images and records are saved and
   become usable automatically. Region and requirement work drives preparation of
   needed text and branches. Distinguish ready and unknown portions without
   silently reducing whole-area requirements.
4. After interruption, keep working with received evidence. One **Continue** action
   checks connection, changes and gaps, then resumes or supplements appropriately.
   Users do not diagnose the recovery strategy.
5. Review regions with sufficient evidence, keeping the original task's incomplete
   state separate from individual reviews and approvals.

For example, an interrupted whole-screen collection keeps its image and received
nodes in the same workspace. **Continue** lets the app select supplementation.
Completed smaller areas may be reviewed while the original whole-screen request
remains pending.

## Choices to remove and decisions owned by the app

| Current or previously proposed choice | Replacement |
| --- | --- |
| Overview only / structure only / either read order | Remove; the app determines evidence and order needed for the current task |
| Small capture / large collection / selective inspection | Remove separate starting routes; one task uses appropriate internal reads |
| Create image draft / use structure without image | Remove separate recovery actions; valid received evidence is used in the same workspace |
| Resume / restart / supplement / reuse stored evidence | One Continue action selects the route using provenance, changes, coverage and cost |
| Enter node IDs / request child-list pages / collect a branch | Remove from normal UI; search, Figma selection and region work drive source reads |
| Save capture / add structure / attach image as separate finishing steps | Save validated evidence and bind it to the task automatically |
| Move between several acquisition-history panels | One workspace evidence-status and history view |
| Small capture transfer versus large structure transfer | One standard route for new source transfers; keep older-file import compatibility |

Do not relocate these choices into an advanced-settings menu. Retain internals
needed for older files and agent compatibility under the same task management and
validation rules. Agent tools should expose task requests, progress and evidence
reads rather than redundant acquisition strategies for the same goal. Compatibility
adapters must not create a separate acquisition workflow.
Source-file opening, backups and reviewed-context sharing serve
distinct purposes and remain where needed.

Human decisions remain: **what to work on, which source and meaning are correct,
whether to change scope, whether material extra cost/risk is acceptable, and
whether external transfer is allowed**. Source confirmation and meaning approval
remain separate human judgments rather than being automated or collapsed.

## Required distinctions

| Question | Required evidence |
| --- | --- |
| Was it received? | Requested IDs, fields or child inventories were received, validated and saved |
| Is the area covered? | Every required branch was examined; node counts and geometric overlap alone do not establish this |
| Does it match today's source? | Explicitly record what was rechecked and when; reopening history is not a freshness check |
| Did a person review it? | Explicit source-set and meaning approval supported by sufficient evidence |

**The current plugin route does not supply an immutable source revision across
reads.** After reconnecting, it cannot guarantee both that all old evidence is
current and that reading only missing portions will suffice. An unchanged root
name or bounds, or a user's statement that they made no changes, is insufficient.

Keep observation times for reused and newly read evidence. Distinguish coverage
of a stored evidence view from a guarantee that it represents the entire live
design at one instant. If the latter is mandatory and no validated provider route
supports it, leave that requirement unsupported.

## Delivery order and acceptance criteria

| Order | Work | User outcome | Acceptance criterion |
| --- | --- | --- | --- |
| 0 | Small feasibility experiment for reuse after reconnection | Establish safe reuse and reread conditions | Record outcomes for internal changes with unchanged root name/bounds, and added, deleted or moved layers |
| 1 | One workspace with automatic use of successful evidence | Draw from received images; use complete structure without an image | No mode choice or separate result-saving steps; failure, cancellation and reload preserve valid results without duplication |
| 2 | Partial evidence browsing and durable requirements | Inspect received nodes/text and make proposals; see missing portions and completed branches | Restart preserves evidence, outstanding coverage and provenance; absent or corrupt evidence remains unresolved |
| 3 | Targeted supplementation and reconnect recovery | Reuse eligible data while requesting required branches, nodes or text | Changes, deletion, reordering and lost replies cannot create missing or duplicate coverage or silently reduce the original task |
| 4 | Region-level review tied to overall task status | Review completed small areas on the existing large image; keep other work pending | Each approval has sufficient scoped evidence and fields; unknown areas do not enter complete or approved results |
| 5 | Remove duplicate routes; guides, compatibility and release | One workflow with one primary action per state, preserving existing work | Old selectors and duplicate panels removed; regression, owned native Figma, package, backup and restore checks pass |

0 and 1 can proceed independently. 3 depends on 2's durable coverage model; 4
builds on those results. A UI-only improvement is not completion of recovery.

## 0. Prove supplementation conditions first

- Reconnect while preserving prior inventories, text and observation times.
- Change internal text, layers, parents and order without changing root name/bounds.
- Measure which parent inventories must be reread to discover unreceived branches.
- A child count without its unreceived IDs is not a known list of missing nodes.
- If reuse validation approaches full traversal cost, report it. Do not default
  to checks that cost more than reacquisition.

Even if this experiment blocks safe supplementation, stages 1 and 2 remain useful
and can proceed: received evidence should remain inspectable for proposal work.

## 1. Use successful images and structure independently

- Prepare the workspace on Add source and allow drawing there when the image
  arrives, without a separate visual-draft creation step.
- Complete structure remains usable there if the image fails. Retry the image
  only when the current task needs it.
- Preserve and bind validated evidence automatically, including stopped tasks.
  **Continue** processes only necessary outstanding work.
- Preserve conflicting observations separately instead of combining changed sources.
- Creating a draft must not redirect an ongoing read. Late results cannot replace
  another workspace's or draft's evidence.

## 2. Persist received and missing evidence explicitly

- Track metadata, immediate-child inventories, text and images separately. Unread
  text is different from empty text, not requested, or failed.
- Page through validated saved evidence. Fetch exact text only when selected;
  enlarging a received image does not call Figma again.
- Allow inspection and proposals from partial evidence. Position suggestions must
  say they search received evidence, not the whole source.
- Record provably complete branches separately; unexamined siblings and outside
  layers remain unknown.
- Open validated interrupted 0.2.0 records as well. Do not invent child IDs or
  historical text that were never stored.

## 3. Supplement without overwriting history

- Persist requests and validated results before advancing. Lost replies can be
  checked again without turning repeated evidence into duplicate nodes.
- Retain current same-connection resume. After reconnecting, start a new read
  that compares and reuses prior evidence; do not claim to restore a lost native
  reading position.
- Recheck affected branches on additions, deletions, moves and reordering.
  Matching names and bounds do not prove matching text or descendants.
- Append immutable observations. Distinguish conflicting values for the same ID
  and withhold merged completeness until those conflicts are resolved.
- Initially reuse verified complete branches without weakening the existing
  complete-collection contract. Expand to broader composed coverage only where
  missing-evidence checks are sound.

## 4. Complete and review the necessary area

- Preserve the large image and drawn regions. Improve source attachment so using
  a complete smaller source does not require drawing regions again.
- Start approval support with **fully covered branches**. Their success does not
  complete outside siblings or the containing image.
- An agent request explicitly naming IDs and fields can complete those
  requirements. Do not expose an ID-entry mode to ordinary users or silently
  convert region-wide discovery into a limited known-ID request.
- A component spanning branches needs evidence for all required branches. If
  unexamined areas may contain relevant layers, discovery remains incomplete.
- Preserve previous approvals with their historical sources. New evidence cannot
  overwrite them or inherit their approval; changed content needs new review.

## Planned interface states and primary action

These are proposed actions, not currently available buttons. Each state has one
recommended primary action. Evidence browsing and details stay in the same
workspace rather than creating acquisition-route choices. **Pause** remains
available during work; it is not an alternative algorithm choice.

| Situation | Explanation and app behavior | Primary action |
| --- | --- | --- |
| No source | Check selected source and create one task | Add source |
| Before starting | Review the target, limits and risks, then start preparing the same task | Start |
| Preparing evidence | Display received images and nodes in the workspace; save valid results | Pause |
| Image ready, structure interrupted | “You can work with this image. Only part of the source structure was received.” Region editing remains available | Continue |
| Structure ready; review possible without image | “Source nodes are usable.” Prepare review without an unnecessary image retry | Confirm sources |
| Required image failed | Preserve structure and prepare the necessary image retry | Continue |
| Paused in a valid connection | Retain saved parts and resume | Continue |
| Interrupted evidence after reconnecting | The app checks changes and chooses reuse, supplementation or necessary reacquisition | Continue |
| Material extra cost or broad reacquisition | Explain scope, reason and preserved work first | Confirm proceeding with that operation |
| Only some regions ready | Ready regions can be reviewed; the whole task remains incomplete | Pause if running, Continue if stopped |
| Reviewed region has sufficient source evidence | Review saved sources separately from other regions' readiness | Confirm sources |
| Sources confirmed | Review names, roles, bounds and relationships | Approve meaning |
| Meaning approved | Share approved evidence and meaning | Share |

When the total is unknown, do not invent percentages or time remaining. Show
actual received quantities and outstanding requirements. Before revalidation or
rereading, explain the scope, repeated work, uncertain cost and effects on drafts.

Automatic recovery stays within existing permission and budgets. Retry transient
failures only a bounded number of times and only for safely repeatable requests.
Do not repeat deterministic limits or data errors, or restart a native image
render that is still running. After app restart, restore the workspace but wait
for **Continue** before initiating heavy new source reads.

## Reducing cost and Figma load

1. Read saved evidence first, while distinguishing historical viewing from a live
   freshness check.
2. Acquire only required fields. Structure exploration need not read all text or
   render images. Requirements needing text must preserve the entire exact text.
3. Separate structural coverage from text coverage in the new route. Missing
   required fields remain incomplete; do not weaken existing complete formats.
4. Serialize heavy Figma reads. Local browsing, editing and validation can proceed
   together where they do not conflict. Do not render and traverse concurrently
   by default.
5. Retry only when the cause can be resolved; do not repeat deterministic limits.
6. Aim for affected-area revalidation, but expand checks when change locations
   cannot be trusted. Do not promise bounds on all native Figma memory or rendering.

## Verification and release gates

- Deterministic tests: repeated replies, forced exit after partial persistence,
  additions/deletions/moves/reordering, internal changes with unchanged root
  metadata, unloaded/empty/oversized text.
- Browser journey: **start → save some evidence → interrupt → restart app → open
  received evidence → supplement required area → confirm sources → approve meaning
  → read through a coding agent**.
- Single workflow: small/large sources, image/structure failures and reconnection
  must finish without acquisition-mode selection or separate history panels.
  Requiring user-entered limits, order or node IDs to recover is not success for
  the normal user journey.
- Negative checks: missing siblings, corrupt data, unread required text and
  unapproved meaning cannot become completed or approved output. Prior evidence
  and approvals remain intact.
- Native Figma: read-only interruption, reconnect, changes and text reads in an
  owned synthetic file; record source/selection preservation and request, node,
  byte and time measurements.
- Measure reused data, repeated reads, validation cost and original-task omissions;
  first-image latency or apparent speed is insufficient.
- Run the complete 0.2.0 regression suite, Korean/English review and upgrade,
  backup and restore checks. Target **0.3.0 Alpha** for the new evidence bindings;
  do not bump or replace released artifacts before implementation and validation.

Development, synthetic verification and packaging are agent-owned work. The
original production file and another owner's view-only account require permitted
access. If unavailable, leave those specific acceptance checks unverified while
continuing independent engineering.

The architecture proposal is [ADR 0012](adr/0012-recoverable-source-evidence.md).
This is a plan; [current scenarios](user-scenarios.en.md) describe shipped behavior.
