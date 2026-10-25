import { authenticateFakePlugin } from './bridge-auth-helper.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { PluginBroker } from '../src/server/broker.js';

class Socket extends EventEmitter {
  readyState=1;
  sent:string[]=[];
  closed=false;
  send(value:string,callback?:()=>void) {this.sent.push(value);callback?.();}
  close() {this.closed=true;this.readyState=3;this.emit('close');}
  terminate() {this.close();}
  receive(value:unknown) {this.emit('message',Buffer.from(JSON.stringify(value)),false);}
}

test('legacy preview_node progress is forwarded without closing its Figma session',async()=>{
  const token='synthetic-progress-token-32-characters';
  const broker=new PluginBroker(token);
  const socket=new Socket();
  try {
    broker.attach(socket as unknown as WebSocket,{address:'127.0.0.1',port:4177});
    authenticateFakePlugin(socket,token);
    assert.equal(broker.status.connected,true);
    const progress:unknown[]=[];
    const result=broker.request({type:'preview_node',fileKey:'synthetic-file',pageId:'page',nodeId:'root'},
      {timeoutMs:1000,onProgress:event=>progress.push(event)});
    const request=JSON.parse(socket.sent.at(-1)!) as {requestId:string};
    const event={type:'progress',requestId:request.requestId,phase:'preview',nodes:0,bytes:0};
    socket.receive(event);
    assert.deepEqual(progress,[event]);
    assert.equal(socket.closed,false);
    assert.equal(broker.status.connected,true);
    socket.receive({type:'response',requestId:request.requestId,ok:false,error:{code:'SYNTHETIC_DONE',message:'Synthetic request finished.'}});
    await assert.rejects(result,{code:'PLUGIN_ERROR'});
    assert.equal(broker.status.connected,true);
  } finally {broker.close();}
});
