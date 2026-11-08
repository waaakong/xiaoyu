import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {preferenceInstruction} from '../src/chat-state.js';

const request=(scope='qq:99:group:20',user='10',personaId='default')=>({scope,user,group:scope.includes(':group:')?scope.split(':')[3]:null,policy:{personaId,voiceMode:'requested'},event:{message:[]}});
function source(s,r,text){const id=s.add(r.scope,'user',text,'received',JSON.stringify({id:r.user}));s.tagTurn(id,r.policy.personaId,'turn-'+id);return id;}
test('only explicit persistent preferences are learned, never quotations or a one-turn request',()=>{
  assert.equal(preferenceInstruction('记住了你和我说话，你尽量发语音，查资料什么的才发文字回复'),'smart');
  assert.equal(preferenceInstruction('以后只用语音回复我'),'voice');assert.equal(preferenceInstruction('以后不要发语音，用文字回复我'),'text');
  assert.equal(preferenceInstruction('这次用语音回复我'),null);assert.equal(preferenceInstruction('他说以后用语音回复我'),null);
  assert.equal(preferenceInstruction('为什么以后都用语音回复我'),null);assert.equal(preferenceInstruction('以后恢复默认设置'),'inherit');
});
test('preferences survive reopen and are isolated by platform, account, group, persona and member',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-chat-state-')),file=path.join(dir,'s.sqlite');let s=new Store(file);const r=request();
  try{const id=source(s,r,'以后只用语音回复我');s.chatState.learn({...r,text:'以后只用语音回复我'},id);s.close();s=new Store(file);assert.equal(s.chatState.mode(r),'only');
    for(const other of [request('qq:99:group:21'),request('qq:98:group:20'),request(r.scope,'11'),request(r.scope,'10','other'),request('wechat:wx_role:group:20','wx_user')])assert.equal(s.chatState.mode(other),'requested');
    assert.equal(s.chatState.mode(r,{...r.policy,voiceMode:'off'}),'off');assert.equal(s.chatState.mode({...r,text:'这条用文字回复'}),'off');
  }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('preference provenance rejects another member, forwarded and quoted instructions; migration only uses own private received messages',()=>{
  const s=new Store(':memory:');try{const r=request(),id=source(s,{...r,user:'11'},'以后用语音回复我');assert.throws(()=>s.chatState.set(r,'voice',id),/发言者/);
    const own=source(s,r,'以后用语音回复我');for(const extra of [{hasForward:true},{event:{message:[{type:'reply'}]}}])assert.equal(s.chatState.learn({...r,text:'以后用语音回复我',...extra},own),null);
    const p=request('qq:99:private:10');const prior=source(s,p,'以后尽量用语音回复我，查资料用文字');s.chatState.restore(p);assert.equal(s.chatState.get(p).sourceId,prior);assert.equal(s.chatState.get(p).mode,'smart');
    assert.equal(s.chatState.mode(p,p.policy,{reply:'参考 https://example.com'}),'off');assert.equal(s.chatState.mode({...p,text:'聊聊今天'},p.policy,{reply:'好呀'}),'only');
  }finally{s.close();}
});
test('group snapshots and summaries remain distinct across restart, persona changes and single-group reset',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-group-state-')),file=path.join(dir,'s.sqlite');let s=new Store(file);const a=request(),b=request('qq:99:group:21'),c=request(a.scope,'10','other');
  try{for(const [r,text]of [[a,'本群项目是白茶'],[b,'本群项目是乌龙'],[c,'另一个人格的项目']]){const id=source(s,r,text);s.chatState.observe(r,id);s.chatState.stampSummary(r.scope,r.policy.personaId,id,[{id}],text);}
    s.close();s=new Store(file);assert.equal(s.chatState.view(a.scope,'default').messages[0].text,'本群项目是白茶');assert.equal(s.chatState.summary(b.scope,'default'),'本群项目是乌龙');assert.equal(s.chatState.summary(a.scope,'other'),'另一个人格的项目');
    assert.throws(()=>s.chatState.stampSummary(a.scope,'default',99,[{id:s.chatState.view(b.scope,'default').messages[0].id}],'串群'),/来源/);
    s.reset(a.scope);assert.equal(s.chatState.view(a.scope,'default').messages.length,0);assert.equal(s.chatState.summary(b.scope,'default'),'本群项目是乌龙');
  }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('forgotten sources invalidate group summaries and snapshots instead of replaying old text',()=>{
  const s=new Store(':memory:');try{const r=request(),id=source(s,r,'不能再召回的内容');s.chatState.observe(r,id);s.chatState.stampSummary(r.scope,'default',id,[{id}],'旧摘要');s.db.prepare('INSERT INTO memory_blocked VALUES(?,?)').run(r.scope,id);assert.equal(s.chatState.summary(r.scope,'default'),'');assert.equal(s.chatState.view(r.scope,'default').messages.length,0);}finally{s.close();}
});
async function harness(t,{enhanced=false,platform='qq'}={}){
  const account=platform==='qq'?'99':'wx_role',user=platform==='qq'?'10':'wx_user';
  const store=new Store(':memory:'),sent=[],calls=[],assets=[],config={platform,admins:[],allowedUsers:[user],allowedGroups:['20','21'],wakeWords:['小鱼'],followupSeconds:60,historyMessages:20,memoryChars:500,defaults:{voiceMode:'requested',rhythmMode:'instant',autoSummary:false,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands'}};
  const b=new Bridge({store,config,persona:'小鱼',media:{candidates:()=>[{id:'sticker'}]},log:()=>{},onebot:{capabilities:{voice:true},reply:async(_e,text,o={})=>{o.beforeSend?.();sent.push({type:'text',text});return [{message_id:sent.length}];},record:async(_e,file,o={})=>{o.beforeSend?.();sent.push({type:'voice',file});return {message_id:sent.length};}},codex:{chat:async p=>{calls.push(p);return {reply:p.text.includes('查找')?'来源 https://example.com':'收到',memories:[],assetId:'sticker'};}}});
  b.voice={config:()=>({maxChars:180}),synthesize:async(text,o)=>{o.assertFresh();return {file:'fake.wav',assertFresh:o.assertFresh};}};b.deliverAsset=async(_r,id)=>assets.push(id);
  if(enhanced)b.plugins={handle:async()=>false,cancel(){},enhance:async(r,options)=>{const out=await options.model({purpose:'reply',prompt:'OTHER_GROUP_SECRET',system:'OTHER_GROUP_SECRET',contexts:[{role:'user',content:'OTHER_GROUP_SECRET'}]},{signal:new AbortController().signal});const message=[{type:'text',data:{text:out.reply}}];if(options.bufferReply)options.bufferReply(message);else{const receipts=await b.onebot.reply(r.event,out.reply);await options.onSent({message,receipt:receipts[0]});}return {sent:options.bufferReply?0:1,calls:1};}};
  const send=async(text,group)=>{await b.handle({post_type:'message',message_type:group?'group':'private',self_id:account,user_id:user,...(group?{group_id:group}:{}),message_id:Math.random(),message:[{type:'text',data:{text}}]});await Promise.all([...b.queues.values()].map(q=>q.chain));};
  t.after(async()=>{await b.stop();store.close();});return {store,b,send,sent,calls,assets};
}
for(const platform of ['qq','wechat'])for(const enhanced of [false,true])test(`persistent smart preference drives ${platform}/${enhanced?'enhanced':'normal'} delivery, sources remain written and stickers survive`,async t=>{
  const h=await harness(t,{enhanced,platform});await h.send('记住了你和我说话，你尽量发语音，查资料什么的才发文字回复');h.sent.length=0;h.assets.length=0;
  await h.send('你叫什么名字');assert.deepEqual(h.sent.map(x=>x.type),['voice']);assert.equal(h.assets.length,1);h.sent.length=0;
  await h.send('查找资料，给出来源');assert.deepEqual(h.sent.map(x=>x.type),['text']);assert.match(h.sent[0].text,/https:/);h.sent.length=0;
  await h.send('今天开心吗');assert.deepEqual(h.sent.map(x=>x.type),['voice']);
  if(enhanced)for(const p of h.calls)assert.equal(JSON.stringify({persona:p.persona,history:p.history,memory:p.memory,summary:p.summary,text:p.text}).includes('OTHER_GROUP_SECRET'),false);
});
test('live group turns cannot consume another group or another persona history',async t=>{
  const h=await harness(t);await h.send('小鱼，本群话题是白茶',20);await h.send('小鱼，本群话题是乌龙',21);await h.send('小鱼，本群之前聊什么',20);const p=h.calls.at(-1);assert.equal(JSON.stringify({persona:p.persona,history:p.history,memory:p.memory,summary:p.summary,text:p.text}).includes('乌龙'),false);assert.equal(p.history.some(r=>r.text.includes('白茶')),true);
});
for(const enhanced of [false,true])test(`actual search result overrides smart voice after generation, enhanced=${enhanced}`,async t=>{
  const h=await harness(t,{enhanced}),r=request('qq:99:private:10');h.store.chatState.set(r,'smart');
  h.b.codex.chat=async()=>({reply:'参考 https://example.com',memories:[],web:{operations:[{kind:'search',status:'ok'}]}});
  await h.send('说说你看到的情况');assert.deepEqual(h.sent.map(x=>x.type),['text']);assert.match(h.sent[0].text,/https:/);
});
test('edited source text invalidates existing summary provenance',()=>{
  const s=new Store(':memory:');try{const r=request(),id=source(s,r,'原文');s.chatState.stampSummary(r.scope,'default',id,[{id}],'原文摘要');s.db.prepare('UPDATE messages SET text=? WHERE id=?').run('修改后的原文',id);assert.equal(s.chatState.summary(r.scope,'default'),'');}finally{s.close();}
});
test('generic group recap retrieves its own old summary within budget and rechecks source revocation',()=>{
  const s=new Store(':memory:');try{const r={...request(),text:'本群之前聊什么',policy:{...request().policy,memoryChars:800}},id=source(s,r,'旧项目叫海盐');s.chatState.stampSummary(r.scope,'default',id,[{id}],'旧项目叫海盐');
    const other=request('qq:99:group:21'),otherId=source(s,other,'其他群的秘密');s.chatState.stampSummary(other.scope,'default',otherId,[{id:otherId}],'其他群的秘密');
    r.turnParts=[{id:otherId+1}];const text=s.chatState.prompt(r,[]);assert.match(text,/海盐/);assert.doesNotMatch(text,/秘密/);assert.ok(text.length<=400);assert.equal(s.chatState.fresh(r),true);s.db.prepare('INSERT INTO memory_blocked VALUES(?,?)').run(r.scope,id);assert.equal(s.chatState.fresh(r),false);
  }finally{s.close();}
});
test('preference API requires local authentication, checks members and does not enable synthesis',async t=>{
  const {Runtime}=await import('../src/runtime.js'),{startGui}=await import('../src/gui.js');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-preference-api-')),runtime=new Runtime({store:new Store(':memory:'),dataDir:dir}),gui=await startGui({open:false,autoConnect:false,runtime});
  t.after(async()=>{await gui.close();fs.rmSync(dir,{recursive:true,force:true});});const scope='qq:99:private:10',headers={'X-Session-Token':gui.token,'Content-Type':'application/json'},post=(body,h=headers)=>fetch(gui.origin+'/api/chat/reply-preference',{method:'POST',headers:h,body:JSON.stringify(body)});
  assert.equal((await post({scope,member:'10',mode:'smart'},{'Content-Type':'application/json'})).status,403);
  assert.equal((await post({scope,member:'11',mode:'smart'})).status,400);assert.equal((await post({scope,member:'10',mode:'bad'})).status,400);
  const before=runtime.conversation(scope).policy.voiceMode,result=await post({scope,member:'10',mode:'smart'});assert.equal(result.status,200);const data=await result.json();assert.equal(data.replyPreferences[0].mode,'smart');assert.equal(data.policy.voiceMode,before);assert.equal(runtime.voice.last?.status==='synthesized',false);
  const app=await(await fetch(gui.origin+'/app.js')).text();assert.match(app,/回复偏好与群上下文/);assert.match(app,/history\/reset/);
});
