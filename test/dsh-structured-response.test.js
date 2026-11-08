import test from 'node:test';import assert from 'node:assert/strict';
import {structuredResponse,chatResponse,structuredTaskResponse} from '../integrations/dsh/structured-response.mjs';
test('DSH structured output supports a single fenced object or explanatory wrapper',()=>{
  const body=JSON.stringify({reply:'你好\n链接 {示例}',memories:[]});
  for(const text of [body,'```json\n'+body+'\n```','结果如下：\n'+body])assert.equal(structuredResponse(text).reply,'你好\n链接 {示例}');
});

test('ordinary natural text and line breaks do not require a JSON envelope',()=>{
  const r=chatResponse('诶 在呢\n刚刚卡了一下');assert.equal(r.reply,'诶 在呢\n刚刚卡了一下');assert.deepEqual(r.memories,[]);assert.equal(r.format.mode,'text');
});

test('optional metadata failure preserves reply and never sends internal metadata',()=>{
  for(const tail of ['{"memories":broken}\n```','{"memories":[]','{"memories":[]}\n```\nleaked trailing data']){
    const r=chatResponse('记住啦\n```xiaoyu-meta\n'+tail);assert.equal(r.reply,'记住啦');assert.deepEqual(r.memories,[]);assert.deepEqual(r.format.warnings,['DSH_METADATA_FORMAT_IGNORED']);
  }
  const r=chatResponse('嗯\n```xiaoyu-meta\n{"memories":"invalid"}\n```');assert.equal(r.reply,'嗯');assert.deepEqual(r.memories,[]);assert.ok(r.format.warnings.includes('DSH_MEMORY_FORMAT_IGNORED'));
});

test('valid optional metadata and legacy JSON both preserve facts without another generation',()=>{
  const m={key:'饮料',value:'白茶',evidence:'白茶',type:'preference'};
  const r=chatResponse('好呀\n```xiaoyu-meta\n'+JSON.stringify({memories:[m],assetId:'asset-1'})+'\n```');assert.deepEqual(r.memories,[m]);assert.equal(r.assetId,'asset-1');
  assert.equal(chatResponse('{"reply":"嗯","memories":"bad"}').reply,'嗯');
  assert.equal(chatResponse('{"reply":"第一句\n第二句","memories":[]}').reply,'第一句\n第二句');
});

test('empty, ambiguous, truncated envelopes and oversized replies are not sent as chat text',()=>{
  for(const raw of ['', '{"reply":"未闭合', '{"reply":"a","memories":[]} {"reply":"b","memories":[]}', '结果：{"reply":"bad','a'.repeat(24001)])assert.throws(()=>chatResponse(raw));
});
test('DSH structured output refuses ambiguous objects, invalid schema and malformed strings',()=>{
  assert.throws(()=>structuredResponse('{"reply":"a","memories":[]} {"reply":"b","memories":[]}'),e=>e.code==='DSH_RESPONSE_AMBIGUOUS');
  assert.throws(()=>structuredResponse('{"reply":"a"}'),e=>e.code==='DSH_RESPONSE_SCHEMA_INVALID');
  assert.throws(()=>structuredResponse('{"reply":"bad\nline","memories":[]}'),e=>e.code==='DSH_RESPONSE_JSON_INVALID');
  assert.throws(()=>structuredResponse('原生工具失败'),e=>e.code==='DSH_RESPONSE_JSON_INVALID');
});

test('local structured tasks preserve machine JSON independently from human chat parsing',()=>{const value={summary:'鱼群里有三条限制',uncertainty:'只看采样',topic:'插件'};const r=structuredTaskResponse(JSON.stringify(value));assert.deepEqual(JSON.parse(r.reply),value);assert.deepEqual(r.memories,[]);assert.equal(r.format.mode,'local-task-json');assert.deepEqual(JSON.parse(structuredTaskResponse(JSON.stringify({reply:JSON.stringify(value),memories:[]})).reply),value);for(const raw of ['正文不是JSON','{} {}','{"summary":"截断', '[]'])assert.throws(()=>structuredTaskResponse(raw));});
