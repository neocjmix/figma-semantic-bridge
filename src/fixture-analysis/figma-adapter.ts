import type { NodeAdapter, NodeRecord, Rect } from './index.js';

/** The small, read-only part of the Plugin API needed by fixture acquisition. */
export interface FigmaNodeLike {
  readonly id: string;
  readonly type: string;
  readonly parent: FigmaNodeLike | null;
  readonly children?: readonly FigmaNodeLike[];
  readonly absoluteBoundingBox?: Rect | null;
  readonly visible?: boolean;
  readonly layoutMode?: string;
}

export const figmaNodeAdapter: NodeAdapter<FigmaNodeLike> = {
  read(node): NodeRecord {
    const box = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
    return {
      id: node.id,
      parentId: node.parent?.id ?? null,
      type: node.type,
      bbox: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      visible: 'visible' in node ? node.visible !== false : true,
      layoutMode: 'layoutMode' in node ? node.layoutMode ?? null : null,
    };
  },
  children(node) {
    // This reads native handles for the current branch only. No recursive API,
    // node names, original text, styles, assets, or serialized document is read.
    return 'children' in node ? node.children ?? [] : [];
  },
};

export function assertAnalysisRoot(node: FigmaNodeLike): void {
  if (!['PAGE', 'FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'].includes(node.type)) {
    throw new Error('Select one Frame, Group, Component, Component Set, Instance, or Section.');
  }
}

/** This runtime flag changes traversal, not canvas nodes; always restore it. */
export async function withHiddenInstanceChildren<T>(api: { skipInvisibleInstanceChildren?: boolean }, run: () => Promise<T>) {
  const previous = 'skipInvisibleInstanceChildren' in api && typeof api.skipInvisibleInstanceChildren === 'boolean'
    ? api.skipInvisibleInstanceChildren : undefined;
  if (previous === undefined) {
    return { result: await run(), hiddenInstanceChildren: { status: 'not measured' as const, reason: 'Runtime traversal flag is not exposed.' } };
  }
  api.skipInvisibleInstanceChildren = false;
  try {
    return { result: await run(), hiddenInstanceChildren: { status: 'measured' as const, value: 'included' as const } };
  } finally {
    api.skipInvisibleInstanceChildren = previous;
  }
}
