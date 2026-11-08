import test from 'node:test';
import assert from 'node:assert/strict';
import {pluginModelInput} from '../src/plugin-model-server.js';
const base={trace:'00000000-0000-0000-0000-000000000000',purpose:'reply',system:'核心人设',prompt:'纽约时间呢',contexts:[]};
test('long-running plugin chats retain newest 40 messages without rejecting current question',()=>{
  const contexts=Array.from({length:101},(_,i)=>({role:i%2?'assistant':'user',content:'turn '+i}));
  const result=pluginModelInput({...base,contexts});
  assert.deepEqual(result.contexts,contexts.slice(-40));assert.equal(result.system,base.system);assert.equal(result.prompt,base.prompt);
});
test('history is fitted to remaining character budget without changing mandatory text',()=>{
  const system='人'.repeat(13000),prompt='问'.repeat(2000);
  const result=pluginModelInput({...base,system,prompt,contexts:[{role:'user',content:'旧'.repeat(30000)},{role:'assistant',content:'最近答复'}]});
  assert.equal(result.system,system);assert.equal(result.prompt,prompt);
  assert.equal(result.contexts.at(-1).content,'最近答复');assert.match(result.contexts[0].content,/较早内容已省略/);
  assert.ok(system.length+prompt.length+result.contexts.reduce((n,m)=>n+m.content.length,0)<=32000);
});
test('essential overflow and malformed history remain explicit errors; adjacent duplicates only',()=>{
  assert.throws(()=>pluginModelInput({...base,system:'s'.repeat(32001)}),/系统提示32001/);
  assert.throws(()=>pluginModelInput({...base,contexts:null}),/必须为数组/);
  assert.throws(()=>pluginModelInput({...base,contexts:[{role:'tool',content:'bad'}]}),/纯文本/);
  const a={role:'user',content:'你好'},b={role:'assistant',content:'你好'};
  assert.deepEqual(pluginModelInput({...base,contexts:[a,a,b,a]}).contexts,[a,b,a]);
});
test('emoji boundary trimming never produces lone surrogates',()=>{
  const r=pluginModelInput({...base,system:'s'.repeat(31980),prompt:'',contexts:[{role:'user',content:'🙂'.repeat(40)}]});
  assert.ok(!r.contexts[0].content.isWellFormed||r.contexts[0].content.isWellFormed());
});
