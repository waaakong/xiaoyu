import test from 'node:test';
import assert from 'node:assert/strict';
import {chatParts,naturalChatText} from '../src/chat-rhythm.js';
import {OneBot} from '../src/onebot.js';
import {PluginGateway} from '../src/plugin-gateway.js';
import {normalize} from '../src/policy.js';
import {policyFor} from '../src/config.js';

test('only two or three short unformatted Chinese utterances become bubbles',()=>{
  assert.deepEqual(chatParts('噢原来如此\n那就先不改'),['噢原来如此','那就先不改']);
  for(const text of ['好的','前一句  后一句','第一段\n\n第二段','一\n二\n三\n四','a=1\nb=2','print(1)\nprint(2)','介绍\nhttps://example.com','1. 第一项\n2. 第二项','- 第一项\n- 第二项','```\n示例\n```','甲'.repeat(81)+'\n乙'])assert.deepEqual(chatParts(text),[text]);
});

test('DSH blank paragraph separators become short bubbles without changing punctuation or spaces',()=>{
  const text='你是 WaaaKong 啊\n\n怎么，又崩了？';assert.deepEqual(chatParts(naturalChatText(text)),['你是 WaaaKong 啊','怎么，又崩了？']);
  assert.deepEqual(chatParts(naturalChatText('第一句\r\n\r\n第二句\n \n第三句')),['第一句','第二句','第三句']);
  for(const text of ['长段落'.repeat(81)+'\n\n第二段','一\n\n二\n\n三\n\n四','来源\n\nhttps://example.com','1. 第一项\n\n2. 第二项','```js\n\n代码\n```','原文  空格'])assert.equal(naturalChatText(text),text);
  // Other engines retain the existing paragraph-preservation behavior.
  assert.deepEqual(chatParts(text),[text]);
});
test('core reply sends sequential bubbles, mentions once and checks cancellation between sends',async()=>{
  const bot=new OneBot({}),sent=[];bot.action=async(a,p)=>{if(a==='get_group_member_info')return {group_id:20,user_id:10};sent.push(p);return {message_id:sent.length};};
  const receipts=await bot.reply({message_type:'group',group_id:20,user_id:10},'噢懂了\n那先保存\n再关掉',{natural:true,mention:{id:'10'}});assert.equal(receipts.length,3);assert.equal(sent.flatMap(p=>p.message).filter(s=>s.type==='at').length,1);
  sent.length=0;await bot.reply({message_type:'private',user_id:10},'第一行\n第二行');assert.equal(sent.length,1);
  sent.length=0;let fresh=0;await assert.rejects(bot.reply({message_type:'private',user_id:10},'噢懂了\n那先保存',{natural:true,beforeSend:()=>{if(++fresh===2)throw Error('cancelled');}}),/cancelled/);assert.equal(sent.length,1);
  sent.length=0;bot.action=async(a,p)=>{sent.push(p);throw Error('unknown');};await assert.rejects(bot.reply({message_type:'private',user_id:10},'噢懂了\n那先保存',{natural:true}),/unknown/);assert.equal(sent.length,1);
});
function fixture(action){const config={allowedUsers:['10'],allowedGroups:['20'],wakeWords:['小鱼'],defaults:{pluginsEnabled:true,pluginMode:'enhanced'}},sent=[],records=[];const gateway=new PluginGateway({token:'x'.repeat(32),getAccount:()=>99,policy:s=>policyFor(config,s),onebot:{connected:true,action:action??(async(a,p)=>{sent.push(p);return {message_id:sent.length};})}});gateway.socket={readyState:1,send:()=>{}};const event={post_type:'message',message_type:'group',self_id:99,user_id:10,group_id:20,message_id:12,message:[{type:'text',data:{text:'小鱼 你好'}}]},r=normalize(event,config);const pending=gateway.enhance(r,{model:async()=>({reply:'你好'}),onSent:async row=>records.push(row)});return {gateway,sent,records,pending,r};}
test('enhanced replies record each receipt, preserve complete speech text and stay inside the three-send budget',async()=>{
  const f=fixture();await f.gateway.action('send_group_msg',{group_id:20,message:[{type:'at',data:{qq:10}},{type:'text',data:{text:'噢懂了\n那先保存'}}]});assert.equal(f.sent.length,2);assert.equal(f.records.length,2);assert.equal(f.records[0].speechText,'噢懂了\n那先保存');assert.equal(f.sent[1].message.some(s=>s.type==='at'),false);
  await f.gateway.action('send_group_msg',{group_id:20,message:'还有一点\n别急着关'});assert.equal(f.sent.length,3);assert.equal(f.sent[2].message[0].data.text,'还有一点\n别急着关');await assert.rejects(f.gateway.action('send_group_msg',{group_id:20,message:'额外'}),/最多/);const lease=f.gateway.leases.get(f.r.scope);f.gateway.complete(lease.trace);assert.equal((await f.pending).sent,3);
});
test('revoking an enhanced request after its first bubble prevents later bubbles',async()=>{
  let f;f=fixture(async()=>{f.gateway.cancel();return {message_id:1};});const rejected=assert.rejects(f.pending,/撤销/);await assert.rejects(f.gateway.action('send_group_msg',{group_id:20,message:'噢懂了\n那先保存'}),/有效/);await rejected;assert.equal(f.records.length,1);
});
