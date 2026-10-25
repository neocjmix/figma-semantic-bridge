import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureBundleSchema, ImportCaptureBundleInputSchema, ExportCaptureBundleInputSchema } from '../src/shared/capture-bundle.js';

function unreadable(length:number):unknown[] {
  const values=new Array(length);
  Object.defineProperty(values,0,{get(){throw new Error('Element validation ran before collection bounds.');}});
  return values;
}
function envelope(snapshots:unknown[]) {
  return {kind:'figma-semantic-bridge.capture-bundle',version:'1.0.0',exportedAt:'2026-10-26T00:00:00.000Z',snapshots};
}

test('capture bundle collection bounds run before nested element validation for every public schema entry',()=>{
  for(const bundle of [
    envelope(unreadable(1000)),
    envelope([{snapshot:{nodes:unreadable(6000)}},{snapshot:{nodes:unreadable(4001)}}]),
    envelope([{snapshot:{nodes:unreadable(10001)}}]),
    envelope([{snapshot:{nodes:unreadable(1),warnings:unreadable(101)}}]),
  ]) {
    for(const result of [CaptureBundleSchema.safeParse(bundle),ImportCaptureBundleInputSchema.safeParse({name:'Bounded input',bundle})]) {
      assert.equal(result.success,false);
      if(!result.success)assert.equal(result.error.issues.length,1,'One bounded collection error, no nested issues.');
    }
  }
  const result=ExportCaptureBundleInputSchema.safeParse({expectedRevision:0,snapshotIds:unreadable(1000)});
  assert.equal(result.success,false);
  if(!result.success)assert.equal(result.error.issues.length,1);
});

test('small invalid records and strict unknown fields still reach ordinary contract validation',()=>{
  assert.equal(CaptureBundleSchema.safeParse(envelope([{}])).success,false);
  assert.equal(ExportCaptureBundleInputSchema.safeParse({expectedRevision:0,snapshotIds:['one'],token:'forbidden'}).success,false);
  assert.equal(ExportCaptureBundleInputSchema.safeParse({expectedRevision:0,snapshotIds:['one','two']}).success,true);
});
