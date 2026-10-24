import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, resolveLocale, translate, message, renderMessage, type MessageKey } from '../web/locale.js';

test('locale precedence validates native and stored choices, then follows the browser language', () => {
  assert.equal(resolveLocale({ desktopLocale: 'en', storedLocale: 'ko', language: 'ko-KR' }), 'en');
  assert.equal(resolveLocale({ desktopLocale: 'ko', storedLocale: 'en', language: 'en-US' }), 'ko');
  assert.equal(resolveLocale({ desktopLocale: 'fr', storedLocale: 'ko', language: 'en-US' }), 'ko');
  assert.equal(resolveLocale({ storedLocale: 'invalid', language: 'ko-KR' }), 'ko');
  assert.equal(resolveLocale({ language: 'fr-FR' }), 'en');
  assert.equal(resolveLocale({}), 'en');
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
  assert.equal(renderMessage('ko', { parts: [raw, message('Refresh the workspace before saving again.')] }), raw.raw + ' 다시 저장하기 전에 작업공간을 새로고침하세요.');
});
