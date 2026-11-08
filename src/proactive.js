import {randomUUID} from 'node:crypto';
import {parseScope} from './chat-identity.js';

export const proactiveDefaults={enabled:false,minMinutes:30,maxMinutes:90,dailyLimit:2,unansweredLimit:1,generationLimit:3,tokenLimit:12000};
export function validateProactive(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(proactiveDefaults,k)))throw Error('主动陪伴设置字段无效');
  if(value.enabled!==undefined&&typeof value.enabled!=='boolean')throw Error('主动陪伴开关无效');
  for(const [k,min,max]of [['minMinutes',1,10080],['maxMinutes',1,10080],['dailyLimit',1,20],['unansweredLimit',1,5],['generationLimit',1,30],['tokenLimit',100,1000000]])if(value[k]!==undefined&&(!Number.isSafeInteger(value[k])||value[k]<min||value[k]>max))throw Error('主动陪伴范围无效：'+k);
  const p={...proactiveDefaults,...value};if(p.maxMinutes<p.minMinutes)throw Error('最长静默时间不能小于最短时间');return p;
}
export function proactivePolicy(policy,scope){return validateProactive({...proactiveDefaults,...(parseScope(scope).kind==='group'?{minMinutes:90,maxMinutes:180,dailyLimit:1}:{}),...policy.proactive});}
const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export function quietHours(at,start=23,end=8){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(at));return start===end||start<end?hour>=start&&hour<end:hour>=start||hour<end;}

