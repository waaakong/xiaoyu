import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import source from './emoji-expanded-source.json' with {type:'json'};
import {EXPANDED_EMOJIS} from './emoji-expanded.js';
import {writeZip} from './meme-zip.js';
export const EXPANDED_ENTRY={id:'twemoji-expanded-37',name:'Twemoji · 37情绪扩展',description:'37个补充情绪语义，覆盖得意、调皮、恼火、委屈、累等细分心情；不改变 dsh-emoji 40 语义契约。',version:'1.0.0',count:37,license:'CC-BY-4.0',provider:'twemoji',supported:true};
export const EXPANDED_SOURCE='https://github.com/jdecked/twemoji/tree/'+source.revision;
export const EXPANDED_LICENSE=source.attribution;
function blobHash(bytes){return crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
export async function expandedTwemojiArchive(download,cacheDir,{signal,progress=()=>{}}={}){
  async function verified(file,gitSha){
    if(signal?.aborted)throw new Error('任务已取消');const cached=path.join(cacheDir,'twemoji-'+gitSha+'.bin');let bytes;try{bytes=fs.readFileSync(cached);if(blobHash(bytes)!==gitSha)bytes=null;}catch{}
    if(!bytes){bytes=await download('https://raw.githubusercontent.com/jdecked/twemoji/'+source.revision+'/'+file,{signal,maxBytes:2*1024*1024});if(blobHash(bytes)!==gitSha)throw new Error('Twemoji扩展文件校验不匹配，未安装');if(signal?.aborted)throw new Error('任务已取消');fs.writeFileSync(cached,bytes);}return bytes;
  }
  progress('核对Twemoji扩展素材许可…');await verified(source.licensePath,source.licenseGitSha);
  const images=new Map(),rows=[];let count=0;
  for(let i=0;i<source.files.length;i+=4){const batch=source.files.slice(i,i+4);const outcomes=await Promise.allSettled(batch.map(async f=>{const bytes=await verified(f.path,f.gitSha);images.set(f.key,bytes);progress('下载并校验 '+Math.min(source.files.length,++count)+'/37');}));const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;}
  for(const e of EXPANDED_EMOJIS){const f=source.files.find(x=>x.key===e.key);if(!f)throw new Error('扩展语义缺少素材：'+e.key);rows.push({path:'memes/'+e.mood+'/'+e.key+'.png',tag:e.mood,file_name:e.key+'.png',caption:e.label+' · '+e.key,keywords:JSON.stringify([e.label,...e.terms])});}
  const temp=path.join(cacheDir,crypto.randomUUID()+'.db'),db=new DatabaseSync(temp),files=[];
  try{db.exec('CREATE TABLE memes(path TEXT PRIMARY KEY,tag TEXT,file_name TEXT,caption TEXT,keywords TEXT,mtime REAL,captioned_at REAL)');const insert=db.prepare('INSERT INTO memes VALUES(?,?,?,?,?,?,?)');for(const row of rows)insert.run(row.path,row.tag,row.file_name,row.caption,row.keywords,Date.now(),Date.now());files.push(['index.db',fs.readFileSync(temp)]);}finally{db.close();fs.rmSync(temp,{force:true});}
  files.push(['manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,id:'twemoji-expanded',name:EXPANDED_ENTRY.name,description:EXPANDED_ENTRY.description,version:EXPANDED_ENTRY.version,count:EXPANDED_ENTRY.count,license:source.attribution,source:EXPANDED_SOURCE},null,2))]);
  for(const row of rows)files.push([row.path,images.get(row.file_name.slice(0,-4))]);
  return writeZip(files);
}
