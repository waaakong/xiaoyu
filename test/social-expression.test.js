import test from 'node:test';import assert from 'node:assert/strict';
import {SOCIAL_EXPRESSION,socialProfile,socialReply,expressionEmotion} from '../src/social-expression.js';
import {memoryImportance,oldMemoryNotice} from '../src/memory-salience.js';
import {Store} from '../src/store.js';import {Bridge} from '../src/bridge.js';
import {Emotion} from '../src/emotion.js';
import {Media} from '../src/media.js';
import {naturalGate} from '../src/message-batch.js';
import {voiceTemplates,compileVoiceDirection,emotionTone} from '../src/voice-emotion.js';

test('persona rules are shared without replacing identity, traits or the explicit opt-out',()=>{
 const s=new Store(':memory:');try{const base='知夏喜欢安静，小鱼喜欢接梗';assert.match(s.personaInstructions(base,'10'),/知夏喜欢安静，小鱼喜欢接梗/);assert.match(s.personaInstructions(base,'10'),/日常表达与分寸/);assert.doesNotMatch(s.personaInstructions(base,'10',{humanStyle:false}),/日常表达与分寸/);assert.match(SOCIAL_EXPRESSION,/不随机改错生日/);assert.match(SOCIAL_EXPRESSION,/准确完整/);}finally{s.close();}
});
test('casual markup softens but tasks, URLs, code, facts and user formats stay intact',()=>{
 const casual=socialProfile({text:'你好呀',key:'turn1'});assert.equal(socialReply('### 哈喽\n- **好耶**\n总之，今天不错',casual),'哈喽\n好耶\n今天不错');
 for(const text of ['请列出三个步骤','分析这段代码','给我完整资料和来源','分成两段回答','紧急帮我','只回复收到'])assert.equal(socialProfile({text}).mode,'task');
 const task=socialProfile({text:'请列出步骤'});assert.equal(socialReply('1. 先保存\n2. 再退出',task),'1. 先保存\n2. 再退出');assert.equal(socialReply('```js\nlet a=1\n```',casual),'```js\nlet a=1\n```');assert.equal(socialReply('来源 https://example.com',casual),'来源 https://example.com');
});
test('mood changes length and pacing without forcing omissions or hostile treatment',()=>{
 const state={enabled:true,valence:0,axes:{energy:.2}},tired=socialProfile({text:'在干嘛',state,key:'one'});assert.equal(tired.tone,'tired');assert.equal(tired.bubbles,1);
 const happy={enabled:true,valence:.5,arousal:.7,axes:{energy:.8}};const profiles=Array.from({length:50},(_,i)=>socialProfile({text:'在干嘛',state:happy,key:String(i)}));assert.ok(new Set(profiles.map(p=>p.bubbles)).size>1);assert.equal(profiles[0].tone,'excited');assert.equal(socialProfile({text:'请帮我解释',state,key:'one'}).bubbles,3);
});
test('local rhythm and the same emotion snapshot drive text and voice, old voice templates fall back',()=>{
 const raw={enabled:true,valence:0,arousal:.2,axes:{energy:.7,interest:.2}},night=expressionEmotion(raw,{enabled:true,timeZone:'Asia/Shanghai',awakeStart:9,awakeEnd:22},{now:Date.parse('2026-11-16T15:00:00Z')});
 assert.equal(raw.axes.energy,.7);assert.ok(night.axes.energy<.3);assert.equal(socialProfile({text:'晚安',state:night}).tone,'tired');assert.equal(compileVoiceDirection(voiceTemplates[0],night).tone,'tired');const off={...raw,enabled:false};assert.equal(expressionEmotion(off,{enabled:true}),off);
 const bored={enabled:true,valence:0,axes:{energy:.7,interest:.05}};assert.equal(emotionTone(bored),'bored');assert.match(compileVoiceDirection(voiceTemplates[0],bored).instructions,/不敷衍/);
 const legacy={...voiceTemplates[0],mapping:Object.fromEntries(Object.entries(voiceTemplates[0].mapping).filter(([k])=>k!=='bored'))};assert.equal(compileVoiceDirection(legacy,bored).mappedTone,'neutral');
});
test('old memory gets a caution cue, never a fabricated replacement or weaker fixed identity',()=>{
 const now=Date.parse('2026-11-16T00:00:00Z'),old={key:'一起散步',value:'公园',type:'event',updated:'2025-01-01 00:00:00'};assert.match(oldMemoryNotice(old,now),/不补造/);assert.equal(oldMemoryNotice({...old,pinned:1},now),'');assert.equal(oldMemoryNotice({...old,type:'commitment'},now),'');assert.ok(memoryImportance({...old,evidence:'这件事很重要，请记住'})>memoryImportance(old));assert.ok(memoryImportance({type:'preference'})>memoryImportance({type:'fact'}));assert.equal(old.value,'公园');
});
test('emotion microvariation is bounded, idempotent and disabled when emotion is off',()=>{
 const s=new Store(':memory:');try{const e=new Emotion(s,{now:()=>1000}),a=e.observe('qq:99:private:10','p','你好',{turnId:'a',variation:true});assert.ok(Math.abs(a.valence)<=.02);assert.equal(e.observe('qq:99:private:10','p','你好',{turnId:'a',variation:true}).valence,a.valence);const b=e.observe('qq:99:private:11','p','你好',{turnId:'a',variation:true});assert.notEqual(a.valence,b.valence);e.configure({scope:'qq:99:private:10',personaId:'off',enabled:false});assert.equal(e.observe('qq:99:private:10','off','开心',{variation:true,turnId:'x'}).valence,0);}finally{s.close();}
});
test('natural timing credits elapsed model time, tired is slower, explicit tasks never get theatre delays',async()=>{
 const delays=[],run=async(state,mode='casual')=>{const timing={};await naturalGate({rhythmMode:'fast'},0,undefined,{now:()=>1600,random:()=>.5,state:()=>state,mode:()=>mode,wait:async n=>delays.push(n),timing}).first();return timing;};const regular=await run({enabled:true,axes:{energy:.7}}),tired=await run({enabled:true,axes:{energy:.2}});assert.ok(tired.replyDelayMs>regular.replyDelayMs);assert.equal((await run({},'task')).replyDelayMs,0);let slept=false;await naturalGate({},0,undefined,{now:()=>30000,wait:async()=>slept=true}).first();assert.equal(slept,false);
});
test('subtle sticker contrast permits only safe moods and never bypasses an explicit refusal or cooldown',()=>{
 const rows=['happy','daily','playful','angry','hurt'].map((m,i)=>({id:String(i),name:m==='angry'?'生气':m,caption:'',tags:[],kind:'sticker',mood:m})),media={eligible:()=>rows,sentState:()=>({at:0,ids:[]})};
 const out=Media.prototype.candidates.call(media,'随便聊聊',{mode:'active',emotionMood:'happy',emotionContrast:true});assert.ok(out.some(x=>x.mood==='daily'));assert.ok(out.every(x=>['happy','daily','playful'].includes(x.mood)));
 assert.deepEqual(Media.prototype.candidates.call(media,'不要发表情',{mode:'active',emotionMood:'happy',emotionContrast:true}),[]);media.sentState=()=>({at:Date.now(),ids:[]});assert.deepEqual(Media.prototype.candidates.call(media,'随便聊聊',{mode:'active',cooldownSeconds:30,emotionMood:'happy',emotionContrast:true}),[]);
});
for(const platform of ['qq','wechat'])for(const enhanced of [false,true])test(`${platform} enhanced=${enhanced}: dialogue gets one shared style/state, voice and stickers retain their separate gates`,async t=>{
 const s=new Store(':memory:'),user=platform==='qq'?'10':'wx_user',account=platform==='qq'?'99':'wx_role',models=[],sent=[];
 const config={platform,allowedUsers:[user],allowedGroups:[],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500,defaults:{humanStyle:true,rhythmMode:'instant',naturalDelay:false,voiceMode:'off',stickers:false,autoSummary:false,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands'}};
 const bridge=new Bridge({store:s,config,account,persona:'我是小鱼，喜欢接梗',onebot:{reply:async(_e,body,o)=>{o?.beforeSend?.();sent.push(body);return [{message_id:'mock'}];}},codex:{chat:async p=>{models.push(p);return {reply:'### 哈喽\n- **好耶**',memories:[]};}},log:()=>{}});
 if(enhanced)bridge.plugins={handle:async()=>false,cancel:()=>{},enhance:async(_r,o)=>{const a=await o.model({purpose:'reply',prompt:'',contexts:[]},{}),route=o.prepareSend(a.reply);await o.onSent({message:[{type:'text',data:{text:route.text}}],receipt:{message_id:'mock'}});sent.push(route.text);return {calls:1,sent:1};}};
 try{await bridge.handle({post_type:'message',message_type:'private',self_id:account,user_id:user,message_id:'1',message:[{type:'text',data:{text:'你好呀'}}]});await Promise.all([...bridge.queues.values()].map(q=>q.chain));assert.equal(models.length,1);assert.match(models[0].persona,/日常表达与分寸/);assert.match(models[0].persona,/本轮表达状态/);assert.deepEqual(sent,['哈喽\n好耶']);}finally{await bridge.stop();s.close();}
});
