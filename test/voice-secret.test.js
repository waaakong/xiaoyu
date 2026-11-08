import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {VoiceSecret} from '../src/voice-secret.js';
import {Runtime} from '../src/runtime.js';
import {Store} from '../src/store.js';
import {WeChatManager} from '../src/wechat-runtime.js';
test('saved credential changes invalidate cached plaintext, including another instance and file deletion',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-secret-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));const file=path.join(dir,'key.dpapi'),a=new VoiceSecret(file),b=new VoiceSecret(file);let reads=0;
  for(const x of [a,b])x.transform=(v,protect)=>{if(!protect)reads++;return protect?'encrypted:'+v:v.slice(10);};
  a.write('dummy-old');assert.equal(b.read(),'dummy-old');assert.equal(b.read(),'dummy-old');assert.equal(reads,1);a.write('dummy-new');assert.equal(b.read(),'dummy-new');assert.equal(reads,2);a.write('');assert.equal(b.read(),'');a.write('dummy-third');assert.equal(b.read(),'dummy-third');
});
test('WeChat shares the protected Breeze credential while keeping config and memory separate',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-platform-voice-')),parent=new Runtime({store:new Store(':memory:'),dataDir:dir}),manager=new WeChatManager(parent,{dataDir:dir});manager.config.account='wx_test_voice';
  t.after(async()=>{await manager.close();await parent.close();fs.rmSync(dir,{recursive:true,force:true});});
  const child=manager.context();assert.equal(child.voice.secret,parent.voice.secret);assert.notEqual(child.voice.file,parent.voice.file);assert.notEqual(child.store,parent.store);assert.equal(child.voice.config().enabled,false);
});
