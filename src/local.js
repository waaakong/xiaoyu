import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function findCodex(preferred='codex'){
  if(preferred!=='codex'&&fs.existsSync(preferred))return preferred;
  try{const found=execFileSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true,timeout:3000}).trim().split(/\r?\n/).find(p=>fs.existsSync(p));if(found)return found;}catch{}
  const base=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'OpenAI','Codex','bin');
  try{const found=fs.readdirSync(base).map(n=>path.join(base,n,'codex.exe')).filter(p=>fs.existsSync(p)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(found[0])return found[0];}catch{}
  return preferred;
}
