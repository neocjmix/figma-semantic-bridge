import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { renderOfflineGuide } = await import(new URL('../scripts/render-offline-guide.mjs', import.meta.url).href) as {
  renderOfflineGuide(title: string, markdown: string, options?: { locale?: string; kind?: string; images?: Record<string, string> }): string;
};
const body = (markdown: string) => renderOfflineGuide('설치 <안내> & 도움말', markdown);

test('English user guide has matching document language and accessible chrome', () => {
  const html = renderOfflineGuide('User guide', '# Workflow\n\n- [ ] Review\n- [x] Capture', { locale: 'en', kind: 'user' });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Offline user guide/);
  assert.match(html, /aria-label="Incomplete"/);
  assert.match(html, /aria-label="Complete"/);
  assert.match(html, /Links are shown as reference text/);
  assert.doesNotMatch(html, /[가-힣]/);
});

test('guide locales and document kinds are bounded while source text stays verbatim', () => {
  const html = renderOfflineGuide('사용 가이드', '# Product label: 고객센터', { locale: 'ko', kind: 'user' });
  assert.match(html, /오프라인 사용 가이드/);
  assert.match(html, /Product label: 고객센터/);
  assert.throws(() => renderOfflineGuide('Guide', '# text', { locale: 'fr' }), /locale/);
  assert.throws(() => renderOfflineGuide('Guide', '# text', { locale: 'en', kind: '<script>' }), /kind/);
});

test('offline guide renders Korean headings, wrapped prose and inline emphasis without losing code', () => {
  const html = body('# 설치 안내\n\n첫 번째 줄의 **중요한\n안내**와 `npm ci`를 읽는다.\n\n## 다음 단계');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<title>설치 &lt;안내&gt; &amp; 도움말<\/title>/);
  assert.match(html, /<h1>설치 안내<\/h1>/);
  assert.match(html, /<p>첫 번째 줄의 <strong>중요한 안내<\/strong>와 <code>npm ci<\/code>를 읽는다\.<\/p>/);
  assert.match(html, /<h2>다음 단계<\/h2>/);
});

test('offline guide builds readable tables and preserves literal pipes inside cells', () => {
  const html = body('| 항목 | 값 |\n| --- | --- |\n| 기본 위치 | `~/bridge` |\n| 파이프 | `a|b` 또는 a\\|b |');
  assert.match(html, /<table>/);
  assert.match(html, /<thead><tr><th scope="col">항목<\/th><th scope="col">값<\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>~\/bridge<\/code><\/td>/);
  assert.match(html, /<td><code>a\|b<\/code> 또는 a\|b<\/td>/);
  assert.equal((html.match(/<td>/g) ?? []).length, 4);
});

test('offline guide preserves ordered steps, continuation text and nested lists', () => {
  const html = body('3. 앱을 연다.\n   이어지는 설명이다.\n   - 첫 번째 확인\n   - 두 번째 확인\n4. 저장한다.\n\n다음 문단.');
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<li><p>앱을 연다\. 이어지는 설명이다\.<\/p><ul><li><p>첫 번째 확인<\/p><\/li><li><p>두 번째 확인<\/p><\/li><\/ul><\/li>/);
  assert.match(html, /<li><p>저장한다\.<\/p><\/li><\/ol>\s*<p>다음 문단\.<\/p>/);
});

test('offline guide renders callouts and inert checklist states', () => {
  const html = body('> 첫 줄\n> 둘째 줄\n\n- [ ] 아직 확인 전\n  계속되는 안내\n- [x] 확인 완료');
  assert.match(html, /<blockquote><p>첫 줄 둘째 줄<\/p><\/blockquote>/);
  assert.match(html, /aria-label="미완료">☐<\/span>/);
  assert.match(html, /aria-label="완료">☑<\/span>/);
  assert.match(html, /아직 확인 전 계속되는 안내/);
  assert.doesNotMatch(html, /<input\b/i);
});

