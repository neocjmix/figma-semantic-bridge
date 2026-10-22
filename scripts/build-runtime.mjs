import { build } from 'esbuild';
await build({
  entryPoints: { server: 'src/server/cli.ts', mcp: 'src/mcp/cli.ts' },
  outdir: 'dist', outExtension: { '.js': '.mjs' },
  platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external',
  sourcemap: true,
});
console.log('Built local server and MCP stdio entrypoints.');
