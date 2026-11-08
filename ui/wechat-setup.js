import {animateSubview} from './page-navigation.js';
// Connection and capability state comes from the current WeChat runtime.
export async function renderWeChatSetup({container,api,node,button,edit,notice,refresh,showChats}){
  const w=await api('wechat');
  const native=w.config.mode==='hook'&&w.config.nativeAdapter==='xiaoyu-1';
  const section=(title,text)=>{const p=node('article','cognition-panel');p.append(node('h2','',title));if(text)p.append(node('p','',text));container.append(p);return p;};
  const client=section('当前系统微信','直接适配本机微信。检测、读取、账号核验和发送分别显示结果。');
  client.append(node('p','',w.config.executable),button('检测系统微信',async()=>{
    const result=await api('wechat/detect',{});
    if(!result.clients.length)throw Error('未检测到微信，请先正常启动系统微信');
    edit('选择当前系统微信',[{name:'executable',label:'检测到的客户端',type:'select',value:'',required:true,options:[['','请选择客户端'],...result.clients.map(c=>[c.executable,(c.version??'未知版本')+' · '+(c.signatureValid?'签名有效':'未核验')+' · '+c.executable])]}],async v=>{await api('wechat/use-system',v);await refresh();},'保存前备份原微信连接配置。不会切换QQ，不会退出或降级微信。');
  }),button('检查读取与版本',async()=>{await api('wechat/diagnose',{});await refresh();},'quiet'),button('只检查前台控件',async()=>{await api('wechat/foreground-probe',{});await refresh();},'quiet'));
  for(const stage of w.diagnostics?.stages??[]){client.append(node('p','footnote',`${stage.id} · ${stage.state}：${stage.message}`));}
  const account=section('本人账号与读取','必须使用当前本人账号的数据目录；历史目录存在不代表已登录。读取密钥只在本机保存。');
  account.append(node('p','',w.backend?.message??'尚未连接读取账号'),button('检查读取运行环境',async()=>{await api('wechat/environment',{});await refresh();},'quiet'),button('发现本机数据目录',async()=>{
    const r=await api('wechat/accounts',{});if(!r.accounts.length)throw Error('未发现微信数据目录，请先登录并等待同步');
    edit('选择本人账号的数据目录',[{name:'selected',label:'请与微信设置中的当前数据目录核对',type:'select',value:'',options:[['','请先核对当前账号目录'],...r.accounts.map((a,i)=>[String(i),a.myWxid+' · '+a.dbPath])],required:true},{name:'autoKey',label:'尝试获取读取密钥，可能需要重新登录微信',type:'checkbox',value:false},{name:'confirmCurrentVersionCapture',label:'已了解：当前版本的密钥获取兼容性待验证，允许本机尝试（不会启用自动回复）',type:'checkbox',value:false}],async v=>{const selected=v.selected===''?null:r.accounts[Number(v.selected)];if(!selected)throw Error('请选择当前本人账号');await api('wechat/reader-connect',{...selected,autoKey:v.autoKey,confirmCurrentVersionCapture:v.confirmCurrentVersionCapture});await api('wechat/diagnose',{});await refresh();},'不确定时请取消，在微信设置中打开当前账号的数据位置核对。密钥组件来自已校验的WeChatGirl运行包；未选择尝试时不会加载。');
  }));
  const run=section('发送与运行','前台发送和原生发送分别核验。所有必需检查通过后才能开启自动回复；微信与QQ的授权和记忆独立。');
  run.append(node('p','',w.config.mode==='hook'&&w.config.nativeAdapter==='xiaoyu-1'?'当前为小鱼原生发送；收信使用独立读取器，发送不切换微信窗口。图片与GIF能力见下方核验状态。':'可选择已验证的4.2.0.13原生发送，前台方式保留备用。'),button('启用小鱼原生发送',async()=>{await api('wechat/stop',{});await api('wechat/save',{mode:'hook',nativeAdapter:'xiaoyu-1'});await api('wechat/start',{});await refresh();},'quiet'));
  run.append(button('前台控件兼容适配',()=>edit('按需启用微信控件',[{name:'foregroundCompatibility',label:'启用4.2.0.13按需适配（默认关闭）',type:'checkbox',value:w.config.foregroundCompatibility===true}],async v=>{await api('wechat/save',v);await refresh();},'开启后，每次需要操作微信时会在精确版本核验后临时修改一个进程内数据标志，最多30秒并恢复原值。可能导致微信异常；恢复未确认时停止。不会修改客户端文件或注册表。此开关不授权任何聊天。')));
  run.append(button('发送到文件传输助手自测',()=>edit('确认一次自测发送',[{name:'confirm',label:'向当前微信的“文件传输助手”发送：小鱼微信4.2.0.13联调测试',type:'checkbox',value:false}],async v=>{if(!v.confirm)throw Error('请先确认这一次发送');const r=await api('wechat/test-self',v);notice('已核对微信投递回执 '+r.receipts.map(x=>x.message_id).join('、'));await refresh();},'只发送这条固定文字，不授权其他联系人，不开启自动回复。结果未知时不会自动重发。'),'quiet'));
  run.append(node('p','',w.connected?'微信收发已连接':'微信收发未就绪'),button('核验并启动',async()=>{await api('wechat/start',{});await refresh();},'primary'),button('停止微信接入',async()=>{await api('wechat/stop',{});await refresh();},'quiet'));
  const matrix=node('dl','wechat-capabilities');matrix.setAttribute('aria-label','当前微信通道能力');
  for(const [label,value]of [['文字发送',w.capabilities?.text?(native?'原生通道 · 无需切换窗口':'前台通道'):'等待连接核验'],['图片理解','需在聊天中开启，并选择支持图片的模型'],['语音识别','本地识别 · 需单独开启语音输入'],['群聊触发','真实 @ 与唤醒词并行；仍需授权该群'],['图片 / GIF / 文件 / 视频',[['images','图片'],['stickers','GIF'],['files','文件'],['videos','视频']].filter(([key])=>w.capabilities?.[key]).map(([,label])=>label).join('、')||'待完成原生媒体投递验收'],['插件链',w.capabilities?.plugins?'独立微信通道已连接 · 逐聊天授权':'等待微信插件通道连接'],['发送语音','暂不启用 · 保留接口'],['记忆边界','微信独立保存，与QQ不互通']]){matrix.append(node('dt','',label),node('dd','',value));}run.append(matrix);
  if(w.error)run.append(node('p','',w.error));
  const advanced=node('details');advanced.append(node('summary','','高级连接与读取组件'));container.append(advanced);
  advanced.append(button('选择独立读取Python',()=>edit('选择正常解压的读取运行环境',[{name:'python',label:'官方运行包内 app/resources/runtime/python/python.exe 的完整路径',required:true}],async v=>{await api('wechat/reader-runtime',v);await refresh();},'只核对已校验官方包的相同Python文件和进程完整性，不修改Windows安全权限。保留整个python目录及其依赖，不要单独复制EXE。')));
  advanced.append(button('本机连接设置',()=>edit('微信连接',[{name:'executable',label:'系统微信程序',value:w.config.executable},{name:'account',label:'已核验的本人wxid（首次留空）',value:w.config.account},{name:'mode',label:'发送方式',type:'select',options:[['foreground','前台发送'],['hook','原生发送（需精确版本适配）']],value:w.config.mode},{name:'nativeAdapter',label:'原生组件',type:'select',options:[['xiaoyu-1','小鱼原生文字 · 已验证的4.2.0.13构建'],['legacy','参考项目旧版组件 · 4.1.10.27']],value:w.config.nativeAdapter??'legacy'},{name:'readerUrl',label:'本机读取服务地址',value:w.config.readerUrl},{name:'readerToken',label:'读取令牌（留空保留）',type:'password'},{name:'hookUrl',label:'本机原生服务地址',value:w.config.hookUrl},{name:'hookToken',label:'原生令牌（留空保留）',type:'password'}],async v=>{if(!v.readerToken)delete v.readerToken;if(!v.hookToken)delete v.hookToken;await api('wechat/save',v);await refresh();})),button('准备读取依赖',async()=>{await api('wechat/prepare',{});notice('开始准备参考运行组件，保持当前系统微信不变');await refresh();}),button('采用已有读取依赖',async()=>{await api('wechat/use-prepared',{});await refresh();},'quiet'),button('取消下载',async()=>{await api('wechat/cancel-prepare',{});await refresh();},'quiet'));
  advanced.append(node('p','footnote',`读取组件：${w.components?.state??'idle'}。参考包包含旧版客户端，但当前接入流程不启动旧客户端。`));
  arrangeWeChatSteps({container,w,client,account,run,advanced,node,button,showChats,native});

}

