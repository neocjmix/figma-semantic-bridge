import { useEffect, useId, useRef, useState } from 'react';
import { defaultImportSettings, SettingsViewSchema, ImportSettingsSchema, type ImportSettings, type SettingsView } from '../src/shared/import-settings.js';
import { request } from './api.js';
import { useLocale } from './i18n.js';
import { errorMessage, type UIMessage } from './locale.js';

export function useImportSettings(token:string) {
  const [settings,setSettings]=useState<ImportSettings>(defaultImportSettings);
  useEffect(()=>{
    if(!token)return;
    let active=true;let controller:AbortController|undefined;
    const load=()=>{
      controller?.abort();const current=new AbortController();controller=current;
      void request<unknown>(token,'/api/import-settings',undefined,current.signal)
        .then(value=>{if(active&&!current.signal.aborted)setSettings(SettingsViewSchema.parse(value).settings);}).catch(()=>{});
    };
    load();window.addEventListener('fsb-import-settings-changed',load);
    return()=>{active=false;controller?.abort();window.removeEventListener('fsb-import-settings-changed',load);};
  },[token]);return settings;
}

export function ImportSettingsButton({token,disabled}:{token:string;disabled:boolean}) {
  const {t,renderMessage}=useLocale();
  const dialog=useRef<HTMLDialogElement>(null),button=useRef<HTMLButtonElement>(null);
  const pending=useRef<AbortController|null>(null),id=useId();
  const [view,setView]=useState<SettingsView|null>(null),[draft,setDraft]=useState<ImportSettings>(defaultImportSettings);
  const [busy,setBusy]=useState(false),[error,setError]=useState<UIMessage|null>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function open() {
    if(busy)return;setError(null);setView(null);setBusy(true);dialog.current?.showModal();
    const controller=new AbortController();pending.current=controller;
    try {const value=SettingsViewSchema.parse(await request<unknown>(token,'/api/import-settings',undefined,controller.signal));
      if(!controller.signal.aborted){setView(value);setDraft(value.settings);}
    } catch(cause){if(!controller.signal.aborted)setError(errorMessage(cause));}
    finally {if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  async function save() {
    if(!view||busy)return;
    const parsed=ImportSettingsSchema.safeParse(draft);
    if(!parsed.success){setError({key:'Enter values within the displayed ranges.'});return;}
    setBusy(true);setError(null);
    const controller=new AbortController();pending.current=controller;
    try {
      await request(token,'/api/import-settings',{expectedRevision:view.revision,settings:parsed.data},controller.signal);
      if(!controller.signal.aborted){window.dispatchEvent(new Event('fsb-import-settings-changed'));dialog.current?.close();}
    }catch(cause){if(!controller.signal.aborted)setError(errorMessage(cause));}
    finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  const field=(label:Parameters<typeof t>[0],value:number,min:number,max:number,update:(value:number)=>void,step=1)=><label>{t(label)}
    <input type="number" aria-label={t(label)} required value={Number.isFinite(value)?value:''} min={min} max={max} step={step} disabled={!view||busy}
      onChange={event=>update(event.target.valueAsNumber)} /><small>{min.toLocaleString()}–{max.toLocaleString()}</small></label>;
  return <><button ref={button} disabled={disabled||busy} onClick={()=>void open()}>{t('Settings')}</button>
    <dialog ref={dialog} aria-labelledby={id} className="import-settings-dialog" onCancel={()=>{pending.current?.abort();setBusy(false);}}
      onClose={()=>{pending.current?.abort();button.current?.focus();}}>
      <h2 id={id}>{t('Import settings')}</h2>
      <p>{t('Changes apply to the next import or resume. Existing images and saved sources are kept.')}</p>
      <p>{t('Higher limits can use more time, disk space and Figma memory. Packet and integrity protections remain in place.')}</p>
      {error&&<p role="alert" className="error">{renderMessage(error)}</p>}
      <form onSubmit={event=>{event.preventDefault();void save();}}>
        <div className="settings-grid">
          {field('Image scale',draft.overview.scale,0.25,4,scale=>setDraft({...draft,overview:{...draft.overview,scale}}),0.25)}
          {field('Image long edge (px)',draft.overview.maxDimension,256,8192,maxDimension=>setDraft({...draft,overview:{...draft.overview,maxDimension}}))}
          {field('Image budget (MB)',draft.overview.maxBytes/1_000_000,0.1,9,maxBytes=>setDraft({...draft,overview:{...draft.overview,maxBytes:Math.round(maxBytes*1_000_000)}}),0.1)}
          {field('Image wait (seconds)',draft.overview.maxDurationMs/1000,1,300,maxDurationMs=>setDraft({...draft,overview:{...draft.overview,maxDurationMs:maxDurationMs*1000}}))}
          {field('Source node budget',draft.maxNodes,1,1_000_000,maxNodes=>setDraft({...draft,maxNodes}))}
          {field('Source budget (MB)',draft.maxBytes/1_000_000,1,128,maxBytes=>setDraft({...draft,maxBytes:maxBytes*1_000_000}))}
          {field('Reading time before pause (seconds)',draft.runDurationMs/1000,1,1800,runDurationMs=>setDraft({...draft,runDurationMs:runDurationMs*1000}))}
          {field('Response wait (seconds)',draft.requestTimeoutMs/1000,1,120,requestTimeoutMs=>setDraft({...draft,requestTimeoutMs:requestTimeoutMs*1000}))}
          {field('Paused connection retention (minutes)',draft.cursorIdleMs/60000,1,30,cursorIdleMs=>setDraft({...draft,cursorIdleMs:cursorIdleMs*60000}))}
        </div>
        <p className="small muted">{t('A paused read can continue only while its original Figma connection and source remain valid. Increasing limits cannot restore a lost connection.')}</p>
        <div className="actions"><button type="button" disabled={busy} onClick={()=>setDraft(defaultImportSettings())}>{t('Restore defaults')}</button>
          <button type="button" onClick={()=>dialog.current?.close()}>{t('Close')}</button>
          <button type="submit" disabled={!view||busy}>{t('Save settings')}</button></div>
      </form>
    </dialog></>;
}
