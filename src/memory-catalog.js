import {createHash} from 'node:crypto';
import {parseScope} from './chat-identity.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max=180)=>String(value??'').slice(0,max);
const safe=text=>!/(?:-----BEGIN|\b(?:brz_|sk-|key_)[\w-]{12,}|(?:密码|密钥|password|api[_-]?key|token)\s*[:=：]\s*\S+)/iu.test(text);
export class MemoryCatalog {
 constructor(store){this.store=store;this.db=store.db;this.db.exec('CREATE TABLE IF NOT EXISTS catalog_message_refs(messageId INTEGER,catalogId TEXT,fingerprint TEXT,PRIMARY KEY(messageId,catalogId));');}
 dependencies(id){return this.db.prepare('SELECT catalogId,fingerprint FROM catalog_message_refs WHERE messageId=?').all(id);}
 tagMessage(id,refs){for(const ref of refs??[])this.db.prepare('INSERT OR REPLACE INTO catalog_message_refs VALUES(?,?,?)').run(id,ref.catalogId,ref.fingerprint);if(refs?.length)this.db.prepare('DELETE FROM episode_terms WHERE messageId=?').run(id);}
 messageAllowed(id,context){const refs=this.dependencies(id);if(!refs.length)return true;return this.fresh(refs,{...context,members:context.members??[String(context.owner??'')],allowAnyLocalMember:true});}
 list(context={}){
 const {scope='',personaId=''}=context,store=this.store,db=this.db;const selected=scope?parseScope(scope):null,platform=context.platform??selected?.platform??store.meta('platform')??'qq',account=String(context.account??selected?.account??store.meta('lastAccount')??'');
 if(scope&&(selected.platform!==platform||selected.account!==account||selected.member))throw Error('记忆目录范围无效');
 const domain=s=>{try{const p=parseScope(s);return p.platform===platform&&p.account===account?p:null;}catch{return null;}};
  const sourceMeta=id=>id==null?null:db.prepare('SELECT id,scope,personaId,speaker,created FROM messages WHERE id=?').get(id);
  const sourceValid=(id,origin)=>id==null||store.cognition.sourceAllowed(Number(id),origin);
  const provenance=(kind,id,sourceId)=>[...new Set([sourceId,...(kind==='note'?db.prepare("SELECT messageId FROM cognition_sources WHERE ownerKind='note' AND ownerId=?").all(id).map(r=>r.messageId):db.prepare('SELECT messageId FROM memory_evidence WHERE memoryId=?').all(id).map(r=>r.messageId))].filter(x=>x!=null))];
  const policies=new Map(),policy=s=>{if(!policies.has(s))policies.set(s,context.policy?.(s)??{enabled:!context.policy,personaId});return policies.get(s);},shared=store.shared;
  const sharedRows=db.prepare('SELECT id,memoryId FROM shared_facts WHERE active=1 AND account=?').all(account),sharedByMemory=new Map(sharedRows.map(r=>[r.memoryId,shared.fact(r.id)]));
  const spaces=store.continuity.list().filter(s=>s.enabled&&s.account===account&&(!personaId||s.personaId===personaId));
  function crossAccess(origin,owner,person,type,record){
    if(!scope||origin===scope)return 'local';
    if(!owner||context.purpose==='recall'&&String(owner)!==String(context.members?.[0]))return null;
    const selectedPersona=personaId||policy(scope).personaId||'default';
    const ctx=store.continuity.context(scope,owner,policy);ctx.personaId=selectedPersona;
    if(parseScope(scope).kind==='private'&&parseScope(scope).peer!==owner)return null;
    if(type==='fact'){
      const f=sharedByMemory.get(record.id);
      if(f&&f.owner===owner&&shared.allowed(f,ctx))return 'shared';
      if(!['fact','preference'].includes(record.type))return null;
    }else if(type==='note'&&!(parseScope(origin).kind==='private'&&record.domain==='note'&&['user','feedback','project','moment','upcoming'].includes(record.kind)))return null;
    if(spaces.some(s=>s.owner===owner&&store.continuity.route(s,ctx,origin)&&(!person||person===s.personaId)))return 'continuity';
    return null;
  }
  const records=[];
  for(const f of store.fixedMemories())records.push({id:'fixed:'+f.id,type:'fixed',title:text(f.text,36),body:f.text,scope:'',personaId:'*',owner:'',sources:[],created:'',updated:'',status:'固定设定',access:'local',version:null,pinned:false,confirmations:0});
  // Iteration avoids an arbitrary SQL pre-limit silently hiding older matches.
  for(const m of db.prepare('SELECT * FROM memories ORDER BY updated DESC,id DESC').iterate()){
    const who=domain(m.scope);if(!who||m.expires&&m.expires<=Date.now()||!sourceValid(m.sourceId,who.scope))continue;
    const sources=provenance('fact',m.id,m.sourceId);if(!sources.every(id=>sourceValid(id,who.scope)))continue;
    const meta=sourceMeta(m.sourceId),person=meta?.personaId||'',owner=who.kind==='private'?who.peer:who.member||'';
    const access=crossAccess(who.scope,owner,person,'fact',m);if(!access)continue;
    if(personaId&&person&&person!==personaId&&access!=='shared')continue;
    const version=db.prepare("SELECT min(created) created,max(id) version FROM memory_versions WHERE memoryId=? AND status='current'").get(m.id);
    records.push({id:'fact:'+m.id,subtype:m.type,type:m.type==='event'?'event':m.type==='commitment'?'plan':'fact',title:m.key,body:m.value,scope:who.scope,personaId:person,owner,sources,created:version.created??m.updated,updated:m.updated,status:m.pinned?'固定事实':'有效记忆',access,version:version.version,pinned:!!m.pinned,confirmations:Number(m.confirmations??0)});
  }
  for(const n of db.prepare("SELECT * FROM memory_notes WHERE status='active' ORDER BY updated DESC,id").iterate()){
    const who=domain(n.scope);if(!who||personaId&&n.personaId!==personaId||!sourceValid(n.sourceId,n.scope)||!store.cognition.validSources('note',n.id,n.scope))continue;
    const owner=who.kind==='private'?who.peer:'';
    const access=crossAccess(n.scope,owner,n.personaId,'note',n);if(!access)continue;
    const type=n.kind==='upcoming'?'plan':n.domain==='notebook'?'note':n.domain==='knowledge'?'topic':n.kind==='moment'?'event':'fact';
    records.push({id:'note:'+n.id,subtype:n.kind,type,title:n.title,body:n.text,domain:n.domain,noteKind:n.kind,noteState:n.state,scope:n.scope,personaId:n.personaId,owner,sources:provenance('note',n.id,n.sourceId),created:n.created,updated:n.updated,status:n.kind==='upcoming'?({planned:'计划中',due:'已到期',awaiting_result:'等待结果',completed:'已完成',cancelled:'已取消'}[n.state]??n.state):'有效笔记',access,version:db.prepare('SELECT max(id) n FROM note_revisions WHERE noteId=?').get(n.id).n,pinned:false,confirmations:0,domain:n.domain,noteKind:n.kind,noteState:n.state});
  }
  for(const n of store.archive?.rows({personaId,pending:context.includePending===true})??[]){if(!domain(n.scope))continue;const access=crossAccess(n.scope,n.owner,n.personaId,'archive',n);if(!access)continue;records.push({id:'archive:'+n.id,subtype:n.kind,type:n.kind==='event'?'event':n.kind==='commitment'?'plan':n.kind==='relationship'?'relationship':'fact',title:n.title,body:n.text,scope:n.scope,personaId:n.personaId,owner:n.owner,sources:store.archive.sources(n).map(s=>s.messageId),created:n.sourceAt??n.created,updated:n.updated,state:n.status,status:n.status==='pending'?'待审核':n.authority==='declaration'?'本人明确陈述':'已审核归纳',access,version:n.revision,pinned:false,confirmations:1,replaces:n.replaces,authority:n.authority});}

 const normalized=records.map(n=>{const state=n.state??'active',sourceVersions=n.sources.map(id=>{const row=db.prepare('SELECT scope,personaId,role,speaker,text,status,created FROM messages WHERE id=?').get(id);return {id,hash:digest(row)};}),isLocal=!scope||!n.scope||n.scope===scope,memberAllowed=context.allowAnyLocalMember&&n.access==='local'||!context.members?.length||!n.owner||context.members.map(String).includes(String(n.owner)),allowed=state==='active'&&safe(n.body)&&memberAllowed&&n.domain!=='observation'&&!(n.domain==='notebook'&&!store.archive.settings().diaryRecall)&&!(n.noteKind==='upcoming'&&n.noteState==='cancelled')&&(!n.id.startsWith('archive:')||store.archive.settings().enabled)&&(!scope&&!n.scope||policy(scope||n.scope).enabled!==false);
 const permission={platform,account,scope:n.scope,personaId:n.personaId,owner:n.owner,access:n.access,recallAllowed:allowed,reason:state!=='active'?'尚未批准':!memberAllowed?'不是当前允许的人物':!allowed?'资料类型、设置或聊天授权限制':isLocal?'本聊天可用':'已有共享/续聊授权'};
 return {...n,state,sourceVersions,permission,fingerprint:digest({id:n.id,title:n.title,body:n.body,scope:n.scope,personaId:n.personaId,owner:n.owner,state,version:n.version,sourceVersions}),catalogId:n.id};});
 const byId=new Map(normalized.map(n=>[n.id,n])),valid=(n,visited=new Set(),depth=0)=>{if(depth>4||visited.has(n.id))return false;const next=new Set(visited).add(n.id);for(const source of n.sources)for(const ref of this.dependencies(source)){const original=byId.get(ref.catalogId);if(!original||original.fingerprint!==ref.fingerprint||!valid(original,next,depth+1))return false;}return true;};return normalized.filter(n=>valid(n)&&(context.purpose!=='recall'||n.permission.recallAllowed));
 }
 get(id,context={}){return this.list(context).find(n=>n.id===id)??null;}
 filter(records,params={},context={}){const types=String(params.types??'').split(',').filter(Boolean),valid=['fixed','fact','event','note','topic','plan','relationship'],query=String(params.query??'').trim().toLowerCase(),until=String(params.until??'');if(query.length>200||types.some(t=>!valid.includes(t)))throw Error('记忆目录筛选无效');if(until&&(!/^\d{4}-\d{2}-\d{2}$/.test(until)||!Number.isFinite(Date.parse(until))||new Date(until).toISOString().slice(0,10)!==until))throw Error('日期无效');const contacts=this.store.contacts(context.account??this.store.meta('lastAccount')??''),names=new Map(contacts.map(c=>[(context.platform??this.store.meta('platform'))+':'+c.account+':'+c.kind+':'+c.peer,c.name]));return records.filter(n=>(!types.length||types.includes(n.type))&&(!query||(n.title+' '+n.body+' '+(names.get(n.scope)??'')+' '+(contacts.find(c=>c.kind==='private'&&c.peer===n.owner)?.name??n.owner)).toLowerCase().includes(query))&&(!until||!n.created||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(n.created.replace(' ','T')+(/Z$|[+]\d\d:\d\d$/.test(n.created)?'':'Z')))<=until));}
 page(context,params={}){const limit=params.limit==null?500:Number(params.limit),offset=Number(params.cursor??0);if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0)throw Error('记忆目录分页无效');const records=this.filter(this.list(context),params,context),revision=digest(records.map(n=>[n.id,n.fingerprint,n.permission]));if(params.revision===revision)return {unchanged:true,revision};return {schema:1,platform:context.platform,account:context.account,scope:context.scope??'',personaId:context.personaId??'',records:records.slice(offset,offset+limit),total:records.length,offset,nextCursor:offset+limit<records.length?String(offset+limit):null,revision,readOnly:true};}
 fresh(refs,context){const records=new Map(this.list({...context,purpose:'recall'}).map(n=>[n.id,n]));return refs.every(ref=>records.get(ref.catalogId)?.fingerprint===ref.fingerprint);}
 search(context,query,{limit=8}={}){if(!String(query).trim())return [];const semantic=this.store.archive.semanticHits(query,context.scope,context.personaId),lexical=new Map();for(const member of context.members??[]){const scope=context.scope.includes(':group:')?context.scope+':member:'+member:context.scope;for(const m of this.store.living.candidates(scope,query))lexical.set('fact:'+m.id,m.score*40);}return this.list({...context,purpose:'recall'}).filter(n=>n.type!=='fixed').filter(n=>!/(?:叫什么|叫啥|名字|姓名|称呼)/u.test(query)||/(?:生日|出生|生辰)/u.test(query)||!/(?:生日|出生|生辰)/u.test(n.title+' '+n.body)||/(?:名字|姓名|称呼|叫我)/u.test(n.title+' '+n.body)).map(n=>({...n,score:(this.store.archive.rank(n.title+' '+n.body,query)+(semantic.get(n.id)??0)*3+(lexical.get(n.id)??0))*(n.pinned?1.5:1),reason:semantic.has(n.id)?'语义与词法混合检索':'词法与概念扩展'})).filter(n=>n.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);}
 neighbors(seeds,context,{limit=2}={}){if(limit<=0)return [];const records=this.list({...context,purpose:'recall'}),byId=new Map(records.map(n=>[n.id,n])),selected=new Set(seeds.map(n=>n.catalogId??n.id)),seedRows=[...selected].map(id=>byId.get(id)).filter(Boolean),explicit=this.db.prepare('SELECT * FROM archive_edges').all(),result=[];for(const n of records){if(selected.has(n.id)||!['event','plan','relationship'].includes(n.type))continue;let relation=null,via=null;for(const seed of seedRows){if(n.scope!==seed.scope||n.personaId!==seed.personaId||n.owner&&seed.owner&&n.owner!==seed.owner)continue;const shared=n.sources.find(id=>seed.sources.includes(id));if(shared!=null){relation='同一原文来源 #'+shared;via=seed.id;break;}const edge=explicit.find(e=>e.a===seed.id&&e.b===n.id||e.b===seed.id&&e.a===n.id);if(edge){relation=edge.relation;via=seed.id;break;}}if(relation)result.push({...n,via,relation,reason:'一跳事件关联补查；'+relation});if(result.length>=Math.min(2,limit))break;}return result;}
}
