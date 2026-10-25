import { utf8Bytes } from '../fixture-analysis/index.js';
import { SourceNodeSchema, type SourceNode } from '../shared/contracts.js';
import {
  SELECTIVE_CHILDREN_WIRE_BYTES, SELECTIVE_CURSOR_IDLE_MS, SELECTIVE_NODES_WIRE_BYTES,
  SelectiveReadChildrenCommandSchema, SelectiveReadNodesCommandSchema,
  type SelectiveReadChildrenCommand, type SelectiveReadNodesCommand,
} from '../shared/selective-source.js';
import {
  SelectiveChildrenResultSchema, SelectiveMetadataNodeSchema, SelectiveNodesResultSchema,
  type SelectiveChildrenResult, type SelectiveNodesResult,
} from '../shared/selective-source-results.js';
import { PluginCommandError, type CaptureHost, type FigmaReadableNode } from './capture.js';

type Host = Pick<CaptureHost, 'fileKey' | 'currentPage' | 'skipInvisibleInstanceChildren' | 'getNodeByIdAsync'>;
type MetadataNode = Omit<SourceNode, 'text'>;
type ChildCursor = {
  command: SelectiveReadChildrenCommand;
  scope: MetadataNode; parent: MetadataNode; children: readonly FigmaReadableNode[];
  startedAt: string; epoch: number; serial: number; lastAccess: number;
  nextOffset: number; lastPacket: SelectiveChildrenResult | null; seen: Set<string>;
};
export interface SelectiveReadOptions { cancelled?: () => boolean; yieldControl?: () => Promise<void> }
export interface SelectiveReaderOptions {
  now?: () => number; observedAt?: () => string; getChangeEpoch?: () => number; idleMs?: number;
}

