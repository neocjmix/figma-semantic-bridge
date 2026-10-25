import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  CollectionQuerySchema, CollectionTextQuerySchema, CollectionViewSchema, StructureChunkSchema,
  STRUCTURE_CHUNK_BYTES, STRUCTURE_COLLECTION_BYTES, STRUCTURE_COLLECTION_NODES,
  type CollectionQuery, type CollectionSource, type CollectionTextQuery, type CollectionView, type StructureChunk,
} from '../shared/structure-collection.js';
import type { CollectionReference, SourceNode } from '../shared/contracts.js';
import { ServiceError } from './errors.js';

export type CollectionPage = { nodes: (Omit<SourceNode, 'text'> & { textLength: number | null })[]; nextOffset: number | null; total: number; complete: true; reviewStatus: 'unreviewed' };
export type CollectionText = { nodeId: string; text: string; offset: number; nextOffset: number | null; totalLength: number; reviewStatus: 'unreviewed' };
type Create = { id: string; projectId: string; sessionId: string; source: CollectionSource };
type Patch = Partial<Pick<CollectionView, 'status' | 'elapsedMs' | 'error' | 'warnings'>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COLLECTIONS = 12, MAX_DISK_BYTES = 256_000_000, MAX_MANIFEST_BYTES = 16_000_000, MAX_PAGE_BYTES = 96_000;
const DescriptorSchema = z.object({ sequence: z.number().int().min(0), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(STRUCTURE_CHUNK_BYTES), nodeCount: z.number().int().min(1).max(500) }).strict();
const ManifestSchema = z.object({ version: z.literal(1), view: CollectionViewSchema,
  chunks: z.array(DescriptorSchema).max(STRUCTURE_COLLECTION_NODES) }).strict();
const PatchSchema = CollectionViewSchema.pick({ status: true, elapsedMs: true, error: true, warnings: true }).partial().strict();
type Manifest = z.infer<typeof ManifestSchema>;
type Location = { sequence: number; offset: number };
type Frontier = { id: string; remaining: number; previous: Frontier | null };
type Runtime = { manifest: Manifest; manifestBytes: number; index: Map<string, Location>; order: string[];
  children: Map<string, string[]>; frontier: Frontier | null; root: SourceNode | null;
  startedAt: string | null; observedAt: string | null; orphans: Map<number, number> };
type Accepted = { chunk: StructureChunk; frontier: Frontier | null };
function invalid(message: string): never { throw new ServiceError('INVALID_COLLECTION', message); }
function integrity(): never { throw new ServiceError('COLLECTION_INTEGRITY', 'Stored source collection failed integrity validation.', 500); }
function limit(): never { throw new ServiceError('COLLECTION_LIMIT', 'Source collection exceeds its bounded record, packet or storage budget.', 413); }
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const terminal = new Set<CollectionView['status']>(['complete', 'failed', 'cancelled', 'interrupted']);
function empty(manifest: Manifest, manifestBytes: number): Runtime {
  return { manifest, manifestBytes, index: new Map(), order: [], children: new Map(), frontier: null,
    root: null, startedAt: null, observedAt: null, orphans: new Map() };
}
function warnings(previous: string[], incoming: string[]): string[] {
  const values = [...new Set([...previous, ...incoming])];
  return values.length <= 100 ? values : [...values.slice(0, 99), 'Additional warnings remain available in the stored source chunks.'];
}

