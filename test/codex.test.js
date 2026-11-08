import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Codex} from '../src/codex.js';
test('App Server lifecycle, structured reply and deny tool requests',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'qq-companion-test-'));
  const fixture=path.resolve(import.meta.dirname,'fixtures/fake-codex.cjs');
  const c=new Codex({codexPath:process.execPath,codexHome:path.join(dir,'home'),workspace:path.join(dir,'workspace'),timeoutSeconds:3},
    {spawnProcess:(_cmd,_args,options)=>spawn(process.execPath,[fixture],options)});
  try{
    await c.start();
    const denied=[];const send=c.send.bind(c);c.send=m=>{if(m.id===987)denied.push(m);send(m);};
    const r=await c.chat({persona:'角色',history:[],memory:'',text:'hi',user:'10'});
    assert.equal(r.reply,'模拟回复');assert.equal(denied[0].error.code,-32601);
  }finally{
    const exit=c.process?.exitCode===null?new Promise(r=>c.process.once('exit',r)):Promise.resolve();
    c.stop();await exit;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('native live search coexists with a namespaced memory tool without external search tools',async()=>{
  const c=new Codex({workspace:'test',timeoutSeconds:3}),calls=[];c.request=async(method,params)=>{calls.push({method,params});if(method==='thread/start'){
    assert.deepEqual(params.dynamicTools.map(t=>t.name),['qq_memory']);
    assert.equal(params.config.web_search,'live');assert.equal(params.dynamicTools[0].type,'namespace');assert.equal(params.dynamicTools[0].tools[0].type,'function');assert.equal(params.dynamicTools[0].tools[0].name,'recall');return {thread:{id:'combined'}};
  }if(method==='turn/start'){queueMicrotask(()=>c.jobs.get('combined').resolve({text:JSON.stringify({reply:'记住了',assetId:null,memories:[]}),completedAt:Date.now()}));return {turn:{id:'turn'}};}return {};};
  const r=await c.chat({persona:'角色',history:[],memory:'',text:'你好',user:'10',webSearch:true,recallSession:{invoke:async()=>({status:'ok'})}});assert.equal(r.reply,'记住了');assert.ok(calls.some(r=>r.method==='thread/start'));
});
