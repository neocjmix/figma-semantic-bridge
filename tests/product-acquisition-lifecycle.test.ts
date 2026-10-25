import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../src/core/project.js';
import { AcquisitionManager } from '../src/server/acquisition.js';
import type { PluginBroker } from '../src/server/broker.js';
import type { ProjectStore } from '../src/server/store.js';
import type { PluginCommand, Selection, Snapshot } from '../src/shared/contracts.js';

const projectId='synthetic-project',sessionId='synthetic-session';
const fileKey='synthetic-file',pageId='synthetic-page',nodeId='synthetic-root';
const bounds={x:0,y:0,width:100,height:80};
const selection:Selection={fileKey,pageId,nodes:[{id:nodeId,name:'Synthetic root',type:'FRAME',bbox:bounds}]};

function deferred() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
function snapshot():Snapshot {
  return {schemaVersion:'1.0.0',id:'synthetic-snapshot',name:'Synthetic root',
    source:{fileKey,pageId,rootId:nodeId,revision:null,capturedAt:new Date().toISOString()},bounds,
    nodes:[{id:nodeId,parentId:pageId,name:'Synthetic root',type:'FRAME',bbox:bounds,visible:true,sourceFileKey:fileKey,sourcePageId:pageId}],
    preview:null,completeness:{complete:true,reason:null},warnings:[]};
}
async function environment(t:test.TestContext) {
  const directory=await mkdtemp(join(tmpdir(),'fsb-lifecycle-'));
  const project=createProject(projectId,'Synthetic project');
  const store={get:async(id:string)=>{assert.equal(id,projectId);return project;}};
  const broker={status:{connected:true,sessionId},request:async(command:PluginCommand)=>{
    if(command.type==='get_selection')return selection;
    if(command.type==='capture_metadata')return snapshot();
    assert.fail(`Unexpected command: ${command.type}`);
  }};
  const manager=new AcquisitionManager(directory,store as unknown as ProjectStore,broker as unknown as PluginBroker);
  await manager.initialize();
  t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});
  return {manager,store,broker,directory,project};
}
async function fixture(t:test.TestContext) {
  const {manager,directory}=await environment(t);
  const prepared=await manager.prepare(projectId,0,sessionId);
  const persistedFile=join(directory,'acquisitions',prepared.id+'.json');
  return {manager,prepared,persistedFile};
}

type Journal={view:{id:string;status:string;stage:string}};
function holdPersist(manager:AcquisitionManager,when:(task:Journal)=>boolean) {
  const entered=deferred(),release=deferred();
  const access=manager as unknown as {persist:(task:Journal)=>Promise<void>};
  const original=access.persist.bind(manager);
  let held=false,heldId:string|null=null;
  access.persist=async task=>{
    if(!held&&when(task)){held=true;heldId=task.view.id;entered.resolve();await release.promise;}
    await original(task);
  };
  return {entered,release,get heldId(){return heldId;}};
}
async function waitForReady(manager:AcquisitionManager,id:string) {
  const deadline=Date.now()+2000;
  while(Date.now()<deadline) {
    const view=manager.get(projectId,id);
    if(view.status==='ready')return view;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('Acquisition did not reach ready state.');
}

test('cancel during final journal persist does not overwrite a completed acquisition',async t=>{
  const {manager,prepared,persistedFile}=await fixture(t);
  const gate=holdPersist(manager,task=>task.view.status==='ready'&&task.view.stage==='done');
  await manager.start(projectId,prepared.id,{plan:'structure',limits:{}});
  await gate.entered.promise;
  try {
    assert.equal(manager.get(projectId,prepared.id).stage,'saving');
    const cancellation=await manager.cancel(projectId,prepared.id);
    assert.equal(cancellation.status,'running');
    assert.equal(cancellation.stage,'saving');
  } finally {gate.release.resolve();}
  assert.equal((await waitForReady(manager,prepared.id)).status,'ready');
  const persisted=JSON.parse(await readFile(persistedFile,'utf8')) as Journal;
  assert.equal(persisted.view.status,'ready');
});

test('commit waits until the acquisition journal is durable',async t=>{
  const {manager,prepared}=await fixture(t);
  const gate=holdPersist(manager,task=>task.view.status==='ready'&&task.view.stage==='done');
  await manager.start(projectId,prepared.id,{plan:'structure',limits:{}});
  await gate.entered.promise;
  try {
    assert.equal(manager.get(projectId,prepared.id).stage,'saving');
    await assert.rejects(manager.commit(projectId,prepared.id,0),{code:'ACQUISITION_BUSY'});
  } finally {gate.release.resolve();}
  assert.equal((await waitForReady(manager,prepared.id)).status,'ready');
});

test('shutdown joins a launch paused before its first journal persist',async t=>{
  const {manager,prepared,persistedFile}=await fixture(t);
  const gate=holdPersist(manager,task=>task.view.status==='running'&&task.view.stage==='prepared');
  const starting=manager.start(projectId,prepared.id,{plan:'structure',limits:{}});
  await gate.entered.promise;
  let closeReturned=false;
  const closing=manager.close().then(()=>{closeReturned=true;});
  try {
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(closeReturned,false);
  } finally {gate.release.resolve();}
  await Promise.all([starting,closing]);
  assert.equal(manager.get(projectId,prepared.id).status,'cancelled');
  const persisted=JSON.parse(await readFile(persistedFile,'utf8')) as Journal;
  assert.equal(persisted.view.status,'cancelled');
});

for(const changed of ['abort','session'] as const) {
  test(`preflight discards a ${changed} change during its final project read`,async t=>{
    const {manager,store,broker,project}=await environment(t);
    const gate={entered:deferred(),release:deferred()};
    let reads=0;
    store.get=async id=>{
      assert.equal(id,projectId);
      if(++reads===2){gate.entered.resolve();await gate.release.promise;}
      return project;
    };
    const controller=new AbortController();
    const preparing=manager.prepare(projectId,0,sessionId,controller.signal);
    await gate.entered.promise;
    try {
      if(changed==='abort')controller.abort();
      else broker.status.sessionId='replacement-session';
    } finally {gate.release.resolve();}
    await assert.rejects(preparing,{code:changed==='abort'?'CANCELLED':'PLUGIN_SESSION_CHANGED'});
    assert.deepEqual(manager.list(projectId),[]);
  });
}

test('preflight hides a task until its journal exists and does not permit early removal',async t=>{
  const {manager}=await environment(t);
  const gate=holdPersist(manager,task=>task.view.status==='prepared');
  const preparing=manager.prepare(projectId,0,sessionId);
  await gate.entered.promise;
  try {
    assert.ok(gate.heldId);
    assert.deepEqual(manager.list(projectId),[]);
    assert.throws(()=>manager.get(projectId,gate.heldId!),{code:'NOT_FOUND'});
    await assert.rejects(manager.remove(projectId,gate.heldId!),{code:'NOT_FOUND'});
  } finally {gate.release.resolve();}
  const prepared=await preparing;
  assert.equal(prepared.id,gate.heldId);
  assert.equal(manager.get(projectId,prepared.id).status,'prepared');
  assert.deepEqual(manager.list(projectId).map(task=>task.id),[prepared.id]);
});
