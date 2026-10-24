import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

execFileSync(process.execPath, ['scripts/build-fixture-plugin.mjs'], { stdio: 'pipe' });
let html = '';
vm.runInNewContext(readFileSync('plugins/fixture-analyzer/code.js', 'utf8'), {
  figma: { showUI: (value: string) => { html = value; }, ui: {} },
}, { timeout: 2000 });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
const script = scripts[0]![1]!;

type Element = { disabled: boolean; value: string; textContent: string; onclick?: () => void };
type Message = { source: object; origin: string; data: unknown };

for (const host of ['parent', 'https://www.figma.com', 'https://figma.com']) {
  test(`built fixture UI completes analysis from ${host} and rejects unrelated senders`, () => {
    const elements = new Map<string, Element>();
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const top = {};
    const window: { onmessage?: (event: Message) => void } = {};
    vm.runInNewContext(script, {
      document: { getElementById: (id: string) => {
        const element: Element = { disabled: id === 'download', value: '', textContent: '' };
        elements.set(id, element); return element;
      } },
      window, parent, top,
    }, { timeout: 2000 });
    const selection = elements.get('selection')!, page = elements.get('page')!;
    const download = elements.get('download')!, output = elements.get('output')!, status = elements.get('status')!;
    const source = host === 'parent' ? parent : top, origin = host === 'parent' ? 'null' : host;
    const report = { schemaVersion: '1.0.0', counts: { nodes: 21 }, complete: true };
    const result = { pluginMessage: { type: 'result', report } };

    selection.onclick!();
    assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), { pluginMessage: { type: 'analyze-selection' } });
    assert.equal(selection.disabled, true);
    assert.equal(page.disabled, true);
    assert.equal(download.disabled, true);
    for (const sender of [
      { source: {}, origin: 'https://www.figma.com' },
      { source: {}, origin: 'https://figma.com' },
      { source: top, origin: 'https://untrusted.example' },
      { source: top, origin: 'https://www.figma.com.untrusted.example' },
      { source: top, origin: 'null' },
    ]) {
      window.onmessage!({ ...sender, data: result });
      window.onmessage!({ ...sender, data: { pluginMessage: { type: 'error', message: 'Untrusted error' } } });
      assert.equal(selection.disabled, true);
      assert.equal(page.disabled, true);
      assert.equal(download.disabled, true);
      assert.equal(output.value, '');
      assert.equal(status.textContent, 'Analyzing the chosen scope…');
    }

    window.onmessage!({ source, origin, data: result });
    assert.equal(selection.disabled, false, 'A trusted host result must release the Analyze buttons.');
    assert.equal(page.disabled, false);
    assert.equal(download.disabled, false);
    assert.deepEqual(JSON.parse(output.value), report);
    assert.match(status.textContent, /Report ready/);

    page.onclick!();
    assert.deepEqual(JSON.parse(JSON.stringify(posted[1])), { pluginMessage: { type: 'analyze-page' } });
    assert.equal(output.value, '');
    window.onmessage!({ source, origin, data: { pluginMessage: { type: 'error', message: 'Select a supported container.' } } });
    assert.equal(selection.disabled, false);
    assert.equal(page.disabled, false);
    assert.equal(download.disabled, true);
    assert.equal(status.textContent, 'Select a supported container.');
  });
}
