import test from 'node:test';
import assert from 'node:assert/strict';
import {chatParts,naturalChatText,stripNarration} from '../src/chat-rhythm.js';
import {OneBot} from '../src/onebot.js';
import {PluginGateway} from '../src/plugin-gateway.js';
import {normalize} from '../src/policy.js';
import {policyFor} from '../src/config.js';

test('only two or three short unformatted Chinese utterances become bubbles',()=>{
  assert.deepEqual(chatParts('噢原来如此\n那就先不改'),['噢原来如此','那就先不改']);
  assert.deepEqual(chatParts('第一段\n\n第二段'),['第一段','第二段']);
  for(const text of ['好的','前一句  后一句','a=1\nb=2','print(1)\nprint(2)','介绍\nhttps://example.com','1. 第一项\n2. 第二项','- 第一项\n- 第二项','```\n示例\n```','甲'.repeat(81)+'\n乙'])assert.deepEqual(chatParts(text),[text]);
});

test('DSH blank paragraph separators become short bubbles without changing punctuation or spaces',()=>{
  const text='你是 WaaaKong 啊\n\n怎么，又崩了？';assert.deepEqual(chatParts(naturalChatText(text)),['你是 WaaaKong 啊','怎么，又崩了？']);
  assert.deepEqual(chatParts(naturalChatText('第一句\r\n\r\n第二句\n \n第三句')),['第一句','第二句','第三句']);
  for(const text of ['长段落'.repeat(81)+'\n\n第二段','来源\n\nhttps://example.com','1. 第一项\n\n2. 第二项','```js\n\n代码\n```','原文  空格'])assert.equal(naturalChatText(text),text);
  // Blank-line paragraphs split for every engine when the caller asks for natural bubbles.
  assert.deepEqual(chatParts(text),['你是 WaaaKong 啊','怎么，又崩了？']);
});
test('utterances beyond the bubble budget merge into the last bubble instead of one long message',()=>{
  assert.deepEqual(chatParts('一\n二\n三\n四'),['一','二','三\n四']);
  assert.deepEqual(chatParts('一\n二',{maxParts:1}),['一\n二']);
  const live='嘻嘻\n\n那必须的呀\n\n刚好在\n\n主要是等你发呢 [偷笑]';
  assert.deepEqual(chatParts(live),['嘻嘻','那必须的呀','刚好在\n主要是等你发呢 [偷笑]']);
  assert.deepEqual(chatParts(naturalChatText(live)),['嘻嘻','那必须的呀','刚好在\n主要是等你发呢 [偷笑]']);
  // An inline face token is plain text, not markup that disqualifies a split.
  assert.deepEqual(chatParts('好呀[偷笑]\n那就这样'),['好呀[偷笑]','那就这样']);
  assert.deepEqual(chatParts('前一句[猫猫看戏]\n后一句'),['前一句[猫猫看戏]','后一句']);
});
test('kaomoji openers without Han stay text while HTML and ASCII blocks still keep one message',()=>{
  const blank='早呀\n\nCiallo～(∠・ω< )⌒★\n\n睡够了没';
  assert.deepEqual(chatParts(blank),['早呀','Ciallo～(∠・ω< )⌒★','睡够了没']);
  assert.deepEqual(chatParts(naturalChatText(blank)),['早呀','Ciallo～(∠・ω< )⌒★','睡够了没']);
  const single='Ciallo～(∠・ω< )⌒★\n在\n那坠日1是谁带你上去的[旺柴]';
  assert.deepEqual(chatParts(single),['Ciallo～(∠・ω< )⌒★','在','那坠日1是谁带你上去的[旺柴]']);
  for(const text of ['<div>你好</div>\n下一行','看这个 -> 右边\n下一行','Hello world\n第二行','纯英文\nno han'])assert.deepEqual(chatParts(text),[text]);
});
test('bracketed stage direction is staging, not text, and no longer blocks the bubble split',()=>{
  const reply='啊？挂掉了呀\n语音功能是开着的呀，可能是那条发送时断了\n现在打字能收到不\n[晕了，螺旋眼捂脸，脑子打结]';
  const cleaned=stripNarration(reply);
  assert.equal(cleaned.includes('晕了'),false);
  assert.deepEqual(chatParts(cleaned),['啊？挂掉了呀','语音功能是开着的呀，可能是那条发送时断了','现在打字能收到不']);
  for(const text of ['[表情：猫猫看戏]','[REPLY_TO:wx_abc]','[图片]','[语音，内容同上一条文字]'])assert.equal(stripNarration(text),text);
  assert.equal(stripNarration('正文\n【叹气】'),'正文');
  assert.equal(stripNarration('[只有旁白]'),'[只有旁白]');
  assert.equal(stripNarration('普通\n[社交动作：摸了摸头]\n句尾'),'普通\n[社交动作：摸了摸头]\n句尾');
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
