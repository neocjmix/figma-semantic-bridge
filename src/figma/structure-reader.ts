import { SourceNodeSchema, type PluginCommand, type Rect, type SourceNode } from '../shared/contracts.js';
import {
  STRUCTURE_CHUNK_BYTES, STRUCTURE_CHUNK_NODES, STRUCTURE_COLLECTION_BYTES, STRUCTURE_COLLECTION_NODES,
  StructureChunkSchema, type StructureChunk,
} from '../shared/structure-collection.js';
import { utf8Bytes } from '../fixture-analysis/index.js';
import { PluginCommandError, type CaptureHost, type FigmaReadableNode } from './capture.js';
import { compactStructureChunk, StructureReplayHintSchema,
  type StructureReplayResult } from '../shared/structure-replay.js';

type ReadCommand = Extract<PluginCommand, {type:'read_structure_chunk'}>;
type Frame = {nodes:readonly FigmaReadableNode[]; index:number; parentId:string|null};
type Cursor = {
  collectionId:string; fileKey:string; pageId:string; nodeId:string; scopeId:string|undefined; root:SourceNode; bounds:Rect;
  startedAt:string; epoch:number; serial:number; nextSequence:number; lastPacket:StructureChunk|null;
  stack:Frame[]; seen:Set<string>; totalNodes:number; totalBytes:number;
};
export interface StructureReadOptions {cancelled?:()=>boolean; yieldControl?:()=>Promise<void>; packetNodeLimit?:number}
export interface StructureReaderOptions {now?:()=>number; observedAt?:()=>string; getChangeEpoch?:()=>number}

function fail(code:string,message:string):never {throw new PluginCommandError(code,message);}
function copyBounds(node:FigmaReadableNode):Rect|null {
  const value='absoluteBoundingBox' in node?node.absoluteBoundingBox:null;
  if(!value||![value.x,value.y,value.width,value.height].every(Number.isFinite)||value.width<0||value.height<0)return null;
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}
function sourceNode(node:FigmaReadableNode,fileKey:string,pageId:string,siblingIndex:number|undefined):SourceNode {
  const rendering:NonNullable<SourceNode['rendering']>={};
  if(siblingIndex!==undefined)rendering.siblingIndex=siblingIndex;
  if('opacity' in node&&typeof node.opacity==='number'&&Number.isFinite(node.opacity)&&node.opacity>=0&&node.opacity<=1)rendering.opacity=node.opacity;
  const source:SourceNode={id:node.id,parentId:node.parent?.id??null,type:node.type,name:node.name,
    bbox:copyBounds(node),visible:'visible' in node?node.visible!==false:true,
    sourceFileKey:fileKey,sourcePageId:pageId,rendering};
  if(node.type==='TEXT'&&'characters' in node)source.text=node.characters??'';
  const parsed=SourceNodeSchema.safeParse(source);
  if(!parsed.success)fail('INVALID_SOURCE_METADATA','A source record exceeds the bounded schema; exact text and names were not truncated.');
  return parsed.data;
}
function assertPageAncestry(node:FigmaReadableNode,pageId:string,scopeId?:string):void {
  let inScope=scopeId===undefined||node.id===scopeId;
  const seen=new Set([node.id]);let ancestor=node.parent;
  for(let hops=0;ancestor&&hops<256;hops++) {
    if(seen.has(ancestor.id))break;
    if(ancestor.id===scopeId)inScope=true;
    if(ancestor.id===pageId){
      if(inScope)return;
      fail('WRONG_SCOPE','Requested branch is no longer inside its pinned inspection scope.');
    }
    seen.add(ancestor.id);ancestor=ancestor.parent;
  }
  fail('WRONG_PAGE','Requested source root does not belong to the current page within 256 parent IDs.');
}

