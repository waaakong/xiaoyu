import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../src/runtime.js';
import {WeChatRuntime} from '../src/wechat-runtime.js';
test('explicit Codex connection works alongside DSH without changing defaults',async()=>{
 let args;const r={engines:{selected:()=> 'dsh'},connect:async a=>{args=a;return {connected:true};}};
 assert.deepEqual(await Runtime.prototype.connectEngine.call(r,'codex'),{connected:true});assert.deepEqual(args,{engine:'codex',allowRunning:true});assert.equal(r.engines.selected(),'dsh');await assert.rejects(Runtime.prototype.connectEngine.call(r,'invalid'),/引擎无效/);
});
test('DSH connect never starts or stops Codex even while QQ is running',async()=>{
 let connected=0;const r={running:true,engines:{selected:()=> 'dsh',connectDsh:async()=>connected++},codex:{stop:()=>{throw Error('must not touch Codex');}},state:()=>({ok:true})};
 assert.deepEqual(await Runtime.prototype.connect.call(r),{ok:true});assert.equal(connected,1);
});
test('DSH reconnect preserves shared engine router and never requests Codex',async()=>{
 const engines={selected:()=> 'dsh',dsh:{closed:true},connectDsh:async()=>{}};const r={engines,bridge:{codex:engines},services:{},pluginHost:{state:()=>({running:false})},state:()=>({}),integrationState:()=>({}),log:()=>{}};
 await Runtime.prototype.repairConnections.call(r);assert.equal(r.codex,undefined);assert.equal(r.bridge.codex,engines);
});
test('WeChat chooses its own DSH engine without needing a parent Codex',async()=>{
 const r={configuration:()=>({defaults:{engine:'dsh'}}),engines:{selected:e=>e,dsh:{closed:false},dshModels:['dsh-model']},manager:{parent:{connect:()=>{throw Error('Codex must not connect');}}},state:()=>({ok:true})};
 await WeChatRuntime.prototype.connect.call(r);assert.equal(r.codex,r.engines.dsh);assert.deepEqual(r.models,['dsh-model']);
});
