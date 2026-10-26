import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultImportSettings, ImportSettingsSchema } from '../src/shared/import-settings.js';
import { ImportSettingsStore } from '../src/server/import-settings.js';

test('import settings double image dimensions and permit larger resumable budgets without unbounded values',()=>{
  const defaults=defaultImportSettings();
  assert.equal(defaults.overview.scale,2);assert.equal(defaults.overview.maxDimension,4096);
  assert.equal(defaults.maxNodes,200_000);
  assert.equal(ImportSettingsSchema.parse({...defaults,maxNodes:500_000}).maxNodes,500_000);
  assert.throws(()=>ImportSettingsSchema.parse({...defaults,maxNodes:Infinity}));
  assert.throws(()=>ImportSettingsSchema.parse({...defaults,overview:{...defaults.overview,maxDimension:100_000}}));
});
test('settings persist across restart, isolate returned values and reject stale changes',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fsb-settings-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new ImportSettingsStore(directory);await store.initialize();
  const first=store.get();first.settings.maxNodes=7;assert.equal(store.get().settings.maxNodes,200_000);
  await store.save(0,{...first.settings,maxNodes:300_000});
  const reopened=new ImportSettingsStore(directory);await reopened.initialize();
  assert.equal(reopened.get().settings.maxNodes,300_000);assert.equal(reopened.get().revision,1);
  await assert.rejects(store.save(0,first.settings),{code:'REVISION_CONFLICT'});
});
