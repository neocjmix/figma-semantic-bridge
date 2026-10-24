import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0' as const;
export const IdSchema = z.string().min(1).max(160);
export const RectSchema = z.object({
  x: z.number().finite().min(-1e8).max(1e8),
  y: z.number().finite().min(-1e8).max(1e8),
  width: z.number().finite().positive().max(1e7),
  height: z.number().finite().positive().max(1e7),
}).strict();
export const NodeBoundsSchema = RectSchema.extend({ width: z.number().finite().min(0).max(1e7), height: z.number().finite().min(0).max(1e7) });
export const ReviewStatusSchema = z.enum(['proposed', 'approved', 'rejected']);
export const SourceNodeSchema = z.object({
  id: IdSchema, parentId: IdSchema.nullable(), type: z.string().min(1).max(80),
  name: z.string().max(1000), bbox: NodeBoundsSchema.nullable(),
  text: z.string().max(50000).optional(), visible: z.boolean(),
  rendering: z.object({ opacity: z.number().finite().min(0).max(1).optional(),
    siblingIndex: z.number().int().min(0).optional() }).strict().optional(),
  sourceFileKey: z.string().min(1).max(160).nullable(), sourcePageId: IdSchema,
}).strict();
export const PreviewSchema = z.object({
  mimeType: z.literal('image/png'), base64: z.string().max(12_000_000),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
}).strict();
export const NODE_PREVIEW_MAX_DIMENSION = 1024;
export const NODE_PREVIEW_MAX_BYTES = 2_000_000;
export const NODE_PREVIEW_MAX_DURATION_MS = 5000;
export const NodePreviewResultSchema = z.object({
  fileKey: IdSchema, pageId: IdSchema, node: SourceNodeSchema,
  observedAt: z.string().datetime(), preview: PreviewSchema,
  warnings: z.array(z.string().max(2000)).max(20),
}).strict();
export const SourcePreviewInputSchema = z.object({
  expectedRevision: z.number().int().min(0), annotationId: IdSchema,
  expectedSessionId: IdSchema, nodeId: IdSchema,
}).strict();
export const SourcePreviewResultSchema = z.object({
  projectId: IdSchema, revision: z.number().int().min(0), annotationId: IdSchema,
  snapshotId: IdSchema, sessionId: IdSchema, result: NodePreviewResultSchema,
}).strict();
export const SnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), id: IdSchema, name: z.string().min(1).max(300),
  source: z.object({ fileKey: z.string().min(1).max(160).nullable(), pageId: IdSchema, rootId: IdSchema,
    revision: z.string().max(200).nullable(), capturedAt: z.string().datetime() }).strict(),
  bounds: RectSchema, nodes: z.array(SourceNodeSchema).min(1).max(10000),
  preview: PreviewSchema.nullable(),
  completeness: z.object({ complete: z.boolean(), reason: z.string().max(1000).nullable() }).strict(),
  warnings: z.array(z.string().max(2000)).max(100),
}).strict();
export const SourceReferenceSchema = z.object({
  snapshotId: IdSchema, nodeId: IdSchema,
  matchType: z.enum(['exact', 'contained', 'partial', 'aggregate']),
  coverage: z.number().finite().min(0).max(1).optional(),
}).strict();
export const SourceReviewSchema = z.object({
  candidates: z.array(z.object({ nodeId: IdSchema, coverage: z.number().finite().min(0).max(1),
    iou: z.number().finite().min(0).max(1), reason: z.string().max(1000) }).strict()).max(200),
  ambiguous: z.boolean(), warnings: z.array(z.string().max(2000)).max(100),
  renderingReviewRequired: z.boolean().optional(),
  status: z.enum(['unconfirmed', 'confirmed']), confirmedAt: z.string().datetime().nullable(),
}).strict().refine(value => (value.status === 'confirmed') === (value.confirmedAt !== null),
  { message: 'Only confirmed source reviews carry a confirmation time.' });
