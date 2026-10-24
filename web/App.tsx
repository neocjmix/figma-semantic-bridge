import { useLocale, LanguageSelector } from './i18n.js';
import { message, errorMessage, UIError, type UIMessage } from './locale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DraftSchema, SourcePreviewResultSchema, type Annotation, type Operation, type Project, type Rect, type Snapshot, type SourceReference, type Specification } from '../src/shared/contracts.js';
import { ApiError, download, request } from './api.js';
import { Canvas } from './Canvas.js';
import { AiDraftPanel } from './AiDraftPanel.js';
import { SourceReviewPanel, type NodePreviewState } from './SourceReviewPanel.js';
import { CaptureBundlePanel } from './CaptureBundlePanel.js';
import { CAPTURE_BUNDLE_MAX_BYTES, type CaptureBundle } from '../src/shared/capture-bundle.js';
import { buildRenderingEvidence } from '../src/core/rendering-evidence.js';

type ProjectSummary = Pick<Project, 'id' | 'name' | 'revision' | 'updatedAt'> & { snapshotCount: number; annotationCount: number; specificationCount: number };
type Tab = 'components' | 'specifications' | 'proposals';
interface SourceSelectionResult {
  projectId: string; revision: number; annotationId: string; snapshotId: string; sessionId: string;
  selected: { id: string; name: string; type: string; bbox: Rect | null };
  sourceRef: SourceReference;
}
interface PreviewContext { projectId: string; revision: number; annotationId: string; snapshotId: string; sessionId: string }
const uid = () => crypto.randomUUID();
const sourceKey = (snapshotId: string, nodeId: string) => JSON.stringify([snapshotId, nodeId]);
const roles: Annotation['role'][] = ['component', 'section', 'element', 'page', 'specification', 'ignore'];
const relationTypes: Specification['relations'][number]['relationType'][] = ['describes', 'behavior', 'constraint', 'interaction', 'dependency'];

