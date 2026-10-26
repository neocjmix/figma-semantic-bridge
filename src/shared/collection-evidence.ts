import { z } from 'zod';
import { AncestorRenderingSchema, IdSchema, SourceNodeSchema } from './contracts.js';
import { CollectionSourceSchema, STRUCTURE_COLLECTION_NODES } from './structure-collection.js';

/** Historical observations. Completeness never implies current Figma freshness or approval. */
export const CollectionEvidenceSnapshotSchema = z.object({
  version: z.literal(1), collectionId: IdSchema, source: CollectionSourceSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  nodeCount: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  chunkCount: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  scopeComplete: z.boolean(), startedAt: z.string().datetime().nullable(),
  observedAt: z.string().datetime().nullable(),
  consistency: z.literal('live-session-observation'), freshness: z.literal('not-revalidated'),
  reviewStatus: z.literal('unreviewed'),
}).strict();
export type CollectionEvidenceSnapshot = z.infer<typeof CollectionEvidenceSnapshotSchema>;

export const CollectionEvidenceNodeSchema = SourceNodeSchema.omit({ text: true }).extend({
  textLength: z.number().int().min(0).max(50000).nullable(),
  textAvailable: z.boolean(),
  declaredChildCount: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  observedChildCount: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  subtreeComplete: z.boolean(),
}).strict();
export type CollectionEvidenceNode = z.infer<typeof CollectionEvidenceNodeSchema>;

export const CollectionEvidencePageSchema = z.object({
  snapshot: CollectionEvidenceSnapshotSchema, nodes: z.array(CollectionEvidenceNodeSchema).max(200),
  nextOffset: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES).nullable(),
  total: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  coverage: z.literal('observed-records-only'), reviewStatus: z.literal('unreviewed'),
}).strict();
export type CollectionEvidencePage = z.infer<typeof CollectionEvidencePageSchema>;

export const CollectionEvidenceTextSchema = z.object({
  snapshot: CollectionEvidenceSnapshotSchema, nodeId: IdSchema, text: z.string().max(4000),
  offset: z.number().int().min(0).max(50000), nextOffset: z.number().int().min(0).max(50000).nullable(),
  totalLength: z.number().int().min(0).max(50000), reviewStatus: z.literal('unreviewed'),
}).strict();
export type CollectionEvidenceText = z.infer<typeof CollectionEvidenceTextSchema>;

/** A closed saved subtree only; outside ancestors and siblings are outside this coverage. */
export const CollectionEvidenceBranchSchema = z.object({
  version: z.literal(1), collectionId: IdSchema, source: CollectionSourceSchema,
  root: SourceNodeSchema, startOffset: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  endOffset: z.number().int().min(1).max(STRUCTURE_COLLECTION_NODES),
  nodeCount: z.number().int().min(1).max(STRUCTURE_COLLECTION_NODES),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), startedAt: z.string().datetime(), observedAt: z.string().datetime(),
  coverage: z.literal('closed-saved-subtree'), consistency: z.literal('live-session-observation'),
  ancestorRendering: AncestorRenderingSchema,
  freshness: z.literal('not-revalidated'), reviewStatus: z.literal('unreviewed'),
}).strict();
export type CollectionEvidenceBranch = z.infer<typeof CollectionEvidenceBranchSchema>;

export type CollectionEvidenceBranchPacket = {
  collectionId: string; branchNodeId: string; originalSequence: number; originalOffset: number;
  nodes: z.infer<typeof SourceNodeSchema>[]; childCounts: number[]; startedAt: string; observedAt: string;
};
