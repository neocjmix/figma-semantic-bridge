import { resolve } from 'node:path';
import { startServer } from './index.js';

const port=Number(process.env.FSB_PORT??4177);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('FSB_PORT must be a valid TCP port.');
const server=await startServer({port,...(process.env.FSB_DATA_DIR?{dataDir:resolve(process.env.FSB_DATA_DIR)}:{}),...(process.env.FSB_TOKEN?{token:process.env.FSB_TOKEN}:{})});
process.stdout.write(`Figma Semantic Bridge: ${server.url}\nPairing token (local secret): ${server.token}\nPaste this token into the web app and development plugin. Keep this terminal private.\n`);
let closing=false;
const close=async()=>{if(closing)return;closing=true;await server.close();process.exit(0);};
process.on('SIGINT',()=>{void close();});process.on('SIGTERM',()=>{void close();});
