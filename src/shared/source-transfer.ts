import { MAX_COLLECTION_NODES } from './import-settings.js';
import { z } from 'zod';
import { CollectionReferenceSchema, EvidenceScopeSchema, SnapshotSchema } from './contracts.js';
import { CollectionSourceSchema } from './structure-collection.js';

export const SOURCE_TRANSFER_MAX_BYTES=80_000_000;
export const SOURCE_TRANSFER_LINE_BYTES=13_000_000;
export const SourceTransferV1HeaderSchema=z.object({
  kind:z.literal('figma-semantic-bridge.source-transfer'),version:z.literal(1),
  exportedAt:z.string().datetime(),source:CollectionSourceSchema,scope:EvidenceScopeSchema,
}).strict().refine(value=>value.scope.kind==='collection'&&value.scope.collection!==null,'A complete collection is required.');
/** Inline records are sent only in bounded packets, including old captures. */
export const TransferSnapshotSchema=SnapshotSchema.omit({nodes:true}).extend({kind:z.literal('snapshot')});
export const SourceTransferV2HeaderSchema=z.object({
  kind:z.literal('figma-semantic-bridge.source-transfer'),version:z.literal(2),
  exportedAt:z.string().datetime(),source:CollectionSourceSchema,collection:CollectionReferenceSchema,
  scope:z.union([EvidenceScopeSchema,TransferSnapshotSchema]),
}).strict().refine(value=>value.scope.kind==='snapshot'?value.scope.completeness.complete:value.scope.kind!=='visual',
  'A complete source scope or saved branch is required.');
export const SourceTransferHeaderSchema=z.union([SourceTransferV1HeaderSchema,SourceTransferV2HeaderSchema]);
export type SourceTransferHeader=z.infer<typeof SourceTransferHeaderSchema>;
export type SourceTransferV2Header=z.infer<typeof SourceTransferV2HeaderSchema>;
export const SourceTransferFooterSchema=z.object({kind:z.literal('end'),
  chunkCount:z.number().int().min(1).max(MAX_COLLECTION_NODES),nodeCount:z.number().int().min(1).max(MAX_COLLECTION_NODES),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
