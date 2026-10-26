import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import { StructureReader } from '../src/figma/structure-reader.js';
import type { CaptureHost, FigmaReadableNode } from '../src/figma/capture.js';
import type { SourceNode } from '../src/shared/contracts.js';
import type { StructureChunk } from '../src/shared/structure-collection.js';

// Feasibility-only fixture. Production source acquisition does not use this planner.
export const fileKey = 'recovery-synthetic-file', pageId = 'recovery-synthetic-page';
export const rootId = 'recovery-synthetic-root';
export const earlyTime = '2026-10-26T00:00:00.000Z', laterTime = '2026-10-26T00:01:00.000Z';
const bounds = { x: 0, y: 0, width: 800, height: 600 };
export interface Reads { lookups: number; bounds: number; names: number; children: number; text: number }
export interface Fixture {
  host: CaptureHost; byId: Map<string, FigmaReadableNode>; children: Map<string, FigmaReadableNode[]>;
  reads: Reads; reset(): void; setText(id: string, text: string): void;
  addText(parentId: string, id: string): FigmaReadableNode;
}

export function fixture(branchCount = 10, leafCount = 10): Fixture {
  const reads: Reads = { lookups: 0, bounds: 0, names: 0, children: 0, text: 0 };
  const byId = new Map<string, FigmaReadableNode>(), children = new Map<string, FigmaReadableNode[]>();
  const texts = new Map<string, string>();
  const page: CaptureHost['currentPage'] = { id: pageId, name: 'Synthetic page', type: 'PAGE', parent: null, selection: [] };
  Object.defineProperty(page, 'children', { get() { throw Error('No page preload'); } });
  function add(id: string, type: string, parent: FigmaReadableNode): FigmaReadableNode {
    const node: FigmaReadableNode = { id, name: id, type, parent, visible: true, opacity: 1 };
    Object.defineProperty(node, 'name', { get() { reads.names++; return id; } });
    Object.defineProperty(node, 'absoluteBoundingBox', { get() { reads.bounds++; return { ...bounds }; } });
    if (type === 'TEXT') {
      texts.set(id, `Exact synthetic ${id} 𝌆\r\ntext`);
      Object.defineProperty(node, 'characters', { get() { reads.text++; return texts.get(id)!; } });
    } else {
      children.set(id, []);
      Object.defineProperty(node, 'children', { get() { reads.children++; return children.get(id)!; } });
    }
    byId.set(id, node);
    children.get(parent.id)?.push(node);
    return node;
  }
  const root = add(rootId, 'FRAME', page);
  const addText = (parentId: string, id: string) => add(id, 'TEXT', byId.get(parentId)!);
  for (let branch = 0; branch < branchCount; branch++) {
    const group = add(`branch-${branch}`, 'GROUP', root);
    for (let leaf = 0; leaf < leafCount; leaf++) addText(group.id, `text-${branch}-${leaf}`);
  }
  const host: CaptureHost = { fileKey, currentPage: page, skipInvisibleInstanceChildren: true,
    async getNodeByIdAsync(id) { reads.lookups++; return byId.get(id) ?? null; },
    async setCurrentPageAsync() { throw Error('No page navigation'); },
    selectNodes() { throw Error('No source selection write'); },
    scrollAndZoomIntoView() { throw Error('No source viewport write'); } };
  return { host, byId, children, reads, reset() { for (const key of Object.keys(reads) as (keyof Reads)[]) reads[key] = 0; },
    setText(id, text) { assert.equal(byId.get(id)?.type, 'TEXT'); texts.set(id, text); }, addText };
}

export async function structure(f: Fixture, options: { nodeId?: string; maxNodes?: number; time?: string } = {}): Promise<StructureChunk[]> {
  const nodeId = options.nodeId ?? rootId;
  const reader = new StructureReader(f.host, { now: () => 0, observedAt: () => options.time ?? earlyTime });
  const chunks: StructureChunk[] = [];
  try {
    for (let sequence = 0; ; sequence++) {
      const chunk = await reader.readChunk({ type: 'read_structure_chunk', collectionId: `observation-${nodeId}`,
        nodeId, fileKey, pageId, sequence, ...(nodeId !== rootId ? { scopeId: rootId } : {}),
        ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }) });
      chunks.push(chunk);
      if (chunk.complete || options.maxNodes !== undefined && chunks.reduce((n, part) => n + part.nodes.length, 0) >= options.maxNodes) return chunks;
    }
  } finally { reader.clear(); }
}

