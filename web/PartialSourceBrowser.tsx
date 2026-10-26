import { useEffect, useRef, useState } from 'react';
import { CollectionEvidencePageSchema, CollectionEvidenceTextSchema,
  type CollectionEvidenceNode, type CollectionEvidencePage } from '../src/shared/collection-evidence.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, type UIMessage } from './locale.js';

/** Browse only verified saved records. This never establishes whole-source coverage. */
export function PartialSourceBrowser({ token, projectId, collectionId, savedParts, busy, onBranchReady, onPreparePart }: {
  token: string; projectId: string; collectionId: string; savedParts: number; busy: boolean;
  onBranchReady?: (nodeId: string) => void;
  onPreparePart?: (nodeId: string) => void;
}) {
  const { t, renderMessage, formatNumber } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(''), [searched, setSearched] = useState('');
  const [offsets, setOffsets] = useState([0]);
  const [page, setPage] = useState<CollectionEvidencePage | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<UIMessage | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [text, setText] = useState<{ nodeId: string; name: string; value: string } | null>(null);
  const pendingText = useRef<AbortController | null>(null);
  const offset = offsets.at(-1) ?? 0;
  const base = `/api/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(collectionId)}`;

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void request(token, `${base}/evidence`, { offset, limit: 25, ...(searched ? { query: searched } : {}) }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(CollectionEvidencePageSchema.parse(value)); })
      .catch(cause => { if (!controller.signal.aborted) { setPage(null); setError(errorMessage(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, base, offset, searched, expanded, savedParts]);

  useEffect(() => {
    setText(null); setReading(null);
    return () => pendingText.current?.abort();
  }, [token, projectId, collectionId]);

  async function readText(node: CollectionEvidenceNode) {
    if (pendingText.current || !node.textAvailable) return;
    const controller = new AbortController(); pendingText.current = controller;
    setReading(node.id); setText(null); setError(null);
    try {
      let position = 0, original = '', totalLength: number | null = null;
      while (true) {
        const part = CollectionEvidenceTextSchema.parse(await request(token, `${base}/evidence-text`,
          { nodeId: node.id, offset: position, limit: 4000 }, controller.signal));
        if (part.snapshot.collectionId !== collectionId || part.nodeId !== node.id || part.offset !== position ||
          totalLength !== null && part.totalLength !== totalLength || part.nextOffset !== null && part.nextOffset <= position)
          throw new Error('Source text response did not match the requested node and offset.');
        totalLength = part.totalLength; original += part.text;
        if (original.length > 50000 || original.length > totalLength)
          throw new Error('Source text exceeded its declared length.');
        if (part.nextOffset === null) {
          if (original.length !== totalLength) throw new Error('Source text ended before its declared length.');
          break;
        }
        if (original.length !== part.nextOffset) throw new Error('Source text continuation was not contiguous.');
        position = part.nextOffset;
      }
      if (!controller.signal.aborted) setText({ nodeId: node.id, name: node.name, value: original });
    } catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (pendingText.current === controller) { pendingText.current = null; setReading(null); } }
  }

  return <details className="partial-source-browser" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t('Received sources')}</summary>
    <p className="small muted">{t('Search covers only saved material. Missing layers may still change which sources belong to your region.')}</p>
    <p className="small muted">{t('This is the saved observation. It has not been checked against the current Figma design.')}</p>
    <form onSubmit={event => { event.preventDefault(); setOffsets([0]); setSearched(query.trim()); }}>
      <label>{t('Search received sources')}<input value={query} maxLength={300} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={loading}>{t('Search')}</button>
    </form>
    {error && <p className="small error" role="alert">{renderMessage(error)}</p>}
    {loading && <p className="small muted" role="status">{t('Loading saved sources…')}</p>}
    {page && <>
      <p className="small muted">{t('{count} saved sources match this search. The full design may contain more.', { count: formatNumber(page.total) })}</p>
      <ul className="collection-nodes">{page.nodes.map(node => <li key={node.id}>
        <div><strong>{node.name || node.type}</strong><small>{node.type} · {node.id}</small>
          <p className="small muted">{node.subtreeComplete ? t('This part has all its saved source nodes.') : t('This part still has missing source nodes.')}</p>
          {node.type === 'TEXT' && !node.textAvailable && <p className="small muted">{t('This text has not been read yet.')}</p>}
          {node.textAvailable && <button className="text-button" disabled={!!reading} onClick={() => void readText(node)}>
            {reading === node.id ? t('Loading source text…') : t('Read original text')}</button>}
          {node.subtreeComplete && node.bbox && onBranchReady && <button className="text-button" disabled={busy || loading}
            onClick={() => onBranchReady(node.id)}>{t('Review this part')}</button>}
          {!node.subtreeComplete && node.id !== page.snapshot.source.nodeId && node.declaredChildCount > 0 && node.bbox && onPreparePart && <button className="text-button" disabled={busy || loading}
            onClick={() => onPreparePart(node.id)}>{t('Prepare this part')}</button>}
        </div>
      </li>)}</ul>
      <div className="collection-page-actions">
        <button disabled={loading || offset === 0} onClick={() => setOffsets(value => value.slice(0, -1))}>{t('Previous page')}</button>
        <button disabled={loading || page.nextOffset === null} onClick={() => {
          if (page.nextOffset !== null) setOffsets(value => [...value, page.nextOffset!]);
        }}>{t('Next page')}</button>
      </div>
    </>}
    {text && <section aria-label={t('Saved original text')}>
      <strong>{text.name || text.nodeId}</strong>
      {text.value === '' ? <p className="small muted">{t('The saved original text is empty.')}</p> : <pre className="source-original-text">{text.value}</pre>}
      <button className="text-button" onClick={() => setText(null)}>{t('Close original text')}</button>
    </section>}
  </details>;
}