function arrangeWeChatSteps({container,w,client,account,run,advanced,node,button,showChats,native}){
  for(const e of [...container.children])if(e.tagName==='H1'||e.classList.contains('actions'))e.remove();
  const heading=node('div','wechat-heading'),title=node('div');title.append(node('h1','','微信接入'),node('p','','沿用当前微信，分别核验读取、发送与聊天授权。'));heading.append(title,node('span','badge'+(w.connected?' online':''),w.connected?'收发已连接':'尚未就绪'));container.prepend(heading);
  const auth=node('article','cognition-panel');auth.append(node('h2','','只回复你选定的聊天'),node('p','','微信联系人独立授权，不继承 QQ 的好友、群聊或记忆。新聊天默认关闭。'),button('管理微信联系人',()=>showChats?.(),'primary'),node('p','footnote','先给一位好友开启回复，通过后再逐个启用。群触发与媒体能力需要分别验证。'));
  const operating=node('article','cognition-panel');operating.append(node('h2','','独立运行，各聊各的'),node('p','','微信启动不会停止 QQ；停止微信保留当前平台的配置和记忆。'));
  const start=Array.from(run.querySelectorAll('button')).find(b=>b.textContent==='核验并启动'),stop=Array.from(run.querySelectorAll('button')).find(b=>b.textContent==='停止微信接入');if(start){start.disabled=w.running;operating.append(start);}if(stop){stop.disabled=!w.running;operating.append(stop);}operating.append(node('p','footnote',w.error|| (w.connected?`当前读取、实时身份和${native?'原生发送':'前台控件'}已连接；每条消息另行核对目标及投递回执。`:'先完成读取与发送检查，再开始处理已授权的新消息。')));
  const labels=['检测微信','账号与读取','验证发送','授权聊天','开始运行'],pages=[client,account,run,auth,operating],stepper=node('nav','wechat-stepper');stepper.setAttribute('aria-label','微信配置步骤');
  const layout=node('div','wechat-step-layout'),body=node('div'),help=node('article','cognition-panel wechat-help');help.append(node('h2','','当前一步，需要什么？'));const copy=node('p'),next=button('下一步 →',()=>select(Math.min(4,active+1)),'secondary');help.append(copy,next);pages.forEach(p=>body.append(p));layout.append(body,help);container.insertBefore(stepper,advanced);container.insertBefore(layout,advanced);advanced.classList.add('wechat-advanced');
  let active=Number(sessionStorage.getItem('xyWechatStep')??(w.connected?4:w.config.account?2:0));if(!Number.isInteger(active)||active<0||active>4)active=0;
  const descriptions=['保持当前系统微信正常登录。检测版本、架构与腾讯签名，不启动旧版客户端。','核对本人数据目录。实时登录账号与读取目录一致，才允许处理聊天。',native?'原生发送不切换窗口。精确核验版本、账号、目标和独立投递回执；媒体能力逐项验收后开放。':'前台模式会短暂切换微信窗口。有未发送草稿、同名目标或焦点变化时停止发送；提交与投递分别记录。','这里的授权只作用于微信。查看 QQ 和微信的数据平台切换，不会停止另一平台。','开始后只处理新的已授权消息。不补答旧消息；投递未知时不会自动重发。'];
  const buttons=labels.map((label,i)=>{const b=button('',()=>select(i),'quiet');b.append(node('strong','',String(i+1).padStart(2,'0')),node('span','',label));stepper.append(b);return b;});
  function select(i){active=i;sessionStorage.setItem('xyWechatStep',String(i));pages.forEach((p,n)=>p.hidden=n!==i);buttons.forEach((b,n)=>{b.classList.toggle('selected',n===i);b.setAttribute('aria-current',n===i?'step':'false');});copy.textContent=descriptions[i];next.hidden=i===4;animateSubview(pages[i]);}select(active);
}
