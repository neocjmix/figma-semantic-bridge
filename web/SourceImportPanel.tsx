import { useEffect, useRef, useState } from 'react';
import { CollectionViewSchema, type CollectionView } from '../src/shared/structure-collection.js';
import { AcquisitionViewSchema, type AcquisitionView } from '../src/shared/acquisition.js';
import { NodePreviewResultSchema, type Project, type NodePreviewResult } from '../src/shared/contracts.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { useImportSettings } from './ImportSettings.js';
import { errorMessage, type UIMessage } from './locale.js';

/** One normal import route: pinned overview, durable structure packets, automatic source binding. */
export function SourceImportPanel({token,project,sessionId,connected,busy,dirty,beginProjectMutation,onBound}:{
  token:string;project:Project|null;sessionId:string|null;connected:boolean;busy:boolean;dirty:boolean;
  beginProjectMutation(): (()=>void)|null;
  onBound(project:Project,scopeId:string,keepSelection:boolean):void;
}) {
  const {t,systemText,errorText,renderMessage,formatNumber}=useLocale();
  const settings=useImportSettings(token);
  const [task,setTask]=useState<CollectionView|null>(null),[history,setHistory]=useState<CollectionView[]>([]);
  const [legacyHistory,setLegacyHistory]=useState<AcquisitionView[]>([]);
  const [overview,setOverview]=useState<AcquisitionView|null>(null),[image,setImage]=useState<NodePreviewResult|null>(null);
  const [acting,setActing]=useState(false),[error,setError]=useState<UIMessage|null>(null);
  const active=useRef(false),generation=useRef(0),attempt=useRef(''),choice=useRef(0);
  const controllers=useRef(new Set<AbortController>());
  const projectId=project?.id??null,base=projectId?`/api/projects/${encodeURIComponent(projectId)}/collections`:'';
  const path=task?`${base}/${encodeURIComponent(task.id)}`:'';
  const context=useRef({token,projectId});context.current={token,projectId};
  const linked=task?project?.scopes?.find(scope=>scope.collection?.id===task.id):undefined;
  const visual=task?.overviewAcquisitionId?project?.scopes?.find(scope=>scope.visualObservation?.taskId===task.overviewAcquisitionId):undefined;
  const validOverview=overview?.id===task?.overviewAcquisitionId?overview:null;
  const visibleImage=validOverview&&image?.observedAt===validOverview.preview.observedAt?image:null;

  useEffect(()=>{
    const current=++generation.current,selected=++choice.current;
    for(const controller of controllers.current)controller.abort();controllers.current.clear();active.current=false;
    setTask(null);setHistory([]);setLegacyHistory([]);setOverview(null);setImage(null);setActing(false);setError(null);attempt.current='';
    if(token&&projectId){
      const controller=new AbortController();controllers.current.add(controller);
      void Promise.all([request<{collections:unknown[]}>(token,base,undefined,controller.signal),
        request<{tasks:unknown[]}>(token,`/api/projects/${encodeURIComponent(projectId)}/acquisitions`,undefined,controller.signal)]).then(([result,older])=>{
        if(current!==generation.current)return;
        const items=result.collections.map(value=>CollectionViewSchema.parse(value));
        setHistory(previous=>[...previous,...items.filter(item=>!previous.some(value=>value.id===item.id))]);
        setLegacyHistory(older.tasks.map(value=>AcquisitionViewSchema.parse(value)));
        if(choice.current===selected)setTask(items.find(item=>item.overviewAcquisitionId&&!project?.scopes?.some(scope=>scope.collection?.id===item.id))??items.find(item=>item.overviewAcquisitionId)??null);
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

  useEffect(()=>{setOverview(null);setImage(null);attempt.current='';},[task?.id]);
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
    if(!project||!sessionId||!connected||busy||dirty||active.current||task?.status==='running')return;
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
  function operate(action:'start'|'resume'|'stop'){
    if(!task||active.current)return;
    if(action!=='stop'&&(!connected||task.sessionId!==sessionId||busy||dirty))return;
    void perform(signal=>request(token,`${path}/${action}`,{},signal).then(value=>CollectionViewSchema.parse(value)),setTask);
  }
  function bind(){
    if(!task||!project||linked||busy||dirty||active.current)return;
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
    if(!task?.overviewAcquisitionId||!project||linked||busy||dirty||acting)return;
    if(!validOverview)return;
    if(task.status!=='complete'&&(validOverview?.preview.status!=='ready'||visual))return;
    const key=`${task.id}:${task.status==='complete'}:${project.revision}`;
    if(attempt.current===key)return;attempt.current=key;bind();
  },[task?.id,task?.status,validOverview?.preview.status,project?.revision,linked?.id,visual?.id,busy,dirty,acting]);

  const running=task?.status==='running',sameSession=task?.sessionId===sessionId;
  const budgetPaused=task?.status==='paused'&&(task.pauseReason==='nodes'||task.pauseReason==='bytes');
  return <section className="acquisition-panel" aria-label={t('Source import')}>
    <button className="primary wide" disabled={!project||!connected||!sessionId||busy||dirty||acting||running}
      onClick={prepare}>{t('Add source')}</button>
    <p className="small muted">{t('Received sources are saved automatically. Review their meaning before approval.')}</p>
    {history.some(item=>item.overviewAcquisitionId)&&<label>{t('Recent imports')}<select value={task?.id??''} disabled={acting} onChange={event=>{choice.current++;setTask(history.find(item=>item.id===event.target.value)??null);setError(null);}}>
      {history.filter(item=>item.overviewAcquisitionId).map(item=><option key={item.id} value={item.id}>{item.source.name}</option>)}
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
      {budgetPaused&&<p className="small acquisition-warning">{t('Reading pauses at your configured limit. Increase it in Settings, then continue with the same Figma connection.')}</p>}
      {!sameSession&&task.status!=='complete'&&<p className="small acquisition-warning">{t('The Figma connection or workspace changed. Check the selection again before continuing.')}</p>}
      {task.error&&<p className="small acquisition-warning">{errorText(task.error)}</p>}
      {task.warnings.map((warning,index)=><p key={index} className="small muted">{systemText(warning)}</p>)}
      {task.status==='prepared'&&<button className="primary wide" disabled={!sameSession||!connected||busy||dirty||acting} onClick={()=>operate('start')}>{t('Start import')}</button>}
      {task.status==='paused'&&<button className="primary wide" disabled={!sameSession||!connected||busy||dirty||acting} onClick={()=>operate('resume')}>{t('Continue')}</button>}
      {task.status==='complete'&&!linked&&<button className="wide" disabled={busy||dirty||acting} onClick={()=>{attempt.current='';bind();}}>{t('Continue')}</button>}
      {task.status!=='complete'&&task.status!=='prepared'&&task.status!=='running'&&task.status!=='paused'&&<p className="small acquisition-warning">{t('The Figma connection or workspace changed. Check the selection again before continuing.')}</p>}
    </div>}
    {(history.length>0||legacyHistory.length>0)&&<details className="source-history"><summary>{t('Saved import records')}</summary>
      <p className="small muted">{t('Delete unused import records to free cache space. Sources used by workspace drafts are protected.')}</p>
      <ul className="collection-nodes">{history.map(item=>{
        const used=project?.scopes?.some(scope=>scope.collection?.id===item.id||item.overviewAcquisitionId&&scope.visualObservation?.taskId===item.overviewAcquisitionId);
        return <li key={item.id}><span>{item.source.name}<small>{formatNumber(item.nodeCount)} {t('nodes')}</small></span>
          <button className="text-button" disabled={busy||acting||!!used||item.status==='running'} onClick={()=>removeRecord('collections',item.id)}>{t('Delete import record')}</button></li>;
      })}{legacyHistory.filter(item=>!history.some(value=>value.overviewAcquisitionId===item.id)).map(item=><li key={item.id}>
        <span>{item.source.name}<small>{formatNumber(item.progress.nodes)} {t('nodes')}</small></span>
        <button className="text-button" disabled={busy||acting||item.status==='running'||item.status==='cancel_requested'||!!project?.scopes?.some(scope=>scope.visualObservation?.taskId===item.id)}
          onClick={()=>removeRecord('acquisitions',item.id)}>{t('Delete import record')}</button></li>)}</ul>
    </details>}
  </section>;
}
