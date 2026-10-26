import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { SourceNodeSchema, type Annotation, type EvidenceScope, type SourceReference } from '../src/shared/contracts.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, type UIMessage } from './locale.js';
import type { NodePreviewState } from './SourceReviewPanel.js';

const NodeSummarySchema = SourceNodeSchema.omit({ text: true }).extend({ textLength: z.number().int().min(0).max(50000).nullable() }).strict();
export const NodePageSchema = z.object({ nodes: z.array(NodeSummarySchema).max(200), nextOffset: z.number().int().min(0).nullable(),
  total: z.number().int().min(0), complete: z.literal(true), reviewStatus: z.literal('unreviewed') }).strict();
const TextPageSchema = z.object({ nodeId: z.string(), text: z.string().max(4000), offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(), totalLength: z.number().int().min(0).max(50000), reviewStatus: z.literal('unreviewed') }).strict();
type NodeSummary = z.infer<typeof NodeSummarySchema>;
type NodePage = z.infer<typeof NodePageSchema>;
export type ChosenEvidenceText = { scopeId: string; nodeId: string; name: string; text: string };

function useNodePage(token: string, projectId: string, scopeId: string, textOnly: boolean, enabled = true) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [offsets, setOffsets] = useState([0]);
  const [page, setPage] = useState<NodePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UIMessage | null>(null);
  const offset = offsets.at(-1) ?? 0;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setPage(null); setLoading(true); setError(null);
    void request<unknown>(token, `/api/projects/${encodeURIComponent(projectId)}/evidence-scopes/${encodeURIComponent(scopeId)}/nodes`,
      { offset, limit: 50, ...(searched ? { query: searched } : {}), ...(textOnly ? { textOnly: true } : {}) }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(NodePageSchema.parse(value)); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, projectId, scopeId, textOnly, offset, searched, enabled]);
  return { query, setQuery, searched, setSearched, offsets, setOffsets, offset, page, loading, error };
}

export async function loadEvidenceText(token: string, projectId: string, scopeId: string, nodeId: string, signal: AbortSignal): Promise<string> {
  let offset = 0, text = '', totalLength: number | null = null;
  while (true) {
    const value = await request<unknown>(token,
      `/api/projects/${encodeURIComponent(projectId)}/evidence-scopes/${encodeURIComponent(scopeId)}/text`,
      { nodeId, offset, limit: 4000 }, signal);
    const part = TextPageSchema.parse(value);
    if (part.nodeId !== nodeId || part.offset !== offset || (totalLength !== null && totalLength !== part.totalLength) ||
        part.nextOffset !== null && part.nextOffset <= offset) throw new Error('Source text response did not match the requested node and offset.');
    totalLength = part.totalLength; text += part.text;
    if (text.length > 50000 || text.length > totalLength) throw new Error('Source text exceeded its declared length.');
    if (part.nextOffset === null) {
      if (text.length !== totalLength) throw new Error('Source text ended before its declared length.');
      return text;
    }
    if (text.length !== part.nextOffset) throw new Error('Source text continuation was not contiguous.');
    offset = part.nextOffset;
  }
}

function PageControls({ offset, page, loading, previous, next }: {
  offset: number; page: NodePage | null; loading: boolean; previous(): void; next(): void;
}) {
  const { t, systemText, formatNumber } = useLocale();
  return <><p className="small muted">{page ? t('Nodes {from}–{to} of {total} · not reviewed', {
    from: page.nodes.length ? offset + 1 : 0, to: offset + page.nodes.length, total: formatNumber(page.total),
  }) : t('Loading source nodes…')}</p>
    <div className="collection-page-actions"><button disabled={offset === 0 || loading} onClick={previous}>{t('Previous page')}</button>
      <button disabled={page?.nextOffset === null || !page || loading} onClick={next}>{t('Next page')}</button></div></>;
}

