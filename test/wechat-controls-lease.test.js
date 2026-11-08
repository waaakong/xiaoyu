import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {WeChatAccessibility} from '../src/wechat-accessibility.js';

const proof={client:{version:'4.2.0.13',executable:'client',core:'core'},identity:{clientPid:123,version:'4.2.0.13'}};
function helperFactory({restored=true,expire=false}={}){
  const state={spawned:0,active:0,maxActive:0};
  const spawn=()=>{
    state.spawned++;state.maxActive=Math.max(state.maxActive,++state.active);
    const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();let started=false,finished=false;
    const row=x=>c.stdout.write(JSON.stringify(x)+'\n');
    const finish=()=>{if(finished)return;finished=true;row({type:'restoration',restored,value:0});state.active--;c.stdout.end();c.emit('close',0);};
    c.stdin=new Writable({write(_b,_e,done){if(!started){started=true;queueMicrotask(()=>{row({type:'inspection',gate:0});row({type:'phase',phase:'temporarily-enabled'});if(expire)setTimeout(finish,5);});}done();},final(done){queueMicrotask(finish);done();}});
    return c;
  };
  return {spawn,state};
}
test('disabled compatibility never starts a helper',async()=>{let starts=0;const c=new WeChatAccessibility({enabled:()=>false,spawnImpl:()=>{starts++;}});assert.equal(await c.run(null,()=>42),42);assert.equal(starts,0);await c.close();});
test('incompatible version is refused before requesting write access',async()=>{let starts=0;const c=new WeChatAccessibility({enabled:()=>true,spawnImpl:()=>{starts++;}});await assert.rejects(c.run({...proof,client:{version:'4.2.0.14'}},()=>{}),/版本/);assert.equal(starts,0);await c.close();});
test('failed UI action still waits for confirmed restoration',async()=>{const fake=helperFactory(),audit=[];const c=new WeChatAccessibility({root:'.',enabled:()=>true,python:()=>'',spawnImpl:fake.spawn,audit:r=>audit.push(r)});await assert.rejects(c.run(proof,()=>{throw Error('target changed');}),/target changed/);assert.equal(audit[0].restored,true);assert.equal(fake.state.active,0);await c.close();});
test('successful action cannot hide an unconfirmed restoration or permit another operation',async()=>{const fake=helperFactory({restored:false});const c=new WeChatAccessibility({root:'.',enabled:()=>true,python:()=>'',spawnImpl:fake.spawn});await assert.rejects(c.run(proof,()=>123),/恢复未确认/);await assert.rejects(c.run(proof,()=>456),/后续控件操作已阻止/);assert.equal(fake.state.spawned,1);await c.close();});
test('helper expiry aborts a pending UI action',async()=>{const fake=helperFactory({expire:true});let aborted=false;const c=new WeChatAccessibility({root:'.',enabled:()=>true,python:()=>'',spawnImpl:fake.spawn});await assert.rejects(c.run(proof,({signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;}))),/已停止/);assert.equal(aborted,true);await c.close();});
test('concurrent operations never hold overlapping accessibility leases',async()=>{const fake=helperFactory();const c=new WeChatAccessibility({root:'.',enabled:()=>true,python:()=>'',spawnImpl:fake.spawn});const values=await Promise.all([c.run(proof,()=>1),c.run(proof,()=>2)]);assert.deepEqual(values,[1,2]);assert.equal(fake.state.maxActive,1);await c.close();});
