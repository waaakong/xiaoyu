import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {root} from './config.js';
export function nativeExecutable(){
  const dir=path.join(root,'data','windows-host'),sdk=path.join(root,'data','webview-sdk'),packageDir=path.join(sdk,'package');
  const filename='Companion-'+JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version+'.exe';
  const bundled=path.join(dir,filename);
  if(fs.existsSync(bundled)&&['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'].every(n=>fs.existsSync(path.join(dir,n)))&&['desktop/NativeHost.cs','desktop/icon.ico'].every(n=>fs.statSync(path.join(root,n)).mtimeMs<=fs.statSync(bundled).mtimeMs))return bundled;
  fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(sdk,{recursive:true});
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  if(!fs.existsSync(path.join(packageDir,'lib','net462','Microsoft.Web.WebView2.Core.dll'))){
    const zip=path.join(sdk,'package.zip');
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4314.35/microsoft.web.webview2.1.0.4314.35.nupkg' -OutFile ${quote(zip)}; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(zip)}, ${quote(packageDir)})`],{windowsHide:true,timeout:120000,stdio:'pipe'});
  }
  for(const name of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'])if(!fs.existsSync(path.join(dir,name)))fs.copyFileSync(path.join(packageDir,'lib','net462',name),path.join(dir,name));
  if(!fs.existsSync(path.join(dir,'WebView2Loader.dll')))fs.copyFileSync(path.join(packageDir,'runtimes','win-x64','native','WebView2Loader.dll'),path.join(dir,'WebView2Loader.dll'));
  if(!fs.existsSync(path.join(root,'desktop','icon.ico'))){const png=fs.readFileSync(path.join(root,'desktop','icon.png')),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);fs.writeFileSync(path.join(root,'desktop','icon.ico'),Buffer.concat([header,png]));}
  const exe=path.join(dir,filename),source=path.join(root,'desktop','NativeHost.cs');
  if(!fs.existsSync(exe)||[source,path.join(root,'desktop','icon.ico')].some(p=>fs.statSync(p).mtimeMs>fs.statSync(exe).mtimeMs)){
    const csc=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
    execFileSync(csc,['/nologo','/target:winexe',`/out:${exe}`,`/win32icon:${path.join(root,'desktop','icon.ico')}`,'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',...['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'].map(n=>'/reference:'+path.join(dir,n)),source],{windowsHide:true,encoding:'utf8',stdio:'pipe'});
  }return exe;
}
