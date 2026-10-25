import { z } from 'zod';
import { IdSchema, SourceNodeSchema } from './contracts.js';
import { SELECTIVE_CHILDREN_MAX, SELECTIVE_NODES_MAX } from './selective-source.js';

export const SelectiveMetadataNodeSchema = SourceNodeSchema.omit({ text: true });
const FieldCoverageSchema = z.object({
  metadata: z.literal('loaded'),
  text: z.enum(['loaded', 'not-requested', 'not-applicable']),
}).strict();

export const SelectiveNodesResultSchema = z.object({
  fileKey: IdSchema, pageId: IdSchema, scopeId: IdSchema,
  scope: SelectiveMetadataNodeSchema,
  startedAt: z.string().datetime(), observedAt: z.string().datetime(),
  requestedIds: z.array(IdSchema).min(1).max(SELECTIVE_NODES_MAX),
  fields: z.enum(['metadata', 'text']),
  records: z.array(z.object({ node: SourceNodeSchema, fieldCoverage: FieldCoverageSchema }).strict())
    .min(1).max(SELECTIVE_NODES_MAX),
  requestedIdsComplete: z.literal(true),
  consistency: z.literal('live-session-observation'),
}).strict().superRefine((value,ctx) => {
  if (value.requestedIds.length !== value.records.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Every requested ID needs one exact record.' }); return;
  }
  for (let index = 0; index < value.records.length; index++) {
    const record = value.records[index]!;
    if (record.node.id !== value.requestedIds[index])
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Record order must match requested IDs.' });
    if (record.node.sourceFileKey !== value.fileKey || record.node.sourcePageId !== value.pageId)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Record provenance differs from the scope.' });
    const expected = value.fields === 'metadata' ? 'not-requested' : record.node.type === 'TEXT' ? 'loaded' : 'not-applicable';
    if (record.fieldCoverage.text !== expected || (expected === 'loaded') !== (record.node.text !== undefined))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Text availability does not match the requested fields.' });
  }
  if (value.scope.id !== value.scopeId || value.scope.sourceFileKey !== value.fileKey || value.scope.sourcePageId !== value.pageId)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Scope metadata differs from the pinned source.' });
});

export const SelectiveChildrenResultSchema = z.object({
  fileKey: IdSchema, pageId: IdSchema, scopeId: IdSchema,
  scope: SelectiveMetadataNodeSchema, parentId: IdSchema, parent: SelectiveMetadataNodeSchema,
  observationId: IdSchema, startedAt: z.string().datetime(), observedAt: z.string().datetime(),
  offset: z.number().int().min(0).max(200_000), totalChildren: z.number().int().min(0).max(200_000),
  nodes: z.array(SelectiveMetadataNodeSchema).max(SELECTIVE_CHILDREN_MAX),
  nextOffset: z.number().int().min(1).max(200_000).nullable(), childrenComplete: z.boolean(),
  consistency: z.literal('live-session-observation'),
}).strict().superRefine((value,ctx) => {
  const end = value.offset + value.nodes.length;
  if (value.scope.id !== value.scopeId || value.parent.id !== value.parentId ||
      value.scope.sourceFileKey !== value.fileKey || value.parent.sourceFileKey !== value.fileKey ||
      value.scope.sourcePageId !== value.pageId || value.parent.sourcePageId !== value.pageId ||
      value.offset > value.totalChildren || end > value.totalChildren ||
      value.childrenComplete !== (end === value.totalChildren) ||
      value.nextOffset !== (end === value.totalChildren ? null : end))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Immediate-child coverage is inconsistent.' });
  for (let index = 0; index < value.nodes.length; index++) {
    const node = value.nodes[index]!;
    if (node.parentId !== value.parentId || node.sourceFileKey !== value.fileKey || node.sourcePageId !== value.pageId ||
      node.rendering?.siblingIndex !== value.offset + index)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Child source or sibling order differs from the parent inventory.' });
  }
});

export type SelectiveNodesResult = z.infer<typeof SelectiveNodesResultSchema>;
export type SelectiveChildrenResult = z.infer<typeof SelectiveChildrenResultSchema>;
