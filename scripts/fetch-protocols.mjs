import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root} from '../src/config.js';

const directory=path.join(root,'vendor','protocols');
const archives=[
  {id:'snowluma',file:'SnowLuma-v2.4.2-win-x64.zip',target:'SnowLuma',version:'2.4.2',
   url:'https://github.com/TomyJan/SnowLuma/releases/download/v2.4.2/SnowLuma-v2.4.2-win-x64.zip',
   sha256:'0912926c5e73260f35b000278a8658493fc9452f36782c32fa86f0e825bad81a'},
  {id:'napcat',file:'NapCat.Shell.Windows.Node.zip',target:'NapCat',version:'4.18.42',
   url:'https://github.com/XingYunStar/NapCatQQ/releases/download/v4.18.42/NapCat.Shell.Windows.Node.zip',
   sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed'}
];
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(directory,{recursive:true});
for(const item of archives){
  const file=path.join(directory,item.file);
  let bytes=fs.existsSync(file)?fs.readFileSync(file):null;
  if(bytes&&digest(bytes)===item.sha256){console.log('已校验 '+item.file);}
  else{
    console.log('下载 '+item.url);
    const response=await fetch(item.url,{signal:AbortSignal.timeout(180000),redirect:'follow'});
    if(!response.ok)throw Error('下载失败 '+response.status+' '+item.url);
    bytes=Buffer.from(await response.arrayBuffer());
    if(digest(bytes)!==item.sha256)throw Error('SHA-256不匹配，已拒绝 '+item.file);
    fs.writeFileSync(file+'.tmp',bytes);fs.renameSync(file+'.tmp',file);
    console.log('已写入并校验 '+item.file);
  }
  item.bytes=bytes.length;
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({format:1,generatedAt:new Date().toISOString(),archives:archives.map(({url,...item})=>item)},null,2)+'\n');
console.log('内置QQ协议端清单已更新：'+directory);
