import fs from 'node:fs';
import path from 'node:path';

// Cache only an unchanged signed build, never the live account or UI evidence.
// ctime/file identity detect replacements even when size and mtime are retained.
export function createClientInspector(inspect,{stat=file=>fs.statSync(file,{bigint:true}),now=Date.now,ttlMs=60000}={}){
  const entries=new Map(),pending=new Map();
  const stamp=files=>files.map(file=>{const s=stat(file);return [file,String(s.dev),String(s.ino),String(s.size),String(s.mtimeNs??s.mtimeMs),String(s.ctimeNs??s.ctimeMs)].join(':');}).join('|');
  return async executable=>{
    const key=path.resolve(executable),old=entries.get(key);
    if(old&&now()-old.at<ttlMs){try{if(stamp(old.files)===old.stamp)return structuredClone(old.result);}catch{entries.delete(key);}}
    if(pending.has(key))return structuredClone(await pending.get(key));
    const task=(async()=>{entries.delete(key);const before=stamp([key,path.dirname(key)]),result=await inspect(executable),files=[key,path.dirname(key),...(result.core?[result.core]:[])];
      // Never cache an invalid result, a missing core, or a build changed during inspection.
      if(result.signatureValid&&result.coreSignatureValid&&result.core&&before===stamp([key,path.dirname(key)])){
        const fingerprint=stamp(files);entries.set(key,{files,stamp:fingerprint,result:structuredClone(result),at:now()});while(entries.size>4)entries.delete(entries.keys().next().value);
      }
      return result;
    })();pending.set(key,task);try{return structuredClone(await task);}finally{pending.delete(key);}
  };
}
