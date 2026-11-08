import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {seedPersonas} from '../src/persona-seeds.js';

test('bundled personas initialize new databases without replacing user edits',()=>{
  const store=new Store(':memory:');try{seedPersonas(store,path.resolve('personas'));const p=store.persona('dafeiyu');assert.equal(p.name,'大肥鱼');assert.ok(store.persona('f6b08e99-6db7-4c76-adf6-5e9330335191'));store.savePersona({...p,text:'我的自定义设定'});seedPersonas(store,path.resolve('personas'));assert.equal(store.persona('dafeiyu').text,'我的自定义设定');}finally{store.close();}
});
test('invalid bundled persona does not partially import other files',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-seeds-')),store=new Store(':memory:');try{fs.writeFileSync(path.join(dir,'a.json'),JSON.stringify({id:'a',name:'a',category:'a',text:'a'}));fs.writeFileSync(path.join(dir,'b.json'),JSON.stringify({id:'../bad'}));assert.throws(()=>seedPersonas(store,dir),/格式无效/);assert.equal(store.persona('a'),undefined);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