export async function inventory(f: Fixture, parentId: string): Promise<SourceNode[]> {
  const reader = new SelectiveReader(f.host, { observedAt: () => laterTime });
  const nodes: SourceNode[] = [];
  try {
    for (let offset = 0; ;) {
      const part = await reader.readChildren({ type: 'read_source_children', fileKey, pageId, scopeId: rootId,
        parentId, observationId: `inventory-${parentId}`, offset, limit: 100 });
      nodes.push(...part.nodes);
      if (part.nextOffset === null) return nodes;
      offset = part.nextOffset;
    }
  } finally { reader.clear(); }
}

// An exhaustive metadata/text recheck using only existing selective commands.
// Enumerating a leaf establishes an observed empty inventory; no type allowlist
// silently asserts that an unfamiliar Figma node can never contain children.
export async function selectiveRecheck(f: Fixture): Promise<SourceNode[]> {
  const reader = new SelectiveReader(f.host, { observedAt: () => laterTime });
  const root = await reader.readNodes({ type: 'read_source_nodes', fileKey, pageId, scopeId: rootId,
    nodeIds: [rootId], fields: 'metadata' });
  const records = new Map<string, SourceNode>([[rootId, root.records[0]!.node]]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index++) {
    for (const child of await inventory(f, queue[index]!)) {
      assert.equal(records.has(child.id), false, 'A fresh tree cannot contain duplicate or moved-in-flight IDs');
      records.set(child.id, child); queue.push(child.id);
    }
  }
  const textIds = [...records.values()].filter(node => node.type === 'TEXT').map(node => node.id);
  for (let index = 0; index < textIds.length; index += 100) {
    const result = await reader.readNodes({ type: 'read_source_nodes', fileKey, pageId, scopeId: rootId,
      nodeIds: textIds.slice(index, index + 100), fields: 'text' });
    for (const record of result.records) {
      const prior = records.get(record.node.id)!;
      // readNodes does not observe sibling order; preserve the explicit inventory.
      records.set(record.node.id, { ...record.node, rendering: { ...record.node.rendering,
        ...(prior.rendering?.siblingIndex === undefined ? {} : { siblingIndex: prior.rendering.siblingIndex }) } });
    }
  }
  reader.clear();
  return [...records.values()];
}

/** Closed intervals are verifiable from validated preorder + direct-child counts. */
export function coverage(chunks: StructureChunk[]): {
  complete: boolean; closed: Map<string, SourceNode[]>; frontier: { id: string; remaining: number }[];
} {
  const nodes: SourceNode[] = [], closed = new Map<string, SourceNode[]>();
  const stack: { id: string; remaining: number; start: number }[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) for (let index = 0; index < chunk.nodes.length; index++) {
    const node = chunk.nodes[index]!, childCount = chunk.childCounts[index]!;
    assert.equal(seen.has(node.id), false); seen.add(node.id);
    if (nodes.length) {
      const parent = stack.at(-1); assert.ok(parent); assert.equal(node.parentId, parent.id);
      parent.remaining--;
    }
    const start = nodes.length; nodes.push(node);
    stack.push({ id: node.id, remaining: childCount, start });
    while (stack.at(-1)?.remaining === 0) {
      const finished = stack.pop()!; closed.set(finished.id, nodes.slice(finished.start));
    }
  }
  return { complete: nodes.length > 0 && stack.length === 0, closed,
    frontier: stack.map(({ id, remaining }) => ({ id, remaining })) };
}

export function changedIds(before: SourceNode[], after: SourceNode[]): string[] {
  const old = new Map(before.map(node => [node.id, node])), fresh = new Map(after.map(node => [node.id, node]));
  return [...new Set([...old.keys(), ...fresh.keys()])].filter(id => !isDeepStrictEqual(old.get(id), fresh.get(id))).sort();
}
