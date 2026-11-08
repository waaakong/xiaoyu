// Isolated live-model check. No real platform adapter or runtime database writes.
import fs from 'node:fs';import path from 'node:path';
import {Store} from '../src/store.js';import {Bridge} from '../src/bridge.js';
import {Codex} from '../src/codex.js';import {DshClient} from '../src/model-engines.js';
import {loadConfig} from '../src/config.js';import {findCodex} from '../src/local.js';
const c=loadConfig(),settings=JSON.parse(fs.readFileSync(path.join(c.dataDir,'model-engines.json'),'utf8')),results=[];
for(const engine of ['codex','dsh']){
  const store=new Store(':memory:');let bridge,client;const output=[];let calls=0;
  try{
    client=engine==='codex'?new Codex({...c,codexPath:findCodex(c.codexPath)}):new DshClient(()=>settings);await client.start();if(engine==='codex')await client.models();
    const model=engine==='codex'?'gpt-6-luna':settings.model,scope='qq:99:private:10',config={platform:'qq',allowedUsers:['10'],allowedGroups:[],admins:[],wakeWords:['小鱼'],historyMessages:10,historyChars:3000,memoryChars:600,followupSeconds:60,defaults:{model,engine,personaId:'default',proactive:{enabled:true,minMinutes:1,maxMinutes:1},autoSummary:false}};
    store.savePersona({id:'default',name:'本地测试角色',category:'test',text:'自然简短地聊天，不虚构用户事实，没有适合的话题就保持安静。'});
    store.add(scope,'user','今天先聊到这里，我去忙了','received','{"id":"10","name":"测试用户"}','local-test');
    bridge=new Bridge({config,store,account:'99',codex:{selected:()=>engine,chat:p=>{calls++;return client.chat(p);}},persona:'本地测试角色',onebot:{connected:true,reply:async(_event,text)=>{output.push(text);return [{message_id:'isolated-output'}];}},log:()=>{}});
    let now=Date.parse('2026-11-06T04:00:00Z');bridge.proactive.now=()=>now;bridge.proactive.random=()=>0;bridge.proactive.configure({enabled:true});bridge.proactive.activity(scope);now+=61000;
    const started=Date.now(),result=await bridge.proactive.run(scope);results.push({engine,status:result.status,modelCalls:calls,localOutputs:output.length,replyLength:output[0]?.length??0,noRealPlatformSent:true,runtimeMemoryWritten:false,totalMs:Date.now()-started,pass:calls===1&&['silent','delivered'].includes(result.status)&&output.every(text=>text.length<=1200&&!/QUOTE_SOURCE|REPLY_TO/u.test(text))});
  }catch(e){results.push({engine,pass:false,error:String(e.code??e.message).slice(0,160),noRealPlatformSent:true});}
  finally{await bridge?.stop();client?.stop();store.close();}
}
fs.mkdirSync('data/social-proactive',{recursive:true});fs.writeFileSync('data/social-proactive/model-preview.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
