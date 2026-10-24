import { z } from 'zod';
import { IdSchema, SnapshotSchema } from './contracts.js';

export const CAPTURE_BUNDLE_MAX_BYTES = 15_000_000;
export const CAPTURE_BUNDLE_MAX_NODE_BYTES = 4_000_000;
export const CAPTURE_BUNDLE_MAX_NODES = 10_000;
export const CAPTURE_BUNDLE_MAX_SNAPSHOTS = 2;

const SnapshotIdsSchema = z.array(IdSchema).min(1).max(CAPTURE_BUNDLE_MAX_SNAPSHOTS)
  .refine(ids => new Set(ids).size === ids.length, 'Select distinct snapshots.');
export const CaptureBundleSchema = z.object({
  kind: z.literal('figma-semantic-bridge.capture-bundle'),
  version: z.literal('1.0.0'),
  exportedAt: z.string().datetime(),
  snapshots: z.array(z.object({ snapshot: SnapshotSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
    .min(1).max(CAPTURE_BUNDLE_MAX_SNAPSHOTS),
}).strict();
export type CaptureBundle = z.infer<typeof CaptureBundleSchema>;
export const ExportCaptureBundleInputSchema = z.object({
  expectedRevision: z.number().int().min(0), snapshotIds: SnapshotIdsSchema,
}).strict();
export const ImportCaptureBundleInputSchema = z.object({
  name: z.string().min(1).max(300), bundle: CaptureBundleSchema,
}).strict();
