import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { SourceNodeSchema, type EvidenceScope, type Project } from '../src/shared/contracts.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, type MessageKey, type UIMessage } from './locale.js';

const NodeSummarySchema = SourceNodeSchema.omit({ text: true }).extend({ textLength: z.number().int().min(0).nullable() }).strict();
const NodePageSchema = z.object({ nodes: z.array(NodeSummarySchema).max(200), nextOffset: z.number().int().min(0).nullable(),
  total: z.number().int().min(0), complete: z.literal(true), reviewStatus: z.literal('unreviewed') }).strict();
const TextPageSchema = z.object({ nodeId: z.string(), text: z.string(), offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(), totalLength: z.number().int().min(0), reviewStatus: z.literal('unreviewed') }).strict();
type NodePage = z.infer<typeof NodePageSchema>;
type NodeSummary = z.infer<typeof NodeSummarySchema>;
type TextView = { nodeId: string; name: string; text: string; nextOffset: number | null; totalLength: number };
type Action = 'prepare' | 'start' | 'stop' | 'resume' | 'remove' | 'nodes' | 'text' | 'add_scope' | 'attach_scope';

const statusLabels: Record<CollectionView['status'], MessageKey> = {
  prepared: 'Prepared', running: 'Working', paused: 'Paused', complete: 'Collection complete',
  failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted',
};

