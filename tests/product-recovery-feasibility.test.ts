import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectiveReader } from '../src/figma/selective-reader.js';
import { changedIds, coverage, earlyTime, fileKey, fixture, inventory, laterTime, pageId,
  rootId, selectiveRecheck, structure } from './recovery-feasibility-fixture.js';

test('reconnect metadata equality does not validate exact text with unchanged name and bounds', async () => {
  const f = fixture(2, 2), reader = new SelectiveReader(f.host);
  const command = { type: 'read_source_nodes' as const, fileKey, pageId, scopeId: rootId, nodeIds: ['text-0-0'] };
  const before = await reader.readNodes({ ...command, fields: 'metadata' });
  const original = (await reader.readNodes({ ...command, fields: 'text' })).records[0]!.node.text;
  f.setText('text-0-0', 'Changed with identical name and bounds 𝌆\r\n'); f.reset();
  const after = await reader.readNodes({ ...command, fields: 'metadata' });
  assert.deepEqual(after.records, before.records); assert.equal(f.reads.text, 0);
  const checked = await reader.readNodes({ ...command, fields: 'text' });
  assert.notEqual(checked.records[0]!.node.text, original); assert.equal(f.reads.text, 1);
  reader.clear();
});

test('root-only child inventories miss nested insertion, deletion, movement and reorder', async () => {
  const f = fixture(2, 3), rootBefore = await inventory(f, rootId);
  const aBefore = await inventory(f, 'branch-0'), bBefore = await inventory(f, 'branch-1');
  const a = f.children.get('branch-0')!, b = f.children.get('branch-1')!;
  const deleted = a.splice(1, 1)[0]!; f.byId.delete(deleted.id);
  const moved = a.pop()!; moved.parent = f.byId.get('branch-1')!; b.unshift(moved);
  b.reverse(); f.addText('branch-0', 'inserted-text');
  assert.deepEqual(await inventory(f, rootId), rootBefore);
  const aAfter = await inventory(f, 'branch-0'), bAfter = await inventory(f, 'branch-1');
  assert.ok(changedIds(aBefore, aAfter).includes('inserted-text'));
  assert.ok(changedIds(aBefore, aAfter).includes(deleted.id));
  assert.equal(bAfter.find(node => node.id === moved.id)?.parentId, 'branch-1');
  assert.notDeepEqual(bAfter.map(node => node.id), bBefore.map(node => node.id));
});

test('validated prefixes retain complete branches and unknown child identities after serialization', async () => {
  const f = fixture(), chunks = await structure(f, { maxNodes: 56 });
  assert.equal(chunks.at(-1)!.complete, false);
  const persisted = JSON.parse(JSON.stringify(chunks)) as typeof chunks;
  const result = coverage(persisted);
  assert.equal(result.complete, false);
  assert.deepEqual(result.frontier, [{ id: rootId, remaining: 5 }]);
  assert.equal(result.closed.get('branch-0')!.length, 11);
  assert.equal(result.closed.has('branch-5'), false);
  assert.equal(result.closed.has(rootId), false);
  assert.equal(result.closed.get('text-0-0')![0]!.text, 'Exact synthetic text-0-0 𝌆\r\ntext');
});

test('selective exact recheck detects changed records and costs more reads than full bounded traversal', async t => {
  const f = fixture(), original = (await structure(f)).flatMap(chunk => chunk.nodes);
  f.setText('text-0-0', 'Changed text with identical root metadata');
  const deleted = f.children.get('branch-1')!.pop()!; f.byId.delete(deleted.id);
  const moved = f.children.get('branch-2')!.pop()!; moved.parent = f.byId.get('branch-3')!;
  f.children.get('branch-3')!.unshift(moved); f.children.get('branch-4')!.reverse();
  f.addText('branch-5', 'inserted-text');
  f.reset(); const full = (await structure(f, { time: laterTime })).flatMap(chunk => chunk.nodes);
  const fullReads = { ...f.reads };
  f.reset(); const selective = await selectiveRecheck(f), selectiveReads = { ...f.reads };
  assert.deepEqual(changedIds(original, selective), changedIds(original, full));
  const changed = changedIds(original, selective);
  assert.ok(changed.includes('text-0-0')); assert.ok(changed.includes(deleted.id));
  assert.ok(changed.includes(moved.id)); assert.ok(changed.includes('inserted-text'));
  assert.equal(changed.includes('text-9-9'), false, 'Unchanged records must not be falsely reported changed');
  assert.equal(fullReads.text, 100); assert.equal(selectiveReads.text, 100);
  assert.equal(fullReads.children, 11); assert.equal(selectiveReads.children, 11);
  assert.ok(selectiveReads.bounds > fullReads.bounds); assert.ok(selectiveReads.lookups > fullReads.lookups);
  t.diagnostic(JSON.stringify({ nodes: full.length, fullReads, selectiveReads }));
});

test('historical supplementation saves text reads but cannot certify changes in reused branches', async t => {
  const f = fixture(), saved = await structure(f, { maxNodes: 56 });
  const old = coverage(saved), oldText = old.closed.get('text-0-0')![0]!.text;
  f.setText('text-0-0', 'New live text, absent from the historical observation');
  f.addText('branch-0', 'unobserved-insert-in-reused-branch');
  f.reset();
  const rootInventory = await inventory(f, rootId);
  const missing = rootInventory.filter(node => !old.closed.has(node.id));
  assert.equal(missing.length, 5);
  const later = [];
  for (const branch of missing) later.push(...await structure(f, { nodeId: branch.id, time: laterTime }));
  const supplementationReads = { ...f.reads };
  const reused = [...old.closed.entries()].filter(([id]) => id.startsWith('branch-')).flatMap(([, nodes]) => nodes);
  assert.equal(reused.find(node => node.id === 'text-0-0')!.text, oldText);
  assert.equal(reused.some(node => node.id === 'unobserved-insert-in-reused-branch'), false);
  assert.equal(saved[0]!.observedAt, earlyTime); assert.equal(later[0]!.observedAt, laterTime);
  assert.equal(coverage(saved).complete, false, 'Supplementing branches must not mutate the original request to complete');
  assert.equal(later.flatMap(chunk => chunk.nodes).length, 55);
  assert.equal(supplementationReads.text, 50); assert.equal(supplementationReads.children, 6);
  t.diagnostic(JSON.stringify({ reusedNodes: reused.length, newlyReadNodes: 55, supplementationReads,
    freshnessOfReusedNodes: 'not-revalidated', atomicSnapshot: false }));
});
