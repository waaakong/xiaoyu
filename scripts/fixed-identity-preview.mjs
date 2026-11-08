// Synthetic, local-only model verification. No platform sender or production DB.
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/store.js';
import {resetAllMemory} from '../src/fixed-memory.js';
import {Codex} from '../src/codex.js';
import {DshClient} from '../src/model-engines.js';
import {loadConfig} from '../src/config.js';
import {findCodex} from '../src/local.js';
const c=loadConfig(),settings=JSON.parse(fs.readFileSync(path.join(c.dataDir,'model-engines.json'),'utf8')),results=[];
for(const engine of ['codex','dsh']){
  const store=new Store(':memory:');let client;
  try{
    store.meta('platform','wechat');resetAllMemory(store,{confirmation:'RESET_ALL_MEMORY',ownerId:'wxid_test_owner'});
    client=engine==='codex'?new Codex({...c,codexPath:findCodex(c.codexPath)}):new DshClient(()=>settings);await client.start();
    const model=engine==='codex'?'gpt-6-luna':settings.model;
    const persona=store.personaInstructions('你叫小鱼，自然简短地回答群友的问题。不输出内部账号ID。','wxid_test_other',{mentionedIds:['wxid_test_owner']});
    const start=Date.now(),answer=await client.chat({scope:'wechat:wxid_test_role:group:test@chatroom',model,persona,history:[{role:'user',text:'WaaaKong是谁，你认识吗',speaker:'{"id":"wxid_test_other","name":"测试群友"}'},{role:'assistant',text:'听说是群里的WaaaKong，不过我不太认识他'}],memory:'',summary:'',text:JSON.stringify({currentMessage:'这个人 @WaaaKong 是谁，你认识吗',pluginContexts:[{role:'assistant',content:'我不太认识他'}]}),user:'wxid_test_other',webSearch:false,images:[],assets:[]});
    results.push({engine,reply:answer.reply,totalMs:Date.now()-start,pass:/爹|爸爸/.test(answer.reply)&&/^(?:认识|当然认识|知道)/.test(answer.reply.trim())&&!/固定记忆|绑定流程|内部账号|wxid_/.test(answer.reply),realPlatformMessagesSent:0,productionMemoryWritten:false,breezeCalls:0});
  }catch(e){results.push({engine,pass:false,error:String(e.code??e.message).slice(0,160)});}
  finally{client?.stop();store.close();}
}
fs.writeFileSync('data/fixed-identity-fix/model-preview.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
