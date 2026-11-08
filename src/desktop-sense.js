import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsPowerShell,windowsPowerShellEnv} from './windows-powershell.js';
const exec=promisify(execFile),names={xiaoyu:'小鱼',codex:'Codex',dsh:'DSH',qq:'QQ',wechat:'微信',plugins:'插件'};
export async function targetProcesses(){
  if(process.platform!=='win32')return {supported:false};
  const script="@('Codex','DeepSeek Harness','DeepSeekHarness','deepseek-harness','dsh','Weixin','WeChat','QQ') | ForEach-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName } | Sort-Object -Unique | ConvertTo-Json -Compress";
  const {stdout}=await exec(windowsPowerShell(),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:windowsPowerShellEnv(),timeout:5000,maxBuffer:4096});
  const parsed=stdout.trim()?JSON.parse(stdout):[],list=Array.isArray(parsed)?parsed:[parsed];const has=pattern=>list.some(n=>pattern.test(String(n)));
  return {supported:true,codex:has(/^Codex$/i),dsh:has(/^(?:DeepSeek ?Harness|deepseek-harness|dsh)$/i),wechat:has(/^(?:Weixin|WeChat)$/i),qq:has(/^QQ$/i),xiaoyu:true};
}
export class DesktopSense {
  constructor({directory,getServices,probe=targetProcesses,now=Date.now,onEvent=()=>{}}){Object.assign(this,{getServices,probe,now,onEvent});this.file=path.join(directory,'desktop-sense.json');let saved;try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}this.enabled=saved?.enabled!==false;this.events=Array.isArray(saved?.events)?saved.events.slice(-200):[];this.lastServices=null;this.processes=null;this.processAt=null;this.previousCpu=null;this.closed=false;}
  start(){if(this.timer)return;void this.sample();this.timer=setInterval(()=>void this.sample(),10000);this.timer.unref?.();}
  persist(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({enabled:this.enabled,events:this.events}),{mode:0o600});fs.renameSync(tmp,this.file);}
  add(kind,service,platform=null){if(!this.enabled||!Object.hasOwn(names,service))return;const event={at:this.now(),kind,service,platform};const last=this.events.at(-1);if(last?.kind===kind&&last.service===service&&last.platform===platform&&event.at-last.at<30000)return;this.events.push(event);this.onEvent?.(event);this.events=this.events.slice(-200);try{this.persist();this.storageError=false;}catch{this.storageError=true;}}
  observeServices(current){if(!this.enabled)return;if(this.lastServices)for(const key of Object.keys(names))if(typeof current[key]?.connected==='boolean'&&typeof this.lastServices[key]?.connected==='boolean'&&current[key].connected!==this.lastServices[key].connected)this.add(current[key].connected?'recovered':'disconnected',key,['qq','wechat'].includes(key)?key:null);this.lastServices=current;}
  failure(service,platform){this.add('failed',service,platform);}
  async sample(){if(this.closed||!this.enabled||this.sampling)return;this.sampling=true;try{this.observeServices(this.getServices());const next=await this.probe();if(this.closed||!this.enabled)return;if(next.supported&&this.processes?.supported)for(const key of ['codex','dsh','qq','wechat'])if(typeof next[key]==='boolean'&&typeof this.processes[key]==='boolean'&&next[key]!==this.processes[key])this.add(next[key]?'process-started':'process-stopped',key,['qq','wechat'].includes(key)?key:null);this.processes=next;this.processAt=this.now();this.probeError=false;}catch{this.probeError=true;}finally{this.sampling=false;}}
  state(){const services=this.getServices();this.observeServices(services);const cpu=os.cpus().reduce((s,c)=>({idle:s.idle+c.times.idle,total:s.total+Object.values(c.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});let cpuPercent=null;if(this.previousCpu&&cpu.total>this.previousCpu.total)cpuPercent=Math.max(0,Math.min(100,(1-(cpu.idle-this.previousCpu.idle)/(cpu.total-this.previousCpu.total))*100));this.previousCpu=cpu;
    return {enabled:this.enabled,at:this.now(),services,computer:this.enabled?{cpuPercent,memoryUsed:os.totalmem()-os.freemem(),memoryTotal:os.totalmem(),uptimeSeconds:os.uptime()}:null,processes:this.enabled?this.processes:null,processAt:this.processAt,processStale:!!(this.probeError||!this.processAt||this.now()-this.processAt>30000),storageError:!!this.storageError,events:this.events.slice().reverse(),privacy:{screen:false,clipboard:false,windowTitles:false,computerDetailsInChat:false}};
  }
  configure({enabled,clearEvents=false}){if(typeof enabled!=='boolean'||typeof clearEvents!=='boolean')throw Error('感知设置无效');this.enabled=enabled;if(clearEvents)this.events=[];if(!enabled){this.processes=null;this.processAt=null;this.lastServices=null;}this.persist();if(enabled)void this.sample();return this.state();}
  chatContext(platform,text){if(!this.enabled||!/(?:电脑|连接|在线|掉线|程序|内存|cpu|codex|dsh|微信|qq|状态|断开|报错|失败|刚[刚才].{0,8}(?:没回|发生|怎么))/iu.test(text))return '';const s=this.getServices(),allowed=['xiaoyu','codex','dsh',platform],parts=allowed.filter(k=>Object.hasOwn(names,k)).map(k=>names[k]+'：'+(s[k]?.connected===true?'已连接':s[k]?.connected===false?'未连接':'未知')+(s[k]?.busy?'，忙碌':''));const labels={recovered:'连接恢复',disconnected:'连接中断',failed:'任务未完成','process-started':'进程启动','process-stopped':'进程退出'};const events=this.events.filter(e=>allowed.includes(e.service)&&(!e.platform||e.platform===platform)&&this.now()-e.at<600000).slice(-2).map(e=>new Date(e.at).toISOString()+' '+names[e.service]+labels[e.kind]).join('；');return '\n本机只读状态快照（'+new Date(this.now()).toISOString()+'）：'+parts.join('；')+(events?'。最近观测事件：'+events:'。最近十分钟没有可用的相关事件记录')+'。仅描述已观测状态，不推断用户行为或故障原因；进程运行不代表账号在线。电脑资源和其他聊天内容未提供。';}
  close(){this.closed=true;clearInterval(this.timer);}
}