export class Proactive {
  #permits=new WeakSet();
  constructor({store,budgetStore=store,platform='qq',policy,ready,busy,generate,send,now=Date.now,random=Math.random,log=()=>{}}){
    Object.assign(this,{store,budgetStore,platform,policy,ready,busy,generate,send,now,random,log});this.inflight=new Map();this.closed=false;
    for(const target of new Set([store,budgetStore]))target.db.exec(`CREATE TABLE IF NOT EXISTS proactive_state(scope TEXT PRIMARY KEY,activity INTEGER NOT NULL,due INTEGER NOT NULL,unanswered INTEGER DEFAULT 0,revision INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS proactive_jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,day TEXT NOT NULL,started INTEGER NOT NULL,status TEXT NOT NULL,tokens INTEGER DEFAULT 0,detail TEXT DEFAULT '');CREATE INDEX IF NOT EXISTS proactive_jobs_day ON proactive_jobs(day,scope);`);
    // An interrupted submission is never replayed. A generation may have been billed.
    {const own=platform+':%';this.budgetStore.db.prepare("UPDATE proactive_jobs SET status='unknown',detail='进程中断，禁止自动重试' WHERE status='submitting' AND scope LIKE ?").run(own);this.budgetStore.db.prepare("UPDATE proactive_jobs SET status='interrupted',tokens=max(tokens,12000) WHERE status IN ('generating','preview-generating') AND scope LIKE ?").run(own);}for(const {scope}of this.store.db.prepare('SELECT scope,activity FROM proactive_state').all())if(this.budgetStore.db.prepare("SELECT 1 FROM proactive_jobs WHERE scope=? AND status='unknown' AND detail='进程中断，禁止自动重试' AND started>=? LIMIT 1").get(scope,this.store.db.prepare('SELECT activity FROM proactive_state WHERE scope=?').get(scope).activity))this.store.db.prepare('UPDATE proactive_state SET unanswered=max(unanswered,1) WHERE scope=?').run(scope);
  }
  settings(){try{return {enabled:false,dailyLimit:6,dndStart:23,dndEnd:8,...JSON.parse(this.budgetStore.meta('proactive-settings')??'{}')};}catch{return {enabled:false,dailyLimit:6,dndStart:23,dndEnd:8};}}
  configure(v){if(!v||Object.keys(v).some(k=>!['enabled','dailyLimit','dndStart','dndEnd'].includes(k))||v.enabled!==undefined&&typeof v.enabled!=='boolean')throw Error('全局陪伴配置无效');for(const k of ['dailyLimit','dndStart','dndEnd'])if(v[k]!==undefined&&(!Number.isInteger(v[k])||v[k]<(k==='dailyLimit'?1:0)||v[k]>(k==='dailyLimit'?30:23)))throw Error('全局陪伴配置范围无效');const old=this.settings(),next={...old,...v};if(next.enabled&&!old.enabled)this.budgetStore.meta('proactive-enabled-at',this.now());this.budgetStore.meta('proactive-settings',JSON.stringify(next));this.budgetStore.meta('proactive-config-revision',Number(this.budgetStore.meta('proactive-config-revision')??0)+1);for(const scope of this.inflight.keys())this.cancel(scope);return next;}
  schedule(scope,at=this.now()){
    const p=proactivePolicy(this.policy(scope),scope),due=at+(p.minMinutes+Math.max(0,Math.min(1,this.random()))*(p.maxMinutes-p.minMinutes))*60000;
    this.store.db.prepare('INSERT INTO proactive_state(scope,activity,due) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET activity=excluded.activity,due=excluded.due,revision=revision+1').run(scope,at,Math.round(due));return due;
  }
  activity(scope,{interaction=true}={}){const p=this.policy(scope);if(!p.enabled)return;this.cancel(scope);this.schedule(scope);if(interaction)this.store.db.prepare('UPDATE proactive_state SET unanswered=0 WHERE scope=?').run(scope);}
  cancel(scope){this.inflight.get(scope)?.abort();}
  counts(scope){const d=day(this.now()),rows=this.budgetStore.db.prepare('SELECT * FROM proactive_jobs WHERE day=?').all(d),own=rows.filter(r=>r.scope===scope);return {global:rows.filter(r=>['delivered','unknown','submitting','generating'].includes(r.status)).length,sent:own.filter(r=>['delivered','unknown','submitting'].includes(r.status)).length,generations:own.length,tokens:own.reduce((n,r)=>n+r.tokens,0)};}
  gate(scope){
    if(this.closed)return 'stopped';const g=this.settings(),policy=this.policy(scope),p=proactivePolicy(policy,scope),state=this.store.db.prepare('SELECT * FROM proactive_state WHERE scope=?').get(scope),n=this.counts(scope);
    if(!g.enabled||!p.enabled||!policy.enabled)return 'disabled';if(!this.ready(scope))return 'disconnected';if(this.busy(scope))return 'busy';if(quietHours(this.now(),g.dndStart,g.dndEnd))return 'do-not-disturb';if(state&&state.due<Number(this.budgetStore.meta('proactive-enabled-at')??0)){this.defer(scope);return 'waiting';}if(state?.unanswered>=p.unansweredLimit)return 'unanswered';if(!state||state.due>this.now())return 'waiting';if(n.global>=g.dailyLimit||n.sent>=p.dailyLimit)return 'daily-limit';if(n.generations>=p.generationLimit||n.tokens>=p.tokenLimit)return 'generation-budget';return null;
  }
  preview(scope){const policy=this.policy(scope),state=this.store.db.prepare('SELECT * FROM proactive_state WHERE scope=?').get(scope);return {scope,policy:proactivePolicy(policy,scope),state:state??null,counts:this.counts(scope),blockedBy:this.gate(scope)};}
  dashboard(){return {settings:this.settings(),timeZone:'Asia/Shanghai',states:this.store.db.prepare('SELECT scope FROM proactive_state ORDER BY activity DESC LIMIT 200').all().map(r=>this.preview(r.scope)),jobs:this.budgetStore.db.prepare('SELECT * FROM proactive_jobs WHERE scope LIKE ? ORDER BY started DESC LIMIT 100').all((this.platform??'qq')+':%')};}
  defer(scope){const row=this.store.db.prepare('SELECT scope FROM proactive_state WHERE scope=?').get(scope);if(!row)return;const p=proactivePolicy(this.policy(scope),scope);this.store.db.prepare('UPDATE proactive_state SET due=?,revision=revision+1 WHERE scope=?').run(Math.round(this.now()+(p.minMinutes+this.random()*(p.maxMinutes-p.minMinutes))*60000),scope);}
  start(platform){this.platform=platform;for(const row of this.store.db.prepare('SELECT scope FROM proactive_state').all()){const p=proactivePolicy(this.policy(row.scope),row.scope);this.store.db.prepare('UPDATE proactive_state SET due=?,revision=revision+1 WHERE scope=?').run(Math.round(this.now()+(p.minMinutes+this.random()*(p.maxMinutes-p.minMinutes))*60000),row.scope);}this.timer=setInterval(()=>{this.tick().catch(()=>this.log('主动陪伴检查未完成，未重发。'));},15000);this.timer.unref?.();}
  async tick(){if(this.ticking||this.closed)return;this.ticking=true;try{for(const {scope}of this.store.db.prepare('SELECT scope FROM proactive_state WHERE due<=? ORDER BY due LIMIT 100').all(this.now())){if(this.gate(scope)||this.inflight.has(scope))continue;await this.run(scope);break;}}finally{this.ticking=false;}}
  async previewCandidate(scope){
    const policy=this.policy(scope),p=proactivePolicy(policy,scope),count=this.counts(scope);if(this.closed||this.inflight.has(scope)||!policy.enabled||!this.ready(scope)||this.busy(scope))throw Error('当前聊天未就绪或有任务正在处理');if(count.generations>=p.generationLimit||count.tokens>=p.tokenLimit)throw Error('今日主动生成预算已用完');
    const id=randomUUID(),controller=new AbortController(),db=this.budgetStore.db;this.inflight.set(scope,controller);db.prepare("INSERT INTO proactive_jobs(id,scope,day,started,status) VALUES(?,?,?,?,'preview-generating')").run(id,scope,day(this.now()),this.now());
    try{const response=await this.generate(scope,{signal:controller.signal,id,policy}),usage=response?.usage?.last??response?.usage?.total??response?.usage,known=usage&&['inputTokens','input_tokens','totalTokens','total_tokens'].some(k=>Number.isFinite(usage[k])),tokens=known?Number(usage.totalTokens??usage.total_tokens??((usage.inputTokens??usage.input_tokens??0)+(usage.outputTokens??usage.output_tokens??0))):p.tokenLimit;db.prepare('UPDATE proactive_jobs SET tokens=? WHERE id=?').run(Math.max(0,tokens),id);if(response?.usage)this.store.usage(scope,{...response.usage,kind:'proactive-preview',runId:id,engine:response.engine,model:response.model});controller.signal.throwIfAborted();response.assertFresh?.();if(JSON.stringify(this.policy(scope))!==JSON.stringify(policy)||!this.ready(scope))throw Error('预览条件已改变');db.prepare("UPDATE proactive_jobs SET status='preview',detail='仅本机预览，未发送' WHERE id=?").run(id);return {id,scope,reply:String(response.reply).slice(0,1200),sent:false,tokens};}
    catch(e){db.prepare("UPDATE proactive_jobs SET status=?,detail='预览未完成，未发送' WHERE id=?").run(controller.signal.aborted?'cancelled':'failed',id);throw e;}
    finally{this.inflight.delete(scope);}
  }
  async testOnce(scope,{message}={}){
    if(message!==undefined&&(typeof message!=='string'||!message.trim()||message.length>300))throw Error('测试文字限1—300字');
    if(this.inflight.has(scope))return {status:'blocked',reason:'in-flight'};
    // Only the authenticated local console can invoke this explicit one-shot.
    // The lease is held in this call; no JSON token enables a background sender.
    const policy=this.policy(scope),p=proactivePolicy(policy,scope),g=this.settings(),n=this.counts(scope),state=this.store.db.prepare('SELECT * FROM proactive_state WHERE scope=?').get(scope);
    if(this.closed||!policy.enabled||!this.ready(scope)||this.busy(scope))return {status:'blocked',reason:'disconnected'};
    if(quietHours(this.now(),g.dndStart,g.dndEnd))return {status:'blocked',reason:'do-not-disturb'};
    if(state?.unanswered>=p.unansweredLimit||n.global>=g.dailyLimit||n.sent>=p.dailyLimit||n.generations>=p.generationLimit||n.tokens>=p.tokenLimit)return {status:'blocked',reason:'budget-or-unanswered'};
    if(!state)this.schedule(scope);this.store.db.prepare('UPDATE proactive_state SET due=?,revision=revision+1 WHERE scope=?').run(this.now(),scope);
    const permit={scope,expires:this.now()+120000,used:false,message};this.#permits.add(permit);return this.run(scope,permit);
  }
  async deliverPrepared(scope,text,{assertFresh=()=>{}}={}){if(typeof text!=='string'||!text.trim()||text.length>1200)throw Error('主动分享文字无效');const reason=this.gate(scope);if(reason)return {status:'blocked',reason};assertFresh();return this.run(scope,null,{reply:text,usage:{inputTokens:0,outputTokens:0},assertFresh});}
  async run(scope,permit=null,prepared=null){
    if(this.inflight.has(scope))return {status:'blocked',reason:'in-flight'};
    const oneShot=!!permit&&this.#permits.has(permit)&&permit.scope===scope&&!permit.used&&permit.expires>this.now();if(permit&&!oneShot)return {status:'blocked',reason:'expired-permit'};
    if(!oneShot&&this.gate(scope))return {status:'blocked',reason:this.gate(scope)};if(oneShot){permit.used=true;this.#permits.delete(permit);}
    const id=randomUUID(),controller=new AbortController(),state=this.store.db.prepare('SELECT * FROM proactive_state WHERE scope=?').get(scope),policy=this.policy(scope),fingerprint=JSON.stringify(policy),revision=state.revision,startedDay=day(this.now());
    this.inflight.set(scope,controller);const db=this.budgetStore.db;
    db.prepare("INSERT INTO proactive_jobs(id,scope,day,started,status) VALUES(?,?,?,?,'generating')").run(id,scope,day(this.now()),this.now());
    const update=(status,detail='')=>{db.prepare('UPDATE proactive_jobs SET status=?,detail=? WHERE id=?').run(status,detail,id);return {id,status};};
    let generated=null;const resetFence=this.store.meta('memory-reset-at'),configRevision=this.budgetStore.meta('proactive-config-revision');const fresh=()=>{controller.signal.throwIfAborted();generated?.assertFresh?.();if(this.store.meta('memory-reset-at')!==resetFence||this.budgetStore.meta('proactive-config-revision')!==configRevision)throw Error('记忆已重置');if(day(this.now())!==startedDay||this.closed||oneShot&&permit.expires<=this.now()||JSON.stringify(this.policy(scope))!==fingerprint||this.store.db.prepare('SELECT revision FROM proactive_state WHERE scope=?').get(scope)?.revision!==revision||!oneShot&&!this.settings().enabled||!this.ready(scope)||this.busy(scope)||quietHours(this.now(),this.settings().dndStart,this.settings().dndEnd))throw Error('主动陪伴条件已改变');};
    try{
      fresh();const response=prepared??await this.generate(scope,{signal:controller.signal,id,policy,remainingTokens:proactivePolicy(policy,scope).tokenLimit-this.counts(scope).tokens,testMessage:oneShot?permit.message:undefined});generated=response;
      const usage=response?.usage?.last??response?.usage?.total??response?.usage??{},known=Object.keys(usage).some(k=>['totalTokens','total_tokens','inputTokens','input_tokens','outputTokens','output_tokens'].includes(k)),tokens=known?Number(usage.totalTokens??usage.total_tokens??((usage.inputTokens??usage.input_tokens??0)+(usage.outputTokens??usage.output_tokens??0))):proactivePolicy(policy,scope).tokenLimit;
      db.prepare('UPDATE proactive_jobs SET tokens=? WHERE id=?').run(Number.isFinite(tokens)?Math.max(0,tokens):0,id);
      if(response?.usage)this.store.usage(scope,{...response.usage,kind:'proactive',runId:id,engine:response.engine,model:response.model,outcome:'generated'});
      fresh();const text=String(response?.reply??'').trim();if(oneShot&&permit.message&&text!==permit.message)return update('skipped','approved-text-mismatch');if(!text||text==='[SILENT]')return update('silent');
      if(text.length>1200||this.counts(scope).tokens>proactivePolicy(policy,scope).tokenLimit)return update('skipped','output-or-token-limit');
      update('submitting');let result;try{fresh();result=await this.send(scope,text,{beforeSend:fresh,signal:controller.signal,id,natural:!(oneShot&&permit.message)});}catch(e){if(e.deliveryAttempted===false)return update('cancelled');this.store.db.prepare('UPDATE proactive_state SET unanswered=unanswered+1 WHERE scope=? AND revision=?').run(scope,revision);return update('unknown','不自动重试');}
      this.store.db.prepare('UPDATE proactive_state SET unanswered=unanswered+1 WHERE scope=? AND revision=?').run(scope,revision);return update('delivered');
    }catch(e){return update(controller.signal.aborted?'cancelled':e.code==='PROACTIVE_TOKEN_BUDGET'?'skipped':'failed',e.code==='PROACTIVE_TOKEN_BUDGET'?'token-admission-budget':'');}
    finally{this.inflight.delete(scope);const current=this.store.db.prepare('SELECT revision FROM proactive_state WHERE scope=?').get(scope);if(current?.revision===revision)this.defer(scope);}
  }
  async close(){this.closed=true;clearInterval(this.timer);for(const c of this.inflight.values())c.abort();while(this.inflight.size)await new Promise(r=>setTimeout(r,20));}
}
