import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {RecallSession} from '../src/living-memory.js';
import {Bridge} from '../src/bridge.js';
import {OneBot} from '../src/onebot.js';
import {policyFor,chatDefaults} from '../src/config.js';
const privateScope='qq:99:private:10',group='qq:99:group:20',otherGroup='qq:99:group:30';
function fixture(t){const s=new Store(':memory:');t.after(()=>s.close());const config={allowedUsers:['10','11'],allowedGroups:['20','30'],admins:[],wakeWords:['小鱼'],followupSeconds:0,historyMessages:8,memoryChars:1600,defaults:{...chatDefaults,autoSummary:false,crossMemoryRead:true,crossMemoryWrite:true},chats:{}};const policy=scope=>policyFor(config,scope),ctx=(scope=group,owner='10')=>s.shared.context(scope,owner,policy);return {s,config,policy,ctx};}
function publish(f,{key='饮料偏好',value='桂花乌龙茶',targets=[group],includePrivate=true,allPersonas=false}={}){const m=f.s.remember(privateScope,key,value,{type:'preference'});return f.s.shared.publish({memoryId:m.id,targets,includePrivate,allPersonas},f.policy);}
function recall(f,scope=group,owner='10',query='喜欢喝什么茶',extra={}){return new RecallSession(f.s,{scope,members:[owner],query,policy:f.policy,...extra}).prepare();}

