import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export const redact=text=>String(text).replace(/(https?:\/\/)[^/\s@]+@/g,'$1[隐藏]@').replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g,'$1?[隐藏]').slice(-60000);
export async function runDependencyProcess(exe,args,{cwd,env,signal,input='',timeoutMs=600000,onLine=()=>{},quiet=false}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let done=false,terminating=false,output='',pending='';
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(output);};
    const kill=async()=>{if(child.exitCode!==null||!child.pid)return;if(process.platform==='win32')await new Promise(r=>{const p=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.once('error',()=>{child.kill();r();});p.once('exit',r);});else child.kill('SIGKILL');};
    const abort=()=>{terminating=true;kill().finally(()=>finish(Error('准备任务已取消')));};
    const timer=setTimeout(()=>{terminating=true;kill().finally(()=>finish(Error('当前准备步骤超时，请检查网络后重试')));},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    const consume=b=>{if(quiet)return;const text=redact(b.toString('utf8'));output=(output+text).slice(-60000);pending+=text;while(pending.includes('\n')||pending.length>4096){const end=pending.includes('\n')?pending.indexOf('\n'):4096;onLine(redact(pending.slice(0,end)));pending=pending.slice(end+1);}};
    child.stdout.on('data',consume);child.stderr.on('data',consume);child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',()=>finish(Error('无法启动依赖工具，请检查程序文件和目录权限')));
    child.once('close',code=>{if(terminating)return;if(signal?.aborted)return finish(Error('准备任务已取消'));if(pending)onLine(redact(pending));finish(code===0?null:Error('准备步骤失败'+(quiet?'':`：${redact(output).slice(-1200)}`)));});
  });
}
export async function downloadVerified(asset,file,{signal,fetcher=fetch,progress=()=>{},maxBytes=64*1024*1024,domains=['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']}={}){
  const valid=url=>{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&domains.some(d=>u.hostname===d||d.startsWith('.')&&u.hostname.endsWith(d));};
  if(!valid(asset.url)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('依赖下载来源或校验值无效');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  if(fs.existsSync(file)&&hash(fs.readFileSync(file))===asset.sha256)return file;
  const temp=file+'.part';let response,url=asset.url;
  try{
    for(let i=0;i<6;i++){signal?.throwIfAborted();response=await fetcher(url,{redirect:'manual',signal,headers:{'user-agent':'Xiaoyu-Dependencies'}});if(response.status>=300&&response.status<400){const next=new URL(response.headers.get('location'),url).href;await response.body?.cancel();if(!valid(next))throw Error('依赖下载重定向到未授权来源');url=next;continue;}break;}
    if(!response?.ok)throw Error('官方下载失败：HTTP '+response?.status);
    const expected=Number(response.headers.get('content-length')??0);if(expected>maxBytes)throw Error('工具下载大小超限');
    const digest=crypto.createHash('sha256'),fd=fs.openSync(temp,'w',0o600);let bytes=0;
    try{for await(const chunk of response.body){signal?.throwIfAborted();bytes+=chunk.length;if(bytes>maxBytes)throw Error('工具下载大小超限');fs.writeSync(fd,chunk);digest.update(chunk);progress({bytes,totalBytes:expected||null});}}finally{fs.closeSync(fd);}
    if(digest.digest('hex')!==asset.sha256)throw Error('依赖文件SHA256校验失败，请重试下载');signal?.throwIfAborted();fs.renameSync(temp,file);return file;
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
