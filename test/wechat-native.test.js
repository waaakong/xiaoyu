import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {nativePacket,WeChatNativeClient,usesCurrentNative} from '../src/wechat-native.js';
import {WeChatIO} from '../src/wechat-io.js';
import {naturalChatText} from '../src/chat-rhythm.js';

const account='wx_test',folder='wx_test_1234',peer='wx_friend';
const client={version:'4.2.0.13',signatureValid:true,coreVersion:'4.2.0.13',machine:'8664'};

async function fixture(t,{groupMention=false}={}){
  let sends=0,text='',verified=true,unknown=false,lastMention=null;const routes=[],target=groupMention?'123@chatroom':peer;
  const server=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer '+'a'.repeat(64)){res.writeHead(401).end('{}');return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/health'){res.end(JSON.stringify({integration:'XiaoyuNative-1',version:'4.2.0.13',pid:123,accountDirectory:folder,verified,nativeProtocol:2,nativeMentionSend:groupMention,submissionLimit:1000,submissions:sends}));return;}
    if(req.url==='/send'||req.url==='/send-at'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const packet=Buffer.concat(chunks);
      sends++;routes.push(req.url);const offset=req.url==='/send-at'?52:48;text=packet.subarray(offset+packet.readUInt32LE(40),offset+packet.readUInt32LE(40)+packet.readUInt32LE(44)).toString();lastMention=req.url==='/send-at'?packet.subarray(offset+packet.readUInt32LE(40)+packet.readUInt32LE(44)).toString():null;
      if(unknown){res.writeHead(500).end('{"state":"unknown"}');return;}
      res.end('{"state":"submitted"}');return;
    }res.writeHead(404).end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config={account,executable:'client',mode:'hook',nativeAdapter:'xiaoyu-1',hookUrl:`http://127.0.0.1:${server.address().port}`,hookToken:'a'.repeat(64),readerUrl:'http://127.0.0.1:11444',readerToken:'reader'};
  const fetchImpl=async url=>{
    const u=new URL(url);let body;
    if(u.pathname.endsWith('/status'))body={backend:'weflow-cli-nt',ownWxid:account,accountDirectory:folder};
    else if(u.pathname.endsWith('/contacts'))body={contacts:[{username:target,displayName:'同名好友'}]};
    else body={messages:sends&&!unknown?[{serverId:String(9000+sends),localId:String(3+sends),createTime:Math.floor(Date.now()/1000),isSend:true,content:text,msgSource:lastMention?'<msgsource><atuserlist>'+lastMention+'</atuserlist></msgsource>':''}]:[]};
    if(groupMention&&body.messages)body.messages.push({serverId:'8000',localId:1,createTime:Date.now()/1000,isSend:false,senderUsername:'wx_member',content:'真实群成员发言'});
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  };
  const dir=fs.mkdtempSync(path.join(process.cwd(),'data/native-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const io=new WeChatIO({config:()=>config,policy:()=>({enabled:true}),dir,inspect:async()=>client,fetchImpl,
    foreground:{send(){throw Error('Must not operate foreground')},probe(){throw Error('Must not inspect UI')},close(){}}});
  return {config,io,stats:()=>({sends,routes}),invalidate:()=>verified=false,fail:()=>unknown=true};
}

test('native packet bounds IDs, UTF-8 bytes and embedded NUL',()=>{
  const id='12345678-1234-1234-1234-123456789abc';const p=nativePacket(peer,'你好🙂',id);
  assert.equal(p.readUInt32LE(44),Buffer.byteLength('你好🙂'));assert.equal(p.subarray(48+Buffer.byteLength(peer)).toString(),'你好🙂');
  for(const [target,text] of [['../wrong','hi'],[peer,'a\0b'],[peer,'中'.repeat(1001)]])assert.throws(()=>nativePacket(target,text,id),/PAYLOAD_INVALID/);
  assert.throws(()=>nativePacket(peer,'hi','not-uuid'),/PAYLOAD_INVALID/);
});

test('new adapter is selected explicitly for the exact current version',()=>{
  assert.equal(usesCurrentNative({mode:'hook',nativeAdapter:'xiaoyu-1'},client),true);
  assert.equal(usesCurrentNative({mode:'foreground',nativeAdapter:'xiaoyu-1'},client),false);
  assert.equal(usesCurrentNative({mode:'hook'},client),false);
  assert.equal(usesCurrentNative({mode:'hook',nativeAdapter:'xiaoyu-1'},{version:'4.2.0.14'}),false);
});