export function EvidenceSourcePanel({ token, projectId, scope, annotation, saved, dirty, busy, connected, sessionId,
  nodePreview, onMatch, onAddCurrent, onConfirm, onReferencesChange, onShowInFigma, onPreviewNode, onCloseNodePreview }: {
  token: string; projectId: string; scope: EvidenceScope; annotation: Annotation; saved: boolean; dirty: boolean;
  busy: boolean; connected: boolean; sessionId: string | null; nodePreview: NodePreviewState | null;
  onMatch(): void; onAddCurrent(): void; onConfirm(): void; onReferencesChange(refs: SourceReference[]): void;
  onShowInFigma(nodeId: string): void; onPreviewNode(nodeId: string): void; onCloseNodePreview(): void;
}) {
  const { t, systemText, renderMessage, formatDate, formatNumber } = useLocale();
  const complete = scope.kind === 'collection';
  const [browseOpen, setBrowseOpen] = useState(false);
  const browser = useNodePage(token, projectId, scope.id, false, complete && browseOpen);
  const selectedIds = new Set(annotation.sourceRefs.map(ref => ref.nodeId));
  const review = annotation.sourceReview;
  const candidates = review?.candidates ?? [];
  const [candidatePage, setCandidatePage] = useState(0);
  const candidateOffset = candidatePage * 25;
  function toggle(nodeId: string, checked: boolean) {
    const remaining = annotation.sourceRefs.filter(ref => ref.nodeId !== nodeId);
    onReferencesChange(checked ? [...remaining, { snapshotId: scope.id, nodeId, matchType: 'partial' }] : remaining);
  }
  const preview = nodePreview?.status === 'ready' ? nodePreview.result : null;
  return <section className="source-review evidence-source-review" aria-label={t('Review source connections')}>
    <div className="section-title"><h2>{t('Source connections')}</h2><span className="count">{annotation.sourceRefs.length}</span></div>
    {scope.kind === 'visual' ? <p className="small evidence-warning">{t('This draft has an image only. Save your regions, then attach complete source structure to match nodes, confirm sources and approve.')}</p> : <>
      <p className="small muted">{t('All source nodes have been collected. Compare them with the image, then save and confirm your chosen sources before approval.')}</p>
      <p className="small muted">{t('Nodes are loaded a page at a time. Matching positions alone cannot tell you which overlapping layer is visible.')}</p>
      <button className="wide" disabled={busy || !saved || dirty} onClick={onMatch}>{t('Match source')}</button>
      <button className="wide" disabled={busy || !saved || !connected || !sessionId} onClick={onAddCurrent}>{t('Add current Figma selection')}</button>
      {review && <div className={`source-review-state ${review.status === 'confirmed' ? '' : 'needs-review'}`}>
        <strong>{dirty ? t('Unsaved changes — save to refresh source review') : review.status === 'confirmed' ? t('Sources confirmed by a human') : t('Sources not confirmed')}</strong>
        {review.confirmedAt && <p className="small muted">{t('Confirmed {date}', { date: formatDate(review.confirmedAt) })}</p>}
        {review.warnings.map((warning, index) => <p className="small muted" key={`${index}:${warning}`}>{systemText(warning)}</p>)}
      </div>}
      <div className="source-references" aria-label={t('Selected source nodes')}>{annotation.sourceRefs.map(ref => <div key={ref.nodeId}>
        <strong>{ref.nodeId}</strong><span>{t(ref.matchType)}</span>
        <div className="source-row-actions"><button className="text-button" disabled={!connected || busy} onClick={() => onShowInFigma(ref.nodeId)}>{t('Show in Figma')}</button>
          <button className="text-button" disabled={!connected || !saved || busy} onClick={() => onPreviewNode(ref.nodeId)}>{t('Compare current export')}</button>
          <button className="text-button" disabled={busy} onClick={() => toggle(ref.nodeId, false)}>{t('Remove')}</button></div>
      </div>)}</div>
      {nodePreview && <div className="current-node-preview"><strong>{nodePreview.nodeId}</strong>
        {nodePreview.status === 'loading' && <p role="status" className="small muted">{t('Requesting this node from Figma…')}</p>}
        {nodePreview.status === 'error' && <p role="alert" className="small error">{renderMessage(nodePreview.message)}</p>}
        {preview && <figure className="node-export-image"><img alt={t('Current node export: {label}', { label: nodePreview.nodeId })}
          src={`data:image/png;base64,${preview.preview.base64}`} /><figcaption>{t('This is the current Figma image. Viewing it does not confirm your saved sources.')}</figcaption></figure>}
        <button className="text-button" onClick={onCloseNodePreview}>{t('Close current export')}</button></div>}
      {candidates.length > 0 && <details className="source-candidates"><summary>{t('Compare {count} matching candidates', { count: formatNumber(candidates.length) })}</summary>
        {candidates.slice(candidateOffset, candidateOffset + 25).map(candidate => <article className="source-candidate" key={candidate.nodeId}>
          <label className="checkbox"><input type="checkbox" checked={selectedIds.has(candidate.nodeId)} disabled={busy}
            onChange={event => toggle(candidate.nodeId, event.target.checked)} /><span>{candidate.nodeId}<small>{systemText(candidate.reason)}</small></span></label>
          <p className="small muted">{t('Area coverage {coverage}% · overlap {iou}% · position only', { coverage: Math.round(candidate.coverage * 100), iou: Math.round(candidate.iou * 100) })}</p>
        </article>)}
        <div className="collection-page-actions"><button disabled={candidatePage === 0} onClick={() => setCandidatePage(value => value - 1)}>{t('Previous candidates')}</button>
          <button disabled={candidateOffset + 25 >= candidates.length} onClick={() => setCandidatePage(value => value + 1)}>{t('Next candidates')}</button></div>
      </details>}
      <details className="advanced" onToggle={event => setBrowseOpen(event.currentTarget.open)}><summary>{t('Browse collected source nodes')}</summary>
        <form onSubmit={event => { event.preventDefault(); browser.setOffsets([0]); browser.setSearched(browser.query.trim()); }}>
          <label>{t('Search captured nodes')}<input value={browser.query} maxLength={300} onChange={event => browser.setQuery(event.target.value)} placeholder={t('Name, node ID or type')} /></label>
          <button disabled={browser.loading}>{t('Search')}</button></form>
        {browser.error && <p role="alert" className="small error">{renderMessage(browser.error)}</p>}
        <ul className="collection-nodes">{browser.page?.nodes.map(node => <li key={node.id}>
          <label className="checkbox"><input type="checkbox" checked={selectedIds.has(node.id)} disabled={busy}
            onChange={event => toggle(node.id, event.target.checked)} /><span>{node.name || node.type}<small>{node.id} · {node.type}</small></span></label>
          <button className="text-button" disabled={!connected || !saved || busy} onClick={() => onPreviewNode(node.id)}>{t('Compare current export')}</button>
        </li>)}</ul>
        <PageControls offset={browser.offset} page={browser.page} loading={browser.loading}
          previous={() => browser.setOffsets(value => value.slice(0, -1))}
          next={() => { if (browser.page?.nextOffset !== null && browser.page) browser.setOffsets(value => [...value, browser.page!.nextOffset!]); }} />
      </details>
      <button className="wide" disabled={busy || !saved || dirty || annotation.sourceRefs.length === 0 || review?.status === 'confirmed'} onClick={onConfirm}>{t('Confirm sources')}</button>
      {review?.status !== 'confirmed' && <p className="small evidence-warning">{t('Confirm the saved source nodes before approving the annotation.')}</p>}
    </>}
  </section>;
}

