import { contains, nearEqual, overlaps } from '../fixture-analysis/index.js';
import { buildRenderingEvidence } from './rendering-evidence.js';
import { NodeBoundsSchema, RectSchema, type Rect, type Snapshot, type SourceNode, type SourceReference } from '../shared/contracts.js';

export interface MatchCandidate { nodeId: string; coverage: number; iou: number; reason: string }
export interface MatchResult { sourceRefs: SourceReference[]; candidates: MatchCandidate[]; ambiguous: boolean; warnings: string[] }
interface IndexedNode { node: SourceNode; bbox: Rect; depth: number; visible: boolean; enter: number; exit: number }
const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const area = (box: Rect): number => box.width * box.height;
const intersectionArea = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** A bounded interval index with original-tree ancestry and effective visibility. */
export class SpatialNodeIndex {
  private readonly byId = new Map<string, IndexedNode>();
  private readonly sorted: IndexedNode[];
  private readonly prefixRight: number[];

  constructor(nodes: readonly SourceNode[]) {
    if (nodes.length > 10000) throw new Error('Spatial index is limited to 10,000 source nodes.');
    const rendering = buildRenderingEvidence(nodes);
    const source = new Map<string, SourceNode>();
    const children = new Map<string | null, SourceNode[]>();
    for (const node of nodes) {
      if (source.has(node.id)) throw new Error('Duplicate source node ID.');
      source.set(node.id, node);
      if (node.bbox) NodeBoundsSchema.parse(node.bbox);
    }
    for (const node of nodes) {
      const parent = node.parentId !== null && source.has(node.parentId) ? node.parentId : null;
      const list = children.get(parent) ?? []; list.push(node); children.set(parent, list);
    }
    for (const list of children.values()) list.sort((a, b) => compareId(a.id, b.id));
    const visited = new Set<string>();
    let tick = 0;
    const stack: Array<{ node: SourceNode; depth: number; visible: boolean; exit: boolean }> = [];
    for (const node of [...(children.get(null) ?? [])].reverse()) stack.push({ node, depth: 0, visible: true, exit: false });
    while (stack.length) {
      const entry = stack.pop()!;
      if (entry.exit) { const indexed = this.byId.get(entry.node.id); if (indexed) indexed.exit = tick++; continue; }
      if (visited.has(entry.node.id)) throw new Error('Source ancestry contains a cycle.');
      visited.add(entry.node.id);
      const visible = entry.visible && entry.node.visible;
      const box = entry.node.bbox;
      if (box && box.width > 0 && box.height > 0) this.byId.set(entry.node.id, { node: entry.node, bbox: box, depth: entry.depth, visible, enter: tick, exit: tick });
      tick++;
      stack.push({ ...entry, exit: true });
      for (const child of [...(children.get(entry.node.id) ?? [])].reverse()) stack.push({ node: child, depth: entry.depth + 1, visible, exit: false });
    }
    if (visited.size !== nodes.length) throw new Error('Source ancestry contains a cycle.');
    this.sorted = [...this.byId.values()].filter(item => item.visible && rendering.get(item.node.id)?.status !== 'transparent').sort((a, b) => a.bbox.x - b.bbox.x || compareId(a.node.id, b.node.id));
    let right = -Infinity;
    this.prefixRight = this.sorted.map(item => (right = Math.max(right, item.bbox.x + item.bbox.width)));
  }

  query(region: Rect, tolerance = 0): SourceNode[] {
    RectSchema.parse(region);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10) throw new Error('Tolerance must be between 0 and 10.');
    let low = 0, high = this.sorted.length;
    const right = region.x + region.width + tolerance;
    while (low < high) { const middle = (low + high) >>> 1; if (this.sorted[middle]!.bbox.x <= right) low = middle + 1; else high = middle; }
    const matches: SourceNode[] = [];
    for (let i = low - 1; i >= 0; i--) {
      if (this.prefixRight[i]! < region.x - tolerance) break;
      const item = this.sorted[i]!;
      if (overlaps(item.bbox, region) || nearEqual(item.bbox, region, tolerance)) matches.push(item.node);
    }
    return matches.sort((a, b) => compareId(a.id, b.id));
  }

  depth(id: string): number { return this.byId.get(id)?.depth ?? 0; }
  isAncestor(ancestorId: string, childId: string): boolean {
    const parent = this.byId.get(ancestorId), child = this.byId.get(childId);
    return !!parent && !!child && parent.enter < child.enter && parent.exit > child.exit;
  }
}

