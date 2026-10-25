import {
  CaptureLimitsSchema, PluginCommandSchema, SelectionSchema, SnapshotSchema, SourceNodeSchema,
  NODE_PREVIEW_MAX_BYTES, NODE_PREVIEW_MAX_DIMENSION, NODE_PREVIEW_MAX_DURATION_MS, NodePreviewResultSchema,
  type CaptureLimits, type NodePreviewResult, type PluginCommand, type Rect, type Selection, type Snapshot, type SourceNode,
} from '../shared/contracts.js';
import { utf8Bytes } from '../fixture-analysis/index.js';

export interface FigmaReadableNode {
  id:string; name:string; type:string; parent:FigmaReadableNode|null;
  children?:readonly FigmaReadableNode[];
  absoluteBoundingBox?:Rect|null; absoluteRenderBounds?:Rect|null;
  absoluteTransform?:readonly [readonly [number,number,number],readonly [number,number,number]];
  visible?:boolean; opacity?:number; characters?:string; isMask?:boolean; clipsContent?:boolean;
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
  onProgress?:(progress:{phase:'structure'|'preview';nodes:number;bytes:number})=>void;
  metadataOnly?:boolean;
}
export class PluginCommandError extends Error {
  constructor(public readonly code:string,message:string) { super(message); this.name='PluginCommandError'; }
}
const containers = new Set(['FRAME','GROUP','COMPONENT','COMPONENT_SET','INSTANCE','SECTION']);
const MAX_PNG_BYTES=8_000_000;
const CAPTURE_PREVIEW_MAX_DIMENSION=2048;
const CAPTURE_PREVIEW_MAX_DURATION_MS=55_000;
const SECTION_PREVIEW_UNSUPPORTED='Section capture supports metadata only; PNG coordinate mapping is unsupported. Select an unrotated inner Frame explicitly and capture it.';
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
  const previous=host.skipInvisibleInstanceChildren;
  host.skipInvisibleInstanceChildren=false;
  try {
    if(host.currentPage.selection.length>100)fail('SELECTION_TOO_LARGE','Select at most 100 nodes for selection metadata.');
    return SelectionSchema.parse({fileKey:host.fileKey??null,pageId:host.currentPage.id,
      nodes:host.currentPage.selection.map(n=>({id:n.id,name:n.name,type:n.type,bbox:copyBounds(n)}))});
  } finally {host.skipInvisibleInstanceChildren=previous;}
}

