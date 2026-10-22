/** Bounded structural measurement only. Geometry is never semantic certainty. */
export interface Rect { x:number; y:number; width:number; height:number }
export interface NodeRecord {
  id:string; parentId:string|null; type:string; bbox:Rect|null;
  visible:boolean; layoutMode:string|null;
}
export interface ScopedNodeRecord extends NodeRecord { depth:number }
export interface NodeAdapter<N> { read(node:N):NodeRecord; children(node:N):readonly N[] }
export interface Limits { maxNodes:number; maxRecordBytes:number; maxDurationMs:number; maxPairChecks:number }
export const DEFAULT_LIMITS:Readonly<Limits> = Object.freeze({maxNodes:10000,maxRecordBytes:2000000,maxDurationMs:5000,maxPairChecks:250000});
export interface SourceScope { fileKey:string|null; pageId:string; rootId:string; revision?:string|null }
export interface AnalyzeOptions {
  source:SourceScope; limits:Limits; tolerancePx:number;
  now?:()=>number; yieldControl?:()=>Promise<void>;
}
export type Measurement<T> = {status:'measured';value:T} | {status:'not measured';reason:string};
const measured=<T>(value:T):Measurement<T>=>({status:'measured',value});
const unmeasured=<T=never>(reason:string):Measurement<T>=>({status:'not measured',reason});
export type StopReason='maxNodes'|'maxRecordBytes'|'maxDurationMs'|null;
export interface Extraction {
  records:ScopedNodeRecord[]; complete:boolean; stopReason:StopReason;
  durationMs:number; serializedRecordBytes:number;
}
export interface SpatialMetrics {
  complete:boolean; stopReason:'maxPairChecks'|'maxDurationMs'|null; pairChecks:number;
  boundedNodeCount:number; possiblePairCount:number;
  exactEqualBoxPairCount:number; exactEqualBoxNodeRatio:Measurement<number>;
  nearEqualBoxPairCount:number; nearEqualBoxNodeRatio:Measurement<number>;
  overlapPairCount:number; overlapPairRatio:Measurement<number>;
  containmentPairCount:number; containmentWithoutAncestryCount:number;
  containmentWithoutAncestryRatio:Measurement<number>;
  directParentPairCount:number; directParentNotContainingCount:number;
  directParentNotContainingRatio:Measurement<number>;
}
export interface AnalysisReport {
  schemaVersion:'1.0.0'; analyzerVersion:'0.1.0'; source:SourceScope;
  parameters:{limits:Limits;tolerancePx:number};
  extraction:Omit<Extraction,'records'>;
  scopeNodeCount:Measurement<number>; wholeFileNodeCount:Measurement<number>;
  structure:{nodeCount:number;typeCounts:Record<string,number>;maxDepth:number;meanDepth:number;
    frameGroupComponentInstanceRatios:Record<string,number>;autoLayoutEligibleCount:number;
    autoLayoutCount:number;autoLayoutRatio:number|null;textNodeCount:number;textNodeRatio:number;
    textNodesPerMillionSquarePixels:Measurement<number>;hiddenNodeCount:number;invalidOrMissingBoundsCount:number};
  spatial:SpatialMetrics;
  timing:{extractionMs:number;spatialMs:number;totalMs:number;clock:string};
  bytes:{recordNdjsonUtf8:number;reportJsonUtf8:number;networkTransfer:Measurement<number>};
  memory:{pluginHeapBytes:Measurement<number>;serverPeakHeapBytes:Measurement<number>};
  limitations:string[];
}

