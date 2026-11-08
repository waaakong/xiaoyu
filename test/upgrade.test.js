import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {normalize,isAwake} from '../src/policy.js';
import {policyFor,validateChat} from '../src/config.js';
import {qqImageUrl,imageInputs,imageInfo,MAX_IMAGE} from '../src/media.js';
import sharp from 'sharp';
const config={admins:[],allowedUsers:['10'],allowedGroups:['20'],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:800,defaults:{autoSummary:false}};
const event=(text,user=10,extra={})=>({post_type:'message',message_type:'group',self_id:99,user_id:user,group_id:20,message_id:Math.random(),message:[{type:'text',data:{text}}],sender:{nickname:'成员'+user},...extra});
function fixture(chat){const store=new Store(':memory:'),sent=[];const bridge=new Bridge({config,store,codex:{closed:false,chat},onebot:{reply:async(e,text)=>{sent.push({e,text});return [{message_id:1234}];}},persona:'default',log:()=>{}});return {store,bridge,sent,drain:async()=>{await Promise.all([...bridge.queues.values()].map(q=>q.chain));}};}
test('account scoping and per-chat overrides do not cross accounts',()=>{
  const c={...config,chats:{'qq:99:group:20':{enabled:false}}};assert.equal(normalize(event('小鱼你好'),c),null);assert.ok(normalize(event('小鱼你好',10,{self_id:88}),c));
  assert.notEqual(normalize(event('小鱼你好'),config).scope,normalize(event('小鱼你好',10,{self_id:88}),config).scope);
});
test('same group shares context with attributed speakers; private memory stays private',async()=>{
  let input;const f=fixture(async x=>{input=x;return {reply:'回复',memories:[],assetId:null};});
  f.store.remember('qq:99:private:10','秘密','私聊秘密',{pinned:true});
  await f.bridge.handle(event('我在准备周末的活动',11));await f.bridge.handle(event('你怎么看，小鱼？',10));await f.drain();
  assert.match(input.history[0].text,/周末/);assert.match(input.history[0].speaker,/11/);assert.doesNotMatch(input.memory,/私聊秘密/);assert.equal(f.sent.length,1);f.store.close();
});
test('memory extraction requires an exact quote from current speaker and stores source',async()=>{
  const f=fixture(async()=>({reply:'记下了',memories:[{key:'喜欢',value:'茶',evidence:'喜欢喝茶'},{key:'编造',value:'秘密',evidence:'根本没说过'}]}));
  await f.bridge.handle(event('小鱼我喜欢喝茶'));await f.drain();const m=f.store.memories('qq:99:group:20:member:10');assert.equal(m.length,1);assert.equal(m[0].evidence,'喜欢喝茶');assert.match(f.store.source(m[0].sourceId).text,/喜欢喝茶/);f.store.close();
});
test('replying to a locally confirmed bot message wakes without @ or name',async()=>{
  const f=fixture(async()=>({reply:'你好',memories:[]}));const id=f.store.add('qq:99:group:20','assistant','上一条','delivered','AI','777');
  f.store.setReceipts(id,[{message_id:777},{message_id:778}]);
  const e=event('继续说',10);e.message.unshift({type:'reply',data:{id:778}});await f.bridge.handle(e);await f.drain();assert.equal(f.sent.length,1);
  f.store.reset('qq:99:group:20');assert.equal(f.store.quoted('qq:99:group:20',778),undefined);f.store.close();
});
test('natural participation is opt-in, bounded and respects cooldown',()=>{
  const r=normalize(event('大家怎么看这件事情'),{...config,defaults:{wakeMode:'hybrid',naturalProbability:0.1,naturalCooldownSeconds:60}});
  assert.equal(isAwake(r,new Map(),100000,false,new Map(),()=>0.05),true);
  assert.equal(isAwake(r,new Map(),100000,false,new Map([[r.scope,90000]]),()=>0.01),false);
  assert.equal(isAwake({...r,policy:{...r.policy,wakeMode:'mention'}},new Map(),100000,false,new Map(),()=>0),false);
  assert.throws(()=>validateChat({naturalProbability:1}),/概率/);
});
test('per-chat persona, model and web flags reach model call',async()=>{
  let input;const f=fixture(async x=>{input=x;return {reply:'好',memories:[]};});f.store.savePersona({id:'friend',name:'朋友',category:'陪伴',text:'专属人格'});f.bridge.config={...config,chats:{'qq:99:group:20':{personaId:'friend',model:'account-model',webSearch:true}}};
  await f.bridge.handle(event('小鱼你好'));await f.drain();assert.ok(input.persona.startsWith('专属人格'));assert.ok(input.persona.includes('conversationFocus'));assert.equal(input.model,'account-model');assert.equal(input.webSearch,true);f.store.close();
});
test('memory expiry, fixed records and member listing are bounded by conversation',()=>{
  const s=new Store(':memory:');s.remember('qq:99:group:20:member:10','爱好','音乐');s.remember('qq:88:group:20:member:10','爱好','别的账号');assert.equal(s.memoryPage('qq:99:group:20').length,1);s.db.prepare('UPDATE memories SET expires=? WHERE scope=?').run(Date.now()-1,'qq:99:group:20:member:10');assert.equal(s.memories('qq:99:group:20:member:10').length,0);s.remember('qq:99:group:20:member:10','爱好','音乐',{pinned:true});assert.equal(s.memories('qq:99:group:20:member:10')[0].expires,null);s.close();
});
test('summary retains raw archive and covers only history outside the recent window',async()=>{
  const f=fixture(async()=>({reply:'活动摘要',memories:[]}));for(let i=0;i<15;i++){const id=f.store.add('qq:99:group:20','user','消息'+i,'received','10');f.store.tagTurn(id,'default','archive-'+i);}
  const p=policyFor(config,'qq:99:group:20');await f.bridge.summarize('qq:99:group:20',p,{force:true});assert.equal(f.store.summary('qq:99:group:20').endId,7);assert.equal(f.store.historyPage('qq:99:group:20').length,15);f.store.close();
});
test('image inputs are bounded and arbitrary URLs are rejected',async()=>{
  assert.throws(()=>qqImageUrl('http://127.0.0.1/a'));assert.throws(()=>qqImageUrl('https://qpic.cn.attacker.test/a'));assert.throws(()=>qqImageUrl('https://user:pass@gchat.qpic.cn/a'));assert.match(qqImageUrl('https://gchat.qpic.cn/a'),/qpic/);
  await assert.rejects(()=>imageInfo(Buffer.alloc(MAX_IMAGE+1)),/5MB/);const bytes=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer();const inputs=await imageInputs(bytes);assert.equal(inputs.length,1);assert.match(inputs[0].url,/^data:image\/jpeg;base64,/);
});
