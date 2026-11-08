import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {ScheduledTasks} from '../src/scheduled-tasks.js';
import {parseScheduledRequest,taskIntent,beijingStamp} from '../src/scheduled-time.js';
import {Bridge} from '../src/bridge.js';
import {policyFor,validateChat} from '../src/config.js';

const now=Date.parse('2026-11-07T10:00:00+08:00');
function fixture(t,{platform='qq',send,store}={}){
  let clock=now,online=true;const s=store??new Store(':memory:'),owner=platform==='qq'?'10':'wxid_owner',account=platform==='qq'?'99':'wxid_role',group=platform==='qq'?'20':'room@chatroom',scope=`${platform}:${account}:group:${group}`,sent=[],controls=[];
  s.meta('platform',platform);s.meta('fixed-memory-owner',owner);
  const config={platform,allowedUsers:[owner],allowedGroups:[group],wakeWords:['小鱼'],historyMessages:8,memoryChars:500,followupSeconds:60,defaults:{autoSummary:false,scheduledTasks:{enabled:true,creators:[]},voiceMode:'off',personaId:'default'}};
  const service=new ScheduledTasks({store:s,platform,policy:sc=>policyFor(config,sc),now:()=>clock,ready:()=>online,send:send??(async(j,o)=>{o.beforeSend();sent.push(j);return [{message_id:'receipt-'+sent.length}];})});service.control=async(_r,text)=>controls.push(text);
  service.configure({enabled:true});let n=0;const request=(text='5分钟后提醒我喝水',extra={})=>({scope,user:owner,account,group,at:true,speaker:JSON.stringify({id:owner,name:'本人'}),text,event:{message_id:String(++n),message:[{type:'at',data:{qq:account}},{type:'text',data:{text}}]},...extra});
  t.after(async()=>{await service.close();if(!store)s.close();});
  return {s,service,config,scope,owner,account,group,sent,controls,request,advance:ms=>clock+=ms,offline:()=>online=false,online:()=>online=true};
}
test('Beijing relative, named clocks, daily and weekly expressions are deterministic',()=>{
  assert.equal(parseScheduledRequest('五分钟后在本群提醒我喝水',now).due,now+300000);
  assert.equal(parseScheduledRequest('半小时后提醒我休息',now).due,now+1800000);assert.equal(parseScheduledRequest('后天下午三点提醒我喝水',now).due,Date.parse('2026-11-09T15:00:00+08:00'));assert.equal(parseScheduledRequest('下周一9:00提醒我开会',now).due,Date.parse('2026-11-09T09:00:00+08:00'));
  const tomorrow=parseScheduledRequest('明天18:30提醒我开会',now);assert.equal(tomorrow.due,Date.parse('2026-11-08T18:30:00+08:00'));assert.equal(tomorrow.content,'开会');
  const daily=parseScheduledRequest('每天晚上八点提醒我吃药',now);assert.equal(daily.repeat,'daily');assert.equal(daily.interval,86400000);assert.equal(daily.due,Date.parse('2026-11-07T20:00:00+08:00'));
  const weekly=parseScheduledRequest('每周一9:00提醒我开会',now);assert.equal(weekly.due,Date.parse('2026-11-09T09:00:00+08:00'));
  assert.match(beijingStamp(tomorrow.due),/18:30/);assert.throws(()=>parseScheduledRequest('今天9:00提醒我开会',now));assert.throws(()=>parseScheduledRequest('99:99提醒我开会',now));
  for(const text of ['5分钟后群发找我','5分钟后发给另一个群','5分钟后转账'])assert.ok(parseScheduledRequest(text,now).clarify);
  assert.ok(parseScheduledRequest('5分钟后提醒我',now).clarify);assert.equal(taskIntent('他说5分钟后提醒我'),false);assert.equal(taskIntent('晚上八点提醒我喝水'),true);
  assert.equal(parseScheduledRequest('每天晚上八点半提醒我吃药',now).due,Date.parse('2026-11-07T20:30:00+08:00'));
  assert.ok(parseScheduledRequest('每5分钟提醒我喝水',now).clarify);
  assert.ok(parseScheduledRequest('你会明天5分钟后发什么',now).clarify);
});
test('complex parsing replaces normal reply once, requires review and has a bounded model budget',async t=>{
  const f=fixture(t);let calls=0;f.service.generate=async()=>{calls++;return {reply:JSON.stringify({atLocal:'2026-11-09 15:00',repeat:'once',content:'喝水',voice:false,mentionSelf:false})};};
  f.service.configure({dailyLimit:1});const r=f.request('2026年11月9日下午三点提醒我喝水'),d=await f.service.prepare(r),j=f.service.create(r,d);assert.equal(calls,1);assert.equal(j.status,'awaiting-confirmation');assert.equal(f.service.confirm(j.id,f.owner).status,'pending');
  await assert.rejects(f.service.prepare(f.request('2026年11月9日傍晚提醒我休息')),/解析.*上限/);assert.equal(calls,1);
});
test('turning off the switch during model parsing cancels the draft and creates no task',async t=>{
  const f=fixture(t);let started;const ready=new Promise(r=>started=r);f.service.generate=async(_r,{signal})=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};
  const work=f.service.prepare(f.request('2026年11月9日下午三点提醒我喝水'));await ready;f.service.configure({enabled:false});await assert.rejects(work);assert.equal(f.service.list().length,0);
});
test('task handling precedes enhanced plugins and never needs a model for a fixed reminder',async t=>{
  const f=fixture(t);let calls=0,plugins=0;const bridge=new Bridge({config:f.config,store:f.s,account:f.account,onebot:{reply:async()=>[]},codex:{chat:async()=>{calls++;throw Error('must not call');}},persona:'小鱼',log:()=>{}});bridge.tasks=f.service;bridge.plugins={handle:async()=>{plugins++;return false;},cancel(){}};t.after(()=>bridge.stop());
  const r=f.request();await bridge.handle({post_type:'message',message_type:'group',self_id:f.account,user_id:f.owner,group_id:f.group,message_id:'fixed',message:r.event.message});assert.equal(f.service.list().length,1);assert.equal(calls,0);assert.equal(plugins,0);
});
test('settings default off, owner identity verified and platform scope isolated',async t=>{
  const f=fixture(t);f.service.configure({enabled:false});assert.throws(()=>f.service.create(f.request(),parseScheduledRequest('5分钟后提醒我喝水',now)),/未开启/);
  f.service.configure({enabled:true});assert.equal(f.service.permitted(f.scope,'11'),false);assert.equal(f.service.permitted('wechat:wx_role:group:room@chatroom',f.owner),false);
  validateChat({scheduledTasks:{enabled:true,creators:['10']}},true);assert.throws(()=>validateChat({scheduledTasks:{enabled:true,creators:['10','10']}},true));
});
for(const platform of ['qq','wechat'])test(`${platform}: clear commands persist, deliver once and never treat typed nickname as permission`,async t=>{
  const f=fixture(t,{platform}),r=f.request();await f.service.command(r);assert.match(f.controls[0],/已安排/);assert.equal(f.service.list().length,1);assert.equal(f.sent.length,0);
  const j=f.service.list()[0];assert.equal(j.sourceId,f.s.historyPage(f.scope)[0].id);assert.equal(j.creator,f.owner);
  f.advance(300000);await Promise.all([f.service.pump(),f.service.pump()]);assert.equal(f.sent.length,1);assert.equal(f.service.get(j.id).status,'completed');await f.service.pump();assert.equal(f.sent.length,1);
  await f.service.command(f.request('5分钟后提醒我喝水',{user:platform==='qq'?'11':'wxid_impostor',speaker:JSON.stringify({id:'impostor',name:'WaaaKong'})}));assert.equal(f.service.list().length,1);assert.match(f.controls.at(-1),/权限/);
});
test('same event key deduplicates, max pending enforced and no content never claims success',async t=>{
  const f=fixture(t),r=f.request(),draft=await f.service.prepare(r),a=f.service.create(r,draft),b=f.service.create(r,draft);assert.equal(a.id,b.id);
  f.service.configure({maxPending:1});assert.throws(()=>f.service.create(f.request(),draft),/上限/);await f.service.command(f.request('5分钟后群发找我'));assert.equal(f.service.list().length,1);assert.doesNotMatch(f.controls.at(-1),/已安排/);
});
test('periodic rules need confirmation, roll forward and are creator-scoped',async t=>{
  const f=fixture(t),r=f.request('每天18:00提醒我吃饭'),j=f.service.create(r,await f.service.prepare(r));assert.equal(j.status,'awaiting-confirmation');f.advance(8*3600000);await f.service.pump();assert.equal(f.sent.length,0);assert.throws(()=>f.service.confirm(j.id,'11'));
  const active=f.service.confirm(j.id,f.owner);assert.ok(active.due>now+8*3600000);f.advance(active.due-(now+8*3600000));await f.service.pump();assert.equal(f.sent.length,1);assert.equal(f.service.get(j.id).due,active.due+86400000);
});
test('cancel and platform/global/chat switches block output; late reminders expire',async t=>{
  const f=fixture(t),r=f.request(),j=f.service.create(r,await f.service.prepare(r));assert.throws(()=>f.service.cancel(j.id,'11'));f.service.cancel(j.id,f.owner);f.advance(300000);await f.service.pump();assert.equal(f.sent.length,0);
  const k=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我休息',now+300000));f.offline();f.advance(361000);await f.service.pump();assert.equal(f.service.get(k.id).status,'expired');f.online();await f.service.pump();assert.equal(f.sent.length,0);
});
test('brief disconnection waits within grace, disabled globals pause and no mass catchup',async t=>{
  const f=fixture(t),j=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我喝水',now));f.offline();f.advance(61000);await f.service.pump();assert.equal(f.service.get(j.id).status,'pending');f.online();await f.service.pump();assert.equal(f.sent.length,1);
  const k=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我休息',now+61000));f.service.configure({enabled:false});f.advance(500000);await f.service.pump();assert.equal(f.sent.length,1);f.service.configure({enabled:true});await f.service.pump();assert.equal(f.service.get(k.id).status,'expired');assert.equal(f.sent.length,1);
});
test('unknown submission is terminal and cannot be cancelled or replayed',async t=>{
  let count=0;const f=fixture(t,{send:async(_j,o)=>{o.beforeSend();count++;throw Error('receipt unknown');}}),j=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我喝水',now));f.advance(60000);await f.service.pump();await f.service.pump();assert.equal(count,1);assert.equal(f.service.get(j.id).status,'unknown');assert.throws(()=>f.service.resume(j.id));
});
test('restart preserves pending tasks and quarantines interrupted submissions',async t=>{
  const s=new Store(':memory:');t.after(()=>s.close());const a=fixture(t,{store:s}),j=a.service.create(a.request(),parseScheduledRequest('1分钟后提醒我喝水',now));await a.service.close();const b=fixture(t,{store:s});b.advance(60000);await b.service.pump();assert.equal(b.sent.length,1);assert.equal(b.service.get(j.id).status,'completed');
  const k=b.service.create(b.request('2分钟后提醒我休息',{sourceKey:'different'}),parseScheduledRequest('2分钟后提醒我休息',now+60000));s.db.prepare("UPDATE scheduled_tasks SET status='running' WHERE id=?").run(k.id);const c=fixture(t,{store:s});assert.equal(c.service.get(k.id).status,'unknown');c.advance(500000);await c.service.pump();assert.equal(c.sent.length,0);
});
test('cancellation before submit prevents send, after submit refuses a false recall claim',async t=>{
  let start,release;const ready=new Promise(r=>start=r),gate=new Promise(r=>release=r);const f=fixture(t,{send:async(_j,o)=>{start();await gate;o.beforeSend();return [{message_id:'x'}];}}),j=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我喝水',now));f.advance(60000);const work=f.service.pump();await ready;f.service.cancel(j.id,f.owner);release();await work;assert.equal(f.service.get(j.id).status,'cancelled');
  let sub,done;const submitted=new Promise(r=>sub=r),hold=new Promise(r=>done=r),g=fixture(t,{send:async(_j,o)=>{o.beforeSend();sub();await hold;return [{message_id:'x'}];}}),k=g.service.create(g.request(),parseScheduledRequest('1分钟后提醒我喝水',now));g.advance(60000);const w=g.service.pump();await submitted;assert.throws(()=>g.service.cancel(k.id,g.owner),/已提交/);done();await w;assert.equal(g.service.get(k.id).status,'completed');
});
for(const platform of ['qq','wechat'])test(`${platform}: scheduled output reuses native voice without repeated text and respects stickers`,async t=>{
  const f=fixture(t,{platform}),sent=[],voice=[];f.config.defaults.voiceMode='only';f.config.defaults.stickers=false;
  const bridge=new Bridge({config:f.config,store:f.s,account:f.account,persona:'小鱼',codex:{},onebot:{connected:true,capabilities:{voice:true},record:async(_e,_file,o)=>{o.beforeSend();sent.push('voice');return {message_id:'v'};},reply:async()=>{sent.push('text');return [{message_id:'t'}];}},log:()=>{}});t.after(()=>bridge.stop());bridge.voice={synthesize:async(text,o)=>{voice.push(text);o.assertFresh();return {file:'mock.wav',assertFresh:o.assertFresh};}};f.service.send=(j,o)=>bridge.sendScheduled(j,o);
  const j=f.service.create(f.request(),parseScheduledRequest('1分钟后提醒我喝水',now));f.advance(60000);await f.service.pump();assert.deepEqual(sent,['voice']);assert.deepEqual(voice,['喝水']);assert.equal(f.service.get(j.id).status,'completed');assert.equal(f.s.historyPage(f.scope).find(r=>r.role==='assistant').text,'喝水');
});