/** Separate raw observations: no Project/Snapshot materialization or semantic approval. */
export class CollectionStore {
  private readonly directory: string;
  private readonly collections = new Map<string, Runtime>();
  private mutation: Promise<unknown> = Promise.resolve();
  private leases=new Map<string,number>();
  constructor(readonly dataDir: string) { this.directory = join(resolve(dataDir), 'structure-collections'); }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    // Also serialize quota reservations across collections, not only per-ID writes.
    const result = this.mutation.catch(() => {}).then(work); this.mutation = result; return result;
  }
  private path(id: string): string {
    if (!UUID.test(id)) throw new ServiceError('NOT_FOUND', 'Source collection not found.', 404);
    return join(this.directory, id);
  }
  private task(projectId: string, id: string): Runtime {
    this.path(id);
    const runtime = this.collections.get(id);
    if (!runtime || runtime.manifest.view.projectId !== projectId) throw new ServiceError('NOT_FOUND', 'Source collection not found.', 404);
    return runtime;
  }
  private async directorySafe(path: string): Promise<void> {
    const info = await lstat(path).catch(() => integrity());
    if (!info.isDirectory() || info.isSymbolicLink()) integrity();
  }
  private async read(path: string, maxBytes: number): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => integrity());
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxBytes) integrity();
      // Bound the allocation even if another process grows the file after stat.
      const bytes = Buffer.alloc(info.size + 1); let length = 0;
      while (length < bytes.length) {
        const read = await file.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break; length += read.bytesRead;
      }
      if (length !== info.size) integrity();
      return bytes.subarray(0, length);
    } finally { await file.close(); }
  }
  private async atomic(path: string, encoded: string): Promise<void> {
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
      const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
  }
  private diskBytes(): number {
    let bytes = 0;
    for (const runtime of this.collections.values()) {
      bytes += runtime.manifestBytes;
      for (const chunk of runtime.manifest.chunks) bytes += chunk.bytes;
      for (const orphan of runtime.orphans.values()) bytes += orphan;
    }
    return bytes;
  }
  private async save(runtime: Runtime, manifest: Manifest, beforePublish?: () => void): Promise<void> {
    const encoded = JSON.stringify(ManifestSchema.parse(manifest)), bytes = Buffer.byteLength(encoded);
    if (bytes > MAX_MANIFEST_BYTES || this.diskBytes() - runtime.manifestBytes + bytes > MAX_DISK_BYTES) limit();
    await this.directorySafe(this.path(manifest.view.id));
    await this.atomic(join(this.path(manifest.view.id), 'manifest.json'), encoded);
    // Publish the index and view in one synchronous continuation, after durability.
    beforePublish?.();
    runtime.manifest = manifest; runtime.manifestBytes = bytes;
  }
  private parse(bytes: Buffer): StructureChunk {
    try { return StructureChunkSchema.parse(JSON.parse(bytes.toString('utf8'))); } catch { return integrity(); }
  }
  private async chunk(runtime: Runtime, sequence: number): Promise<StructureChunk> {
    const descriptor = runtime.manifest.chunks[sequence]; if (!descriptor) return integrity();
    await this.directorySafe(this.path(runtime.manifest.view.id));
    const bytes = await this.read(join(this.path(runtime.manifest.view.id), `${sequence}.json`), STRUCTURE_CHUNK_BYTES);
    if (bytes.length !== descriptor.bytes || hash(bytes) !== descriptor.sha256) integrity();
    const chunk = this.parse(bytes);
    if (chunk.sequence !== sequence || chunk.collectionId !== runtime.manifest.view.id || chunk.nodes.length !== descriptor.nodeCount) integrity();
    return chunk;
  }
  private accept(runtime: Runtime, chunk: StructureChunk): Accepted {
    const { view } = runtime.manifest, pinned = view.source;
    if (chunk.collectionId !== view.id || chunk.fileKey !== pinned.fileKey || chunk.pageId !== pinned.pageId ||
      chunk.root.id !== pinned.nodeId || chunk.root.name !== pinned.name || chunk.root.type !== pinned.type ||
      !isDeepStrictEqual(chunk.bounds, pinned.bounds) || !isDeepStrictEqual(chunk.root.bbox, pinned.bounds) ||
      chunk.root.sourceFileKey !== pinned.fileKey || chunk.root.sourcePageId !== pinned.pageId || chunk.root.parentId === chunk.root.id ||
      (pinned.parentId!==undefined&&chunk.root.parentId!==pinned.parentId))
      invalid('Chunk source identity or root metadata differs from the prepared scope.');
    if (runtime.root && !isDeepStrictEqual(runtime.root, chunk.root)) invalid('Root metadata changed between chunks.');
    if (chunk.sequence !== runtime.manifest.chunks.length || chunk.childCounts.length !== chunk.nodes.length ||
      chunk.nextSequence !== (chunk.complete ? null : chunk.sequence + 1)) invalid('Chunk sequence or coverage declaration is invalid.');
    if ((runtime.startedAt !== null && chunk.startedAt !== runtime.startedAt) || Date.parse(chunk.observedAt) < Date.parse(chunk.startedAt) ||
      (runtime.observedAt !== null && Date.parse(chunk.observedAt) < Date.parse(runtime.observedAt))) invalid('Chunk observation times are inconsistent.');
    if (runtime.index.size + chunk.nodes.length > STRUCTURE_COLLECTION_NODES) limit();
    const ids = new Set<string>(); let frontier = runtime.frontier;
    for (let offset = 0; offset < chunk.nodes.length; offset++) {
      const node = chunk.nodes[offset]!, count = chunk.childCounts[offset]!;
      if (node.sourceFileKey !== pinned.fileKey || node.sourcePageId !== pinned.pageId || node.id === chunk.root.parentId ||
        runtime.index.has(node.id) || ids.has(node.id)) invalid('Chunk contains duplicate IDs or inconsistent node provenance.');
      ids.add(node.id);
      if (chunk.sequence === 0 && offset === 0) {
        if (!isDeepStrictEqual(node, chunk.root)) invalid('The first source record must be the pinned root.');
      } else {
        if (!frontier || node.parentId !== frontier.id) invalid('Source preorder or declared child counts leave missing or unexpected records.');
        frontier = frontier.remaining === 1 ? frontier.previous : { ...frontier, remaining: frontier.remaining - 1 };
      }
      if (count > 0) frontier = { id: node.id, remaining: count, previous: frontier };
    }
    if (chunk.complete !== (frontier === null)) invalid('Complete coverage requires every declared child to be observed.');
    return { chunk, frontier };
  }
  private index(runtime: Runtime, accepted: Accepted): void {
    const { chunk } = accepted;
    for (let offset = 0; offset < chunk.nodes.length; offset++) {
      const node = chunk.nodes[offset]!;
      runtime.index.set(node.id, { sequence: chunk.sequence, offset }); runtime.order.push(node.id);
      if (node.id !== chunk.root.id && node.parentId !== null) {
        let children = runtime.children.get(node.parentId);
        if (!children) { children = []; runtime.children.set(node.parentId, children); }
        children.push(node.id);
      }
    }
    runtime.root ??= chunk.root; runtime.startedAt ??= chunk.startedAt; runtime.observedAt = chunk.observedAt;
    runtime.frontier = accepted.frontier;
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); await this.directorySafe(this.directory);
    const names = (await readdir(this.directory)).filter(name => UUID.test(name));
    if (names.length > MAX_COLLECTIONS) limit();
    const loaded = new Map<string, Runtime>();
    for (const id of names) {
      const directory = this.path(id); await this.directorySafe(directory);
      const files = await readdir(directory);
      for (const name of files) if (/^(manifest|\d+)\.json\.[0-9a-f-]+\.tmp$/i.test(name)) await rm(join(directory, name), { force: true });
      if (!files.includes('manifest.json')) {
        if ((await readdir(directory)).length === 0) { await rm(directory, { recursive: true }); continue; }
        integrity();
      }
      const raw = await this.read(join(directory, 'manifest.json'), MAX_MANIFEST_BYTES);
      let manifest: Manifest;
      try { manifest = ManifestSchema.parse(JSON.parse(raw.toString('utf8'))); } catch { return integrity(); }
      if (manifest.view.id !== id || !UUID.test(manifest.view.projectId)) integrity();
      const runtime = empty({ ...manifest, chunks: [] }, raw.length); let bytes = 0;
      try {
        for (const descriptor of manifest.chunks) {
          if (descriptor.sequence !== runtime.manifest.chunks.length) integrity();
          const encoded = await this.read(join(directory, `${descriptor.sequence}.json`), STRUCTURE_CHUNK_BYTES);
          if (encoded.length !== descriptor.bytes || hash(encoded) !== descriptor.sha256) integrity();
          const chunk = this.parse(encoded); if (chunk.nodes.length !== descriptor.nodeCount) integrity();
          const accepted = this.accept(runtime, chunk); this.index(runtime, accepted); runtime.manifest.chunks.push(descriptor); bytes += encoded.length;
          if (chunk.complete && descriptor.sequence !== manifest.chunks.length - 1) integrity();
        }
        if (bytes !== manifest.view.byteCount || bytes > STRUCTURE_COLLECTION_BYTES || runtime.index.size !== manifest.view.nodeCount ||
          manifest.chunks.length !== manifest.view.chunkCount || (manifest.view.status === 'complete') !== (manifest.chunks.length > 0 && runtime.frontier === null) ||
          (manifest.view.status === 'prepared' && manifest.chunks.length > 0) || (manifest.view.status === 'complete') !== (manifest.view.finishedAt !== null)) integrity();
      } catch (error) { if (error instanceof ServiceError && error.code === 'COLLECTION_INTEGRITY') throw error; integrity(); }
      runtime.manifest = manifest;
      for (const name of files) {
        if (!/^(0|[1-9]\d*)\.json$/.test(name)) continue;
        const sequence = Number(name.slice(0, -5));
        if (sequence >= manifest.chunks.length) runtime.orphans.set(sequence, (await this.read(join(directory, name), STRUCTURE_CHUNK_BYTES)).length);
      }
      loaded.set(id, runtime);
    }
    this.collections.clear(); for (const [id, runtime] of loaded) this.collections.set(id, runtime);
    if (this.diskBytes() > MAX_DISK_BYTES) { this.collections.clear(); limit(); }
    for (const runtime of this.collections.values()) {
      if (['running', 'paused'].includes(runtime.manifest.view.status)) {
        const view = { ...runtime.manifest.view, status: 'interrupted' as const, updatedAt: new Date().toISOString(),
          error: { code: 'COLLECTION_INTERRUPTED', message: 'The server restarted. The prior live traversal cannot continue; prepare a new collection.' } };
        await this.save(runtime, { ...runtime.manifest, view });
      }
    }
  }
  async create(input: Create): Promise<CollectionView> {
    return this.exclusive(async () => {
      const path = this.path(input.id);
      if (!UUID.test(input.projectId)) invalid('Collection project identity must be a UUID.');
      if (this.collections.has(input.id)) throw new ServiceError('ALREADY_EXISTS', 'Source collection already exists.', 409);
      if (this.collections.size >= MAX_COLLECTIONS) limit();
      const now = new Date().toISOString();
      const parsed = CollectionViewSchema.safeParse({ ...input, status: 'prepared', nodeCount: 0, byteCount: 0, chunkCount: 0,
        createdAt: now, updatedAt: now, finishedAt: null, elapsedMs: 0, error: null, warnings: [], consistency: 'live-session-observation', reviewStatus: 'unreviewed' });
      if (!parsed.success) invalid('Invalid collection source descriptor.');
      const manifest: Manifest = { version: 1, view: parsed.data, chunks: [] }, encoded = JSON.stringify(manifest);
      if (this.diskBytes() + Buffer.byteLength(encoded) > MAX_DISK_BYTES) limit();
      await this.directorySafe(this.directory);
      await mkdir(path, { mode: 0o700 });
      try { await this.atomic(join(path, 'manifest.json'), encoded); }
      catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
      this.collections.set(input.id, empty(manifest, Buffer.byteLength(encoded))); return structuredClone(manifest.view);
    });
  }
  list(projectId: string): CollectionView[] { return [...this.collections.values()].filter(value => value.manifest.view.projectId === projectId).map(value => structuredClone(value.manifest.view)); }
  get(projectId: string, id: string): CollectionView { return structuredClone(this.task(projectId, id).manifest.view); }
  async update(projectId: string, id: string, input: Patch): Promise<CollectionView> {
    return this.exclusive(async () => {
      const runtime = this.task(projectId, id), parsed = PatchSchema.safeParse(input);
      if (!parsed.success) invalid('Invalid collection state update.');
      const previous = runtime.manifest.view, patch = parsed.data;
      if (patch.status && patch.status !== previous.status && (terminal.has(previous.status) || patch.status === 'complete' || patch.status === 'prepared'))
        invalid('This update cannot complete or restart a terminal collection.');
      const view: CollectionView = { ...previous, status: patch.status ?? previous.status,
        elapsedMs: patch.elapsedMs ?? previous.elapsedMs, warnings: patch.warnings ?? previous.warnings,
        error: patch.error === undefined ? previous.error : patch.error, updatedAt: new Date().toISOString() };
      await this.save(runtime, { ...runtime.manifest, view }); return structuredClone(view);
    });
  }
  async append(projectId: string, id: string, input: StructureChunk): Promise<CollectionView> {
    return this.exclusive(async () => {
      const runtime = this.task(projectId, id);
      let encoded: string;
      try { encoded = JSON.stringify(input); } catch { return invalid('Invalid source chunk.'); }
      if (Buffer.byteLength(encoded) > STRUCTURE_CHUNK_BYTES) limit();
      const parsed = StructureChunkSchema.safeParse(input); if (!parsed.success) invalid('Invalid source chunk schema.');
      const chunk = parsed.data; encoded = JSON.stringify(chunk);
      const bytes = Buffer.byteLength(encoded), digest = hash(encoded), prior = runtime.manifest.chunks[chunk.sequence];
      if (prior) {
        await this.chunk(runtime, chunk.sequence);
        if (prior.sha256 !== digest) invalid('A replay changed a previously recorded chunk.');
        return structuredClone(runtime.manifest.view);
      }
      if (terminal.has(runtime.manifest.view.status)) invalid('Terminal collections cannot accept new source records.');
      if (runtime.manifest.view.byteCount + bytes > STRUCTURE_COLLECTION_BYTES) limit();
      const accepted = this.accept(runtime, chunk), now = new Date().toISOString();
      const view: CollectionView = { ...runtime.manifest.view, status: chunk.complete ? 'complete' : runtime.manifest.view.status === 'paused' ? 'paused' : 'running',
        nodeCount: runtime.index.size + chunk.nodes.length, byteCount: runtime.manifest.view.byteCount + bytes, chunkCount: chunk.sequence + 1,
        updatedAt: now, finishedAt: chunk.complete ? now : null, warnings: warnings(runtime.manifest.view.warnings, chunk.warnings) };
      const manifest: Manifest = { version: 1, view, chunks: [...runtime.manifest.chunks, { sequence: chunk.sequence, sha256: digest, bytes, nodeCount: chunk.nodes.length }] };
      const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
      if (manifestBytes > MAX_MANIFEST_BYTES || this.diskBytes() - runtime.manifestBytes - (runtime.orphans.get(chunk.sequence) ?? 0) + bytes + manifestBytes > MAX_DISK_BYTES) limit();
      await this.directorySafe(this.path(id));
      const path = join(this.path(id), `${chunk.sequence}.json`);
      // A packet written before a crash is not acknowledged until the manifest
      // references it. It may be replaced; committed packet files never are.
      const existing = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.size > STRUCTURE_CHUNK_BYTES)) integrity();
      if (!existing || hash(await this.read(path, STRUCTURE_CHUNK_BYTES)) !== digest) await this.atomic(path, encoded);
      runtime.orphans.set(chunk.sequence, bytes);
      await this.save(runtime, manifest, () => { runtime.orphans.delete(chunk.sequence); this.index(runtime, accepted); });
      return structuredClone(view);
    });
  }
  private complete(projectId: string, id: string): Runtime {
    const runtime = this.task(projectId, id);
    if (runtime.manifest.view.status !== 'complete') throw new ServiceError('SOURCE_INCOMPLETE', 'Complete the entire selected source collection before querying its records.', 409);
    return runtime;
  }
  descriptor(projectId:string,id:string):CollectionReference {
    const runtime=this.complete(projectId,id),view=runtime.manifest.view;
    return {id,contentHash:hash(JSON.stringify({source:view.source,chunks:runtime.manifest.chunks})),
      nodeCount:view.nodeCount,byteCount:view.byteCount,observedAt:runtime.observedAt!};
  }
  hasNode(projectId:string,id:string,nodeId:string):boolean {return this.complete(projectId,id).index.has(nodeId);}
  async using<T>(projectId:string,id:string,work:()=>Promise<T>):Promise<T>{
    await this.exclusive(async()=>{this.complete(projectId,id);this.leases.set(id,(this.leases.get(id)??0)+1);});
    try{return await work();}finally{const count=(this.leases.get(id)??1)-1;if(count)this.leases.set(id,count);else this.leases.delete(id);}
  }
  async *iterate(projectId:string,id:string):AsyncGenerator<StructureChunk> {
    const runtime=this.complete(projectId,id);
    for(let sequence=0;sequence<runtime.manifest.chunks.length;sequence++)yield await this.chunk(runtime,sequence);
  }
  async records(projectId:string,id:string,nodeIds:readonly string[]):Promise<SourceNode[]> {
    const runtime=this.complete(projectId,id),loaded=new Map<number,StructureChunk>(),records:SourceNode[]=[];
    for(const nodeId of nodeIds){
      const location=runtime.index.get(nodeId);
      if(!location)throw new ServiceError('NOT_FOUND','Requested source node is not in this collection.',404);
      let packet=loaded.get(location.sequence);
      if(!packet){packet=await this.chunk(runtime,location.sequence);loaded.clear();loaded.set(location.sequence,packet);}
      records.push(packet.nodes[location.offset]!);
    }
    return records;
  }
  async query(projectId: string, id: string, input: CollectionQuery): Promise<CollectionPage> {
    const runtime = this.complete(projectId, id), parsed = CollectionQuerySchema.safeParse(input);
    if (!parsed.success) throw new ServiceError('INVALID_COLLECTION_QUERY', 'Invalid source page query.');
    const query = parsed.data;
    if (query.nodeIds && new Set(query.nodeIds).size !== query.nodeIds.length) throw new ServiceError('INVALID_COLLECTION_QUERY', 'Request distinct source node IDs.');
    if (query.nodeIds?.some(nodeId => !runtime.index.has(nodeId)) || (query.parentId !== undefined && !runtime.index.has(query.parentId)))
      throw new ServiceError('NOT_FOUND', 'Requested source node is not in this collection.', 404);
    let ids = query.parentId === undefined ? runtime.order : runtime.children.get(query.parentId) ?? [];
    if (query.nodeIds) { const parents = query.parentId === undefined ? null : new Set(ids); ids = query.nodeIds.filter(nodeId => !parents || parents.has(nodeId)); }
    if(query.query||query.textOnly){
      const allowed=new Set(ids),found:string[]=[],needle=query.query?.toLocaleLowerCase()??'';
      for await(const packet of this.iterate(projectId,id))for(const node of packet.nodes)
        if(allowed.has(node.id)&&(!query.textOnly||node.type==='TEXT')&&(!needle||node.id.toLocaleLowerCase().includes(needle)||node.name.toLocaleLowerCase().includes(needle)))found.push(node.id);
      ids=found;
    }
    const result: CollectionPage = { nodes: [], nextOffset: null, total: ids.length, complete: true, reviewStatus: 'unreviewed' };
    let loaded: StructureChunk | null = null, next = query.offset;
    for (const nodeId of ids.slice(query.offset, query.offset + query.limit)) {
      const location = runtime.index.get(nodeId)!;
      if (loaded?.sequence !== location.sequence) loaded = await this.chunk(runtime, location.sequence);
      const { text, ...node } = loaded.nodes[location.offset]!;
      const summary = { ...node, textLength: text === undefined ? null : text.length };
      const candidate: CollectionPage = { ...result, nodes: [...result.nodes, summary], nextOffset: next + 1 < ids.length ? next + 1 : null };
      if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_PAGE_BYTES) break;
      result.nodes.push(summary); next++;
    }
    result.nextOffset = next < ids.length ? next : null;
    if (!result.nodes.length && query.offset < ids.length) throw new ServiceError('RESPONSE_LIMIT', 'One source summary exceeds the response byte budget.', 413);
    return result;
  }
  async text(projectId: string, id: string, input: CollectionTextQuery): Promise<CollectionText> {
    const runtime = this.complete(projectId, id), parsed = CollectionTextQuerySchema.safeParse(input);
    if (!parsed.success) throw new ServiceError('INVALID_COLLECTION_QUERY', 'Invalid source text query.');
    const query = parsed.data, location = runtime.index.get(query.nodeId);
    if (!location) throw new ServiceError('NOT_FOUND', 'Requested source node is not in this collection.', 404);
    const value = (await this.chunk(runtime, location.sequence)).nodes[location.offset]!.text;
    if (value === undefined) throw new ServiceError('TEXT_UNAVAILABLE', 'This source record has no observed text field.', 409);
    const splits = (offset: number) => offset > 0 && offset < value.length && /[\uD800-\uDBFF]/.test(value[offset - 1]!) && /[\uDC00-\uDFFF]/.test(value[offset]!);
    if (query.offset > value.length || splits(query.offset)) throw new ServiceError('INVALID_COLLECTION_QUERY', 'Text offset must lie on a valid UTF-16 character boundary.');
    let end = Math.min(value.length, query.offset + query.limit); if (splits(end)) end--;
    if (end === query.offset && end < value.length) throw new ServiceError('INVALID_COLLECTION_QUERY', 'Use a text limit of at least two code units for this character.');
    return { nodeId: query.nodeId, text: value.slice(query.offset, end), offset: query.offset,
      nextOffset: end < value.length ? end : null, totalLength: value.length, reviewStatus: 'unreviewed' };
  }
  async remove(projectId: string, id: string, ensureUnbound?: () => Promise<void>): Promise<void> {
    return this.exclusive(async () => {
      if(this.leases.has(id))throw new ServiceError('COLLECTION_BUSY','This source collection is being attached or transferred.',409);
      const runtime = this.task(projectId, id);
      if (runtime.manifest.view.status === 'running') throw new ServiceError('COLLECTION_BUSY', 'Stop the live traversal before removing its collection.', 409);
      // Every source binding reserves a lease in this same exclusive queue.
      // Recheck the project while new leases cannot start, immediately before deletion.
      await ensureUnbound?.();
      await this.directorySafe(this.path(id)); await rm(this.path(id), { recursive: true }); this.collections.delete(id);
    });
  }
}
