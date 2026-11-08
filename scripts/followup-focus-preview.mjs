// Live engine verification with synthetic context and an in-memory store only.
// No real platform adapter, no Breeze, no production conversation writes.
import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../src/store.js';
import {Bridge} from '../src/bridge.js';
import {Codex} from '../src/codex.js';
import {DshClient} from '../src/model-engines.js';
import {loadConfig} from '../src/config.js';
import {findCodex} from '../src/local.js';
const c=loadConfig(),settings=JSON.parse(fs.readFileSync(path.join(c.dataDir,'model-engines.json'),'utf8')),results=[];
for(const engine of (process.argv[2]?[process.argv[2]]:['codex','dsh'])){
  const store=new Store(':memory:');let client,bridge,release;let liveCalls=0;const outputs=[],inputs=[];
  try{
    client=engine==='codex'?new Codex({...c,codexPath:findCodex(c.codexPath)}):new DshClient(()=>settings);await client.start();
    const model=engine==='codex'?'gpt-6-luna':settings.model,scope='qq:99:private:10',speaker='{"id":"10","name":"本地测试用户"}',config={platform:'qq',allowedUsers:['10'],allowedGroups:[],admins:[],wakeWords:['小鱼'],historyMessages:20,historyChars:4000,memoryChars:600,followupSeconds:60,defaults:{model,engine,personaId:'default',pluginsEnabled:true,pluginMode:'enhanced',autoSummary:false,voiceMode:'off'}};
    store.savePersona({id:'default',name:'小鱼',category:'本地测试',text:'你叫小鱼，自然简短地聊天。先理解当前对方问的是什么，再回应；不要把无关旧事当成答案。'});
    const first=store.add(scope,'user','我生日是农历三月初八','received',speaker);store.tagTurn(first,'default','birthday');const second=store.add(scope,'assistant','记住啦，你生日是农历三月初八','delivered','AI');store.tagTurn(second,'default','birthday');store.remember(scope,'生日','农历三月初八',{pinned:true});
    let started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);let requests=0;
    bridge=new Bridge({config,store,account:'99',persona:'你叫小鱼',onebot:{connected:true,reply:async()=>[{message_id:'isolated'}]},codex:{selected:()=>engine,chat:async p=>{inputs.push(p);if(++requests===1){started();await gate;return {reply:'我叫小鱼呀',memories:[]};}liveCalls++;return client.chat(p);}},log:()=>{}});
    bridge.plugins={handle:async()=>false,enhance:async(r,{model,onSent,prepareSend})=>{const result=await model({purpose:'reply',system:'自然聊天，语气简短，不输出分析过程。',prompt:r.text,contexts:[{role:'user',content:'我生日是农历三月初八'},{role:'assistant',content:'知道呀，你生日是农历三月初八'}]},{});const route=prepareSend(result.reply);outputs.push(route.text);await onSent({message:[{type:'text',data:{text:route.text}}],receipt:{message_id:'isolated-'+outputs.length}});return {calls:1,sent:1};}};
    const event=(text,id)=>({post_type:'message',message_type:'private',self_id:99,user_id:10,message_id:id,sender:{nickname:'本地测试用户'},message:[{type:'text',data:{text}}]});
    const start=Date.now();await bridge.handle(event('你叫什么名字',1));await ready;await bridge.handle(event('你知道吗？',2));release();await Promise.all([...bridge.queues.values()].map(q=>q.chain));
    const reply=outputs[1]??'',focus=inputs[1]?JSON.parse(inputs[1].text).conversationFocus:null;results.push({engine,model,liveCalls,reply,focus:focus?{kind:focus.kind,anchorText:focus.anchor?.text,receivedBeforeAnchorAnswer:focus.receivedBeforeAnchorAnswer}:null,historyMessages:inputs[1]?.history.length,totalMs:Date.now()-start,noRealPlatformSent:true,noBreezeCalled:true,productionMemoryWritten:false,pass:liveCalls===1&&focus?.anchor?.text==='你叫什么名字'&&!!reply&&!/生日|三月|初八/u.test(reply)});
  }catch(error){results.push({engine,pass:false,error:String(error.code??error.message).slice(0,160),noRealPlatformSent:true,noBreezeCalled:true});}
  finally{release?.();await bridge?.stop();client?.stop();store.close();}
}
fs.mkdirSync('data/context-followup-fix',{recursive:true});fs.writeFileSync('data/context-followup-fix/model-preview.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
