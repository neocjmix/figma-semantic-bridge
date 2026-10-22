import { BridgeClient, type SocketLike } from '../../src/figma/bridge-client.js';
import { PluginResponseSchema } from '../../src/shared/contracts.js';

const token=document.querySelector<HTMLInputElement>('#token')!;
const connect=document.querySelector<HTMLButtonElement>('#connect')!;
const disconnect=document.querySelector<HTMLButtonElement>('#disconnect')!;
const status=document.querySelector<HTMLElement>('#status')!;
const indicator=document.querySelector<HTMLElement>('#indicator')!;
const clientId=`figma-${crypto.randomUUID()}`;
const client=new BridgeClient({clientId,
  socketFactory:url=>new WebSocket(url) as unknown as SocketLike,
  onRequest:(request,generation)=>parent.postMessage({pluginMessage:{type:'execute',request,generation}},'*'),
  onCancel:(requestId,generation)=>parent.postMessage({pluginMessage:{type:'cancel',requestId,generation}},'*'),
  onState:(state,detail)=>{
    status.textContent=detail;indicator.dataset.state=state;
    connect.disabled=state!=='disconnected';disconnect.disabled=state==='disconnected';
  },
});
connect.onclick=()=>{
  try{client.start(token.value.trim());token.value='';}
  catch(error){status.textContent=error instanceof Error?error.message:'Connection failed.';}
};
token.addEventListener('keydown',event=>{if(event.key==='Enter'&&!connect.disabled)connect.click();});
disconnect.onclick=()=>client.stop();
window.addEventListener('message',event=>{
  if(event.source!==parent)return;
  const message=event.data?.pluginMessage;
  if(message?.type!=='complete'||typeof message.generation!=='number')return;
  const response=PluginResponseSchema.safeParse(message.response);
  if(response.success)client.complete(response.data,message.generation);
});
window.addEventListener('pagehide',()=>client.stop());
