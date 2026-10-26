import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EvidenceScopeSchema, type EvidenceScope, type Operation, type Project, type Rect, type SourceNode, type SourceReference } from '../shared/contracts.js';
import { type OperationContext, type SourceAccess, type ApprovedExportOptions, approvedContext, approvedRecords, validateProject, sourceScope, inlineScope } from '../core/index.js';
import { matchCollectionRegion } from '../core/collection-matching.js';
import type { MatchResult } from '../core/matching.js';
import type { CollectionQuery, CollectionTextQuery, StructureChunk } from '../shared/structure-collection.js';
import type { CollectionEvidenceBranch } from '../shared/collection-evidence.js';
import { CollectionStore } from './structure-collection-store.js';
import { ProjectStore } from './store.js';
import { AcquisitionManager } from './acquisition.js';
import { ServiceError } from './errors.js';

const matchKey=(scopeId:string,region:Rect,tolerance=0.5)=>JSON.stringify([scopeId,region.x,region.y,region.width,region.height,tolerance]);

/** Bridges explicitly backed scopes to pure editing operations without materializing a full source tree. */
export class EvidenceScopes {
  constructor(private readonly projects:ProjectStore,readonly collections:CollectionStore,private readonly acquisitions:AcquisitionManager){}
  private branchRef(value:CollectionEvidenceBranch,projectId:string):NonNullable<EvidenceScope['branch']>{
    const view=this.collections.get(projectId,value.collectionId);
    return {collectionId:value.collectionId,nodeId:value.root.id,contentHash:value.contentHash,startOffset:value.startOffset,
      endOffset:value.endOffset,nodeCount:value.nodeCount,startedAt:value.startedAt,observedAt:value.observedAt,
      enclosingRootId:view.partOf?.contextRootId??value.source.scopeId??value.source.nodeId,
      ancestorRendering:value.ancestorRendering,coverage:'closed-saved-subtree',freshness:'not-revalidated'};
  }
  private async branch(projectId:string,scope:EvidenceScope){
    if(!scope.branch)throw new ServiceError('SOURCE_INCOMPLETE','This source has no verified branch.',409);
    const value=await this.collections.evidenceBranch(projectId,scope.branch.collectionId,scope.branch.nodeId);
    if(!isDeepStrictEqual(scope.branch,this.branchRef(value,projectId))||scope.source.fileKey!==value.source.fileKey||scope.source.pageId!==value.source.pageId||
      scope.source.rootId!==value.root.id||!isDeepStrictEqual(scope.coverageBounds,value.root.bbox))
      throw new ServiceError('SOURCE_BINDING_CHANGED','The saved branch no longer matches its verified source range.',409);
    return value;
  }
  /** The virtual stream preserves every record and observation time; it claims only this closed subtree. */
  async *iterate(project:Project,scope:EvidenceScope):AsyncGenerator<StructureChunk>{
    if(scope.kind==='collection'){yield* this.collections.iterate(project.id,scope.collection!.id);return;}
    const branch=await this.branch(project.id,scope);let sequence=0,count=0;
    const build=(nodes:SourceNode[],childCounts:number[],observedAt:string):StructureChunk=>{
      const complete=count+nodes.length===branch.nodeCount;
      return {collectionId:scope.id,sequence,fileKey:branch.source.fileKey,pageId:branch.source.pageId,root:branch.root,
        bounds:scope.coverageBounds!,startedAt:branch.startedAt,observedAt,nodes,childCounts,
        complete,nextSequence:complete?null:sequence+1,warnings:['Coverage is limited to this saved branch; the enclosing source may remain incomplete.'],consistency:'live-session-observation'};
    };
    for await(const packet of this.collections.iterateEvidenceBranch(project.id,branch.collectionId,branch)){
      let nodes:SourceNode[]=[],counts:number[]=[];
      for(let i=0;i<packet.nodes.length;i++){
        const next=build([...nodes,packet.nodes[i]!],[...counts,packet.childCounts[i]!],packet.observedAt);
        if(Buffer.byteLength(JSON.stringify(next))>1_000_000&&nodes.length){
          yield build(nodes,counts,packet.observedAt);count+=nodes.length;sequence++;nodes=[];counts=[];
        }
        nodes.push(packet.nodes[i]!);counts.push(packet.childCounts[i]!);
      }
      if(nodes.length){const next=build(nodes,counts,packet.observedAt);
        if(Buffer.byteLength(JSON.stringify(next))>1_000_000)throw new ServiceError('RESPONSE_LIMIT','A branch record exceeds its bounded matching packet.',413);
        yield next;count+=nodes.length;sequence++;
      }
    }
  }

