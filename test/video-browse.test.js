import sharp from 'sharp';
const testFrame=await sharp({create:{width:128,height:72,channels:3,background:'#4488aa'}}).jpeg().toBuffer();
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Store} from '../src/store.js';import {Video} from '../src/video.js';import {videoIntent} from '../src/video-intent.js';import {Bridge} from '../src/bridge.js';
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xy-browse-')),store=new Store(':memory:');store.savePersona({id:'default',name:'小鱼',category:'测试',text:'简短自然'});store.meta('fixed-memory-owner','10');
 let clock=100000,calls=0;const policy={enabled:true,personaId:'default',engine:'codex',model:'fixture'},scope='qq:99:private:10',sent=[];
 const runtime={platform:'qq',dataDir:directory,store,accountId:'99',accounts:{domain:()=> 'qq:99'},bridge:{total:0,sendVideoNotice:async(j,text)=>sent.push({scope:j.scope,text})},onebot:{connected:true},configuration:()=>({defaults:policy}),configPolicy:()=>policy,maintenance:new Map(),notebook:{},learningQueue:{},engines:{visionSupport:()=>true,chat:async()=>{calls++;return {reply:JSON.stringify({summary:'实际画面中的测试收获',topic:'观察'}),usage:{inputTokens:30,outputTokens:20}};}},life:{assertChat:(s,p)=>{if(s!==scope||p&&p!==policy.personaId||!policy.enabled)throw Error('授权失效');return policy;},emit:()=>{}},log:()=>{}};
 const browser={state:()=>({available:true}),candidates:async()=>[1,2,3,4,5].map(id=>({url:'https://www.bilibili.com/video/BVtest'+id,title:'作品'+id})),observe:async(url,o)=>{await o.beforeTick?.();clock+=30000;await o.onProgress?.({watchedSeconds:o.seconds,position:o.seconds,title:'实际作品'});return {url,title:'实际作品',watchedSeconds:o.seconds,frames:[testFrame],captions:'实际字幕',evidence:[{playbackSeconds:1}],duration:100,wallSeconds:o.seconds};},pause:async()=>{},close:()=>{}};
 runtime.video=new Video(runtime,{browser,now:()=>clock});const browse=runtime.video.browse;browse.now=()=>clock;browse.sleep=async()=>{clock+=300;};browse.notify=async(j,text)=>sent.push({scope:j.scope,text});
 t.after(async()=>{await runtime.video.close();store.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {runtime,store,policy,scope,browser,browse,video:runtime.video,sent,calls:()=>calls,clock:()=>clock};
}
test('a failed start notice is not retried or misreported as a failed browsing start',async t=>{
 const f=fixture(t);let sends=0;f.runtime.bridge.sendVideoNotice=async()=>{sends++;throw Error('delivery unknown');};const r={scope:f.scope,user:'10',policy:f.policy,text:'去刷1分钟抖音',event:{message_id:'notice-unknown'}};await assert.rejects(f.browse.command(r),/delivery unknown/);assert.equal(sends,1);await f.browse.work;assert.equal(f.browse.state().jobs.length,1);assert.equal(f.browse.state().jobs[0].status,'completed');
});
test('voice notices wait for synthesis availability, serialize and retain current authorization',async t=>{
 const f=fixture(t),config={platform:'qq',allowedUsers:['10'],allowedGroups:[],admins:[],defaults:{...f.policy,voiceMode:'only',stickers:false}};
 const b=new Bridge({config,store:f.store,persona:'小鱼',account:'99',onebot:{connected:true},codex:{},log:()=>{}});b.voice={busy:true,config:()=>({maxChars:180})};let active=0,peak=0,sends=0;b.voiceOnly=async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;return {message_id:++sends};};
 const job={id:'notice',scope:f.scope,creator:'10',personaId:'default'};const ready=setTimeout(()=>b.voice.busy=false,30);try{await Promise.all([b.sendPersonaNotice(job,'好'),b.sendPersonaNotice(job,'回来了')]);assert.equal(sends,2);assert.equal(peak,1);}finally{clearTimeout(ready);await b.stop();}
});
test('explicit written and transcribed requests parse, while capability questions, quotes and denials do not start',()=>{
 for(const text of ['你快去看10分钟抖音，学一下现在的网络热梗。','去刷十分钟抖音，学习网络热梗','/刷视频 抖音 10分钟 热梗']){const i=videoIntent(text);assert.equal(i.action,'start');assert.equal(i.minutes,10);assert.equal(i.platform,'douyin');}
 for(const text of ['你会不会刷10分钟抖音','不要去看10分钟抖音','如果你去看10分钟抖音呢','他说你去刷10分钟抖音','“去刷10分钟抖音”是什么意思'])assert.equal(videoIntent(text),null);
 assert.equal(videoIntent('/刷视频 抖音').action,'clarify');assert.equal(videoIntent('/停止刷视频').action,'stop');
 assert.equal(videoIntent('去B站看5分钟游戏视频').query,'游戏视频');assert.equal(videoIntent('去刷10分钟抖音，不要点赞').action,'start');assert.equal(videoIntent('我刚看10分钟抖音'),null);
 assert.equal(videoIntent('去刷十五分钟抖音').minutes,15);assert.equal(videoIntent('去刷三十分钟抖音').minutes,30);assert.equal(videoIntent('去刷三十一分钟抖音').action,'clarify');assert.equal(videoIntent('/刷视频 抖音 -10分钟').action,'clarify');
});
test('continuous tasks exceed old two-frame limit, switch unique clips, account actual playback and batch understanding',async t=>{
 const f=fixture(t);const job=await f.browse.start({platform:'bilibili',minutes:2,scope:f.scope,creator:'10',notify:true,sourceKey:'once'});await f.browse.active.done;
 const j=f.browse.get(job.id);assert.equal(j.status,'completed',j.reason);assert.equal(j.watchedSeconds,120);assert.equal(j.clips,4);assert.equal(j.analysed,4);assert.equal(f.calls(),1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].scope,f.scope);assert.equal(new Set(j.seen).size,4);assert.equal(f.video.budget().seconds,120);
 const again=await f.browse.start({platform:'bilibili',minutes:2,scope:f.scope,creator:'10',sourceKey:'once'});assert.equal(again.id,j.id);assert.equal(f.browse.active,null);
});
test('chat foreground pauses and automatically resumes rather than cancelling the whole browsing task',async t=>{
 const f=fixture(t);let tick=0;const observe=f.browser.observe;f.browser.observe=async(...args)=>{if(!tick++){f.browse.foreground();}return observe(...args);};
 const job=await f.browse.start({platform:'bilibili',minutes:1});await f.browse.active.done;assert.equal(f.browse.get(job.id).status,'completed',f.browse.get(job.id).reason);assert.equal(f.browse.get(job.id).watchedSeconds,60);
});
test('revoking chat or changing persona prevents further analysis and original-chat result delivery',async t=>{
 const f=fixture(t),observe=f.browser.observe;f.browser.observe=async(...args)=>{const r=await observe(...args);f.policy.enabled=false;return r;};
 const job=await f.browse.start({platform:'bilibili',minutes:1,scope:f.scope,creator:'10',notify:true});await f.browse.active.done;assert.equal(f.browse.get(job.id).status,'failed');assert.equal(f.calls(),0);assert.equal(f.sent.length,0);
});
test('budget rejection cannot start browsers; unknown model usage remains reserved and login blocks with partial state',async t=>{
 const f=fixture(t);f.video.configure({dailyMinutes:1});await assert.rejects(f.browse.start({platform:'bilibili',minutes:2}),/预算/);assert.equal(f.browse.active,null);
 f.browser.observe=async()=>{throw Object.assign(Error('登录验证'),{code:'VIDEO_LOGIN_REQUIRED'});};const job=await f.browse.start({platform:'bilibili',minutes:1});await f.browse.active.done;assert.equal(f.browse.get(job.id).status,'needs-login');assert.equal(f.browse.get(job.id).watchedSeconds,0);assert.equal(f.calls(),0);
});
test('manual cancel persists partial observed seconds, does not claim completion, and cannot cross another chat',async t=>{
 const f=fixture(t);f.browser.observe=async(url,o)=>{await o.onProgress({watchedSeconds:5});f.browse.stop();o.signal.throwIfAborted();};const job=await f.browse.start({platform:'bilibili',minutes:1});await f.browse.active.done;const j=f.browse.get(job.id);assert.equal(j.status,'cancelled');assert.equal(j.watchedSeconds,5);assert.equal(f.video.budget().seconds,5);assert.equal(f.sent.length,0);
 await assert.rejects(f.browse.start({platform:'bilibili',minutes:1,scope:'qq:99:group:other',creator:'10'}),/授权/);
});
test('only owner or explicitly configured members may create chat tasks; UI observation remains read-only',async t=>{
 const f=fixture(t);assert.equal(f.browse.allowed('guest'),false);await assert.rejects(f.browse.start({platform:'bilibili',minutes:1,scope:f.scope,creator:'guest'}),/主人/);f.store.pause(f.scope,true);await assert.rejects(f.browse.start({platform:'bilibili',minutes:1,scope:f.scope,creator:'10'}),/暂停/);assert.equal(f.browse.active,null);f.store.pause(f.scope,false);f.browse.configure({chatUsers:['guest']});assert.equal(f.browse.allowed('guest'),true);f.browse.configure({chatEnabled:false});assert.equal(f.browse.allowed('10'),false);
});
test('manual pause and resume keep one cursor, and a restarted executor never replays an unfinished task',async t=>{
 const f=fixture(t);let waits=0;f.browse.sleep=async()=>{if(++waits===3)await f.browse.resume();};const observe=f.browser.observe;let calls=0;f.browser.observe=async(...args)=>{if(!calls++)f.browse.pause();return observe(...args);};const j=await f.browse.start({platform:'bilibili',minutes:1});await f.browse.active.done;assert.equal(f.browse.get(j.id).status,'completed');assert.equal(waits,3);
 const unfinished={...f.browse.get(j.id),status:'running'};f.browse.save(unfinished);const {VideoBrowse}=await import('../src/video-browse.js');const restored=new VideoBrowse(f.video);assert.equal(restored.get(j.id).status,'interrupted');assert.equal(restored.active,null);await assert.rejects(restored.resume({id:j.id}),/中断/);
});
test('failed model understanding remains budgeted without auto-retry and cannot produce a learned-success message',async t=>{
 const f=fixture(t);f.runtime.engines.chat=async()=>{throw Error('provider failed');};const j=await f.browse.start({platform:'bilibili',minutes:1});await f.browse.active.done;const result=f.browse.get(j.id);assert.equal(result.status,'failed');assert.equal(result.analysed,0);assert.equal(f.video.budget().calls,1);assert.equal(f.video.budget().tokens,8000);assert.match(f.browse.report(result),/还没完成/);
});
test('many short clips use bounded contact sheets and never count unselected evidence as understood',async t=>{
 const f=fixture(t);f.browser.candidates=async()=>Array.from({length:15},(_,i)=>({url:'https://www.bilibili.com/video/BVshort'+i}));f.browser.observe=async(url,o)=>{await o.beforeTick();await o.onProgress({watchedSeconds:10});return {url,title:'短片',watchedSeconds:10,frames:[testFrame,testFrame],captions:'实际字幕',evidence:[{playbackSeconds:1},{playbackSeconds:6}],duration:10};};let images=0;f.runtime.engines.chat=async p=>{images=p.images.length;for(const image of p.images){const metadata=await sharp(Buffer.from(image.url.split(',')[1],'base64')).metadata();assert.equal(metadata.width,960);}return {reply:'已根据实际画面观察，部分视频未分析。',usage:{inputTokens:10,outputTokens:10}};};
 const j=await f.browse.start({platform:'bilibili',minutes:2});await f.browse.active.done;const result=f.browse.get(j.id);assert.equal(result.status,'completed',result.reason);assert.equal(result.clips,12);assert.equal(result.analysed,6);assert.equal(images,2);assert.equal(f.video.budget().calls,1);
});
test('video result respects voice-only delivery without duplicate text and keeps the active sticker policy',async t=>{
 const f=fixture(t),texts=[],voices=[],stickers=[];const config={platform:'qq',allowedUsers:['10'],allowedGroups:[],admins:[],defaults:{...f.policy,voiceMode:'only',stickers:true,stickerMode:'always'}};
 const b=new Bridge({config,store:f.store,persona:'角色',account:'99',onebot:{connected:true,reply:async(_e,text)=>{texts.push(text);return [{message_id:1}];}},codex:{},log:()=>{}});b.videoBrowse={allowed:()=>true};b.voice={config:()=>({maxChars:180})};b.voiceOnly=async(r,text)=>{voices.push(text);return {message_id:2};};b.media={candidates:()=>[{id:'fixture-meme'}]};b.deliverAsset=async(r,id)=>{stickers.push(id);};
 try{await b.sendVideoNotice({id:'fixture-job',scope:f.scope,creator:'10',personaId:'default'},'这轮刷完了，实际播放60秒。\n实际观察到的内容\nhttps://www.bilibili.com/video/BVtest');assert.equal(voices.length,1);assert.equal(texts.length,0);assert.equal(stickers.length,1);assert.ok(voices[0].length<=180);}finally{await b.stop();}
});
test('both normal and enhanced speech paths dispatch video before model/plugin and never run embedded quoted requests',async t=>{
 for(const enhanced of [false,true]){
  const f=fixture(t),store=f.store,config={platform:'qq',allowedUsers:['10'],allowedGroups:['20'],admins:[],wakeWords:['小鱼'],defaults:{...f.policy,speechInput:true,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands',rhythmMode:'instant'}};
  let dispatches=0,models=0,plugins=0;const b=new Bridge({config,store,persona:'角色',account:'99',onebot:{reply:async()=>[{message_id:1}]},codex:{chat:async()=>{models++;return {reply:'普通回答',memories:[]};}},log:()=>{}});b.videoBrowse={command:async r=>{dispatches++;assert.match(r.text,/看10分钟抖音/);return true;}};b.plugins={handle:async()=>{plugins++;return false;},cancel:()=>{}};b.speech={config:()=>({enabled:true}),transcribe:async()=>({text:'去看10分钟抖音',seconds:3,decodeMs:1,inferenceMs:1})};
  const e={post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:'voice-'+enhanced,message:[{type:'record',data:{file:'test'}}]};await b.handle(e);assert.equal(dispatches,1);assert.equal(models,0);assert.equal(plugins,0);await b.stop();
 }
});
