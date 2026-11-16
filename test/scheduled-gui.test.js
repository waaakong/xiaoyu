import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
import {startGui} from '../src/gui.js';
import {loadConfig,chatDefaults} from '../src/config.js';

test('scheduled API uses isolated local identity, validates account, revisions and blacklists without sending',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scheduled-gui-')),scope='qq:99:group:20',store=new Store(':memory:');
 const config={...loadConfig(),defaults:{...chatDefaults},chats:{[scope]:{enabled:true,scheduledTasks:{enabled:true,blacklist:[]}}},allowedUsers:[],allowedGroups:[]};
 store.meta('lastAccount','99');
 const runtime=new Runtime({store,dataDir:dir,configLoader:()=>config,configWriter:()=>{throw Error('no real config writes');}});
 const gui=await startGui({runtime,open:false,autoConnect:false}),headers={'X-Session-Token':gui.token,'Content-Type':'application/json'};
 const post=async(route,body)=>{const r=await fetch(gui.origin+'/api/scheduled-tasks/'+route,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  for(const file of ['scheduled-ui.js','scheduled-panel.js','scheduled-time.js'])assert.equal((await fetch(gui.origin+'/'+file)).status,200);
  assert.equal((await fetch(gui.origin+'/api/scheduled-tasks/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const schedule={kind:'fixed',repeat:'daily',time:'09:00',content:'早上好呀'};
  const preview=await post('preview',{scope,schedule});assert.equal(preview.status,200);assert.equal(preview.data.submitted,false);assert.equal(runtime.tasks.list().length,0);
  await post('settings',{enabled:true});
  const body={scope,schedule,confirm:true,confirmRepeat:true,requestId:randomUUID(),creator:'11'};
  const create=await post('create',body);assert.equal(create.status,200);assert.equal(create.data.creator,'local-scheduler');assert.equal(create.data.sourceId,null);assert.equal(create.data.status,'pending');
  assert.equal((await post('create',body)).data.id,create.data.id);
  assert.equal((await post('create',{...body,scope:'qq:98:group:20',requestId:randomUUID()})).status,400);
  assert.equal((await post('create',{...body,scope:'wechat:wxid_a:group:20',requestId:randomUUID()})).status,400);
  const edited=await post('edit',{id:create.data.id,revision:0,confirm:true,confirmRepeat:true,schedule:{...schedule,content:'晚上好',time:'20:00'}});assert.equal(edited.status,200);assert.equal(edited.data.revision,1);
  assert.equal((await post('edit',{id:create.data.id,revision:0,confirm:true,schedule})).status,400);
  assert.equal((await post('task-pause',{id:create.data.id,paused:true})).data.status,'paused');
  assert.equal((await post('task-pause',{id:create.data.id,paused:false})).data.status,'pending');
  await post('settings',{blockedChats:[scope]});
  assert.equal((await post('create',{...body,requestId:randomUUID()})).status,400);
  assert.equal(store.historyPage(scope).length,0);assert.equal(runtime.tasks.dashboard().runs.length,0);
 }finally{await gui.close();fs.rmSync(dir,{recursive:true,force:true});}
});