export function App() {
  const { t, renderMessage, formatNumber } = useLocale();
  const [tokenInput, setTokenInput] = useState(() => sessionStorage.getItem('fsb-token') ?? '');
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<Annotation | null>(null);
  const [specDraft, setSpecDraft] = useState<Specification | null>(null);
  const [textKeys, setTextKeys] = useState<string[]>([]);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('components');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UIMessage | null>(null);
  const [notice, setNotice] = useState<UIMessage>(() => message('Your design, your interpretation. Your workspace is stored on this computer.'));
  const [connected, setConnected] = useState(false);
  const [pluginSessionId, setPluginSessionId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState<string | null>(null);
  const [proposalJson, setProposalJson] = useState('');
  const [nodePreview, setNodePreview] = useState<{ context: PreviewContext; state: NodePreviewState } | null>(null);
  const previewRequestId = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  useEffect(() => () => previewAbort.current?.abort(), []);
  const snapshot = project?.snapshots.find(s => s.id === snapshotId) ?? project?.snapshots[0] ?? null;
  const annotations = project?.annotations.filter(a => a.snapshotId === snapshot?.id) ?? [];
  const selectedSaved = project?.annotations.find(a => a.id === selectedId);
  const dirtyAnnotation = annotationDraft && JSON.stringify(annotationDraft) !== JSON.stringify(selectedSaved);
  const dirtySpecification = specDraft && JSON.stringify(specDraft) !== JSON.stringify(project?.specifications.find(spec => spec.id === specDraft.id));
  const dirtyCaptureImport = !!dirtyAnnotation || !!dirtySpecification || !!proposalJson.trim() || (!specDraft && textKeys.length > 0);
  const sourceReview = annotationDraft?.sourceReview;
  const renderingEvidence = useMemo(() => buildRenderingEvidence(snapshot?.nodes ?? [], snapshot?.source.pageId), [snapshot?.nodes, snapshot?.source.pageId]);
  const hasObservedRendering = snapshot?.nodes.some(node => node.rendering !== undefined) ?? false;
  const renderingReviewRequired = !!sourceReview?.renderingReviewRequired || !!annotationDraft?.sourceRefs.some(ref => {
    const status = renderingEvidence.get(ref.nodeId)?.status;
    return status === 'hidden' || status === 'transparent' || (hasObservedRendering && status === 'unknown');
  });
  const sourceConfirmationRequired = !!(sourceReview?.ambiguous || renderingReviewRequired) && sourceReview?.status !== 'confirmed';
  const busyRef = useRef(false);
  const currentView = useRef({ token, project, annotationDraft, snapshotId: snapshot?.id, pluginSessionId, dirtyCaptureImport });
  useEffect(() => { currentView.current = { token, project, annotationDraft, snapshotId: snapshot?.id, pluginSessionId, dirtyCaptureImport }; }, [token, project, annotationDraft, snapshot?.id, pluginSessionId, dirtyCaptureImport]);
  useEffect(() => {
    previewRequestId.current++;
    previewAbort.current?.abort(); previewAbort.current = null;
    setNodePreview(null);
  }, [token, project?.id, project?.revision, snapshot?.id, annotationDraft?.id, pluginSessionId]);
  const visibleNodePreview = nodePreview && nodePreview.context.projectId === project?.id && nodePreview.context.revision === project.revision
    && nodePreview.context.annotationId === annotationDraft?.id && nodePreview.context.snapshotId === snapshot?.id
    && nodePreview.context.sessionId === pluginSessionId ? nodePreview.state : null;
  const pendingProposals = project?.proposals.filter(p => p.status === 'pending') ?? [];
  const allTexts = useMemo(() => project?.snapshots.flatMap(s => s.nodes.filter(n => n.type === 'TEXT' && n.text !== undefined).map(n => ({ snapshot: s, node: n, key: sourceKey(s.id, n.id) }))) ?? [], [project]);
  const chosenTexts = textKeys.map(key => allTexts.find(t => t.key === key)).filter(t => t !== undefined);
  const sourceRefs = chosenTexts.map(t => ({ snapshotId: t.snapshot.id, nodeId: t.node.id, matchType: 'exact' as const }));
  const originalText = chosenTexts.map(t => t.node.text).join('\n\n');

  async function listProjects(auth = token) {
    const result = await request<{ projects: ProjectSummary[] }>(auth, '/api/projects');
    setProjects(result.projects);
    return result.projects;
  }
  function receive(next: Project, keepSelection = true) {
    setProject(next);
    sessionStorage.setItem('fsb-last-project', next.id);
    setSnapshotId(current => next.snapshots.some(s => s.id === current) ? current : next.snapshots[0]?.id ?? null);
    if (!keepSelection) { setSelectedId(null); setAnnotationDraft(null); setSpecDraft(null); setTextKeys([]); setMergeIds([]); }
    else {
      const selected = next.annotations.find(a => a.id === selectedId);
      if (selected) setAnnotationDraft(structuredClone(selected));
      else if (selectedId) { setSelectedId(null); setAnnotationDraft(null); }
      if (specDraft) setSpecDraft(next.specifications.find(s => s.id === specDraft.id) ?? null);
    }
    setProjects(current => {
      const summary = { id: next.id, name: next.name, revision: next.revision, updatedAt: next.updatedAt,
        snapshotCount: next.snapshots.length, annotationCount: next.annotations.length, specificationCount: next.specifications.length };
      return [summary, ...current.filter(p => p.id !== next.id)];
    });
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    if (previewAbort.current) closeNodePreview();
    busyRef.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? { parts: [errorMessage(e), message('Refresh the workspace before saving again.')] } : errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function pair(auth: string) {
    await request(auth, '/api/health');
    sessionStorage.setItem('fsb-token', auth);
    setToken(auth);
    const available = await listProjects(auth);
    const lastProject = sessionStorage.getItem('fsb-last-project');
    if (lastProject && available.some(p => p.id === lastProject)) {
      receive(await request<Project>(auth, `/api/projects/${encodeURIComponent(lastProject)}`), false);
    }
    setNotice(message("Local server paired. Open a workspace or load the synthetic demo."));
  }
  useEffect(() => { if (tokenInput) void run(() => pair(tokenInput)); }, []);
  useEffect(() => {
    if (!token) { setConnected(false); setPluginSessionId(null); return; }
    let active = true;
    const poll = () => request<{ connected: boolean; sessionId: string | null }>(token, '/api/plugin/status').then(status => {
      if (active) { setConnected(status.connected); setPluginSessionId(status.connected ? status.sessionId : null); }
    }).catch(() => { if (active) { setConnected(false); setPluginSessionId(null); } });
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [token]);
  async function mutate(operation: Operation, noticeMessage: UIMessage) {
    if (!project) return;
    const next = await request<Project>(token, `/api/projects/${encodeURIComponent(project.id)}/mutate`, { expectedRevision: project.revision, operation });
    if (currentView.current.token !== token || currentView.current.project?.id !== project.id) return;
    receive(next); setNotice(noticeMessage); return next;
  }
  function selectAnnotation(annotation: Annotation) {
    setSelectedId(annotation.id); setAnnotationDraft(structuredClone(annotation)); setSnapshotId(annotation.snapshotId); setTab('components');
  }
  function createAnnotation(bbox: Rect) {
    if (!snapshot) return;
    const annotation: Annotation = { id: uid(), snapshotId: snapshot.id, name: t('Component {count}', { count: (project?.annotations.length ?? 0) + 1 }),
      role: 'component', bbox, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 };
    selectAnnotation(annotation); setNotice(message("New region drawn. Name it, then save the annotation."));
  }
  function patchAnnotation(patch: Partial<Annotation>) { if (!busyRef.current) setAnnotationDraft(current => current ? { ...current, ...patch } : null); }
  async function addCurrentFigmaSelection() {
    if (!project || !annotationDraft || !selectedSaved || !pluginSessionId) return;
    const expected = { projectId: project.id, revision: project.revision, annotationId: annotationDraft.id,
      snapshotId: annotationDraft.snapshotId, sessionId: pluginSessionId };
    const result = await request<SourceSelectionResult>(token, `/api/projects/${encodeURIComponent(project.id)}/source-selection`, {
      expectedRevision: expected.revision, annotationId: expected.annotationId, expectedSessionId: expected.sessionId,
    });
    const current = currentView.current;
    if (current.token !== token || current.project?.id !== expected.projectId || current.project.revision !== expected.revision
      || current.annotationDraft?.id !== expected.annotationId || current.annotationDraft.snapshotId !== expected.snapshotId
      || current.pluginSessionId !== expected.sessionId) throw new UIError(message("The workspace, annotation or Figma connection changed. Inspect the current selection and add it again."));
    if (result.projectId !== expected.projectId || result.revision !== expected.revision || result.annotationId !== expected.annotationId
      || result.snapshotId !== expected.snapshotId || result.sessionId !== expected.sessionId
      || result.sourceRef.snapshotId !== expected.snapshotId || result.sourceRef.nodeId !== result.selected.id
      || !current.project.snapshots.find(s => s.id === expected.snapshotId)?.nodes.some(n => n.id === result.selected.id)) {
      throw new UIError(message("The selected source could not be matched to this saved capture. Refresh and try again."));
    }
    const duplicate = current.annotationDraft.sourceRefs.some(ref => ref.snapshotId === result.sourceRef.snapshotId && ref.nodeId === result.sourceRef.nodeId);
    setAnnotationDraft(draft => draft?.id === expected.annotationId && draft.snapshotId === expected.snapshotId
      ? { ...draft, sourceRefs: draft.sourceRefs.some(ref => ref.snapshotId === result.sourceRef.snapshotId && ref.nodeId === result.sourceRef.nodeId)
        ? draft.sourceRefs : [...draft.sourceRefs, result.sourceRef] } : draft);
    setNotice(message(duplicate ? 'This Figma source is already in the draft set.' : 'Figma source added to the draft. Save annotation, then confirm sources.'));
  }
  async function showSourceInFigma(nodeId: string) {
    if (!snapshot?.source.fileKey) throw new UIError(message("Source file identity is unavailable; cannot safely highlight a node."));
    await request(token, '/api/plugin/highlight', { fileKey: snapshot.source.fileKey, pageId: snapshot.source.pageId, nodeIds: [nodeId] });
    setNotice(message("Source node selected in Figma. Inspect it before adding or confirming sources."));
  }
  async function previewSourceNode(nodeId: string) {
    if (busyRef.current || !project || !annotationDraft || !selectedSaved || !snapshot?.source.fileKey || !pluginSessionId || !connected) return;
    if (!snapshot.nodes.some(node => node.id === nodeId)) return;
    const context: PreviewContext = { projectId: project.id, revision: project.revision, annotationId: annotationDraft.id,
      snapshotId: snapshot.id, sessionId: pluginSessionId };
    const requestId = ++previewRequestId.current;
    const controller = new AbortController();
    previewAbort.current?.abort();
    previewAbort.current = controller;
    const isCurrent = () => {
      const current = currentView.current;
      return requestId === previewRequestId.current && current.token === token && current.project?.id === context.projectId
        && current.project.revision === context.revision && current.annotationDraft?.id === context.annotationId
        && current.annotationDraft.snapshotId === context.snapshotId && current.snapshotId === context.snapshotId
        && current.pluginSessionId === context.sessionId;
    };
    setNodePreview({ context, state: { nodeId, status: 'loading' } });
    try {
      const response = await request<unknown>(token, `/api/projects/${encodeURIComponent(project.id)}/source-preview`, {
        expectedRevision: context.revision, annotationId: context.annotationId, expectedSessionId: context.sessionId, nodeId,
      }, controller.signal);
      if (!isCurrent()) return;
      const parsed = SourcePreviewResultSchema.safeParse(response);
      if (!parsed.success) throw new UIError(message("The current export response could not be validated. Reconnect the plugin and try again."));
      const result = parsed.data;
      if (result.projectId !== context.projectId || result.revision !== context.revision || result.annotationId !== context.annotationId
        || result.snapshotId !== context.snapshotId || result.sessionId !== context.sessionId || result.result.node.id !== nodeId
        || result.result.fileKey !== snapshot.source.fileKey || result.result.pageId !== snapshot.source.pageId
        || result.result.node.sourceFileKey !== snapshot.source.fileKey || result.result.node.sourcePageId !== snapshot.source.pageId) {
        throw new UIError(message("The current export does not match this capture and connection. Reconnect the plugin and request it again."));
      }
      setNodePreview({ context, state: { nodeId, status: 'ready', result: result.result } });
    } catch (error) {
      if (!isCurrent()) return;
      const previewError: UIMessage = error instanceof ApiError && error.code === 'SOURCE_METADATA_CHANGED'
        ? message('The source changed since capture. Capture the scope again and review the new capture.')
        : error instanceof ApiError && error.code === 'REVISION_CONFLICT'
          ? message('The workspace changed. Reload it before requesting another export.')
          : { parts: [errorMessage(error, 'The current export is unavailable.'), message('Inspect the node with Show in Figma, check the plugin connection, then try again or capture a new scope.')] };
      setNodePreview({ context, state: { nodeId, status: 'error', message: previewError } });
    } finally {
      if (previewAbort.current === controller) previewAbort.current = null;
    }
  }
  function closeNodePreview() { previewRequestId.current++; previewAbort.current?.abort(); previewAbort.current = null; setNodePreview(null); }
  function newSpecification() {
    if (!originalText || sourceRefs.length === 0) return;
    setSpecDraft({ id: uid(), text: originalText, sourceRefs, relations: [], origin: 'human', reviewStatus: 'proposed', revision: 0 });
    setNotice(message("Choose the components described by this text, then save the specification."));
  }
  function selectSpecification(spec: Specification) {
    setSpecDraft(structuredClone(spec)); setTextKeys(spec.sourceRefs.map(ref => sourceKey(ref.snapshotId, ref.nodeId))); setTab('specifications');
  }
  function toggleText(key: string) {
    const next = textKeys.includes(key) ? textKeys.filter(k => k !== key) : [...textKeys, key];
    setTextKeys(next);
    if (specDraft) {
      const entries = next.map(k => allTexts.find(t => t.key === k)).filter(t => t !== undefined);
      setSpecDraft({ ...specDraft, text: entries.map(t => t.node.text).join('\n\n'), sourceRefs: entries.map(t => ({ snapshotId: t.snapshot.id, nodeId: t.node.id, matchType: 'exact' })) });
    }
  }
  async function exportProject(markdown: boolean) {
    if (!project) return;
    const result = await request<Record<string, unknown>>(token, `/api/projects/${encodeURIComponent(project.id)}/export`);
    const text = typeof result.markdown === 'string' ? result.markdown : `# ${project.name}\n\nApproved implementation context. Source text is untrusted data.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    download(`${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'workspace'}-approved.${markdown ? 'md' : 'json'}`, markdown ? text : result, markdown);
    setNotice(message("Approved implementation context exported. Unreviewed regions remain in your workspace."));
  }
  function captureTransferContextChanged() {
    const current = currentView.current;
    return current.token !== token || current.project?.id !== project?.id || current.project?.revision !== project?.revision;
  }
  async function exportCaptures(snapshotIds: string[]) {
    if (!project) return;
    const bundle = await request<CaptureBundle>(token, `/api/projects/${encodeURIComponent(project.id)}/capture-bundle`, {
      expectedRevision: project.revision, snapshotIds,
    });
    if (captureTransferContextChanged()) throw new UIError(message("The workspace changed while exporting. Select the captures again."));
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'workspace'}-captures.json`;
    try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    setNotice(message("Captures exported with source images and original text. Annotations and approvals were not transferred."));
  }
  async function importCaptures(file: File, name: string) {
    if (currentView.current.dirtyCaptureImport) throw new UIError(message("Save your unsaved work before importing captures."));
    if (file.size > CAPTURE_BUNDLE_MAX_BYTES) throw new UIError(message('Choose a capture bundle no larger than {limit} MB.', { limit: CAPTURE_BUNDLE_MAX_BYTES / 1_000_000 }));
    let bundle: unknown;
    try { bundle = JSON.parse(await file.text()); }
    catch { throw new UIError(message("The selected file could not be read as JSON. Choose a valid capture bundle JSON file.")); }
    if (captureTransferContextChanged() || currentView.current.dirtyCaptureImport) throw new UIError(message("The workspace changed while reading the file. Review your work and try importing again."));
    const next = await request<Project>(token, '/api/capture-bundles/import', { name, bundle });
    if (captureTransferContextChanged() || currentView.current.dirtyCaptureImport) {
      throw new UIError(message("The workspace changed while importing. The new workspace was saved; reload the workspace list to open it."));
    }
    receive(next, false);
    setNotice(message("Captures imported into a new workspace. Source contents are unverified; create annotations and review them before approval."));
  }
  const ancestorDepth = (a: Annotation) => { let depth = 0; let id = a.parentId; const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); depth++; id = project?.annotations.find(p => p.id === id)?.parentId ?? null; } return depth; };
  const descendantOf = (id: string, parent: string) => { const seen = new Set<string>(); let current = project?.annotations.find(a => a.id === id); while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); if (current.parentId === parent) return true; current = project?.annotations.find(a => a.id === current!.parentId); } return false; };
  const statusBadge = (status: Annotation['reviewStatus']) => <span className={`badge ${status}`}>{t(status)}</span>;

  return <div className="app">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⇄</span><div><strong>Semantic Bridge</strong><span>{t("FIGMA → IMPLEMENTATION CONTEXT")}</span></div></div>
      <div className="header-center"><span className="local-pill">{t("LOCAL WORKSPACE")}</span>{project && <span className="project-heading">{project.name}</span>}</div>
      <div className="header-actions"><LanguageSelector /><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? t("Figma connected") : t("Figma disconnected")}</span>{token && <button className="quiet inverse" disabled={busy} onClick={() => { sessionStorage.removeItem('fsb-token'); sessionStorage.removeItem('fsb-last-project'); setToken(''); setTokenInput(''); setProject(null); }}>{t("Unpair")}</button>}</div>
    </header>
    {!token ? <main className="pairing-page">
      <section className="welcome-copy"><div className="eyebrow">{t("HUMAN FIRST. SOURCE GROUNDED.")}</div><h1>{t("Turn a design into")}<br />{t("shared understanding.")}</h1><p>{t("Mark meaningful components, connect their specifications, and give coding agents context you have reviewed.")}</p><div className="workflow-steps"><span><b>01</b> {t("Capture a frame")}</span><span><b>02</b> {t("Annotate & connect")}</span><span><b>03</b> {t("Review & share")}</span></div></section>
      <form className="pairing-card" onSubmit={event => { event.preventDefault(); void run(() => pair(tokenInput.trim())); }}><div className="card-icon">⌘</div><h2>{t("Connect your local server")}</h2><p>{t("Paste the pairing token printed by")} <code>npm start</code>{t(". It stays in this browser tab's session.")}</p><label>{t("Pairing token")}<input autoComplete="off" type="password" minLength={32} maxLength={1024} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder={t("Paste local pairing token")} autoFocus /></label><button className="primary wide" type="submit" disabled={busy || tokenInput.trim().length < 32 || tokenInput.trim().length > 1024}>{t("Pair server")}</button><p className="small muted">{t("The Figma plugin uses the same token. Your source document remains unchanged.")}</p>{error && <div className="error" role="alert">{renderMessage(error)}</div>}</form>
    </main> : <>
      <div className="workspace-bar"><div className="breadcrumbs">{t("Workspace")} <span>/</span> {snapshot?.name ?? t("Get started")} {project && <span className="revision">{t('revision {revision}', { revision: project.revision })}</span>}</div><div className="actions"><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}`)); setNotice(message("Workspace refreshed from local storage.")); })}>{t("Refresh")}</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(false))}>{t("Export JSON")}</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(true))}>{t("Markdown")}</button></div></div>
      {error && <div className="global-error" role="alert"><strong>{t("Could not complete action.")}</strong> {renderMessage(error)}<button aria-label={t("Dismiss error")} onClick={() => setError(null)}>×</button></div>}
      <div className="workspace">
        <aside className="sidebar">
          <section className="panel-section"><div className="section-title"><h2>{t("Workspace")}</h2><span className="mini-label">{t("LOCAL")}</span></div>
            <label className="sr-only" htmlFor="workspace-select">{t("Open workspace")}</label><select id="workspace-select" value={project?.id ?? ''} disabled={busy} onChange={e => { const id = e.target.value; if (id) void run(async () => receive(await request<Project>(token, `/api/projects/${id}`), false)); }}><option value="">{t("Choose a workspace")}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <form className="create-project" onSubmit={e => { e.preventDefault(); void run(async () => { receive(await request<Project>(token, '/api/projects', { name: newProjectName ?? t('Untitled workspace') }), false); setNotice(message("Workspace created. Capture a Figma selection to begin.")); }); }}><label className="sr-only" htmlFor="project-name">{t("New workspace name")}</label><input id="project-name" value={newProjectName ?? t('Untitled workspace')} maxLength={300} onChange={e => setNewProjectName(e.target.value)} /><button type="submit" disabled={busy || !(newProjectName ?? t('Untitled workspace')).trim()} aria-label={t("Create workspace")}>+</button></form>
            <button className="text-button" disabled={busy} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice(message("Synthetic demo loaded. This is generated test data, not a live Figma capture.")); })}>{t("Load demo")}</button>
          </section>
          <section className="panel-section"><div className="section-title"><h2>{t("Source captures")}</h2><span className="count">{project?.snapshots.length ?? 0}</span></div><p className="small muted">{t("Capture the UI and nearby specifications separately.")}</p>
            <button className="primary wide" disabled={!project || !connected || busy} onClick={() => void run(async () => { if (!project) return; const next = await request<Project>(token, `/api/projects/${project.id}/capture`, { expectedRevision: project.revision, limits: {} }); receive(next, false); setSnapshotId(next.snapshots[next.snapshots.length - 1]?.id ?? null); setNotice(message("Selected Figma scope captured and stored locally.")); })}>{t("Capture Figma selection")}</button>
            {!connected && <p className="small muted">{t("Launch the development plugin and pair it with this server.")}</p>}
            <div className="snapshot-list">{project?.snapshots.map((s, i) => <button disabled={busy} key={s.id} className={`snapshot-item ${snapshot?.id === s.id ? 'active' : ''}`} onClick={() => { setSnapshotId(s.id); setSelectedId(null); setAnnotationDraft(null); setMergeIds([]); }}><span className="snapshot-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{s.name}</strong><small>{t('{count} nodes · {scope}', { count: formatNumber(s.nodes.length), scope: t(s.completeness.complete ? 'complete scope' : 'partial scope') })}</small></span></button>)}</div>
            <CaptureBundlePanel key={project?.id ?? 'no-workspace'} project={project} currentSnapshotId={snapshot?.id ?? null} busy={busy} dirty={dirtyCaptureImport}
              onExport={ids => void run(() => exportCaptures(ids))} onImport={(file, name) => void run(() => importCaptures(file, name))} />
          </section>
          <section className="panel-section components-section"><div className="section-title"><h2>{t("Components")}</h2><span className="count">{annotations.length}</span></div>
            <div className="component-list">{annotations.map(a => <div className={`component-row ${a.id === selectedId ? 'active' : ''}`} key={a.id} style={{ paddingLeft: 5 + Math.min(ancestorDepth(a), 5) * 10 }}><input type="checkbox" aria-label={t('Merge {name}', { name: a.name })} checked={mergeIds.includes(a.id)} onChange={e => setMergeIds(current => e.target.checked ? [...current, a.id] : current.filter(id => id !== a.id))} /><button disabled={busy} onClick={() => selectAnnotation(a)}><span className={`status-dot ${a.reviewStatus}`} /><span>{a.name}</span></button></div>)}</div>
            {!annotations.length && <p className="empty-hint">{t("Draw your first region on the canvas. Component structure is yours to define.")}</p>}
            <button className="wide" disabled={!snapshot || busy} onClick={() => { if (snapshot) createAnnotation({ x: snapshot.bounds.x + snapshot.bounds.width * 0.1, y: snapshot.bounds.y + snapshot.bounds.height * 0.1, width: snapshot.bounds.width * 0.3, height: snapshot.bounds.height * 0.2 }); }}>{t("+ Add region")}</button>
            {mergeIds.length >= 2 && <button className="wide" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'merge_annotations', ids: mergeIds, name: t('Merged component') }, message("Regions merged. Review the component and its specification links.")); setMergeIds([]); })}>{t('Merge {count} selected', { count: mergeIds.length })}</button>}
          </section>
          <div className="sidebar-footer"><strong>{t("Human decisions are authoritative.")}</strong><span>{t("Approved context is available through MCP.")}</span></div>
        </aside>

        <main className="canvas-column">
          <div className="canvas-heading"><div><div className="eyebrow">{t("VISUAL SOURCE → SEMANTIC REGIONS")}</div><h1>{snapshot?.name ?? t("Start with a design")}</h1></div><div className="actions"><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/undo`, { expectedRevision: project.revision })); setNotice(message("Previous edit restored.")); })}>{t("Undo")}</button><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/redo`, { expectedRevision: project.revision })); setNotice(message("Edit restored.")); })}>{t("Redo")}</button></div></div>
          {snapshot && (!snapshot.completeness.complete || snapshot.warnings.length > 0) && <details className="scope-warning"><summary>{t('{kind} · inspect limitations before approval', { kind: t(!snapshot.completeness.complete ? 'Partial capture' : 'Capture notes') })}</summary>{!snapshot.completeness.complete && <p>{snapshot.completeness.reason}</p>}<ul>{snapshot.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          {snapshot ? <Canvas key={snapshot.id} snapshot={snapshot} annotations={annotations} selectedId={selectedId} draft={annotationDraft} onSelect={annotation => { if (!busyRef.current) selectAnnotation(annotation); }} onDraft={annotation => { if (!busyRef.current) setAnnotationDraft(annotation); }} onCreate={bbox => { if (!busyRef.current) createAnnotation(bbox); }} /> : <section className="empty-canvas"><div className="empty-diagram"><span>▤</span><i>→</i><span>▧</span><i>→</i><span>⌘</span></div><h2>{t("Give your design a meaningful structure.")}</h2><p>{t("Create a workspace and capture one selected Figma frame. You can also explore a generated demo without connecting Figma.")}</p><button className="primary" disabled={busy} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice(message("Generated demo loaded.")); })}>{t("Explore synthetic demo")}</button><p className="small">{t("Capture → mark regions → connect specifications → approve")}</p></section>}
          <div className="status-bar" role="status"><span className={`status-indicator ${busy ? 'working' : ''}`} />{busy ? t('Working with your local server…') : renderMessage(notice)}</div>
        </main>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist" aria-label={t("Inspector")}><button role="tab" aria-selected={tab === 'components'} onClick={() => setTab('components')}>{t("Component")}</button><button role="tab" aria-selected={tab === 'specifications'} onClick={() => setTab('specifications')}>{t("Specifications")}</button><button role="tab" aria-selected={tab === 'proposals'} onClick={() => setTab('proposals')}>{t("Drafts")} {pendingProposals.length > 0 && <b>{pendingProposals.length}</b>}</button></div>
          {tab === 'components' && <div className="inspector-content">
            {annotationDraft ? <><div className="section-title"><h2>{t("Region details")}</h2>{statusBadge(annotationDraft.reviewStatus)}</div>
              {dirtyAnnotation && <p className="unsaved">{t("Unsaved changes · use Save annotation")}</p>}
              <label>{t("Component name")}<input disabled={busy} aria-label={t("Component name")} value={annotationDraft.name} maxLength={300} onChange={e => patchAnnotation({ name: e.target.value })} /></label>
              <div className="two-fields"><label>{t("Role")}<select disabled={busy} aria-label={t('Role')} value={annotationDraft.role} onChange={e => patchAnnotation({ role: e.target.value as Annotation['role'] })}>{roles.map(role => <option key={role} value={role}>{t(role)}</option>)}</select></label><label>{t("Parent component")}<select disabled={busy} aria-label={t("Parent component")} value={annotationDraft.parentId ?? ''} onChange={e => patchAnnotation({ parentId: e.target.value || null })}><option value="">{t("Top level")}</option>{annotations.filter(a => a.id !== annotationDraft.id && !descendantOf(a.id, annotationDraft.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
              <div className="section-label">{t("DOCUMENT COORDINATES")}</div><div className="bbox-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{t(key)}<input disabled={busy} aria-label={t(`Region ${key}`)} type="number" step="0.1" min={key === 'width' || key === 'height' ? 0.1 : undefined} value={Math.round(annotationDraft.bbox[key] * 100) / 100} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) patchAnnotation({ bbox: { ...annotationDraft.bbox, [key]: value } }); }} /></label>)}</div>
              <button className="primary wide" disabled={busy || !annotationDraft.name.trim()} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_annotation', annotation: annotationDraft }, message("Annotation saved. Match source nodes, then review it.")); if (next) { const saved = next.annotations.find(a => a.id === annotationDraft.id); if (saved) selectAnnotation(saved); } })}>{t("Save annotation")}</button>
              <div className="divider" />
              {snapshot && <SourceReviewPanel key={`${project?.id}:${annotationDraft.id}:${snapshot.id}`} annotation={annotationDraft} snapshot={snapshot}
                renderingEvidence={renderingEvidence} renderingReviewRequired={renderingReviewRequired}
                nodePreview={visibleNodePreview} onPreviewNode={nodeId => void previewSourceNode(nodeId)} onCloseNodePreview={closeNodePreview}
                saved={!!selectedSaved} dirty={!!dirtyAnnotation} busy={busy} connected={connected} sessionId={pluginSessionId}
                onMatch={() => void run(async () => { await mutate({ type: 'match_annotation', id: annotationDraft.id, tolerance: 0.5 }, message("Source matches updated. Inspect references before approval.")); })}
                onAddCurrent={() => void run(addCurrentFigmaSelection)}
                onReferencesChange={refs => patchAnnotation({ sourceRefs: refs })}
                onShowInFigma={nodeId => void run(() => showSourceInFigma(nodeId))}
                onConfirm={() => void run(async () => { if (selectedSaved) await mutate({ type: 'confirm_annotation_sources', id: selectedSaved.id, expectedAnnotationRevision: selectedSaved.revision }, message("Source set confirmed. Review the annotation meaning before approval.")); })} />}
              <div className="divider" /><div className="section-title"><h2>{t("Human review")}</h2><span className="mini-label">{t(annotationDraft.origin)}</span></div><p className="small muted">{t("Save changes before approving. Editing an approved region requires review again.")}</p><div className="two-fields"><button className="approve" disabled={!selectedSaved || !!dirtyAnnotation || busy || sourceConfirmationRequired} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'approved' }, message("Component approved for implementation context.")); })}>{t("Approve annotation")}</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'rejected' }, message("Annotation rejected.")); })}>{t("Reject")}</button></div>
              {annotationDraft.parentId && <p className="small muted">{t("Its parent must also be approved before this component appears in approved exports.")}</p>}
              <details className="advanced"><summary>{t("Split or remove region")}</summary><div className="two-fields"><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'horizontal', ratio: 0.5 }, message("Region split into two components. Review their source matches.")); })}>{t("Split horizontally")}</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'vertical', ratio: 0.5 }, message("Region split into two components. Review their source matches.")); })}>{t("Split vertically")}</button></div><button className="danger wide" disabled={busy} onClick={() => void run(async () => { if (selectedSaved) await mutate({ type: 'delete_annotation', id: annotationDraft.id }, message("Annotation removed. Undo is available.")); setAnnotationDraft(null); setSelectedId(null); })}>{t("Delete annotation")}</button></details>
            </> : <div className="inspector-empty"><span>▧</span><h2>{t("Choose a component")}</h2><p>{t("Select a region or draw one on the canvas to name it, connect source nodes and review its meaning.")}</p></div>}
          </div>}
          {tab === 'specifications' && <div className="inspector-content">
            <div className="section-title"><h2>{t("Specification graph")}</h2><span className="count">{project?.specifications.length ?? 0}</span></div><p className="small muted">{t("Keep the original wording. A specification can describe several components.")}</p>
            <div className="spec-list">{project?.specifications.map(spec => <button disabled={busy} key={spec.id} className={specDraft?.id === spec.id ? 'active' : ''} onClick={() => selectSpecification(spec)}><span>{spec.text.slice(0, 75)}{spec.text.length > 75 ? '…' : ''}</span>{statusBadge(spec.reviewStatus)}<small>{t('{count} component links', { count: spec.relations.length })}</small></button>)}</div>
            <details open={!specDraft}><summary>{t('Select source text ({count})', { count: textKeys.length })}</summary><p className="small muted">{t("Select exact TEXT nodes from any captured scope. Selection order is preserved.")}</p><div className="text-nodes">{allTexts.map(({ snapshot: source, node, key }) => <label className="checkbox text-node" key={key}><input disabled={busy} type="checkbox" checked={textKeys.includes(key)} onChange={() => toggleText(key)} /><span>{node.text}<small>{source.name} · {node.id}</small></span></label>)}</div>{!allTexts.length && <p className="empty-hint">{t("Capture a scope containing specification text first.")}</p>}</details>
            <button className="wide" disabled={!originalText || busy} onClick={newSpecification}>{t("Create specification")}</button>
            {specDraft && <><div className="divider" /><div className="section-title"><h2>{t("Original specification")}</h2>{statusBadge(specDraft.reviewStatus)}</div><pre className="spec-text">{specDraft.text || t("Select at least one nonempty source TEXT node.")}</pre><div className="section-label">{t("LINK TO COMPONENTS")}</div>
              <div className="relation-list">{project?.annotations.map(annotation => { const relation = specDraft.relations.find(r => r.targetAnnotationId === annotation.id); return <div className="relation" key={annotation.id}><label className="checkbox"><input disabled={busy} type="checkbox" checked={!!relation} onChange={e => setSpecDraft({ ...specDraft, relations: e.target.checked ? [...specDraft.relations, { targetAnnotationId: annotation.id, relationType: 'describes', reviewStatus: 'proposed' }] : specDraft.relations.filter(r => r.targetAnnotationId !== annotation.id) })} /><span>{annotation.name}<small>{t(annotation.reviewStatus)}</small></span></label>{relation && <select disabled={busy} aria-label={t('Relation to {name}', { name: annotation.name })} value={relation.relationType} onChange={e => setSpecDraft({ ...specDraft, relations: specDraft.relations.map(r => r.targetAnnotationId === annotation.id ? { ...r, relationType: e.target.value as typeof relation.relationType } : r) })}>{relationTypes.map(type => <option key={type} value={type}>{t(type)}</option>)}</select>}</div>; })}</div>
              {!project?.annotations.length && <p className="empty-hint">{t("Create components before adding specification links.")}</p>}
              <button className="primary wide" disabled={busy || !specDraft.text || !specDraft.sourceRefs.length} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_specification', specification: specDraft }, message("Specification and component links saved for review.")); const saved = next?.specifications.find(s => s.id === specDraft.id); if (saved) selectSpecification(saved); })}>{t("Save specification")}</button>
              <div className="two-fields"><button className="approve" disabled={busy || !project?.specifications.some(s => s.id === specDraft.id) || JSON.stringify(specDraft) !== JSON.stringify(project?.specifications.find(s => s.id === specDraft.id))} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'approved' }, message("Specification and its component links approved.")); })}>{t("Approve specification")}</button><button disabled={busy || !project?.specifications.some(s => s.id === specDraft.id)} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'rejected' }, message("Specification rejected.")); })}>{t("Reject")}</button></div><p className="small muted">{t("Approve target components first. This action reviews the specification and all its links.")}</p><button className="danger text-button" disabled={busy} onClick={() => void run(async () => { if (project?.specifications.some(s => s.id === specDraft.id)) await mutate({ type: 'delete_specification', id: specDraft.id }, message("Specification removed.")); setSpecDraft(null); setTextKeys([]); })}>{t("Delete specification")}</button>
            </>}
          </div>}
          {tab === 'proposals' && <div className="inspector-content"><div className="section-title"><h2>{t("Review draft proposals")}</h2><span className="count">{pendingProposals.length}</span></div><p className="small muted">{t("AI and coding agents can suggest changes. Accepting a draft keeps its content proposed until you review it.")}</p>
            {pendingProposals.map(proposal => <article className="proposal" key={proposal.id}><strong>{t('{regions} regions · {specifications} specifications', { regions: proposal.draft.annotations.length, specifications: proposal.draft.specifications.length })}</strong><small>{t('Based on revision {revision}', { revision: proposal.baseRevision })}</small><details><summary>{t("Inspect proposed changes")}</summary><pre>{JSON.stringify(proposal.draft, null, 2)}</pre></details>{proposal.warnings.map((warning, i) => <p className="small" key={i}>{warning}</p>)}<div className="two-fields"><button className="primary" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'accept' }, message("Draft applied as proposed content. Review each region and specification.")); })}>{t("Accept draft")}</button><button disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'reject' }, message("Draft rejected.")); })}>{t("Reject draft")}</button></div></article>)}
            {!pendingProposals.length && <p className="empty-hint">{t("No proposals waiting. The manual workflow is always available.")}</p>}
            <div className="divider" /><AiDraftPanel token={token} project={project} currentSnapshotId={snapshot?.id ?? null} onGenerated={next => {
              if (currentView.current.token !== token || currentView.current.project?.id !== next.id || busyRef.current) return;
              receive(next); setNotice(message("Generated draft queued. Inspect it before accepting, then review each proposed record."));
            }} />
            <div className="divider" /><h2>{t("Import a structured draft")}</h2><label>{t("Draft JSON")}<textarea disabled={busy} aria-label={t("Draft JSON")} rows={8} value={proposalJson} onChange={e => setProposalJson(e.target.value)} placeholder={'{"annotations": [], "specifications": []}'} /></label><button className="wide" disabled={!project || !proposalJson.trim() || busy} onClick={() => void run(async () => { if (!project) return; const draft = DraftSchema.parse(JSON.parse(proposalJson)); receive(await request<Project>(token, `/api/projects/${project.id}/proposals`, { expectedRevision: project.revision, draft, warnings: [] })); setProposalJson(''); setNotice(message("Draft validated and queued for human review.")); })}>{t("Submit draft for review")}</button><p className="small muted">{t("No external model connection is enabled by importing JSON.")}</p>
          </div>}
        </aside>
      </div>
    </>}
  </div>;
}
