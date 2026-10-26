import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import WebSocket from 'ws';
import { startServer } from '../src/server/index.js';
import { StructureReader } from '../src/figma/structure-reader.js';
import { executePluginCommand,type CaptureHost,type FigmaReadableNode } from '../src/figma/capture.js';
import type { PluginCommand,Project } from '../src/shared/contracts.js';
import { authenticatePluginSocket } from './bridge-auth-helper.js';

function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function syntheticPng(width:number,height:number):Buffer {
  const part=(kind:string,data:Buffer)=>{const body=Buffer.concat([Buffer.from(kind),data]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([size,body,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height,255);for(let row=0;row<height;row++)pixels[row*(width*4+1)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),part('IHDR',header),part('IDAT',deflateSync(pixels)),part('IEND',Buffer.alloc(0))]);
}

/** Synthetic adapter only; HTTP, encrypted sockets, traversal, PNG checks and disk are real. */
export async function sourceImportFixture(options:{nodeCount?:number;webDir?:string;hold?:boolean;failImage?:boolean}={}) {
  const directory=await mkdtemp(join(tmpdir(),'fsb-unified-import-'));
  let server=await startServer({port:0,dataDir:directory,aiConfig:null,...(options.webDir?{webDir:options.webDir}:{})});
  const token=server.token,project=await server.store.create('Synthetic import workspace');
  const page:FigmaReadableNode & {selection:FigmaReadableNode[]}={id:'page',name:'Synthetic page',type:'PAGE',parent:null,selection:[]};
  let childReads=0,imageFailure=options.failImage??false,holding=options.hold??false;
  const root:FigmaReadableNode={id:'root',name:'Synthetic source',type:'FRAME',parent:page,
    absoluteBoundingBox:{x:-20,y:10,width:128,height:64},absoluteTransform:[[1,0,-20],[0,1,10]],visible:true,opacity:1,
    exportAsync:async settings=>{if(imageFailure)throw new Error('Synthetic image failure');return syntheticPng(Math.round(128*settings.constraint.value),Math.round(64*settings.constraint.value));}};
  const children=Array.from({length:(options.nodeCount??12)-1},(_,index):FigmaReadableNode=>({id:`leaf-${index}`,name:`Synthetic layer ${index}`,type:index===0?'TEXT':'RECTANGLE',
    parent:root,visible:true,opacity:1,absoluteBoundingBox:{x:-10,y:20,width:10,height:10},...(index===0?{characters:' Exact 한글 👩‍💻\r\n source text '}: {})}));
  Object.defineProperty(root,'children',{get(){childReads++;return children;}});page.selection=[root];
  const host:CaptureHost={fileKey:'synthetic-file',currentPage:page,skipInvisibleInstanceChildren:true,
    getNodeByIdAsync:async id=>id==='root'?root:children.find(node=>node.id===id)??null,
    setCurrentPageAsync:async()=>{throw new Error('Unexpected navigation');},selectNodes:()=>{throw new Error('Unexpected selection write');},scrollAndZoomIntoView:()=>{}};
  let reader=new StructureReader(host),socket:WebSocket,sessionId='';
  const commands:PluginCommand[]=[],waiters:(()=>void)[]=[];
  async function connect(){
    socket=new WebSocket(server.url.replace('http:','ws:')+'/bridge',{origin:'null'});await once(socket,'open');
    sessionId=(await authenticatePluginSocket(socket,token,'synthetic-unified-import')).sessionId;
    const current=socket;
    current.on('message',async bytes=>{
      const message=JSON.parse(String(bytes)) as {type:string;requestId:string;command:PluginCommand};if(message.type!=='request')return;
      commands.push(message.command);
      try {
        if(message.command.type==='read_structure_chunk'&&holding)await new Promise<void>(resolve=>waiters.push(resolve));
        const result=message.command.type==='read_structure_chunk'?await reader.readChunk(message.command):
          message.command.type==='release_structure_cursor'?reader.release(message.command.collectionId):await executePluginCommand(host,message.command);
        if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'response',requestId:message.requestId,ok:true,result}));
      }catch(error){if(current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'response',requestId:message.requestId,ok:false,error:{code:'SYNTHETIC_FAILURE',message:error instanceof Error?error.message:'Synthetic failure'}}));}
    });
  }
  await connect();
  return {token,projectId:project.id,directory,commands,get sessionId(){return sessionId;},get url(){return server.url;},get childReads(){return childReads;},
    async api(path:string,body?:unknown){return fetch(server.url+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,
      ...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});},
    readProject:():Promise<Project>=>server.store.get(project.id),
    release(){holding=false;for(const resolve of waiters.splice(0))resolve();},
    failImage(value:boolean){imageFailure=value;},
    async restart(){holding=false;for(const resolve of waiters.splice(0))resolve();socket.terminate();await server.close();reader=new StructureReader(host);
      server=await startServer({port:0,token,dataDir:directory,aiConfig:null,...(options.webDir?{webDir:options.webDir}:{})});await connect();},
    async close(){holding=false;for(const resolve of waiters.splice(0))resolve();socket.terminate();await server.close();await rm(directory,{recursive:true,force:true});},
  };
}
