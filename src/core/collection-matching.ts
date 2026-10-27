import { contains, nearEqual, overlaps, utf8Bytes } from '../fixture-analysis/index.js';
import { IdSchema, RectSchema, type Rect, type SourceNode, type SourceReference } from '../shared/contracts.js';
import { StructureChunkSchema, STRUCTURE_CHUNK_BYTES, STRUCTURE_COLLECTION_BYTES, STRUCTURE_COLLECTION_NODES,
  type StructureChunk } from '../shared/structure-collection.js';
import type { MatchResult } from './matching.js';
import { DomainError } from './project.js';
import { unitRatio } from './geometry-scores.js';

type Rendering = 'hidden' | 'transparent' | 'unknown' | 'potential';
type Scored = { nodeId: string; box: Rect; depth: number; enter: number; exit: number;
  coverage: number; iou: number; near: boolean; exact: boolean; inside: boolean; contains: boolean };
type Frame = { id: string; remaining: number; depth: number; rendering: Rendering; scored: Scored | null };
const MAX_CANDIDATES = 200;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const area = (box: Rect) => box.width * box.height;
const intersectionArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const compareScore = (a: Scored, b: Scored) => Number(b.near) - Number(a.near) || b.iou - a.iou || a.depth - b.depth || compareId(a.nodeId, b.nodeId);
const compareExact = (a: Scored, b: Scored) => Number(b.exact) - Number(a.exact) || b.iou - a.iou || a.depth - b.depth || compareId(a.nodeId, b.nodeId);
function invalid(message: string): never { throw new DomainError('INVALID_COLLECTION', message); }
function incomplete(): never { throw new DomainError('SOURCE_INCOMPLETE', 'Matching requires the entire complete source collection, with its declared node count and closed traversal frontier.'); }
function rendering(node: SourceNode, inherited: Rendering): Rendering {
  if (!node.visible || inherited === 'hidden') return 'hidden';
  if (node.rendering?.opacity === 0 || inherited === 'transparent') return 'transparent';
  if (inherited === 'unknown' || node.rendering?.opacity === undefined) return 'unknown';
  return 'potential';
}
function retainCandidate(top: Scored[], item: Scored): void {
  if (top.length === MAX_CANDIDATES && compareScore(item, top[top.length - 1]!) >= 0) return;
  let low = 0, high = top.length;
  while (low < high) { const middle = (low + high) >>> 1; if (compareScore(item, top[middle]!) < 0) high = middle; else low = middle + 1; }
  top.splice(low, 0, item); if (top.length > MAX_CANDIDATES) top.pop();
}

/** Scans every record. Only the active ancestry, unique IDs and bounded diagnostics remain in memory.
 * The server supplies hash-verified immutable chunks; this function independently verifies coverage.
 */
