import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {SelfAccounts,cleanAccount} from '../src/self-accounts.js';
import {ownVideoAccount} from '../src/video-account.js';
import {SelfModel} from '../src/self-model.js';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

function fixture(t){
 let now=100000;const store=new Store(':memory:');t.after(()=>store.close());
 const runtime={platform:'qq',store,accountId:'123456',onebot:{connected:true},protocolStatus:{online:true},verifiedQqIdentity:{account:'123456',nickname:'角色'},wechat:{child:{accountId:'wx_role',onebot:{connected:true}}},video:{browser:{sites:new Map([['bilibili',{cdp:{socket:{readyState:1}}}],['douyin',{cdp:{socket:{readyState:1}}}]])}}};
 const accounts=new SelfAccounts(runtime,{now:()=>now});return {store,runtime,accounts,advance:ms=>{now+=ms;}};
}
test('real role identity, offline state and a switched QQ account cannot be confused with declared values',t=>{
 const f=fixture(t);f.accounts.save({platform:'qq',publicId:'999999',nickname:'手填'});let row=f.accounts.rows()[0];assert.equal(row.verified.publicId,'123456');assert.equal(row.declared.publicId,'999999');assert.equal(row.status,'verified');
 f.store.meta('lastAccount','123456');f.runtime.accountId=null;f.runtime.onebot.connected=false;row=f.accounts.rows()[0];assert.equal(row.status,'offline');assert.equal(row.verified.publicId,'123456');
 f.runtime.accountId='654321';f.runtime.onebot.connected=true;row=f.accounts.rows()[0];assert.equal(row.verified.publicId,'654321');assert.equal(row.declared,null);assert.equal(row.verified.nickname,'');
});
test('ordinary chats see only current public identity, never other platform numbers or internal wxid',t=>{
 const f=fixture(t);f.accounts.verified('douyin',{publicId:'video_123',internalId:'internal_123'},'fixture');
 const q=f.accounts.view({scope:'qq:123456:group:1'});assert.equal(q.items.length,1);assert.equal(q.items[0].platform,'qq');assert.equal(JSON.stringify(q).includes('wx_role'),false);assert.equal(JSON.stringify(q).includes('video_123'),false);
 const wx=f.accounts.view({scope:'wechat:wx_role:group:123@chatroom'});assert.equal(wx.items.length,1);assert.equal(wx.items[0].verified.internalId,undefined);
 const owner=f.accounts.view({scope:'qq:123456:group:1'},{owner:true});assert.equal(owner.items.length,4);assert.equal(owner.items[1].verified.internalId,'wx_role');
});
test('video observations expire, logout invalidates current login, failures do not reuse a recent success',async t=>{
 const f=fixture(t);f.runtime.video.browser.identity=async()=>({status:'verified',fields:{publicId:'12345'},source:'本人头像'});
 assert.equal((await f.accounts.detect({platform:'bilibili'})).status,'verified');f.advance(300001);assert.equal(f.accounts.rows()[2].status,'stale');
 f.runtime.video.browser.identity=async()=>({status:'signed-out'});assert.equal((await f.accounts.detect({platform:'bilibili'})).status,'signed-out');
 f.runtime.video.browser.identity=async()=>{throw Error('failed');};await assert.rejects(f.accounts.detect({platform:'bilibili'}));assert.equal(f.accounts.rows()[2].status,'unknown');
 assert.equal(f.accounts.rows()[2].verified.publicId,'12345');
});
test('video detection never writes to an account that changed during observation or interrupts watching',async t=>{
 const f=fixture(t);f.runtime.video.active={};await assert.rejects(f.accounts.detect({platform:'douyin'}),/暂停/);f.runtime.video.active=null;
 f.runtime.video.browser.identity=async()=>{f.runtime.accountId='654321';return {status:'verified',fields:{publicId:'video'},source:'本人'};};await assert.rejects(f.accounts.detect({platform:'douyin'}),/已变化/);assert.equal(f.accounts.rows()[3].verified,null);
});
test('platform environments retain distinct video identities and declarations never permit secret fields or external URLs',t=>{
 const f=fixture(t),other=new Store(':memory:');t.after(()=>other.close());const wx=new SelfAccounts({...f.runtime,store:other,platform:'wechat',account:'wx_role'});
 f.accounts.verified('bilibili',{publicId:'12345'},'本人');assert.equal(wx.rows()[2].verified,null);
 for(const body of [{platform:'qq',token:'SECRET'},{platform:'wechat',publicId:'wx bad'},{platform:'douyin',profileUrl:'https://www.douyin.com/user/self?token=SECRET'}])assert.throws(()=>f.accounts.save(body));
 assert.throws(()=>cleanAccount('bilibili',{profileUrl:'https://space.bilibili.com.evil/12345'}));assert.throws(()=>cleanAccount('bilibili',{profileUrl:'https://space.bilibili.com:123/12345'}));
});

