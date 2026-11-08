import test from 'node:test';import assert from 'node:assert/strict';import {Store} from '../src/store.js';import {Emotion,emotionCue,decayEmotion} from '../src/emotion.js';
test('emotion cues handle negation and ambiguous sarcasm without treating them as facts',()=>{assert.ok(emotionCue('我不开心').valence<0);assert.equal(emotionCue('我不生气').valence,0);assert.equal(emotionCue('真棒啊又崩了').uncertain,true);assert.equal(emotionCue('真棒啊又崩了').valence,0);assert.ok(emotionCue('今天好耶太好了',{}).valence>0);});
test('time decay is repeatable and never compounds on read',()=>{const row={valence:.8,arousal:.9,updatedAt:1000};const a=decayEmotion(row,3601000),b=decayEmotion(row,3601000);assert.deepEqual(a,b);assert.ok(a.valence<row.valence);assert.ok(a.arousal<row.arousal);assert.equal(decayEmotion(row,0).valence,.8);});
test('states isolate chat and persona, disabled/off modes and single-turn idempotence',()=>{
 const s=new Store(':memory:');let now=1000;const e=new Emotion(s,{now:()=>now});try{const scope='qq:1:private:2';const first=e.observe(scope,'a','太好了成功了好耶哈哈',{turnId:'turn1'});assert.ok(first.valence>0);assert.deepEqual(e.observe(scope,'a','太好了成功了好耶哈哈',{turnId:'turn1'}),first);assert.equal(e.read(scope,'b').valence,0);assert.equal(e.read('qq:1:private:3','a').valence,0);assert.equal(e.read('wechat:wxid_a:private:wxid_b','a').valence,0);
  e.configure({scope,personaId:'a',expressionStyle:'off'});assert.equal(e.prompt(e.read(scope,'a')),'');assert.equal(e.mood(e.read(scope,'a')),null);
  e.configure({scope,personaId:'a',enabled:false});const before=e.read(scope,'a');assert.deepEqual(e.observe(scope,'a','烦死了生气',{turnId:'turn2'}),before);
  e.configure({scope,personaId:'a',enabled:true,expressionStyle:'explicit',reset:true});assert.equal(e.read(scope,'a').label,'平静');assert.ok(e.prompt(e.read(scope,'a')).length<=65);
  assert.throws(()=>e.configure({scope,personaId:'a',expressionStyle:'arbitrary'}));now+=3600000;assert.ok(Number.isFinite(e.read(scope,'a').valence));
 }finally{s.close();}
});
