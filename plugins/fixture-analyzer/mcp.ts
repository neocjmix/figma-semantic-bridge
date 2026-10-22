import { analyzeScope, finalizeReportBytes, type AnalyzeOptions } from '../../src/fixture-analysis/index.js';
import { assertAnalysisRoot, figmaNodeAdapter, withHiddenInstanceChildren, type FigmaNodeLike } from '../../src/fixture-analysis/figma-adapter.js';

interface FigmaReadContext {
  readonly fileKey?: string;
  skipInvisibleInstanceChildren?: boolean;
  readonly currentPage: FigmaNodeLike;
  getNodeByIdAsync(id: string): Promise<FigmaNodeLike | null>;
  setCurrentPageAsync(page: FigmaNodeLike): Promise<void>;
}

/** Explicit, one-page MCP runner; callers discover IDs before invoking this. */
export async function analyzeFigmaScope(api: FigmaReadContext, input: {
  pageId: string;
  rootId: string;
  limits?: AnalyzeOptions['limits'];
  tolerancePx?: number;
}) {
  if (!input || typeof input.pageId !== 'string' || !input.pageId || typeof input.rootId !== 'string' || !input.rootId) {
    throw new Error('Explicit pageId and rootId are required.');
  }
  if (api.currentPage.id !== input.pageId) {
    const page = await api.getNodeByIdAsync(input.pageId);
    if (!page || page.type !== 'PAGE') throw new Error('Requested page is unavailable.');
    await api.setCurrentPageAsync(page);
  }
  const root = input.rootId === input.pageId ? api.currentPage : await api.getNodeByIdAsync(input.rootId);
  if (!root) throw new Error('Requested scope is unavailable.');
  assertAnalysisRoot(root);
  let ancestor: FigmaNodeLike | null = root;
  let hops = 0;
  while (ancestor && ancestor.id !== input.pageId && hops < 10000) {
    ancestor = ancestor.parent;
    hops += 1;
  }
  if (!ancestor || ancestor.id !== input.pageId) throw new Error('Requested scope does not belong to the requested page.');
  const { result: report, hiddenInstanceChildren } = await withHiddenInstanceChildren(api, () => analyzeScope(root, figmaNodeAdapter, {
    source: { fileKey: api.fileKey ?? null, pageId: input.pageId, rootId: root.id, revision: null },
    limits: input.limits ?? { maxNodes: 10000, maxRecordBytes: 2000000, maxDurationMs: 5000, maxPairChecks: 250000 },
    tolerancePx: input.tolerancePx ?? 0.5,
    now: () => Date.now(),
  }));
  return finalizeReportBytes({ ...report, hiddenInstanceChildren });
}
