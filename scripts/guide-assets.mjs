import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Explicit end-user documentation only; never copy a docs directory wholesale.
export const guideDocumentNames = ['user-guide.ko.md', 'user-guide.en.md', 'alpha-installation.md', 'alpha-installation.en.md',
  'acquisition-workflow.ko.md', 'acquisition-workflow.en.md', 'upgrade-guide.md',
  'user-scenarios.ko.md', 'user-scenarios.en.md', 'local-diagnostics.md'];
// Explicit public synthetic screenshots only; never collect a directory of images.
export const guideImageNames = ['workflow.ko.png', 'workflow.en.png', 'source-review.ko.png', 'source-review.en.png'];
export function upgradeAppendix(markdown, locale) {
  const korean = markdown.indexOf('## 한국어\n'), english = markdown.indexOf('## English\n');
  if (korean < 0 || english <= korean || !['ko', 'en'].includes(locale)) throw new Error('Upgrade guide must contain Korean and English instructions.');
  const content = locale === 'ko' ? markdown.slice(korean + '## 한국어\n'.length, english) : markdown.slice(english + '## English\n'.length);
  return `\n\n---\n\n# ${locale === 'ko' ? '업데이트·백업·복원' : 'Update, backup and restore'}\n\n${content.trim()}\n`;
}
export function userAppendix(acquisition, scenarios, diagnostics, locale) {
  const korean = diagnostics.indexOf('## 한국어\n'), english = diagnostics.indexOf('## English\n');
  if (korean < 0 || english <= korean || !['ko', 'en'].includes(locale)) throw new Error('Diagnostics guide must contain Korean and English instructions.');
  const content = locale === 'ko' ? diagnostics.slice(korean + '## 한국어\n'.length, english) : diagnostics.slice(english + '## English\n'.length);
  return `\n\n---\n\n${acquisition.trim()}\n\n---\n\n${scenarios.trim()}\n\n---\n\n# ${locale === 'ko' ? '로컬 진단' : 'Local diagnostics'}\n\n${content.trim()}\n`;
}
export async function loadGuideImages(projectDir = '.') {
  const images = {};
  for (const name of guideImageNames) {
    const path = join(projectDir, 'docs/images', name);
    const info = await lstat(path);
    if (!info.isFile() || info.size > 1_000_000) throw new Error(`Invalid guide image: ${name}`);
    const bytes = await readFile(path);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) > 2048) throw new Error(`Invalid guide PNG: ${name}`);
    images[`images/${name}`] = `data:image/png;base64,${bytes.toString('base64')}`;
  }
  return images;
}
