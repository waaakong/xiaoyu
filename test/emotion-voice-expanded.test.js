import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Emotion} from '../src/emotion.js';
import {Media} from '../src/media.js';
import {PackManager} from '../src/meme-packs.js';
import {voiceTemplates,validateVoiceTemplate,compileVoiceDirection} from '../src/voice-emotion.js';
import {MOODS,moodOf} from '../src/meme-search.js';
import {EXPANDED_EMOJIS,EXPANDED_KEY_SET} from '../src/emoji-expanded.js';
import {EXPANDED_ENTRY} from '../src/emoji-expanded-twemoji.js';

test('temper and hurt are first-class emotion axes with bounded expression',()=>{
  const s=new Store(':memory:'),e=new Emotion(s,{now:()=>1000}),scope='qq:1:private:2';
  try{
    const angry=e.observe(scope,'p','烦死了，真讨厌，够了',{turnId:'a1'});
    assert.ok(angry.axes.anger>.22);
    assert.match(angry.label,/恼火/);
    assert.ok(['angry','annoyed'].includes(e.mood(angry)));
    assert.match(e.prompt(angry),/可以有脾气/);
    assert.match(e.prompt(angry),/不人身攻击/);
    const hurt1=e.observe('qq:1:private:3','p','委屈，失望，受伤，心寒',{turnId:'h1'});
    const hurt2=e.observe('qq:1:private:3','p','还是委屈，感觉被忽略了',{turnId:'h2'});
    assert.ok(hurt2.axes.hurt>hurt1.axes.hurt);
    assert.equal(e.mood(hurt2),'hurt');
    assert.equal(e.mood(e.read('qq:1:private:4','p')),null);
    assert.ok(e.prompt(e.read('qq:1:private:4','p')).length<=65);
  }finally{s.close();}
});

test('voice direction follows temper while old seven-tone templates still validate and fall back',()=>{
  const t=voiceTemplates[0];
  const angry=compileVoiceDirection(t,{enabled:true,valence:-.6,arousal:.7,axes:{anger:.7}});
  assert.equal(angry.tone,'angry');
  assert.match(angry.instructions,/不悦/);
  assert.equal(compileVoiceDirection(t,{axes:{anger:.3}}).tone,'annoyed');
  assert.equal(compileVoiceDirection(t,{axes:{hurt:.6}}).tone,'hurt');
  const legacy={...t,mapping:Object.fromEntries(Object.entries(t.mapping).filter(([k])=>['neutral','happy','excited','low','serious','comfort','tired'].includes(k)))};
  validateVoiceTemplate(legacy);
  assert.equal(compileVoiceDirection(legacy,{axes:{anger:.7}}).mappedTone,'serious');
  assert.equal(compileVoiceDirection(legacy,{axes:{hurt:.6}}).mappedTone,'low');
  assert.throws(()=>validateVoiceTemplate({...t,mapping:{...t.mapping,weird:{emotion:'x',pace:'y',pause:'z'}}}));
});

test('meme moods cover fine-grained temper and expanded pack keeps the core contract intact',async t=>{
  assert.ok(MOODS.annoyed&&MOODS.hurt&&MOODS.smug&&MOODS.playful&&MOODS.excited&&MOODS.tired);
  assert.equal(moodOf('','恼火'),'annoyed');
  assert.equal(moodOf('','委屈'),'hurt');
  assert.equal(moodOf('','得意'),'smug');
  assert.equal(EXPANDED_KEY_SET,'xiaoyu-emoji-expanded@1');
  assert.equal(EXPANDED_EMOJIS.length,37);
  assert.equal(EXPANDED_ENTRY.count,37);
  assert.equal(EXPANDED_ENTRY.id,'twemoji-expanded-37');
  assert.equal(new Set(EXPANDED_EMOJIS.map(e=>e.key)).size,37);
  assert.ok(EXPANDED_EMOJIS.every(e=>MOODS[e.mood]));
  for(const mood of ['angry','annoyed','hurt','smug','playful','tired'])assert.ok(EXPANDED_EMOJIS.some(e=>e.mood===mood),mood);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-expanded-test-'));
  const packs=new PackManager(new Media(new Store(':memory:'),dir),dir);
  t.after(async()=>{await packs.close();fs.rmSync(dir,{recursive:true,force:true});});
  packs.download=async()=>Buffer.from('{"packs":[]}');
  const catalog=await packs.catalog({refresh:true});
  assert.ok(catalog.entries.some(e=>e.id===EXPANDED_ENTRY.id&&e.count===37&&e.supported));
});
