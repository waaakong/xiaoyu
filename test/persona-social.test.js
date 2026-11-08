import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SOCIAL_BOUNDARIES,withSocialBoundaries} from '../src/persona-social.js';
import {refreshPersona} from '../src/persona-refresh.js';
test('social boundaries apply without fixed memories to custom and built-in personas',()=>{
  const s=new Store(':memory:');try{for(const name of ['小鱼','知夏','大肥鱼','自定义']){
    const original={name,text:'角色开头\n\n保留原来的标点和断句规则'};
    const p=refreshPersona(original);assert.ok(p.text.includes('保留原来的标点和断句规则'));
    assert.equal(refreshPersona(p).text,p.text);
    const prompt=s.personaInstructions(p.text,'other');assert.equal(prompt.split(SOCIAL_BOUNDARIES).length,2);
    assert.ok(prompt.includes('不能据此确认身份'));assert.ok(prompt.includes('不靠贬低第三个人'));
  }}finally{s.close();}
  assert.equal(withSocialBoundaries(withSocialBoundaries('test')),withSocialBoundaries('test'));
});
