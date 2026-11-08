import {randomUUID} from 'node:crypto';
import {parseScope,validId} from './chat-identity.js';
import {parseScheduledRequest,parseLocalTime,taskIntent,beijingStamp} from './scheduled-time.js';

export const scheduledDefaults={enabled:false,creators:[]};
export function validateScheduled(v){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(scheduledDefaults,k))||v.enabled!==undefined&&typeof v.enabled!=='boolean'||v.creators!==undefined&&(!Array.isArray(v.creators)||v.creators.length>30||v.creators.some(x=>typeof x!=='string'||!/^[-\w@.]{1,160}$/.test(x))||new Set(v.creators).size!==v.creators.length))throw Error('定时任务设置无效');return {...scheduledDefaults,...v};}
const settingsDefaults={enabled:false,maxPending:5,dailyLimit:20,graceSeconds:300};
export class ScheduledTasks {
  constructor({store,platform,policy,ready,send,generate,now=Date.now,log=()=>{}}){
    Object.assign(this,{store,db:store.db,platform,policy,ready,send,generate,now,log});this.active=new Map();this.preparing=new Map();this.closed=false;
    this.db.exec(`CREATE TABLE IF NOT EXISTS scheduled_tasks(id TEXT PRIMARY KEY,scope TEXT NOT NULL,creator TEXT NOT NULL,creatorName TEXT NOT NULL,sourceKey TEXT NOT NULL UNIQUE,sourceId INTEGER,request TEXT NOT NULL,content TEXT NOT NULL,personaId TEXT NOT NULL,assetId TEXT,due INTEGER NOT NULL,intervalMs INTEGER NOT NULL DEFAULT 0,repeat TEXT NOT NULL,voice INTEGER NOT NULL,mentionSelf INTEGER NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,detail TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS scheduled_preparations(id TEXT PRIMARY KEY,scope TEXT,creator TEXT,started INTEGER,kind TEXT,status TEXT);CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_tasks(status,due);CREATE TABLE IF NOT EXISTS scheduled_runs(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,receipt TEXT,detail TEXT NOT NULL DEFAULT '',UNIQUE(taskId,due));`);
    this.db.exec("UPDATE scheduled_tasks SET status='unknown',detail='程序中断，执行状态需人工核对，不自动重试' WHERE status='running';UPDATE scheduled_runs SET status='unknown',detail='程序中断，不自动重试' WHERE status IN ('claimed','submitting');");
  }
  settings(){try{return {...settingsDefaults,...JSON.parse(this.store.meta('scheduled-settings')??'{}')};}catch{return {...settingsDefaults};}}
  configure(v){if(!v||Object.keys(v).some(k=>!Object.hasOwn(settingsDefaults,k))||v.enabled!==undefined&&typeof v.enabled!=='boolean')throw Error('定时任务总设置无效');for(const [k,min,max] of [['maxPending',1,30],['dailyLimit',1,100],['graceSeconds',0,3600]])if(v[k]!==undefined&&(!Number.isInteger(v[k])||v[k]<min||v[k]>max))throw Error('定时任务范围无效：'+k);const next={...this.settings(),...v};this.store.meta('scheduled-settings',JSON.stringify(next));if(!next.enabled){for(const c of this.active.values())c.abort();for(const p of this.preparing.values())p.controller.abort();}return next;}
  permitted(scope,creator){try{const who=parseScope(scope),p=this.policy(scope),ids=validateScheduled(p.scheduledTasks??{}).creators;return who.platform===this.platform&&p.enabled&&validId(creator,this.platform)&&(ids.length?ids.includes(creator):creator===this.store.meta('fixed-memory-owner'));}catch{return false;}}
  assertAllowed(scope,creator){if(this.closed||!this.settings().enabled||!this.policy(scope).scheduledTasks?.enabled||this.store.meta('scheduled-paused:'+scope)==='1'||!this.permitted(scope,creator))throw Error('定时任务未开启、已暂停或创建者未获授权');}
  list({scope,creator}={}){return this.db.prepare('SELECT * FROM scheduled_tasks WHERE (? IS NULL OR scope=?) AND (? IS NULL OR creator=?) ORDER BY created DESC LIMIT 200').all(scope??null,scope??null,creator??null,creator??null);}
  dashboard(){return {settings:this.settings(),tasks:this.list(),runs:this.db.prepare('SELECT * FROM scheduled_runs ORDER BY started DESC LIMIT 100').all(),owner:this.store.meta('fixed-memory-owner')??'',pausedScopes:this.db.prepare("SELECT substr(key,18) scope FROM meta WHERE key LIKE 'scheduled-paused:%' AND value='1'").all().map(r=>r.scope)};}
  get(id){return this.db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id);}
  async prepare(r){
    this.assertAllowed(r.scope,r.user);if(this.db.prepare("SELECT count(*) n FROM scheduled_tasks WHERE scope=? AND status IN ('pending','awaiting-confirmation','running')").get(r.scope).n>=this.settings().maxPending)throw Error('此聊天待执行任务已达上限');const key=r.scope+':'+r.user;if(this.preparing.has(key))throw Error('当前账号已有任务正在解析，请稍后');
    const controller=new AbortController(),work=this.prepareDraft(r,controller.signal),entry={scope:r.scope,controller,work};this.preparing.set(key,entry);
    try{const draft=await work;controller.signal.throwIfAborted();this.assertAllowed(r.scope,r.user);return draft;}finally{if(this.preparing.get(key)===entry)this.preparing.delete(key);}
  }
  async prepareDraft(r,signal){
    this.assertAllowed(r.scope,r.user);let draft=parseScheduledRequest(r.text,this.now());
    if(draft.complex){if(!this.generate)throw Error('时间表达尚不能识别，请使用“5分钟后提醒我喝水”等明确格式');const out=await this.generateBounded(r,{kind:'parse',now:this.now(),signal});try{draft=JSON.parse(out.reply);}catch{throw Error('时间解析失败，尚未建立任务');}if(draft.clarify)return {clarify:String(draft.clarify).slice(0,180)};if(!draft||Object.keys(draft).some(k=>!['atLocal','repeat','content','voice','mentionSelf','clarify'].includes(k)))throw Error('任务解析字段无效');draft.due=parseLocalTime(draft.atLocal);delete draft.atLocal;draft.interval=draft.repeat==='daily'?86400000:draft.repeat==='weekly'?7*86400000:0;draft.requiresConfirmation=true;}
    if(draft.clarify)return draft;
    if(draft.style){const out=await this.generateBounded(r,{kind:'style',content:draft.content,now:this.now(),signal});if(!out?.reply)throw Error('人设措辞生成失败，尚未建立任务');draft.content=out.reply;draft.assetId=out.assetId??null;}
    return draft;
  }
  async generateBounded(r,options){
    if(!this.generate)throw Error('模型未准备，未创建任务');options.signal?.throwIfAborted();this.assertAllowed(r.scope,r.user);const date=new Date(this.now()+8*3600000).toISOString().slice(0,10),start=Date.parse(date+'T00:00:00+08:00');
    if(this.db.prepare('SELECT count(*) n FROM scheduled_preparations WHERE scope=? AND creator=? AND started>=?').get(r.scope,r.user,start).n>=this.settings().dailyLimit)throw Error('今日定时任务解析/润色次数已达上限');
    const id=randomUUID();this.db.prepare('INSERT INTO scheduled_preparations VALUES(?,?,?,?,?,?)').run(id,r.scope,r.user,this.now(),options.kind,'started');try{const result=await this.generate(r,options);options.signal?.throwIfAborted();this.db.prepare("UPDATE scheduled_preparations SET status='completed' WHERE id=?").run(id);return result;}catch(e){this.db.prepare("UPDATE scheduled_preparations SET status='failed' WHERE id=?").run(id);throw e;}
  }
  bySource(key){return this.db.prepare('SELECT * FROM scheduled_tasks WHERE sourceKey=?').get(key);}
  create(r,draft,{confirmRepeat=false}={}){
    this.assertAllowed(r.scope,r.user);const who=parseScope(r.scope),p=this.policy(r.scope),now=this.now();
    if(!who.account||!Number.isSafeInteger(draft.due)||draft.due<=now||draft.due>now+30*86400000||!['once','daily','weekly'].includes(draft.repeat)||draft.interval!==(draft.repeat==='daily'?86400000:draft.repeat==='weekly'?7*86400000:0)||typeof draft.content!=='string'||!draft.content.trim()||draft.content.length>1800||draft.voice!==undefined&&typeof draft.voice!=='boolean'||draft.mentionSelf!==undefined&&typeof draft.mentionSelf!=='boolean')throw Error('执行时间或提醒内容无效');
    if(draft.voice&&p.voiceMode==='off')throw Error('本聊天语音回复未开启，未创建付费语音任务');
    if(draft.mentionSelf&&who.kind==='group'&&(p.voiceMode==='only'||draft.voice&&p.voiceMode==='requested'))throw Error('当前纯语音通道不支持同时真实@，请取消@要求或改为文字提醒');
    const sourceKey=r.sourceKey??`${who.account}:${who.kind}:${who.peer}:${r.event?.message_id}`;if(!r.sourceKey&&r.event?.message_id==null)throw Error('缺少原始消息标识');const existing=this.db.prepare('SELECT * FROM scheduled_tasks WHERE sourceKey=?').get(sourceKey);if(existing)return existing;
    const count=this.db.prepare("SELECT count(*) n FROM scheduled_tasks WHERE scope=? AND status IN ('pending','awaiting-confirmation','running')").get(r.scope).n;if(count>=this.settings().maxPending)throw Error('此聊天待执行任务已达上限');
    const id=randomUUID().slice(0,8),status=draft.requiresConfirmation||draft.repeat!=='once'&&!confirmRepeat?'awaiting-confirmation':'pending',speaker=r.creatorName??(()=>{try{return JSON.parse(r.speaker).name;}catch{return r.user;}})();
    const sourceId=r.sourceId??this.store.add(r.scope,'user',r.text,'received',r.speaker??JSON.stringify({id:r.user,name:speaker}),String(r.event?.message_id??''));
    this.db.prepare('INSERT INTO scheduled_tasks(id,scope,creator,creatorName,sourceKey,sourceId,request,content,personaId,assetId,due,intervalMs,repeat,voice,mentionSelf,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,r.scope,r.user,String(speaker).slice(0,80),sourceKey,sourceId,r.text,draft.content.trim(),p.personaId,draft.assetId??null,draft.due,draft.interval,draft.repeat,draft.voice?1:0,draft.mentionSelf&&who.kind==='group'?1:0,status,now);return this.get(id);
  }
  confirm(id,creator){const j=this.get(id);if(!j||j.creator!==creator||j.status!=='awaiting-confirmation')throw Error('没有可确认的本人任务');this.assertAllowed(j.scope,creator);let due=j.due;if(!j.intervalMs&&due<=this.now())throw Error('此任务时间已过，请重新创建');while(due<=this.now())due+=j.intervalMs;this.db.prepare("UPDATE scheduled_tasks SET status='pending',due=? WHERE id=?").run(due,id);return this.get(id);}
  cancel(id,creator){const j=this.get(id);if(!j||creator&&j.creator!==creator)throw Error('任务不存在或不属于当前账号');const c=this.active.get(id);if(j.status==='running'&&this.db.prepare("SELECT 1 FROM scheduled_runs WHERE taskId=? AND due=? AND status='submitting'").get(id,j.due))throw Error('此任务已提交，无法保证撤回；请先核对客户端');if(!['pending','awaiting-confirmation','running'].includes(j.status))throw Error('此任务已结束，不能取消或重放');this.db.prepare("UPDATE scheduled_tasks SET status='cancelled',detail='已取消' WHERE id=?").run(id);c?.abort();return this.get(id);}
  pause(scope,paused){parseScope(scope);this.store.meta('scheduled-paused:'+scope,paused?'1':'0');if(paused)for(const [id,c]of this.active)if(this.get(id)?.scope===scope)c.abort();}
  resume(id){const j=this.get(id);if(!j||!['unknown','failed','expired','interrupted'].includes(j.status)||!j.intervalMs)throw Error('只有已停止的周期任务能恢复；一次任务需重新创建');this.assertAllowed(j.scope,j.creator);const due=j.due+Math.max(1,Math.floor((this.now()-j.due)/j.intervalMs)+1)*j.intervalMs;this.db.prepare("UPDATE scheduled_tasks SET due=?,status='pending',detail='' WHERE id=?").run(due,id);return this.get(id);}
  async command(r){
    if(!taskIntent(r.text))return false;
    // A group continuation or incidental nickname is insufficient for scheduling.
    const raw=r.event.message.filter(s=>s.type==='text').map(s=>s.data.text).join('').trim();if(r.group&&!r.at&&!(r.word&&raw.startsWith(r.word)))return false;
    let controlAttempted=false;const reply=text=>{controlAttempted=true;return this.sendControl(r,text);};try{
      if(!this.permitted(r.scope,r.user))throw Error('当前账号没有本聊天的定时任务权限');
      if(/^\/任务\s*$/u.test(r.text)){const rows=this.list({scope:r.scope,creator:r.user});await reply(rows.length?rows.slice(0,10).map(j=>`${j.id} · ${beijingStamp(j.due)} · ${j.repeat} · ${j.status} · ${j.content.slice(0,80)}`).join('\n'):'当前没有你的定时任务。');return true;}
      let m;if((m=/^\/取消任务\s+([a-f0-9-]{8})$/u.exec(r.text))){this.cancel(m[1],r.user);await reply('已取消任务 '+m[1]);return true;}
      if((m=/^\/确认任务\s+([a-f0-9-]{8})$/u.exec(r.text))){const j=this.confirm(m[1],r.user);await reply('周期任务已确认：'+j.id+'，首次 '+beijingStamp(j.due));return true;}
      if(/^\/(?:暂停|继续)定时任务\s*$/u.test(r.text)){if(r.user!==this.store.meta('fixed-memory-owner'))throw Error('只有本机绑定本人能暂停整个聊天；其他创建者可取消本人任务');this.pause(r.scope,r.text.startsWith('/暂停'));await reply(r.text.startsWith('/暂停')?'已暂停本聊天定时任务。':'已恢复本聊天定时任务，过期任务不会补发。');return true;}
      const draft=await this.prepare(r);if(draft.clarify){await reply(draft.clarify);return true;}const j=this.create(r,draft),p=this.policy(r.scope),voice=draft.voice||['only','always'].includes(p.voiceMode);await reply(`${j.status==='awaiting-confirmation'?'待确认任务':'已安排'} ${j.id}\n${beijingStamp(j.due)}（北京时间） · 当前${r.group?'群':'私聊'}\n${j.content}${voice?'\n语音合成可能消耗Breeze额度。':''}${j.status==='awaiting-confirmation'?'\n规则：'+j.repeat+'；发送 /确认任务 '+j.id+' 后才执行。':''}\n取消：/取消任务 ${j.id}`);
    }catch(e){if(controlAttempted){this.log('定时任务确认提示投递未确认，不重发；请在本机任务列表核对。');return true;}await reply('定时任务：'+String(e.message).slice(0,200));}return true;
  }
  async sendControl(r,text){await this.control(r,text);}
  abortScope(scope){for(const p of this.preparing.values())if(p.scope===scope)p.controller.abort();for(const [id,c]of this.active)if(this.get(id)?.scope===scope)c.abort();}
  start(){this.timer=setInterval(()=>void this.pump().catch(e=>this.log('定时任务检查失败：'+e.message)),1000);this.timer.unref();}
  async pump(){if(this.closed||this.pumping||!this.settings().enabled)return;this.pumping=this.work();try{await this.pumping;}finally{this.pumping=null;}}
  async work(){
    for(const j of this.db.prepare("SELECT * FROM scheduled_tasks WHERE status='pending' AND due<=? ORDER BY due LIMIT 20").all(this.now())){
      if(this.closed)break;const settings=this.settings();if(!settings.enabled)break;
      if(this.now()>j.due+settings.graceSeconds*1000){this.finish(j,'expired','超过宽限，未补发');continue;}
      try{this.assertAllowed(j.scope,j.creator);}catch{continue;}if(!this.ready(j.scope))continue;
      const day=new Date(this.now()+8*3600000).toISOString().slice(0,10),count=this.db.prepare('SELECT count(*) n FROM scheduled_runs r JOIN scheduled_tasks t ON t.id=r.taskId WHERE t.scope=? AND r.started>=? AND r.started<?').get(j.scope,Date.parse(day+'T00:00:00+08:00'),Date.parse(day+'T00:00:00+08:00')+86400000).n;if(count>=settings.dailyLimit)continue;
      if(!this.db.prepare("UPDATE scheduled_tasks SET status='running' WHERE id=? AND status='pending' AND due=?").run(j.id,j.due).changes)continue;
      const runId=randomUUID(),controller=new AbortController();this.active.set(j.id,controller);this.db.prepare("INSERT INTO scheduled_runs(id,taskId,due,status,started) VALUES(?,?,?,'claimed',?)").run(runId,j.id,j.due,this.now());let submitted=false;
      const fresh=()=>{controller.signal.throwIfAborted();this.assertAllowed(j.scope,j.creator);const current=this.get(j.id);if(current?.status!=='running'||current.due!==j.due||this.policy(j.scope).personaId!==j.personaId||this.now()>j.due+this.settings().graceSeconds*1000||!this.ready(j.scope))throw Error('任务权限、人格、时间或连接已变化');};
      try{const receipt=await this.send({...j,executionKey:runId},{signal:controller.signal,assertFresh:fresh,beforeSend:()=>{fresh();submitted=true;this.db.prepare("UPDATE scheduled_runs SET status='submitting' WHERE id=?").run(runId);}});if(!receipt?.length||receipt.some(r=>!r?.message_id))throw Error('投递回执未知');this.db.prepare("UPDATE scheduled_runs SET status='sent',finished=?,receipt=? WHERE id=?").run(this.now(),JSON.stringify(receipt),runId);this.finish(j,'completed','回执已确认');}
      catch(e){const status=submitted?'unknown':this.closed?'interrupted':this.get(j.id)?.status==='cancelled'?'cancelled':'failed';this.db.prepare('UPDATE scheduled_runs SET status=?,finished=?,detail=? WHERE id=?').run(status,this.now(),String(e.message).slice(0,160),runId);this.db.prepare('UPDATE scheduled_tasks SET status=?,detail=? WHERE id=?').run(status,submitted?'投递未知，不自动重试':String(e.message).slice(0,160),j.id);}
      finally{this.active.delete(j.id);}
    }
  }
  finish(j,status,detail){let due=j.due;if(j.intervalMs){due+=Math.max(1,Math.floor((this.now()-due)/j.intervalMs)+1)*j.intervalMs;}this.db.prepare('UPDATE scheduled_tasks SET status=?,due=?,detail=? WHERE id=?').run(j.intervalMs?'pending':status,due,detail,j.id);if(status==='expired')this.db.prepare("INSERT OR IGNORE INTO scheduled_runs(id,taskId,due,status,started,finished,detail) VALUES(?,?,?,'expired',?,?,?)").run(randomUUID(),j.id,j.due,this.now(),this.now(),detail);}
  async close(){this.closed=true;clearInterval(this.timer);for(const c of this.active.values())c.abort();for(const p of this.preparing.values())p.controller.abort();await this.pumping;await Promise.allSettled([...this.preparing.values()].map(p=>p.work));}
}