/** Geometric suggestions only. The result never assigns semantic confidence. */
export function matchRegion(snapshot: Snapshot, region: Rect, options: { tolerance?: number; maxCandidates?: number } = {}): MatchResult {
  RectSchema.parse(region);
  const tolerance = options.tolerance ?? 0.5, maxCandidates = options.maxCandidates ?? 200;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10) throw new Error('Tolerance must be between 0 and 10.');
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 1000) throw new Error('maxCandidates must be an integer between 1 and 1,000.');
  const index = new SpatialNodeIndex(snapshot.nodes);
  const warnings = ['BBox matches use axis-aligned captured bounds; clipping, masks, rotation silhouettes and semantic ownership require human review.'];
  if(snapshot.nodes.some(node=>node.rendering!==undefined))warnings.push('Observed hidden and zero-opacity subtrees are excluded from automatic candidates. Positive opacity does not prove visible pixels or rule out overlays outside the capture.');
  if (!snapshot.completeness.complete) warnings.push('Source extraction is incomplete; all matches refer only to captured nodes.');
  const scored = index.query(region, tolerance).map(node => {
    const box = node.bbox!;
    const intersection = intersectionArea(region, box);
    const coverage = intersection / area(region), iou = intersection / (area(region) + area(box) - intersection);
    return { node, box, coverage, iou, near: nearEqual(region, box, tolerance), inside: contains(region, box, tolerance), contains: contains(box, region, tolerance) };
  }).sort((a, b) => Number(b.near) - Number(a.near) || b.iou - a.iou || index.depth(a.node.id) - index.depth(b.node.id) || compareId(a.node.id, b.node.id));
  const candidates: MatchCandidate[] = scored.slice(0, maxCandidates).map(item => ({ nodeId: item.node.id, coverage: item.coverage, iou: item.iou, reason: item.near ? 'equal or near-equal bounds' : item.inside ? 'inside the selected region' : item.contains ? 'contains the selected region' : 'partial spatial intersection' }));
  if(scored.length>maxCandidates)warnings.push(`Spatial candidate limit exceeded. Only the first ${maxCandidates} candidate diagnostics are shown; search all captured nodes or narrow the region to inspect more candidates.`);
  if(!snapshot.completeness.complete)return {sourceRefs:[],candidates,ambiguous:true,
    warnings:[...warnings,'Automatic source references are withheld until the requested capture is complete.']};
  const reference = (item: typeof scored[number], matchType: SourceReference['matchType']): SourceReference => ({ snapshotId: snapshot.id, nodeId: item.node.id, matchType, coverage: item.coverage });
  const exact = scored.filter(item => item.near).sort((a, b) => Number(nearEqual(region, b.box, 0)) - Number(nearEqual(region, a.box, 0)) || b.iou - a.iou || index.depth(a.node.id) - index.depth(b.node.id) || compareId(a.node.id, b.node.id));
  if (exact.length) {
    if (exact.length > 1) warnings.push('Equal or near-equal BBoxes admit multiple source candidates; original ancestry and stable IDs choose a deterministic suggestion.');
    const best = exact[0]!;
    return { sourceRefs: [reference(best, nearEqual(region, best.box, 0) ? 'exact' : 'contained')], candidates, ambiguous: exact.length > 1, warnings };
  }
  if (scored.length > maxCandidates) {
    return { sourceRefs: [], candidates, ambiguous: true, warnings };
  }
  // A broad page/background must not obscure a useful multi-sibling match.
  const fitting = scored.filter(item => item.contains && item.iou >= 0.8);
  if (fitting.length) {
    const best = fitting[0]!;
    const ties = fitting.filter(item => Math.abs(item.iou - best.iou) <= 1e-9);
    if (ties.length > 1) warnings.push('Several containing nodes have the same geometric fit.');
    return { sourceRefs: [reference(best, 'contained')], candidates, ambiguous: ties.length > 1, warnings };
  }
  const pool = scored.filter(item => item.inside || (!item.contains && intersectionArea(region, item.box) / area(item.box) >= 0.5));
  // Minimal source-tree frontier: descendants of an included original ancestor are
  // covered by that ancestor. Geometrically-contained siblings remain distinct.
  const frontier = pool.filter(item => !pool.some(other => other !== item && index.isAncestor(other.node.id, item.node.id)))
    .sort((a, b) => compareId(a.node.id, b.node.id));
  if (!frontier.length) {
    warnings.push('No sufficiently fitting source node was found; the region remains unresolved.');
    return { sourceRefs: [], candidates, ambiguous: false, warnings };
  }
  const partial = frontier.some(item => !item.inside);
  const mutuallyOverlapping = frontier.some((a, i) => frontier.slice(i + 1).some(b => overlaps(a.box, b.box)));
  if (partial) warnings.push('Only partial spatial intersections are available; review every source reference.');
  if (frontier.length > 1) warnings.push('Aggregate references form a minimal frontier of the captured original tree, not a guaranteed minimum geometric set cover.');
  if (mutuallyOverlapping) warnings.push('The selected source frontier contains overlapping siblings.');
  return {
    sourceRefs: frontier.map(item => reference(item, !item.inside ? 'partial' : frontier.length > 1 ? 'aggregate' : 'contained')),
    candidates, ambiguous: partial || mutuallyOverlapping, warnings,
  };
}