export function EvidenceTextPicker({ token, projectId, scope, selected, busy, onPick }: {
  token: string; projectId: string; scope: EvidenceScope; selected: ReadonlySet<string>; busy: boolean;
  onPick(value: ChosenEvidenceText): void;
}) {
  const { t, systemText, renderMessage, formatNumber } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const browser = useNodePage(token, projectId, scope.id, true, expanded);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<UIMessage | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [token, projectId, scope.id, busy]);
  async function choose(node: NodeSummary) {
    if (busy || reading || node.textLength === null || node.textLength === 0) return;
    const controller = new AbortController(); pending.current = controller; setReading(node.id); setError(null);
    try {
      const text = await loadEvidenceText(token, projectId, scope.id, node.id, controller.signal);
      if (!controller.signal.aborted && text) onPick({ scopeId: scope.id, nodeId: node.id, name: node.name, text });
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (pending.current === controller) pending.current = null; setReading(null); }
  }
  return <details className="evidence-text-picker" onToggle={event => setExpanded(event.currentTarget.open)}><summary>{t('Choose original text')}</summary>
    <p className="small muted">{t('Only the text you choose is loaded. Its original wording and selection order are preserved.')}</p>
    <form onSubmit={event => { event.preventDefault(); browser.setOffsets([0]); browser.setSearched(browser.query.trim()); }}>
      <label>{t('Search source text nodes')}<input value={browser.query} maxLength={300} onChange={event => browser.setQuery(event.target.value)} /></label>
      <button disabled={browser.loading}>{t('Search')}</button></form>
    {(error || browser.error) && <p role="alert" className="small error">{renderMessage(error ?? browser.error!)}</p>}
    <ul className="collection-nodes">{browser.page?.nodes.map(node => <li key={node.id}>
      <span><strong>{node.name || node.type}</strong><small>{node.id} · {t('{count} text characters', { count: formatNumber(node.textLength ?? 0) })}</small></span>
      <button className="text-button" disabled={busy || !!reading || !node.textLength || selected.has(JSON.stringify([scope.id, node.id]))}
        onClick={() => void choose(node)}>{reading === node.id ? t('Loading source text…') : t('Use original text')}</button>
    </li>)}</ul>
    <PageControls offset={browser.offset} page={browser.page} loading={browser.loading}
      previous={() => browser.setOffsets(value => value.slice(0, -1))}
      next={() => { if (browser.page?.nextOffset !== null && browser.page) browser.setOffsets(value => [...value, browser.page!.nextOffset!]); }} />
  </details>;
}
