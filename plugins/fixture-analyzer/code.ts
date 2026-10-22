import { analyzeScope, finalizeReportBytes } from '../../src/fixture-analysis/index.js';
import { assertAnalysisRoot, figmaNodeAdapter, withHiddenInstanceChildren, type FigmaNodeLike } from '../../src/fixture-analysis/figma-adapter.js';

declare const __html__: string;
declare const figma: {
  readonly fileKey?: string;
  skipInvisibleInstanceChildren?: boolean;
  readonly currentPage: FigmaNodeLike & { readonly selection: readonly FigmaNodeLike[] };
  showUI(html: string, options: { width: number; height: number }): void;
  ui: { postMessage(message: unknown): void; onmessage: ((message: unknown) => void) | undefined };
};

figma.showUI(__html__, { width: 440, height: 540 });
let busy = false;

figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type !== 'analyze-selection' && message.type !== 'analyze-page') return;
  if (busy) return;
  busy = true;
  figma.ui.postMessage({ type: 'started' });
  try {
    const page = figma.currentPage;
    if (message.type === 'analyze-selection' && page.selection.length !== 1) {
      throw new Error('Select exactly one supported container before running.');
    }
    const root = message.type === 'analyze-page' ? page : page.selection[0]!;
    assertAnalysisRoot(root);
    const { result: report, hiddenInstanceChildren } = await withHiddenInstanceChildren(figma, () => analyzeScope(root, figmaNodeAdapter, {
      source: { fileKey: figma.fileKey ?? null, pageId: page.id, rootId: root.id, revision: null },
      limits: { maxNodes: 10000, maxRecordBytes: 2000000, maxDurationMs: 5000, maxPairChecks: 250000 },
      tolerancePx: 0.5,
      now: () => Date.now(),
      yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    }));
    figma.ui.postMessage({ type: 'result', report: finalizeReportBytes({ ...report, hiddenInstanceChildren }) });
  } catch (error: unknown) {
    figma.ui.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Analysis failed.' });
  } finally {
    busy = false;
  }
};
