import { z } from 'zod';

// Resource settings are separate from packet/integrity ceilings.
export const MAX_COLLECTION_NODES = 1_000_000;
export const MAX_COLLECTION_BYTES = 128_000_000;
export const OverviewOptionsSchema = z.object({
  maxDimension: z.number().int().min(256).max(8192).default(4096),
  scale: z.number().min(0.25).max(4).default(2),
  maxBytes: z.number().int().min(100_000).max(9_000_000).default(8_000_000),
  maxDurationMs: z.number().int().min(1000).max(300_000).default(55_000),
}).strict();
export const ImportSettingsSchema = z.object({
  overview: OverviewOptionsSchema.prefault({}),
  maxNodes: z.number().int().min(1).max(MAX_COLLECTION_NODES).default(200_000),
  maxBytes: z.number().int().min(1_000_000).max(MAX_COLLECTION_BYTES).default(64_000_000),
  runDurationMs: z.number().int().min(1000).max(1_800_000).default(300_000),
  requestTimeoutMs: z.number().int().min(1000).max(120_000).default(20_000),
  cursorIdleMs: z.number().int().min(60_000).max(1_800_000).default(600_000),
}).strict();
export const SettingsViewSchema = z.object({revision:z.number().int().min(0),settings:ImportSettingsSchema}).strict();
export type ImportSettings = z.infer<typeof ImportSettingsSchema>;
export type OverviewOptions = z.infer<typeof OverviewOptionsSchema>;
export type SettingsView = z.infer<typeof SettingsViewSchema>;
export const defaultImportSettings = (): ImportSettings => ImportSettingsSchema.parse({});
