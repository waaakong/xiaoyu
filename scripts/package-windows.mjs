import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root} from '../src/config.js';

if(process.platform!=='win32'||process.arch!=='x64')throw new Error('请在Windows x64构建桌面发行包');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name=`xiaoyu-${pkg.version}-win-x64${process.argv.includes('--release')?'-release':''}`,dest=path.join(root,'dist',name),app=path.join(dest,'app');
if(fs.existsSync(dest))throw new Error('发行目录已存在，请先归档旧包或更新版本：'+dest);
const cache=path.join(root,'data','packaging-cache');fs.mkdirSync(cache,{recursive:true});
async function download(url,file){if(fs.existsSync(file))return;const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error('官方依赖下载失败：'+r.status);fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
const nodeVersion=process.version;
const checksums=path.join(cache,`node-${nodeVersion}-SHASUMS256.txt`),nodeLicense=path.join(cache,`node-${nodeVersion}-LICENSE`);
await download(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`,checksums);
await download(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`,nodeLicense);
const expected=fs.readFileSync(checksums,'utf8').split(/\r?\n/).map(l=>l.trim().split(/\s+/)).find(x=>x[1]==='win-x64/node.exe')?.[0];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(!expected||digest(process.execPath)!==expected)throw new Error('本机Node与官方发行SHA256不符，停止打包');
const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
for(const folder of ['src','ui','desktop','personas','node_modules','integrations','scripts'])fs.cpSync(path.join(root,folder),path.join(app,folder),{recursive:true,preserveTimestamps:true,filter:p=>!p.split(path.sep).some(s=>['.cache','__pycache__'].includes(s))&&!p.endsWith('.pyc')&&p!==path.join(root,'integrations','dsh','cordis.patch.yml')});
for(const file of ['package.json','package-lock.json','release-notes.json','persona.md','README.md'])fs.copyFileSync(path.join(root,file),path.join(app,file));
// Only the independent validated DLL and non-personal evidence are bundled.
// Never include its live token/session, mock DLL, compiler, PDB or reader keys.
const mediaBuild=path.join(root,'data','wechat-native-research','build-media'),mediaValidated=fs.existsSync(path.join(mediaBuild,'validation.json'));
const mentionBuild=path.join(root,'data','wechat-native-research','build-mentions'),mentionValidated=fs.existsSync(path.join(mentionBuild,'validation.json'))&&JSON.parse(fs.readFileSync(path.join(mentionBuild,'validation.json'))).mentionValidated===true;
const nativeBuild=mentionValidated?mentionBuild:mediaValidated?mediaBuild:path.join(root,'data','wechat-native-research','build'),nativeValidation=mentionValidated?path.join(mentionBuild,'validation.json'):mediaValidated?path.join(mediaBuild,'validation.json'):path.join(root,'data','wechat-native-research','self-test-result.json');
if(fs.existsSync(path.join(nativeBuild,'manifest.json'))&&fs.existsSync(nativeValidation)){
  const manifest=JSON.parse(fs.readFileSync(path.join(nativeBuild,'manifest.json'))),validation=JSON.parse(fs.readFileSync(nativeValidation));
  if(validation.confirmed!==true||validation.target!=='filehelper'||validation.nativeDll!==manifest.dllSha256||digest(path.join(nativeBuild,'XiaoyuWechatNative.dll'))!==manifest.dllSha256)throw Error('原生组件尚未通过对应构建的真实投递验证');
  const bundle=path.join(app,'integrations','wechat','native','bundle');fs.mkdirSync(bundle,{recursive:true});
  for(const file of ['XiaoyuWechatNative.dll','manifest.json'])fs.copyFileSync(path.join(nativeBuild,file),path.join(bundle,file));
  fs.writeFileSync(path.join(bundle,'validation.json'),JSON.stringify({confirmed:true,target:'filehelper',nativeDll:validation.nativeDll,mediaMask:validation.mediaMask??0,mentionValidated:validation.mentionValidated===true,at:validation.at},null,2));
}
fs.mkdirSync(path.join(app,'docs'),{recursive:true});for(const file of ['desktop-packaging.md','breeze-voice.md','plugin-enhancement.md','unified-startup.md','dependencies.md','speech-input.md','memory-workbench.md','continuity.md','dsh-wechat.md','meme-learning-and-self-model.md','real-video-browsing.md'])fs.copyFileSync(path.join(root,'docs',file),path.join(app,'docs',file));
const native=path.join(app,'data','windows-host');fs.mkdirSync(native,{recursive:true});
for(const dll of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])fs.copyFileSync(path.join(root,'data','windows-host',dll),path.join(native,dll));
const references=['System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll'].map(n=>'/reference:'+n);
execFileSync(compiler,['/nologo','/target:winexe',`/out:${path.join(native,`Companion-${pkg.version}.exe`)}`,`/win32icon:${path.join(root,'desktop','icon.ico')}`,...references,...['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'].map(n=>'/reference:'+path.join(native,n)),path.join(root,'desktop','NativeHost.cs')],{windowsHide:true,stdio:'pipe'});
execFileSync(compiler,['/nologo','/target:winexe',`/out:${path.join(dest,'小鱼.exe')}`,`/win32icon:${path.join(root,'desktop','icon.ico')}`,'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',path.join(root,'desktop','Launcher.cs'),path.join(root,'desktop','RuntimePrerequisites.cs')],{windowsHide:true,stdio:'pipe'});
fs.mkdirSync(path.join(dest,'runtime'));fs.copyFileSync(process.execPath,path.join(dest,'runtime','node.exe'));
const licenses=path.join(dest,'licenses');fs.mkdirSync(licenses);
fs.copyFileSync(nodeLicense,path.join(licenses,'Node.js-LICENSE.txt'));
for(const file of ['LICENSE.txt','NOTICE.txt'])fs.copyFileSync(path.join(root,'data/webview-sdk/package',file),path.join(licenses,'WebView2-'+file));
fs.cpSync(path.join(root,'docs','voice-templates'),path.join(app,'docs','voice-templates'),{recursive:true});
fs.writeFileSync(path.join(licenses,'THIRD-PARTY.txt'),'Node.js and its bundled dependencies: Node.js-LICENSE.txt\nWebView2 SDK: WebView2-LICENSE.txt and WebView2-NOTICE.txt\nGSAP: app/ui/GSAP-NOTICE.txt (Standard License).\nMoYu-Station control adaptations: app/ui/MOYU-NOTICE.txt (MIT License).\nApplication npm dependencies retain their own licenses inside app/node_modules.\nWindows .NET Framework and WebView2 Evergreen runtime are system prerequisites, not bundled here.\nSnowLuma and AstrBot are separate optional services and are not included. BreezeBlue is an optional cloud TTS service; no API credentials or audio are bundled.\n');
fs.copyFileSync(path.join(root,'docs','desktop-packaging.md'),path.join(dest,'使用说明.md'));
fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({name:'小鱼',version:pkg.version,platform:'win32-x64',nodeVersion,nodeSha256:expected,containsUserData:false,entry:'小鱼.exe'},null,2));
const inventory=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('发行包中禁止符号链接');if(item.isDirectory())walk(p);else inventory.push({file:path.relative(dest,p).split(path.sep).join('/'),bytes:fs.statSync(p).size,sha256:digest(p)});}}walk(dest);
for(const item of inventory)if(/(^|\/)(config\.json|companion\.sqlite.*|qq-live-session.*|auth\.json|\.env|settings\.json)$/.test(item.file)||item.file.startsWith('app/data/')&&!item.file.startsWith('app/data/windows-host/'))throw new Error('发行包包含非允许的运行数据：'+item.file);
fs.writeFileSync(path.join(dest,'files.sha256.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify({directory:dest,version:pkg.version,files:inventory.length,bytes:inventory.reduce((n,f)=>n+f.bytes,0),nodeVerified:true,userDataIncluded:false}));
