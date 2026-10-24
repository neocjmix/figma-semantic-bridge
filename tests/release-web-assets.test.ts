import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { releaseWebAssets } = await import(pathToFileURL(resolve('scripts/release-web-assets.mjs')).href) as { releaseWebAssets(directory: string): Promise<string[]> };

test('release web assembly includes only the entrypoint and referenced compiled assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsb-release-web-'));
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<script src="/assets/index-Ab123.js"></script><link href="/assets/index-Cd456.css">');
    await writeFile(join(dir, 'assets/index-Ab123.js'), 'export {}');
    await writeFile(join(dir, 'assets/index-Cd456.css'), 'body{}');
    await writeFile(join(dir, '.env.local'), 'not for distribution');
    await writeFile(join(dir, 'capture.json'), '{"private":true}');
    assert.deepEqual(await releaseWebAssets(dir), ['index.html', 'assets/index-Ab123.js', 'assets/index-Cd456.css']);
    await unlink(join(dir, 'assets/index-Ab123.js'));
    await symlink('../.env.local', join(dir, 'assets/index-Ab123.js'));
    await assert.rejects(releaseWebAssets(dir), /regular files/);
    await writeFile(join(dir, 'index.html'), '<script src="https://untrusted.invalid/app.js"></script>');
    await assert.rejects(releaseWebAssets(dir), /Unexpected web entrypoint/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