/** UTF-8 byte length without TextEncoder (unavailable in some plugin sandboxes). */
export function utf8Bytes(text:string):number {
  let count=0;
  for(let i=0;i<text.length;i++) {
    const c=text.charCodeAt(i);
    if(c<0x80)count++;
    else if(c<0x800)count+=2;
    else if(c>=0xd800&&c<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){count+=4;i++;}
    else count+=3;
  }
  return count;
}
export function validRect(r:Rect):boolean {
  return [r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height,r.width*r.height].every(Number.isFinite)&&r.width>=0&&r.height>=0;
}
export function contains(a:Rect,b:Rect,tolerance=0):boolean {
  return a.x-tolerance<=b.x&&a.y-tolerance<=b.y&&a.x+a.width+tolerance>=b.x+b.width&&a.y+a.height+tolerance>=b.y+b.height;
}
export function overlaps(a:Rect,b:Rect):boolean {
  return a.width>0&&a.height>0&&b.width>0&&b.height>0&&Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
}
export function nearEqual(a:Rect,b:Rect,tolerance:number):boolean {
  return Math.abs(a.x-b.x)<=tolerance&&Math.abs(a.y-b.y)<=tolerance&&Math.abs(a.x+a.width-b.x-b.width)<=tolerance&&Math.abs(a.y+a.height-b.y-b.height)<=tolerance;
}
function validateOptions(o:AnalyzeOptions):void {
  if(!Number.isFinite(o.tolerancePx)||o.tolerancePx<0||o.tolerancePx>100)throw new Error('tolerancePx must be finite, between 0 and 100');
  const ceilings:Limits={maxNodes:100000,maxRecordBytes:20000000,maxDurationMs:60000,maxPairChecks:2000000};
  for(const key of Object.keys(ceilings) as (keyof Limits)[]) {
    if(!Number.isSafeInteger(o.limits[key])||o.limits[key]<1||o.limits[key]>ceilings[key])throw new Error(`${key} must be a positive integer <= ${ceilings[key]}`);
  }
  if(!o.source.pageId||!o.source.rootId)throw new Error('source pageId and rootId are required');
}
function validateRecord(r:NodeRecord):void {
  if(typeof r.id!=='string'||!r.id||r.id.length>1024||typeof r.type!=='string'||!r.type||r.type.length>100)throw new Error('invalid node id or type');
  if(r.parentId!==null&&(typeof r.parentId!=='string'||r.parentId.length>1024))throw new Error('invalid parentId');
  if(typeof r.visible!=='boolean'||(r.layoutMode!==null&&typeof r.layoutMode!=='string'))throw new Error('invalid visibility/layoutMode');
  if(r.bbox!==null&&!validRect(r.bbox))throw new Error('invalid bbox');
}

/** Iterative pre-order read of ONE explicit root; no whole-file fallback or recursion. */
export async function extractScope<N>(root:N,adapter:NodeAdapter<N>,options:AnalyzeOptions):Promise<Extraction> {
  validateOptions(options);
  const now=options.now??Date.now,start=now();
  const records:ScopedNodeRecord[]=[],seen=new Set<string>();
  // One native children array per active ancestor, rather than pushing every sibling.
  const stack:{nodes:readonly N[];index:number;depth:number;parentId:string|null}[]=[{nodes:[root],index:0,depth:0,parentId:null}];
  let bytes=0,stopReason:StopReason=null;
  while(stack.length) {
    const top=stack[stack.length-1]!;
    if(top.index>=top.nodes.length){stack.pop();continue;}
    if(records.length>=options.limits.maxNodes){stopReason='maxNodes';break;}
    if(now()-start>=options.limits.maxDurationMs){stopReason='maxDurationMs';break;}
    const node=top.nodes[top.index++]!;
    const raw=adapter.read(node);validateRecord(raw);
    if(records.length===0&&raw.id!==options.source.rootId)throw new Error('source rootId does not match selected root');
    if(seen.has(raw.id))throw new Error('duplicate node id or cycle');
    if(top.depth>0&&raw.parentId!==top.parentId)throw new Error('adapter parentId differs from traversal parent');
    // Copy only contracted scalar metadata. Unknown fields/text cannot leak into output.
    const record:ScopedNodeRecord={id:raw.id,parentId:raw.parentId,type:raw.type,bbox:raw.bbox?{x:raw.bbox.x,y:raw.bbox.y,width:raw.bbox.width,height:raw.bbox.height}:null,visible:raw.visible,layoutMode:raw.layoutMode,depth:top.depth};
    const recordBytes=utf8Bytes(JSON.stringify(record))+1;
    if(bytes+recordBytes>options.limits.maxRecordBytes){stopReason='maxRecordBytes';break;}
    records.push(record);seen.add(record.id);bytes+=recordBytes;
    const children=adapter.children(node);
    if(children.length)stack.push({nodes:children,index:0,depth:top.depth+1,parentId:record.id});
    if(options.yieldControl&&records.length%200===0)await options.yieldControl();
  }
  return {records,complete:stopReason===null,stopReason,durationMs:Math.max(0,now()-start),serializedRecordBytes:bytes};
}

