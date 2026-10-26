import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { AcquisitionViewSchema, type AcquisitionView } from '../src/shared/acquisition.js';
import { NodePreviewResultSchema, type Project, type NodePreviewResult } from '../src/shared/contracts.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { useImportSettings } from './ImportSettings.js';
import { errorMessage, type UIMessage } from './locale.js';
import { PartialSourceBrowser } from './PartialSourceBrowser.js';

const ContinuePlanSchema = z.object({ kind:z.enum(['resume','revalidate']),requiresConfirmation:z.boolean(),
  savedNodes:z.number().int().min(0),reason:z.string() });
type ContinueDecision = { taskId:string;sessionId:string;revision:number;plan:z.infer<typeof ContinuePlanSchema> };
const PartPlanSchema = z.object({kind:z.literal('part'),nodeId:z.string(),requiresConfirmation:z.boolean(),
  releasesPausedTaskId:z.string().nullable(),savedNodes:z.number().int().min(0),reason:z.string()});
type PartDecision = {taskId:string;sessionId:string;revision:number;plan:z.infer<typeof PartPlanSchema>};

/** One normal import route: pinned overview, durable structure packets, automatic source binding. */
export function SourceImportPanel({token,project,sessionId,connected,busy,dirty,beginProjectMutation,onBound,onBranchReady}:{
  token:string;project:Project|null;sessionId:string|null;connected:boolean;busy:boolean;dirty:boolean;
  beginProjectMutation(): (()=>void)|null;
  onBound(project:Project,scopeId:string,keepSelection:boolean):void;
  onBranchReady?:(collectionId:string,nodeId:string)=>void;
}) {
  const {t,systemText,errorText,renderMessage,formatNumber}=useLocale();
  const settings=useImportSettings(token);
  const [task,setTask]=useState<CollectionView|null>(null),[history,setHistory]=useState<CollectionView[]>([]);
  const [legacyHistory,setLegacyHistory]=useState<AcquisitionView[]>([]);
  const [overview,setOverview]=useState<AcquisitionView|null>(null),[image,setImage]=useState<NodePreviewResult|null>(null);
  const [acting,setActing]=useState(false),[error,setError]=useState<UIMessage|null>(null);
  const [continueDecision,setContinueDecision]=useState<ContinueDecision|null>(null);
  const [partDecision,setPartDecision]=useState<PartDecision|null>(null);
  const partAttempt=useRef('');
  const active=useRef(false),generation=useRef(0),attempt=useRef(''),choice=useRef(0);
  const controllers=useRef(new Set<AbortController>());
  const projectId=project?.id??null,base=projectId?`/api/projects/${encodeURIComponent(projectId)}/collections`:'';
  const path=task?`${base}/${encodeURIComponent(task.id)}`:'';
  const context=useRef({token,projectId});context.current={token,projectId};
  const linked=task?project?.scopes?.find(scope=>scope.collection?.id===task.id):undefined;
  const visual=task?.overviewAcquisitionId?project?.scopes?.find(scope=>scope.visualObservation?.taskId===task.overviewAcquisitionId):undefined;
  const validOverview=overview?.id===task?.overviewAcquisitionId?overview:null;
  const visibleImage=validOverview&&image?.observedAt===validOverview.preview.observedAt?image:null;
  const partTask=task?history.filter(item=>item.partOf?.collectionId===task.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]:undefined;
  const partBound=partTask?project?.scopes?.some(scope=>scope.branch?.collectionId===partTask.id):false;
  const partPending=partTask&&partTask.status!=='complete';

  useEffect(()=>{
    const current=++generation.current,selected=++choice.current;
    for(const controller of controllers.current)controller.abort();controllers.current.clear();active.current=false;
    setTask(null);setHistory([]);setLegacyHistory([]);setOverview(null);setImage(null);setActing(false);setError(null);setContinueDecision(null);setPartDecision(null);attempt.current='';partAttempt.current='';
    if(token&&projectId){
      const controller=new AbortController();controllers.current.add(controller);
      void Promise.all([request<{collections:unknown[]}>(token,base,undefined,controller.signal),
        request<{tasks:unknown[]}>(token,`/api/projects/${encodeURIComponent(projectId)}/acquisitions`,undefined,controller.signal)]).then(([result,older])=>{
        if(current!==generation.current)return;
        const items=result.collections.map(value=>CollectionViewSchema.parse(value)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        setHistory(previous=>[...previous,...items.filter(item=>!previous.some(value=>value.id===item.id))]);
        setLegacyHistory(older.tasks.map(value=>AcquisitionViewSchema.parse(value)));
        const superseded=new Set(items.map(item=>item.recovery?.previousCollectionId).filter(id=>id!==undefined));
        if(choice.current===selected)setTask(items.find(item=>!item.partOf&&!superseded.has(item.id)&&!project?.scopes?.some(scope=>scope.collection?.id===item.id))??items.find(item=>!item.partOf)??null);
      }).catch(cause=>{if(current===generation.current&&!controller.signal.aborted)setError(errorMessage(cause));})
        .finally(()=>controllers.current.delete(controller));
    }
    return()=>{generation.current++;for(const controller of controllers.current)controller.abort();controllers.current.clear();};
  },[token,projectId,sessionId]);

  useEffect(()=>{
    if(!task||!projectId)return;
    const current=generation.current,id=task.id;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    const poll=async()=>{
      controller=new AbortController();controllers.current.add(controller);
      try {
        const next=CollectionViewSchema.parse(await request(token,`${base}/${encodeURIComponent(id)}`,undefined,controller.signal));
        if(next.overviewAcquisitionId){
          const picture=AcquisitionViewSchema.parse(await request(token,`/api/projects/${encodeURIComponent(projectId)}/acquisitions/${encodeURIComponent(next.overviewAcquisitionId)}`,undefined,controller.signal));
          if(alive&&current===generation.current)setOverview(picture);
        }
        if(alive&&current===generation.current){setTask(previous=>previous?.id===id?next:previous);
          setHistory(items=>[next,...items.filter(item=>item.id!==id)]);}
      }catch(cause){if(alive&&current===generation.current&&!controller.signal.aborted)setError(errorMessage(cause));}
      finally{controllers.current.delete(controller);if(alive&&current===generation.current&&task.status==='running')timer=setTimeout(()=>void poll(),700);}
    };
    void poll();return()=>{alive=false;if(timer)clearTimeout(timer);controller?.abort();};
  },[task?.id,task?.status,token,projectId]);

  useEffect(()=>{
    if(!partTask||!projectId)return;
    const current=generation.current,id=partTask.id;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    const poll=async()=>{
      controller=new AbortController();controllers.current.add(controller);
      try{const next=CollectionViewSchema.parse(await request(token,`${base}/${encodeURIComponent(id)}`,undefined,controller.signal));
        if(alive&&current===generation.current)setHistory(items=>[next,...items.filter(item=>item.id!==id)]);
      }catch(cause){if(alive&&current===generation.current&&!controller.signal.aborted)setError(errorMessage(cause));}
      finally{controllers.current.delete(controller);if(alive&&current===generation.current&&partTask.status==='running')timer=setTimeout(()=>void poll(),700);}
    };
    void poll();return()=>{alive=false;if(timer)clearTimeout(timer);controller?.abort();};
  },[partTask?.id,partTask?.status,token,projectId]);

  useEffect(()=>{setOverview(null);setImage(null);setContinueDecision(null);setPartDecision(null);attempt.current='';partAttempt.current='';},[task?.id]);
  useEffect(()=>{setContinueDecision(null);setPartDecision(null);},[sessionId,project?.revision]);
  useEffect(()=>{
    if(!projectId||!overview||overview.preview.status!=='ready')return;
    const current=generation.current,controller=new AbortController();controllers.current.add(controller);
    void request(token,`/api/projects/${encodeURIComponent(projectId)}/acquisitions/${encodeURIComponent(overview.id)}/preview`,undefined,controller.signal)
      .then(value=>{if(current===generation.current&&!controller.signal.aborted)setImage(NodePreviewResultSchema.parse(value));})
      .catch(cause=>{if(current===generation.current&&!controller.signal.aborted)setError(errorMessage(cause));})
      .finally(()=>controllers.current.delete(controller));
    return()=>controller.abort();
  },[overview?.id,overview?.preview.status,overview?.preview.observedAt,projectId,token]);

  async function perform<T>(call:(signal:AbortSignal)=>Promise<T>,apply:(result:T)=>void,write=false){
    if(active.current)return;
    const release=write?beginProjectMutation():null;if(write&&!release)return;
    active.current=true;setActing(true);setError(null);
    const current=generation.current,expected={...context.current},controller=new AbortController();controllers.current.add(controller);
    try {const result=await call(controller.signal);
      if(current===generation.current&&context.current.token===expected.token&&context.current.projectId===expected.projectId)apply(result);
    }catch(cause){if(current===generation.current&&!controller.signal.aborted)setError(errorMessage(cause));}
    finally{controllers.current.delete(controller);if(current===generation.current){active.current=false;setActing(false);}release?.();}
  }
  function prepare(){
    if(!project||!sessionId||!connected||busy||dirty||active.current||task?.status==='running'||partTask?.status==='running')return;
    choice.current++;
    void perform(signal=>request(token,base,{expectedRevision:project.revision,expectedSessionId:sessionId,withOverview:true},signal)
      .then(value=>CollectionViewSchema.parse(value)),value=>{setTask(value);setHistory(items=>[value,...items]);});
  }
  function removeRecord(kind:'collections'|'acquisitions',id:string){
    if(!projectId||busy)return;
    void perform(async signal=>{
      await request(token,`/api/projects/${encodeURIComponent(projectId)}/${kind}/${encodeURIComponent(id)}/remove`,{},signal);
      return id;
    },removed=>{
      if(kind==='collections'){setHistory(items=>items.filter(item=>item.id!==removed));if(task?.id===removed){choice.current++;setTask(null);}}
      else setLegacyHistory(items=>items.filter(item=>item.id!==removed));
    });
  }
  function operate(action:'start'|'stop',target=task){
    if(!target||active.current)return;
    if(action!=='stop'&&(!connected||target.sessionId!==sessionId||busy||dirty))return;
    void perform(signal=>request(token,`${base}/${encodeURIComponent(target.id)}/${action}`,{},signal).then(value=>CollectionViewSchema.parse(value)),next=>{
      if(next.id===task?.id)setTask(next);
      setHistory(items=>[next,...items.filter(item=>item.id!==next.id)]);
    });
  }
  function continueImport(confirmed=false){
    const target=partPending?partTask:task;
    if(!target||!project||!sessionId||!connected||busy||dirty||active.current)return;
    setPartDecision(null);
    const targetPath=`${base}/${encodeURIComponent(target.id)}`;
    const expected={taskId:target.id,sessionId,revision:project.revision};
    const approved=confirmed&&continueDecision?.taskId===target.id&&continueDecision.sessionId===sessionId
      &&continueDecision.revision===project.revision?continueDecision.plan:null;
    void perform(async signal=>{
      const plan=ContinuePlanSchema.parse(await request(token,`${targetPath}/continue-plan`,{},signal));
      if(plan.requiresConfirmation&&(!approved||approved.kind!==plan.kind||approved.savedNodes!==plan.savedNodes||approved.reason!==plan.reason))
        return {decision:{...expected,plan}};
      const next=CollectionViewSchema.parse(await request(token,`${targetPath}/continue`,{
        expectedSessionId:sessionId,expectedRevision:project.revision,confirmRevalidation:plan.requiresConfirmation,
      },signal));
      return {task:next};
    },result=>{
      if('decision' in result&&result.decision)setContinueDecision(result.decision);
      else if(result.task){setContinueDecision(null);if(!result.task.partOf)setTask(result.task);setHistory(items=>[result.task!,...items.filter(item=>item.id!==result.task!.id)]);}
    });
  }
  function preparePart(nodeId:string,confirmed=false){
    if(!task||!project||!sessionId||!connected||busy||dirty||active.current||task.status==='running'||partTask?.status==='running')return;
    setContinueDecision(null);
    const expected={taskId:task.id,sessionId,revision:project.revision};
    const approved=confirmed&&partDecision?.taskId===task.id&&partDecision.sessionId===sessionId&&partDecision.revision===project.revision?partDecision.plan:null;
    void perform(async signal=>{
      const plan=PartPlanSchema.parse(await request(token,`${path}/part-plan`,{nodeId},signal));
      if(plan.requiresConfirmation&&(!approved||approved.nodeId!==plan.nodeId||approved.releasesPausedTaskId!==plan.releasesPausedTaskId||approved.savedNodes!==plan.savedNodes))
        return {decision:{...expected,plan}};
      const child=CollectionViewSchema.parse(await request(token,`${path}/part`,{nodeId,expectedRevision:project.revision,
        expectedSessionId:sessionId,confirmRevalidation:plan.requiresConfirmation},signal));
      const parent=CollectionViewSchema.parse(await request(token,path,undefined,signal));
      return {child,parent};
    },result=>{
      if('decision' in result&&result.decision)setPartDecision(result.decision);
      else if(result.child){setPartDecision(null);setTask(result.parent);setHistory(items=>[result.child!,result.parent!,...items.filter(item=>item.id!==result.child!.id&&item.id!==result.parent!.id)]);}
    });
  }
  function bind(){
    if(!task||task.partOf||!project||linked||busy||dirty||active.current)return;
    const complete=task.status==='complete',hasImage=validOverview?.preview.status==='ready';
    if(!complete&&!hasImage||!complete&&visual||task.overviewAcquisitionId&&!validOverview)return;
    const attach=complete&&visual?.kind==='visual';
    const url=attach?`/api/projects/${encodeURIComponent(project.id)}/evidence-scopes/${encodeURIComponent(visual.id)}/attach`
      :`/api/projects/${encodeURIComponent(project.id)}/evidence-scopes`;
    const body=attach?{expectedRevision:project.revision,collectionId:task.id}:{expectedRevision:project.revision,
      ...(complete?{collectionId:task.id}:{}),...(hasImage?{acquisitionId:task.overviewAcquisitionId}:{})};
    void perform(signal=>request<Project>(token,url,body,signal),next=>{
      const scope=next.scopes?.find(value=>complete?value.collection?.id===task.id:value.visualObservation?.taskId===task.overviewAcquisitionId);
      if(scope)onBound(next,scope.id,!!attach);
    },true);
  }
  useEffect(()=>{
    if(!task||task.partOf||!project||linked||busy||dirty||acting)return;
    if(task.overviewAcquisitionId&&!validOverview)return;
    if(task.status!=='complete'&&(validOverview?.preview.status!=='ready'||visual))return;
    const key=`${task.id}:${task.status==='complete'}:${project.revision}`;
    if(attempt.current===key)return;attempt.current=key;bind();
  },[task?.id,task?.status,validOverview?.preview.status,project?.revision,linked?.id,visual?.id,busy,dirty,acting]);
  useEffect(()=>{
    if(!partTask||partTask.status!=='complete'||partBound||!onBranchReady||busy||dirty||acting)return;
    const key=`${partTask.id}:${project?.revision}`;
    if(partAttempt.current===key)return;partAttempt.current=key;
    onBranchReady(partTask.id,partTask.source.nodeId);
  },[partTask?.id,partTask?.status,partBound,project?.revision,busy,dirty,acting,onBranchReady]);

  const running=task?.status==='running',sameSession=task?.sessionId===sessionId;
  const continuingTask=partPending?partTask:task;
  const budgetPaused=continuingTask?.status==='paused'&&(continuingTask.pauseReason==='nodes'||continuingTask.pauseReason==='bytes');
  const needsContinue=continuingTask&&continuingTask.status!=='complete'&&continuingTask.status!=='running'&&(continuingTask.status!=='prepared'||continuingTask.sessionId!==sessionId);
  const visibleDecision=continueDecision&&continueDecision.taskId===continuingTask?.id&&continueDecision.sessionId===sessionId
    &&continueDecision.revision===project?.revision?continueDecision:null;
  const visiblePartDecision=partDecision&&partDecision.taskId===task?.id&&partDecision.sessionId===sessionId&&partDecision.revision===project?.revision?partDecision:null;
  return <section className="acquisition-panel" aria-label={t('Source import')}>
    <button className="primary wide" disabled={!project||!connected||!sessionId||busy||dirty||acting||running||partTask?.status==='running'}
      onClick={prepare}>{t('Add source')}</button>
    <p className="small muted">{t('Received sources are saved automatically. Review their meaning before approval.')}</p>
    {history.some(item=>!item.partOf)&&<label>{t('Recent imports')}<select value={task?.id??''} disabled={acting||running||partTask?.status==='running'} onChange={event=>{choice.current++;setTask(history.find(item=>!item.partOf&&item.id===event.target.value)??null);setError(null);}}>
      {history.filter(item=>!item.partOf).map(item=><option key={item.id} value={item.id}>{item.source.name}</option>)}
    </select></label>}
    {dirty&&<p className="small acquisition-warning">{t('Save your unsaved work before starting or saving a capture.')}</p>}
    {error&&<p className="error small" role="alert">{renderMessage(error)}</p>}
    {task&&<div className="acquisition-detail">
      <strong>{task.source.name}</strong>
      <p className="small muted">{t('Document bounds: x {x}, y {y}, width {width}, height {height}',task.source.bounds)}</p>
      <p className="small muted">{t('Import allows {nodes} nodes and {megabytes} MB, pausing after {seconds} seconds. Change these in Settings.',{
        nodes:formatNumber(settings.maxNodes),megabytes:settings.maxBytes/1_000_000,seconds:settings.runDurationMs/1000})}</p>
      <p className="small muted">{t('The overview uses scale {scale}, up to {pixels} px on its long edge.',{scale:settings.overview.scale,pixels:formatNumber(settings.overview.maxDimension)})}</p>
      {visibleImage&&<figure className="acquisition-preview"><img alt={t('Figma overview image')} src={`data:image/png;base64,${visibleImage.preview.base64}`}/>
        <figcaption>{visibleImage.preview.width} × {visibleImage.preview.height} px</figcaption></figure>}
      {running&&<><progress aria-label={t('Collection progress')}/>
        {validOverview?.preview.status==='running'&&<p className="small muted">{t('Preparing the image. Figma rendering may take time and cannot stop immediately.')}</p>}
        <button className="wide" disabled={acting||task.pauseRequested} onClick={()=>operate('stop')}>{t('Pause collection')}</button></>}
      <p className="small muted" aria-live="polite">{t('{status} · {nodes} nodes · {chunks} saved parts · {bytes} bytes · {seconds} s elapsed',{
        status:t(task.status==='complete'?'Collection complete':task.status==='paused'?'Paused':task.status==='running'?'Working':task.status==='prepared'?'Prepared':'Interrupted'),
        nodes:formatNumber(task.nodeCount),chunks:formatNumber(task.chunkCount),bytes:formatNumber(task.byteCount),seconds:(task.elapsedMs/1000).toFixed(1)})}</p>
      {task.recovery&&<p className="small muted">{t('Checked {nodes} source nodes again; reused {parts} unchanged saved parts without transferring them again.',{
        nodes:formatNumber(task.recovery.revalidatedNodes),parts:formatNumber(task.recovery.reusedPackets)})}</p>}
      {budgetPaused&&<p className="small acquisition-warning">{t('Reading pauses at your configured limit. Increase it in Settings, then continue with the same Figma connection.')}</p>}
      {task.nodeCount>0&&task.status!=='complete'&&<p className="small acquisition-warning">{t('You can work with the saved material. Some source content is still missing.')}</p>}
      {!sameSession&&task.status!=='complete'&&<p className="small acquisition-warning">{t('The connection changed. Continue to check the source and read what is needed.')}</p>}
      {task.error&&<p className="small acquisition-warning">{errorText(task.error)}</p>}
      {task.warnings.map((warning,index)=><p key={index} className="small muted">{systemText(warning)}</p>)}
      {partTask&&<section className="source-part-progress" aria-label={t('Selected part')}>
        <strong>{t('Selected part: {name}',{name:partTask.source.name})}</strong>
        <p className="small muted">{t('Only this part is being prepared. The full import keeps its own progress.')}</p>
        <p className="small muted" aria-live="polite">{t('{status} · {nodes} nodes · {chunks} saved parts · {bytes} bytes · {seconds} s elapsed',{
          status:t(partTask.status==='complete'?'Collection complete':partTask.status==='paused'?'Paused':partTask.status==='running'?'Working':partTask.status==='prepared'?'Prepared':'Interrupted'),
          nodes:formatNumber(partTask.nodeCount),chunks:formatNumber(partTask.chunkCount),bytes:formatNumber(partTask.byteCount),seconds:(partTask.elapsedMs/1000).toFixed(1)})}</p>
        {partTask.status==='running'&&<><progress aria-label={t('Selected part progress')}/>
          <button className="wide" disabled={acting||partTask.pauseRequested} onClick={()=>operate('stop',partTask)}>{t('Pause collection')}</button></>}
        {partTask.recovery&&<p className="small muted">{t('Checked {nodes} source nodes again; reused {parts} unchanged saved parts without transferring them again.',{
          nodes:formatNumber(partTask.recovery.revalidatedNodes),parts:formatNumber(partTask.recovery.reusedPackets)})}</p>}
        {partTask.error&&<p className="small acquisition-warning">{errorText(partTask.error)}</p>}
        {partTask.status==='complete'&&<p className="small muted">{t('This part is ready for source review. The full import remains separate, and your original regions are kept.')}</p>}
        {partTask.nodeCount>0&&partTask.status!=='complete'&&projectId&&<PartialSourceBrowser key={partTask.id} token={token} projectId={projectId}
          collectionId={partTask.id} savedParts={partTask.chunkCount} busy={busy||dirty||acting}
          {...(onBranchReady?{onBranchReady:(nodeId:string)=>onBranchReady(partTask.id,nodeId)}:{})}/>}
      </section>}
      {task.status==='prepared'&&sameSession&&<button className="primary wide" disabled={!connected||busy||dirty||acting} onClick={()=>operate('start')}>{t('Start import')}</button>}
      {needsContinue&&!visibleDecision&&!visiblePartDecision&&<button className="primary wide" disabled={!connected||!sessionId||busy||dirty||acting} onClick={()=>continueImport()}>{t('Continue')}</button>}
      {visibleDecision&&<div className="acquisition-warning" role="region" aria-label={t('Check before continuing')}>
        <strong>{t('The source needs to be checked again')}</strong>
        <p className="small">{t('Your saved image and edits will be kept. Figma may need to read the whole selected source again to verify changes.')}</p>
        <p className="small">{t('{count} saved nodes remain available. The amount and duration of the new read are not yet known.',{count:formatNumber(visibleDecision.plan.savedNodes)})}</p>
        <p className="small">{systemText(visibleDecision.plan.reason)}</p>
        <button className="primary wide" disabled={!connected||busy||dirty||acting} onClick={()=>continueImport(true)}>{t('Continue and check the source')}</button>
        <button className="text-button" disabled={acting} onClick={()=>setContinueDecision(null)}>{t('Keep working with saved material')}</button>
      </div>}
      {visiblePartDecision&&<div className="acquisition-warning" role="region" aria-label={t('Check before preparing this part')}>
        <strong>{t('Preparing this part changes how the full import can continue')}</strong>
        <p className="small">{t('Your saved image, sources and edits will be kept. Figma must release the paused reading position to prepare this part. Continuing the full import later will require checking its source again.')}</p>
        <p className="small">{systemText(visiblePartDecision.plan.reason)}</p>
        <button className="primary wide" disabled={!connected||busy||dirty||acting} onClick={()=>preparePart(visiblePartDecision.plan.nodeId,true)}>{t('Prepare this part')}</button>
        <button className="text-button" disabled={acting} onClick={()=>setPartDecision(null)}>{t('Keep working with saved material')}</button>
      </div>}
      {task.status==='complete'&&!linked&&<button className="wide" disabled={busy||dirty||acting} onClick={()=>{attempt.current='';bind();}}>{t('Continue')}</button>}
      {task.nodeCount>0&&task.status!=='complete'&&projectId&&<PartialSourceBrowser key={task.id} token={token} projectId={projectId}
        collectionId={task.id} savedParts={task.chunkCount} busy={busy||dirty||acting}
        {...(onBranchReady?{onBranchReady:(nodeId:string)=>onBranchReady(task.id,nodeId)}:{})}
        {...(connected&&sessionId&&!running&&partTask?.status!=='running'?{onPreparePart:(nodeId:string)=>preparePart(nodeId)}:{})}/>}
    </div>}
    {(history.length>0||legacyHistory.length>0)&&<details className="source-history"><summary>{t('Saved import records')}</summary>
      <p className="small muted">{t('Delete unused import records to free cache space. Sources used by workspace drafts are protected.')}</p>
      <ul className="collection-nodes">{history.map(item=>{
        const used=project?.scopes?.some(scope=>scope.collection?.id===item.id||scope.branch?.collectionId===item.id||
          !item.partOf&&item.overviewAcquisitionId&&scope.visualObservation?.taskId===item.overviewAcquisitionId)||
          history.some(value=>value.partOf?.collectionId===item.id||value.partOf?.contextCollectionId===item.id||
            value.recovery?.previousCollectionId===item.id&&['prepared','paused','running'].includes(value.status));
        return <li key={item.id}><span>{item.source.name}<small>{formatNumber(item.nodeCount)} {t('nodes')}</small></span>
          <button className="text-button" disabled={busy||acting||!!used||item.status==='running'} onClick={()=>removeRecord('collections',item.id)}>{t('Delete import record')}</button></li>;
      })}{legacyHistory.filter(item=>!history.some(value=>value.overviewAcquisitionId===item.id)).map(item=><li key={item.id}>
        <span>{item.source.name}<small>{formatNumber(item.progress.nodes)} {t('nodes')}</small></span>
        <button className="text-button" disabled={busy||acting||item.status==='running'||item.status==='cancel_requested'||!!project?.scopes?.some(scope=>scope.visualObservation?.taskId===item.id)}
          onClick={()=>removeRecord('acquisitions',item.id)}>{t('Delete import record')}</button></li>)}</ul>
    </details>}
  </section>;
}
