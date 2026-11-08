import {createHash} from 'node:crypto';
import {parseScope} from './chat-identity.js';

const recordTypes=new Set(['fixed','fact','event','note','topic','plan']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=value=>String(value??'').replace(' ','T').replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/,'$1Z');
const text=(value,max=180)=>String(value??'').slice(0,max);

// This is an administrative, read-only projection. A selected chat never gains
// access to another chat merely because both are visible in the local catalogue.
export function memoryStarMap(runtime,params={}){
  const {store,platform='qq'}=runtime,db=store.db;
  const scope=String(params.scope??''),personaId=String(params.personaId??''),query=String(params.query??'').trim().toLowerCase();
  if(query.length>200)throw Error('搜索词最多200字');
  if(scope)runtime.assertScope(scope);
  if(personaId&&!store.persona(personaId))throw Error('人格不存在');
  const account=String(runtime.manager?.config?.account||runtime.accountId||store.meta('lastAccount')||'');
  const domain=s=>{try{const p=parseScope(s);return p.platform===platform&&p.account===account?p:null;}catch{return null;}};
  if(scope&&!domain(scope))throw Error('聊天不属于当前账号');
  const until=String(params.until??'');
  if(until&&(!/^\d{4}-\d{2}-\d{2}$/.test(until)||Number.isNaN(Date.parse(until))||new Date(until).toISOString().slice(0,10)!==until))throw Error('日期无效');
  const requestedTypes=String(params.types??'').split(',').filter(Boolean);
  if(requestedTypes.some(t=>!recordTypes.has(t)))throw Error('节点类型无效');
  const limit=params.limit==null?500:Number(params.limit),offset=params.cursor==null?0:Number(params.cursor);
  if(!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(offset)||offset<0)throw Error('分页无效');
  // The graph needs names, not the per-contact effective policy catalogue.
  // In WeChat that catalogue rereads configuration once per cached contact.
  const contacts=new Map(store.contacts(account).map(c=>[`${platform}:${account}:${c.kind}:${c.peer}`,c])),personas=store.personas();
  const sourceMeta=id=>id==null?null:db.prepare('SELECT id,scope,personaId,speaker,created FROM messages WHERE id=?').get(id);
  const sourceValid=(id,origin)=>id==null||store.cognition.sourceAllowed(Number(id),origin);
  const provenance=(kind,id,sourceId)=>[...new Set([sourceId,...(kind==='note'?db.prepare("SELECT messageId FROM cognition_sources WHERE ownerKind='note' AND ownerId=?").all(id).map(r=>r.messageId):db.prepare('SELECT messageId FROM memory_evidence WHERE memoryId=?').all(id).map(r=>r.messageId))].filter(x=>x!=null))];
  const policy=s=>runtime.configPolicy(s),shared=store.shared;
  const sharedRows=db.prepare('SELECT id,memoryId FROM shared_facts WHERE active=1 AND account=?').all(account),sharedByMemory=new Map(sharedRows.map(r=>[r.memoryId,shared.fact(r.id)]));
  const spaces=store.continuity.list().filter(s=>s.enabled&&s.account===account&&(!personaId||s.personaId===personaId));
  function crossAccess(origin,owner,person,type,record){
    if(!scope||origin===scope)return 'local';
    if(!owner)return null;
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
  for(const f of store.fixedMemories())records.push({id:'fixed:'+f.id,type:'fixed',title:text(f.text,36),body:f.text,scope:'',personaId:'*',owner:'',sources:[],created:'',updated:'',status:'固定设定',access:'local',version:null});
  // Iteration avoids an arbitrary SQL pre-limit silently hiding older matches.
  for(const m of db.prepare('SELECT * FROM memories ORDER BY updated DESC,id DESC').iterate()){
    const who=domain(m.scope);if(!who||m.expires&&m.expires<=Date.now()||!sourceValid(m.sourceId,who.scope))continue;
    const sources=provenance('fact',m.id,m.sourceId);if(!sources.every(id=>sourceValid(id,who.scope)))continue;
    const meta=sourceMeta(m.sourceId),person=meta?.personaId||'',owner=who.kind==='private'?who.peer:who.member||'';
    const access=crossAccess(who.scope,owner,person,'fact',m);if(!access)continue;
    if(personaId&&person&&person!==personaId&&access!=='shared')continue;
    const version=db.prepare("SELECT min(created) created,max(id) version FROM memory_versions WHERE memoryId=? AND status='current'").get(m.id);
    records.push({id:'fact:'+m.id,type:m.type==='event'?'event':m.type==='commitment'?'plan':'fact',title:m.key,body:m.value,scope:who.scope,personaId:person,owner,sources,created:version.created??m.updated,updated:m.updated,status:m.pinned?'固定事实':'有效记忆',access,version:version.version});
  }
  for(const n of db.prepare("SELECT * FROM memory_notes WHERE status='active' ORDER BY updated DESC,id").iterate()){
    const who=domain(n.scope);if(!who||personaId&&n.personaId!==personaId||!sourceValid(n.sourceId,n.scope)||!store.cognition.validSources('note',n.id,n.scope))continue;
    const owner=who.kind==='private'?who.peer:'';
    const access=crossAccess(n.scope,owner,n.personaId,'note',n);if(!access)continue;
    const type=n.kind==='upcoming'?'plan':n.domain==='notebook'?'note':n.domain==='knowledge'?'topic':n.kind==='moment'?'event':'fact';
    records.push({id:'note:'+n.id,type,title:n.title,body:n.text,scope:n.scope,personaId:n.personaId,owner,sources:provenance('note',n.id,n.sourceId),created:n.created,updated:n.updated,status:n.kind==='upcoming'?({planned:'计划中',due:'已到期',awaiting_result:'等待结果',completed:'已完成',cancelled:'已取消'}[n.state]??n.state):'有效笔记',access,version:db.prepare('SELECT max(id) n FROM note_revisions WHERE noteId=?').get(n.id).n});
  }
  const filtered=records.filter(n=>(!requestedTypes.length||requestedTypes.includes(n.type))&&(!query||(n.title+' '+n.body+' '+(contacts.get(n.scope)?.name??'')+' '+(contacts.get(`${platform}:${account}:private:${n.owner}`)?.name??n.owner)).toLowerCase().includes(query))&&(!until||!n.created||stamp(n.created).slice(0,10)<=until));
  const counts=Object.fromEntries([...recordTypes].map(t=>[t,filtered.filter(n=>n.type===t).length]));
  const revision=digest({platform,account,scope,personaId,query,until,requestedTypes,offset,limit,records:filtered,contacts:[...contacts].map(([s,c])=>[s,c.name]),personas:personas.map(p=>[p.id,p.name])});
  if(params.revision===revision&&!params.node)return {unchanged:true,revision,platform,account};
  const page=filtered.slice(offset,offset+limit),nodes=new Map(),edges=[];
  const add=n=>{if(!nodes.has(n.id))nodes.set(n.id,n);return n.id;},link=(a,b,label)=>edges.push({id:digest([a,b,label]).slice(0,24),a,b,label});
  const root=add({id:'center:'+platform+':'+account,type:'center',title:personaId?store.persona(personaId).name:'小鱼',summary:'当前平台的本机记忆',scope:'',personaId,created:''});
  for(const n of page){
    add({...n,body:undefined,sources:undefined,summary:text(n.body,200),sourceCount:n.sources.length});
    if(n.personaId&&n.personaId!=='*'){
      const p=add({id:'persona:'+n.personaId,type:'persona',title:store.persona(n.personaId)?.name??'已移除人格',summary:'已记录的人格归属',personaId:n.personaId});link(root,p,'人格');link(p,n.id,'归属人格');
    }else link(root,n.id,n.type==='fixed'?'固定设定':'未标注人格');
    if(n.scope){const c=add({id:'chat:'+n.scope,type:'chat',title:contacts.get(n.scope)?.name||parseScope(n.scope).peer,summary:parseScope(n.scope).kind==='private'?'私聊':'群聊',scope:n.scope});link(c,n.id,n.access==='shared'?'已授权共享':n.access==='continuity'?'续聊授权':'记录归属');}
    if(n.owner){const p=add({id:'person:'+platform+':'+account+':'+n.owner,type:'person',title:contacts.get(`${platform}:${account}:private:${n.owner}`)?.name||n.owner,summary:'按真实账号标识关联，不按昵称合并',owner:n.owner});link(p,n.id,'记忆归属账号');}
  }
  // Shared provenance is an explicit, traceable relation; coincident words are not.
  const bySource=new Map();for(const n of page)for(const id of n.sources){const other=bySource.get(id);if(other&&other!==n.id)link(other,n.id,'同一来源 #'+id);else bySource.set(id,n.id);}
  const result={schema:1,platform,account,scope,personaId,revision,nodes:[...nodes.values()],edges,counts,total:filtered.length,visible:page.length,offset,nextCursor:offset+limit<filtered.length?String(offset+limit):null,earliest:records.map(n=>stamp(n.created).slice(0,10)).filter(Boolean).sort()[0]??null,asOf:new Date().toISOString(),unassigned:filtered.filter(n=>!n.personaId).length,scopeLabel:scope?(contacts.get(scope)?.name??parseScope(scope).peer):'全部本机聊天',readOnly:true};
  if(params.node){
    const n=filtered.find(n=>n.id===params.node);
    if(!n)throw Error('这条记忆已失效、被筛选或不在当前读取范围');
    result.detail={...n,body:n.body,personaName:n.personaId==='*'?'全部人格':store.persona(n.personaId)?.name??'未标注人格',scopeLabel:n.scope?(contacts.get(n.scope)?.name??n.scope):'当前平台全局设定',sources:n.sources.map(id=>{if(!sourceValid(id,n.scope))throw Error('来源已失效');const s=store.source(id);return {id,scope:s.scope,speaker:s.speaker,created:s.created,text:s.text};})};
  }
  return result;
}
