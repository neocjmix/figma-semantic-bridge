import { useLocale } from './i18n.js';
import { message, type UIMessage } from './locale.js';
import { useState } from 'react';
import { CAPTURE_BUNDLE_MAX_BYTES, CAPTURE_BUNDLE_MAX_SNAPSHOTS } from '../src/shared/capture-bundle.js';
import type { Project } from '../src/shared/contracts.js';

export function CaptureBundlePanel({ project, currentSnapshotId, busy, dirty, onExport, onImport }: {
  project: Project | null; currentSnapshotId: string | null; busy: boolean; dirty: boolean;
  onExport(snapshotIds: string[]): void;
  onImport(file: File, name: string): void;
}) {
  const { t, renderMessage, formatNumber } = useLocale();
  const [selectedIds, setSelectedIds] = useState<string[]>(currentSnapshotId ? [currentSnapshotId] : []);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<UIMessage | null>(null);
  const displayName = name ?? t('Imported captures');
  const snapshotIds = selectedIds.filter(id => project?.snapshots.some(snapshot => snapshot.id === id));

  return <details className="capture-transfer">
    <summary>{t("Capture transfer")}</summary>
    <section aria-label={t("Capture transfer")}>
      <p className="small muted">{t("Includes source images and original text. Annotations and approvals are not transferred. Source contents are unverified and require human review.")}</p>
      <p className="small muted">{t("Choose one or two captures to download. No Figma connection is needed.")}</p>
      <div className="capture-transfer-scopes">{project?.snapshots.map(snapshot => <label className="checkbox" key={snapshot.id}>
        <input type="checkbox" aria-label={t('Export capture {name}', { name: snapshot.name })} checked={snapshotIds.includes(snapshot.id)}
          disabled={busy || (!snapshotIds.includes(snapshot.id) && snapshotIds.length >= CAPTURE_BUNDLE_MAX_SNAPSHOTS)}
          onChange={event => setSelectedIds(current => event.target.checked ? [...current, snapshot.id] : current.filter(id => id !== snapshot.id))} />
        <span>{snapshot.name}<small>{t('{count} nodes · {scope}', { count: formatNumber(snapshot.nodes.length), scope: t(snapshot.completeness.complete ? 'complete scope' : 'partial scope') })}</small></span>
      </label>)}</div>
      <button className="wide" disabled={busy || snapshotIds.length === 0} onClick={() => onExport(snapshotIds)}>{t("Export captures")}</button>
      <form onSubmit={event => { event.preventDefault(); if (file && !busy && !dirty && displayName.trim()) onImport(file, displayName.trim()); }}>
        <label>{t("Capture bundle JSON")}<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
          const next = event.target.files?.[0] ?? null;
          setFileError(null);
          if (next && next.size > CAPTURE_BUNDLE_MAX_BYTES) {
            setFile(null); event.target.value = '';
            setFileError(message('Choose a capture bundle no larger than {limit} MB.', { limit: CAPTURE_BUNDLE_MAX_BYTES / 1_000_000 }));
          } else setFile(next);
        }} /></label>
        <label>{t("Imported workspace name")}<input value={displayName} maxLength={300} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <p className="small muted">{t("Import creates a new workspace. Your existing workspace stays stored on this computer.")}</p>
        {dirty && <p className="small capture-transfer-warning">{t("Save your unsaved annotations, specifications and draft input before importing captures.")}</p>}
        {fileError && <p className="error small" role="alert">{renderMessage(fileError)}</p>}
        <button className="wide" type="submit" disabled={busy || dirty || !file || !displayName.trim()}>{t("Import captures")}</button>
      </form>
    </section>
  </details>;
}
