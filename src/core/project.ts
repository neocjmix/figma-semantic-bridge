import {
  OperationSchema, ProjectSchema, type Annotation, type Draft, type Operation, type Project,
  type Rect, type Snapshot, type SourceNode, type SourceReference, type Specification,
} from '../shared/contracts.js';
import { contains } from '../fixture-analysis/index.js';
import { matchRegion, type MatchResult } from './matching.js';
import { annotationSourceReview, sourceReviewFromMatch } from './source-review.js';
import { sourceScopes, sourceScope, inlineScope, completeScope, type SourceScope } from './source-scopes.js';

/** Stable error codes are safe to expose; source text is never embedded in errors. */
export class DomainError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}
function fail(message: string): never { throw new DomainError('INVALID_PROJECT', message); }
const lookup = <T extends {id:string}>(items:readonly T[], id:string, kind:string):T => {
  const item = items.find(item => item.id === id);
  if (!item) throw new DomainError('NOT_FOUND', `${kind} was not found.`);
  return item;
};
function uniqueIds(items:readonly {id:string}[], kind:string):void {
  if (new Set(items.map(item => item.id)).size !== items.length) fail(`Duplicate ${kind} identifiers.`);
}
function requireCompleteSource(snapshot:SourceScope):void {
  if (!completeScope(snapshot)) throw new DomainError('SOURCE_INCOMPLETE', 'The requested source capture is incomplete. Complete its acquisition before matching, confirming sources or granting a new approval.');
}
function requireRegionCoverage(scope:SourceScope,region:Rect):void {
  if(!inlineScope(scope)&&scope.kind==='branch'&&(!scope.coverageBounds||!contains(scope.coverageBounds,region,0.01)))
    throw new DomainError('SOURCE_REGION_INCOMPLETE','This region extends beyond the prepared source part. Acquire its full required source before confirming or approving it.');
}

