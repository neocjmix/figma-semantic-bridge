# ADR 0003: portable bounded capture bundles

Status: Accepted for the initial implementation on 2026-10-23, following the user's
request to proceed with the read-only access alternatives. Actual no-edit Dev-seat
acceptance remains a separate gate.

## Purpose

Consumers without Dev Mode cannot run the Design plugin with can-view permission.
A permitted producer can capture a bounded source in Figma and pass those observations
to a consumer for local semantic review. This adds an acquisition path and does not
change the source of truth, review workflow or approved-context export.

## Initial slice

- A single UTF-8 JSON file, kind `figma-semantic-bridge.capture-bundle`, version
  `1.0.0`, contains an exportedAt timestamp and one or two selected snapshots.
  Two scopes cover the common UI plus separate notes case without a page dump.
- Each entry contains an unchanged Snapshot and a SHA-256 digest of recursively
  key-sorted canonical JSON for that snapshot. Digests detect accidental corruption;
  they do not prove authorship, permission or correspondence to current Figma pixels.
- Preserve snapshot IDs, file/page/root provenance, capture time and nullable revision,
  exact text, coordinates, visibility, preview bytes, completeness and warnings.
  A duplicate remains grounded in the copy's identity. Never infer original identity.
- The format strictly excludes annotations, specifications, proposals, approvals and
  credentials. Existing approved-context JSON export is a separate feature.
- Export is a read-only POST `/api/projects/:id/capture-bundle` with expectedRevision
  and one or two unique snapshotIds. A stale project revision is rejected.
- Import is POST `/api/capture-bundles/import` with a name and bundle. It validates
  before persistence and always creates a new project with fresh local project identity,
  unchanged snapshots and empty semantic records. It never targets an existing project.
- Both routes use existing loopback binding, token, Host/Origin checks and request limits.
  No Figma/plugin/model/API connection is needed to export or import cached captures.

## Validation and limits

- Strict runtime schemas; reject unknown kind/version/fields, duplicate snapshots,
  duplicate node IDs, provenance inconsistencies, invalid ancestry and invalid
  completeness. Reuse the existing Project invariants rather than a second source model.
- At most 10,000 nodes total, 4,000,000 UTF-8 bytes of node JSON total and
  15,000,000 UTF-8 bytes for the complete serialized bundle. Existing HTTP request
  body limit stays 16 MB. UI rejects oversized files before reading them.
- Verify snapshot digests, base64 PNG data, PNG header dimensions against the preview,
  and root BBox against snapshot bounds. Preserve nullable previews as unavailable.
  This does not establish rendering fidelity, visibility or immutable source revision.
- Treat all imported strings and images as untrusted source material. Render text as
  text; no import instruction can run code, request network access or approve records.
- Exports may contain licensed or confidential designs. Sharing is an explicit user's
  file transfer outside this feature; no automatic cloud upload or external inference.

## User flow and verification

The workspace offers Import captures without an active Figma connection. Export captures
lets the user choose up to two named captures and downloads one file. The UI clearly
states that captures include images and original text, and human approvals are not
transferred. Imported observations require new local annotation/review.

Verify deterministic round trips with synthetic snapshots containing negative coordinates,
partial capture warnings and non-ASCII text; tampering and invalid image/identity rejection;
HTTP authentication/revision/persistence; and browser export/import while disconnected.
Use permitted Bonafide captures only in private manual verification, never public CI.

ZIP archives, whole-project backup/migration, merging into an existing workspace, imported
semantic decisions, REST authentication, and automated source reconciliation are out of scope.
