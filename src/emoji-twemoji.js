import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import source from './twemoji-source.json' with {type:'json'};
import {writeZip} from './meme-zip.js';
import {EMOJI_KEY_SET} from './emoji-core.js';
export const TWEMOJI_ENTRY={id:'twemoji-core-40',name:'Twemoji · 40语义',description:'兼容dsh-emoji的40个固定语义，保留作者署名；下载后本地使用，无额外模型调用。',version:'1.0.0',count:40,license:'CC-BY-4.0',provider:'twemoji',supported:true};
export const TWEMOJI_SOURCE='https://github.com/jdecked/twemoji/tree/'+source.revision;
function blobHash(bytes){return crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
export async function twemojiArchive(download,cacheDir,{signal,progress=()=>{}}={}){
  async function verified(file,gitSha){
    if(signal?.aborted)throw new Error('任务已取消');const cached=path.join(cacheDir,'twemoji-'+gitSha+'.bin');let bytes;try{bytes=fs.readFileSync(cached);if(blobHash(bytes)!==gitSha)bytes=null;}catch{}
    if(!bytes){bytes=await download('https://raw.githubusercontent.com/jdecked/twemoji/'+source.revision+'/'+file,{signal,maxBytes:2*1024*1024});if(blobHash(bytes)!==gitSha)throw new Error('Twemoji文件校验不匹配，未安装');if(signal?.aborted)throw new Error('任务已取消');fs.writeFileSync(cached,bytes);}return bytes;
  }
  progress('核对Twemoji素材许可…');await verified(source.licensePath,source.licenseGitSha);
  const files=[['pack.json',Buffer.from(JSON.stringify({schemaVersion:1,keySet:EMOJI_KEY_SET,id:'twemoji-core',name:TWEMOJI_ENTRY.name,version:TWEMOJI_ENTRY.version,displayMode:'block',license:source.attribution,source:TWEMOJI_SOURCE},null,2))]],images=new Map();let count=0;
  for(let i=0;i<source.files.length;i+=4){const batch=source.files.slice(i,i+4);const outcomes=await Promise.allSettled(batch.map(async f=>{const bytes=await verified(f.path,f.gitSha);images.set(f.key,bytes);progress(`下载并校验 ${++count}/40`);}));const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;}
  for(const f of source.files)files.push(['images/'+f.key+'.png',images.get(f.key)]);return writeZip(files);
}
