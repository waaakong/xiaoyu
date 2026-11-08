import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
import {startGui} from '../src/gui.js';

test('scheduled API is authenticated, off by default and source-key idempotent',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-scheduled-api-')),store=new Store(':memory:');let config={platform:'qq',dataDir:dir,allowedUsers:['10'],allowedGroups:[],admins:[],wakeWords:['小鱼'],historyMessages:8,memoryChars:500,defaults:{scheduledTasks:{enabled:false,creators:[]},personaId:'default',voiceMode:'off'},chats:{}};
  const runtime=new Runtime({store,dataDir:dir,configLoader:()=>config,configWriter:c=>config=c});store.meta('fixed-memory-owner','10');store.meta('lastAccount','99');runtime.accountId='99';
  // A transport exists, but the fake recorder must never be called during configuration.
  runtime.bridge={cancel(){},stop:async()=>{},queues:new Map(),intakes:new Map()};
  const gui=await startGui({open:false,autoConnect:false,runtime});t.after(async()=>{await gui.close();fs.rmSync(dir,{recursive:true,force:true});});
  const headers={'X-Session-Token':gui.token,'Content-Type':'application/json',Origin:gui.origin},post=(route,body)=>fetch(gui.origin+'/api/scheduled-tasks/'+route,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await fetch(gui.origin+'/api/scheduled-tasks')).status,403);
  assert.equal((await fetch(gui.origin+'/scheduled-ui.js')).status,200);
  assert.equal((await(await fetch(gui.origin+'/api/scheduled-tasks',{headers})).json()).settings.enabled,false);
  assert.equal((await post('settings',{enabled:'yes'})).status,400);assert.equal((await post('settings',{enabled:true})).status,200);
  const scope='qq:99:private:10';assert.equal((await post('chat',{scope,policy:{enabled:true,creators:[]}})).status,200);
  assert.equal((await post('create',{scope,creator:'10',request:'5分钟后提醒我喝水'})).status,400);
  const body={scope,creator:'10',request:'5分钟后提醒我喝水',confirm:true,requestId:'12345678-1234-1234-1234-123456789012'},a=await post('create',body);assert.equal(a.status,200);const job=await a.json();assert.equal(job.status,'pending');
  const b=await post('create',body);assert.equal(b.status,200);assert.equal((await b.json()).id,job.id);assert.equal(runtime.tasks.list().length,1);
  assert.equal((await post('create',{...body,requestId:undefined,creator:'11'})).status,400);
  assert.equal((await post('chat',{scope:'wechat:wxid_role:private:wxid_other',policy:{enabled:true,creators:[]}})).status,400);
  assert.equal((await post('cancel',{id:job.id})).status,200);assert.equal(runtime.tasks.get(job.id).status,'cancelled');
  const foreign=await fetch(gui.origin+'/api/scheduled-tasks/settings',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{"enabled":true}'});assert.equal(foreign.status,403);
});
