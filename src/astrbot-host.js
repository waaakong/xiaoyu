import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export class AstrBotHost {
  constructor(dataDir,log=()=>{}){this.base=path.resolve(dataDir);this.python=path.join(this.base,'astrbot-env','Scripts','python.exe');this.directory=path.join(this.base,'astrbot');this.log=log;this.child=null;this.lastExit=null;this.dashboard='http://127.0.0.1:6185/';}
  installerState(){try{const file=path.join(this.directory,'data','xiaoyu-installer-status.json');if(fs.statSync(file).size>2048)return null;const s=JSON.parse(fs.readFileSync(file,'utf8'));if(!['downloading','downloaded','installing','succeeded','failed','timed-out'].includes(s.state))return null;return {state:s.state,time:s.time,elapsedSeconds:s.elapsedSeconds,timeoutSeconds:s.timeoutSeconds,stale:['installing','downloading'].includes(s.state)&&(!this.child||Date.now()/1000-Number(s.time)>250)};}catch{return null;}}
  state(){return {installed:fs.existsSync(this.python)&&fs.existsSync(path.join(this.directory,'.astrbot')),running:!!this.child,version:'4.29.4',dashboard:this.dashboard,lastExit:this.lastExit,installer:this.installerState()};}
  configureBridge(){
    const project=path.resolve(import.meta.dirname,'..'),file=path.join(this.directory,'data','cmd_config.json');
    const config=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    config.platform??=[];if(!config.platform.some(p=>p.id==='xiaoyu_wechat'))config.platform.push({id:'xiaoyu_wechat',type:'xiaoyu_wechat',enable:true});
    const id='xiaoyu_local_codex';config.provider??=[];
    if(config.provider.some(p=>p.enable&&p.id!==id))throw new Error('AstrBot已有其他启用模型，请先在插件环境中停用它们，再启用本机增强桥接');
    if(!config.provider.some(p=>p.id===id))config.provider.push({id,type:id,enable:true,model:'local-codex',key:[]});else config.provider.find(p=>p.id===id).enable=true;
    config.provider_settings??={};Object.assign(config.provider_settings,{enable:true,wake_prefix:''});
    config.wake_prefix=[...new Set([...(config.wake_prefix??[]),''])];
    config.agent_runner??={runner_type:'local',config:{}};if(config.agent_runner.runner_type!=='local')throw new Error('聊天增强要求AstrBot使用local agent runner');
    config.agent_runner.config??={};config.agent_runner.config.model={...config.agent_runner.config.model,provider_id:id,request_max_retries:1,fallback_provider_ids:[]};
    const backup=path.join(this.base,'backups','astrbot-bridge-'+Date.now());fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(file,path.join(backup,'cmd_config.json'));
    fs.cpSync(path.join(project,'integrations','astrbot','xiaoyu_bridge_context'),path.join(this.directory,'data','plugins','xiaoyu_bridge_context'),{recursive:true});
    const temp=file+'.bridge.tmp';fs.writeFileSync(temp,JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(temp,file);
  }
  async start({modelURL,modelToken,wechatToken}={}){if(this.child)return this.state();if(!this.state().installed)throw new Error('尚未准备独立AstrBot环境，请按本机安装说明配置');const output=fs.openSync(path.join(this.base,'astrbot-runtime.log'),'a',0o600);try{const child=spawn(this.python,[path.resolve(import.meta.dirname,'../scripts/run-astrbot.py')],{cwd:this.directory,env:{...process.env,ASTRBOT_ROOT:this.directory,PYTHONUTF8:'1',XIAOYU_MODEL_URL:modelURL??'',XIAOYU_MODEL_TOKEN:modelToken??'',XIAOYU_WECHAT_TOKEN:wechatToken??''},windowsHide:true,stdio:['ignore',output,output]});this.child=child;child.on('exit',code=>{if(this.child===child){this.child=null;this.lastExit=code;this.log('AstrBot插件环境已停止。');}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});this.log('AstrBot插件环境正在启动，插件默认按聊天关闭。');return this.state();}catch(e){this.child=null;throw e;}finally{fs.closeSync(output);}}
  async stop(){const child=this.child;if(!child)return this.state();if(process.platform==='win32'){await new Promise(resolve=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill();resolve();});killer.once('exit',resolve);});}else child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});if(this.child===child)this.child=null;return this.state();}
}