function fail(code: string, message: string): never { throw new PluginCommandError(code, message); }
function metadata(node: FigmaReadableNode, fileKey: string, pageId: string, siblingIndex?: number): MetadataNode {
  // Do not inspect children or characters here. Text availability is a separate field.
  const bounds = node.absoluteBoundingBox;
  const bbox = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width >= 0 && bounds.height >= 0
    ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
  const rendering: NonNullable<SourceNode['rendering']> = {};
  if (siblingIndex !== undefined) rendering.siblingIndex = siblingIndex;
  if (typeof node.opacity === 'number' && Number.isFinite(node.opacity) && node.opacity >= 0 && node.opacity <= 1)
    rendering.opacity = node.opacity;
  const result = SelectiveMetadataNodeSchema.safeParse({
    id: node.id, parentId: node.parent?.id ?? null, name: node.name, type: node.type,
    bbox, visible: node.visible !== false, rendering, sourceFileKey: fileKey, sourcePageId: pageId,
  });
  if (!result.success) fail('INVALID_SOURCE_METADATA', 'A source field exceeds its schema limit; nothing was truncated.');
  return result.data;
}
function hasAncestor(node: FigmaReadableNode, ancestorId: string): boolean {
  const seen = new Set<string>(); let current: FigmaReadableNode | null = node;
  for (let hops = 0; current && hops < 256; hops++) {
    if (seen.has(current.id)) return false;
    if (current.id === ancestorId) return true;
    seen.add(current.id); current = current.parent;
  }
  return false;
}
function within(node: FigmaReadableNode, scopeId: string, pageId: string): void {
  if (!hasAncestor(node, pageId)) fail('WRONG_PAGE', 'The requested node is not on the pinned current page.');
  if (!hasAncestor(node, scopeId)) fail('WRONG_SCOPE', 'The requested node is outside the pinned source scope.');
}
function sameMetadata(a: MetadataNode, b: MetadataNode): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Current-page, explicit-ID reads. No selection changes, descendants or Figma document writes. */
export class SelectiveReader {
  private cursor: ChildCursor | null = null;
  private invalidatedObservationId: string | null = null;
  private serial = 0;
  private reading = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly observedAt: () => string;
  private readonly getChangeEpoch: () => number;
  private readonly idleMs: number;
  constructor(private readonly host: Host, options: SelectiveReaderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.observedAt = options.observedAt ?? (() => new Date().toISOString());
    this.getChangeEpoch = options.getChangeEpoch ?? (() => 0);
    this.idleMs = options.idleMs ?? SELECTIVE_CURSOR_IDLE_MS;
  }
  hasCursor(): boolean { return this.cursor !== null; }
  clear(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null; this.serial++; this.cursor = null; this.invalidatedObservationId = null;
  }
  invalidateSource(): void {
    const observationId = this.cursor?.command.observationId ?? null;
    this.clear(); this.invalidatedObservationId = observationId;
  }
  release(observationId: string): { released: true } {
    if (this.cursor?.command.observationId === observationId) this.clear();
    if (this.invalidatedObservationId === observationId) this.invalidatedObservationId = null;
    return { released: true };
  }
  private refreshIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.cursor) return;
    this.cursor.lastAccess = this.now();
    const timer = setTimeout(() => this.clear(), this.idleMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.idleTimer = timer;
  }
  private check(fileKey: string, pageId: string, epoch: number, serial: number, options: SelectiveReadOptions): void {
    if (options.cancelled?.()) fail('CANCELLED', 'Selective source reading was cancelled.');
    if (serial !== this.serial || this.getChangeEpoch() !== epoch ||
      this.host.fileKey !== fileKey || this.host.currentPage.id !== pageId) {
      this.invalidateSource(); fail('SOURCE_CHANGED', 'The current source changed during selective reading.');
    }
  }
  private initial(fileKey: string, pageId: string, options: SelectiveReadOptions): { epoch: number; serial: number } {
    if (options.cancelled?.()) fail('CANCELLED', 'Selective source reading was cancelled.');
    if (!this.host.fileKey) fail('FILE_IDENTITY_UNAVAILABLE', 'Figma did not expose the current file identity.');
    if (this.host.fileKey !== fileKey) fail('WRONG_FILE', 'The connected plugin is in another source file.');
    if (this.host.currentPage.id !== pageId) fail('WRONG_PAGE', 'Open the pinned source page before reading.');
    return { epoch: this.getChangeEpoch(), serial: this.serial };
  }
  private async resolve(id: string, fileKey: string, pageId: string, scopeId: string,
    epoch: number, serial: number, options: SelectiveReadOptions): Promise<FigmaReadableNode> {
    const node = await this.host.getNodeByIdAsync(id);
    this.check(fileKey, pageId, epoch, serial, options);
    if (!node || node.id !== id) fail('NODE_UNAVAILABLE', 'The requested source node is unavailable.');
    within(node, scopeId, pageId);
    return node;
  }
  private async verifyScope(scope: MetadataNode, fileKey: string, pageId: string,
    epoch: number, serial: number, options: SelectiveReadOptions): Promise<void> {
    const current = await this.resolve(scope.id, fileKey, pageId, scope.id, epoch, serial, options);
    if (!sameMetadata(metadata(current, fileKey, pageId), scope)) {
      this.invalidateSource(); fail('SOURCE_CHANGED', 'Pinned scope metadata changed during selective reading.');
    }
  }
  async readNodes(raw: SelectiveReadNodesCommand, options: SelectiveReadOptions = {}): Promise<SelectiveNodesResult> {
    if (this.reading) fail('PLUGIN_BUSY', 'Another selective source read is active.');
    const command = SelectiveReadNodesCommandSchema.parse(raw);
    if (new Set(command.nodeIds).size !== command.nodeIds.length)
      fail('DUPLICATE_ID', 'Requested source IDs must be distinct.');
    this.reading = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const previous = this.host.skipInvisibleInstanceChildren;
    try {
      this.host.skipInvisibleInstanceChildren = false;
      const { fileKey, pageId, scopeId } = command;
      const { epoch, serial } = this.initial(fileKey, pageId, options);
      const startedAt = this.observedAt();
      const scopeNode = await this.resolve(scopeId, fileKey, pageId, scopeId, epoch, serial, options);
      const scope = metadata(scopeNode, fileKey, pageId);
      const records: SelectiveNodesResult['records'] = [];
      for (let index = 0; index < command.nodeIds.length; index++) {
        const node = await this.resolve(command.nodeIds[index]!, fileKey, pageId, scopeId, epoch, serial, options);
        const source: SourceNode = metadata(node, fileKey, pageId);
        let text: 'loaded' | 'not-requested' | 'not-applicable' = 'not-requested';
        if (command.fields === 'text') {
          if (node.type === 'TEXT') {
            const characters = node.characters;
            if (typeof characters !== 'string') fail('TEXT_UNAVAILABLE', 'Exact source text is unavailable.');
            if (characters.length > 50_000) fail('TEXT_TOO_LARGE', 'Exact source text exceeds the 50,000-code-unit record limit.');
            source.text = characters;
            text = 'loaded';
          } else text = 'not-applicable';
        }
        if (!SourceNodeSchema.safeParse(source).success)
          fail('INVALID_SOURCE_METADATA', 'A source field exceeds its schema limit; nothing was truncated.');
        records.push({ node: source, fieldCoverage: { metadata: 'loaded', text } });
        if (options.yieldControl && (index + 1) % 25 === 0) {
          await options.yieldControl(); this.check(fileKey, pageId, epoch, serial, options);
        }
      }
      await this.verifyScope(scope, fileKey, pageId, epoch, serial, options);
      this.check(fileKey, pageId, epoch, serial, options);
      const result = SelectiveNodesResultSchema.parse({ fileKey, pageId, scopeId, scope, startedAt,
        observedAt: this.observedAt(), requestedIds: command.nodeIds, fields: command.fields,
        records, requestedIdsComplete: true, consistency: 'live-session-observation' });
      if (utf8Bytes(JSON.stringify(result)) > SELECTIVE_NODES_WIRE_BYTES)
        fail('SOURCE_RESPONSE_TOO_LARGE', 'The exact requested records exceed the 1 MB response limit.');
      this.check(fileKey, pageId, epoch, serial, options);
      return result;
    } finally {
      this.refreshIdle();
      this.host.skipInvisibleInstanceChildren = previous;
      this.reading = false;
    }
  }
  private async beginChildren(command: SelectiveReadChildrenCommand, options: SelectiveReadOptions): Promise<ChildCursor> {
    if (command.offset !== 0) fail('CURSOR_UNAVAILABLE', 'Start a new immediate-child observation at offset zero.');
    const { fileKey, pageId, scopeId, parentId } = command;
    const { epoch, serial } = this.initial(fileKey, pageId, options);
    const startedAt = this.observedAt();
    const scopeNode = await this.resolve(scopeId, fileKey, pageId, scopeId, epoch, serial, options);
    const parentNode = parentId === scopeId ? scopeNode
      : await this.resolve(parentId, fileKey, pageId, scopeId, epoch, serial, options);
    const scope = metadata(scopeNode, fileKey, pageId);
    const parent = metadata(parentNode, fileKey, pageId);
    // One property access creates one full native array; response limits do not cap it.
    const children = 'children' in parentNode ? parentNode.children ?? [] : [];
    this.check(fileKey, pageId, epoch, serial, options);
    if (children.length > 200_000) fail('CHILD_LIMIT', 'This parent has more than 200,000 immediate children.');
    const cursor: ChildCursor = { command, scope, parent, children, startedAt, epoch, serial,
      lastAccess: this.now(), nextOffset: 0, lastPacket: null, seen: new Set() };
    this.cursor = cursor; this.invalidatedObservationId = null;
    return cursor;
  }
  private async verifyCursor(cursor: ChildCursor, options: SelectiveReadOptions): Promise<void> {
    const { fileKey, pageId, scopeId, parentId } = cursor.command;
    this.check(fileKey, pageId, cursor.epoch, cursor.serial, options);
    const scopeNode = await this.resolve(scopeId, fileKey, pageId, scopeId, cursor.epoch, cursor.serial, options);
    const parentNode = parentId === scopeId ? scopeNode
      : await this.resolve(parentId, fileKey, pageId, scopeId, cursor.epoch, cursor.serial, options);
    if (!sameMetadata(metadata(scopeNode, fileKey, pageId), cursor.scope) ||
        !sameMetadata(metadata(parentNode, fileKey, pageId), cursor.parent)) {
      this.invalidateSource(); fail('SOURCE_CHANGED', 'Pinned parent or scope metadata changed during child enumeration.');
    }
  }
  async readChildren(raw: SelectiveReadChildrenCommand, options: SelectiveReadOptions = {}): Promise<SelectiveChildrenResult> {
    if (this.reading) fail('PLUGIN_BUSY', 'Another selective source read is active.');
    const command = SelectiveReadChildrenCommandSchema.parse(raw);
    this.reading = true;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const previous = this.host.skipInvisibleInstanceChildren;
    try {
      this.host.skipInvisibleInstanceChildren = false;
      if (this.invalidatedObservationId === command.observationId)
        fail('SOURCE_CHANGED', 'This child observation was invalidated by a source change.');
      if (this.cursor && this.now() - this.cursor.lastAccess > this.idleMs) this.clear();
      const cursor = this.cursor ?? await this.beginChildren(command, options);
      if (cursor.command.observationId !== command.observationId || cursor.command.fileKey !== command.fileKey ||
          cursor.command.pageId !== command.pageId || cursor.command.scopeId !== command.scopeId ||
          cursor.command.parentId !== command.parentId || cursor.command.limit !== command.limit)
        fail('CURSOR_MISMATCH', 'Release the existing immediate-child cursor before starting another.');
      await this.verifyCursor(cursor, options);
      if (cursor.lastPacket?.offset === command.offset) return cursor.lastPacket;
      if (command.offset !== cursor.nextOffset || cursor.lastPacket?.childrenComplete)
        fail('CURSOR_SEQUENCE', 'Only the next offset or last published packet may be requested.');
      const { fileKey, pageId, scopeId, parentId, observationId } = command;
      const nodes: MetadataNode[] = [], draftSeen = new Set<string>();
      const totalChildren = cursor.children.length;
      const make = (items: MetadataNode[]) => {
        const end = command.offset + items.length;
        return { fileKey, pageId, scopeId, scope: cursor.scope, parentId, parent: cursor.parent,
          observationId, startedAt: cursor.startedAt, observedAt: this.observedAt(),
          offset: command.offset, totalChildren, nodes: items,
          nextOffset: end === totalChildren ? null : end, childrenComplete: end === totalChildren,
          consistency: 'live-session-observation' as const };
      };
      for (let index = command.offset; index < totalChildren && nodes.length < command.limit; index++) {
        this.check(fileKey, pageId, cursor.epoch, cursor.serial, options);
        const child = cursor.children[index]!;
        if (child.parent?.id !== parentId) {
          this.invalidateSource(); fail('SOURCE_CHANGED', 'A child moved during immediate-child enumeration.');
        }
        if (cursor.seen.has(child.id) || draftSeen.has(child.id)) fail('INVALID_TREE', 'Duplicate immediate-child source ID.');
        const record = metadata(child, fileKey, pageId, index);
        const candidate = make([...nodes, record]);
        if (utf8Bytes(JSON.stringify(candidate)) > SELECTIVE_CHILDREN_WIRE_BYTES) {
          if (nodes.length === 0) fail('SOURCE_RECORD_TOO_LARGE', 'One exact child record exceeds the packet byte limit.');
          break;
        }
        nodes.push(record); draftSeen.add(child.id);
        if (options.yieldControl && nodes.length % 25 === 0) {
          await options.yieldControl(); this.check(fileKey, pageId, cursor.epoch, cursor.serial, options);
        }
      }
      if (totalChildren > command.offset && nodes.length === 0)
        fail('SOURCE_RECORD_TOO_LARGE', 'The next child cannot fit in one response.');
      await this.verifyCursor(cursor, options);
      const packet = SelectiveChildrenResultSchema.parse(make(nodes));
      if (utf8Bytes(JSON.stringify(packet)) > SELECTIVE_CHILDREN_WIRE_BYTES)
        fail('SOURCE_RESPONSE_TOO_LARGE', 'Immediate-child response exceeds the 96 KB limit.');
      this.check(fileKey, pageId, cursor.epoch, cursor.serial, options);
      if (packet.childrenComplete && cursor.seen.size + draftSeen.size !== totalChildren)
        fail('INVALID_TREE', 'The immediate-child inventory has missing source IDs.');
      for (const id of draftSeen) cursor.seen.add(id);
      cursor.nextOffset = packet.nextOffset ?? totalChildren;
      cursor.lastPacket = packet;
      return packet;
    } finally {
      this.refreshIdle();
      this.host.skipInvisibleInstanceChildren = previous;
      this.reading = false;
    }
  }
}
