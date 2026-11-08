import fs from 'node:fs';
import path from 'node:path';
import {Codex} from '../src/codex.js';
import {DshClient} from '../src/model-engines.js';
import {loadConfig} from '../src/config.js';
import {findCodex} from '../src/local.js';
import {GROUP_REPLY_NOTICE} from '../src/group-reply.js';
import {responseDecision} from '../src/social-rhythm.js';
const c=loadConfig(),settings=JSON.parse(fs.readFileSync(path.join(c.dataDir,'model-engines.json'),'utf8')),results=[];
for(const engine of ['codex','dsh']){
  let client;
  try{
    client=engine==='codex'?new Codex({...c,codexPath:findCodex(c.codexPath)}):new DshClient(()=>settings);await client.start();
    const answer=await client.chat({scope:'wechat:wxid_test_role:group:test@chatroom',model:engine==='codex'?'gpt-6-luna':settings.model,persona:'你叫小鱼，作为群友自然聊天。\n'+GROUP_REPLY_NOTICE,history:[{role:'user',text:'@测试群友 你语音系统都接上了？',speaker:'{"id":"wxid_b","name":"乙"}'},{role:'user',text:'对啊',speaker:'{"id":"wxid_a","name":"测试群友"}'},{role:'user',text:'能不能设置别一遍文字一遍语音，要不就单语音',speaker:'{"id":"wxid_b","name":"乙"}'}],memory:'',summary:'',text:JSON.stringify({currentMessage:'感觉有点多余',groupReplyGate:{explicit:false,reason:'natural-candidate'},pluginSystem:'尽量回应群消息'}),user:'wxid_b',webSearch:false,images:[],assets:[]});
    results.push({engine,reply:answer.reply,decision:responseDecision(answer.reply).kind,pass:responseDecision(answer.reply).kind!=='respond',realPlatformMessagesSent:0,breezeCalls:0});
  }catch(e){results.push({engine,pass:false,error:String(e.code??e.message).slice(0,160)});}
  finally{client?.stop();}
}
fs.writeFileSync('data/fixed-identity-fix/group-model-preview.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