/** Preserve exact scalar source data, bounding application allocations and output. */
export async function captureSelection(host:CaptureHost,rawLimits:CaptureLimits,options:CaptureOptions={}):Promise<Snapshot> {
  const limits=CaptureLimitsSchema.parse(rawLimits),now=options.now??Date.now,start=now();
  const previous=host.skipInvisibleInstanceChildren;
  host.skipInvisibleInstanceChildren=false;
  try {
    if(host.currentPage.selection.length!==1)fail('INVALID_SELECTION','Select exactly one container to capture.');
    const page=host.currentPage,root=page.selection[0]!;
    if(!containers.has(root.type))fail('INVALID_SELECTION','Select a Frame, Group, Component, Instance, Component Set or Section container.');
    const bounds=copyBounds(root);
    if(!bounds||bounds.width<=0||bounds.height<=0)fail('INVALID_BOUNDS','Selected container has no positive-area absolute bounds.');
    const nodes:SourceNode[]=[],seen=new Set<string>(),warnings=new Set<string>();
    const stack:{nodes:readonly FigmaReadableNode[];index:number}[]=[{nodes:[root],index:0}];
    let bytes=2,reason:string|null=null;
    while(stack.length) {
      const cursor=stack[stack.length-1]!;
      if(cursor.index>=cursor.nodes.length){stack.pop();continue;}
      checkCancelled(options);
      if(nodes.length>=limits.maxNodes){reason='Node budget reached; this is an observed prefix only.';break;}
      if(now()-start>=limits.maxDurationMs){reason='Time budget reached; this is an observed prefix only.';break;}
      const siblingIndex=cursor.index,node=cursor.nodes[cursor.index++]!;
      if(seen.has(node.id))fail('INVALID_TREE','Duplicate node ID or cycle in selected scope.');
      // Observe local properties only; unsupported opacity and the root's external order stay unknown.
      const rendering:NonNullable<SourceNode['rendering']>={};
      if(node!==root)rendering.siblingIndex=siblingIndex;
      if('opacity' in node) {
        const opacity=node.opacity;
        if(typeof opacity==='number'&&Number.isFinite(opacity)&&opacity>=0&&opacity<=1)rendering.opacity=opacity;
      }
      const candidate:SourceNode={id:node.id,parentId:node.parent?.id??null,type:node.type,name:node.name,
        bbox:copyBounds(node),visible:'visible' in node?node.visible!==false:true,
        sourceFileKey:host.fileKey??null,sourcePageId:page.id,rendering};
      if(node.type==='TEXT'&&'characters' in node)candidate.text=node.characters??'';
      const parsed=SourceNodeSchema.safeParse(candidate);
      if(!parsed.success){reason='A source record exceeded the schema limits; exact text/name was not truncated.';break;}
      const size=utf8Bytes(JSON.stringify(candidate))+(nodes.length?1:0);
      if(bytes+size>limits.maxBytes){reason='Metadata byte budget reached; exact text was not truncated.';break;}
      nodes.push(candidate);seen.add(node.id);bytes+=size;
      if(nodes.length%100===0)options.onProgress?.({phase:'structure',nodes:nodes.length,bytes});
      if('isMask' in node&&node.isMask)warnings.add('Masks are present. BBoxes do not represent the rendered masked silhouette.');
      if('clipsContent' in node&&node.clipsContent)warnings.add('Clipping is present. Descendant BBoxes can extend outside the visible preview.');
      if(rotated(node))warnings.add('Rotated, reflected or skewed nodes are present; source matching uses axis-aligned BBoxes.');
      if('children' in node&&node.children?.length)stack.push({nodes:node.children,index:0});
      if(options.yieldControl&&nodes.length%100===0)await options.yieldControl();
    }
    if(nodes.length===0)fail('EMPTY_CAPTURE',reason??'No source nodes could be read.');
    checkCancelled(options);
    if(nodes.length%100!==0)options.onProgress?.({phase:'structure',nodes:nodes.length,bytes});
    checkCancelled(options);
    let preview:Snapshot['preview']=null;
    if(options.metadataOnly)warnings.add('Metadata-only observation; no preview was requested.');
    else if(root.type==='SECTION')warnings.add(SECTION_PREVIEW_UNSUPPORTED);
    else if(rotated(root))warnings.add('Preview withheld: rotated, reflected or skewed root coordinate mapping is not supported. Select an unrotated enclosing frame.');
    else if(!('exportAsync' in root)||!root.exportAsync)warnings.add('Preview unavailable: this node does not expose image export.');
    else if(now()-start>=limits.maxDurationMs)warnings.add('Preview not attempted because the extraction time budget was exhausted.');
    else {
      try {
        options.onProgress?.({phase:'preview',nodes:nodes.length,bytes});
        checkCancelled(options);
        const scale=Math.min(1,limits.maxImageDimension/Math.max(bounds.width,bounds.height));
        const image=await root.exportAsync({format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:scale}});
        checkCancelled(options);
        if(image.byteLength>MAX_PNG_BYTES)fail('IMAGE_TOO_LARGE','PNG preview exceeds the 8 MB image budget.');
        const {width,height}=pngDimensions(image);
        const expectedWidth=bounds.width*scale,expectedHeight=bounds.height*scale;
        // Numeric dimensions only: never include source identifiers, labels, text or PNG bytes.
        const diagnostic=`PNG diagnostics: actual=${width}x${height}; requestedMaxDimension=${limits.maxImageDimension}; scale=${scale}; sourceBounds=${bounds.width}x${bounds.height}; expectedScaled=${expectedWidth}x${expectedHeight}.`;
        if(width<1||height<1||width>limits.maxImageDimension||height>limits.maxImageDimension)fail('INVALID_IMAGE_SIZE',`Exported preview exceeds the requested pixel budget. ${diagnostic} Select an unrotated inner Frame explicitly and capture it.`);
        if(Math.abs(width-expectedWidth)>2||Math.abs(height-expectedHeight)>2)fail('COORDINATE_MISMATCH',`Preview aspect/dimensions differ from absolute bounds; preview withheld to avoid uncertain mapping. ${diagnostic} Select an unrotated inner Frame explicitly and capture it.`);
        preview={mimeType:'image/png',base64:encodeBase64(image),width,height};
        if(now()-start>limits.maxDurationMs)warnings.add('Native Figma image export exceeded the cooperative extraction deadline; exportAsync cannot be preempted.');
      } catch(error) {
        if(error instanceof PluginCommandError&&error.code==='CANCELLED')throw error;
        warnings.add(error instanceof PluginCommandError?error.message:'Native Figma image export failed; metadata remains available.');
      }
    }
    if(!options.metadataOnly)warnings.add('Preview uses contentsOnly=true and useAbsoluteBounds=true; overlapping siblings outside the selected subtree are excluded.');
    warnings.add(options.metadataOnly
      ? 'Snapshot is an observation, not an immutable Figma revision. Native page loading is not bounded by metadata limits.'
      : 'Snapshot is an observation, not an immutable Figma revision. Native page loading and image-export memory are not bounded by metadata limits.');
    return SnapshotSchema.parse({schemaVersion:'1.0.0',id:options.id?.()??`capture-${Date.now()}-${Math.random().toString(36).slice(2,12)}`,
      name:root.name.slice(0,300)||'Selected scope',source:{fileKey:host.fileKey??null,pageId:page.id,rootId:root.id,revision:null,capturedAt:options.capturedAt?.()??new Date().toISOString()},
      bounds,nodes,preview,completeness:{complete:reason===null,reason},warnings:[...warnings]});
  } finally {host.skipInvisibleInstanceChildren=previous;}
}

