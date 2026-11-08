import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),dest=path.join(root,'dist',`xiaoyu-dev-${version}-${stamp}`),zip=dest+'.zip';
const docs=['desktop-packaging.md','breeze-voice.md','plugin-enhancement.md','unified-startup.md','dependencies.md','speech-input.md','memory-workbench.md','continuity.md','dsh-wechat.md','meme-learning-and-self-model.md','real-video-browsing.md','qzone-notebook.md','wechat-moments.md','reply-preferences-and-group-context.md','companion-life-video.md','chat-scheduled-tasks.md','voice-emotion-prompt-template.md'];
const skipped=new Set(['node_modules','__pycache__','.git','.venv','venv','data','runtime','dist','bundle']);
const files=[];
function copy(relative){const source=path.join(root,relative),stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('不复制符号链接：'+relative);if(stat.isDirectory()){for(const e of fs.readdirSync(source)){if(!skipped.has(e))copy(path.join(relative,e));}return;}
 if(/(?:\.pyc|\.log|\.sqlite\S*|\.db|\.exe|\.dll|\.zip|\.7z|\.pfx|\.pem|\.key)$/i.test(relative)||path.basename(relative)==='cordis.patch.yml'||/^\.env/.test(path.basename(relative)))return;
 if(stat.size>8*1024*1024)throw Error('请先审查大文件：'+relative);
 const target=path.join(dest,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);files.push({file:relative.split(path.sep).join('/'),bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')});
}
fs.mkdirSync(dest,{recursive:true});
for(const entry of ['src','ui','desktop','integrations','scripts','test','personas','examples','README.md','persona.md','package.json','package-lock.json','release-notes.json','.gitignore','.gitattributes','启动.ps1','打开小鱼.vbs'])copy(entry);
for(const doc of docs)copy(path.join('docs',doc));copy('docs/voice-templates');
// Detect accidental inclusion of actual local tokens, without printing them.
const secrets=new Set();function collect(v){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(typeof x==='string'&&x.length>=24&&/token|password|api.?key|secret/i.test(k))secrets.add(x);else if(typeof x==='object')collect(x);}}
for(const f of ['config.json','data/model-engines.json','data/qq-live-session.json','data/wechat/b514ab0b4ca941c6798f6064/config.json'])try{collect(JSON.parse(fs.readFileSync(path.join(root,f))));}catch{}
for(const f of files){const text=fs.readFileSync(path.join(dest,f.file),'utf8');for(const secret of secrets)if(text.includes(secret))throw Error('发现本机凭据，停止打包：'+f.file);}
fs.writeFileSync(path.join(dest,'MANIFEST.sha256.json'),JSON.stringify({version,kind:'development-source',userDataIncluded:false,gitHistoryIncluded:false,files},null,2));
const quote=x=>"'"+x.replaceAll("'","''")+"'";
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath ${quote(dest)} -DestinationPath ${quote(zip)} -CompressionLevel Optimal`],{windowsHide:true,stdio:'pipe',timeout:120000});
const sha=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');fs.writeFileSync(zip+'.sha256',sha+'  '+path.basename(zip)+'\n');
console.log(JSON.stringify({directory:dest,zip,files:files.length,bytes:fs.statSync(zip).size,sha256:sha,userDataIncluded:false}));
