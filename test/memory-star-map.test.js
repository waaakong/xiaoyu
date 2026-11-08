import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {memoryStarMap} from '../src/memory-star-map.js';
import {parseScope} from '../src/chat-identity.js';

const priv='qq:99:private:10',group='qq:99:group:20';
function fixture(t){
  const store=new Store(':memory:');t.after(()=>store.close());
  store.savePersona({id:'default',name:'小鱼',category:'test',text:'基础卡'});store.savePersona({id:'other',name:'知夏',category:'test',text:'另一角色'});
  store.meta('lastAccount','99');store.touchContact('99','private','10','测试联系人');store.touchContact('99','group','20','测试群');
  const policies=new Map(),policy=s=>({enabled:true,crossMemoryRead:true,crossMemoryWrite:true,personaId:'default',...policies.get(s)});
  const runtime={store,platform:'qq',configPolicy:policy,assertScope(s){if(parseScope(s).platform!==this.platform||parseScope(s).member)throw Error('会话编号无效');},contacts:()=>({account:'99',items:[{scope:priv,name:'测试联系人',kind:'private',peer:'10'},{scope:group,name:'测试群',kind:'group',peer:'20'}]})};
  return {store,runtime,policies,policy,get:p=>memoryStarMap(runtime,p)};
}
test('graph separates platform/account and preserves unassigned historical persona',t=>{
  const {store,get}=fixture(t);store.remember(priv,'偏好','乌龙');store.remember('qq:98:private:10','旧账号秘密','秘密');store.remember('wechat:wxid_role:private:wxid_peer','微信秘密','秘密');
  const g=get({personaId:'other'});assert.equal(g.total,1);const n=g.nodes.find(n=>n.id.startsWith('fact:'));assert.equal(n.personaId,'');assert.equal(g.unassigned,1);assert.doesNotMatch(JSON.stringify(g),/旧账号秘密|微信秘密/);
  assert.throws(()=>get({scope:'qq:98:private:10'}),/当前账号/);assert.throws(()=>get({scope:'wechat:wxid_role:private:wxid_peer'}));
});
test('notes carry actual persona; sources and versions are loaded through a scoped detail request',t=>{
  const {store,get}=fixture(t);const id=store.add(priv,'user','周六去海边','received','10');store.db.prepare('UPDATE messages SET personaId=? WHERE id=?').run('default',id);
  const note=store.cognition.saveNote({scope:priv,personaId:'default',kind:'upcoming',title:'看海',text:'周六去海边',sourceId:id});
  assert.equal(get({personaId:'other'}).total,0);const g=get({personaId:'default'});assert.equal(g.total,1);assert.equal(g.nodes.find(n=>n.id==='note:'+note.id).body,undefined);
  const d=get({scope:priv,node:'note:'+note.id}).detail;assert.equal(d.body,'周六去海边');assert.equal(d.sources[0].text,'周六去海边');assert.equal(d.personaName,'小鱼');assert.ok(d.version);
  assert.throws(()=>get({scope:group,node:'note:'+note.id}),/失效|范围/);
});
test('a selected group only sees explicitly granted facts; revocation invalidates revisions and detail',t=>{
  const {store,get,policy,policies}=fixture(t);const m=store.remember(priv,'饮品','桂花乌龙',{type:'preference'});
  assert.equal(get({scope:group}).total,0);const f=store.shared.publish({memoryId:m.id,targets:[group],includePrivate:false},policy);
  const g=get({scope:group});assert.equal(g.total,1);assert.ok(g.edges.some(e=>e.label==='已授权共享'));
  assert.equal(get({scope:group,revision:g.revision}).unchanged,true);
  policies.set(priv,{crossMemoryWrite:false});const revoked=get({scope:group,revision:g.revision});assert.equal(revoked.total,0);assert.notEqual(revoked.revision,g.revision);assert.throws(()=>get({scope:group,node:'fact:'+m.id}));
  policies.clear();store.shared.stop(f.id);assert.equal(get({scope:group}).total,0);
});
test('continuity respects owner, persona, selected route and disabling',t=>{
  const {store,get,policy}=fixture(t);const m=store.remember(priv,'偏好','白茶',{type:'preference'});store.remember('qq:99:private:11','其他人','红茶');
  const s=store.continuity.save({name:'测试续聊',owner:'10',personaId:'default',sourceScopes:[priv],targetScopes:[group]},policy);
  const g=get({scope:group});assert.equal(g.total,1);assert.equal(g.nodes.find(n=>n.id==='fact:'+m.id).access,'continuity');assert.equal(get({scope:group,personaId:'other'}).total,0);
  store.continuity.disable(s.id);assert.equal(get({scope:group}).total,0);
});
test('explicit all-persona shared grants are visible in the target role while preserving source role',t=>{
  const {store,get,policy,policies}=fixture(t),id=store.add(priv,'user','我喜欢白茶','received','10');store.db.prepare('UPDATE messages SET personaId=? WHERE id=?').run('default',id);
  const m=store.remember(priv,'饮品','白茶',{sourceId:id,type:'preference'});policies.set(group,{personaId:'other'});
  store.shared.publish({memoryId:m.id,targets:[group],includePrivate:false,allPersonas:true},policy);
  const g=get({scope:group,personaId:'other'});assert.equal(g.total,1);assert.equal(g.nodes.find(n=>n.id==='fact:'+m.id).personaId,'default');assert.equal(g.nodes.find(n=>n.id==='fact:'+m.id).access,'shared');
  assert.equal(get({scope:priv,personaId:'other'}).total,0);
});
test('forgotten/blocked sources and expired facts cannot remain in graph or cached detail',t=>{
  const {store,get}=fixture(t),id=store.add(priv,'user','周末喝茶','received','10');const m=store.remember(priv,'饮品','白茶',{sourceId:id});
  const before=get({});store.db.prepare('INSERT INTO memory_blocked(scope,messageId) VALUES(?,?)').run(priv,id);assert.equal(get({revision:before.revision}).total,0);assert.throws(()=>get({node:'fact:'+m.id}));
  const another=store.remember(priv,'过期','不展示');store.db.prepare('UPDATE memories SET expires=? WHERE id=?').run(Date.now()-1,another.id);assert.equal(get({}).total,0);
  const note=store.cognition.saveNote({scope:priv,personaId:'default',kind:'user',title:'手动笔记',text:'有效'});const first=get({});store.cognition.deleteNote(note.id);assert.notEqual(get({}).revision,first.revision);assert.throws(()=>get({node:'note:'+note.id}));
});
test('pagination, keyword/name/type/date filtering and stable IDs do not fabricate relations',t=>{
  const {store,get}=fixture(t);for(let i=0;i<505;i++)store.remember(priv,'测试记忆'+i,'内容'+i);const a=get({});assert.equal(a.total,505);assert.equal(a.visible,500);assert.equal(a.nextCursor,'500');assert.equal(get({cursor:'500'}).visible,5);
  assert.equal(get({query:'测试联系人'}).total,505);assert.equal(get({query:'测试记忆504'}).total,1);assert.equal(get({types:'plan'}).total,0);assert.equal(get({until:'2000-01-01'}).total,0);
  assert.equal(get({}).nodes[1].id,a.nodes[1].id);assert.ok(a.edges.every(e=>!['朋友','恋人','亲密'].includes(e.label)));assert.throws(()=>get({limit:501}));assert.throws(()=>get({types:'unknown'}));
});
test('fixed memories are platform-local records, not copies of persona biography or inference',t=>{
  const {store,get}=fixture(t);store.db.prepare('INSERT INTO fixed_memories VALUES(?,?)').run('autonomy','不必强迫一个人按我的想法做事');const g=get({personaId:'other',until:'2000-01-01'});assert.equal(g.counts.fixed,1);assert.equal(get({node:'fixed:autonomy'}).detail.sources.length,0);
  assert.doesNotMatch(JSON.stringify(g),/基础卡|另一角色/);
});
