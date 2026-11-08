import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {UV,PYTHON_VERSION,ASTRBOT_VERSION,INDEXES,DEPENDENCY_LINKS} from './dependency-catalog.js';
import {runDependencyProcess,downloadVerified,redact} from './dependency-io.js';
import {readZip} from './meme-zip.js';
import {installSpeech} from './speech-install.js';
import {speechInstalled} from './speech-assets.js';
import {edgeExecutable} from './video-browser.js';

const exists=fs.existsSync;
export class DependencyCenter {
  constructor(dataDir,{projectRoot,canInstall=()=>true,getToken=()=>'',external=()=>({}),adopt=()=>{},runner=runDependencyProcess,fetcher=fetch,uvAsset=UV,platform=process.platform,arch=process.arch,ports={dashboard:6185,gateway:6199}}={}){
    this.base=path.resolve(dataDir);this.project=projectRoot??path.resolve(import.meta.dirname,'..');Object.assign(this,{canInstall,getToken,external,adopt,runner,fetcher,uvAsset,platform,arch,ports});this.directory=path.join(this.base,'dependencies');this.python=path.join(this.base,'astrbot-env','Scripts','python.exe');this.bot=path.join(this.base,'astrbot');this.job=null;this.work=null;this.report=null;this.scanning=null;
  }
  state(){return {items:this.report?.items??[],checkedAt:this.report?.checkedAt??null,index:this.index(),job:this.job?{...this.job,log:this.job.log.slice(-12)}:null,credentialsFile:exists(path.join(this.base,'astrbot-initial-login.txt'))?path.join(this.base,'astrbot-initial-login.txt'):null};}
  index(){try{const c=JSON.parse(fs.readFileSync(path.join(this.directory,'settings.json'),'utf8'));return Object.hasOwn(INDEXES,c.index)?c.index:'official';}catch{return 'official';}}
  managedPath(target){const resolved=path.resolve(target),prefix=this.base+path.sep;if(!resolved.startsWith(prefix))throw Error('依赖路径超出小鱼数据目录');let parent=resolved;while(!exists(parent))parent=path.dirname(parent);if(fs.realpathSync(parent)!==fs.realpathSync(this.base)&&!fs.realpathSync(parent).startsWith(fs.realpathSync(this.base)+path.sep))throw Error('依赖目录不能通过链接指向外部');return resolved;}
  async inspectPython(file){if(!exists(file))return null;try{const result=await this.runner(file,['-I','-c','import sys,json,importlib.metadata as m; print(json.dumps({"python":".".join(map(str,sys.version_info[:3])),"astrbot":next((d.version for d in m.distributions() if d.metadata["Name"].lower()=="astrbot"),None)}))'],{timeoutMs:15000});return JSON.parse(result.trim());}catch{return null;}}
  managedPython(){const dir=path.join(this.base,'runtimes','python');if(!exists(dir))return null;for(const d of fs.readdirSync(dir,{withFileTypes:true}))if(d.isDirectory()&&/^cpython-3\.12\./.test(d.name)&&exists(path.join(dir,d.name,'python.exe')))return path.join(dir,d.name,'python.exe');return null;}
  async scan(){if(this.scanning)return this.scanning;this.scanning=this.scanOnce();try{return await this.scanning;}finally{this.scanning=null;}}
  async scanOnce(){
    let system={};if(this.platform==='win32'){
      const client='Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',keys=[['HKLM\\SOFTWARE\\WOW6432Node\\'+client,'pv'],['HKCU\\Software\\'+client,'pv'],['HKLM\\SOFTWARE\\'+client,'pv'],['HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full','Release']];
      const results=await Promise.allSettled(keys.map(([key,name])=>this.runner('reg.exe',['query',key,'/v',name],{timeoutMs:5000})));
      const versions=results.slice(0,3).filter(r=>r.status==='fulfilled').map(r=>/pv\s+REG_SZ\s+([^\r\n]+)/i.exec(r.value)?.[1]?.trim());system.webview=versions.find(v=>v&&/^\d+(\.\d+)+$/.test(v)&&v.split('.').some(n=>Number(n)>0));
      const release=results[3].status==='fulfilled'?/Release\s+REG_DWORD\s+(0x[\da-f]+|\d+)/i.exec(results[3].value)?.[1]:null;system.dotnet=Number(release)>=528040;
      const custom=process.env.WEBVIEW2_BROWSER_EXECUTABLE_FOLDER;if(custom&&exists(path.join(custom,'msedgewebview2.exe')))system.webview='custom-runtime';
      system.qq=[process.env.ProgramW6432,process.env.ProgramFiles,'C:/Program Files'].filter(Boolean).some(dir=>exists(path.join(dir,'Tencent','QQNT','QQ.exe'))||exists(path.join(dir,'Tencent','QQ','QQ.exe')));
    }
    const env=await this.inspectPython(this.python),managed=env??await this.inspectPython(this.managedPython()??'');const external=this.external(),items=[];
    const add=(id,name,ready,detail,version='',required=false)=>items.push({id,name,state:ready?'ready':'missing',detail,version,required,url:DEPENDENCY_LINKS[id]??null});
    add('node','Node.js',Number(process.versions.node.split('.')[0])>=24,'便携包已携带，无需另装Node/npm',process.version,true);
    add('webview2','WebView2 Runtime',!!system.webview,system.webview?'桌面运行时已检测到':'缺少时可通过启动器下载微软安装器',system.webview??'',true);
    add('dotnet','.NET Framework 4.8',system.dotnet===true,'桌面启动器所需的Windows运行环境','',true);
    add('python','独立 Python 3.12',!!managed?.python?.startsWith('3.12.'),'基础依赖将在小鱼数据目录内准备',managed?.python??'');
    add('astrbot','AstrBot 插件环境',env?.astrbot===ASTRBOT_VERSION&&exists(path.join(this.bot,'data','cmd_config.json')),env?.astrbot&&env.astrbot!==ASTRBOT_VERSION?'已安装其他版本，不会自动替换':'聊天插件可选；准备后继续使用原有插件管理',env?.astrbot??'');
    for(const [id,name]of [['snowluma','SnowLuma'],['napcat','NapCat Shell'],['qq','QQ'],['codex','Codex']])add(id,name,id==='qq'?!!system.qq:!!external[id],id==='snowluma'||id==='napcat'?'从官方获取原版后，在QQ接入页检测目录':'安装及登录使用官方流程');
    add('speech','本地语音识别 / SenseVoiceSmall',speechInstalled(this.base),'可选；独立CPU环境，约230MiB量化模型；不上传音频、不按次收费');
    add('edge','Microsoft Edge / 视频只读浏览',!!edgeExecutable(),'复用已安装的Edge，使用小鱼自己的浏览器资料目录；首次登录由用户处理');
    add('qzone','QQ空间图片/视频组件',exists(path.join(this.directory,'qzone-ready.json')),'复用独立Python；FFmpeg用于MP4封面，准备前请停止插件服务');
    add('voice','Breeze 官方语音',true,'云端合成无需本机模型；在语音与音色页配置Key，合成消耗官网额度');
    this.report={checkedAt:new Date().toISOString(),items};return this.state();
  }
  install({index='official',component='basic'}={}){
    if(!['basic','speech','qzone'].includes(component))throw Error('依赖组件无效');
    if(!Object.hasOwn(INDEXES,index))throw Error('请选择官方PyPI或阿里云镜像');if(this.work)throw Error('依赖准备正在进行，请等待或取消');if(this.platform!=='win32'||this.arch!=='x64')throw Error('当前自动准备支持Windows x64');
    fs.mkdirSync(this.base,{recursive:true});this.managedPath(this.directory);fs.mkdirSync(this.directory,{recursive:true});const lock=path.join(this.directory,'install.lock');
    if(exists(lock)){let alive=true;try{const previous=JSON.parse(fs.readFileSync(lock,'utf8'));try{process.kill(previous.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}catch{}if(alive)throw Error('另一个依赖准备任务仍在运行');fs.unlinkSync(lock);}
    fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(this.directory,'settings.json'),JSON.stringify({index}),{mode:0o600});
    this.controller=new AbortController();const controller=this.controller;this.job={state:'running',stage:'检查现有环境',started:new Date().toISOString(),updated:new Date().toISOString(),bytes:0,totalBytes:null,log:[],error:null};
    let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;controller.abort();},15*60000);
    this.job.component=component;
    this.work=(async()=>{try{await (component==='speech'?installSpeech(this,index,controller.signal):component==='qzone'?this.prepareQzone(index,controller.signal):this.prepare(index,controller.signal));await this.scan();controller.signal.throwIfAborted();this.job.state='succeeded';this.stage('依赖已就绪');}catch(e){this.job.state=controller.signal.aborted&&!timedOut?'cancelled':'failed';this.job.error=timedOut?'准备总时长超过15分钟，已终止，可重试':redact(e.message).slice(-1500);this.stage(this.job.state==='cancelled'?'已取消，可重试':'准备未完成，可重试');}finally{clearTimeout(deadline);if(exists(lock))fs.unlinkSync(lock);this.work=null;}})();return this.state();
  }
  stage(stage){Object.assign(this.job,{stage,updated:new Date().toISOString(),bytes:0,totalBytes:null});}
  line(text){if(!text.trim())return;this.job.log.push(redact(text).slice(-1000));if(this.job.log.length>60)this.job.log.shift();this.job.updated=new Date().toISOString();}
  cancel(){if(this.work){this.stage('正在取消当前准备步骤');this.controller.abort();}return this.state();}
  async prepareQzone(index,signal){
    if(!this.canInstall())throw Error('请先停止AstrBot插件服务再准备空间视频依赖，完成后可重启插件');
    if(!exists(this.python))throw Error('请先准备基础Python＋AstrBot环境');
    const uv=path.join(this.directory,'uv-'+UV.version+'.exe');if(!exists(uv))throw Error('请先完成基础依赖准备');
    this.stage('准备QQ空间HTTP与FFmpeg视频组件');
    await this.runner(uv,['--cache-dir',path.join(this.directory,'qzone-uv-cache'),'pip','install','--python',this.python,'--index-url',INDEXES[index],'httpx>=0.27,<1','imageio-ffmpeg==0.6.0','--no-config'],{signal,timeoutMs:300000,onLine:t=>this.line(t)});
    await this.runner(this.python,['-I','-c','import httpx,imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{signal,timeoutMs:15000});
    fs.writeFileSync(path.join(this.directory,'qzone-ready.json'),JSON.stringify({version:1,preparedAt:new Date().toISOString()}));
  }
  async prepare(index,signal){
    fs.mkdirSync(this.base,{recursive:true});const existing=await this.inspectPython(this.python);signal.throwIfAborted();
    if(existing?.astrbot&&existing.astrbot!==ASTRBOT_VERSION)throw Error('检测到已有不同版本AstrBot，为保留环境请先单独处理版本迁移');
    if(existing?.python&&!existing.python.startsWith('3.12.'))throw Error('已有解释器不是Python 3.12，不会自动替换现有环境');
    if(existing?.astrbot===ASTRBOT_VERSION&&exists(path.join(this.bot,'data','cmd_config.json'))){await this.runner(this.python,['-I','-m','pip','check'],{signal,timeoutMs:30000,onLine:t=>this.line(t)});this.adopt();this.stage('已有环境满足要求，已复用');return;}
    this.managedPath(this.bot);if(!this.canInstall())throw Error('AstrBot或插件操作正在运行，请先停止插件环境再准备依赖；QQ主聊天无需停止');
    // Wheel builds can exceed MAX_PATH inside a deeply nested app directory.
    // Keep only disposable build/download cache in a short per-install temp path.
    const inherited=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^UV_/i.test(k)&&!/^PIP_(INDEX_URL|EXTRA_INDEX_URL|CONFIG_FILE)$/i.test(k)));
    const cache=path.join(os.tmpdir(),...(this.platform==='win32'?['Low']:[]),'xydeps-'+crypto.createHash('sha256').update(this.base).digest('hex').slice(0,10));
    const env={...inherited,UV_CACHE_DIR:cache,UV_PYTHON_INSTALL_DIR:path.join(this.base,'runtimes','python'),UV_PYTHON_INSTALL_BIN:'0',UV_PYTHON_INSTALL_REGISTRY:'0',UV_NO_CONFIG:'1',UV_NO_PROGRESS:'1',UV_HTTP_TIMEOUT:'15',UV_HTTP_RETRIES:'1',PYTHONUTF8:'1'};
    const run=(exe,args,options={})=>this.runner(exe,args,{cwd:this.base,env,signal,onLine:t=>this.line(t),...options});
    if(existing?.astrbot!==ASTRBOT_VERSION){
      this.managedPath(path.join(this.base,'astrbot-env'));this.managedPath(env.UV_PYTHON_INSTALL_DIR);
      const asset=this.uvAsset;this.stage('下载并校验uv工具');const archive=path.join(this.directory,'uv-'+asset.version+'.zip');await downloadVerified(asset,archive,{signal,fetcher:this.fetcher,progress:p=>Object.assign(this.job,p,{updated:new Date().toISOString()})});
      this.stage('准备已校验的安装工具');const entries=readZip(fs.readFileSync(archive),{maxEntryLength:100*1024*1024});const candidate=[...entries.values()].filter(e=>e.name==='uv.exe'||e.name.endsWith('/uv.exe'));if(candidate.length!==1)throw Error('官方uv归档缺少唯一uv.exe');const uv=path.join(this.directory,'uv-'+asset.version+'.exe');fs.writeFileSync(uv,candidate[0].read(),{mode:0o700});
      let python=this.managedPython();if(!existing&&!python){this.stage('准备独立Python '+PYTHON_VERSION);await run(uv,['python','install',PYTHON_VERSION,'--no-bin','--no-registry','--no-config'],{timeoutMs:300000});python=this.managedPython();if(!python)throw Error('独立Python安装后未通过文件检查');}
      if(!existing){
        this.stage('创建独立Python环境');const target=path.dirname(path.dirname(this.python)),marker=path.join(this.directory,'owned-environment.json');if(exists(target)&&!exists(marker))throw Error('已有不完整环境，为保留文件请先检查astrbot-env目录');fs.writeFileSync(marker,JSON.stringify({path:target}),{mode:0o600});
        await run(uv,['venv',target,'--python',python,'--seed','--allow-existing','--no-config','--index-url',INDEXES[index]],{timeoutMs:180000});
      }
      this.stage('安装AstrBot '+ASTRBOT_VERSION);await run(uv,['pip','install','--python',this.python,'--index-url',INDEXES[index],'astrbot=='+ASTRBOT_VERSION,'--no-config'],{timeoutMs:600000});
    }
    this.stage('验证解释器与包依赖');await run(this.python,['-I','-m','pip','check'],{timeoutMs:30000});const verified=await this.inspectPython(this.python);if(verified?.astrbot!==ASTRBOT_VERSION||!verified.python.startsWith('3.12.'))throw Error('安装后的版本检查失败');
    if(!exists(path.join(this.bot,'data','cmd_config.json'))){this.stage('准备首次AstrBot配置');await run(this.python,[path.join(this.project,'scripts','prepare-astrbot.py'),'--data-dir',this.base,'--index',index,'--dashboard-port',String(this.ports.dashboard),'--gateway-port',String(this.ports.gateway)],{input:this.getToken()+'\n',quiet:true,timeoutMs:60000});}
    signal.throwIfAborted();this.adopt();
  }
  async close(){this.controller?.abort();await this.work;}
}
