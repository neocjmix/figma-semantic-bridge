import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import WebSocket from 'ws';
import type { approvedContext } from '../src/core/project.js';
import { captureSelection, type CaptureHost, type FigmaReadableNode } from '../src/figma/capture.js';
import { startServer } from '../src/server/index.js';
import { PluginRequestSchema, type CaptureLimits, type Project, type Snapshot } from '../src/shared/contracts.js';

const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;
const BOUNDS = { x: -100, y: 200, width: 5000, height: 5000 };
const milliseconds = (value: number) => Math.round(value * 1000) / 1000;
const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');

/** Synthetic lazy tree, matching the shape of benchmark-product.ts. No image export. */
function generatedScope(nodeCount: number) {
  const page: FigmaReadableNode & { selection: readonly FigmaReadableNode[] } = {
    id: 'generated-page', name: 'Generated benchmark page', type: 'PAGE', parent: null, selection: [],
  };
  const handles = new Map<number, FigmaReadableNode>();
  function nodeAt(index: number, parent: FigmaReadableNode): FigmaReadableNode {
    const cached = handles.get(index);
    if (cached) return cached;
    const childStart = index * 6 + 1, childCount = Math.max(0, Math.min(6, nodeCount - childStart));
    const type = index === 0 ? 'FRAME' : childCount ? ['FRAME', 'GROUP', 'INSTANCE'][index % 3]! : index % 3 === 0 ? 'TEXT' : 'RECTANGLE';
    const node: FigmaReadableNode = { id: `generated-${index}`, name: `Generated ${type} ${index}`, type, parent, visible: true,
      absoluteBoundingBox: index === 0 ? BOUNDS : { x: -90 + (index % 100) * 30, y: 210 + Math.floor(index / 100) * 30, width: 20, height: 20 } };
    if (type === 'TEXT') node.characters = `Generated policy ${index}: confirm the action before continuing.`;
    if (childCount) node.children = new Proxy([] as FigmaReadableNode[], { get(target, key, receiver) {
      if (key === 'length') return childCount;
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        const offset = Number(key);
        return offset < childCount ? nodeAt(childStart + offset, node) : undefined;
      }
      return Reflect.get(target, key, receiver);
    } });
    handles.set(index, node);
    return node;
  }
  page.selection = [nodeAt(0, page)];
  const outsideScope = () => { throw new Error('Capture must only read the selected synthetic scope.'); };
  const host: CaptureHost = { fileKey: 'generated-local-pipeline', currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async () => outsideScope(), setCurrentPageAsync: async () => outsideScope(),
    selectNodes: outsideScope, scrollAndZoomIntoView: outsideScope };
  return { host, materializedNodeHandles: () => handles.size };
}

function distribution(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return { samples: values, min: ordered[0]!, median: ordered[Math.floor(ordered.length / 2)]!,
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1]!, max: ordered.at(-1)!,
    mean: milliseconds(values.reduce((sum, value) => sum + value, 0) / values.length) };
}

