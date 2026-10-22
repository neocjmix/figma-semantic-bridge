export class BridgeApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BridgeApiError'; }
}

/** Only the authenticated local bridge; never a general-purpose fetch tool. */
export class BridgeApi {
  readonly url: string;
  constructor(url: string, private readonly token: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('FSB_SERVER_URL must be a loopback HTTP origin.');
    }
    if (token.length < 32 || token.length > 1024) throw new Error('A local pairing token is required.');
    this.url = parsed.origin;
  }
  async request<T = unknown>(path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('..')) throw new BridgeApiError('INVALID_PATH', 'Invalid bridge API path.');
    let response: Response;
    try {
      response = await fetch(this.url + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000), redirect: 'error',
      });
    } catch { throw new BridgeApiError('BRIDGE_UNAVAILABLE', 'Local bridge is unavailable or timed out. Start it and check pairing.'); }
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
      const error = result as { error?: { code?: string; message?: string } };
      throw new BridgeApiError(error.error?.code ?? 'BRIDGE_ERROR', error.error?.message ?? `Bridge request failed (${response.status}).`);
    }
    return result as T;
  }
}
