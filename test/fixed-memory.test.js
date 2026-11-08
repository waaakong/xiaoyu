import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {RecallSession} from '../src/living-memory.js';
import {resetAllMemory,FIXED_MEMORIES} from '../src/fixed-memory.js';
import {refreshPersona} from '../src/persona-refresh.js';
import {Bridge} from '../src/bridge.js';
test('reset preserves visible archive but excludes it from context, learning and continuity',()=>{
  const s=new Store(':memory:');try{
    s.meta('platform','qq');const scope='qq:100010001:private:100020002';
    s.savePersona({id:'default',name:'小鱼',category:'默认',text:'原人设'});
    const id=s.add(scope,'user','旧代号是测试旧内容','received','100020002','old-receipt');
    s.remember(scope,'旧代号','测试旧内容',{sourceId:id});s.saveSummary(scope,id,'旧摘要');
    s.cognition.saveNote({scope,personaId:'default',kind:'user',title:'旧笔记',text:'旧内容'});
    s.db.exec("CREATE TABLE learning_settings(scope TEXT,personaId TEXT,afterId INTEGER,diaryAfterId INTEGER)");
    s.db.prepare('INSERT INTO learning_settings VALUES(?,?,0,0)').run(scope,'default');
    assert.throws(()=>resetAllMemory(s,{ownerId:'100020002'}));
    const r=resetAllMemory(s,{confirmation:'RESET_ALL_MEMORY',ownerId:'100020002'});
    assert.equal(r.through,id);assert.equal(s.historyPage(scope).length,1);assert.equal(s.history(scope,20).length,0);
    assert.equal(s.summaryRows(scope,id).length,0);assert.equal(s.quoted(scope,'old-receipt'),undefined);
    assert.equal(s.memories(scope).length,0);assert.equal(s.cognition.notes({scope}).length,0);
    s.living.indexMessage({...s.source(id),role:'user',status:'received'});assert.equal(s.living.episodes(scope,'旧代号').length,0);
    assert.equal(new RecallSession(s,{scope,members:['100020002'],query:'还记得旧代号吗',personaId:'default'}).prepare().memory,'');
    assert.equal(s.db.prepare('SELECT afterId FROM learning_settings').get().afterId,id);
    const n=s.add(scope,'user','新的消息','received','100020002');assert.ok(n>id);assert.equal(s.history(scope,20).length,1);
  }finally{s.close();}
});
test('exact fixed rules apply to any persona and new chats, with verified owner identity',()=>{
  for(const [platform,owner,other]of [['qq','100020002','123456'],['wechat','wxid_test_owner','wxid_other']]){
    const s=new Store(':memory:');try{s.meta('platform',platform);resetAllMemory(s,{confirmation:'RESET_ALL_MEMORY',ownerId:owner});
      assert.deepEqual(s.fixedMemories().map(x=>x.text),FIXED_MEMORIES.map(x=>x.text));
      for(const name of ['小鱼','知夏','大肥鱼','新增人格']){const p=s.personaInstructions(name,owner);for(const m of FIXED_MEMORIES)assert.equal(p.split(m.text).length-1,1);assert.ok(p.includes('当前发言者是已绑定'));}
      assert.ok(s.personaInstructions('知夏',other).includes('当前发言者不是已绑定'));s.remember(platform==='qq'?'qq:1:private:2':'wechat:wxid_a:private:wxid_b','问候','你好',{authority:'auto'});assert.equal(s.fixedMemories().length,FIXED_MEMORIES.length);
    }finally{s.close();}
  }
});
test('persona refresh keeps distinct names, rhythm and removes legacy identity example',()=>{
  const p=refreshPersona({name:'小鱼',text:'旧开头\n\n底层模型。被问身份时坦率承认是AI。\n\n短意群单个换行\n\n用户：你是不是AI\n\n小鱼：是啊\n'});
  assert.ok(p.text.includes('短意群单个换行'));assert.ok(!p.text.includes('小鱼：是啊'));assert.ok(p.text.includes('你叫小鱼'));
  assert.equal(refreshPersona(p).text,p.text);
});
test('normal and enhanced replies receive fixed preferences once, independent of selected engine',async()=>{
 for(const engine of ['codex','dsh'])for(const enhanced of [false,true]){
  const s=new Store(':memory:');try{s.meta('platform','qq');resetAllMemory(s,{confirmation:'RESET_ALL_MEMORY',ownerId:'10'});s.savePersona({id:'default',name:'小鱼',category:'默认',text:'小鱼的语气'});const seen=[];
   const cfg={admins:[],allowedUsers:['10'],allowedGroups:[],wakeWords:['小鱼'],followupSeconds:0,historyMessages:8,memoryChars:500,defaults:{engine,model:engine==='dsh'?'["p","m"]':null,pluginsEnabled:enhanced,pluginMode:enhanced?'enhanced':'commands'}};
   const b=new Bridge({config:cfg,store:s,persona:'小鱼',log:()=>{},codex:{selected:()=>engine,config:{model:'["p","m"]'},chat:async p=>{seen.push(p);return {reply:'Ciallo～(∠・ω< )⌒★',memories:[]};}},onebot:{reply:async()=>[{message_id:'receipt'}]}});
   if(enhanced)b.plugins={handle:async()=>false,cancel:()=>{},enhance:async(r,o)=>{const out=await o.model({purpose:'reply',prompt:'打招呼',contexts:[]},{signal:new AbortController().signal});await o.onSent({message:[{type:'text',data:{text:out.reply}}],receipt:{message_id:'enhanced'},signal:new AbortController().signal});return {calls:1,sent:1};}};
   await b.handle({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:'incoming',message:[{type:'text',data:{text:'你好'}}],sender:{nickname:'WaaaKong'}});await Promise.all([...b.queues.values()].map(q=>q.chain));
   assert.equal(seen.length,1);assert.equal(seen[0].engine,engine);for(const m of FIXED_MEMORIES)assert.equal(seen[0].persona.split(m.text).length-1,1);assert.equal(s.db.prepare("SELECT count(*) n FROM messages WHERE role='assistant' AND status='delivered'").get().n,1);
  }finally{s.close();}
 }
});
