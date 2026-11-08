import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptBaseline,findReceipt,findMediaReceipt,serverMessageId} from '../src/wechat-receipts.js';
const started=1700000000000,text='test';
const message={localId:3,serverId:'4553041133109346590',createTime:1700000001,isSend:1,fullText:text};
test('media confirmation requires the exact digest, media type and a fresh independent server receipt',()=>{
  const md5='a'.repeat(32),image={...message,localType:3,imageMd5:md5},options={baseline:receiptBaseline([]),kind:'image',md5,started};assert.equal(findMediaReceipt([image],options),image);
  for(const patch of [{imageMd5:'b'.repeat(32)},{localType:47},{isSend:0},{serverId:'0'},{createTime:1600000000}])assert.equal(findMediaReceipt([{...image,...patch}],options),undefined);
  assert.equal(findMediaReceipt([image],{...options,baseline:receiptBaseline([image])}),undefined);
  const gif={...message,localType:8*2**32+49,stickerMd5:md5};assert.equal(findMediaReceipt([gif],{...options,kind:'sticker'}),gif);
});
test('same local ID from another shard does not hide a new confirmed message',()=>{const baseline=receiptBaseline([{...message,serverId:'1849354182549109299',createTime:1600000000,fullText:'old'}]);assert.equal(findReceipt([message],{baseline,text,started}),message);});
test('existing server message and old pending row acknowledgments cannot confirm a new send',()=>{const options={text,started};assert.equal(findReceipt([message],{...options,baseline:receiptBaseline([message])}),undefined);const pending={...message,serverId:'0',fullText:'test '};assert.equal(findReceipt([message],{...options,baseline:receiptBaseline([pending])}),undefined);});
test('receipt requires exact text, outgoing direction, recency and a confirmed server id',()=>{const options={text,started,baseline:receiptBaseline([])};for(const patch of [{fullText:'different'},{isSend:0},{createTime:1600000000},{serverId:'0'}])assert.equal(findReceipt([{...message,...patch}],options),undefined);});
test('64-bit server ids retain precision and signed storage is normalized',()=>{assert.equal(serverMessageId('4553041133109346590'),'4553041133109346590');assert.equal(serverMessageId('-9223372036854775808'),'9223372036854775808');for(const value of [0,Number('4553041133109346590'),'18446744073709551616','-9223372036854775809','invalid'])assert.equal(serverMessageId(value),null);});