test('migration never shares existing facts and both read/export flags default off',t=>{
  const f=fixture(t);f.config.defaults.crossMemoryRead=false;f.config.defaults.crossMemoryWrite=false;const m=f.s.remember(privateScope,'偏好','乌龙茶');assert.equal(f.s.shared.list(privateScope).length,0);assert.equal(recall(f).sharedCount,0);assert.throws(()=>f.s.shared.publish({memoryId:m.id,targets:[group]},f.policy),/来源聊天/);f.config.defaults.crossMemoryWrite=true;assert.throws(()=>f.s.shared.publish({memoryId:m.id,targets:[group]},f.policy),/目标聊天/);
});
test('grants, QQ identity and role account all constrain candidates before prompt assembly',t=>{
  const f=fixture(t);publish(f);assert.match(recall(f).memory,/桂花乌龙茶/);assert.equal(recall(f,otherGroup).sharedCount,0);assert.equal(recall(f,group,'11').sharedCount,0);assert.equal(recall(f,'qq:98:group:20').sharedCount,0);assert.equal(recall(f,group,'10','午安').sharedCount,0);assert.throws(()=>publish(f,{targets:['qq:99:private:11']}),/其他人/);
});
test('private-only facts do not surface in groups; group source can return only its owner to private',t=>{
  const f=fixture(t);publish(f,{targets:[]});assert.equal(recall(f).sharedCount,0);const id=f.s.remember(group+':member:10','称呼','阿K').id;f.s.shared.publish({memoryId:id,targets:[],includePrivate:true},f.policy);assert.match(recall(f,privateScope,'10','称呼').memory,/阿K/);assert.equal(recall(f,'qq:99:private:11','11','称呼').sharedCount,0);
});
test('source/target authorization and persona revocation invalidate in-flight references',t=>{
  const f=fixture(t);publish(f);const r=recall(f);f.config.chats[privateScope]={crossMemoryWrite:false};assert.throws(()=>r.assertFresh(),/权限或版本/);assert.equal(recall(f).sharedCount,0);f.config.chats[privateScope]={};f.config.chats[group]={enabled:false};assert.equal(recall(f).sharedCount,0);f.config.chats[group]={personaId:'another'};assert.equal(recall(f).sharedCount,0);
});
test('all-persona use is an explicit grant and current persona changes still stop pending delivery',t=>{
  const f=fixture(t);publish(f,{allPersonas:true});f.config.chats[group]={personaId:'another'};const r=recall(f);assert.equal(r.sharedCount,1);f.config.chats[group]={personaId:'third'};assert.throws(()=>r.assertFresh(),/权限或版本/);
});
test('local scoped facts override general shared facts and shared retrieval obeys both budgets',t=>{
  const f=fixture(t);publish(f,{key:'称呼',value:'小王'});f.s.remember(group+':member:10','本群称呼','阿K');const r=recall(f,group,'10','称呼');assert.match(r.memory,/阿K/);assert.doesNotMatch(r.memory,/小王/);for(let i=0;i<8;i++)publish(f,{key:'饮料'+i,value:'喝红茶'.repeat(35)});const b=recall(f,group,'10','喝红茶',{budget:230});assert.ok(b.sharedChars<=230);assert.ok(b.sharedChars<=400);assert.ok(b.sharedCount<=3);assert.ok(b.used<=230);assert.ok(b.entries.length<=8);
});
test('corrections update one canonical fact, preserve versions and invalidate old replies',t=>{
  const f=fixture(t),fact=publish(f),r=recall(f);const row=f.s.add(group,'assistant','你喜欢桂花乌龙茶');f.s.shared.tagMessage(row,r.references());f.s.remember(privateScope,'饮料偏好','红茶',{type:'preference'});assert.equal(f.s.shared.describe(fact.id).value,'红茶');assert.ok(f.s.living.versions(fact.memoryId).some(v=>v.status==='superseded'));assert.throws(()=>r.assertFresh(),/权限或版本/);assert.equal(f.s.shared.messageAllowed(row,f.ctx()),false);assert.match(recall(f,group,'10','饮料').memory,/红茶/);
});
test('stop, hide-here, source forgetting and expiry have distinct effects',t=>{
  const f=fixture(t),fact=publish(f,{targets:[group,otherGroup]});f.s.shared.hide(fact.id,group,f.ctx());assert.equal(recall(f).sharedCount,0);assert.equal(recall(f,otherGroup).sharedCount,1);f.s.shared.unhide(fact.id,group);assert.equal(recall(f).sharedCount,1);f.s.shared.stop(fact.id,f.ctx());assert.equal(recall(f,otherGroup).sharedCount,0);assert.ok(f.s.memory(fact.memoryId));f.s.shared.publish({memoryId:fact.memoryId,targets:[group]},f.policy);f.s.db.prepare('UPDATE memories SET expires=1 WHERE id=?').run(fact.memoryId);assert.equal(recall(f).sharedCount,0);f.s.db.prepare('UPDATE memories SET expires=NULL WHERE id=?').run(fact.memoryId);f.s.forget(privateScope,fact.memoryId);assert.equal(recall(f).sharedCount,0);assert.equal(f.s.shared.describe(fact.id).active,0);
});
test('deleted memory IDs cannot later reconnect an old grant to another owner',t=>{
  const f=fixture(t),fact=publish(f);f.s.shared.forget(fact.id,f.ctx());const m=f.s.remember('qq:99:private:11','饮料偏好','别人的白茶');assert.ok(m.id>fact.memoryId);assert.equal(f.s.shared.describe(fact.id).key,null);assert.equal(recall(f).sharedCount,0);
});
test('remote owner commands cannot publish to groups, edit other people or revive stopped sharing',t=>{
  const f=fixture(t),ctx=f.ctx(privateScope);const fact=f.s.shared.upsertOwn({key:'联调代号',value:'清风'},ctx);assert.deepEqual(fact.targets,[privateScope]);f.s.shared.upsertOwn({key:'联调代号',value:'竹影'},f.ctx());assert.equal(f.s.shared.describe(fact.id).value,'竹影');assert.throws(()=>f.s.shared.stop(fact.id,f.ctx(group,'11')),/属于你/);f.s.shared.stop(fact.id,ctx);assert.throws(()=>f.s.shared.upsertOwn({key:'联调代号',value:'清风'},ctx),/已停止/);
});
test('fixed or operator-maintained facts cannot be overridden by a remote shared write',t=>{
  const f=fixture(t),fact=publish(f);assert.throws(()=>f.s.shared.upsertOwn({key:'饮料偏好',value:'咖啡'},f.ctx()),/本机维护/);assert.equal(f.s.shared.describe(fact.id).value,'桂花乌龙茶');
});
test('shared replies never become untracked archive snippets or summaries',t=>{
  const f=fixture(t);publish(f);const r=recall(f),row=f.s.add(group,'assistant','桂花乌龙茶');f.s.shared.tagMessage(row,r.references());assert.equal(f.s.summaryRows(group,row).length,0);assert.equal(f.s.living.episodes(group,'桂花乌龙茶',{members:['10','AI']}).length,0);f.s.shared.stop(r.references()[0].factId);assert.equal(f.s.shared.messageAllowed(row,f.ctx()),false);
});
test('shared query tools retain trusted scope and a stopped grant cancels a real queued reply',async t=>{
  const f=fixture(t),fact=publish(f);let release,entered;const ready=new Promise(r=>entered=r),pending=new Promise(r=>release=r),sent=[];const bridge=new Bridge({config:f.config,store:f.s,codex:{chat:async p=>{assert.match(p.memory,/桂花乌龙茶/);entered();await pending;return {reply:'你喜欢桂花乌龙茶',memories:[]};}},onebot:{reply:async(e,text)=>{sent.push(text);return [];}},persona:'角色',log:()=>{}});t.after(()=>bridge.stop());await bridge.handle({post_type:'message',message_type:'group',self_id:99,group_id:20,user_id:10,message_id:1,message:[{type:'at',data:{qq:99}},{type:'text',data:{text:'喜欢喝什么茶'}}]});await ready;f.s.shared.stop(fact.id);release();await Promise.all([...bridge.queues.values()].map(q=>q.chain));assert.deepEqual(sent,[]);
});
test('shared grants persist across restart without expanding target scope',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-shared-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let s=new Store(path.join(dir,'db.sqlite'));const config={allowedUsers:['10'],allowedGroups:['20'],defaults:{crossMemoryRead:true,crossMemoryWrite:true},chats:{}},policy=scope=>policyFor(config,scope);const m=s.remember(privateScope,'称呼','阿K');s.shared.publish({memoryId:m.id,targets:[group]},policy);s.close();s=new Store(path.join(dir,'db.sqlite'));const ctx=s.shared.context(group,'10',policy);assert.equal(s.shared.available(ctx).length,1);assert.equal(s.shared.available(s.shared.context(otherGroup,'10',policy)).length,0);s.close();
});

