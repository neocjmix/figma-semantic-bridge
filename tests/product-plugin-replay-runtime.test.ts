import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { PluginResponseSchema, type PluginCommand } from '../src/shared/contracts.js';
import { StructureChunkSchema } from '../src/shared/structure-collection.js';
import { StructureReplayResultSchema, structureChunkContentHash } from '../src/shared/structure-replay.js';
import type { FigmaReadableNode } from '../src/figma/capture.js';

test('actual plugin main bundle replays exact source without browser globals or dynamic code generation', async () => {
  // Use the production entry, target and bundling boundary, without writing an
  // artifact or evaluating the separate browser UI that owns transport crypto.
  const bundled = await build({ entryPoints: ['plugins/semantic-bridge/code.ts'], bundle: true, write: false,
    format: 'iife', platform: 'browser', target: 'es2018', legalComments: 'none', define: { __html__: '""' } });
  const page: FigmaReadableNode & { selection: FigmaReadableNode[]; on(): void; off(): void } = {
    id: 'page', name: 'Synthetic page', type: 'PAGE', parent: null, selection: [], on() {}, off() {},
  };
  const root: FigmaReadableNode = { id: 'root', name: 'Portable hash 한글 👩‍💻', type: 'FRAME', parent: page,
    visible: true, opacity: 1, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 30 }, children: [] };
  const leaf: FigmaReadableNode = { id: 'text', name: 'Exact original', type: 'TEXT', parent: root,
    visible: true, opacity: 1, absoluteBoundingBox: { x: 1, y: 1, width: 20, height: 10 },
    characters: ' 한글 👩‍💻\r\n\ud800 ' };
  root.children = [leaf]; page.selection = [root];
  const messages: Array<{ type: string; response?: unknown }> = [];
  const ui: { onmessage?: (message: unknown) => Promise<void>; postMessage(message: { type: string; response?: unknown }): void } = {
    postMessage: message => { messages.push(message); },
  };
  const figma = { fileKey: 'synthetic-file', currentPage: page, skipInvisibleInstanceChildren: true,
    getNodeByIdAsync: async (id: string) => id === root.id ? root : id === leaf.id ? leaf : null,
    showUI() {}, on() {}, ui };
  const context = vm.createContext({ figma, setTimeout: () => 0, clearTimeout() {} },
    { codeGeneration: { strings: false, wasm: false } });
  for (const name of ['TextEncoder', 'TextDecoder', 'crypto', 'URL', 'Buffer'])
    assert.equal(vm.runInContext(`typeof ${name}`, context), 'undefined', `${name} must not be supplied by the test`);
  vm.runInContext(bundled.outputFiles[0]!.text, context, { timeout: 2000 });
  assert.equal(typeof ui.onmessage, 'function');

  async function execute(requestId: string, command: PluginCommand) {
    await ui.onmessage!({ type: 'execute', generation: 1, request: { type: 'request', requestId, command } });
    const response = messages.filter(message => message.type === 'complete').map(message => PluginResponseSchema.parse(message.response))
      .find(message => message.requestId === requestId);
    assert.ok(response, `Plugin did not answer ${requestId}`);
    assert.equal(response.ok, true, response.error?.message);
    if (!response.ok) assert.fail(response.error?.message ?? 'Plugin request failed');
    return response.result;
  }
  const command = { type: 'read_structure_chunk' as const, fileKey: 'synthetic-file', pageId: page.id,
    nodeId: root.id, sequence: 0, maxNodes: 500 };
  const packet = StructureChunkSchema.parse(await execute('first', { ...command, collectionId: 'collection-first' }));
  assert.equal(packet.nodes.length, 2);
  assert.equal(packet.nodes[1]!.text, leaf.characters);
  await execute('release', { type: 'release_structure_cursor', collectionId: 'collection-first' });
  const expectedHash = structureChunkContentHash(packet);
  const receipt = StructureReplayResultSchema.parse(await execute('replay', { ...command, collectionId: 'collection-second',
    replay: { nodeCount: 2, contentHash: expectedHash } }));
  assert.equal(receipt.kind, 'unchanged-structure-chunk');
  assert.equal(receipt.contentHash, expectedHash);
  assert.equal(receipt.nodeCount, 2);
});