/** Capture a pinned current-page root without reading or changing Figma selection. */
async function captureMetadata(host:CaptureHost,command:Extract<PluginCommand,{type:'capture_metadata'}>,options:CaptureOptions):Promise<Snapshot> {
  const checkAncestry=(node:FigmaReadableNode)=>{
    const seen=new Set([node.id]);let ancestor=node.parent;
    for(let hops=0;ancestor&&hops<256;hops++) {
      const id=ancestor.id;
      if(seen.has(id))break;
      if(id===command.pageId)return;
      seen.add(id);ancestor=ancestor.parent;
    }
    fail('WRONG_PAGE','Requested source root does not belong to the current page.');
  };
  const checkScope=()=>{
    checkCancelled(options);
    if(!host.fileKey)fail('FILE_IDENTITY_UNAVAILABLE','Figma did not expose this file identity; metadata cannot be verified.');
    if(host.fileKey!==command.fileKey)fail('WRONG_FILE','The connected plugin is not in the requested source file.');
    if(host.currentPage.id!==command.pageId)fail('WRONG_PAGE','Open the requested source page before capturing metadata.');
  };
  checkScope();
  const previous=host.skipInvisibleInstanceChildren;
  host.skipInvisibleInstanceChildren=false;
  try {
    const root=await host.getNodeByIdAsync(command.nodeId);checkScope();
    if(!root||root.id!==command.nodeId)fail('NODE_UNAVAILABLE','Requested source root is unavailable.');
    checkAncestry(root);
    const original={id:root.id,name:root.name,type:root.type,parentId:root.parent?.id??null,bbox:copyBounds(root)};
    // The adapter supplies a fixed selection only to the existing bounded walker.
    // It never writes Figma's actual currentPage.selection.
    const pinnedPage:CaptureHost['currentPage']={id:command.pageId,name:'',type:'PAGE',parent:null,selection:[root]};
    const pinnedHost:CaptureHost={
      get fileKey(){return host.fileKey;},currentPage:pinnedPage,
      get skipInvisibleInstanceChildren(){return host.skipInvisibleInstanceChildren;},
      set skipInvisibleInstanceChildren(value){host.skipInvisibleInstanceChildren=value;},
      getNodeByIdAsync:id=>host.getNodeByIdAsync(id),
      setCurrentPageAsync:page=>host.setCurrentPageAsync(page),
      selectNodes:nodes=>host.selectNodes(nodes),
      scrollAndZoomIntoView:nodes=>host.scrollAndZoomIntoView(nodes),
    };
    const snapshot=await captureSelection(pinnedHost,command.limits,{...options,metadataOnly:true});
    checkScope();
    const current=await host.getNodeByIdAsync(command.nodeId);checkScope();
    if(current)checkAncestry(current);
    const observed=snapshot.nodes[0];
    const matches=(node:FigmaReadableNode|SourceNode|undefined)=>!!node&&node.id===original.id&&node.name===original.name&&node.type===original.type&&
      ('parentId' in node?node.parentId:node.parent?.id??null)===original.parentId&&
      JSON.stringify('bbox' in node?node.bbox:copyBounds(node))===JSON.stringify(original.bbox);
    if(!matches(current??undefined)||!matches(observed)||snapshot.source.fileKey!==command.fileKey||
      snapshot.source.pageId!==command.pageId||snapshot.source.rootId!==command.nodeId) {
      fail('SOURCE_METADATA_CHANGED','Source root metadata changed during capture. Capture the scope again.');
    }
    return snapshot;
  } finally {host.skipInvisibleInstanceChildren=previous;}
}

