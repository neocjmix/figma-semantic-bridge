import { resolve } from 'node:path';
import { startServer } from './index.js';
import { PRODUCT_VERSION, SERVICE_NAME } from '../shared/version.js';

const port=Number(process.env.FSB_PORT??4177);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('FSB_PORT must be a valid TCP port.');
const desktop=process.env.FSB_DESKTOP==='1';
const desktopTlsPort=Number(process.env.FSB_DESKTOP_TLS_PORT??4178);
if(!Number.isInteger(desktopTlsPort)||desktopTlsPort<1||desktopTlsPort>65535)throw new Error('FSB_DESKTOP_TLS_PORT must be a valid TCP port.');
const server=await startServer({port,desktopTlsPort,...(process.env.FSB_DATA_DIR?{dataDir:resolve(process.env.FSB_DATA_DIR)}:{}),...(process.env.FSB_TOKEN?{token:process.env.FSB_TOKEN}:{}),...(process.env.FSB_WEB_DIR?{webDir:resolve(process.env.FSB_WEB_DIR)}:{})});
if(desktop)process.stdout.write(JSON.stringify({event:'ready',service:SERVICE_NAME,version:PRODUCT_VERSION,url:server.desktopUrl})+'\n');
else process.stdout.write(`Figma Semantic Bridge ${PRODUCT_VERSION}: ${server.url}\nPairing token (local secret): ${server.token}\nPaste this token into the web app and Figma plugin. Keep this terminal private.\n`);
let closing=false;
const close=async()=>{if(closing)return;closing=true;await server.close();process.exit(0);};
process.on('SIGINT',()=>{void close();});process.on('SIGTERM',()=>{void close();});
