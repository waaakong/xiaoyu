const platformName=value=>({qq:'QQ',wechat:'微信',local:'本机自检'})[value]??value;
const statusNames={ready:'已读取',stale:'已过期',unsupported:'不支持查询','signed-out':'未登录',unavailable:'暂不可用'};
const stamp=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未读取';
const count=value=>Number.isFinite(value)?value.toLocaleString('zh-CN'):'未记录';
const duration=value=>Number.isFinite(value)?(value/1000).toFixed(1)+' 秒':'未记录';
const amount=wallet=>wallet.balanceDisplay??'未知';
export async function renderEngineDashboard({container:s,api,node,button,edit,getSettings,reload,refresh,notice,active}){
  const e=await api('engines'),current=getSettings().config.defaults?.engine??'codex';
  const heading=node('div','engine-heading'),title=s.querySelector('h1'),refreshBar=s.querySelector('.actions');if(title)heading.append(title);if(refreshBar)heading.append(refreshBar);s.prepend(heading);
  s.append(node('p','engine-intro','两个本机引擎，一处查看连接、模型、额度和实际用量。QQ 与微信分别授权、分别记忆。'));
  const instruments=node('div','instrument-grid');
  for(const [label,value,unit] of [
    ['已连接引擎',Number(!!e.codex?.connected)+Number(!!e.dsh?.connected),'/ 2'],
    ['可用模型目录',(e.codex?.models?.length??0)+(e.dsh?.models?.length??0),'个'],
    ['调用样本',e.dashboard.sampled,'条'],
    ['额度提醒',e.quota.alerts.length,'条']
  ]){
    const metric=node('article','instrument');metric.append(node('span','',label),node('strong','',String(value)),node('small','',unit));instruments.append(metric);
  }
  s.append(instruments);
  const context=node('div','engine-context');context.append(node('span','',`当前数据平台：${active==='wechat'?'微信':'QQ'} · 默认引擎：${current==='dsh'?'DSH':'Codex'}`),button('切换默认引擎',()=>edit('当前平台默认引擎',[{name:'engine',label:'引擎',type:'select',options:[['codex','本机 Codex'],['dsh','本机 DSH']],value:current}],async v=>{await api('defaults',{...v,model:null});await reload();await refresh();},'仅影响当前平台后续新消息。各聊天的明确覆盖保留；失败不会自动调用另一家。'),'secondary'));s.append(context);
  const cards=node('div','engine-cards');
  for(const id of ['codex','dsh']){
    const info=e[id],online=!!info?.connected,card=node('article','engine-card'),head=node('div','engine-card-head'),title=node('div');title.append(node('small','',id==='dsh'?'DEEPSEEK HARNESS':'LOCAL CODEX'),node('h2','',id==='dsh'?'DSH':'Codex'));
    const badge=node('span','engine-state',online?'已连接':'未连接');badge.dataset.online=String(online);head.append(title,badge);card.append(head);
    const selected=id==='dsh'?e.dsh.models.find(m=>m.id===e.dsh.model):null;
    card.append(node('p','engine-model',id==='dsh'?(selected?.name??(e.dsh.model?'已保存模型，等待目录核验':'尚未选择默认模型')):'复用本机登录 · 按聊天选择模型'));
    const snapshot=e.quota.snapshots.find(q=>q.engine===id);const quota=node('div','engine-quota');
    if(snapshot?.status==='ready'||snapshot?.status==='stale'){
      for(const w of snapshot.windows??[]){const row=node('div','engine-window'),remaining=Number.isFinite(w.usedPercent)?Math.max(0,100-w.usedPercent):null;row.append(node('strong','',remaining===null?'未知':remaining+'%'),node('span','',w.name+' · 剩余'));if(remaining!==null){const meter=node('progress');meter.max=100;meter.value=remaining;meter.setAttribute('aria-label',w.name+'剩余额度');row.append(meter);}row.append(node('small','',`窗口 ${w.windowDurationMins??'未知'} 分钟 · 重置 ${w.resetsAt?stamp(w.resetsAt*1000):'未知'}`));quota.append(row);}
      for(const w of snapshot.wallets??[]){const wallet=node('div','engine-wallet');wallet.append(node('span','',w.kind==='bonus'?'赠送余额':'充值余额'),node('strong','',amount(w)),node('span','',w.currency));quota.append(wallet);}
    }
    if(!quota.childNodes.length)quota.append(node('p','empty','尚无可用额度数据'));
    const windows=snapshot?.windows?.filter(w=>Number.isFinite(w.usedPercent))??[];
    const percent=windows.length?Math.max(0,Math.min(100,100-Math.max(...windows.map(w=>w.usedPercent)))):null;
    const gauge=node('div','quota-gauge');
    const dial=node('div','quota-dial',percent===null?'—':Math.round(percent)+'%');
    dial.style.setProperty('--remaining',(percent??0)+'%');
    gauge.append(dial,node('span','',percent===null?'暂无窗口额度读数':snapshot.status==='stale'?'上次记录的最低剩余额度':'窗口最低剩余额度'));
    card.insertBefore(gauge,card.querySelector('.engine-model'));
    card.append(quota,node('p','footnote',`${online?'':'离线保留的历史快照 · '}${statusNames[snapshot?.status]??'尚未读取'} · 上次成功 ${stamp(snapshot?.lastSuccessAt)}`));
    if(snapshot?.error||snapshot?.reason)card.append(node('p','engine-warning',snapshot.error??snapshot.reason));
    if(id==='dsh'){
      const health=e.dsh.health,cap=node('dl','engine-capabilities');for(const [key,value]of [['模型目录',`${e.dsh.models.length} 个模型${e.dsh.providerErrors?.length?' · 部分提供方读取失败':''}`],['图片理解',selected?(selected.inputModalities?.includes('image')?'所选模型支持':'所选模型未声明支持'):'先选择模型'],['原生联网',!online?'等待连接':health?.nativeWeb?'宿主服务已提供，执行结果另行记录':'宿主未提供'],['按需记忆',health?.memoryBroker?'已连接受限召回':'等待能力核验']]){cap.append(node('dt','',key),node('dd','',value));}card.append(cap);
      if(e.dsh.error)card.append(node('p','engine-warning',e.dsh.error));if(e.dsh.providerErrors?.length)card.append(node('p','engine-warning','未读取的提供方：'+e.dsh.providerErrors.join('、')));
      const runtime=node('div','engine-runtime');runtime.append(node('span','',`桥接 ${health?.bridgeVersion??'版本未报告'}`),node('span','',`进行中 ${Number.isSafeInteger(health?.activeJobs)?health.activeJobs:'未报告'}`),node('span','',`连接核验 ${stamp(e.dsh.lastSuccessAt)}`));card.append(runtime);
      if(health?.lastFailure){const failure=health.lastFailure;card.append(node('p','engine-warning',`最近未完成 ${stamp(failure.at)} · ${/^[A-Z0-9_]{2,80}$/.test(failure.code??'')?failure.code:'未报告错误码'}。具体结果请结合下方调用状态核对。`));}
      if(health?.lastFormatWarning)card.append(node('p','engine-warning',`附加数据未采用 ${stamp(health.lastFormatWarning.at)} · 回复正文已保留，本轮未写入无法校验的附加记忆。`));
      const actions=node('div','engine-actions');actions.append(button('检测连接与模型',async()=>{await api('engines/connect',{});await reload();await refresh();}),button('配置DSH',configureDsh,'quiet'));card.append(actions);
    }else card.append(node('p','footnote',`${info?.models?.length??0} 个模型 · 使用原生额度接口，查询不调用模型`));
    card.dataset.engine=id;cards.append(card);
  }
  s.append(cards);
  const toolbar=node('div','engine-section-head');toolbar.append(node('h2','','账号额度与预警'),button('刷新真实额度',async()=>{await api('engines/quota',{});await refresh();},'secondary'),button('设置预警阈值',configureThresholds,'quiet'));s.append(toolbar,node('p','footnote','钱包是账号共享余额，不按QQ/微信拆成两份。第三方模型不适用DSH官方钱包；不估算费用、剩余token或可用次数。'));
  const alerts=node('div','engine-alerts');for(const a of e.quota.alerts.slice(0,5)){const line=node('div','engine-alert');line.dataset.level=a.level;line.append(node('time','',stamp(a.at)),node('span','',a.message));alerts.append(line);}if(!alerts.childNodes.length)alerts.append(node('p','empty','当前没有额度提醒'));s.append(alerts);
  const usage=node('section','engine-usage'),usageHead=node('div','engine-section-head'),filter=node('select');filter.setAttribute('aria-label','仪表盘用量平台');for(const [value,label]of [['all','全部平台'],['qq','QQ'],['wechat','微信'],['local','本机自检']]){const o=node('option','',label);o.value=value;filter.append(o);}usageHead.append(node('h2','','实际调用用量'),filter);usage.append(usageHead,node('p','footnote',`每个平台最近 ${e.dashboard.limitPerPlatform} 条记录，当前共 ${e.dashboard.sampled} 条。只汇总用量元数据，缺少引擎的旧记录单列为“未知”。`));const stats=node('div','engine-usage-grid'),tableWrap=node('div','engine-table-wrap');tableWrap.tabIndex=0;tableWrap.setAttribute('role','region');tableWrap.setAttribute('aria-label','最近引擎调用，可左右滚动');usage.append(stats,tableWrap);s.append(usage);
  const paintUsage=()=>{stats.replaceChildren();tableWrap.replaceChildren();for(const group of e.dashboard.groups.filter(g=>filter.value==='all'||g.platform===filter.value)){const card=node('article','engine-usage-card');card.append(node('h3','',`${platformName(group.platform)} / ${group.engine==='unknown'?'未知引擎':group.engine.toUpperCase()}`),node('strong','',count(group.calls)+' 次'),node('p','',`输入 ${count(group.inputTokens)} · 缓存 ${count(group.cachedInputTokens)} · 输出 ${count(group.outputTokens)}`),node('p','footnote',`用量已记录 ${group.knownUsage} / ${group.calls} · 失败 ${group.failed} · 取消 ${group.cancelled}`),node('p','footnote',`p50 ${duration(group.p50Ms)} · p95 ${duration(group.p95Ms)} · ${group.latencySamples} 条耗时`));stats.append(card);}if(!stats.childNodes.length)stats.append(node('p','empty','该范围还没有调用记录'));
    const table=node('table','engine-table'),head=node('tr');for(const label of ['时间 / 平台','引擎 / 模型','输入 / 输出','状态 / 耗时'])head.append(node('th','',label));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');for(const row of e.dashboard.recent.filter(r=>filter.value==='all'||r.platform===filter.value)){const tr=node('tr');for(const label of [row.created+' / '+(platformName(row.platform)),row.engine+' / '+(row.model??'未记录'),count(row.inputTokens)+' / '+count(row.outputTokens)])tr.append(node('td','',label));const status=node('td','',row.status+' / '+duration(row.totalMs));if(row.errorCode)status.append(node('small','engine-stage',row.errorCode));const phases=[['generationMs','模型'],['deliveryMs','投递']].filter(([key])=>Number.isFinite(row.timing?.[key]));if(phases.length)status.append(node('small','engine-stage',phases.map(([key,label])=>label+' '+duration(row.timing[key])).join(' · ')));tr.append(status);body.append(tr);}table.append(body);tableWrap.append(table);};filter.onchange=paintUsage;paintUsage();
  const setup=node('details','engine-setup');setup.append(node('summary','','DSH接入设置与自检'));setup.append(node('p','footnote','首次：保存程序位置 → 完整退出DSH → 官方CLI导入 → 重开DSH → 检测连接。已连接时无需重复导入。小鱼不替你退出、登录或接受协议。'));
  const actions=node('div','engine-actions');actions.append(button('配置DSH',configureDsh),button('通过官方CLI导入小鱼插件',async()=>{const r=await api('engines/import',{});notice(r.imported?'插件已导入，请重新打开DSH并检测':'尚未完成');}),button('打开DSH',()=>api('engines/open',{})));const link=node('a','quiet','DSH官方下载');link.href='https://www.deepseek.com/harness/';link.target='_blank';link.rel='noreferrer';actions.append(link);setup.append(actions,node('p','footnote','公开文字自检会消耗所选DSH模型额度，不发送QQ/微信消息，不读取聊天或记忆。'));
  const testActions=node('div','engine-actions'),result=node('p','engine-diagnostic');const testButton=button('运行DSH文字自检',async()=>{testButton.disabled=true;cancelButton.disabled=false;result.textContent='正在等待DSH…';try{const r=await api('engines/test',{engine:'dsh'});result.textContent=`${r.reply} · ${duration(r.durationMs)}`;}catch(error){result.textContent='自检未完成：'+error.message;throw error;}finally{testButton.disabled=!e.dsh.connected;cancelButton.disabled=true;}});testButton.disabled=!e.dsh.connected||e.diagnostic?.status==='running';const cancelButton=button('取消自检',async()=>{await api('engines/test-cancel',{});result.textContent='已请求取消';},'quiet');cancelButton.disabled=e.diagnostic?.status!=='running';testActions.append(testButton,cancelButton);setup.append(testActions,result);if(e.diagnostic)result.textContent=e.diagnostic.status==='running'?'自检运行中，可取消':`${e.diagnostic.status} · ${duration(e.diagnostic.durationMs)}${e.diagnostic.error?' · '+e.diagnostic.error:''}`;s.append(setup);
  function configureDsh(){return edit('DSH本机连接',[{name:'executable',label:'DSH程序位置',value:e.dsh.executable||e.detectedDsh},{name:'url',label:'小鱼插件地址',value:e.dsh.url},{name:'model',label:'默认DSH模型',type:'select',options:[['','未选择'],...e.dsh.models.map(m=>[m.id,m.name])],value:e.dsh.model??''}],async v=>{await api('engines/save',{...v,model:v.model||null});await api('engines/connect',{});await reload();await refresh();});}
  function configureThresholds(){const t=e.quota.settings;return edit('本机额度提醒',[{name:'enabled',label:'启用提醒',type:'checkbox',value:t.enabled},{name:'warningPercent',label:'Codex剩余百分比提醒',value:t.warningPercent},{name:'criticalPercent',label:'Codex剩余百分比严重提醒',value:t.criticalPercent},...['CNY','USD'].flatMap(c=>[{name:c+'Warning',label:c+'余额提醒阈值',value:t.wallets[c].warning},{name:c+'Critical',label:c+'余额严重阈值',value:t.wallets[c].critical}])],async v=>{await api('engines/quota-settings',{enabled:v.enabled,warningPercent:Number(v.warningPercent),criticalPercent:Number(v.criticalPercent),wallets:Object.fromEntries(['CNY','USD'].map(c=>[c,{warning:v[c+'Warning'],critical:v[c+'Critical']}]))});await refresh();});}
}
