import { PluginRequestSchema } from '../../src/shared/contracts.js';
import { executePluginCommand, PluginCommandError, type CaptureHost, type FigmaReadableNode } from '../../src/figma/capture.js';

const host:CaptureHost={
  get fileKey(){return figma.fileKey;},
  get currentPage(){return figma.currentPage;},
  get skipInvisibleInstanceChildren(){return figma.skipInvisibleInstanceChildren;},
  set skipInvisibleInstanceChildren(value){figma.skipInvisibleInstanceChildren=value;},
  getNodeByIdAsync:async id=>figma.getNodeByIdAsync(id),
  setCurrentPageAsync:async page=>figma.setCurrentPageAsync(page as PageNode),
  selectNodes:nodes=>{figma.currentPage.selection=nodes as readonly SceneNode[];},
  scrollAndZoomIntoView:nodes=>figma.viewport.scrollAndZoomIntoView(nodes as readonly SceneNode[]),
};
figma.showUI(__html__,{width:380,height:360,themeColors:true});
const active=new Map<string,{cancelled:boolean}>();
let busy=false;
figma.ui.onmessage=async (message:unknown)=>{
  if(!message||typeof message!=='object'||!('type' in message))return;
  if(message.type==='cancel'&&'requestId' in message&&typeof message.requestId==='string') {
    const request=active.get(message.requestId);if(request)request.cancelled=true;return;
  }
  if(message.type==='shutdown'){figma.closePlugin();return;}
  if(message.type!=='execute'||!('request' in message)||!('generation' in message)||typeof message.generation!=='number')return;
  const parsed=PluginRequestSchema.safeParse(message.request);if(!parsed.success)return;
  const {requestId,command}=parsed.data,generation=message.generation;
  if(busy){figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:false,error:{code:'PLUGIN_BUSY',message:'Another source operation is still running.'}}});return;}
  busy=true;const state={cancelled:false};active.set(requestId,state);
  try {
    const result=await executePluginCommand(host,command,{cancelled:()=>state.cancelled,yieldControl:()=>new Promise(resolve=>setTimeout(resolve,0))});
    if(!state.cancelled)figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:true,result}});
  } catch(error) {
    if(!state.cancelled)figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:false,error:{
      code:error instanceof PluginCommandError?error.code:'PLUGIN_ERROR',
      message:error instanceof PluginCommandError?error.message:'Figma could not complete this bounded source request.',
    }}});
  } finally {active.delete(requestId);busy=false;}
};
figma.on('close',()=>{for(const request of active.values())request.cancelled=true;});

// The only source interactions are reads, exportAsync and explicit user-requested
// page/selection/viewport navigation. This adapter never edits document content.
export type {FigmaReadableNode};
