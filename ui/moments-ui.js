export function installMoments({api,node,button,edit,notice,viewText,showPage,getCatalog}){
  const entry=button('微信朋友圈',()=>showPage('moments',load));entry.dataset.page='moments';entry.dataset.title='微信朋友圈';document.querySelector('nav').append(entry);const page=node('section','page companion-page');page.id='moments';page.hidden=true;document.querySelector('main').append(page);
  const card=(title,copy)=>{const e=node('article','cognition-panel companion-card');e.append(node('h2','',title));if(copy)e.append(node('p','',copy));return e;},actions=()=>node('div','actions');let sequence=0;
  async function load({isCurrent=()=>true}={}){
    const seq=++sequence;
    try{
      const connection=await api('wechat');
      if(seq!==sequence||!isCurrent())return false;
      if(!connection.config.account){
        page.replaceChildren(node('h1','','微信朋友圈'),node('p','footnote','查看朋友圈接入与本地草稿。发布前确认内容，原生能力需在当前客户端验证。'));
        const empty=card('先连接微信','尚未配置微信账号。请先完成账号、读取和发送核验，再查看朋友圈能力与草稿。');
        empty.append(button('前往微信接入',()=>document.querySelector('nav [data-page="wechatConnection"]')?.click(),'secondary'));page.append(empty);return true;
      }
      const d=await api('wechat/moments');if(seq!==sequence||!isCurrent())return false;render(d);return true;
    }catch(e){notice(e.message,true);return false;}
  }
  const refresh=()=>load();
  const fields=d=>[{name:'text',label:'待审核正文',type:'textarea',rows:7,max:2000,value:d?.text??'',required:true},{name:'visibility',label:'可见范围',type:'select',options:[['public','公开（真实发布需再次确认）']],value:'public'}];
  async function confirmProposal(id){if(!id){notice('请先准备材料，并完成具体DLL及内容的加载授权',true);return;}const p=await api('wechat/moments/preview',{id});edit('实际公开发布一次',[{name:'confirm',label:'确认账号、正文和公开范围，并允许这一次真实发布',type:'checkbox',value:false}],async value=>{if(!value.confirm)throw Error('请先确认');const r=await api('wechat/moments/confirm',{token:p.token,confirm:true});viewText('原生投递结果',r.notice+'\n'+JSON.stringify(r.result,null,2));await refresh();},`微信 ${p.account}\n范围：公开\n\n${p.text}\n\n${p.warning}`);}
  function render(data){page.replaceChildren();page.append(node('h1','','微信朋友圈'),node('p','footnote','使用当前微信的独立原生组件。生成文案只保存本机；发布须确认具体内容。QQ资料不进入这里，自动发布关闭。'));
    const state=card('原生接入 · '+(data.native.connected?'有限测试已连接':'等待有限加载'),data.native.message);state.append(node('p','footnote','微信 '+(data.account??'未核验')+' · 文字：待实测 · 图片/视频/可见名单：未开放'));if(data.native.connected)state.append(node('p','footnote','允许尝试 1 次 · 已尝试 '+data.native.attempts+' 次 · 组件保持到微信退出'));page.append(state);
    const bar=actions();bar.append(button('新建文字草稿',()=>edit('朋友圈草稿',fields(),async v=>{await api('wechat/moments/draft',v);await refresh();},'仅保存本地。原生文字通道仍需有限实测。')),
      button('按人格写朋友圈',()=>{const catalog=getCatalog(),chats=catalog.contacts.items.filter(c=>c.scope.startsWith('wechat:')&&c.policy.enabled).map(c=>[c.scope,c.name+' · '+c.peer]);if(!chats.length){notice('先切换到微信数据，并授权一个来源聊天',true);return;}edit('生成待审核文案（调用当前聊天模型）',[{name:'scope',label:'微信来源聊天',type:'select',options:chats,required:true},{name:'personaId',label:'人格',type:'select',options:catalog.personas.map(p=>[p.id,p.name]),required:true},{name:'theme',label:'主题',type:'textarea',max:1000},{name:'diaryDate',label:'可选：本聊天日记日期',type:'date'}],async v=>{await api('wechat/moments/generate',v);await refresh();},'仅使用微信平台的人格和日记。生成后请检查事实、隐私与语气，不会自动发布。');},'quiet'),button('刷新',refresh,'quiet'));page.append(bar);
    for(const d of data.drafts){const p=card(d.status==='draft'?'待审核文字':d.status==='unstable'?'已发布 · 稳定性未通过':d.status==='accepted'?'服务端接受 · 待人工核对':d.status==='unknown'?'结果未知 · 禁止重发':d.status==='not-submitted'?'原生预检未提交':d.status==='rejected'?'服务端拒绝':d.status,d.text);p.style.whiteSpace='pre-wrap';p.append(node('small','','微信 '+d.account+' · 公开'));
      if(d.status==='draft'){const a=actions();a.append(button('编辑',()=>edit('编辑朋友圈草稿',fields(d),async v=>{await api('wechat/moments/draft',{id:d.id,...v});await refresh();},'编辑后原确认失效。'),'quiet'),button('准备有限测试材料',async()=>{const p=await api('wechat/moments/prepare',{id:d.id});viewText('加载及发布审核材料',JSON.stringify(p,null,2));notice('材料已保存本机，没有加载组件或发布');}),button('审核已加载的测试内容',()=>confirmProposal(data.native.proposalId),'quiet'));p.append(a);}page.append(p);}
    const ledger=card('投递记录','未知结果不自动重试；服务端对象ID不等于已核对可见的朋友圈。');for(const op of data.operations){const p=node('div','actions');p.append(node('span','',op.status+' · '+new Date(op.created).toLocaleString()));if(op.result)p.append(button('查看回执',()=>viewText('朋友圈回执',op.result),'quiet'));if(['unknown','accepted'].includes(op.status))p.append(button('只查原请求回执',async()=>{const r=await api('wechat/moments/reconcile',{id:op.id});viewText('原请求回执',JSON.stringify(r,null,2));await refresh();},'quiet'));ledger.append(p);}page.append(ledger);
  }
}