type LocalServer = Awaited<ReturnType<typeof startServer>>;
async function run(server: LocalServer, dataDir: string, nodeCount: number, maxNodes: number) {
  const generated = generatedScope(nodeCount);
  const limits: CaptureLimits = { maxNodes, maxBytes: 4_000_000, maxDurationMs: 15000, maxImageDimension: 2048 };
  const api = async <T>(path: string, body?: unknown) => {
    const requestText = body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
    const response = await fetch(server.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(requestText === undefined ? {} : { body: requestText }), signal: AbortSignal.timeout(30000),
    });
    const responseText = await response.text();
    assert.ok(response.ok, `${path}: HTTP ${response.status}: ${responseText.slice(0, 200)}`);
    const value = JSON.parse(responseText) as T;
    return { value, elapsedMs: milliseconds(performance.now() - started),
      requestBodyBytes: requestText === undefined ? 0 : byteLength(requestText), responseBodyBytes: byteLength(responseText) };
  };
  // Creation, authentication and tree construction are setup, outside the measured capture chain.
  const created = await api<Project>('/api/projects', { name: `Generated ${nodeCount}, cap ${maxNodes}` });
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/bridge', { origin: 'null' });
  let snapshot: Snapshot | undefined, adapterMs = 0, wsRequestBytes = 0, wsResponseBytes = 0, emulatorError: unknown;
  try {
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    const welcomed = once(ws, 'message', { signal: AbortSignal.timeout(5000) });
    ws.send(JSON.stringify({ type: 'hello', token: server.token, clientId: 'synthetic-pipeline-benchmark' }));
    assert.equal(JSON.parse((await welcomed)[0].toString()).type, 'welcome');
    ws.on('message', raw => {
      void (async () => {
        const requestText = raw.toString();
        wsRequestBytes += byteLength(requestText);
        const request = PluginRequestSchema.parse(JSON.parse(requestText));
        assert.equal(request.command.type, 'capture_selection');
        if (request.command.type !== 'capture_selection') throw new Error('Unexpected synthetic plugin command.');
        const started = performance.now();
        snapshot = await captureSelection(generated.host, request.command.limits, {
          now: () => performance.now(), yieldControl: async () => { await yieldImmediate(); },
          id: () => `generated-${nodeCount}-budget-${maxNodes}`,
        });
        adapterMs = milliseconds(performance.now() - started);
        const payload = JSON.stringify({ type: 'response', requestId: request.requestId, ok: true, result: snapshot });
        wsResponseBytes += byteLength(payload);
        ws.send(payload);
      })().catch(error => { emulatorError = error; ws.terminate(); });
    });
    const pipelineStarted = performance.now();
    const captured = await api<Project>(`/api/projects/${created.value.id}/capture`, { expectedRevision: 0, limits });
    if (emulatorError) throw emulatorError;
    assert.ok(snapshot);
    assert.equal(captured.value.revision, 1);
    assert.equal(captured.value.snapshots.length, 1);
    assert.deepEqual(captured.value.snapshots[0], snapshot);
    assert.equal(snapshot.nodes.length, Math.min(nodeCount, maxNodes));
    assert.equal(snapshot.completeness.complete, nodeCount <= maxNodes);
    assert.equal(snapshot.completeness.reason === null, nodeCount <= maxNodes);
    assert.deepEqual(snapshot.bounds, BOUNDS);
    assert.equal(snapshot.preview, null);
    assert.equal(generated.materializedNodeHandles(), snapshot.nodes.length);
    assert.equal(generated.host.skipInvisibleInstanceChildren, true);
    const leaf = snapshot.nodes.find(node => node.type === 'TEXT');
    assert.ok(leaf?.bbox && leaf.text);
    const annotation = { id: 'generated-annotation', snapshotId: snapshot.id, name: 'Generated exact region',
      role: 'element', bbox: leaf.bbox, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 };
    const mutationPath = `/api/projects/${created.value.id}/mutate`;
    const annotated = await api<Project>(mutationPath, { expectedRevision: 1,
      operation: { type: 'upsert_annotation', annotation } });
    assert.equal(annotated.value.revision, 2);
    const matched = await api<Project>(mutationPath, { expectedRevision: 2,
      operation: { type: 'match_annotation', id: annotation.id, tolerance: 0 } });
    assert.equal(matched.value.revision, 3);
    assert.deepEqual(matched.value.annotations[0]!.sourceRefs,
      [{ snapshotId: snapshot.id, nodeId: leaf.id, matchType: 'exact', coverage: 1 }]);
    const approved = await api<Project>(mutationPath, { expectedRevision: 3,
      operation: { type: 'review_annotation', id: annotation.id, status: 'approved' } });
    assert.equal(approved.value.revision, 4);
    assert.equal(approved.value.annotations[0]!.reviewStatus, 'approved');
    assert.deepEqual(approved.value.snapshots[0], snapshot);
    const retrieved = await api<Project>(`/api/projects/${created.value.id}`);
    assert.deepEqual(retrieved.value, approved.value);
    const diskStarted = performance.now();
    const savedText = await readFile(join(dataDir, 'projects', `${created.value.id}.json`), 'utf8');
    const saved = JSON.parse(savedText) as { project: Project; past: unknown[]; future: unknown[] };
    const diskReadMs = milliseconds(performance.now() - diskStarted);
    assert.deepEqual(saved.project, approved.value);
    assert.equal(saved.past.length, 3);
    assert.deepEqual(saved.future, []);
    const exported = await api<ReturnType<typeof approvedContext>>(`/api/projects/${created.value.id}/export`);
    const unresolved = snapshot.completeness.complete ? [] : [`Source scope ${snapshot.id} is partial.`];
    assert.deepEqual(exported.value, {
      schemaVersion: '1.0.0', projectId: saved.project.id, name: saved.project.name,
      revision: 4, updatedAt: saved.project.updatedAt,
      annotations: [{ ...saved.project.annotations[0], childIds: [] }], specifications: [],
      sourceNodes: [{ ...leaf, snapshotId: snapshot.id }],
      sources: [{ snapshotId: snapshot.id, name: snapshot.name, source: snapshot.source, bounds: BOUNDS,
        completeness: snapshot.completeness, warnings: snapshot.warnings }], unresolved, truncated: false,
    });
    assert.equal(server.broker.status.pendingRequests, 0);
    return { timingsMs: { pipelineIncludingAssertions: milliseconds(performance.now() - pipelineStarted),
      captureHttp: captured.elapsedMs, captureAdapter: adapterMs,
      annotationCreateHttp: annotated.elapsedMs, matchHttp: matched.elapsedMs, approveHttp: approved.elapsedMs,
      readHttp: retrieved.elapsedMs, diskReadAndParse: diskReadMs, approvedExportHttp: exported.elapsedMs },
    sizesBytes: { captureHttpRequestJson: captured.requestBodyBytes, captureHttpResponseJson: captured.responseBodyBytes,
      captureWebSocketRequestJson: wsRequestBytes, captureWebSocketResponseJson: wsResponseBytes,
      annotationCreateHttpRequestJson: annotated.requestBodyBytes, annotationCreateHttpResponseJson: annotated.responseBodyBytes,
      matchHttpRequestJson: matched.requestBodyBytes, matchHttpResponseJson: matched.responseBodyBytes,
      approveHttpRequestJson: approved.requestBodyBytes, approveHttpResponseJson: approved.responseBodyBytes,
      readHttpResponseJson: retrieved.responseBodyBytes, storedProjectEnvelopeJson: byteLength(savedText),
      approvedExportHttpResponseJson: exported.responseBodyBytes },
    checks: { capturedNodes: snapshot.nodes.length, materializedNodeHandles: generated.materializedNodeHandles(),
      completeness: snapshot.completeness, httpReadEqualsApprovedProject: true, diskEqualsApprovedProject: true,
      deterministicExactMatch: true, approvedExportMatchesDiskProjection: true,
      exactSourceTextAndProvenancePreserved: true, restoredTraversalFlag: true } };
  } finally {
    // Termination has no native plugin or user-service side effects; this socket is synthetic.
    if (ws.readyState !== WebSocket.CLOSED) {
      const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) });
      ws.terminate();
      await closed;
    }
  }
}

