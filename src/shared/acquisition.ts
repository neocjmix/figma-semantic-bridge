import { z } from 'zod';
import { CaptureLimitsSchema, IdSchema, RectSchema } from './contracts.js';

export const AcquisitionPlanSchema = z.enum(['overview', 'structure', 'overview_then_structure', 'structure_then_overview']);
export type AcquisitionPlan = z.infer<typeof AcquisitionPlanSchema>;
export const AcquisitionStartSchema = z.object({ plan: AcquisitionPlanSchema, limits: CaptureLimitsSchema.prefault({}) }).strict();
export const AcquisitionStatusSchema = z.enum(['prepared', 'running', 'ready', 'partial', 'failed', 'cancel_requested', 'cancelled', 'committed', 'interrupted']);
export const AcquisitionStepSchema = z.enum(['idle', 'running', 'ready', 'partial', 'failed']);
const ErrorSchema = z.object({ code: z.string().max(80), message: z.string().max(1000) }).strict();
export const AcquisitionViewSchema = z.object({
  id: IdSchema, projectId: IdSchema, baseRevision: z.number().int().min(0), sessionId: IdSchema,
  source: z.object({ fileKey: IdSchema, pageId: IdSchema, nodeId: IdSchema, name: z.string().max(1000),
    type: z.string().max(80), bounds: RectSchema }).strict(),
  status: AcquisitionStatusSchema, stage: z.enum(['prepared', 'preview', 'structure', 'saving', 'done']),
  plan: AcquisitionPlanSchema.nullable(), limits: CaptureLimitsSchema,
  progress: z.object({ nodes: z.number().int().min(0).max(10000), bytes: z.number().int().min(0).max(4_000_000), elapsedMs: z.number().int().min(0) }).strict(),
  preview: z.object({ status: AcquisitionStepSchema, observedAt: z.string().datetime().nullable(), error: ErrorSchema.nullable() }).strict(),
  structure: z.object({ status: AcquisitionStepSchema, complete: z.boolean(), reason: z.string().max(1000).nullable(), error: ErrorSchema.nullable() }).strict(),
  warnings: z.array(z.string().max(2000)).max(100), error: ErrorSchema.nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), resultSnapshotId: IdSchema.nullable(),
}).strict();
export type AcquisitionView = z.infer<typeof AcquisitionViewSchema>;
