import {
  CaptureLimitsSchema, PluginCommandSchema, SelectionSchema, SnapshotSchema, SourceNodeSchema,
  type CaptureLimits, type PluginCommand, type Rect, type Selection, type Snapshot, type SourceNode,
} from '../shared/contracts.js';
import { utf8Bytes } from '../fixture-analysis/index.js';

export interface FigmaReadableNode {
  id:string; name:string; type:string; parent:FigmaReadableNode|null;
  children?:readonly FigmaReadableNode[];
  absoluteBoundingBox?:Rect|null; absoluteRenderBounds?:Rect|null;
  absoluteTransform?:readonly [readonly [number,number,number],readonly [number,number,number]];
  visible?:boolean; characters?:string; isMask?:boolean; clipsContent?:boolean;
  exportAsync?:(settings:{format:'PNG';contentsOnly:true;useAbsoluteBounds:true;constraint:{type:'SCALE';value:number}})=>Promise<Uint8Array>;
}
export interface CaptureHost {
  fileKey?:string|undefined;
  currentPage:FigmaReadableNode & {selection:readonly FigmaReadableNode[]};
  skipInvisibleInstanceChildren:boolean;
  getNodeByIdAsync(id:string):Promise<FigmaReadableNode|null>;
  setCurrentPageAsync(page:FigmaReadableNode):Promise<void>;
  selectNodes(nodes:readonly FigmaReadableNode[]):void;
  scrollAndZoomIntoView(nodes:readonly FigmaReadableNode[]):void;
}
export interface CaptureOptions {
  now?:()=>number; capturedAt?:()=>string; id?:()=>string;
  cancelled?:()=>boolean; yieldControl?:()=>Promise<void>;
}
export class PluginCommandError extends Error {
  constructor(public readonly code:string,message:string) { super(message); this.name='PluginCommandError'; }
}
const containers = new Set(['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION']);
const MAX_PNG_BYTES=8_000_000;
function fail(code:string,message:string):never { throw new PluginCommandError(code,message); }
function checkCancelled(options:CaptureOptions) { if(options.cancelled?.())fail('CANCELLED','Capture cancelled.'); }
function copyBounds(node:FigmaReadableNode):Rect|null {
  const value='absoluteBoundingBox' in node?node.absoluteBoundingBox:null;
  if(!value)return null;
  if(![value.x,value.y,value.width,value.height].every(Number.isFinite)||value.width<0||value.height<0)return null;
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}
function rotated(node:FigmaReadableNode):boolean {
  const transform='absoluteTransform' in node?node.absoluteTransform:undefined;
  return !!transform&&(Math.abs(transform[0][1])>1e-8||Math.abs(transform[1][0])>1e-8||transform[0][0]<=0||transform[1][1]<=0);
}
export function pngDimensions(bytes:Uint8Array):{width:number;height:number} {
  const magic=[137,80,78,71,13,10,26,10];
  if(bytes.length<24||magic.some((v,i)=>bytes[i]!==v)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')fail('INVALID_PNG','Export did not return a PNG image.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {width:view.getUint32(16),height:view.getUint32(20)};
}
export function encodeBase64(bytes:Uint8Array):string {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks:string[]=[];let chunk='';
  for(let i=0;i<bytes.length;i+=3) {
    const a=bytes[i]!,b=bytes[i+1],c=bytes[i+2];
    chunk+=alphabet[a>>2]!+alphabet[((a&3)<<4)|((b??0)>>4)]!+(b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>6)]!)+(c===undefined?'=':alphabet[c&63]!);
    if(chunk.length>=16384){chunks.push(chunk);chunk='';}
  }
  if(chunk)chunks.push(chunk);return chunks.join('');
}

/** Reads only the current selection. It never falls back to a page/document dump. */
export function getSelection(host:CaptureHost):Selection {
  if(host.currentPage.selection.length>100)fail('SELECTION_TOO_LARGE','Select at most 100 nodes for selection metadata.');
  return SelectionSchema.parse({fileKey:host.fileKey??null,pageId:host.currentPage.id,
    nodes:host.currentPage.selection.map(n=>({id:n.id,name:n.name,type:n.type,bbox:copyBounds(n)}))});
}