export function CollectionPanel({ token, project, sessionId, connected, busy, dirty, currentScope, beginProjectMutation, onScopeCreated, onScopeAttached }: {
  token: string; project: Project | null; sessionId: string | null; connected: boolean; busy: boolean; dirty: boolean;
  beginProjectMutation(): (() => void) | null;
  currentScope: EvidenceScope | null; onScopeCreated(next: Project): void; onScopeAttached(next: Project): void;
}) {
  const { t, renderMessage, formatNumber, formatDate } = useLocale();
  const [collection, setCollection] = useState<CollectionView | null>(null);
  const [history, setHistory] = useState<CollectionView[]>([]);
  const [nodePage, setNodePage] = useState<NodePage | null>(null);
  const [nodeOffset, setNodeOffset] = useState(0);
  const [textView, setTextView] = useState<TextView | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<UIMessage | null>(null);
  const generation = useRef(0), acting = useRef(false), pending = useRef(new Set<AbortController>());
  const context = useRef({ token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null });
  context.current = { token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null };
  const projectId = project?.id ?? null;
  const base = projectId ? `/api/projects/${encodeURIComponent(projectId)}/collections` : '';
  const path = collection ? `${base}/${encodeURIComponent(collection.id)}` : '';

  useEffect(() => {
    if (collection) setHistory(current => current.some(item => item.id === collection.id)
      ? current.map(item => item.id === collection.id ? collection : item) : [collection, ...current]);
  }, [collection]);

  useEffect(() => {
    const current = ++generation.current;
    for (const controller of pending.current) controller.abort();
    pending.current.clear(); acting.current = false;
    setCollection(null); setHistory([]); setNodePage(null); setTextView(null); setNodeOffset(0); setError(null); setAction(null);
    if (token && projectId) {
      const controller = new AbortController(); pending.current.add(controller);
      void request<{ collections: CollectionView[] }>(token, base, undefined, controller.signal)
        .then(response => {
          if (generation.current !== current) return;
          const items = response.collections.map(item => CollectionViewSchema.parse(item));
          setHistory(items);
          setCollection(previous => items.find(item => item.id === previous?.id) ?? previous ?? items[0] ?? null);
        })
        .catch(cause => { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); })
        .finally(() => pending.current.delete(controller));
    }
    return () => { generation.current++; for (const controller of pending.current) controller.abort(); pending.current.clear(); };
  }, [token, projectId, sessionId]);

  useEffect(() => { setNodePage(null); setNodeOffset(0); setTextView(null); }, [collection?.id]);

  useEffect(() => {
    if (!collection || collection.status !== 'running' || !projectId) return;
    const id = collection.id, current = generation.current;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController(); pending.current.add(controller);
      try {
        const next = CollectionViewSchema.parse(await request<unknown>(token,
          `/api/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(id)}`, undefined, controller.signal));
        if (active && generation.current === current) setCollection(previous => previous?.id === id &&
          Date.parse(next.updatedAt) >= Date.parse(previous.updatedAt) && !(previous.status === 'paused' && next.status === 'running') ? next : previous);
      } catch (cause) {
        if (active && generation.current === current && !controller.signal.aborted) setError(errorMessage(cause));
      } finally {
        pending.current.delete(controller);
        if (active && generation.current === current) timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { active = false; if (timer) clearTimeout(timer); controller?.abort(); };
  }, [collection?.id, collection?.status, token, projectId, sessionId]);

  async function perform<T>(kind: Action, call: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
    options: { requireRevision?: boolean; allowSessionChange?: boolean; lockEditor?: boolean } = {}) {
    if (acting.current) return;
    const releaseEditor = options.lockEditor ? beginProjectMutation() : null;
    if (options.lockEditor && !releaseEditor) return;
    acting.current = true; setAction(kind); setError(null);
    const current = generation.current, expected = { ...context.current };
    const controller = new AbortController(); pending.current.add(controller);
    try {
      const result = await call(controller.signal);
      if ((generation.current === current || options.allowSessionChange) && context.current.token === expected.token && context.current.projectId === expected.projectId
          && (options.allowSessionChange || context.current.sessionId === expected.sessionId)
          && (!options.requireRevision || context.current.revision === expected.revision)) apply(result);
    } catch (cause) {
      if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      pending.current.delete(controller);
      if (generation.current === current) { acting.current = false; setAction(null); }
      releaseEditor?.();
    }
  }
  const performView = (kind: Action, endpoint: string, body: unknown, requireRevision = false) => perform(kind,
    signal => request<unknown>(token, endpoint, body, signal).then(value => CollectionViewSchema.parse(value)),
    value => { setCollection(value); setHistory(current => [value, ...current.filter(item => item.id !== value.id)]); }, { requireRevision });

  function prepare() {
    if (!project || !sessionId || !connected || busy || dirty) return;
    void performView('prepare', base, { expectedRevision: project.revision, expectedSessionId: sessionId }, true);
  }
  function start() {
    if (!collection || collection.status !== 'prepared' || !connected || collection.sessionId !== sessionId || busy || dirty) return;
    void performView('start', `${path}/start`, {});
  }
  function stop() {
    if (!collection || collection.status !== 'running' || collection.pauseRequested) return;
    void performView('stop', `${path}/stop`, {});
  }
  function resume() {
    if (!collection || collection.status !== 'paused' || !connected || collection.sessionId !== sessionId || busy || dirty) return;
    void performView('resume', `${path}/resume`, {});
  }
  function addScope() {
    if (!project || !collection || collection.status !== 'complete' || busy || dirty || action || linkedScope) return;
    void perform('add_scope', signal => request<Project>(token, `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes`,
      { expectedRevision: project.revision, collectionId: collection.id }, signal), onScopeCreated,
      { requireRevision: true, allowSessionChange: true, lockEditor: true });
  }
  function attachScope() {
    if (!project || !collection || collection.status !== 'complete' || !currentScope || currentScope.kind !== 'visual' ||
        !samePinnedSource || busy || dirty || action || linkedScope) return;
    void perform('attach_scope', signal => request<Project>(token,
      `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes/${encodeURIComponent(currentScope.id)}/attach`,
      { expectedRevision: project.revision, collectionId: collection.id }, signal), onScopeAttached,
      { requireRevision: true, allowSessionChange: true, lockEditor: true });
  }
  function remove() {
    if (!collection || collection.status === 'running' || linkedScope || busy) return;
    const removedId = collection.id;
    void perform('remove', async signal => {
      const result = await request<{ removed: boolean }>(token, `${path}/remove`, {}, signal);
      if (!result.removed) throw new Error('Collection removal was not confirmed.');
      try {
        const listed = await request<{ collections: CollectionView[] }>(token, base, undefined, signal);
        return listed.collections.map(item => CollectionViewSchema.parse(item));
      } catch { return null; }
    }, items => {
      const remaining = items ?? history.filter(item => item.id !== removedId);
      setHistory(remaining); setCollection(remaining[0] ?? null);
      setNodePage(null); setTextView(null); setNodeOffset(0);
    });
  }
  function loadNodes(offset: number) {
    if (!collection || collection.status !== 'complete' || action) return;
    void perform('nodes', signal => request<unknown>(token, `${path}/nodes`, { offset, limit: 50 }, signal).then(value => NodePageSchema.parse(value)),
      value => { setNodePage(value); setNodeOffset(offset); setTextView(null); });
  }
  function loadText(node: NodeSummary, offset = 0) {
    if (!collection || collection.status !== 'complete' || node.textLength === null || action) return;
    void perform('text', signal => request<unknown>(token, `${path}/text`, { nodeId: node.id, offset, limit: 4000 }, signal)
      .then(value => {
        const page = TextPageSchema.parse(value);
        if (page.nodeId !== node.id || page.offset !== offset) throw new Error('Source text response did not match the requested node and offset.');
        return page;
      }), value => setTextView(previous => offset > 0 && previous?.nodeId === node.id
      ? { nodeId: node.id, name: node.name, text: previous.text + value.text, nextOffset: value.nextOffset, totalLength: value.totalLength }
      : { nodeId: node.id, name: node.name, text: value.text, nextOffset: value.nextOffset, totalLength: value.totalLength }));
  }

  const sameSession = !!collection && !!sessionId && collection.sessionId === sessionId;
  const linkedScope = collection && project?.scopes?.find(scope => scope.collection?.id === collection.id);
  const samePinnedSource = !!collection && !!currentScope && currentScope.kind === 'visual'
    && collection.source.fileKey === currentScope.source.fileKey && collection.source.pageId === currentScope.source.pageId
    && collection.source.nodeId === currentScope.source.rootId && JSON.stringify(collection.source.bounds) === JSON.stringify(currentScope.bounds);
  const canPrepare = !!project && !!sessionId && connected && !busy && !dirty && !action && collection?.status !== 'running';
  const shown = collection && !history.some(item => item.id === collection.id) ? [collection, ...history] : history;
  const textNode = nodePage?.nodes.find(node => node.id === textView?.nodeId);
  const collectionStatus = collection ? collection.pauseRequested && collection.status === 'running'
    ? t('Pause requested') : t(statusLabels[collection.status]) : '';

  return <details className="collection-panel raw-collection-panel">
    <summary>{t('Raw source collection')}{collection && <span> · {collectionStatus} · {formatNumber(collection.nodeCount)} {t('nodes')}</span>}</summary>
    <p className="small muted">{t('Collection alone stores unreviewed source records. Once complete, you may add them as a source scope for manual annotation; collection itself grants no approval.')}</p>
    <button className="wide" disabled={!canPrepare} onClick={prepare}>{t('Prepare selected source collection')}</button>
    {shown.length > 0 && <label>{t('Collection history')}<select value={collection?.id ?? ''} disabled={!!action} onChange={event => {
      setCollection(shown.find(item => item.id === event.target.value) ?? null); setError(null);
    }}>{shown.map(item => <option key={item.id} value={item.id}>{item.source.name} · {t(statusLabels[item.status])} · {formatDate(item.createdAt)}</option>)}</select></label>}
    {dirty && <p className="small collection-warning">{t('Save unsaved editor work before starting or resuming a collection.')}</p>}
    {!connected && <p className="small muted">{t('Connect the Figma development plugin to prepare or resume.')}</p>}
    {error && <p className="small error" role="alert">{renderMessage(error)}</p>}
    {collection && <div className="collection-detail">
      <strong>{collection.source.name} <span>{collection.source.type}</span></strong>
      <p className="small muted">{t('Pinned bounds: x {x}, y {y}, width {width}, height {height}', collection.source.bounds)}</p>
      <p className="small muted">{t('Status: {status} · {nodes} nodes · {chunks} batches · {bytes} bytes · {seconds} s elapsed', {
        status: collectionStatus, nodes: formatNumber(collection.nodeCount), chunks: formatNumber(collection.chunkCount),
        bytes: formatNumber(collection.byteCount), seconds: (collection.elapsedMs / 1000).toFixed(1),
      })}</p>
      {collection.status === 'prepared' && <>
        <p className="small collection-warning">{t('Limit: 200,000 nodes and 64 MB. Each batch reads at most 500 nodes or 1 MB; work pauses cooperatively after about 5 minutes. Actual total size and native memory use are unknown.')}</p>
        <p className="small muted">{t('Collection attempts the full selected scope. A paused or interrupted prefix is not a complete result.')}</p>
        <p className="small collection-warning">{t('A paused cursor can resume for 10 minutes in the same plugin session. If the source changes or the plugin reconnects, start a new collection.')}</p>
        <p className="small collection-warning">{t('A very wide Figma parent may allocate child references before a bounded batch returns; native peak memory is not known.')}</p>
        <p className="small collection-warning">{t('Figma operations are serialized. Each batch observes the live document separately, so one unchanged revision is not guaranteed. A native operation already running may finish before a pause takes effect.')}</p>
        <p className="small muted">{t('The selected source is read without editing its Figma document. This raw collection is not an approved capture; link it as a source scope and review annotations separately.')}</p>
        <button className="wide" disabled={!sameSession || !connected || busy || dirty || !!action} onClick={start}>{t('Start source collection')}</button>
      </>}
      {collection.status === 'running' && <><progress aria-label={t('Collection progress')} />
        {collection.pauseRequested && <p className="small collection-warning">{t('Pause requested. The current batch must finish and be saved before work pauses.')}</p>}
        <button className="wide" disabled={!!action || !!collection.pauseRequested} onClick={stop}>{t('Pause after current batch')}</button></>}
      {collection.status === 'paused' && <><p className="small muted">{t('Collection is paused. Resume within 10 minutes in the same plugin session. If the source changed or the plugin reconnected, start a new collection.')}</p>
        <button className="wide" disabled={!sameSession || !connected || busy || dirty || !!action} onClick={resume}>{t('Resume collection')}</button></>}
      {collection.status === 'complete' && <p className="small muted">{t('Collection complete. Inspect records here or add them as an unreviewed source scope in the editor.')}</p>}
      {collection.status === 'complete' && <div className="collection-link-actions">
        {linkedScope ? <p className="small muted">{t('This collection backs workspace scope {name}.', { name: linkedScope.name })}</p> : <>
          <p className="small muted">{t('Choose how to use this complete collection. It remains a separate observation from any overview image.')}</p>
          <button className="wide" disabled={busy || dirty || !!action} onClick={addScope}>{t('Add collection as source scope')}</button>
          {currentScope?.kind === 'visual' && <><button className="wide" disabled={!samePinnedSource || busy || dirty || !!action} onClick={attachScope}>{t('Attach to current visual draft')}</button>
            {!samePinnedSource && <p className="small collection-warning">{t('The current visual draft has different pinned source identity or bounds. Select its matching collection instead.')}</p>}
            <p className="small collection-warning">{t('Attaching keeps the image and structure as separate observations. Review and confirm source nodes before approving annotations.')}</p></>}
        </>}
      </div>}
      {collection.error && <p className="small collection-warning">{collection.error.message}</p>}
      {collection.warnings.length > 0 && <ul className="collection-warnings">{collection.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>}
      {collection.status === 'complete' && <div className="collection-inspection">
        <button className="wide" disabled={!!action} onClick={() => loadNodes(0)}>{t('Inspect first node page')}</button>
        {nodePage && <>
          <p className="small muted">{t('Unreviewed nodes {from}–{to} of {total}', {
            from: nodePage.nodes.length ? nodeOffset + 1 : 0, to: nodeOffset + nodePage.nodes.length, total: formatNumber(nodePage.total),
          })}</p>
          <ul className="collection-nodes">{nodePage.nodes.map(node => <li key={node.id}>
            <span><strong>{node.name}</strong><small>{node.type} · {node.id}{node.textLength === null ? '' : ` · ${t('text length {count}', { count: formatNumber(node.textLength) })}`}</small></span>
            {node.textLength !== null && <button className="text-button" disabled={!!action} onClick={() => loadText(node)}>{t('Read exact text')}</button>}
          </li>)}</ul>
          <div className="collection-page-actions"><button disabled={nodeOffset === 0 || !!action} onClick={() => loadNodes(Math.max(0, nodeOffset - 50))}>{t('Previous page')}</button>
            <button disabled={nodePage.nextOffset === null || !!action} onClick={() => { if (nodePage.nextOffset !== null) loadNodes(nodePage.nextOffset); }}>{t('Next page')}</button></div>
        </>}
        {textView && <div className="collection-text"><strong>{t('Exact source text')} · {textView.name}</strong>
          <p className="small muted">{t('Loaded {loaded} of {total} characters · unreviewed', { loaded: formatNumber(textView.text.length), total: formatNumber(textView.totalLength) })}</p>
          <pre>{textView.text}</pre>
          {textView.nextOffset !== null && textNode && <button className="wide" disabled={!!action} onClick={() => {
            if (textView.nextOffset !== null) loadText(textNode, textView.nextOffset);
          }}>{t('Load next text segment')}</button>}
        </div>}
      </div>}
      <button className="text-button collection-remove" disabled={collection.status === 'running' || !!linkedScope || !!action || busy} onClick={remove}>{t('Remove collection record')}</button>
      {linkedScope && <p className="small muted">{t('A workspace scope uses this collection, so remove that scope before deleting its records.')}</p>}
      <p className="small muted">{t('Removing this collection deletes only its cached raw observations. Workspace captures and annotations remain unchanged.')}</p>
    </div>}
  </details>;
}
