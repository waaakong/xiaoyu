import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {imageInfo} from './media.js';
import {originalMomentsImages} from './moments-image-pack.js';

const MAX_IMAGE=5*1024*1024;
const EXT={jpeg:'.jpg',jpg:'.jpg',png:'.png',webp:'.webp',gif:'.gif'};
const clean=t=>String(t??'').replace(/\s+/g,' ').trim();
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const tagsOf=value=>{if(Array.isArray(value))return value.map(clean).filter(Boolean).slice(0,15);try{const v=JSON.parse(value??'[]');return Array.isArray(v)?v.map(clean).filter(Boolean).slice(0,15):[];}catch{return[];}};
const words=text=>{const raw=(String(text??'').toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9_]{2,}/gu)??[]).slice(0,40),out=[];for(const token of raw){out.push(token);if(/\p{Script=Han}/u.test(token))for(let i=0;i<token.length-1;i++)out.push(token.slice(i,i+2));}return [...new Set(out)].slice(0,120);};
export function animatedMomentImage(bytes,meta){if(meta.format==='gif'||(meta.pages??1)>1)return true;if(meta.format==='png'){let p=8;while(p+12<=bytes.length){const n=bytes.readUInt32BE(p);if(n>bytes.length-p-12)break;if(bytes.toString('ascii',p+4,p+8)==='acTL')return true;p+=n+12;}}return false;}

