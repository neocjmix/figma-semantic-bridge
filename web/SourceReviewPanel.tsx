import { useLocale } from './i18n.js';
import type { UIMessage } from './locale.js';
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
  { status: 'loading' } | { status: 'ready'; result: NodePreviewResult } | { status: 'error'; message: UIMessage }
);

function RenderingEvidenceInfo({ node, evidence }: { node: SourceNode | undefined; evidence: RenderingEvidence | undefined }) {
  const { t, systemText } = useLocale();
  const status = evidence?.status ?? 'unknown';
  return <span className={`rendering-evidence rendering-${status}`}>
    <span className="rendering-state">{status === 'potential' ? t("May be visible in this capture") : status === 'transparent' ? t("Transparent") : status === 'hidden' ? t("Hidden") : t("Unknown")}</span>
    <span className="rendering-reason">{(evidence ? systemText(evidence.reason) : t("Visibility details are unavailable for this source."))}</span>
    {evidence?.sourceNodeId && <small>{t("Source node:")} <code>{evidence.sourceNodeId}</code></small>}
    {node?.rendering?.opacity !== undefined && <small>{t('Captured opacity: {opacity}', { opacity: node.rendering.opacity })}</small>}
    {node?.rendering?.siblingIndex !== undefined && <small>{t('Layer order: {index} · within the same parent', { index: node.rendering.siblingIndex })}</small>}
  </span>;
}

/** This is a crop of the captured composite, never an isolated-node render. */
function CapturedArea({ snapshot, bounds, label }: { snapshot: Snapshot; bounds: Rect | null; label: string }) {
  const { t, systemText } = useLocale();
  const clipId = `source-crop-${useId().replaceAll(':', '')}`;
  if (!bounds || !snapshot.preview) return <p className="small muted">{t('Captured preview unavailable for {label}.', { label })}</p>;
  const source = snapshot.bounds;
  const x = Math.max(source.x, bounds.x), y = Math.max(source.y, bounds.y);
  const width = Math.min(source.x + source.width, bounds.x + bounds.width) - x;
  const height = Math.min(source.y + source.height, bounds.y + bounds.height) - y;
  if (width <= 0 || height <= 0) return <p className="small muted">{t("These bounds are outside the captured image.")}</p>;
  return <figure className="source-crop">
    <svg role="img" aria-label={t('Captured area: {label}', { label })} viewBox={`${x} ${y} ${width} ${height}`}>
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <image href={`data:image/png;base64,${snapshot.preview.base64}`} {...source} preserveAspectRatio="none" />
        <rect x={x} y={y} width={width} height={height} fill="none" stroke="#008f83" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
    <figcaption>{t('{label} · captured composite. Overlapping layers remain combined.', { label })}</figcaption>
  </figure>;
}

function NodePreviewContent({ snapshot, node, preview, descriptionId }: {
  snapshot: Snapshot; node: SourceNode; preview: NodePreviewState; descriptionId?: string;
}) {
  const { t, systemText, renderMessage, formatDate } = useLocale();
  const label = `${node.name || node.type} (${node.id})`;
  return <>
    <div className="node-preview-comparison">
      <div><h3>{t("Captured composite")}</h3><time dateTime={snapshot.source.capturedAt}>{formatDate(snapshot.source.capturedAt)}</time>
        <CapturedArea snapshot={snapshot} bounds={node.bbox} label={label} />
      </div>
      <div><h3>{t("Current node export")}</h3>
        {preview.status === 'loading' && <p className="small muted" role="status">{t("Requesting this node from Figma…")}</p>}
        {preview.status === 'error' && <p className="small node-preview-error" role="alert">{renderMessage(preview.message)}</p>}
        {preview.status === 'ready' && <>
          <time dateTime={preview.result.observedAt}>{formatDate(preview.result.observedAt)}</time>
          <figure className="node-export-image"><img alt={t('Current node export: {label}', { label })} src={`data:image/png;base64,${preview.result.preview.base64}`} width={preview.result.preview.width} height={preview.result.preview.height} />
            <figcaption>{t("Node and child layers · current image")}</figcaption>
          </figure>
        </>}
      </div>
    </div>
    <p id={descriptionId} className="small muted">{t("These images were taken at different times. The current node image leaves out neighboring layers, so it cannot show whether those layers covered it in the saved capture.")}</p>
    <p className="small muted">{t("A transparent export may look blank. Its cause is not determined, and source visibility is never changed.")}</p>
    {preview.status === 'ready' && preview.result.warnings.length > 0 && <ul className="small muted" aria-label={t("Current export warnings")}>{preview.result.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{systemText(warning)}</li>)}</ul>}
  </>;
}

