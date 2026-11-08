import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {QuotaMonitor,moneyLte,normalizeCodexQuota} from '../src/quota.js';
import {ModelEngines,DshClient,loopback} from '../src/model-engines.js';
import {Codex} from '../src/codex.js';
import {policyFor} from '../src/config.js';
function temp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'xy-engines-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}

test('DSH normalizes short conversational paragraphs before history and delivery while preserving metadata',async()=>{
  let calls=0;const memories=[{key:'饮料',value:'白茶'}],client=new DshClient(()=>({url:'http://127.0.0.1:11340',token:'test',model:'["p","m"]'}),{fetchImpl:async()=>{calls++;return Response.json({reply:'第一句\n\n第二句',memories,format:{mode:'text'}});}});client.closed=false;
  const r=await client.chat({text:'测试',history:[]});assert.equal(r.reply,'第一句\n第二句');assert.deepEqual(r.memories,memories);assert.equal(r.format.mode,'text');assert.equal(calls,1);
});
test('money comparison keeps decimal and exponent precision without currency conversion',()=>{assert.ok(moneyLte('0E-16','0'));assert.ok(moneyLte('0.1000000000000000001','0.1000000000000000002'));assert.ok(!moneyLte('2.01','2'));assert.throws(()=>moneyLte('NaN','2'));});
test('quota read is coalesced, failures retain the last value and alerts deduplicate and recover',async t=>{let now=1000,calls=0;const q=new QuotaMonitor(temp(t),{now:()=>now}),read=async()=>{calls++;return normalizeCodexQuota({rateLimits:{limitId:'x',primary:{usedPercent:91,resetsAt:100,windowDurationMins:12}}},{id:'a'});};await Promise.all([q.refresh('codex',read),q.refresh('codex',read)]);assert.equal(calls,1);assert.equal(q.alerts.length,1);await q.refresh('codex',read,{force:true});assert.equal(q.alerts.length,1);now+=700000;await q.refresh('codex',async()=>{throw Error('offline');},{force:true});assert.equal(q.view('codex').status,'stale');assert.equal(q.view('codex').windows[0].usedPercent,91);q.update('codex',normalizeCodexQuota({rateLimits:{primary:{usedPercent:10}}},{id:'b'}));assert.equal(q.view('codex').windows[0].usedPercent,10);});
test('Codex quota notifications are observed without a running thread and API-key quotas remain unsupported',async()=>{const c=new Codex({});let observed;c.quotaObserver=r=>observed=r;c.onMessage({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:55}}}});assert.equal(observed.rateLimits.primary.usedPercent,55);c.auth={account:{type:'apikey'}};assert.equal((await c.quota()).status,'unsupported');});
test('routing honors one selected engine without a fallback or duplicate call',async t=>{const calls=[],codex={closed:false,chat:async p=>{calls.push('codex');return {reply:p.text};}},e=new ModelEngines(temp(t),{getCodex:()=>codex});t.after(()=>e.close());e.dsh.closed=false;e.dsh.chat=async()=>{calls.push('dsh');throw Error('quota');};assert.equal((await e.chat({engine:'codex',text:'x'})).engine,'codex');await assert.rejects(e.chat({engine:'dsh',text:'y'}),/quota/);assert.deepEqual(calls,['codex','dsh']);e.dsh.closed=true;await assert.rejects(e.chat({engine:'dsh'}),/尚未连接/);assert.equal(calls.length,2);});
test('local bridges reject public URLs, URL credentials and paths',()=>{assert.equal(loopback('http://127.0.0.1:4444'),'http://127.0.0.1:4444');for(const u of ['https://example.com','http://localhost:1','http://a:b@127.0.0.1:1','http://127.0.0.1:1/x'])assert.throws(()=>loopback(u));});
test('DSH scoped memory callbacks cannot select another platform and the broker closes after completion',async()=>{let brokerUrl,queries=[];const c=new DshClient(()=>({url:'http://127.0.0.1:1',token:'x',model:JSON.stringify(['deepseek-account','test'])}),{fetchImpl:async(_url,options)=>{const b=JSON.parse(options.body);brokerUrl=b.memoryBroker.url;const r=await fetch(brokerUrl,{method:'POST',headers:{Authorization:'Bearer '+b.memoryBroker.token},body:JSON.stringify({query:'旧事'})});assert.equal(r.status,200);const denied=await fetch(brokerUrl,{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'});assert.equal(denied.status,403);return new Response(JSON.stringify({reply:'记得',memories:[],usage:null}));}});c.closed=false;const r=await c.chat({text:'x',history:[],persona:'x',recallSession:{scope:'wechat:wx_a:private:wx_b',assertFresh(){},invoke:async p=>{queries.push(p.query);return {memory:'微信的记忆'};}}});assert.equal(r.reply,'记得');assert.deepEqual(queries,['旧事']);await assert.rejects(fetch(brokerUrl));});

test('an empty bonus wallet is not presented as an exhausted account when recharge funds exist',t=>{const q=new QuotaMonitor(temp(t));q.update('dsh',{status:'ready',accountFingerprint:'same',kind:'wallets',wallets:[{kind:'recharge',currency:'CNY',balance:'100'},{kind:'bonus',currency:'CNY',balance:'0'}]});assert.equal(q.alerts.length,0);assert.equal(q.exhausted('dsh'),false);});

test('DSH connection exposes partial directory failures and clears online health after a failure',async t=>{
  const e=new ModelEngines(temp(t),{getCodex:()=>null});t.after(()=>e.close());let fail=false;
  e.dsh.start=async()=>{if(fail)throw Error('offline');e.dsh.closed=false;e.dsh.health={nativeWeb:true};};
  e.dsh.request=async()=>({models:[{id:'model'}],providerErrors:['unavailable-provider']});e.dsh.quota=async()=>({status:'unsupported'});
  await e.connectDsh();assert.equal(e.state().dsh.connected,true);assert.deepEqual(e.state().dsh.providerErrors,['unavailable-provider']);fail=true;await e.checkDsh();assert.equal(e.state().dsh.connected,false);assert.equal(e.state().dsh.health,null);assert.match(e.state().dsh.error,/offline/);
});

test('public diagnostic is isolated, rejects overlap, cancels and never falls back',async t=>{
  const e=new ModelEngines(temp(t),{getCodex:()=>({closed:false,chat:()=>{throw Error('must not run');}})});t.after(()=>e.close());e.dsh.closed=false;
  let begin;const started=new Promise(r=>begin=r);e.dsh.chat=p=>{assert.equal(p.scope,'preview:engine-diagnostic');assert.deepEqual(p.history,[]);assert.equal(p.memory,'');assert.equal(p.webSearch,false);begin();return new Promise((resolve,reject)=>p.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};
  const pending=e.diagnostic(),rejected=assert.rejects(pending,/cancelled/);await started;await assert.rejects(e.diagnostic(),/运行中/);assert.equal(e.state().diagnostic.status,'running');assert.equal(e.cancelDiagnostic().cancelled,true);await rejected;assert.equal(e.diagnosticJob,null);assert.equal(e.state().diagnostic.status,'cancelled');
});

test('a per-chat engine override never inherits the other engine model',()=>{
  const scope='qq:99:private:10',base={wakeWords:[],allowedUsers:[],allowedGroups:[],defaults:{engine:'codex',model:'codex-model'},chats:{[scope]:{engine:'dsh',model:null}}};
  assert.equal(policyFor(base,scope).engine,'dsh');assert.equal(policyFor(base,scope).model,null);
  base.defaults={engine:'dsh',model:'["p","m"]'};base.chats[scope]={engine:'codex',model:null};assert.equal(policyFor(base,scope).model,null);
  base.chats[scope]={engine:'dsh',model:null};assert.equal(policyFor(base,scope).model,'["p","m"]');
  base.chats[scope]={model:'legacy-codex'};assert.equal(policyFor(base,scope).engine,'codex');assert.equal(policyFor(base,scope).model,'legacy-codex');
});
