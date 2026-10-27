import { z } from 'zod';

export const DiagnosticEventSchema = z.enum(['http.start','http.complete','http.error','plugin.start','plugin.complete','plugin.error','plugin.progress','plugin.connected','plugin.disconnected','runtime.ready','runtime.stopping','runtime.error','ui.action.start','ui.action.complete','ui.action.error','ui.request.start','ui.request.complete','ui.request.error','web.console','web.error','web.unhandledrejection','web.ready']);
export const diagnosticActions = ['connect','create_workspace','import_source','inspect_sources','edit_region','review_region','edit_specification','export','undo','redo','settings','refresh','editor.action','region.draw','region.edit','specification.begin','workspace.switch','unknown'] as const;
const actions = new Set<string>(diagnosticActions);
export function diagnosticAction(value: unknown): string { return typeof value==='string'&&actions.has(value)?value:'unknown'; }
const CodeSchema=z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export function diagnosticFrame(value:string):boolean{
  return /^(?:web\/|src\/|app\/|assets\/|server\.mjs|mcp\.mjs)[A-Za-z0-9_./-]*:\d+:\d+$/.test(value)&&
    value.split(':')[0]!.split('/').every(segment=>segment!==''&&segment!=='.'&&segment!=='..');
}
export const DiagnosticClientEventSchema=z.object({
  event:DiagnosticEventSchema.extract(['ui.action.start','ui.action.complete','ui.action.error','ui.request.start','ui.request.complete','ui.request.error','web.console','web.error','web.unhandledrejection','web.ready']),
  level:z.enum(['debug','info','warn','error']).default('info'),
  action:z.enum(diagnosticActions).optional(),requestId:z.string().uuid().optional(),code:CodeSchema.optional(),
  durationMs:z.number().finite().min(0).max(86_400_000).optional(),status:z.number().int().min(0).max(599).optional(),
  argumentCount:z.number().int().min(0).max(1000).optional(),
  resourceType:z.enum(['script','style','image','unknown']).optional(),
  errorType:z.enum(['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','DOMException','ApiError','Unknown']).optional(),
  frames:z.array(z.string().max(240).refine(diagnosticFrame)).max(20).optional(),
}).strict();
export type DiagnosticClientEvent=z.infer<typeof DiagnosticClientEventSchema>;

/** Keep code locations, never error text, arguments, URL parameters or user paths. */
export function diagnosticFrames(error:unknown):string[]{
  try{
    if(!(error instanceof Error)||typeof error.stack!=='string')return [];
    let stack=error.stack;
    // V8 puts the complete (possibly multiline) message before the stack.
    // WebKit omits that prefix. Never interpret a message line as a call site.
    const prefix=`${error.name}: ${error.message}`;
    if(stack.startsWith(prefix))stack=stack.slice(prefix.length);
    const result:string[]=[];
    for(const line of stack.split('\n').slice(0,30).filter((line,index)=>index>0||!line.includes('Error:'))){
      const match=line.match(/(?:^|[/\\])((?:web|src|app|assets)\/[A-Za-z0-9_./-]+|server\.mjs|mcp\.mjs):(\d+):(\d+)(?:\)?$)/);
      if(match){const frame=`${match[1]}:${match[2]}:${match[3]}`;if(frame.length<=240&&diagnosticFrame(frame))result.push(frame);}
      if(result.length===20)break;
    }
    return result;
  }catch{return [];}
}
export function diagnosticErrorType(value:unknown):NonNullable<DiagnosticClientEvent['errorType']>{
  const name=value instanceof Error?value.name:'';
  return ['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','DOMException','ApiError'].includes(name)?name as NonNullable<DiagnosticClientEvent['errorType']>:'Unknown';
}
