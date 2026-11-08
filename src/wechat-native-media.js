import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {imageInfo} from './media.js';
import sharp from 'sharp';

const kinds={image:1,sticker:2,file:3,video:4};
const limits={image:6*1024*1024,sticker:1024*1024,file:20*1024*1024,video:20*1024*1024};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const reject=()=>{const error=Error('WECHAT_NATIVE_MEDIA_INVALID');error.deliveryAttempted=false;throw error;};

export async function nativeImageBytes(input,kind){
  const meta=await imageInfo(input);
  if(kind==='sticker')return meta.format==='gif'?Buffer.from(input):sharp(input,{animated:true,limitInputPixels:20000000}).gif().toBuffer();
  if(kind==='image')return sharp(input,{limitInputPixels:20000000}).rotate().png().toBuffer();
  reject();
}

export function mediaPacket({peer,id,kind,name,basename,size,sha256}){
  if(!/^[A-Za-z0-9_@.-]{1,128}$/.test(peer??'')||!uuid.test(id??'')||!kinds[kind]||
    typeof name!=='string'||!name||/[\x00-\x1f\x7f/\\:]/.test(name)||Buffer.byteLength(name)>240||
    typeof basename!=='string'||!uuid.test(basename.slice(0,36))||!/^\.[a-z0-9]{1,8}$/.test(basename.slice(36))||
    !Number.isSafeInteger(size)||size<=0||size>limits[kind]||!/^[a-f0-9]{64}$/.test(sha256??''))reject();
  const ext=path.extname(basename);if(kind==='image'&&!['.jpg','.png'].includes(ext)||kind==='sticker'&&ext!=='.gif'||kind==='video'&&ext!=='.mp4')reject();
  const p=Buffer.from(peer),n=Buffer.from(name),f=Buffer.from(basename),out=Buffer.alloc(96+p.length+n.length+f.length);
  out.writeUInt32LE(0x324d5958);out.write(id,4,36);out.writeUInt32LE(kinds[kind],40);out.writeUInt32LE(p.length,44);out.writeUInt32LE(n.length,48);out.writeUInt32LE(f.length,52);out.writeBigUInt64LE(BigInt(size),56);Buffer.from(sha256,'hex').copy(out,64);p.copy(out,96);n.copy(out,96+p.length);f.copy(out,96+p.length+n.length);return out;
}

// Input is bounded bytes already selected by the user/plugin. Never accept a
// filesystem path from a model, and never fetch a URL as a side effect.
export class NativeMediaLease {
  constructor(root,{now=Date.now}={}){this.root=path.resolve(root);this.now=now;fs.mkdirSync(this.root,{recursive:true});}
  async prepare({bytes,kind,name,account,scope,assertFresh=()=>{}}){
    assertFresh();if(!Buffer.isBuffer(bytes)||!limits[kind]||!bytes.length||bytes.length>limits[kind]||typeof account!=='string'||typeof scope!=='string'||!/^wechat:[A-Za-z0-9_.-]+:(private|group):[A-Za-z0-9_@.-]+$/.test(scope)||scope.split(':')[1]!==account)reject();
    let ext=path.extname(name??'').toLowerCase();
    if(['image','sticker'].includes(kind)){const meta=await imageInfo(bytes);if(kind==='sticker'&&meta.format!=='gif'||kind==='image'&&!['png','jpeg'].includes(meta.format))reject();ext=meta.format==='jpeg'?'.jpg':'.'+meta.format;}
    if(kind==='video'&&(ext!=='.mp4'||bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'))reject();
    if(!/^\.[a-z0-9]{1,8}$/.test(ext))reject();
    const id=randomUUID(),basename=id+ext,sha256=createHash('sha256').update(bytes).digest('hex'),peer=scope.split(':').slice(3).join(':');
    const fields={id,peer,kind,name,basename,size:bytes.length,sha256};mediaPacket(fields);assertFresh();
    const file=path.join(this.root,basename);fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const expiresAt=this.now()+120000;let consumed=false;
    return {id,sha256,basename,expiresAt,
      consume:current=>{assertFresh();if(consumed||this.now()>expiresAt||current.account!==account||current.scope!==scope)reject();consumed=true;return mediaPacket(fields);},
      // Call after the native operation has finished using the file, never on
      // mere submission: WeChat may still be reading/uploading asynchronously.
      dispose:()=>fs.rmSync(file,{force:true})};
  }
}
