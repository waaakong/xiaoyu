import test from 'node:test';
import assert from 'node:assert/strict';
import {platformName,accountLabel,peerLabel,isWeChat} from '../ui/platform-copy.js';
test('platform copy follows the selected data space',()=>{
  const store=new Map([['xyPlatform','wechat']]);
  globalThis.sessionStorage={getItem:key=>store.get(key)??null};
  assert.equal(isWeChat(),true);
  assert.equal(platformName(),'微信');
  assert.equal(accountLabel(),'微信号');
  assert.equal(peerLabel(),'微信号 / 群 ID');
  store.set('xyPlatform','qq');
  assert.equal(isWeChat(),false);
  assert.equal(platformName(),'QQ');
  assert.equal(accountLabel(),'QQ号');
  assert.equal(peerLabel(),'QQ号 / 群号');
});
