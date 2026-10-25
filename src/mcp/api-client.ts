import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { X509Certificate } from 'node:crypto';

export class BridgeApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BridgeApiError'; }
}

function responseError(result: unknown, status: number): BridgeApiError {
  const envelope = typeof result === 'object' && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
  const value = envelope?.error;
  const error = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  return new BridgeApiError(
    typeof error?.code === 'string' ? error.code : 'BRIDGE_ERROR',
    typeof error?.message === 'string' ? error.message : `Bridge request failed (${status}).`,
  );
}

/** Only the authenticated local bridge; never a general-purpose fetch tool. */
export class BridgeApi {
  readonly url: string;
  constructor(url: string, private readonly token: string, private readonly transport: {certificate?:Buffer;allowInsecureHttp?:boolean} = {}) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1' ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('FSB_SERVER_URL must be a numeric loopback HTTPS origin.');
    }
    if (parsed.protocol === 'http:' && !transport.allowInsecureHttp) throw new Error('Unverified HTTP requires explicit development-only opt-in.');
    if (parsed.protocol === 'https:' && !transport.certificate) throw new Error('A private local certificate pin is required.');
    if (transport.certificate) {
      if (transport.certificate.length > 16384) throw new Error('Invalid local certificate pin.');
      transport.certificate = Buffer.from(new X509Certificate(transport.certificate).raw);
    }
    if (token.length < 32 || token.length > 1024) throw new Error('A local pairing token is required.');
    this.url = parsed.origin;
  }
  async request<T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('..')) throw new BridgeApiError('INVALID_PATH', 'Invalid bridge API path.');
    const timeout = AbortSignal.timeout(25000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      if (this.url.startsWith('https:')) return await this.pinnedRequest<T>(path,body,requestSignal);
      const response = await fetch(this.url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal, redirect: 'error',
      });
      const reader = response.body?.getReader();
      if (!reader) throw new BridgeApiError('INVALID_RESPONSE', 'Empty bridge response.');
      const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > 16_000_000) { await reader.cancel(); throw new BridgeApiError('RESPONSE_TOO_LARGE', 'Bridge response exceeds the bounded client limit.'); }
        chunks.push(value);
      }
      let result: unknown;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new BridgeApiError('INVALID_RESPONSE', 'Bridge returned invalid JSON.'); }
      if (!response.ok) {
        throw responseError(result, response.status);
      }
      return result as T;
    } catch (error) {
      if (signal?.aborted) throw new BridgeApiError('CANCELLED', 'Bridge request was cancelled.');
      if (error instanceof BridgeApiError) throw error;
      throw new BridgeApiError('BRIDGE_UNAVAILABLE', 'Local bridge is unavailable or timed out. Start it and check pairing.');
    }
  }
  /** TLS authenticates every connection before any bearer header or request body leaves the process. */
  private pinnedRequest<T>(path:string,body:unknown,signal:AbortSignal):Promise<T> {
    const pin=this.transport.certificate!;
    const certificate=new X509Certificate(pin);
    return new Promise((resolve,reject)=>{
      const request=httpsRequest(this.url+path,{
        method:body===undefined?'GET':'POST',agent:false,ca:certificate.toString(),rejectUnauthorized:true,signal,
        minVersion:'TLSv1.2',
        checkServerIdentity:(host,peer)=>peer.raw?.equals(pin)?checkServerIdentity(host,peer):new Error('Local bridge certificate does not match the private pin.'),
        headers:{authorization:`Bearer ${this.token}`,...(body===undefined?{}:{'content-type':'application/json'})},
      },response=>{
        const chunks:Buffer[]=[];let total=0;
        response.on('data',(chunk:Buffer)=>{
          total+=chunk.length;
          if(total>16_000_000){request.destroy(new BridgeApiError('RESPONSE_TOO_LARGE','Bridge response exceeds the bounded client limit.'));return;}
          chunks.push(chunk);
        });
        response.on('error',reject);
        response.on('end',()=>{
          if(total>16_000_000)return;
          const status=response.statusCode??0;
          if(status>=300&&status<400){reject(new BridgeApiError('INVALID_RESPONSE','Bridge redirects are not followed.'));return;}
          let result:unknown;
          try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
          catch{reject(new BridgeApiError('INVALID_RESPONSE','Bridge returned invalid JSON.'));return;}
          if(status<200||status>=300){
            reject(responseError(result,status));return;
          }
          resolve(result as T);
        });
      });
      request.on('error',reject);
      request.end(body===undefined?undefined:JSON.stringify(body));
    });
  }

}
