import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const defaults={enabled:false,protocol:'snowluma',snowlumaPath:'',napcatPath:'',napcatPort:6099,astrbot:true};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function validateServices(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(defaults,k)))throw Error('服务设置字段无效');
  const c={...defaults,...value};if(typeof c.enabled!=='boolean'||typeof c.astrbot!=='boolean'||!['snowluma','napcat'].includes(c.protocol))throw Error('服务启动选项无效');
  for(const k of ['snowlumaPath','napcatPath'])if(typeof c[k]!=='string'||c[k].length>1000||/[\r\n"%&|<>^!]/.test(c[k])||c[k]&&!path.isAbsolute(c[k]))throw Error('服务目录须为绝对路径，不能包含命令控制字符');
  if(!Number.isInteger(c.napcatPort)||c.napcatPort<1024||c.napcatPort>65535)throw Error('NapCat管理端口无效');return c;
}
export class ServiceManager {
  constructor(dataDir,{projectRoot,log=()=>{},fetcher=fetch,spawner=spawn,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){this.base=path.resolve(dataDir);this.file=path.join(this.base,'services.json');this.project=projectRoot??path.dirname(this.base);Object.assign(this,{log,fetcher,spawner,sleep});this.child=null;this.kind=null;this.starting=null;this.closing=false;this.lastError=null;this.health=null;this.failedStarts=0;}
  config(){try{return validateServices(read(this.file));}catch{return {...defaults};}}
  save(value){if(this.starting||this.child)throw Error('请先停止托管的协议服务再修改设置');const config=validateServices(value);fs.mkdirSync(this.base,{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(temp,this.file);this.failedStarts=0;return this.state();}
  detect(){const c=this.config(),roots=[path.dirname(this.project),path.dirname(path.dirname(this.project)),path.join(this.base,'protocols')],found={snowluma:[],napcat:[]};for(const root of roots){if(!fs.existsSync(root))continue;for(const d of fs.readdirSync(root,{withFileTypes:true})){if(!d.isDirectory()||!/^snowluma|^napcat/i.test(d.name))continue;const dir=path.join(root,d.name);if(fs.existsSync(path.join(dir,'index.mjs'))&&fs.existsSync(path.join(dir,'node.exe'))&&fs.existsSync(path.join(dir,'EULA.md')))found.snowluma.push(dir);if(['napcat.bat','launcher.bat'].some(file=>fs.existsSync(path.join(dir,file)))&&fs.existsSync(path.join(dir,'napcat.mjs')))found.napcat.push(dir);}}
    return {...found,suggested:{...c,snowlumaPath:c.snowlumaPath||found.snowluma[0]||'',napcatPath:c.napcatPath||found.napcat[0]||''}};
  }
  panel(c=this.config()){let port=c.napcatPort;if(c.protocol==='snowluma'){port=5099;try{const config=read(path.join(c.snowlumaPath,'config','runtime.json'));if(Number.isInteger(config.webuiPort)&&config.webuiPort>=1024&&config.webuiPort<=65535)port=config.webuiPort;if(config.webuiHost&&config.webuiHost!=='127.0.0.1'||config.webuiTls?.enabled)throw Error('目前仅支持本机HTTP控制台');}catch(e){if(e.message==='目前仅支持本机HTTP控制台')throw e;}}return `http://127.0.0.1:${port}/`;}
  state(){const config=this.config();let panelURL=null;try{panelURL=this.panel(config);}catch{}let autoHook=null;if(config.protocol==='snowluma'&&config.snowlumaPath)try{autoHook=read(path.join(config.snowlumaPath,'config','runtime.json')).hookAutoLoad===true;}catch{}return {config,owned:!!this.child,managedProtocol:this.kind,starting:!!this.starting,health:this.health,lastError:this.lastError,panelURL,autoHook,failedStarts:this.failedStarts};}
  async probe(url=this.panel(),kind=this.config().protocol){try{const r=await this.fetcher(url,{signal:AbortSignal.timeout(1500),redirect:'manual'});if(r.status<200||r.status>=400){await r.body?.cancel();return false;}let size=0,text='';for await(const chunk of r.body){size+=chunk.length;if(size>128*1024)return false;text+=Buffer.from(chunk).toString('utf8');}const valid=(kind==='snowluma'?/SnowLuma/i:/NapCat/i).test(text);this.lastProbeMismatch=valid?null:url;return valid;}catch{return false;}}
  async start({qqConnected=false,qqRunning=false}={}){
    if(this.starting)return this.starting;if(this.closing)throw Error('服务管理器正在退出');
    this.stopping=false;this.starting=this.launch({qqConnected,qqRunning});try{return await this.starting;}finally{this.starting=null;}
  }
  async launch({qqConnected,qqRunning}){
    const c=this.config();this.lastError=null;
    try{
      const panel=this.panel(c);if(qqConnected){this.health='qq-connected';return this.state();}
      const other=c.protocol==='snowluma'?'napcat':'snowluma';if(await this.probe(this.panel({...c,protocol:other}),other))throw Error('检测到另一套QQ协议控制台，请先停止旧接入，避免同时加载两个Hook');
      // Reuse an existing controller; never adopt or terminate its process.
      if(await this.probe(panel)){this.health='external-ready';return this.state();}if(this.lastProbeMismatch===panel)throw Error('协议管理端口被其他网页占用，请调整官方服务端口后重试');
      if(this.child){this.health='starting';return this.state();}
      const dir=c.protocol==='snowluma'?c.snowlumaPath:c.napcatPath;
      if(!dir||!fs.existsSync(dir))throw Error('尚未找到'+c.protocol+'原版目录，请自动检测或填写路径');
      let executable,args,env={...process.env};
      if(c.protocol==='snowluma'){
        executable=path.join(dir,'node.exe');args=[path.join(dir,'index.mjs')];
        if(!fs.existsSync(executable)||!fs.existsSync(args[0])||!fs.existsSync(path.join(dir,'EULA.md')))throw Error('SnowLuma目录缺少官方完整包文件');
        // Keep official consent, password and hookAutoLoad settings unchanged.
      }else{
        if(qqRunning)throw Error('QQ正在运行且未连通NapCat，请先在官方流程处理QQ会话；小鱼不会自动退出QQ或加载第二个Hook');
        const entry=['napcat.bat','launcher.bat'].map(n=>path.join(dir,n)).find(p=>fs.existsSync(p));
        if(!entry||!fs.existsSync(path.join(dir,'napcat.mjs')))throw Error('目前支持NapCat官方Shell目录，请核对napcat.mjs和启动脚本');
        executable=process.env.ComSpec??'C:/Windows/System32/cmd.exe';args=['/d','/s','/c',`""${entry}""`];
      }
      if(this.closing||this.stopping)throw Error('协议启动已取消');
      fs.mkdirSync(this.base,{recursive:true});const output=fs.openSync(path.join(this.base,'protocol-managed.log'),'a',0o600);let child;
      try{child=this.spawner(executable,args,{cwd:dir,env,windowsHide:true,stdio:['ignore',output,output]});}finally{fs.closeSync(output);}
      this.child=child;this.kind=c.protocol;this.health='starting';
      child.on('error',()=>{if(this.child===child){this.child=null;this.health='failed';}});
      child.on('exit',()=>{if(this.child===child){this.child=null;this.health='stopped';this.log('托管协议服务已退出，请检查服务日志。');}});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      for(let i=0;i<30&&!this.closing&&!this.stopping&&this.child===child;i++){if(await this.probe(panel)){this.health='ready';this.failedStarts=0;this.log('协议控制台已就绪，等待QQ连接与身份核验。');return this.state();}await this.sleep(500);}
      throw Error('协议控制台未就绪，请查看protocol-managed.log；首次设置或Node完整性问题需在官方窗口处理');
    }catch(e){this.failedStarts++;this.lastError=e.message;this.log(e.message);throw e;}
  }
  async stop(){
    this.stopping=true;
    const child=this.child;if(!child)return this.state();
    // Never kill a QQ process tree. Stopping a console is not unloading a QQ hook.
    child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    if(this.child===child)this.child=null;this.health='stopped';return this.state();
  }
  async close(){this.closing=true;await this.stop();await this.starting?.catch(()=>{});}
}
