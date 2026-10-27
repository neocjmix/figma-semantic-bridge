import { reportDiagnostic } from './observability.js';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number,public readonly requestId?:string) { super(message);this.name='ApiError'; }
}

export async function request<T>(token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const started=performance.now();
  reportDiagnostic({event:'ui.request.start',level:'debug'});
  try{
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const header=response.headers.get('X-FSB-Request-Id'),requestId=header&&/^[0-9a-f-]{36}$/i.test(header)?header:undefined;
  const data: unknown = await response.json().catch(() => {throw new ApiError('INVALID_RESPONSE','The local service returned an unreadable response.',response.status,requestId);});
  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(typeof error?.error?.code==='string'?error.error.code:'REQUEST_FAILED', typeof error?.error?.message==='string'?error.error.message:`Request failed (${response.status})`, response.status,requestId);
  }
  reportDiagnostic({event:'ui.request.complete',level:'info',status:response.status,durationMs:performance.now()-started,...(requestId?{requestId}:{})});
  return data as T;
  }catch(error){
    reportDiagnostic({event:'ui.request.error',level:'error',durationMs:performance.now()-started,...(error instanceof ApiError?{code:error.code,status:error.status,...(error.requestId?{requestId:error.requestId}:{})}:{code:signal?.aborted?'CANCELLED':'NETWORK_ERROR'})});
    throw error;
  }
}

export function download(name: string, value: unknown, markdown = false): void {
  const content = markdown ? String(value) : JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: markdown ? 'text/markdown;charset=utf-8' : 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
