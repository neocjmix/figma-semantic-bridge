import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Annotation, NodePreviewResult, Rect, Snapshot, SourceNode, SourceReference } from '../src/shared/contracts.js';
import type { RenderingEvidence } from '../src/core/rendering-evidence.js';

interface Props {
  annotation: Annotation;
  snapshot: Snapshot;
  renderingEvidence: ReadonlyMap<string, RenderingEvidence>;
  renderingReviewRequired: boolean;
  nodePreview: NodePreviewState | null;
  saved: boolean;
  dirty: boolean;
  busy: boolean;
  connected: boolean;
  sessionId: string | null;
  onMatch(): void;
  onAddCurrent(): void;
  onConfirm(): void;
  onReferencesChange(refs: SourceReference[]): void;
  onShowInFigma(nodeId: string): void;
  onPreviewNode(nodeId: string): void;
  onCloseNodePreview(): void;
}
const PAGE_SIZE = 25;
export type NodePreviewState = { nodeId: string } & (
  { status: 'loading' } | { status: 'ready'; result: NodePreviewResult } | { status: 'error'; message: string }
);

function RenderingEvidenceInfo({ node, evidence }: { node: SourceNode | undefined; evidence: RenderingEvidence | undefined }) {
  const status = evidence?.status ?? 'unknown';
  return <span className={`rendering-evidence rendering-${status}`}>
    <span className="rendering-state">{status === 'potential' ? 'Potential within captured scope' : status === 'transparent' ? 'Transparent' : status === 'hidden' ? 'Hidden' : 'Unknown'}</span>
    <span className="rendering-reason">{evidence?.reason ?? 'Rendering evidence is unavailable for this source.'}</span>
    {evidence?.sourceNodeId && <small>Evidence node: <code>{evidence.sourceNodeId}</code></small>}
    {node?.rendering?.opacity !== undefined && <small>Observed opacity: {node.rendering.opacity}</small>}
    {node?.rendering?.siblingIndex !== undefined && <small>Sibling index: {node.rendering.siblingIndex} · within its source parent</small>}
  </span>;
}

/** This is a crop of the captured composite, never an isolated-node render. */
function CapturedArea({ snapshot, bounds, label }: { snapshot: Snapshot; bounds: Rect | null; label: string }) {
  const clipId = `source-crop-${useId().replaceAll(':', '')}`;
  if (!bounds || !snapshot.preview) return <p className="small muted">Captured preview unavailable for {label}.</p>;
  const source = snapshot.bounds;
  const x = Math.max(source.x, bounds.x), y = Math.max(source.y, bounds.y);
  const width = Math.min(source.x + source.width, bounds.x + bounds.width) - x;
  const height = Math.min(source.y + source.height, bounds.y + bounds.height) - y;
  if (width <= 0 || height <= 0) return <p className="small muted">These bounds are outside the captured image.</p>;
  return <figure className="source-crop">
    <svg role="img" aria-label={`Captured area: ${label}`} viewBox={`${x} ${y} ${width} ${height}`}>
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <image href={`data:image/png;base64,${snapshot.preview.base64}`} {...source} preserveAspectRatio="none" />
        <rect x={x} y={y} width={width} height={height} fill="none" stroke="#008f83" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
    <figcaption>{label} · captured composite. Overlapping layers remain combined.</figcaption>
  </figure>;
}