test('copied quotes inherit dependencies and queued quotes are checked again before model input',async t=>{
  const f=fixture(t),fact=publish(f),shared=recall(f),row=f.s.add(group,'assistant','桂花乌龙茶');f.s.setSource(row,'source-reply');f.s.shared.tagMessage(row,shared.references());
  let release,entered;const pending=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let calls=0;
  const bridge=new Bridge({config:f.config,store:f.s,codex:{chat:async p=>{calls++;if(calls===1){entered();await pending;}else{assert.doesNotMatch(p.text,/桂花乌龙茶/);assert.ok(p.history.every(h=>!h.text.includes('桂花乌龙茶')));}return {reply:'你好',memories:[]};}},onebot:{reply:async()=>[]},persona:'角色',log:()=>{}});t.after(()=>bridge.stop());
  const event=(id,quoted=false)=>({post_type:'message',message_type:'group',self_id:99,group_id:20,user_id:10,message_id:id,message:[...(quoted?[{type:'reply',data:{id:'source-reply'}}]:[]),{type:'at',data:{qq:99}},{type:'text',data:{text:'你好'}}]});
  await bridge.handle(event(1));await ready;await bridge.handle(event(2,true));
  const copied=f.s.db.prepare("SELECT id FROM messages WHERE source='2'").get();assert.equal(f.s.shared.dependencies(copied.id).length,1);
  f.s.db.prepare('UPDATE memories SET expires=1 WHERE id=?').run(fact.memoryId);release();await Promise.all([...bridge.queues.values()].map(q=>q.chain));assert.equal(calls,2);assert.equal(f.s.shared.messageAllowed(copied.id,f.ctx()),false);
});

test('revocation between QQ chunks prevents all remaining chunks from being sent',async t=>{
  const f=fixture(t),fact=publish(f),r=recall(f),bot=new OneBot({});let sent=0;
  bot.action=async()=>{sent++;f.s.shared.stop(fact.id);return {message_id:sent};};
  await assert.rejects(bot.reply({message_type:'group',group_id:20,user_id:10},'茶'.repeat(1801),{beforeSend:()=>r.assertFresh()}),/权限或版本/);assert.equal(sent,1);
});
