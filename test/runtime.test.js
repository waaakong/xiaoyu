import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
test('contact sync verifies account, keeps successful lists and preserves cache on failure',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-runtime-test-'));const r=new Runtime({store:new Store(':memory:'),dataDir:dir});
  r.onebot={connected:true,action:async action=>action==='get_login_info'?{user_id:99}:action==='get_friend_list'?[{user_id:10,nickname:'小王'}]:[{group_id:20,group_name:'群聊'}]};
  try{await r.refreshContacts();assert.equal(r.accountId,'99');assert.equal(r.contacts().items.length,2);assert.equal(r.contacts().items[0].scope.startsWith('qq:99:'),true);
    r.onebot.action=async action=>{if(action==='get_login_info')return {user_id:99};throw new Error('offline');};await r.refreshContacts();assert.equal(r.contacts().items.length,2);
  }finally{r.onebot=null;await r.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('persona library and image library are usable without a cloud API',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-library-test-'));const r=new Runtime({store:new Store(':memory:'),dataDir:dir});
  try{
    const persona=r.savePersona({name:'测试角色',category:'验证',text:'简洁回答'});assert.equal(r.store.persona(persona.id).text,'简洁回答');assert.throws(()=>r.deletePersona('default'),/不能删除/);r.deletePersona(persona.id);assert.equal(r.store.persona(persona.id),undefined);
    const bytes=await sharp({create:{width:16,height:16,channels:3,background:'green'}}).png().toBuffer();const a=await r.media.import({name:'开心',tags:['开心'],kind:'sticker',base64:bytes.toString('base64')});assert.equal(r.media.candidates('今天开心')[0].id,a.id);assert.ok(r.media.read(a.id).bytes.length);r.media.remove(a.id);assert.equal(r.store.assets().length,0);assert.ok(fs.existsSync(path.join(dir,'assets',a.id+'.png')));
  }finally{await r.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('chat library selection rejects other-chat private libraries and missing libraries before changing configuration',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-runtime-scope-test-')),r=new Runtime({store:new Store(':memory:'),dataDir:dir});
  try{const l=r.media.collection('qq:99:private:10');assert.throws(()=>r.saveChat('qq:99:private:11',{stickerLibraryId:l.id}),/不属于当前聊天/);assert.throws(()=>r.saveChat('qq:99:private:10',{stickerLibraryId:'missing'}),/不存在/);assert.throws(()=>r.saveDefaults({stickerLibraryId:l.id}),/共享图库/);}
  finally{await r.close();fs.rmSync(dir,{recursive:true,force:true});}
});