test('offline guide escapes fenced code verbatim and supports a longer containing fence', () => {
  const code = '```toml\ncommand = "<script>alert(1)</script>"\n```';
  const html = body('````text\n' + code + '\n````');
  assert.match(html, /<pre><code>```toml\ncommand = &quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;\n```<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('offline guide never turns raw HTML, links or images into executable or network content', () => {
  const html = renderOfflineGuide('</title><script>bad()</script>', '# 안전\n\n<script>bad()</script><img src="https://untrusted.invalid/pixel" onerror="bad()">\n\n[공식 문서](https://example.invalid/a?x=1&y=2) ![이미지](https://example.invalid/image.png) [위험](javascript:bad())\n\n<iframe src="file:///etc/passwd"></iframe>');
  assert.doesNotMatch(html, /<(?:script|img|iframe|a|link|base|form|input|object|embed)\b/i);
  assert.doesNotMatch(html, /\s(?:href|src|onerror|onclick)="/i);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /공식 문서/);
  assert.match(html, /https:\/\/example\.invalid\/a\?x=1&amp;y=2/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
});

test('offline guide embeds only explicitly supplied PNGs and keeps unknown images inert', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const markdown = '![A "safe" screenshot](images/workflow.en.png)\n\n![Remote](https://example.invalid/a.png)';
  const html = renderOfflineGuide('Guide', markdown, { images: { 'images/workflow.en.png': png } });
  assert.match(html, /<img class="guide-image" src="data:image\/png;base64,iVBORw0KGgo=" alt="A &quot;safe&quot; screenshot">/);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.match(html, /img-src data:/);
  for (const data of ['https://example.invalid/a.png', 'data:image/svg+xml,<svg/>', png + '" onerror="bad()', png + 'A'.repeat(1_400_000)]) {
    assert.throws(() => renderOfflineGuide('Guide', markdown, { images: { 'images/workflow.en.png': data } }), /bounded bundled PNG/);
  }
});

test('the shipped installation guide becomes structured, self-contained HTML', async () => {
  const markdown = await readFile(new URL('../docs/alpha-installation.md', import.meta.url), 'utf8');
  const html = renderOfflineGuide('Figma Semantic Bridge 설치 안내', markdown);
  assert.match(html, /<h2>1\. 환경과 배포 파일 확인<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<pre><code>\[mcp_servers\.figma_semantic_bridge\]/);
  assert.match(html, /@media/);
  assert.doesNotMatch(html, /<a\b|<script\b|<link\b|<img\b/i);
  assert.doesNotMatch(html, /<pre># 0\.1\.0/);
});


test('offline user guide includes troubleshooting and only the selected diagnostic language', async () => {
  const { userAppendix } = await import(new URL('../scripts/guide-assets.mjs', import.meta.url).href) as {
    userAppendix(acquisition: string, scenarios: string, diagnostics: string, locale: string): string;
  };
  const diagnostics = '# Local diagnostics\n\n## 한국어\n\n한국어 진단 절차\n\n## English\n\nEnglish diagnostic procedure\n';
  for (const locale of ['ko', 'en']) {
    const appendix = userAppendix('# Acquisition\n\nImport steps.', '# Recovery\n\nSaved drafts stay available.', diagnostics, locale);
    const html = renderOfflineGuide('User guide', '# Main workflow' + appendix, { locale, kind: 'user' });
    assert.match(html, /<h1>Acquisition<\/h1>/);
    assert.match(html, /<h1>Recovery<\/h1>/);
    assert.match(html, /Saved drafts stay available/);
    assert.ok(html.includes(locale === 'ko' ? '한국어 진단 절차' : 'English diagnostic procedure'));
    assert.ok(!html.includes(locale === 'ko' ? 'English diagnostic procedure' : '한국어 진단 절차'));
    const shipped = userAppendix(await readFile(`docs/acquisition-workflow.${locale}.md`, 'utf8'),
      await readFile(`docs/user-scenarios.${locale}.md`, 'utf8'), await readFile('docs/local-diagnostics.md', 'utf8'), locale);
    const rendered = renderOfflineGuide('User guide', await readFile(`docs/user-guide.${locale}.md`, 'utf8') + shipped, { locale, kind: 'user' });
    assert.match(rendered, /server\.ndjson/);
    assert.match(rendered, /native\.ndjson/);
    assert.match(rendered, /X-FSB-Request-Id/);
    assert.doesNotMatch(rendered, /<(?:script|iframe|a|link|object)\b/i);
    assert.ok(Buffer.byteLength(rendered) < 4_000_000);
  }
  assert.throws(() => userAppendix('', '', diagnostics, 'fr'), /Diagnostics guide/);
  assert.throws(() => userAppendix('', '', '## English\nOnly one language.', 'en'), /Diagnostics guide/);
});