/** One session-local DFS cursor. Packet boundaries bound serialized metadata, not Figma's native child-array allocation. */
export class StructureReader {
  private cursor:Cursor|null=null;
  private invalidatedCollectionId:string|null=null;
  private serial=0;
  private reading=false;
  private readonly now:()=>number;
  private readonly observedAt:()=>string;
  private readonly getChangeEpoch:()=>number;
  constructor(private readonly host:CaptureHost,options:StructureReaderOptions={}) {
    this.now=options.now??Date.now;
    this.observedAt=options.observedAt??(()=>new Date().toISOString());
    this.getChangeEpoch=options.getChangeEpoch??(()=>0);
  }
  hasCursor():boolean {return this.cursor!==null;}
  clear():void {this.serial++;this.cursor=null;this.invalidatedCollectionId=null;}
  invalidateSource():void {
    const collectionId=this.cursor?.collectionId??null;
    this.clear();this.invalidatedCollectionId=collectionId;
  }
  release(collectionId:string):{released:true} {
    if(this.cursor?.collectionId===collectionId)this.clear();
    if(this.invalidatedCollectionId===collectionId)this.invalidatedCollectionId=null;
    return {released:true};
  }
  private check(command:ReadCommand,options:StructureReadOptions,serial:number,epoch:number):void {
    if(options.cancelled?.())fail('CANCELLED','Structure reading was cancelled.');
    if(serial!==this.serial){
      if(this.invalidatedCollectionId===command.collectionId)fail('SOURCE_CHANGED','The current page changed during structure reading. Start a new collection.');
      fail('CURSOR_INVALIDATED','The structure cursor was invalidated by a bridge restart or release.');
    }
    if(this.getChangeEpoch()!==epoch){this.invalidateSource();fail('SOURCE_CHANGED','The current page changed during structure reading. Start a new collection.');}
    if(this.host.fileKey!==command.fileKey||this.host.currentPage.id!==command.pageId){this.invalidateSource();fail('SOURCE_CHANGED','The source file or current page changed during structure reading.');}
  }
  private async checkRoot(command:ReadCommand,cursor:Cursor,options:StructureReadOptions):Promise<void> {
    this.check(command,options,cursor.serial,cursor.epoch);
    const root=await this.host.getNodeByIdAsync(command.nodeId);
    this.check(command,options,cursor.serial,cursor.epoch);
    if(!root||root.id!==command.nodeId){this.invalidateSource();fail('SOURCE_CHANGED','The source root is no longer available.');}
    try {assertPageAncestry(root,command.pageId,command.scopeId);} catch {this.invalidateSource();fail('SOURCE_CHANGED','The source root moved from its pinned page or inspection scope.');}
    const current=sourceNode(root,command.fileKey,command.pageId,undefined);
    if(JSON.stringify(current)!==JSON.stringify(cursor.root)){this.invalidateSource();fail('SOURCE_CHANGED','Source root metadata changed during structure reading.');}
  }
  private async begin(command:ReadCommand,options:StructureReadOptions):Promise<Cursor> {
    if(command.sequence!==0)fail('CURSOR_UNAVAILABLE','This sequence has no active plugin cursor. Restart the collection.');
    if(!this.host.fileKey)fail('FILE_IDENTITY_UNAVAILABLE','Figma did not expose this file identity.');
    if(this.host.fileKey!==command.fileKey)fail('WRONG_FILE','The connected plugin is not in the requested source file.');
    if(this.host.currentPage.id!==command.pageId)fail('WRONG_PAGE','Open the requested source page before reading structure.');
    const epoch=this.getChangeEpoch(),serial=this.serial;
    if(options.cancelled?.())fail('CANCELLED','Structure reading was cancelled.');
    const root=await this.host.getNodeByIdAsync(command.nodeId);
    this.check(command,options,serial,epoch);
    if(!root||root.id!==command.nodeId)fail('NODE_UNAVAILABLE','Requested source root is unavailable.');
    assertPageAncestry(root,command.pageId,command.scopeId);
    if(!new Set(['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION']).has(root.type))fail('INVALID_SELECTION','Select a supported source container.');
    const source=sourceNode(root,command.fileKey,command.pageId,undefined),bounds=source.bbox;
    if(!bounds||bounds.width<=0||bounds.height<=0)fail('INVALID_BOUNDS','Requested source root has no positive-area absolute bounds.');
    const cursor:Cursor={collectionId:command.collectionId,fileKey:command.fileKey,pageId:command.pageId,nodeId:command.nodeId,scopeId:command.scopeId,
      root:source,bounds,startedAt:this.observedAt(),epoch,serial,nextSequence:0,lastPacket:null,
      stack:[{nodes:[root],index:0,parentId:root.parent?.id??null}],seen:new Set(),totalNodes:0,totalBytes:0};
    this.cursor=cursor;this.invalidatedCollectionId=null;
    return cursor;
  }
  async readChunk(command:ReadCommand,options:StructureReadOptions={}):Promise<StructureChunk> {
    if(this.reading)fail('CURSOR_BUSY','Another structure packet is being read.');
    this.reading=true;
    const previous=this.host.skipInvisibleInstanceChildren;
    this.host.skipInvisibleInstanceChildren=false;
    try {
      if(!this.cursor&&this.invalidatedCollectionId===command.collectionId&&command.sequence!==0)
        fail('SOURCE_CHANGED','The source changed after the last published packet. Start a new collection.');
      const cursor=this.cursor??await this.begin(command,options);
      if(cursor.collectionId!==command.collectionId||cursor.fileKey!==command.fileKey||cursor.pageId!==command.pageId||cursor.nodeId!==command.nodeId||cursor.scopeId!==command.scopeId)
        fail('CURSOR_MISMATCH','Release the existing structure cursor before starting another source.');
      this.check(command,options,cursor.serial,cursor.epoch);
      await this.checkRoot(command,cursor,options);
      if(cursor.lastPacket?.sequence===command.sequence)return cursor.lastPacket;
      if(command.sequence!==cursor.nextSequence)fail('CURSOR_SEQUENCE','Only the next sequence or the last published packet may be requested.');
      if(cursor.lastPacket?.complete)fail('CURSOR_SEQUENCE','The collection is complete; release its cursor.');
      // The draft and newly seen IDs become authoritative only after a complete, validated packet.
      const draft=cursor.stack.map(frame=>({...frame}));
      const newIds=new Set<string>(),nodes:SourceNode[]=[],childCounts:number[]=[];
      const warnings=new Set<string>([
        'This is a live-session observation, not an immutable Figma revision. Paint and unobserved source changes may remain undetected.',
        'Figma allocates each parent children array natively; packet byte limits do not bound that array memory.',
      ]);
      let packetBytes=2;
      // The broker bounds the complete JSON response. Leave room for the repeated
      // root, child counts, IDs, timestamps and warnings, then verify exactly.
      const envelopeReserve=utf8Bytes(JSON.stringify(cursor.root))+8192;
      const nodePayloadLimit=STRUCTURE_CHUNK_BYTES-envelopeReserve;
      const start=this.now();
      while(draft.length) {
        this.check(command,options,cursor.serial,cursor.epoch);
        const frame=draft[draft.length-1]!;
        if(frame.index>=frame.nodes.length){draft.pop();continue;}
        if(nodes.length>=Math.min(options.packetNodeLimit??STRUCTURE_CHUNK_NODES,STRUCTURE_CHUNK_NODES)||nodes.length>0&&this.now()-start>=1000)break;
        if(cursor.totalNodes+nodes.length>=Math.min(command.maxNodes??STRUCTURE_COLLECTION_NODES,STRUCTURE_COLLECTION_NODES))break;
        const node=frame.nodes[frame.index]!;
        if(node.parent?.id!==frame.parentId) {this.invalidateSource();fail('SOURCE_CHANGED','A source node moved during structure reading.');}
        if(cursor.seen.has(node.id)||newIds.has(node.id))fail('INVALID_TREE','Duplicate node ID or cycle in selected scope.');
        const isRoot=cursor.totalNodes===0&&nodes.length===0;
        const candidate=sourceNode(node,command.fileKey,command.pageId,isRoot?undefined:frame.index);
        const size=utf8Bytes(JSON.stringify(candidate))+(nodes.length?1:0);
        if(packetBytes+size>nodePayloadLimit) {
          if(nodes.length===0)fail('SOURCE_RECORD_TOO_LARGE','One exact source record exceeds the packet byte limit.');
          break;
        }
        if(cursor.totalBytes+packetBytes+size>STRUCTURE_COLLECTION_BYTES)fail('COLLECTION_BYTE_LIMIT','The collection exceeds the 64 MB exact metadata limit.');
        const children='children' in node?node.children:undefined;
        const childCount=children?.length??0;
        if(childCount>STRUCTURE_COLLECTION_NODES)fail('COLLECTION_NODE_LIMIT','One parent exceeds the collection node limit.');
        frame.index++;
        nodes.push(candidate);childCounts.push(childCount);newIds.add(node.id);packetBytes+=size;
        if('isMask' in node&&node.isMask)warnings.add('Masks are present. BBoxes do not represent the rendered masked silhouette.');
        if('clipsContent' in node&&node.clipsContent)warnings.add('Clipping is present. Descendant BBoxes can extend outside the visible area.');
        const transform='absoluteTransform' in node?node.absoluteTransform:undefined;
        if(transform&&(Math.abs(transform[0][1])>1e-8||Math.abs(transform[1][0])>1e-8||transform[0][0]<=0||transform[1][1]<=0))
          warnings.add('Rotated, reflected or skewed nodes are present; source matching uses axis-aligned BBoxes.');
        if(children?.length)draft.push({nodes:children,index:0,parentId:node.id});
        if(nodes.length%100===0&&options.yieldControl){await options.yieldControl();this.check(command,options,cursor.serial,cursor.epoch);}
      }
      while(draft.length&&draft[draft.length-1]!.index>=draft[draft.length-1]!.nodes.length)draft.pop();
      if(nodes.length===0)fail('COLLECTION_NODE_LIMIT','The node budget is reached. Increase it and resume the same collection.');
      const complete=draft.length===0;
      await this.checkRoot(command,cursor,options);
      this.check(command,options,cursor.serial,cursor.epoch);
      const packet=StructureChunkSchema.parse({collectionId:cursor.collectionId,sequence:command.sequence,
        fileKey:cursor.fileKey,pageId:cursor.pageId,root:cursor.root,bounds:cursor.bounds,
        startedAt:cursor.startedAt,observedAt:this.observedAt(),nodes,childCounts,complete,
        nextSequence:complete?null:command.sequence+1,warnings:[...warnings],consistency:'live-session-observation'});
      const wireBytes=utf8Bytes(JSON.stringify(packet));
      if(wireBytes>STRUCTURE_CHUNK_BYTES)fail('CHUNK_BYTE_LIMIT','The exact packet exceeds the 1 MB wire limit.');
      if(cursor.totalBytes+wireBytes>STRUCTURE_COLLECTION_BYTES)fail('COLLECTION_BYTE_LIMIT','The collection exceeds the 64 MB wire limit.');
      // No await after this point: published packet, DFS frontier and counters commit atomically.
      cursor.stack=draft;for(const id of newIds)cursor.seen.add(id);
      cursor.totalNodes+=nodes.length;cursor.totalBytes+=wireBytes;
      cursor.lastPacket=packet;cursor.nextSequence=command.sequence+1;
      return packet;
    } finally {this.host.skipInvisibleInstanceChildren=previous;this.reading=false;}
  }
  /** Re-read source fields before substituting a compact acknowledgement for equal stored bytes. */
  async readChunkWithReplay(command:ReadCommand,options:StructureReadOptions={}):Promise<StructureChunk|StructureReplayResult> {
    const hint=command.replay===undefined?undefined:StructureReplayHintSchema.parse(command.replay);
    const packet=await this.readChunk(command,{...options,...(hint?{packetNodeLimit:hint.nodeCount}:{})});
    return compactStructureChunk(packet,hint);
  }
}
