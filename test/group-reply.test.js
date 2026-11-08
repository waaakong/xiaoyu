import test from 'node:test';
import assert from 'node:assert/strict';
import {groupReplyGate} from '../src/group-reply.js';
import {isAwake} from '../src/policy.js';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';
import {wechatEvent} from '../src/wechat-events.js';

const base={group:'20',scope:'qq:99:group:20',memberScope:'qq:99:group:20:member:11',account:'99',user:'11',text:'你语音系统都接上了？',policy:{wakeMode:'hybrid',naturalCooldownSeconds:0,naturalProbability:1,wakeWords:['小鱼']},event:{message:[{type:'at',data:{qq:'10'}},{type:'text',data:{text:'你语音系统都接上了？'}}]}};
test('another target cannot be overridden by an open followup or natural chat probability',()=>{
  assert.equal(groupReplyGate(base).reason,'addressed-to-other');assert.equal(isAwake({...base,explicitFollowup:true},new Map([[base.memberScope,Date.now()+60000]]),Date.now(),false,new Map(),()=>0),false);
  assert.equal(groupReplyGate({...base,at:true}).allow,true);
  assert.equal(groupReplyGate({...base,word:'小鱼',event:{message:[{type:'text',data:{text:'小鱼，这个人是谁'}},{type:'at',data:{qq:'10'}}]}}).allow,true);
  assert.equal(groupReplyGate({...base,event:{message:[]}}, {quoteOther:true}).allow,false);
  assert.equal(groupReplyGate(base,{quoteSelf:true,quoteOther:true}).allow,true);
});
test('acknowledgements are observed; explicit questions and role invitations remain eligible',()=>{
  for(const text of ['对啊','好的。','嗯嗯','收到','OK','谢谢'])assert.equal(groupReplyGate({...base,text,event:{message:[{type:'text',data:{text}}]}}).reason,'acknowledgement');
  assert.equal(groupReplyGate({...base,at:true,text:'对啊'}).allow,true);
  assert.equal(groupReplyGate({...base,group:null}).allow,true);
  assert.equal(groupReplyGate({...base,event:{message:[]}}, {otherConversation:true}).allow,false);
  assert.equal(groupReplyGate({...base,at:true},{otherConversation:true}).allow,true);
});

for(const platform of ['qq','wechat'])for(const enhanced of [false,true])test(`${platform}/enhanced=${enhanced}: observe human discussion, resume on explicit invitation, honor model silence`,async t=>{
  const store=new Store(':memory:'),account=platform==='qq'?'99':'wxid_role',user=platform==='qq'?'11':'wxid_other',target=platform==='qq'?'10':'wxid_owner',group=platform==='qq'?'20':'room@chatroom',scope=`${platform}:${account}:group:${group}`,memberScope=scope+':member:'+user;
  const config={platform,admins:[],allowedUsers:[],allowedGroups:[group],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500,defaults:{wakeMode:'hybrid',naturalProbability:.25,naturalCooldownSeconds:0,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands',autoSummary:false}};
  const sent=[],inputs=[];let silence=false;
  const bridge=new Bridge({config,store,persona:'你叫小鱼',onebot:{reply:async(_e,text)=>{sent.push(text);return [{message_id:'1'}];}},codex:{chat:async p=>{inputs.push(p);return {reply:silence?'[SILENT]':'我在呢',memories:[]};}},log:()=>{}});
  t.after(async()=>{await bridge.stop();store.close();});
  if(enhanced)bridge.plugins={handle:async()=>false,cancel(){},enhance:async(r,o)=>{const out=await o.model({purpose:'reply',system:'尽量回复每条消息',prompt:r.text,contexts:[]},{});if(out.reply==='[SILENT]')return {calls:1,sent:0};await o.onSent({message:[{type:'text',data:{text:out.reply}}],receipt:{message_id:'1'}});sent.push(out.reply);return {calls:1,sent:1};}};
  let n=0;const deliver=async(text,ids=[])=>{let event={post_type:'message',message_type:'group',self_id:account,user_id:user,group_id:group,message_id:String(++n),message:[...ids.map(qq=>({type:'at',data:{qq}})),{type:'text',data:{text}}]};if(platform==='wechat')event=wechatEvent({event:'message.new',type:1,sessionId:group,talkerId:user,timestamp:Date.now()/1000,rawid:String(n),content:text,mentions:ids},0,{config:{account},policy:()=>({enabled:true})});await bridge.handle(event);await Promise.all([...bridge.queues.values()].map(q=>q.chain));};
  bridge.followups.set(memberScope,Date.now()+60000);
  await deliver('你语音系统都接上了？',[target]);await deliver('能不能设置一下别一遍文字一遍语音，要不就单语音');await deliver('感觉有点多余');await deliver('对啊');
  assert.equal(inputs.length,0);assert.equal(sent.length,0);assert.equal(bridge.followups.has(memberScope),false);
  assert.ok(store.historyPage(scope).every(r=>r.role!=='assistant'));
  await deliver('你能帮我看看吗',[account]);assert.equal(inputs.length,1);assert.match(inputs[0].persona,/群聊发言判断/);assert.match(inputs[0].persona,/不代替那个人答话/);assert.equal(sent.length,1);
  assert.equal(bridge.groupAudience.has(memberScope),false);
  silence=true;await deliver('这句其实不用回应',[account]);assert.equal(sent.length,1);assert.equal(inputs.length,2);
});