/** Linear-time parent validation, including disconnected cycles. */
function validateParents(items:readonly {id:string;parentId:string|null}[], allowExternalRoot?:string):void {
  const byId = new Map(items.map(item => [item.id,item]));
  const done = new Set<string>();
  for (const item of items) {
    const trail = new Set<string>();
    let cursor:typeof item|undefined = item;
    while (cursor && !done.has(cursor.id)) {
      if (trail.has(cursor.id)) fail('Parent graph contains a cycle.');
      trail.add(cursor.id);
      if (cursor.id === allowExternalRoot) {
        if (cursor.parentId && byId.has(cursor.parentId)) fail('Scope root cannot be parented to a captured descendant.');
        break;
      }
      if (cursor.parentId !== null && !byId.has(cursor.parentId)) fail('Parent reference is missing.');
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    for (const id of trail) done.add(id);
  }
}

function validateSnapshot(snapshot:Snapshot):void {
  uniqueIds(snapshot.nodes,'source node');
  if (!snapshot.nodes.some(node => node.id === snapshot.source.rootId)) fail('Snapshot root is absent from its node index.');
  for (const node of snapshot.nodes) {
    if (node.sourceFileKey !== snapshot.source.fileKey || node.sourcePageId !== snapshot.source.pageId) fail('Source node provenance differs from its snapshot.');
    if (node.id !== snapshot.source.rootId && node.parentId === null) fail('Captured nodes must belong to the selected root.');
  }
  validateParents(snapshot.nodes,snapshot.source.rootId);
  if (snapshot.completeness.complete && snapshot.completeness.reason !== null) fail('Complete captures cannot carry a truncation reason.');
  if (!snapshot.completeness.complete && !snapshot.completeness.reason) fail('Partial captures must explain the missing remainder.');
  if (snapshot.preview) {
    // No SVG/HTML data URLs: the only supported preview is an actual PNG payload.
    if (!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(snapshot.preview.base64) || snapshot.preview.base64.length % 4 !== 0) fail('Preview must be base64-encoded PNG data.');
  }
}

export interface SourceAccess {
  hasNode(scopeId:string,nodeId:string):boolean;
  getNode(scopeId:string,nodeId:string):SourceNode|undefined;
}
function validateReferences(project:Project,refs:readonly SourceReference[],access?:SourceAccess):void {
  const keys=new Set<string>();
  for(const ref of refs){
    const key=JSON.stringify([ref.snapshotId,ref.nodeId]);
    if(keys.has(key))fail('Duplicate source reference.');keys.add(key);
    const scope=sourceScope(project,ref.snapshotId);
    if(!scope)fail('Source scope does not exist.');
    if(inlineScope(scope)){
      if(!scope.nodes.some(node=>node.id===ref.nodeId))fail('Source reference does not resolve in the captured scope.');
    }else{
      if(scope.kind==='visual')fail('Visual drafts have no acquired source records.');
      if(access&&!access.hasNode(scope.id,ref.nodeId))fail('Source reference does not resolve in the bound collection.');
    }
  }
}
function referenceNodes(project:Project,refs:readonly SourceReference[],access?:SourceAccess):SourceNode[]{
  validateReferences(project,refs,access);
  return refs.map(ref=>{
    const scope=sourceScope(project,ref.snapshotId)!;
    const node=inlineScope(scope)?scope.nodes.find(node=>node.id===ref.nodeId):access?.getNode(scope.id,ref.nodeId);
    if(!node)throw new DomainError('SOURCE_RESOLUTION_REQUIRED','Resolve the exact bound source records before using this evidence.');
    if(node.id!==ref.nodeId||node.sourceFileKey!==scope.source.fileKey||node.sourcePageId!==scope.source.pageId)
      fail('Resolved source identity or provenance differs from its bound scope.');
    return node;
  });
}
/** Preserves source text verbatim; only the separator between selected nodes is added. */
export function sourceTextForReferences(project:Project,refs:readonly SourceReference[],access?:SourceAccess):string {
  const nodes=referenceNodes(project,refs,access);
  if(!nodes.length||nodes.some(node=>node.type!=='TEXT'||node.text===undefined))fail('Specifications require captured TEXT node references.');
  return nodes.map(node=>node.text!).join('\n\n');
}

function validateContents(project:Project,access?:SourceAccess):void {
  uniqueIds(sourceScopes(project),'source scope'); uniqueIds(project.annotations,'annotation');
  uniqueIds(project.specifications,'specification'); uniqueIds(project.proposals,'proposal');
  for (const snapshot of project.snapshots) validateSnapshot(snapshot);
  const annotations = new Map(project.annotations.map(a => [a.id,a]));
  const snapshots = new Map(sourceScopes(project).map(snapshot => [snapshot.id,snapshot]));
  validateParents(project.annotations);
  for (const annotation of project.annotations) {
    const snapshot = snapshots.get(annotation.snapshotId);
    if (!snapshot) fail('Annotation snapshot does not exist.');
    if(!inlineScope(snapshot)&&annotation.reviewStatus==='approved'&&(!completeScope(snapshot)||!annotation.sourceRefs.length||annotation.sourceReview?.status!=='confirmed'))fail('Collection-backed approval requires complete source and explicit human confirmation.');
    if(annotation.reviewStatus==='approved')requireRegionCoverage(snapshot,annotation.bbox);
    if (!contains(snapshot.bounds,annotation.bbox,0.01)) fail('Annotation lies outside its captured image bounds.');
    if (annotation.parentId !== null && annotations.get(annotation.parentId)?.snapshotId !== annotation.snapshotId) fail('Annotation parents must belong to the same captured scope.');
    if (annotation.sourceRefs.some(ref => ref.snapshotId !== annotation.snapshotId)) fail('Annotation source references must belong to its captured scope.');
    validateReferences(project,annotation.sourceRefs,access);
    if(annotation.sourceReview) {
      for(const candidate of annotation.sourceReview.candidates)validateReferences(project,[{snapshotId:annotation.snapshotId,nodeId:candidate.nodeId,matchType:'partial'}],access);
      if(annotation.sourceReview.status==='confirmed'&&!annotation.sourceRefs.length) fail('Confirmed source reviews require selected source references.');
      if(annotation.reviewStatus==='approved'&&(annotation.sourceReview.ambiguous||annotation.sourceReview.renderingReviewRequired)&&annotation.sourceReview.status!=='confirmed') fail('Approved source references with geometric or rendering uncertainty require human confirmation.');
    }
  }
  for (const specification of project.specifications) {
    validateReferences(project,specification.sourceRefs,access);
    const external=specification.sourceRefs.some(ref=>!inlineScope(snapshots.get(ref.snapshotId)!));
    if ((!external||access)&&sourceTextForReferences(project,specification.sourceRefs,access)!==specification.text)fail('Specification text must exactly preserve its ordered source text.');
    const relations = new Set<string>();
    for (const relation of specification.relations) {
      const target = annotations.get(relation.targetAnnotationId);
      if (!target) fail('Specification target annotation does not exist.');
      const key = JSON.stringify([relation.targetAnnotationId,relation.relationType]);
      if (relations.has(key)) fail('Duplicate specification relation.');
      relations.add(key);
      if (specification.reviewStatus === 'approved' && (relation.reviewStatus !== 'approved' || target.reviewStatus !== 'approved')) fail('Approved specifications require approved links and targets.');
    }
    if (specification.reviewStatus === 'approved' && !specification.relations.length) fail('Approved specifications require at least one reviewed component relation.');
  }
  for (const proposal of project.proposals) {
    if (proposal.draft.annotations.some(a => a.origin !== 'ai' || a.reviewStatus !== 'proposed' || a.sourceReview !== undefined) ||
        proposal.draft.specifications.some(s => s.origin !== 'ai' || s.reviewStatus !== 'proposed' || s.relations.some(r => r.reviewStatus !== 'proposed'))) fail('AI proposals cannot carry approvals.');
  }
}

/** Runtime schema plus cross-record invariants; returns a detached validated value. */
export function validateProject(value:unknown,access?:SourceAccess):Project {
  const parsed = ProjectSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('INVALID_PROJECT','Project does not satisfy the versioned data contract.');
  validateContents(parsed.data,access);
  return parsed.data;
}

export function createProject(id:string, name:string, now=new Date().toISOString()):Project {
  return validateProject({schemaVersion:'1.0.0',id,name,revision:0,updatedAt:now,snapshots:[],annotations:[],specifications:[],proposals:[]});
}

export interface OperationContext {
  actor:'human'|'ai'; now?:string; id?:()=>string; sources?:SourceAccess;
  evidenceWrite?:boolean;
  match?:(scopeId:string,region:Rect,tolerance?:number)=>MatchResult;
}
function scopeFor(project:Project,id:string):SourceScope {
  const scope=sourceScope(project,id);if(!scope)throw new DomainError('NOT_FOUND','Source scope was not found.');return scope;
}
function requireScopeAccess(scope:SourceScope,access?:SourceAccess):void {
  if(!inlineScope(scope)&&completeScope(scope)&&!access)
    throw new DomainError('SOURCE_RESOLUTION_REQUIRED','Resolve the bound collection before changing, confirming, approving or exporting its evidence.');
}
function matchScope(scope:SourceScope,region:Rect,context:OperationContext,tolerance=0.5):MatchResult {
  if(inlineScope(scope))return matchRegion(scope,region,{tolerance});
  if(scope.kind==='visual')return {sourceRefs:[],candidates:[],ambiguous:true,warnings:['Visual draft: source structure has not been acquired.']};
  requireScopeAccess(scope,context.sources);
  if(!context.match)throw new DomainError('SOURCE_RESOLUTION_REQUIRED','A complete collection scan is required for source matching.');
  return context.match(scope.id,region,tolerance);
}
function reviewScope(scope:SourceScope,input:Annotation,prior:Annotation|undefined,result:MatchResult|undefined,context:OperationContext) {
  if(inlineScope(scope))return annotationSourceReview(scope,input,prior,result);
  const sameGeometry=prior?.snapshotId===input.snapshotId&&JSON.stringify(prior.bbox)===JSON.stringify(input.bbox);
  const sameRefs=sameGeometry&&JSON.stringify(prior?.sourceRefs)===JSON.stringify(input.sourceRefs);
  const review=!result&&sameGeometry&&prior?.sourceReview?structuredClone(prior.sourceReview):sourceReviewFromMatch(result??matchScope(scope,input.bbox,context));
  if(!sameRefs||result||scope.kind==='visual'){review.status='unconfirmed';review.confirmedAt=null;}
  review.renderingReviewRequired=true;
  const notice='Image and source structure are separate live observations. Inspect and explicitly confirm every source set before approval.';
  if(!review.warnings.includes(notice))review.warnings.push(notice);
  return review;
}
function invalidateRelations(project:Project, ids:ReadonlySet<string>):void {
  for (const specification of project.specifications) {
    if (!specification.relations.some(r => ids.has(r.targetAnnotationId))) continue;
    specification.reviewStatus = 'proposed'; specification.revision += 1;
    specification.relations = specification.relations.map(relation => ids.has(relation.targetAnnotationId) ? {...relation,reviewStatus:'proposed'} : relation);
  }
}
function putAnnotation(project:Project, input:Annotation, origin:'human'|'ai', context:OperationContext, match?:MatchResult):void {
  const index = project.annotations.findIndex(a => a.id === input.id);
  const prior = index === -1 ? undefined : project.annotations[index];
  if (origin === 'ai' && prior?.reviewStatus === 'approved') throw new DomainError('APPROVED_PROTECTED','AI cannot replace an approved annotation.');
  const snapshot=scopeFor(project,input.snapshotId);
  requireScopeAccess(snapshot,context.sources);
  const sourceReview=reviewScope(snapshot,input,origin==='human'?prior:undefined,match,context);
  const record:Annotation = {...structuredClone(input),origin,reviewStatus:'proposed',revision:prior ? prior.revision + 1 : 0,sourceReview};
  if (index === -1) project.annotations.push(record); else project.annotations[index] = record;
  invalidateRelations(project,new Set([input.id]));
}
function putSpecification(project:Project, input:Specification, origin:'human'|'ai',context:OperationContext):void {
  const index = project.specifications.findIndex(s => s.id === input.id);
  const prior = index === -1 ? undefined : project.specifications[index];
  if (origin === 'ai' && prior?.reviewStatus === 'approved') throw new DomainError('APPROVED_PROTECTED','AI cannot replace an approved specification.');
  if(sourceTextForReferences(project,input.sourceRefs,context.sources)!==input.text)fail('Specification text must exactly preserve its ordered source text.');
  const record:Specification = {...structuredClone(input),origin,reviewStatus:'proposed',revision:prior ? prior.revision + 1 : 0,
    relations:input.relations.map(r => ({...r,reviewStatus:'proposed'}))};
  if (index === -1) project.specifications.push(record); else project.specifications[index] = record;
}
function normalizeDraft(draft:Draft):Draft {
  return {
    annotations:draft.annotations.map(({sourceReview:_,...a}) => ({...a,origin:'ai',reviewStatus:'proposed'})),
    specifications:draft.specifications.map(s => ({...s,origin:'ai',reviewStatus:'proposed',relations:s.relations.map(r => ({...r,reviewStatus:'proposed'}))})),
  };
}
function applyDraft(project:Project,draft:Draft,context:OperationContext):void {
  uniqueIds(draft.annotations,'draft annotation'); uniqueIds(draft.specifications,'draft specification');
  for (const annotation of draft.annotations) putAnnotation(project,annotation,'ai',context);
  for (const specification of draft.specifications) putSpecification(project,specification,'ai',context);
}
function uniqueRelations(relations:Specification['relations']):Specification['relations'] {
  const seen = new Set<string>();
  return relations.filter(r => { const key=JSON.stringify([r.targetAnnotationId,r.relationType]); if (seen.has(key)) return false; seen.add(key); return true; });
}
function replaceTargets(project:Project, oldIds:ReadonlySet<string>, replacements:readonly string[]):void {
  for (const specification of project.specifications) {
    if (!specification.relations.some(r => oldIds.has(r.targetAnnotationId))) continue;
    specification.relations = uniqueRelations(specification.relations.flatMap(r => oldIds.has(r.targetAnnotationId) ? replacements.map(targetAnnotationId => ({...r,targetAnnotationId,reviewStatus:'proposed' as const})) : [r]));
    specification.reviewStatus = 'proposed'; specification.revision += 1;
  }
}

/** Pure copy-on-write transaction. Failed operations leave the original untouched. */
export function applyOperation(value:Project, input:Operation, context:OperationContext):Project {
  const project = validateProject(value,context.sources);
  const parsed = OperationSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_OPERATION','Operation does not satisfy its runtime contract.');
  const operation = parsed.data;
  if (context.actor !== 'human' && context.actor !== 'ai') throw new DomainError('FORBIDDEN','Unknown operation actor.');
  if (context.actor === 'ai' && operation.type !== 'submit_proposal') throw new DomainError('FORBIDDEN','Agents can submit proposals only. Human review is required.');
  const now = context.now ?? new Date().toISOString();
  const newId = context.id ?? (() => globalThis.crypto.randomUUID());
  switch (operation.type) {
    case 'add_snapshot': {
      if (project.snapshots.some(s => s.id === operation.snapshot.id)) throw new DomainError('ALREADY_EXISTS','Snapshot IDs are immutable; capture a new scope revision instead.');
      project.snapshots.push(operation.snapshot); break;
    }
    case 'add_evidence_scope': {
      if(!context.evidenceWrite)throw new DomainError('FORBIDDEN','Evidence scopes must be created through validated source routes.');
      if(sourceScope(project,operation.scope.id))throw new DomainError('ALREADY_EXISTS','Source scope IDs are immutable.');
      project.scopes=[...project.scopes??[],operation.scope];break;
    }
    case 'attach_scope_collection': {
      if(!context.evidenceWrite)throw new DomainError('FORBIDDEN','Source backing must be attached through a validated source route.');
      const scope=lookup(project.scopes??[],operation.scopeId,'Evidence scope');
      if(scope.kind!=='visual'||scope.collection)throw new DomainError('IMMUTABLE_SOURCE','Create a new scope for a different source observation.');
      scope.kind='collection';scope.collection=operation.collection;
      for(const annotation of project.annotations.filter(item=>item.snapshotId===scope.id)){
        annotation.sourceReview=undefined;annotation.reviewStatus='proposed';annotation.revision++;
      }
      invalidateRelations(project,new Set(project.annotations.filter(item=>item.snapshotId===scope.id).map(item=>item.id)));
      break;
    }
    case 'copy_scope_regions': {
      if(!context.evidenceWrite)throw new DomainError('FORBIDDEN','Copy regions through a verified source route.');
      const source=scopeFor(project,operation.sourceScopeId),target=scopeFor(project,operation.targetScopeId);
      if(inlineScope(target)||target.kind!=='branch'||source.source.fileKey!==target.source.fileKey||source.source.pageId!==target.source.pageId||
        target.branch?.enclosingRootId!==source.source.rootId)throw new DomainError('SOURCE_BINDING_CHANGED','The branch does not belong to this design source.');
      const originals=operation.annotationIds.map(id=>lookup(project.annotations,id,'Annotation'));
      if(new Set(operation.annotationIds).size!==originals.length||originals.some(a=>a.snapshotId!==source.id||a.reviewStatus!=='proposed'))
        throw new DomainError('APPROVED_PROTECTED','Only proposed regions from this source can be copied for branch review.');
      const copies=new Map(originals.map(a=>[a.id,newId()]));
      for(const original of originals)putAnnotation(project,{...original,id:copies.get(original.id)!,snapshotId:target.id,
        parentId:original.parentId?copies.get(original.parentId)??null:null,sourceRefs:[],sourceReview:undefined,reviewStatus:'proposed',revision:0},'human',context);
      break;
    }
    case 'rename_project': project.name = operation.name; break;
    case 'upsert_annotation': putAnnotation(project,operation.annotation,'human',context); break;
    case 'delete_annotation': {
      lookup(project.annotations,operation.id,'Annotation');
      if (project.annotations.some(a => a.parentId === operation.id)) throw new DomainError('HAS_CHILDREN','Reparent or remove child annotations before deleting their parent.');
      project.annotations = project.annotations.filter(a => a.id !== operation.id);
      replaceTargets(project,new Set([operation.id]),[]); break;
    }
    case 'review_annotation': {
      const annotation = lookup(project.annotations,operation.id,'Annotation');
      if(operation.status==='approved'&&annotation.reviewStatus!=='approved') {
        const snapshot=scopeFor(project,annotation.snapshotId);
        requireCompleteSource(snapshot);
        requireRegionCoverage(snapshot,annotation.bbox);
        requireScopeAccess(snapshot,context.sources);
        annotation.sourceReview=reviewScope(snapshot,annotation,annotation,undefined,context);
        if(!inlineScope(snapshot)&&!annotation.sourceRefs.length)throw new DomainError('SOURCE_REFERENCES_REQUIRED','Choose captured source references before approval.');
        if((annotation.sourceReview.ambiguous||annotation.sourceReview.renderingReviewRequired)&&annotation.sourceReview.status!=='confirmed') throw new DomainError('SOURCE_CONFIRMATION_REQUIRED','Inspect the source evidence and explicitly confirm the chosen source set before approving this annotation.');
      }
      annotation.reviewStatus = operation.status; annotation.revision += 1;
      if (operation.status !== 'approved') invalidateRelations(project,new Set([annotation.id]));
      break;
    }
    case 'match_annotation': {
      const annotation = lookup(project.annotations,operation.id,'Annotation');
      const snapshot = scopeFor(project,annotation.snapshotId);
      requireCompleteSource(snapshot);
      const result = matchScope(snapshot,annotation.bbox,context,operation.tolerance);
      putAnnotation(project,{...annotation,sourceRefs:result.sourceRefs},'human',context,result); break;
    }
    case 'confirm_annotation_sources': {
      const annotation=lookup(project.annotations,operation.id,'Annotation');
      if(annotation.revision!==operation.expectedAnnotationRevision) throw new DomainError('STALE_SOURCE_REVIEW','The annotation changed after this source review. Inspect its current source references before confirming.');
      if(!annotation.sourceRefs.length) throw new DomainError('SOURCE_REFERENCES_REQUIRED','Choose at least one captured source reference before confirming.');
      const snapshot=scopeFor(project,annotation.snapshotId);
      requireCompleteSource(snapshot);
      requireRegionCoverage(snapshot,annotation.bbox);
      requireScopeAccess(snapshot,context.sources);
      const review=annotation.sourceReview??reviewScope(snapshot,annotation,undefined,undefined,context);
      annotation.sourceReview={...review,status:'confirmed',confirmedAt:now};
      annotation.revision+=1;break;
    }
    case 'split_annotation': {
      const original = lookup(project.annotations,operation.id,'Annotation');
      if (project.annotations.some(a => a.parentId === original.id)) throw new DomainError('HAS_CHILDREN','Reparent child annotations before splitting their parent.');
      const boxes:[Rect,Rect] = [{...original.bbox},{...original.bbox}];
      if (operation.axis === 'vertical') { boxes[0].width *= operation.ratio; boxes[1].x += boxes[0].width; boxes[1].width -= boxes[0].width; }
      else { boxes[0].height *= operation.ratio; boxes[1].y += boxes[0].height; boxes[1].height -= boxes[0].height; }
      const snapshot = scopeFor(project,original.snapshotId);
      const secondId = newId();
      const labels = operation.axis === 'vertical' ? ['Left','Right'] : ['Top','Bottom'];
      for (let index=0;index<2;index++) {
        const box = boxes[index]!;
        const result=matchScope(snapshot,box,context);
        putAnnotation(project,{...original,id:index===0?original.id:secondId,name:`${original.name.slice(0,285)} · ${labels[index]}`,bbox:box,sourceRefs:result.sourceRefs},'human',context,result);
      }
      replaceTargets(project,new Set([original.id]),[original.id,secondId]); break;
    }
    case 'merge_annotations': {
      if (new Set(operation.ids).size !== operation.ids.length) throw new DomainError('INVALID_OPERATION','Merge requires distinct annotation IDs.');
      const selected = operation.ids.map(id => lookup(project.annotations,id,'Annotation'));
      const first = selected[0]!;
      if (selected.some(a => a.snapshotId !== first.snapshotId || a.parentId !== first.parentId)) throw new DomainError('INVALID_OPERATION','Only sibling annotations in one captured scope can be merged.');
      const x=Math.min(...selected.map(a=>a.bbox.x)), y=Math.min(...selected.map(a=>a.bbox.y));
      const bbox={x,y,width:Math.max(...selected.map(a=>a.bbox.x+a.bbox.width))-x,height:Math.max(...selected.map(a=>a.bbox.y+a.bbox.height))-y};
      const id=newId(), oldIds=new Set(operation.ids);
      project.annotations = project.annotations.filter(a => !oldIds.has(a.id));
      for (const annotation of project.annotations) if (annotation.parentId && oldIds.has(annotation.parentId)) { annotation.parentId=id; annotation.reviewStatus='proposed'; annotation.revision+=1; invalidateRelations(project,new Set([annotation.id])); }
      const result=matchScope(scopeFor(project,first.snapshotId),bbox,context);
      putAnnotation(project,{...first,id,name:operation.name,bbox,sourceRefs:result.sourceRefs},'human',context,result);
      replaceTargets(project,oldIds,[id]); break;
    }
    case 'upsert_specification': putSpecification(project,operation.specification,'human',context); break;
    case 'delete_specification': lookup(project.specifications,operation.id,'Specification'); project.specifications=project.specifications.filter(s=>s.id!==operation.id); break;
    case 'review_specification': {
      const specification=lookup(project.specifications,operation.id,'Specification');
      if(operation.status==='approved'&&specification.reviewStatus!=='approved') {
        const sourceScopes=new Set(specification.sourceRefs.map(ref=>ref.snapshotId));
        for(const relation of specification.relations)sourceScopes.add(lookup(project.annotations,relation.targetAnnotationId,'Annotation').snapshotId);
        for(const snapshotId of sourceScopes){const scope=scopeFor(project,snapshotId);requireCompleteSource(scope);requireScopeAccess(scope,context.sources);}
      }
      if (operation.status==='approved' && (!specification.relations.length || specification.relations.some(r=>lookup(project.annotations,r.targetAnnotationId,'Annotation').reviewStatus!=='approved'))) throw new DomainError('APPROVAL_REQUIRED','Approve all target components before approving this specification and its links.');
      specification.reviewStatus=operation.status; specification.revision+=1;
      specification.relations=specification.relations.map(r=>({...r,reviewStatus:operation.status})); break;
    }
    case 'submit_proposal': {
      if (!operation.draft.annotations.length && !operation.draft.specifications.length) throw new DomainError('INVALID_OPERATION','An empty draft cannot be submitted.');
      const draft=normalizeDraft(operation.draft);
      const candidate=structuredClone(project); applyDraft(candidate,draft,context); validateProject(candidate,context.sources);
      project.proposals.push({id:newId(),createdAt:now,baseRevision:project.revision,status:'pending',draft,warnings:operation.warnings}); break;
    }
    case 'resolve_proposal': {
      const proposal=lookup(project.proposals,operation.id,'Proposal');
      if (proposal.status!=='pending') throw new DomainError('INVALID_OPERATION','This proposal has already been reviewed.');
      if (operation.decision==='accept') {
        if (project.revision!==proposal.baseRevision+1) throw new DomainError('STALE_PROPOSAL','The project changed after this proposal. Generate or submit a fresh proposal.');
        applyDraft(project,proposal.draft,context); proposal.status='accepted';
      } else proposal.status='rejected';
      break;
    }
  }
  project.revision+=1; project.updatedAt=now;
  return validateProject(project,context.sources);
}

function reviewedRecords(project:Project) {
  const unresolved:string[]=[];
  const byId=new Map(project.annotations.map(a=>[a.id,a]));
  const eligible=new Set<string>();
  for (const annotation of project.annotations) {
    if (annotation.reviewStatus!=='approved') continue;
    let parent=annotation.parentId; let valid=true;
    while (parent) { const ancestor=byId.get(parent)!; if(ancestor.reviewStatus!=='approved'){valid=false;break;} parent=ancestor.parentId; }
    if(valid)eligible.add(annotation.id);else unresolved.push(`Approved annotation ${annotation.id} withheld because an ancestor is unapproved.`);
  }
  const ordered:Annotation[]=[];
  const children=new Map<string|null,Annotation[]>();
  for(const annotation of project.annotations)if(eligible.has(annotation.id)){const list=children.get(annotation.parentId)??[];list.push(annotation);children.set(annotation.parentId,list);}
  for(const list of children.values())list.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const stack=[...(children.get(null)??[])].reverse();
  while(stack.length){const annotation=stack.pop()!;ordered.push(annotation);stack.push(...[...(children.get(annotation.id)??[])].reverse());}
  const annotations=ordered.map(a=>({...a,childIds:(children.get(a.id)??[]).map(c=>c.id)}));
  const specifications:Specification[]=[];
  for(const specification of [...project.specifications].sort((a,b)=>a.id.localeCompare(b.id,'en'))) {
    if(specification.reviewStatus!=='approved')continue;
    const relations=specification.relations.filter(r=>r.reviewStatus==='approved'&&eligible.has(r.targetAnnotationId));
    if(!relations.length){unresolved.push(`Specification ${specification.id} withheld because no approved target is exported.`);continue;}
    if(relations.length<specification.relations.length)unresolved.push(`Some specification ${specification.id} relations are withheld because their targets are not exported.`);
    specifications.push({...specification,relations});
  }
  return {annotations,specifications,unresolved};
}

/** Complete approved records for server-side pagination; callers bound response bytes after slicing. */
export function approvedRecords(value:Project) {
  const {annotations,specifications}=reviewedRecords(validateProject(value));
  return {annotations,specifications};
}

export interface ApprovedExportOptions { maxAnnotations?:number; maxSpecifications?:number; maxSourceNodes?:number; maxTextChars?:number }
/** Exports only human-reviewed material; images and draft content are excluded. */
export function approvedContext(value:Project,options:ApprovedExportOptions={},access?:SourceAccess) {
  const project=validateProject(value,access);
  const limits={maxAnnotations:options.maxAnnotations??2000,maxSpecifications:options.maxSpecifications??2000,maxSourceNodes:options.maxSourceNodes??5000,maxTextChars:options.maxTextChars??1_000_000};
  for (const count of Object.values(limits)) if (!Number.isSafeInteger(count)||count<1||count>1_000_000) throw new DomainError('INVALID_OPERATION','Invalid export limit.');
  const reviewed=reviewedRecords(project), unresolved=[...reviewed.unresolved];let truncated=false;
  const selected=reviewed.annotations.slice(0,limits.maxAnnotations), selectedIds=new Set(selected.map(a=>a.id));
  if(selected.length<reviewed.annotations.length){unresolved.push('Annotation export limit reached.');truncated=true;}
  const annotations=selected.map(a=>({...a,childIds:a.childIds.filter(id=>selectedIds.has(id))}));
  for(const annotation of annotations)if(!annotation.sourceRefs.length)unresolved.push(`Annotation ${annotation.id} has no grounded source node.`);
  const specifications:Specification[]=[];let textChars=0;
  for(const specification of reviewed.specifications) {
    const relations=specification.relations.filter(r=>selectedIds.has(r.targetAnnotationId));
    if(!relations.length){unresolved.push(`Specification ${specification.id} withheld because no approved target is exported.`);continue;}
    if(relations.length<specification.relations.length)unresolved.push(`Some specification ${specification.id} relations are withheld because their targets are not exported.`);
    if(specifications.length>=limits.maxSpecifications||textChars+specification.text.length>limits.maxTextChars){unresolved.push('Specification export limit reached.');truncated=true;break;}
    specifications.push({...specification,relations});textChars+=specification.text.length;
  }
  const refs=[...annotations.flatMap(a=>a.sourceRefs),...specifications.flatMap(s=>s.sourceRefs)];
  // Source-detail pagination must not bypass validation of the approved records
  // whose references remain in the response.
  for(const scopeId of new Set(refs.map(ref=>ref.snapshotId)))requireScopeAccess(scopeFor(project,scopeId),access);
  const sourceNodes:Array<SourceNode&{snapshotId:string}>=[],seen=new Set<string>();
  for(const ref of refs){
    const key=JSON.stringify([ref.snapshotId,ref.nodeId]);if(seen.has(key))continue;seen.add(key);
    if(sourceNodes.length>=limits.maxSourceNodes){unresolved.push('Source-detail export limit reached; references are preserved.');truncated=true;break;}
    const node=referenceNodes(project,[ref],access)[0]!;
    if(node.text && textChars+node.text.length>limits.maxTextChars){
      const {text:_,...withoutText}=node;sourceNodes.push({...withoutText,snapshotId:ref.snapshotId});unresolved.push(`Source node ${node.id} text omitted by export limit.`);truncated=true;
    }else{sourceNodes.push({...node,snapshotId:ref.snapshotId});textChars+=node.text?.length??0;}
  }
  const usedSnapshots=new Set(refs.map(r=>r.snapshotId));for(const a of annotations)usedSnapshots.add(a.snapshotId);
  const sources=sourceScopes(project).filter(s=>usedSnapshots.has(s.id)).map(s=>({snapshotId:s.id,name:s.name,source:s.source,bounds:s.bounds,completeness:inlineScope(s)?s.completeness:{complete:completeScope(s),reason:completeScope(s)?null:'Visual draft'},warnings:s.warnings,
    ...(inlineScope(s)?s.acquisition?{acquisition:s.acquisition}:{}:{kind:s.kind,collection:s.collection,visualObservation:s.visualObservation,
      ...(s.branch?{branch:s.branch,coverageBounds:s.coverageBounds,visualBounds:s.visualBounds}: {}),
      ...(s.transferOrigin?{transferOrigin:s.transferOrigin}:{})})}));
  for(const source of sources)if(!source.completeness.complete)unresolved.push(`Source scope ${source.snapshotId} is partial.`);
  return {schemaVersion:'1.0.0' as const,projectId:project.id,name:project.name,revision:project.revision,updatedAt:project.updatedAt,annotations,specifications,sourceNodes,sources,unresolved,truncated};
}
