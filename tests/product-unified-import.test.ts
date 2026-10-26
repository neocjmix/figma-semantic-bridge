import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceImportFixture } from './source-import-fixture.js';
import { CollectionViewSchema,type CollectionView } from '../src/shared/structure-collection.js';
import { SettingsViewSchema } from '../src/shared/import-settings.js';
import { NodePreviewResultSchema } from '../src/shared/contracts.js';

async function until(read:()=>Promise<CollectionView>,accept:(v:CollectionView)=>boolean){
  const end=Date.now()+20000;while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,15));}assert.fail('Synthetic import did not settle');
}
test('normal import crosses 5,000 nodes; raising a paused budget preserves packets and exact text',async t=>{
  const f=await sourceImportFixture({nodeCount:6001});t.after(()=>f.close());
  const original=await f.readProject(),settings=SettingsViewSchema.parse(await(await f.api('/api/import-settings')).json());
  assert.equal((await f.api('/api/import-settings',{expectedRevision:settings.revision,settings:{...settings.settings,maxNodes:5000}})).status,200);
  const base=`/api/projects/${f.projectId}/collections`;
  const prepared=CollectionViewSchema.parse(await(await f.api(base,{expectedRevision:original.revision,expectedSessionId:f.sessionId,withOverview:true})).json());
  assert.equal(f.commands.filter(command=>command.type!=='get_selection').length,0);
  const get=async()=>CollectionViewSchema.parse(await(await f.api(`${base}/${prepared.id}`)).json());
  await f.api(`${base}/${prepared.id}/start`,{});
  const paused=await until(get,value=>value.status==='paused');assert.equal(paused.pauseReason,'nodes');assert.equal(paused.nodeCount,5000);
  const picture=NodePreviewResultSchema.parse(await(await f.api(`/api/projects/${f.projectId}/acquisitions/${prepared.overviewAcquisitionId}/preview`)).json());
  assert.equal(picture.preview.width,256);assert.equal(picture.preview.height,128);
  const current=SettingsViewSchema.parse(await(await f.api('/api/import-settings')).json());
  await f.api('/api/import-settings',{expectedRevision:current.revision,settings:{...current.settings,maxNodes:10000}});
  await f.api(`${base}/${prepared.id}/resume`,{});const complete=await until(get,value=>value.status==='complete');
  assert.equal(complete.nodeCount,6001);assert.equal(f.childReads,1);
  assert.equal(f.commands.filter(command=>command.type==='preview_capture').length,1);
  assert.deepEqual(f.commands.filter(command=>command.type==='read_structure_chunk').map(command=>command.sequence),Array.from({length:13},(_,index)=>index));
  const text=await(await f.api(`${base}/${prepared.id}/text`,{nodeId:'leaf-0',offset:0,limit:4000})).json();
  assert.equal(text.text,' Exact 한글 👩‍💻\r\n source text ');
  assert.deepEqual(await f.readProject(),original);
});
test('settings require authentication, reject unsafe values, survive restart and refuse stale writes',async t=>{
  const f=await sourceImportFixture();t.after(()=>f.close());
  assert.equal((await fetch(f.url+'/api/import-settings')).status,401);
  const current=SettingsViewSchema.parse(await(await f.api('/api/import-settings')).json());
  assert.equal((await f.api('/api/import-settings',{expectedRevision:0,settings:{...current.settings,maxNodes:1_000_001}})).status,400);
  assert.equal((await f.api('/api/import-settings',{expectedRevision:0,settings:{...current.settings,maxNodes:300000}})).status,200);
  assert.equal((await f.api('/api/import-settings',{expectedRevision:0,settings:current.settings})).status,409);
  await f.restart();const saved=SettingsViewSchema.parse(await(await f.api('/api/import-settings')).json());assert.equal(saved.settings.maxNodes,300000);
});
