export function createSharedMemoryUI({node,button,edit,api,notice,viewText,getScope,getConversation,getCatalog,reload}){
  let memberId='';
  function owner(m){const parts=m.scope.split(':');return {platform:parts[0],account:parts[1],owner:parts[2]==='private'?parts[3]:parts[5]};}
  function publishDialog(m,existing=null){
    const who=owner(m),catalog=getCatalog(),privateScope=`${who.platform}:${who.account}:private:${who.owner}`;
    const eligible=catalog.contacts.items.filter(c=>c.scope.startsWith(who.platform+':'+who.account+':')&&c.policy.enabled&&c.policy.crossMemoryRead&&(c.kind==='group'||c.scope===privateScope));
    const groups=eligible.filter(c=>c.kind==='group'),privateAllowed=eligible.some(c=>c.scope===privateScope);
    const fields=[...(privateAllowed?[{name:'includePrivate',label:'本人私聊可用',type:'checkbox',value:existing?existing.targets.includes(privateScope):true}]:[]),...groups.map((c,i)=>({name:'target'+i,label:'允许群：'+c.name+'（'+c.peer+'）',type:'checkbox',value:existing?.targets.includes(c.scope)??false})),{name:'allPersonas',label:'所有人格可用（默认仅来源人格）',type:'checkbox',value:existing?.personaId==='*'}];
    if(!eligible.length){notice('请先在目标聊天设置开启“导入本人共享记忆”，再发布。',true);return;}
    edit('发布共享事实 · '+m.key,fields,async data=>{await api('shared/publish',{memoryId:m.id,targets:groups.filter((_,i)=>data['target'+i]).map(c=>c.scope),includePrivate:privateAllowed&&!!data.includePrivate,allPersonas:!!data.allPersonas});await reload();notice('共享范围已保存。未选中的聊天不能读取。');},'内容：'+m.value+'。来源聊天需开启发布权限；只发布这条事实，不共享原始对话或摘要。');
  }
  async function render(target){
    const scope=getScope(),group=scope.includes(':group:'),controls=node('div','toolbar');
    const input=node('input');input.placeholder='共享档案所属成员ID';input.setAttribute('aria-label','共享档案成员ID');input.value=memberId;if(group)controls.append(input);
    const list=node('div'),hint=node('p','footnote','同一平台的真实成员ID才认作同一人。来源、目标读取和人格范围共同生效。跨聊只传已发布事实，不传原文。');
    controls.append(button('读取个人共享档案',async()=>{memberId=input.value.trim();await draw();}));target.append(controls,hint,list);
    async function draw(){list.replaceChildren();if(group&&!(scope.startsWith('wechat:')?/^[-\w@.]{1,160}$/:/^\d+$/).test(memberId)){list.append(node('p','empty','输入成员ID后查看其共享档案。'));return;}
      const facts=await api('shared/list',{scope,memberId});for(const f of facts){const row=node('div','memory-row'),body=node('div');const targetNames=f.targets.map(s=>getCatalog().contacts.items.find(c=>c.scope===s)?.name??s).join('、');
        body.append(node('h3','',`共享#${f.id} · ${f.key??'来源已忘记'}`),node('p','',f.value??'共享引用已失效，不再返回事实内容。'),node('small','',`${f.active&&f.key?'已发布':'已停止/来源失效'} · 成员 ${f.owner} · ${f.personaId==='*'?'所有人格':f.personaId}`),node('small','',`来源：${f.originScope} · 可见：${targetNames||'无'}${f.hiddenTargets.length?' · 有本聊隐藏范围':''}`));
        const actions=node('div','actions');if(f.key)actions.append(button('修改发布范围',async()=>publishDialog({id:f.memoryId,scope:f.memoryScope,key:f.key,value:f.value},f),'quiet'),button('更正共享事实',async()=>{edit('更正共享事实（所有允许目标生效）',[{name:'key',label:'事实键',value:f.key,required:true,max:60},{name:'value',label:'事实内容',type:'textarea',value:f.value,required:true,max:240},{name:'pinned',label:'固定保留',type:'checkbox',value:!!f.pinned}],async data=>{await api('memory/save',{...data,id:f.memoryId,type:f.type});await reload();},'更正保留旧版本，并取消受影响的待发送回复。');},'quiet'));
        actions.append(button('版本与授权记录',async()=>{const d=await api('shared/details?id='+f.id);viewText('共享事实记录',`来源：${d.originScope}\n\n`+d.versions.map(v=>`${v.created} · ${v.status}\n${v.key}：${v.value}`).join('\n\n')+'\n\n授权变更：\n'+d.audit.map(a=>`${a.created} · ${a.action} · ${a.actor}\n${JSON.stringify(a.detail)}`).join('\n'));},'quiet'));
        if(f.active)actions.append(button('停止共享',async()=>{await api('shared/action',{id:f.id,action:'stop'});await reload();notice('已停止跨聊使用，来源记忆保留。');},'quiet'));
        if(f.targets.includes(scope))actions.append(button(f.hiddenTargets.includes(scope)?'恢复本聊使用':'仅本聊隐藏',async()=>{await api('shared/action',{id:f.id,scope,action:f.hiddenTargets.includes(scope)?'unhide':'hide'});await reload();},'quiet'));
        if(f.key)actions.append(button('全局忘记',async()=>{edit('全局忘记共享事实',[{name:'confirmText',label:'输入“忘记”确认',required:true}],async data=>{if(data.confirmText!=='忘记')throw new Error('请输入“忘记”');await api('shared/action',{id:f.id,action:'forget'});await reload();},'将删除这条来源记忆和版本，使所有共享引用失效。已发送的QQ回复无法撤回；若只想停止跨聊，请使用“停止共享”。');},'quiet danger'));
        row.append(body,actions);list.append(row);}
      if(!facts.length)list.append(node('p','empty','尚无个人共享事实；先从“当前聊天”中选择记忆发布，或由本人发送 /跨聊记住 键=值。'));
      const preview=node('div','form-section'),select=node('select'),query=node('input'),output=node('pre','source-quote','目标预览不调用模型、不发送QQ。');select.setAttribute('aria-label','共享目标预览聊天');
      const who=scope.split(':');const peer=group?memberId:who[3];for(const c of getCatalog().contacts.items.filter(c=>c.account===who[1]&&(c.kind==='group'||c.peer===peer))){const o=node('option','',c.name+' · '+c.peer);o.value=c.scope;select.append(o);}query.placeholder='例如：我喜欢喝什么？';query.setAttribute('aria-label','共享目标预览问题');preview.append(node('h3','','目标聊天召回预览'),select,query,button('预览目标召回',async()=>{const r=await api('memory/preview',{scope:select.value,memberId:peer,query:query.value});output.textContent=`${r.chars}/${r.budget}字符 · 共享${r.sharedChars??0}/400字符 · ${r.durationMs}ms\n\n${r.memory}\n${r.summary}`;}),output);list.append(preview);
    }
    await draw();
  }
  return {publishDialog,render};
}
