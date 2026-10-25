import { z } from 'zod';
import { IdSchema, SnapshotSchema } from './contracts.js';

export const CAPTURE_BUNDLE_MAX_BYTES = 15_000_000;
export const CAPTURE_BUNDLE_MAX_NODE_BYTES = 4_000_000;
export const CAPTURE_BUNDLE_MAX_NODES = 10_000;
export const CAPTURE_BUNDLE_MAX_SNAPSHOTS = 2;

function record(value:unknown):Record<string,unknown>|null {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}

/** Inspect lengths only, before Zod can visit elements or accumulate nested errors. */
export function captureBundleCollectionLimit(value:unknown):string|null {
  const snapshots=record(value)?.snapshots;
  if(!Array.isArray(snapshots))return null;
  if(snapshots.length>CAPTURE_BUNDLE_MAX_SNAPSHOTS)return 'Capture bundles contain at most two scopes.';
  let nodes=0;
  for(const entry of snapshots) {
    const snapshot=record(record(entry)?.snapshot);
    if(!snapshot)continue;
    if(Array.isArray(snapshot.nodes))nodes+=snapshot.nodes.length;
    if(nodes>CAPTURE_BUNDLE_MAX_NODES)return 'Capture bundle exceeds 10,000 source nodes across its scopes.';
    if(Array.isArray(snapshot.warnings)&&snapshot.warnings.length>100)return 'A captured scope contains at most 100 warnings.';
  }
  return null;
}
const SnapshotIdsSchema = z.preprocess((value,ctx)=>{
  if(Array.isArray(value)&&value.length>CAPTURE_BUNDLE_MAX_SNAPSHOTS) {
    ctx.addIssue({code:'custom',message:'Select at most two scopes.',fatal:true});return z.NEVER;
  }
  return value;
},z.array(IdSchema).min(1).max(CAPTURE_BUNDLE_MAX_SNAPSHOTS)
  .refine(ids => new Set(ids).size === ids.length, 'Select distinct snapshots.'));
export const CaptureBundleSchema = z.preprocess((value,ctx)=>{
  const message=captureBundleCollectionLimit(value);
  if(message){ctx.addIssue({code:'custom',message,fatal:true});return z.NEVER;}
  return value;
},z.object({
  kind: z.literal('figma-semantic-bridge.capture-bundle'),
  version: z.literal('1.0.0'),
  exportedAt: z.string().datetime(),
  snapshots: z.array(z.object({ snapshot: SnapshotSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .min(1).max(CAPTURE_BUNDLE_MAX_SNAPSHOTS),
}).strict());
export type CaptureBundle = z.infer<typeof CaptureBundleSchema>;
export const ExportCaptureBundleInputSchema = z.object({
  expectedRevision: z.number().int().min(0), snapshotIds: SnapshotIdsSchema,
}).strict();
export const ImportCaptureBundleInputSchema = z.object({
  name: z.string().min(1).max(300), bundle: CaptureBundleSchema,
}).strict();