export class MomentsImages {
  constructor(runtime,{now=Date.now}={}){
    this.runtime=runtime;this.db=runtime.store.db;this.now=now;
    this.dir=path.join(runtime.manager?.dataDir??runtime.dataDir??'.','wechat-moments-media');
    this.libraryDir=path.join(this.dir,'library');fs.mkdirSync(this.libraryDir,{recursive:true});
    this.db.exec(`CREATE TABLE IF NOT EXISTS moments_images(id TEXT PRIMARY KEY,name TEXT,path TEXT UNIQUE,tags TEXT,mood TEXT,caption TEXT,width INTEGER,height INTEGER,sha256 TEXT,bytes INTEGER,source TEXT,enabled INTEGER DEFAULT 1,created INTEGER);
      CREATE INDEX IF NOT EXISTS moments_images_created ON moments_images(created);
      CREATE TABLE IF NOT EXISTS moments_draft_media(draftId TEXT,ordinal INTEGER,imageId TEXT,path TEXT,created INTEGER,PRIMARY KEY(draftId,ordinal))`);
    for(const [name,type]of [['staticStatus',"TEXT DEFAULT 'unchecked'"],['category',"TEXT DEFAULT '表情'"],['license',"TEXT DEFAULT ''"]])if(!this.db.prepare('PRAGMA table_info(moments_images)').all().some(c=>c.name===name))this.db.exec('ALTER TABLE moments_images ADD COLUMN '+name+' '+type);
  }
  count(){return Number(this.db.prepare("SELECT count(*) n FROM moments_images WHERE enabled=1 AND staticStatus='static'").get()?.n??0);}
  row(id){const r=this.db.prepare('SELECT * FROM moments_images WHERE id=?').get(String(id??''));return r?{...r,enabled:r.enabled===1,tags:tagsOf(r.tags)}:null;}
  allowedSticker(a){const l=this.runtime.store.library(a.libraryId);if(!l||l.enabled===false||l.scope||a.libraryId?.startsWith('person-memes-'))return false;const has=this.db.prepare("SELECT name FROM sqlite_master WHERE name='meme_owned'").get();return !has||!this.db.prepare('SELECT assetId FROM meme_owned WHERE assetId=?').get(a.id);}
  list({query='',category='',limit=60,offset=0}={}){
    const n=Math.max(1,Math.min(200,Number(limit)||60)),start=Math.max(0,Math.trunc(Number(offset)||0)),q=clean(query).toLowerCase();
    const rows=this.db.prepare("SELECT * FROM moments_images WHERE enabled=1 AND staticStatus='static' ORDER BY (source='original') DESC,created DESC,id").all().map(r=>({...r,enabled:true,tags:tagsOf(r.tags)}));
    return rows.filter(r=>(!category||r.category===category)&&(!q||[r.name,r.caption,r.mood,...r.tags].join(' ').toLowerCase().includes(q))).slice(start,start+n);
  }
  async addBytes(bytes,{name='',source='upload',tags=[],mood='',caption='',category='表情',license=''}={}){
    if(!Buffer.isBuffer(bytes)||!bytes.length)throw Error('图片为空');
    if(bytes.length>MAX_IMAGE)throw Error('朋友圈图片单张最多 5MB');
    const meta=await imageInfo(bytes),fmt=String(meta.format??'');
    if(!EXT[fmt])throw Error('朋友圈图片仅支持 PNG/JPEG/WebP/GIF');
    if(animatedMomentImage(bytes,meta))throw Error('朋友圈图库只接收静态图片，动态素材请保留在聊天表情库');
    let outputFormat=fmt;if(fmt==='webp'){bytes=await sharp(bytes).rotate().png().toBuffer();outputFormat='png';if(bytes.length>MAX_IMAGE)throw Error('静态图片转换后超过5MB');}
    const hash=sha256(bytes),old=this.db.prepare('SELECT * FROM moments_images WHERE sha256=?').get(hash);
    if(old)return {...this.row(old.id),duplicate:true};
    const id=crypto.randomUUID(),ext=EXT[outputFormat],file=path.join(this.libraryDir,id+ext);
    fs.writeFileSync(file,bytes,{mode:0o600});
    const row={id,name:clean(name)||('朋友圈图片-'+id.slice(0,6)),path:file,tags:JSON.stringify(tags.map(clean).filter(Boolean).slice(0,15)),mood:clean(mood)||'daily',caption:clean(caption).slice(0,200),width:meta.width??0,height:meta.pageHeight??meta.height??0,sha256:hash,bytes:bytes.length,source:clean(source)||'upload',enabled:1,created:this.now()};
    this.db.prepare('INSERT INTO moments_images(id,name,path,tags,mood,caption,width,height,sha256,bytes,source,enabled,created,staticStatus,category,license) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.name,row.path,row.tags,row.mood,row.caption,row.width,row.height,row.sha256,row.bytes,row.source,row.enabled,row.created,'static',clean(category)||'表情',clean(license));
    return this.row(id);
  }
  async addPath(file){
    const value=clean(file).replace(/^["']|["']$/g,'');
    if(!value||!path.isAbsolute(value))throw Error('图片必须使用绝对路径');
    let st;try{st=fs.statSync(value);}catch{throw Error('图片不存在：'+path.basename(value));}
    if(!st.isFile()||st.size<=0)throw Error('图片不可用：'+path.basename(value));
    if(st.size>MAX_IMAGE)throw Error('朋友圈图片单张最多 5MB');
    const bytes=fs.readFileSync(value);
    return this.addBytes(bytes,{name:path.basename(value),source:'path'});
  }
  async seedFromStickers({limit=500}={}){
    if(this.runtime.store.meta('moments-images-seeded-static-v2')==='1')return {seeded:0,total:this.count(),skipped:true};
    let images=[];try{const media=this.runtime.media;if(!media)throw Error('media missing');
      const assets=media.store.assets().filter(a=>a.kind==='sticker'&&this.allowedSticker(a));
      for(const a of assets){
        if(images.length>=Math.max(1,Math.min(1000,Number(limit)||500)))break;
        try{
          const {bytes}=media.read(a.id);
          const saved=await this.addBytes(bytes,{name:a.name,source:'sticker',tags:tagsOf(a.tags),mood:a.mood,caption:a.caption});
          if(!saved.duplicate)images.push(saved);
        }catch{}
      }
      this.runtime.store.meta('moments-images-seeded-static-v2','1');
    }catch(e){throw Error('复制表情包到朋友圈图库失败：'+String(e.message??e));}
    return {seeded:images.length,total:this.count()};
  }
  async prepare(){if(this.prepared)return;if(this.preparing)return this.preparing;this.preparing=(async()=>{
    const rows=this.db.prepare("SELECT * FROM moments_images WHERE staticStatus='unchecked'").all(),privateHashes=new Set((this.runtime.store.assets?.()??[]).filter(a=>!this.allowedSticker(a)).map(a=>a.hash).filter(Boolean));
    if(rows.length){const backup=path.join(this.dir,'migration-static-'+this.now()+'.json');fs.writeFileSync(backup,JSON.stringify({at:this.now(),rows},null,2),{mode:0o600});}
    for(const r of rows){try{if(r.source==='sticker'&&privateHashes.has(r.sha256)){this.db.prepare("UPDATE moments_images SET enabled=0,staticStatus='private-source' WHERE id=?").run(r.id);continue;}const bytes=fs.readFileSync(r.path),m=await imageInfo(bytes);if(animatedMomentImage(bytes,m)){this.db.prepare("UPDATE moments_images SET enabled=0,staticStatus='animated' WHERE id=?").run(r.id);continue;}if(m.format==='webp'){const out=await sharp(bytes).rotate().png().toBuffer();if(out.length>MAX_IMAGE)throw Error('converted image too large');const dest=path.join(this.libraryDir,r.id+'-static.png');fs.writeFileSync(dest,out,{mode:0o600});this.db.prepare("UPDATE moments_images SET path=?,sha256=?,bytes=? WHERE id=?").run(dest,sha256(out),out.length,r.id);this.db.prepare('UPDATE moments_draft_media SET path=? WHERE imageId=?').run(dest,r.id);}this.db.prepare("UPDATE moments_images SET staticStatus='static' WHERE id=?").run(r.id);}catch{this.db.prepare("UPDATE moments_images SET enabled=0,staticStatus='unavailable' WHERE id=?").run(r.id);}}
    if(this.runtime.media)await this.seedFromStickers({limit:750});
    for(const r of originalMomentsImages())await this.addBytes(await sharp(Buffer.from(r.svg)).png().toBuffer(),r);
    this.prepared=true;
  })();try{return await this.preparing;}finally{this.preparing=null;}}
  remove(id){
    const r=this.row(id);if(!r)throw Error('朋友圈图片不存在');
    this.db.prepare('DELETE FROM moments_images WHERE id=?').run(r.id);
    this.db.prepare('DELETE FROM moments_draft_media WHERE imageId=?').run(r.id);
    try{if(r.path.startsWith(this.libraryDir+path.sep))fs.unlinkSync(r.path);}catch{}
    return {id:r.id,removed:true};
  }
  resolve(ids=[]){
    const out=[];for(const id of [...new Set((Array.isArray(ids)?ids:[]).map(String).filter(Boolean))]){
      const r=this.row(id);if(!r||!r.enabled||r.staticStatus!=='static')throw Error('朋友圈图片已停用或不存在：'+id);
      let st;try{st=fs.statSync(r.path);}catch{throw Error('朋友圈图片文件丢失：'+r.name);}
      if(!st.isFile()||st.size<=0)throw Error('朋友圈图片文件不可用：'+r.name);
      out.push(r);
    }return out;
  }
  async suggest(text='',{mood='',limit=3}={}){
    const n=Math.max(0,Math.min(9,Number(limit)||0));if(!n)return [];
    const tokens=words(text),m=clean(mood);
    const rows=this.db.prepare("SELECT * FROM moments_images WHERE enabled=1 AND staticStatus='static' ORDER BY created DESC,id").all().map(r=>({...r,tags:tagsOf(r.tags)}));
    const scored=rows.map(r=>{
      const hay=[r.name,r.caption,r.mood,...r.tags].join(' ').toLowerCase();
      let score=0;for(const w of tokens)if(hay.includes(w))score+=2;
      if(m&&r.mood===m)score+=3;
      if(r.source==='original')score+=0.5;
      return {r,score};
    }).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id));
    const picked=[],seen=new Set();
    for(const {r} of scored){if(seen.has(r.sha256))continue;seen.add(r.sha256);picked.push(r);if(picked.length>=n)break;}
    return picked;
  }
  attach(draftId,ids=[]){
    if(!draftId)return [];
    const rows=this.resolve(ids);
    this.db.prepare('DELETE FROM moments_draft_media WHERE draftId=?').run(draftId);
    rows.forEach((r,i)=>this.db.prepare('INSERT INTO moments_draft_media VALUES(?,?,?,?,?)').run(draftId,i,r.id,r.path,this.now()));
    return rows;
  }
  draftMedia(draftId){
    return this.db.prepare('SELECT m.*,i.name,i.mood,i.sha256 FROM moments_draft_media m LEFT JOIN moments_images i ON i.id=m.imageId WHERE m.draftId=? ORDER BY m.ordinal').all(draftId);
  }
  file(id){
    const r=this.row(id);if(!r||!r.enabled||r.staticStatus!=='static')throw Error('朋友圈图片不存在或已停用');
    const bytes=fs.readFileSync(r.path),ext=path.extname(r.path).toLowerCase();
    const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':ext==='.gif'?'image/gif':'image/jpeg';
    return {asset:r,bytes,mime};
  }
  async thumbnail(id){const f=this.file(id);return {asset:f.asset,bytes:await sharp(f.bytes).rotate().resize(256,256,{fit:'cover'}).webp({quality:80}).toBuffer(),mime:'image/webp'};}
  dashboard(options={}){const all=this.db.prepare("SELECT * FROM moments_images WHERE enabled=1 AND staticStatus='static'").all(),q=clean(options.query).toLowerCase(),filtered=all.filter(r=>(!options.category||r.category===options.category)&&(!q||[r.name,r.caption,r.mood,...tagsOf(r.tags)].join(' ').toLowerCase().includes(q)));return {count:this.count(),total:filtered.length,categories:[...new Set(all.map(r=>r.category))].sort(),images:this.list(options),offset:Math.max(0,Number(options.offset)||0),limit:Math.max(1,Math.min(200,Number(options.limit)||60)),staticOnly:true};}
}
