# ADR 0013 — Configurable resource budgets and the normal resumable import

Status: implemented and verified on a matched native candidate, 2026-10-26.
See [0.2.1 acceptance](../evaluation/release-0.2.1-acceptance.md). Final release
provenance is separately bound by its clean-commit artifact verification.
User instruction extends ADR 0012: double capture image dimensions, allow resource
limits to be raised in settings, and avoid the default 5,000-node dead end.

The normal UI uses one pinned overview plus chunked structure collection. Keep
legacy bounded capture contracts for existing file/API compatibility; do not
raise Snapshot's embedded-node ceiling or pretend its truncated prefix resumes.
New normal imports never call that bounded metadata walker.

New imports request scale 2 and a 4,096px long-edge cap: a source previously
rendered at 800×600 becomes 1,600×1,200; a large 2,048px-capped overview becomes
4,096px-capped. Preserve original document coordinates. Settings permit scale up
to 4 and long edge up to 8,192px. PNG transport remains bounded; use up to 9 MB
within the existing 16 MB plaintext bridge envelope, not arbitrary memory limits.
Old commands omitting options retain their earlier image contract.

Persist authenticated, revision-checked settings locally. Defaults: 200,000 nodes,
64 MB, a five-minute run, 20-second structure response wait, ten-minute paused
cursor retention and 55-second image wait. Expose node/byte/run/wait/retention and
image budgets. Supported resource ceilings are one million nodes, 128 MB,
30-minute runs/retention, 120-second structure responses and 300-second image wait.
Packet size, integrity/approval gates and source provenance remain hard protections.
Raise collection cache disk safety ceiling to 512 MB to accommodate supported
collections; record count and transfer-file budgets remain separate limits.

At a configured node, byte or run budget, pause after durable data rather than
terminally failing. Node budgets stop at the exact next unread node. Byte budgets
reserve one bounded packet before requesting more data; this may pause early by
less than one packet. Resume reads updated settings while preserving the same
valid plugin cursor and chunk sequence. Native allocation/rendering is not
preemptible or bounded by these serialized budgets. Reconnect/source change still
invalidates this live cursor; durable cross-session supplementation remains ADR
0012 work and is not claimed here. Retention changes apply when the next packet
sets its timer, not retroactively to a cursor already expired.

The source task references its overview acquisition. Server execution serializes
overview and structure; image failure preserves a structure-only path. The editor
uses validated images automatically and attaches complete structure when clean.
Automatic writes use the same synchronous editor lock and revision checks as
manual writes, wait for unsaved edits, and must not affect another task/workspace.
Existing approvals are never transferred or changed by these new source bindings.

Tests must demonstrate actual 2× PNG dimensions/unchanged coordinates, a normal
import beyond 5,000 nodes, exact pause→settings increase→next-node continuation,
one native child-array read without duplicate PNG export, exact text preservation,
invalid/unauthorized/stale settings rejection, reload, image failure, pending-write
locks and unsaved-edit preservation. Existing old UI mode tests must be replaced
by the normal workflow; retain server/adapter compatibility tests. Distinguish
synthetic browser/adapter proof from an actual matched Figma plugin package run.
