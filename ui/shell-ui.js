import {wrapActions} from './layout.js';
import {animateSubview} from './page-navigation.js';
import {workspacePages, applyPageIntroduction} from './workspace-copy.js';
import {installWorkspaceMotion} from './workspace-motion.js';
// Reorganize existing controls without replacing their handlers or form state.
export function installShell({node,button,notice,showPage,getSettings}){
  const $=id=>document.getElementById(id),main=$('workspace'),aside=document.querySelector('.shell>aside'),nav=aside.querySelector('nav');
  const icon=id=>{const e=node('span');e.innerHTML=`<svg class="icon" aria-hidden="true"><use href="/icons.svg#${id}"></use></svg>`;return e.firstChild;};
  const open=id=>document.querySelector(`nav [data-page="${id}"]`)?.click();
  const header=main.querySelector('header'),strip=node('div','connection-strip');strip.setAttribute('aria-label','平台与模型连接状态');header.after(strip);
  const dshStatus=button('DSH 检测中',()=>open('engines'),'status-chip');dshStatus.id='headerDsh';dshStatus.title='查看DSH连接、模型与额度';dshStatus.dataset.online='false';
  for(const id of ['headerQq','headerWechat','headerCodex'])if($(id))strip.append($(id));strip.append(dshStatus);if($('headerPlugins'))strip.append($('headerPlugins'));
  const domain=nav.querySelector('label');
  if(domain){
    const picker=domain.querySelector('select');
    const switcher=node('div','platform-switcher');
    switcher.setAttribute('role','group');
    switcher.setAttribute('aria-label','当前数据平台');
    switcher.append(node('span','platform-caption','数据空间'));
    const active=picker.value;
    const track=node('div','scope-track');
    track.append(node('span','scope-indicator'));
    switcher.append(track);
    let switching=false,setupView=false;
    const paintChoice=value=>{
      track.dataset.scope=value;
      for(const control of track.querySelectorAll('button'))control.setAttribute('aria-pressed',String(control.dataset.scope===value));
    };
    for(const option of picker.options){
      const choice=button(option.textContent.replace(/数据/g,'').trim(),async()=>{
        if(switching)return;
        if(option.value===active && !setupView)return;
        switching=true;
        try{
          if($('unsavedIndicator')?.hidden===false){notice('请先保存当前草稿',true);return;}
          paintChoice(option.value);
          if(setupView&&option.value===active){
            setupView=false;
            await showPage('overview');
            return;
          }
          picker.value=option.value;
          const result=await picker.onchange();
          setupView=result==='setup';
          if(result==='failed')paintChoice(active);
        }finally{switching=false;}
      },'platform-choice');
      choice.dataset.scope=option.value;track.append(choice);
    }
    paintChoice(active);
    new MutationObserver(()=>{
      if(setupView && $('wechatConnection').hidden){setupView=false;paintChoice(active);}
    }).observe($('wechatConnection'),{attributes:true,attributeFilter:['hidden']});
    header.insertBefore(switcher,header.querySelector('.topbar-actions'));
    domain.remove();
  }
  const viewControls=document.querySelector('.appearance-dialog');
  if(viewControls){
    const themeRow=node('div','appearance-theme-row');
    themeRow.append(node('span','','界面主题'),$('toggleTheme'));
    viewControls.querySelector('label').before(themeRow);
  }
  const updated=node('span','connection-updated');
  const scroller=node('div','workspace-scroll');scroller.id='workspaceScroll';
  for(const element of [...main.children])if(element!==header&&element!==strip)scroller.append(element);main.append(scroller);const placeholder=node('div','workspace-placeholder','正在准备工作台…');placeholder.setAttribute('role','status');scroller.prepend(placeholder);
  // Features install their pages dynamically. Keep all business pages in the
  // same scrolling region, including any later-added pages.
  new MutationObserver(records=>{for(const r of records)for(const e of r.addedNodes)if(e.nodeType===1&&e.classList.contains('page'))scroller.append(e);}).observe(main,{childList:true});
  const originalButtons=new Map([...nav.querySelectorAll('[data-page]')].map(b=>[b.dataset.page,b]));
  nav.replaceChildren();nav.setAttribute('aria-label','主导航');
  const group=(title,ids)=>{nav.append(node('div','nav-group',title));for(const id of ids){const b=originalButtons.get(id);if(b)nav.append(b);}};
  group('陪伴空间',['overview','chats','personas','assets','proactive','companion','life','video']);
  const memory=node('details','memory-navigation'),summary=node('summary');summary.append(icon('cognition'),node('span','nav-label','记忆与成长'));summary.setAttribute('aria-label','记忆与成长');summary.title='记忆与成长';memory.append(summary);for(const id of ['cognition','starMap','memories','people','notebook','diary','knowledge','continuity','learning','recall'])if(originalButtons.has(id))memory.append(originalButtons.get(id));nav.append(memory);
  group('社交与分享',['qzone','moments']);
  group('连接与能力',['wechatConnection','integrations','engines','models','voice','web','plugins']);
  group('工作台管理',['dependencies','usage','maintenance','settings']);
  for(const [id,b]of originalButtons){b.classList.add('nav-item');b.title=b.title||b.dataset.title||b.textContent.trim();for(const t of [...b.childNodes])if(t.nodeType===3&&t.textContent.trim()){const label=node('span','nav-label',t.textContent);t.replaceWith(label);}if(!b.isConnected)nav.append(b);if(!b.querySelector('svg'))b.prepend(icon(id==='proactive'?'chats':id==='wechatConnection'?'chats':id==='engines'?'models':id==='companion'?'overview':['qzone','moments'].includes(id)?'web':id==='diary'?'notebook':id==='life'?'life':id));}
  const collapse=button('«',()=>{document.body.classList.toggle('nav-collapsed');const on=document.body.classList.contains('nav-collapsed');collapse.textContent=on?'»':'«';collapse.setAttribute('aria-label',on?'展开导航':'折叠导航');localStorage.setItem('xyNavCollapsed',String(on));},'quiet');collapse.id='collapseNavigation';collapse.setAttribute('aria-label','折叠导航');aside.querySelector('.brand').append(collapse);
  if(localStorage.getItem('xyNavCollapsed')==='true'){document.body.classList.add('nav-collapsed');collapse.textContent='»';collapse.setAttribute('aria-label','展开导航');}
  const navColors={overview:'#8d9bfa',chats:'#62b4e9',personas:'#bd94ec',assets:'#e7aa66',proactive:'#e38eaa',companion:'#e091b9',life:'#63c4b0',video:'#c59aeb',engines:'#86a1ee',voice:'#d88dac',integrations:'#80ade8',wechatConnection:'#65c59e'};
  for(const [id,b] of originalButtons){
    const copy=workspacePages[id];
    if(copy){b.dataset.title=copy[0];b.title=copy[0];const label=b.querySelector('.nav-label');if(label)label.textContent=copy[0];}
    b.style.setProperty('--nav-color',navColors[id]??'#99a6c7');
    b.setAttribute('aria-current',id==='overview'?'page':'false');
  }
  const finder=node('input','page-finder');
  finder.type='search';
  finder.placeholder='查找功能';
  finder.setAttribute('aria-label','按名称查找工作台功能');
  const emptyResult=node('p','finder-empty','没有匹配的功能');
  emptyResult.hidden=true;
  aside.insertBefore(finder,nav);
  nav.append(emptyResult);
  let wasOpen=memory.open;
  finder.oninput=()=>{
    const query=finder.value.trim().toLowerCase();
    if(!nav.classList.contains('filtering'))wasOpen=memory.open;
    nav.classList.toggle('filtering',!!query);
    let matches=0;
    for(const b of originalButtons.values()){
      b.hidden=!!query&&!b.dataset.title.toLowerCase().includes(query);
      if(!b.hidden)matches++;
    }
    memory.hidden=!!query&&![...memory.querySelectorAll('button')].some(b=>!b.hidden);
    memory.open=query?true:wasOpen;
    emptyResult.hidden=matches!==0;
  };
  finder.onkeydown=event=>{
    if(event.key==='Escape'){finder.value='';finder.oninput();}
    if(event.key==='Enter'&&finder.value.trim())nav.querySelector('button:not([hidden])')?.click();
  };
  for(const page of document.querySelectorAll('.page'))applyPageIntroduction(page);
  // Dynamic feature pages keep their own rendering and handlers. Normalize only
  // their introduction after content has been committed.
  const pendingPages=new Set();let copyFrame;
  const copyObserver=new MutationObserver(records=>{
    for(const r of records){const page=r.target.nodeType===1?r.target.closest('.page'):r.target.parentElement?.closest('.page');if(page)pendingPages.add(page);}
    if(pendingPages.size&&!copyFrame)copyFrame=requestAnimationFrame(()=>{copyFrame=0;for(const p of pendingPages)applyPageIntroduction(p);pendingPages.clear();});
  });
  copyObserver.observe(scroller,{subtree:true,childList:true});
  installWorkspaceMotion();
  const menu=button('',()=>setMobileNav(!document.body.classList.contains('mobile-nav-open')),'mobile-navigation-button');
  menu.id='mobileNavigation';menu.append(icon('menu'));menu.setAttribute('aria-label','打开导航');menu.setAttribute('aria-expanded','false');
  nav.id='primaryNavigation';menu.setAttribute('aria-controls',nav.id);header.prepend(menu);
  const scrim=button('',()=>setMobileNav(false),'nav-scrim');scrim.setAttribute('aria-label','关闭导航');scrim.tabIndex=-1;document.body.append(scrim);
  let previousFocus;
  function setMobileNav(open){
    document.body.classList.toggle('mobile-nav-open',open);menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'关闭导航':'打开导航');
    if(open){previousFocus=document.activeElement;main.inert=true;aside.querySelector('[aria-current=page]')?.focus();}
    else{main.inert=false;if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;}
  }
  const mobileQuery=matchMedia('(max-width:760px)');mobileQuery.addEventListener('change',()=>setMobileNav(false));
  aside.addEventListener('keydown',e=>{
    if(!document.body.classList.contains('mobile-nav-open'))return;
    if(e.key==='Escape'){e.preventDefault();setMobileNav(false);}
    if(e.key==='Tab'){const items=[...aside.querySelectorAll('button,summary,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  });
  nav.addEventListener('click',e=>{if(e.target.closest('[data-page]')&&mobileQuery.matches)setMobileNav(false);});
  window.addEventListener('pagehide',()=>{copyObserver.disconnect();cancelAnimationFrame(copyFrame);},{once:true});
  const heading=$('overview').querySelector('.heading'),intro=node('div');
  while(heading.firstChild)intro.append(heading.firstChild);heading.classList.add('overview-heading');heading.append(intro);
  

  const shortcuts=node('div','overview-shortcuts');
  for(const [label,page,mark]of [['管理聊天','chats','chats'],['编辑人格','personas','personas'],['连接模型','engines','models']]){const action=button(label,()=>open(page),'secondary');action.prepend(icon(mark));shortcuts.append(action);}intro.append(shortcuts);
  heading.after($('overview').querySelector('.stats'));
  const overview=node('div','workspace-overview'),channels=node('article','workspace-panel'),engine=node('article','workspace-panel');channels.append(node('h2','','消息入口'));
  const channelFields={};
  for(const [key,title,page]of [['wechat','微信','wechatConnection'],['qq','QQ','integrations']]){const row=node('div','workspace-channel'),mark=node('div','channel-mark'),info=node('div'),name=node('h3','',title),status=node('span','channel-status','检测中'),hint=node('p','footnote');mark.dataset.channel=key;mark.append(icon('chats'));name.append(status);info.append(name,hint);row.append(mark,info,button('配置接入',()=>open(page),'secondary'));channels.append(row);channelFields[key]={status,hint};}
  channels.append(node('p','footnote','联系人分别授权，记忆与人格数据按平台保存。'));
  const engineSummaries=node('div','workspace-engines');engine.append(node('h2','','模型引擎'),engineSummaries,button('管理引擎与额度 →',()=>open('engines'),'quiet'));overview.append(channels,engine);$('overview').querySelector('.stats').after(overview);
  const recent=node('section','workspace-recent'),recentHead=node('div','section-title'),recentRows=node('div');recentHead.append(node('h2','','最近回复'),updated,button('运行与用量 →',()=>open('usage'),'quiet'));recent.append(recentHead,recentRows);overview.after(recent);
  const advanced=node('details','overview-advanced');advanced.append(node('summary','','当前数据平台运行与连接参数'));for(const e of [$('overview').querySelector('.connection-row'),$('overview').querySelector('.lower-grid')])if(e)advanced.append(e);$('overview').append(advanced);
  const parameters=$('wsUrl')?.closest('article');if(parameters)parameters.hidden=(sessionStorage.getItem('xyPlatform')==='wechat');
  // Settings retain the same form and values; only sections are reorganized.
  const form=$('settingsForm'),sections=[...form.querySelectorAll(':scope>.form-section')],tabs=node('nav','settings-categories');tabs.setAttribute('aria-label','设置分类');const settingsBody=node('div','settings-content'),settingsLayout=node('div','settings-layout');
  const appearance=node('section','form-section');appearance.append(node('h2','','背景与玻璃'),node('p','','上传自己的背景图，调整磨砂、遮罩和面板透明度。外观保存在本机。'),button('调整外观',()=>$('openAppearance')?.click(),'secondary'));
  const data=node('section','form-section');data.append(node('h2','','数据与备份'),node('p','','QQ 和微信分别保存聊天、记忆与人格学习。备份只包含当前查看的平台。'),button('备份与维护 →',()=>open('maintenance'),'secondary'));
  const settingPages=[['聊天默认值',sections[1]],['连接与运行',sections[0]],['外观',appearance],['数据与备份',data]].filter(([,p])=>p);
  const settingButtons=[];for(const [i,[name,p]]of settingPages.entries()){settingsBody.append(p);p.hidden=i!==0;const b=button(name,()=>{for(const [,s]of settingPages)s.hidden=s!==p;settingButtons.forEach(t=>t.classList.toggle('active',t===b));animateSubview(p);},'quiet');b.classList.toggle('active',i===0);settingButtons.push(b);tabs.append(b);}settingsLayout.append(tabs,settingsBody);form.prepend(settingsLayout);
  wrapActions(document.body);
  let recentKey='';
  function paint(state){const c=state.connections;if(!c)return;const w=c.wechat,q=c.qq;const pluginsConnected=!!q.integrations?.plugins?.gateway?.connected;$('headerPlugins').textContent=pluginsConnected?'插件 已连接':'插件 未连接';$('headerPlugins').dataset.online=String(pluginsConnected);
    aside.querySelector('.tiny-dot').dataset.online=String(!!q.connected||!!w.connected);
    for(const [key,data]of [['qq',q],['wechat',w]]){const online=data.connected;channelFields[key].status.textContent=online?'已连接':data.running?'等待连接':'未启动';channelFields[key].status.dataset.online=String(online);channelFields[key].hint.textContent=key==='qq'?(q.integrations?.protocol.name??'QQ协议端')+' · 只回复已授权聊天':(w.mode==='foreground'?'前台发送':'原生发送')+' · 独立记忆';}
    for(const [id,data,label]of [['headerQq',q,'QQ'],['headerWechat',w,'微信']])if($(id)){$(id).textContent=label+' '+(data.connected?'在线':data.running?'待连接':'未启动');$(id).dataset.online=String(data.connected);}
    $('headerQq').onclick=()=>open('integrations');$('headerWechat').onclick=()=>open('wechatConnection');
    const e=c.engines,d=getSettings()?.config.defaults?.engine??e?.defaultEngine??'codex';
    for(const [id,label,online]of [['headerCodex','Codex',!!c.codex?.connected],['headerDsh','DSH',!!e?.dsh?.connected]]){const chip=$(id);chip.textContent=label+' '+(online?'已连接':'未连接');chip.dataset.online=String(online);chip.onclick=()=>open('engines');chip.title=`${label}连接、模型与额度${d===label.toLowerCase()?' · 当前平台默认引擎':''}${label==='DSH'&&e?.dsh?.error?' · '+e.dsh.error:''}`;}
    engineSummaries.replaceChildren();for(const id of ['codex','dsh']){const online=id==='dsh'?e?.dsh?.connected:c.codex?.connected,summary=node('div','workspace-engine-summary'),badge=node('span','engine-state',online?'已连接':'未连接');badge.dataset.online=String(!!online);summary.append(node('h3','',id==='dsh'?'DSH':'Codex'),badge);const snapshot=e?.quota?.snapshots?.find(q=>q.engine===id);if(snapshot?.status==='ready'&&snapshot.windows?.some(w=>Number.isFinite(w.usedPercent))){const remaining=Math.min(...snapshot.windows.filter(w=>Number.isFinite(w.usedPercent)).map(w=>Math.max(0,100-w.usedPercent)));summary.append(node('p','',remaining+'% 最低剩余额度'));}else if(snapshot?.status==='ready'&&snapshot.wallets?.length){for(const wallet of snapshot.wallets)summary.append(node('p','',(wallet.kind==='bonus'?'赠送 ':'充值 ')+wallet.balance+' '+wallet.currency));}else summary.append(node('p','footnote',snapshot?.status==='stale'?'额度已过期':snapshot?.status==='unsupported'?'当前路由不支持额度查询':'额度尚未读取'));summary.append(node('p','footnote',id===d?'当前平台默认':'可按聊天选择'));engineSummaries.append(summary);}updated.textContent='刷新于 '+new Date(c.at).toLocaleTimeString('zh-CN',{hour12:false});
    const key=JSON.stringify(c.recent);if(key!==recentKey){recentKey=key;recentRows.replaceChildren();for(const item of c.recent){const row=node('div','workspace-activity'),status=({delivered:'已送达',unknown:'未确认',cancelled:'已取消',failed:'失败'})[item.status]??item.status??'已记录',total=item.timing.totalMs,label=item.platform==='wechat'?'微信':'QQ';row.append(node('time','',new Date(item.created.replace(' ','T')+'Z').toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'})),node('span','platform-label',label),node('div','activity-caption',`${status} · ${item.model??item.engine??'模型'}`),node('span','footnote',Number.isFinite(total)?(total/1000).toFixed(1)+' 秒':''));const detail=node('small','activity-timing');const parts=[['生成',item.timing.generationMs],['投递',item.timing.deliveryMs],['排队',item.timing.queueMs]].filter(([,v])=>Number.isFinite(v));detail.textContent=parts.map(([k,v])=>k+' '+(v/1000).toFixed(1)+' 秒').join(' · ');row.querySelector('.activity-caption').append(detail);recentRows.append(row);}if(!c.recent.length)recentRows.append(node('p','empty','还没有回复记录。连接后，只处理已授权的新消息。'));}
  }
  return {paint};
}
