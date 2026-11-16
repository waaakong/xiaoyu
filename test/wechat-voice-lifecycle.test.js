import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureWeChatVoice,enableWeChatVoice} from '../src/wechat-native-lifecycle.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,{confirmed=true,voiceSession}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xy-voice-life-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const build=path.join(directory,'build-voice');fs.mkdirSync(build);
  const dll=Buffer.from('reviewed-voice-dll');fs.writeFileSync(path.join(build,'XiaoyuWechatVoice.dll'),dll);
  const sha=hash(dll);
  fs.writeFileSync(path.join(build,'manifest.json'),JSON.stringify({offlineTest:false,voiceExperimental:true,dllSha256:sha}));
  fs.writeFileSync(path.join(directory,'voice-validation.json'),JSON.stringify({confirmed,voiceBubbleVerified:confirmed,dllSha256:sha}));
  if(voiceSession)fs.writeFileSync(path.join(directory,'voice-session.json'),JSON.stringify(voiceSession));
  return {directory,sha};
}
const backend={paths:()=>({python:'python'})};

test('voice arming stays dormant without a matching human acceptance',async t=>{
  const {directory}=fixture(t,{confirmed:false});
  const calls=[];const state=await ensureWeChatVoice(backend,{pid:7,directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>null});
  assert.equal(state.state,'unavailable');assert.equal(calls.length,0);
});

test('an already armed component is left untouched',async t=>{
  const {directory}=fixture(t,{voiceSession:{pid:7,port:11348,token:'t'}});
  const calls=[];const state=await ensureWeChatVoice(backend,{pid:7,directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>({integration:'XiaoyuVoice-1',pid:7,verified:true,limit:100000})});
  assert.equal(state.state,'ready');assert.equal(calls.length,0);
});

test('a finite trial session only needs the validated rearm',async t=>{
  const {directory,sha}=fixture(t,{voiceSession:{pid:7,port:11348,token:'t'}});
  const calls=[];let reads=0;const state=await ensureWeChatVoice(backend,{pid:7,directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>{reads+=1;return {integration:'XiaoyuVoice-1',pid:7,verified:true,limit:reads===1?1:100000};}});
  assert.equal(state.state,'ready');assert.equal(calls.length,1);
  assert.deepEqual(calls[0][1].slice(-3),['--confirm-sha256',sha,'--enable-validated']);
});

test('a restart stale session loads once then rearms',async t=>{
  const {directory}=fixture(t,{voiceSession:{pid:6,port:11348,token:'old'}});
  const calls=[];let reads=0;
  const state=await ensureWeChatVoice(backend,{pid:7,directory,execute:async(...args)=>{calls.push(args);if(calls.length===2)fs.writeFileSync(path.join(directory,'voice-session.json'),JSON.stringify({pid:7,port:11348,token:'new'}));},readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>{reads+=1;return reads===1?null:{integration:'XiaoyuVoice-1',pid:7,verified:true,limit:100000};}});
  assert.equal(state.state,'ready');assert.equal(calls.length,2);
  assert.equal(calls[0][1].includes('--enable-validated'),false);assert.equal(calls[1][1].includes('--enable-validated'),true);
});

test('the dashboard fallback reports a disconnected transport without touching the client',async t=>{
  const {directory}=fixture(t,{});
  const calls=[];const state=await enableWeChatVoice(backend,{directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>null});
  assert.equal(state.state,'unavailable');assert.match(state.error,/尚未连接/);assert.equal(calls.length,0);
});

test('the dashboard fallback arms the voice component for the transport that is live now',async t=>{
  const {directory}=fixture(t,{voiceSession:{pid:7,port:11348,token:'t'}});
  fs.writeFileSync(path.join(directory,'session.json'),JSON.stringify({pid:7,port:11343,token:'h'}));
  const calls=[];
  const state=await enableWeChatVoice(backend,{directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async session=>session.port===11343?{pid:7,verified:true}:null,voiceHealth:async()=>({integration:'XiaoyuVoice-1',pid:7,verified:true,limit:100000})});
  assert.equal(state.state,'ready');assert.equal(calls.length,0);
});

test('an unverified transport is not trusted when arming voice',async t=>{
  const {directory}=fixture(t,{voiceSession:{pid:7,port:11348,token:'t'}});
  fs.writeFileSync(path.join(directory,'session.json'),JSON.stringify({pid:7,port:11343,token:'h'}));
  const calls=[];const state=await enableWeChatVoice(backend,{directory,execute:async(...args)=>calls.push(args),readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>({pid:7,verified:false})});
  assert.equal(state.state,'unavailable');assert.match(state.error,/未就绪/);assert.equal(calls.length,0);
});

test('an injection denial is reported without throwing',async t=>{
  const {directory}=fixture(t,{voiceSession:{pid:6,port:11348,token:'old'}});
  const state=await ensureWeChatVoice(backend,{pid:7,directory,execute:async()=>{throw Error('Explicit native load access unavailable');},readJson:file=>JSON.parse(fs.readFileSync(file,'utf8')),health:async()=>null});
  assert.equal(state.state,'failed');assert.match(state.error,/access unavailable/);
});
