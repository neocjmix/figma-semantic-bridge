import { useLocale } from './i18n.js';
import { useRef, useState, type PointerEvent } from 'react';
import type { Annotation, Rect, SourceNode } from '../src/shared/contracts.js';
import { inlineScope, scopeNodeCount, type SourceScope } from '../src/core/source-scopes.js';

type Mode = 'select' | 'draw' | 'pan';
interface Props {
  scope: SourceScope;
  fetchedNodes?: SourceNode[];
  annotations: Annotation[];
  selectedId: string | null;
  draft: Annotation | null;
  onSelect(annotation: Annotation): void;
  onDraft(annotation: Annotation): void;
  onCreate(bbox: Rect): void;
}
interface Gesture {
  kind: Mode | 'resize';
  start: { x: number; y: number };
  client: { x: number; y: number };
  original: Rect | null;
  annotation: Annotation | null;
  initialPan: { x: number; y: number };
  documentPerPixel: number;
}

export function Canvas({ scope, fetchedNodes = [], annotations, selectedId, draft, onSelect, onDraft, onCreate }: Props) {
  const { t, formatNumber } = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const [showSources, setShowSources] = useState(false);
  const b = scope.bounds;
  const sourceNodes = inlineScope(scope) ? scope.nodes : fetchedNodes;
  const margin = Math.max(b.width, b.height) * 0.04;
  const viewWidth = (b.width + margin * 2) / zoom;
  const viewHeight = (b.height + margin * 2) / zoom;
  const viewX = b.x + b.width / 2 - viewWidth / 2 + pan.x;
  const viewY = b.y + b.height / 2 - viewHeight / 2 + pan.y;
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  };
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const p = point(event);
    if (!p) return;
    const target = event.target as Element;
    const annotationId = target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
    const selected = annotations.find(a => a.id === annotationId) ?? (draft?.id === annotationId ? draft : null);
    const isResize = target.getAttribute('data-handle') === 'resize';
    const actualMode = mode === 'pan' || event.altKey ? 'pan' : mode;
    const active = selected && draft?.id === selected.id ? draft : selected;
    if (active && actualMode === 'select') onSelect(active);
    if (actualMode === 'select' && !active) return;
    const ctm = svgRef.current!.getScreenCTM()!;
    gesture.current = { kind: isResize && actualMode === 'select' ? 'resize' : actualMode, start: p, client: { x: event.clientX, y: event.clientY },
      original: active?.bbox ?? null, annotation: active, initialPan: pan, documentPerPixel: 1 / ctm.a };
    if (actualMode === 'draw') setDrawing({ x: p.x, y: p.y, width: 0.01, height: 0.01 });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    const p = point(event);
    if (!g || !p) return;
    if (g.kind === 'pan') {
      setPan({ x: g.initialPan.x - (event.clientX - g.client.x) * g.documentPerPixel,
        y: g.initialPan.y - (event.clientY - g.client.y) * g.documentPerPixel });
      return;
    }
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (g.kind === 'draw') {
      setDrawing({ x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(dx), height: Math.abs(dy) });
    } else if (g.original && g.annotation) {
      const bbox = g.kind === 'resize' ? { ...g.original, width: Math.max(1, g.original.width + dx), height: Math.max(1, g.original.height + dy) }
        : { ...g.original, x: g.original.x + dx, y: g.original.y + dy };
      onDraft({ ...g.annotation, bbox });
    }
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (g?.kind === 'draw' && drawing && drawing.width >= 2 && drawing.height >= 2) {
      onCreate({ x: Math.round(drawing.x * 100) / 100, y: Math.round(drawing.y * 100) / 100,
        width: Math.round(drawing.width * 100) / 100, height: Math.round(drawing.height * 100) / 100 });
      setMode('select');
    }
    gesture.current = null;
    setDrawing(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const visible = annotations.map(a => draft?.id === a.id ? draft : a);
  if (draft?.snapshotId === scope.id && !visible.some(a => a.id === draft.id)) visible.push(draft);
  return <div className="canvas-shell">
    <div className="canvas-toolbar">
      <div className="segmented" aria-label={t("Canvas tools")}>
        <button aria-pressed={mode === 'select'} onClick={() => setMode('select')}>{t("Select")}</button>
        <button aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}>{t("Draw region")}</button>
        <button aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}>{t("Pan")}</button>
      </div>
      <label className="checkbox small"><input type="checkbox" checked={showSources} onChange={e => setShowSources(e.target.checked)} /> {t("Source bounds")}</label>
      <div className="zoom-controls">
        <button aria-label={t("Zoom out")} onClick={() => setZoom(z => Math.max(0.2, z / 1.25))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label={t("Zoom in")} onClick={() => setZoom(z => Math.min(8, z * 1.25))}>+</button>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>{t("Fit")}</button>
      </div>
    </div>
    <svg ref={svgRef} className={`design-canvas mode-${mode}`} aria-label={t("Design canvas")} role="img"
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; setDrawing(null); }}>
      <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="white" />
      {scope.preview ? <image href={`data:image/png;base64,${scope.preview.base64}`} x={b.x} y={b.y} width={b.width} height={b.height} preserveAspectRatio="none" />
        : <g className="missing-preview"><text x={b.x + b.width / 2} y={b.y + b.height / 2} textAnchor="middle" fontSize={Math.max(b.width / 45, 10)}>{inlineScope(scope) ? t("No preview image · you can still annotate regions") : t('No overview image · use source bounds to draw regions')}</text></g>}
      {showSources && sourceNodes.filter(n => n.bbox && n.visible).slice(0, 2000).map(n => <rect key={n.id} {...n.bbox!} fill="none" stroke="#8b5cf6" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.35} pointerEvents="none" />)}
      {visible.map(a => <g key={a.id} data-annotation-id={a.id} className={`region ${a.id === selectedId ? 'selected' : ''} status-${a.reviewStatus}`}>
        <rect {...a.bbox} fill={a.id === selectedId ? '#00a89925' : '#126ad316'} stroke={a.reviewStatus === 'approved' ? '#14846b' : '#2876c8'} strokeWidth={a.id === selectedId ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" />
        <text x={a.bbox.x + 5 / zoom} y={a.bbox.y + 15 / zoom} fontSize={Math.max(10, b.width / 100) / zoom} fill="#103f66" paintOrder="stroke" stroke="white" strokeWidth={2 / zoom} pointerEvents="none">{a.name}</text>
        {a.id === selectedId && <rect data-handle="resize" x={a.bbox.x + a.bbox.width - 5 / zoom} y={a.bbox.y + a.bbox.height - 5 / zoom} width={10 / zoom} height={10 / zoom} fill="#009b8d" stroke="white" strokeWidth={1 / zoom} className="resize-handle" />}
      </g>)}
      {drawing && <rect {...drawing} fill="#00a89922" stroke="#009b8d" strokeDasharray="5 3" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    </svg>
    <div className="canvas-footer"><span>{inlineScope(scope)
      ? t('{nodes} source nodes · {regions} regions', { nodes: formatNumber(scope.nodes.length), regions: formatNumber(annotations.length) })
      : t('{nodes} source nodes · {loaded} bounds shown · {regions} regions', { nodes: formatNumber(scopeNodeCount(scope)), loaded: formatNumber(fetchedNodes.length), regions: formatNumber(annotations.length) })}</span><span>{mode === 'draw' ? t("Drag to mark a component. Save it in the inspector.") : t("Drag a selected region to move · corner handle to resize · Alt + drag to pan")}</span></div>
  </div>;
}
