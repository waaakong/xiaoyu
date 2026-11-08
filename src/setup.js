import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root} from './config.js';
const file=path.join(root,'config.json');
if(fs.existsSync(file)) { console.log('已有 config.json，未覆盖。'); }
else {
  fs.writeFileSync(file,JSON.stringify({codexPath:'codex',model:null,port:11339,onebotToken:crypto.randomBytes(32).toString('hex'),allowedUsers:[],allowedGroups:[],admins:[],wakeWords:['小鱼','大肥鱼'],followupSeconds:60,historyMessages:16,memoryChars:1600,timeoutSeconds:120},null,2),{mode:0o600});
  console.log('已生成 config.json。请填写白名单，并将 onebotToken 配到 NapCat。');
}
for(const dir of ['data/codex-home','data/chat-workspace']) fs.mkdirSync(path.join(root,dir),{recursive:true});
