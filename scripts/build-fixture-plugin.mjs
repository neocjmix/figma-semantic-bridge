import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../plugins/fixture-analyzer/ui.html', import.meta.url), 'utf8');
await build({
  entryPoints: ['plugins/fixture-analyzer/code.ts'],
  outfile: 'plugins/fixture-analyzer/code.js',
  bundle: true,
  target: 'es2018',
  format: 'iife',
  platform: 'browser',
  define: { __html__: JSON.stringify(html) },
});
await build({
  entryPoints: ['plugins/fixture-analyzer/mcp.ts'],
  outfile: 'dist/fixture-analyzer.mcp.js',
  bundle: true,
  target: 'es2018',
  format: 'iife',
  globalName: 'FixtureAnalyzer',
  platform: 'browser',
});
process.stdout.write('Built development plugin and bounded MCP analyzer.\n');
