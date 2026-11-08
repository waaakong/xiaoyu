import {execFileSync} from 'node:child_process';
import {ProxyAgent} from 'undici';
const hosts=new Set(['raw.githubusercontent.com','github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','cdn.jsdelivr.net','registry.npmjs.org']);
export function remoteUrl(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!hosts.has(u.hostname))throw new Error('只允许既定公开图库托管站点的HTTPS地址');return u.href;}
let proxy;
function systemProxy(){
  if(proxy!==undefined)return proxy;proxy=null;
  if(process.platform!=='win32')return proxy;
  try{const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';const enabled=execFileSync('reg.exe',['query',key,'/v','ProxyEnable'],{encoding:'utf8',windowsHide:true,timeout:2000});if(!/0x1\s*$/m.test(enabled))return proxy;const result=execFileSync('reg.exe',['query',key,'/v','ProxyServer'],{encoding:'utf8',windowsHide:true,timeout:2000});const raw=result.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim();const target=raw?.includes('=')?(raw.match(/(?:^|;)https=([^;]+)/)?.[1]??raw.match(/(?:^|;)http=([^;]+)/)?.[1]):raw;if(target){const u=new URL(target.includes('://')?target:'http://'+target);if(['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))proxy=new ProxyAgent(u.href);}}catch{/* direct route remains available */}
  return proxy;
}
export async function remoteBytes(value,{maxBytes=2*1024*1024,signal,timeoutMs=60000,progress=()=>{}}={}){
  let url=remoteUrl(value);const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  for(let redirect=0;redirect<6;redirect++){
    const dispatcher=systemProxy();const response=await fetch(url,{redirect:'manual',signal:combined,...(dispatcher?{dispatcher}:{}),headers:{'User-Agent':'CodexQQCompanion/0.4','Accept':'application/json,application/zip,image/*,*/*'}});
    if([301,302,303,307,308].includes(response.status)){const dest=response.headers.get('location');await response.body?.cancel();if(!dest)throw new Error('图库重定向无地址');url=remoteUrl(new URL(dest,url));continue;}
    if(!response.ok)throw new Error('图库下载HTTP '+response.status);
    const declared=Number(response.headers.get('content-length'))||0;if(declared>maxBytes){await response.body?.cancel();throw new Error('图库下载超出大小限制');}
    const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>maxBytes){await response.body?.cancel().catch(()=>{});throw new Error('图库下载超出大小限制');}parts.push(part);progress(size,declared);}
    return Buffer.concat(parts);
  }throw new Error('图库重定向次数超限');
}