const dataDir = await mkdtemp(join(tmpdir(), 'fsb-local-pipeline-benchmark-'));
let server: LocalServer | undefined;
try {
  server = await startServer({ port: 0, dataDir, token: randomBytes(32).toString('hex'), aiConfig: null });
  const results = [];
  for (const [nodeCount, maxNodes] of [[100, 2000], [1000, 2000], [10000, 2000], [10000, 10000]] as const) {
    for (let index = 0; index < WARMUP_RUNS; index++) await run(server, dataDir, nodeCount, maxNodes);
    const runs: Awaited<ReturnType<typeof run>>[] = [];
    for (let index = 0; index < MEASURED_RUNS; index++) runs.push(await run(server, dataDir, nodeCount, maxNodes));
    const sample = runs[0]!;
    results.push({ knownGeneratedScopeNodeCount: nodeCount, maxNodes, measuredRuns: runs.length,
      timingsMs: Object.fromEntries(Object.keys(sample.timingsMs).map(key => [key,
        distribution(runs.map(result => result.timingsMs[key as keyof typeof sample.timingsMs]))])),
      sizesBytes: Object.fromEntries(Object.keys(sample.sizesBytes).map(key => [key,
        distribution(runs.map(result => result.sizesBytes[key as keyof typeof sample.sizesBytes]))])),
      checks: sample.checks });
    process.stdout.write(`Generated ${nodeCount}, cap ${maxNodes}: capture median ${distribution(runs.map(result => result.timingsMs.captureHttp)).median} ms; ${sample.checks.capturedNodes} captured nodes; stored ${sample.sizesBytes.storedProjectEnvelopeJson} bytes.\n`);
  }
  const output = { schemaVersion: '1.0.0', kind: 'synthetic-local-http-websocket-disk-pipeline-benchmark', measuredAt: new Date().toISOString(),
    command: 'npm run benchmark:local-pipeline', generator: 'scripts/benchmark-local-pipeline.ts',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    method: { warmupRunsPerCase: WARMUP_RUNS, measuredRunsPerCase: MEASURED_RUNS,
      captureLimits: { maxBytes: 4_000_000, maxDurationMs: 15000, maxImageDimension: 2048 },
      setup: 'One loopback server on port 0 and a temporary data directory; fresh project and synthetic WebSocket connection per run; no active user service or data is used.',
      timing: 'HTTP timings include body consumption and JSON parsing. Adapter timing is nested inside captureHttp. Pipeline includes capture, one annotation creation, deterministic match, simulated approval, read, direct disk read, approved export, and consistency assertions, excluding setup.',
      distributions: 'Five sequential measured runs after one warmup per case. p95 uses nearest rank and is the maximum for five samples; it is not a stable tail-latency estimate.',
      bytes: 'Serialized UTF-8 application JSON body/payload sizes and actual project-envelope file bytes; excludes HTTP/WebSocket framing, headers and TCP overhead. Not wire-byte measurements.' },
    limitations: [
      'Synthetic generated scalar nodes only. No Figma Desktop, Dev seat enforcement, public fixture, native page loading, exportAsync, PNG or browser rendering is measured.',
      'Server, client and synthetic plugin share one Node.js process and event loop; real Figma process isolation and scheduling are not represented.',
      'A synthetic text-node BBox is annotated, matched and approved through the local API by the benchmark. This simulated approval tests persistence/export and is not evidence of human review accuracy or productivity. The approved export contains one annotation and one source record, not a large approved context.',
      'Capture uses the real bounded adapter; HTTP, WebSocket, schema validation and atomic disk persistence are real local operations.',
      'No performance pass threshold, forced GC, CPU isolation, peak-memory measurement, cold-filesystem claim or inference about native Figma latency.',
    ], results };
  await mkdir('docs/evaluation', { recursive: true });
  await writeFile('docs/evaluation/product-local-pipeline-benchmark.json', JSON.stringify(output, null, 2) + '\n');
} finally {
  try { await server?.close(); } finally { await rm(dataDir, { recursive: true, force: true }); }
}
