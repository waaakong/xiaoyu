import test from 'node:test';import assert from 'node:assert/strict';
import {waitBatch,batchParts,batchable,naturalGate} from '../src/message-batch.js';
import {Store} from '../src/store.js';import {Bridge} from '../src/bridge.js';import {validateChat} from '../src/config.js';
const entry=(at,text='文字',extra={})=>({receivedAt:at,rowId:at,quoteId:undefined,r:{scope:'qq:99:private:10',user:'10',account:'99',text,event:{message:[]},policy:{rhythmMode:'fast',mergeQueued:true,personaId:'default'},...extra}});
test('trailing quiet window resets on text/media and caps total wait without reading typing state',async()=>{
 let now=0;const a=entry(0),b=entry(1200),c=entry(2400,'图',{hasImages:true}),pending=[a];
 await waitBatch(a,()=>pending,undefined,{now:()=>now,wait:async ms=>{now+=ms;if(now>=1200&&!pending.includes(b))pending.push(b);if(now>=2400&&!pending.includes(c))pending.push(c);}});assert.equal(now,4900);
 now=0;const list=[entry(0)];await waitBatch(list[0],()=>list,undefined,{now:()=>now,wait:async ms=>{now+=ms;const last=list.at(-1);if(now-last.receivedAt>=1200&&list.length<8)list.push(entry(now));}});assert.equal(now,8000);
});
test('isolation, bounded attachments, max fragments, explicit commands and disabled modes',async()=>{
 const a=entry(0),b=entry(100),photo=entry(200,'图片',{hasImages:true,event:{message:[{type:'image',data:{file:'x'}}]}});assert.equal(batchParts(a,[a,b,photo]).length,3);
 for(const change of [{user:'11'},{scope:'qq:99:private:11'},{hasAudio:true},{hasForward:true},{social:{kind:'poke'}},{text:'/取消'},{policy:{...a.r.policy,engine:'dsh'}}])assert.equal(batchable(a,entry(100,'片段',change)),false);
 assert.equal(batchParts(a,[a,...Array.from({length:9},(_,i)=>entry(i+1))]).length,8);
 const imgs=Array.from({length:3},(_,i)=>entry(i+1,'图',{hasImages:true,event:photo.r.event}));assert.equal(batchParts(a,[a,...imgs]).length,3);
 assert.equal(await waitBatch(entry(0,'/状态'),()=>[],undefined),0);assert.equal(await waitBatch(entry(0,'文字',{policy:{rhythmMode:'instant'}}),()=>[],undefined),0);
});
test('natural wait varies, credits model time, honors disable and checks cancellation between bubbles',async()=>{
 let now=1600,waited=[];const gate=naturalGate({rhythmMode:'fast'},0,undefined,{now:()=>now,random:()=>0.5,wait:async ms=>{waited.push(ms);now+=ms;}});await gate.first();assert.deepEqual(waited,[4500]);await gate.packet();await gate.packet();assert.deepEqual(waited,[4500,600]);
 const slow=naturalGate({rhythmMode:'fast'},0,undefined,{now:()=>9999,wait:()=>{throw Error('no extra model wait');}});await slow.first();
 const off=naturalGate({naturalDelay:false},Date.now());await off.first();await off.packet();await off.packet();
 const controller=new AbortController(),cancel=naturalGate({},0,controller.signal,{now:()=>0,wait:async()=>controller.abort()});await assert.rejects(cancel.first(),/abort/i);
 assert.throws(()=>validateChat({aggregateTextMs:3000,aggregateMaxMs:1000}),/最长/);assert.throws(()=>validateChat({replyDelayMinMs:900,replyDelayMaxMs:100}),/最小/);
});
function fixture(t,{platform='qq',enhanced=false,chat,group=false,engine='dsh'}={}){
 const store=new Store(':memory:'),account=platform==='qq'?'99':'wxid_role',user=platform==='qq'?'10':'wxid_user',calls=[],sent=[],logs=[];
 const config={platform,allowedUsers:[user],allowedGroups:['20'],wakeWords:['小鱼'],followupSeconds:60,historyMessages:20,memoryChars:500,defaults:{engine,model:'vision',rhythmMode:'fast',aggregateTextMs:100,aggregateMediaMs:160,aggregateMaxMs:1000,naturalDelay:false,images:true,stickers:false,autoSummary:false,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands'}};
 const onebot={reply:async(e,text,o)=>{await o?.beforePart?.();o?.beforeSend?.();sent.push(text);return [{message_id:String(sent.length)}];}};
 const bridge=new Bridge({config,store,account,onebot,persona:'角色',media:{incoming:async segments=>segments.filter(s=>s.type==='image').map(s=>({url:'image:'+s.data.file}))},log:x=>logs.push(x),codex:{closed:false,chat:async p=>{calls.push(p);return chat?chat(p,calls.length):{reply:'收到',memories:[]};}}});
 if(enhanced)bridge.plugins={handle:async()=>false,enhance:async(_r,o)=>{const result=await o.model({purpose:'reply',system:'',prompt:'',contexts:[]},{signal:o.signal});await o.beforePacket?.();const route=o.prepareSend(result.reply);await o.onSent({message:[{type:'text',data:{text:route.text}}],receipt:{message_id:'mock'},signal:o.signal});sent.push(route.text);return {calls:1,sent:1};},cancel:()=>{}};
 const event=(text,id,image)=>({post_type:'message',message_type:group?'group':'private',...(group?{group_id:'20'}:{}),self_id:account,user_id:user,message_id:id,sender:{nickname:'测试'},message:[...(text?[{type:'text',data:{text}}]:[]),...(image?[{type:'image',data:{file:image}}]:[])]});
 const drain=async()=>{while(bridge.queues.size)await Promise.all([...bridge.queues.values()].map(q=>q.chain));};t.after(async()=>{await bridge.stop();store.close();});return {bridge,store,calls,sent,event,drain,config,logs};
}
for(const platform of ['qq','wechat'])for(const enhanced of [false,true])test(`${platform} enhanced=${enhanced}: text/photo both orders produce one model call with all media and original sources`,async t=>{
 const f=fixture(t,{platform,enhanced});await f.bridge.handle(f.event('看这个',1));await new Promise(r=>setTimeout(r,40));await f.bridge.handle(f.event('',2,'photo'));await f.bridge.handle(f.event('是什么',3));await f.drain();assert.equal(f.calls.length,1);assert.match(f.calls[0].text,/看这个/);assert.match(f.calls[0].text,/是什么/);assert.equal(f.calls[0].images.length,1);assert.equal(f.sent.length,1);assert.equal(f.store.db.prepare("SELECT count(*) n FROM messages WHERE role='user'").get().n,3);
 await f.bridge.handle(f.event('',4,'second'));await f.bridge.handle(f.event('再看图',5));await f.drain();assert.equal(f.calls.length,2);assert.equal(f.calls[1].images.length,1);assert.match(f.calls[1].text,/再看图/);
});
test('late fragment cancels an unsubmitted result, carries source text and emits one up-to-date answer',async t=>{
 let began,release;const ready=new Promise(r=>began=r),hold=new Promise(r=>release=r);const f=fixture(t,{chat:async(_p,n)=>{if(n===1){began();await hold;return {reply:'过时答案',memories:[]};}return {reply:'完整答案',memories:[]};}});
 await f.bridge.handle(f.event('我想问',1));await ready;await f.bridge.handle(f.event('图片含义',2,'photo'));release();await f.drain();assert.equal(f.calls.length,2);assert.match(f.calls[1].text,/我想问/);assert.match(f.calls[1].text,/图片含义/);assert.equal(f.calls[1].images.length,1);assert.deepEqual(f.sent,['完整答案']);
});
test('once submission starts a new fragment is a separate turn and cannot replay the old message',async t=>{
 let submitted,release;const ready=new Promise(r=>submitted=r),hold=new Promise(r=>release=r),f=fixture(t);f.bridge.onebot.reply=async(_e,text,o)=>{o.beforeSend();f.sent.push(text);if(f.sent.length===1){submitted();await hold;}return [{message_id:String(f.sent.length)}];};
 await f.bridge.handle(f.event('第一句话',1));await ready;await f.bridge.handle(f.event('下一句话',2));release();await f.drain();assert.equal(f.calls.length,2);assert.equal(f.calls[1].text,'下一句话');assert.equal(f.sent.length,2);
});
for(const platform of ['qq','wechat'])test(`${platform}: unawakened group photo waits for same author wakeup and does not borrow another member image`,async t=>{
 const f=fixture(t,{platform,group:true});await f.bridge.handle(f.event('',1,'same-author'));assert.equal(f.calls.length,0);
 await f.bridge.handle(f.event('小鱼 这是什么',2));await f.drain();assert.equal(f.calls.length,1);assert.equal(f.calls[0].images.length,1);assert.equal(f.calls[0].images[0].url,'image:same-author');
 const other=f.event('',3,'other-author');other.user_id=platform==='qq'?'11':'wxid_other';await f.bridge.handle(other);await f.bridge.handle(f.event('小鱼 再问一下',4));await f.drain();assert.equal(f.calls[1].images.length,0);
});
test('revoking a chat or cancelling during collection prevents model use and clears the pending work',async t=>{
 const f=fixture(t);await f.bridge.handle(f.event('先等一下',1));f.config.allowedUsers=[];f.bridge.cancel('qq:99:private:10');await f.drain();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
});
for(const platform of ['qq','wechat'])for(const engine of ['codex','dsh'])for(const enhanced of [false,true])test(`${platform}/${engine}/enhanced=${enhanced}: no model begins before input collection, even with history linking off`,async t=>{
 const f=fixture(t,{platform,engine,enhanced});f.config.defaults.contextLinking=false;
 await f.bridge.handle(f.event('第一条文字',1));assert.equal(f.calls.length,0,'first fragment must not start a model');
 await f.bridge.handle(f.event('补充的图片',2,'picture'));assert.equal(f.calls.length,0,'second fragment still belongs to the collection window');
 await f.drain();assert.equal(f.calls.length,1);assert.match(f.calls[0].text,/第一条文字/);assert.match(f.calls[0].text,/补充的图片/);assert.equal(f.calls[0].engine,engine);assert.equal(f.calls[0].images.length,1);assert.equal(f.sent.length,1);
});

for(const platform of ["qq","wechat"])for(const enhanced of [false,true])test(`${platform}/enhanced=${enhanced}: video and subsequent text reach a single model together`,async t=>{const f=fixture(t,{platform,enhanced});f.bridge.media.chatVideo={incoming:async segments=>{assert.equal(segments.filter(x=>x.type==="video").length,1);return {images:[{type:"image",url:"video-sheet"}],notice:"[视频采样0-3秒]"};}};const event=f.event("",1);event.message.push({type:"video",data:{file:"v"}});await f.bridge.handle(event);assert.equal(f.calls.length,0);await f.bridge.handle(f.event("说说这个视频",2));await f.drain();assert.equal(f.calls.length,1);assert.match(f.calls[0].text,/说说这个视频/);assert.match(f.calls[0].text,/视频采样/);assert.equal(f.calls[0].images.length,1);});

for(const platform of ["qq","wechat"])for(const enhanced of [false,true])test(`${platform}/enhanced=${enhanced}: explicit quote rereads an observed group sticker instead of only its placeholder`,async t=>{const f=fixture(t,{platform,enhanced,group:true}),photo=f.event("",1,"custom-sticker");await f.bridge.handle(photo);assert.equal(f.calls.length,0);const question=f.event("知道图里面有什么不",2);question.message.unshift({type:"at",data:{qq:question.self_id}},{type:"reply",data:{id:"1"}});await f.bridge.handle(question);await f.drain();assert.equal(f.calls.length,1);assert.equal(f.calls[0].images.length,1);assert.match(f.calls[0].images[0].url,/custom-sticker/);assert.match(f.calls[0].text,/明确引用/);const row=f.store.quoted(`${platform}:${question.self_id}:group:20`,"1");assert.equal(f.store.dialogue.quotedMedia(row.scope??`${platform}:${question.self_id}:group:20`,row.id,"other-persona").length,0);});

for(const enhanced of [false,true])test(`wechat/enhanced=${enhanced}: old quoted attachments are recovered only through an exact same-chat reader source`,async t=>{const f=fixture(t,{platform:"wechat",group:true,enhanced});let lookups=0;f.bridge.onebot.quotedMediaEvent=async()=>{lookups++;return {...f.event("",99,"recovered-image"),wechatServerId:"99"};};const q=f.event("知道图里有什么",2);q.message.unshift({type:"at",data:{qq:q.self_id}},{type:"reply",data:{id:"99"}});await f.bridge.handle(q);await f.drain();assert.equal(lookups,1);assert.equal(f.calls[0].images[0].url,"image:recovered-image");assert.match(f.calls[0].text,/明确引用/);});
