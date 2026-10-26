import { useLocale } from './i18n.js';
import { message, errorMessage, type UIMessage } from './locale.js';
import { useEffect, useState } from 'react';
import type { Project } from '../src/shared/contracts.js';
import { request } from './api.js';

interface AiStatus {
  enabled: boolean;
  model: string | null;
  endpointOrigin: string | null;
  external: boolean;
  limits: { snapshots: number; nodes: number; textChars: number; requestBytes: number };
}

export function AiDraftPanel({ token, project, currentSnapshotId, onGenerated }: {
  token: string; project: Project | null; currentSnapshotId: string | null; onGenerated(project: Project): void;
}) {
  const { t, renderMessage, formatNumber } = useLocale();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [scopeIds, setScopeIds] = useState<string[]>(currentSnapshotId ? [currentSnapshotId] : []);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UIMessage | null>(null);
  useEffect(() => {
    let active = true;
    void request<AiStatus>(token, '/api/ai/status').then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError(message('Model configuration is unavailable. Manual annotation and draft import remain available.')); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => { setScopeIds(currentSnapshotId ? [currentSnapshotId] : []); setConsent(false); }, [project?.id, currentSnapshotId]);
  async function generate() {
    if (!project || !status?.enabled) return;
    setBusy(true); setError(null);
    try {
      const next = await request<Project>(token, `/api/projects/${encodeURIComponent(project.id)}/generate-draft`, {
        expectedRevision: project.revision, snapshotIds: scopeIds, consentToExternalTransfer: status.external && consent,
      });
      onGenerated(next);
    } catch (cause) { setError(errorMessage(cause, 'Could not generate a draft.')); }
    finally { setBusy(false); setConsent(false); }
  }
  return <section className="ai-panel" aria-label={t("Optional AI draft")}>
    <div className="section-title"><h2>{t("Generate a draft")}</h2><span className="mini-label">{t("OPTIONAL")}</span></div>
    {!status && !error && <p className="small muted">{t("Checking local model configuration…")}</p>}
    {status && !status.enabled && <p className="small muted">{t("AI drafting is not configured. You can annotate manually or paste a draft for review.")}</p>}
    {status?.enabled && <>
      <dl className="provider-details"><div><dt>{t("Destination")}</dt><dd>{status.endpointOrigin}</dd></div><div><dt>{t("Model")}</dt><dd>{status.model}</dd></div></dl>
      <p className="small muted">{t('Select up to two captures. Their images, node details and original text will be processed {destination}.', { destination: t(status.external ? 'by this external provider' : 'at this local model address') })}</p>
      <div className="ai-scopes">{project?.snapshots.map(snapshot => <label className="checkbox" key={snapshot.id}><input type="checkbox" checked={scopeIds.includes(snapshot.id)} disabled={busy || (!scopeIds.includes(snapshot.id) && scopeIds.length >= 2)} onChange={event => {
        setScopeIds(current => event.target.checked ? [...current, snapshot.id] : current.filter(id => id !== snapshot.id)); setConsent(false);
      }} /><span>{snapshot.name}<small>{t('{count} source nodes', { count: formatNumber(snapshot.nodes.length) })}</small></span></label>)}</div>
      <p className="small muted">{t('Up to {nodes} nodes and {megabytes} MB per request. Larger selections are rejected so the original text stays complete.', { nodes: formatNumber(status.limits.nodes), megabytes: formatNumber(status.limits.requestBytes / 1_000_000) })}</p>
      {status.external && <label className="checkbox transfer-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{t('I allow this request to send the selected images and source text to {destination}.', { destination: status.endpointOrigin ?? '' })}</span></label>}
      <button className="wide" disabled={busy || !project || scopeIds.length === 0 || (status.external && !consent)} onClick={() => void generate()}>{busy ? t("Generating draft…") : t("Generate draft for review")}</button>
      <p className="small muted">{t("Generated drafts wait for your review. Applying a draft does not approve it.")}</p>
    </>}
    {error && <p className="error" role="alert">{renderMessage(error)}</p>}
  </section>;
}
