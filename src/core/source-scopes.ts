import type { EvidenceScope, Project, Snapshot, SourceNode } from '../shared/contracts.js';

export type SourceScope = Snapshot | EvidenceScope;
export type ResolvedSources = ReadonlyMap<string, ReadonlyMap<string, SourceNode>>;
export const sourceScopes=(project:Project):SourceScope[]=>[...project.snapshots,...project.scopes??[]];
export const sourceScope=(project:Project,id:string)=>sourceScopes(project).find(scope=>scope.id===id);
export const inlineScope=(scope:SourceScope):scope is Snapshot=>'nodes' in scope;
export const completeScope=(scope:SourceScope)=>inlineScope(scope)?scope.completeness.complete:scope.kind==='collection'||scope.kind==='branch';
export const scopeNodeCount=(scope:SourceScope)=>inlineScope(scope)?scope.nodes.length:scope.collection?.nodeCount??scope.branch?.nodeCount??0;
