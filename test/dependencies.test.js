import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DependencyCenter} from '../src/dependencies.js';
import {downloadVerified,runDependencyProcess} from '../src/dependency-io.js';
import {writeZip} from '../src/meme-zip.js';

function fixture(t,options={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'xy-deps-')),bytes=writeZip([['uv.exe',Buffer.from('offline fixture')]]),calls=[];let installed=false;
  const asset={version:'fixture',url:'https://github.com/astral-sh/uv/releases/download/fixture/uv.zip',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const center=new DependencyCenter(base,{platform:'win32',arch:'x64',uvAsset:asset,fetcher:async()=>new Response(bytes),getToken:()=>'private-gateway-token-never-log',runner:async(exe,args,opts={})=>{
    calls.push({exe,args,env:opts.env,quiet:opts.quiet});opts.signal?.throwIfAborted();
    if(exe==='powershell.exe')return '{}';
    if(args.includes('-c'))return JSON.stringify({python:'3.12.16',astrbot:installed?'4.29.4':null});
    if(args[0]==='python'&&args[1]==='install'){const dir=path.join(base,'runtimes','python','cpython-3.12.16-test');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'python.exe'),'fixture');}
    if(args[0]==='venv'){fs.mkdirSync(path.dirname(center.python),{recursive:true});fs.writeFileSync(center.python,'fixture');}
    if(args[0]==='pip'&&args[1]==='install')installed=true;
    if(args.some(a=>a.endsWith('prepare-astrbot.py'))){assert.equal(opts.quiet,true);assert.equal(opts.input,'private-gateway-token-never-log\n');fs.mkdirSync(path.join(center.bot,'data'),{recursive:true});fs.writeFileSync(path.join(center.bot,'data','cmd_config.json'),'{}');fs.writeFileSync(path.join(center.bot,'.astrbot'),'');}
    return 'ok';
  },...options});t.after(async()=>{await center.close();fs.rmSync(base,{recursive:true,force:true});});return {center,base,asset,bytes,calls,setInstalled:v=>installed=v};
}
test('verified downloads reject corruption and external redirects, and clean partial files',async t=>{const f=fixture(t),file=path.join(f.base,'download.zip');await assert.rejects(downloadVerified(f.asset,file,{fetcher:async()=>new Response('damaged')}),/校验/);assert.equal(fs.existsSync(file+'.part'),false);await assert.rejects(downloadVerified(f.asset,file,{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://example.com/untrusted'}})}),/未授权/);let count=0;await downloadVerified(f.asset,file,{fetcher:async()=>{count++;return new Response(f.bytes);}});await downloadVerified(f.asset,file,{fetcher:()=>{throw Error('must reuse verified cache');}});assert.equal(count,1);});
test('fresh preparation is isolated, has bounded official commands and keeps the gateway token out of logs',async t=>{const f=fixture(t);f.center.install({index:'aliyun'});assert.throws(()=>f.center.install(),/正在进行/);await f.center.work;assert.equal(f.center.state().job.state,'succeeded');assert.equal(f.center.state().items.find(i=>i.id==='astrbot').state,'ready');assert.ok(f.calls.some(c=>c.args.includes('--no-bin')&&c.args.includes('--no-registry')));const packageCall=f.calls.find(c=>c.args[0]==='pip');assert.ok(packageCall.args.includes('https://mirrors.aliyun.com/pypi/simple/'));assert.equal(packageCall.env.UV_PYTHON_INSTALL_DIR,path.join(f.base,'runtimes','python'));assert.doesNotMatch(JSON.stringify(f.center.state()),/private-gateway-token/);assert.equal(fs.existsSync(path.join(f.base,'dependencies','install.lock')),false);});
test('existing matching AstrBot configuration is retained without downloading or modifying packages',async t=>{const f=fixture(t,{canInstall:()=>false,fetcher:()=>{throw Error('unnecessary download');}});fs.mkdirSync(path.dirname(f.center.python),{recursive:true});fs.writeFileSync(f.center.python,'existing');fs.mkdirSync(path.join(f.center.bot,'data'),{recursive:true});const config=path.join(f.center.bot,'data','cmd_config.json');fs.writeFileSync(config,'{"keep":"user configuration"}');f.setInstalled(true);f.center.install();await f.center.work;assert.equal(f.center.state().job.state,'succeeded');assert.equal(fs.readFileSync(config,'utf8'),'{"keep":"user configuration"}');assert.ok(!f.calls.some(c=>c.args[0]==='pip'));});
test('failed install can be retried after releasing the lock',async t=>{let bad=true;const f=fixture(t,{fetcher:async()=>new Response(bad?'broken':f.bytes)});f.center.install();await f.center.work;assert.equal(f.center.state().job.state,'failed');bad=false;f.center.install();await f.center.work;assert.equal(f.center.state().job.state,'succeeded');});
test('cancellation aborts downloads, releases the job and allows a subsequent retry',async t=>{const f=fixture(t,{fetcher:(_u,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))});f.center.install();await new Promise(r=>setImmediate(r));f.center.cancel();await f.center.work;assert.equal(f.center.state().job.state,'cancelled');assert.equal(fs.existsSync(path.join(f.base,'dependencies','install.lock')),false);});
test('unsupported platforms, unknown indexes and live plugin environments cannot trigger package mutation',async t=>{const f=fixture(t,{platform:'linux'});assert.throws(()=>f.center.install(),/Windows/);const g=fixture(t,{canInstall:()=>false});assert.throws(()=>g.center.install({index:'arbitrary-url'}));g.center.install();await g.center.work;assert.equal(g.center.state().job.state,'failed');assert.ok(!g.calls.some(c=>c.args[0]==='pip'));});
test('process cancellation and timeout terminate only the owned installer process',async()=>{const controller=new AbortController(),work=runDependencyProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});const rejected=assert.rejects(work,/取消/);controller.abort();await rejected;await assert.rejects(runDependencyProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),/超时/);assert.match(await runDependencyProcess(process.execPath,['-e','console.log("ready")']),/ready/);});
