import {createStarCanvas,starTypes} from './star-map-canvas.js';

export function installMemoryStarMap({api,node,button,notice,showPage,getCatalog}){
  const stylesheet=node('link');stylesheet.rel='stylesheet';stylesheet.href='/memory-star-map.css';
  const styled=new Promise(resolve=>{stylesheet.onload=resolve;stylesheet.onerror=resolve;});document.head.append(stylesheet);
  const nav=document.querySelector('aside nav'),anchor=nav.querySelector('[data-page="memories"]');
  const entry=button('记忆星图',()=>open(),'');entry.dataset.page='starMap';entry.dataset.title='记忆星图';entry.title='记忆星图';entry.replaceChildren();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.innerHTML='<path d="m6 6 12 2-7 11L6 6m5 13 8-4M6 6l-2 9"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="11" cy="19" r="2"/><circle cx="4" cy="15" r="1"/><circle cx="19" cy="15" r="1"/>';entry.append(svg,node('span','nav-label','记忆星图'));nav.insertBefore(entry,anchor);
  const page=node('section','page star-workspace');page.id='starMap';page.hidden=true;document.querySelector('main').append(page);
  let graph=null,selected=null,view='galaxy',scope='',personaId='',query='',until='',cursor=0,seq=0,detailSeq=0,pending,detailAbort,initialized=false,timer,debounce,pollBusy=false,dirty=false;
  const enabled=new Set(['fixed','fact','event','note','topic','plan']);
  const heading=node('div','star-heading'),title=node('div');title.append(node('p','star-eyebrow','记忆与成长'),node('h1','','记得的事，彼此相连'),node('p','star-intro','循着记忆，找到人、故事和它的来处。'));heading.append(title);
  const shortcuts=node('div','star-shortcuts');for(const [id,label]of [['memories','记忆库'],['notebook','记事本']])shortcuts.append(button(label,()=>document.querySelector(`nav [data-page="${id}"]`)?.click(),'quiet'));heading.append(shortcuts);page.append(heading);
  const filter=node('div','star-filters');filter.setAttribute('aria-label','星图筛选');
  const scopeSelect=node('select'),personaSelect=node('select'),search=node('input'),date=node('input');scopeSelect.setAttribute('aria-label','星图聊天范围');personaSelect.setAttribute('aria-label','星图人格');search.type='search';search.placeholder='搜索记忆、人或内容';search.setAttribute('aria-label','搜索星图');search.maxLength=200;date.type='date';date.setAttribute('aria-label','记忆截至日期');
  const field=(label,control,cls='')=>{const l=node('label','star-field '+cls);l.append(node('span','',label),control);return l;};
  filter.append(field('聊天范围',scopeSelect),field('人格',personaSelect),field('搜索',search,'star-search'),field('截至日期',date));
  const clear=button('重置筛选',()=>{scope='';personaId='';query='';until='';cursor=0;scopeSelect.value='';personaSelect.value='';search.value='';date.value='';for(const type of enabledTypes)enabled.add(type);syncTypes();refresh({clear:true});},'quiet');filter.append(clear);page.append(filter);
  const controlbar=node('div','star-controlbar'),types=node('div','star-type-filter'),viewbar=node('div','star-view-switch');types.setAttribute('aria-label','记忆类型');viewbar.setAttribute('aria-label','星图显示方式');
  const enabledTypes=[...enabled],typeButtons=new Map();
  for(const type of enabledTypes){const b=button(starTypes[type][0],()=>{enabled.has(type)?enabled.delete(type):enabled.add(type);syncTypes();cursor=0;refresh({clear:true});},'star-type');b.dataset.type=type;const dot=node('i');dot.style.setProperty('--star-color',starTypes[type][1]);b.prepend(dot);typeButtons.set(type,b);types.append(b);}
  function syncTypes(){for(const [type,b]of typeButtons)b.setAttribute('aria-pressed',String(enabled.has(type)));}syncTypes();
  const modes=new Map();for(const [id,label]of [['galaxy','银河'],['relations','关系'],['list','列表']]){const b=button(label,()=>setView(id),'quiet');b.setAttribute('aria-pressed',String(id===view));modes.set(id,b);viewbar.append(b);}controlbar.append(types,viewbar);page.append(controlbar);
  const status=node('div','star-status'),statusText=node('span','','准备读取本机记忆'),refreshButton=button('刷新',()=>refresh({clear:true}),'quiet');status.setAttribute('role','status');status.append(statusText,refreshButton);page.append(status);
  const layout=node('div','star-layout'),visual=node('div','star-visual'),canvas=node('canvas','star-canvas'),list=node('div','star-record-list'),empty=node('div','star-empty'),hover=node('div','star-hover');canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','记忆星图，左右方向键选择节点，加减号缩放；也可切换列表操作');list.hidden=true;list.setAttribute('aria-label','记忆列表');empty.hidden=true;hover.hidden=true;visual.append(canvas,list,empty,hover);
  const info=node('div','star-map-caption'),count=node('strong','','0'),scopeCaption=node('span','','真实本机数据');info.append(count,scopeCaption);visual.append(info);
  const tools=node('div','star-map-tools');for(const [label,caption,fn]of [['放大星图','＋',()=>map.zoom(1.15)],['缩小星图','−',()=>map.zoom(.85)],['复位星图','⌂',()=>map.reset()]]){const b=button(caption,fn,'quiet');b.setAttribute('aria-label',label);b.title=label;tools.append(b);}visual.append(tools);
  const help=node('div','star-map-help'),rotateLabel=node('label','star-auto'),rotate=node('input');rotate.type='checkbox';rotate.setAttribute('aria-label','星图缓慢自转');rotate.onchange=()=>map.rotate(rotate.checked);rotateLabel.append(rotate,node('span','','缓慢自转'));help.append(node('span','','拖动旋转 · 滚轮缩放 · 点选查看'),rotateLabel);visual.append(help);
  const detail=node('aside','star-detail');detail.setAttribute('aria-label','星图记忆详情');layout.append(visual,detail);page.append(layout);
  const footer=node('div','star-footer'),pagination=node('div','star-pagination'),previous=button('上一页',()=>{cursor=Math.max(0,cursor-500);refresh({clear:true});},'quiet'),next=button('下一页',()=>{cursor=Number(graph.nextCursor);refresh({clear:true});},'quiet'),pageLabel=node('span');pagination.append(previous,pageLabel,next);footer.append(node('p','','只读星图 · 装饰星尘不计入记忆 · 不消耗模型额度'),pagination);page.append(footer);
  const map=createStarCanvas(canvas,{onSelect:choose,onHover:n=>{hover.hidden=!n;hover.textContent=n?.title??'';}});
  const options=(select,items,value)=>{select.replaceChildren();for(const [v,label]of items){const o=node('option','',label);o.value=v;select.append(o);}select.value=value;};
  function catalogue(){const c=getCatalog();options(scopeSelect,[['','全部本机聊天'],...c.contacts.items.map(x=>[x.scope,(x.kind==='group'?'群 · ':'私聊 · ')+x.name])],scope);options(personaSelect,[['','全部人格'],...c.personas.map(p=>[p.id,p.name])],personaId);}
  function args(extra={}){return new URLSearchParams({scope,personaId,query,until,types:[...enabled].join(','),cursor:String(cursor),...extra}).toString();}
  function clearData(){graph=null;selected=null;detailSeq++;detailAbort?.abort();map.setData({nodes:[],edges:[]});map.select('');list.replaceChildren();renderDetail();count.textContent='读取中';previous.disabled=true;next.disabled=true;}
  function showEmpty(title,copy){empty.replaceChildren(node('strong','',title),node('p','',copy));empty.hidden=false;}
  async function refresh({clear=false,conditional=false,isCurrent=()=>true}={}){
    const request=++seq;pending?.abort();pending=new AbortController();
    if(clear){clearData();dirty=true;statusText.textContent='正在读取当前范围…';showEmpty('正在整理星图','仅查询本机记录，不调用模型。');}
    try{
      if(!enabled.size){dirty=false;graph={platform:sessionStorage.getItem('xyPlatform')??'qq',nodes:[],edges:[],total:0,visible:0,counts:{},offset:0,nextCursor:null,scopeLabel:'当前范围'};renderGraph();return true;}
      const result=await api('cognition/star-map?'+args(conditional&&graph?{revision:graph.revision}:{}),undefined,{signal:pending.signal});
      if(request!==seq||!isCurrent())return false;if(result.unchanged)return true;
      graph=result;dirty=false;renderGraph();if(selected){const n=result.nodes.find(n=>n.id===selected.id);if(n)await choose(n);else{selected=null;renderDetail();map.select('');}}return true;
    }catch(e){if(e.name==='AbortError'||request!==seq||!isCurrent())return false;clearData();showEmpty('星图暂时无法读取',e.message);statusText.textContent='读取失败，可刷新重试';return true;}
  }
  function renderGraph(){
    map.setData(graph);count.textContent=graph.visible+' 条记忆';scopeCaption.textContent=(graph.platform==='wechat'?'微信':'QQ')+' · '+graph.scopeLabel;
    const label=graph.total?`当前显示 ${graph.offset+1}–${graph.offset+graph.visible} / ${graph.total} 条`:'当前范围还没有匹配记录';
    statusText.textContent=label+(graph.unassigned?' · '+graph.unassigned+' 条未标注人格':'')+' · 本机只读';
    previous.disabled=!cursor;next.disabled=graph.nextCursor==null;pageLabel.textContent=graph.total?`第 ${Math.floor(cursor/500)+1} 页`:'';
    if(graph.visible){empty.hidden=true;}else showEmpty('这里还没有点亮的记忆','可以调整筛选，或前往记忆库查看和记录。星图不会自动编造经历。');
    renderList();renderDetail();
  }
  function renderList(){list.replaceChildren();for(const n of graph?.nodes??[]){if(['center','persona','chat','person'].includes(n.type))continue;const row=button('',()=>choose(n),'star-list-row');row.dataset.nodeId=n.id;row.setAttribute('aria-pressed',String(n.id===selected?.id));row.append(node('span','star-list-kind',starTypes[n.type]?.[0]??n.type),node('strong','',n.title),node('span','',n.summary),node('small','',n.created?.slice(0,10)||'固定设定'));list.append(row);}}
  function renderDetail(){
    detail.replaceChildren();const top=node('div','star-detail-heading');top.append(node('span','','记忆详情'),node('span','star-readonly','只读'));detail.append(top);
    if(!selected){detail.append(node('div','star-detail-symbol','✧'),node('h2','','从一颗星开始'),node('p','star-detail-copy','点选节点或切换到列表，查看记忆内容、归属和来源。'),node('p','star-detail-tip','只展示已有记录的关联，不按昵称合并人物，也不推断私人关系。'));return;}
    const n=selected;detail.append(node('span','star-kind',starTypes[n.type]?.[0]??(n.type==='center'?'中心':n.type)),node('h2','',n.title),node('p','star-detail-copy',n.body??n.summary??''));
    if(n.loading)detail.append(node('p','star-detail-tip','正在核验来源与读取范围…'));
    const meta=node('dl');for(const [label,value]of [['归属',n.scopeLabel||(n.scope??'')||(n.type==='fixed'?'当前平台全局设定':'当前平台')],['人格',n.personaId==='*'?'全部人格':n.personaName??(getCatalog().personas.find(p=>p.id===n.personaId)?.name||'未标注人格')],['记录日期',n.created?.slice(0,10)||'未记录'],['状态',n.status??'导航节点'],['版本',n.version==null?'未记录':'#'+n.version]]){meta.append(node('dt','',label),node('dd','',value));}detail.append(meta);
    if(n.access&&n.access!=='local')detail.append(node('p','star-access',n.access==='shared'?'来自已授权的逐条共享':'来自已连接的续聊空间'));
    if(n.sources){const sources=node('div','star-sources');sources.append(node('h3','','来源原文'));if(!n.sources.length)sources.append(node('p','','本机录入或固定设定，没有聊天原文来源。'));for(const s of n.sources){const disclosure=node('details'),summary=node('summary');summary.textContent='#'+s.id+' · '+s.created;disclosure.append(summary,node('p','',s.text));sources.append(disclosure);}detail.append(sources);}
    const connections=graph?.edges.filter(e=>e.a===n.id||e.b===n.id)??[];if(connections.length){detail.append(node('h3','','与它相连'));const related=node('div','star-related');for(const e of connections.slice(0,24)){const other=graph.nodes.find(x=>x.id===(e.a===n.id?e.b:e.a));if(!other)continue;const b=button('',()=>choose(other),'quiet');b.append(node('span','',other.title),node('small','',e.label));related.append(b);}if(connections.length>24)related.append(node('p','',`另有 ${connections.length-24} 条关联，可通过列表或搜索缩小范围。`));detail.append(related);}
  }
  async function choose(n){
    if(!n)return;const request=++detailSeq;detailAbort?.abort();const record=/^(fact|note|fixed):/.test(n.id);selected={...n,loading:record};map.select(n.id);renderDetail();renderList();if(!record)return;
    detailAbort=new AbortController();try{const result=await api('cognition/star-map?'+args({node:n.id}),undefined,{signal:detailAbort.signal});if(request!==detailSeq||page.hidden)return;selected=result.detail;renderDetail();}catch(e){if(e.name==='AbortError'||request!==detailSeq)return;selected=null;map.select('');renderDetail();notice(e.message,true);await refresh({clear:true});}
  }
  function setView(id){view=id;for(const [m,b]of modes)b.setAttribute('aria-pressed',String(m===id));canvas.hidden=id==='list';list.hidden=id!=='list';tools.hidden=id==='list';help.hidden=id==='list';info.hidden=id==='list';hover.hidden=true;if(id!=='list')map.mode(id);map.active(!page.hidden&&id!=='list');}
  scopeSelect.onchange=()=>{scope=scopeSelect.value;cursor=0;refresh({clear:true});};personaSelect.onchange=()=>{personaId=personaSelect.value;cursor=0;refresh({clear:true});};date.onchange=()=>{until=date.value;cursor=0;refresh({clear:true});};search.oninput=()=>{query=search.value;cursor=0;clearTimeout(debounce);pending?.abort();clearData();debounce=setTimeout(()=>refresh({clear:true}),220);};
  async function open(){await styled;catalogue();return showPage('starMap',async({isCurrent})=>{initialized=true;return refresh({clear:!graph||dirty,isCurrent});});}
  const visibility=new MutationObserver(()=>{map.active(!page.hidden&&view!=='list');if(page.hidden){pending?.abort();detailAbort?.abort();seq++;detailSeq++;clearTimeout(debounce);selected=null;renderDetail();}else if(initialized&&dirty)void refresh({clear:true});});visibility.observe(page,{attributes:true,attributeFilter:['hidden']});
  timer=setInterval(async()=>{if(page.hidden||document.hidden||pollBusy||!initialized)return;pollBusy=true;try{await refresh({conditional:true});}finally{pollBusy=false;}},3000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(debounce);pending?.abort();detailAbort?.abort();visibility.disconnect();map.destroy();},{once:true});
  // Keep entry points close to the record lists without rebuilding those pages.
  const shortcutsObserver=new MutationObserver(()=>{for(const id of ['cognition','memories','people','notebook','knowledge']){const target=document.getElementById(id),h=target?.querySelector('.heading');if(!h||h.querySelector('.star-entry-link'))continue;const link=button('在星图中查看',()=>open(),'quiet star-entry-link');h.append(link);}});shortcutsObserver.observe(document.querySelector('main'),{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>shortcutsObserver.disconnect(),{once:true});return {open};
}
