import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.js';
import {RecallSession,decay,explicitDate} from '../src/living-memory.js';
import {Codex} from '../src/codex.js';
const scope='qq:99:private:10',group='qq:99:group:20';
function fixture(t){const s=new Store(':memory:');t.after(()=>s.close());return s;}
function automatic(s,text,key,value,options={}){const sourceId=s.add(scope,'user',text,'received',JSON.stringify({id:'10',name:'测试'}));return s.remember(scope,key,value,{authority:'auto',sourceId,evidence:text,...options});}

test('all indexed memories including entries older than the latest 500 remain retrievable',t=>{
  const s=fixture(t);s.remember(scope,'饮料偏好','桂花乌龙茶');for(let i=0;i<520;i++)s.remember(scope,'编号'+i,'无关记录'+i);
  assert.match(s.recall(scope,'我喜欢的乌龙茶',200),/桂花乌龙茶/);assert.equal(s.recall(scope,'午安呀',200),'');s.remember(scope,'核心:星球','海王星',{pinned:true});assert.equal(s.recall(scope,'午安呀',200),'');
});
test('independent source confirmations reinforce once; retrieval itself is not validation',t=>{
  const s=fixture(t),r=automatic(s,'我喜欢乌龙茶','饮料','乌龙茶');const m=s.memory(r.id);s.remember(scope,'饮料','乌龙茶',{sourceId:m.sourceId,evidence:'我喜欢乌龙茶',authority:'auto'});assert.equal(s.memory(r.id).confirmations,1);automatic(s,'我确实喜欢乌龙茶','饮料','乌龙茶');assert.equal(s.memory(r.id).confirmations,2);
  new RecallSession(s,{scope,members:['10'],query:'乌龙茶',preview:false}).prepare();assert.equal(s.memory(r.id).confirmations,2);assert.ok(s.memory(r.id).lastRecall);
});
test('conflicts wait for confirmation, explicit corrections keep source versions and invalidate summaries',t=>{
  const s=fixture(t),r=automatic(s,'我喜欢乌龙茶','饮料','乌龙茶');s.saveSummary(scope,1,'喜欢乌龙茶');const pending=automatic(s,'我喜欢白茶','饮料','白茶');assert.equal(pending.status,'pending');assert.equal(s.memory(r.id).value,'乌龙茶');const v=s.living.versions(r.id).find(v=>v.status==='pending');s.living.resolve(r.id,v.id);assert.equal(s.memory(r.id).value,'白茶');assert.ok(s.living.versions(r.id).some(v=>v.value==='乌龙茶'&&v.status==='superseded'));assert.equal(s.summary(scope).text,'');
  const second=automatic(s,'更正：饮料改成红茶','饮料','红茶',{correction:true});assert.equal(second.status,'pending','manual resolution protects the current fact');
  const x=automatic(s,'我的城市是苏州','城市','苏州');automatic(s,'更正：城市改成杭州','城市','杭州',{correction:true});assert.equal(s.memory(x.id).value,'杭州');
});
test('pinned and manual facts resist automatic changes, including attempts to rename another owner',t=>{
  const s=fixture(t),m=s.remember(scope,'城市','杭州',{pinned:true});assert.equal(automatic(s,'更正城市改成上海','城市','上海',{correction:true}).status,'pending');assert.equal(s.memory(m.id).pinned,1);const other=s.remember(group+':member:11','城市','北京');assert.equal(automatic(s,'城市改成北京','城市','北京',{correction:true,replacesId:other.id}),null);
  const sourceId=s.add(scope,'user','我喜欢红茶','received',JSON.stringify({id:'11'}));assert.equal(s.remember(scope,'饮料','红茶',{authority:'auto',sourceId,evidence:'我喜欢红茶'}),null);
});
test('forgetting removes versions and old inputs, prevents replay and does not reuse message IDs',t=>{
  const s=fixture(t),r=automatic(s,'我喜欢桂花乌龙茶','饮料','桂花乌龙茶');s.add(scope,'assistant','记住了，你喜欢桂花乌龙茶。');s.saveSummary(scope,2,'用户喜欢桂花乌龙茶');assert.equal(s.forget(scope,r.id),1);assert.equal(s.living.versions(r.id).length,0);assert.equal(s.history(scope,20).length,0);assert.equal(s.summary(scope).text,'');assert.equal(automatic(s,'我喜欢桂花乌龙茶','饮料','桂花乌龙茶'),null);assert.equal(s.living.episodes(scope,'乌龙茶').length,0);s.reset(scope);const fresh=s.add(scope,'user','今天聊天','received','10');assert.ok(fresh>2);assert.equal(s.history(scope,20).length,1);
  s.remember(scope,'饮料','桂花乌龙茶');assert.match(s.recall(scope,'乌龙茶',100),/乌龙茶/);
});
test('account, group and member filtering is applied before retrieval and tools reject extra scope arguments',async t=>{
  const s=fixture(t);s.remember(group+':member:10','饮料','红茶');s.remember(group+':member:11','饮料','白茶');s.remember('qq:98:group:20:member:10','饮料','秘密茶');s.remember(scope,'饮料','私聊茶');s.add(group,'user','之前约定喝白茶','received',JSON.stringify({id:'11'}));
  const r=new RecallSession(s,{scope:group,members:['10'],query:'以前喝什么茶',budget:500}).prepare();assert.match(r.memory,/红茶/);assert.doesNotMatch(r.memory,/白茶|私聊茶|秘密茶/);await assert.rejects(r.invoke({query:'茶',scope}),/查询无效/);await assert.rejects(r.invoke({query:'茶'}),/已使用/);
});
test('memory, summary and episode tool share one hard character budget and eight-item limit',async t=>{
  const s=fixture(t);for(let i=0;i<12;i++)s.remember(scope,'红茶'+i,'喜欢红茶'.repeat(10));s.saveSummary(scope,1,'喜欢红茶。'.repeat(60));s.add(scope,'user','以前约定喝红茶。'.repeat(80),'received','10');
  const r=new RecallSession(s,{scope,members:['10'],query:'以前红茶',budget:260}).prepare();assert.ok(r.memory.length+r.summary.length<=260);const initial=r.used;const result=await r.invoke({query:'红茶'});assert.ok(result.chars<=260);assert.ok(r.used>=initial);assert.ok(r.entries.length<=8);await assert.rejects(r.invoke({query:'红茶'}),/已使用/);
});
test('FTS failure degrades to indexed lexical retrieval and maintenance stays local',t=>{
  const s=fixture(t);s.remember(scope,'偏好','桂花乌龙茶');s.db.exec('DROP TABLE memory_fts');assert.match(s.recall(scope,'乌龙茶',100),/乌龙茶/);assert.doesNotThrow(()=>s.living.maintain());assert.equal(s.living.fts,false);s.remember(scope,'城市','杭州');assert.match(s.recall(scope,'杭州',100),/杭州/);
});
test('decay uses real confirmation age, keeps pinned records and validates literal calendar dates',()=>{
  const now=Date.parse('2026-11-02T00:00:00Z'),old={type:'event',confirmedAt:'2026-08-04 00:00:00',confirmations:1};assert.ok(decay(old,now)<.2);assert.ok(decay({...old,confirmations:8},now)>decay(old,now));assert.equal(decay({...old,pinned:1},now),1);assert.equal(decay({...old,type:'commitment'},now),1);assert.equal(explicitDate('约定2026年11月12日见'),'2026-11-12');assert.equal(explicitDate('2026-02-30'),null);assert.equal(explicitDate('明年三月'),null);
});
test('legacy expiry survives transactional migration and index watermark resumes after restart',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-memory-')),file=path.join(dir,'db.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let db=new DatabaseSync(file);db.exec("CREATE TABLE memories(id INTEGER PRIMARY KEY,scope TEXT,key TEXT,value TEXT,updated TEXT,expires INTEGER,pinned INTEGER,evidence TEXT,UNIQUE(scope,key));INSERT INTO memories VALUES(1,'qq:99:private:10','城市','苏州','2026-01-01',1,0,'本机手动修正')");db.close();let s=new Store(file);assert.equal(s.memories(scope).length,0);assert.equal(s.memory(1).expires,1);assert.equal(s.memory(1).authority,'manual');for(let i=0;i<7;i++)s.add(scope,'user','老约定'+i,'received','10');assert.equal(s.living.maintain(3).watermark,3);s.close();s=new Store(file);assert.equal(s.living.maintain(3).watermark,6);s.remember(scope,'城市','杭州');assert.equal(s.memory(1).expires,null);s.close();
});
test('read-only recall tool works without web permission and enforces cancellation',async t=>{
  const s=fixture(t),c=new Codex({}),answers=[];s.add(scope,'user','以前约定周六看电影','received','10');const controller=new AbortController(),session=new RecallSession(s,{scope,members:['10'],query:'今天',signal:controller.signal}).prepare();c.send=v=>answers.push(v);c.jobs.set('test',{recallSession:session,signal:controller.signal,searchAllowed:false});c.onMessage({id:1,method:'item/tool/call',params:{thread_id:'test',tool:'qq_memory_recall',arguments:JSON.stringify({query:'电影'})}});await new Promise(r=>setImmediate(r));assert.equal(answers[0].result.success,true);assert.match(answers[0].result.contentItems[0].text,/周六看电影/);controller.abort();c.onMessage({id:2,method:'item/tool/call',params:{threadId:'test',tool:'qq_memory_recall',arguments:{query:'电影'}}});await new Promise(r=>setImmediate(r));assert.equal(answers[1].result.success,false);
});
test('preview never changes confirmation or recall counters; credentials cannot be persisted',t=>{
  const s=fixture(t),r=s.remember(scope,'偏好','喜欢红茶');new RecallSession(s,{scope,members:['10'],query:'红茶',preview:true}).prepare();assert.equal(s.memory(r.id).lastRecall,null);assert.equal(s.memory(r.id).confirmations,1);assert.equal(s.remember(scope,'API密钥','api_key=example-secret-value'),null);
});

