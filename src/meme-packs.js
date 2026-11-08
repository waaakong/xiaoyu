import {isEmojiEntries,importEmojiEntries,exportEmojiZip} from './emoji-packs.js';
import {TWEMOJI_ENTRY,TWEMOJI_SOURCE,twemojiArchive} from './emoji-twemoji.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readZip,writeZip,safeEntry,MAX_ZIP} from './meme-zip.js';
import {imageInfo,MAX_IMAGE} from './media.js';
import {moodOf} from './meme-search.js';
import {remoteBytes,remoteUrl} from './meme-remote.js';
const imagePattern=/\.(png|jpe?g|webp|gif)$/i;
const starter={id:'dafeiyu-001',name:'大肥鱼',version:'1.3.0',count:24,description:'上游dsh-meme自带的24张鲸鱼娘表情',license:'personal',sha256:'9fca6a4fc101232b39ab79181b9ed1b12289cf4890b3fadac89576545e51b3a4',archiveUrl:'https://github.com/yyh-001/dsh-meme-packs/releases/download/dafeiyu-001-v1.3.0/dafeiyu-001-v1.3.0.zip'};
export function contained(root,relative){
  safeEntry(relative);const full=path.resolve(root,relative),base=path.resolve(root);if(!full.startsWith(base+path.sep))throw new Error('图包路径越界');
  if(fs.lstatSync(full).isSymbolicLink())throw new Error('图包不接受符号链接');const real=fs.realpathSync(full),canonical=fs.realpathSync(base);if(!real.startsWith(canonical+path.sep))throw new Error('图包实际路径越界');return real;
}
export class PackManager {
  constructor(media,dataDir,{download=remoteBytes}={}){this.media=media;this.dir=path.join(dataDir,'pack-cache');fs.mkdirSync(this.dir,{recursive:true});this.download=download;this.jobs=new Map();this.catalogCache=null;}
  state(){return [...this.jobs.values()].map(({controller,...job})=>job).slice(-12);}
  begin(label,work){if([...this.jobs.values()].some(j=>j.status==='running'))throw new Error('已有图库任务正在进行');const id=crypto.randomUUID(),job={id,label,status:'running',progress:'准备中',created:Date.now(),controller:new AbortController()};this.jobs.set(id,job);for(const [key,j]of [...this.jobs].slice(0,-12))if(j.status!=='running')this.jobs.delete(key);Promise.resolve().then(()=>work(job.controller.signal,text=>{job.progress=text;})).then(result=>{job.result=result;job.status='done';job.progress='完成';}).catch(e=>{job.status=job.controller.signal.aborted?'cancelled':'failed';job.error=job.controller.signal.aborted?'任务已取消':String(e.message).slice(0,240);});return {id};}
  cancel(id){const job=this.jobs.get(id);if(job?.status==='running')job.controller.abort();}
  async close(){for(const job of this.jobs.values())job.controller.abort();while([...this.jobs.values()].some(j=>j.status==='running'))await new Promise(r=>setTimeout(r,20));}
  async catalog({refresh=false,signal}={}){
    if(this.catalogCache&&!refresh&&Date.now()-this.catalogCache.at<3600000)return this.catalogCache;
    const file=path.join(this.dir,'catalog.json');let cached;try{cached=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    try{
      const bytes=await this.download('https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json',{maxBytes:2*1024*1024,timeoutMs:8000,signal});const data=JSON.parse(bytes.toString('utf8')),items=Array.isArray(data)?data:data.packs;
      if(!Array.isArray(items)||items.length>200)throw new Error('图库目录格式无效');
      const entries=items.filter(x=>/^[a-z0-9_-]{1,40}$/.test(x.id)&&typeof x.name==='string').map(x=>({id:x.id,name:x.name.slice(0,60),description:String(x.description??'').slice(0,200),version:String(x.version??'').slice(0,40),count:Math.min(500,Number(x.count)||0),license:String(x.license??'未提供').slice(0,100),archiveUrl:x.archiveUrl,sha256:x.sha256,supported:!!x.archiveUrl&&/^[a-f0-9]{64}$/.test(x.sha256??'')}));
      this.catalogCache={at:Date.now(),entries,cached:false};fs.writeFileSync(file,JSON.stringify(this.catalogCache));
    }catch(e){this.catalogCache={at:Date.now(),entries:cached?.entries??[starter],cached:true,warning:'目录暂不可达，使用本地目录快照'};this.catalogCache.entries=this.catalogCache.entries.map(x=>({...x,supported:!!x.archiveUrl&&/^[a-f0-9]{64}$/.test(x.sha256??'')}));}
    this.catalogCache.entries=[TWEMOJI_ENTRY,...this.catalogCache.entries.filter(x=>x.id!==TWEMOJI_ENTRY.id)];return this.catalogCache;
  }
  install(id){if(id===TWEMOJI_ENTRY.id)return this.begin('安装Twemoji 40语义库',async(signal,progress)=>{const bytes=await twemojiArchive(this.download,this.dir,{signal,progress});return this.importZip(bytes,{source:TWEMOJI_SOURCE,expectedId:'twemoji-core',signal,progress});});return this.begin('安装图库',async(signal,progress)=>{const directory=await this.catalog({signal});if(signal.aborted)throw new Error('任务已取消');const item=directory.entries.find(x=>x.id===id);if(!item?.supported)throw new Error('该图库没有可校验ZIP，请使用本地导入');remoteUrl(item.archiveUrl);const source=item.archiveUrl+'#sha256='+item.sha256;
    const old=this.media.store.libraries().find(l=>l.source===source);if(old&&old.count&&(!item.count||old.count===item.count)&&this.media.store.meta('meme-pack-complete:'+old.id)===source){this.media.saveLibrary({id:old.id,enabled:true});return {libraryId:old.id,imported:0,duplicates:old.count,warnings:[]};}
    progress('下载并校验图包…');const bytes=await this.download(item.archiveUrl,{maxBytes:MAX_ZIP,signal,progress:(n,total)=>progress('下载 '+Math.round(n/1024)+'KB'+(total?' / '+Math.round(total/1024)+'KB':''))});if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('图包SHA-256不匹配，未导入');
    const result=await this.importZip(bytes,{name:item.name,source,license:item.license,expectedId:item.id,signal,progress,...(old?{libraryId:old.id}:{})});if(signal.aborted)throw new Error('任务已取消');this.media.saveLibrary({id:result.libraryId,enabled:true});this.media.store.meta('meme-pack-complete:'+result.libraryId,source);return result;});}
  async importZip(bytes,options={}){return this.importEntries(readZip(bytes),{...options,archiveBytes:bytes.length});}
  async importDirectory(root,options={}){
    if(typeof root!=='string'||!path.isAbsolute(root)||fs.lstatSync(root).isSymbolicLink()||!fs.statSync(root).isDirectory())throw new Error('请选择绝对路径的图库目录');root=fs.realpathSync(root);const candidates=[root,...fs.readdirSync(root,{withFileTypes:true}).filter(f=>f.isDirectory()&&!f.isSymbolicLink()&&!f.name.startsWith('.')).map(f=>path.join(root,f.name))];const emojiLayout=candidates.some(p=>fs.existsSync(path.join(p,'pack.json'))||fs.existsSync(path.join(p,'.dsh-emoji-pack.json')));const entries=new Map();let size=0;
    const walk=(folder,depth=0)=>{if(depth>8)throw new Error('图库目录层级过深');for(const file of fs.readdirSync(folder,{withFileTypes:true})){if(file.name.startsWith('.')&&!['.dsh-emoji-pack.json','.removed','.DS_Store'].includes(file.name)||file.name==='node_modules')continue;const full=path.join(folder,file.name);if(file.isSymbolicLink())throw new Error('图库中含符号链接');const rel=path.relative(root,full).split(path.sep).join('/');if(file.isDirectory())walk(full,depth+1);else if(file.isFile()&&(emojiLayout||imagePattern.test(rel)||['index.db','manifest.json','pack.json','.dsh-emoji-pack.json','LICENSE','LICENSE.txt'].includes(file.name))){const real=contained(root,rel),st=fs.statSync(real);if(st.size>(rel==='index.db'?32*1024*1024:MAX_IMAGE))throw new Error('图包文件过大：'+file.name);size+=st.size;if(size>MAX_ZIP||entries.size>=1600)throw new Error('图库最多200MB/1600条目');entries.set(rel,{name:rel,length:st.size,read:()=>fs.readFileSync(contained(root,rel))});}}};walk(root);
    return this.importEntries(entries,{...options,name:options.name||path.basename(root),source:options.source||'本地目录：'+root});
  }
  async importEntries(entries,{name='',scope='',source='本地ZIP导入',license='',expectedId='',signal,progress=()=>{},libraryId,archiveBytes}={}){
    if(isEmojiEntries(entries))return importEmojiEntries(this.media,entries,{name,scope,source,license,expectedId,signal,progress,libraryId,archiveBytes});
    let prefix='';const indexes=[...entries.keys()].filter(x=>/(^|\/)index\.db$/.test(x));if(indexes.length>1)throw new Error('ZIP包含多个图库，请分别导入');if(indexes.length)prefix=indexes[0].slice(0,-'index.db'.length);
    else{const manifests=[...entries.keys()].filter(x=>/(^|\/)manifest\.json$/.test(x));if(manifests.length===1)prefix=manifests[0].slice(0,-'manifest.json'.length);}
    let meta={};const manifest=entries.get(prefix+'manifest.json');if(manifest){if(manifest.length>64000)throw new Error('图库清单过大');meta=JSON.parse(manifest.read().toString('utf8'));if(!meta||typeof meta!=='object'||Array.isArray(meta))throw new Error('图库清单格式无效');}
    if(expectedId&&meta.id!==expectedId)throw new Error('图库ID与市场目录不一致');
    let rows;const index=entries.get(prefix+'index.db');
    if(index){const tmp=path.join(this.dir,crypto.randomUUID()+'.db');try{fs.writeFileSync(tmp,index.read());const db=new DatabaseSync(tmp,{readOnly:true});try{db.exec('PRAGMA trusted_schema=OFF;PRAGMA query_only=ON;');if(db.prepare("SELECT type FROM sqlite_master WHERE name='memes'").get()?.type!=='table')throw new Error('索引缺少memes数据表');rows=db.prepare('SELECT substr(path,1,1025) AS path,substr(tag,1,80) AS tag,substr(file_name,1,160) AS file_name,substr(caption,1,201) AS caption,substr(keywords,1,1000) AS keywords FROM memes LIMIT 501').all();}finally{db.close();}}finally{fs.rmSync(tmp,{force:true});}}
    else rows=[...entries.keys()].filter(x=>x.startsWith(prefix)&&imagePattern.test(x)).map(x=>({path:x.slice(prefix.length),tag:x.split('/').at(-2)??'daily',file_name:path.posix.basename(x),caption:'',keywords:''}));
    if(!rows.length||rows.length>500)throw new Error('单个图库应为1—500张图片');
    // Validate every indexed path before adding anything, even if a file is missing.
    for(const row of rows)safeEntry(String(row.path));
    const old=libraryId?this.media.store.library(libraryId):null;if(libraryId&&!old)throw new Error('扫描目标图库不存在');
    const lib=old??this.media.saveLibrary({name:String(name||meta.name||'导入图库').slice(0,60),description:String(meta.description??'').slice(0,200),source:String(source==='本地ZIP导入'&&meta.source?source+'；原来源：'+meta.source:source).slice(0,1000),license:String(license||meta.license||'来源未声明；请核对使用范围').slice(0,12000),scope,enabled:false});
    let imported=0,duplicates=0;const warnings=[];
    try{for(const [i,row]of rows.entries()){
      if(signal?.aborted)throw new Error('任务已取消');progress(`导入 ${i+1}/${rows.length}`);
      const rel=String(row.path),entry=entries.get(prefix+rel);if(!entry||!imagePattern.test(rel)){warnings.push(rel.slice(0,120)+'：图片不存在或格式不支持');continue;}
      try{if(entry.length>MAX_IMAGE)throw new Error('超过5MB');const bytes=entry.read();await imageInfo(bytes);let words=[];if(typeof row.keywords==='string'){try{const parsed=JSON.parse(row.keywords);words=Array.isArray(parsed)?parsed:row.keywords.split(/[\s,，]+/u);}catch{words=row.keywords.split(/[\s,，]+/u);}}else if(Array.isArray(row.keywords))words=row.keywords;
        const tags=[row.tag,...words].filter(x=>typeof x==='string'&&x.trim()).map(x=>x.slice(0,30)).slice(0,15),caption=String(row.caption??'').slice(0,200),a=await this.media.import({libraryId:lib.id,name:String(caption||row.file_name||path.posix.basename(rel)).slice(0,80),caption,mood:moodOf(row.tag),tags,kind:'sticker',base64:bytes.toString('base64')});if(a.duplicate)duplicates++;else imported++;
      }catch(e){warnings.push(rel.slice(0,120)+'：'+String(e.message).slice(0,120));}
    }
      if(!imported&&!duplicates)throw new Error('没有可导入的有效图片');const skipped=warnings.length;if(!old){const declared=!!String(license||meta.license||'').trim();this.media.saveLibrary({id:lib.id,enabled:declared});if(!declared)warnings.push('来源未声明许可，图库已保持停用；请核对来源后手动启用。');}return {libraryId:lib.id,imported,duplicates,skipped,warnings:warnings.slice(0,30)};
    }catch(e){if(!old)this.media.saveLibrary({id:lib.id,enabled:false});throw e;}
  }
  async exportZip(id,{version}={}){
    const library=this.media.store.library(id);if(!library)throw new Error('图库不存在');if(library.format==='dsh-emoji')return exportEmojiZip(this.media,id,{version});const rows=this.media.store.assets().filter(a=>a.libraryId===id);if(!rows.length||rows.length>500)throw new Error('可导出1—500张图片');
    const temp=path.join(this.dir,crypto.randomUUID()+'.db'),db=new DatabaseSync(temp),files=[];
    try{db.exec('CREATE TABLE memes(path TEXT PRIMARY KEY,tag TEXT,file_name TEXT,caption TEXT,keywords TEXT,mtime REAL,captioned_at REAL)');const insert=db.prepare('INSERT INTO memes VALUES(?,?,?,?,?,?,?)');for(const a of rows){const rel=`memes/${a.mood}/${a.id}.${a.ext}`;insert.run(rel,a.mood,`${a.id}.${a.ext}`,a.caption||a.name,a.tags.join(' '),Date.now(),Date.now());files.push([rel,this.media.read(a.id).bytes]);}}finally{db.close();}
    try{files.push(['index.db',fs.readFileSync(temp)],['manifest.json',Buffer.from(JSON.stringify({id:library.id,name:library.name,description:library.description,version:'1.0.0',source:library.source,license:library.license},null,2))]);return writeZip(files);}finally{fs.rmSync(temp,{force:true});}
  }
  detect({dshHome=process.env.DSH_HOME||path.join(os.homedir(),'.dsh')}={}){const roots=[],base=path.join(dshHome,'meme-packs');if(fs.existsSync(base))roots.push(base);const profiles=path.join(dshHome,'profiles');if(fs.existsSync(profiles))for(const f of fs.readdirSync(profiles).slice(0,30)){const memes=path.join(profiles,f,'node_modules','dsh-meme','memes');if(fs.existsSync(memes))roots.push(memes);}const packs=[];for(const root of roots)for(const f of fs.readdirSync(root,{withFileTypes:true}).slice(0,100))if(f.isDirectory()&&!f.isSymbolicLink()){const p=path.join(root,f.name);if(fs.existsSync(path.join(p,'index.db')))packs.push({name:f.name,path:p});}const emojiRoot=path.join(dshHome,'emoji-packs');if(fs.existsSync(emojiRoot)&&!fs.lstatSync(emojiRoot).isSymbolicLink())for(const id of fs.readdirSync(emojiRoot,{withFileTypes:true}).slice(0,100)){if(!id.isDirectory()||id.isSymbolicLink()||id.name.startsWith('.'))continue;const idPath=path.join(emojiRoot,id.name);for(const version of fs.readdirSync(idPath,{withFileTypes:true}).slice(0,30)){if(!version.isDirectory()||version.isSymbolicLink()||version.name.startsWith('.'))continue;const p=path.join(idPath,version.name);if(!fs.existsSync(path.join(p,'.removed'))&&(fs.existsSync(path.join(p,'.dsh-emoji-pack.json'))||fs.existsSync(path.join(p,'pack.json'))))packs.push({name:id.name+'@'+version.name,path:p,format:'dsh-emoji'});}}return packs;}
}
