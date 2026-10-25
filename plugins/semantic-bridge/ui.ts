import { BridgeClient, type SocketLike } from '../../src/figma/bridge-client.js';
import { PluginProgressSchema, PluginResponseSchema } from '../../src/shared/contracts.js';
import { initialPluginLocale, isPluginLocale, pluginText } from './locale.js';

const token=document.querySelector<HTMLInputElement>('#token')!;
const connect=document.querySelector<HTMLButtonElement>('#connect')!;
const disconnect=document.querySelector<HTMLButtonElement>('#disconnect')!;
const status=document.querySelector<HTMLElement>('#status')!;
const indicator=document.querySelector<HTMLElement>('#indicator')!;
const language=document.querySelector<HTMLSelectElement>('#locale')!;
const localeLabel=document.querySelector<HTMLElement>('#locale-label')!;
const localeNotice=document.querySelector<HTMLElement>('#locale-notice')!;
const introduction=document.querySelector<HTMLElement>('#introduction')!;
const tokenLabel=document.querySelector<HTMLElement>('#token-label')!;
let locale=initialPluginLocale(typeof navigator==='undefined'?undefined:navigator.languages?.[0]??navigator.language);
let localeEdited=false, localeRequest=0;
let statusDetail='Disconnected. Your Figma document remains unchanged.', localeDetail='';
const intro='Open the Figma Semantic Bridge app on this computer. Copy its pairing token from the Bridge menu, connect here, then capture your selected frame in the app.';
function renderLocale() {
  if(document.documentElement)document.documentElement.lang=locale;
  language.value=locale;
  introduction.textContent=pluginText(locale,intro);
  tokenLabel.textContent=pluginText(locale,'Pairing token');
  token.placeholder=pluginText(locale,'Bridge → Copy Pairing Token');
  connect.textContent=pluginText(locale,'Connect');disconnect.textContent=pluginText(locale,'Disconnect');
  localeLabel.textContent=pluginText(locale,'Language');
  status.textContent=pluginText(locale,statusDetail);localeNotice.textContent=pluginText(locale,localeDetail);
}
renderLocale();
language.onchange=()=>{
  if(!isPluginLocale(language.value)){language.value=locale;return;}
  locale=language.value;localeEdited=true;localeDetail='';renderLocale();
  parent.postMessage({pluginMessage:{type:'locale-set',locale,requestId:++localeRequest}},'*');
};
// Request after load so the host handler and iframe listener are both installed.
window.addEventListener('load',()=>parent.postMessage({pluginMessage:{type:'locale-read'}},'*'));
const clientId=`figma-${Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
const client=new BridgeClient({clientId,
  socketFactory:url=>new WebSocket(url) as unknown as SocketLike,
  onRequest:(request,generation)=>parent.postMessage({pluginMessage:{type:'execute',request,generation}},'*'),
  onCancel:(requestId,generation)=>parent.postMessage({pluginMessage:{type:'cancel',requestId,generation}},'*'),
  onState:(state,detail)=>{
    statusDetail=detail;status.textContent=pluginText(locale,detail);indicator.dataset.state=state;
    connect.disabled=state!=='disconnected';disconnect.disabled=state==='disconnected';
  },
});
connect.onclick=()=>{
  try{client.start(token.value.trim());token.value='';}
  catch(error){statusDetail=error instanceof Error?error.message:'Connection failed.';status.textContent=pluginText(locale,statusDetail);}
};
token.addEventListener('keydown',event=>{if(event.key==='Enter'&&!connect.disabled)connect.click();});
disconnect.onclick=()=>client.stop();
window.addEventListener('message',event=>{
  const fromFigmaHost=(event.origin==='https://www.figma.com'||event.origin==='https://figma.com')&&event.source===top;
  if(event.source!==parent&&!fromFigmaHost)return;
  const message=event.data?.pluginMessage;
  if(message?.type==='locale') {
    if(!localeEdited&&isPluginLocale(message.locale)){locale=message.locale;renderLocale();}
    return;
  }
  if(message?.type==='locale-read-failed'&&!localeEdited){localeDetail='Saved language could not be loaded. Choose a language here.';renderLocale();return;}
  if(message?.type==='locale-saved'&&message.requestId===localeRequest&&typeof message.ok==='boolean') {
    localeDetail=message.ok?'':'Language could not be saved. This choice applies until the plugin closes.';renderLocale();return;
  }
  if(message?.type==='progress'&&typeof message.generation==='number') {
    const progress=PluginProgressSchema.safeParse(message.progress);
    if(progress.success)client.progress(progress.data,message.generation);
    return;
  }
  if(message?.type!=='complete'||typeof message.generation!=='number')return;
  const response=PluginResponseSchema.safeParse(message.response);
  if(response.success)client.complete(response.data,message.generation);
});
window.addEventListener('pagehide',()=>client.stop());
