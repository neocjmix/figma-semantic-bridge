import { createHash, randomUUID } from 'node:crypto';
import { createProject, DomainError, validateProject } from '../core/index.js';
import {
  CAPTURE_BUNDLE_MAX_BYTES, CAPTURE_BUNDLE_MAX_NODE_BYTES, CAPTURE_BUNDLE_MAX_NODES,
  CaptureBundleSchema, ExportCaptureBundleInputSchema, type CaptureBundle,
} from '../shared/capture-bundle.js';
import type { Project, Snapshot } from '../shared/contracts.js';
import { validatePreview } from './preview.js';

function invalid(message:string):never {throw new DomainError('INVALID_CAPTURE_BUNDLE',message);}
function limit(message:string):never {throw new DomainError('CAPTURE_BUNDLE_LIMIT',message);}

/** Defined only for schema-validated JSON: sort object keys; retain arrays and scalar values. */
function canonicalJson(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value!==null&&typeof value==='object') {
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';
  }
  return JSON.stringify(value)!;
}
function digest(snapshot:Snapshot):string {
  return createHash('sha256').update(canonicalJson(snapshot),'utf8').digest('hex');
}
function checkBundleBytes(value:unknown):void {
  let encoded:string|undefined;
  try{encoded=JSON.stringify(value);}catch{invalid('Capture bundle must be JSON data.');}
  if(encoded===undefined)invalid('Capture bundle must be JSON data.');
  if(Buffer.byteLength(encoded,'utf8')>CAPTURE_BUNDLE_MAX_BYTES)limit('Capture bundle exceeds the 15 MB encoded limit. Select smaller captures.');
}
function validateBundle(value:unknown,verifyDigests:boolean):CaptureBundle {
  checkBundleBytes(value);
  const parsed=CaptureBundleSchema.safeParse(value);
  if(!parsed.success)invalid('Capture bundle does not satisfy the versioned capture-only contract.');
  const bundle=parsed.data,snapshots=bundle.snapshots.map(entry=>entry.snapshot);
  let nodeCount=0,nodeBytes=0;
  for(const snapshot of snapshots) {
    nodeCount+=snapshot.nodes.length;
    nodeBytes+=Buffer.byteLength(JSON.stringify(snapshot.nodes),'utf8');
  }
  if(nodeCount>CAPTURE_BUNDLE_MAX_NODES)limit('Capture bundle exceeds 10,000 source nodes across its scopes.');
  if(nodeBytes>CAPTURE_BUNDLE_MAX_NODE_BYTES)limit('Capture bundle exceeds the 4 MB source-node JSON limit. Select smaller captures.');
  if(verifyDigests&&bundle.snapshots.some(entry=>digest(entry.snapshot)!==entry.sha256)) {
    throw new DomainError('CAPTURE_BUNDLE_INTEGRITY','A snapshot checksum does not match its contents.');
  }
  // The same source identity, ancestry and completeness invariants apply to live and imported captures.
  try{validateProject({...createProject('capture-bundle-validation','Captured sources'),snapshots});}
  catch{invalid('Captured sources have invalid identity, ancestry or completeness.');}
  for(const snapshot of snapshots) {
    const root=snapshot.nodes.find(node=>node.id===snapshot.source.rootId)!;
    if(!root.bbox||(['x','y','width','height'] as const).some(key=>root.bbox![key]!==snapshot.bounds[key])) {
      invalid('Captured root bounds must equal the snapshot scope bounds.');
    }
    try{validatePreview(snapshot);}catch{invalid('Captured preview must contain bounded PNG data with matching header dimensions.');}
  }
  return bundle;
}

/** Read-only, explicit selection; no semantic decisions or project identity enter the bundle. */
export function exportCaptureBundle(project:Project,snapshotIds:string[],exportedAt=new Date().toISOString()):CaptureBundle {
  const selection=ExportCaptureBundleInputSchema.safeParse({expectedRevision:0,snapshotIds});
  if(!selection.success)invalid('Choose one or two distinct captured scopes.');
  const snapshots=selection.data.snapshotIds.map(id=>{
    const snapshot=project.snapshots.find(item=>item.id===id);
    if(!snapshot)throw new DomainError('NOT_FOUND','Requested capture was not found.');
    return {snapshot,sha256:'0'.repeat(64)};
  });
  const bundle=validateBundle({kind:'figma-semantic-bridge.capture-bundle',version:'1.0.0',exportedAt,snapshots},false);
  for(const entry of bundle.snapshots)entry.sha256=digest(entry.snapshot);
  return bundle;
}

/** Checksums detect changed data, not authorship, permission or current Figma rendering. */
export function importCaptureBundle(value:unknown,name:string):Project {
  const bundle=validateBundle(value,true);
  try {
    return validateProject({...createProject(randomUUID(),name),snapshots:bundle.snapshots.map(entry=>entry.snapshot)});
  } catch {invalid('Imported captures require a valid new project name.');}
}
