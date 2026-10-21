# Feasibility Gates and Test Protocol

No large implementation until these gates are evaluated. Record commands, fixtures, timings, results and go/no-go rationale.

## F0 — Enterprise permissions
Verify plugin development/installation, localhost communication, corporate data handling and permission for external multimodal inference. Public repository must use synthetic fixtures. **Hard stop:** mandatory policy prohibits required workflow.

## F1 — Real bidirectional bridge
Run Figma Desktop + tiny plugin + local server + MCP client. Codex invokes get_selected_node, server sends command to active plugin, plugin reads source and returns ID/BBox/text. Also test source node selection/highlight from MCP. Evaluate main/UI networking, manifest permissions, HTTP vs polling/WebSocket, reconnect, cancellation and disconnect errors. **Pass:** repeatable end-to-end command/response without REST and without manual copy/paste.

## F2 — Bounded performance
Use synthetic small/medium/large frames and only authorized real documents. Measure image export latency, first-node latency, nodes/sec, bytes, peak plugin/server memory and failure rate. **Pass:** selected-frame workflow does not require whole-document preload or multi-GB export. Set numerical budgets after baseline.

## F3 — Coordinate fidelity
Compare exported preview to node coordinates across nested frames, scale, pan, rotation, clipping, masks and invisible nodes. **Pass:** accuracy threshold established for supported cases and unsupported cases flagged explicitly.

## F4 — Source grounding
Fixture labels for single node, multiple siblings, overlapping regions, equal BBoxes, tolerance ambiguity and no match. Evaluate precision/recall, ambiguous candidate frequency, determinism and runtime. **Pass:** repeatable matching and no false certainty.

## F5 — Human productivity
Benchmark experienced frontend developers on representative screens: baseline manual analysis, tool-only annotation, AI-first review. Measure full completion time including corrections, clicks, omissions, rework and accepted proposals. **Pass:** net improvement or clear iteration path; otherwise simplify UI.

## F6 — MCP security
Test Codex and a second MCP client. Validate input bounds, local-origin restrictions, hostile Figma spec text, disconnected plugin, safe patch semantics and no unauthorized egress. **Pass:** approved data cannot be silently mutated and proprietary material does not leak.

## Go/no-go
F0–F4 determine technical viability; F5 determines product value; F6 gates release. Do not treat a successful localhost hello-world as evidence that large documents are performant.
