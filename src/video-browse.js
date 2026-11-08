import {videoStartText,videoChatReport,videoAnalysisPrompt} from './companion-task-text.js';
import {videoContactSheets} from './video-contact-sheet.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {videoKey} from './video-browser.js';
import {videoIntent} from './video-intent.js';
const hash=x=>createHash('sha256').update(Buffer.isBuffer(x)||typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const running=new Set(['running','paused','waiting-chat','understanding']);

export class VideoBrowse {
 constructor(video,{now=Date.now,sleep=delay}={}){
  this.video=video;this.runtime=video.runtime;this.db=video.db;this.now=now;this.sleep=sleep;this.active=null;this.closed=false;
  this.db.exec('CREATE TABLE IF NOT EXISTS video_browse_jobs(id TEXT PRIMARY KEY,sourceKey TEXT UNIQUE,data TEXT,updated INTEGER)');
  for(const row of this.db.prepare('SELECT * FROM video_browse_jobs').all()){const j=JSON.parse(row.data);if(running.has(j.status)){j.status='interrupted';j.reason='进程停止，未自动重放';this.save(j);}}
 }
 settings(){return {chatEnabled:true,chatUsers:[],...JSON.parse(this.runtime.store.meta('video-browse-settings')??'{}')};}
 configure(p){if(!p||Object.keys(p).some(k=>!['chatEnabled','chatUsers'].includes(k))||p.chatEnabled!==undefined&&typeof p.chatEnabled!=='boolean'||p.chatUsers!==undefined&&(!Array.isArray(p.chatUsers)||p.chatUsers.length>32||p.chatUsers.some(s=>typeof s!=='string'||!/^[-\w]{1,128}$/.test(s))))throw Error('聊天视频授权设置无效');this.runtime.store.meta('video-browse-settings',JSON.stringify({...this.settings(),...p}));return this.state();}
 allowed(user){const c=this.settings(),owner=this.runtime.store.meta('fixed-memory-owner');return c.chatEnabled&&!!user&&(String(user)===owner||c.chatUsers.includes(String(user)));}
 save(j){this.db.prepare('UPDATE video_browse_jobs SET data=?,updated=? WHERE id=?').run(JSON.stringify(j),this.now(),j.id);}
 get(id){const r=this.db.prepare('SELECT data FROM video_browse_jobs WHERE id=?').get(id);if(!r)throw Error('视频任务不存在');return JSON.parse(r.data);}
 state(){return {settings:this.settings(),active:this.active?this.get(this.active.job.id):null,jobs:this.db.prepare('SELECT data FROM video_browse_jobs ORDER BY updated DESC LIMIT 20').all().map(r=>JSON.parse(r.data))};}
 domain(){return this.runtime.accounts?.domain()??this.runtime.platform+':'+(this.runtime.accountId??this.runtime.account??this.runtime.store.meta('lastAccount')??'local');}
 paused(scope,creator){return !!scope&&!!creator&&this.runtime.store.isPaused(scope.includes(':group:')?scope+':member:'+creator:scope);}
 modelFor(p,engine){return p.model??(engine==='dsh'?this.runtime.engines.config?.model:this.runtime.engines.client?.(engine)?.config?.model??this.runtime.configuration().model)??null;}
 fresh(j){
  if(this.closed||this.runtime.closing||this.paused(j.scope,j.creator)||this.domain()!==j.domain||hash(this.runtime.store.persona(j.personaId)?.text??'')!==j.personaHash||this.runtime.store.meta('memory-reset-at')!==j.memoryFence||hash(this.video.settings())!==j.settingsHash)throw Error('运行账号、人格、暂停状态或视频设置已变化');
  if(j.scope){const p=this.runtime.life.assertChat(j.scope,j.personaId);if((p.engine??null)!==j.policyEngine||(p.model??null)!==j.policyModel||(this.runtime.engines.selected?.(p.engine)??p.engine??'codex')!==j.engine)throw Error('聊天模型设置已变化');if(!this.runtime.onebot?.connected||j.creator&&(!this.allowed(j.creator)||p.allowedSenders?.length&&j.scope.includes(':group:')&&!p.allowedSenders.includes(j.creator)))throw Error('聊天离线或任务授权已变化');}
  if((this.runtime.engines.selected?.(j.policyEngine)??j.policyEngine??'codex')!==j.engine||this.modelFor({model:j.policyModel},j.engine)!==j.model)throw Error('本轮引擎或默认模型已变化');
 }
 async start({platform,minutes=10,query='',scope='',personaId,creator='',sourceKey='',notify=false}={}){
  if(this.closed||this.active||this.video.active||this.runtime.busy||this.runtime.maintenance?.size)throw Error('已有视频任务，请先停止或等待完成');
  if(!['bilibili','douyin'].includes(platform)||!Number.isInteger(minutes)||minutes<1||minutes>30||typeof query!=='string'||query.length>150||typeof notify!=='boolean')throw Error('请选择平台及1—30分钟观看时长');
  const c=this.video.settings(),p=scope?this.runtime.life.assertChat(scope,personaId):this.video.assertContext({...c,scope:'',personaId:personaId??c.personaId});personaId??=p.personaId??c.personaId;
  if(creator&&!this.allowed(creator))throw Error('仅主人或本机指定成员可启动视频任务');
  if(this.paused(scope,creator))throw Error('当前聊天已暂停，请先恢复聊天');
  const cooldown=Number(this.runtime.store.meta('video-cooldown:'+platform)??0);if(cooldown>this.now())throw Error('平台风控暂停中，请在专用浏览器处理');
  if(sourceKey){const old=this.db.prepare('SELECT id FROM video_browse_jobs WHERE sourceKey=?').get(sourceKey);if(old)return this.get(old.id);}
  const b=this.video.budget();if(b.seconds+minutes*60>b.limits.seconds||b.calls>=b.limits.calls||b.tokens+8000>b.limits.tokens)throw Error('本轮超过剩余观看或理解预算，请先在本机调整');
  const j={id:randomUUID(),platform,scope,creator,personaId,policyEngine:p.engine??null,policyModel:p.model??null,engine:this.runtime.engines.selected?.(p.engine)??p.engine??'codex',model:p.model??null,query,notify:!!notify&&!!scope,domain:this.domain(),targetSeconds:minutes*60,watchedSeconds:0,clips:0,analysed:0,seen:[],pending:[],status:'running',stage:'preparing',created:this.now(),deadline:this.now()+minutes*180000+120000,personaHash:hash(this.runtime.store.persona(personaId)?.text??''),memoryFence:this.runtime.store.meta('memory-reset-at'),settingsHash:hash(c),report:'',delivery:'not-requested'};
  j.model=this.modelFor(p,j.engine);
  this.db.prepare('INSERT INTO video_browse_jobs VALUES(?,?,?,?)').run(j.id,sourceKey||null,JSON.stringify(j),this.now());
  this.db.prepare("INSERT INTO video_jobs VALUES(?,?,?,?,'running',?,NULL,'')").run(j.id,platform,personaId,scope,this.now());
  this.launch(j);return j;
 }
 launch(job){const a={job,controller:new AbortController(),manualPause:false,idleUntil:0};this.active=a;a.done=this.run(a).catch(e=>this.runtime.log?.('视频任务停止：'+String(e.message).slice(0,120)));this.work=a.done;}
 foreground(){if(this.active){this.active.idleUntil=this.now()+2000;this.active.modelController?.abort();void this.video.browser.pause();}}
 pause(){if(this.active){this.active.manualPause=true;void this.video.browser.pause();}return this.state();}
 async resume({id}={}){
  if(this.active){this.active.manualPause=false;this.active.idleUntil=0;return this.state();}
  const j=this.get(id);if(!['needs-login','paused','failed'].includes(j.status)||j.watchedSeconds>=j.targetSeconds&&!j.pending.length||j.domain!==this.domain())throw Error('该任务不能恢复，已中断的进程任务需重新发起');this.fresh(j);j.deadline=this.now()+Math.max(60000,(j.targetSeconds-j.watchedSeconds)*3000+120000);j.status='running';j.reason='';this.save(j);this.launch(j);return this.state();
 }
 stop(reason='user'){if(typeof reason!=='string')reason='user';if(this.active){this.active.reason=reason;this.active.controller.abort();this.active.modelController?.abort();}void this.video.browser.pause();return this.state();}
 async gate(a){let paused=false;const j=a.job;
  while(a.manualPause||this.now()<a.idleUntil||this.runtime.bridge?.total||this.runtime.life.active||this.runtime.notebook?.active||this.runtime.learningQueue?.active){a.controller.signal.throwIfAborted();this.fresh(j);if(this.now()>j.deadline)throw Error('超过墙钟时限，未用暂停时间冒充观看');if(!paused){paused=true;await this.video.browser.pause();}j.status=a.manualPause?'paused':'waiting-chat';this.save(j);await this.sleep(250,null,{signal:a.controller.signal});}
  this.fresh(j);a.controller.signal.throwIfAborted();if(this.now()>j.deadline)throw Error('超过墙钟时限');j.status='running';return paused;
 }
 async run(a){const j=a.job,c=this.video.settings(),signal=a.controller.signal;let pool=[],lastAnalysis=j.watchedSeconds,shorts=0;
  const timer=setTimeout(()=>{a.reason='wall-time-limit';a.controller.abort();a.modelController?.abort();},Math.max(1,j.deadline-this.now()));timer.unref?.();
  try{
   while(j.watchedSeconds<j.targetSeconds-.1){
    await this.gate(a);const budget=this.video.budget();if(budget.seconds>=budget.limits.seconds)throw Object.assign(Error('观看时长预算用尽'),{code:'VIDEO_BUDGET'});
    if(!pool.length){j.stage='finding';this.save(j);pool=await this.video.browser.candidates(j.platform,{query:j.query,signal,limit:30,exclude:j.seen});if(!pool.length)throw Object.assign(Error('没有新的可播放作品，未重复循环冒充观看'),{code:'VIDEO_NO_CANDIDATES'});}
    const candidate=pool.shift(),url=candidate.url.split('?')[0];if(j.seen.some(x=>videoKey(x)===videoKey(url)))continue;j.seen.push(url);if(j.seen.length>180)throw Error('达到本轮换片上限');
    const itemId=randomUUID(),remaining=Math.min(30,j.targetSeconds-j.watchedSeconds,budget.limits.seconds-budget.seconds),base=j.watchedSeconds;
    let progress=0;j.stage='playing';j.current={url,title:candidate.title??'',itemId};this.save(j);
    this.db.prepare('INSERT INTO video_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(itemId,j.id,j.platform,j.personaId,j.scope,url,candidate.title??'',JSON.stringify({scope:'playing',watchedSeconds:0,wallSeconds:0}),'','仅实际采样范围','',this.now(),'observed');
    let observation;
    try{observation=await this.video.browser.observe(url,{signal,maxFrames:Math.min(2,c.frameLimit),seconds:remaining,continuous:true,audio:c.asr,beforeTick:()=>this.gate(a),onProgress:p=>{this.fresh(j);progress=Math.min(remaining,Math.max(progress,Number(p.watchedSeconds)||0));j.watchedSeconds=base+progress;j.current={...j.current,title:p.title||candidate.title,position:p.position};this.db.prepare('UPDATE video_items SET observation=? WHERE id=?').run(JSON.stringify({scope:'playing',watchedSeconds:progress,wallSeconds:progress,position:p.position}),itemId);this.save(j);}});}
    catch(e){if(signal.aborted)throw e;if(['VIDEO_STALLED','VIDEO_NOT_OBSERVED'].includes(e.code)&&++shorts<=2){this.db.prepare("UPDATE video_items SET status='unavailable' WHERE id=?").run(itemId);continue;}throw e;}
    await this.gate(a);j.watchedSeconds=base+Math.min(remaining,Math.max(progress,observation.watchedSeconds||0));if(j.watchedSeconds-base<.1){if(++shorts>2)throw Error('连续作品没有有效播放进度');continue;}shorts=0;j.clips++;
    const directory=path.join(this.video.base,'evidence',itemId);fs.mkdirSync(directory,{recursive:true});const frames=observation.frames.slice(0,2).map((bytes,i)=>{if(!Buffer.isBuffer(bytes)||bytes.length>5*1024*1024)throw Error('画面证据过大');const name=i+'.jpg';fs.writeFileSync(path.join(directory,name),bytes,{mode:0o600});return {name,hash:hash(bytes),size:bytes.length};});
    let transcript='';if(c.asr&&observation.audio?.length){try{transcript=(await this.runtime.speech.enqueue(()=>this.runtime.speech.local(observation.audio,{signal}))).text?.slice(0,3000)??'';}catch{signal.throwIfAborted();}}
    const safe={...observation,frames,audio:undefined,transcript,watchedSeconds:j.watchedSeconds-base,wallSeconds:j.watchedSeconds-base,notice:'真实播放累计；内容理解仅覆盖画面采样与实际字幕，不代表完整观看每部作品'};
    this.db.prepare('UPDATE video_items SET observation=?,title=? WHERE id=?').run(JSON.stringify(safe),safe.title||candidate.title,itemId);j.pending.push(itemId);this.save(j);
    if(j.watchedSeconds-lastAnalysis>=180){await this.analyse(a);lastAnalysis=j.watchedSeconds;}
   }
   while(j.pending.length){await this.analyse(a);await this.gate(a);}this.fresh(j);j.status='completed';j.stage='completed';
  }catch(e){j.status=signal.aborted?'cancelled':['VIDEO_LOGIN_REQUIRED','VIDEO_RATE_LIMIT'].includes(e.code)?'needs-login':e.code==='VIDEO_BUDGET'?'budget-limited':'failed';j.reason=signal.aborted?a.reason??'cancelled':String(e.message).slice(0,180);if(e.code==='VIDEO_RATE_LIMIT')this.runtime.store.meta('video-cooldown:'+j.platform,this.now()+300000);}
  finally{
   clearTimeout(timer);await this.video.browser.pause();j.finished=this.now();j.current=null;this.save(j);this.db.prepare('UPDATE video_jobs SET status=?,finished=?,reason=? WHERE id=?').run(j.status,j.finished,j.reason??'',j.id);this.runtime.life.emit({kind:j.status==='completed'?'completed':j.status==='failed'?'failed':'cancelled',service:'video',scope:j.scope,personaId:j.personaId,key:j.id,reason:j.reason??'连续浏览完成'});if(this.active===a)this.active=null;
   if(j.notify&&!this.closed&&j.status!=='cancelled'){j.delivery='pending';this.save(j);let dispatched=false;try{this.fresh(j);if(this.notify){dispatched=true;await this.notify(j,videoChatReport(j));j.delivery='sent';}else j.delivery='unavailable';}catch(e){j.delivery=!dispatched||e.deliveryAttempted===false?'not-sent':'unknown';j.deliveryReason=String(e.message??'回传失败').slice(0,180);this.runtime.log?.('视频任务回传未确认：'+j.deliveryReason);}this.save(j);}
  }
 }
 async analyse(a){
  await this.gate(a);const j=a.job,b=this.video.budget(),signal=a.controller.signal;if(b.calls>=b.limits.calls||b.tokens+8000>b.limits.tokens)throw Object.assign(Error('理解预算用尽，已看部分保留，不能声称已学会'),{code:'VIDEO_BUDGET'});
  const pending=[...j.pending],selected=pending.length<=6?pending:[...new Set(Array.from({length:6},(_,i)=>pending[Math.round(i*(pending.length-1)/5)]))],items=selected.map(id=>this.video.item(id)),vision=this.runtime.engines.visionSupport?.(j.engine,j.model)!==false,images=[];
  if(vision){const sheets=await videoContactSheets(items,(itemId,index)=>Buffer.from(this.video.frame({itemId,index}).base64,'base64'));for(const bytes of sheets)images.push({type:'image',url:'data:image/jpeg;base64,'+bytes.toString('base64'),detail:'auto'});}
  if(!images.length&&!items.some(i=>i.observation.captions||i.observation.transcript))throw Error('模型未获得可理解的画面或字幕，不能只按标题编造');
  const callId=randomUUID(),controller=new AbortController();a.modelController=controller;j.stage='understanding';this.save(j);this.db.prepare("INSERT INTO video_calls VALUES(?,?,?,'running',8000,NULL,?)").run(callId,j.id,j.scope||'preview:video:'+this.runtime.platform+':'+j.personaId,this.now());let response,status='failed';
  try{
   response=await this.runtime.engines.chat({responseMode:'structured',scope:j.scope||'preview:video:'+this.runtime.platform+':'+j.personaId,engine:j.engine,model:j.model,persona:this.runtime.store.personaInstructions(videoAnalysisPrompt(this.runtime.store.persona(j.personaId).text),'local-video'),text:JSON.stringify(items.map((i,index)=>({clip:index+1,url:i.url,title:i.title,seconds:i.observation.watchedSeconds,captions:(i.observation.captions??'').slice(0,2500),transcript:i.observation.transcript,frames:vision?Math.min(2,i.observation.frames?.length??0):0,frameTimes:i.observation.evidence}))),images,history:[],memory:'',summary:'',assets:[],webSearch:false,user:'local-video',signal:AbortSignal.any([signal,controller.signal])});
   this.fresh(j);signal.throwIfAborted();controller.signal.throwIfAborted();let parsed;const body=String(response.reply??'').replace(/^```(?:json)?\s*|\s*```$/gu,'').trim();try{parsed=JSON.parse(body);}catch{parsed={summary:body};}if(typeof parsed.summary!=='string'||!parsed.summary.trim()||parsed.summary.length>2000||/<think>|xiaoyu-meta/u.test(parsed.summary))throw Error('观看总结格式无效');
   for(const item of items)this.db.prepare("UPDATE video_items SET summary=?,uncertainty='批次总结，仅依据采样',status='analysed' WHERE id=?").run(parsed.summary,item.id);
   if(typeof parsed.topic==='string'&&parsed.topic.length<=20&&parsed.topic.trim())this.video.interest({itemId:items[0].id,topic:parsed.topic,score:.1,basis:'observed-playback'});
   j.chatReply=typeof parsed.chat==='string'&&parsed.chat.trim().length<=100?parsed.chat.trim():'';j.notes=[...(j.notes??[]),parsed.summary].slice(-15);j.report=j.notes.map((n,i)=>(i+1)+'. '+n.slice(0,220)).join('\n').slice(0,1600);j.analysed+=items.length;j.pending=[];status='completed';
  }catch(e){if(controller.signal.aborted&&!signal.aborted){j.stage='waiting-chat';return;}throw e;}
  finally{a.modelController=null;this.db.prepare('UPDATE video_calls SET status=?,usage=? WHERE id=?').run(controller.signal.aborted||signal.aborted?'cancelled':status,JSON.stringify(response?.usage??null),callId);if(response?.usage)this.runtime.store.usage(j.scope||'preview:video:'+this.runtime.platform+':'+j.personaId,{...response.usage,kind:'video-browse',status,engine:j.engine,model:j.model});this.save(j);}
 }
 report(j){const label=j.platform==='douyin'?'抖音':'B站';return `${j.status==='completed'?'这轮刷完了':'这轮还没完成'}：${label}实际播放累计${Math.floor(j.watchedSeconds)}秒/目标${j.targetSeconds}秒，${j.clips}条不同作品，已分析${j.analysed}条。${j.reason?'原因：'+j.reason+'。':''}\n${j.report||'暂无足够依据形成学习结论。'}\n${this.db.prepare("SELECT url FROM video_items WHERE jobId=? AND status='analysed' ORDER BY created DESC LIMIT 2").all(j.id).map(x=>x.url).join('\n')}\n仅依据采样画面和实际字幕；未点赞、评论或关注。`;}
 async command(r){
  const intent=videoIntent(r.text);if(!intent||this.paused(r.scope,r.user))return false;
  const sourceId=this.runtime.store.add(r.scope,'user',r.text,'received',r.speaker??JSON.stringify({id:r.user}),String(r.event.message_id));this.runtime.store.tagTurn(sourceId,r.policy.personaId,'video-request:'+sourceId);
  const reply=text=>this.runtime.bridge.sendVideoNotice({scope:r.scope,creator:r.user,personaId:r.policy.personaId,request:r.text},text,{control:true});
  if(!this.allowed(r.user)){await reply('刷视频任务只允许主人或本机指定成员发起。');return true;}
  let answer;
  try{
   if(intent.action==='clarify')answer='去抖音还是B站呀 想让我看几分钟';
   else if(intent.action==='start'){const j=await this.start({...intent,scope:r.scope,creator:r.user,personaId:r.policy.personaId,sourceKey:r.scope+':'+r.event.message_id,notify:true});answer=videoStartText(j);}
   else{const j=this.active?.job??this.state().jobs.find(x=>x.scope===r.scope&&x.creator===r.user);if(!j||j.scope!==r.scope||j.creator!==r.user)throw Error('这个聊天里还没有在刷的视频');if(intent.action==='status')answer=this.report(j);else{if(intent.action==='stop')this.stop();if(intent.action==='pause')this.pause();if(intent.action==='resume')await this.resume({id:j.id});answer=intent.action==='stop'?'好 不刷了':intent.action==='pause'?'好 先停着 想接着看就叫我':'好 接着看';}}
  }catch(e){answer='没刷起来 '+String(e.message).slice(0,180);}
  // Notice delivery failure does not mean start failed. Never submit a
  // second paid synthesis after a delivery with an unknown result.
  await reply(answer);return true;
 }
 async close(){this.closed=true;this.stop('service-stop');await this.work;}
}
