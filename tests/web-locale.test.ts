import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, resolveLocale, translate, message, renderMessage, systemMessage, errorMessage, type MessageKey } from '../web/locale.js';
import { ApiError } from '../web/api.js';

test('locale precedence validates native and stored choices, then follows the browser language', () => {
  assert.equal(resolveLocale({ desktopLocale: 'en', storedLocale: 'ko', language: 'ko-KR' }), 'en');
  assert.equal(resolveLocale({ desktopLocale: 'ko', storedLocale: 'en', language: 'en-US' }), 'ko');
  assert.equal(resolveLocale({ desktopLocale: 'fr', storedLocale: 'ko', language: 'en-US' }), 'ko');
  assert.equal(resolveLocale({ storedLocale: 'invalid', language: 'ko-KR' }), 'ko');
  assert.equal(resolveLocale({ language: 'fr-FR' }), 'en');
  assert.equal(resolveLocale({}), 'en');
});

test('known system diagnostics retranslate with the locale while unknown source material stays exact', () => {
  const warning = systemMessage('Equal or near-equal BBoxes admit multiple source candidates; original ancestry and stable IDs choose a deterministic suggestion.');
  assert.match(renderMessage('en', warning), /needs your review/);
  assert.match(renderMessage('ko', warning), /직접 검토/);
  const error = errorMessage(new ApiError('PLUGIN_TIMEOUT', 'Internal transport detail', 504));
  assert.match(renderMessage('en', error), /Check the plugin/);
  assert.match(renderMessage('ko', error), /플러그인/);
  assert.match(renderMessage('ko', error), /PLUGIN_TIMEOUT/);
  const source = '<script>原文 & 고객 문구</script>';
  assert.equal(renderMessage('ko', systemMessage(source)), source);
  assert.equal(renderMessage('en', systemMessage(source)), source);
  const limit = systemMessage('Spatial candidate limit exceeded. Only the first 250 candidate diagnostics are shown; search all captured nodes or narrow the region to inspect more candidates.');
  assert.match(renderMessage('ko', limit), /250/);
  assert.doesNotMatch(renderMessage('ko', limit), /Spatial/);
});

test('both catalogs have identical keys and interpolation fields', () => {
  assert.deepEqual(Object.keys(catalogs.ko).sort(), Object.keys(catalogs.en).sort());
  for (const key of Object.keys(catalogs.en) as MessageKey[]) {
    const fields = (value: string) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(fields(catalogs.ko[key]), fields(catalogs.en[key]), key);
    assert.ok(catalogs.ko[key].trim());
  }
});

test('queued UI notices retranslate without translating user content or raw diagnostics', () => {
  const saved = message('Annotation saved. Match source nodes, then review it.');
  assert.equal(renderMessage('en', saved), 'Annotation saved. Match source nodes, then review it.');
  assert.equal(renderMessage('ko', saved), '주석을 저장했습니다. 원본 노드를 연결한 뒤 검토하세요.');
  assert.equal(translate('ko', 'Merge {name}', { name: '고객 & Billing' }), '고객 & Billing 병합');
  const raw = { raw: 'Original diagnostic: sample-node has no PNG. 원문' };
  assert.equal(renderMessage('ko', raw), raw.raw);
  assert.equal(renderMessage('en', raw), raw.raw);
  assert.equal(renderMessage('ko', { parts: [raw, message('Refresh the workspace before saving again.')] }), raw.raw + ' 다시 저장하기 전에 작업 공간을 새로고침하세요.');
});

test('focused-part continuation and source-file image coverage are explained in Korean', () => {
  const reason = 'The saved reading position was released to read a chosen part. Saved evidence remains available; continuing the broader import rechecks its source.';
  const translated = renderMessage('ko', errorMessage(new ApiError('CURSOR_RELEASED_FOR_PART', reason, 409)));
  assert.match(translated, /선택한 부분/);
  assert.match(translated, /전체 가져오기를 계속하면 원본을 다시 확인/);
  assert.doesNotMatch(translated, /saved reading position/i);
  assert.equal(renderMessage('en', systemMessage(reason)), reason);
  const coverage = 'An included overview image keeps its full area, including design outside a prepared part.';
  assert.match(translate('ko', coverage), /원래 범위 전체/);
  assert.match(translate('ko', coverage), /부분 밖의 디자인/);
});
