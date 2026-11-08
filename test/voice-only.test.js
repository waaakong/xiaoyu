import test from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';
import {PluginGateway} from '../src/plugin-gateway.js';
import {WeChatPluginGateway} from '../src/wechat-plugin-gateway.js';
import {policyFor,validateChat} from '../src/config.js';
import {wantsVoice} from '../src/voice-audio.js';

function fixture(t,{platform='qq',enhanced=false,failure,voiceCapability=true,group=false,pluginImage=false,voiceMode='only',text='你好',withSticker=false,stickers=true,stickerAvailable=true,chooseSticker=true}={}){
  const account=platform==='qq'?'99':'wx_role',user=platform==='qq'?'10':'wx_friend',peer=platform==='qq'?'20':'room@chatroom',scope=`${platform}:${account}:${group?'group':'private'}:${group?peer:user}`;
  const config={platform,admins:[],allowedUsers:[user],allowedGroups:group?[peer]:[],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500,defaults:{voiceMode,stickers,stickerLibraryId:'test-library',stickerCooldownSeconds:30,stickerEdge:300,autoSummary:false,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands'}};
  const store=new Store(':memory:'),sent=[],syntheses=[],models=[],logs=[];
  const onebot={connected:true,capabilities:{voice:voiceCapability},sticker:async(_e,_bytes,options)=>{options.beforeSend();sent.push({kind:'sticker'});return {message_id:'sticker-receipt'};},reply:async(_e,text,options)=>{options?.beforeSend?.();sent.push({kind:'text',text});return [{message_id:'system'}];},action:async()=>{throw Error('voice-only must not call text/image platform API');},record:async(_e,_file,options)=>{options.beforeSend();sent.push({kind:'voice'});if(failure==='unknown')throw Error('unknown');return {message_id:'voice-receipt'};}};
  const bridge=new Bridge({config,store,account,onebot,persona:'你叫小鱼',codex:{chat:async p=>{models.push(p);return {reply:'你好呀\n今天过得怎么样',memories:[],assetId:withSticker&&chooseSticker?'wave':null};}},log:s=>logs.push(s)});
  const candidateOptions=[],sentAssetOptions=[],marked=[];
  if(withSticker){store.saveLibrary({id:'test-library',name:'test'});store.saveAsset({id:'wave',name:'挥手',tags:['开心'],kind:'sticker',ext:'gif',size:10,libraryId:'test-library'});bridge.media={candidates:(_text,options)=>{candidateOptions.push(options);return stickerAvailable?[{id:'wave',name:'挥手'}]:[];},eligible:(_scope,libraryId)=>libraryId==='test-library'?[{id:'wave'}]:[],sendBytes:async(_id,options)=>{sentAssetOptions.push(options);return Buffer.from('mock gif');},markSent:(_scope,id)=>marked.push(id)};}
  bridge.voice={config:()=>({enabled:true,maxChars:180}),synthesize:async(text,options)=>{syntheses.push(text);options.assertFresh();if(failure==='synthesis')throw Error('no audio');if(failure==='mode-change')config.defaults.voiceMode='always';if(failure==='cancel')bridge.cancel(scope);if(failure==='revoke')config.allowedUsers=[];return {file:'mock.wav',assertFresh:options.assertFresh};}};
  let gateway;
  if(enhanced){
    gateway=new (platform==='qq'?PluginGateway:WeChatPluginGateway)({token:'t'.repeat(32),onebot,getAccount:()=>account,policy:s=>policyFor(config,s)});
    gateway.socket={readyState:1,send(){},terminate(){}};
    bridge.plugins={handle:async()=>false,cancel:scope=>gateway.cancel(scope),enhance:async(r,options)=>{
      const pending=gateway.enhance(r,options),l=gateway.leases.get(scope),trace=l.trace;
      try{
        const answer=await gateway.callModel(trace,{purpose:'reply',prompt:r.text,contexts:[]});
        // Simulate a chat plugin sending separate packets rather than one response.
        for(const body of answer.reply.split('\n')){
          const params=platform==='qq'?{[group?'group_id':'user_id']:Number(group?peer:user),message:body}:{kind:group?'group':'private',peer:group?peer:user,trace,message:body};
          const receipt=await gateway.action(platform==='qq'?(group?'send_group_msg':'send_private_msg'):'send',params);
          assert.deepEqual(receipt,{buffered:true,delivered:false});
        }
        if(pluginImage){const bytes=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer(),message=[{type:'image',data:{file:'base64://'+bytes.toString('base64')}}];const params=platform==='qq'?{user_id:Number(user),message}:{kind:'private',peer:user,trace,message};await gateway.action(platform==='qq'?'send_private_msg':'send',params);}
        assert.equal(sent.length,0,'plugin packets remain local until completion');
        gateway.complete(trace);
      }catch(e){gateway.complete(trace,{error:true});await pending.catch(()=>{});throw e;}
      return pending;
    }};
  }
  t.after(async()=>{await bridge.stop();await gateway?.stop();store.close();});
  const event={post_type:'message',message_type:group?'group':'private',self_id:account,user_id:user,...(group?{group_id:peer}:{}),message_id:'1',message:[...(group?[{type:'at',data:{qq:account}}]:[]),{type:'text',data:{text}}]};
  const run=async()=>{await bridge.handle(event);await Promise.all([...bridge.queues.values()].map(q=>q.chain));};
  return {bridge,store,config,sent,syntheses,models,logs,scope,run,candidateOptions,sentAssetOptions,marked};
}

test('only is a valid per-chat voice mode without changing defaults',()=>{
  validateChat({voiceMode:'only'},true);assert.equal(wantsVoice('only','你好'),true);
  assert.equal(policyFor({allowedUsers:['10'],allowedGroups:[],wakeWords:[]},'qq:99:private:10').voiceMode,'off');
});

for(const platform of ['qq','wechat'])for(const enhanced of [false,true]){
  test(`${platform} enhanced=${enhanced}: exactly one voice, no body text, canonical transcript and receipt`,async t=>{
    const f=fixture(t,{platform,enhanced});await f.run();
    assert.deepEqual(f.sent,[{kind:'voice'}]);assert.deepEqual(f.syntheses,['你好呀\n今天过得怎么样']);assert.equal(f.models.length,1);
    assert.match(f.models[0].persona,/本轮只发语音/);
    const rows=f.store.historyPage(f.scope).filter(r=>r.role==='assistant');
    assert.equal(rows.length,1);assert.equal(rows[0].text,'你好呀\n今天过得怎么样');assert.equal(rows[0].status,'delivered');assert.equal(f.store.db.prepare('SELECT source FROM messages WHERE id=?').get(rows[0].id).source,'voice-receipt');
    assert.ok(f.store.dialogue.diagnostics(f.scope).length);
  });
  for(const failure of ['synthesis','unknown','mode-change','cancel','revoke'])test(`${platform} enhanced=${enhanced}: ${failure} never leaks body or retries`,async t=>{
    const f=fixture(t,{platform,enhanced,failure});await f.run();assert.equal(f.syntheses.length,1);
    assert.ok(!f.sent.some(s=>s.text?.includes('你好呀')));
    assert.deepEqual(f.sent.map(s=>s.kind),failure==='synthesis'?['text']:failure==='unknown'?['voice']:[]);
    const rows=f.store.historyPage(f.scope).filter(r=>r.role==='assistant');assert.equal(rows.length,1);
    assert.notEqual(rows[0].status,'delivered');if(failure==='unknown')assert.equal(rows[0].status,'unknown');
  });
}

test('unverified WeChat voice capability refuses before paid synthesis',async t=>{
  const f=fixture(t,{platform:'wechat',voiceCapability:false});await f.run();assert.equal(f.syntheses.length,0);assert.deepEqual(f.sent.map(s=>s.kind),['text']);
});

for(const platform of ['qq','wechat'])for(const enhanced of [false,true])test(`${platform} enhanced=${enhanced}: group voice does not emit a separate text mention`,async t=>{const f=fixture(t,{platform,enhanced,group:true});await f.run();assert.deepEqual(f.sent,[{kind:'voice'}]);assert.equal(f.syntheses.length,1);});

for(const platform of ['qq','wechat'])test(`${platform}: unselected plugin images cannot bypass the app library policy`,async t=>{const f=fixture(t,{platform,enhanced:true,pluginImage:true});await f.run();assert.deepEqual(f.sent,[{kind:'voice'}]);assert.equal(f.syntheses.length,1);});

for(const platform of ['qq','wechat'])for(const enhanced of [false,true]){
  for(const voiceMode of ['only','requested'])test(`${platform}/enhanced=${enhanced}/${voiceMode}: voice replaces body and eligible library sticker is still delivered`,async t=>{
    const f=fixture(t,{platform,enhanced,voiceMode,text:'用语音打个招呼',withSticker:true});await f.run();
    assert.deepEqual(f.sent.map(x=>x.kind),['voice','sticker']);assert.equal(f.syntheses.length,1);assert.equal(f.models.length,1);
    assert.equal(f.models[0].assets[0].id,'wave');assert.equal(f.candidateOptions[0].libraryId,'test-library');assert.equal(f.candidateOptions[0].cooldownSeconds,30);assert.equal(f.sentAssetOptions[0].edge,300);assert.deepEqual(f.marked,['wave']);
  });
  for(const mode of ['disabled','cooldown'])test(`${platform}/enhanced=${enhanced}: ${mode} prevents sticker while retaining requested voice`,async t=>{
    const f=fixture(t,{platform,enhanced,voiceMode:'requested',text:'用语音回复',withSticker:true,stickers:mode!=='disabled',stickerAvailable:mode!=='cooldown'});await f.run();assert.deepEqual(f.sent.map(x=>x.kind),['voice']);assert.deepEqual(f.models[0].assets,[]);assert.equal(f.sentAssetOptions.length,0);
  });
}
for(const platform of ['qq','wechat'])test(`${platform}: requested mode without a voice request still replies in text`,async t=>{const f=fixture(t,{platform,voiceMode:'requested'});await f.run();assert.deepEqual(f.sent.map(x=>x.kind),['text']);assert.equal(f.syntheses.length,0);});
