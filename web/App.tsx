import { useLocale, LanguageSelector } from './i18n.js';
import { message, errorMessage, UIError, type UIMessage } from './locale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DraftSchema, ProjectSchema, SourceNodeSchema, SourcePreviewResultSchema, type Annotation, type Operation, type Project, type Rect, type SourceReference, type Specification, type SourceNode } from '../src/shared/contracts.js';
import { CollectionViewSchema } from '../src/shared/structure-collection.js';
import { ApiError, download, request } from './api.js';
import { Canvas } from './Canvas.js';
import { AiDraftPanel } from './AiDraftPanel.js';
import { SourceReviewPanel, type NodePreviewState } from './SourceReviewPanel.js';
import { SourceImportPanel } from './SourceImportPanel.js';
import { ImportSettingsButton } from './ImportSettings.js';
import { SourceTransferPanel } from './SourceTransferPanel.js';
import { EvidenceSourcePanel, EvidenceTextPicker, NodePageSchema, type ChosenEvidenceText } from './EvidenceSourcePanel.js';
import { buildRenderingEvidence } from '../src/core/rendering-evidence.js';
import { completeScope, inlineScope, scopeNodeCount, sourceScopes } from '../src/core/source-scopes.js';
import { z } from 'zod';
import { contains } from '../src/fixture-analysis/index.js';

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
  const { t, systemText, renderMessage, formatNumber } = useLocale();
  const [tokenInput, setTokenInput] = useState(() => sessionStorage.getItem('fsb-token') ?? '');
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<Annotation | null>(null);
  const [specDraft, setSpecDraft] = useState<Specification | null>(null);
  const [textKeys, setTextKeys] = useState<string[]>([]);
  const [externalTexts, setExternalTexts] = useState<ChosenEvidenceText[]>([]);
  const [textHydrating, setTextHydrating] = useState(false);
  const textHydrationAbort = useRef<AbortController | null>(null);
  const specEditorGeneration = useRef(0);
  const [overlayNodes, setOverlayNodes] = useState<{ scopeId: string; nodes: SourceNode[] } | null>(null);
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
  const scopes = project ? sourceScopes(project) : [];
  const scope = scopes.find(value => value.id === snapshotId) ?? scopes[0] ?? null;
  const snapshot = scope && inlineScope(scope) ? scope : null;
  const evidenceScope = scope && !inlineScope(scope) ? scope : null;
  const annotations = project?.annotations.filter(a => a.snapshotId === scope?.id) ?? [];
  const selectedSaved = project?.annotations.find(a => a.id === selectedId);
  const dirtyAnnotation = annotationDraft && JSON.stringify(annotationDraft) !== JSON.stringify(selectedSaved);
  const dirtySpecification = specDraft && JSON.stringify(specDraft) !== JSON.stringify(project?.specifications.find(spec => spec.id === specDraft.id));
  const dirtyCaptureImport = !!dirtyAnnotation || !!dirtySpecification || !!proposalJson.trim() || (!specDraft && textKeys.length > 0);
  const specEditorVersion = specEditorGeneration.current;
  const sourceReview = annotationDraft?.sourceReview;
  const renderingEvidence = useMemo(() => buildRenderingEvidence(snapshot?.nodes ?? [], snapshot?.source.pageId), [snapshot?.nodes, snapshot?.source.pageId]);
  const hasObservedRendering = snapshot?.nodes.some(node => node.rendering !== undefined) ?? false;
  const branchRegionIncomplete = evidenceScope?.kind === 'branch' && !!annotationDraft
    && (!evidenceScope.coverageBounds || !contains(evidenceScope.coverageBounds, annotationDraft.bbox, 0.01));
  const renderingReviewRequired = !!sourceReview?.renderingReviewRequired || !!annotationDraft?.sourceRefs.some(ref => {
    const status = renderingEvidence.get(ref.nodeId)?.status;
    return status === 'hidden' || status === 'transparent' || (hasObservedRendering && status === 'unknown');
  });
  const sourceConfirmationRequired = evidenceScope
    ? !completeScope(evidenceScope) || branchRegionIncomplete || sourceReview?.status !== 'confirmed'
    : !!(sourceReview?.ambiguous || renderingReviewRequired) && sourceReview?.status !== 'confirmed';
  const busyRef = useRef(false);
  const projectMutationLease = useRef<symbol | null>(null);
  const currentView = useRef({ token, project, annotationDraft, snapshotId: scope?.id, pluginSessionId, dirtyCaptureImport });
  useEffect(() => { currentView.current = { token, project, annotationDraft, snapshotId: scope?.id, pluginSessionId, dirtyCaptureImport }; }, [token, project, annotationDraft, scope?.id, pluginSessionId, dirtyCaptureImport]);
  useEffect(() => {
    previewRequestId.current++;
    previewAbort.current?.abort(); previewAbort.current = null;
    setNodePreview(null);
  }, [token, project?.id, project?.revision, scope?.id, annotationDraft?.id, pluginSessionId]);
  const visibleNodePreview = nodePreview && nodePreview.context.projectId === project?.id && nodePreview.context.revision === project.revision
    && nodePreview.context.annotationId === annotationDraft?.id && nodePreview.context.snapshotId === scope?.id
    && nodePreview.context.sessionId === pluginSessionId ? nodePreview.state : null;
  const pendingProposals = project?.proposals.filter(p => p.status === 'pending') ?? [];
  const allTexts = useMemo(() => project?.snapshots.flatMap(s => s.nodes.filter(n => n.type === 'TEXT' && n.text !== undefined).map(n => ({ snapshot: s, node: n, key: sourceKey(s.id, n.id) }))) ?? [], [project]);
  const chosenTexts = textKeys.map(key => {
    const inline = allTexts.find(value => value.key === key);
    return inline ? { scopeId: inline.snapshot.id, nodeId: inline.node.id, text: inline.node.text! }
      : externalTexts.find(value => sourceKey(value.scopeId, value.nodeId) === key);
  }).filter(value => value !== undefined);
  const sourceRefs = chosenTexts.map(value => ({ snapshotId: value.scopeId, nodeId: value.nodeId, matchType: 'exact' as const }));
  const originalText = chosenTexts.map(value => value.text).join('\n\n');
  const textSelectionReady = textKeys.every(key => allTexts.some(value => value.key === key)
    || externalTexts.some(value => sourceKey(value.scopeId, value.nodeId) === key));
  const specSourceReady = !!specDraft && specDraft.sourceRefs.every(ref => {
    const source = scopes.find(value => value.id === ref.snapshotId);
    return !!source && completeScope(source);
  }) && specDraft.relations.length > 0 && specDraft.relations.every(relation => {
    const target = project?.annotations.find(value => value.id === relation.targetAnnotationId);
    const targetScope = scopes.find(value => value.id === target?.snapshotId);
    return !!target && target.reviewStatus === 'approved' && !!targetScope && completeScope(targetScope)
      && (inlineScope(targetScope) || target.sourceReview?.status === 'confirmed');
  });
  useEffect(() => () => textHydrationAbort.current?.abort(), []);

  useEffect(() => {
    setOverlayNodes(null);
    if (!evidenceScope || !completeScope(evidenceScope) || !project || !token) return;
    const controller = new AbortController(), id = evidenceScope.id;
    void request<unknown>(token, `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes/${encodeURIComponent(id)}/nodes`,
      { offset: 0, limit: 200 }, controller.signal).then(value => {
      const page = NodePageSchema.parse(value);
      if (!controller.signal.aborted) setOverlayNodes({ scopeId: id, nodes: page.nodes });
    }).catch(() => {});
    return () => controller.abort();
  }, [token, project?.id, evidenceScope?.id, evidenceScope?.kind]);

  async function listProjects(auth = token) {
    const result = await request<{ projects: ProjectSummary[] }>(auth, '/api/projects');
    setProjects(result.projects);
    return result.projects;
  }
  function receive(next: Project, keepSelection = true) {
    specEditorGeneration.current++;
    currentView.current = { ...currentView.current, project: next };
    setProject(next);
    sessionStorage.setItem('fsb-last-project', next.id);
    const nextScopes = sourceScopes(next);
    setSnapshotId(current => nextScopes.some(value => value.id === current) ? current : nextScopes[0]?.id ?? null);
    if (!keepSelection) { textHydrationAbort.current?.abort(); setTextHydrating(false); setSelectedId(null); setAnnotationDraft(null); setSpecDraft(null); setTextKeys([]); setExternalTexts([]); setMergeIds([]); }
    else {
      const selected = next.annotations.find(a => a.id === selectedId);
      if (selected) setAnnotationDraft(structuredClone(selected));
      else if (selectedId) { setSelectedId(null); setAnnotationDraft(null); }
      if (specDraft) setSpecDraft(next.specifications.find(s => s.id === specDraft.id) ?? null);
    }
    setProjects(current => {
      const summary = { id: next.id, name: next.name, revision: next.revision, updatedAt: next.updatedAt,
        snapshotCount: nextScopes.length, annotationCount: next.annotations.length, specificationCount: next.specifications.length };
      return [summary, ...current.filter(p => p.id !== next.id)];
    });
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    if (previewAbort.current) closeNodePreview();
    busyRef.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(e instanceof ApiError && e.code === 'SOURCE_INCOMPLETE'
      ? message('The source structure is incomplete. Finish bringing it in before matching nodes, confirming sources or approving.')
      : e instanceof ApiError && e.status === 409 ? { parts: [errorMessage(e), message('Refresh the workspace before saving again.')] } : errorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function beginProjectMutation(): (() => void) | null {
    if (busyRef.current || dirtyCaptureImport) return null;
    const lease = Symbol('project mutation');
    projectMutationLease.current = lease;
    busyRef.current = true;
    setBusy(true);
    return () => {
      if (projectMutationLease.current !== lease) return;
      projectMutationLease.current = null;
      busyRef.current = false;
      setBusy(false);
    };
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
    setNotice(message("Connected. Open a workspace or try the sample."));
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
  function selectAnnotation(annotation: Annotation, savedResult = false) {
    if (!savedResult && (busyRef.current || dirtyAnnotation)) return;
    setSelectedId(annotation.id); setAnnotationDraft(structuredClone(annotation)); setSnapshotId(annotation.snapshotId); setTab('components');
  }
  function createAnnotation(bbox: Rect) {
    if (!scope || dirtyCaptureImport) return;
    const annotation: Annotation = { id: uid(), snapshotId: scope.id, name: t('Component {count}', { count: (project?.annotations.length ?? 0) + 1 }),
      role: 'component', bbox, parentId: null, sourceRefs: [], origin: 'human', reviewStatus: 'proposed', revision: 0 };
    selectAnnotation(annotation); setNotice(message("New region drawn. Name it, then save the annotation."));
  }
  function patchAnnotation(patch: Partial<Annotation>) { if (!busyRef.current) setAnnotationDraft(current => current ? { ...current, ...patch } : null); }
  async function reviewSavedBranch(collectionId: string, nodeId: string) {
    if (!project || !token) return;
    const release = beginProjectMutation(); if (!release) return;
    const expected = { token, projectId: project.id };
    setError(null);
    let persisted: Project | null = null;
    try {
      const task = CollectionViewSchema.parse(await request(token, `/api/projects/${encodeURIComponent(project.id)}/collections/${encodeURIComponent(collectionId)}`));
      const imageScope = project.scopes?.find(value => value.kind !== 'branch' &&
        value.source.rootId === (task.partOf?.contextRootId ?? task.source.nodeId) &&
        value.visualObservation?.taskId === task.overviewAcquisitionId);
      persisted = ProjectSchema.parse(await request(token, `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes/branch`, {
        expectedRevision: project.revision, collectionId, nodeId, ...(imageScope ? { contextScopeId: imageScope.id } : {}),
      }));
      const existingIds = new Set(project.scopes?.map(value => value.id));
      const branch = persisted.scopes?.find(value => !existingIds.has(value.id) && value.kind === 'branch' && value.branch?.collectionId === collectionId && value.branch.nodeId === nodeId);
      if (!branch) throw new Error('The saved branch could not be found in the updated workspace.');
      const copiedFrom = selectedSaved?.reviewStatus === 'proposed' && selectedSaved.snapshotId === imageScope?.id ? selectedSaved : null;
      if (copiedFrom) persisted = ProjectSchema.parse(await request(token,
        `/api/projects/${encodeURIComponent(project.id)}/evidence-scopes/${encodeURIComponent(branch.id)}/copy-regions`, {
          expectedRevision: persisted.revision, sourceScopeId: copiedFrom.snapshotId, annotationIds: [copiedFrom.id],
        }));
      if (currentView.current.token !== expected.token || currentView.current.project?.id !== expected.projectId) return;
      receive(persisted, false); setSnapshotId(branch.id);
      const copied = copiedFrom ? persisted.annotations.find(value => value.snapshotId === branch.id && value.name === copiedFrom.name) : null;
      if (copied) { setSelectedId(copied.id); setAnnotationDraft(structuredClone(copied)); setTab('components'); }
      setNotice(message('This part is ready for source review. The full import remains separate, and your original regions are kept.'));
    } catch (cause) {
      if (currentView.current.token === expected.token && currentView.current.project?.id === expected.projectId) {
        if (persisted) receive(persisted);
        setError(errorMessage(cause));
      }
    } finally { release(); }
  }
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
      || (snapshot && !snapshot.nodes.some(n => n.id === result.selected.id))) {
      throw new UIError(message("The selected source could not be matched to this saved capture. Refresh and try again."));
    }
    const duplicate = current.annotationDraft.sourceRefs.some(ref => ref.snapshotId === result.sourceRef.snapshotId && ref.nodeId === result.sourceRef.nodeId);
    setAnnotationDraft(draft => draft?.id === expected.annotationId && draft.snapshotId === expected.snapshotId
      ? { ...draft, sourceRefs: draft.sourceRefs.some(ref => ref.snapshotId === result.sourceRef.snapshotId && ref.nodeId === result.sourceRef.nodeId)
        ? draft.sourceRefs : [...draft.sourceRefs, result.sourceRef] } : draft);
    setNotice(message(duplicate ? 'This Figma source is already in the draft set.' : 'Figma source added to the draft. Save annotation, then confirm sources.'));
  }
  async function showSourceInFigma(nodeId: string) {
    if (!scope?.source.fileKey) throw new UIError(message("The Figma file could not be identified. Open the original file and reconnect the plugin."));
    await request(token, '/api/plugin/highlight', { fileKey: scope.source.fileKey, pageId: scope.source.pageId, nodeIds: [nodeId] });
    setNotice(message("Source node selected in Figma. Inspect it before adding or confirming sources."));
  }
  async function previewSourceNode(nodeId: string) {
    if (busyRef.current || !project || !annotationDraft || !selectedSaved || !scope?.source.fileKey || !pluginSessionId || !connected || !completeScope(scope)) return;
    if (snapshot && !snapshot.nodes.some(node => node.id === nodeId)) return;
    const context: PreviewContext = { projectId: project.id, revision: project.revision, annotationId: annotationDraft.id,
      snapshotId: scope.id, sessionId: pluginSessionId };
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
        || result.result.fileKey !== scope.source.fileKey || result.result.pageId !== scope.source.pageId
        || result.result.node.sourceFileKey !== scope.source.fileKey || result.result.node.sourcePageId !== scope.source.pageId) {
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
    if (!textSelectionReady || !originalText || sourceRefs.length === 0) return;
    specEditorGeneration.current++;
    setSpecDraft({ id: uid(), text: originalText, sourceRefs, relations: [], origin: 'human', reviewStatus: 'proposed', revision: 0 });
    setNotice(message("Choose the components described by this text, then save the specification."));
  }
  function selectSpecification(spec: Specification, sourceProject: Project | null = project, savedResult = false) {
    if (!savedResult && (busyRef.current || dirtySpecification || !specDraft && textKeys.length > 0)) return;
    specEditorGeneration.current++;
    setSpecDraft(structuredClone(spec)); setTextKeys(spec.sourceRefs.map(ref => sourceKey(ref.snapshotId, ref.nodeId))); setTab('specifications');
    textHydrationAbort.current?.abort();
    const external = spec.sourceRefs.filter(ref => !sourceProject?.snapshots.some(snapshot => snapshot.id === ref.snapshotId));
    if (!sourceProject || external.length === 0) { setExternalTexts([]); setTextHydrating(false); return; }
    const controller = new AbortController(); textHydrationAbort.current = controller; setTextHydrating(true); setExternalTexts([]);
    const expected = { id: sourceProject.id, revision: sourceProject.revision };
    void (async () => {
      const byScope = new Map<string, string[]>();
      for (const ref of external) byScope.set(ref.snapshotId, [...(byScope.get(ref.snapshotId) ?? []), ref.nodeId]);
      const loaded = new Map<string, ChosenEvidenceText>();
      for (const [scopeId, ids] of byScope) {
        // Each selected node may contain 50k text characters; stay below the
        // resolve endpoint's 2 MB response budget even for full-length text.
        for (let index = 0; index < ids.length; index += 20) {
          const batch = ids.slice(index, index + 20);
          const result = await request<unknown>(token,
            `/api/projects/${encodeURIComponent(expected.id)}/evidence-scopes/${encodeURIComponent(scopeId)}/resolve`,
            { nodeIds: batch }, controller.signal);
          const parsed = z.object({ nodes: z.array(SourceNodeSchema).max(100), source: z.unknown() }).parse(result);
          for (const node of parsed.nodes) if (node.text !== undefined && batch.includes(node.id))
            loaded.set(sourceKey(scopeId, node.id), { scopeId, nodeId: node.id, name: node.name, text: node.text });
        }
      }
      if (external.some(ref => !loaded.has(sourceKey(ref.snapshotId, ref.nodeId)))) throw new Error('Chosen source text could not be resolved.');
      if (controller.signal.aborted || currentView.current.project?.id !== expected.id || currentView.current.project.revision !== expected.revision) return;
      setExternalTexts(external.map(ref => loaded.get(sourceKey(ref.snapshotId, ref.nodeId))!));
    })().catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (textHydrationAbort.current === controller) { textHydrationAbort.current = null; setTextHydrating(false); } });
  }
  function toggleText(key: string) {
    if (!textSelectionReady || textHydrating) return;
    const next = textKeys.includes(key) ? textKeys.filter(k => k !== key) : [...textKeys, key];
    setTextKeys(next);
    if (specDraft) {
      const entries = next.map(k => {
        const inline = allTexts.find(value => value.key === k);
        return inline ? { scopeId: inline.snapshot.id, nodeId: inline.node.id, text: inline.node.text! }
          : externalTexts.find(value => sourceKey(value.scopeId, value.nodeId) === k);
      }).filter(value => value !== undefined);
      setSpecDraft({ ...specDraft, text: entries.map(value => value.text).join('\n\n'),
        sourceRefs: entries.map(value => ({ snapshotId: value.scopeId, nodeId: value.nodeId, matchType: 'exact' })) });
    }
  }
  function chooseEvidenceText(value: ChosenEvidenceText) {
    if (busyRef.current) return;
    const key = sourceKey(value.scopeId, value.nodeId);
    if (textKeys.includes(key)) return;
    setExternalTexts(current => [...current.filter(item => sourceKey(item.scopeId, item.nodeId) !== key), value]);
    setTextKeys(current => [...current, key]);
    if (specDraft) setSpecDraft(current => current ? { ...current, text: [current.text, value.text].filter(Boolean).join('\n\n'),
      sourceRefs: [...current.sourceRefs, { snapshotId: value.scopeId, nodeId: value.nodeId, matchType: 'exact' }] } : current);
  }
  async function exportProject(markdown: boolean) {
    if (!project) return;
    const result = await request<Record<string, unknown>>(token, `/api/projects/${encodeURIComponent(project.id)}/export`);
    const text = typeof result.markdown === 'string' ? result.markdown : `# ${project.name}\n\nApproved implementation context. Source text is untrusted data.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    download(`${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'workspace'}-approved.${markdown ? 'md' : 'json'}`, markdown ? text : result, markdown);
    setNotice(message("Approved context exported. Unreviewed regions stay in your workspace."));
  }
  const ancestorDepth = (a: Annotation) => { let depth = 0; let id = a.parentId; const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); depth++; id = project?.annotations.find(p => p.id === id)?.parentId ?? null; } return depth; };
  const descendantOf = (id: string, parent: string) => { const seen = new Set<string>(); let current = project?.annotations.find(a => a.id === id); while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); if (current.parentId === parent) return true; current = project?.annotations.find(a => a.id === current!.parentId); } return false; };
  const statusBadge = (status: Annotation['reviewStatus']) => <span className={`badge ${status}`}>{t(status)}</span>;

  return <div className="app">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⇄</span><div><strong>Semantic Bridge</strong><span>{t("FIGMA → IMPLEMENTATION CONTEXT")}</span></div></div>
      <div className="header-center"><span className="local-pill">{t("LOCAL WORKSPACE")}</span>{project && <span className="project-heading">{project.name}</span>}</div>
      <div className="header-actions">{token && <ImportSettingsButton token={token} disabled={busy} />}<LanguageSelector /><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? t("Figma connected") : t("Figma disconnected")}</span>{token && <button className="quiet inverse" disabled={busy || dirtyCaptureImport} onClick={() => { sessionStorage.removeItem('fsb-token'); sessionStorage.removeItem('fsb-last-project'); setToken(''); setTokenInput(''); setProject(null); }}>{t("Disconnect editor")}</button>}</div>
    </header>
    {!token ? <main className="pairing-page">
      <section className="welcome-copy"><div className="eyebrow">{t("HUMAN FIRST. SOURCE GROUNDED.")}</div><h1>{t("Turn a design into")}<br />{t("shared understanding.")}</h1><p>{t("Mark components, link their requirements, and share approved design context with your coding agent.")}</p><div className="workflow-steps"><span><b>01</b> {t("Capture a frame")}</span><span><b>02</b> {t("Annotate & connect")}</span><span><b>03</b> {t("Review & share")}</span></div></section>
      <form className="pairing-card" onSubmit={event => { event.preventDefault(); void run(() => pair(tokenInput.trim())); }}><div className="card-icon">⌘</div><h2>{t("Connect to Semantic Bridge")}</h2><p>{t("Copy the pairing token from the Semantic Bridge desktop app. It is kept only in this browser tab for the current session.")}</p><label>{t("Pairing token")}<input autoComplete="off" type="password" minLength={32} maxLength={1024} value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder={t("Paste your pairing token")} autoFocus /></label><button className="primary wide" type="submit" disabled={busy || tokenInput.trim().length < 32 || tokenInput.trim().length > 1024}>{t("Connect")}</button><p className="small muted">{t("Use the same token in the Figma plugin. Your source design stays unchanged.")}</p>{error && <div className="error" role="alert">{renderMessage(error)}</div>}</form>
    </main> : <>
      <div className="workspace-bar"><div className="breadcrumbs">{t("Workspace")} <span>/</span> {scope?.name ?? t("Get started")} {project && <span className="revision">{t('Saved version {revision}', { revision: project.revision })}</span>}</div><div className="actions"><button disabled={!project || busy || dirtyCaptureImport} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}`)); setNotice(message("Workspace refreshed from local storage.")); })}>{t("Refresh")}</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(false))}>{t("Export JSON")}</button><button disabled={!project || busy} onClick={() => void run(() => exportProject(true))}>{t("Markdown")}</button></div></div>
      {error && <div className="global-error" role="alert"><strong>{t("Could not complete action.")}</strong> {renderMessage(error)}<button aria-label={t("Dismiss error")} onClick={() => setError(null)}>×</button></div>}
      <div className="workspace">
        <aside className="sidebar">
          <section className="panel-section"><div className="section-title"><h2>{t("Workspace")}</h2><span className="mini-label">{t("LOCAL")}</span></div>
            <label className="sr-only" htmlFor="workspace-select">{t("Open workspace")}</label><select id="workspace-select" value={project?.id ?? ''} disabled={busy || dirtyCaptureImport} onChange={e => { const id = e.target.value; if (id) void run(async () => receive(await request<Project>(token, `/api/projects/${id}`), false)); }}><option value="">{t("Choose a workspace")}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <form className="create-project" onSubmit={e => { e.preventDefault(); void run(async () => { receive(await request<Project>(token, '/api/projects', { name: newProjectName ?? t('Untitled workspace') }), false); setNotice(message("Workspace created. Select an area in Figma and bring it in to begin.")); }); }}><label className="sr-only" htmlFor="project-name">{t("New workspace name")}</label><input id="project-name" value={newProjectName ?? t('Untitled workspace')} maxLength={300} onChange={e => setNewProjectName(e.target.value)} /><button type="submit" disabled={busy || dirtyCaptureImport || !(newProjectName ?? t('Untitled workspace')).trim()} aria-label={t("Create workspace")}>+</button></form>
            <button className="text-button" disabled={busy || dirtyCaptureImport} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice(message("Sample workspace loaded. Its designs are generated examples, not your Figma content.")); })}>{t("Load demo")}</button>
          </section>
          <section className="panel-section">{dirtyCaptureImport && <p className="small acquisition-warning">{t('Save your current edits before switching workspaces or sources.')}</p>}<div className="section-title"><h2>{t('Design sources')}</h2><span className="count">{scopes.length}</span></div><p className="small muted">{t('Choose a design source to work on. Images can be used for drafts; approval also requires complete source structure.')}</p>
            <SourceImportPanel token={token} project={project} sessionId={pluginSessionId} connected={connected} busy={busy} dirty={dirtyCaptureImport}
              beginProjectMutation={beginProjectMutation}
              onBound={(next,id,keepSelection) => { receive(next,keepSelection); setSnapshotId(id); }}
              onBranchReady={(collectionId,nodeId) => void reviewSavedBranch(collectionId,nodeId)} />
            <div className="snapshot-list">{scopes.map((value, i) => <button disabled={busy || dirtyCaptureImport} key={value.id} className={`snapshot-item ${scope?.id === value.id ? 'active' : ''}`} onClick={() => { setSnapshotId(value.id); setSelectedId(null); setAnnotationDraft(null); setMergeIds([]); }}><span className="snapshot-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{value.name}</strong><small>{inlineScope(value)
              ? t('{count} nodes · {scope}', { count: formatNumber(value.nodes.length), scope: t(value.completeness.complete ? 'complete' : 'incomplete') })
              : value.kind === 'visual' ? t('Image draft · source structure needed') : value.kind === 'branch'
                ? t('{count} nodes · only this part is complete', { count: formatNumber(scopeNodeCount(value)) })
                : t('{count} nodes · source structure complete', { count: formatNumber(scopeNodeCount(value)) })}</small></span></button>)}</div>

          </section>
          <section className="panel-section"><SourceTransferPanel token={token} project={project} busy={busy} dirty={dirtyCaptureImport}
            beginProjectMutation={beginProjectMutation}
            onImported={next => { receive(next, false); setSnapshotId(next.scopes?.at(-1)?.id ?? next.snapshots[0]?.id ?? null);
              setNotice(message('Source file imported. Add annotations, check the source nodes and confirm them before approval.')); }} /></section>
          <section className="panel-section components-section"><div className="section-title"><h2>{t("Components")}</h2><span className="count">{annotations.length}</span></div>
            <div className="component-list">{annotations.map(a => <div className={`component-row ${a.id === selectedId ? 'active' : ''}`} key={a.id} style={{ paddingLeft: 5 + Math.min(ancestorDepth(a), 5) * 10 }}><input type="checkbox" disabled={busy} aria-label={t('Merge {name}', { name: a.name })} checked={mergeIds.includes(a.id)} onChange={e => setMergeIds(current => e.target.checked ? [...current, a.id] : current.filter(id => id !== a.id))} /><button disabled={busy || !!dirtyAnnotation} onClick={() => selectAnnotation(a)}><span className={`status-dot ${a.reviewStatus}`} /><span>{a.name}</span></button></div>)}</div>
            {!annotations.length && <p className="empty-hint">{t("Draw a region on the canvas and give it a meaningful name.")}</p>}
            <button className="wide" disabled={!scope || busy || dirtyCaptureImport} onClick={() => { if (scope) { const bounds = !inlineScope(scope) && scope.coverageBounds ? scope.coverageBounds : scope.bounds; createAnnotation({ x: bounds.x + bounds.width * 0.1, y: bounds.y + bounds.height * 0.1, width: bounds.width * 0.3, height: bounds.height * 0.2 }); } }}>{t("+ Add region")}</button>
            {mergeIds.length >= 2 && <button className="wide" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'merge_annotations', ids: mergeIds, name: t('Merged component') }, message("Regions merged. Review the component and its specification links.")); setMergeIds([]); })}>{t('Merge {count} selected', { count: mergeIds.length })}</button>}
          </section>
          <div className="sidebar-footer"><strong>{t("You decide what is approved.")}</strong><span>{t("Your coding agent can read approved context through MCP.")}</span></div>
        </aside>

        <main className="canvas-column">
          <div className="canvas-heading"><div><div className="eyebrow">{t("DESIGN → REVIEWED CONTEXT")}</div><h1>{scope?.name ?? t("Start with a design")}</h1></div><div className="actions"><button disabled={!project || busy || dirtyCaptureImport} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/undo`, { expectedRevision: project.revision })); setNotice(message("Previous edit restored.")); })}>{t("Undo")}</button><button disabled={!project || busy || dirtyCaptureImport} onClick={() => void run(async () => { if (project) receive(await request<Project>(token, `/api/projects/${project.id}/redo`, { expectedRevision: project.revision })); setNotice(message("Edit restored.")); })}>{t("Redo")}</button></div></div>
          {snapshot && (!snapshot.completeness.complete || snapshot.warnings.length > 0) && <details className="scope-warning"><summary>{t('{kind} · inspect limitations before approval', { kind: t(!snapshot.completeness.complete ? 'Partial capture' : 'Capture notes') })}</summary>{!snapshot.completeness.complete && <p>{snapshot.completeness.reason ? systemText(snapshot.completeness.reason) : ''}</p>}<ul>{snapshot.warnings.map((warning, i) => <li key={i}>{systemText(warning)}</li>)}</ul></details>}
          {evidenceScope && <div className="scope-warning evidence-scope-warning" role="status"><strong>{t(evidenceScope.kind === 'visual' ? 'Image draft · source structure needed' : evidenceScope.kind === 'branch' ? 'This part is complete · the full import may still be incomplete' : 'Source structure complete · confirm sources before approval')}</strong>
            <p>{t(evidenceScope.kind === 'branch' ? 'This is the saved observation. It has not been checked against the current Figma design.' : 'The image and structure were read at different times. Check that they still describe the same design.')}</p>
            {evidenceScope.warnings.length > 0 && <details><summary>{t('Source notes')}</summary><ul>{evidenceScope.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{systemText(warning)}</li>)}</ul></details>}</div>}
          {scope ? <Canvas key={scope.id} scope={scope} fetchedNodes={overlayNodes?.scopeId === scope.id ? overlayNodes.nodes : []}
            annotations={annotations} selectedId={selectedId} draft={annotationDraft} onSelect={annotation => { if (!busyRef.current) selectAnnotation(annotation); }} onDraft={annotation => { if (!busyRef.current) setAnnotationDraft(annotation); }} onCreate={bbox => { if (!busyRef.current) createAnnotation(bbox); }} /> : <section className="empty-canvas"><div className="empty-diagram"><span>▤</span><i>→</i><span>▧</span><i>→</i><span>⌘</span></div><h2>{t("Give your design a meaningful structure.")}</h2><p>{t("Create a workspace and bring in a selected Figma frame. Or explore the sample workspace without connecting Figma.")}</p><button className="primary" disabled={busy || dirtyCaptureImport} onClick={() => void run(async () => { receive(await request<Project>(token, '/api/demo', {}), false); setNotice(message("Generated demo loaded.")); })}>{t("Explore sample workspace")}</button><p className="small">{t("Capture → mark regions → connect specifications → approve")}</p></section>}
          <div className="status-bar" role="status"><span className={`status-indicator ${busy ? 'working' : ''}`} />{busy ? t('Working…') : renderMessage(notice)}</div>
        </main>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist" aria-label={t("Inspector")}><button role="tab" aria-selected={tab === 'components'} onClick={() => setTab('components')}>{t("Component")}</button><button role="tab" aria-selected={tab === 'specifications'} onClick={() => setTab('specifications')}>{t("Specifications")}</button><button role="tab" aria-selected={tab === 'proposals'} onClick={() => setTab('proposals')}>{t("Drafts")} {pendingProposals.length > 0 && <b>{pendingProposals.length}</b>}</button></div>
          {tab === 'components' && <div className="inspector-content">
            {annotationDraft ? <><div className="section-title"><h2>{t("Region details")}</h2>{statusBadge(annotationDraft.reviewStatus)}</div>
              {dirtyAnnotation && <div className="unsaved"><p>{t("Unsaved changes · use Save annotation")}</p>
                <button className="text-button" disabled={busy} onClick={() => { setAnnotationDraft(selectedSaved ? structuredClone(selectedSaved) : null); if (!selectedSaved) setSelectedId(null); }}>{t('Discard annotation changes')}</button></div>}
              <label>{t("Component name")}<input disabled={busy} aria-label={t("Component name")} value={annotationDraft.name} maxLength={300} onChange={e => patchAnnotation({ name: e.target.value })} /></label>
              <div className="two-fields"><label>{t("Role")}<select disabled={busy} aria-label={t('Role')} value={annotationDraft.role} onChange={e => patchAnnotation({ role: e.target.value as Annotation['role'] })}>{roles.map(role => <option key={role} value={role}>{t(role)}</option>)}</select></label><label>{t("Parent component")}<select disabled={busy} aria-label={t("Parent component")} value={annotationDraft.parentId ?? ''} onChange={e => patchAnnotation({ parentId: e.target.value || null })}><option value="">{t("Top level")}</option>{annotations.filter(a => a.id !== annotationDraft.id && !descendantOf(a.id, annotationDraft.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
              <div className="section-label">{t("DOCUMENT COORDINATES")}</div><div className="bbox-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{t(key)}<input disabled={busy} aria-label={t(`Region ${key}`)} type="number" step="0.1" min={key === 'width' || key === 'height' ? 0.1 : undefined} value={Math.round(annotationDraft.bbox[key] * 100) / 100} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) patchAnnotation({ bbox: { ...annotationDraft.bbox, [key]: value } }); }} /></label>)}</div>
              <button className="primary wide" disabled={busy || !annotationDraft.name.trim()} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_annotation', annotation: annotationDraft }, message("Annotation saved. Match source nodes, then review it.")); if (next) { const saved = next.annotations.find(a => a.id === annotationDraft.id); if (saved) selectAnnotation(saved, true); } })}>{t("Save annotation")}</button>
              <div className="divider" />
              {snapshot && <SourceReviewPanel key={`${project?.id}:${annotationDraft.id}:${snapshot.id}`} annotation={annotationDraft} snapshot={snapshot}
                renderingEvidence={renderingEvidence} renderingReviewRequired={renderingReviewRequired}
                nodePreview={visibleNodePreview} onPreviewNode={nodeId => void previewSourceNode(nodeId)} onCloseNodePreview={closeNodePreview}
                saved={!!selectedSaved} dirty={!!dirtyAnnotation} busy={busy} connected={connected} sessionId={pluginSessionId}
                onMatch={() => void run(async () => { await mutate({ type: 'match_annotation', id: annotationDraft.id, tolerance: 0.5 }, message("Source matches updated. Check the selected nodes before approval.")); })}
                onAddCurrent={() => void run(addCurrentFigmaSelection)}
                onReferencesChange={refs => patchAnnotation({ sourceRefs: refs })}
                onShowInFigma={nodeId => void run(() => showSourceInFigma(nodeId))}
                onConfirm={() => void run(async () => { if (selectedSaved) await mutate({ type: 'confirm_annotation_sources', id: selectedSaved.id, expectedAnnotationRevision: selectedSaved.revision }, message("Sources confirmed. Review the annotation meaning before approval.")); })} />}
              {evidenceScope && project && <EvidenceSourcePanel key={`${project.id}:${annotationDraft.id}:${evidenceScope.id}`} token={token} projectId={project.id}
                scope={evidenceScope} annotation={annotationDraft} nodePreview={visibleNodePreview} saved={!!selectedSaved} dirty={!!dirtyAnnotation}
                busy={busy} connected={connected} sessionId={pluginSessionId}
                onMatch={() => void run(async () => { await mutate({ type: 'match_annotation', id: annotationDraft.id, tolerance: 0.5 }, message("Source matches updated. Check the selected nodes before approval.")); })}
                onAddCurrent={() => void run(addCurrentFigmaSelection)} onReferencesChange={refs => patchAnnotation({ sourceRefs: refs })}
                onShowInFigma={nodeId => void run(() => showSourceInFigma(nodeId))} onPreviewNode={nodeId => void previewSourceNode(nodeId)} onCloseNodePreview={closeNodePreview}
                onConfirm={() => void run(async () => { if (selectedSaved) await mutate({ type: 'confirm_annotation_sources', id: selectedSaved.id, expectedAnnotationRevision: selectedSaved.revision }, message("Sources confirmed. Review the annotation meaning before approval.")); })} />}
              <div className="divider" /><div className="section-title"><h2>{t("Human review")}</h2><span className="mini-label">{t(annotationDraft.origin)}</span></div><p className="small muted">{t("Save changes before approving. Editing an approved region requires review again.")}</p><div className="two-fields"><button className="approve" disabled={!selectedSaved || !!dirtyAnnotation || busy || sourceConfirmationRequired} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'approved' }, message("Annotation approved for your coding agent.")); })}>{t("Approve annotation")}</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'review_annotation', id: annotationDraft.id, status: 'rejected' }, message("Annotation rejected.")); })}>{t("Reject")}</button></div>
              {branchRegionIncomplete && <p className="small evidence-warning">{t('This region extends beyond the prepared source part. Acquire its full required source before confirming or approving it.')}</p>}
              {evidenceScope?.kind === 'visual' && <p className="small evidence-warning">{t('Regions on an image draft cannot be approved until complete source structure is attached and a person confirms the source nodes.')}</p>}
              {annotationDraft.parentId && <p className="small muted">{t("Its parent must also be approved before this component appears in approved exports.")}</p>}
              <details className="advanced"><summary>{t("Split or remove region")}</summary><div className="two-fields"><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'horizontal', ratio: 0.5 }, message("Region split into two components. Review their source matches.")); })}>{t("Split horizontally")}</button><button disabled={!selectedSaved || !!dirtyAnnotation || busy} onClick={() => void run(async () => { await mutate({ type: 'split_annotation', id: annotationDraft.id, axis: 'vertical', ratio: 0.5 }, message("Region split into two components. Review their source matches.")); })}>{t("Split vertically")}</button></div><button className="danger wide" disabled={busy} onClick={() => void run(async () => { if (selectedSaved) await mutate({ type: 'delete_annotation', id: annotationDraft.id }, message("Annotation removed. Undo is available.")); setAnnotationDraft(null); setSelectedId(null); })}>{t("Delete annotation")}</button></details>
            </> : <div className="inspector-empty"><span>▧</span><h2>{t("Choose a component")}</h2><p>{t("Select a region or draw one on the canvas to name it, connect source nodes and review its meaning.")}</p></div>}
          </div>}
          {tab === 'specifications' && <div className="inspector-content">
            <div className="section-title"><h2>{t("Specification graph")}</h2><span className="count">{project?.specifications.length ?? 0}</span></div><p className="small muted">{t("Use the original requirements text and link it to one or more components.")}</p>
            <div className="spec-list">{project?.specifications.map(spec => <button disabled={busy || !!dirtySpecification || !specDraft && textKeys.length > 0} key={spec.id} className={specDraft?.id === spec.id ? 'active' : ''} onClick={() => selectSpecification(spec)}><span>{spec.text.slice(0, 75)}{spec.text.length > 75 ? '…' : ''}</span>{statusBadge(spec.reviewStatus)}<small>{t('{count} component links', { count: spec.relations.length })}</small></button>)}</div>
            <details open={!specDraft}><summary>{t('Select source text ({count})', { count: textKeys.length })}</summary><p className="small muted">{t("Choose original text from your saved sources. It is combined in the order you select it.")}</p>{textHydrating && <p role="status" className="small muted">{t('Loading chosen source text…')}</p>}
              <div className="text-nodes">{allTexts.map(({ snapshot: source, node, key }) => <label className="checkbox text-node" key={key}><input disabled={busy || textHydrating || !textSelectionReady} type="checkbox" checked={textKeys.includes(key)} onChange={() => toggleText(key)} /><span>{node.text}<small>{source.name} · {node.id}</small></span></label>)}
              {externalTexts.filter(value => textKeys.includes(sourceKey(value.scopeId, value.nodeId))).map(value => <label className="checkbox text-node" key={sourceKey(value.scopeId, value.nodeId)}><input disabled={busy || textHydrating || !textSelectionReady} type="checkbox" checked onChange={() => toggleText(sourceKey(value.scopeId, value.nodeId))} /><span>{value.text}<small>{value.name} · {value.nodeId}</small></span></label>)}</div>{!allTexts.length && !project?.scopes?.some(value => completeScope(value)) && <p className="empty-hint">{t("Capture a scope containing specification text first.")}</p>}
              {evidenceScope && completeScope(evidenceScope) && project && <EvidenceTextPicker key={`${project.id}:${project.revision}:${evidenceScope.id}:${specEditorVersion}`} token={token} projectId={project.id}
                scope={evidenceScope} selected={new Set(textKeys)} busy={busy || textHydrating || !textSelectionReady}
                onPick={value => { if (specEditorGeneration.current === specEditorVersion) chooseEvidenceText(value); }} />}</details>
            <button className="wide" disabled={!originalText || !textSelectionReady || busy} onClick={newSpecification}>{t("Create specification")}</button>
            {specDraft && <><div className="divider" /><div className="section-title"><h2>{t("Original specification")}</h2>{statusBadge(specDraft.reviewStatus)}</div>{dirtySpecification && <div className="unsaved"><p>{t('Save or discard these specification changes before switching.')}</p><button className="text-button" disabled={busy} onClick={() => {
                const saved = project?.specifications.find(value => value.id === specDraft.id);
                if (saved) selectSpecification(saved, project, true);
                else { specEditorGeneration.current++; textHydrationAbort.current?.abort(); setTextHydrating(false); setSpecDraft(null); setTextKeys([]); setExternalTexts([]); }
              }}>{t('Discard specification changes')}</button></div>}<pre className="spec-text">{specDraft.text || t("Choose at least one source text with content.")}</pre><div className="section-label">{t("LINK TO COMPONENTS")}</div>
              <div className="relation-list">{project?.annotations.map(annotation => { const relation = specDraft.relations.find(r => r.targetAnnotationId === annotation.id); return <div className="relation" key={annotation.id}><label className="checkbox"><input disabled={busy} type="checkbox" checked={!!relation} onChange={e => setSpecDraft({ ...specDraft, relations: e.target.checked ? [...specDraft.relations, { targetAnnotationId: annotation.id, relationType: 'describes', reviewStatus: 'proposed' }] : specDraft.relations.filter(r => r.targetAnnotationId !== annotation.id) })} /><span>{annotation.name}<small>{t(annotation.reviewStatus)}</small></span></label>{relation && <select disabled={busy} aria-label={t('Relation to {name}', { name: annotation.name })} value={relation.relationType} onChange={e => setSpecDraft({ ...specDraft, relations: specDraft.relations.map(r => r.targetAnnotationId === annotation.id ? { ...r, relationType: e.target.value as typeof relation.relationType } : r) })}>{relationTypes.map(type => <option key={type} value={type}>{t(type)}</option>)}</select>}</div>; })}</div>
              {!project?.annotations.length && <p className="empty-hint">{t("Create components before adding specification links.")}</p>}
              <button className="primary wide" disabled={busy || textHydrating || !textSelectionReady || !specDraft.text || !specDraft.sourceRefs.length} onClick={() => void run(async () => { const next = await mutate({ type: 'upsert_specification', specification: specDraft }, message("Specification and component links saved for review.")); const saved = next?.specifications.find(s => s.id === specDraft.id); if (saved) selectSpecification(saved, next, true); })}>{t("Save specification")}</button>
              <div className="two-fields"><button className="approve" disabled={busy || textHydrating || !specSourceReady || !project?.specifications.some(s => s.id === specDraft.id) || JSON.stringify(specDraft) !== JSON.stringify(project?.specifications.find(s => s.id === specDraft.id))} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'approved' }, message("Specification and its component links approved.")); })}>{t("Approve specification")}</button><button disabled={busy || !project?.specifications.some(s => s.id === specDraft.id)} onClick={() => void run(async () => { await mutate({ type: 'review_specification', id: specDraft.id, status: 'rejected' }, message("Specification rejected.")); })}>{t("Reject")}</button></div><p className="small muted">{t("Approve target components first. This action reviews the specification and all its links.")}</p>{!specSourceReady && <p className="small evidence-warning">{t('To approve a specification, complete its source structure and approve the linked regions after confirming their sources.')}</p>}<button className="danger text-button" disabled={busy} onClick={() => void run(async () => { if (project?.specifications.some(s => s.id === specDraft.id)) await mutate({ type: 'delete_specification', id: specDraft.id }, message("Specification removed.")); setSpecDraft(null); setTextKeys([]); })}>{t("Delete specification")}</button>
            </>}
          </div>}
          {tab === 'proposals' && <div className="inspector-content"><div className="section-title"><h2>{t("Review draft proposals")}</h2><span className="count">{pendingProposals.length}</span></div><p className="small muted">{t("AI and coding agents can suggest changes. Accepting a draft keeps its content proposed until you review it.")}</p>
            {pendingProposals.map(proposal => <article className="proposal" key={proposal.id}><strong>{t('{regions} regions · {specifications} specifications', { regions: proposal.draft.annotations.length, specifications: proposal.draft.specifications.length })}</strong><small>{t('Based on saved version {revision}', { revision: proposal.baseRevision })}</small><details><summary>{t("Inspect proposed changes")}</summary><pre>{JSON.stringify(proposal.draft, null, 2)}</pre></details>{proposal.warnings.map((warning, i) => <p className="small" key={i}>{systemText(warning)}</p>)}<div className="two-fields"><button className="primary" disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'accept' }, message("Draft applied. Review each region and specification before approval.")); })}>{t("Accept draft")}</button><button disabled={busy} onClick={() => void run(async () => { await mutate({ type: 'resolve_proposal', id: proposal.id, decision: 'reject' }, message("Draft rejected.")); })}>{t("Reject draft")}</button></div></article>)}
            {!pendingProposals.length && <p className="empty-hint">{t("No proposals waiting. The manual workflow is always available.")}</p>}
            <div className="divider" /><AiDraftPanel token={token} project={project} currentSnapshotId={snapshot?.id ?? null} onGenerated={next => {
              if (currentView.current.token !== token || currentView.current.project?.id !== next.id || busyRef.current) return;
              receive(next); setNotice(message("Draft ready. Check it before applying, then review each annotation and specification."));
            }} />
            <div className="divider" /><h2>{t("Import a structured draft")}</h2><label>{t("Draft JSON")}<textarea disabled={busy} aria-label={t("Draft JSON")} rows={8} value={proposalJson} onChange={e => setProposalJson(e.target.value)} placeholder={'{"annotations": [], "specifications": []}'} /></label><button className="wide" disabled={!project || !proposalJson.trim() || busy} onClick={() => void run(async () => { if (!project) return; const draft = DraftSchema.parse(JSON.parse(proposalJson)); receive(await request<Project>(token, `/api/projects/${project.id}/proposals`, { expectedRevision: project.revision, draft, warnings: [] })); setProposalJson(''); setNotice(message("Draft added for review. Check it before applying.")); })}>{t("Submit draft for review")}</button><p className="small muted">{t("No external model connection is enabled by importing JSON.")}</p>
          </div>}
        </aside>
      </div>
    </>}
  </div>;
}
