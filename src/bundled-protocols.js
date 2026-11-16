import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readZip} from './meme-zip.js';

const MAX_ARCHIVE=200*1024*1024,MAX_TOTAL=1024*1024*1024,MAX_ENTRY=512*1024*1024,MAX_ENTRIES=5000;
const REQUIRED={snowluma:['index.mjs','node.exe','EULA.md'],napcat:['napcat.bat','index.js','node.exe']};
const TARGETS={snowluma:'SnowLuma',napcat:'NapCat'};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export class BundledProtocols {
  constructor(dataDir,{projectRoot=path.resolve(import.meta.dirname,'..'),resourcesPath=process.resourcesPath,log=()=>{},enabled}={}){
    this.base=path.resolve(dataDir);this.project=path.resolve(projectRoot);this.resources=resourcesPath;
    this.log=log;this.directory=path.join(this.base,'protocols');this.promise=null;
    const packaged=!!resourcesPath&&fs.existsSync(path.join(resourcesPath,'protocols','manifest.json'));
    this.enabled=enabled??(packaged||process.env.XIAOYU_BUNDLED_PROTOCOLS==='1');
    this.status=this.enabled?{state:'idle',detail:'尚未检查内置QQ协议包',archives:[]}:{state:'source',detail:'源码运行不自动释放内置协议包；打包版首次启动会自动准备',archives:[]};
  }
  archiveDirectory(){
    const packaged=this.resources&&path.join(this.resources,'protocols');
    if(packaged&&fs.existsSync(path.join(packaged,'manifest.json')))return packaged;
    return path.join(this.project,'vendor','protocols');
  }
  manifest(){
    const file=path.join(this.archiveDirectory(),'manifest.json');
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(data?.format!==1||!Array.isArray(data.archives)||!data.archives.length||data.archives.length>8)throw Error('内置QQ协议包清单无效');
    return data;
  }
  paths(){
    const found={snowluma:'',napcat:''};
    for(const [id,files]of Object.entries(REQUIRED)){
      const dir=path.join(this.directory,TARGETS[id]);
      if(files.every(file=>fs.existsSync(path.join(dir,file))))found[id]=dir;
    }
    return found;
  }
  state(){return {...this.status,enabled:this.enabled,archives:this.status.archives.map(item=>({...item}))};}
  ensure(){
    if(!this.enabled){this.status={state:'source',detail:'源码运行不自动释放内置协议包；打包版首次启动会自动准备',archives:[]};return Promise.resolve(this.state());}
    if(!this.promise)this.promise=Promise.resolve().then(()=>this.installAll()).catch(error=>{
      this.status={state:'failed',detail:String(error.message).slice(0,300),archives:this.status.archives};
      this.log('内置QQ协议包准备失败：'+this.status.detail);
      return this.state();
    });
    return this.promise;
  }
  async installAll(){
    let manifest;
    try{manifest=this.manifest();}catch(error){this.status={state:'missing',detail:'安装包未携带QQ协议端，可继续使用已安装的原版目录',archives:[]};return this.state();}
    this.status={state:'extracting',detail:'正在准备内置QQ协议端',archives:manifest.archives.map(a=>({id:a.id,version:a.version,state:'pending',detail:''}))};
    for(const archive of manifest.archives){
      const record=this.status.archives.find(item=>item.id===archive.id);
      try{
        await this.installOne(archive);
        Object.assign(record,{state:'ready',detail:'已准备'});
      }catch(error){
        Object.assign(record,{state:'failed',detail:String(error.message).slice(0,240)});
        this.log('内置'+archive.id+'准备失败：'+record.detail);
      }
    }
    const failed=this.status.archives.filter(item=>item.state==='failed');
    this.status={state:failed.length?'failed':'ready',detail:failed.length?'部分内置协议端未准备好，可在QQ接入页手动选择目录':'内置QQ协议端已就绪',archives:this.status.archives};
    return this.state();
  }
  async installOne(archive){
    if(!archive||!/^[a-z0-9-]{1,32}$/.test(archive.id)||!/^[\w.-]{1,120}$/.test(archive.file)||!/^[A-Za-z0-9._-]{1,64}$/.test(archive.target)||!/^[a-f0-9]{64}$/.test(archive.sha256))throw Error('内置协议包清单字段无效');
    const required=REQUIRED[archive.id];
    if(!required||archive.target!==TARGETS[archive.id])throw Error('未知内置协议包：'+archive.id);
    const target=path.join(this.directory,archive.target);
    if(required.every(file=>fs.existsSync(path.join(target,file)))){return target;}
    const file=path.join(this.archiveDirectory(),archive.file);
    if(!fs.existsSync(file))throw Error('缺少安装包文件：'+archive.file);
    const bytes=fs.readFileSync(file);
    if(bytes.length>MAX_ARCHIVE)throw Error('内置协议包过大');
    if(sha256(bytes)!==archive.sha256)throw Error('内置协议包SHA-256不匹配');
    const entries=readZip(bytes,{maxEntryLength:MAX_ENTRY,maxTotal:MAX_TOTAL,maxEntries:MAX_ENTRIES});
    const staging=target+'.tmp-'+process.pid+'-'+Date.now();
    try{
      fs.rmSync(staging,{recursive:true,force:true});fs.mkdirSync(staging,{recursive:true});
      for(const entry of entries.values()){
        const name=entry.name;
        const full=path.join(staging,...name.split('/'));
        if(full!==staging&&!full.startsWith(staging+path.sep))throw Error('内置协议包路径越界');
        if(name.endsWith('/')){fs.mkdirSync(full,{recursive:true});continue;}
        fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,entry.read());
      }
      if(!required.every(name=>fs.existsSync(path.join(staging,name))))throw Error('内置协议包缺少必要文件');
      fs.rmSync(target,{recursive:true,force:true});fs.renameSync(staging,target);
      fs.writeFileSync(path.join(target,'.xiaoyu-bundled.json'),JSON.stringify({id:archive.id,version:archive.version,sha256:archive.sha256,installedAt:new Date().toISOString()},null,2));
      return target;
    }finally{fs.rmSync(staging,{recursive:true,force:true});}
  }
}