function element(text='',href=''){return {innerText:text,getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>href,querySelectorAll:()=>[]};}
function doc(host,path,entries){return {location:{hostname:host,pathname:path,href:'https://'+host+path},defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})},querySelectorAll:s=>entries[s]??[]};}
test('Bilibili uses only the self avatar anchor, rejects conflicting avatars and never adopts a creator link',()=>{
 const avatar=element('','//space.bilibili.com/12345'),creator=element('','https://space.bilibili.com/98765'),selector='.header-avatar-wrap a[href],a.header-entry-avatar[href]';
 assert.equal(ownVideoAccount(doc('www.bilibili.com','/video/BVtest',{'a[href]':[creator]}),'bilibili').status,'unknown');
 assert.equal(ownVideoAccount(doc('www.bilibili.com','/',{[selector]:[avatar]}),'bilibili').fields.publicId,'12345');
 assert.equal(ownVideoAccount(doc('www.bilibili.com','/',{[selector]:[avatar,creator]}),'bilibili').status,'unknown');
});
test('Douyin accepts the number only on the explicit self endpoint, never from another creator page or title',()=>{
 const info=element('角色\n抖音号：my_fish123\n关注');info.querySelectorAll=()=>[element('角色')];const entry={'[data-e2e="user-info"]':[info]};
 assert.equal(ownVideoAccount(doc('www.douyin.com','/user/creator',entry),'douyin').status,'unknown');
 const good=ownVideoAccount(doc('www.douyin.com','/user/self',entry),'douyin');assert.equal(good.fields.publicId,'my_fish123');assert.equal(good.fields.nickname,'角色');
 assert.equal(ownVideoAccount(doc('www.douyin.com','/user/self',{}),'douyin').status,'unknown');
});
test('account query topic reaches both prompt context and read-only broker with group privacy applied',async t=>{
 const f=fixture(t);f.store.meta('fixed-memory-owner','owner');const policy={enabled:true,personaId:'default'};
 const self=new SelfModel({store:f.store,version:'fixture',routeFile:new URL('../src/gui.js',import.meta.url),status:()=>({}),accounts:(r,o)=>f.accounts.view(r,o),persona:()=>({name:'角色'}),policy:()=>policy,releaseNotes:[],engines:{}});t.after(()=>self.close());
 const r={scope:'qq:123456:group:1',user:'guest',policy,text:'你自己的QQ号是多少'};
 const text=self.context(r);assert.match(text,/123456/);assert.doesNotMatch(text,/wx_role/);const result=await self.forChat(r).invoke({topic:'accounts'});assert.equal(result.data.items.length,1);
 const owner=await self.forChat({...r,user:'owner'}).invoke({topic:'accounts'});assert.equal(owner.data.items.length,4);
});

test('local account APIs require window authentication and keep manual declarations isolated by platform',async t=>{
 const {Runtime}=await import('../src/runtime.js'),{startGui}=await import('../src/gui.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xy-accounts-')),runtime=new Runtime({store:new Store(':memory:'),dataDir:dir}),gui=await startGui({open:false,autoConnect:false,runtime});
 t.after(async()=>{await gui.close();fs.rmSync(dir,{recursive:true,force:true});});
 const headers={'X-Session-Token':gui.token,'Content-Type':'application/json'};
 assert.equal((await fetch(gui.origin+'/api/self-model/accounts')).status,403);
 const saved=await fetch(gui.origin+'/api/self-model/accounts/save',{method:'POST',headers,body:JSON.stringify({platform:'douyin',publicId:'declared_fish'})});assert.equal(saved.status,200);
 const rows=await(await fetch(gui.origin+'/api/self-model/accounts',{headers})).json();assert.equal(rows[3].declared.publicId,'declared_fish');assert.equal(rows[3].verified,null);
 await runtime.wechat.save({account:'wx_test'});
 const wx=await(await fetch(gui.origin+'/api/self-model/accounts',{headers:{...headers,'X-Platform':'wechat'}})).json();assert.equal(wx[3].declared,null);
 assert.equal((await fetch(gui.origin+'/api/self-model/accounts/save',{method:'POST',headers,body:JSON.stringify({platform:'qq',token:'SECRET'})})).status,400);
});
