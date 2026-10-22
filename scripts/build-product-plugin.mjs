import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','plugins/semantic-bridge/tsconfig.json'],{stdio:'inherit'});

const ui=await build({entryPoints:['plugins/semantic-bridge/ui.ts'],bundle:true,write:false,
  format:'iife',platform:'browser',target:'es2020'});
const script=ui.outputFiles[0].text.replaceAll('</script','<\\/script');
const template=await readFile('plugins/semantic-bridge/ui.template.html','utf8');
const html=template.replace('<!-- BRIDGE_SCRIPT -->',`<script>${script}</script>`);
await build({entryPoints:['plugins/semantic-bridge/code.ts'],outfile:'plugins/semantic-bridge/code.js',
  bundle:true,format:'iife',platform:'browser',target:'es2018',define:{__html__:JSON.stringify(html)}});
process.stdout.write('Built Figma Desktop semantic bridge development plugin.\n');
