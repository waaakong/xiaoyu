import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {WeChatMoments} from '../src/wechat-moments.js';import {beijingDate,nextPlanTime,planWindow} from '../src/moments-plan.js';

test('random plan time stays inside the Beijing window and never fires twice on the same day',()=>{
  const at=(s)=>Date.parse(s+'+08:00');
  assert.equal(beijingDate(at('2026-11-10T23:30:00')),'2026-11-10');
  assert.equal(nextPlanTime({now:at('2026-11-10T08:00:00'),startHour:9,endHour:22,random:()=>0.5}),at('2026-11-10T15:30:00'));
  assert.equal(nextPlanTime({now:at('2026-11-10T23:00:00'),startHour:9,endHour:22,random:()=>0.5}),at('2026-11-11T15:30:00'));
  assert.equal(nextPlanTime({now:at('2026-11-10T10:00:00'),startHour:9,endHour:22,random:()=>0,skipToday:true}),at('2026-11-11T09:00:00'));
  assert.equal(nextPlanTime({now:at('2026-11-10T10:00:00'),startHour:9,endHour:22,random:()=>0}),at('2026-11-10T10:01:00'));
  assert.deepEqual(planWindow(at('2026-11-10T10:00:00'),9,22),{date:'2026-11-10',start:at('2026-11-10T09:00:00'),end:at('2026-11-10T22:00:00')});
  for(const bad of [{startHour:22,endHour:9},{startHour:-1,endHour:22},{startHour:9,endHour:25},{startHour:9.5,endHour:22}])assert.throws(()=>nextPlanTime({now:at('2026-11-10T10:00:00'),...bad}),/随机时间窗口/);
});

test('enabling the daily plan validates the WeChat scope and persists the next random time',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moments-plan-')),store=new Store(':memory:');
  const runtime={platform:'wechat',manager:{config:{account:'wxid_test',foregroundCompatibility:true},dataDir:dir},store,notebook:{assert:(scope,personaId)=>{assert.equal(scope,'wechat:wxid_test:private:wx_other');assert.equal(personaId,'p1');return {persona:{text:'人格'}};}}};
  const service=new WeChatMoments(runtime);
  try{
    assert.equal(service.plan().enabled,false);
    const plan=service.configurePlan({enabled:true,scope:'wechat:wxid_test:private:wx_other',personaId:'p1',startHour:9,endHour:22,visibility:'private'});
    assert.equal(plan.enabled,true);assert.equal(plan.visibility,'private');assert.ok(Number.isInteger(plan.nextAt));assert.equal(plan.lastStatus,null);
    assert.equal(service.plan().nextAt,plan.nextAt);
    const off=service.configurePlan({enabled:false,scope:'',personaId:'',startHour:9,endHour:22,visibility:'public'});
    assert.equal(off.enabled,false);assert.equal(off.nextAt,null);
    assert.throws(()=>service.configurePlan({enabled:true,scope:'wechat:wxid_test:private:wx_other',personaId:'p1',startHour:23,endHour:9}),/随机时间窗口/);
  }finally{await service.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('每日计划在微信收发运行时直接发布，不暂停不重启',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moments-plan-concurrent-')),store=new Store(':memory:');
  const now=Date.parse('2026-11-10T10:00:00+08:00');
  let running=true,stops=0,starts=0,published=null;
  const child={get running(){return running;},async stop(){stops++;running=false;},async start(){starts++;running=true;}};
  const runtime={platform:'wechat',manager:{config:{account:'wxid_test',foregroundCompatibility:true},dataDir:dir,child},store,notebook:{assert:(scope,personaId)=>{assert.equal(scope,'wechat:wxid_test:private:wx_other');assert.equal(personaId,'p1');return {persona:{text:'人格'}};}}};
  const service=new WeChatMoments(runtime,{now:()=>now,publishUi:async()=>{assert.equal(running,true);published=true;return {submissionAttempted:true};},verifyPublish:async()=>({verified:true,objectId:'123'})});
  try{
    service.configurePlan({enabled:true,scope:'wechat:wxid_test:private:wx_other',personaId:'p1',startHour:9,endHour:22,visibility:'public'});
    assert.equal(running,true);
    const draftId='draft-1';
    service.db.prepare('INSERT INTO moments_drafts VALUES(?,?,?,?,?,?,?)').run(draftId,'wxid_test','计划测试正文','public','draft',now,now);
    service.generate=async()=>({id:draftId});
    const result=await service.runPlan();
    assert.equal(result.published,true);
    assert.equal(published,true);
    assert.equal(stops,0);assert.equal(starts,0);assert.equal(running,true);
    const plan=service.plan();
    assert.equal(plan.lastStatus,'published');
    assert.equal(plan.lastError,null);
    assert.equal(plan.lastDate,'2026-11-10');
  }finally{await service.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('plan keeps one generated draft across definite pre-submit failures',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moments-plan-retry-')),store=new Store(':memory:'),now=Date.parse('2026-11-16T10:00:00+08:00');let generated=0,submitted=0;
 const runtime={platform:'wechat',store,manager:{dataDir:dir,config:{account:'wxid_test',foregroundCompatibility:true}},notebook:{assert:()=>({persona:{text:'小鱼'}})}};
 const s=new WeChatMoments(runtime,{now:()=>now,publishUi:async()=>{submitted++;const e=Error('menu missing');e.submissionAttempted=false;throw e;}});
 try{s.configurePlan({enabled:true,scope:'wechat:wxid_test:private:friend',personaId:'p',startHour:9,endHour:22});s.generate=async()=>{generated++;store.db.prepare('INSERT INTO moments_drafts VALUES(?,?,?,?,?,?,?)').run('d','wxid_test','同一份文案','private','draft',now,now);return {id:'d'};};await assert.rejects(s.runPlan(),/menu/);await assert.rejects(s.runPlan(),/menu/);assert.equal(generated,1);assert.equal(submitted,2);assert.equal(s.plan().lastStatus,'failed');}finally{await s.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('unknown plan result blocks another same-day send and generation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moments-plan-unknown-')),store=new Store(':memory:'),now=Date.parse('2026-11-16T10:00:00+08:00');let generated=0,submitted=0;
 const runtime={platform:'wechat',store,manager:{dataDir:dir,config:{account:'wxid_test',foregroundCompatibility:true}},notebook:{assert:()=>({persona:{text:'小鱼'}})}};
 const s=new WeChatMoments(runtime,{now:()=>now,publishUi:async()=>{submitted++;return {submissionAttempted:true};}});
 try{s.configurePlan({enabled:true,scope:'wechat:wxid_test:private:friend',personaId:'p',startHour:9,endHour:22});s.generate=async()=>{generated++;store.db.prepare('INSERT INTO moments_drafts VALUES(?,?,?,?,?,?,?)').run('d','wxid_test','未知结果不重发','private','draft',now,now);return {id:'d'};};assert.equal((await s.runPlan()).status,'unknown');assert.equal((await s.runPlan()).skipped,true);assert.equal(generated,1);assert.equal(submitted,1);assert.equal(s.plan().lastStatus,'unknown');}finally{await s.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
