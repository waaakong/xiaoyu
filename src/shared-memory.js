import {identity,parseScope,sameDomain} from './chat-identity.js';
import {EventEmitter} from 'node:events';
import {memoryTokens,safeMemory,decay} from './living-memory.js';

export const normalizedKey=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/^(?:本群|本聊天|本会话|这里)[：:\s]*/u,'').replace(/\s+/gu,'').replace(/.*(?:称呼|昵称).*/u,'称呼');
export const chatIdentity=identity;
function memoryOwner(scope){const m=parseScope(scope);if(m.kind==='group'&&!m.member||m.kind==='private'&&m.member)throw Error('只能共享归属明确的个人事实');return {...m,owner:m.kind==='private'?m.peer:m.member,originScope:m.scope};}

export class SharedMemory extends EventEmitter {
  constructor(store){super();this.store=store;this.db=store.db;this.setMaxListeners(30);this.db.exec(`
    CREATE TABLE IF NOT EXISTS shared_facts(id INTEGER PRIMARY KEY AUTOINCREMENT,memoryId INTEGER UNIQUE,account TEXT,owner TEXT,originScope TEXT,personaId TEXT,active INTEGER DEFAULT 1,revision INTEGER DEFAULT 1,createdBy TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS shared_grants(factId INTEGER,targetScope TEXT,PRIMARY KEY(factId,targetScope));
    CREATE TABLE IF NOT EXISTS shared_hidden(factId INTEGER,targetScope TEXT,PRIMARY KEY(factId,targetScope));
    CREATE TABLE IF NOT EXISTS shared_message_refs(messageId INTEGER,factId INTEGER,revision INTEGER,memoryVersion INTEGER,PRIMARY KEY(messageId,factId));
    CREATE TABLE IF NOT EXISTS shared_audit(id INTEGER PRIMARY KEY,factId INTEGER,actor TEXT,action TEXT,detail TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS shared_owner ON shared_facts(account,owner,active);
    CREATE INDEX IF NOT EXISTS shared_refs_fact ON shared_message_refs(factId);`);}
  context(scope,member,policy){const identity=chatIdentity(scope,member);return {...identity,personaId:policy(scope).personaId??'default',policy};}
  fact(id){return this.db.prepare(`SELECT f.*,m.key,m.value,m.type,m.pinned,m.authority,m.sourceId,m.evidence,m.expires,m.confirmations,m.confirmedAt,m.scope AS memoryScope,(SELECT max(v.id) FROM memory_versions v WHERE v.memoryId=m.id AND v.status='current') AS memoryVersion FROM shared_facts f LEFT JOIN memories m ON m.id=f.memoryId WHERE f.id=?`).get(id);}
  grants(id){return this.db.prepare('SELECT targetScope FROM shared_grants WHERE factId=? ORDER BY targetScope').all(id).map(r=>r.targetScope);}
  hidden(id){return this.db.prepare('SELECT targetScope FROM shared_hidden WHERE factId=?').all(id).map(r=>r.targetScope);}
  audit(id){return this.db.prepare('SELECT * FROM shared_audit WHERE factId=? ORDER BY id DESC LIMIT 100').all(id).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  change(fact,action,actor='local-owner',detail={}){this.db.prepare('INSERT INTO shared_audit(factId,actor,action,detail) VALUES(?,?,?,?)').run(fact.id,actor,action,JSON.stringify(detail));this.emit('change',{account:fact.account,owner:fact.owner,scopes:[fact.originScope,...this.grants(fact.id),...(detail.previousTargets??[])]});}
  sourceChanged(memoryId){for(const f of this.db.prepare('SELECT * FROM shared_facts WHERE memoryId=?').all(memoryId)){this.db.prepare('UPDATE shared_facts SET revision=revision+1,updated=CURRENT_TIMESTAMP WHERE id=?').run(f.id);this.change(f,'source_changed');}}
  sourceForgotten(memoryId){for(const f of this.db.prepare('SELECT * FROM shared_facts WHERE memoryId=?').all(memoryId)){this.db.prepare('UPDATE shared_facts SET active=0,revision=revision+1,updated=CURRENT_TIMESTAMP WHERE id=?').run(f.id);this.change(f,'source_forgotten');}}
  policyChanged(scope){for(const f of this.db.prepare('SELECT DISTINCT f.* FROM shared_facts f LEFT JOIN shared_grants g ON g.factId=f.id WHERE f.originScope=? OR g.targetScope=?').all(scope,scope))this.change(f,'policy_changed','local-owner');}
  validateSource(m,policy){if(!m||!['fact','preference'].includes(m.type)||!safeMemory(m.key,m.value)||m.expires&&m.expires<=Date.now())throw new Error('只允许共享未过期的事实或偏好，请先核对内容');const who=memoryOwner(m.scope),p=policy(who.originScope);if(!p.enabled||!p.crossMemoryWrite)throw new Error('来源聊天尚未允许发布共享事实');return who;}
  publish({memoryId,targets=[],includePrivate=true,allPersonas=false,actor='local-owner',createdBy='operator'},policy){
    const m=this.store.memory(Number(memoryId)),who=this.validateSource(m,policy);if(!Array.isArray(targets)||targets.length>100||targets.some(s=>typeof s!=='string')||typeof includePrivate!=='boolean'||typeof allPersonas!=='boolean')throw new Error('共享范围无效');
    const selected=new Set(targets);if(includePrivate)selected.add(`${who.platform}:${who.account}:private:${who.owner}`);if(!selected.size)throw new Error('至少选择一个目标聊天');
    for(const scope of selected){const target=chatIdentity(scope,who.owner);if(!sameDomain(target,who)||target.kind==='private'&&target.owner!==who.owner)throw new Error('不能共享到其他角色账号或其他人的私聊');const p=policy(scope);if(!p.enabled||!p.crossMemoryRead)throw new Error('目标聊天未授权或未开启共享记忆读取');}
    const personaId=allPersonas?'*':policy(who.originScope).personaId??'default';
    const duplicate=this.db.prepare('SELECT f.id FROM shared_facts f JOIN memories m ON m.id=f.memoryId WHERE f.account=? AND f.owner=? AND f.personaId=? AND m.key=? AND f.memoryId!=?').get(who.account,who.owner,personaId,m.key,m.id);if(duplicate)throw new Error('本人已有同名共享事实，请编辑现有事实，不创建冲突副本');
    const previous=this.db.prepare('SELECT * FROM shared_facts WHERE memoryId=?').get(m.id),previousTargets=previous?this.grants(previous.id):[];
    return this.store.living.transaction(()=>{
      this.db.prepare('INSERT INTO shared_facts(memoryId,account,owner,originScope,personaId,createdBy) VALUES(?,?,?,?,?,?) ON CONFLICT(memoryId) DO UPDATE SET active=1,personaId=excluded.personaId,revision=shared_facts.revision+1,updated=CURRENT_TIMESTAMP').run(m.id,who.account,who.owner,who.originScope,personaId,createdBy);
      const f=this.db.prepare('SELECT * FROM shared_facts WHERE memoryId=?').get(m.id);this.db.prepare('DELETE FROM shared_grants WHERE factId=?').run(f.id);for(const scope of selected)this.db.prepare('INSERT INTO shared_grants VALUES(?,?)').run(f.id,scope);
      this.db.prepare('DELETE FROM shared_hidden WHERE factId=?').run(f.id);this.change(f,'published',actor,{targets:[...selected],previousTargets,personaId});return this.describe(f.id);
    });
  }
  describe(id){const f=this.fact(id);return f?{...f,targets:this.grants(id),hiddenTargets:this.hidden(id)}:null;}
  list(scope,member){const who=chatIdentity(scope,member);return this.db.prepare('SELECT id FROM shared_facts WHERE account=? AND owner=? ORDER BY id DESC').all(who.account,who.owner).map(r=>this.describe(r.id));}
  owned(id,context){const f=this.fact(Number(id));if(!f||f.account!==context.account||f.owner!==context.owner)throw new Error('没有找到属于你的共享事实');return f;}
  stop(id,context=null){const f=context?this.owned(id,context):this.fact(id);if(!f)throw new Error('共享事实不存在');this.db.prepare('UPDATE shared_facts SET active=0,revision=revision+1,updated=CURRENT_TIMESTAMP WHERE id=?').run(f.id);this.change(f,'stopped',context?.owner??'local-owner');}
  hide(id,targetScope,context=null){const f=context?this.owned(id,context):this.fact(id);if(!f||!this.grants(f.id).includes(targetScope))throw new Error('该事实未发布到当前聊天');this.db.prepare('INSERT OR IGNORE INTO shared_hidden VALUES(?,?)').run(f.id,targetScope);this.change(f,'hidden_here',context?.owner??'local-owner');}
  unhide(id,targetScope){const f=this.fact(id);if(!f)throw new Error('共享事实不存在');this.db.prepare('DELETE FROM shared_hidden WHERE factId=? AND targetScope=?').run(id,targetScope);this.change(f,'unhidden_here');}
  forget(id,context=null){const f=context?this.owned(id,context):this.fact(id);if(!f)throw new Error('共享事实不存在');if(f.key)this.store.forget(f.memoryScope,f.memoryId);else this.stop(id,context);this.change(f,'globally_forgotten',context?.owner??'local-owner');}
  allowed(f,ctx){
    if(!f?.active||!f.key||f.account!==ctx.account||f.owner!==ctx.owner||!['*',ctx.personaId].includes(f.personaId)||f.expires&&f.expires<=Date.now()||!safeMemory(f.key,f.value))return false;
    const origin=memoryOwner(f.memoryScope);if(origin.account!==f.account||origin.owner!==f.owner||origin.originScope!==f.originScope)return false;
    const target=ctx.policy(ctx.scope),source=ctx.policy(f.originScope);if(!target.enabled||!target.crossMemoryRead||!source.enabled||!source.crossMemoryWrite||target.personaId!==ctx.personaId)return false;
    if(f.personaId!=='*'&&source.personaId!==f.personaId)return false;
    return !!this.db.prepare('SELECT 1 FROM shared_grants WHERE factId=? AND targetScope=?').get(f.id,ctx.scope)&&!this.db.prepare('SELECT 1 FROM shared_hidden WHERE factId=? AND targetScope=?').get(f.id,ctx.scope);
  }
  available(ctx,query=null){const target=ctx.policy(ctx.scope);if(!target.enabled||!target.crossMemoryRead)return [];
    const tokens=query===null?null:memoryTokens(query),terms=tokens?[...new Set([...tokens.words,...tokens.grams])].slice(0,40):null;if(terms&&!terms.length)return [];
    const matches=terms?this.db.prepare(`SELECT 1 FROM memory_terms WHERE memoryId=? AND token IN (${terms.map(()=>'?').join(',')}) LIMIT 1`):null;
    // Identity and target grants are checked in SQL before reading any fact values.
    return this.db.prepare('SELECT f.id,f.memoryId,f.originScope,f.personaId FROM shared_facts f JOIN shared_grants g ON g.factId=f.id WHERE f.account=? AND f.owner=? AND f.active=1 AND g.targetScope=? AND f.personaId IN (?,?) AND NOT EXISTS(SELECT 1 FROM shared_hidden h WHERE h.factId=f.id AND h.targetScope=g.targetScope)').all(ctx.account,ctx.owner,ctx.scope,ctx.personaId,'*').filter(f=>{const p=ctx.policy(f.originScope);return p.enabled&&p.crossMemoryWrite&&(f.personaId==='*'||p.personaId===f.personaId)&&(!matches||matches.get(f.memoryId,...terms));}).map(r=>this.fact(r.id)).filter(f=>this.allowed(f,ctx));
  }
  candidates(ctx,query){const tokens=memoryTokens(query),q=new Set([...tokens.words,...tokens.grams]);return this.available(ctx,query).map(f=>{const t=memoryTokens(f.key+' '+f.value),score=[...new Set([...t.words,...t.grams])].filter(w=>q.has(w)).length;return {...f,score:score*decay(f)*(f.pinned?1.5:1)};}).filter(f=>f.score>0).sort((a,b)=>b.score-a.score||b.id-a.id).slice(0,40);}
  localOverrides(memoryId,key){const m=this.store.memory(memoryId);return m&&normalizedKey(m.key)===normalizedKey(key);}
  stamp(f){return {factId:f.id,revision:f.revision,memoryVersion:f.memoryVersion};}
  fresh(ref,ctx){const f=this.fact(ref.factId);return this.allowed(f,ctx)&&f.revision===ref.revision&&f.memoryVersion===ref.memoryVersion;}
  dependencies(messageId){return this.db.prepare('SELECT factId,revision,memoryVersion FROM shared_message_refs WHERE messageId=?').all(messageId);}
  messageAllowed(messageId,ctx){return this.dependencies(messageId).every(r=>this.fresh(r,ctx))&&(this.store.continuity?.messageAllowed(messageId,ctx)??true);}
  tagMessage(messageId,refs){for(const r of refs)this.db.prepare('INSERT OR REPLACE INTO shared_message_refs VALUES(?,?,?,?)').run(messageId,r.factId,r.revision,r.memoryVersion);}
  upsertOwn({key,value,sourceId=null},ctx){
    const p=ctx.policy(ctx.scope);if(!p.enabled||!p.crossMemoryWrite)throw new Error('当前聊天未允许发布共享事实');if(!safeMemory(key,value)||typeof key!=='string'||typeof value!=='string'||!key.trim()||!value.trim()||key.length>60||value.length>240)throw new Error('共享记忆格式或内容无效');
    const found=this.db.prepare('SELECT f.id FROM shared_facts f JOIN memories m ON m.id=f.memoryId WHERE f.account=? AND f.owner=? AND f.personaId IN (?,?) AND m.key=? ORDER BY f.id LIMIT 1').get(ctx.account,ctx.owner,ctx.personaId,'*',key.trim());
    if(found){const f=this.fact(found.id);if(!f.active)throw new Error('该共享事实已停止，请在本机窗口核对后重新发布');if(f.pinned||f.createdBy!=='owner_command'||String(f.evidence).startsWith('本机手动'))throw new Error('固定或本机维护的事实请在窗口更正');if(!ctx.policy(f.originScope).enabled||!ctx.policy(f.originScope).crossMemoryWrite)throw new Error('原来源已停止发布，请在窗口处理');
      const updated=this.store.remember(f.memoryScope,f.key,value,{sourceId,evidence:'本人跨聊明确要求：'+value,authority:'manual',type:f.type,pinned:!!f.pinned,correction:true});if(!updated)throw new Error('共享事实未保存');return this.describe(f.id);
    }
    const target=`${ctx.platform}:${ctx.account}:private:${ctx.owner}`,tp=ctx.policy(target);if(!tp.enabled||!tp.crossMemoryRead)throw new Error('请先在本机为本人私聊开启共享记忆读取');
    const scope=ctx.kind==='private'?ctx.scope:ctx.scope+':member:'+ctx.owner;const old=this.db.prepare('SELECT * FROM memories WHERE scope=? AND key=?').get(scope,key.trim());if(old&&(old.pinned||old.authority==='manual')&&old.value!==value)throw new Error('已有固定或人工记忆，请先在窗口核对');
    const saved=this.store.remember(scope,key,value,{sourceId,evidence:'本人跨聊明确要求：'+value,type:'fact',authority:'manual'});if(!saved)throw new Error('共享事实未保存');return this.publish({memoryId:saved.id,includePrivate:true,createdBy:'owner_command',actor:ctx.owner},ctx.policy);
  }
}
