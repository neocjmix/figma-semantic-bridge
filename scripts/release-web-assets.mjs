import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function releaseWebAssets(directory) {
  for (const part of [directory, join(directory, 'assets')]) {
    const info = await lstat(part);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Web asset directories must not be symbolic links.');
  }
  const index = join(directory, 'index.html');
  if (!(await lstat(index)).isFile() || (await lstat(index)).isSymbolicLink()) throw new Error('Web index must be a regular file.');
  const html = await readFile(index, 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  if (references.length === 0 || references.some(path => !/^\/assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(path))) throw new Error('Unexpected web entrypoint asset reference.');
  const names = ['index.html', ...new Set(references.map(path => path.slice(1)))];
  if (!names.some(path => path.endsWith('.js')) || !names.some(path => path.endsWith('.css'))) throw new Error('Web entrypoint requires compiled JavaScript and CSS.');
  for (const name of names) {
    const info = await lstat(join(directory, name));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Web assets must be regular files.');
  }
  return names;
}