/** Export one explicit current-page node without reading its children or changing the document. */
async function previewNode(host:CaptureHost,command:Extract<PluginCommand,{type:'preview_node'|'preview_capture'}>,options:CaptureOptions):Promise<NodePreviewResult> {
  const independent=command.type==='preview_capture';
  const maxDimension=independent?CAPTURE_PREVIEW_MAX_DIMENSION:NODE_PREVIEW_MAX_DIMENSION;
  const maxBytes=independent?MAX_PNG_BYTES:NODE_PREVIEW_MAX_BYTES;
  const maxDurationMs=independent?CAPTURE_PREVIEW_MAX_DURATION_MS:NODE_PREVIEW_MAX_DURATION_MS;
  const now=options.now??Date.now,start=now();
  const checkActive=()=>{
    checkCancelled(options);
    if(now()-start>=maxDurationMs)fail('PREVIEW_TIMEOUT','Node export exceeded the cooperative deadline; the result was discarded. Native exportAsync cannot be preempted.');
    if(!host.fileKey)fail('FILE_IDENTITY_UNAVAILABLE','Figma did not expose this file identity; node export cannot be verified.');
    if(host.fileKey!==command.fileKey)fail('WRONG_FILE','The connected plugin is not in the requested source file.');
    if(host.currentPage.id!==command.pageId)fail('WRONG_PAGE','Open the requested source page in Figma before requesting its node export.');
  };
  checkActive();
  const previous=host.skipInvisibleInstanceChildren;host.skipInvisibleInstanceChildren=false;
  try {
    const node=await host.getNodeByIdAsync(command.nodeId);checkActive();
    if(!node||node.id!==command.nodeId||['PAGE','DOCUMENT','SLICE'].includes(node.type))fail('NODE_UNAVAILABLE','Requested source node is unavailable or does not support scoped node export.');
    if(node.type==='SECTION')fail('UNSUPPORTED_NODE_PREVIEW',SECTION_PREVIEW_UNSUPPORTED);
    if(independent&&!containers.has(node.type))fail('NODE_UNAVAILABLE','Select a supported source container for an independent overview.');
    const readObservation=()=>{
      // Ancestors contribute IDs only. No sibling arrays, styles or external opacity are read.
      const parents:string[]=[],seen=new Set([node.id]);let parent=node.parent;
      for(let hops=0;parent&&hops<256;hops++) {
        checkActive();const id=parent.id;
        if(seen.has(id))fail('WRONG_PAGE','Source ancestry is cyclic or does not reach the current page within 256 parent IDs.');
        seen.add(id);parents.push(id);
        if(id===command.pageId)break;
        parent=parent.parent;
      }
      if(parents[parents.length-1]!==command.pageId)fail('WRONG_PAGE','Source ancestry does not reach the current page within 256 parent IDs.');
      const opacity='opacity' in node?node.opacity:undefined,visible='visible' in node?node.visible:undefined;
      const rendering:NonNullable<SourceNode['rendering']>={};
      if(typeof opacity==='number'&&Number.isFinite(opacity)&&opacity>=0&&opacity<=1)rendering.opacity=opacity;
      const source:SourceNode={id:node.id,parentId:parents[0]!,type:node.type,name:node.name,bbox:copyBounds(node),
        visible:visible!==false,rendering,sourceFileKey:command.fileKey,sourcePageId:command.pageId};
      if(node.type==='TEXT'&&'characters' in node)source.text=node.characters??'';
      const parsed=SourceNodeSchema.safeParse(source);
      if(!parsed.success)fail('INVALID_SOURCE_METADATA','Source metadata exceeds the bounded node schema; exact text and names were not truncated.');
      const transform='absoluteTransform' in node?node.absoluteTransform:undefined;
      return {source:parsed.data,parents,opacity,visible,transform:transform?[...transform[0],...transform[1]]:null};
    };
    const before=readObservation(),bounds=before.source.bbox;
    if(!bounds||bounds.width<=0||bounds.height<=0)fail('INVALID_BOUNDS','Requested source node has no positive-area absolute bounds.');
    if(before.transform&&(!before.transform.every(Number.isFinite)||Math.abs(before.transform[1]!)>1e-8||Math.abs(before.transform[3]!)>1e-8||before.transform[0]!<=0||before.transform[4]!<=0)) {
      fail('UNSUPPORTED_TRANSFORM','Node export withheld: rotated, reflected, skewed or invalid coordinate transforms are unsupported.');
    }
    if(!('exportAsync' in node)||!node.exportAsync)fail('PREVIEW_UNAVAILABLE','This node does not expose image export.');
    checkActive();
    options.onProgress?.({phase:'preview',nodes:0,bytes:0});
    checkActive();
    const scale=Math.min(1,maxDimension/Math.max(bounds.width,bounds.height));
    const image=await node.exportAsync({format:'PNG',contentsOnly:true,useAbsoluteBounds:true,constraint:{type:'SCALE',value:scale}});
    checkActive();
    const after=readObservation();
    if(JSON.stringify(before.source)!==JSON.stringify(after.source)||JSON.stringify(before.parents)!==JSON.stringify(after.parents)
      ||JSON.stringify(before.transform)!==JSON.stringify(after.transform)||!Object.is(before.opacity,after.opacity)||!Object.is(before.visible,after.visible)) {
      fail('NODE_CHANGED','Source node metadata or ancestry changed during export; the live image was discarded.');
    }
    if(image.byteLength>maxBytes)fail('IMAGE_TOO_LARGE',`Node PNG exceeds the ${maxBytes/1_000_000} MB image budget.`);
    const {width,height}=pngDimensions(image),expectedWidth=bounds.width*scale,expectedHeight=bounds.height*scale;
    const diagnostic=`PNG diagnostics: actual=${width}x${height}; requestedMaxDimension=${maxDimension}; scale=${scale}; sourceBounds=${bounds.width}x${bounds.height}; expectedScaled=${expectedWidth}x${expectedHeight}.`;
    if(width<1||height<1||width>maxDimension||height>maxDimension)fail('INVALID_IMAGE_SIZE',`Node PNG exceeds the requested pixel budget. ${diagnostic}`);
    if(Math.abs(width-expectedWidth)>2||Math.abs(height-expectedHeight)>2)fail('COORDINATE_MISMATCH',`Node PNG dimensions differ from absolute bounds; uncertain mapping was rejected. ${diagnostic}`);
    const result=NodePreviewResultSchema.parse({fileKey:command.fileKey,pageId:command.pageId,node:after.source,
      observedAt:options.capturedAt?.()??new Date().toISOString(),preview:{mimeType:'image/png',base64:encodeBase64(image),width,height},warnings:[
        'Current node export uses contentsOnly=true and useAbsoluteBounds=true; outside overlapping siblings are excluded. Ancestor opacity, clipping, masks and blending remain unverified.',
        'This is a current observation, not the captured historical image or an immutable Figma revision. Descendant, paint and external ancestor changes may remain undetected.',
        'Native image-export memory and runtime cannot be bounded or preempted before completion; late or cancelled results are discarded.',
        'Hidden or transparent nodes may produce blank PNGs or export errors. A blank image does not establish its cause.',
      ]});
    checkActive();return result;
  } catch(error) {
    checkActive();
    if(error instanceof PluginCommandError)throw error;
    fail('PREVIEW_UNAVAILABLE','Native Figma node export or source observation failed; no live image is available.');
  } finally {host.skipInvisibleInstanceChildren=previous;}
}

