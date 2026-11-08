import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {windowsPowerShell,windowsPowerShellEnv} from './windows-powershell.js';

export class VoiceSecret {
  constructor(file){this.file=file;this.cached=null;this.ciphertext=null;}
  has(){return fs.existsSync(this.file);}
  transform(value,protect){
    if(process.platform!=='win32')throw Error('此构建需要Windows当前用户密钥保护');
    const script='$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); '+(protect?'$b=[Text.Encoding]::UTF8.GetBytes($v); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))':'$b=[Convert]::FromBase64String($v); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))');
    try{return execFileSync(windowsPowerShell(),['-NoProfile','-NonInteractive','-Command',script],{input:value,encoding:'utf8',env:windowsPowerShellEnv(),windowsHide:true,timeout:10000,stdio:['pipe','pipe','pipe']}).trim();}catch{throw Error('语音API Key的本机保护操作失败，请在当前Windows用户下重试');}
  }
  read(){if(!this.has()){this.cached=null;this.ciphertext=null;return '';}const encrypted=fs.readFileSync(this.file,'utf8');if(this.cached!==null&&encrypted===this.ciphertext)return this.cached;const value=this.transform(encrypted,false);this.ciphertext=encrypted;return this.cached=value;}
  write(value){if(!value){fs.rmSync(this.file,{force:true});this.cached=null;this.ciphertext=null;return;}const protectedValue=this.transform(value,true),tmp=this.file+'.tmp';fs.writeFileSync(tmp,protectedValue,{mode:0o600});fs.renameSync(tmp,this.file);this.cached=value;this.ciphertext=protectedValue;}
}
