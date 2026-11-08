import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {randomUUID} from 'node:crypto';
import {apply} from '../integrations/dsh/index.mjs';
import {nativeWebContext} from '../integrations/dsh/native-web.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
async function fixture(t,llm,services={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xy-dsh-plugin-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const url='http://127.0.0.1:'+port,token='a'.repeat(64),configFile=path.join(directory,'config.json');fs.writeFileSync(configFile,JSON.stringify({url,token}));let dispose;await apply({llm,get:k=>services[k],on:(event,fn)=>{if(event==='dispose')dispose=fn;}},{configFile});t.after(async()=>{await dispose();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,url,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},payload:{id:randomUUID(),provider:'test',model:'test',scope:'qq:99:private:10',persona:'PRIVATE_PERSONA',history:[],memory:'PRIVATE_MEMORY',text:'PRIVATE_CURRENT',user:'10'}};
}
function* resultChunks(reply='连接正常'){
  yield {type:'block-end',index:0,block:{type:'text',text:JSON.stringify({reply,memories:[],assetId:null})}};
  yield {type:'usage',usage:{inputTokens:10,outputTokens:3,cacheReadTokens:2}};yield {type:'finish',reason:{kind:'stop'}};
}

test('DSH image semantics use optional metadata while self-status is a separate read-only tool',async t=>{
  const http=await import('node:http');let queried=0,rounds=0;const broker=http.createServer(async(req,res)=>{assert.equal(req.url,'/self');assert.equal(req.headers.authorization,'Bearer fixture-self');let body='';for await(const b of req)body+=b;assert.equal(JSON.parse(body).topic,'accounts');queried++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{modelStatus:'fixture-ready'}}));});await new Promise(r=>broker.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>broker.close(r)));
  const insight={imageId:'m0',mediaType:'sticker',sensitive:false,confidence:.95,caption:'点头',meaning:'赞同',contextMeaning:'在安慰',mood:'happy',tags:['点头'],favorite:true,likeScore:90,reason:'符合人格',usage:'同意',avoid:'争吵'};
  const f=await fixture(t,{async *stream(options){assert.match(options.system,/memeInsights/);assert.ok(options.tools.some(t=>t.name==='self_status'));if(rounds++===0){yield {type:'block-end',index:0,block:{type:'tool-call',id:'self-1',name:'self_status',arguments:JSON.stringify({topic:'accounts'})}};yield {type:'finish',reason:{kind:'tool-calls'}};}else{yield {type:'block-end',index:0,block:{type:'text',text:'收到\n```xiaoyu-meta\n'+JSON.stringify({memories:[],memeInsights:[insight]})+'\n```'}};yield {type:'finish',reason:{kind:'stop'}};}}});
  const response=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify({...f.payload,memeContext:{images:[{imageId:'m0',knownVisual:{caption:'点头'}}]},selfBroker:{url:'http://127.0.0.1:'+broker.address().port+'/self',token:'fixture-self'}})}),data=await response.json();assert.equal(response.status,200);assert.equal(data.reply,'收到');assert.deepEqual(data.memeInsights,[insight]);assert.equal(queried,1);assert.equal(data.web.operations.length,0);
});
test('real DSH plugin contract executes native web and image paths without persisting private bodies',async t=>{
  let rounds=0,imageCount=0;const llm={listProviders:async()=>[{id:'test'}],listModels:async()=>[{id:'test',inputModalities:['text','image']}],async *stream(options){assert.match(options.system,/PRIVATE_PERSONA/);if(rounds++===0){assert.equal(options.messages[0].content.some(x=>x.type==='image'),true);yield {type:'block-end',index:0,block:{type:'tool-call',id:'call-1',name:'web_search',arguments:JSON.stringify({query:'public website'})}};yield {type:'finish',reason:{kind:'tool-calls'}};}else yield* resultChunks();}};
  const f=await fixture(t,llm,{web:{search:async()=>({text:'PRIVATE_TOOL',sources:[{title:'Example',url:'https://example.com'}]})},attachments:{saveImage:async()=>{imageCount++;return {id:'test-image',mediaType:'image/png'};}}});
  assert.equal((await fetch(f.url+'/health')).status,403);const health=await(await fetch(f.url+'/health',{headers:f.headers})).json();assert.equal(health.bridgeVersion,'0.28.1');assert.equal(health.activeJobs,0);
  const r=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify({...f.payload,images:['data:image/png;base64,aGVsbG8='],webSearch:true})}),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(data.reply,'连接正常');assert.equal(imageCount,1);assert.equal(data.web.operations[0].status,'ok');assert.equal(data.sources[0].url,'https://example.com');
  const files=fs.readdirSync(path.join(f.directory,'dsh-requests'));assert.deepEqual(files,['qq-latest.json']);const diagnostic=fs.readFileSync(path.join(f.directory,'dsh-requests',files[0]),'utf8');for(const text of ['PRIVATE_PERSONA','PRIVATE_MEMORY','PRIVATE_TOOL','PRIVATE_CURRENT'])assert.equal(diagnostic.includes(text),false);
});
test('DSH plugin cancellation aborts the owned generation and releases its request',async t=>{
  let started;const began=new Promise(r=>started=r);const f=await fixture(t,{async *stream({signal}){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
  const pending=fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify(f.payload)});await began;const cancelled=await(await fetch(f.url+'/cancel',{method:'POST',headers:f.headers,body:JSON.stringify({id:f.payload.id})})).json();assert.equal(cancelled.cancelled,true);assert.equal((await pending).status,400);
  const absent=await(await fetch(f.url+'/cancel',{method:'POST',headers:f.headers,body:JSON.stringify({id:f.payload.id})})).json();assert.equal(absent.cancelled,false);
});

test('account web runs under an owned route without inheriting user sessions and disposes cleanly',async()=>{
  const local=new AsyncLocalStorage(),created=[],disposed=[];const agents={create:async options=>{created.push(options);return {agent:{session:{append:(type,data)=>{assert.equal(type,'request/context');assert.deepEqual(data,{provider:'deepseek-account',model:'test'});}}},dispose:async()=>disposed.push(options.sessionId)};},withInitiator:(agent,fn)=>local.run(agent,fn)};
  const owner=await nativeWebContext({get:()=>agents},{id:'test',provider:'deepseek-account',model:'test',cwd:'test-dir',signal:new AbortController().signal});assert.equal(created.length,1);assert.equal(Object.hasOwn(created[0],'seed'),false);assert.equal(created[0].meta.cwd,'test-dir');await owner.run(async()=>{assert.ok(local.getStore()?.session);});assert.equal(local.getStore(),undefined);await owner.dispose();assert.deepEqual(disposed,['xiaoyu-web-test']);
  await assert.rejects(nativeWebContext({get:()=>null},{provider:'deepseek-account',signal:new AbortController().signal}),{code:'WEB_ACCOUNT_CONTEXT_UNAVAILABLE'});
});

test('successful fetch never hides a failed search in the native web result',async t=>{
  let round=0;const f=await fixture(t,{async *stream(){if(round++===0){for(const [index,name,args]of [[0,'web_search',{query:'public'}],[1,'web_fetch',{url:'https://example.com'}]])yield {type:'block-end',index,block:{type:'tool-call',id:'call-'+index,name,arguments:JSON.stringify(args)}};yield {type:'finish',reason:{kind:'tool-calls'}};}else yield* resultChunks();}},{web:{search:async()=>{throw Object.assign(Error('missing'),{code:'WEB_PROVIDER_CREDENTIAL_MISSING'});},fetch:async()=>({url:'https://example.com',status:200,body:'public'})}});
  const r=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify({...f.payload,webSearch:true})}),d=await r.json();assert.equal(r.status,200);assert.equal(d.web.status,'partial');assert.equal(d.searchUsed,false);assert.equal(d.web.operations[0].code,'WEB_PROVIDER_CREDENTIAL_MISSING');assert.equal(d.web.operations[1].status,'ok');
});

