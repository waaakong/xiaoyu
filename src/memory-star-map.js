import {createHash} from 'node:crypto';
import {parseScope} from './chat-identity.js';

const recordTypes=new Set(['fixed','fact','event','note','topic','plan','relationship']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp=value=>String(value??'').replace(' ','T').replace(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)$/,'$1Z');
const dateOf=value=>{const s=stamp(value);if(!s)return '';const at=new Date(s);return Number.isFinite(+at)?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(at):'';};
const text=(value,max=180)=>String(value??'').slice(0,max);
const ageDays=value=>{const time=Date.parse(stamp(value));return Number.isFinite(time)?Math.max(0,Math.floor((Date.now()-time)/86400000)):null;};
const baseWeight={fixed:1.8,plan:1.35,event:1.15,fact:1,note:.85,topic:.8};
const weightOf=n=>{const confirm=Math.min(1.6,1+Math.log2(1+Math.max(0,Number(n.confirmations??0)))*.35),sources=Math.min(1.25,1+(n.sources?.length??0)*.15),age=ageDays(n.created??n.updated),recency=age==null?1:Math.max(.55,1-age/900);return Number(((baseWeight[n.type]??.8)*confirm*(n.pinned?1.25:1)*sources*recency).toFixed(2));};

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
  const records=store.catalog.list({platform,account,scope,personaId,policy:s=>runtime.configPolicy(s)});
  const runs=db.prepare('SELECT * FROM recall_runs ORDER BY created DESC LIMIT 1000').all().filter(r=>domain(r.scope)&&(!scope||r.scope===scope)&&(!personaId||r.personaId===personaId));
  const used=new Map(),runNodes=new Map();for(const r of runs){let d;try{d=JSON.parse(r.data);}catch{continue;}const ids=new Set((d.entries??[]).map(e=>e.catalogId??(/^(fact|archive|note|fixed):/.test(String(e.id))?e.id:e.kind==='memory'?'fact:'+e.id:e.kind==='archive'?'archive:'+e.id:e.kind==='note'?'note:'+e.id:null)).filter(Boolean));runNodes.set(r.id,ids);for(const id of ids){const old=used.get(id)??{count:0,last:r.created};old.count++;used.set(id,old);}}
  if(params.runId&&!runNodes.has(params.runId))throw Error('召回记录不在当前读取范围');
  if(params.runId){const run=runs.find(r=>r.id===params.runId);const data=JSON.parse(run.data);for(const [i,e]of (data.entries??[]).entries()){if(!['summary','episode','continuity-message','continuity-archive','shared'].includes(e.kind))continue;const id='trace:'+run.id+':'+i,source=e.kind==='episode'?sourceMeta(e.id):null;if(source&&(source.scope!==run.scope||!sourceValid(source.id,source.scope)))continue;runNodes.get(run.id).add(id);records.push({id,type:e.kind==='episode'?'event':'topic',title:e.kind==='summary'?'本轮使用的摘要片段':'本轮检索 · '+e.kind,body:(e.reason??'本轮实际召回项')+'；使用'+(e.chars??0)+'字符。此处只展示当时的召回诊断，没有保留的正文快照不会用现在的内容代替。',scope:run.scope,personaId:run.personaId,owner:'',sources:source?[source.id]:[],created:run.created,updated:run.created,status:'召回诊断，不是新增独立记忆',access:'local',version:null,pinned:false,confirmations:0});}}
  const filtered=store.catalog.filter(records,params,{platform,account}).filter(n=>!params.runId||runNodes.get(params.runId).has(n.id));
  const counts=Object.fromEntries([...recordTypes].map(t=>[t,filtered.filter(n=>n.type===t).length]));
  const dates=filtered.map(n=>dateOf(n.created??n.updated)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const stats={total:filtered.length,fixed:counts.fixed,pinned:filtered.filter(n=>n.pinned).length,people:new Set(filtered.map(n=>n.owner).filter(Boolean)).size,chats:new Set(filtered.map(n=>n.scope).filter(Boolean)).size,sources:new Set(filtered.flatMap(n=>n.sources)).size,first:dates[0]??null,last:dates.at(-1)??null,spanDays:dates.length?Math.max(0,Math.round((Date.parse(dates.at(-1))-Date.parse(dates[0]))/86400000)):0,types:counts};
  const revision=digest({platform,account,scope,personaId,query,until,requestedTypes,offset,limit,runId:params.runId??'',used:[...used],records:filtered,contacts:[...contacts].map(([s,c])=>[s,c.name]),personas:personas.map(p=>[p.id,p.name])});
  if(params.revision===revision&&!params.node)return {unchanged:true,revision,platform,account};
  const page=filtered.slice(offset,offset+limit).map(n=>({...n,recallCount:used.get(n.id)?.count??0,lastRecall:used.get(n.id)?.last??null,ageDays:ageDays(n.created??n.updated),weight:weightOf(n)})),nodes=new Map(),edges=[];
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
  if(store.archive)for(const e of db.prepare('SELECT * FROM archive_edges').all())if(nodes.has(e.a)&&nodes.has(e.b))link(e.a,e.b,e.relation);
  const result={schema:1,platform,account,scope,personaId,revision,nodes:[...nodes.values()],edges,counts,stats,total:filtered.length,visible:page.length,offset,nextCursor:offset+limit<filtered.length?String(offset+limit):null,earliest:stats.first,asOf:new Date().toISOString(),unassigned:filtered.filter(n=>!n.personaId).length,scopeLabel:scope?(contacts.get(scope)?.name??parseScope(scope).peer):'全部本机聊天',readOnly:true};
  result.latestRecall=runs[0]?{id:runs[0].id,created:runs[0].created}:null;result.recallFilter=params.runId??null;
  if(params.node){
    const n=filtered.find(n=>n.id===params.node);
    if(!n)throw Error('这条记忆已失效、被筛选或不在当前读取范围');
    result.detail={...n,recallCount:used.get(n.id)?.count??0,lastRecall:used.get(n.id)?.last??null,ageDays:ageDays(n.created??n.updated),weight:weightOf(n),body:n.body,personaName:n.personaId==='*'?'全部人格':store.persona(n.personaId)?.name??'未标注人格',scopeLabel:n.scope?(contacts.get(n.scope)?.name??n.scope):'当前平台全局设定',sources:n.sources.map(id=>{if(!sourceValid(id,n.scope))throw Error('来源已失效');const s=store.source(id);return {id,scope:s.scope,speaker:s.speaker,created:s.created,text:s.text};})};
  }
  return result;
}