function NodeExportComparison({ snapshot, node, preview, canNavigate, onShowInFigma, onClose }: {
  snapshot: Snapshot; node: SourceNode; preview: NodePreviewState; canNavigate: boolean;
  onShowInFigma(nodeId: string): void; onClose(): void;
}) {
  const { t, systemText } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), enlargeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (expanded && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [expanded]);
  return <section className="current-node-preview" aria-label={t("Current node export comparison")}>
    <strong>{node.name || node.type} ({node.id})</strong>
    <NodePreviewContent snapshot={snapshot} node={node} preview={preview} />
    <div className="source-row-actions"><button ref={enlargeButton} className="text-button" disabled={preview.status !== 'ready'} onClick={() => setExpanded(true)}>{t("Enlarge comparison")}</button><button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(node.id)}>{t("Show in Figma")}</button><button className="text-button" onClick={onClose}>{t("Close current export")}</button></div>
    <dialog ref={dialog} className="node-comparison-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onClose={() => { setExpanded(false); enlargeButton.current?.focus(); }}>
      {expanded && <>
        <div className="node-comparison-dialog-header"><div><h2 id={titleId}>{t("Enlarged source comparison")}</h2><p className="small muted">{node.name || node.type} ({node.id})</p></div><button autoFocus onClick={() => dialog.current?.close()}>{t("Close comparison")}</button></div>
        <NodePreviewContent snapshot={snapshot} node={node} preview={preview} descriptionId={descriptionId} />
        <button disabled={!canNavigate} onClick={() => onShowInFigma(node.id)}>{t("Show in Figma")}</button>
      </>}
    </dialog>
  </section>;
}