function NodePreviewContent({ snapshot, node, preview, descriptionId }: {
  snapshot: Snapshot; node: SourceNode; preview: NodePreviewState; descriptionId?: string;
}) {
  const label = `${node.name || node.type} (${node.id})`;
  return <>
    <div className="node-preview-comparison">
      <div><h3>Captured composite</h3><time dateTime={snapshot.source.capturedAt}>{new Date(snapshot.source.capturedAt).toLocaleString()}</time>
        <CapturedArea snapshot={snapshot} bounds={node.bbox} label={label} />
      </div>
      <div><h3>Current node export</h3>
        {preview.status === 'loading' && <p className="small muted" role="status">Requesting this node from Figma…</p>}
        {preview.status === 'error' && <p className="small node-preview-error" role="alert">{preview.message}</p>}
        {preview.status === 'ready' && <>
          <time dateTime={preview.result.observedAt}>{new Date(preview.result.observedAt).toLocaleString()}</time>
          <figure className="node-export-image"><img alt={`Current node export: ${label}`} src={`data:image/png;base64,${preview.result.preview.base64}`} width={preview.result.preview.width} height={preview.result.preview.height} />
            <figcaption>Node and its descendants · current observation</figcaption>
          </figure>
        </>}
      </div>
    </div>
    <p id={descriptionId} className="small muted">These images were observed at different times. Current export excludes outside siblings and does not prove pixel contribution or occlusion in the capture.</p>
    <p className="small muted">A transparent export may look blank. Its cause is not determined, and source visibility is never changed.</p>
    {preview.status === 'ready' && preview.result.warnings.length > 0 && <ul className="small muted" aria-label="Current export warnings">{preview.result.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>}
  </>;
}

function NodeExportComparison({ snapshot, node, preview, canNavigate, onShowInFigma, onClose }: {
  snapshot: Snapshot; node: SourceNode; preview: NodePreviewState; canNavigate: boolean;
  onShowInFigma(nodeId: string): void; onClose(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), enlargeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (expanded && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [expanded]);
  return <section className="current-node-preview" aria-label="Current node export comparison">
    <strong>{node.name || node.type} ({node.id})</strong>
    <NodePreviewContent snapshot={snapshot} node={node} preview={preview} />
    <div className="source-row-actions"><button ref={enlargeButton} className="text-button" disabled={preview.status !== 'ready'} onClick={() => setExpanded(true)}>Enlarge comparison</button><button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(node.id)}>Show in Figma</button><button className="text-button" onClick={onClose}>Close current export</button></div>
    <dialog ref={dialog} className="node-comparison-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onClose={() => { setExpanded(false); enlargeButton.current?.focus(); }}>
      {expanded && <>
        <div className="node-comparison-dialog-header"><div><h2 id={titleId}>Enlarged source comparison</h2><p className="small muted">{node.name || node.type} ({node.id})</p></div><button autoFocus onClick={() => dialog.current?.close()}>Close comparison</button></div>
        <NodePreviewContent snapshot={snapshot} node={node} preview={preview} descriptionId={descriptionId} />
        <button disabled={!canNavigate} onClick={() => onShowInFigma(node.id)}>Show in Figma</button>
      </>}
    </dialog>
  </section>;
}

export function SourceReviewPanel({ annotation, snapshot, renderingEvidence, renderingReviewRequired, nodePreview, saved, dirty, busy, connected, sessionId,
  onMatch, onAddCurrent, onConfirm, onReferencesChange, onShowInFigma, onPreviewNode, onCloseNodePreview }: Props) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [candidatePage, setCandidatePage] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const nodesById = useMemo(() => new Map(snapshot.nodes.map(node => [node.id, node])), [snapshot.nodes]);
  const hasObservedRendering = snapshot.nodes.some(node => node.rendering !== undefined);
  const selectedIds = new Set(annotation.sourceRefs.map(ref => ref.nodeId));
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? snapshot.nodes.filter(node => `${node.id} ${node.name} ${node.type}`.toLocaleLowerCase().includes(term)) : snapshot.nodes;
  }, [snapshot.nodes, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const review = annotation.sourceReview;
  const requiresConfirmation = !!(review?.ambiguous || renderingReviewRequired) && review?.status !== 'confirmed';
  const candidates = review?.candidates ?? [];
  const candidatePageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const currentCandidatePage = Math.min(candidatePage, candidatePageCount - 1);
  const preview = previewId ? nodesById.get(previewId) : null;
  const exportedNode = nodePreview ? nodesById.get(nodePreview.nodeId) : null;
  const canNavigate = connected && !!snapshot.source.fileKey && !busy;
  const canExport = canNavigate && saved && !!sessionId;
  function compareNode(nodeId: string) { setPreviewId(null); onPreviewNode(nodeId); }
  function toggleReference(nodeId: string, checked: boolean) {
    const remaining = annotation.sourceRefs.filter(ref => ref.nodeId !== nodeId);
    onReferencesChange(checked ? [...remaining, { snapshotId: snapshot.id, nodeId, matchType: 'partial' }] : remaining);
  }
  return <section className="source-review" aria-label="Source grounding review">
    <div className="section-title"><h2>Source grounding</h2><span className="count">{annotation.sourceRefs.length}</span></div>
    <p className="small muted">Inspect in Figma, add each intended node, save the set, then confirm sources. Annotation approval is a separate decision.</p>
    <p className="small muted">Potential does not prove that a node contributes visible pixels. Masks, clipping and outside layers remain uncertain. Sibling indices describe order under one parent, not occlusion.</p>
    {!hasObservedRendering && <p className="small muted rendering-legacy-note">This older capture has no observed opacity. Missing evidence stays unknown; existing approvals are preserved.</p>}
    <button className="wide" disabled={busy || !saved || dirty} onClick={onMatch}>Match source</button>
    <button className="wide" disabled={busy || !saved || !connected || !sessionId} onClick={onAddCurrent}>Add current Figma selection</button>
    {!saved && <p className="small muted">Save this annotation before adding the current Figma selection.</p>}
    {!connected && <p className="small muted">Connect the plugin to add a native selection. Saved references remain available.</p>}
    <p className="small muted">Compare current export requests one node image from Figma. Save the annotation and connect the source file first. Viewing an export does not add or confirm a source.</p>
    <CapturedArea snapshot={snapshot} bounds={annotation.bbox} label="Semantic region" />
    {nodePreview && exportedNode && <NodeExportComparison key={exportedNode.id} snapshot={snapshot} node={exportedNode} preview={nodePreview} canNavigate={canNavigate} onShowInFigma={onShowInFigma} onClose={onCloseNodePreview} />}
    {(review || renderingReviewRequired) && <div className={`source-review-state ${requiresConfirmation ? 'needs-review' : ''}`}>
      <strong>{dirty ? 'Unsaved changes — save to refresh source review' : review?.status === 'confirmed' ? 'Sources confirmed by a human' : renderingReviewRequired ? 'Rendering evidence requires source confirmation' : review?.ambiguous ? 'Ambiguous sources — confirmation required' : 'Sources not confirmed'}</strong>
      {review?.confirmedAt && <p className="small muted">{dirty ? 'Previously saved source set confirmed' : 'Confirmed'} {new Date(review.confirmedAt).toLocaleString()}{dirty ? '. Current draft changes are not confirmed.' : ''}</p>}
      {review && review.warnings.length > 0 && <ul aria-label="Source matching warnings">{review.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>}
    </div>}
    <div className="source-references" aria-label="Selected source references">
      {annotation.sourceRefs.map(ref => {
        const node = nodesById.get(ref.nodeId);
        return <div key={ref.nodeId}>
          <strong>{node?.name || node?.type || ref.nodeId}</strong><code>{ref.nodeId}</code>
          <span>{ref.matchType}{ref.coverage !== undefined ? ` · ${Math.round(ref.coverage * 100)}% geometric coverage` : ''}</span>
          <RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(ref.nodeId)} />
          <div className="source-row-actions">
            <button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(ref.nodeId)}>Show in Figma</button>
            <button className="text-button" disabled={!node?.bbox} onClick={() => setPreviewId(ref.nodeId)}>Preview captured area</button>
            <button className="text-button" disabled={!canExport} onClick={() => compareNode(ref.nodeId)}>Compare current export</button>
            <button className="text-button" aria-label={`Remove source ${ref.nodeId}`} disabled={busy} onClick={() => toggleReference(ref.nodeId, false)}>Remove</button>
          </div>
        </div>;
      })}
    </div>
    {annotation.sourceRefs.length > 0 && <button className="text-button" disabled={busy} onClick={() => onReferencesChange([])}>Clear selected sources</button>}
    {preview && <div className="candidate-preview"><CapturedArea snapshot={snapshot} bounds={preview.bbox} label={`${preview.name || preview.type} (${preview.id})`} /><button className="text-button" onClick={() => setPreviewId(null)}>Close candidate preview</button></div>}
    {candidates.length > 0 && <details className="source-candidates" open={requiresConfirmation}>
      <summary>Compare {candidates.length} geometric candidates</summary>
      <p className="small muted">Automatic matching excludes observed hidden and zero-opacity nodes. Other candidates may still be covered. Use native Figma inspection to choose the intended source set.</p>
      {candidates.slice(currentCandidatePage * PAGE_SIZE, (currentCandidatePage + 1) * PAGE_SIZE).map(candidate => {
        const node = nodesById.get(candidate.nodeId);
        return <article className="source-candidate" key={candidate.nodeId}>
          <label className="checkbox"><input type="checkbox" checked={selectedIds.has(candidate.nodeId)} disabled={busy} onChange={event => toggleReference(candidate.nodeId, event.target.checked)} /><span>{node?.name || node?.type || candidate.nodeId}<small>{candidate.nodeId} · {candidate.reason}</small></span></label>
          <p className="small muted">Coverage {Math.round(candidate.coverage * 100)}% · IoU {Math.round(candidate.iou * 100)}% · geometry only</p>
          <RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(candidate.nodeId)} />
          <div className="source-row-actions"><button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(candidate.nodeId)}>Show in Figma</button><button className="text-button" disabled={!node?.bbox} onClick={() => setPreviewId(candidate.nodeId)}>Preview captured area</button><button className="text-button" disabled={!canExport} onClick={() => compareNode(candidate.nodeId)}>Compare current export</button></div>
        </article>;
      })}
      {candidatePageCount > 1 && <div className="source-pagination"><button disabled={currentCandidatePage === 0} onClick={() => setCandidatePage(currentCandidatePage - 1)}>Previous candidates</button><span>{currentCandidatePage + 1} / {candidatePageCount}</span><button disabled={currentCandidatePage + 1 >= candidatePageCount} onClick={() => setCandidatePage(currentCandidatePage + 1)}>Next candidates</button></div>}
    </details>}
    <details><summary>Adjust source references manually</summary>
      <p className="small muted">Search all captured nodes. Changes remain in this draft until Save annotation.</p>
      <p className="small muted">Hidden and transparent sources remain selectable for explicit human review. Their metadata is preserved even when automatic matching excludes them.</p>
      <label>Search captured nodes<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Name, node ID or type" /></label>
      <p className="small muted">{filtered.length} captured nodes · page {currentPage + 1} of {pageCount}</p>
      <div className="manual-sources">{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(node => <div className="manual-source" key={node.id}>
        <label className="checkbox"><input type="checkbox" checked={selectedIds.has(node.id)} disabled={busy} onChange={event => toggleReference(node.id, event.target.checked)} /><span>{node.name || node.type}<small>{node.id} · {node.type}</small><RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(node.id)} /></span></label>
        <button className="text-button" disabled={!canExport} onClick={() => compareNode(node.id)}>Compare current export</button>
      </div>)}</div>
      <div className="source-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous nodes</button><button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next nodes</button></div>
    </details>
    <button className="wide" disabled={busy || !saved || dirty || annotation.sourceRefs.length === 0 || review?.status === 'confirmed'} onClick={onConfirm}>Confirm sources</button>
    {dirty && <p className="small muted">Save annotation before confirming this source set.</p>}
    {requiresConfirmation && <p className="small source-confirmation-required">Approval is unavailable until you explicitly confirm the saved source set.</p>}
  </section>;
}