export const AnnotationSchema = z.object({
  id: IdSchema, snapshotId: IdSchema, name: z.string().min(1).max(300),
  role: z.enum(['page', 'section', 'component', 'element', 'specification', 'ignore']),
  bbox: RectSchema, parentId: IdSchema.nullable(), sourceRefs: z.array(SourceReferenceSchema).max(1000),
  origin: z.enum(['human', 'ai']), reviewStatus: ReviewStatusSchema, revision: z.number().int().min(0),
  sourceReview: SourceReviewSchema.optional(),
}).strict();
export const SpecRelationSchema = z.object({
  targetAnnotationId: IdSchema, relationType: z.enum(['describes', 'behavior', 'constraint', 'interaction', 'dependency']),
  reviewStatus: ReviewStatusSchema,
}).strict();
export const SpecificationSchema = z.object({
  id: IdSchema, text: z.string().min(1).max(100000),
  sourceRefs: z.array(SourceReferenceSchema).min(1).max(1000),
  relations: z.array(SpecRelationSchema).max(1000),
  origin: z.enum(['human', 'ai']), reviewStatus: ReviewStatusSchema, revision: z.number().int().min(0),
}).strict();
export const DraftSchema = z.object({
  annotations: z.array(AnnotationSchema).max(200), specifications: z.array(SpecificationSchema).max(200),
}).strict();
export const ProposalSchema = z.object({
  id: IdSchema, createdAt: z.string().datetime(), baseRevision: z.number().int().min(0),
  status: z.enum(['pending', 'accepted', 'rejected']), draft: DraftSchema,
  warnings: z.array(z.string().max(2000)).max(100),
}).strict();
export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), id: IdSchema, name: z.string().min(1).max(300),
  revision: z.number().int().min(0), updatedAt: z.string().datetime(),
  snapshots: z.array(SnapshotSchema).max(30), annotations: z.array(AnnotationSchema).max(2000),
  specifications: z.array(SpecificationSchema).max(2000), proposals: z.array(ProposalSchema).max(100),
}).strict();
export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_snapshot'), snapshot: SnapshotSchema }).strict(),
  z.object({ type: z.literal('upsert_annotation'), annotation: AnnotationSchema }).strict(),
  z.object({ type: z.literal('delete_annotation'), id: IdSchema }).strict(),
  z.object({ type: z.literal('review_annotation'), id: IdSchema, status: ReviewStatusSchema }).strict(),
  z.object({ type: z.literal('match_annotation'), id: IdSchema, tolerance: z.number().finite().min(0).max(10).default(0.5) }).strict(),
  z.object({ type: z.literal('confirm_annotation_sources'), id: IdSchema, expectedAnnotationRevision: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('split_annotation'), id: IdSchema, axis: z.enum(['horizontal', 'vertical']), ratio: z.number().min(0.1).max(0.9).default(0.5) }).strict(),
  z.object({ type: z.literal('merge_annotations'), ids: z.array(IdSchema).min(2).max(50), name: z.string().min(1).max(300) }).strict(),
  z.object({ type: z.literal('upsert_specification'), specification: SpecificationSchema }).strict(),
  z.object({ type: z.literal('delete_specification'), id: IdSchema }).strict(),
  z.object({ type: z.literal('review_specification'), id: IdSchema, status: ReviewStatusSchema }).strict(),
  z.object({ type: z.literal('submit_proposal'), draft: DraftSchema, warnings: z.array(z.string().max(2000)).max(100).default([]) }).strict(),
  z.object({ type: z.literal('resolve_proposal'), id: IdSchema, decision: z.enum(['accept', 'reject']) }).strict(),
  z.object({ type: z.literal('rename_project'), name: z.string().min(1).max(300) }).strict(),
]);
export const MutationSchema = z.object({ expectedRevision: z.number().int().min(0), operation: OperationSchema }).strict();
export const CaptureLimitsSchema = z.object({ maxNodes: z.number().int().min(1).max(10000).default(5000),
  maxBytes: z.number().int().min(1024).max(4_000_000).default(2_000_000),
  maxDurationMs: z.number().int().min(100).max(15000).default(5000),
  maxImageDimension: z.number().int().min(256).max(4096).default(2048),
}).strict();
export const PluginCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('get_selection') }).strict(),
  z.object({ type: z.literal('capture_selection'), limits: CaptureLimitsSchema }).strict(),
  z.object({ type: z.literal('preview_node'), fileKey: IdSchema, pageId: IdSchema, nodeId: IdSchema }).strict(),
  z.object({ type: z.literal('highlight_nodes'), fileKey: IdSchema, pageId: IdSchema, nodeIds: z.array(IdSchema).min(1).max(100) }).strict(),
]);
export const PluginRequestSchema = z.object({ type: z.literal('request'), requestId: IdSchema, command: PluginCommandSchema }).strict();
export const PluginResponseSchema = z.object({ type: z.literal('response'), requestId: IdSchema, ok: z.boolean(),
  result: z.unknown().optional(), error: z.object({code:z.string().max(80),message:z.string().max(1000)}).strict().optional(),
}).strict();
export const SelectionSchema = z.object({ fileKey: z.string().max(160).nullable(), pageId: IdSchema,
  nodes: z.array(z.object({id:IdSchema,name:z.string().max(1000),type:z.string().max(80),bbox:NodeBoundsSchema.nullable()}).strict()).max(100),
}).strict();

export type Rect = z.infer<typeof RectSchema>;
export type SourceNode = z.infer<typeof SourceNodeSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type SourceReview = z.infer<typeof SourceReviewSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type Specification = z.infer<typeof SpecificationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type PluginCommand = z.infer<typeof PluginCommandSchema>;
export type CaptureLimits = z.infer<typeof CaptureLimitsSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type NodePreviewResult = z.infer<typeof NodePreviewResultSchema>;
export type SourcePreviewResult = z.infer<typeof SourcePreviewResultSchema>;