export function SourceReviewPanel({ annotation, snapshot, renderingEvidence, renderingReviewRequired, nodePreview, saved, dirty, busy, connected, sessionId,
  onMatch, onAddCurrent, onConfirm, onReferencesChange, onShowInFigma, onPreviewNode, onCloseNodePreview }: Props) {
  const { t, systemText, formatDate, formatNumber } = useLocale();
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
  return <section className="source-review" aria-label={t("Review source connections")}>
    <div className="section-title"><h2>{t("Source connections")}</h2><span className="count">{annotation.sourceRefs.length}</span></div>
    <p className="small muted">{t("Check the intended nodes in Figma, add them here and save the annotation. Then confirm sources before deciding whether to approve.")}</p>
    <p className="small muted">{t("A visible setting does not guarantee that a layer appears in the image. Other layers, masks and clipping may cover it; check in Figma.")}</p>
    {!hasObservedRendering && <p className="small muted rendering-legacy-note">{t("This capture has no opacity information. Check visibility in Figma; existing approvals are kept.")}</p>}
    <button className="wide" disabled={busy || !saved || dirty} onClick={onMatch}>{t("Match source")}</button>
    <button className="wide" disabled={busy || !saved || !connected || !sessionId} onClick={onAddCurrent}>{t("Add current Figma selection")}</button>
    {!saved && <p className="small muted">{t("Save this annotation before adding the current Figma selection.")}</p>}
    {!connected && <p className="small muted">{t("Connect the Figma plugin to add the current selection. Saved sources are still available.")}</p>}
    <p className="small muted">{t("Compare current export loads one node image from Figma. Save the annotation and connect the original file first. Viewing the image does not add or confirm a source.")}</p>
    <CapturedArea snapshot={snapshot} bounds={annotation.bbox} label={t("Annotated region")} />
    {nodePreview && exportedNode && <NodeExportComparison key={exportedNode.id} snapshot={snapshot} node={exportedNode} preview={nodePreview} canNavigate={canNavigate} onShowInFigma={onShowInFigma} onClose={onCloseNodePreview} />}
    {(review || renderingReviewRequired) && <div className={`source-review-state ${requiresConfirmation ? 'needs-review' : ''}`}>
      <strong>{dirty ? t("Unsaved changes — save to refresh source review") : review?.status === 'confirmed' ? t("Sources confirmed by a human") : renderingReviewRequired ? t("Check source visibility before confirming") : review?.ambiguous ? t("Ambiguous sources — confirmation required") : t("Sources not confirmed")}</strong>
      {review?.confirmedAt && <p className="small muted">{t(dirty ? 'Previously saved source set confirmed {date}. Current draft changes are not confirmed.' : 'Confirmed {date}', { date: formatDate(review.confirmedAt) })}</p>}
      {review && review.warnings.length > 0 && <ul aria-label={t("Source matching warnings")}>{review.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{systemText(warning)}</li>)}</ul>}
    </div>}
    <div className="source-references" aria-label={t("Selected source nodes")}>
      {annotation.sourceRefs.map(ref => {
        const node = nodesById.get(ref.nodeId);
        return <div key={ref.nodeId}>
          <strong>{node?.name || node?.type || ref.nodeId}</strong><code>{ref.nodeId}</code>
          <span>{t(ref.matchType)}{ref.coverage !== undefined ? ` · ${t('{coverage}% area coverage', { coverage: Math.round(ref.coverage * 100) })}` : ''}</span>
          <RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(ref.nodeId)} />
          <div className="source-row-actions">
            <button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(ref.nodeId)}>{t("Show in Figma")}</button>
            <button className="text-button" disabled={!node?.bbox} onClick={() => setPreviewId(ref.nodeId)}>{t("Preview captured area")}</button>
            <button className="text-button" disabled={!canExport} onClick={() => compareNode(ref.nodeId)}>{t("Compare current export")}</button>
            <button className="text-button" aria-label={t('Remove source {id}', { id: ref.nodeId })} disabled={busy} onClick={() => toggleReference(ref.nodeId, false)}>{t("Remove")}</button>
          </div>
        </div>;
      })}
    </div>
    {annotation.sourceRefs.length > 0 && <button className="text-button" disabled={busy} onClick={() => onReferencesChange([])}>{t("Clear selected sources")}</button>}
    {preview && <div className="candidate-preview"><CapturedArea snapshot={snapshot} bounds={preview.bbox} label={`${preview.name || preview.type} (${preview.id})`} /><button className="text-button" onClick={() => setPreviewId(null)}>{t("Close candidate preview")}</button></div>}
    {candidates.length > 0 && <details className="source-candidates" open={requiresConfirmation}>
      <summary>{t('Compare {count} matching candidates', { count: formatNumber(candidates.length) })}</summary>
      <p className="small muted">{t("Automatic matching skips hidden and fully transparent nodes. Other nodes may still be covered by layers. Check in Figma before choosing sources.")}</p>
      {candidates.slice(currentCandidatePage * PAGE_SIZE, (currentCandidatePage + 1) * PAGE_SIZE).map(candidate => {
        const node = nodesById.get(candidate.nodeId);
        return <article className="source-candidate" key={candidate.nodeId}>
          <label className="checkbox"><input type="checkbox" checked={selectedIds.has(candidate.nodeId)} disabled={busy} onChange={event => toggleReference(candidate.nodeId, event.target.checked)} /><span>{node?.name || node?.type || candidate.nodeId}<small>{candidate.nodeId} · {systemText(candidate.reason)}</small></span></label>
          <p className="small muted">{t('Area coverage {coverage}% · overlap {iou}% · position only', { coverage: Math.round(candidate.coverage * 100), iou: Math.round(candidate.iou * 100) })}</p>
          <RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(candidate.nodeId)} />
          <div className="source-row-actions"><button className="text-button" disabled={!canNavigate} onClick={() => onShowInFigma(candidate.nodeId)}>{t("Show in Figma")}</button><button className="text-button" disabled={!node?.bbox} onClick={() => setPreviewId(candidate.nodeId)}>{t("Preview captured area")}</button><button className="text-button" disabled={!canExport} onClick={() => compareNode(candidate.nodeId)}>{t("Compare current export")}</button></div>
        </article>;
      })}
      {candidatePageCount > 1 && <div className="source-pagination"><button disabled={currentCandidatePage === 0} onClick={() => setCandidatePage(currentCandidatePage - 1)}>{t("Previous candidates")}</button><span>{currentCandidatePage + 1} / {candidatePageCount}</span><button disabled={currentCandidatePage + 1 >= candidatePageCount} onClick={() => setCandidatePage(currentCandidatePage + 1)}>{t("Next candidates")}</button></div>}
    </details>}
    <details><summary>{t("Choose source nodes manually")}</summary>
      <p className="small muted">{t("Search all captured nodes. Changes remain in this draft until Save annotation.")}</p>
      <p className="small muted">{t("You can still select hidden or transparent nodes manually after checking them in Figma.")}</p>
      <label>{t("Search captured nodes")}<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder={t("Name, node ID or type")} /></label>
      <p className="small muted">{t('{count} captured nodes · page {page} of {pages}', { count: formatNumber(filtered.length), page: currentPage + 1, pages: pageCount })}</p>
      <div className="manual-sources">{filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(node => <div className="manual-source" key={node.id}>
        <label className="checkbox"><input type="checkbox" checked={selectedIds.has(node.id)} disabled={busy} onChange={event => toggleReference(node.id, event.target.checked)} /><span>{node.name || node.type}<small>{node.id} · {node.type}</small><RenderingEvidenceInfo node={node} evidence={renderingEvidence.get(node.id)} /></span></label>
        <button className="text-button" disabled={!canExport} onClick={() => compareNode(node.id)}>{t("Compare current export")}</button>
      </div>)}</div>
      <div className="source-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous nodes")}</button><button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{t("Next nodes")}</button></div>
    </details>
    <button className="wide" disabled={busy || !saved || dirty || annotation.sourceRefs.length === 0 || review?.status === 'confirmed'} onClick={onConfirm}>{t("Confirm sources")}</button>
    {dirty && <p className="small muted">{t("Save the annotation before confirming its source nodes.")}</p>}
    {requiresConfirmation && <p className="small source-confirmation-required">{t("Confirm the saved source nodes before approving the annotation.")}</p>}
  </section>;
}
