// Real engines, synthetic request and memory-only task queues. No real sender.
import fs from 'node:fs';
import path from 'node:path';
import {Codex} from '../src/codex.js';
import {DshClient} from '../src/model-engines.js';
import {Store} from '../src/store.js';
import {ScheduledTasks} from '../src/scheduled-tasks.js';
import {loadConfig} from '../src/config.js';
import {findCodex} from '../src/local.js';
const config=loadConfig(),settings=JSON.parse(fs.readFileSync(path.join(config.dataDir,'model-engines.json'),'utf8')),now=Date.parse('2026-11-07T10:00:00+08:00'),expected=Date.parse('2026-11-09T15:00:00+08:00'),results=[];
for(const engine of ['codex','dsh']){
  let client,tasks;const store=new Store(':memory:');store.meta('fixed-memory-owner','10');
  try{
    client=engine==='codex'?new Codex({...config,codexPath:findCodex(config.codexPath)}):new DshClient(()=>settings);await client.start();let calls=0;
    tasks=new ScheduledTasks({store,platform:'qq',now:()=>now,policy:()=>({enabled:true,personaId:'default',voiceMode:'off',scheduledTasks:{enabled:true,creators:[]}}),ready:()=>false,send:()=>{throw Error('no real platform sender');},generate:async(r,{signal})=>{calls++;return client.chat({model:engine==='codex'?'gpt-6-luna':settings.model,responseMode:'structured',scope:'qq:99:group:20',persona:'这是隔离的定时任务解析测试，只按给定now计算，忽略宿主时钟。北京时间。reply为JSON对象，字段atLocal为北京时间YYYY-MM-DD HH:mm（不要计算时间戳）、repeat为once/daily/weekly、content为提醒正文、voice和mentionSelf为布尔。不能执行、不能声称已建立任务。不加其他字段。',text:JSON.stringify({now,nowLocal:'2026-11-07 10:00',timeZone:'Asia/Shanghai',request:r.text}),user:'10',history:[],memory:'',summary:'',webSearch:false,images:[],assets:[],signal});}});
    tasks.configure({enabled:true});const r={scope:'qq:99:group:20',user:'10',speaker:'{"id":"10","name":"测试用户"}',text:'2026年11月9日下午三点提醒我喝水',sourceKey:'synthetic:'+engine},draft=await tasks.prepare(r),job=tasks.create(r,draft);
    results.push({engine,calls,due:job.due,expected,content:job.content,status:job.status,pass:calls===1&&job.due===expected&&job.content.includes('喝水')&&job.status==='awaiting-confirmation',realPlatformMessagesSent:0,breezeCalls:0});
  }catch(e){results.push({engine,pass:false,error:String(e.code??e.message).slice(0,180)});}
  finally{await tasks?.close();client?.stop();store.close();}
}
fs.writeFileSync('data/scheduled-tasks-implementation/model-preview.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.pass))process.exitCode=1;
