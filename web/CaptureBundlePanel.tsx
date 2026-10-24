import { useState } from 'react';
import { CAPTURE_BUNDLE_MAX_BYTES, CAPTURE_BUNDLE_MAX_SNAPSHOTS } from '../src/shared/capture-bundle.js';
import type { Project } from '../src/shared/contracts.js';

export function CaptureBundlePanel({ project, currentSnapshotId, busy, dirty, onExport, onImport }: {
  project: Project | null; currentSnapshotId: string | null; busy: boolean; dirty: boolean;
  onExport(snapshotIds: string[]): void;
  onImport(file: File, name: string): void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(currentSnapshotId ? [currentSnapshotId] : []);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('Imported captures');
  const [fileError, setFileError] = useState('');
  const snapshotIds = selectedIds.filter(id => project?.snapshots.some(snapshot => snapshot.id === id));

  return <details className="capture-transfer">
    <summary>Capture transfer</summary>
    <section aria-label="Capture transfer">
      <p className="small muted">Includes source images and original text. Annotations and approvals are not transferred. Source contents are unverified and require human review.</p>
      <p className="small muted">Choose one or two captures to download. No Figma connection is needed.</p>
      <div className="capture-transfer-scopes">{project?.snapshots.map(snapshot => <label className="checkbox" key={snapshot.id}>
        <input type="checkbox" aria-label={`Export capture ${snapshot.name}`} checked={snapshotIds.includes(snapshot.id)}
          disabled={busy || (!snapshotIds.includes(snapshot.id) && snapshotIds.length >= CAPTURE_BUNDLE_MAX_SNAPSHOTS)}
          onChange={event => setSelectedIds(current => event.target.checked ? [...current, snapshot.id] : current.filter(id => id !== snapshot.id))} />
        <span>{snapshot.name}<small>{snapshot.nodes.length} nodes · {snapshot.completeness.complete ? 'complete scope' : 'partial scope'}</small></span>
      </label>)}</div>
      <button className="wide" disabled={busy || snapshotIds.length === 0} onClick={() => onExport(snapshotIds)}>Export captures</button>
      <form onSubmit={event => { event.preventDefault(); if (file && !busy && !dirty && name.trim()) onImport(file, name.trim()); }}>
        <label>Capture bundle JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
          const next = event.target.files?.[0] ?? null;
          setFileError('');
          if (next && next.size > CAPTURE_BUNDLE_MAX_BYTES) {
            setFile(null); event.target.value = '';
            setFileError(`Choose a capture bundle no larger than ${CAPTURE_BUNDLE_MAX_BYTES / 1_000_000} MB.`);
          } else setFile(next);
        }} /></label>
        <label>Imported workspace name<input value={name} maxLength={300} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <p className="small muted">Import creates a new workspace. Your existing workspace stays stored on this computer.</p>
        {dirty && <p className="small capture-transfer-warning">Save your unsaved annotations, specifications and draft input before importing captures.</p>}
        {fileError && <p className="error small" role="alert">{fileError}</p>}
        <button className="wide" type="submit" disabled={busy || dirty || !file || !name.trim()}>Import captures</button>
      </form>
    </section>
  </details>;
}
