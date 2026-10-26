# Interrupted imports: implementation and acceptance plan

[한국어](recovery-plan.ko.md) · [User scenarios](user-scenarios.en.md)

**Updated 2026-10-27 for the 0.3.0 implementation.** This records delivered recovery
behavior and its boundaries. Executed source, browser and installed-app checks are in
[0.3.0 acceptance](evaluation/release-0.3.0-acceptance.md); the release attachment
records the final package provenance and hashes.

The goal is to keep received evidence useful after interruption and obtain enough
source to finish human review, without omissions or silently shrinking the original
request. One workflow remains: **Add source → work on regions and requirements →
confirm sources → approve meaning → share**.

## Implemented scope

| Need | Current behavior | Important boundary |
| --- | --- | --- |
| Use an image when structure stops | Preserve the image and proposed regions independently | Image pixels alone do not permit source approval |
| Inspect an interrupted import | Page through verified received nodes and exact saved text; show observed child counts and complete branches | Received records do not establish unseen siblings or current Figma freshness |
| Continue in the same live session | Resume the next acknowledged packet when the cursor remains valid | Idle expiry, source changes and reconnect can invalidate the cursor |
| Continue after reconnect or restart | Explain the repeated work, require confirmation, then revalidate the pinned original source into a new generation | All fields needed for whole-scope freshness are reread; no atomic Figma revision is available |
| Reuse equal saved packets | Compare exact canonical content after a real read and return a compact receipt | Saves transfer; it does not skip required native getters |
| Finish a known incomplete container | Read that container and its descendants as a focused part; preserve original image context and parent task | Unrelated subtrees are not traversed; the broader task stays incomplete |
| Review a complete small part | Bind a verified closed subtree to a separate review scope and copy eligible proposed regions | Approval covers only the declared branch and does not transfer old approval |
| Use a coding agent | Four normal task tools cover acquisition, status, continuation and saved evidence | Older acquisition calls remain compatibility adapters, omitted from normal discovery |
| Transfer source evidence | Standard V2 files carry complete collections, closed branches or complete bounded captures; older files remain readable | No annotations, specifications or approvals transfer; incomplete whole scopes stay incomplete |

Focused acquisition may require releasing a broader paused reading position.
The app explains that continuing the broader import later will require rereading
and obtains confirmation before releasing it. Fresh source membership is checked
first: a node moved outside the original scope is refused without discarding the
paused cursor. Focused tasks retain their enclosing scope and historical image
provenance through restart and continuation.

## What the app does automatically

Normal users do not choose overview-only, structure-only, read order, small versus
large capture, raw node IDs or a recovery algorithm. The app saves valid results,
selects valid continuation and exposes evidence in the workspace. A person still
chooses which area to work on, confirms source membership and meaning, and decides
whether material repeated work or external transfer is acceptable.

The normal MCP surface is `acquire_source_task`, `get_source_task`,
`continue_source_task` and `read_source_evidence`, alongside project, approved
context and proposal tools. `acquire_source_task` prepares without starting heavy
work; starting is explicit. Its part-plan/part actions serve an identified saved
container. Compatibility calls retain their previous contracts; they are not
advertised as alternative workflows or a promise of identical orchestration.

## Evidence, coverage and freshness

These questions have separate answers:

- **Received:** the requested records were validated and saved. Missing text is
  different from an observed empty string.
- **Covered:** every required descendant of the declared root was received.
  Validated preorder and direct-child counts can prove a closed saved subtree,
  but cannot invent the IDs of unread children.
- **Fresh:** a stated set of fields was reread at stated times. Opening saved
  evidence does not revalidate it. Equal root names or bounds are insufficient.
- **Reviewed:** a person confirmed the source set and separately approved meaning.
  Source acquisition never supplies that judgment.

A reconnect creates a new immutable acquisition generation. Revalidation includes
text and ordered records, so matching root metadata does not hide internal text
changes, additions, deletions, moves or reordering. Exact packet reuse only follows
that read. Old observations, drafts and approval bindings remain intact. The image
and structure retain their separate observation times, and neither is declared an
atomic current Figma snapshot.

The feasibility experiment found exhaustive selective freshness checks more
expensive than ordinary traversal for the synthetic tree. The default therefore
uses one revalidation traversal, not a selective pre-scan followed by another full
read. See [measured feasibility](evaluation/recovery-feasibility.md).

## Where lazy work reduces cost today

Saved metadata is paged and exact saved text is requested only when the UI or agent
needs it. Reopening or enlarging a retained image does not render Figma again.
A focused part avoids unrelated branches and does not repeat the historical image
export. Local evidence reads and editing can proceed while plugin work is paused.

**Native structure traversal still reads complete records, including exact TEXT,
for every node in the requested subtree.** Lazy local text queries do not mean
Figma text getters were skipped. Metadata-first native traversal with independently
fulfilled text requirements is deferred: it requires an additive coverage contract
and must not weaken existing complete-source guarantees. Arbitrary compositions of
incomplete branches also remain unsupported. A component spanning separate branches
still needs sufficient evidence for the full declared review scope.

## Continuation, retries and resource budgets

**Continue** resumes a valid cursor or explains the necessary source recheck.
Restoring the workspace never starts heavy reads automatically. When totals are
unknown, show actual received counts and status, not invented percentages or
remaining-time estimates. Node/byte/time limits pause after durable packets;
resource settings can be increased before continuation within safety ceilings.

A fast `PLUGIN_BUSY` structure response may be retried **once**, after 250 ms,
with the same packet command and only inside its original packet and run deadlines.
Pause, cancellation, session replacement or an exhausted budget prevents the retry.
A second busy response or timeout pauses for Continue. A lost reply can then reuse
the cached packet without duplicate nodes. Timeouts are not automatically repeated,
because they have already consumed their request budget. Image export, deterministic
schema/coverage failures and source changes are never automatically retried.

Figma can still allocate an entire native child array or continue an image render
before it returns control. Application budgets do not guarantee native peak memory
or instant cancellation. No whole-document preload or source edit is required.

## Acceptance and release gates

| Layer | Required evidence |
| --- | --- |
| Deterministic and local integration | Partial persistence/restart, exact text including empty and Unicode values, corrupt or missing packets, closure/count validation, changed internal text and inventories, lost replies, bounded retries, source membership, immutable history and deletion races |
| Scoped acquisition | Requested subtree only; no unrelated native child/text reads; no duplicate image; original task stays incomplete; restart retains enclosing scope and context |
| Browser journey | Start → partial save → interruption/reload → inspect received evidence → finish a needed part → confirm sources → approve meaning → agent reads approved scope |
| Compatibility | Old projects and source files remain readable; legacy MCP calls remain callable; all new exports use the standard transfer route |
| Native fixture | Read-only owned Figma fixture verifies plugin lifecycle, cursor loss/recovery, exact text, retained image and scoped acquisition without source mutation |
| Final package | Complete source/build/browser checks, bilingual writing, packaged app/plugin/MCP, upgrade backup/restore, artifact hashes and local installation |

Implemented source and focused passing tests are not substitutes for the final
browser/native/package journey. Target **0.3.0 Alpha** only after those agent-owned
gates are recorded. The original production file, an effective Dev-only account
on another owner's can-view source, and organization policy require permitted
access or human decisions; if unavailable, report those checks separately.

[ADR 0012](adr/0012-recoverable-source-evidence.md) records the design decisions.
[User scenarios](user-scenarios.en.md) describe the user-facing behavior and limits.
