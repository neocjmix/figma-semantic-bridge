import type { Project, Snapshot } from '../shared/contracts.js';
import { ServiceError } from './errors.js';

// Leave room for tool/protocol envelopes below the MCP 128 KB output budget.
const MAX_PAGE_BYTES=120_000;
export function boundedPage<T>(values:readonly T[],offset:number,limit:number) {
  const records:T[]=[];let bytes=1024;
  for(const record of values.slice(offset,offset+limit)) {
    const size=Buffer.byteLength(JSON.stringify(record))+1;
    if(bytes+size>MAX_PAGE_BYTES) {
      if(records.length===0)throw new ServiceError('RESPONSE_LIMIT','One record exceeds the 120 KB tool budget; use bounded source-node queries.',413);
      break;
    }
    bytes+=size;records.push(record);
  }
  const next=offset+records.length;
  return {records,total:values.length,offset,nextOffset:next<values.length?next:null};
}
export function captureSummary(project:Project,snapshot:Snapshot) {
  return {projectId:project.id,revision:project.revision,snapshot:{id:snapshot.id,name:snapshot.name,source:snapshot.source,completeness:snapshot.completeness,warnings:snapshot.warnings.slice(0,10),warningCount:snapshot.warnings.length}};
}
export function proposalSummary(project:Project) {
  const proposal=project.proposals.at(-1)!;
  return {projectId:project.id,revision:project.revision,proposal:{id:proposal.id,status:proposal.status,baseRevision:proposal.baseRevision,warnings:proposal.warnings.slice(0,10),warningCount:proposal.warnings.length}};
}
