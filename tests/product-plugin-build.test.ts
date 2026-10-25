import { challengeFor } from './bridge-auth-helper.js';
import { BRIDGE_PROTOCOL, bridgeProof, BridgeChannel } from '../src/shared/bridge-auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

test('built Desktop plugin embeds one syntactically valid UI script', () => {
  execFileSync(process.execPath, ['scripts/build-product-plugin.mjs'], { stdio: 'pipe' });
  const code=readFileSync('plugins/semantic-bridge/code.js','utf8');
  // Figma's sandbox rejects even an import() spelling inside a dependency comment.
  assert.doesNotMatch(code,/\bimport\s*\(/);
  let html = '';
  const page = { id: 'synthetic-page', name: 'Synthetic page', type: 'PAGE', parent: null, selection: [],
    on(type: string, listener: () => void) { assert.equal(type, 'nodechange'); assert.equal(typeof listener, 'function'); },
    off(type: string, listener: () => void) { assert.equal(type, 'nodechange'); assert.equal(typeof listener, 'function'); } };
  vm.runInNewContext(code, {
    figma: { currentPage: page, showUI: (value: string) => { html = value; },
      on: (type: string) => { assert.ok(type === 'currentpagechange' || type === 'close'); }, ui: {} },
  }, { timeout: 2000, contextCodeGeneration:{strings:false,wasm:false} });
  assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]![1]!));
  assert.ok(html.includes('id="connect"'));
  const elements = new Map<string, { value: string; addEventListener: () => void; onclick?: () => void }>();
  const listeners = new Map<string, (event: unknown) => void>();
  const posted: unknown[] = [];
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  const top = {};
  const sent: string[] = [];
  let socket: FakeSocket;
  class FakeSocket {
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; }
    send(value: string) { sent.push(value); }
    close() {}
  }
  vm.runInNewContext(scripts[0]![1]!, {
    document: { querySelector: (selector: string) => {
      const element = { value: '', dataset: {}, addEventListener: () => {} }; elements.set(selector, element); return element;
    } },
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, TextEncoder, TextDecoder, btoa, atob,
    window: { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) },
    parent, top, WebSocket: FakeSocket, setTimeout: () => 0, clearTimeout: () => {},
  }, { timeout: 2000 });
  assert.equal(typeof elements.get('#connect')?.onclick, 'function');
  assert.equal(typeof elements.get('#disconnect')?.onclick, 'function');
  elements.get('#token')!.value = 'synthetic-plugin-token-32-chars-long';
  elements.get('#connect')!.onclick!();
  socket!.onopen!();
  const challenge=challengeFor(JSON.parse(sent[0]!), 'synthetic-plugin-token-32-chars-long');
  socket!.onmessage!({data:JSON.stringify(challenge)});
  socket!.onmessage!({data:JSON.stringify({type:'welcome',protocol:BRIDGE_PROTOCOL,sessionId:challenge.sessionId,proof:bridgeProof('synthetic-plugin-token-32-chars-long','server-welcome',challenge)})});
  const channel=new BridgeChannel('synthetic-plugin-token-32-chars-long',challenge,'server');
  socket!.onmessage!({data:channel.seal(JSON.stringify({type:'request',requestId:'test-read',command:{type:'get_selection'}}))});
  const request = JSON.parse(JSON.stringify(posted[0])).pluginMessage;
  const data = { pluginMessage: { type: 'complete', generation: request.generation, response: { type: 'response', requestId: 'test-read', ok: true, result: {} } } };
  const message = listeners.get('message')!;
  const before = sent.length;
  message({ source: {}, origin: 'https://www.figma.com', data });
  message({ source: top, origin: 'https://untrusted.example', data });
  assert.equal(sent.length, before);
  message({ source: top, origin: 'https://www.figma.com', data });
  assert.equal(sent.length, before + 1);
  assert.equal((channel.open(sent.at(-1)!) as {requestId:string}).requestId, 'test-read');
  elements.get('#disconnect')!.onclick!();
});
