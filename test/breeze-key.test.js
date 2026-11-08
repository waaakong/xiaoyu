import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBreezeKey} from '../src/breeze-key.js';
import {Voice} from '../src/voice.js';
test('key IDs, voice IDs and masked values cannot be sent as developer credentials',async()=>{
  assert.equal(validateBreezeKey('brz_dummy-test-credential'),'brz_dummy-test-credential');
  assert.throws(()=>validateBreezeKey('key_dummy_identifier'),/密钥ID/);
  assert.throws(()=>validateBreezeKey('voc_dummy_voice'),/音色ID/);
  assert.throws(()=>validateBreezeKey('brz_********'),/掩码/);
  let requests=0;const voice=new Voice('unused-local-test-path',{secretStore:{has:()=>true,read:()=> 'key_dummy_identifier'},fetcher:async()=>{requests++;throw Error('must not request');}});
  await assert.rejects(voice.probe(),/密钥ID/);assert.equal(requests,0);
});
