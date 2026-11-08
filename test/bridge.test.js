import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {route} from '../src/policy.js';
const config={admins:[],allowedUsers:['10'],allowedGroups:['20'],wakeWords:['鱼','小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500};
const event=(text,extra={})=>({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:Math.random(),message:[{type:'text',data:{text}}],...extra});
const group=(text,extra={})=>event(text,{message_type:'group',group_id:20,...extra});
test('whitelist, self messages and non-array CQ strings are rejected',()=>{
  assert.equal(route(event('hi',{user_id:11}),config,new Map()),null);
  assert.equal(route(event('hi',{user_id:99}),config,new Map()),null);
  assert.equal(route(group('hi',{group_id:21}),config,new Map()),null);
  assert.equal(route(group('hi',{message:'[CQ:at,qq=99] hi'}),config,new Map()),null);
});
test('@ and wake words use OR, longest prefix and member scoped followup',()=>{
  const e=group('小鱼，你好');e.message.unshift({type:'at',data:{qq:'99'}});
  const r=route(e,config,new Map());assert.equal(r.text,'你好');
  assert.equal(route(group('普通聊天'),config,new Map()),null);
  const follow=new Map([[r.memberScope,Date.now()+60000]]);
  assert.ok(route(group('继续聊'),config,follow));
  assert.equal(route(group('继续聊',{user_id:11}),config,follow),null);
});
test('persistent memory update, budget, source scope and removal',()=>{
  const s=new Store(':memory:');s.remember('a','核心:称呼','小王');s.remember('a','考试','准备考试');s.remember('b','秘密','另一个人');
  s.remember('a','考试','已经考完');assert.equal(s.memories('a').length,2);
  assert.match(s.recall('a','考试',100),/已经考完/);assert.ok(s.recall('a','考试',6).length<=6);
  assert.equal(s.forget('b',s.memories('a')[0].id),0);
  assert.equal(s.once('e'),true);assert.equal(s.once('e'),false);s.close();
});
function fixture(chat=async()=>({reply:'你好呀',memories:[{key:'喜欢',value:'喝茶',evidence:'喜欢喝茶'}]}),reply){
  const s=new Store(':memory:'),sent=[];
  const b=new Bridge({config,store:s,codex:{closed:false,chat},onebot:{reply:reply??(async(e,text)=>{sent.push(text);})},persona:'角色',log:()=>{}});
  return {s,b,sent,drain:async()=>{await Promise.all([...b.queues.values()].map(q=>q.chain));}};
}
test('duplicate event only invokes model and sends once',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {reply:'你好',memories:[]};});
  const e=group('小鱼你好');e.message.unshift({type:'at',data:{qq:'99'}});
  await f.b.handle(e);await f.b.handle(e);await f.drain();assert.equal(calls,1);assert.equal(f.sent.length,1);f.s.close();
});
test('confirmed delivery adds assistant and memory; failed delivery does not',async()=>{
  const f=fixture();await f.b.handle(event('喜欢喝茶'));await f.drain();assert.equal(f.s.memories('qq:99:private:10').length,1);assert.equal(f.s.history('qq:99:private:10',8).length,2);f.s.close();
  const g=fixture(undefined,async()=>{throw new Error('timeout');});await g.b.handle(event('喜欢喝茶'));await g.drain();assert.equal(g.s.memories('qq:99:private:10').length,0);assert.equal(g.s.history('qq:99:private:10',8).length,1);g.s.close();
});
test('pause and resume, reset preserves memories, clear removes both',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {reply:'你好',memories:[]};});
  await f.b.handle(event('/暂停'));await f.b.handle(event('hello'));await f.drain();assert.equal(calls,0);
  await f.b.handle(event('/继续'));await f.b.handle(event('/记住 核心:称呼=小王'));await f.b.handle(event('/新对话'));assert.equal(f.s.memories('qq:99:private:10').length,1);
  await f.b.handle(event('/清空记忆'));assert.equal(f.s.memories('qq:99:private:10').length,0);assert.equal(f.s.history('qq:99:private:10',8).length,0);f.s.close();
});
test('cancellation discards response and proposed memories',async()=>{
  let started;const ready=new Promise(r=>{started=r;});
  const f=fixture(async({signal})=>{started();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancel')),{once:true});});});
  await f.b.handle(event('hi'));await ready;await f.b.handle(event('/取消'));await f.drain();assert.deepEqual(f.sent,['已取消你的待处理回复。']);assert.equal(f.s.memories('qq:99:private:10').length,0);f.s.close();
});
test('history bounds and group/private contexts do not cross',async()=>{
  const inputs=[];const f=fixture(async x=>{inputs.push(x);return {reply:'好',memories:[]};});
  f.s.add('qq:99:private:10','user','私人内容','received');await f.b.handle(group('小鱼你好'));await f.drain();assert.equal(inputs[0].history.length,0);f.s.close();
});
