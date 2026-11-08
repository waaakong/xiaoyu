import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {qqImageUrl} from './media.js';
import {speechInstalled} from './speech-assets.js';

export const MAX_AUDIO=10*1024*1024;
export function clearStaleSpeechCache(directory){
  const cache=path.join(directory,'cache');if(!fs.existsSync(cache)||fs.lstatSync(cache).isSymbolicLink())return;
  for(const entry of fs.readdirSync(cache,{withFileTypes:true})){if(!entry.isDirectory()||!/^job-[A-Za-z0-9]{6}$/.test(entry.name))continue;const target=path.join(cache,entry.name);if(Date.now()-fs.statSync(target).mtimeMs>3600000)fs.rmSync(target,{recursive:true,force:true});}
}
export class Speech {
  constructor(base,{environmentBase=base,projectRoot=path.resolve(import.meta.dirname,'..'),cacheRoots=()=>[],fetcher=fetch}={}){this.base=path.resolve(base);this.environmentBase=path.resolve(environmentBase);this.project=projectRoot;this.cacheRoots=cacheRoots;this.fetcher=fetcher;this.directory=path.join(this.base,'speech');this.tail=Promise.resolve();this.queued=0;this.child=null;this.pending=null;this.last=null;this.closing=false;clearStaleSpeechCache(this.directory);}
  config(){try{const c=JSON.parse(fs.readFileSync(path.join(this.directory,'settings.json'),'utf8'));return {enabled:c.enabled===true,emotion:c.emotion!==false};}catch{return {enabled:false,emotion:true};}}
  save(c){if(!c||Object.keys(c).some(k=>!['enabled','emotion'].includes(k))||Object.values(c).some(v=>typeof v!=='boolean'))throw Error('语音输入设置无效');fs.mkdirSync(this.directory,{recursive:true});const next={...this.config(),...c};fs.writeFileSync(path.join(this.directory,'settings.json'),JSON.stringify(next),{mode:0o600});if(!next.enabled)this.stopWorker();return this.state();}
  state(){return {config:this.config(),installed:speechInstalled(this.environmentBase),warm:!!this.child,busy:!!this.pending,queued:this.queued,last:this.last};}
  async stopWorker(){clearTimeout(this.idle);const child=this.child;this.child=null;this.pending?.reject(Error('语音识别已取消'));this.pending=null;if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('close',resolve);if(process.platform==='win32'&&child.pid){const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.once('error',()=>child.kill());}else child.kill('SIGKILL');});}
  async worker(){
    if(this.child)return this.child;if(!speechInstalled(this.environmentBase))throw Error('请先在依赖中心准备语音识别环境');
    const child=spawn(path.join(this.environmentBase,'speech-env','Scripts','python.exe'),['-I','-X','utf8',path.join(this.project,'scripts','speech-worker.py'),'--base',this.environmentBase,'--cache-base',this.base],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']});this.child=child;child.stderr.resume();child.stdin.on('error',()=>{});
    let buffer='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){this.stopWorker();return;}while(buffer.includes('\n')){const n=buffer.indexOf('\n'),line=buffer.slice(0,n);buffer=buffer.slice(n+1);let result;try{result=JSON.parse(line);}catch{continue;}if(result.id&&this.pending?.id===result.id){const p=this.pending;this.pending=null;result.ok?p.resolve(result):p.reject(Error(result.error||'语音识别失败'));}}});
    child.once('error',()=>{if(this.child===child){this.child=null;this.pending?.reject(Error('无法启动本地语音环境'));this.pending=null;}});child.once('close',()=>{if(this.child===child){this.child=null;this.pending?.reject(Error('本地语音进程已退出'));this.pending=null;}});return child;
  }
  enqueue(work,{signal}={}){
    if(this.closing||this.queued>=4)throw Error('语音识别正在排队，请稍后再试');this.queued++;
    const task=this.tail.catch(()=>{}).then(async()=>{signal?.throwIfAborted();if(this.closing)throw Error('语音识别已关闭');return work();});this.tail=task.finally(()=>{this.queued--;});this.tail.catch(()=>{});return task;
  }
  async infer(request,{signal}={}){
    signal?.throwIfAborted();clearTimeout(this.idle);const start=Date.now();const child=await this.worker();signal?.throwIfAborted();
    try{return await new Promise((resolve,reject)=>{const id=crypto.randomUUID(),finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};const abort=()=>{this.stopWorker();finish(reject,Error('语音识别已取消'));};const timer=setTimeout(()=>{this.stopWorker();finish(reject,Error('本地语音识别超时'));},120000);signal?.addEventListener('abort',abort,{once:true});this.pending={id,resolve:r=>finish(resolve,r),reject:e=>finish(reject,e)};child.stdin.write(JSON.stringify({...request,id})+'\n',e=>{if(e){this.pending?.reject(Error('本地语音通道中断'));this.pending=null;}});});}
    finally{this.last={at:new Date().toISOString(),totalMs:Date.now()-start};this.idle=setTimeout(()=>this.stopWorker(),300000);this.idle.unref();}
  }
  async bytes(segment,onebot,{signal,assertFresh=()=>{}}={}){
    signal?.throwIfAborted();assertFresh();const file=String(segment?.data?.file??'');if(!file||file.length>1000||/[\\/:\x00-\x1f]/.test(file)||file==='.'||file==='..')throw Error('QQ语音文件编号无效');
    let record;try{record=await onebot.action('get_record',{file,out_format:'wav'},{signal,assertFresh});}catch{signal?.throwIfAborted();assertFresh();record=await onebot.action('get_record',{file},{signal,assertFresh});}signal?.throwIfAborted();assertFresh();
    const base64=record?.base64?.replace(/^base64:\/\//,'');if(base64){if(base64.length>Math.ceil(MAX_AUDIO/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('QQ语音大小或数据无效');return this.check(Buffer.from(base64,'base64'));}
    const url=record?.url??segment?.data?.url;if(url){const target=qqImageUrl(url),res=await this.fetcher(target,{signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]),redirect:'error'});if(!res.ok||Number(res.headers.get('content-length'))>MAX_AUDIO){await res.body?.cancel();throw Error('QQ语音读取失败或过大');}const chunks=[];let size=0;for await(const part of res.body){size+=part.length;if(size>MAX_AUDIO){await res.body?.cancel().catch(()=>{});throw Error('QQ语音超过10MB');}chunks.push(part);}return this.check(Buffer.concat(chunks));}
    // Only a trusted get_record response may supply a local path, and only in a known protocol cache.
    if(record?.file&&path.isAbsolute(record.file)){const target=fs.realpathSync(record.file);const allowed=this.cacheRoots().some(root=>{try{return target.startsWith(fs.realpathSync(root)+path.sep);}catch{return false;}});if(allowed){const stat=fs.statSync(target);if(stat.isFile()&&stat.size<=MAX_AUDIO)return this.check(fs.readFileSync(target));}}
    throw Error('协议端未提供可读取的语音，请重新发送');
  }
  check(bytes){if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_AUDIO)throw Error('音频须在10MB以内');return bytes;}
  async local(bytes,options={}){this.check(bytes);const cache=path.join(this.directory,'cache');fs.mkdirSync(cache,{recursive:true});const dir=fs.mkdtempSync(path.join(cache,'job-')),file=path.join(dir,'input.audio');try{fs.writeFileSync(file,bytes,{mode:0o600});const result=await this.infer({op:'transcribe',path:file},options);if(!this.config().emotion){result.emotion='unknown';result.events=[];}return result;}finally{fs.rmSync(dir,{recursive:true,force:true});}}
  transcribe(segment,onebot,options={}){return this.enqueue(async()=>{options.assertFresh?.();const bytes=await this.bytes(segment,onebot,options);options.assertFresh?.();const result=await this.local(bytes,options);options.assertFresh?.();return result;},options);}
  preview(bytes){return this.enqueue(()=>this.local(bytes));}
  probe(){return this.enqueue(()=>this.infer({op:'probe'}));}
  async close(){this.closing=true;await this.stopWorker();await this.tail.catch(()=>{});}
}
