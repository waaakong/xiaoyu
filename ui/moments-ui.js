import {momentSections,pageRows,confirmMoment,syncMomentComments,commentSyncNotice} from './moments-workflow-ui.js';
export function installMoments({api,node,button,edit,notice,viewText,showPage,getCatalog}){
  const entry=button('微信朋友圈',()=>showPage('moments',load));entry.dataset.page='moments';entry.dataset.title='微信朋友圈';document.querySelector('nav').append(entry);
  const page=node('section','page companion-page moments-page');page.id='moments';page.hidden=true;document.querySelector('main').append(page);
  const card=(title,copy)=>{const e=node('article','cognition-panel companion-card');e.append(node('h2','',title));if(copy)e.append(node('p','',copy));return e;};
  const actions=()=>node('div','actions');
  let activeSection='compose',commentPage=0,commentFilter='all',currentData=null,currentConnection=null;
  let sequence=0,compose=null,composeAccount=null,lastResult=null,saveTimer=null,sending=false,reviewFilter='all',reviewQuery='';
  const storageKey=account=>'xy-moments-draft:'+encodeURIComponent(account||'wechat');
  const readableSize=bytes=>bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':bytes>=1024?Math.round(bytes/1024)+' KB':bytes+' B';
  const cleanPath=value=>String(value||'').trim().replace(/^["']|["']$/g,'');
  const isAbsolute=value=>/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
  const kindOf=value=>/[.](?:mp4|mov|mkv|mgp|mpe?g|avi|wmv|rm|rmvb)$/i.test(value)?'video':'image';
  const mediaLabel=items=>!items.length?'没有素材':items[0].kind==='video'?'1 个视频':items.length+' 张图片';
  const reviewStatus={draft:['待审核','ready'],published:['已核验发布','ready'],unstable:['已投递 · 稳定性未通过','warn'],accepted:['服务端接受 · 待核对','warn'],unknown:['结果未知 · 禁止重发','danger'],'not-submitted':['明确未提交','idle'],rejected:['服务端拒绝','danger'],attempting:['投递中','warn']};
  const reviewLabel=status=>(reviewStatus[status]??[status||'未知','idle'])[0];
  const reviewClass=status=>(reviewStatus[status]??[null,'idle'])[1];
  const reviewTime=value=>{const d=new Date(Number(value));return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'时间未知';};
  const reviewAccount=account=>String(account||'微信').replace(/^(wxid_.{4}).+$/,'$1…');
  const reviewResult=op=>{try{return JSON.parse(op?.result||'')}catch{return null}};
  async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}notice('正文已复制');}
  async function removeDraft(d,btn){if(btn.dataset.armed!=='1'){btn.dataset.armed='1';btn.textContent='再点一次删除';setTimeout(()=>{if(document.body.contains(btn)){btn.dataset.armed='0';btn.textContent='删除草稿';}},4000);return;}try{btn.disabled=true;await api('wechat/moments/remove',{id:d.id});notice('已删除待审核草稿');await load();}catch(e){btn.disabled=false;btn.dataset.armed='0';btn.textContent='删除草稿';notice(e.message,true);}}
  function savedDraft(account){try{return JSON.parse(localStorage.getItem(storageKey(account))||'{}')}catch{return{}}}
  function ensureCompose(account){
    if(composeAccount===account&&compose)return;
    composeAccount=account;const saved=savedDraft(account);
    const raw=Array.isArray(saved.media)?saved.media.filter(m=>m&&typeof m.path==='string'&&isAbsolute(m.path)):[];
    const kind=raw[0]?kindOf(raw[0].path):null;
    const media=(kind?raw.filter(m=>kindOf(m.path)===kind):[]).slice(0,kind==='video'?1:9).map(m=>({path:m.path,name:m.name||m.path.split(/[\\/]/).pop(),kind,size:Number(m.size)||0,dataUrl:null}));
    compose={draftId:saved.draftId??null,text:typeof saved.text==='string'?[...saved.text].slice(0,1500).join(''):'',media,privacy:saved.privacy==='public'?'public':'private',publish:false};
  }
  function persist(){
    if(!compose||!composeAccount)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{
      try{localStorage.setItem(storageKey(composeAccount),JSON.stringify({draftId:compose.draftId??null,text:compose.text,privacy:compose.privacy,media:compose.media.map(({path,name,kind,size})=>({path,name,kind,size}))}));}catch{}
    },180);
  }
  function clearSaved(account){try{localStorage.removeItem(storageKey(account));}catch{}}
  async function load({isCurrent=()=>true}={}){
    const seq=++sequence;
    try{
      const connection=await api('wechat');
      if(seq!==sequence||!isCurrent())return false;
      if(!connection.config.account){
        page.replaceChildren(node('h1','','微信朋友圈'),node('p','footnote','连接微信后，在这里写文字、加图片或视频，先预览再发布。'));
        const empty=card('先连接微信','尚未配置微信账号。请先完成账号、读取和发送核验，再查看朋友圈能力与草稿。');
        empty.append(button('前往微信接入',()=>document.querySelector('nav [data-page="wechatConnection"]')?.click(),'secondary'));page.append(empty);return true;
      }
      const d=await api('wechat/moments');if(seq!==sequence||!isCurrent())return false;
      if(lastResult&&lastResult.account!==d.account)lastResult=null;
      render(d,connection);return true;
    }catch(e){notice(e.message,true);return false;}
  }
  const refresh=()=>load();
  function openPlan(plan={}){
    const catalog=getCatalog();
    const chats=catalog.contacts.items.filter(c=>c.scope.startsWith('wechat:')&&!c.scope.includes(':group:')&&c.policy.enabled).map(c=>[c.scope,c.name+' · '+c.peer]);
    if(!chats.length){notice('先切换到微信数据，并授权一个私聊作为模型与人格来源',true);return;}
    const personas=catalog.personas.map(p=>[p.id,p.name]);
    if(!personas.length){notice('先创建一个可用人格',true);return;}
    edit('每日随机朋友圈',[
      {name:'enabled',label:'开启每天随机发布',type:'checkbox',value:plan.enabled===true},
      {name:'scope',label:'使用哪个微信私聊的模型与人格上下文',type:'select',options:chats,value:plan.scope||chats[0][0],required:true},
      {name:'personaId',label:'写朋友圈的人格',type:'select',options:personas,value:plan.personaId||personas[0][0],required:true},
      {name:'startHour',label:'随机窗口开始（0–23 时）',type:'number',min:0,max:23,value:plan.startHour??9},
      {name:'endHour',label:'随机窗口结束（1–24 时）',type:'number',min:1,max:24,value:plan.endHour??22},
      {name:'visibility',label:'可见范围',type:'select',options:[['private','私密（仅自己）'],['public','公开（所有人可见）']],value:plan.visibility||'private'},
      {name:'autoIllustrate',label:'让小鱼从朋友圈图库自己配图',type:'checkbox',value:plan.autoIllustrate!==false},
      {name:'maxImages',label:'每次最多配几张图（0–3）',type:'number',min:0,max:3,value:plan.maxImages??1}
    ],async v=>{
      await api('wechat/moments/plan',{...v,enabled:v.enabled===true,startHour:Number(v.startHour),endHour:Number(v.endHour),autoIllustrate:v.autoIllustrate===true,maxImages:Number(v.maxImages)});
      await refresh();notice(v.enabled?'每日随机朋友圈已开启':'每日随机朋友圈已关闭');
    },'每天在窗口内随机选一个时间，读取当前人格最近的日记与各聊天线索，自主选题生成文案，再从朋友圈图库挑图后用微信界面发布。不会暂停微信收发，但微信窗口会短暂切到前台。默认私密；选择公开前请确认人格与内容边界。');
  }
  function openGenerate(){
    const catalog=getCatalog(),chats=catalog.contacts.items.filter(c=>c.scope.startsWith('wechat:')&&c.policy.enabled).map(c=>[c.scope,c.name+' · '+c.peer]);
    if(!chats.length){notice('先切换到微信数据，并授权一个来源聊天',true);return;}
    edit('生成待审核文案（调用当前聊天模型）',[{name:'scope',label:'微信来源聊天',type:'select',options:chats,required:true},{name:'personaId',label:'人格',type:'select',options:catalog.personas.map(p=>[p.id,p.name]),required:true},{name:'theme',label:'主题（可留空，让小鱼自主选题）',type:'textarea',max:1000},{name:'diaryDate',label:'可选：只读这一天的日记',type:'date'},{name:'autoIllustrate',label:'让小鱼从朋友圈图库自己配图',type:'checkbox',value:true},{name:'maxImages',label:'最多配几张图（0–3）',type:'number',min:0,max:3,value:1}],async v=>{await api('wechat/moments/generate',{...v,autoIllustrate:v.autoIllustrate===true,maxImages:Number(v.maxImages)});await refresh();},'主题留空时，小鱼会读取当前人格最近的日记，以及这个人格在各聊天的近期线索，自主选题撰写；指定日期则只读该篇日记。仅使用微信平台资料，生成后请检查事实、隐私与语气，不会自动发布。勾选配图时只从朋友圈图库挑，不上传外部图片。');
  }
  function openLocalDraft(){
    const fields=d=>[{name:'text',label:'待审核正文',type:'textarea',rows:7,max:2000,value:d?.text??'',required:true},{name:'visibility',label:'可见范围',type:'select',options:[['public','公开（真实发布需再次确认）']],value:'public'}];
    edit('朋友圈草稿',fields(),async v=>{await api('wechat/moments/draft',v);await refresh();},'仅保存本地。原生文字通道仍需有限实测。');
  }
  async function confirmProposal(id){
    if(!id){notice('请先准备材料，并完成具体DLL及内容的加载授权',true);return;}
    const p=await api('wechat/moments/preview',{id});
    edit('实际公开发布一次',[{name:'confirm',label:'确认账号、正文和公开范围，并允许这一次真实发布',type:'checkbox',value:false}],async value=>{if(!value.confirm)throw Error('请先确认');const r=await api('wechat/moments/confirm',{token:p.token,confirm:true});viewText('原生投递结果',r.notice+'\n'+JSON.stringify(r.result,null,2));await refresh();},`微信 ${p.account}\n范围：公开\n\n${p.text}\n\n${p.warning}`);
  }
  function renderResult(target,result){
    if(!result||result.account!==composeAccount)return;
    const box=node('div','moment-result '+(result.error?'error':'success'));
    if(result.error){box.append(node('strong','','这次没有完成'),node('p','',result.error));}
    else{
      const title=result.published?'已核验发布':result.status==='unknown'?'结果待核对，禁止重发':result.status==='duplicate'?'已阻止重复发布':result.canceled?'演练完成，未发布':'操作结束';
      box.append(node('strong','',title),node('p','',result.notice??(result.published?'已读回本人朋友圈的新动态。':result.canceled?'编辑已取消，微信里没有产生新动态。':'操作已结束。')));
      box.append(node('small','','requestId · '+(result.requestId||'未返回')));
      box.append(button('查看完整回执',()=>viewText('朋友圈界面发布结果',JSON.stringify(result,null,2)),'quiet'));
    }
    target.append(box);
  }
  function buildCompose(data,connection,canPublish){
    ensureCompose(data.account);
    const section=node('section','moment-compose');
    const editor=node('div','moment-editor-card');
    const head=node('div','moment-compose-head');
    const title=node('div');
    title.append(node('span','moment-kicker',compose.draftId?'DRAFT':'NEW MOMENT'),node('h2','',compose.draftId?'编辑朋友圈草稿':'写一条朋友圈'),node('p','footnote','像发朋友圈一样写好文字和素材，再决定只演练还是真实发布。'));
    const headTools=node('div','moment-head-tools');
    const drafts=(data.drafts??[]).filter(d=>d.status==='draft').length;
    headTools.append(node('span','moment-badge '+(canPublish?'ready':'blocked'),canPublish?'界面自动化已就绪':'界面自动化未就绪'),button('草稿箱 '+drafts,()=>document.querySelector('.moment-review')?.scrollIntoView({behavior:'smooth',block:'start'}),'quiet'));
    head.append(title,headTools);
    editor.append(head);
    if(!canPublish){
      const warning=node('div','moment-warning');
      warning.append(node('span','','需要先开启微信控件适配，才能用界面发布。'),button('前往微信接入',()=>showPage('wechatConnection'),'quiet'));
      editor.append(warning);
    }
    const textWrap=node('div','moment-text-wrap');
    const textarea=node('textarea','moment-text');textarea.maxLength=1500;textarea.placeholder='这一刻的想法…';textarea.value=compose.text;textarea.setAttribute('aria-label','朋友圈正文');
    const counter=node('span','moment-counter');
    textWrap.append(textarea,counter);editor.append(textWrap);
    const mediaHead=node('div','moment-section-head');mediaHead.append(node('strong','','图片 / 视频'),node('small','','最多 9 张图片，或 1 个视频；第一张是封面'));
    const grid=node('div','moment-media-grid');
    const picker=node('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.multiple=true;picker.hidden=true;picker.setAttribute('aria-label','选择朋友圈静态图片');
    const mediaActions=node('div','moment-media-actions');
    const choose=button('选择图片',()=>picker.click(),'primary');
    const library=button('从图库选择',()=>openLibrary(),'secondary');
    const auto=button('让小鱼配图',()=>autoIllustrate(),'secondary');
    const clearMedia=button('清空素材',()=>{if(!compose.media.length)return;compose.media=[];sync(true);persist();},'quiet');
    mediaActions.append(choose,library,auto,clearMedia);
    const pathRow=node('div','moment-path-row');
    const pathInput=node('input','moment-path');pathInput.placeholder='视频请粘贴绝对路径（图片可直接选择）';pathInput.setAttribute('aria-label','媒体绝对路径');
    const addButton=button('按路径添加',async()=>{if(await addPath(pathInput.value))pathInput.value='';},'quiet');
    pathInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();addButton.click();}};
    pathRow.append(pathInput,addButton);
    const hint=node('p','moment-file-hint','图片会被整理进朋友圈图库，发布时由微信界面读取原文件；不会上传到外部服务。');
    picker.onchange=async()=>{const files=[...picker.files];picker.value='';for(const file of files)await addFile(file);};
    grid.ondragover=e=>{e.preventDefault();grid.classList.add('drop');};
    grid.ondragleave=()=>grid.classList.remove('drop');
    grid.ondrop=async e=>{e.preventDefault();grid.classList.remove('drop');for(const file of [...(e.dataTransfer?.files??[])])await addFile(file);};
    const mediaBlock=node('div','moment-media');mediaBlock.append(mediaHead,grid,mediaActions,pathRow,hint,picker);editor.append(mediaBlock);
    const options=node('div','moment-options');
    const privacy=node('div','moment-privacy');privacy.setAttribute('role','group');privacy.setAttribute('aria-label','可见范围');
    const privacyButtons={};
    for(const [key,label,desc]of [['private','私密','仅自己可见'],['public','公开','所有人可见']]){
      const b=node('button','moment-privacy-option');b.type='button';b.append(node('strong','',label),node('small','',desc));b.onclick=()=>{compose.privacy=key;sync(false);persist();};privacyButtons[key]=b;privacy.append(b);
    }
    const confirm=node('label','moment-confirm');const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=compose.publish;checkbox.onchange=()=>{compose.publish=checkbox.checked;sync(false);};confirm.append(checkbox,node('span','','确认现在真实发布到微信朋友圈'));
    options.append(privacy);editor.append(options);
    const footer=node('div','moment-actions');
    const publishButton=button('发布到朋友圈',()=>submit(true),'primary');
    const dryButton=button('先演练，不发布',()=>submit(false),'secondary');
    const clearButton=button('清空',()=>{if(!confirm2())return;compose.draftId=null;compose.text='';compose.media=[];compose.publish=false;clearSaved(composeAccount);textarea.value='';checkbox.checked=false;sync(true);},'quiet');
    const saveButton=button('保存草稿',async()=>{try{const result=await api('wechat/moments/composition/save',{draftId:compose.draftId??undefined,text:compose.text,media:compose.media.map(m=>m.path),privacy:compose.privacy});compose.draftId=result.id;persist();notice('草稿已保存，未操作微信');await load();}catch(e){notice(e.message,true);}},'secondary');footer.append(publishButton,saveButton,dryButton,clearButton);editor.append(footer);
    const status=node('p','moment-publish-hint');editor.append(status);
    const resultSlot=node('div','moment-result-slot');editor.append(resultSlot);
    const preview=node('aside','moment-preview');
    const previewCard=node('div','moment-preview-card');
    const previewHead=node('div','moment-preview-head');const avatar=node('span','moment-preview-avatar','鱼');const who=node('div');who.append(node('strong','','小鱼'),node('small','','刚刚'));
    const privacyBadge=node('span','moment-preview-privacy','私密');previewHead.append(avatar,who,privacyBadge);
    const previewText=node('p','moment-preview-text');const previewMedia=node('div','moment-preview-media');
    const previewFoot=node('div','moment-preview-foot');previewFoot.append(node('span','','发布后可在微信朋友圈查看'),node('span','moment-preview-count'));
    previewCard.append(previewHead,previewText,previewMedia,previewFoot);preview.append(previewCard,node('p','moment-preview-note','这是本地预览，最终排版以微信为准。'));
    section.append(editor,preview);
    function sync(media=true){
      if(document.activeElement!==textarea&&textarea.value!==compose.text)textarea.value=compose.text;
      if(document.activeElement!==checkbox)checkbox.checked=compose.publish;
      const chars=[...compose.text].length;counter.textContent=chars+' / 1500';counter.classList.toggle('near',chars>1350);
      for(const [key,value]of Object.entries(privacyButtons)){value.classList.toggle('active',compose.privacy===key);value.setAttribute('aria-pressed',String(compose.privacy===key));}
      privacyBadge.textContent=compose.privacy==='public'?'公开':'私密';privacyBadge.dataset.privacy=compose.privacy;
      const has=!!compose.text.trim()||compose.media.length>0;
      previewText.textContent=compose.text.trim()||'这一刻的想法…';previewText.classList.toggle('empty',!compose.text.trim());previewMedia.hidden=!compose.media.length;previewFoot.querySelector('.moment-preview-count').textContent=mediaLabel(compose.media);
      if(media)paintMedia();
      publishButton.disabled=!canPublish||!has||sending;
      dryButton.disabled=!canPublish||!has||sending;clearButton.disabled=sending;saveButton.disabled=!has||sending;
      publishButton.textContent=sending?'正在处理…':'审核并发布';
      status.textContent=!canPublish?'界面自动化未就绪，先完成微信接入与控件适配。':!has?'填写正文，或加入图片 / 视频。':compose.publish?'将真实发布到微信朋友圈；不会暂停微信收发，但微信窗口会短暂切到前台。':'先保存草稿，或审核完整内容后确认发布；也可只准备演练。';
    }
    function paintMedia(){
      grid.replaceChildren();
      if(!compose.media.length){const empty=node('div','moment-empty-media');empty.append(node('span','moment-empty-icon','＋'),node('small','','还没有选择图片或视频'));grid.append(empty);}
      compose.media.forEach((item,index)=>{
        const tile=node('div','moment-thumb');tile.title=item.path;tile.draggable=true;
        if(item.dataUrl){const img=node('img');img.src=item.dataUrl;img.alt=item.name;tile.append(img);}
        else{const fallback=node('div','moment-thumb-fallback');fallback.append(node('span','moment-thumb-glyph',item.kind==='video'?'▶':'▧'),node('small','',item.previewUnavailable?'文件较大，暂不预览':item.name));tile.append(fallback);}
        if(index===0)tile.append(node('span','moment-cover','封面'));
        const label=node('span','moment-file',item.name);tile.append(label);
        const remove=button('×',()=>{compose.media=compose.media.filter(x=>x!==item);sync(true);persist();},'quiet moment-remove');remove.title='移除';remove.setAttribute('aria-label','移除 '+item.name);tile.append(remove);
        tile.ondragstart=e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(index));};
        tile.ondragover=e=>{e.preventDefault();tile.classList.add('drag-over');};
        tile.ondragleave=()=>tile.classList.remove('drag-over');
        tile.ondrop=e=>{e.preventDefault();tile.classList.remove('drag-over');const from=Number(e.dataTransfer.getData('text/plain'));if(!Number.isInteger(from)||from===index)return;const [moved]=compose.media.splice(from,1);compose.media.splice(index,0,moved);sync(true);persist();};
        grid.append(tile);
      });
      previewMedia.replaceChildren();previewMedia.classList.toggle('single',compose.media.length===1);
      for(const item of compose.media.slice(0,9)){
        const cell=node('div','moment-preview-cell');
        if(item.dataUrl){const img=node('img');img.src=item.dataUrl;img.alt=item.name;cell.append(img);}
        else{cell.append(node('span','',item.kind==='video'?'▶':'▧'),node('small','',item.kind==='video'?item.name:''));}
        previewMedia.append(cell);
      }
    }
    const fileData=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error??Error('读取图片失败'));reader.readAsDataURL(file);});
    async function imageUrl(id,{thumbnail=false}={}){
      const token=sessionStorage.getItem('windowToken')||'';
      const res=await fetch('/api/wechat/moments/images/file?id='+encodeURIComponent(id)+(thumbnail?'&thumbnail=1':''),{headers:{'X-Session-Token':token,'X-Platform':sessionStorage.getItem('xyPlatform')??'wechat'}});
      if(!res.ok)throw Error('图库预览加载失败');
      return URL.createObjectURL(await res.blob());
    }
    function fits(kind){
      if(kind==='video'&&(compose.media.some(x=>x.kind==='image')||compose.media.length>=1)){notice('一条朋友圈只能放 1 个视频，且不能和图片混发',true);return false;}
      if(kind==='image'&&(compose.media.some(x=>x.kind==='video')||compose.media.length>=9)){notice(compose.media.length>=9?'最多添加 9 张图片':'图片不能和视频混发',true);return false;}
      return true;
    }
    async function addLibraryImage(row){
      if(!fits('image')||compose.media.some(x=>x.path===row.path))return false;
      const item={path:row.path,name:row.name||String(row.path).split(/[\\/]/).pop(),kind:'image',size:Number(row.bytes)||0,dataUrl:null};
      compose.media.push(item);sync(true);persist();
      try{item.dataUrl=await imageUrl(row.id);paintMedia();}catch{}
      return true;
    }
    async function addFile(file){
      if(!file)return false;
      if(!/^image\/(png|jpeg|webp)$/i.test(file.type)){notice('朋友圈图库只接收静态 PNG/JPEG/WebP；动态表情请在聊天中使用',true);return false;}
      if(!fits('image'))return false;
      if(file.size>5*1024*1024){notice('朋友圈图片单张最多 5MB',true);return false;}
      try{
        const data=await fileData(file),base64=data.split(',').pop();
        const saved=await api('wechat/moments/images/upload',{name:file.name,base64});
        return addLibraryImage(saved);
      }catch(e){notice(e.message,true);return false;}
    }
    async function openLibrary(){
      if(!fits('image'))return;
      let data;try{data=await api('wechat/moments/images');}catch(e){notice(e.message,true);return;}
      const overlay=node('div','moment-library-overlay'),panel=node('div','moment-library-panel');
      panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','朋友圈静态图库');
      let timer,request=0;const urls=new Set(),remember=url=>{if(!overlay.isConnected){URL.revokeObjectURL(url);return null;}urls.add(url);return url;};const dispose=()=>{clearTimeout(timer);request++;for(const url of urls)URL.revokeObjectURL(url);overlay.remove();document.removeEventListener('keydown',keydown);};
      const keydown=e=>{if(e.key==='Escape')dispose();};document.addEventListener('keydown',keydown);
      const head=node('div','moment-library-head');const close=button('×',dispose,'quiet');close.setAttribute('aria-label','关闭图库');head.append(node('div','', ''),close);head.firstChild.append(node('h3','','朋友圈图库'),node('p','footnote','仅静态图片 · 共 '+(data.count??0)+' 张 · 方形缩略图，发布保留原图'));
      const search=node('input','moment-search');search.type='search';search.placeholder='搜索名称、标签或心情';
      const category=node('select');category.setAttribute('aria-label','图片分类');for(const name of ['',...(data.categories??[])]){const o=node('option','',name||'全部分类');o.value=name;category.append(o);}const filters=node('div','moment-library-filters');filters.append(search,category);
      const grid2=node('div','moment-library-grid'),selected=new Map(),remaining=9-compose.media.filter(x=>x.kind==='image').length;const confirm=node('button','primary','加入素材');confirm.type='button';confirm.disabled=true;const cancel=button('取消',dispose,'quiet');const count=node('span','footnote'),previous=button('上一页',()=>fetchPage(Math.max(0,(data.offset??0)-60)),'quiet'),next=button('下一页',()=>fetchPage((data.offset??0)+60),'quiet'),pager=node('div','moment-library-pager');pager.append(previous,count,next);
      const update=()=>{confirm.disabled=!selected.size;confirm.textContent=selected.size?'加入 '+selected.size+' 张':'加入素材';count.textContent=(data.total?Math.floor((data.offset??0)/60)+1:0)+' / '+Math.ceil((data.total??0)/60)+' 页 · 已选 '+selected.size+'/'+remaining;previous.disabled=!(data.offset>0);next.disabled=(data.offset??0)+(data.images?.length??0)>=(data.total??0);};
      function preview(row){const shade=node('div','moment-original-overlay'),box=node('div','moment-original-box'),img=node('img');img.alt=row.name;const done=button('关闭原图',()=>shade.remove(),'quiet');box.append(done,img,node('p','',row.name+' · '+row.width+' × '+row.height));shade.append(box);shade.onclick=e=>{if(e.target===shade)shade.remove();};overlay.append(shade);imageUrl(row.id).then(url=>{const saved=remember(url);if(shade.isConnected&&saved)img.src=saved;}).catch(()=>shade.remove());}
      const paint=()=>{
        grid2.replaceChildren();const rows=data.images??[];
        if(!rows.length){grid2.append(node('p','moment-review-empty','没有匹配的图库图片。'));return;}
        for(const row of rows){
          const tile=node('div','moment-library-item'),pick=node('button','moment-library-pick');pick.type='button';tile.dataset.id=row.id;pick.setAttribute('aria-label','选择 '+row.name);const added=compose.media.some(x=>x.path===row.path);pick.disabled=added;pick.setAttribute('aria-pressed',String(selected.has(row.id)));tile.classList.toggle('on',selected.has(row.id));
          const frame=node('span','moment-library-frame'),img=node('img');img.alt=row.name;img.loading='lazy';frame.append(img);pick.append(frame,node('span','moment-library-name',row.name));tile.append(pick,button(added?'已添加':'查看原图',()=>preview(row),'moment-library-preview'));
          imageUrl(row.id,{thumbnail:true}).then(url=>{const saved=remember(url);if(saved&&img.isConnected)img.src=saved;}).catch(()=>{});
          pick.onclick=()=>{if(selected.has(row.id))selected.delete(row.id);else{if(selected.size>=remaining)return notice('还可添加 '+remaining+' 张',true);selected.set(row.id,row);}tile.classList.toggle('on',selected.has(row.id));pick.setAttribute('aria-pressed',String(selected.has(row.id)));update();};
          grid2.append(tile);
        }
        update();
      };
      async function fetchPage(offset=0){const n=++request;grid2.setAttribute('aria-busy','true');try{const r=await api('wechat/moments/images?'+new URLSearchParams({query:search.value.trim(),category:category.value,offset,limit:60}));if(n!==request||!overlay.isConnected)return;data=r;paint();update();}catch(e){if(n===request)notice(e.message,true);}finally{if(n===request)grid2.removeAttribute('aria-busy');}}
      search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>fetchPage(0),180);};category.onchange=()=>fetchPage(0);
      confirm.onclick=async()=>{if(!selected.size)return;confirm.disabled=true;try{for(const row of selected.values())await addLibraryImage(row);dispose();}catch(e){confirm.disabled=false;notice(e.message,true);}};
      const foot=node('div','moment-library-foot');foot.append(node('span','footnote','第一张会作为封面'),cancel,confirm);
      panel.append(head,filters,grid2,pager,foot);overlay.append(panel);overlay.onclick=e=>{if(e.target===overlay)dispose();};document.body.append(overlay);paint();update();search.focus();
    }
    async function autoIllustrate(){
      if(!compose.text.trim())return notice('先写一点正文，小鱼才知道配什么图',true);
      if(!fits('image'))return;
      try{
        const rows=await api('wechat/moments/images/suggest',{text:compose.text,limit:Math.max(1,Math.min(3,9-compose.media.length))});
        let added=0;for(const row of rows??[])if(await addLibraryImage(row))added++;
        notice(added?('小鱼挑了 '+added+' 张图，可以继续换或删'):'图库里没有合适的图，先保持纯文字');
      }catch(e){notice(e.message,true);}
    }
    async function addPath(raw){
      let file;try{file=cleanPath(raw);}catch{return false;}
      if(!file){notice('先粘贴一个图片或视频的绝对路径',true);return false;}
      if(!isAbsolute(file)){notice('请填写绝对路径，例如 C:\\Users\\你\\Pictures\\a.png',true);return false;}
      const kind=kindOf(file);
      if(compose.media.some(x=>x.path===file)){notice('这个文件已经在素材里了');return false;}
      if(kind==='video'&&(compose.media.some(x=>x.kind==='image')||compose.media.length>=1)){notice('一条朋友圈只能放 1 个视频，且不能和图片混发',true);return false;}
      if(kind==='image'&&(compose.media.some(x=>x.kind==='video')||compose.media.length>=9)){notice(compose.media.length>=9?'最多添加 9 张图片':'图片不能和视频混发',true);return false;}
      let info;try{info=await api('wechat/moments/media?path='+encodeURIComponent(file));}catch(e){notice(e.message,true);return false;}
      compose.media.push({path:file,name:info.name,kind:info.kind,size:info.size,dataUrl:info.base64?'data:'+info.mime+';base64,'+info.base64:null,previewUnavailable:info.kind==='image'&&!info.preview});
      sync(true);persist();return true;
    }
    function confirm2(){return window.confirm('清空正在编辑的正文和素材？本机草稿也会删除。');}
    async function submit(publish){
      if(sending)return;
      if(!canPublish){notice('请先在微信接入中开启控件适配',true);return;}
      if(!compose.text.trim()&&!compose.media.length){notice('先写正文，或加入图片 / 视频',true);return;}
      sending=true;sync(false);
      try{
        const payload={text:compose.text,media:compose.media.map(x=>x.path),privacy:compose.privacy,publish};let r;if(publish){const saved=await api('wechat/moments/composition/save',{...payload,draftId:compose.draftId??undefined});compose.draftId=saved.id;persist();const review=await api('wechat/moments/composition/review',{draftId:saved.id});if(!await confirmMoment(review,compose.media)){await api('wechat/moments/composition/cancel',{reviewId:review.reviewId});notice('已返回编辑，草稿保留，未发布');return;}r=await api('wechat/moments/composition/publish',{reviewId:review.reviewId});}else r=await api('wechat/moments/ui',payload);
        if(!publish&&r.canConfirmDuplicate&&window.confirm('相同内容24小时内已经发布。确定要再发布一条吗？'))r=await api('wechat/moments/ui',{...payload,confirmDuplicate:true});
        lastResult={...r,account:composeAccount,mode:publish?'publish':'dry-run'};
        if(publish&&r.published){compose.text='';compose.media=[];compose.publish=false;clearSaved(composeAccount);}
        notice(r.published?'已核验发布':r.notice??(r.canceled?'演练完成，微信里没有新动态':'操作结束'));
        await load();
      }catch(e){lastResult={error:e.message,account:composeAccount,mode:publish?'publish':'dry-run'};renderResult(resultSlot,lastResult);notice(e.message,true);}
      finally{sending=false;if(document.body.contains(textarea))sync(false);}
    }
    textarea.oninput=()=>{compose.text=textarea.value;sync(false);persist();};
    textarea.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!publishButton.disabled){e.preventDefault();publishButton.click();}};
    sync(true);renderResult(resultSlot,lastResult);
    return section;
  }
  function buildReview(data){
    const drafts=data.drafts??[],ops=data.operations??[],section=node('article','moment-review');
    const head=node('div','moment-review-head'),intro=node('div','');
    intro.append(node('p','moment-eyebrow','LOCAL REVIEW'),node('h2','','本地草稿与审核记录'),node('p','moment-review-sub','草稿只保存在本机；投递回执只记录服务端返回，不代表朋友圈已核对可见。'));
    head.append(intro,node('span','moment-badge '+(drafts.some(d=>d.status!=='draft')?'warn':'idle'),drafts.length+' 份草稿 · '+ops.length+' 条投递'));
    section.append(head);
    const tools=node('div','moment-review-tools'),search=node('input','moment-search');
    search.type='search';search.placeholder='搜索正文、状态或日期';search.value=reviewQuery;search.setAttribute('aria-label','搜索本地草稿');
    const filters=node('div','moment-filter'),list=node('div','moment-review-list');
    const count=key=>key==='draft'?drafts.filter(d=>d.status==='draft').length:key==='review'?drafts.filter(d=>['accepted','unknown','unstable'].includes(d.status)).length:key==='published'?drafts.filter(d=>d.status!=='draft').length:drafts.length;
    const filterButtons=new Map();
    const paint=()=>{
      for(const [key,b] of filterButtons){b.classList.toggle('active',key===reviewFilter);b.setAttribute('aria-pressed',String(key===reviewFilter));}
      const query=reviewQuery.toLowerCase(),visible=drafts.filter(d=>{
        const byFilter=reviewFilter==='all'||(reviewFilter==='draft'?d.status==='draft':reviewFilter==='review'?['accepted','unknown','unstable'].includes(d.status):d.status!=='draft');
        if(!byFilter)return false;
        if(!query)return true;
        return [d.text,reviewLabel(d.status),reviewTime(d.updated),d.account].join(' ').toLowerCase().includes(query);
      });
      list.replaceChildren();
      if(!visible.length){list.append(node('p','moment-review-empty',drafts.length?'没有匹配的草稿或记录。':'还没有本地草稿。写一条或按人格生成后，会先保存在这里。'));return;}
      for(const d of visible){
        const text=String(d.text??''),record=node('article','moment-record status-'+reviewClass(d.status));
        const top=node('header','moment-record-head'),left=node('div','moment-record-status');
        left.append(node('span','moment-record-dot'),node('strong','',reviewLabel(d.status)),node('span','moment-record-time','更新于 '+reviewTime(d.updated)));
        top.append(left,node('span','moment-record-chars',[...text].length+' 字'));record.append(top);
        const body=node('p','moment-record-text',text);if([...text].length>120)body.classList.add('clamped');record.append(body);
        const meta=node('div','moment-record-meta');
        meta.append(node('span','',d.visibility==='public'?'公开':'私密'),node('span','','微信 '+reviewAccount(d.account)),node('span','','#'+String(d.id).slice(0,8)));
        const op=ops.find(o=>o.draftId===d.id),receipt=reviewResult(op);
        if(receipt?.objectId)meta.append(node('span','moment-meta-object','对象 '+receipt.objectId));
        record.append(meta);
        const acts=actions();
        if([...text].length>120){const more=button('展开全文',()=>{const clamped=body.classList.toggle('clamped');more.textContent=clamped?'展开全文':'收起';},'quiet');acts.append(more);}
        acts.append(button('复制正文',()=>copyText(text),'quiet'));
        if(d.status==='draft'){
          acts.append(button('继续编辑 / 审核发布',async()=>{if(sending)return;try{if(compose?.text?.trim()&&compose.draftId!==d.id&&!window.confirm('载入此草稿将替换编辑区内容，是否继续？'))return;const value=await api('wechat/moments/composition/load',{draftId:d.id});const previews=await Promise.all(value.media.map(async path=>{try{const info=await api('wechat/moments/media?path='+encodeURIComponent(path));return info.base64?'data:'+info.mime+';base64,'+info.base64:null;}catch{return null;}}));compose={...value,media:value.media.map((path,index)=>({path,name:path.split(/[\\/]/).pop(),kind:kindOf(path),size:0,dataUrl:previews[index]})),publish:false};composeAccount=data.account;persist();activeSection='compose';render(currentData,currentConnection);page.querySelector('.moment-compose')?.scrollIntoView({behavior:'smooth',block:'start'});}catch(e){notice(e.message,true);}},'primary'));
          const del=button('删除草稿',()=>removeDraft(d,del),'quiet');acts.append(del);
        }
        if(op)acts.append(button('查看投递回执',()=>viewText('朋友圈投递回执',op.result??''),'quiet'));
        record.append(acts);list.append(record);
      }
    };
    search.oninput=()=>{reviewQuery=search.value.trim();paint();};
    for(const [key,label] of [['all','全部'],['draft','待审核'],['review','需核对'],['published','已投递']]){
      const b=button(label+' '+count(key),()=>{reviewFilter=key;paint();},'quiet moment-filter-button');filterButtons.set(key,b);filters.append(b);
    }
    tools.append(search,filters);section.append(tools,list);
    if(ops.length){
      const audit=node('section','moment-audit'),auditHead=node('div','moment-audit-head');
      auditHead.append(node('h3','','投递回执'),node('p','footnote','未知结果不自动重试；服务端对象 ID 不等于已核对可见的朋友圈。'));audit.append(auditHead);
      for(const op of ops){
        const row=node('div','moment-audit-row'),main=node('div','moment-audit-main'),receipt=reviewResult(op);
        main.append(node('strong','',reviewLabel(op.status)),node('span','',reviewTime(op.created)+(receipt?.objectId?' · 对象 '+receipt.objectId:'')));
        row.append(main);
        if(op.result)row.append(button('查看回执',()=>viewText('朋友圈回执',op.result),'quiet'));
        if(['unknown','accepted'].includes(op.status))row.append(button('只查原请求回执',async()=>{const r=await api('wechat/moments/reconcile',{id:op.id});viewText('原请求回执',JSON.stringify(r,null,2));await refresh();},'quiet'));
        audit.append(row);
      }
      section.append(audit);
    }
    paint();return section;
  }
  function openCommentPolicy(data){
    const p=data?.policy??{};
    edit('朋友圈评论自动回复',[
      {name:'enabled',label:'自动回复本人动态的新评论（首次开启先建立历史基线）',type:'checkbox',value:p.enabled===true},
      {name:'defaultPersonaId',label:'新发现动态默认绑定的人格（留空则逐条指定）',type:'select',value:p.defaultPersonaId??'',options:[['','逐条指定'],...(getCatalog()?.personas??[]).map(p=>[p.id,p.name])]},
      {name:'allowedAuthors',label:'仅回复这些微信ID（可选，逗号分隔；留空允许所有评论人）',value:(p.allowedAuthors??[]).join(',')},
      {name:'scope',label:'回复范围',type:'select',value:p.scope??'selected',options:[['selected','仅逐条开启的本人动态'],['allOwn','所有已核验的本人动态']]},
      ...[['maxPerPerson','每人每帖回复上限',1,20,5],['maxPerDay','24小时发送上限',1,500,50],['maxAgeHours','评论有效小时',1,720,72],['maxCallsPerDay','24小时模型调用上限',1,500,50],['maxTokensPerDay','24小时Token预算（保守估计）',500,100000,16000],['cooldownSeconds','回复冷却秒数',0,86400,60],['maxChain','评论链上限',1,10,3]].map(([name,label,min,max,value])=>({name,label,type:'number',min,max,value:p[name]??value}))
    ],async v=>{await api('wechat/moments/comments/policy',v);await refresh();notice('设置已保存，原排队任务已取消');},'自动发送须同时具备准确身份、人格绑定、已核验发送通道及预算。结果未知不重发；首次开启不会补回历史评论。');
  }
  function buildComments(data){
    const section=node('article','moment-comments'),p=data?.policy??{},counts=data?.counts??{},transport=data?.transport??{};
    const head=node('div','moment-comments-head'),intro=node('div');
    intro.append(node('p','moment-eyebrow','COMMENTS'),node('h2','','朋友圈评论'),node('p','moment-review-sub','只处理本人动态；准确区分待处理、提交和真实送达。'));
    head.append(intro,node('span','moment-badge '+(p.enabled?'ready':'idle'),p.enabled?'自动回复策略已开启':'自动回复已关闭'));section.append(head);
    section.append(node('p','footnote',transport.ready?'原生评论通道已核验':transport.reason??'原生评论发送尚未核验，当前不会自动发出评论'));
    if(transport.build){const nativeTools=node('div','moment-comment-tools');nativeTools.append(button(transport.connected?'重新核对组件':'加载原生评论组件',()=>edit('加载常驻原生评论组件',[{name:'confirm',label:'我确认加载此已列出哈希的组件；自动回复需另行开启',type:'checkbox',value:false},{name:'autoConnect',label:'今后同账号、同哈希组件随微信连接自动恢复',type:'checkbox',value:true}],async v=>{if(!v.confirm)throw Error('请先确认组件');await api('wechat/moments/native/enable',{confirmHash:transport.build.dllSha256,autoConnect:!!v.autoConnect});await refresh();notice('组件已连接，自动回复保持关闭。请先核验一条回复，再配置范围。');},'微信4.2.0.13 · SHA256 '+transport.build.dllSha256+'。组件可能使微信异常；只复用已确认的相同文件，更新后需重新核验。','确认加载组件'),'secondary'),button('检测组件状态',async()=>{await api('wechat/moments/native/refresh',{});await refresh();},'quiet'));section.append(nativeTools);}
    if(transport.canValidate)section.append(node('p','footnote','当前组件尚未完成真实回复验收。同步后可选择一条评论，核验正文并发送一次；此操作会公开回复，不会开启后台自动回复。'));
    if(p.migrationNotice)section.append(node('p','footnote',p.migrationNotice));
    const stats=node('div','moment-comment-stats');for(const [label,value]of [['动态',counts.posts??0],['评论',counts.comments??0],['待处理',counts.pending??0],['结果未知',counts.unknown??0],['模型调用',data?.usage?.calls??0],['预算Token',data?.usage?.tokens??0]])stats.append(node('span','',label+' '+value));
    if(p.lastSyncAt)stats.append(node('span','','上次同步 '+reviewTime(p.lastSyncAt)));if(p.lastError)stats.append(node('span','moment-comment-error',p.lastError));section.append(stats);if(p.lastSyncInfo){const x=p.lastSyncInfo;section.append(node('p','footnote','本轮详情补查 '+x.detailReads+' 条 · 待补查 '+Math.max(x.deferredDetails??0,x.unresolvedPosts??0)+' 条 · 完整性未确认 '+(x.incompletePosts??0)+' 条'+(x.historyPending?' · 历史分页尚未结束':'')));}
    const tools=node('div','moment-comment-tools');tools.append(button('立即同步',async()=>{const r=await syncMomentComments(api);await refresh();notice(commentSyncNotice(r));},'primary'),button('回复设置',()=>openCommentPolicy(data),'secondary'));section.append(tools);
    const posts=node('details');posts.append(node('summary','','逐条动态的范围与人格'));
    for(const post of data?.posts??[]){const row=node('div','moment-comment');row.append(node('p','',String(post.text||'媒体动态').slice(0,100)),node('small','',post.objectId?'对象 '+post.objectId:'仅界面观察 · 缺少稳定ID'));
      row.append(button('设置范围和人格',()=>edit('动态评论策略',[{name:'enabled',label:'允许此动态自动回复',type:'checkbox',value:!!post.autoReply},{name:'personaId',label:'绑定人格',type:'select',options:(getCatalog()?.personas??[]).map(p=>[p.id,p.name]),value:post.personaId??'',required:true}],async v=>{await api('wechat/moments/comments/post-policy',{postId:post.id,...v});await refresh();},'首次开启此动态会忽略已有评论。'),'quiet'));posts.append(row);
    }section.append(posts);
    const list=node('div','moment-comment-list'),filter=node('select');filter.setAttribute('aria-label','筛选评论状态');for(const [value,label]of [['all','全部评论'],['pending','待处理'],['unknown','结果未知'],['delivered','已送达'],['unverified','身份未核验']]){const o=node('option','',label);o.value=value;filter.append(o);}section.append(filter,list);
    const labels={new:'待处理',unverified:'身份未核验',ignored:'已忽略',queued:'排队',generating:'生成中',ready:'待提交',sending:'提交中',delivered:'已核验送达',failed:'未提交失败',unknown:'结果未知，禁止重发'};
    const pager=node('div','moment-pager');section.append(pager);filter.value=commentFilter;
    let nextOffset=data?.pagination?.nextOffset??null;const more=button('加载更早评论',async()=>{const r=await api('wechat/moments/comments?offset='+nextOffset+'&limit=200'),ids=new Set((data.comments??[]).map(c=>c.id));data.comments.push(...r.comments.filter(c=>!ids.has(c.id)));nextOffset=r.pagination?.nextOffset??null;more.hidden=nextOffset==null;paint();notice('已载入 '+data.comments.length+' / '+r.pagination.total+' 条评论');},'secondary');more.hidden=nextOffset==null;section.append(more);
    if(data?.pagination&&data.pagination.total>(data.comments?.length??0))section.append(node('p','footnote','数据库已同步 '+data.pagination.total+' 条评论；下方可继续加载更早记录。'));
    const paint=()=>{list.replaceChildren();const filtered=(data?.comments??[]).filter(c=>{const status=c.replyStatus??c.status;return filter.value==='all'||(filter.value==='pending'?['new','queued','generating','ready'].includes(status):filter.value===status);}),pagination=pageRows(filtered,commentPage,20);commentPage=pagination.page;pager.replaceChildren();const prev=button('上一页',()=>{commentPage--;paint();},'quiet'),next=button('下一页',()=>{commentPage++;paint();},'quiet');prev.disabled=commentPage===0;next.disabled=commentPage>=pagination.pages-1;pager.append(prev,node('span','','第 '+(commentPage+1)+' / '+pagination.pages+' 页 · 共 '+pagination.total+' 条'),next);for(const c of pagination.rows){const status=c.replyStatus??c.status;
      const row=node('article','moment-comment'),top=node('div','moment-comment-head');top.append(node('strong','',c.author||'访客'),node('span','',labels[status]??status));row.append(top,node('p','moment-comment-text',c.content),node('p','moment-comment-post','原帖：'+String(c.postText??'').slice(0,100)));
      if(c.replyText)row.append(node('p','moment-comment-reply','小鱼：'+c.replyText));if(c.replyError)row.append(node('small','',c.replyError));
      const acts=actions();
      if((!c.replyStatus||c.replyStatus==='failed')&&c.identityVerified&&c.direction!=='self'){acts.append(button('生成建议',async()=>{const result=await api('wechat/moments/comments/reply-preview',{commentId:c.id});viewText('未发送的建议回复',result.text);await refresh();},'quiet'));
        const send=button(transport.canValidate?'核验此回复通道':'审核并回复',()=>edit('确认回复这条评论',[{name:'text',label:'公开回复正文（最多80字）',type:'textarea',rows:3,max:80,required:true}],async v=>{const result=await api(transport.canValidate?'wechat/moments/comments/validate':'wechat/moments/comments/reply',{commentId:c.id,text:v.text,confirm:true});await refresh();notice(result.status==='delivered'?'已核验送达':'结果未知，只能查询原回执');},'将回复此本人动态下的指定评论：'+c.content,'确认发送回复'),'quiet');send.disabled=!transport.ready&&!transport.canValidate;acts.append(send);
      }
      if(status==='unknown')acts.append(button('只查原回执',async()=>{const result=await api('wechat/moments/comments/reconcile',{commentId:c.id});await refresh();notice(result.status==='delivered'?'已核验送达':'仍未确认，不会重发');},'quiet'));
      if(c.receipt)acts.append(button('查看回执',()=>viewText('评论回执',c.receipt),'quiet'));row.append(acts);list.append(row);
    }if(!list.childElementCount)list.append(node('p','moment-review-empty','该筛选下暂无评论。'));};filter.onchange=()=>{commentPage=0;commentFilter=filter.value;paint();};paint();return section;
  }
  function render(data,connection){
    currentData=data;currentConnection=connection;
    const account=data.account??'';
    const caps=data.capabilities??{};
    const ready=connection?.config?.foregroundCompatibility===true;
    const canPublish=ready&&caps.text==='ui-automation';
    page.replaceChildren();
    page.append(node('h1','','微信朋友圈'),node('p','footnote','写文字、从图库或本机加图片，先在本机预览；不暂停微信收发也能发布，真实发布前手动确认。'));
    page.append(node('p','moment-workflow-summary','待审核 '+(data.drafts??[]).filter(d=>d.status==='draft').length+' · 明确未提交 '+(data.publishJobs??[]).filter(j=>j.status==='not-submitted').length+' · 待核验 '+(data.publishJobs??[]).filter(j=>j.status==='unknown').length));
    const panels=momentSections(page,activeSection,id=>{activeSection=id;});
    panels.compose.append(buildCompose(data,connection,canPublish),buildReview(data));
    const plan=data.plan??{},planCard=node('article','moment-plan');
    const planHead=node('div','moment-plan-head');planHead.append(node('div','', ''),node('span','moment-badge '+(plan.enabled?'ready':'idle'),plan.enabled?'已开启':'未开启'));
    planHead.firstChild.append(node('h3','','每日随机朋友圈'),node('p','',plan.enabled?'每天 '+String(plan.startHour).padStart(2,'0')+':00–'+String(plan.endHour).padStart(2,'0')+':00 随机一条 · '+(plan.visibility==='public'?'公开':'私密'):'每天在设定的时间窗口里随机发一条，默认关闭。'));
    planCard.append(planHead);
    planCard.append(node('p','footnote','到点直接发布，不暂停微信收发；会按设置从朋友圈图库自动配图，微信窗口会短暂切到前台。'));
    if(plan.enabled&&plan.nextAt)planCard.append(node('p','footnote','下一次：'+new Date(plan.nextAt).toLocaleString()));
    if(plan.lastStatus==='published'&&plan.lastAt)planCard.append(node('p','footnote','上次发布：'+new Date(plan.lastAt).toLocaleString()));
    if(plan.lastStatus==='failed')planCard.append(node('p','footnote','上次失败：'+(plan.lastError??'未知原因')+'；计划会自动重试或顺延'));
    planCard.append(button('设置每日随机朋友圈',()=>openPlan(plan),'secondary'));panels.records.append(planCard);
    if(lastResult&&lastResult.account===account&&lastResult.mode){/* result is already shown inside composer */ }
    const other=node('details','moment-other');other.append(node('summary','','其他方式'));
    const otherActions=actions();otherActions.append(button('新建本地文字草稿',openLocalDraft,'quiet'),button('按人格写朋友圈',openGenerate,'quiet'));other.append(otherActions);panels.compose.append(other);
    panels.comments.append(buildComments(data.comments));
    if(data.publishJobs?.length){const jobs=node('article','moment-comments');jobs.append(node('h2','','发布任务'));for(const j of data.publishJobs){let r={};try{r=JSON.parse(j.result??'{}');}catch{}const row=node('div','moment-comment');row.append(node('strong','',({published:'已核验发布',unknown:'结果未知 · 禁止重发','not-submitted':'明确未提交',preparing:'准备中',submitting:'提交中'})[j.status]??j.status),node('small','','任务 '+j.id+' · '+reviewTime(j.created)));if(r.error||r.notice)row.append(node('p','',r.error??r.notice));if(j.status==='unknown')row.append(button('只核对原发布结果',async()=>{const result=await api('wechat/moments/publication/reconcile',{id:j.id});notice(result.status==='published'?'已核验发布':'仍未确认，不会重发');await refresh();},'quiet'));jobs.append(row);}panels.records.append(jobs);}
    if(data.reviews?.length){const audits=card('审核记录','保存和预览不代表发布；以关联任务的真实回执为准。');const list=node('div','moment-review-list');for(const r of data.reviews){const row=node('article','moment-comment');row.append(node('strong','',({canceled:'已返回编辑 · 未发布',expired:'已过期 · 请重新审核',ready:'待确认',invalidated:'内容修改 · 旧审核失效',submitting:'提交中',published:'已核验发布',unknown:'待核验 · 禁止重发','not-submitted':'明确未提交'})[r.status]??r.status),node('small','',reviewTime(r.created)+' · 草稿 '+r.draftId+(r.jobId?' · 任务 '+r.jobId:'')));list.append(row);}audits.append(list);panels.records.append(audits);}
    panels.records.append(buildReview(data));
  }
}
