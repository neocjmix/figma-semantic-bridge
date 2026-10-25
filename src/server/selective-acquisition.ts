import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { IdSchema, SelectionSchema } from '../shared/contracts.js';
import { CollectionSourceSchema } from '../shared/structure-collection.js';
import { SELECTIVE_CHILDREN_WIRE_BYTES, SELECTIVE_NODES_WIRE_BYTES } from '../shared/selective-source.js';
import {
  SelectiveChildrenResultSchema, SelectiveNodesResultSchema,
  type SelectiveChildrenResult, type SelectiveNodesResult,
} from '../shared/selective-source-results.js';
import { PluginBroker } from './broker.js';
import { ServiceError } from './errors.js';
import { ProjectStore } from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INSPECTIONS = 12, MAX_TOTAL_BYTES = 32_000_000, MAX_OBSERVATION_BYTES = 1_000_000;
const MAX_HISTORY_PAGE_BYTES = 2_000_000;
const NodesInputSchema = z.object({ nodeIds: z.array(IdSchema).min(1).max(100), fields: z.enum(['metadata', 'text']) }).strict();
const ChildrenInputSchema = z.object({ parentId: IdSchema, observationId: IdSchema.optional(),
  offset: z.number().int().min(0).max(200_000).default(0), limit: z.number().int().min(1).max(100).default(100) }).strict();