/** Sweep along x to avoid enumerating all disjoint pairs; dense cases have a hard cap. */
export function analyzeSpatial(records:readonly ScopedNodeRecord[],tolerance:number,maxPairChecks:number,deadline:number,now:()=>number):SpatialMetrics {
  const byId=new Map(records.map((r,i)=>[r.id,i]));
  const ends=new Array<number>(records.length).fill(records.length),stack:number[]=[];
  for(let i=0;i<records.length;i++) {
    while(stack.length&&records[stack[stack.length-1]!]!.depth>=records[i]!.depth)ends[stack.pop()!]=i;
    stack.push(i);
  }
  const ancestor=(a:number,b:number)=>a<b&&b<ends[a]!;
  const bounded=records.map((r,index)=>({r,index})).filter((v):v is {r:ScopedNodeRecord&{bbox:Rect};index:number}=>v.r.bbox!==null&&v.r.bbox.width>0&&v.r.bbox.height>0);
  bounded.sort((a,b)=>a.r.bbox.x-b.r.bbox.x||a.r.id.localeCompare(b.r.id,'en'));
  const exactCounts=new Map<string,number>();let exactPairs=0,exactNodes=0;
  for(const {r} of bounded) {const b=r.bbox;const key=JSON.stringify([b.x,b.y,b.width,b.height]);exactCounts.set(key,(exactCounts.get(key)??0)+1);}
  for(const n of exactCounts.values())if(n>1){exactPairs+=n*(n-1)/2;exactNodes+=n;}
  const nearNodes=new Set<number>();let nearPairs=0,overlapPairs=0,containmentPairs=0,mismatches=0,pairChecks=0;
  let stopReason:SpatialMetrics['stopReason']=null;
  outer:for(let i=0;i<bounded.length;i++) {
    const a=bounded[i]!;
    for(let j=i+1;j<bounded.length;j++) {
      const b=bounded[j]!;
      if(b.r.bbox.x>a.r.bbox.x+a.r.bbox.width+tolerance)break;
      if(pairChecks>=maxPairChecks){stopReason='maxPairChecks';break outer;}
      if(now()>=deadline){stopReason='maxDurationMs';break outer;}
      pairChecks++;
      if(overlaps(a.r.bbox,b.r.bbox))overlapPairs++;
      const ab=contains(a.r.bbox,b.r.bbox,tolerance),ba=contains(b.r.bbox,a.r.bbox,tolerance);
      if(nearEqual(a.r.bbox,b.r.bbox,tolerance)){nearPairs++;nearNodes.add(a.index);nearNodes.add(b.index);}
      // Mutual tolerant containment is ambiguous equivalence, never a parent edge.
      if(ab!==ba) {
        containmentPairs++;
        if(!(ab?ancestor(a.index,b.index):ancestor(b.index,a.index)))mismatches++;
      }
    }
  }
  let parentPairs=0,parentNotContaining=0;
  for(const {r} of bounded) {
    const p=byId.get(r.parentId??'');if(p===undefined)continue;
    const parent=records[p]!;
    if(!parent.bbox||parent.bbox.width<=0||parent.bbox.height<=0)continue;
    parentPairs++;if(!contains(parent.bbox,r.bbox,tolerance))parentNotContaining++;
  }
  const complete=stopReason===null,possiblePairCount=bounded.length*(bounded.length-1)/2;
  const rate=(v:number,n:number):Measurement<number>=>n?measured(v/n):unmeasured('zero denominator');
  const spatialRate=(v:number,n:number)=>complete?rate(v,n):unmeasured<number>('spatial pair budget exhausted; counts are observed lower bounds');
  return {complete,stopReason,pairChecks,boundedNodeCount:bounded.length,possiblePairCount,exactEqualBoxPairCount:exactPairs,exactEqualBoxNodeRatio:rate(exactNodes,bounded.length),nearEqualBoxPairCount:nearPairs,nearEqualBoxNodeRatio:spatialRate(nearNodes.size,bounded.length),overlapPairCount:overlapPairs,overlapPairRatio:spatialRate(overlapPairs,possiblePairCount),containmentPairCount:containmentPairs,containmentWithoutAncestryCount:mismatches,containmentWithoutAncestryRatio:spatialRate(mismatches,containmentPairs),directParentPairCount:parentPairs,directParentNotContainingCount:parentNotContaining,directParentNotContainingRatio:rate(parentNotContaining,parentPairs)};
}

