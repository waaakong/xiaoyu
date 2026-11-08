export const forbidsNetwork=text=>/(?:不要|不用|禁止|别).{0,5}(?:联网|搜索|读取网页)/u.test(text);

export function sourceURL(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>1000||/[\r\n]/.test(value)||!u.hostname.includes('.')||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(u.hostname)||/\.(?:local|internal)$/i.test(u.hostname))return null;return u.href;}catch{return null;}}

export class NativeWebTrace {
  constructor(enabled,{now=Date.now}={}){this.enabled=enabled;this.now=now;this.items=new Map();this.sources=new Set();this.refs=new Map();}
  observe(method,item){
    if(!this.enabled||!['webSearch','web_search'].includes(item?.type)||!['item/started','item/completed'].includes(method))return;
    const id=String(item.id??'native-'+this.items.size),old=this.items.get(id),at=this.now();
    const operation=old??{id,at,kind:'search',provider:'Codex native',status:'running',durationMs:0};
    if(item.action?.type)operation.kind=String(item.action.type).slice(0,32);
    if(method==='item/completed'){operation.status=item.status==='failed'||item.error||item.results?.some(r=>r.type==='error')?'failed':'ok';operation.durationMs=Math.max(0,at-operation.at);}
    this.items.set(id,operation);
    const collect=(value,depth=0)=>{if(!value||typeof value!=='object'||depth>5)return;const reference=sourceURL(value.url);if(reference&&typeof value.ref_id==='string')this.refs.set(value.ref_id,reference);for(const [key,v]of Object.entries(value)){if(['url','uri'].includes(key)&&typeof v==='string'){const url=sourceURL(v);if(url)this.sources.add(url);}else if(v&&typeof v==='object')collect(v,depth+1);}};collect(item);
  }
  result(){const operations=[...this.items.values()].map(o=>({...o,durationMs:o.status==='running'?Math.max(0,this.now()-o.at):o.durationMs}));return {provider:'Codex native',mode:this.enabled?'live':'disabled',status:!this.enabled?'disabled':operations.some(o=>o.status==='ok')?'ok':operations.some(o=>o.status==='failed')?'failed':operations.length?'running':'not_used',operations,counts:{native:operations.length},sourceCount:this.sources.size};}
}

export function webReply(reply,sources,trace){
  let text=reply.replace(/cite([^]*)/gu,(_,refs)=>[...new Set(refs.split('').map(r=>trace.refs.get(r)).filter(Boolean))].join(' ')).replace(/[^]*/gu,'').trim();
  if(trace.result().status!=='ok')return text;
  const selected=(Array.isArray(sources)?sources:[]).map(s=>sourceURL(s?.url)).filter(url=>url&&trace.sources.has(url));
  const links=[...new Set(selected.length?selected:trace.sources)].slice(0,3);
  for(const url of links){if(text.includes(url))continue;const line='\n来源：'+url;if(text.length+line.length<=2400)text+=line;}
  return text;
}
