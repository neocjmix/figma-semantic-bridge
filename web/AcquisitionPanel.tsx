import { useEffect, useId, useRef, useState } from 'react';
import { AcquisitionViewSchema, type AcquisitionPlan, type AcquisitionView } from '../src/shared/acquisition.js';
import { NodePreviewResultSchema, type Project, type NodePreviewResult } from '../src/shared/contracts.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, message, type MessageKey, type UIMessage } from './locale.js';

type Action = 'prepare' | 'start' | 'load_structure' | 'cancel' | 'retry' | 'commit' | 'visual' | 'remove';
type Step = 'preview' | 'structure';

const plans: { value: AcquisitionPlan; label: MessageKey; description: MessageKey }[] = [
  { value: 'overview_then_structure', label: 'Overview, then structure', description: 'See the image first, then read bounded source records.' },
  { value: 'structure_then_overview', label: 'Structure, then overview', description: 'Read bounded source records first, then render the image.' },
  { value: 'overview', label: 'Overview only', description: 'View an image without a saved, source-grounded capture.' },
  { value: 'structure', label: 'Structure only', description: 'Read source records without requesting an overview image.' },
];
const statusLabels: Record<AcquisitionView['status'], MessageKey> = {
  prepared: 'Prepared', running: 'Working', ready: 'Ready to save', partial: 'Incomplete', failed: 'Failed',
  cancel_requested: 'Stop requested', cancelled: 'Stopped', committed: 'Saved', interrupted: 'Interrupted',
};
const statusLabel = (view: AcquisitionView): MessageKey => view.status === 'ready' && view.plan === 'overview'
  ? 'Overview ready' : statusLabels[view.status];
const stageLabels: Record<AcquisitionView['stage'], MessageKey> = {
  prepared: 'Preparing', preview: 'Rendering overview', structure: 'Reading structure', saving: 'Saving observations', done: 'Finished',
};
const stepLabels: Record<AcquisitionView['preview']['status'], MessageKey> = {
  idle: 'Not requested', running: 'Working', ready: 'Ready', partial: 'Incomplete', failed: 'Failed',
};
const needsPreview = (plan: AcquisitionPlan | null) => plan === 'overview' || plan === 'overview_then_structure' || plan === 'structure_then_overview';
const needsStructure = (plan: AcquisitionPlan | null) => plan === 'structure' || plan === 'overview_then_structure' || plan === 'structure_then_overview';

function OverviewPreview({ result, sourceName }: { result: NodePreviewResult; sourceName: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), enlargeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (expanded && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [expanded]);
  const src = `data:image/png;base64,${result.preview.base64}`;
  return <>
    <figure className="acquisition-preview"><img src={src} alt={t('Figma overview image')} />
      <figcaption>{t('Overview image is available. Source grounding remains separate until the required structure is complete.')}
        <button ref={enlargeButton} className="text-button" onClick={() => setExpanded(true)}>{t('Enlarge overview')}</button>
      </figcaption></figure>
    <dialog ref={dialog} className="node-comparison-dialog acquisition-overview-dialog" aria-labelledby={titleId}
      onClose={() => { setExpanded(false); enlargeButton.current?.focus(); }}>
      {expanded && <>
        <div className="node-comparison-dialog-header"><div><h2 id={titleId}>{t('Enlarged overview')}</h2><p className="small muted">{sourceName}</p></div>
          <button autoFocus onClick={() => dialog.current?.close()}>{t('Close overview')}</button></div>
        <img src={src} alt={t('Figma overview image')} />
      </>}
    </dialog>
  </>;
}

