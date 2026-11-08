import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createClientInspector} from '../src/wechat-client-cache.js';
import {ForegroundProcess,WeChatIO} from '../src/wechat-io.js';
import {waitForReaderReady} from '../src/wechat-reader-ready.js';

test('signed build cache coalesces, returns detached values, expires and invalidates both files',async()=>{
  let calls=0,now=0,exeStamp=1,coreStamp=1;
  const cached=createClientInspector(async executable=>{calls++;await new Promise(r=>setImmediate(r));return {executable,core:'core.dll',signatureValid:true,coreSignatureValid:true,version:'4.2.0.13'};},{now:()=>now,stat:file=>({dev:1,ino:1,size:10,mtimeNs:1,ctimeNs:file==='core.dll'?coreStamp:exeStamp})});
  const [a,b]=await Promise.all([cached('client.exe'),cached('client.exe')]);assert.equal(calls,1);a.version='corrupted';assert.equal(b.version,'4.2.0.13');assert.equal((await cached('client.exe')).version,'4.2.0.13');assert.equal(calls,1);
  coreStamp++;await cached('client.exe');assert.equal(calls,2);exeStamp++;await cached('client.exe');assert.equal(calls,3);now=60001;await cached('client.exe');assert.equal(calls,4);
});
test('invalid signatures and missing files never reuse a cached success',async()=>{
  let calls=0,valid=false,missing=false;
  const cached=createClientInspector(async executable=>{calls++;return {executable,core:'core.dll',signatureValid:valid,coreSignatureValid:valid};},{stat:()=>{if(missing)throw Error('missing');return {ino:1};}});
  await cached('client.exe');await cached('client.exe');assert.equal(calls,2);valid=true;await cached('client.exe');assert.equal(calls,3);missing=true;await assert.rejects(cached('client.exe'),/missing/);
});
test('concurrent foreground prewarm and start wait for one worker readiness',async()=>{
  let spawned=0,worker;const foreground=new ForegroundProcess('.',{spawnImpl:()=>{spawned++;worker=new EventEmitter();worker.stdout=new PassThrough();worker.stdin=new PassThrough();worker.kill=()=>{};return worker;}});
  let ready=0;const a=foreground.start().then(()=>ready++),b=foreground.start().then(()=>ready++);assert.equal(spawned,1);assert.equal(ready,0);worker.stdout.write('{"ready":true}\n');await Promise.all([a,b]);assert.equal(ready,2);foreground.close();
});
test('reply prewarm checks authorization and does not focus, probe or send',async()=>{
  let inspect=0,start=0;const io=new WeChatIO({config:()=>({account:'wx_a',mode:'foreground',executable:'client'}),policy:()=>({enabled:true}),inspect:async()=>inspect++,foreground:{start:async()=>start++,focus:()=>{throw Error('no focus');},send:()=>{throw Error('no send');}}});io.connected=true;await io.prepareReply({message_type:'private',user_id:'wx_b'});assert.equal(inspect,1);assert.equal(start,1);io.policy=()=>({enabled:false});await io.prepareReply({message_type:'private',user_id:'wx_b'});assert.equal(start,1);
});
test('verified stream subscribes immediately; reconnect verifies account without activating UI',async()=>{
  let verified=0,requests=0;const controller=new AbortController();const io=new WeChatIO({config:()=>({readerUrl:'http://127.0.0.1:1',readerToken:'token'}),fetchImpl:async()=>{requests++;controller.abort();throw Error('end');}});io.verify=async({checkControls})=>{verified++;assert.equal(checkControls,false);};await io.stream(controller.signal,{verified:true});assert.equal(requests,1);assert.equal(verified,0);
  const next=new AbortController();io.fetch=async()=>{next.abort();throw Error('end');};await io.stream(next.signal);assert.equal(verified,1);
});

test('reader readiness follows actual startup instead of a fixed one-second assumption',async()=>{let calls=0,now=0;const result=await waitForReaderReady(async()=>{calls++;if(calls<4)throw Error('starting');return {backend:'weflow-cli-nt',ownWxid:'wx_a'};},{now:()=>now,sleep:async ms=>{now+=ms;}});assert.equal(result.ownWxid,'wx_a');assert.equal(now,300);assert.equal(calls,4);});
test('reader readiness rejects dead workers and never accepts an errored or unrelated backend',async()=>{await assert.rejects(waitForReaderReady(async()=>({}),{isAlive:()=>false}),/退出/);let now=0;await assert.rejects(waitForReaderReady(async()=>({backend:'weflow-cli-nt',ownWxid:'wx_a',lastError:'not ready'}),{now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:250}),/超时/);assert.equal(now,250);});
