import crypto from 'node:crypto';
import sharp from 'sharp';
import {crc32} from 'node:zlib';
import {EMOJI_CORE,EMOJI_KEY_SET,EMOJI_VERSION} from './emoji-core.js';
import {writeZip} from './meme-zip.js';
const MiB=1024*1024;
const idPattern=/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export function emojiManifest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.keySet!==EMOJI_KEY_SET)throw new Error('不支持的dsh-emoji格式或keySet');
  if(typeof value.id!=='string'||!idPattern.test(value.id)||value.id==='deepseek'||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.version!=='string'||value.version.length>100||!EMOJI_VERSION.test(value.version)||value.displayMode!==undefined&&!['inline','block'].includes(value.displayMode))throw new Error('dsh-emoji图包的ID、名称、版本或展示方式无效');
  for(const key of ['license','source'])if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>(key==='license'?12000:1000)))throw new Error('图包来源信息过长或无效');
  return {schemaVersion:1,keySet:EMOJI_KEY_SET,id:value.id,name:value.name.trim(),version:value.version,displayMode:value.displayMode??'inline',...(value.license?{license:value.license}:{}),...(value.source?{source:value.source}:{})};
}
export async function validateEmojiPng(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>2*MiB||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('语义图必须是真实PNG，单图不超过2MiB');
  let position=8,ended=false;while(position<bytes.length){if(position+12>bytes.length)throw new Error('PNG文件不完整');const n=bytes.readUInt32BE(position);if(position+12+n>bytes.length||crc32(bytes.subarray(position+4,position+8+n))!==bytes.readUInt32BE(position+8+n))throw new Error('PNG区块CRC或长度无效');const type=bytes.toString('ascii',position+4,position+8);position+=12+n;if(type==='IEND'){ended=true;break;}}
  if(!ended||position!==bytes.length)throw new Error('PNG文件结尾无效');
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:512*512}),meta=await image.metadata();if(meta.format!=='png'||!meta.width||!meta.height||meta.width>512||meta.height>512||(meta.pages??1)!==1)throw new Error('语义PNG宽高不能超过512，且必须为单张图片');await image.stats();return meta;
}
export function isEmojiEntries(entries){return [...entries.keys()].some(p=>/(^|\/)(?:pack\.json|\.dsh-emoji-pack\.json)$/.test(p));}
function ignored(name){return name.endsWith('/')||name.split('/').some(p=>p==='__MACOSX'||p==='.DS_Store');}
function cancelled(signal){if(signal?.aborted)throw new Error('任务已取消');}
export async function importEmojiEntries(media,entries,{scope='',name='',license='',source='本地ZIP导入',libraryId,archiveBytes,expectedId='',signal,progress=()=>{}}={}){
  if(archiveBytes>20*MiB)throw new Error('dsh-emoji ZIP最多20MiB');
  const folded=new Set();let total=0;for(const [name,entry]of entries){const key=name.toLowerCase();if(folded.has(key))throw new Error('语义图包含大小写重复路径');folded.add(key);if(!ignored(name)){total+=entry.length;if(entry.length>2*MiB||total>80*MiB)throw new Error('dsh-emoji单文件最多2MiB、总大小最多80MiB');}}
  const paths=[...entries.keys()].filter(p=>!ignored(p)),headers=paths.filter(p=>/(^|\/)(?:pack\.json|\.dsh-emoji-pack\.json)$/.test(p));
  const rawHeaders=headers.filter(p=>p.endsWith('pack.json')&&!p.endsWith('.dsh-emoji-pack.json'));const choices=rawHeaders.length?rawHeaders:headers;
  if(choices.length!==1)throw new Error('请选择一个完整的dsh-emoji图包');const header=choices[0],prefix=header.slice(0,header.lastIndexOf('/')+1);if(prefix&&prefix.slice(0,-1).includes('/'))throw new Error('dsh-emoji ZIP只支持单层包装目录');
  const entry=entries.get(header);if(entry.length>32000)throw new Error('pack.json清单过大');const manifest=emojiManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entry.read()))),installed=header.endsWith('.dsh-emoji-pack.json');if(expectedId&&manifest.id!==expectedId)throw new Error('图包ID与来源不一致');
  const allowed=new Set([header,...EMOJI_CORE.map(e=>prefix+'images/'+e.key+'.png')]);if(installed)allowed.add(prefix+'.removed');else if(entries.has(prefix+'.dsh-emoji-pack.json'))allowed.add(prefix+'.dsh-emoji-pack.json');
  const extra=paths.find(p=>!allowed.has(p));if(extra)throw new Error('dsh-emoji包含额外文件：'+extra.slice(0,120));
  const images=new Map(),hash=crypto.createHash('sha256').update(JSON.stringify(manifest));
  for(const [i,e]of EMOJI_CORE.entries()){cancelled(signal);progress(`校验语义 ${i+1}/40 · ${e.label}`);const image=entries.get(prefix+'images/'+e.key+'.png');if(!image)throw new Error('缺少语义图片：'+e.key);const bytes=image.read();await validateEmojiPng(bytes);images.set(e.key,bytes);hash.update(e.key).update(bytes);}
  cancelled(signal);const digest=hash.digest('hex'),packRef=manifest.id+'@'+manifest.version;
  let old=libraryId?media.store.library(libraryId):media.store.libraries().find(l=>l.format==='dsh-emoji'&&l.packRef===packRef&&l.scope===scope);
  if(libraryId&&!old)throw new Error('目标图库不存在');if(old&&(old.format!=='dsh-emoji'||old.packRef!==packRef||old.digest!==digest))throw new Error('同ID同版本图包内容冲突，请提升version后导入');
  const lib=old??media.saveLibrary({name:(name||manifest.name).slice(0,60),description:'dsh-emoji标准40语义图包，可按聊天整套切换',scope,source:source==='本地ZIP导入'&&manifest.source?source+'；'+manifest.source:source,license:license||manifest.license||'未声明许可；请核对来源后启用',enabled:false,format:'dsh-emoji',keySet:EMOJI_KEY_SET,packRef,digest});
  const prior=media.store.meta('emoji-complete:'+lib.id)==digest;let imported=0,duplicates=0;
  try{for(const [i,e]of EMOJI_CORE.entries()){cancelled(signal);progress(`导入语义 ${i+1}/40 · ${e.label}`);const a=await media.import({name:e.label,tags:[e.key,e.label,e.unicode,...e.terms],kind:'sticker',mood:e.mood,caption:e.label+' / '+e.terms.join('、'),libraryId:lib.id,semanticKey:e.key,base64:images.get(e.key).toString('base64')});a.duplicate?duplicates++:imported++;}
    cancelled(signal);const rows=media.store.assets().filter(a=>a.libraryId===lib.id);if(rows.length!==40||new Set(rows.map(a=>a.semanticKey)).size!==40)throw new Error('目标语义图库不完整或混入了其他图片');
    media.store.meta('emoji-manifest:'+lib.id,JSON.stringify(manifest));media.store.meta('emoji-complete:'+lib.id,digest);const declared=!!String(license||manifest.license||'').trim();media.saveLibrary({id:lib.id,enabled:old&&prior?old.enabled:declared});return {libraryId:lib.id,imported,duplicates,skipped:0,warnings:declared?[]:['图包未声明许可，已保持停用；核对来源后可在窗口启用。']};
  }catch(e){if(!prior)media.saveLibrary({id:lib.id,enabled:false});throw e;}
}
export async function exportEmojiZip(media,id,{version}={}){
  const lib=media.store.library(id);if(lib?.format!=='dsh-emoji')throw new Error('不是dsh-emoji语义图库');let original;try{original=JSON.parse(media.store.meta('emoji-manifest:'+id));}catch{throw new Error('缺少标准图包清单，请重新导入');}
  const manifest=emojiManifest({...original,...(version?{version}:{})}),rows=media.store.assets().filter(a=>a.libraryId===id),files=[['pack.json',Buffer.from(JSON.stringify(manifest,null,2))]];
  if(rows.length!==40||new Set(rows.map(a=>a.semanticKey)).size!==40)throw new Error('标准图包必须保留完整40语义，缺图或重复时无法导出');
  for(const e of EMOJI_CORE){const a=rows.find(a=>a.semanticKey===e.key);if(!a)throw new Error('缺少语义：'+e.key);const {bytes}=media.read(a.id);await validateEmojiPng(bytes);files.push(['images/'+e.key+'.png',bytes]);}const zip=writeZip(files);if(zip.length>20*MiB)throw new Error('导出dsh-emoji ZIP超过20MiB');return zip;
}
