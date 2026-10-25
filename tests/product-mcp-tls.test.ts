import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdtemp,rm,chmod,rename,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDesktopTls } from '../src/server/desktop-tls.js';
import { BridgeApi,BridgeApiError } from '../src/mcp/api-client.js';
import { readLocalCertificate } from '../src/mcp/local-pin.js';

const token='synthetic-mcp-private-token-'.repeat(2);
async function identity(t:test.TestContext) {
  const dir=await mkdtemp(join(tmpdir(),'fsb-mcp-tls-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return {dir,...await ensureDesktopTls(dir)};
}
test('MCP refuses unverified HTTP by default and requires a local HTTPS pin',()=>{
  assert.throws(()=>new BridgeApi('http://127.0.0.1:4177',token),/opt-in/);
  assert.throws(()=>new BridgeApi('https://127.0.0.1:4178',token),/pin/);
  assert.throws(()=>new BridgeApi('https://localhost:4178',token),/loopback/);
});
test('MCP authenticates each TLS connection and rejects a listener replaced after a valid request',async t=>{
  const first=await identity(t),second=await identity(t);let validHeaders=0,impostorRequests=0;
  const server=createServer(first,(req,res)=>{assert.equal(req.headers.authorization,`Bearer ${token}`);validHeaders++;res.end(JSON.stringify({ok:true}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port;
  const api=new BridgeApi(`https://127.0.0.1:${port}`,token,{certificate:await readLocalCertificate(first.dir)});
  assert.deepEqual(await api.request('/api/health'),{ok:true});assert.equal(validHeaders,1);
  await new Promise<void>(r=>server.close(()=>r()));
  const rogue=createServer(second,(_req,res)=>{impostorRequests++;res.end('{}');});
  await new Promise<void>(r=>rogue.listen(port,'127.0.0.1',r));
  t.after(()=>new Promise<void>(r=>rogue.close(()=>r())));
  await assert.rejects(api.request('/api/health'),(e:unknown)=>e instanceof BridgeApiError&&e.code==='BRIDGE_UNAVAILABLE');
  assert.equal(impostorRequests,0,'No bearer header or body reaches an unverified replacement.');
});
test('MCP pinned transport does not follow redirects and bounds responses',async t=>{
  const id=await identity(t);let forwarded=false;
  const server=createServer(id,(req,res)=>{
    if(req.url==='/api/redirect'){res.writeHead(302,{location:'/api/forwarded'});res.end();}
    else if(req.url==='/api/large'){res.end(' '.repeat(16_000_001));}
    else{forwarded=true;res.end('{}');}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const api=new BridgeApi(`https://127.0.0.1:${(server.address() as {port:number}).port}`,token,{certificate:id.pinDER});
  await assert.rejects(api.request('/api/redirect'),(e:unknown)=>e instanceof BridgeApiError&&e.code==='INVALID_RESPONSE');
  assert.equal(forwarded,false);
  await assert.rejects(api.request('/api/large'),(e:unknown)=>e instanceof BridgeApiError&&e.code==='RESPONSE_TOO_LARGE');
});
test('MCP pinned transport rejects non-success JSON of any shape without throwing outside the request',async t=>{
  const id=await identity(t);
  const cases: Array<{body:unknown;code:string;message:string}> = [
    ...[null,'failure',false,503,[],{}, {error:null},{error:'failure'},{error:[]},{error:{code:42,message:{text:'failure'}}}]
      .map(body=>({body,code:'BRIDGE_ERROR',message:'Bridge request failed (503).'})),
    {body:{error:{code:'BUSY',message:'Try again later.'}},code:'BUSY',message:'Try again later.'},
    {body:{error:{code:'BUSY',message:false}},code:'BUSY',message:'Bridge request failed (503).'},
    {body:{error:{code:null,message:'Try again later.'}},code:'BRIDGE_ERROR',message:'Try again later.'},
  ];
  const server=createServer(id,(req,res)=>{
    const index=Number(req.url?.split('/').at(-1));
    res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify(cases[index]?.body));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const api=new BridgeApi(`https://127.0.0.1:${(server.address() as {port:number}).port}`,token,{certificate:id.pinDER});
  for(const [index,expected] of cases.entries()) {
    await assert.rejects(api.request(`/api/failure/${index}`,undefined,AbortSignal.timeout(2000)),
      (error:unknown)=>error instanceof BridgeApiError&&error.code===expected.code&&error.message===expected.message,
      `Non-success response ${JSON.stringify(expected.body)} must reject with a typed bridge error.`);
  }
});
test('MCP certificate trust anchor rejects permissive and symlink files',async t=>{
  const id=await identity(t),path=join(id.dir,'desktop-tls','pin.der');
  assert.deepEqual(await readLocalCertificate(id.dir),id.pinDER);
  await chmod(path,0o644);await assert.rejects(readLocalCertificate(id.dir));await chmod(path,0o600);
  await rename(path,path+'.original');await symlink(path+'.original',path);await assert.rejects(readLocalCertificate(id.dir));
});