test('natural multiline chat survives broken optional memory metadata with one model call and no body logging',async t=>{
  let calls=0;const f=await fixture(t,{async *stream(options){calls++;assert.match(options.system,/不要用JSON包裹正文/);yield {type:'block-end',index:0,block:{type:'text',text:'PRIVATE_REPLY\n第二句\n```xiaoyu-meta\n{"memories":broken}\n```'}};yield {type:'finish',reason:{kind:'stop'}};}});
  const r=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify(f.payload)}),d=await r.json();assert.equal(r.status,200);assert.equal(d.reply,'PRIVATE_REPLY\n第二句');assert.deepEqual(d.memories,[]);assert.equal(calls,1);assert.deepEqual(d.format.warnings,['DSH_METADATA_FORMAT_IGNORED']);
  const log=fs.readFileSync(path.join(f.directory,'dsh-requests','qq-latest.json'),'utf8');assert.equal(log.includes('PRIVATE_REPLY'),false);assert.match(log,/DSH_METADATA_FORMAT_IGNORED/);
});

test('incomplete or empty model output is rejected instead of delivering a partial answer',async t=>{
  for(const [output,kind]of [['partial answer','length'],['','stop']]){
    const f=await fixture(t,{async *stream(){yield {type:'block-end',index:0,block:{type:'text',text:output}};yield {type:'finish',reason:{kind}};}});
    const r=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify(f.payload)});assert.equal(r.status,400);
  }
});

test('valid trailing memory block survives the full plugin path and retains evidence checks',async t=>{
  const memories=[{key:'测试',value:'CURRENT',evidence:'PRIVATE_CURRENT',type:'fact'},{key:'伪造',value:'bad',evidence:'not-in-input',type:'fact'}];
  const f=await fixture(t,{async *stream(){yield {type:'block-end',index:0,block:{type:'text',text:'好的\n```xiaoyu-meta\n'+JSON.stringify({memories})+'\n```'}};yield {type:'finish',reason:{kind:'stop'}};}});
  const r=await fetch(f.url+'/chat',{method:'POST',headers:f.headers,body:JSON.stringify(f.payload)}),d=await r.json();assert.equal(r.status,200);assert.equal(d.reply,'好的');assert.equal(d.memories.length,1);assert.equal(d.format.mode,'text-metadata');assert.deepEqual(d.format.warnings,[]);
});
