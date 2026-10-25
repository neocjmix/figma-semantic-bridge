import { PluginProgressSchema, PluginRequestSchema } from '../../src/shared/contracts.js';
import { executePluginCommand, PluginCommandError, type CaptureHost, type FigmaReadableNode } from '../../src/figma/capture.js';
import { StructureReader } from '../../src/figma/structure-reader.js';
import { SelectiveReader } from '../../src/figma/selective-reader.js';
import { isPluginLocale } from './locale.js';

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
figma.showUI(__html__,{width:380,height:430,themeColors:true});
const active=new Map<string,{cancelled:boolean}>();
let busy=false;
let sourceEpoch=0;
const structureReader=new StructureReader(host,{getChangeEpoch:()=>sourceEpoch});
const selectiveReader=new SelectiveReader(host,{getChangeEpoch:()=>sourceEpoch});
let cursorIdleTimer:ReturnType<typeof setTimeout>|null=null;
const clearCursorIdle=()=>{if(cursorIdleTimer!==null){clearTimeout(cursorIdleTimer);cursorIdleTimer=null;}};
const refreshCursorIdle=()=>{
  clearCursorIdle();
  if(structureReader.hasCursor())cursorIdleTimer=setTimeout(()=>{cursorIdleTimer=null;structureReader.clear();},10*60*1000);
};
let observedPage=figma.currentPage;
const onNodeChange=()=>{sourceEpoch++;clearCursorIdle();structureReader.invalidateSource();selectiveReader.invalidateSource();};
observedPage.on('nodechange',onNodeChange);
figma.on('currentpagechange',()=>{
  observedPage.off('nodechange',onNodeChange);
  observedPage=figma.currentPage;
  observedPage.on('nodechange',onNodeChange);
  sourceEpoch++;clearCursorIdle();structureReader.invalidateSource();selectiveReader.invalidateSource();
});
let bridgeGeneration:number|null=null;
let localeWrite=Promise.resolve();
figma.ui.onmessage=async (message:unknown)=>{
  if(!message||typeof message!=='object'||!('type' in message))return;
  if(message.type==='locale-read') {
    try {
      const saved:unknown=await figma.clientStorage.getAsync('fsb-locale');
      figma.ui.postMessage({type:'locale',locale:isPluginLocale(saved)?saved:null});
    } catch {figma.ui.postMessage({type:'locale-read-failed'});}
    return;
  }
  if(message.type==='locale-set') {
    if(!('locale' in message)||!isPluginLocale(message.locale)||!('requestId' in message)||typeof message.requestId!=='number'||!Number.isSafeInteger(message.requestId)||message.requestId<1)return;
    const locale=message.locale,requestId=message.requestId;
    // Serialize preference writes so a slower earlier choice cannot replace the
    // latest choice. This stores no token and never writes to a Figma document.
    localeWrite=localeWrite.then(async()=>{
      try {await figma.clientStorage.setAsync('fsb-locale',locale);figma.ui.postMessage({type:'locale-saved',requestId,ok:true});}
      catch {figma.ui.postMessage({type:'locale-saved',requestId,ok:false});}
    });
    await localeWrite;return;
  }
  if(message.type==='cancel'&&'requestId' in message&&typeof message.requestId==='string') {
    const request=active.get(message.requestId);if(request)request.cancelled=true;return;
  }
  if(message.type==='shutdown'){figma.closePlugin();return;}
  if(message.type!=='execute'||!('request' in message)||!('generation' in message)||typeof message.generation!=='number')return;
  const parsed=PluginRequestSchema.safeParse(message.request);if(!parsed.success)return;
  const {requestId,command}=parsed.data,generation=message.generation;
  if(!Number.isSafeInteger(generation)||generation<0)return;
  if(bridgeGeneration!==null&&generation<bridgeGeneration)return;
  if(bridgeGeneration!==generation){
    for(const request of active.values())request.cancelled=true;
    clearCursorIdle();
    structureReader.clear();
    selectiveReader.clear();
    bridgeGeneration=generation;
  }
  if(busy){figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:false,error:{code:'PLUGIN_BUSY',message:'Another source operation is still running.'}}});return;}
  busy=true;const state={cancelled:false};active.set(requestId,state);
  try {
    const options={cancelled:()=>state.cancelled,yieldControl:()=>new Promise<void>(resolve=>setTimeout(resolve,0)),
      onProgress:progress=>{
        if(state.cancelled)return;
        const event=PluginProgressSchema.parse({type:'progress',requestId,...progress});
        figma.ui.postMessage({type:'progress',generation,progress:event});
      }} satisfies Parameters<typeof executePluginCommand>[2];
    let result:unknown;
    if(command.type==='read_source_nodes')result=await selectiveReader.readNodes(command,options);
    else if(command.type==='read_source_children'){
      if(structureReader.hasCursor())throw new PluginCommandError('PLUGIN_BUSY','Release the active structure cursor before opening an immediate-child inventory.');
      result=await selectiveReader.readChildren(command,options);
    }
    else if(command.type==='release_source_children')result=selectiveReader.release(command.observationId);
    else if(command.type==='read_structure_chunk'){
      if(selectiveReader.hasCursor())throw new PluginCommandError('PLUGIN_BUSY','Release the active immediate-child cursor before reading structure.');
      clearCursorIdle();
      try {result=await structureReader.readChunk(command,options);}
      finally {refreshCursorIdle();}
    } else if(command.type==='release_structure_cursor'){
      clearCursorIdle();result=structureReader.release(command.collectionId);refreshCursorIdle();
    } else result=await executePluginCommand(host,command,options);
    if(!state.cancelled)figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:true,result}});
  } catch(error) {
    if(!state.cancelled)figma.ui.postMessage({type:'complete',generation,response:{type:'response',requestId,ok:false,error:{
      code:error instanceof PluginCommandError?error.code:'PLUGIN_ERROR',
      message:error instanceof PluginCommandError?error.message:'Figma could not complete this bounded source request.',
    }}});
  } finally {active.delete(requestId);busy=false;}
};
figma.on('close',()=>{for(const request of active.values())request.cancelled=true;clearCursorIdle();structureReader.clear();selectiveReader.clear();observedPage.off('nodechange',onNodeChange);});

// The only source interactions are reads, exportAsync and explicit user-requested
// page/selection/viewport navigation. This adapter never edits document content.
export type {FigmaReadableNode};
