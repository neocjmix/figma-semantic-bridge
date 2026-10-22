import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { analyzeScope, DEFAULT_LIMITS, type NodeAdapter, type NodeRecord } from '../src/fixture-analysis/index.js';

type SyntheticNode=NodeRecord&{children:SyntheticNode[]};
function fixture(screenCount:number):SyntheticNode {
  const root:SyntheticNode={id:'synthetic-root',parentId:null,type:'FRAME',bbox:{x:0,y:0,width:screenCount*600,height:1000},visible:true,layoutMode:'NONE',children:[]};
  for(let s=0;s<screenCount;s++) {
    const screen:SyntheticNode={id:`s${s}`,parentId:root.id,type:s%3===0?'GROUP':'FRAME',bbox:{x:s*600,y:50,width:400,height:800},visible:true,layoutMode:s%2?'VERTICAL':'NONE',children:[]};root.children.push(screen);
    for(let j=0;j<20;j++) {
      const row:SyntheticNode={id:`s${s}-r${j}`,parentId:screen.id,type:j%4===0?'INSTANCE':'FRAME',bbox:{x:s*600+10,y:60+j*30,width:380,height:28},visible:j!==19,layoutMode:'HORIZONTAL',children:[]};screen.children.push(row);
      row.children.push({id:`s${s}-r${j}-background`,parentId:row.id,type:'RECTANGLE',bbox:{...row.bbox!},visible:true,layoutMode:null,children:[]});
      row.children.push({id:`s${s}-r${j}-text`,parentId:row.id,type:'TEXT',bbox:{x:s*600+20,y:65+j*30,width:180,height:18},visible:true,layoutMode:null,children:[]});
    }
    // Explanatory-like nodes live beside screens in the source tree; only generated geometry exists.
    root.children.push({id:`note${s}`,parentId:root.id,type:'TEXT',bbox:{x:s*600+420,y:100,width:150,height:80},visible:true,layoutMode:null,children:[]});
  }
  return root;
}
const adapter:NodeAdapter<SyntheticNode>={read:({children:_,...record})=>record,children:node=>node.children};
const results=[];
for(const screens of [1,20,100]) {
  const root=fixture(screens),before=process.memoryUsage();
  const report=await analyzeScope(root,adapter,{source:{fileKey:null,pageId:'synthetic-page',rootId:root.id,revision:'generator-v1'},limits:{...DEFAULT_LIMITS,maxDurationMs:10000},tolerancePx:0.5,now:()=>performance.now()});
  const after=process.memoryUsage();
  results.push({label:`generated-${screens}-screens`,generatedScreenCount:screens,report,nodeProcessMemory:{method:'process.memoryUsage snapshots before/after analysis; process.resourceUsage cumulative process high-water RSS',beforeHeapUsedBytes:before.heapUsed,afterHeapUsedBytes:after.heapUsed,afterRssBytes:after.rss,cumulativeMaxRssBytes:process.resourceUsage().maxRSS*1024,peakPluginHeapBytes:{status:'not measured',reason:'Node generator benchmark, not Figma Desktop'}}});
}
const output={schemaVersion:'1.0.0',kind:'generated-synthetic-node-benchmark',measuredAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch},command:'npm run benchmark:fixtures',generator:'scripts/benchmark-fixtures.ts',limitations:['Generated scalar nodes, not the linked synthetic Figma file or any public candidate.','Single run per size; timings are observations, not statistical performance budgets.','Memory snapshots are whole Node process measurements; cumulative maxRSS includes startup and earlier cases.','No source screenshots/text/design assets exist in these fixtures.'],results};
await writeFile('fixtures/synthetic/benchmark-results.json',JSON.stringify(output,null,2)+'\n');
process.stdout.write(results.map(r=>`${r.label}: ${r.report.structure.nodeCount} nodes, ${r.report.timing.totalMs.toFixed(2)} ms, ${r.report.bytes.recordNdjsonUtf8} record bytes, spatial complete=${r.report.spatial.complete}`).join('\n')+'\n');
