import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function ui(language = 'en-US') {
  const script = buildSync({ entryPoints: ['plugins/semantic-bridge/ui.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020' }).outputFiles[0]!.text;
  type Element = { value: string; textContent: string; placeholder: string; disabled: boolean; dataset: Record<string, string>; onclick?: () => void; onchange?: () => void; addEventListener: () => void };
  const elements = new Map<string, Element>();
  const listeners = new Map<string, (event?: unknown) => void>();
  const posted: { pluginMessage: Record<string, unknown> }[] = [];
  const parent = { postMessage: (value: typeof posted[number]) => posted.push(value) }, top = {};
  const documentElement = { lang: 'en' };
  const sent: string[] = []; let closed = 0, socket: Socket | undefined;
  class Socket {
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; }
    send(value: string) { sent.push(value); }
    close() { closed++; }
  }
  vm.runInNewContext(script, {
    document: { documentElement, querySelector: (selector: string) => {
      if (!elements.has(selector)) elements.set(selector, { value: '', textContent: '', placeholder: '', disabled: false, dataset: {}, addEventListener() {} });
      return elements.get(selector);
    } },
    navigator: { languages: [language], language },
    window: { addEventListener: (name: string, fn: (event?: unknown) => void) => listeners.set(name, fn) },
    crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, parent, top,
    WebSocket: Socket, setTimeout: () => 0, clearTimeout() {},
  });
  const change = (locale: string) => { elements.get('#locale')!.value = locale; elements.get('#locale')!.onchange!(); };
  const receive = (message: unknown, source: unknown = parent, origin = '') => listeners.get('message')!({ data: { pluginMessage: message }, source, origin });
  return { elements, posted, listeners, documentElement, change, receive, parent, top, sent, socket: () => socket!, closed: () => closed };
}

test('plugin locale uses the first browser language, preserves token input, and rejects foreign locale messages', () => {
  const app = ui('ko-KR');
  assert.equal(app.documentElement.lang, 'ko');
  assert.equal(app.elements.get('#connect')!.textContent, '연결');
  app.elements.get('#token')!.value = 'private-input-stays-in-ui';
  app.listeners.get('load')!();
  assert.equal(app.posted[0]!.pluginMessage.type, 'locale-read');
  app.receive({ type: 'locale', locale: 'en' }, {}, 'https://www.figma.com');
  app.receive({ type: 'locale', locale: 'en' }, app.top, 'https://evil.example');
  assert.equal(app.documentElement.lang, 'ko');
  app.receive({ type: 'locale', locale: 'en' }, app.top, 'https://www.figma.com');
  assert.equal(app.documentElement.lang, 'en');
  app.change('ko');
  app.receive({ type: 'locale', locale: 'en' });
  assert.equal(app.documentElement.lang, 'ko', 'late initial storage read must not overwrite an explicit choice');
  assert.equal(app.elements.get('#token')!.value, 'private-input-stays-in-ui');
  assert.ok(!JSON.stringify(app.posted).includes('private-input-stays-in-ui'));
  app.change('xx');
  assert.equal(app.documentElement.lang, 'ko');
});

test('plugin locale keeps local errors actionable in both languages', () => {
  const app = ui();
  app.elements.get('#connect')!.onclick!();
  assert.match(app.elements.get('#status')!.textContent, /32.*1024/);
  app.change('ko');
  assert.match(app.elements.get('#status')!.textContent, /페어링 토큰/);
  app.change('en');
  assert.match(app.elements.get('#status')!.textContent, /pairing token/);
});

test('changing plugin language preserves an authenticated connection and pending source request', () => {
  const app = ui();
  app.elements.get('#token')!.value = 'synthetic-locale-token-32-characters';
  app.elements.get('#connect')!.onclick!();
  app.socket().onopen!();
  app.socket().onmessage!({ data: JSON.stringify({ type: 'welcome', sessionId: 'locale-test' }) });
  app.socket().onmessage!({ data: JSON.stringify({ type: 'request', requestId: 'pending-read', command: { type: 'get_selection' } }) });
  const request = app.posted.find(value => value.pluginMessage.type === 'execute')!.pluginMessage;
  app.change('ko');
  assert.equal(app.closed(), 0);
  assert.equal(app.elements.get('#connect')!.disabled, true);
  assert.equal(app.elements.get('#disconnect')!.disabled, false);
  assert.match(app.elements.get('#status')!.textContent, /연결되었습니다/);
  app.receive({ type: 'complete', generation: request.generation, response: { type: 'response', requestId: 'pending-read', ok: true, result: {} } });
  assert.equal(JSON.parse(app.sent.at(-1)!).requestId, 'pending-read');
  app.receive({ type: 'locale-saved', requestId: 1, ok: false });
  assert.match(app.elements.get('#locale-notice')!.textContent, /저장하지 못/);
  app.change('en');
  app.receive({ type: 'locale-saved', requestId: 1, ok: false });
  assert.equal(app.elements.get('#locale-notice')!.textContent, '', 'old write result must not replace the latest preference status');
  app.receive({ type: 'locale-saved', requestId: 2, ok: false });
  assert.match(app.elements.get('#locale-notice')!.textContent, /could not be saved/);
});

test('plugin sandbox stores only a validated locale and serializes writes without touching source APIs', async () => {
  const script = buildSync({ entryPoints: ['plugins/semantic-bridge/code.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2018', define: { __html__: JSON.stringify('<html></html>') } }).outputFiles[0]!.text;
  const messages: Record<string, unknown>[] = [], writes: [string, unknown][] = [];
  let stored: unknown = 'ko', releaseFirst: (() => void) | undefined;
  const ui: { onmessage?: (message: unknown) => Promise<void>; postMessage: (message: Record<string, unknown>) => void } = { postMessage: message => messages.push(message) };
  const figma = { ui, showUI() {}, on() {}, clientStorage: {
    getAsync: async (key: string) => { assert.equal(key, 'fsb-locale'); return stored; },
    setAsync: async (key: string, value: unknown) => { writes.push([key, value]); if (writes.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; }); stored = value; },
  } };
  vm.runInNewContext(script, { figma });
  await ui.onmessage!({ type: 'locale-read' });
  assert.equal(messages.at(-1)?.locale, 'ko');
  await ui.onmessage!({ type: 'locale-set', locale: 'not-a-locale', requestId: 1 });
  assert.equal(writes.length, 0);
  const first = ui.onmessage!({ type: 'locale-set', locale: 'en', requestId: 1 });
  await Promise.resolve(); await Promise.resolve();
  const second = ui.onmessage!({ type: 'locale-set', locale: 'ko', requestId: 2 });
  await Promise.resolve();
  assert.equal(writes.length, 1);
  releaseFirst!(); await Promise.all([first, second]);
  assert.deepEqual(writes, [['fsb-locale', 'en'], ['fsb-locale', 'ko']]);
  assert.equal(stored, 'ko');
  assert.equal(messages.at(-1)?.type, 'locale-saved');
  assert.equal(messages.at(-1)?.requestId, 2);
});