export async function matchCollectionRegion(scopeId: string, inputRegion: Rect, chunks: AsyncIterable<StructureChunk>,
  options: { expectedNodeCount: number; tolerance?: number; ancestorRendering?: Rendering }): Promise<MatchResult> {
  const tolerance = options.tolerance ?? 0.5, expectedNodeCount = options.expectedNodeCount, parsedRegion = RectSchema.safeParse(inputRegion);
  if (!IdSchema.safeParse(scopeId).success || !parsedRegion.success || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10 ||
    !Number.isSafeInteger(expectedNodeCount) || expectedNodeCount < 1 || expectedNodeCount > STRUCTURE_COLLECTION_NODES)
    throw new DomainError('INVALID_OPERATION', 'Invalid collection matching scope, bounds, tolerance or expected node count.');
  const region = parsedRegion.data;
  const seen = new Set<string>(), stack: Frame[] = [], top: Scored[] = [];
  let count = 0, candidateCount = 0, nearCount = 0, bestExact: Scored | null = null, observedRendering = false;
  let sequence = 0, totalBytes = 0, finalComplete = false, identity: string | null = null, priorObservedAt: string | null = null;
  for await (const value of chunks) {
    if (finalComplete) invalid('Source chunks continue after the declared end of the collection.');
    const parsed = StructureChunkSchema.safeParse(value); if (!parsed.success) invalid('Source chunk schema is invalid.');
    const chunk = parsed.data, wireBytes = utf8Bytes(JSON.stringify(chunk));
    totalBytes += wireBytes;
    if (wireBytes > STRUCTURE_CHUNK_BYTES || totalBytes > STRUCTURE_COLLECTION_BYTES)
      throw new DomainError('COLLECTION_LIMIT', 'Collection matching exceeded its bounded packet or cumulative byte limit.');
    if (chunk.sequence !== sequence || chunk.childCounts.length !== chunk.nodes.length || chunk.nextSequence !== (chunk.complete ? null : sequence + 1))
      invalid('Source chunk order or coverage declaration is invalid.');
    const currentIdentity = JSON.stringify([chunk.collectionId, chunk.fileKey, chunk.pageId, chunk.root, chunk.bounds, chunk.startedAt]);
    if (identity !== null && identity !== currentIdentity) invalid('Source identity or root metadata changed between chunks.');
    identity ??= currentIdentity;
    if (!chunk.root.bbox || JSON.stringify(chunk.root.bbox) !== JSON.stringify(chunk.bounds) ||
      chunk.root.sourceFileKey !== chunk.fileKey || chunk.root.sourcePageId !== chunk.pageId || chunk.root.id === chunk.root.parentId ||
      Date.parse(chunk.observedAt) < Date.parse(chunk.startedAt) || (priorObservedAt !== null && Date.parse(chunk.observedAt) < Date.parse(priorObservedAt)))
      invalid('Source root bounds, provenance or observation times are inconsistent.');
    priorObservedAt = chunk.observedAt;
    for (let offset = 0; offset < chunk.nodes.length; offset++) {
      const node = chunk.nodes[offset]!, childCount = chunk.childCounts[offset]!;
      if (count >= expectedNodeCount) incomplete();
      if (seen.has(node.id) || node.id === chunk.root.parentId || node.sourceFileKey !== chunk.fileKey || node.sourcePageId !== chunk.pageId)
        invalid('Duplicate source node or inconsistent source provenance.');
      seen.add(node.id);
      let depth = 0, inherited: Rendering = options.ancestorRendering??(node.parentId === chunk.pageId ? 'potential' : 'unknown');
      if (count === 0) {
        if (JSON.stringify(node) !== JSON.stringify(chunk.root)) invalid('The first source node must be the declared collection root.');
      } else {
        const parent = stack[stack.length - 1];
        if (!parent || parent.id !== node.parentId || parent.remaining < 1) invalid('Source preorder or parent child counts are inconsistent.');
        parent.remaining--; depth = parent.depth + 1; inherited = parent.rendering;
      }
      observedRendering ||= node.rendering !== undefined;
      const effective = rendering(node, inherited), box = node.bbox;
      let scored: Scored | null = null;
      if (effective !== 'hidden' && effective !== 'transparent' && box && box.width > 0 && box.height > 0 && (overlaps(box, region) || nearEqual(box, region, tolerance))) {
        const intersection = intersectionArea(region, box);
        scored = { nodeId: node.id, box, depth, enter: count, exit: count + 1, coverage: unitRatio(intersection, area(region)),
          iou: unitRatio(intersection, area(region) + area(box) - intersection), near: nearEqual(region, box, tolerance), exact: nearEqual(region, box, 0),
          inside: contains(region, box, tolerance), contains: contains(box, region, tolerance) };
        candidateCount++; retainCandidate(top, scored);
        if (scored.near) { nearCount++; if (!bestExact || compareExact(scored, bestExact) < 0) bestExact = scored; }
      }
      count++;
      // Once more than 200 candidates exist, nonexact references are withheld;
      // no unbounded candidate ancestry or node text needs to be retained.
      if (childCount) stack.push({ id: node.id, remaining: childCount, depth, rendering: effective,
        scored: candidateCount <= MAX_CANDIDATES ? scored : null });
      while (stack.length && stack[stack.length - 1]!.remaining === 0) {
        const closed = stack.pop()!; if (closed.scored) closed.scored.exit = count;
      }
    }
    if (chunk.complete !== (stack.length === 0)) incomplete();
    finalComplete = chunk.complete; sequence++;
  }
  if (!finalComplete || count !== expectedNodeCount || stack.length) incomplete();
  const warnings = ['BBox matches use axis-aligned captured bounds; clipping, masks, rotation silhouettes and semantic ownership require human review.'];
  if(options.ancestorRendering==='hidden'||options.ancestorRendering==='transparent')warnings.push('A saved ancestor outside this branch is hidden or has zero opacity. Its descendants are excluded from automatic candidates.');
  else if(options.ancestorRendering==='unknown')warnings.push('Rendering above this saved branch is not fully known. Inspect the image and the original design before confirming source nodes.');
  if (observedRendering) warnings.push('Observed hidden and zero-opacity subtrees are excluded from automatic candidates. Positive opacity does not prove visible pixels or rule out overlays outside the capture.');
  const candidates = top.map(item => ({ nodeId: item.nodeId, coverage: item.coverage, iou: item.iou,
    reason: item.near ? 'equal or near-equal bounds' : item.inside ? 'inside the selected region' : item.contains ? 'contains the selected region' : 'partial spatial intersection' }));
  if (candidateCount > MAX_CANDIDATES) warnings.push(`Spatial candidate limit exceeded. Only the first ${MAX_CANDIDATES} candidate diagnostics are shown; search all captured nodes or narrow the region to inspect more candidates.`);
  const reference = (item: Scored, matchType: SourceReference['matchType']): SourceReference => ({ snapshotId: scopeId, nodeId: item.nodeId, matchType, coverage: item.coverage });
  if (bestExact) {
    if (nearCount > 1) warnings.push('Equal or near-equal BBoxes admit multiple source candidates; original ancestry and stable IDs choose a deterministic suggestion.');
    return { sourceRefs: [reference(bestExact, bestExact.exact ? 'exact' : 'contained')], candidates, ambiguous: nearCount > 1, warnings };
  }
  if (candidateCount > MAX_CANDIDATES) return { sourceRefs: [], candidates, ambiguous: true, warnings };
  const fitting = top.filter(item => item.contains && item.iou >= 0.8);
  if (fitting.length) {
    const best = fitting[0]!, ties = fitting.filter(item => Math.abs(item.iou - best.iou) <= 1e-9);
    if (ties.length > 1) warnings.push('Several containing nodes have the same geometric fit.');
    return { sourceRefs: [reference(best, 'contained')], candidates, ambiguous: ties.length > 1, warnings };
  }
  const pool = top.filter(item => item.inside || (!item.contains && intersectionArea(region, item.box) / area(item.box) >= 0.5));
  const frontier = pool.filter(item => !pool.some(other => other !== item && other.enter < item.enter && other.exit > item.enter))
    .sort((a, b) => compareId(a.nodeId, b.nodeId));
  if (!frontier.length) {
    warnings.push('No sufficiently fitting source node was found; the region remains unresolved.');
    return { sourceRefs: [], candidates, ambiguous: false, warnings };
  }
  const partial = frontier.some(item => !item.inside);
  const mutuallyOverlapping = frontier.some((a, i) => frontier.slice(i + 1).some(b => overlaps(a.box, b.box)));
  if (partial) warnings.push('Only partial spatial intersections are available; review every source reference.');
  if (frontier.length > 1) warnings.push('Aggregate references form a minimal frontier of the captured original tree, not a guaranteed minimum geometric set cover.');
  if (mutuallyOverlapping) warnings.push('The selected source frontier contains overlapping siblings.');
  return { sourceRefs: frontier.map(item => reference(item, !item.inside ? 'partial' : frontier.length > 1 ? 'aggregate' : 'contained')),
    candidates, ambiguous: partial || mutuallyOverlapping, warnings };
}
