import { useEffect, useRef, useState } from 'react';
import { ProjectSchema, type Project } from '../src/shared/contracts.js';
import { SOURCE_TRANSFER_MAX_BYTES } from '../src/shared/source-transfer.js';
import { ApiError } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, message, type UIMessage } from './locale.js';

type Action = 'export' | 'import';

async function responseError(response: Response): Promise<ApiError> {
  const value: unknown = await response.json().catch(() => null);
  const detail = value && typeof value === 'object' && 'error' in value ? value.error : null;
  const code = detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string'
    ? detail.code : 'REQUEST_FAILED';
  const description = detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
    ? detail.message : `Request failed (${response.status})`;
  return new ApiError(code, description, response.status);
}

function fileBase(value: string): string { return value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'figma-source'; }

export function SourceTransferPanel({ token, project, busy, dirty, beginProjectMutation, onImported }: {
  token: string; project: Project | null; busy: boolean; dirty: boolean;
  beginProjectMutation(): (() => void) | null; onImported(next: Project): void;
}) {
  const { t, renderMessage, formatNumber } = useLocale();
  const complete = project?.scopes?.filter(scope => scope.kind === 'collection' && scope.collection) ?? [];
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const selected = complete.find(scope => scope.id === preferredId) ?? complete[0] ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<UIMessage | null>(null);
  const [notice, setNotice] = useState<UIMessage | null>(null);
  const pending = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const active = useRef(false);
  const context = useRef({ token, projectId: project?.id ?? null, revision: project?.revision ?? null });
  context.current = { token, projectId: project?.id ?? null, revision: project?.revision ?? null };
  useEffect(() => () => pending.current?.abort(), [token, project?.id, project?.revision]);
  useEffect(() => { setPreferredId(null); setFile(null); setError(null); setNotice(null); setBytes(0); }, [project?.id]);

  async function exportScope() {
    if (!project || !selected || action || active.current || busy) return;
    const expected = { ...context.current }, controller = new AbortController();
    active.current = true; pending.current = controller; setAction('export'); setBytes(0); setError(null); setNotice(null);
    const currentOperation = () => pending.current === controller && context.current.token === expected.token
      && context.current.projectId === expected.projectId && context.current.revision === expected.revision;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/source-transfer/${encodeURIComponent(selected.id)}?expectedRevision=${project.revision}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response);
      if (!response.body) throw new Error('Streaming download is unavailable in this browser.');
      const reader = response.body.getReader(), chunks: ArrayBuffer[] = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > SOURCE_TRANSFER_MAX_BYTES) { await reader.cancel(); throw new Error('Source transfer exceeded the 80 MB limit.'); }
        const copy = new Uint8Array(part.value.byteLength);
        copy.set(part.value); chunks.push(copy.buffer); if (currentOperation()) setBytes(total);
      }
      if (!total) throw new Error('Source transfer was empty.');
      if (controller.signal.aborted || !currentOperation()) return;
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/x-ndjson' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `${fileBase(project.name)}-${fileBase(selected.name)}-source.ndjson`;
      try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setNotice(message('Source file downloaded. Share its design images and original text only with permission.'));
    } catch (cause) {
      if (!controller.signal.aborted && currentOperation()) setError(errorMessage(cause));
    } finally {
      if (pending.current === controller) { pending.current = null; active.current = false; setAction(null); }
    }
  }

  async function importFile() {
    if (!project || !file || !file.size || file.size > SOURCE_TRANSFER_MAX_BYTES || action || active.current || busy || dirty) return;
    const releaseEditor = beginProjectMutation();
    if (!releaseEditor) return;
    const expected = { ...context.current }, controller = new AbortController();
    active.current = true; pending.current = controller; setAction('import'); setBytes(0); setError(null); setNotice(null);
    const currentOperation = () => pending.current === controller && context.current.token === expected.token
      && context.current.projectId === expected.projectId && context.current.revision === expected.revision;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/source-transfer?expectedRevision=${project.revision}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
        body: file, signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response);
      const next = ProjectSchema.parse(await response.json());
      if (controller.signal.aborted || !currentOperation()) return;
      if (context.current.revision !== expected.revision) {
        setError(message('The workspace changed during import. Refresh it to find the imported sources.'));
        return;
      }
      onImported(next); setFile(null); if (fileInput.current) fileInput.current.value = '';
      setNotice(message('Source file imported. Add annotations, check the source nodes and confirm them before approval.'));
    } catch (cause) {
      if (!controller.signal.aborted && currentOperation()) setError(errorMessage(cause));
    } finally {
      if (pending.current === controller) { pending.current = null; active.current = false; setAction(null); }
      releaseEditor();
    }
  }

  return <details className="source-transfer-panel">
    <summary>{t('Source files')}</summary>
    <p className="small muted">{t('Share complete source structure, original text and any overview image in one file. Annotations, specifications and approvals are not included.')}</p>
    <p className="small source-transfer-warning">{t('The file can contain sensitive design images and original text. Keep it in an appropriate local location and share it only with permission.')}</p>
    <p className="small muted">{t('Files can be up to 80 MB. No Figma connection is needed. The file is checked for damage and completeness before adding its sources to this workspace for review.')}</p>
    {complete.length > 0 && <label>{t('Source structure to share')}<select value={selected?.id ?? ''} disabled={!!action || busy}
      onChange={event => setPreferredId(event.target.value)}>{complete.map(scope => <option key={scope.id} value={scope.id}>{scope.name} · {formatNumber(scope.collection!.nodeCount)} {t('nodes')}</option>)}</select></label>}
    {!complete.length && <p className="small muted">{t('Complete a source collection and add it to your workspace before downloading a source file.')}</p>}
    <button className="wide" disabled={!selected || !!action || busy} onClick={() => void exportScope()}>{t('Download source file')}</button>
    {action === 'export' && <><p role="status" className="small muted">{t('Downloaded {bytes} bytes of at most 80 MB', { bytes: formatNumber(bytes) })}</p>
      <progress aria-label={t('Source download progress')} /><button className="text-button" onClick={() => pending.current?.abort()}>{t('Stop download')}</button></>}
    <form onSubmit={event => { event.preventDefault(); void importFile(); }}>
      <label>{t('Source file (.ndjson)')}<input ref={fileInput} type="file" accept=".ndjson,application/x-ndjson,text/plain" disabled={!!action || busy}
        onChange={event => { const value = event.target.files?.[0] ?? null; setNotice(null);
          if (value && (!value.size || value.size > SOURCE_TRANSFER_MAX_BYTES)) {
            setFile(null); event.target.value = ''; setError(message('Choose a source file of 80 MB or less. Empty files cannot be imported.'));
          } else { setFile(value); setError(null); }
        }} /></label>
      {file && <p className="small muted">{t('Selected file: {name} · {bytes} bytes', { name: file.name, bytes: formatNumber(file.size) })}</p>}
      {dirty && <p className="small source-transfer-warning">{t('Save your changes before importing a source file.')}</p>}
      {action === 'import' && <><progress aria-label={t('Source file import progress')} />
        <p role="status" className="small muted">{t('Checking and importing the file on this computer. Please wait for confirmation.')}</p>
        <button className="text-button" type="button" onClick={() => {
          pending.current?.abort();
          setNotice(message('Import stopped. The sources may already have been saved; refresh this workspace to check.'));
        }}>{t('Stop import')}</button></>}
      <button className="wide" disabled={!project || !file || !!action || busy || dirty} type="submit">{t('Import source file')}</button>
    </form>
    {error && <p className="small error" role="alert">{renderMessage(error)}</p>}
    {notice && <p className="small" role="status">{renderMessage(notice)}</p>}
  </details>;
}
