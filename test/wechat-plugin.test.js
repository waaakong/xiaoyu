import test from 'node:test';import assert from 'node:assert/strict';
import {WeChatPluginGateway} from '../src/wechat-plugin-gateway.js';
import {normalize} from '../src/policy.js';import {policyFor} from '../src/config.js';
function fixture(){const config={platform:'wechat',allowedUsers:['wx_friend'],allowedGroups:[],wakeWords:['小鱼'],defaults:{pluginsEnabled:true,pluginCommands:['helloworld'],pluginMode:'commands',pluginCallLimit:1}},events=[],sent=[];
const gateway=new WeChatPluginGateway({token:'a'.repeat(64),getAccount:()=> 'wx_role',policy:s=>policyFor(config,s),onebot:{connected:true,reply:async(e,text)=>{sent.push({event:e,text});return [{message_id:String(sent.length)}];}}});gateway.socket={readyState:1,send:text=>events.push(JSON.parse(text))};
const event={post_type:'message',message_type:'private',self_id:'wx_role',user_id:'wx_friend',message_id:'123',message:[{type:'text',data:{text:'/插件 helloworld'}}],sender:{nickname:'测试'}};
return {config,gateway,events,sent,event,r:normalize(event,config)};}
test('WeChat command leases preserve raw IDs, reject stale traces and never use QQ actions',async()=>{
 const f=fixture();assert.equal(await f.gateway.handle(f.r),true);assert.equal(f.events[0].self_id,'wx_role');assert.equal(f.events[0].user_id,'wx_friend');const trace=f.events[0].xiaoyu_lease_id;
 await assert.rejects(f.gateway.action('send',{kind:'private',peer:'wx_friend',trace:'stale',message:'wrong'}),/不匹配/);
 const receipt=await f.gateway.action('send',{kind:'private',peer:'wx_friend',trace,message:'Hello'});assert.equal(receipt.message_id,'1');assert.equal(f.sent[0].event.user_id,'wx_friend');
 await assert.rejects(f.gateway.action('send',{kind:'private',peer:'wx_other',trace,message:'wrong'}),/未授权/);await assert.rejects(f.gateway.action('send_private_msg',{user_id:123,message:'wrong'}),/未开放/);
 f.config.defaults.pluginsEnabled=false;await assert.rejects(f.gateway.action('send',{kind:'private',peer:'wx_friend',trace,message:'wrong'}),/未授权/);
});
test('WeChat enhancement keeps model limits and separate target traces',async()=>{
 const f=fixture();f.config.defaults.pluginMode='enhanced';f.r.policy=policyFor(f.config,f.r.scope);let calls=0;
 const pending=f.gateway.enhance(f.r,{model:async()=>{calls++;return {reply:'你好'};}}),trace=f.events[0].xiaoyu_request_id;
 await f.gateway.callModel(trace,{purpose:'reply'});await assert.rejects(f.gateway.callModel(trace,{purpose:'aux'}),/上限/);assert.equal(calls,1);
 await f.gateway.action('send',{kind:'private',peer:'wx_friend',trace,message:'第一句\n第二句'});f.gateway.complete(trace);assert.equal((await pending).sent,2);assert.equal(f.sent.length,2);
 await assert.rejects(f.gateway.action('send',{kind:'private',peer:'wx_friend',trace,message:'late'}),/未授权/);
});
