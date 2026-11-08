import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {UV,INDEXES,PYTHON_VERSION} from './dependency-catalog.js';
import {downloadVerified} from './dependency-io.js';
import {readZip} from './meme-zip.js';
import {SPEECH_ASSETS,SPEECH_PACKAGES,SPEECH_SIGNATURE,speechInstalled,speechModel} from './speech-assets.js';

export async function installSpeech(center,index,signal){
  const {base}=center,python=path.join(base,'speech-env','Scripts','python.exe'),model=speechModel(base);
  if(speechInstalled(base)){center.stage('语音环境已存在，执行本地自检');const text=await center.runner(python,[path.join(center.project,'scripts','speech-worker.py'),'--base',base,'--self-test'],{signal,timeoutMs:120000});const result=JSON.parse(text.trim().split('\n').at(-1));if(!result.ok)throw Error('语音环境自检失败');return;}
  if(center.canInstallSpeech&&!center.canInstallSpeech())throw Error('语音识别正在运行，请先关闭语音输入并等待任务结束');
  center.managedPath(path.join(base,'speech-env'));center.managedPath(path.join(base,'speech'));fs.mkdirSync(model,{recursive:true});
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^UV_/i.test(k)&&!/^PIP_(INDEX_URL|EXTRA_INDEX_URL|CONFIG_FILE)$/i.test(k)));
  const env={...inherited,UV_CACHE_DIR:path.join(os.tmpdir(),'Low','xyspeech-'+crypto.createHash('sha256').update(base).digest('hex').slice(0,10)),UV_PYTHON_INSTALL_DIR:path.join(base,'runtimes','python'),UV_PYTHON_INSTALL_BIN:'0',UV_PYTHON_INSTALL_REGISTRY:'0',UV_NO_CONFIG:'1',UV_NO_PROGRESS:'1',UV_HTTP_TIMEOUT:'15',UV_HTTP_RETRIES:'1',PYTHONUTF8:'1'};
  const run=(exe,args,timeoutMs=600000)=>center.runner(exe,args,{cwd:base,env,signal,timeoutMs,onLine:s=>center.line(s)});
  center.stage('准备独立语音安装工具');const archive=path.join(center.directory,'uv-'+UV.version+'.zip');await downloadVerified(UV,archive,{signal,fetcher:center.fetcher,progress:p=>Object.assign(center.job,p)});const entries=[...readZip(fs.readFileSync(archive),{maxEntryLength:100*1024*1024}).values()].filter(e=>e.name==='uv.exe'||e.name.endsWith('/uv.exe'));if(entries.length!==1)throw Error('uv归档无效');const uv=path.join(center.directory,'uv-'+UV.version+'.exe');fs.writeFileSync(uv,entries[0].read());
  let managed=center.managedPython();if(!managed){center.stage('准备语音所需Python');await run(uv,['python','install',PYTHON_VERSION,'--no-bin','--no-registry','--no-config'],300000);managed=center.managedPython();if(!managed)throw Error('未找到独立Python');}
  if(!fs.existsSync(python)){center.stage('创建独立语音环境');const dir=path.dirname(path.dirname(python)),marker=path.join(center.directory,'owned-speech-environment.json');if(fs.existsSync(dir)&&!fs.existsSync(marker))throw Error('已有不完整speech-env，请先检查目录，未覆盖');fs.writeFileSync(marker,JSON.stringify({path:dir}));await run(uv,['venv',dir,'--python',managed,'--seed','--allow-existing','--no-config','--index-url',INDEXES[index]],180000);}
  center.stage('安装CPU识别与音频解码依赖');await run(uv,['pip','install','--python',python,'--index-url',INDEXES[index],...SPEECH_PACKAGES,'--no-config']);await run(python,['-I','-m','pip','check'],30000);
  for(const asset of SPEECH_ASSETS){center.stage('下载并校验语音模型：'+asset.name);await downloadVerified(asset,path.join(model,asset.name),{signal,fetcher:center.fetcher,maxBytes:260*1024*1024,domains:['modelscope.cn','.modelscope.cn'],progress:p=>Object.assign(center.job,p,{updated:new Date().toISOString()})});}
  center.stage('实际运行本地语音自检');const output=await run(python,[path.join(center.project,'scripts','speech-worker.py'),'--base',base,'--self-test'],120000);let result;try{result=JSON.parse(output.trim().split('\n').at(-1));}catch{}if(!result?.ok||!result.text)throw Error('语音模型实际转写自检未通过');
  fs.writeFileSync(path.join(base,'speech','installed.json'),JSON.stringify({signature:SPEECH_SIGNATURE,time:new Date().toISOString(),packages:SPEECH_PACKAGES,source:'iic/SenseVoiceSmall-onnx',emotionTagsVerified:!!result.tagged}),{mode:0o600});
}
