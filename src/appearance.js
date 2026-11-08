import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
export const appearanceDefaults={theme:'dark',preset:'coast',opacity:78,blur:22,shade:28,position:50,lowEffects:false,reduceMotion:false};
export class Appearance {
  constructor(dataDir){this.dir=path.join(dataDir,'appearance');this.file=path.join(this.dir,'settings.json');}
  read(){try{return {...appearanceDefaults,...JSON.parse(fs.readFileSync(this.file,'utf8'))};}catch{return {...appearanceDefaults};}}
  save(input){const p={...this.read()};for(const [key,value]of Object.entries(input)){
    if(key==='theme'&&['dark','light'].includes(value)||key==='preset'&&['coast','mountain','plain','custom'].includes(value))p[key]=value;
    else if(['opacity','blur','shade','position'].includes(key)&&Number.isFinite(value)&&value>=({opacity:45,blur:0,shade:0,position:0}[key])&&value<=({opacity:96,blur:32,shade:75,position:100}[key]))p[key]=value;
    else if(key==='background'&&typeof value==='string'&&/^background-[a-f0-9]{32}\.webp$/.test(value)&&this.background(value))p[key]=value;
    else if(['lowEffects','reduceMotion'].includes(key)&&typeof value==='boolean')p[key]=value;
    else throw Error('外观设置字段无效：'+key);
  }if(p.preset==='custom'&&!this.background(p.background))throw Error('请先选择背景图片');fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(p,null,2));fs.renameSync(this.file+'.tmp',this.file);return p;}
  background(candidate){const name=candidate??this.read().background;if(typeof name!=='string'||!/^background-[a-f0-9]{32}\.webp$/.test(name))return null;const file=path.join(this.dir,name);return fs.existsSync(file)?file:null;}
  async upload(bytes){if(!bytes.length||bytes.length>12*1024*1024)throw Error('背景图片最多12MB');const image=sharp(bytes,{limitInputPixels:24000000}),meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format)||meta.pages>1)throw Error('请选择静态JPG、PNG或WebP');const output=await image.rotate().resize({width:2560,height:2560,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer(),name='background-'+crypto.createHash('sha256').update(output).digest('hex').slice(0,32)+'.webp';fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(path.join(this.dir,name),output);return {...this.read(),background:name,preset:'custom'};}
}
