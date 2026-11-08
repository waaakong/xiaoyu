import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {engineDashboard} from '../src/engine-dashboard.js';

test('dashboard aggregates platform metadata without scopes, prompts or private payloads',()=>{
  const qq={store:new Store(':memory:')},wechat={store:new Store(':memory:')};try{
    qq.store.usage('qq:secret:private:person',{engine:'dsh',status:'delivered',model:'model',last:{inputTokens:12,outputTokens:3,cachedInputTokens:4},reply:'PRIVATE_REPLY',recall:{secret:'PRIVATE_MEMORY'},timing:{totalMs:200}});
    qq.store.usage('qq:secret:private:person',{status:'failed'});
    wechat.store.usage('wechat:secret:private:person',{engine:'codex',status:'failed',last:{inputTokens:7,outputTokens:2},timing:{totalMs:500}});
    const result=engineDashboard([['qq',qq],['wechat',wechat]],{now:123});assert.equal(result.at,123);assert.equal(result.sampled,3);assert.equal(result.groups.length,3);
    const g=result.groups.find(g=>g.engine==='dsh');assert.equal(g.inputTokens,12);assert.equal(g.p50Ms,200);assert.equal(g.knownUsage,1);assert.equal(result.groups.find(g=>g.engine==='unknown').missingUsage,1);
    for(const secret of ['PRIVATE_REPLY','PRIVATE_MEMORY','secret','person','recall'])assert.equal(JSON.stringify(result).includes(secret),false);
  }finally{qq.store.close();wechat.store.close();}
});

test('dashboard bounds samples and tolerates invalid usage records',()=>{
  const store=new Store(':memory:');try{for(let i=0;i<1002;i++)store.usage('local',{engine:'dsh',last:{inputTokens:1,outputTokens:1}});store.db.prepare('INSERT INTO usage(scope,data) VALUES(?,?)').run('secret','{bad');const d=engineDashboard([['qq',{store}]]);assert.equal(d.sampled,1000);assert.equal(d.invalid,1);assert.equal(d.groups[0].calls,999);assert.equal(d.recent.length,30);}finally{store.close();}
});

test('local diagnostics are never counted as real QQ or WeChat traffic',()=>{const store=new Store(':memory:');try{store.usage('local:engine-diagnostic',{engine:'dsh',last:{inputTokens:3,outputTokens:2}});const d=engineDashboard([['qq',{store}]]);assert.equal(d.groups[0].platform,'local');assert.equal(d.recent[0].platform,'local');}finally{store.close();}});

test('dashboard exposes bounded failure codes and stage durations without copying diagnostic payloads',()=>{const store=new Store(':memory:');try{
  store.usage('wechat:secret',{engine:'dsh',status:'failed',errorCode:'DSH_RESPONSE_SCHEMA_INVALID',timing:{generationMs:1300,deliveryMs:500,receiptMs:-1,prompt:'PRIVATE',totalMs:1900},error:'PRIVATE'});
  store.usage('wechat:secret',{engine:'dsh',status:'failed',errorCode:'PRIVATE error with spaces',timing:{generationMs:-1}});
  const d=engineDashboard([['wechat',{store}]]),r=d.recent.find(x=>x.errorCode);assert.equal(r.errorCode,'DSH_RESPONSE_SCHEMA_INVALID');assert.deepEqual(r.timing,{generationMs:1300,deliveryMs:500});assert.equal(JSON.stringify(d).includes('PRIVATE'),false);
}finally{store.close();}});
