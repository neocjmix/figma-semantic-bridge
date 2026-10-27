import { useEffect, useId, useRef, useState } from 'react';
import type { Project } from '../src/shared/contracts.js';
import { request, download } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, type UIMessage } from './locale.js';
import { z } from 'zod';

const ExportSchema = z.object({ projectId: z.string(), name: z.string(), revision: z.number().int().nonnegative(),
  annotations: z.array(z.unknown()), specifications: z.array(z.unknown()), truncated: z.boolean(), markdown: z.string().optional() }).passthrough();
type ExportResult = z.infer<typeof ExportSchema>;

export function SharePanel({ token, project, onClose }: { token: string; project: Project; onClose(): void }) {
  const { t, renderMessage } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [result, setResult] = useState<ExportResult | null>(null), [error, setError] = useState<UIMessage | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setError(null);
    void request<unknown>(token, `/api/projects/${encodeURIComponent(project.id)}/export`, undefined, controller.signal)
      .then(value => { const parsed = ExportSchema.parse(value); if (parsed.projectId !== project.id) throw new Error('Export workspace identity differs from the requested workspace.');
        if (!controller.signal.aborted) setResult(parsed); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [token, project.id, project.revision, attempt]);
  function save(markdown: boolean) {
    if (!result) return;
    const name = `${result.name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'workspace'}-approved`;
    const text = result.markdown ?? `# ${result.name}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`;
    download(`${name}.${markdown ? 'md' : 'json'}`, markdown ? text : result, markdown);
  }
  const comparable = result && result.revision === project.revision && !result.truncated;
  const remainingRegions = comparable ? Math.max(0, project.annotations.length - result.annotations.length) : 0;
  const remainingSpecs = comparable ? Math.max(0, project.specifications.length - result.specifications.length) : 0;
  return <dialog ref={dialog} className="workflow-dialog" aria-labelledby={titleId} onClose={onClose}>
    <div className="section-title"><h2 id={titleId}>{t('Share approved work')}</h2><button autoFocus onClick={() => dialog.current?.close()}>{t('Close')}</button></div>
    <p className="small muted">{result?.name ?? project.name} · {t('Saved version {revision}', { revision: result?.revision ?? project.revision })}</p>
    {!result && !error && <p role="status">{t('Preparing your approved work…')}</p>}
    {error && <><p role="alert" className="error">{renderMessage(error)}</p><button onClick={() => setAttempt(value => value + 1)}>{t('Try again')}</button></>}
    {result && <>
      <p className="share-count">{result.annotations.length ? t('{regions} regions and {specifications} specifications are ready to share.', {
        regions: result.annotations.length, specifications: result.specifications.length,
      }) : t('Approve a region to start sharing.')}</p>
      {remainingRegions > 0 && <p className="small muted">{t('{count} regions still need review or an approved parent.', { count: remainingRegions })}</p>}
      {remainingSpecs > 0 && <p className="small muted">{t('{count} specifications still need review or approved links.', { count: remainingSpecs })}</p>}
      {result.truncated && <p className="evidence-warning">{t('This file contains part of the approved work because of the export size limit. Use MCP to read the remaining components individually.')}</p>}
      <h3>{t('For a file')}</h3><p className="small muted">{t('JSON preserves structured context. Markdown is easy to read and attach to a task.')}</p>
      <div className="two-fields"><button className="primary" disabled={!result.annotations.length} onClick={() => save(false)}>{t('Export JSON')}</button><button disabled={!result.annotations.length} onClick={() => save(true)}>{t('Markdown')}</button></div>
      <h3>{t('For a coding agent')}</h3><p className="small">{t('Keep this app open. Choose Bridge → Copy MCP Configuration and add it to your agent. Ask it to read this workspace’s approved context.')}</p>
    </>}
  </dialog>;
}
