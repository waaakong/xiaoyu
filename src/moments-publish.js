import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createReadStream} from 'node:fs';
import {validateMomentUiRequest} from './wechat-moments-ui.js';import {imageInfo} from './media.js';import {animatedMomentImage} from './moments-images.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fileHash(file){const h=crypto.createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export function matchPublishedMoment(before,after,req,{account,startedAt}){
 if(!Array.isArray(before?.posts)||!Array.isArray(after?.posts)||before.account!==account||after.account!==account)return null;
 const seen=new Set(before.posts.map(p=>p.objectId)),rows=after.posts.filter(p=>p.identityVerified===true&&p.ownerId===account&&!p.deleted&&!seen.has(p.objectId)&&p.text.trim()===req.text.trim()&&p.publishedAt>=Math.floor(startedAt/1000)*1000&&p.publishedAt<=after.observedAt+1000&&p.mediaCount===req.media.length);
 if(rows.length!==1)return null;const p=rows[0];return {verified:true,source:'native-own-page',account,objectId:p.objectId,text:p.text,mediaCount:p.mediaCount,publishedAt:p.publishedAt};
}
export class MomentsPublisher {
 constructor(runtime,{publish,snapshot,now=Date.now,verify}={}){this.runtime=runtime;this.db=runtime.store.db;this.publish=publish;this.snapshot=snapshot;this.now=now;this.verify=verify;this.active=false;
  this.db.exec(`CREATE TABLE IF NOT EXISTS moments_publish_jobs(id TEXT PRIMARY KEY,account TEXT,fingerprint TEXT,source TEXT,planDate TEXT,draftId TEXT,status TEXT,payload TEXT,result TEXT,created INTEGER,updated INTEGER);CREATE INDEX IF NOT EXISTS moments_publish_dedup ON moments_publish_jobs(account,fingerprint,created);CREATE TABLE IF NOT EXISTS moments_plan_runs(account TEXT,date TEXT,draftId TEXT,payload TEXT,status TEXT,error TEXT,PRIMARY KEY(account,date));UPDATE moments_publish_jobs SET status='unknown' WHERE status IN ('preparing','submitting');`);
 }
 account(){return this.runtime.manager.config.account;}
 jobs(){return this.db.prepare('SELECT id,source,planDate,draftId,status,result,created,updated FROM moments_publish_jobs WHERE account=? ORDER BY created DESC LIMIT 50').all(this.account());}
 row(id){return this.db.prepare('SELECT * FROM moments_publish_jobs WHERE id=? AND account=?').get(id,this.account());}
 update(id,status,result){this.db.prepare('UPDATE moments_publish_jobs SET status=?,result=?,updated=? WHERE id=?').run(status,JSON.stringify(result??{}),this.now(),id);}
 async payload(body,id){const req=validateMomentUiRequest(body),media=[],fingerprints=[];const dir=path.join(this.runtime.manager.dataDir,'wechat-moments-ui','jobs',id);fs.mkdirSync(dir,{recursive:true});
  for(let i=0;i<req.media.length;i++){const input=req.media[i],st=fs.statSync(input);if(!st.isFile())throw Error('媒体文件不是普通文件');if(/\.(png|jpe?g|bmp)$/i.test(input)){const bytes=fs.readFileSync(input),meta=await imageInfo(bytes);if(animatedMomentImage(bytes,meta))throw Error('朋友圈仅支持静态图片');}const digest=await fileHash(input),dest=path.join(dir,`${i}${path.extname(input).toLowerCase()}`);await fs.promises.copyFile(input,dest);if(await fileHash(dest)!==digest)throw Error('媒体文件在准备中变化，请重新选择');media.push(dest);fingerprints.push(digest);}
  return {req:{...req,media},fingerprint:hash(JSON.stringify({account:this.account(),text:req.text,privacy:req.privacy,media:fingerprints}))};
 }
 async execute(body,{source='manual',draftId=null,planDate=null}={}){
  if(this.active)throw Error('朋友圈操作正在进行，请等待当前任务完成');this.active=true;let finish;this.pending=new Promise(r=>finish=r);const account=this.account(),id=crypto.randomUUID();let job=false;
  try{const {req,fingerprint}=await this.payload(body,id);if(this.account()!==account)throw Error('微信账号已改变，未提交');if(body.expectedFingerprint&&body.expectedFingerprint!==fingerprint)throw Error('审核后的素材内容已变化，未提交，请重新审核');
   if(!req.publish)return await this.publish(this.runtime.manager,{...req,operationId:id});
   const duplicate=this.db.prepare("SELECT id,status FROM moments_publish_jobs WHERE account=? AND fingerprint=? AND status IN ('preparing','submitting','unknown','published') AND created>=? ORDER BY created DESC LIMIT 1").get(account,fingerprint,this.now()-86400000);
   if(duplicate&&!(duplicate.status==='published'&&body.confirmDuplicate===true))return {published:false,status:'duplicate',canConfirmDuplicate:duplicate.status==='published',duplicateOf:duplicate.id,notice:duplicate.status==='published'?'相同内容24小时内已经发布；如确需再发，请单独确认':'相同内容的原任务尚未核清，请查询原结果，禁止重发'};
   let before=null;try{before=await this.snapshot();}catch{}
   this.db.prepare('INSERT INTO moments_publish_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,account,fingerprint,source,planDate,draftId,'preparing',JSON.stringify(req),JSON.stringify({before}),this.now(),this.now());job=true;
   let result;for(let attempt=0;attempt<2;attempt++){
    if(this.account()!==account){const e=Error('账号变更，未提交');e.submissionAttempted=false;throw e;}
    this.update(id,'submitting',{before,attempt});
    try{result=await this.publish(this.runtime.manager,{...req,operationId:id,attempt});break;}catch(e){if(e.submissionAttempted!==false||e.retryable!==true||attempt===1)throw e;this.update(id,'preparing',{before,attempt,error:e.message});}
   }
   let receipt=null;if(this.account()===account){if(this.verify)receipt=await this.verify({before,req,result,account,startedAt:this.row(id).created});else if(before){for(let i=0;i<3&&!receipt;i++){if(i)await new Promise(r=>setTimeout(r,700));try{const after=await this.snapshot();receipt=matchPublishedMoment(before,after,req,{account,startedAt:this.row(id).created});}catch{break;}}}}
   const status=receipt?.verified===true?'published':result?.submissionAttempted===false?'not-submitted':'unknown';const answer={...result,id,status,published:status==='published',receipt,submissionAttempted:result?.submissionAttempted!==false,notice:status==='published'?'已核验本人朋友圈的新动态':status==='unknown'?'发表结果待核对，内容已保留，禁止自动重发':'明确未提交，内容已保留'};this.update(id,status,{...answer,before});return answer;
  }catch(e){if(!job)e.submissionAttempted=false;if(job)this.update(id,e.submissionAttempted===false?'not-submitted':'unknown',{...JSON.parse(this.row(id).result??'{}'),error:String(e.message).slice(0,300),submissionAttempted:e.submissionAttempted});throw e;}finally{this.active=false;finish();}
 }
 async reconcile(id){if(this.active)throw Error('发布中，请等待当前任务完成再核验');const row=this.row(id);if(!row||row.status!=='unknown')throw Error('没有待核验的前台发布任务');const result=JSON.parse(row.result),req=JSON.parse(row.payload);if(!result.before)return {id,status:'unknown',notice:'缺少发布前快照，不能自动确认，需本人核对'};const receipt=matchPublishedMoment(result.before,await this.snapshot(),req,{account:row.account,startedAt:row.created});if(receipt){if(row.draftId&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='moments_drafts'").get())this.db.prepare("UPDATE moments_drafts SET status='published' WHERE id=? AND account=?").run(row.draftId,row.account);this.update(id,'published',{...result,receipt,published:true});if(row.planDate)this.db.prepare("UPDATE moments_plan_runs SET status='published',error=NULL WHERE account=? AND date=?").run(row.account,row.planDate);}return {id,status:receipt?'published':'unknown',receipt};}
}
