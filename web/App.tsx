import { useEffect, useMemo, useState } from 'react';
import { DraftSchema, type Annotation, type Operation, type Project, type Rect, type Snapshot, type SourceReference, type Specification } from '../src/shared/contracts.js';
import { ApiError, download, request } from './api.js';
import { Canvas } from './Canvas.js';
import { AiDraftPanel } from './AiDraftPanel.js';

type ProjectSummary = Pick<Project, 'id' | 'name' | 'revision' | 'updatedAt'> & { snapshotCount: number; annotationCount: number; specificationCount: number };
type Tab = 'components' | 'specifications' | 'proposals';
const uid = () => crypto.randomUUID();
const sourceKey = (snapshotId: string, nodeId: string) => JSON.stringify([snapshotId, nodeId]);
const roles: Annotation['role'][] = ['component', 'section', 'element', 'page', 'specification', 'ignore'];
const relationTypes: Specification['relations'][number]['relationType'][] = ['describes', 'behavior', 'constraint', 'interaction', 'dependency'];

export function App() {
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Your design, your interpretation. Your workspace is stored on this computer.');
  const [connected, setConnected] = useState(false);
  const [newProjectName, setNewProjectName] = useState('Untitled workspace');
  const [proposalJson, setProposalJson] = useState('');
  const snapshot = project?.snapshots.find(s => s.id === snapshotId) ?? project?.snapshots[0] ?? null;
  const annotations = project?.annotations.filter(a => a.snapshotId === snapshot?.id) ?? [];
  const selectedSaved = project?.annotations.find(a => a.id === selectedId);
  const dirtyAnnotation = annotationDraft && JSON.stringify(annotationDraft) !== JSON.stringify(selectedSaved);
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
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? `${e.message} Refresh the workspace before saving again.` : e instanceof Error ? e.message : 'The request could not be completed.'); }
    finally { setBusy(false); }
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
    setNotice('Local server paired. Open a workspace or load the synthetic demo.');
  }
  useEffect(() => { if (tokenInput) void run(() => pair(tokenInput)); }, []);
  useEffect(() => {
    if (!token) return;
    const poll = () => request<{ connected: boolean }>(token, '/api/plugin/status').then(status => setConnected(status.connected)).catch(() => setConnected(false));
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => clearInterval(timer);
  }, [token]);
  async function mutate(operation: Operation, message: string) {
    if (!project) return;
    const next = await request<Project>(token, `/api/projects/${encodeURIComponent(project.id)}/mutate`, { expectedRevision: project.revision, operation });
    receive(next); setNotice(message); return next;
  }
  function selectAnnotation(annotation: Annotation) {
    setSelectedId(annotation.id); setAnnotationDraft(structuredClone(annotation)); setSnapshotId(annotation.snapshotId); setTab('components');
  }
  function createAnnotation(bbox: Rect) {
    if (!snapshot) return;
    const annotation: Annotation = { id: uid(), snapshotId: snapshot.id, name: `Component ${(project?.annotations.length ?? 0) + 1}`,
      role: 'component', bbox, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 };
    selectAnnotation(annotation); setNotice('New region drawn. Name it, then save the annotation.');
  }
  function patchAnnotation(patch: Partial<Annotation>) { setAnnotationDraft(current => current ? { ...current, ...patch } : null); }
  function newSpecification() {
    if (!originalText || sourceRefs.length === 0) return;
    setSpecDraft({ id: uid(), text: originalText, sourceRefs, relations: [], origin: 'human', reviewStatus: 'proposed', revision: 0 });
    setNotice('Choose the components described by this text, then save the specification.');
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
    setNotice('Approved implementation context exported. Unreviewed regions remain in your workspace.');
  }
  const ancestorDepth = (a: Annotation) => { let depth = 0; let id = a.parentId; const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); depth++; id = project?.annotations.find(p => p.id === id)?.parentId ?? null; } return depth; };
  const descendantOf = (id: string, parent: string) => { const seen = new Set<string>(); let current = project?.annotations.find(a => a.id === id); while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); if (current.parentId === parent) return true; current = project?.annotations.find(a => a.id === current!.parentId); } return false; };
  const statusBadge = (status: string) => <span className={`badge ${status}`}>{status}</span>;

  return <div className="app">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⇄</span><div><strong>Semantic Bridge</strong><span>FIGMA → IMPLEMENTATION CONTEXT</span></div></div>
      <div className="header-center"><span className="local-pill">LOCAL WORKSPACE</span>{project && <span className="project-heading">{project.name}</span>}</div>
      <div className="header-actions"><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'Figma connected' : 'Figma disconnected'}</span>{token && <button className="quiet inverse" onClick={() => { sessionStorage.removeItem('fsb-token'); sessionStorage.removeItem('fsb-last-project'); setToken(''); setTokenInput(''); setProject(null); }}>Unpair</button>}</div>
    </header>
    {!token ? <main className="pairing-page">
      <section className="welcome-copy"><div className="eyebrow">HUMAN FIRST. SOURCE GROUNDED.</div><h1>Turn a design into<br />shared understanding.</h1><p>Mark meaningful components, connect their specifications, and give coding agents context you have reviewed.</p><div className="workflow-steps"><span><b>01</b> Capture a frame</span><span><b>02</b> Annotate & connect</span><span><b>03</b> Review & share</span></div></section>
      <form className="pairing-card" onSubmit={event => { event.preventDefault(); void run(() => pair(tokenInput.trim())); }}><div className="card-icon">⌘</div><h2>Connect your local server</h2><p>Paste the pairing token printed by <code>npm start</code>. It stays in this browser tab's session.</p><label>Pairing token<input autoComplete="off" type="password" minLength={32} maxLength={1024} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="Paste local pairing token" autoFocus /></label><button className="primary wide" type="submit" disabled={busy || tokenInput.trim().length < 32 || tokenInput.trim().length > 1024}>Pair server</button><p className="small muted">The Figma plugin uses the same token. Your source document remains unchanged.</p>{error && <div className="error" role="alert">{error}</div>}</form>
    </main> : <>
      <div className="workspace-bar"><div className="breadcrumbs">Workspace <span>/</span> {snapshot?.name ?? 'Get started'} {project && <span className="revision">revision {project.revision}</span>}</div><div className="actions"><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}`)); setNotice('Workspace refreshed from local storage.'); })}>Refresh</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(false))}>Export JSON</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(true))}>Markdown</button></div></div>
      {error && <div className="global-error" role="alert"><strong>Could not complete action.</strong> {error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      <div className="workspace">
        <aside className="sidebar">
          <section className="panel-section"><div className="section-title"><h2>Workspace</h2><span className="mini-label">LOCAL</span></div>
            <label className="sr-only" htmlFor="workspace-select">Open workspace</label><select id="workspace-select" value={project?.id ?? ''} disabled={busy} onChange={e => { const id = e.target.value; if (id) void run(async () => receive(await request<Project>(token, `/api/projects/${id}`), false)); }}><option value="">Choose a workspace</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <form className="create-project" onSubmit={e => { e.preventDefault(); void run(async () => { receive(await request<Project>(token, '/api/projects', { name: newProjectName }), false); setNotice('Workspace created. Capture a Figma selection to begin.'); }); }}><label className="sr-only" htmlFor="project-name">New workspace name</label><input id="project-name" value={newProjectName} maxLength={300} onChange={e => setNewProjectName(e.target.value)} /><button type="submit" disabled={busy || !newProjectName.trim()} aria-label="Create workspace">+</button></form>
            <button className="text-button" disabled={busy} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice('Synthetic demo loaded. This is generated test data, not a live Figma capture.'); })}>Load demo</button>
          </section>
          <section className="panel-section"><div className="section-title"><h2>Source captures</h2><span className="count">{project?.snapshots.length ?? 0}</span></div><p className="small muted">Capture the UI and nearby specifications separately.</p>
            <button className="primary wide" disabled={!project || !connected || busy} onClick={() => void run(async () => { if (!project) return; const next = await request<Project>(token, `/api/projects/${project.id}/capture`, { expectedRevision: project.revision, limits: {} }); receive(next, false); setSnapshotId(next.snapshots[next.snapshots.length - 1]?.id ?? null); setNotice('Selected Figma scope captured and stored locally.'); })}>Capture Figma selection</button>
            {!connected && <p className="small muted">Launch the development plugin and pair it with this server.</p>}
            <div className="snapshot-list">{project?.snapshots.map((s, i) => <button key={s.id} className={`snapshot-item ${snapshot?.id === s.id ? 'active' : ''}`} onClick={() => { setSnapshotId(s.id); setSelectedId(null); setAnnotationDraft(null); setMergeIds([]); }}><span className="snapshot-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{s.name}</strong><small>{s.nodes.length} nodes · {s.completeness.complete ? 'complete scope' : 'partial scope'}</small></span></button>)}</div>
          </section>
          <section className="panel-section components-section"><div className="section-title"><h2>Components</h2><span className="count">{annotations.length}</span></div>
            <div className="component-list">{annotations.map(a => <div className={`component-row ${a.id === selectedId ? 'active' : ''}`} key={a.id} style={{ paddingLeft: 5 + Math.min(ancestorDepth(a), 5) * 10 }}><input type="checkbox" aria-label={`Merge ${a.name}`} checked={mergeIds.includes(a.id)} onChange={e => setMergeIds(current => e.target.checked ? [...current, a.id] : current.filter(id => id !== a.id))} /><button onClick={() => selectAnnotation(a)}><span className={`status-dot ${a.reviewStatus}`} /><span>{a.name}</span></button></div>)}</div>
            {!annotations.length && <p className="empty-hint">Draw your first region on the canvas. Component structure is yours to define.</p>}
            <button className="wide" disabled={!snapshot || busy} onClick={() => { if (snapshot) createAnnotation({ x: snapshot.bounds.x + snapshot.bounds.width * 0.1, y: snapshot.bounds.y + snapshot.bounds.height * 0.1, width: snapshot.bounds.width * 0.3, height: snapshot.bounds.height * 0.2 }); }}>+ Add region</button>
            {mergeIds.length >= 2 && <button className="wide" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'merge_annotations', ids: mergeIds, name: 'Merged component' }, 'Regions merged. Review the component and its specification links.'); setMergeIds([]); })}>Merge {mergeIds.length} selected</button>}
          </section>
          <div className="sidebar-footer"><strong>Human decisions are authoritative.</strong><span>Approved context is available through MCP.</span></div>
        </aside>

        <main className="canvas-column">
          <div className="canvas-heading"><div><div className="eyebrow">VISUAL SOURCE → SEMANTIC REGIONS</div><h1>{snapshot?.name ?? 'Start with a design'}</h1></div><div className="actions"><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/undo`, { expectedRevision: project.revision })); setNotice('Previous edit restored.'); })}>Undo</button><button disabled={!project || busy} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/redo`, { expectedRevision: project.revision })); setNotice('Edit restored.'); })}>Redo</button></div></div>
          {snapshot && (!snapshot.completeness.complete || snapshot.warnings.length > 0) && <details className="scope-warning"><summary>{!snapshot.completeness.complete ? 'Partial capture' : 'Capture notes'} · inspect limitations before approval</summary>{!snapshot.completeness.complete && <p>{snapshot.completeness.reason}</p>}<ul>{snapshot.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          {snapshot ? <Canvas key={snapshot.id} snapshot={snapshot} annotations={annotations} selectedId={selectedId} draft={annotationDraft} onSelect={selectAnnotation} onDraft={setAnnotationDraft} onCreate={createAnnotation} /> : <section className="empty-canvas"><div className="empty-diagram"><span>▤</span><i>→</i><span>▧</span><i>→</i><span>⌘</span></div><h2>Give your design a meaningful structure.</h2><p>Create a workspace and capture one selected Figma frame. You can also explore a generated demo without connecting Figma.</p><button className="primary" disabled={busy} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice('Generated demo loaded.'); })}>Explore synthetic demo</button><p className="small">Capture → mark regions → connect specifications → approve</p></section>}
          <div className="status-bar" role="status"><span className={`status-indicator ${busy ? 'working' : ''}`} />{busy ? 'Working with your local server…' : notice}</div>
        </main>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector"><button role="tab" aria-selected={tab === 'components'} onClick={() => setTab('components')}>Component</button><button role="tab" aria-selected={tab === 'specifications'} onClick={() => setTab('specifications')}>Specifications</button><button role="tab" aria-selected={tab === 'proposals'} onClick={() => setTab('proposals')}>Drafts {pendingProposals.length > 0 && <b>{pendingProposals.length}</b>}</button></div>
          {tab === 'components' && <div className="inspector-content">
            {annotationDraft ? <><div className="section-title"><h2>Region details</h2>{statusBadge(annotationDraft.reviewStatus)}</div>
              {dirtyAnnotation && <p className="unsaved">Unsaved changes · use Save annotation</p>}
              <label>Component name<input aria-label="Component name" value={annotationDraft.name} maxLength={300} onChange={e => patchAnnotation({ name: e.target.value })} /></label>
              <div className="two-fields"><label>Role<select value={annotationDraft.role} onChange={e => patchAnnotation({ role: e.target.value as Annotation['role'] })}>{roles.map(role => <option key={role}>{role}</option>)}</select></label><label>Parent component<select aria-label="Parent component" value={annotationDraft.parentId ?? ''} onChange={e => patchAnnotation({ parentId: e.target.value || null })}><option value="">Top level</option>{annotations.filter(a => a.id !== annotationDraft.id && !descendantOf(a.id, annotationDraft.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
              <div className="section-label">DOCUMENT COORDINATES</div><div className="bbox-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<input aria-label={`Region ${key}`} type="number" step="0.1" min={key === 'width' || key === 'height' ? 0.1 : undefined} value={Math.round(annotationDraft.bbox[key] * 100) / 100} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) patchAnnotation({ bbox: { ...annotationDraft.bbox, [key]: value } }); }} /></label>)}</div>
              <button className="primary wide" disabled={busy || !annotationDraft.name.trim()} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_annotation', annotation: annotationDraft }, 'Annotation saved. Match source nodes, then review it.'); if (next) { const saved = next.annotations.find(a => a.id === annotationDraft.id); if (saved) selectAnnotation(saved); } })}>Save annotation</button>
              <div className="divider" /><div className="section-title"><h2>Source grounding</h2><span className="count">{annotationDraft.sourceRefs.length}</span></div><p className="small muted">Geometry suggests original nodes. It does not decide component meaning.</p>
              <button className="wide" disabled={busy || !selectedSaved || !!dirtyAnnotation} onClick={() => void run(async () => { await mutate({ type: 'match_annotation', id: annotationDraft.id, tolerance: 0.5 }, 'Source matches updated. Inspect references before approval.'); })}>Match source</button>
              <div className="source-references">{annotationDraft.sourceRefs.map(ref => <div key={sourceKey(ref.snapshotId, ref.nodeId)}><code>{ref.nodeId}</code><span>{ref.matchType}{ref.coverage !== undefined ? ` · ${Math.round(ref.coverage * 100)}%` : ''}</span><button className="text-button" disabled={!connected || busy || !project?.snapshots.find(s => s.id === ref.snapshotId)?.source.fileKey} onClick={() => void run(async () => { const source = project?.snapshots.find(s => s.id === ref.snapshotId); if (!source?.source.fileKey) throw new Error('Source file identity is unavailable; cannot safely highlight a node.'); await request(token, '/api/plugin/highlight', { fileKey: source.source.fileKey, pageId: source.source.pageId, nodeIds: [ref.nodeId] }); setNotice('Referenced source node selected in Figma.'); })}>Show in Figma</button></div>)}</div>
              <details><summary>Adjust source references manually</summary><p className="small muted">First 500 nodes of this capture. Changes are saved with the annotation.</p><div className="manual-sources">{snapshot?.nodes.slice(0, 500).map(node => <label className="checkbox" key={node.id}><input type="checkbox" checked={annotationDraft.sourceRefs.some(ref => ref.snapshotId === snapshot.id && ref.nodeId === node.id)} onChange={e => patchAnnotation({ sourceRefs: e.target.checked ? [...annotationDraft.sourceRefs, { snapshotId: snapshot.id, nodeId: node.id, matchType: 'partial' }] : annotationDraft.sourceRefs.filter(ref => ref.nodeId !== node.id || ref.snapshotId !== snapshot.id) })} /><span>{node.name || node.type}<small>{node.id} · {node.type}</small></span></label>)}</div></details>
              <div className="divider" /><div className="section-title"><h2>Human review</h2><span className="mini-label">{annotationDraft.origin}</span></div><p className="small muted">Save changes before approving. Editing an approved region requires review again.</p><div className="two-fields"><button className="approve" disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'approved' }, 'Component approved for implementation context.'); })}>Approve annotation</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'rejected' }, 'Annotation rejected.'); })}>Reject</button></div>
              {annotationDraft.parentId && <p className="small muted">Its parent must also be approved before this component appears in approved exports.</p>}
              <details className="advanced"><summary>Split or remove region</summary><div className="two-fields"><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'horizontal', ratio: 0.5 }, 'Region split into two components. Review their source matches.'); })}>Split horizontally</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'vertical', ratio: 0.5 }, 'Region split into two components. Review their source matches.'); })}>Split vertically</button></div><button className="danger wide" disabled={busy} onClick={() => void run(async () => { if (selectedSaved) await mutate({ type: 'delete_annotation', id: annotationDraft.id }, 'Annotation removed. Undo is available.'); setAnnotationDraft(null); setSelectedId(null); })}>Delete annotation</button></details>
            </> : <div className="inspector-empty"><span>▧</span><h2>Choose a component</h2><p>Select a region or draw one on the canvas to name it, connect source nodes and review its meaning.</p></div>}
          </div>}
          {tab === 'specifications' && <div className="inspector-content">
            <div className="section-title"><h2>Specification graph</h2><span className="count">{project?.specifications.length ?? 0}</span></div><p className="small muted">Keep the original wording. A specification can describe several components.</p>
            <div className="spec-list">{project?.specifications.map(spec => <button key={spec.id} className={specDraft?.id === spec.id ? 'active' : ''} onClick={() => selectSpecification(spec)}><span>{spec.text.slice(0, 75)}{spec.text.length > 75 ? '…' : ''}</span>{statusBadge(spec.reviewStatus)}<small>{spec.relations.length} component links</small></button>)}</div>
            <details open={!specDraft}><summary>Select source text ({textKeys.length})</summary><p className="small muted">Select exact TEXT nodes from any captured scope. Selection order is preserved.</p><div className="text-nodes">{allTexts.map(({ snapshot: source, node, key }) => <label className="checkbox text-node" key={key}><input type="checkbox" checked={textKeys.includes(key)} onChange={() => toggleText(key)} /><span>{node.text}<small>{source.name} · {node.id}</small></span></label>)}</div>{!allTexts.length && <p className="empty-hint">Capture a scope containing specification text first.</p>}</details>
            <button className="wide" disabled={!originalText || busy} onClick={newSpecification}>Create specification</button>
            {specDraft && <><div className="divider" /><div className="section-title"><h2>Original specification</h2>{statusBadge(specDraft.reviewStatus)}</div><pre className="spec-text">{specDraft.text || 'Select at least one nonempty source TEXT node.'}</pre><div className="section-label">LINK TO COMPONENTS</div>
              <div className="relation-list">{project?.annotations.map(annotation => { const relation = specDraft.relations.find(r => r.targetAnnotationId === annotation.id); return <div className="relation" key={annotation.id}><label className="checkbox"><input type="checkbox" checked={!!relation} onChange={e => setSpecDraft({ ...specDraft, relations: e.target.checked ? [...specDraft.relations, { targetAnnotationId: annotation.id, relationType: 'describes', reviewStatus: 'proposed' }] : specDraft.relations.filter(r => r.targetAnnotationId !== annotation.id) })} /><span>{annotation.name}<small>{annotation.reviewStatus}</small></span></label>{relation && <select aria-label={`Relation to ${annotation.name}`} value={relation.relationType} onChange={e => setSpecDraft({ ...specDraft, relations: specDraft.relations.map(r => r.targetAnnotationId === annotation.id ? { ...r, relationType: e.target.value as typeof relation.relationType } : r) })}>{relationTypes.map(type => <option key={type}>{type}</option>)}</select>}</div>; })}</div>
              {!project?.annotations.length && <p className="empty-hint">Create components before adding specification links.</p>}
              <button className="primary wide" disabled={busy || !specDraft.text || !specDraft.sourceRefs.length} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_specification', specification: specDraft }, 'Specification and component links saved for review.'); const saved = next?.specifications.find(s => s.id === specDraft.id); if (saved) selectSpecification(saved); })}>Save specification</button>
              <div className="two-fields"><button className="approve" disabled={busy || !project?.specifications.some(s => s.id === specDraft.id) || JSON.stringify(specDraft) !== JSON.stringify(project?.specifications.find(s => s.id === specDraft.id))} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'approved' }, 'Specification and its component links approved.'); })}>Approve specification</button><button disabled={busy || !project?.specifications.some(s => s.id === specDraft.id)} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'rejected' }, 'Specification rejected.'); })}>Reject</button></div><p className="small muted">Approve target components first. This action reviews the specification and all its links.</p><button className="danger text-button" disabled={busy} onClick={() => void run(async () => { if (project?.specifications.some(s => s.id === specDraft.id)) await mutate({ type: 'delete_specification', id: specDraft.id }, 'Specification removed.'); setSpecDraft(null); setTextKeys([]); })}>Delete specification</button>
            </>}
          </div>}
          {tab === 'proposals' && <div className="inspector-content"><div className="section-title"><h2>Review draft proposals</h2><span className="count">{pendingProposals.length}</span></div><p className="small muted">AI and coding agents can suggest changes. Accepting a draft keeps its content proposed until you review it.</p>
            {pendingProposals.map(proposal => <article className="proposal" key={proposal.id}><strong>{proposal.draft.annotations.length} regions · {proposal.draft.specifications.length} specifications</strong><small>Based on revision {proposal.baseRevision}</small><details><summary>Inspect proposed changes</summary><pre>{JSON.stringify(proposal.draft, null, 2)}</pre></details>{proposal.warnings.map((warning, i) => <p className="small" key={i}>{warning}</p>)}<div className="two-fields"><button className="primary" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'accept' }, 'Draft applied as proposed content. Review each region and specification.'); })}>Accept draft</button><button disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'reject' }, 'Draft rejected.'); })}>Reject draft</button></div></article>)}
            {!pendingProposals.length && <p className="empty-hint">No proposals waiting. The manual workflow is always available.</p>}
            <div className="divider" /><AiDraftPanel token={token} project={project} currentSnapshotId={snapshot?.id ?? null} onGenerated={next => { receive(next); setNotice('Generated draft queued. Inspect it before accepting, then review each proposed record.'); }} />
            <div className="divider" /><h2>Import a structured draft</h2><label>Draft JSON<textarea aria-label="Draft JSON" rows={8} value={proposalJson} onChange={e => setProposalJson(e.target.value)} placeholder={'{"annotations": [], "specifications": []}'} /></label><button className="wide" disabled={!project || !proposalJson.trim() || busy} onClick={() => void run(async () => { if (!project) return; const draft = DraftSchema.parse(JSON.parse(proposalJson)); receive(await request<Project>(token, `/api/projects/${project.id}/proposals`, { expectedRevision: project.revision, draft, warnings: [] })); setProposalJson(''); setNotice('Draft validated and queued for human review.'); })}>Submit draft for review</button><p className="small muted">No external model connection is enabled by importing JSON.</p>
          </div>}
        </aside>
      </div>
    </>}
  </div>;
}