export async function executePluginCommand(host:CaptureHost,input:PluginCommand,options:CaptureOptions={}):Promise<unknown> {
  const command=PluginCommandSchema.parse(input);checkCancelled(options);
  if(command.type==='get_selection')return getSelection(host);
  if(command.type==='capture_selection')return captureSelection(host,command.limits,options);
  if(command.type==='capture_metadata')return captureMetadata(host,command,options);
  if(command.type==='preview_capture')return previewNode(host,command,options);
  if(command.type==='preview_node')return previewNode(host,command,options);
  if(command.type==='read_structure_chunk'||command.type==='release_structure_cursor'||command.type==='read_source_nodes'||command.type==='read_source_children'||command.type==='release_source_children')fail('SESSION_REQUIRED','These source reads require the plugin session reader.');
  if(!host.fileKey)fail('FILE_IDENTITY_UNAVAILABLE','Figma did not expose this file identity; source navigation cannot be verified.');
  if(host.fileKey!==command.fileKey)fail('WRONG_FILE','The connected plugin is not in the requested source file.');
  // Captures preserve hidden instance children. Dev Mode skips them by default,
  // so explicit source references need the same read access during navigation.
  const previous=host.skipInvisibleInstanceChildren;
  host.skipInvisibleInstanceChildren=false;
  try {
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
  } finally {host.skipInvisibleInstanceChildren=previous;}
}
