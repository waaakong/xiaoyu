import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {writeZip} from '../src/meme-zip.js';
import {BundledProtocols} from '../src/bundled-protocols.js';
import {ServiceManager} from '../src/service-manager.js';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,{enabled=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xy-bundled-')),resources=path.join(root,'resources'),archiveDir=path.join(resources,'protocols'),data=path.join(root,'data');
  fs.mkdirSync(archiveDir,{recursive:true});
  const archives=[];
  const add=(id,target,version,files)=>{
    const file=id+'-'+version+'.zip',bytes=writeZip(Object.entries(files));
    fs.writeFileSync(path.join(archiveDir,file),bytes);
    archives.push({id,file,target,version,bytes:bytes.length,sha256:digest(bytes)});
  };
  add('snowluma','SnowLuma','2.4.2',{'index.mjs':'snow','node.exe':'node','EULA.md':'eula','client/app.js':'app'});
  add('napcat','NapCat','4.18.42',{'napcat.bat':'bat','index.js':'nap','node.exe':'node','napcat/core.js':'core'});
  fs.writeFileSync(path.join(archiveDir,'manifest.json'),JSON.stringify({format:1,archives}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,resources,archiveDir,data,archives};
}
test('bundled protocols extract once, verify SHA-256 and expose both directories',async t=>{
  const f=fixture(t),installer=new BundledProtocols(f.data,{projectRoot:f.root,resourcesPath:f.resources,enabled:true,log:()=>{}});
  const state=await installer.ensure();
  assert.equal(state.state,'ready');
  assert.deepEqual(state.archives.map(a=>a.state),['ready','ready']);
  assert.equal(fs.readFileSync(path.join(f.data,'protocols','SnowLuma','index.mjs'),'utf8'),'snow');
  assert.equal(fs.readFileSync(path.join(f.data,'protocols','NapCat','napcat','core.js'),'utf8'),'core');
  assert.ok(fs.existsSync(path.join(f.data,'protocols','NapCat','.xiaoyu-bundled.json')));
  const before=fs.statSync(path.join(f.data,'protocols','SnowLuma','index.mjs')).mtimeMs;
  await installer.ensure();
  assert.equal(fs.statSync(path.join(f.data,'protocols','SnowLuma','index.mjs')).mtimeMs,before);
  assert.deepEqual(installer.paths(),{snowluma:path.join(f.data,'protocols','SnowLuma'),napcat:path.join(f.data,'protocols','NapCat')});
});
test('existing extracted directory is preserved instead of overwritten',async t=>{
  const f=fixture(t),target=path.join(f.data,'protocols','SnowLuma');fs.mkdirSync(target,{recursive:true});
  for(const file of ['index.mjs','node.exe','EULA.md'])fs.writeFileSync(path.join(target,file),'manual');
  const installer=new BundledProtocols(f.data,{projectRoot:f.root,resourcesPath:f.resources,enabled:true,log:()=>{}});
  assert.equal((await installer.ensure()).state,'ready');
  assert.equal(fs.readFileSync(path.join(target,'index.mjs'),'utf8'),'manual');
});
test('checksum mismatch fails closed without creating a usable protocol directory',async t=>{
  const f=fixture(t);const manifest=JSON.parse(fs.readFileSync(path.join(f.archiveDir,'manifest.json'),'utf8'));manifest.archives[0].sha256='0'.repeat(64);fs.writeFileSync(path.join(f.archiveDir,'manifest.json'),JSON.stringify(manifest));
  const installer=new BundledProtocols(f.data,{projectRoot:f.root,resourcesPath:f.resources,enabled:true,log:()=>{}});
  const state=await installer.ensure();
  assert.equal(state.state,'failed');
  assert.equal(state.archives.find(a=>a.id==='snowluma').state,'failed');
  assert.equal(state.archives.find(a=>a.id==='napcat').state,'ready');
  assert.equal(fs.existsSync(path.join(f.data,'protocols','SnowLuma')),false);
});
test('source mode reports that archives are not auto-extracted',async t=>{
  const f=fixture(t),installer=new BundledProtocols(f.data,{projectRoot:f.root,resourcesPath:null,enabled:false});
  assert.equal((await installer.ensure()).state,'source');
  assert.equal(installer.paths().snowluma,'');
});
test('service manager detects and launches the bundled NapCat Shell layout',async t=>{
  const f=fixture(t),installer=new BundledProtocols(f.data,{projectRoot:f.root,resourcesPath:f.resources,enabled:true,log:()=>{}});await installer.ensure();
  const manager=new ServiceManager(f.data,{projectRoot:f.root,fetcher:async()=>new Response(null,{status:404}),sleep:async()=>{}});
  assert.equal(manager.detect().suggested.napcatPath,path.join(f.data,'protocols','NapCat'));
  manager.save({enabled:true,protocol:'napcat',snowlumaPath:'',napcatPath:'',napcatPort:6099,astrbot:false});
  assert.equal(manager.config().napcatPath,path.join(f.data,'protocols','NapCat'));
  t.after(async()=>{await manager.close();});
});
