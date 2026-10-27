import { DiagnosticClientEventSchema, diagnosticAction, diagnosticErrorType, diagnosticFrames, type DiagnosticClientEvent } from '../src/shared/diagnostics.js';

type NativeWindow=Window&{webkit?:{messageHandlers?:{fsbDiagnostics?:{postMessage:(event:DiagnosticClientEvent)=>void}}};__FSB_DIAGNOSTICS__?:boolean};
let count=0,errorCount=0,windowAt=0;
export function reportDiagnostic(event:DiagnosticClientEvent):void{
  const now=Date.now();if(now-windowAt>60_000){windowAt=now;count=0;errorCount=0;}if(event.level==='error'?++errorCount>120:++count>180)return;
  const parsed=DiagnosticClientEventSchema.safeParse(event);if(!parsed.success)return;
  try{
    const bridge=(window as NativeWindow).webkit?.messageHandlers?.fsbDiagnostics;
    if(bridge){bridge.postMessage(parsed.data);return;}
    const token=sessionStorage.getItem('fsb-token');if(!token)return;
    void fetch('/api/diagnostics/events',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(parsed.data),keepalive:true}).catch(()=>{});
  }catch{/* Logging must never interrupt editing. */}
}
export function reportUiEvent(event:'ui.action.start'|'ui.action.complete'|'ui.action.error',details:{action?:string;code?:string;requestId?:string;durationMs?:number}={}):void{
  const {action,...other}=details;reportDiagnostic({event,level:event==='ui.action.error'?'error':'info',action:diagnosticAction(action) as DiagnosticClientEvent['action'],...other});
}
/** Caught validation/render errors also need a trail, without serializing their input. */
export function reportUiFailure(cause:unknown):void{
  const error=cause as {name?:unknown;code?:unknown;requestId?:unknown};
  const code=error?.name==='ApiError'&&typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:undefined;
  const requestId=typeof error?.requestId==='string'&&/^[0-9a-f-]{36}$/i.test(error.requestId)?error.requestId:undefined;
  reportDiagnostic({event:'ui.action.error',level:'error',action:'editor.action',errorType:diagnosticErrorType(cause),frames:diagnosticFrames(cause),...(code?{code}:{}),...(requestId?{requestId}:{})});
}
export function installObservability():void{
  const host=window as NativeWindow;
  // The native bootstrap records errors even before this bundle loads.
  if(host.__FSB_DIAGNOSTICS__)return;host.__FSB_DIAGNOSTICS__=true;
  for(const level of ['warn','error'] as const){const original=console[level].bind(console);console[level]=(...args:unknown[])=>{
    reportDiagnostic({event:'web.console',level,argumentCount:Math.min(1000,args.length),frames:diagnosticFrames(new Error())});original(...args);
  };}
  window.addEventListener('error',event=>reportDiagnostic({event:'web.error',level:'error',errorType:diagnosticErrorType(event.error),frames:diagnosticFrames(event.error),resourceType:event.target instanceof HTMLScriptElement?'script':event.target instanceof HTMLLinkElement?'style':event.target instanceof HTMLImageElement?'image':'unknown'}),true);
  window.addEventListener('unhandledrejection',event=>reportDiagnostic({event:'web.unhandledrejection',level:'error',errorType:diagnosticErrorType(event.reason),frames:diagnosticFrames(event.reason)}));
  reportDiagnostic({event:'web.ready',level:'info'});
}
