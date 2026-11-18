// Explicit operator CLI. No message transport is constructed by this tool.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {Store} from '../src/store.js';
import {ModelEngines} from '../src/model-engines.js';
import {Codex} from '../src/codex.js';
import {findCodex} from '../src/local.js';
import {loadConfig,policyFor} from '../src/config.js';
import {MemoryConsolidation} from '../src/memory-consolidation.js';
import {parseScope} from '../src/chat-identity.js';
const [command,platform,sourceFile,configFile,stageFile]=process.argv.slice(2);
if(!['plan','run','import'].includes(command)||!['qq','wechat'].includes(platform)||!sourceFile||!configFile||!stageFile)throw Error('用法：node scripts/memory-history.mjs plan|run|import qq|wechat 正式数据库 配置文件 整理副本数据库');
if(path.resolve(stageFile)===path.resolve(sourceFile))throw Error('整理副本不能是正式数据库');
fs.mkdirSync(path.dirname(stageFile),{recursive:true});
if(!fs.existsSync(stageFile)){if(command!=='plan')throw Error('请先创建整理计划');const source=new DatabaseSync(sourceFile,{readOnly:true});await backup(source,stageFile);source.close();}
const config=loadConfig(configFile),stage=new Store(stageFile),account=stage.meta('lastAccount')??stage.db.prepare('SELECT scope FROM messages ORDER BY id DESC LIMIT 1').get()?.scope.split(':')[1];
const assertScope=s=>{const p=parseScope(s);if(p.platform!==platform||p.account!==account||p.member)throw Error('历史账号范围不匹配');};
let codex;const engines=new ModelEngines('data',{getCodex:()=>codex,getDefault:()=>config.defaults?.engine??'codex'}),runtime={store:stage,platform,assertScope,configPolicy:s=>policyFor(config,s),engines};
const service=new MemoryConsolidation(runtime);
try{
 if(command==='plan'){const result=service.queue({confirm:true});console.log(JSON.stringify({platform,...result,jobs:stage.db.prepare('SELECT status,count(*) count,sum(estimate) estimate FROM archive_jobs GROUP BY status').all(),messages:stage.db.prepare('SELECT count(*) count,min(created) first,max(created) last FROM messages').get(),blocked:stage.db.prepare('SELECT count(*) count FROM memory_blocked').get().count}));}
 if(command==='run'){
  for(const row of stage.db.prepare("SELECT DISTINCT scope FROM archive_jobs WHERE status='queued'").all()){const selected=engines.selected(runtime.configPolicy(row.scope).engine);if(selected==='dsh'&&engines.dsh.closed)await engines.connectDsh();if(selected==='codex'&&!codex){const c={...config,codexPath:findCodex(config.codexPath)};codex=new Codex(c);await codex.start();}}
  while(stage.db.prepare("SELECT 1 FROM archive_jobs WHERE status='queued'").get()){try{const result=await service.runNext();console.log(JSON.stringify({platform,...result}));}catch(e){console.log(JSON.stringify({platform,error:e.message}));if(/预算|额度|未连接|QUOTA/u.test(e.message))break;}}
  console.log(JSON.stringify({platform,budget:service.budget(),counts:stage.archive.dashboard().counts,jobs:stage.db.prepare('SELECT status,count(*) count FROM archive_jobs GROUP BY status').all()}));
 }
 if(command==='import'){
  const live=new Store(sourceFile);try{
   const backupFile=path.join(path.dirname(sourceFile),'memory-before-import-'+Date.now()+'.sqlite');await backup(live.db,backupFile);let imported=0,skipped=0;const idMap=new Map();
   live.db.exec('BEGIN IMMEDIATE');try{
    for(const item of stage.archive.rows({pending:true})){assertScope(item.scope);const refs=stage.archive.sources(item);if(refs.some(ref=>{const actual=live.archive.source(ref.messageId),original=stage.archive.source(ref.messageId);return !actual||!original||actual.scope!==item.scope||actual.personaId!==item.personaId||actual.text!==original.text;})){skipped++;continue;}
     const result=live.archive.save({...item,evidence:refs.map(r=>({id:r.messageId,quote:r.quote}))});idMap.set(item.id,result.id);if(!result.duplicate)imported++;
    }
    // Copy admission records and progress, never copy staged chat rows or overwrite live facts.
    for(const job of stage.db.prepare('SELECT * FROM archive_jobs').all()){const rows=JSON.parse(job.sourceIds);if(rows.some(id=>!live.archive.source(id)))continue;const columns=Object.keys(job);live.db.prepare('INSERT OR IGNORE INTO archive_jobs('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>k==='output'&&job[k]?JSON.stringify(JSON.parse(job[k]).map(n=>({...n,id:idMap.get(n.id)??n.id}))):job[k]));}
    for(const call of stage.db.prepare('SELECT * FROM archive_calls').all())if(!live.db.prepare('SELECT 1 FROM archive_calls WHERE jobId=? AND started=?').get(call.jobId,call.started))live.db.prepare('INSERT INTO archive_calls(jobId,started,estimate,status,usage) VALUES(?,?,?,?,?)').run(call.jobId,call.started,call.estimate,call.status,call.usage);
    live.db.exec('COMMIT');
   }catch(e){live.db.exec('ROLLBACK');throw e;}
   console.log(JSON.stringify({platform,imported,skipped,backup:backupFile,counts:live.archive.dashboard().counts}));
  }finally{live.close();}
 }
}finally{engines.close();codex?.stop();stage.close();}
