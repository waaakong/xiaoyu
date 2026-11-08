import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsPowerShell,windowsPowerShellEnv} from './windows-powershell.js';
import {createClientInspector} from './wechat-client-cache.js';

const exec=promisify(execFile);
export const nativeProfile=version=>version==='4.1.10.27'?'legacy-4.1.10.27':null;

export function assertClient(client){
  if(!client.signatureValid)throw Error('WECHAT_SIGNATURE_INVALID：微信腾讯签名核验失败');
  if(Object.hasOwn(client,'core')&&(!client.coreVersion||!client.machine||!client.coreSignatureValid))throw Error('WECHAT_CORE_INVALID：微信核心文件、架构或腾讯签名未通过核验');
  if(!/^4\.\d+\.\d+\.\d+$/.test(client.version))throw Error('WECHAT_CLIENT_UNSUPPORTED：当前只验证微信4.x读取接口');
  if(client.coreVersion&&client.coreVersion!==client.version)throw Error('WECHAT_CORE_MISMATCH：启动程序与核心版本不一致');
  if(client.machine&&client.machine!=='8664')throw Error('WECHAT_ARCH_UNSUPPORTED：需要x64微信');
  return client;
}

async function inspectWeChatUncached(executable){
  if(!path.isAbsolute(executable)||!fs.existsSync(executable)||!['weixin.exe','wechat.exe'].includes(path.basename(executable).toLowerCase()))throw Error('请选择有效的微信程序');
  const code="$ErrorActionPreference='Stop'; $p=Get-Item -LiteralPath $env:XY_WECHAT_EXE; $s=Get-AuthenticodeSignature -LiteralPath $p.FullName; $v=$p.VersionInfo.FileVersion.Trim(); $core=Join-Path $p.DirectoryName ($v+'\\Weixin.dll'); if(-not(Test-Path -LiteralPath $core)){$core=Join-Path $p.DirectoryName 'Weixin.dll'}; $cv=if(Test-Path -LiteralPath $core){(Get-Item -LiteralPath $core).VersionInfo.FileVersion.Trim()}else{''}; $cs=if(Test-Path -LiteralPath $core){Get-AuthenticodeSignature -LiteralPath $core}else{$null}; @{coreSignature=[string]$cs.Status;coreSubject=[string]$cs.SignerCertificate.Subject;version=$v; signature=[string]$s.Status; subject=$s.SignerCertificate.Subject; core=$core; coreVersion=$cv}|ConvertTo-Json -Compress";
  const {stdout}=await exec(windowsPowerShell(),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,env:windowsPowerShellEnv({XY_WECHAT_EXE:executable}),timeout:10000});
  const r=JSON.parse(stdout);let machine=null;
  if(fs.existsSync(r.core)){const fd=fs.openSync(r.core,'r');try{const dos=Buffer.alloc(64),pe=Buffer.alloc(6);fs.readSync(fd,dos,0,64,0);fs.readSync(fd,pe,0,6,dos.readUInt32LE(60));if(pe.readUInt32LE(0)===0x4550)machine=pe.readUInt16LE(4).toString(16);}finally{fs.closeSync(fd);}}
  return {executable,version:r.version,signatureValid:r.signature==='Valid'&&/Tencent|腾讯/i.test(r.subject??''),core:r.core,coreVersion:r.coreVersion,coreSignatureValid:r.coreSignature==='Valid'&&/Tencent|腾讯/i.test(r.coreSubject??''),machine,nativeProfile:nativeProfile(r.version)};
}

export const inspectWeChat=createClientInspector(inspectWeChatUncached);

export async function detectWeChatClients(){
  const code="$ErrorActionPreference='Stop'; $found=@(); Get-CimInstance Win32_Process -Filter \"Name='Weixin.exe' OR Name='WeChat.exe'\" | ForEach-Object {if($_.ExecutablePath){$found+=$_.ExecutablePath}}; foreach($base in @($env:ProgramFiles,${env:ProgramFiles(x86)})){if($base){foreach($rel in @('Tencent\\Weixin\\Weixin.exe','Tencent\\WeChat\\WeChat.exe')){$p=Join-Path $base $rel;if(Test-Path -LiteralPath $p){$found+=$p}}}}; ConvertTo-Json -InputObject @($found | Select-Object -Unique) -Compress";
  const {stdout}=await exec(windowsPowerShell(),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,env:windowsPowerShellEnv(),timeout:10000});
  const candidates=JSON.parse(stdout),results=await Promise.allSettled(candidates.map(inspectWeChat));
  return results.map((r,i)=>r.status==='fulfilled'?r.value:{executable:candidates[i],error:'客户端检查失败',signatureValid:false});
}