test('local maintenance merges only exact canonical duplicates and keeps auditable versions',t=>{
  const s=fixture(t);s.remember(scope,'Tea','乌龙茶');s.remember(scope,'Ｔｅａ','乌龙茶',{pinned:true});s.remember(scope,'家乡','杭州');s.remember(scope,'城市','杭州');const r=s.living.maintain();assert.equal(r.merged,1);const remaining=s.memoryPage(scope);assert.equal(remaining.length,3);const tea=remaining.find(m=>m.value==='乌龙茶');assert.equal(tea.pinned,1);assert.ok(s.living.versions(tea.id).some(v=>v.status==='superseded'));assert.equal(remaining.filter(m=>m.value==='杭州').length,2,'equal values with distinct keys are not assumed equivalent');
});
test('summary repeats and the current message are not injected as extra historical evidence',t=>{
  const s=fixture(t);s.remember(scope,'饮料','桂花乌龙茶');s.saveSummary(scope,1,'用户喜欢桂花乌龙茶。');s.add(scope,'user','上次联调成功了','received','10');const current=s.add(scope,'user','还记得我喜欢桂花乌龙茶吗？','received','10');const r=new RecallSession(s,{scope,members:['10'],query:'还记得我喜欢桂花乌龙茶吗？',before:current}).prepare();assert.equal(r.summary,'');assert.equal(r.entries.filter(e=>e.kind==='episode').length,0);assert.equal(r.used,r.memory.length);
});
