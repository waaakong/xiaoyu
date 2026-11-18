import test from 'node:test';import assert from 'node:assert/strict';
import {wechatEvent} from '../src/wechat-events.js';import {WeChatIO} from '../src/wechat-io.js';
import {validateChat} from '../src/config.js';import {Speech} from '../src/speech.js';
const account='wx_role',sender='wx_sender',group='12345@chatroom',id='a'.repeat(64);
const make=(patch={})=>({event:'message.new',type:1,sessionId:sender,talkerId:sender,timestamp:Math.floor(Date.now()/1000),rawid:'event-1',content:'你好',...patch});
const options=policy=>({config:{account,mentionNames:['小鱼']},policy:()=>({enabled:true,...policy})});

test('WeChat voice requires chat consent, an exact reference, and a numeric reader conversation binding',()=>{
  const p=make({type:34,voice:{id},conversationId:12});
  assert.equal(wechatEvent(p,0,options({speechInput:false})),null);
  let bound;const event=wechatEvent(p,0,{...options({speechInput:true}),onVoice:(key,record)=>bound={key,...record}});
  assert.equal(event.message[0].type,'record');assert.equal(bound.conversationKey,'wechat:private:12');assert.equal(bound.account,account);
  assert.equal(wechatEvent({...p,conversationId:'invalid'},0,options({speechInput:true})),null);
});

test('WeChat group sender restrictions also protect images and voice before registration',()=>{
  let records=0;const config={...options({speechInput:true,allowedSenders:['wx_other']}),onVoice:()=>records++};
  assert.equal(wechatEvent(make({sessionId:group,type:34,voice:{id},conversationId:12}),0,config),null);
  assert.equal(records,0);assert.equal(wechatEvent(make({sessionId:group,type:3,image:{id}}),0,config),null);
});

test('sticker frames reach image understanding, and authenticated mentions survive normalization',()=>{
  const event=wechatEvent(make({sessionId:group,type:47,image:{id},atUserIds:[account]}),0,options({allowedSenders:[sender]}));
  assert.equal(event.message[0].type,'at');assert.equal(event.message[1].type,'text');assert.equal(event.message[2].type,'image');
  assert.throws(()=>validateChat({allowedSenders:['bad:scope']},true));
});

test('a voice grant cannot be reused after policy revocation or across another reader conversation',async()=>{
  let enabled=true,wrong=false;
  const io=new WeChatIO({config:()=>({account}),policy:()=>({enabled,speechInput:true})});io.connected=true;io.verify=async()=>{};
  io.voiceRefs=new Map([[id,{account,scope:`wechat:${account}:private:${sender}`,peer:sender,sender,conversationKey:'wechat:private:12'}]]);
  io.reader=async()=>({id,conversationKey:wrong?'wechat:private:13':'wechat:private:12',mime:'audio/wav',b64:Buffer.from('wav').toString('base64')});
  assert.equal((await io.action('get_record',{file:id})).base64,Buffer.from('wav').toString('base64'));
  wrong=true;await assert.rejects(io.action('get_record',{file:id}),/会话核验失败/);
  enabled=false;await assert.rejects(io.action('get_record',{file:id}),/授权已失效/);
});

test('shared speech installation retains independent platform settings, cache and process state',()=>{
  const speech=new Speech('data/test-wechat-speech',{environmentBase:'data'});
  assert.notEqual(speech.base,speech.environmentBase);assert.equal(speech.directory.endsWith('test-wechat-speech\\speech')||speech.directory.endsWith('test-wechat-speech/speech'),true);
  assert.equal(speech.child,null);assert.equal(speech.config().enabled,false);
});

test("desktop member-style group quote source is accepted without certifying another chat",()=>{const quoted={version:1,reference:{messageId:"123",conversationId:"",senderId:sender}},p=make({type:57*2**32+49,sessionId:group,quoteReply:quoted});const e=wechatEvent(p,0,options({}));assert.equal(e.message[0].type,"reply");assert.equal(e.message[0].data.id,"123");assert.equal(wechatEvent({...p,quoteReply:{...quoted,reference:{...quoted.reference,conversationId:"other@chatroom"}}},0,options({})),null);});

test("old-media lookup binds source ID, peer and live account and never accepts a different payload",async()=>{let valid=true;const io=new WeChatIO({config:()=>({account}),policy:()=>({enabled:true})});io.connected=true;io.reader=async()=>({messages:[{serverId:"123",xiaoyuMediaPayload:make({type:47,serverId:"123",image:{id},sessionId:valid?sender:"wx_other"})}]});const event={message_type:"private",user_id:sender};assert.equal((await io.quotedMediaEvent(event,"123")).message.find(x=>x.type==="image").data.file,id);assert.equal(await io.quotedMediaEvent(event,"124"),null);valid=false;assert.equal(await io.quotedMediaEvent(event,"123"),null);io.connected=false;assert.equal(await io.quotedMediaEvent(event,"123"),null);});
