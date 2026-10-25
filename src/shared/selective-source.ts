import { z } from 'zod';

// Kept independent of contracts.ts: PluginCommandSchema imports these commands.
const Id = z.string().min(1).max(160);
export const SELECTIVE_NODES_MAX = 100;
export const SELECTIVE_CHILDREN_MAX = 100;
export const SELECTIVE_NODES_WIRE_BYTES = 1_000_000;
export const SELECTIVE_CHILDREN_WIRE_BYTES = 96_000;
export const SELECTIVE_CURSOR_IDLE_MS = 10 * 60 * 1000;

export const SelectiveReadNodesCommandSchema = z.object({
  type: z.literal('read_source_nodes'), fileKey: Id, pageId: Id, scopeId: Id,
  nodeIds: z.array(Id).min(1).max(SELECTIVE_NODES_MAX),
  fields: z.enum(['metadata', 'text']),
}).strict();
export const SelectiveReadChildrenCommandSchema = z.object({
  type: z.literal('read_source_children'), fileKey: Id, pageId: Id, scopeId: Id,
  parentId: Id, observationId: Id,
  offset: z.number().int().min(0).max(200_000),
  limit: z.number().int().min(1).max(SELECTIVE_CHILDREN_MAX),
}).strict();

export type SelectiveReadNodesCommand = z.infer<typeof SelectiveReadNodesCommandSchema>;
export type SelectiveReadChildrenCommand = z.infer<typeof SelectiveReadChildrenCommandSchema>;