export function AcquisitionPanel({ token, project, sessionId, connected, busy, dirty, beginProjectMutation, onCommitted, onVisualCreated }: {
  token: string; project: Project | null; sessionId: string | null; connected: boolean; busy: boolean; dirty: boolean;
  beginProjectMutation(): (() => void) | null;
  onCommitted(next: Project): void; onVisualCreated(next: Project): void;
}) {
  const { t, renderMessage, formatNumber, formatDate } = useLocale();
  const [task, setTask] = useState<AcquisitionView | null>(null);
  const [recent, setRecent] = useState<AcquisitionView[]>([]);
  const [preview, setPreview] = useState<{ taskId: string; observedAt: string; result: NodePreviewResult } | null>(null);
  const [plan, setPlan] = useState<AcquisitionPlan>('overview_then_structure');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<UIMessage | null>(null);
  const generation = useRef(0);
  const pending = useRef(new Set<AbortController>());
  const acting = useRef(false);
  const context = useRef({ token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null });
  context.current = { token, projectId: project?.id ?? null, sessionId, revision: project?.revision ?? null };
  const projectId = project?.id ?? null;
  const base = projectId ? `/api/projects/${encodeURIComponent(projectId)}/acquisitions` : '';
  const taskPath = task ? `${base}/${encodeURIComponent(task.id)}` : '';
  const contextCurrent = (expected: typeof context.current) => context.current.token === expected.token
    && context.current.projectId === expected.projectId && context.current.sessionId === expected.sessionId;
  useEffect(() => {
    if (task) setRecent(current => current.some(value => value.id === task.id)
      ? current.map(value => value.id === task.id ? task : value) : [task, ...current]);
  }, [task]);

  useEffect(() => {
    const current = ++generation.current;
    for (const controller of pending.current) controller.abort();
    pending.current.clear(); acting.current = false;
    setTask(null); setRecent([]); setPreview(null); setError(null); setAction(null);
    if (token && projectId) {
      const controller = new AbortController(); pending.current.add(controller);
      void request<{ tasks: AcquisitionView[] }>(token, `/api/projects/${encodeURIComponent(projectId)}/acquisitions`, undefined, controller.signal)
        .then(response => {
          if (generation.current !== current) return;
          const tasks = response.tasks.map(value => AcquisitionViewSchema.parse(value));
          setRecent(tasks);
          setTask(previous => tasks.find(value => value.id === previous?.id) ?? previous ?? tasks.find(value => value.status !== 'committed') ?? tasks[0] ?? null);
        })
        .catch(cause => { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); })
        .finally(() => pending.current.delete(controller));
    }
    return () => {
      generation.current++;
      for (const controller of pending.current) controller.abort();
      pending.current.clear();
    };
  }, [token, projectId, sessionId]);

  useEffect(() => {
    if (!task || (task.status !== 'running' && task.status !== 'cancel_requested') || !projectId) return;
    const id = task.id, current = generation.current;
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController(); pending.current.add(controller);
      try {
        const next = AcquisitionViewSchema.parse(await request<unknown>(token,
          `/api/projects/${encodeURIComponent(projectId)}/acquisitions/${encodeURIComponent(id)}`, undefined, controller.signal));
        if (active && generation.current === current && next.id === id) setTask(previous => {
          if (previous?.id !== id) return previous;
          if (Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) return previous;
          if ((previous.status === 'cancel_requested' || previous.status === 'cancelled') &&
              next.status !== 'cancel_requested' && next.status !== 'cancelled') return previous;
          return next;
        });
      } catch (cause) {
        if (active && generation.current === current && !controller.signal.aborted) setError(errorMessage(cause));
      } finally {
        pending.current.delete(controller);
        if (active && generation.current === current) timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { active = false; if (timer) clearTimeout(timer); controller?.abort(); };
  }, [task?.id, task?.status, token, projectId, sessionId]);

  useEffect(() => {
    if (!task || !projectId || task.preview.status !== 'ready' || !task.preview.observedAt ||
        (preview?.taskId === task.id && preview.observedAt === task.preview.observedAt)) return;
    const id = task.id, observedAt = task.preview.observedAt, source = task.source, current = generation.current;
    const controller = new AbortController(); pending.current.add(controller);
    void request<unknown>(token, `/api/projects/${encodeURIComponent(projectId)}/acquisitions/${encodeURIComponent(id)}/preview`, undefined, controller.signal)
      .then(value => {
        const result = NodePreviewResultSchema.parse(value);
        if (result.fileKey !== source.fileKey || result.pageId !== source.pageId || result.node.id !== source.nodeId || result.observedAt !== observedAt)
          throw new Error(t('The overview does not match the prepared Figma source. Check the connection and try again.'));
        if (generation.current === current) setPreview({ taskId: id, observedAt, result });
      })
      .catch(cause => { if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => pending.current.delete(controller));
    return () => controller.abort();
  }, [task?.id, task?.preview.status, task?.preview.observedAt, token, projectId, sessionId, preview?.taskId, preview?.observedAt]);

  async function perform<T>(kind: Action, call: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
    options: { allowSessionChange?: boolean; requireRevision?: boolean; lockEditor?: boolean } = {}) {
    if (acting.current) return;
    const releaseEditor = options.lockEditor ? beginProjectMutation() : null;
    if (options.lockEditor && !releaseEditor) return;
    acting.current = true; setAction(kind); setError(null);
    const current = generation.current, expected = { ...context.current };
    const controller = new AbortController(); pending.current.add(controller);
    try {
      const result = await call(controller.signal);
      if ((generation.current === current || options.allowSessionChange) && context.current.token === expected.token && context.current.projectId === expected.projectId
          && (options.allowSessionChange || contextCurrent(expected))
          && (!options.requireRevision || context.current.revision === expected.revision)) apply(result);
    } catch (cause) {
      if (generation.current === current && !controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      pending.current.delete(controller);
      if (generation.current === current) { acting.current = false; setAction(null); }
      releaseEditor?.();
    }
  }
  const performView = (kind: Action, path: string, body: unknown, onReady?: () => void) => perform(kind,
    signal => request<unknown>(token, path, body, signal).then(value => AcquisitionViewSchema.parse(value)),
    value => { setTask(value); setRecent(current => [value, ...current.filter(item => item.id !== value.id)]); onReady?.(); });

  function prepare() {
    if (!project || !sessionId || !connected || busy || dirty) return;
    void performView('prepare', base, { expectedRevision: project.revision, expectedSessionId: sessionId }, () => setPreview(null));
  }
  function start() {
    if (!task || !connected || task.sessionId !== sessionId || task.baseRevision !== project?.revision || busy || dirty) return;
    void performView('start', `${taskPath}/start`, { plan, limits: {} });
  }
  function loadStructure() {
    if (!task || task.plan !== 'overview' || task.status !== 'ready' || !connected || !sameSession || !sameRevision || busy || dirty) return;
    void performView('load_structure', `${taskPath}/load-structure`, { limits: {} });
  }
  function cancel() {
    if (!task || task.status !== 'running') return;
    void performView('cancel', `${taskPath}/cancel`, {});
  }
  function retry(step: Step) {
    if (!task || !['failed', 'partial', 'interrupted'].includes(task.status) || !connected || task.sessionId !== sessionId || busy || dirty) return;
    void performView('retry', `${taskPath}/retry`, { step });
  }
  function commit() {
    if (!task || !project || !canCommit) return;
    const snapshotId = task.resultSnapshotId;
    void perform('commit', signal => request<Project>(token, `${taskPath}/commit`, { expectedRevision: project.revision }, signal), next => {
      setTask(current => current?.id === task.id ? { ...current, status: 'committed', stage: 'done', resultSnapshotId: snapshotId ?? next.snapshots.at(-1)?.id ?? null } : current);
      setRecent(current => current.map(value => value.id === task.id ? { ...value, status: 'committed', stage: 'done', resultSnapshotId: snapshotId ?? next.snapshots.at(-1)?.id ?? null } : value));
      onCommitted(next);
    }, { allowSessionChange: true, requireRevision: true, lockEditor: true });
  }
  function createVisualDraft() {
    if (!task || !project || task.plan !== 'overview' || task.status !== 'ready' || task.preview.status !== 'ready' ||
        !previewResult || busy || dirty || !!action || project.scopes?.some(scope => scope.visualObservation?.taskId === task.id)) return;
    void perform('visual', signal => request<Project>(token, `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes`,
      { expectedRevision: project.revision, acquisitionId: task.id }, signal), onVisualCreated,
      { allowSessionChange: true, requireRevision: true, lockEditor: true });
  }
  function remove() {
    if (!task || !projectId || task.status === 'running' || task.status === 'cancel_requested' || busy) return;
    const removedId = task.id;
    void perform('remove', async signal => {
      const result = await request<{ removed: boolean }>(token, `${taskPath}/remove`, {}, signal);
      if (!result.removed) throw new Error('Acquisition removal was not confirmed.');
      try {
        const listed = await request<{ tasks: AcquisitionView[] }>(token, base, undefined, signal);
        return listed.tasks.map(value => AcquisitionViewSchema.parse(value));
      } catch { return null; }
    }, tasks => {
      const remaining = tasks ?? recent.filter(value => value.id !== removedId);
      setRecent(remaining); setPreview(null);
      setTask(remaining.find(value => value.status !== 'committed') ?? remaining[0] ?? null);
    });
  }

  const sameSession = !!task && !!sessionId && task.sessionId === sessionId;
  const sameRevision = !!task && task.baseRevision === project?.revision;
  const requiredReady = !!task && (!needsPreview(task.plan) || task.preview.status === 'ready')
    && (!needsStructure(task.plan) || (task.structure.status === 'ready' && task.structure.complete));
  const canCommit = !!task && task.status === 'ready' && needsStructure(task.plan) && requiredReady
    && !busy && !dirty && !action;
  const previewResult = task && preview && preview.taskId === task.id && preview.observedAt === task.preview.observedAt ? preview.result : null;
  const canPrepare = !!project && !!sessionId && connected && !busy && !dirty && !action && task?.status !== 'running' && task?.status !== 'cancel_requested';
  const canRetry = !!task && ['failed', 'partial', 'interrupted'].includes(task.status) && connected && sameSession && !busy && !dirty && !action;
  const visualLinked = !!task && !!project?.scopes?.some(scope => scope.visualObservation?.taskId === task.id);
  const displayedTasks = task && !recent.some(value => value.id === task.id) ? [task, ...recent] : recent;
  const scope = task?.source;
  const largeOverview = !!scope && Math.max(scope.bounds.width, scope.bounds.height) > 2048;

  return <section className="acquisition-panel" aria-label={t('Figma acquisition')}>
    <button className="primary wide" disabled={!canPrepare} onClick={prepare}>{t('Capture Figma selection')}</button>
    {displayedTasks.length > 0 && <label>{t('Recent acquisition jobs')}<select value={task?.id ?? ''} disabled={!!action} onChange={event => {
      setTask(displayedTasks.find(value => value.id === event.target.value) ?? null); setPreview(null); setError(null);
    }}>{displayedTasks.map(value => <option key={value.id} value={value.id}>{value.source.name} · {t(statusLabel(value))} · {formatDate(value.createdAt)}</option>)}</select></label>}
    {!connected && <p className="small muted">{t('Launch the development plugin and pair it with this server.')}</p>}
    {dirty && <p className="small acquisition-warning">{t('Save your unsaved work before starting or saving a capture.')}</p>}
    {error && <p className="error small" role="alert">{renderMessage(error)}</p>}
    {task && <div className="acquisition-detail">
      <div className="acquisition-heading"><strong>{t('Selected Figma scope')}</strong><span className={`acquisition-status ${task.status}`}>{t(statusLabel(task))}</span></div>
      <p className="small acquisition-source">{scope?.name} <span>{scope?.type}</span></p>
      <p className="small muted">{t('Document bounds: x {x}, y {y}, width {width}, height {height}', {
        x: scope?.bounds.x ?? 0, y: scope?.bounds.y ?? 0, width: scope?.bounds.width ?? 0, height: scope?.bounds.height ?? 0,
      })}</p>
      <p className="small muted">{t('Total nodes, completion time and memory use are unknown until observed. The selection is pinned to this Figma connection.')}</p>
      {(!sameSession || !sameRevision) && task.status !== 'committed' && !(task.status === 'ready' && task.structure.complete && requiredReady)
        && <p className="small acquisition-warning">{t('The Figma connection or workspace changed. Check the selection again before continuing.')}</p>}
      {task.status === 'prepared' && <div className="acquisition-plan">
        <label>{t('Acquisition plan')}<select value={plan} onChange={event => setPlan(event.target.value as AcquisitionPlan)} disabled={!!action || busy || dirty || !sameSession || !sameRevision}>
          {plans.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
        </select></label>
        <p className="small muted">{t(plans.find(option => option.value === plan)?.description ?? plans[0]!.description)}</p>
        <p className="small acquisition-budget">{t('Bounded structure read: up to 5,000 nodes, 2 MB of metadata and a 5 s traversal budget. Native image export may take longer.')}</p>
        {needsPreview(plan) && <p className="small acquisition-warning">{t('Overview limit: 2,048 px on the longest side and 8 MB. A native Figma export already running cannot stop immediately.')}</p>}
        {needsPreview(plan) && largeOverview && <p className="small acquisition-warning">{t('This selection is {width} × {height} document units. The overview will be scaled down, so small text may be hard to read.', {
          width: scope?.bounds.width ?? 0, height: scope?.bounds.height ?? 0,
        })}</p>}
        {needsPreview(plan) && needsStructure(plan) && <p className="small acquisition-warning">{t('Image and structure are separate live observations, so they may not reflect one unchanged Figma revision.')}</p>}
        <p className="small muted">{t('Acquisition reads the selection without editing the Figma document.')}</p>
        <button className="wide" disabled={!connected || !sameSession || !sameRevision || busy || dirty || !!action} onClick={start}>{t('Start acquisition')}</button>
      </div>}
      {task.status !== 'prepared' && <div className="acquisition-progress">
        <p className="small" aria-live="polite">{t('Stage: {stage} · {seconds} s elapsed', { stage: t(stageLabels[task.stage]), seconds: (task.progress.elapsedMs / 1000).toFixed(1) })}</p>
        {(task.status === 'running' || task.status === 'cancel_requested') && <progress aria-label={t('Acquisition progress')} />}
        <p className="small muted">{t('Observed: {nodes} nodes · {bytes} metadata bytes. Total work remains unknown.', {
          nodes: formatNumber(task.progress.nodes), bytes: formatNumber(task.progress.bytes),
        })}</p>
        <dl className="acquisition-steps"><div><dt>{t('Overview image')}</dt><dd>{t(stepLabels[task.preview.status])}</dd></div>
          <div><dt>{t('Source structure')}</dt><dd>{t(stepLabels[task.structure.status])}{task.structure.status === 'ready' && !task.structure.complete ? ` · ${t('Incomplete')}` : ''}</dd></div></dl>
      </div>}
      {previewResult && <OverviewPreview key={`${task.id}:${task.preview.observedAt}`} result={previewResult} sourceName={scope?.name ?? scope?.nodeId ?? ''} />}
      {task.structure.reason && <p className="small acquisition-warning">{t('Structure is incomplete: {reason}', { reason: task.structure.reason })}</p>}
      {task.preview.error && <p className="small acquisition-warning">{t('Overview failed: {reason}', { reason: task.preview.error.message })}</p>}
      {task.structure.error && <p className="small acquisition-warning">{t('Structure failed: {reason}', { reason: task.structure.error.message })}</p>}
      {task.error && <p className="small acquisition-warning">{t('Acquisition stopped: {reason}', { reason: task.error.message })}</p>}
      {task.warnings.length > 0 && <ul className="acquisition-warnings">{task.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
      {task.status === 'cancel_requested' && <p className="small acquisition-warning">{t('Stop requested. A native Figma export already in progress may finish before the job stops.')}</p>}
      {task.status === 'cancelled' && <p className="small muted">{t('This job stopped. Previously validated observations remain available.')}</p>}
      {(task.status === 'partial' || task.status === 'failed' || task.status === 'interrupted') && <p className="small acquisition-warning">{t('This acquisition is incomplete. It cannot be saved as a source-grounded capture.')}</p>}
      {task.plan === 'overview' && task.status === 'ready' && <p className="small muted">{t('An overview-only result is for viewing and cannot be saved as a source-grounded capture.')}</p>}
      {task.plan === 'overview' && task.status === 'ready' && <><button className="wide" disabled={visualLinked || !previewResult || busy || dirty || !!action}
        onClick={createVisualDraft}>{t(visualLinked ? 'Visual draft already in workspace' : 'Use overview as visual draft')}</button>
        <p className="small muted">{t('This saves the image as a visual-only scope. Draw proposed regions now; source confirmation and approval remain unavailable until a complete collection is attached.')}</p></>}
      {task.plan === 'overview' && task.status === 'ready' && <><button className="wide" disabled={!connected || !sameSession || !sameRevision || busy || dirty || !!action} onClick={loadStructure}>{t('Load source structure')}</button>
        <p className="small muted">{t('The overview is reused. This starts a bounded structure read without rendering the image again.')}</p></>}
      {task.status === 'running' && <button className="wide" disabled={!!action} onClick={cancel}>{t('Stop acquisition')}</button>}
      {(task.preview.status === 'failed' || task.preview.status === 'partial') && <button className="wide" disabled={!canRetry} onClick={() => retry('preview')}>{t('Retry overview')}</button>}
      {(task.structure.status === 'failed' || task.structure.status === 'partial') && <button className="wide" disabled={!canRetry} onClick={() => retry('structure')}>{t('Retry structure from the beginning')}</button>}
      {task.status !== 'prepared' && task.status !== 'committed' && <button className="approve wide" disabled={!canCommit} onClick={commit}>{t('Save complete capture')}</button>}
      <button className="text-button acquisition-remove" disabled={task.status === 'running' || task.status === 'cancel_requested' || visualLinked || !!action || busy} onClick={remove}>{t('Remove acquisition record')}</button>
      {visualLinked && <p className="small muted">{t('This acquisition backs a workspace visual draft and cannot be removed here.')}</p>}
      <p className="small muted">{t('Removing this job deletes its acquisition observations. Saved captures and annotations stay in the workspace.')}</p>
      {task.status === 'cancelled' && <p className="small muted">{t('A native export may still occupy the plugin briefly after a stop. Try removal again once it settles.')}</p>}
    </div>}
  </section>;
}