test('current native reply uses real raw ID, bypasses UI and still requires independent receipt',async t=>{
  const {io,stats}=await fixture(t);await io.verify();io.connected=true;
  const result=await io.reply({message_type:'private',user_id:peer},'原生路径测试');
  assert.equal(result[0].receipt,'wechat-server-id');assert.equal(result[0].message_id,'9001');assert.equal(stats().sends,1);
});

test('normalized DSH paragraphs become separate native WeChat sends with separate confirmed receipts',async t=>{
  const {io,stats}=await fixture(t);await io.verify();io.connected=true;
  const receipts=await io.reply({message_type:'private',user_id:peer},naturalChatText('咋了，是我哪句说岔了\n\n还是又崩了在等我回'),{natural:true});
  assert.deepEqual(receipts.map(r=>r.message_id),['9001','9002']);assert.equal(stats().sends,2);
  const audits=fs.readdirSync(io.dir).filter(n=>n.startsWith('delivery-')).map(n=>JSON.parse(fs.readFileSync(path.join(io.dir,n))));assert.equal(audits.length,2);assert.ok(audits.every(x=>x.state==='confirmed'));assert.notEqual(audits[0].bodyHash,audits[1].bodyHash);
});
test('WeChatIO routes the first bubble through true @ and requires matching native mention metadata',async t=>{
  const {io,stats}=await fixture(t,{groupMention:true});await io.verify();io.connected=true;let attempts=0;
  const result=await io.reply({message_type:'group',group_id:'123@chatroom',user_id:'wx_member'},'先保存\n然后关闭',{natural:true,mention:{id:'wx_member',name:'测试'},beforeMention:()=>{attempts++;return true;}});
  assert.deepEqual(stats().routes,['/send-at','/send']);assert.equal(attempts,1);assert.equal(result[0].mentionId,'wx_member');assert.equal(result[1].mentionId,undefined);assert.equal(result[0].receipt,'wechat-server-id');
  const audits=fs.readdirSync(io.dir).filter(n=>n.startsWith('delivery-')).map(n=>JSON.parse(fs.readFileSync(path.join(io.dir,n))));assert.ok(audits.every(a=>a.state==='confirmed'));
});

test('native mismatch and cancellation refuse before submission',async t=>{
  const {io,invalidate,stats}=await fixture(t);await io.verify();io.connected=true;
  await assert.rejects(io.reply({message_type:'private',user_id:peer},'hi',{beforeSend(){throw Error('cancelled')}}),/cancelled/);
  invalidate();await assert.rejects(io.reply({message_type:'private',user_id:peer},'hi'),/IDENTITY_MISMATCH/);assert.equal(stats().sends,0);
});

test('unknown native submission is audited once without retry or foreground fallback',async t=>{
  const {io,fail,stats}=await fixture(t);await io.verify();io.connected=true;fail();
  await assert.rejects(io.reply({message_type:'private',user_id:peer},'hi'),/REFUSED_500/);
  assert.equal(stats().sends,1);
  const audits=fs.readdirSync(io.dir).filter(name=>name.startsWith('delivery-')).map(name=>JSON.parse(fs.readFileSync(path.join(io.dir,name))));
  assert.equal(audits.length,1);assert.equal(audits[0].state,'unknown');
});

test('native client refuses off-machine endpoints before network access',async()=>{
  const transport=new WeChatNativeClient(()=>({hookUrl:'http://example.com',hookToken:'a'.repeat(64)}));
  await assert.rejects(transport.verify({accountDirectory:folder}),/ENDPOINT_INVALID/);
});

test('stopping an idle WeChat SSE reader cancels a pending read even if fetch ignores abort',async()=>{
  let cancelled=false,stream;
  const io=new WeChatIO({config:()=>({mode:'foreground',account,executable:'client',readerUrl:'http://127.0.0.1:11444',readerToken:'reader'}),
    inspect:async()=>client,verifyIdentity:async()=>({account,accountDirectory:folder,version:client.version}),
    foreground:{probe:async()=>({accepted:true}),close(){}},fetchImpl:async url=>{
      if(url.endsWith('/status'))return Response.json({backend:'weflow-cli-nt',ownWxid:account,accountDirectory:folder});
      return new Response(new ReadableStream({start(controller){stream=controller;},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
    }});
  await io.start();await new Promise(resolve=>setImmediate(resolve));
  const stopping=io.stop();let timer;
  const stopped=await Promise.race([stopping.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),500);})]);
  clearTimeout(timer);if(!stopped)stream.close();await stopping;
  assert.equal(stopped,true);assert.equal(cancelled,true);assert.equal(io.connected,false);
});
