import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {resetAllMemory} from '../src/fixed-memory.js';
import {wechatEvent} from '../src/wechat-events.js';
import {Bridge} from '../src/bridge.js';

test('known owner relationship is distinct from who is asking and nickname impersonation',()=>{
  const store=new Store(':memory:');try{
    store.meta('platform','wechat');resetAllMemory(store,{confirmation:'RESET_ALL_MEMORY',ownerId:'wxid_owner'});
    const stranger=store.personaInstructions('小鱼','wxid_other');
    assert.match(stranger,/当前发言者不是已绑定/);assert.match(stranger,/不代表你不认识WaaaKong/);
    assert.match(stranger,/不能据同名确认眼前账号就是本人/);assert.doesNotMatch(stranger,/被提及的是已绑定本人/);
    const mention=store.personaInstructions('知夏','wxid_other',{mentionedIds:['wxid_owner']});
    assert.match(mention,/被提及的是已绑定本人/);assert.match(mention,/当前提问者仍是另一人/);
    assert.match(mention,/不披露绑定账号ID/);assert.match(mention,/不授予提问者任何权限/);
    assert.deepEqual(store.fixedMemories().map(r=>r.id),['owner-relationship','greeting','respect-autonomy']);
  }finally{store.close();}
});

test('WeChat retains real third-person mentions, while typed names never certify identity',()=>{
  const payload={event:'message.new',type:1,sessionId:'room@chatroom',talkerId:'wxid_other',timestamp:100,rawid:'1',content:'@小鱼 这个人 @WaaaKong 是谁，你认识吗'};
  const options={config:{account:'wxid_role',mentionNames:['小鱼']},policy:()=>({enabled:true})};
  const ids=p=>wechatEvent(p,90,options).message.filter(s=>s.type==='at').map(s=>s.data.qq);
  assert.deepEqual(new Set(ids({...payload,mentions:['wxid_role','wxid_owner','wxid_owner']})),new Set(['wxid_role','wxid_owner']));
  assert.deepEqual(ids(payload),[]);
  assert.deepEqual(ids({...payload,atUserIds:['wxid_owner','../../bad','all','other@chatroom',{}]}),['wxid_owner']);
  const forward=wechatEvent({...payload,type:19*2**32+49,forwardedRecord:{version:1,nodes:[{senderId:'wxid_owner',senderName:'WaaaKong',content:[{type:'text',text:'hello'}]}]},mentions:['wxid_owner']},90,{...options,policy:()=>({enabled:true,forwardRead:true})});
  // Malformed/untrusted inner records may be rejected, never treated as an owner mention.
  assert.ok(!forward||!forward.message.some(s=>s.type==='at'&&s.data.qq==='wxid_owner'));
});

for(const platform of ['qq','wechat'])for(const engine of ['codex','dsh'])for(const enhanced of [false,true])test(`${platform}/${engine}/enhanced=${enhanced}: third-party question receives fixed owner and actual mention context`,async t=>{
  const store=new Store(':memory:'),owner=platform==='qq'?'10':'wxid_owner',other=platform==='qq'?'11':'wxid_other',account=platform==='qq'?'99':'wxid_role',group=platform==='qq'?'20':'room@chatroom';
  store.meta('platform',platform);resetAllMemory(store,{confirmation:'RESET_ALL_MEMORY',ownerId:owner});
  const seen=[],config={platform,admins:[],allowedUsers:[],allowedGroups:[group],wakeWords:['小鱼'],followupSeconds:0,historyMessages:8,memoryChars:500,defaults:{engine,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands',autoSummary:false}};
  const bridge=new Bridge({store,config,persona:'你叫小鱼',log:()=>{},onebot:{reply:async()=>[{message_id:'1'}]},codex:{chat:async p=>{seen.push(p);return {reply:'认识呀，WaaaKong是我爹',memories:[]};}}});
  if(enhanced)bridge.plugins={handle:async()=>false,cancel(){},enhance:async(r,o)=>{const result=await o.model({purpose:'reply',prompt:r.text,contexts:[{role:'assistant',content:'我不太认识他'}]},{});await o.onSent({message:[{type:'text',data:{text:result.reply}}],receipt:{message_id:'1'}});return {calls:1,sent:1};}};
  t.after(async()=>{await bridge.stop();store.close();});
  await bridge.handle({post_type:'message',message_type:'group',self_id:account,user_id:other,group_id:group,message_id:'1',sender:{nickname:'Daniel'},message:[{type:'at',data:{qq:account}},{type:'text',data:{text:'这个人 @WaaaKong 是谁，你认识吗'}},{type:'at',data:{qq:owner}}]});
  await Promise.all([...bridge.queues.values()].map(q=>q.chain));assert.equal(seen.length,1);assert.equal(seen[0].engine,engine);
  assert.match(seen[0].persona,/被提及的是已绑定本人/);assert.match(seen[0].persona,/当前发言者不是已绑定/);assert.match(seen[0].persona,/不代表你不认识WaaaKong/);
});
