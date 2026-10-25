import { isDeepStrictEqual } from 'node:util';
import { NodePreviewResultSchema, SourcePreviewResultSchema, type SourcePreviewInputSchema, type SourceNode, type SourcePreviewResult } from '../shared/contracts.js';
import type { z } from 'zod';
import type { PluginBroker } from './broker.js';
import type { ProjectStore } from './store.js';
import { ServiceError } from './errors.js';
import { sourceScope, inlineScope } from '../core/source-scopes.js';

function sameCapturedMetadata(captured:SourceNode,live:SourceNode):boolean {
  return captured.id===live.id&&captured.parentId===live.parentId&&captured.name===live.name&&captured.type===live.type&&
    isDeepStrictEqual(captured.bbox,live.bbox)&&captured.text===live.text&&captured.visible===live.visible&&
    captured.sourceFileKey===live.sourceFileKey&&captured.sourcePageId===live.sourcePageId&&
    (captured.rendering?.opacity===undefined||captured.rendering.opacity===live.rendering?.opacity);
}

/** Transient read only. No project history or semantic decision is written. */
export async function sourcePreview(store:ProjectStore,broker:PluginBroker,projectId:string,input:z.infer<typeof SourcePreviewInputSchema>,
  options:{signal:AbortSignal;timeoutMs?:number;isClosed:()=>boolean;
    resolve?:(scopeId:string,nodeId:string)=>Promise<SourceNode|undefined>}):Promise<SourcePreviewResult> {
  const checkActive=()=>{
    if(options.signal.aborted||options.isClosed())throw new ServiceError('CANCELLED','Node preview request cancelled.',499);
    const status=broker.status;
    if(!status.connected)throw new ServiceError('PLUGIN_DISCONNECTED','Connect the Figma plugin to request a current node export.',503);
    if(status.sessionId!==input.expectedSessionId)throw new ServiceError('PLUGIN_SESSION_CHANGED','The Figma connection changed. Inspect the current file and request the export again.',409);
  };
  checkActive();
  const project=await store.get(projectId);checkActive();
  if(project.revision!==input.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed; reload before comparing source images.',409);
  const annotation=project.annotations.find(a=>a.id===input.annotationId);
  if(!annotation)throw new ServiceError('NOT_FOUND','Annotation not found.',404);
  const snapshot=sourceScope(project,annotation.snapshotId)!;
  const captured=inlineScope(snapshot)?snapshot.nodes.find(n=>n.id===input.nodeId):await options.resolve?.(snapshot.id,input.nodeId);
  if(!captured)throw new ServiceError('SOURCE_OUTSIDE_CAPTURE','This source is outside the saved capture. Capture its scope separately before comparing it.',409);
  if(!snapshot.source.fileKey)throw new ServiceError('FILE_IDENTITY_UNAVAILABLE','Captured file identity is unavailable. Capture a new scope before requesting live exports.',409);
  const result=NodePreviewResultSchema.parse(await broker.request({type:'preview_node',fileKey:snapshot.source.fileKey,pageId:snapshot.source.pageId,nodeId:captured.id},
    {signal:options.signal,timeoutMs:options.timeoutMs??20000}));
  checkActive();
  if(result.fileKey!==snapshot.source.fileKey||result.pageId!==snapshot.source.pageId||!sameCapturedMetadata(captured,result.node)) {
    throw new ServiceError('SOURCE_METADATA_CHANGED','Observed source metadata changed since capture. Capture a new scope before comparing it with this saved region.',409);
  }
  const latest=await store.get(projectId);checkActive();
  if(latest.revision!==input.expectedRevision)throw new ServiceError('REVISION_CONFLICT','Project changed during the node export. Reload before comparing source images.',409);
  return SourcePreviewResultSchema.parse({projectId,revision:latest.revision,annotationId:annotation.id,snapshotId:snapshot.id,sessionId:input.expectedSessionId,result});
}
