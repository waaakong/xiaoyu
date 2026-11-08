import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {OneBot} from '../src/onebot.js';
test('real WebSocket authentication and OneBot action receipts',async()=>{
  const bot=new OneBot({port:0,onebotToken:'test-token-with-sufficient-length'});await bot.start();
  const port=bot.http.address().port;
  const bad=new WebSocket(`ws://127.0.0.1:${port}/onebot`);bad.on('error',()=>{});
  await new Promise(r=>bad.once('close',r));assert.equal(bot.connected,false);
  const ws=new WebSocket(`ws://127.0.0.1:${port}/onebot`,{headers:{Authorization:'Bearer test-token-with-sufficient-length'}});
  try{
    await once(ws,'open');
    ws.on('message',raw=>{const m=JSON.parse(raw);assert.equal(m.action,'send_private_msg');ws.send(JSON.stringify({echo:m.echo,status:'ok',retcode:0,data:{message_id:123}}));});
    const result=await bot.action('send_private_msg',{user_id:10,message:[{type:'text',data:{text:'hi'}}]});assert.equal(result.message_id,123);
    const got=once(bot,'message');ws.send(JSON.stringify({post_type:'message',user_id:10}));assert.equal((await got)[0].user_id,10);
  }finally{ws.terminate();await bot.stop();}
});