/** Preserve exact scalar source data, bounding application allocations and output. */
export async function captureSelection(host:CaptureHost,rawLimits:CaptureLimits,options:CaptureOptions={}):Promise<Snapshot> {
  const limits=CaptureLimitsSchema.parse(rawLimits),now=options.now??Date.now,start=now();
  if(host.currentPage.selection.length!==1)fail('INVALID_SELECTION','Select exactly one container to capture.');
  const page=host.currentPage,root=page.selection[0]!;
  if(!containers.has(root.type))fail('INVALID_SELECTION','Select a Frame, Group, Component, Instance, Component Set or Section container.');
  const bounds=copyBounds(root);
  if(!bounds||bounds.width<=0||bounds.height<=0)fail('INVALID_BOUNDS','Selected container has no positive-area absolute bounds.');
  const previous=host.skipInvisibleInstanceChildren;
  host.skipInvisibleInstanceChildren=false;
  try {
    const nodes:SourceNode[]=[],seen=new Set<string>(),warnings=new Set<string>();
    const stack:{nodes:readonly FigmaReadableNode[];index:number}[]=[{nodes:[root],index:0}];
    let bytes=2,reason:string|null=null;
    while(stack.length) {
      const cursor=stack[stack.length-1]!;
      if(cursor.index>=cursor.nodes.length){stack.pop();continue;}
      checkCancelled(options);
      if(nodes.length>=limits.maxNodes){reason='Node budget reached; this is an observed prefix only.';break;}
      if(now()-start>=limits.maxDurationMs){reason='Time budget reached; this is an observed prefix only.';break;}
      const node=cursor.nodes[cursor.index++]!;
      if(seen.has(node.id))fail('INVALID_TREE','Duplicate node ID or cycle in selected scope.');
      const candidate:SourceNode={id:node.id,parentId:node.parent?.id??null,type:node.type,name:node.name,
        bbox:copyBounds(node),visible:'visible' in node?node.visible!==false:true,
        sourceFileKey:host.fileKey??null,sourcePageId:page.id};
      if(node.type==='TEXT'&&'characters' in node)candidate.text=node.characters??'';
      const parsed=SourceNodeSchema.safeParse(candidate);
      if(!parsed.success){reason='A source record exceeded the schema limits; exact text/name was not truncated.';break;}
      const size=utf8Bytes(JSON.stringify(candidate))+(nodes.length?1:0);
      if(bytes+size>limits.maxBytes){reason='Metadata byte budget reached; exact text was not truncated.';break;}
      nodes.push(candidate);seen.add(node.id);bytes+=size;
      if('isMask' in node&&node.isMask)warnings.add('Masks are present. BBoxes do not represent the rendered masked silhouette.');
      if('clipsContent' in node&&node.clipsContent)warnings.add('Clipping is present. Descendant BBoxes can extend outside the visible preview.');
      if(rotated(node))warnings.add('Rotated, reflected or skewed nodes are present; source matching uses axis-aligned BBoxes.');
      if('children' in node&&node.children?.length)stack.push({nodes:node.children,index:0});
      if(options.yieldControl&&nodes.length%100===0)await options.yieldControl();
    }
    if(nodes.length===0)fail('EMPTY_CAPTURE',reason??'No source nodes could be read.');
    checkCancelled(options);
    let preview:Snapshot['preview']=null;
    if(rotated(root))warnings.add('Preview withheld: rotated, reflected or skewed root coordinate mapping is not supported. Select an unrotated enclosing frame.');
    else if(!('exportAsync' in root)||!root.exportAsync)warnings.add('Preview unavailable: this node does not expose image export.');
    else if(now()-start>=limits.maxDurationMs)warnings.add('Preview not attempted because the extraction time budget was exhausted.');
    else {
      try {
        const scale=Math.min(1,limits.maxImageDimension/Math.max(bounds.width,bounds.height));
        const image=await root.exportAsync({format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:scale}});
        checkCancelled(options);
        if(image.byteLength>MAX_PNG_BYTES)fail('IMAGE_TOO_LARGE','PNG preview exceeds the 8 MB image budget.');
        const {width,height}=pngDimensions(image);
        if(width<1||height<1||width>limits.maxImageDimension||height>limits.maxImageDimension)fail('INVALID_IMAGE_SIZE','Exported preview exceeds the requested pixel budget.');
        const expectedWidth=bounds.width*scale,expectedHeight=bounds.height*scale;
        if(Math.abs(width-expectedWidth)>2||Math.abs(height-expectedHeight)>2)fail('COORDINATE_MISMATCH','Preview aspect/dimensions differ from absolute bounds; preview withheld to avoid uncertain mapping.');
        preview={mimeType:'image/png',base64:encodeBase64(image),width,height};
        if(now()-start>limits.maxDurationMs)warnings.add('Native Figma image export exceeded the cooperative extraction deadline; exportAsync cannot be preempted.');
      } catch(error) {
        if(error instanceof PluginCommandError&&error.code==='CANCELLED')throw error;
        warnings.add(error instanceof PluginCommandError?error.message:'Native Figma image export failed; metadata remains available.');
      }
    }
    warnings.add('Preview uses contentsOnly=true and useAbsoluteBounds=true; overlapping siblings outside the selected subtree are excluded.');
    warnings.add('Snapshot is an observation, not an immutable Figma revision. Native page loading and image-export memory are not bounded by metadata limits.');
    return SnapshotSchema.parse({schemaVersion:'1.0.0',id:options.id?.()??`capture-${Date.now()}-${Math.random().toString(36).slice(2,12)}`,
      name:root.name.slice(0,300)||'Selected scope',source:{fileKey:host.fileKey??null,pageId:page.id,rootId:root.id,revision:null,capturedAt:options.capturedAt?.()??new Date().toISOString()},
      bounds,nodes,preview,completeness:{complete:reason===null,reason},warnings:[...warnings]});
  } finally {host.skipInvisibleInstanceChildren=previous;}
}

