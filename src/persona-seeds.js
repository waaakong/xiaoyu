import fs from 'node:fs';
import path from 'node:path';

export function seedPersonas(store,directory){
  if(!fs.existsSync(directory))return;
  const seeds=fs.readdirSync(directory).filter(f=>f.endsWith('.json')).sort().map(f=>{
    const p=JSON.parse(fs.readFileSync(path.join(directory,f),'utf8').replace(/^\uFEFF/,''));
    if(!/^[-\w]{1,64}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||typeof p.category!=='string'||p.category.length>40||typeof p.text!=='string'||!p.text.trim()||p.text.length>12000)throw new Error('内置人格文件格式无效：'+f);
    return p;
  });
  for(const p of seeds)if(!store.persona(p.id))store.savePersona(p);
}
