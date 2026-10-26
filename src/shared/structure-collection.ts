import { z } from 'zod';
import { AncestorRenderingSchema, IdSchema, RectSchema, SourceNodeSchema } from './contracts.js';
import { MAX_COLLECTION_BYTES, MAX_COLLECTION_NODES } from './import-settings.js';

export const STRUCTURE_CHUNK_NODES = 500;
export const STRUCTURE_CHUNK_BYTES = 1_000_000;
export const STRUCTURE_COLLECTION_NODES = MAX_COLLECTION_NODES;
export const STRUCTURE_COLLECTION_BYTES = MAX_COLLECTION_BYTES;
export const StructureChunkSchema = z.object({
  collectionId: IdSchema, sequence: z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  fileKey: IdSchema, pageId: IdSchema, root: SourceNodeSchema, bounds: RectSchema,
  startedAt: z.string().datetime(), observedAt: z.string().datetime(),
  nodes: z.array(SourceNodeSchema).min(1).max(STRUCTURE_CHUNK_NODES),
  childCounts: z.array(z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES)).min(1).max(STRUCTURE_CHUNK_NODES),
  complete: z.boolean(), nextSequence: z.number().int().min(1).max(STRUCTURE_COLLECTION_NODES).nullable(),
  warnings: z.array(z.string().max(2000)).max(20),
  consistency: z.literal('live-session-observation'),
}).strict();
export type StructureChunk = z.infer<typeof StructureChunkSchema>;

export const CollectionSourceSchema = z.object({fileKey:IdSchema,pageId:IdSchema,nodeId:IdSchema,
  name:z.string().max(1000),type:z.string().max(80),bounds:RectSchema,
  // Present for a branch requested from an inspection or a saved source task.
  // A complete collection covers nodeId and its descendants, never scopeId's siblings.
  scopeId:IdSchema.optional(),inspectionId:IdSchema.optional(),parentId:IdSchema.nullable().optional(),
  ancestorRendering:AncestorRenderingSchema.optional(),
}).strict().superRefine((value,ctx)=>{
  if((value.scopeId===undefined)!==(value.parentId===undefined)||value.inspectionId!==undefined&&value.scopeId===undefined)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'A branch must preserve its enclosing root and observed parent.'});
});
export const CollectionPartOfSchema=z.object({
  collectionId:IdSchema,contextCollectionId:IdSchema,contextRootId:IdSchema,contextBounds:RectSchema,
}).strict();
export const CollectionStatusSchema=z.enum(['prepared','running','paused','complete','failed','cancelled','interrupted']);
export const CollectionErrorSchema=z.object({code:z.string().max(80),message:z.string().max(1000)}).strict();
export const CollectionViewSchema=z.object({
  id:IdSchema,projectId:IdSchema,sessionId:IdSchema,source:CollectionSourceSchema,
  status:CollectionStatusSchema,nodeCount:z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  byteCount:z.number().int().min(0).max(STRUCTURE_COLLECTION_BYTES),chunkCount:z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
  createdAt:z.string().datetime(),updatedAt:z.string().datetime(),finishedAt:z.string().datetime().nullable(),
  elapsedMs:z.number().int().min(0),error:CollectionErrorSchema.nullable(),
  overviewAcquisitionId:IdSchema.optional(),
  partOf:CollectionPartOfSchema.optional(),
  recovery:z.object({previousCollectionId:IdSchema,originalCollectionId:IdSchema,
    revalidatedNodes:z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES),
    reusedPackets:z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES)}).strict().optional(),
  pauseReason:z.enum(['user','time','nodes','bytes','busy']).nullable().optional(),
  pauseRequested:z.boolean().optional().default(false),
  warnings:z.array(z.string().max(2000)).max(100),consistency:z.literal('live-session-observation'),
  reviewStatus:z.literal('unreviewed'),
}).strict();
export type CollectionView=z.infer<typeof CollectionViewSchema>;
export type CollectionSource=z.infer<typeof CollectionSourceSchema>;
export const CollectionQuerySchema=z.object({
  offset:z.number().int().min(0).max(STRUCTURE_COLLECTION_NODES).default(0),
  limit:z.number().int().min(1).max(200).default(100),
  nodeIds:z.array(IdSchema).min(1).max(200).optional(),parentId:IdSchema.optional(),
  query:z.string().max(300).optional(),textOnly:z.boolean().optional(),
}).strict();
export type CollectionQuery=z.infer<typeof CollectionQuerySchema>;
export const CollectionTextQuerySchema=z.object({nodeId:IdSchema,offset:z.number().int().min(0).max(50000).default(0),
  limit:z.number().int().min(1).max(4000).default(4000)}).strict();
export type CollectionTextQuery=z.infer<typeof CollectionTextQuerySchema>;
