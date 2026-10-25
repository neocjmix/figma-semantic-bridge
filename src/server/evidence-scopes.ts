import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EvidenceScopeSchema, type EvidenceScope, type Operation, type Project, type Rect, type SourceNode, type SourceReference } from '../shared/contracts.js';
import { type OperationContext, type SourceAccess, type ApprovedExportOptions, approvedContext, approvedRecords, validateProject, sourceScope, inlineScope } from '../core/index.js';
import { matchCollectionRegion } from '../core/collection-matching.js';
import type { MatchResult } from '../core/matching.js';
import type { CollectionQuery, CollectionTextQuery } from '../shared/structure-collection.js';
import { CollectionStore } from './structure-collection-store.js';
import { ProjectStore } from './store.js';
import { AcquisitionManager } from './acquisition.js';
import { ServiceError } from './errors.js';

const matchKey=(scopeId:string,region:Rect,tolerance=0.5)=>JSON.stringify([scopeId,region.x,region.y,region.width,region.height,tolerance]);

/** Bridges explicitly backed scopes to pure editing operations without materializing a full source tree. */
export class EvidenceScopes {
  constructor(private readonly projects:ProjectStore,readonly collections:CollectionStore,private readonly acquisitions:AcquisitionManager){}
  validateScope(projectId:string,scope:EvidenceScope):void {
    if(scope.kind==='visual')return;
    const reference=scope.collection!;
    const view=this.collections.get(projectId,reference.id),actual=this.collections.descriptor(projectId,reference.id);
    if(!isDeepStrictEqual(reference,actual)||scope.source.fileKey!==view.source.fileKey||scope.source.pageId!==view.source.pageId||
      scope.source.rootId!==view.source.nodeId||!isDeepStrictEqual(scope.bounds,view.source.bounds))
      throw new ServiceError('SOURCE_BINDING_CHANGED','The editor source does not match its complete immutable collection.',409);
  }
  private scope(project:Project,id:string):EvidenceScope {
    const scope=project.scopes?.find(value=>value.id===id);
    if(!scope)throw new ServiceError('NOT_FOUND','Evidence scope not found.',404);
    this.validateScope(project.id,scope);return scope;
  }
  private complete(project:Project,id:string):EvidenceScope & {collection:NonNullable<EvidenceScope['collection']>} {
    const scope=this.scope(project,id);
    if(!scope.collection)throw new ServiceError('SOURCE_INCOMPLETE','Attach a complete source collection before reading or approving source evidence.',409);
    return scope as EvidenceScope & {collection:NonNullable<EvidenceScope['collection']>};
  }
  async create(projectId:string,expectedRevision:number,input:{acquisitionId?:string;collectionId?:string}):Promise<Project>{
    if(!input.acquisitionId&&!input.collectionId)throw new ServiceError('INVALID_INPUT','Choose an overview or complete source collection.');
    const project=await this.projects.get(projectId);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload the workspace before adding an evidence scope.',409);
    const image=input.acquisitionId?this.acquisitions.preview(projectId,input.acquisitionId):null;
    const view=input.collectionId?this.collections.get(projectId,input.collectionId):null;
    const collection=input.collectionId?this.collections.descriptor(projectId,input.collectionId):null;
    if(image&&view&&(image.fileKey!==view.source.fileKey||image.pageId!==view.source.pageId||image.node.id!==view.source.nodeId||!isDeepStrictEqual(image.node.bbox,view.source.bounds)))
      throw new ServiceError('SOURCE_BINDING_CHANGED','Overview and structure must describe the same selected file, page, root and bounds.',409);
    const scope=EvidenceScopeSchema.parse({id:randomUUID(),kind:collection?'collection':'visual',
      name:(image?.node.name??view!.source.name).slice(0,300)||'Source scope',
      source:{fileKey:image?.fileKey??view!.source.fileKey,pageId:image?.pageId??view!.source.pageId,rootId:image?.node.id??view!.source.nodeId,
        revision:null,capturedAt:image?.observedAt??collection!.observedAt},bounds:image?.node.bbox??view!.source.bounds,
      preview:image?.preview??null,visualObservation:image?{taskId:input.acquisitionId!,observedAt:image.observedAt}:null,collection,
      warnings:[...new Set([...(image?.warnings??[]),...(view?.warnings??[]),'Image and structure are separate live observations; complete structural coverage does not prove one immutable Figma revision.'])].slice(0,100)});
    const save=()=>this.projects.mutate(projectId,expectedRevision,{type:'add_evidence_scope',scope},'human',true);
    return collection?this.collections.using(projectId,collection.id,save):save();
  }
  async attach(projectId:string,id:string,expectedRevision:number,collectionId:string):Promise<Project>{
    const project=await this.projects.get(projectId),scope=this.scope(project,id);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before attaching source structure.',409);
    const reference=this.collections.descriptor(projectId,collectionId);
    this.validateScope(projectId,{...scope,kind:'collection',collection:reference});
    return this.collections.using(projectId,collectionId,()=>this.projects.mutate(projectId,expectedRevision,{type:'attach_scope_collection',scopeId:id,collection:reference},'human',true));
  }
  async query(project:Project,id:string,input:CollectionQuery){const scope=this.complete(project,id);return this.collections.query(project.id,scope.collection.id,input);}
  async text(project:Project,id:string,input:CollectionTextQuery){const scope=this.complete(project,id);return this.collections.text(project.id,scope.collection.id,input);}
  async records(project:Project,id:string,nodeIds:readonly string[]):Promise<SourceNode[]>{
    const scope=sourceScope(project,id);
    if(!scope)throw new ServiceError('NOT_FOUND','Source scope not found.',404);
    if(inlineScope(scope))return nodeIds.map(id=>{const node=scope.nodes.find(value=>value.id===id);if(!node)throw new ServiceError('NOT_FOUND','Source node not found.',404);return node;});
    const backed=this.complete(project,id);return this.collections.records(project.id,backed.collection.id,nodeIds);
  }
  async access(project:Project,extraRefs:readonly SourceReference[]=[],includeAnnotations=false,verifyScopes:readonly string[]=[]):Promise<SourceAccess>{
    for(const scope of project.scopes??[])this.validateScope(project.id,scope);
    const refs=[...project.specifications.flatMap(value=>value.sourceRefs),...extraRefs,
      ...(includeAnnotations?project.annotations.filter(value=>value.reviewStatus==='approved').flatMap(value=>value.sourceRefs):[])];
    const grouped=new Map<string,Set<string>>(),resolved=new Map<string,Map<string,SourceNode>>();
    for(const ref of refs){const scope=sourceScope(project,ref.snapshotId);if(scope&&!inlineScope(scope)){
      const ids=grouped.get(scope.id)??new Set<string>();ids.add(ref.nodeId);grouped.set(scope.id,ids);
    }}
    // Cached ID membership is not proof that the complete stored tree remains
    // intact. Approval, history restoration and export depend on all its chunks,
    // including records outside the selected region. Recheck them as a stream.
    const verified=new Set<string>();
    for(const scopeId of new Set([...verifyScopes,...(includeAnnotations?[...grouped.keys()]:[])])){
      const scope=sourceScope(project,scopeId);
      if(!scope||inlineScope(scope)||!scope.collection||verified.has(scope.collection.id))continue;
      this.validateScope(project.id,scope);
      for await(const _packet of this.collections.iterate(project.id,scope.collection.id)){/* Each read verifies its immutable digest. */}
      verified.add(scope.collection.id);
    }
    for(const [scopeId,ids] of grouped){const nodes=await this.records(project,scopeId,[...ids]);resolved.set(scopeId,new Map(nodes.map(node=>[node.id,node])));}
    return {
      hasNode:(scopeId,nodeId)=>{const scope=sourceScope(project,scopeId);return !!scope&&(inlineScope(scope)?scope.nodes.some(node=>node.id===nodeId):
        !!scope.collection&&this.collections.hasNode(project.id,scope.collection.id,nodeId));},
      getNode:(scopeId,nodeId)=>{const scope=sourceScope(project,scopeId);return scope&&inlineScope(scope)?scope.nodes.find(node=>node.id===nodeId):resolved.get(scopeId)?.get(nodeId);},
    };
  }
  async context(project:Project,operation:Operation):Promise<Partial<OperationContext>>{
    if(operation.type==='add_evidence_scope')this.validateScope(project.id,operation.scope);
    if(operation.type==='attach_scope_collection')this.validateScope(project.id,{...this.scope(project,operation.scopeId),kind:'collection',collection:operation.collection});
    const annotation= 'id' in operation?project.annotations.find(value=>value.id===operation.id):undefined;
    const extra=operation.type==='upsert_specification'?operation.specification.sourceRefs:
      operation.type==='upsert_annotation'?operation.annotation.sourceRefs:
      (operation.type==='confirm_annotation_sources'||operation.type==='review_annotation')?annotation?.sourceRefs??[]:
      operation.type==='submit_proposal'?operation.draft.specifications.flatMap(value=>value.sourceRefs):
      operation.type==='resolve_proposal'?project.proposals.find(value=>value.id===operation.id)?.draft.specifications.flatMap(value=>value.sourceRefs)??[]:[];
    const verifyScopes:string[]=[];
    if(annotation&&(operation.type==='confirm_annotation_sources'||operation.type==='review_annotation'&&operation.status==='approved'))verifyScopes.push(annotation.snapshotId);
    if(operation.type==='review_specification'&&operation.status==='approved'){
      const specification=project.specifications.find(value=>value.id===operation.id);
      verifyScopes.push(...specification?.sourceRefs.map(ref=>ref.snapshotId)??[]);
      for(const relation of specification?.relations??[]){const target=project.annotations.find(value=>value.id===relation.targetAnnotationId);if(target)verifyScopes.push(target.snapshotId);}
    }
    const sources=await this.access(project,extra,operation.type==='rename_project',verifyScopes),matches=new Map<string,MatchResult>();
    const scan=async(scopeId:string,box:Rect,tolerance=0.5)=>{
      const scope=sourceScope(project,scopeId);if(!scope||inlineScope(scope)||scope.kind==='visual')return;
      this.validateScope(project.id,scope);
      const key=matchKey(scopeId,box,tolerance);if(matches.has(key))return;
      matches.set(key,await matchCollectionRegion(scopeId,box,this.collections.iterate(project.id,scope.collection!.id),{expectedNodeCount:scope.collection!.nodeCount,tolerance}));
    };
    const review=async(input:Project['annotations'][number],force=false,tolerance=0.5)=>{
      const prior=project.annotations.find(value=>value.id===input.id);
      if(force||!prior?.sourceReview||prior.snapshotId!==input.snapshotId||!isDeepStrictEqual(prior.bbox,input.bbox))await scan(input.snapshotId,input.bbox,tolerance);
    };
    if(operation.type==='upsert_annotation')await review(operation.annotation);
    else if(operation.type==='match_annotation'&&annotation)await review(annotation,true,operation.tolerance);
    else if((operation.type==='review_annotation'||operation.type==='confirm_annotation_sources')&&annotation)await review(annotation);
    else if(operation.type==='split_annotation'&&annotation){
      const first={...annotation.bbox},second={...annotation.bbox};
      if(operation.axis==='vertical'){first.width*=operation.ratio;second.x+=first.width;second.width-=first.width;}
      else{first.height*=operation.ratio;second.y+=first.height;second.height-=first.height;}
      await scan(annotation.snapshotId,first);await scan(annotation.snapshotId,second);
    }else if(operation.type==='merge_annotations'){
      const selected=project.annotations.filter(value=>operation.ids.includes(value.id));
      if(selected.length){const x=Math.min(...selected.map(value=>value.bbox.x)),y=Math.min(...selected.map(value=>value.bbox.y));
        await scan(selected[0]!.snapshotId,{x,y,width:Math.max(...selected.map(value=>value.bbox.x+value.bbox.width))-x,height:Math.max(...selected.map(value=>value.bbox.y+value.bbox.height))-y});}
    }else if(operation.type==='submit_proposal')for(const input of operation.draft.annotations)await scan(input.snapshotId,input.bbox);
    else if(operation.type==='resolve_proposal'&&operation.decision==='accept')for(const input of project.proposals.find(value=>value.id===operation.id)?.draft.annotations??[])await scan(input.snapshotId,input.bbox);
    return {sources,match:(scopeId,box,tolerance=0.5)=>{const result=matches.get(matchKey(scopeId,box,tolerance));
      if(!result)throw new ServiceError('SOURCE_RESOLUTION_REQUIRED','Full-scope source matching was not prepared for this operation.',409);return result;}};
  }
  async export(project:Project,options:ApprovedExportOptions={}){
    return approvedContext(project,options,await this.access(project,[],true));
  }
  async approved(project:Project){
    const sources=await this.access(project,[],true);
    return approvedRecords(validateProject(project,sources));
  }
}
