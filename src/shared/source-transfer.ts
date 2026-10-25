import { z } from 'zod';
import { EvidenceScopeSchema } from './contracts.js';
import { CollectionSourceSchema } from './structure-collection.js';

export const SOURCE_TRANSFER_MAX_BYTES=80_000_000;
export const SOURCE_TRANSFER_LINE_BYTES=13_000_000;
export const SourceTransferHeaderSchema=z.object({
  kind:z.literal('figma-semantic-bridge.source-transfer'),version:z.literal(1),
  exportedAt:z.string().datetime(),source:CollectionSourceSchema,scope:EvidenceScopeSchema,
}).strict().refine(value=>value.scope.kind==='collection'&&value.scope.collection!==null,'A complete collection is required.');
export type SourceTransferHeader=z.infer<typeof SourceTransferHeaderSchema>;
export const SourceTransferFooterSchema=z.object({kind:z.literal('end'),
  chunkCount:z.number().int().min(1).max(200000),nodeCount:z.number().int().min(1).max(200000),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
