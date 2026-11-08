import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store} from '../src/store.js';
import {Media} from '../src/media.js';
import {MemeLearning} from '../src/meme-learning.js';
import {validMemeInsights} from '../src/meme-analysis.js';
import {chatResponse} from '../integrations/dsh/structured-response.mjs';
import {Bridge} from '../src/bridge.js';

const scope='qq:99:group:20';
const analysis=(patch={})=>({imageId:'m0',mediaType:'sticker',sensitive:false,confidence:.96,caption:'猫咪点头',meaning:'通常用于赞同',contextMeaning:'这次是在安慰对方',mood:'happy',tags:['点头','认同'],favorite:true,likeScore:90,reason:'符合温和幽默的人格',usage:'赞同或安慰',avoid:'严肃争执时避免误解',...patch});
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xy-meme-learning-')),store=new Store(':memory:'),media=new Media(store,directory);let now=Date.parse('2026-11-07T04:00:00Z'),calls=0;
 const p={enabled:true,images:true,stickers:true,personaId:'default',memeAutoCollect:true,memeBackground:true},bytes=await sharp(Buffer.from('<svg width="80" height="80"><rect width="80" height="80" fill="white"/><circle cx="40" cy="40" r="20" fill="blue"/></svg>')).png().toBuffer();
 const bot={readImage:async()=>bytes},engines={selected:()=> 'codex',visionSupport:()=>true,chat:async()=>{calls++;return {reply:'分析完成',memories:[],memeInsights:[analysis()],usage:{inputTokens:30,outputTokens:10}};}};
 const learner=new MemeLearning({store,media,engines,policy:()=>p,onebot:()=>bot,persona:()=>({name:'小鱼',text:'温和幽默'}),now:()=>now});clearInterval(learner.timer);
 learner.configure({enabled:true});
 const make=(sc=scope,user='10')=>{const id=store.add(sc,'user','[用户发送了图片]','received',JSON.stringify({id:user}));store.tagTurn(id,p.personaId,'meme-'+id);return {sourceId:id,r:{scope:sc,user,group:sc.includes(':group:')?sc.split(':')[3]:null,policy:{...p},text:'别难过',event:{message:[{type:'image',data:{file:'local-test'}}]}}};};
 t.after(async()=>{await learner.close();store.close();if(path.dirname(directory)!==os.tmpdir())throw Error('Unexpected fixture path');fs.rmSync(directory,{recursive:true,force:true});});
 return {directory,store,media,learner,p,bytes,bot,engines,make,calls:()=>calls,advance:n=>{now+=n;}};
}
test('semantic metadata stays out of chat text; malformed analysis never grants collection',()=>{
 const v=analysis(),parsed=chatResponse('收到\n```xiaoyu-meta\n'+JSON.stringify({memories:[],memeInsights:[v]})+'\n```');assert.equal(parsed.reply,'收到');assert.deepEqual(parsed.memeInsights,[v]);
 for(const patch of [{imageId:'forged'},{confidence:2},{sensitive:'false'},{likeScore:101},{extra:'field'}])assert.equal(validMemeInsights([analysis(patch)]).length,0);
});
test('self collection preserves original image and enforces origin, persona, account and platform at selection and send',async t=>{
 const h=await fixture(t),{r,sourceId}=h.make(),packet=await h.learner.prepare(r);assert.equal(packet.images.length,1);await h.learner.consume(r,packet,{memeInsights:[analysis()]},{sourceId});const item=h.learner.dashboard().items[0];assert.ok(item);assert.deepEqual(h.media.read(item.assetId).bytes,h.bytes);
 assert.equal(h.media.eligible(scope,'','default').length,1);for(const [sc,persona]of [['qq:99:group:21','default'],[scope,'other'],['qq:98:group:20','default'],['wechat:wx_role:group:20','default']]){assert.equal(h.media.eligible(sc,'',persona).length,0);await assert.rejects(h.media.sendBytes(item.assetId,{scope:sc,personaId:persona}));}
 h.learner.edit({id:item.assetId,shared:true});assert.equal(h.media.eligible('qq:99:group:21','','default').length,1);assert.equal(h.media.eligible('qq:98:group:21','','default').length,0);h.learner.edit({id:item.assetId,shared:false});assert.equal(h.media.eligible('qq:99:group:21','','default').length,0);
 h.store.db.prepare('INSERT INTO memory_blocked VALUES(?,?)').run(scope,sourceId);assert.equal(h.media.eligible(scope,'','default').length,0);
});
test('cached visual meaning is stable while contextual meaning and taste remain per-turn; duplicates add only a new source grant',async t=>{
 const h=await fixture(t),first=h.make(),packet=await h.learner.prepare(first.r);await h.learner.consume(first.r,packet,{memeInsights:[analysis()]},{sourceId:first.sourceId});
 const second=h.make('qq:99:group:21'),cached=await h.learner.prepare(second.r);assert.equal(cached.images.length,0);assert.equal(cached.context.images[0].knownVisual.meaning,'通常用于赞同');assert.equal(cached.context.images[0].knownVisual.contextMeaning,undefined);
 await h.learner.consume(second.r,cached,{memeInsights:[analysis({contextMeaning:'这次是轻轻调侃'})]},{sourceId:second.sourceId});assert.equal(h.learner.dashboard().items.length,1);assert.equal(h.media.eligible(second.r.scope,'','default').length,1);assert.equal(h.learner.dashboard().items[0].origins.length,2);
});
test('photos, sensitive images, unclear memes and disliked memes do not become self-owned assets',async t=>{
 const h=await fixture(t),{r,sourceId}=h.make(),packet=await h.learner.prepare(r);
 for(const patch of [{mediaType:'photo'},{mediaType:'screenshot'},{sensitive:true},{confidence:.4},{favorite:false},{likeScore:10}])await h.learner.consume(r,packet,{memeInsights:[analysis(patch)]},{sourceId});
 assert.equal(h.learner.dashboard().items.length,0);assert.ok(h.learner.dashboard().decisions.length>=6);
});
test('disabled collection still permits understanding; changing permission during import cannot publish an unowned temporary asset',async t=>{
 const h=await fixture(t),{r,sourceId}=h.make(),packet=await h.learner.prepare(r);h.p.memeAutoCollect=false;await h.learner.consume(r,packet,{memeInsights:[analysis()]},{sourceId});assert.equal(h.learner.dashboard().items.length,0);
 h.p.memeAutoCollect=true;const original=h.media.import.bind(h.media);h.media.import=async p=>{const a=await original(p);assert.equal(h.media.eligible(scope,'','default').some(x=>x.id===a.id),false);h.p.memeAutoCollect=false;return a;};await h.learner.consume(r,packet,{memeInsights:[analysis()]},{sourceId});assert.equal(h.learner.dashboard().items.length,0);assert.equal(h.media.eligible(scope,'','default').length,0);
});
test('background learning has no outbound send, uses one model call, accounts tokens and obeys budget',async t=>{
 const h=await fixture(t),first=h.make();h.learner.enqueue(first.r,first.sourceId);await h.learner.tick();assert.equal(h.calls(),1);assert.equal(h.learner.daily().tokens,40);assert.equal(h.learner.daily().analyzed,1);assert.equal(h.learner.daily().reserved,0);
 h.learner.configure({dailyTokens:1000});const second=h.make();h.learner.enqueue(second.r,second.sourceId);await h.learner.tick();assert.equal(h.calls(),1);assert.equal(h.learner.dashboard().jobs[0].status,'limited');
});
test('failed background jobs are not retried and consume reserved budget when usage is unknown',async t=>{
 const h=await fixture(t);h.engines.chat=async()=>{throw Error('SERVER');};const first=h.make();h.learner.enqueue(first.r,first.sourceId);await h.learner.tick();await h.learner.tick();assert.equal(h.learner.daily().tokens,8000);assert.equal(h.learner.daily().reserved,0);assert.equal(h.learner.dashboard().jobs[0].status,'failed');
});
test('foreground activity cancels background model work and source revocation blocks new queue work',async t=>{
 const h=await fixture(t),first=h.make();let began;const start=new Promise(r=>began=r);h.engines.chat=async({signal})=>{began();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};h.learner.enqueue(first.r,first.sourceId);const work=h.learner.tick();await start;h.learner.foreground();await work;assert.equal(h.learner.dashboard().jobs[0].status,'cancelled');
 h.store.db.prepare('INSERT INTO memory_blocked VALUES(?,?)').run(scope,first.sourceId);h.learner.enqueue(first.r,first.sourceId);assert.equal(h.learner.pending.length,0);
});
test('the full normal chat path reuses image analysis, collects once and never exposes the metadata as a message',async t=>{
 const h=await fixture(t),sent=[],config={allowedUsers:['10'],allowedGroups:[],admins:[],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500,defaults:{images:true,stickers:false,voiceMode:'off',memeAutoCollect:true,autoSummary:false,rhythmMode:'instant'}};
 const b=new Bridge({config,store:h.store,persona:'小鱼',media:h.media,codex:h.engines,log:()=>{},onebot:{...h.bot,reply:async(_event,text)=>{sent.push(text);return [{message_id:1}];}}});b.memeLearning=h.learner;t.after(()=>b.stop());
 await b.handle({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:1,message:[{type:'image',data:{file:'local-test'}}]});await Promise.all([...b.queues.values()].map(q=>q.chain));assert.equal(h.calls(),1);assert.deepEqual(sent,['分析完成']);assert.equal(h.learner.dashboard().items.length,1,JSON.stringify(h.learner.dashboard()));
});
