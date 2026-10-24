import type { Annotation, Snapshot, SourceReview } from '../shared/contracts.js';
import { matchRegion, type MatchResult } from './matching.js';
import { buildRenderingEvidence } from './rendering-evidence.js';

/** Geometric candidates are review aids, never proof of a node's visible pixels. */
export function sourceReviewFromMatch(result:MatchResult):SourceReview {
  return {candidates:structuredClone(result.candidates),ambiguous:result.ambiguous,warnings:[...result.warnings],
    status:'unconfirmed',confirmedAt:null};
}

function sameGeometry(a:Annotation,b:Annotation):boolean {
  return a.snapshotId===b.snapshotId&&a.bbox.x===b.bbox.x&&a.bbox.y===b.bbox.y&&
    a.bbox.width===b.bbox.width&&a.bbox.height===b.bbox.height;
}
function sameReferences(a:Annotation,b:Annotation):boolean {
  return a.sourceRefs.length===b.sourceRefs.length&&a.sourceRefs.every((ref,index)=>{
    const other=b.sourceRefs[index]!;
    return ref.snapshotId===other.snapshotId&&ref.nodeId===other.nodeId&&ref.matchType===other.matchType&&ref.coverage===other.coverage;
  });
}

/** Only persisted evidence can survive an edit; input review fields are never trusted. */
export function annotationSourceReview(snapshot:Snapshot,input:Annotation,prior?:Annotation,result?:MatchResult):SourceReview {
  const unchanged=!result&&prior?.sourceReview&&sameGeometry(prior,input)&&sameReferences(prior,input);
  const review=!result&&prior?.sourceReview&&sameGeometry(prior,input)?structuredClone(prior.sourceReview):
    sourceReviewFromMatch(result??matchRegion(snapshot,input.bbox));
  if(!unchanged){review.status='unconfirmed';review.confirmedAt=null;}
  const modern=snapshot.nodes.some(node=>node.rendering!==undefined);
  const evidence=buildRenderingEvidence(snapshot.nodes,snapshot.source.pageId);
  const required=input.sourceRefs.some(ref=>{
    const status=evidence.get(ref.nodeId)?.status;
    return status==='hidden'||status==='transparent'||(modern&&status==='unknown');
  });
  if(modern||required||review.renderingReviewRequired!==undefined)review.renderingReviewRequired=required;
  return review;
}
