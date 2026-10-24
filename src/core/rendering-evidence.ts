import type { SourceNode } from '../shared/contracts.js';

export interface RenderingEvidence {
  status: 'hidden'|'transparent'|'unknown'|'potential';
  reason: string;
  sourceNodeId: string|null;
}
const potential:RenderingEvidence={status:'potential',reason:'Visible with positive opacity along the observed chain to the page boundary. Actual pixel contribution, clipping and occlusion remain unverified.',sourceNodeId:null};

/** O(n), bounded and iterative. No external tree reads or inferred pixel visibility. */
export function buildRenderingEvidence(nodes:readonly SourceNode[],pageId?:string):Map<string,RenderingEvidence> {
  if(nodes.length>10000)throw new Error('Rendering evidence is limited to 10,000 source nodes.');
  const source=new Map<string,SourceNode>(),children=new Map<string,SourceNode[]>();
  for(const node of nodes){if(source.has(node.id))throw new Error('Duplicate source node ID.');source.set(node.id,node);}
  const stack:Array<{node:SourceNode;inherited:RenderingEvidence}>=[];
  for(const node of nodes){
    if(node.parentId!==null&&source.has(node.parentId)){
      const list=children.get(node.parentId)??[];list.push(node);children.set(node.parentId,list);
    }else stack.push({node,inherited:node.parentId===(pageId??node.sourcePageId)?potential:
      {status:'unknown',reason:'An ancestor outside this captured scope was not observed.',sourceNodeId:node.parentId}});
  }
  const result=new Map<string,RenderingEvidence>();
  while(stack.length){
    const {node,inherited}=stack.pop()!;
    let evidence:RenderingEvidence;
    if(!node.visible)evidence={status:'hidden',reason:'This observed node has visible=false.',sourceNodeId:node.id};
    else if(inherited.status==='hidden')evidence=inherited;
    else if(node.rendering?.opacity===0)evidence={status:'transparent',reason:'This observed node has opacity=0.',sourceNodeId:node.id};
    else if(inherited.status==='transparent')evidence=inherited;
    else if(inherited.status==='unknown')evidence=inherited;
    else if(node.rendering?.opacity===undefined)evidence={status:'unknown',reason:'Opacity was not observed for this node.',sourceNodeId:node.id};
    else evidence=potential;
    result.set(node.id,evidence);
    for(const child of children.get(node.id)??[])stack.push({node:child,inherited:evidence});
  }
  if(result.size!==nodes.length)throw new Error('Source ancestry contains a cycle.');
  return result;
}
