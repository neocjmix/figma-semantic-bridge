# ADR 0014 Guided workflow and local diagnostics

Status: accepted for implementation, 2026-10-27.

The editor will guide a person through source acquisition, region preparation,
source confirmation, semantic approval, specification linking and sharing. It
will reuse existing evidence and review contracts, with secondary recovery and
precision controls disclosed on demand. A saved region may request deterministic
matching explicitly; matching never grants human approval. Unsaved edits block
unrelated project mutations rather than being silently replaced.

The app will record bounded private local diagnostics across HTTP requests,
frontend failures and native WebView/runtime lifecycle. Records use request IDs,
operation names, timings, fixed error reasons, safe validation paths and sanitized
application stack frames. Raw design data, request bodies, credentials, source
names and identifiers are excluded. Log failure must not prevent editing. No
remote telemetry or automatic upload is introduced. Console observation records
safe diagnostic metadata rather than arbitrary console arguments.

Existing single-operator authentication and pinned native TLS remain required for
diagnostic ingestion. Event size and rate are bounded. Native logs provide a
fallback for errors before the local API is available. The user can locate the
logs from the app; developer QA can correlate UI actions and server failures.

This changes presentation and observability, not Figma source contents, evidence
completeness, source freshness, approved export eligibility or AI authority.
