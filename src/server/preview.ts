import { NODE_PREVIEW_MAX_BYTES, NODE_PREVIEW_MAX_DIMENSION, type NodePreviewResult, type Snapshot } from '../shared/contracts.js';
import { ServiceError } from './errors.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** PNG-only previews cannot become HTML/SVG execution contexts in the web client. */
export function validatePreview(snapshot: Pick<Snapshot,'preview'>): void {
  if (!snapshot.preview) return;
  const {base64,width,height}=snapshot.preview;
  // Avoid repeated-group regexes: V8 can exhaust its stack on valid multi-MB
  // payloads. Decode/re-encode compares canonical alphabet/padding in linear work.
  if (base64.length===0||base64.length>12_000_000||base64.length%4!==0) {
    throw new ServiceError('INVALID_PREVIEW','Preview must contain canonical PNG base64.');
  }
  const png=Buffer.from(base64,'base64');
  if(png.toString('base64')!==base64)throw new ServiceError('INVALID_PREVIEW','Preview must contain canonical PNG base64.');
  if(png.length<33||png.length>9_000_000||!png.subarray(0,8).equals(PNG_SIGNATURE)||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(8)!==13) {
    throw new ServiceError('INVALID_PREVIEW','Preview must be a bounded PNG image.');
  }
  if(png.readUInt32BE(16)!==width||png.readUInt32BE(20)!==height) {
    throw new ServiceError('INVALID_PREVIEW','Preview dimensions do not match its PNG header.');
  }
}

/** Enforce node-export limits independently of the live plugin. No pixel-visibility claims. */
export function validateNodePreview(result:NodePreviewResult):void {
  const {preview,node}=result,bounds=node.bbox;
  if(!bounds||bounds.width<=0||bounds.height<=0||preview.width>NODE_PREVIEW_MAX_DIMENSION||preview.height>NODE_PREVIEW_MAX_DIMENSION||
    preview.base64.length>Math.ceil(NODE_PREVIEW_MAX_BYTES/3)*4||Buffer.byteLength(preview.base64,'base64')>NODE_PREVIEW_MAX_BYTES) {
    throw new ServiceError('INVALID_PREVIEW','Node export exceeds the bounded image contract.');
  }
  validatePreview(result);
  const scale=Math.min(1,NODE_PREVIEW_MAX_DIMENSION/Math.max(bounds.width,bounds.height));
  if(Math.abs(preview.width-bounds.width*scale)>2||Math.abs(preview.height-bounds.height*scale)>2) {
    throw new ServiceError('INVALID_PREVIEW','Node export dimensions differ from its observed bounds.');
  }
}