  async validateScope(projectId:string,scope:EvidenceScope):Promise<void> {
    if(scope.kind==='visual')return;
    if(scope.kind==='branch'){await this.branch(projectId,scope);return;}
    const reference=scope.collection!;
    const view=this.collections.get(projectId,reference.id),actual=this.collections.descriptor(projectId,reference.id);
    if(!isDeepStrictEqual(reference,actual)||scope.source.fileKey!==view.source.fileKey||scope.source.pageId!==view.source.pageId||
      scope.source.rootId!==view.source.nodeId||!isDeepStrictEqual(scope.bounds,view.source.bounds))
      throw new ServiceError('SOURCE_BINDING_CHANGED','The editor source does not match its complete immutable collection.',409);
  }
  private async scope(project:Project,id:string):Promise<EvidenceScope> {
    const scope=project.scopes?.find(value=>value.id===id);
    if(!scope)throw new ServiceError('NOT_FOUND','Evidence scope not found.',404);
    await this.validateScope(project.id,scope);return scope;
  }
  private async complete(project:Project,id:string):Promise<EvidenceScope> {
    const scope=await this.scope(project,id);
    if(scope.kind==='visual')throw new ServiceError('SOURCE_INCOMPLETE','Attach a complete source collection before reading or approving source evidence.',409);
    return scope;
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
    const project=await this.projects.get(projectId),scope=await this.scope(project,id);
    if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before attaching source structure.',409);
    const reference=this.collections.descriptor(projectId,collectionId);
    await this.validateScope(projectId,{...scope,kind:'collection',collection:reference});
    return this.collections.using(projectId,collectionId,()=>this.projects.mutate(projectId,expectedRevision,{type:'attach_scope_collection',scopeId:id,collection:reference},'human',true));
  }
  async createBranch(projectId:string,expectedRevision:number,input:{collectionId:string;nodeId:string;contextScopeId?:string}):Promise<Project>{
    return this.collections.usingEvidence(projectId,input.collectionId,async()=>{
      const project=await this.projects.get(projectId);
      if(project.revision!==expectedRevision)throw new ServiceError('REVISION_CONFLICT','Reload before opening a saved branch.',409);
      const branch=await this.collections.evidenceBranch(projectId,input.collectionId,input.nodeId);
      const view=this.collections.get(projectId,input.collectionId);
      const box=branch.root.bbox;
      if(!box||box.width<=0||box.height<=0)throw new ServiceError('INVALID_BRANCH','This saved node has no drawable bounds.',409);
      const context=input.contextScopeId?sourceScope(project,input.contextScopeId):undefined;
      const contextRootId=view.partOf?.contextRootId??branch.source.nodeId;
      const contextBounds=view.partOf?.contextBounds??branch.source.bounds;
      if(view.partOf){
        const original=this.collections.get(projectId,view.partOf.contextCollectionId);
        if(original.source.fileKey!==branch.source.fileKey||original.source.pageId!==branch.source.pageId||
          original.source.nodeId!==contextRootId||!isDeepStrictEqual(original.source.bounds,contextBounds))
          throw new ServiceError('SOURCE_BINDING_CHANGED','The requested part no longer has its original source context.',409);
      }
      if(input.contextScopeId&&(!context||context.source.fileKey!==branch.source.fileKey||context.source.pageId!==branch.source.pageId||
        context.source.rootId!==contextRootId||!isDeepStrictEqual(context.bounds,contextBounds)))
        throw new ServiceError('SOURCE_BINDING_CHANGED','The overview does not belong to this saved source.',409);
      const image=context?.preview??null;
      const b=image?context!.bounds:box,x=Math.min(b.x,box.x),y=Math.min(b.y,box.y);
      const bounds={x,y,width:Math.max(b.x+b.width,box.x+box.width)-x,height:Math.max(b.y+b.height,box.y+box.height)-y};
      const scope=EvidenceScopeSchema.parse({id:randomUUID(),kind:'branch',name:branch.root.name.slice(0,300)||'Saved branch',
        source:{fileKey:branch.source.fileKey,pageId:branch.source.pageId,rootId:branch.root.id,revision:null,capturedAt:branch.observedAt},
        bounds,coverageBounds:box,...(image?{visualBounds:b}:{}),preview:image,
        visualObservation:image?('visualObservation' in context!?context!.visualObservation:null):null,
        collection:null,branch:this.branchRef(branch,projectId),warnings:[
          'Only this saved branch is complete. The enclosing source import may remain incomplete.',
          'This is a historical observation. Its contents have not been checked against the current Figma design.',
          'The image is visual context, not proof that outside branches were acquired. Confirm that the selected source scope is sufficient for this region.']});
      return this.projects.mutate(projectId,expectedRevision,{type:'add_evidence_scope',scope},'human',true);
    });
  }
  async copyRegions(projectId:string,id:string,expectedRevision:number,sourceScopeId:string,annotationIds:string[]){
    return this.projects.mutate(projectId,expectedRevision,{type:'copy_scope_regions',sourceScopeId,targetScopeId:id,annotationIds},'human',true);
  }
  async query(project:Project,id:string,input:CollectionQuery){
    const scope=await this.complete(project,id);
    if(scope.collection)return this.collections.query(project.id,scope.collection.id,input);
    const branch=await this.branch(project.id,scope),page=await this.collections.evidence(project.id,branch.collectionId,input,branch);
    return {nodes:page.nodes.map(({textAvailable:_a,declaredChildCount:_d,observedChildCount:_o,subtreeComplete:_s,...node})=>node),
      total:page.total,nextOffset:page.nextOffset,complete:true as const,reviewStatus:'unreviewed' as const};
  }
  async text(project:Project,id:string,input:CollectionTextQuery){
    const scope=await this.complete(project,id);
    if(scope.collection)return this.collections.text(project.id,scope.collection.id,input);
    const branch=await this.branch(project.id,scope),{snapshot:_snapshot,...text}=await this.collections.evidenceText(project.id,branch.collectionId,input,branch);return text;
  }
  async records(project:Project,id:string,nodeIds:readonly string[]):Promise<SourceNode[]>{
    const scope=sourceScope(project,id);
    if(!scope)throw new ServiceError('NOT_FOUND','Source scope not found.',404);
    if(inlineScope(scope))return nodeIds.map(id=>{const node=scope.nodes.find(value=>value.id===id);if(!node)throw new ServiceError('NOT_FOUND','Source node not found.',404);return node;});
    const backed=await this.complete(project,id);
    if(backed.collection)return this.collections.records(project.id,backed.collection.id,nodeIds);
    const branch=await this.branch(project.id,backed);return this.collections.evidenceRecords(project.id,branch.collectionId,nodeIds,branch);
  }
  async access(project:Project,extraRefs:readonly SourceReference[]=[],includeAnnotations=false,verifyScopes:readonly string[]=[]):Promise<SourceAccess>{
    for(const scope of project.scopes??[])await this.validateScope(project.id,scope);
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
      if(!scope||inlineScope(scope)||scope.kind==='visual'||verified.has(scope.id))continue;
      await this.validateScope(project.id,scope);
      for await(const _packet of this.iterate(project,scope)){/* Each read verifies its immutable digest. */}
      verified.add(scope.id);
    }
    for(const [scopeId,ids] of grouped){const nodes=await this.records(project,scopeId,[...ids]);resolved.set(scopeId,new Map(nodes.map(node=>[node.id,node])));}
    return {
      hasNode:(scopeId,nodeId)=>{const scope=sourceScope(project,scopeId);return !!scope&&(inlineScope(scope)?scope.nodes.some(node=>node.id===nodeId):
        scope.collection?this.collections.hasNode(project.id,scope.collection.id,nodeId):!!scope.branch&&this.collections.hasEvidenceNode(project.id,scope.branch.collectionId,nodeId,scope.branch));},
      getNode:(scopeId,nodeId)=>{const scope=sourceScope(project,scopeId);return scope&&inlineScope(scope)?scope.nodes.find(node=>node.id===nodeId):resolved.get(scopeId)?.get(nodeId);},
    };
  }
  async context(project:Project,operation:Operation):Promise<Partial<OperationContext>>{
    if(operation.type==='add_evidence_scope')await this.validateScope(project.id,operation.scope);
    if(operation.type==='attach_scope_collection')await this.validateScope(project.id,{...await this.scope(project,operation.scopeId),kind:'collection',collection:operation.collection});
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
      await this.validateScope(project.id,scope);
      const key=matchKey(scopeId,box,tolerance);if(matches.has(key))return;
      matches.set(key,await matchCollectionRegion(scopeId,box,this.iterate(project,scope),{expectedNodeCount:scope.collection?.nodeCount??scope.branch!.nodeCount,tolerance,
        ...(scope.branch?{ancestorRendering:scope.branch.ancestorRendering.status}:{})}));
    };
    const review=async(input:Project['annotations'][number],force=false,tolerance=0.5)=>{
      const prior=project.annotations.find(value=>value.id===input.id);
      if(force||!prior?.sourceReview||prior.snapshotId!==input.snapshotId||!isDeepStrictEqual(prior.bbox,input.bbox))await scan(input.snapshotId,input.bbox,tolerance);
    };
    if(operation.type==='copy_scope_regions')for(const id of operation.annotationIds){const a=project.annotations.find(value=>value.id===id);if(a)await scan(operation.targetScopeId,a.bbox);}
    else if(operation.type==='upsert_annotation')await review(operation.annotation);
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
