export function addScheduledFields(form,policy){
  const grid=form.querySelector('.form-grid'),p=policy.scheduledTasks??{};
  const toggle=document.createElement('label');toggle.className='check-setting';const check=document.createElement('input');check.type='checkbox';check.name='scheduledEnabled';check.checked=p.enabled??false;toggle.append(check,'允许本聊天定时任务');
  const label=document.createElement('label');label.append('允许创建者账号（留空仅本人绑定账号）');const ids=document.createElement('input');ids.name='scheduledCreators';ids.value=(p.creators??[]).join('，');label.append(ids);grid.append(toggle,label);
}
export function scheduledPolicy(form){return {enabled:form.elements.namedItem('scheduledEnabled').checked,creators:form.elements.namedItem('scheduledCreators').value.split(/[\s,，]+/u).filter(Boolean)};}
export function scheduledPanel({state,api,node,button,edit,notice,viewText,getCatalog,reload}){
  const section=node('article','cognition-panel companion-card');section.append(node('h2','','聊天定时任务'),node('p','','独立于随机主动陪伴。仅当前平台和已开启的聊天执行；固定提醒到期不调用模型。'));
  const labels={pending:'待执行','awaiting-confirmation':'周期规则待确认',running:'正在执行',completed:'已完成',cancelled:'已取消',failed:'失败',expired:'已过期',unknown:'投递未知，禁止重发',interrupted:'执行中断'};
  const stamp=at=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),contacts=getCatalog().contacts.items;
  const act=async work=>{try{await work();await reload();}catch(e){notice(e.message,true);}};
  section.append(node('p','',`当前平台总开关：${state.settings.enabled?'开启':'关闭'} · 每聊天待执行上限 ${state.settings.maxPending} · 每日尝试上限 ${state.settings.dailyLimit} · 过期宽限 ${state.settings.graceSeconds}秒`));
  const bar=node('div','actions');bar.append(button('定时任务总设置',()=>edit('当前平台定时任务总设置',[
    {name:'enabled',label:'允许已单独开启的聊天执行定时任务',type:'checkbox',value:state.settings.enabled},
    {name:'maxPending',label:'每聊天待执行任务上限',type:'number',min:1,max:30,value:state.settings.maxPending},
    {name:'dailyLimit',label:'每聊天每日尝试上限',type:'number',min:1,max:100,value:state.settings.dailyLimit},
    {name:'graceSeconds',label:'离线/延迟宽限（秒）',type:'number',min:0,max:3600,value:state.settings.graceSeconds}
  ],async v=>{await api('scheduled-tasks/settings',{enabled:v.enabled,maxPending:Number(v.maxPending),dailyLimit:Number(v.dailyLimit),graceSeconds:Number(v.graceSeconds)});await reload();},'不会自动打开任何聊天的任务开关。关闭后暂停待执行任务；重新开启不补发超过宽限的旧任务。')),
  button('创建任务',()=>{const enabled=contacts.filter(c=>c.policy.enabled&&c.policy.scheduledTasks?.enabled);if(!enabled.length){notice('请先在聊天设置中开启定时任务，并开启当前平台总开关。',true);return;}const requestId=crypto.randomUUID();edit('创建当前平台定时任务',[
    {name:'scope',label:'接收聊天',type:'select',options:enabled.map(c=>[c.scope,c.name+' · '+c.peer]),value:enabled[0].scope},
    {name:'creator',label:'创建者账号（必须在该聊天的允许名单中）',value:state.owner},
    {name:'request',label:'任务要求（北京时间）',type:'textarea',value:'5分钟后提醒我喝水'},
    {name:'confirm',label:'确认此任务会在指定聊天到时发送；语音可能消耗Breeze额度',type:'checkbox',value:false},
    {name:'confirmRepeat',label:'若是周期任务，确认按所写周期持续执行',type:'checkbox',value:false}
  ],async v=>{if(!v.confirm)throw Error('请先确认任务目标及发送要求');const job=await api('scheduled-tasks/create',{...v,requestId});notice('任务 '+job.id+' · '+stamp(job.due)+' · '+labels[job.status]);await reload();},'本机不跨平台或跨群自动扩大发送范围。模糊内容会要求补全，不建立任务。');}),button('暂停当前平台定时任务',()=>act(()=>api('scheduled-tasks/settings',{enabled:false})),'quiet'));section.append(bar);
  const chatBox=node('div','companion-grid');for(const contact of contacts.filter(c=>c.policy.enabled)){
    const p=contact.policy.scheduledTasks??{},paused=state.pausedScopes.includes(contact.scope),card=node('div','companion-card');card.append(node('strong','',contact.name),node('p','',`${p.enabled?'聊天开关已开':'聊天开关关闭'}${paused?' · 已暂停':''} · 创建者：${p.creators?.length?p.creators.join('、'):state.owner||'尚未绑定本人账号'}`),button('配置此聊天',()=>edit('定时任务 · '+contact.name,[{name:'enabled',label:'允许本聊天定时任务',type:'checkbox',value:p.enabled??false},{name:'creators',label:'允许创建者账号，逗号分隔（留空仅绑定本人）',value:(p.creators??[]).join('，')}],async v=>{await api('scheduled-tasks/chat',{scope:contact.scope,policy:{enabled:v.enabled,creators:v.creators.split(/[\s,，]+/u).filter(Boolean)}});await reload();},'只授权创建定时任务，不授予其他管理权限。群内需明确@角色或用昵称开头。')),
      button(paused?'恢复此聊天任务':'暂停此聊天任务',()=>act(()=>api('scheduled-tasks/pause',{scope:contact.scope,paused:!paused})),'quiet'));chatBox.append(card);
  }section.append(chatBox);
  const list=node('div','companion-grid');for(const job of state.tasks){const card=node('article','companion-card'),name=contacts.find(c=>c.scope===job.scope)?.name??job.scope;card.append(node('strong','',`${name} · ${job.id}`),node('p','',`${labels[job.status]??job.status} · ${stamp(job.due)}（北京时间） · ${job.repeat==='once'?'一次':job.repeat==='daily'?'每天':'每周'}`),node('p','',job.content),node('p','footnote',`创建者 ${job.creator} · 来源消息 #${job.sourceId??'本机'}${job.voice?' · 请求语音':''}${job.mentionSelf?' · 真实@创建者':''}${job.detail?' · '+job.detail:''}`));
    if(['pending','awaiting-confirmation','running'].includes(job.status))card.append(button('取消任务',()=>act(()=>api('scheduled-tasks/cancel',{id:job.id})),'quiet'));
    if(job.status==='awaiting-confirmation')card.append(button('确认任务',()=>edit('确认定时任务',[{name:'confirm',label:'确认任务正文、执行时间和接收聊天；周期任务会持续执行',type:'checkbox',value:false}],async v=>{if(!v.confirm)throw Error('请确认周期规则');await api('scheduled-tasks/confirm',{id:job.id});await reload();},`${name} · ${job.repeat} · ${stamp(job.due)} · ${job.content}`)));
    if(job.intervalMs&&['unknown','failed','expired','interrupted'].includes(job.status))card.append(button('从下一周期恢复',()=>act(()=>api('scheduled-tasks/resume',{id:job.id})),'quiet'));
    const run=state.runs.find(r=>r.taskId===job.id);if(run)card.append(button('查看执行回执',()=>{viewText('执行记录 · '+job.id,`${labels[run.status]??run.status} · ${stamp(run.started)}\n${run.detail}\n${run.receipt??'没有确认回执，不代表已经送达。'}`);},'quiet'));list.append(card);
  }if(!state.tasks.length)list.append(node('p','empty','暂无定时任务。开关默认关闭，不会自动建立任务。'));section.append(list,node('p','footnote','聊天命令：/任务、/取消任务 编号、/确认任务 编号、/暂停定时任务、/继续定时任务。电脑和平台须在线；超过宽限不补发，投递未知不重试。'));return section;
}
