import {snapshotUi} from './ui-assets.js';
import {replayVoiceTrial} from './voice-replay-trial.js';
import {wechatVoiceTrial} from './wechat-voice-trial.js';
import {memoryStarMap} from './memory-star-map.js';
import {SocialActions} from './social-actions.js';
import {WeChatManager} from './wechat-runtime.js';
import {DesktopSense} from './desktop-sense.js';
import {detectDsh,importDsh,openDsh} from './dsh-install.js';
import {engineDashboard} from './engine-dashboard.js';
import {Appearance} from './appearance.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {root,loadConfig} from './config.js';
import {Runtime,writeConfig} from './runtime.js';
import {findCodex} from './local.js';
import {MOODS} from './meme-search.js';
import {MAX_ZIP} from './meme-zip.js';
if(!fs.existsSync(path.join(root,'config.json')))await import('./setup.js');
export function saveSettings(body,runtime){
  if(runtime.running||runtime.busy||runtime.maintenance?.size)throw new Error('请停止服务并等待当前操作结束后再保存');
  const allowed=['codexPath','model','port','allowedUsers','allowedGroups','wakeWords','followupSeconds','historyMessages','memoryChars','timeoutSeconds','defaults'];
  const c=runtime.configuration?runtime.configuration():JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  for(const key of allowed)if(Object.hasOwn(body.config??{},key))c[key]=body.config[key];
  if(body.persona!==undefined&&(typeof body.persona!=='string'||!body.persona.trim()||body.persona.length>12000))throw new Error('角色设定应为 1—12000 字');
  (runtime.writeConfiguration??writeConfig)(c);
  if(body.persona!==undefined){if(runtime.platform!=='wechat')fs.writeFileSync(path.join(root,'persona.md'),body.persona);if(runtime.store)runtime.store.savePersona({...runtime.store.persona('default'),text:body.persona});}
  if(runtime.platform!=='wechat')runtime.codex?.stop();runtime.codex=null;runtime.account='待重新连接';runtime.log('全局配置已保存。');
}
export async function startGui({open=true,autoConnect=true,port=0,runtime:providedRuntime}={}){
  const appearance=new Appearance(path.join(root,'data'));
  const runtime=providedRuntime??new Runtime(),token=crypto.randomBytes(32).toString('hex');let origin,lastSeen=Date.now(),closing=false;
  const files={'/':'index.html','/app.js':'app.js','/engine-dashboard.js':'engine-dashboard.js','/engine-dashboard.css':'engine-dashboard.css','/platforms-ui.js':'platforms-ui.js','/wechat-setup.js':'wechat-setup.js','/shell-ui.js':'shell-ui.js','/layout.js':'layout.js','/layout.css':'layout.css','/page-navigation.js':'page-navigation.js','/shell.css':'shell.css','/integrations.js':'integrations.js','/services.js':'services.js','/dependencies.js':'dependencies.js','/voice.js':'voice.js','/speech.js':'speech.js','/plugin-mode.js':'plugin-mode.js','/memes.js':'memes.js','/meme-learning-ui.js':'meme-learning-ui.js','/web.js':'web.js','/memory.js':'memory.js','/shared-memory.js':'shared-memory.js','/style.css':'style.css','/workbench.css':'workbench.css','/theme.js':'theme.js','/select-controls.js':'select-controls.js','/controls.css':'controls.css','/glass.css':'glass.css','/appearance-ui.js':'appearance-ui.js','/cognition-ui.js':'cognition-ui.js','/gsap.min.js':'gsap.min.js','/logo.svg':'logo.svg','/icons.svg':'icons.svg'};
  files['/wechat-chat-controls.js']='wechat-chat-controls.js';
  for(const file of ['liquid.css','workspace-copy.js','workspace-motion.js'])files['/'+file]=file;
  for(const file of ['memory-star-map.js','memory-star-map.css','star-map-canvas.js'])files['/'+file]=file;
  for(const file of ['breeze-voice-ui.js','breeze-voice.css'])files['/'+file]=file;
  runtime.wechat??=new WeChatManager(runtime);const hostRuntime=runtime;
  files['/proactive-ui.js']='proactive-ui.js';files['/scheduled-ui.js']='scheduled-ui.js';
  files['/publishing-ui.js']='publishing-ui.js';
  files['/moments-ui.js']='moments-ui.js';files['/life-ui.js']='life-ui.js';
  files['/video-browse-ui.js']='video-browse-ui.js';files['/dialogue-ui.js']='dialogue-ui.js';files['/companion-ui.js']='companion-ui.js';files['/self-model-ui.js']='self-model-ui.js';files['/companion.css']='companion.css';
  const uiSnapshot=snapshotUi(files,path.join(root,'ui'));
  runtime.desktopSense??=new DesktopSense({directory:runtime.dataDir,onEvent:e=>{for(const r of [hostRuntime,hostRuntime.wechat?.child])if(r&&(!e.platform||e.platform===r.platform)&&(!['qq','wechat'].includes(e.service)||e.service===r.platform))r.life.emit({kind:{recovered:'connected',disconnected:'disconnected',failed:'failed','process-started':'connected','process-stopped':'disconnected'}[e.kind],service:e.service,key:e.service+':'+e.kind+':'+e.at,reason:'本机程序观测事件'});},getServices:()=>({
    xiaoyu:{connected:!runtime.closing,busy:!!runtime.bridge?.total||!!runtime.wechat?.child?.bridge?.total,source:'小鱼运行时'},
    codex:{connected:!!runtime.codex&&!runtime.codex.closed,busy:!!runtime.codex?.jobs?.size,source:'Codex本机连接'},
    dsh:{connected:!runtime.engines.dsh.closed,busy:!!runtime.engines.dsh.health?.activeJobs,source:'DSH桥接健康检查'},
    qq:{connected:!!runtime.accountId&&!!runtime.onebot?.connected,source:'QQ协议与账号核验'},
    wechat:{connected:!!runtime.wechat?.child?.accountId&&!!runtime.wechat?.child?.onebot?.connected,source:'微信读取与账号核验'},
    plugins:{connected:!!runtime.plugins?.state().connected,source:'AstrBot QQ网关；微信网关单独检查'}
  })});runtime.desktopSense.start();
  const server=http.createServer(async(req,res)=>{
    let runtime=hostRuntime;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const json=(status,data)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    if(req.headers.host!==new URL(origin).host){json(403,{error:'来源不允许'});return;}
    const url=new URL(req.url,origin),route=url.pathname;
    if(route.startsWith('/api/')){
      const supplied=Buffer.from(req.headers['x-session-token']??''),expected=Buffer.from(token);
      if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'窗口验证失败，请重新打开窗口'});return;}
      lastSeen=Date.now();
      try{
        if(req.headers['x-platform']&&!['qq','wechat'].includes(req.headers['x-platform']))throw Error('平台无效');
        if(req.headers['x-platform']==='wechat'&&/^\/api\/(?:services|integrations)(?:\/|$)/.test(route)&&route!=='/api/integrations/repair')throw Error('请切回QQ数据管理QQ协议和AstrBot；微信使用独立接入页');
        if(req.headers['x-platform']==='wechat'&&route!=='/api/connections'&&!route.startsWith('/api/wechat')&&!route.startsWith('/api/engines')&&!route.startsWith('/api/appearance'))runtime=hostRuntime.wechat.context();
        if(req.method==='GET'){
          if(route==='/api/life'){json(200,runtime.life.dashboard());return;}
          if(route==='/api/life/emotion-history'){const scope=url.searchParams.get('scope'),personaId=url.searchParams.get('personaId');runtime.assertScope(scope);json(200,runtime.store.emotion.history(scope,personaId));return;}
          if(route==='/api/self-model/accounts'){json(200,runtime.accounts.rows());return;}
          if(route==='/api/self-model'){const r=runtime.selfRequest(Object.fromEntries(url.searchParams));json(200,runtime.selfModel.dashboard(r));return;}
          if(route==='/api/meme-learning'){json(200,runtime.memeLearning.dashboard());return;}
          if(route==='/api/video'){json(200,runtime.video.dashboard());return;}
          if(route==='/api/video/report'){json(200,runtime.video.report(Object.fromEntries(url.searchParams)));return;}
          if(route==='/api/video/frame'){json(200,runtime.video.frame(Object.fromEntries(url.searchParams)));return;}

          if(route==='/api/wechat/moments'){json(200,await hostRuntime.wechat.context().moments.dashboard());return;}
          if(route==='/api/notebook'){json(200,runtime.notebook.dashboard());return;}
          if(route==='/api/qzone'){json(200,hostRuntime.qzone.dashboard());return;}
          if(route==='/api/qzone/media-view'){json(200,hostRuntime.qzone.mediaView(url.searchParams.get('id')));return;}
          if(route==='/api/qzone/read'){json(200,await hostRuntime.qzone.read(url.searchParams.get('operation')??'status',Object.fromEntries(url.searchParams)));return;}
          if(route==='/api/awareness'){json(200,hostRuntime.desktopSense.state());return;}
          if(route==='/api/emotions'){const scope=url.searchParams.get('scope'),personaId=url.searchParams.get('personaId');if(scope)runtime.assertScope(scope);json(200,{platform:runtime.platform,states:scope&&personaId?[runtime.store.emotion.read(scope,personaId)]:runtime.store.emotion.list(),fixedMemories:runtime.store.fixedMemories(),resetAt:runtime.store.meta('memory-reset-at')??null});return;}
          if(route==='/api/connections'){const q=hostRuntime.state(),w=hostRuntime.wechat.state();const recent=(r,platform)=>r?r.store.db.prepare('SELECT created,data FROM usage ORDER BY id DESC LIMIT 4').all().flatMap(row=>{try{const d=JSON.parse(row.data);return [{platform,created:row.created,status:d.status,engine:d.engine,model:d.model,timing:d.timing??{}}];}catch{return [];}}):[];json(200,{at:Date.now(),qq:{connected:!!q.accountId&&q.integrations?.protocol?.online!==false,running:q.running,integrations:q.integrations},wechat:{connected:w.connected,running:w.running,accountVerified:w.accountVerified,mode:w.config.mode,version:w.diagnostics?.client?.version??null,error:w.error},codex:{connected:q.codex},engines:q.modelEngines,recent:[...recent(hostRuntime,'qq'),...recent(hostRuntime.wechat.child,'wechat')].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,6)});return;}
          if(route==='/api/wechat'){json(200,hostRuntime.wechat.state());return;}
          if(route==='/api/engines'){json(200,{...hostRuntime.engines.state(),codex:{connected:!!hostRuntime.codex&&!hostRuntime.codex.closed,models:hostRuntime.models??[]},detectedDsh:detectDsh(),dashboard:engineDashboard([['qq',hostRuntime],['wechat',hostRuntime.wechat.child]])});return;}
          if(route==='/api/dependencies'){json(200,await runtime.dependencies.scan());return;}
          if(route==='/api/appearance'){json(200,appearance.read());return;}
          if(route==='/api/appearance/background'){const file=appearance.background(url.searchParams.get('name')??undefined);if(!file){json(404,{error:'尚未选择背景'});return;}res.writeHead(200,{...headers,'Content-Type':'image/webp'});res.end(fs.readFileSync(file));return;}
          if(route==='/api/scheduled-tasks'){json(200,runtime.tasks.dashboard());return;}
          if(route==='/api/proactive'){const service=runtime.bridge?.proactive;json(200,service?{running:true,...service.dashboard()}:{running:false,settings:{enabled:false,dailyLimit:6,dndStart:23,dndEnd:8},states:[],jobs:[]});return;}
          if(route==='/api/social'){const io=runtime.onebot,send=runtime.platform==='wechat'?{quote:!!io?.capabilities?.nativeQuote,poke:!!io?.capabilities?.nativePoke,forward:!!io?.capabilities?.nativeForward}:io?.connected?await io.socialCapabilities():{quote:false,poke:false,forward:false};json(200,{platform:runtime.platform,receive:{quote:true,poke:true,forward:true},send,reason:send.reason??(runtime.platform==='wechat'?'当前已验收微信组件仅支持文字、图片、GIF与真实@；新增发送能力须独立验证。':null)});return;}
          if(route==='/api/dialogue'){const scope=url.searchParams.get('scope');runtime.assertScope(scope);json(200,{scope,routes:runtime.store.dialogue.diagnostics(scope)});return;}
          if(route==='/api/continuity'){json(200,runtime.store.continuity.list());return;}
          if(route==='/api/cognition/star-map'){json(200,memoryStarMap(runtime,Object.fromEntries(url.searchParams)));return;}
          if(route==='/api/cognition/note/versions'){const id=url.searchParams.get('id');json(200,runtime.store.db.prepare('SELECT * FROM note_revisions WHERE noteId=? ORDER BY id DESC LIMIT 50').all(id));return;}
          if(route==='/api/cognition'){const scope=url.searchParams.get('scope')??'',personaId=url.searchParams.get('personaId')??'';if(scope)runtime.assertScope(scope);json(200,{...runtime.store.cognition.dashboard({scope,personaId}),fixedMemories:runtime.store.fixedMemories(),continuitySpaces:runtime.store.continuity.list(),learningSettings:runtime.learningQueue.settings(),learningJobs:runtime.store.db.prepare('SELECT * FROM learning_jobs ORDER BY created DESC LIMIT 100').all()});return;}
          if(route==='/api/state'){json(200,runtime.state());return;}
          if(route==='/api/speech'){json(200,runtime.speech.state());return;}
          if(route==='/api/voice'){json(200,{...runtime.voice.state(),transports:{qqOnline:!!hostRuntime.accountId,wechatOnline:!!hostRuntime.wechat.child?.onebot?.connected,wechatVoiceVerified:!!hostRuntime.wechat.child?.onebot?.capabilities?.voice}});return;}
          if(route==='/api/settings'){const c=runtime.configuration?runtime.configuration():JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));c.codexPath=findCodex(c.codexPath);json(200,{config:c,persona:runtime.store.persona('default').text});return;}
          if(route==='/api/catalog'){json(200,{contacts:runtime.contacts(),personas:runtime.store.personas(),models:[...(hostRuntime.models??[]).map(m=>({...m,engine:'codex'})),...(hostRuntime.engines.dshModels??[]).map(m=>({...m,engine:'dsh'}))],assets:runtime.store.assets(),libraries:runtime.store.libraries(),moods:MOODS});return;}
          if(route==='/api/packs/market'){json(200,await runtime.packs.catalog({refresh:url.searchParams.get('refresh')==='1'}));return;}
          if(route==='/api/packs/detect'){json(200,runtime.packs.detect());return;}
          if(route==='/api/packs/export'){const bytes=await runtime.packs.exportZip(url.searchParams.get('id'),{version:url.searchParams.get('version')||undefined});res.writeHead(200,{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="meme-pack.zip"'});res.end(bytes);return;}
          if(route==='/api/conversation'){json(200,runtime.conversation(url.searchParams.get('scope')));return;}
          if(route==='/api/history'){const scope=url.searchParams.get('scope');runtime.assertScope(scope);const before=Number(url.searchParams.get('before'));if(!Number.isSafeInteger(before)||before<1)throw new Error('分页位置无效');json(200,runtime.store.historyPage(scope,before));return;}
          if(route==='/api/memory/versions'){json(200,runtime.store.living.versions(Number(url.searchParams.get('id'))));return;}
          if(route==='/api/shared/details'){json(200,runtime.sharedDetails(url.searchParams.get('id')));return;}
          if(route==='/api/source'){const source=runtime.store.source(Number(url.searchParams.get('id')));json(200,source??null);return;}
          const asset=/^\/api\/assets\/([-\w]+)$/.exec(route);
          if(asset){const {asset:a,bytes}=runtime.media.read(asset[1]);res.writeHead(200,{...headers,'Content-Type':a.ext==='jpg'?'image/jpeg':`image/${a.ext}`});res.end(bytes);return;}
          json(404,{error:'没有此资源'});return;
        }
        if(req.method!=='POST'){json(405,{error:'不支持的请求'});return;}
        if(route==='/api/appearance/upload'){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('背景最多12MB');chunks.push(chunk);}json(200,await appearance.upload(Buffer.concat(chunks)));return;}
        if(route==='/api/speech/preview'){
          if(!String(req.headers['content-type']??'').startsWith('application/octet-stream'))throw Error('请选择音频文件');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw Error('音频最多10MB');chunks.push(chunk);}json(200,await runtime.speech.preview(Buffer.concat(chunks)));return;
        }
        if(route==='/api/packs/import-zip'){
          if(!String(req.headers['content-type']??'').startsWith('application/zip'))throw new Error('请选择ZIP图包');
          const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_ZIP)throw new Error('ZIP最多200MB');chunks.push(chunk);}const zip=Buffer.concat(chunks),scope=url.searchParams.get('scope')??'';if(scope)runtime.assertScope(scope);
          json(200,runtime.packs.begin('导入ZIP',async(signal,progress)=>runtime.packs.importZip(zip,{name:url.searchParams.get('name')??'',scope,signal,progress})));return;
        }
        let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('请求过大');raw+=chunk;}
        const body=raw?JSON.parse(raw):{};
        if(route.startsWith('/api/life/')){const method={'/api/life/settings':'configure','/api/life/review':'review'}[route];if(!method)throw Error('生活设置接口不存在');json(200,await runtime.life[method](body));return;}
        if(route.startsWith('/api/video/browse/')){const method={'/api/video/browse/start':'start','/api/video/browse/pause':'pause','/api/video/browse/resume':'resume','/api/video/browse/stop':'stop','/api/video/browse/settings':'configure'}[route];if(!method)throw Error('视频任务接口不存在');json(200,await runtime.video.browse[method](body));return;}
        if(route.startsWith('/api/video/')){const method={'/api/video/settings':'configure','/api/video/start':'start','/api/video/open':'open','/api/video/feedback':'feedback','/api/video/share-preview':'previewShare','/api/video/share-confirm':'confirmShare'}[route];if(route==='/api/video/cancel'){json(200,runtime.video.cancel());return;}if(!method)throw Error('视频接口不存在');json(200,await runtime.video[method](body));return;}

        if(route.startsWith('/api/wechat/moments/')){const service=hostRuntime.wechat.context().moments;const method={'/api/wechat/moments/draft':'draft','/api/wechat/moments/generate':'generate','/api/wechat/moments/prepare':'prepare','/api/wechat/moments/preview':'preview','/api/wechat/moments/confirm':'confirm','/api/wechat/moments/reconcile':'reconcile'}[route];if(!method)throw Error('朋友圈操作不存在');json(200,await service[method](['prepare','preview','reconcile'].includes(method)?body.id:body));return;}
        if(route.startsWith('/api/notebook/')){const method={'/api/notebook/write':'write','/api/notebook/settings':'configure','/api/notebook/edit':'edit'}[route];if(!method)throw Error('日记操作不存在');json(200,await runtime.notebook[method](body));return;}
        if(route.startsWith('/api/qzone/')){const q=hostRuntime.qzone;let result;
          if(route==='/api/qzone/bind')result=body.cookies?await q.bind(body.cookies):await q.autoBind();
          else if(route==='/api/qzone/unbind')result=await q.unbind();
          else if(route==='/api/qzone/draft')result=q.draft(body);
          else if(route==='/api/qzone/generate')result=await q.generate(body);
          else if(route==='/api/qzone/preview')result=q.preview(body.id);
          else if(route==='/api/qzone/confirm')result=await q.confirm(body);
          else if(route==='/api/qzone/reject')result=q.reject(body.id);
          else if(route==='/api/qzone/media')result=q.upload(body);
          else throw Error('空间操作不存在');json(200,result);return;}
        if(route==='/api/engines/save'){if(hostRuntime.engines.diagnosticJob||hostRuntime.bridge?.total||hostRuntime.wechat.child?.bridge?.total)throw Error('请等待当前回复或自检完成，再修改模型连接');json(200,hostRuntime.engines.save(body));}
        else if(route==='/api/engines/test'){if(body.engine!=='dsh')throw Error('此自检仅用于DSH');const r=await hostRuntime.engines.diagnostic({engine:'dsh',model:body.model});hostRuntime.store.usage('local:engine-diagnostic',{engine:r.engine,model:r.model,kind:'engine-diagnostic',status:'completed',...r.usage,timing:{totalMs:r.durationMs}});json(200,r);}
        else if(route==='/api/engines/test-cancel')json(200,hostRuntime.engines.cancelDiagnostic());
        else if(route==='/api/engines/connect')json(200,await hostRuntime.engines.connectDsh());
        else if(route==='/api/engines/import')json(200,await importDsh(hostRuntime.engines,root));
        else if(route==='/api/engines/open')json(200,openDsh(hostRuntime.engines));
        else if(route==='/api/engines/quota'){if(body.engine&&!['codex','dsh'].includes(body.engine))throw Error('引擎无效');json(200,await hostRuntime.engines.refreshQuotas(body.engine,true));}
        else if(route==='/api/engines/quota-settings')json(200,hostRuntime.engines.quota.save(body));
        else if(route==='/api/wechat/test-self')json(200,await hostRuntime.wechat.testSelf(body));
        else if(route==='/api/wechat/reader-runtime')json(200,await hostRuntime.wechat.backend.selectRuntime(body));
        else if(route==='/api/wechat/environment'){json(200,await hostRuntime.wechat.backend.environment());}
        else if(route==='/api/wechat/foreground-probe')json(200,await hostRuntime.wechat.probeForeground());
        else if(route==='/api/wechat/detect')json(200,await hostRuntime.wechat.detect());
        else if(route==='/api/wechat/use-system')json(200,await hostRuntime.wechat.useSystem(body));
        else if(route==='/api/wechat/diagnose')json(200,await hostRuntime.wechat.diagnose());
        else if(route==='/api/wechat/use-prepared')json(200,await hostRuntime.wechat.usePrepared());
        else if(route==='/api/awareness/save')json(200,hostRuntime.desktopSense.configure(body));
        else if(route==='/api/social/prepare'){runtime.socialActions??=new SocialActions(runtime);json(200,await runtime.socialActions.prepare(body));}
        else if(route==='/api/social/send'){runtime.socialActions??=new SocialActions(runtime);json(200,await runtime.socialActions.send(body));}
        else if(route==='/api/scheduled-tasks/settings')json(200,runtime.tasks.configure(body));
        else if(route==='/api/scheduled-tasks/chat'){runtime.assertScope(body.scope);json(200,runtime.saveChat(body.scope,{scheduledTasks:body.policy}));}
        else if(route==='/api/scheduled-tasks/create'){runtime.assertScope(body.scope);if(body.confirm!==true||!runtime.bridge)throw Error('请确认本次任务且先启动平台接入');const creator=String(body.creator??runtime.tasks.dashboard().owner),r={scope:body.scope,user:creator,creatorName:'本机确认',sourceKey:'local:'+(typeof body.requestId==='string'&&/^[a-f0-9-]{36}$/.test(body.requestId)?body.requestId:crypto.randomUUID()),speaker:JSON.stringify({id:creator,name:'本机确认'}),text:String(body.request??'')};if(!r.text||r.text.length>1000)throw Error('任务描述需1—1000字');const existing=runtime.tasks.bySource(r.sourceKey);if(existing){runtime.tasks.assertAllowed(existing.scope,existing.creator);if(existing.scope!==r.scope||existing.creator!==r.user)throw Error('任务请求标识冲突');json(200,existing);return;}const draft=await runtime.tasks.prepare(r);if(draft.clarify)throw Error(draft.clarify);json(200,runtime.tasks.create(r,draft,{confirmRepeat:body.confirmRepeat===true}));}
        else if(route==='/api/scheduled-tasks/cancel'){const job=runtime.tasks.get(body.id);if(!job)throw Error('任务不存在');runtime.assertScope(job.scope);json(200,runtime.tasks.cancel(body.id));}
        else if(route==='/api/scheduled-tasks/confirm'){const job=runtime.tasks.get(body.id);if(!job)throw Error('任务不存在');runtime.assertScope(job.scope);json(200,runtime.tasks.confirm(body.id,job.creator));}
        else if(route==='/api/scheduled-tasks/resume'){const job=runtime.tasks.get(body.id);if(!job)throw Error('任务不存在');runtime.assertScope(job.scope);json(200,runtime.tasks.resume(body.id));}
        else if(route==='/api/scheduled-tasks/pause'){runtime.assertScope(body.scope);if(typeof body.paused!=='boolean')throw Error('暂停值无效');runtime.tasks.pause(body.scope,body.paused);json(200,{ok:true});}
        else if(route==='/api/proactive/save'){if(!runtime.bridge?.proactive)throw Error('请先启动当前平台接入');json(200,runtime.bridge.proactive.configure(body));}
        else if(route==='/api/proactive/candidate'){runtime.assertScope(body.scope);if(body.confirm!==true||!runtime.bridge?.proactive)throw Error('请确认本次本机预览会消耗模型额度');json(200,await runtime.bridge.proactive.previewCandidate(body.scope));}
        else if(route==='/api/proactive/test'){runtime.assertScope(body.scope);if(body.confirm!==true||!runtime.bridge?.proactive)throw Error('请确认向这个聊天测试一次主动回复');json(200,await runtime.bridge.proactive.testOnce(body.scope,{message:body.message}));}
        else if(route==='/api/proactive/preview'){runtime.assertScope(body.scope);if(!runtime.bridge?.proactive)throw Error('请先启动当前平台接入');json(200,runtime.bridge.proactive.preview(body.scope));}
        else if(route==='/api/emotions/save'){runtime.assertScope(body.scope);if(!runtime.store.persona(body.personaId))throw Error('人格不存在');json(200,runtime.store.emotion.configure(body));}
        else if(route==='/api/wechat/original-setup')json(200,hostRuntime.wechat.backend.openOriginalSetup());
        else if(route==='/api/wechat/open')json(200,await hostRuntime.wechat.backend.openClient());
        else if(route==='/api/wechat/accounts')json(200,await hostRuntime.wechat.backend.discover());
        else if(route==='/api/wechat/reader-connect')json(200,await hostRuntime.wechat.backend.connect(body));
        else if(route==='/api/wechat/prepare')json(200,hostRuntime.wechat.components.begin());
        else if(route==='/api/wechat/cancel-prepare')json(200,hostRuntime.wechat.components.cancel());
        else if(route==='/api/wechat/save')json(200,await hostRuntime.wechat.save(body));
        else if(route==='/api/wechat/probe')json(200,await hostRuntime.wechat.probe());
        else if(route==='/api/wechat/voice-replay-trial')json(200,await replayVoiceTrial(hostRuntime.wechat.context(),body));
        else if(route==='/api/wechat/voice-trial')json(200,await wechatVoiceTrial(hostRuntime.wechat,body));
        else if(route==='/api/wechat/start')json(200,await hostRuntime.wechat.start());
        else if(route==='/api/wechat/stop')json(200,await hostRuntime.wechat.stop());
        else if(route==='/api/continuity/test-reply'){json(200,await runtime.continuityTestReply(body));}
        else if(route==='/api/continuity/save'){json(200,runtime.store.continuity.save(body,runtime.configPolicy));}
        else if(route==='/api/continuity/disable'){json(200,runtime.store.continuity.disable(body.id));}
        else if(route==='/api/appearance'){json(200,appearance.save(body));}
        else if(route.startsWith('/api/cognition/')){if(body.scope)runtime.assertScope(body.scope);const c=runtime.store.cognition;const op=route.slice('/api/cognition/'.length);if(op==='learning/settings')json(200,runtime.learningQueue.save(body));else if(op==='learning/run')json(200,await runtime.learningQueue.run(body));else if(op==='learning/cancel'){runtime.learningQueue.foreground();json(200,{ok:true});}else if(op==='backup'){const dir=path.join(runtime.dataDir??path.join(root,'data'),'backups');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,(runtime.platform??'qq')+'-cognition-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.sqlite');c.db.prepare('VACUUM INTO ?').run(file);c.audit('backup.create',path.basename(file));json(200,{file});}else if(op==='note/save')json(200,c.saveNote(body));else if(op==='note/archive')json(200,c.archiveNote(body.id,body.restore===true));else if(op==='note/delete')json(200,c.deleteNote(body.id));else if(op==='propose')json(200,c.propose(body));else if(op==='review')json(200,c.review(body));else if(op==='restore'){const row=c.db.prepare('SELECT data FROM persona_versions WHERE id=?').get(Number(body.id));if(!row)throw Error('人格版本不存在');json(200,runtime.savePersona(JSON.parse(row.data)));}else if(op==='draft'){const p=runtime.store.persona(body.personaId);if(!p||typeof body.text!=='string'||body.text.length>12000||!body.text.trim())throw Error('草稿无效');const id=crypto.randomUUID();c.db.prepare('INSERT INTO persona_drafts(id,personaId,name,text) VALUES(?,?,?,?)').run(id,p.id,p.name,body.text);json(200,{id});}else throw Error('操作不存在');}
        else if(route==='/api/settings'){saveSettings(body,runtime);json(200,{ok:true});}
        else if(route==='/api/speech/save'){runtime.bridge?.cancelSpeech();const result=runtime.speech.save(body);json(200,result);}
        else if(route==='/api/self-model/accounts/save')json(200,runtime.accounts.save(body));
        else if(route==='/api/self-model/accounts/detect')json(200,await runtime.accounts.detect(body));
        else if(route==='/api/speech/probe')json(200,await runtime.speech.probe());
        else if(route==='/api/speech/stop'){runtime.bridge?.cancelSpeech();await runtime.speech.stopWorker();json(200,runtime.speech.state());}
        else if(route==='/api/voice/save'){for(const id of Object.keys(body.bindings??{}))if(!runtime.store.persona(id))throw Error('绑定人格不存在');json(200,runtime.voice.save(body));}
        else if(route==='/api/voice/replay-trial')json(200,await replayVoiceTrial(hostRuntime,body));
        else if(route==='/api/voice/probe')json(200,await runtime.voice.probe());
        else if(route==='/api/voice/quota')json(200,await runtime.voice.quota());
        else if(route==='/api/voice/cancel')json(200,runtime.voice.cancel());
        else if(route==='/api/voice/template')json(200,runtime.voice.importTemplate(body));
        else if(route==='/api/voice/direction'){if(body.scope)runtime.assertScope(body.scope);if(!runtime.store.persona(body.personaId))throw Error('请选择有效人格');const emotion=body.scope?runtime.store.emotion.read(body.scope,body.personaId):body.emotion??{};json(200,{...runtime.voice.direction({personaId:body.personaId,emotion}),emotion});}
        else if(route==='/api/voice/preview'){if(typeof body.text!=='string'||body.text.length>500||body.confirmCost!==true||!runtime.store.persona(body.personaId))throw new Error('请选定人格并确认本次试听消耗Breeze额度');if(body.scope)runtime.assertScope(body.scope);const emotion=body.scope?runtime.store.emotion.read(body.scope,body.personaId):body.emotion??{};const audio=await runtime.voice.synthesize(body.text,{personaId:body.personaId,emotion,scope:'preview:'+runtime.platform+(body.scope?':'+body.scope:'')});json(200,{base64:audio.bytes.toString('base64'),seconds:audio.seconds,synthesisMs:audio.synthesisMs,tone:audio.tone,cached:!!audio.cached});}
        else if(route==='/api/integrations/save')json(200,runtime.integrationSave(body));
        else if(route==='/api/integrations/repair')json(200,await runtime.repairConnections());
        else if(route==='/api/dependencies/install')json(200,runtime.dependencies.install(body));
        else if(route==='/api/dependencies/cancel')json(200,runtime.dependencies.cancel());
        else if(route==='/api/services/detect')json(200,runtime.services.detect());
        else if(route==='/api/services/save'){if(runtime.onebot?.connected&&body.protocol!==runtime.store.meta('protocol-kind'))throw Error('请先停止当前QQ接入，再切换协议端');json(200,runtime.services.save(body));runtime.store.meta('protocol-kind',body.protocol);}
        else if(route==='/api/services/start')json(200,await runtime.boot({force:true}));
        else if(route==='/api/services/stop')json(200,await runtime.stopServices());
        else if(route==='/api/services/panel'){const url=runtime.services.panel();if(!await runtime.services.probe(url))throw Error('协议控制台尚未就绪，请先启动服务');json(200,{url,kind:runtime.services.config().protocol});}
        else if(route==='/api/plugins/start')json(200,await runtime.pluginStart());
        else if(route==='/api/plugins/stop')json(200,await runtime.pluginStop());
        else if(route==='/api/plugins/panel')json(200,await runtime.pluginPanel());
        else if(route==='/api/web/diagnostic')json(200,await runtime.webDiagnostic(body));
        else if(route==='/api/defaults')json(200,runtime.saveDefaults(body));
        else if(route==='/api/connect')json(200,await runtime.connect());
        else if(route==='/api/start')json(200,await(runtime.services.config().enabled?runtime.boot():runtime.start()));
        else if(route==='/api/stop')json(200,await runtime.stop());
        else if(route==='/api/contacts/sync')json(200,await runtime.refreshContacts());
        else if(route==='/api/contacts/manual')json(200,runtime.manualContact(body));
        else if(route==='/api/chat/reply-preference')json(200,runtime.saveReplyPreference(body));
        else if(route==='/api/chat/save')json(200,runtime.saveChat(body.scope,body.policy));
        else if(route==='/api/personas/save')json(200,runtime.savePersona(body));
        else if(route==='/api/personas/delete'){runtime.deletePersona(body.id);json(200,{ok:true});}
        else if(route==='/api/shared/list')json(200,runtime.sharedList(body));
        else if(route==='/api/shared/publish')json(200,runtime.sharedPublish(body));
        else if(route==='/api/shared/action')json(200,runtime.sharedAction(body));
        else if(route==='/api/memory/preview')json(200,runtime.memoryPreview(body));
        else if(route==='/api/memory/resolve')json(200,runtime.memoryResolve(body));
        else if(route==='/api/memory/maintain')json(200,runtime.memoryMaintain());
        else if(route==='/api/memory/save'){runtime.memorySave(body);json(200,{ok:true});}
        else if(route==='/api/memory/add'){runtime.memoryAdd(body);json(200,{ok:true});}
        else if(route==='/api/memory/delete'){runtime.memoryDelete(body.id);json(200,{ok:true});}
        else if(route==='/api/history/reset'){runtime.reset(body.scope);json(200,{ok:true});}
        else if(route==='/api/summary')json(200,await runtime.summarize(body.scope));
        else if(route==='/api/test-reply')json(200,await runtime.testReply());
        else if(route==='/api/self-model/save')json(200,runtime.selfModel.configure(body));
        else if(route==='/api/self-model/reflect')json(200,await runtime.selfModel.reflect(runtime.selfRequest(body)));
        else if(route==='/api/self-model/review')json(200,runtime.selfModel.review(runtime.selfRequest(body),body));
        else if(route==='/api/self-model/reset'){runtime.selfModel.reset(runtime.selfRequest(body));json(200,{ok:true});}
        else if(route==='/api/self-model/cancel'){runtime.selfModel.active?.controller.abort();json(200,{ok:true});}
        else if(route==='/api/meme-learning/save')json(200,runtime.memeLearning.configure(body));
        else if(route==='/api/meme-learning/edit')json(200,runtime.memeLearning.edit(body));
        else if(route==='/api/meme-learning/cancel'){runtime.memeLearning.cancel();json(200,{ok:true});}
        else if(route==='/api/assets/import')json(200,await runtime.media.import(body));
        else if(route==='/api/assets/update')json(200,runtime.media.update(body));
        else if(route==='/api/assets/describe')json(200,await runtime.describeAsset(body));
        else if(route==='/api/assets/send')json(200,await runtime.sendAsset(body));
        else if(route==='/api/assets/delete'){runtime.media.remove(body.id);json(200,{ok:true});}
        else if(route==='/api/libraries/save')json(200,runtime.media.saveLibrary(body));
        else if(route==='/api/packs/install')json(200,runtime.packs.install(body.id));
        else if(route==='/api/packs/cancel'){runtime.packs.cancel(body.id);json(200,{ok:true});}
        else if(route==='/api/packs/directory'){json(200,runtime.packs.begin('扫描本地图库',async(signal,progress)=>runtime.packs.importDirectory(body.path,{name:body.name,scope:body.scope??'',libraryId:body.libraryId,signal,progress})));}
        else if(route==='/api/setup/finish'){const c=runtime.configuration?runtime.configuration():JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));c.setupComplete=true;(runtime.writeConfiguration??writeConfig)(c);json(200,{ok:true});}
        else if(route==='/api/quit'){json(200,{ok:true});setTimeout(()=>close(),100);}
        else json(404,{error:'没有此操作'});
      }catch(e){json(400,{error:e.message.replaceAll(token,'[隐藏]')});}return;
    }
    if(req.method!=='GET'||!files[route]){res.writeHead(404);res.end();return;}
    res.writeHead(200,{...headers,'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':route.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'});res.end(uiSnapshot.get(route));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;const url=`${origin}/#${token}`;
  const close=async()=>{if(closing)return;closing=true;clearInterval(heartbeat);await runtime.close();await new Promise(r=>server.close(r));process.send?.({type:'closed'});if(process.connected)process.disconnect();};
  const heartbeat=setInterval(()=>{if(open&&Date.now()-lastSeen>90000)close();},15000);
  if(autoConnect)(runtime.services?.config().enabled?runtime.boot():runtime.connect()).catch(()=>{});
  if(open){const p=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});p.on('error',()=>runtime.log('浏览器打开失败。'));}
  return {url,origin,token,runtime,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(root,'src','gui.js')){
  const gui=await startGui({open:!process.argv.includes('--no-open'),autoConnect:!process.argv.includes('--no-connect')});
  if(process.send)process.send({type:'ready',url:gui.url});else console.log(`本地窗口：${gui.url}`);
  process.on('message',m=>{if(m?.type==='close')gui.close();});
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>gui.close());
}