export const SelectiveInspectionViewSchema = z.object({
  id: IdSchema, projectId: IdSchema, sessionId: IdSchema, source: CollectionSourceSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  observationCount: z.number().int().min(0), byteCount: z.number().int().min(0).max(MAX_TOTAL_BYTES),
  reviewStatus: z.literal('unreviewed'), consistency: z.literal('live-session-observation'),
}).strict();
export const SelectiveObservationSchema = z.discriminatedUnion('kind', [
  z.object({ id: IdSchema, kind: z.literal('nodes'), result: SelectiveNodesResultSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: IdSchema, kind: z.literal('children'), result: SelectiveChildrenResultSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
const StoredSchema = z.object({ view: SelectiveInspectionViewSchema,
  observations: z.array(SelectiveObservationSchema) }).strict();
export type SelectiveInspectionView = z.infer<typeof SelectiveInspectionViewSchema>;
export type SelectiveObservation = z.infer<typeof SelectiveObservationSchema>;
export type SelectiveInspectionHistory = { view: SelectiveInspectionView; history: SelectiveObservation[]; nextOffset: number | null };
export type SelectiveReadOutcome = { view: SelectiveInspectionView; observation: SelectiveObservation; reused: boolean };
export type SelectiveObservationSummary = { id: string; kind: SelectiveObservation['kind']; observedAt: string;
  recordCount: number; fields: 'metadata' | 'text'; parentId: string | null; childrenComplete: boolean | null };
type Stored = z.infer<typeof StoredSchema>;
type Run = { controller: AbortController; done: Promise<unknown> };
type ChildOwner = { projectId: string; inspectionId: string; sessionId: string; observationId: string; parentId: string };
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const digest = (kind: SelectiveObservation['kind'], result: unknown) =>
  createHash('sha256').update(JSON.stringify({ kind, result })).digest('hex');

/** Separate, immutable local observations; never changes a Project or approved annotation. */
export class SelectiveAcquisition {
  private readonly directory: string;
  private readonly tasks = new Map<string, Stored>();
  private readonly sizes = new Map<string, number>();
  private active: Run | null = null;
  private owner: ChildOwner | null = null;
  private closed = false;
  private storageFault = false;
  constructor(dataDir: string, private readonly projects: ProjectStore, private readonly broker: PluginBroker,
    private readonly options: { requestTimeoutMs?: number } = {}) {
    this.directory = join(resolve(dataDir), 'selective-acquisitions');
  }
  private path(id: string): string {
    if (!UUID.test(id)) throw new ServiceError('NOT_FOUND', 'Selective inspection not found.', 404);
    return join(this.directory, id + '.json');
  }
  private healthy(): void {
    if (this.storageFault) throw new ServiceError('STORAGE_ERROR', 'Selective observation durability is uncertain; restart the local server before continuing.', 500);
  }
  private task(projectId: string, id: string): Stored {
    this.healthy();
    const task = UUID.test(id) ? this.tasks.get(id) : undefined;
    if (!task || task.view.projectId !== projectId) throw new ServiceError('NOT_FOUND', 'Selective inspection not found.', 404);
    return task;
  }
  private view(task: Stored): SelectiveInspectionView { return structuredClone(task.view); }
  list(projectId: string): SelectiveInspectionView[] {
    this.healthy();
    return [...this.tasks.values()].filter(task => task.view.projectId === projectId)
      .map(task => this.view(task)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(projectId: string, id: string, offset = 0, limit = 10): SelectiveInspectionHistory {
    const task = this.task(projectId, id);
    if (!Number.isInteger(offset) || offset < 0 || offset > task.observations.length ||
        !Number.isInteger(limit) || limit < 1 || limit > 10)
      throw new ServiceError('INVALID_QUERY', 'History offset and limit are outside the bounded range.');
    const history: SelectiveObservation[] = []; let bytes = 2;
    for (let index = offset; index < task.observations.length && history.length < limit; index++) {
      const entry = task.observations[index]!;
      const size = encodedBytes(entry) + (history.length ? 1 : 0);
      if (history.length && bytes + size > MAX_HISTORY_PAGE_BYTES) break;
      history.push(structuredClone(entry)); bytes += size;
    }
    const nextOffset = offset + history.length < task.observations.length ? offset + history.length : null;
    return { view: this.view(task), history, nextOffset };
  }
  listObservations(projectId: string, id: string, offset = 0, limit = 20) {
    const task = this.task(projectId, id);
    if (!Number.isInteger(offset) || offset < 0 || offset > task.observations.length ||
        !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ServiceError('INVALID_QUERY', 'Observation page is outside the bounded range.');
    const observations: SelectiveObservationSummary[] = task.observations.slice(offset, offset + limit).map(entry => ({
      id: entry.id, kind: entry.kind, observedAt: entry.result.observedAt,
      recordCount: entry.kind === 'nodes' ? entry.result.records.length : entry.result.nodes.length,
      fields: entry.kind === 'nodes' ? entry.result.fields : 'metadata',
      parentId: entry.kind === 'children' ? entry.result.parentId : null,
      childrenComplete: entry.kind === 'children' ? entry.result.childrenComplete : null,
    }));
    const nextOffset = offset + observations.length < task.observations.length ? offset + observations.length : null;
    return { view: this.view(task), observations, nextOffset, total: task.observations.length };
  }
  private observation(projectId: string, id: string, observationId: string): SelectiveObservation {
    const entry = this.task(projectId, id).observations.find(value => value.id === observationId);
    if (!entry) throw new ServiceError('NOT_FOUND', 'Selective observation not found.', 404);
    return entry;
  }
  readRecords(projectId: string, id: string, observationId: string, offset = 0, limit = 20) {
    const entry = this.observation(projectId, id, observationId);
    const all = entry.kind === 'nodes' ? entry.result.records.map(record => {
      const { text, ...node } = record.node;
      return { node, textLength: text?.length ?? null, fieldCoverage: record.fieldCoverage };
    }) : entry.result.nodes.map(node => ({ node, textLength: null,
      fieldCoverage: { metadata: 'loaded' as const, text: 'not-requested' as const } }));
    if (!Number.isInteger(offset) || offset < 0 || offset > all.length ||
        !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new ServiceError('INVALID_QUERY', 'Record page is outside the bounded range.');
    const records = all.slice(offset, offset + limit);
    const nextOffset = offset + records.length < all.length ? offset + records.length : null;
    return { observationId: entry.id, kind: entry.kind, scopeId: entry.result.scopeId,
      records, offset, nextOffset, total: all.length, reviewStatus: 'unreviewed' as const,
      consistency: 'live-session-observation' as const };
  }
  readText(projectId: string, id: string, observationId: string, nodeId: string, offset = 0, limit = 4000) {
    const entry = this.observation(projectId, id, observationId);
    if (!Number.isInteger(offset) || offset < 0 || offset > 50_000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 4000)
      throw new ServiceError('INVALID_QUERY', 'Text segment is outside the bounded range.');
    const record = entry.kind === 'nodes' ? entry.result.records.find(item => item.node.id === nodeId) : undefined;
    if (!record || record.fieldCoverage.text !== 'loaded' || record.node.text === undefined)
      throw new ServiceError('TEXT_NOT_OBSERVED', 'This observation has no requested original text for that node.', 409);
    const original = record.node.text;
    if (offset > original.length) throw new ServiceError('INVALID_QUERY', 'Text offset exceeds the observed original text.');
    const splitsPair = (position: number) => position > 0 && position < original.length &&
      original.charCodeAt(position - 1) >= 0xD800 && original.charCodeAt(position - 1) <= 0xDBFF &&
      original.charCodeAt(position) >= 0xDC00 && original.charCodeAt(position) <= 0xDFFF;
    if (splitsPair(offset)) throw new ServiceError('INVALID_QUERY', 'Text offset splits a UTF-16 surrogate pair.');
    let end = Math.min(original.length, offset + limit);
    if (splitsPair(end)) end--;
    if (end === offset && end < original.length)
      throw new ServiceError('INVALID_QUERY', 'Use a text limit of at least two code units for this character.');
    const text = original.slice(offset, end);
    return { observationId: entry.id, nodeId, text, offset, nextOffset: end < original.length ? end : null,
      totalLength: original.length, reviewStatus: 'unreviewed' as const,
      consistency: 'live-session-observation' as const };
  }
  private checkSession(sessionId: string): void {
    if (this.closed) throw new ServiceError('SERVER_CLOSED', 'Selective acquisition service is stopping.', 503);
    const status = this.broker.status;
    if (!status.connected) throw new ServiceError('PLUGIN_DISCONNECTED', 'Connect the Figma plugin to read new source data.', 503);
    if (status.sessionId !== sessionId) throw new ServiceError('PLUGIN_SESSION_CHANGED', 'The Figma session changed; prepare a new inspection.', 409);
  }
  private currentOwner(): ChildOwner | null {
    if (this.owner && this.owner.sessionId !== this.broker.status.sessionId) this.owner = null;
    return this.owner;
  }
  private run<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    try { this.healthy(); } catch (error) { return Promise.reject(error); }
    if (this.closed) return Promise.reject(new ServiceError('SERVER_CLOSED', 'Selective acquisition service is stopping.', 503));
    if (this.active) return Promise.reject(new ServiceError('SELECTIVE_BUSY', 'Another selective source operation is settling.', 409));
    if (signal?.aborted) return Promise.reject(new ServiceError('CANCELLED', 'Selective source request cancelled.', 499));
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const run: Run = { controller, done: Promise.resolve() };
    this.active = run;
    const operation = Promise.resolve().then(() => work(combined)).finally(() => { if (this.active === run) this.active = null; });
    run.done = operation.then(() => {}, () => {});
    return operation;
  }
  private async directorySafe(): Promise<void> {
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ServiceError('STORAGE_ERROR', 'Selective observation directory is unsafe.', 500);
  }
  private validateStored(stored: Stored): void {
    const invalid = (): never => { throw new ServiceError('SELECTIVE_INTEGRITY', 'Stored selective observations failed integrity checks.', 500); };
    if (stored.observations.length !== stored.view.observationCount ||
        stored.view.byteCount !== stored.observations.reduce((sum, entry) => sum + encodedBytes(entry), 0)) invalid();
    const ids = new Set<string>();
    const childSeries = new Map<string, { next: number; total: number; complete: boolean;
      startedAt: string; parent: SelectiveChildrenResult['parent']; scope: SelectiveChildrenResult['scope'];
      parentId: string; seen: Set<string> }>();
    for (const entry of stored.observations) {
      if (ids.has(entry.id) || encodedBytes(entry) > MAX_OBSERVATION_BYTES ||
          entry.sha256 !== digest(entry.kind, entry.result)) invalid();
      ids.add(entry.id);
      const result = entry.result, source = stored.view.source;
      if (result.fileKey !== source.fileKey || result.pageId !== source.pageId ||
          result.scopeId !== source.nodeId || result.scope.id !== source.nodeId ||
          result.scope.name !== source.name || result.scope.type !== source.type ||
          !isDeepStrictEqual(result.scope.bbox, source.bounds)) invalid();
      if (entry.kind === 'nodes') {
        if (new Set(entry.result.requestedIds).size !== entry.result.requestedIds.length) invalid();
        continue;
      }
      const child = entry.result, previous = childSeries.get(child.observationId);
      if (!previous) {
        if (child.offset !== 0) invalid();
      } else if (previous.complete || child.offset !== previous.next ||
          child.totalChildren !== previous.total || child.startedAt !== previous.startedAt ||
          child.parentId !== previous.parentId || !isDeepStrictEqual(child.parent, previous.parent) ||
          !isDeepStrictEqual(child.scope, previous.scope)) invalid();
      const seen = previous?.seen ?? new Set<string>();
      for (const node of child.nodes) { if (seen.has(node.id)) invalid(); seen.add(node.id); }
      if (child.childrenComplete && seen.size !== child.totalChildren) invalid();
      childSeries.set(child.observationId, { next: child.nextOffset ?? child.totalChildren,
        total: child.totalChildren, complete: child.childrenComplete, startedAt: child.startedAt,
        parent: child.parent, scope: child.scope, parentId: child.parentId, seen });
    }
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.directorySafe();
    const names = await readdir(this.directory);
    for (const name of names) {
      const parts = name.split('.');
      if (parts.length === 3 && UUID.test(parts[0]!) && UUID.test(parts[1]!) && parts[2] === 'tmp')
        await rm(join(this.directory, name), { force: true });
    }
    const files = names.filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5)));
    if (files.length > MAX_INSPECTIONS)
      throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'Selective inspection count exceeds twelve.', 413);
    for (const name of files) {
      const id = name.slice(0, -5);
      const file = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_TOTAL_BYTES)
          throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'Stored inspection exceeds the 32 MB budget.', 413);
        const stored = StoredSchema.parse(JSON.parse(await file.readFile('utf8')));
        if (stored.view.id !== id)
          throw new ServiceError('SELECTIVE_INTEGRITY', 'Stored selective observations failed integrity checks.', 500);
        this.validateStored(stored);
        this.tasks.set(id, stored); this.sizes.set(id, info.size);
      } finally { await file.close(); }
    }
    if ([...this.sizes.values()].reduce((a, b) => a + b, 0) > MAX_TOTAL_BYTES)
      throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'Selective observations exceed the 32 MB total budget.', 413);
  }
  private async persist(next: Stored): Promise<void> {
    this.healthy();
    const value = StoredSchema.parse(next);
    const encoded = JSON.stringify(value), bytes = Buffer.byteLength(encoded), id = value.view.id;
    if (bytes > MAX_TOTAL_BYTES || [...this.sizes.entries()].reduce((sum, [key, size]) => sum + (key === id ? 0 : size), bytes) > MAX_TOTAL_BYTES)
      throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'Selective observations exceed the 32 MB local budget.', 413);
    await this.directorySafe();
    const temporary = join(this.directory, `${id}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.path(id));
      renamed = true;
      const dir = await open(dirname(this.path(id)), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
      this.tasks.set(id, value); this.sizes.set(id, bytes);
    } catch (error) {
      // After rename, the disk and in-memory versions may disagree. Never rewrite
      // from the older in-memory ledger; restart and validate the file instead.
      if (renamed) this.storageFault = true;
      throw error;
    } finally { await rm(temporary, { force: true }); }
  }
  private async append(task: Stored, observation: SelectiveObservation): Promise<SelectiveReadOutcome> {
    const bytes = encodedBytes(observation);
    if (bytes > MAX_OBSERVATION_BYTES)
      throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'One exact observation exceeds the 1 MB limit.', 413);
    const now = new Date().toISOString();
    const next: Stored = { view: { ...task.view, updatedAt: now,
      observationCount: task.view.observationCount + 1, byteCount: task.view.byteCount + bytes },
      observations: [...task.observations, observation] };
    await this.persist(next);
    return { view: this.view(next), observation: structuredClone(observation), reused: false };
  }
  private cached(task: Stored, entry: SelectiveObservation): SelectiveReadOutcome {
    return { view: this.view(task), observation: structuredClone(entry), reused: true };
  }
  async prepare(projectId: string, expectedRevision: number, sessionId: string, signal?: AbortSignal): Promise<SelectiveInspectionView> {
    return this.run(async joined => {
      this.checkSession(sessionId);
      if (this.tasks.size >= MAX_INSPECTIONS)
        throw new ServiceError('SELECTIVE_STORAGE_LIMIT', 'Remove an inspection before preparing another (maximum twelve).', 413);
      if ((await this.projects.get(projectId)).revision !== expectedRevision)
        throw new ServiceError('REVISION_CONFLICT', 'Project changed; refresh before preparing.', 409);
      const selection = SelectionSchema.parse(await this.broker.request({ type: 'get_selection' },
        { signal: joined, timeoutMs: this.options.requestTimeoutMs ?? 20_000 }));
      this.checkSession(sessionId);
      if (joined.aborted) throw new ServiceError('CANCELLED', 'Preparation was cancelled.', 499);
      if ((await this.projects.get(projectId)).revision !== expectedRevision)
        throw new ServiceError('REVISION_CONFLICT', 'Project changed during preparation.', 409);
      this.checkSession(sessionId);
      if (!selection.fileKey) throw new ServiceError('FILE_IDENTITY_UNAVAILABLE', 'Figma did not expose the source file identity.', 409);
      const node = selection.nodes[0];
      if (selection.nodes.length !== 1 || !node || !['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'].includes(node.type) ||
          !node.bbox || node.bbox.width <= 0 || node.bbox.height <= 0)
        throw new ServiceError('INVALID_SELECTION', 'Select one source container with positive bounds.');
      const now = new Date().toISOString(), id = randomUUID();
      const next: Stored = { view: { id, projectId, sessionId,
        source: { fileKey: selection.fileKey, pageId: selection.pageId, nodeId: node.id,
          name: node.name, type: node.type, bounds: node.bbox },
        createdAt: now, updatedAt: now, observationCount: 0, byteCount: 0,
        reviewStatus: 'unreviewed', consistency: 'live-session-observation' }, observations: [] };
      await this.persist(next);
      return this.view(next);
    }, signal);
  }
  private verifyScope(task: Stored, result: SelectiveNodesResult | SelectiveChildrenResult): void {
    const source = task.view.source;
    if (result.fileKey !== source.fileKey || result.pageId !== source.pageId || result.scopeId !== source.nodeId ||
        result.scope.id !== source.nodeId || result.scope.name !== source.name || result.scope.type !== source.type ||
        !isDeepStrictEqual(result.scope.bbox, source.bounds))
      throw new ServiceError('SOURCE_METADATA_CHANGED', 'The source scope differs from the prepared selection.', 409);
  }
  async readNodes(projectId: string, inspectionId: string, input: unknown, signal?: AbortSignal,
    options: { fresh?: boolean } = {}): Promise<SelectiveReadOutcome> {
    if (this.closed) throw new ServiceError('SERVER_CLOSED', 'Selective acquisition service is stopping.', 503);
    if (signal?.aborted) throw new ServiceError('CANCELLED', 'Selective source request cancelled.', 499);
    const task = this.task(projectId, inspectionId), query = NodesInputSchema.parse(input);
    if (new Set(query.nodeIds).size !== query.nodeIds.length)
      throw new ServiceError('DUPLICATE_ID', 'Requested source IDs must be distinct.');
    const existing = task.observations.find(entry => entry.kind === 'nodes' && entry.result.fields === query.fields &&
      isDeepStrictEqual(entry.result.requestedIds, query.nodeIds));
    if (existing && !options.fresh) return this.cached(task, existing);
    return this.run(async joined => {
      this.checkSession(task.view.sessionId);
      const result = SelectiveNodesResultSchema.parse(await this.broker.request({ type: 'read_source_nodes',
        fileKey: task.view.source.fileKey, pageId: task.view.source.pageId, scopeId: task.view.source.nodeId,
        nodeIds: query.nodeIds, fields: query.fields },
      { signal: joined, timeoutMs: this.options.requestTimeoutMs ?? 20_000 }));
      this.checkSession(task.view.sessionId);
      if (joined.aborted) throw new ServiceError('CANCELLED', 'Source request was cancelled before storage.', 499);
      if (encodedBytes(result) > SELECTIVE_NODES_WIRE_BYTES || result.fields !== query.fields ||
          !isDeepStrictEqual(result.requestedIds, query.nodeIds))
        throw new ServiceError('INVALID_PLUGIN_RESPONSE', 'Requested IDs or fields differ from the plugin result.', 502);
      this.verifyScope(task, result);
      const observation: SelectiveObservation = { id: randomUUID(), kind: 'nodes', result, sha256: digest('nodes', result) };
      return this.append(task, observation);
    }, signal);
  }
  private childPackets(task: Stored, observationId: string): Extract<SelectiveObservation, { kind: 'children' }>[] {
    return task.observations.filter((entry): entry is Extract<SelectiveObservation, { kind: 'children' }> =>
      entry.kind === 'children' && entry.result.observationId === observationId);
  }
  private async release(owner: ChildOwner): Promise<boolean> {
    if (this.broker.status.connected && this.broker.status.sessionId === owner.sessionId) {
      try {
        const result = await this.broker.request({ type: 'release_source_children', observationId: owner.observationId },
          { timeoutMs: this.options.requestTimeoutMs ?? 5_000 }) as { released?: boolean };
        if (result.released !== true) return false;
      } catch { return false; }
    }
    if (this.owner?.observationId === owner.observationId) this.owner = null;
    return true;
  }
  async readChildren(projectId: string, inspectionId: string, input: unknown, signal?: AbortSignal): Promise<SelectiveReadOutcome> {
    if (this.closed) throw new ServiceError('SERVER_CLOSED', 'Selective acquisition service is stopping.', 503);
    if (signal?.aborted) throw new ServiceError('CANCELLED', 'Selective source request cancelled.', 499);
    const task = this.task(projectId, inspectionId), query = ChildrenInputSchema.parse(input);
    if (query.offset > 0 && !query.observationId)
      throw new ServiceError('CURSOR_SEQUENCE', 'Continuation requires the original observation ID.', 409);
    const observationId = query.observationId ?? randomUUID();
    const packets = this.childPackets(task, observationId);
    const replay = packets.find(entry => entry.result.offset === query.offset);
    if (replay) {
      if (replay.result.parentId !== query.parentId || replay.result.nodes.length > query.limit)
        throw new ServiceError('CURSOR_MISMATCH', 'Stored child packet differs from the request.', 409);
      return this.cached(task, replay);
    }
    if (!query.observationId) {
      // A fully acknowledged historical child inventory is reusable offline.
      const completed = [...task.observations].reverse().find(entry => entry.kind === 'children' &&
        entry.result.parentId === query.parentId && entry.result.childrenComplete);
      if (completed?.kind === 'children') {
        const first = this.childPackets(task, completed.result.observationId).find(entry => entry.result.offset === 0);
        if (first && first.result.nodes.length <= query.limit) return this.cached(task, first);
      }
    }
    return this.run(async joined => {
      this.checkSession(task.view.sessionId);
      const active = this.currentOwner();
      if (active && (active.projectId !== projectId || active.inspectionId !== inspectionId ||
          active.observationId !== observationId || active.parentId !== query.parentId))
        throw new ServiceError('SELECTIVE_BUSY', 'Resume or release the prior child inventory before opening another parent.', 409);
      const previous = packets.at(-1);
      if (previous) {
        if (previous.result.childrenComplete || previous.result.nextOffset !== query.offset || !active)
          throw new ServiceError('CURSOR_UNAVAILABLE', 'The live child cursor cannot continue at this offset.', 409);
      } else if (query.offset !== 0) {
        throw new ServiceError('CURSOR_SEQUENCE', 'Start this child inventory at offset zero.', 409);
      }
      if (!active) this.owner = { projectId, inspectionId, sessionId: task.view.sessionId, observationId, parentId: query.parentId };
      let result: SelectiveChildrenResult;
      try {
        result = SelectiveChildrenResultSchema.parse(await this.broker.request({ type: 'read_source_children',
          fileKey: task.view.source.fileKey, pageId: task.view.source.pageId, scopeId: task.view.source.nodeId,
          parentId: query.parentId, observationId, offset: query.offset, limit: query.limit },
        { signal: joined, timeoutMs: this.options.requestTimeoutMs ?? 20_000 }));
        this.checkSession(task.view.sessionId);
        if (joined.aborted) throw new ServiceError('CANCELLED', 'Child packet was cancelled before storage.', 499);
        if (encodedBytes(result) > SELECTIVE_CHILDREN_WIRE_BYTES || result.parentId !== query.parentId ||
            result.observationId !== observationId || result.offset !== query.offset || result.nodes.length > query.limit)
          throw new ServiceError('INVALID_PLUGIN_RESPONSE', 'The immediate-child packet differs from the request.', 502);
        this.verifyScope(task, result);
        if (previous && (previous.result.totalChildren !== result.totalChildren ||
            previous.result.startedAt !== result.startedAt || !isDeepStrictEqual(previous.result.parent, result.parent) ||
            !isDeepStrictEqual(previous.result.scope, result.scope) ||
            Date.parse(previous.result.observedAt) > Date.parse(result.observedAt)))
          throw new ServiceError('SOURCE_METADATA_CHANGED', 'The child inventory changed between packets.', 409);
      } catch (error) {
        // A lost reply or cancellation may have advanced the plugin cursor; keep
        // ownership for same-offset replay. Deterministic rejection can release it.
        const uncertain = error instanceof ServiceError &&
          ['PLUGIN_TIMEOUT', 'PLUGIN_BUSY', 'CANCELLED'].includes(error.code);
        if (!uncertain && this.owner?.observationId === observationId && !await this.release(this.owner))
          throw new ServiceError('CURSOR_RELEASE_FAILED', 'Figma did not acknowledge releasing this child cursor. Retry the same page or reconnect.', 409);
        throw error;
      }
      const observation: SelectiveObservation = { id: randomUUID(), kind: 'children', result, sha256: digest('children', result) };
      const saved = await this.append(task, observation);
      if (result.childrenComplete && this.owner) await this.release(this.owner);
      return saved;
    }, signal);
  }
  async remove(projectId: string, id: string): Promise<void> {
    const task = this.task(projectId, id);
    await this.run(async () => {
      const owner = this.currentOwner();
      if (owner?.inspectionId === id && !await this.release(owner))
        throw new ServiceError('CURSOR_RELEASE_FAILED', 'Figma did not acknowledge releasing this child cursor. Retry removal or reconnect.', 409);
      await rm(this.path(id));
      this.tasks.delete(task.view.id); this.sizes.delete(task.view.id);
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.active) { this.active.controller.abort(); await this.active.done; }
    this.owner = null;
  }
}
