import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function detectDsh(){const p=path.join(process.env.LOCALAPPDATA??'','Programs','DeepSeek Harness','DeepSeek Harness.exe');return fs.existsSync(p)?p:'';}
export async function importDsh(engines,root){
  const exe=engines.config.executable||detectDsh();if(!path.isAbsolute(exe)||!fs.existsSync(exe)||path.basename(exe).toLowerCase()!=='deepseek harness.exe')throw Error('请先保存有效的DSH程序位置');
  const cli=path.join(path.dirname(exe),'resources','app.asar','dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');
  const launcher=path.join(path.dirname(exe),'resources','runtime','cli','bin','dsh.cmd');if(!fs.existsSync(launcher))throw Error('此DSH未提供官方Desktop CLI，请更新或手动导入');
  const {stdout}=await exec('tasklist.exe',['/FI','IMAGENAME eq DeepSeek Harness.exe','/FO','CSV','/NH'],{windowsHide:true,timeout:5000});if(/"DeepSeek Harness\.exe"/i.test(stdout))throw Error('请先从系统托盘完整退出DSH，再导入；小鱼不会替你退出');
  engines.save({executable:exe});const dir=path.join(root,'integrations','dsh');const row=[{id:'xiaoyu-dsh-bridge',name:pathToFileURL(path.join(dir,'index.mjs')).href,config:{configFile:engines.file}}];fs.writeFileSync(path.join(dir,'cordis.patch.yml'),'- insert: '+JSON.stringify(row)+'\n');
  try{await exec(exe,['--expose-internals',cli,'plugin','--profile','desktop','add',dir],{cwd:path.dirname(exe),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:''},windowsHide:true,timeout:180000,maxBuffer:100000});return {imported:true,restartRequired:true};}
  catch(e){const output=(String(e.stderr??'')+' '+String(e.stdout??'')).replaceAll(engines.config.token,'[redacted]');fs.writeFileSync(path.join(root,'data','dsh-import-diagnostic.log'),output,{mode:0o600});if(/uninitialized|initialize.*profile|Open DeepSeek Harness Desktop once/i.test(output))throw Error('请先打开DSH完成官方首次初始化，再退出后导入');if(/incompatible(?:-version|.*version)|unsatisfied.*peer|allow-version/i.test(output))throw Error('DSH与插件SDK版本不匹配，未忽略兼容性检查');if(e.killed)throw Error('导入超时，请先在DSH插件页核对结果，避免重复安装');throw Error('官方插件导入未完成，请检查网络、程序版本与DSH是否已退出');}
}
export function openDsh(engines){const exe=engines.config.executable||detectDsh();if(!exe||!fs.existsSync(exe))throw Error('请先安装DSH或保存程序位置');const c=spawn(exe,[],{windowsHide:true,stdio:'ignore',detached:true});c.on('error',()=>{});c.unref();return {opened:true};}