export async function executePluginCommand(host:CaptureHost,input:PluginCommand,options:CaptureOptions={}):Promise<unknown> {
  const command=PluginCommandSchema.parse(input);checkCancelled(options);
  if(command.type==='get_selection')return getSelection(host);
  if(command.type==='capture_selection')return captureSelection(host,command.limits,options);
  if(!host.fileKey)fail('FILE_IDENTITY_UNAVAILABLE','Figma did not expose this file identity; source navigation cannot be verified.');
  if(host.fileKey!==command.fileKey)fail('WRONG_FILE','The connected plugin is not in the requested source file.');
  const page=await host.getNodeByIdAsync(command.pageId);
  if(!page||page.type!=='PAGE')fail('PAGE_UNAVAILABLE','Requested page is unavailable.');
  const nodes=await Promise.all(command.nodeIds.map(id=>host.getNodeByIdAsync(id)));
  for(const node of nodes) {
    if(!node||node.type==='PAGE'||node.type==='DOCUMENT')fail('NODE_UNAVAILABLE','Requested source node is unavailable.');
    let ancestor:FigmaReadableNode|null=node,hops=0;
    while(ancestor&&ancestor.id!==page.id&&hops++<10000)ancestor=ancestor.parent;
    if(!ancestor||ancestor.id!==page.id)fail('WRONG_PAGE','Requested node does not belong to the requested page.');
  }
  checkCancelled(options);
  if(host.currentPage.id!==page.id)await host.setCurrentPageAsync(page);
  checkCancelled(options);
  const found=nodes.filter((node):node is FigmaReadableNode=>node!==null);
  host.selectNodes(found);host.scrollAndZoomIntoView(found);
  return {highlightedNodeIds:found.map(n=>n.id)};
}
