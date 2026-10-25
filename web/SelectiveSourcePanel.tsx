import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { IdSchema, SourceNodeSchema, type Project } from '../src/shared/contracts.js';
import { CollectionSourceSchema, CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { SelectiveChildrenResultSchema, SelectiveNodesResultSchema } from '../src/shared/selective-source-results.js';
import { ApiError, request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, message, type MessageKey, type UIMessage } from './locale.js';

const InspectionSchema = z.object({ id: IdSchema, projectId: IdSchema, sessionId: IdSchema,
  source: CollectionSourceSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  observationCount: z.number().int().min(0), byteCount: z.number().int().min(0),
  reviewStatus: z.literal('unreviewed'), consistency: z.literal('live-session-observation') }).strict();
type Inspection = z.infer<typeof InspectionSchema>;
const SummarySchema = z.object({ id: IdSchema, kind: z.enum(['nodes', 'children']), observedAt: z.string().datetime(),
  recordCount: z.number().int().min(0), fields: z.enum(['metadata', 'text']), parentId: IdSchema.nullable(),
  childrenComplete: z.boolean().nullable() }).strict();
const SummaryPageSchema = z.object({ view: InspectionSchema, observations: z.array(SummarySchema).max(20),
  nextOffset: z.number().int().min(0).nullable(), total: z.number().int().min(0) }).strict();
const MetadataNodeSchema = SourceNodeSchema.omit({ text: true });
const RecordSchema = z.object({ node: MetadataNodeSchema, textLength: z.number().int().min(0).nullable(),
  fieldCoverage: z.object({ metadata: z.literal('loaded'), text: z.enum(['loaded', 'not-requested', 'not-applicable']) }).strict() }).strict();
const RecordsPageSchema = z.object({ observationId: IdSchema, kind: z.enum(['nodes', 'children']), scopeId: IdSchema,
  records: z.array(RecordSchema).max(20), offset: z.number().int().min(0), nextOffset: z.number().int().min(0).nullable(),
  total: z.number().int().min(0), reviewStatus: z.literal('unreviewed'), consistency: z.literal('live-session-observation') }).strict();
const TextPageSchema = z.object({ observationId: IdSchema, nodeId: IdSchema, text: z.string(), offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable(), totalLength: z.number().int().min(0),
  reviewStatus: z.literal('unreviewed'), consistency: z.literal('live-session-observation') }).strict();
const NodeOutcomeSchema = z.object({ view: InspectionSchema, observation: z.object({ id: IdSchema, kind: z.literal('nodes'),
  result: SelectiveNodesResultSchema, sha256: z.string() }).strict(), reused: z.boolean() }).strict();
const ChildOutcomeSchema = z.object({ view: InspectionSchema, observation: z.object({ id: IdSchema, kind: z.literal('children'),
  result: SelectiveChildrenResultSchema, sha256: z.string() }).strict(), reused: z.boolean() }).strict();
type RecordPage = z.infer<typeof RecordsPageSchema>;
type TextView = { observationId: string; nodeId: string; text: string; nextOffset: number | null; totalLength: number };
type ChildView = { parentId: string; observationId: string; offset: number; nodes: z.infer<typeof MetadataNodeSchema>[];
  nextOffset: number | null; totalChildren: number };
const containers = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const statusLabels: Record<CollectionView['status'], MessageKey> = {
  prepared: 'Prepared', running: 'Working', paused: 'Paused', complete: 'Collection complete',
  failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted',
};

export function SelectiveSourcePanel({ token, project, sessionId, connected, busy, dirty }: {
  token: string; project: Project | null; sessionId: string | null; connected: boolean; busy: boolean; dirty: boolean;
}) {
  const { t, renderMessage, formatNumber, formatDate } = useLocale();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [summaries, setSummaries] = useState<z.infer<typeof SummarySchema>[]>([]);
  const [summaryOffset, setSummaryOffset] = useState(0);
  const [summaryNext, setSummaryNext] = useState<number | null>(null);
  const [records, setRecords] = useState<RecordPage | null>(null);
  const [textView, setTextView] = useState<TextView | null>(null);
  const [nodeIds, setNodeIds] = useState('');
  const [fields, setFields] = useState<'metadata' | 'text'>('metadata');
  const [parentId, setParentId] = useState('');
  const [child, setChild] = useState<ChildView | null>(null);
  const [branchNodeId, setBranchNodeId] = useState('');
  const [branches, setBranches] = useState<CollectionView[]>([]);
  const [branch, setBranch] = useState<CollectionView | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<UIMessage | null>(null);
  const generation = useRef(0), acting = useRef(false), pending = useRef(new Set<AbortController>());
  const selectedInspectionId = useRef<string | null>(null);
  selectedInspectionId.current = inspection?.id ?? null;
  const context = useRef({ token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null });
  context.current = { token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null };
  const projectId = project?.id ?? null;
  const base = projectId ? `/api/projects/${encodeURIComponent(projectId)}/selective` : '';
  const path = inspection ? `${base}/${encodeURIComponent(inspection.id)}` : '';
  const sameSession = !!inspection && connected && sessionId === inspection.sessionId;

  useEffect(() => {
    const current = ++generation.current;
    for (const controller of pending.current) controller.abort(); pending.current.clear(); acting.current = false;
    setInspections([]); setInspection(null); setSummaries([]); setRecords(null); setTextView(null);
    setChild(null); setBranch(null); setBranches([]); setError(null); setAction(null);
    if (token && projectId) {
      const controller = new AbortController(); pending.current.add(controller);
      void request<{ inspections: unknown[] }>(token, base, undefined, controller.signal).then(value => {
        if (generation.current !== current) return;
        const items = value.inspections.map(item => InspectionSchema.parse(item));
        setInspections(items); setInspection(items[0] ?? null);
      }).catch(cause => { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); })
        .finally(() => pending.current.delete(controller));
    }
    return () => { generation.current++; for (const controller of pending.current) controller.abort(); pending.current.clear(); };
  }, [token, projectId, sessionId]);

  useEffect(() => {
    setSummaries([]); setSummaryOffset(0); setSummaryNext(null); setRecords(null); setTextView(null);
    setChild(null); setParentId(inspection?.source.nodeId ?? ''); setBranchNodeId(''); setBranches([]); setBranch(null);
    if (!inspection || !token || !projectId) return;
    const current = generation.current, id = inspection.id, controller = new AbortController();
    pending.current.add(controller);
    void Promise.all([
      request<unknown>(token, `${base}/${encodeURIComponent(id)}/observations?offset=0&limit=20`, undefined, controller.signal)
        .then(value => SummaryPageSchema.parse(value)),
      request<{ collections: unknown[] }>(token, `/api/projects/${encodeURIComponent(projectId)}/collections`, undefined, controller.signal),
    ]).then(([history, collectionList]) => {
      if (generation.current !== current || controller.signal.aborted) return;
      setSummaries(history.observations); setSummaryNext(history.nextOffset);
      const items = collectionList.collections.map(value => CollectionViewSchema.parse(value))
        .filter(value => value.source.inspectionId === id);
      setBranches(items); setBranch(items[0] ?? null);
    }).catch(cause => { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => pending.current.delete(controller));
    return () => controller.abort();
  }, [inspection?.id, token, projectId]);

  useEffect(() => {
    if (!branch || branch.status !== 'running' || !projectId) return;
    const id = branch.id, current = generation.current;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController(); pending.current.add(controller);
      try {
        const next = CollectionViewSchema.parse(await request<unknown>(token,
          `/api/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(id)}`, undefined, controller.signal));
        if (active && generation.current === current) {
          setBranch(previous => previous?.id === id ? next : previous);
          setBranches(previous => previous.map(item => item.id === id ? next : item));
        }
      } catch (cause) { if (active && generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); }
      finally { controller && pending.current.delete(controller); if (active && generation.current === current) timer = setTimeout(() => void poll(), 1000); }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { active = false; if (timer) clearTimeout(timer); controller?.abort(); };
  }, [branch?.id, branch?.status, token, projectId, sessionId]);

  async function perform<T>(kind: string, call: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
    requireRevision = false) {
    if (acting.current) return;
    acting.current = true; setAction(kind); setError(null);
    const current = generation.current, expected = { ...context.current };
    const controller = new AbortController(); pending.current.add(controller);
    try {
      const result = await call(controller.signal);
      if (generation.current === current && context.current.token === expected.token &&
        context.current.projectId === expected.projectId && context.current.sessionId === expected.sessionId &&
        (!requireRevision || context.current.revision === expected.revision)) apply(result);
    } catch (cause) { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); }
    finally { pending.current.delete(controller); if (generation.current === current) { acting.current = false; setAction(null); } }
  }
  function reloadSummaries() {
    if (!inspection) return;
    const current = generation.current, id = inspection.id, controller = new AbortController();
    pending.current.add(controller);
    void request<unknown>(token, `${path}/observations?offset=0&limit=20`, undefined, controller.signal).then(value => {
      const page = SummaryPageSchema.parse(value);
      if (generation.current === current && context.current.projectId === projectId &&
        selectedInspectionId.current === id && id === page.view.id) {
        setSummaries(page.observations); setSummaryOffset(0); setSummaryNext(page.nextOffset);
      }
    }).catch(() => {}).finally(() => pending.current.delete(controller));
  }
  function prepare() {
    if (!project || !sessionId || !connected || busy || dirty) return;
    void perform('prepare', signal => request<unknown>(token, base,
      { expectedRevision: project.revision, expectedSessionId: sessionId }, signal).then(value => InspectionSchema.parse(value)),
    value => { setInspections(previous => [value, ...previous]); setInspection(value); }, true);
  }
  function inspectNodes() {
    if (!inspection || !sameSession || busy) return;
    const ids = [...new Set(nodeIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
    if (ids.length < 1 || ids.length > 100) { setError(message('Provide 1–100 explicit node IDs.')); return; }
    void perform('nodes', signal => request<unknown>(token, `${path}/nodes`, { nodeIds: ids, fields }, signal)
      .then(value => NodeOutcomeSchema.parse(value)), outcome => {
        setInspection(outcome.view); setInspections(previous => previous.map(item => item.id === outcome.view.id ? outcome.view : item));
        const result = outcome.observation.result;
        setRecords({ observationId: outcome.observation.id, kind: 'nodes', scopeId: result.scopeId,
          records: result.records.slice(0, 20).map(record => {
            const { text, ...node } = record.node;
            return { node, textLength: text?.length ?? null, fieldCoverage: record.fieldCoverage };
          }),
          offset: 0, nextOffset: result.records.length > 20 ? 20 : null, total: result.records.length,
          reviewStatus: 'unreviewed', consistency: result.consistency });
        setTextView(null); reloadSummaries();
      });
  }
  function readChildren() {
    if (!inspection || !sameSession || busy || !parentId.trim()) return;
    const current = child?.parentId === parentId ? child : null;
    const observationId = current?.observationId ?? crypto.randomUUID();
    const offset = current?.nextOffset ?? 0;
    // Preserve the native cursor identity even if a reply is lost, so the same packet can be retried.
    if (!current) setChild({ parentId, observationId, offset: 0, nodes: [], nextOffset: 0, totalChildren: 0 });
    void perform('children', signal => request<unknown>(token, `${path}/children`,
      { parentId, observationId, offset, limit: 100 }, signal).then(value => ChildOutcomeSchema.parse(value)).catch(cause => {
        // The broker maps definitive plugin rejections to PLUGIN_ERROR and the
        // server releases that cursor. Keep the ID for timeout/busy ambiguity.
        if (offset === 0 && cause instanceof ApiError && cause.code === 'PLUGIN_ERROR')
          setChild(value => value?.observationId === observationId ? null : value);
        throw cause;
      }), outcome => {
        setInspection(outcome.view); setInspections(previous => previous.map(item => item.id === outcome.view.id ? outcome.view : item));
        const result = outcome.observation.result;
        setChild({ parentId, observationId, offset: result.offset, nodes: result.nodes,
          nextOffset: result.nextOffset, totalChildren: result.totalChildren });
        reloadSummaries();
      });
  }
  function loadSummaries(offset: number) {
    if (!inspection) return;
    void perform('history', signal => request<unknown>(token, `${path}/observations?offset=${offset}&limit=20`, undefined, signal)
      .then(value => SummaryPageSchema.parse(value)), value => {
        setSummaries(value.observations); setSummaryOffset(offset); setSummaryNext(value.nextOffset);
      });
  }
  function loadRecords(observationId: string, offset = 0) {
    if (!inspection) return;
    void perform('records', signal => request<unknown>(token, `${path}/records`, { observationId, offset, limit: 20 }, signal)
      .then(value => RecordsPageSchema.parse(value)), value => { setRecords(value); setTextView(null); });
  }
  function loadText(nodeId: string, observationId: string, offset = 0) {
    if (!inspection) return;
    void perform('text', signal => request<unknown>(token, `${path}/text`, { observationId, nodeId, offset, limit: 4000 }, signal)
      .then(value => TextPageSchema.parse(value)), value => setTextView(previous => offset > 0 && previous?.nodeId === nodeId &&
        previous.observationId === observationId ? { observationId, nodeId, text: previous.text + value.text,
          nextOffset: value.nextOffset, totalLength: value.totalLength }
        : { observationId, nodeId, text: value.text, nextOffset: value.nextOffset, totalLength: value.totalLength }));
  }
  function prepareBranch() {
    if (!project || !inspection || !sameSession || !branchNodeId || busy || dirty) return;
    void perform('branch', signal => request<unknown>(token,
      `/api/projects/${encodeURIComponent(project.id)}/collections/branch`,
      { expectedRevision: project.revision, expectedSessionId: sessionId, inspectionId: inspection.id, nodeId: branchNodeId }, signal)
      .then(value => CollectionViewSchema.parse(value)), value => {
        setBranches(previous => [value, ...previous]); setBranch(value);
      }, true);
  }
  function branchAction(kind: 'start' | 'stop' | 'resume') {
    if (!branch || !projectId) return;
    void perform(kind, signal => request<unknown>(token,
      `/api/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(branch.id)}/${kind}`, {}, signal)
      .then(value => CollectionViewSchema.parse(value)), value => {
        setBranch(value); setBranches(previous => previous.map(item => item.id === value.id ? value : item));
      });
  }
  function removeInspection() {
    if (!inspection || busy) return;
    const removedId = inspection.id;
    void perform('remove', signal => request<{ removed: boolean }>(token, `${path}/remove`, {}, signal), value => {
      if (!value.removed) return;
      const next = inspections.filter(item => item.id !== removedId);
      setInspections(next); setInspection(next[0] ?? null);
    });
  }
  const canLive = sameSession && !busy && !action;
  const shown = inspection && !inspections.some(item => item.id === inspection.id) ? [inspection, ...inspections] : inspections;
  const childComplete = child && child.nextOffset === null;
  return <details className="collection-panel selective-source-panel">
    <summary>{t('Selective source inspection')}{inspection && <span> · {inspection.source.name} · {formatNumber(inspection.observationCount)} {t('Observed source records')}</span>}</summary>
    <p className="small muted">{t('Read explicit IDs or immediate children without loading a whole page. Results are unreviewed live observations.')}</p>
    <button className="wide" disabled={!project || !sessionId || !connected || busy || dirty || !!action} onClick={prepare}>{t('Prepare selected inspection')}</button>
    {shown.length > 0 && <label>{t('Inspection history')}<select value={inspection?.id ?? ''} disabled={!!action}
      onChange={event => setInspection(shown.find(item => item.id === event.target.value) ?? null)}>
      {shown.map(item => <option key={item.id} value={item.id}>{item.source.name} · {formatDate(item.createdAt)}</option>)}</select></label>}
    {!inspection && <p className="small muted">{t('Select an inspection first.')}</p>}
    {error && <p className="small error" role="alert">{renderMessage(error)}</p>}
    {inspection && <div className="collection-detail">
      <p className="small muted">{t('Pinned inspection scope: {name} ({type}) · {id}', { name: inspection.source.name,
        type: inspection.source.type, id: inspection.source.nodeId })}</p>
      <p className="small muted">{t('No subtree coverage is implied by these records.')}</p>
      <p className="small muted">{t('Explicit-ID reads: at most 100 IDs and 1 MB per observation. Original text is never shortened.')}</p>
      <label>{t('Node IDs (comma or space separated)')}<textarea value={nodeIds} maxLength={16100}
        onChange={event => setNodeIds(event.target.value)} /></label>
      <label>{t('Fields')}<select value={fields} onChange={event => setFields(event.target.value as 'metadata' | 'text')}>
        <option value="metadata">{t('Metadata only')}</option><option value="text">{t('Metadata and original text')}</option></select></label>
      <button className="wide" disabled={!canLive || !nodeIds.trim()} onClick={inspectNodes}>{t('Read explicit nodes')}</button>
      <p className="small muted">{t('Immediate children: at most 100 records and 96 KB per page. Figma still allocates the native child list.')}</p>
      <label>{t('Immediate parent ID')}<input value={parentId} maxLength={160} disabled={!!child && child.nextOffset !== null}
        onChange={event => { setParentId(event.target.value); setChild(null); }} /></label>
      <button className="wide" disabled={!canLive || !parentId.trim() || !!childComplete} onClick={readChildren}>
        {child?.nodes.length ? t('Continue child page') : child ? t('Retry child page') : t('Read immediate children')}</button>
      {child && child.nodes.length > 0 && <>
        <p className="small muted">{t('Immediate children {from}–{to} of {total}; descendants are not included.', {
          from: child.offset + 1, to: child.offset + child.nodes.length, total: formatNumber(child.totalChildren) })}</p>
        <ul className="collection-nodes">{child.nodes.map(node => <li key={node.id}><span><strong>{node.name}</strong>
          <small>{node.type} · {node.id}</small></span>{containers.has(node.type) &&
          <button className="text-button" disabled={!!action} onClick={() => setBranchNodeId(node.id)}>{t('Use as branch root')}</button>}</li>)}</ul>
      </>}
      {summaries.length > 0 && <div className="collection-inspection"><strong>{t('Observation history')}</strong>
        <ul className="collection-nodes">{summaries.map(item => <li key={item.id}><span><strong>{item.kind}</strong>
          <small>{formatDate(item.observedAt)} · {formatNumber(item.recordCount)} {t('nodes')}</small></span>
          <button className="text-button" disabled={!!action} onClick={() => loadRecords(item.id)}>{t('Inspect first node page')}</button></li>)}</ul>
        <div className="collection-page-actions"><button disabled={summaryOffset===0||!!action}
          onClick={() => loadSummaries(Math.max(0,summaryOffset-20))}>{t('Previous page')}</button>
          <button disabled={summaryNext===null||!!action} onClick={() => summaryNext!==null&&loadSummaries(summaryNext)}>{t('Next page')}</button></div>
      </div>}
      {records && <div className="collection-inspection"><p className="small muted">{t('Unreviewed nodes {from}–{to} of {total}', {
        from: records.records.length ? records.offset+1 : 0, to: records.offset+records.records.length,
        total: formatNumber(records.total) })}</p>
        <ul className="collection-nodes">{records.records.map(record => <li key={record.node.id}><span><strong>{record.node.name}</strong>
          <small>{record.node.type} · {record.node.id}{record.textLength===null?'':` · ${t('text length {count}',{count:formatNumber(record.textLength)})}`}</small></span>
          {record.textLength!==null && <button className="text-button" disabled={!!action}
            onClick={() => loadText(record.node.id,records.observationId)}>{t('Read exact text')}</button>}
          {containers.has(record.node.type) && <button className="text-button" disabled={!!action}
            onClick={() => setBranchNodeId(record.node.id)}>{t('Use as branch root')}</button>}</li>)}</ul>
        <div className="collection-page-actions"><button disabled={records.offset===0||!!action}
          onClick={() => loadRecords(records.observationId,Math.max(0,records.offset-20))}>{t('Previous page')}</button>
          <button disabled={records.nextOffset===null||!!action}
          onClick={() => records.nextOffset!==null&&loadRecords(records.observationId,records.nextOffset)}>{t('Next page')}</button></div>
      </div>}
      {textView && <div className="collection-text"><strong>{t('Exact source text')}</strong>
        <pre>{textView.text}</pre><p className="small muted">{t('Loaded {loaded} of {total} characters · unreviewed', {
          loaded: formatNumber(textView.text.length), total: formatNumber(textView.totalLength) })}</p>
        {textView.nextOffset!==null && <button className="wide" disabled={!!action}
          onClick={() => loadText(textView.nodeId,textView.observationId,textView.nextOffset!)}>{t('Load next text segment')}</button>}</div>}
      <label>{t('Choose a descendant container to prepare a branch.')}<input value={branchNodeId} maxLength={160}
        onChange={event => setBranchNodeId(event.target.value)} /></label>
      <p className="small muted">{t('Branch collection covers only this node and its descendants.')}</p>
      <p className="small collection-warning">{t('Limit: 200,000 nodes and 64 MB. Each batch reads at most 500 nodes or 1 MB; work pauses cooperatively after about 5 minutes. Actual total size and native memory use are unknown.')}</p>
      <p className="small collection-warning">{t('A very wide Figma parent may allocate child references before a bounded batch returns; native peak memory is not known.')}</p>
      <button className="wide" disabled={!canLive || dirty || !branchNodeId.trim() || branchNodeId===inspection.source.nodeId}
        onClick={prepareBranch}>{t('Prepare branch collection')}</button>
      {branches.length > 0 && <label>{t('Branch collections')}<select value={branch?.id ?? ''} disabled={!!action}
        onChange={event => setBranch(branches.find(item => item.id === event.target.value) ?? null)}>
        {branches.map(item => <option key={item.id} value={item.id}>{item.source.name} · {t(statusLabels[item.status])} · {formatDate(item.createdAt)}</option>)}</select></label>}
      {branch && <div className="collection-detail"><strong>{branch.source.name} · {t(statusLabels[branch.status])}</strong>
        <p className="small muted">{formatNumber(branch.nodeCount)} {t('nodes')}</p>
        {branch.status==='prepared' && <button className="wide" disabled={!canLive||dirty}
          onClick={() => branchAction('start')}>{t('Start source collection')}</button>}
        {branch.status==='running' && <><progress aria-label={t('Collection progress')} />
          <button className="wide" disabled={!!action||branch.pauseRequested}
            onClick={() => branchAction('stop')}>{t('Pause after current batch')}</button></>}
        {branch.status==='paused' && <button className="wide" disabled={!canLive||dirty}
          onClick={() => branchAction('resume')}>{t('Resume collection')}</button>}
        {branch.error && <p className="small error" role="alert">{branch.error.message}</p>}
      </div>}
      <button className="wide" disabled={!!action||busy} onClick={removeInspection}>{t('Remove inspection')}</button>
    </div>}
  </details>;
}
