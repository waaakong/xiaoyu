import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Codex,compactPrompt,httpTransportOverride} from '../src/codex.js';
import {Bridge} from '../src/bridge.js';
import {Store} from '../src/store.js';

test('compact context retains speaker order and facts but excludes database metadata',()=>{
  const history=[{id:99,created:'time',status:'delivered',role:'user',speaker:'member-10',text:'我喜欢茶'},{role:'assistant',speaker:'AI',text:'记住了'}];
  const p=JSON.parse(compactPrompt({user:'10',memory:'喜欢茶',summary:'周末约定',history,assets:[],searchContext:null,text:'还记得吗'}));
  assert.deepEqual(p.recentConversation,history.map(({role,speaker,text})=>({role,speaker,text})));
  assert.equal(p.recalledMemory,'喜欢茶');assert.equal(p.olderSummary,'周末约定');assert.equal(p.currentMessage,'还记得吗');assert.equal(p.assetCandidates,undefined);
  assert.doesNotMatch(JSON.stringify(p),/created|delivered/);
});

test('HTTP compatibility preserves custom providers and API-key authentication',()=>{
  assert.equal(httpTransportOverride('custom',{type:'chatgpt'}),null);
  assert.equal(httpTransportOverride(null,{type:'apiKey'}),null);
  assert.equal(httpTransportOverride('openai',null),null);
  const value=httpTransportOverride(null,{type:'chatgpt'});
  assert.equal(value.provider.base_url,'https://chatgpt.com/backend-api/codex');
  assert.equal(value.provider.supports_websockets,false);assert.equal(value.provider.requires_openai_auth,true);
  assert.equal(value.provider.wire_api,'responses');assert.notEqual(value.id,'openai');
});

test('QQ-only skill override leaves global auth/config intact and unsubscribe cannot delay reply',{timeout:3000},async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'qq-latency-')),home=path.join(dir,'home');mkdirSync(home);writeFileSync(path.join(home,'config.toml'),'# user config');writeFileSync(path.join(home,'auth.json'),'user auth');
  const fixture=path.resolve(import.meta.dirname,'fixtures/fake-codex.cjs');
  let startupArgs;
  const c=new Codex({connectionMode:'local',codexPath:process.execPath,codexHome:home,workspace:path.join(dir,'work'),timeoutSeconds:2},{spawnProcess:(_cmd,_args,opts)=>{startupArgs=_args;return spawn(process.execPath,[fixture],opts);}});
  let startParams;const request=c.request.bind(c);
  c.request=(method,params)=>{
    if(method==='account/read')return Promise.resolve({account:{type:'chatgpt'}});
    if(method==='skills/list')return Promise.resolve({data:[{skills:[{path:'C:/skills/chat-unrelated/SKILL.md',enabled:true}]}]});
    if(method==='thread/start')startParams=params;
    if(method==='thread/unsubscribe')return new Promise(()=>{});
    return request(method,params);
  };
  try{
    await c.start();const result=await c.chat({persona:'人格',history:[],memory:'',text:'hi',user:'10'});
    assert.equal(result.reply,'模拟回复');assert.ok(startupArgs.includes('model_provider="qq_companion_http"'));assert.deepEqual(startParams.config['skills.config'],[{path:'C:/skills/chat-unrelated/SKILL.md',enabled:false}]);
    assert.equal(startParams.modelProvider,'qq_companion_http');assert.equal(startParams.config.model_provider,'qq_companion_http');assert.equal(startParams.config['model_providers.qq_companion_http'].supports_websockets,false);
    assert.ok(result.timing.threadMs>=0);assert.ok(result.timing.totalMs>=result.timing.threadMs);
    assert.equal(readFileSync(path.join(home,'config.toml'),'utf8'),'# user config');assert.equal(readFileSync(path.join(home,'auth.json'),'utf8'),'user auth');
  }finally{const exited=new Promise(r=>c.process.once('exit',r));c.stop();await exited;rmSync(dir,{recursive:true,force:true});}
});

test('new message preempts background summary, preserves delivery and saves stage timings',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const store=new Store(':memory:'),sent=[];let summaryStarted=0,summaryAborted=0;
  const bridge=new Bridge({config:{admins:[],allowedUsers:['10'],allowedGroups:[],wakeWords:['小鱼'],followupSeconds:60,historyMessages:8,memoryChars:500},store,codex:{closed:false,chat:async()=>({reply:'回复',memories:[],timing:{threadMs:1,firstOutputMs:2,modelMs:3,totalMs:4},usage:{last:{inputTokens:100,outputTokens:5}}})},onebot:{reply:async(_e,text)=>{sent.push(text);return [{message_id:sent.length}];}},persona:'人格',log:()=>{}});
  bridge.summarize=async(_scope,_p,{signal})=>{summaryStarted++;await new Promise(resolve=>signal.addEventListener('abort',()=>{summaryAborted++;resolve();},{once:true}));};
  const message=id=>({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:id,message:[{type:'text',data:{text:'你好'+id}}]});
  const drain=()=>Promise.all([...bridge.queues.values()].map(q=>q.chain));
  try{
    await bridge.handle(message(1));await drain();assert.deepEqual(sent,['回复']);assert.equal(bridge.total,0);
    t.mock.timers.tick(1000);await Promise.resolve();assert.equal(summaryStarted,1);
    await bridge.handle(message(2));await drain();assert.equal(summaryAborted,1);assert.deepEqual(sent,['回复','回复']);
    const usage=store.usagePage('qq:99:private:10');assert.equal(usage.length,2);assert.equal(usage[0].data.status,'delivered');assert.ok(usage[0].data.timing.deliveryMs>=0);assert.ok(usage[0].data.timing.queueMs>=0);assert.equal(usage[0].data.timing.threadMs,1);
    await bridge.stop();assert.equal(bridge.background.size,0);assert.equal(store.historyPage('qq:99:private:10').length,4);
  }finally{await bridge.stop();store.close();}
});