export async function analyzeScope<N>(root:N,adapter:NodeAdapter<N>,options:AnalyzeOptions):Promise<AnalysisReport> {
  validateOptions(options);
  const now=options.now??Date.now,start=now();
  const extraction=await extractScope(root,adapter,options),records=extraction.records;
  const typeCounts:Record<string,number>=Object.create(null) as Record<string,number>;
  let depthSum=0,maxDepth=0,autoLayoutEligibleCount=0,autoLayoutCount=0,hiddenNodeCount=0,missingBounds=0;
  const eligible=new Set(['FRAME','COMPONENT','COMPONENT_SET','INSTANCE']);
  for(const r of records) {
    typeCounts[r.type]=(typeCounts[r.type]??0)+1;depthSum+=r.depth;maxDepth=Math.max(maxDepth,r.depth);
    if(eligible.has(r.type)){autoLayoutEligibleCount++;if(r.layoutMode!==null&&r.layoutMode!=='NONE')autoLayoutCount++;}
    if(!r.visible)hiddenNodeCount++;
    if(!r.bbox||r.bbox.width<=0||r.bbox.height<=0)missingBounds++;
  }
  const spatialStart=now();
  const spatial=analyzeSpatial(records,options.tolerancePx,options.limits.maxPairChecks,start+options.limits.maxDurationMs,now);
  const spatialMs=Math.max(0,now()-spatialStart),nodeCount=records.length,textNodeCount=typeCounts.TEXT??0;
  const rootBox=records[0]?.bbox;
  const ratios:Record<string,number>={};for(const type of ['FRAME','GROUP','COMPONENT','INSTANCE'])ratios[type]=nodeCount?(typeCounts[type]??0)/nodeCount:0;
  const {records:_,...summary}=extraction;
  const report:AnalysisReport={
    schemaVersion:'1.0.0',analyzerVersion:'0.1.0',source:{...options.source},parameters:{limits:{...options.limits},tolerancePx:options.tolerancePx},
    extraction:summary,scopeNodeCount:extraction.complete?measured(nodeCount):unmeasured('extraction stopped early; structure metrics describe observed prefix only'),
    wholeFileNodeCount:unmeasured('one explicit scope only; no whole-file traversal'),
    structure:{nodeCount,typeCounts,maxDepth,meanDepth:nodeCount?depthSum/nodeCount:0,frameGroupComponentInstanceRatios:ratios,autoLayoutEligibleCount,autoLayoutCount,autoLayoutRatio:autoLayoutEligibleCount?autoLayoutCount/autoLayoutEligibleCount:null,textNodeCount,textNodeRatio:nodeCount?textNodeCount/nodeCount:0,textNodesPerMillionSquarePixels:rootBox&&rootBox.width*rootBox.height>0?measured(textNodeCount/(rootBox.width*rootBox.height)*1000000):unmeasured('root has no positive-area bbox; no inferred canvas area'),hiddenNodeCount,invalidOrMissingBoundsCount:missingBounds},
    spatial,timing:{extractionMs:extraction.durationMs,spatialMs,totalMs:Math.max(0,now()-start),clock:options.now?'caller-provided milliseconds':'Date.now milliseconds'},
    bytes:{recordNdjsonUtf8:extraction.serializedRecordBytes,reportJsonUtf8:0,networkTransfer:unmeasured('serialized bytes are not measured transport or Figma internal loading bytes')},
    memory:{pluginHeapBytes:unmeasured('Plugin API exposes no portable heap counter'),serverPeakHeapBytes:unmeasured('requires external process instrumentation; record byte budget is not heap memory')},
    limitations:[
      'All counts/depths/ratios refer to this scope (root depth 0), or the observed pre-order prefix when extraction.complete is false.',
      'Absolute axis-aligned BBoxes ignore rendered clipping, masks, rotation silhouettes and occlusion; hidden nodes are included.',
      'Near-equal compares all four edges within tolerancePx; exact and near-equal ratios count participating bounded nodes. Near-equal includes exact.',
      'Strict one-way tolerant containment excludes mutual containment; this relation is geometric, never a semantic component hierarchy.',
      'Spatial counts are lower bounds if spatial.complete is false; extraction truncation also prevents whole-scope inference.',
      'No node names, text contents, assets, images or inferred semantic labels are included.',
      'Time budgets are cooperative between node/property and pair reads, not preemptive limits on a blocked host API call.',
    ],
  };
  return finalizeReportBytes(report);
}

/** Recompute after adapters append coverage metadata; includes the field itself. */
export function finalizeReportBytes<T extends AnalysisReport>(report:T):T {
  for(let i=0;i<5;i++){const bytes=utf8Bytes(JSON.stringify(report));if(bytes===report.bytes.reportJsonUtf8)break;report.bytes.reportJsonUtf8=bytes;}
  return report;
}
