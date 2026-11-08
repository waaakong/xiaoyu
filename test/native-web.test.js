import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeWebTrace,webReply,forbidsNetwork,sourceURL} from '../src/native-web.js';
import {Codex,safetyConfig} from '../src/codex.js';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {stripLegacyWeb,validateChat} from '../src/config.js';

test('native events require completion, preserve actual sources and never log search text',()=>{
  let time=1000;const t=new NativeWebTrace(true,{now:()=>time});t.observe('item/started',{id:'one',type:'webSearch',query:'private input is not a log'});assert.equal(t.result().status,'running');time=1600;t.observe('item/completed',{id:'one',type:'webSearch',action:{type:'search'},results:[{url:'https://www.python.org/',ref_id:'turn0search0'}]});assert.equal(t.result().status,'ok');assert.equal(t.result().operations[0].durationMs,600);assert.equal(t.sources.size,1);assert.doesNotMatch(JSON.stringify(t.result()),/private input/);
  assert.equal(new NativeWebTrace(false).result().status,'disabled');const disabled=new NativeWebTrace(false);disabled.observe('item/completed',{id:'x',type:'webSearch'});assert.equal(disabled.items.size,0);
});
test('failed native operations remain failures without another provider or invented citations',()=>{
  const t=new NativeWebTrace(true);t.observe('item/completed',{id:'x',type:'webSearch',results:[{type:'error',message:'no results fetched'}]});assert.equal(t.result().status,'failed');assert.equal(webReply('未查到。citefake',[{url:'https://example.com'}],t),'未查到。');
});
test('QQ citations use real native source URLs without adding irrelevant URL variants',()=>{
  const t=new NativeWebTrace(true);t.observe('item/completed',{id:'x',type:'webSearch',results:[{url:'https://www.python.org/',ref_id:'turn0search0'},{url:'https://www.python.org/?locale=en',ref_id:'turn0search1'}]});
  assert.equal(webReply('官网 https://www.python.org/',[{url:'https://www.python.org/'}],t),'官网 https://www.python.org/');assert.match(webReply('内容citeturn0search0',[],t),/https:\/\/www.python.org\//);assert.doesNotMatch(webReply('内容',[{url:'https://invented.example'}],t),/invented/);for(const u of ['javascript:alert(1)','https://name:secret@example.com','http://127.0.0.1'])assert.equal(sourceURL(u),null);
});
test('retired web settings migrate out, while new writes cannot restore deleted providers',()=>{
  assert.deepEqual(stripLegacyWeb({webSearch:true,webProvider:'anysearch',webFetch:true,douyinRead:false,model:'unchanged'}),{webSearch:true,model:'unchanged'});assert.throws(()=>validateChat({webProvider:'anysearch'},true),/字段/);assert.equal(validateChat({webSearch:true},true).webSearch,true);
  for(const file of ['search.js','web-net.js','web-page.js','douyin-reader.js'])assert.equal(fs.existsSync(new URL('../src/'+file,import.meta.url)),false);
});
test('native runtime exposes memory separately and keeps local execution excluded',()=>{
  assert.equal(safetyConfig['features.code_mode_host'],true);assert.equal(safetyConfig['features.standalone_web_search'],true);assert.equal(safetyConfig['features.shell_tool'],false);assert.equal(safetyConfig['features.apps'],false);assert.deepEqual(safetyConfig['features.code_mode.excluded_tool_namespaces'],['functions']);
});
test('network off and explicit refusal both reach the model with native search disabled',async()=>{
  assert.equal(forbidsNetwork('不要联网搜索这个'),true);assert.equal(forbidsNetwork('核实这个新说法'),false);
  const s=new Store(':memory:');const calls=[];const config={allowedUsers:['10'],allowedGroups:[],admins:[],wakeWords:['小鱼'],followupSeconds:0,historyMessages:8,memoryChars:500,defaults:{webSearch:true,autoSummary:false}};
  const b=new Bridge({config,store:s,codex:{chat:async p=>{calls.push(p);return {reply:'好的',memories:[]};}},onebot:{reply:async()=>[]},persona:'角色',log:()=>{}});
  try{await b.handle({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:1,message:[{type:'text',data:{text:'不要联网搜索这个'}}]});await Promise.all([...b.queues.values()].map(q=>q.chain));assert.equal(calls[0].webSearch,false);assert.equal(calls[0].searchContext,undefined);
    await b.handle({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:2,message:[{type:'text',data:{text:'核实这个新说法'}}]});await Promise.all([...b.queues.values()].map(q=>q.chain));assert.equal(calls[1].webSearch,true,'native tool access does not depend on a keyword-prefetch match');
  }finally{await b.stop();s.close();}
});
test('old custom web tools are rejected even in a native-enabled thread',()=>{
  const c=new Codex({}),responses=[];c.send=m=>responses.push(m);c.jobs.set('t',{nativeWeb:new NativeWebTrace(true)});for(const tool of ['qq_web_search','qq_web_fetch','qq_douyin_read','exec_command'])c.onMessage({id:responses.length,method:'item/tool/call',params:{threadId:'t',tool,arguments:{query:'public'}}});assert.equal(responses.length,4);assert.ok(responses.every(m=>m.error?.code===-32601));
});
