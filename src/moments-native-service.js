import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {root} from './config.js';import {WeChatMomentsServiceClient} from './wechat-moments-service-client.js';import {commentPacket} from './wechat-comment-protocol.js';import {verifiedCommentReceipt} from './moments-comments.js';
const exec=promisify(execFile),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')),sha=s=>crypto.createHash('sha256').update(s).digest('hex'),fileHash=p=>sha(fs.readFileSync(p));
export class MomentsNativeService {
 constructor(runtime,{now=Date.now,run=exec,clientFactory=(s,o)=>new WeChatMomentsServiceClient(s,o)}={}){
  this.runtime=runtime;this.now=now;this.run=run;this.clientFactory=clientFactory;this.db=runtime.store.db;this.state={connected:false,ready:false,canRead:false,canValidate:false,reason:'尚未加载常驻原生评论组件'};this.serial=Promise.resolve();this.closed=false;
  this.db.exec('CREATE TABLE IF NOT EXISTS moments_native_jobs(id TEXT PRIMARY KEY,kind TEXT,objectId TEXT,account TEXT,pid INTEGER,status TEXT,result TEXT,error TEXT,created INTEGER,updated INTEGER); CREATE INDEX IF NOT EXISTS moments_native_jobs_account ON moments_native_jobs(account,pid,status,created)');
 }
 get dir(){return path.join(this.runtime.manager?.dataDir??this.runtime.dataDir??path.join(root,'data'),'wechat-comments-research');}
 account(){return this.runtime.manager?.config?.account??'';}
 manifest(){const m=read(path.join(this.dir,'build-service','manifest.json')),expected=path.join(this.dir,'build-service','XiaoyuWechatMomentsService.dll');if(path.resolve(m.dllPath)!==path.resolve(expected)||m.scope!=='own-moments'||m.offlineTest!==false||fileHash(m.dllPath)!==m.dllSha256||fileHash(path.join(root,'integrations/wechat/comment-native/moments-service.c'))!==m.sourceSha256||fileHash(path.join(root,'integrations/wechat/social-native/identity.h'))!==m.identitySha256)throw Error('常驻原生评论文件发生变化，需重新核验');return m;}
 snapshot(){let build=null;try{const m=this.manifest();build={dllSha256:m.dllSha256,version:'4.2.0.13'};}catch{}return {...this.state,build,unknownTasks:this.db.prepare("SELECT count(*) n FROM moments_native_jobs WHERE account=? AND status IN ('submitting','unknown')").get(this.account()).n};}
 approved(){try{const a=read(path.join(this.dir,'service-approval.json')),m=this.manifest();return a.approved===true&&a.account===this.account()&&a.dllSha256===m.dllSha256?a:null;}catch{return null;}}
 writeValidated(hash){try{const v=read(path.join(this.dir,'service-validation.json'));return v.confirmed===true&&v.account===this.account()&&v.dllSha256===hash;}catch{return false;}}
 async enable({confirmHash,autoConnect=true}={}){
  const m=this.manifest();if(confirmHash!==m.dllSha256||!this.account())throw Error('请确认当前组件的完整哈希和微信账号');
  fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(path.join(this.dir,'service-approval.json'),JSON.stringify({approved:true,account:this.account(),dllSha256:m.dllSha256,autoConnect:!!autoConnect,at:this.now()}),{mode:0o600});
  if(this.runtime.moments?.comments?.policy().enabled)this.runtime.moments.comments.configure({enabled:false});
  await this.connectApproved();return this.snapshot();
 }
 async connectApproved(){
  if(this.connecting)return this.connecting;const a=this.approved();if(!a)throw Error('当前账号的常驻评论组件尚未确认');
  this.connecting=(async()=>{const m=this.manifest(),python=this.runtime.manager.backend.paths().python;
   try{await this.run(python,['-B',path.join(root,'scripts/load-wechat-moments-service.py'),'--approved-sha256',m.dllSha256,'--data-dir',this.runtime.manager.dataDir],{cwd:root,windowsHide:true,timeout:45000,maxBuffer:32000});this.client=null;return await this.refresh();}
   catch(e){this.state={connected:false,ready:false,canRead:false,canValidate:false,reason:String(e.message??e).slice(0,300)};throw e;}
   finally{this.connecting=null;}
  })();return this.connecting;
 }
 async refresh(){
  if(this.closed)return this.snapshot();try{
   const m=this.manifest(),a=this.approved();if(!a)throw Error('组件未授权给当前微信账号');const s=read(path.join(this.dir,'service-session.json'));
   if(!s.healthVerified||s.wxid!==this.account()||s.dllSha256!==m.dllSha256||s.scope!=='own-moments')throw Error('常驻原生评论会话不匹配');
   if(!this.client||this.client.session.pid!==s.pid||this.client.session.token!==s.token){this.client=this.clientFactory(s,{now:this.now,onBeforeTask:j=>this.beforeTask(j),onTaskResult:(j,r)=>this.taskResult(j,r),onTaskError:(j,e)=>this.taskError(j,e)});const pending=this.db.prepare("SELECT * FROM moments_native_jobs WHERE account=? AND pid=? AND status IN ('submitting','unknown') ORDER BY created DESC LIMIT 1").get(this.account(),s.pid);if(pending){this.client.unknown=true;this.client.lastUnknown=pending;}}
   const h=await this.client.health(),valid=this.writeValidated(m.dllSha256),unknown=!!this.client.unknown;this.state={connected:true,canRead:!unknown,ready:valid&&!unknown,canValidate:!valid&&!unknown,reason:unknown?'原生任务结果未知，请只读查询原回执':valid?'原生读取与定向回复均已验收':'读取已连接；当前常驻组件需完成一条定向回复验收',dllSha256:m.dllSha256,at:this.now(),readAttempts:h.readAttempts,maxReads:h.maxReads,commentAttempts:h.commentAttempts,maxComments:h.maxComments};return this.snapshot();
  }catch(e){this.client=null;this.state={connected:false,ready:false,canRead:false,canValidate:false,reason:String(e.message??e).slice(0,300)};return this.snapshot();}
 }
 beforeTask(j){this.db.prepare("INSERT INTO moments_native_jobs(id,kind,objectId,account,pid,status,created,updated) VALUES(?,?,?,?,?,'submitting',?,?)").run(j.id,j.kind,j.objectId,j.account,j.pid,j.created,this.now());}
 taskResult(j,r){this.db.prepare('UPDATE moments_native_jobs SET status=?,result=?,updated=? WHERE id=?').run(r.state,JSON.stringify(r),this.now(),j.id);}
 taskError(j,e){if(e.nativeResult)return;this.db.prepare('UPDATE moments_native_jobs SET status=?,error=?,updated=? WHERE id=?').run(e.notSubmitted?'not-submitted':'unknown',String(e.message??e).slice(0,300),this.now(),j.id);}
 exclusive(fn){const run=this.serial.then(fn,fn);this.serial=run.catch(()=>{});return run;}
 async restore(){if(this.closed||this.runtime.running!==true||!this.approved()?.autoConnect)return this.snapshot();const s=await this.refresh();if(!s.connected)await this.connectApproved();return this.snapshot();}
 async ensure(){let s=await this.refresh();if(!s.connected&&this.approved()?.autoConnect){await this.connectApproved();s=this.snapshot();}if(!s.connected||!s.canRead)throw Error(s.reason);return this.client;}
 async readComments(){return this.exclusive(async()=>{
  const client=await this.ensure(),account=this.account(),first=await client.page('0'),posts=[...first.posts],ids=new Set(posts.map(p=>p.objectId));
  const cursorKey='moments-native-cursor:'+account,oldCursor=this.runtime.store.meta(cursorKey)||'0';let cursor=oldCursor;
  if(first.posts.length){if(cursor==='0')cursor=first.posts.reduce((min,p)=>BigInt(p.objectId)<BigInt(min)?p.objectId:min,first.posts[0].objectId);const older=await client.page(cursor);for(const p of older.posts)if(!ids.has(p.objectId)){posts.push(p);ids.add(p.objectId);}this.runtime.store.meta(cursorKey,older.posts.length?older.posts.reduce((min,p)=>BigInt(p.objectId)<BigInt(min)?p.objectId:min,older.posts[0].objectId):'0');}
  const p=this.runtime.moments.comments.policy(),watched=this.db.prepare('SELECT objectId FROM moments_posts WHERE account=? AND objectId IS NOT NULL AND deleted=0 AND (autoReply=1 OR ?) ORDER BY coalesce(lastSyncAt,0) ASC LIMIT 32').all(account,p.scope==='allOwn'?1:0);let extra=0;
  for(const row of watched){if(ids.has(row.objectId)||extra>=8)continue;extra++;try{posts.push(await client.post(row.objectId));ids.add(row.objectId);}catch(e){if(e.code==='WECHAT_COMMENT_SERVER_REJECTED')posts.push({objectId:row.objectId,unavailable:true});else throw e;}}
  if(this.account()!==account)throw Error('微信账号已变化，停止评论读取');await this.refresh();return {source:'native-service',fresh:true,posts};
 });}
 async publicationSnapshot(){return this.exclusive(async()=>{const client=await this.ensure(),account=this.account(),r=await client.page('0');if(this.account()!==account)throw Error('账号变化');return {account,observedAt:r.observedAt,posts:r.posts};});}
 async replyComment(_manager,payload){return this.exclusive(async()=>{
  const client=await this.ensure(),state=this.snapshot();if(!(state.ready||payload.validation&&state.canValidate)){const e=Error('当前原生评论服务尚未完成回复验收');e.notSubmitted=true;throw e;}
  const before=await client.post(payload.objectId),source=before.comments.find(c=>c.remoteId===payload.remoteKey);
  if(before.deleted||!source?.identityVerified||source.username!==payload.authorId||sha(source.content)!==payload.sourceHash||source.createdAt!==payload.sourceCreatedAt||source.parentCommentId!==payload.sourceParent){const e=Error('原动态或评论已变化，未提交');e.notSubmitted=true;throw e;}
  if(before.comments.some(c=>c.self&&c.parentCommentId===source.remoteId&&c.recipient===source.username)){const e=Error('该评论已有角色回复，禁止重复发送');e.code='NATIVE_ALREADY_REPLIED';e.notSubmitted=true;throw e;}
  const target={...payload,startedAt:this.now(),beforeIds:before.comments.map(c=>c.remoteId)},q=commentPacket({account:this.account(),objectId:before.objectId,remoteKey:source.remoteId,authorId:source.username,author:source.author,content:source.content,createdAt:source.createdAt,legacyId:source.legacyId,id64:source.id64,parentLegacyId:source.parentLegacyId,parentId64:source.parentId64,recipient:source.recipient,isNotRichText:source.isNotRichText,text:payload.text,requestId:payload.requestId,now:this.now()});
  const ack=await client.comment(q.packet,before.objectId,payload.beforeSend);const after=await client.post(before.objectId),receipt=this.receipt(after,target);
  if(receipt&&payload.validation){const m=this.manifest();fs.writeFileSync(path.join(this.dir,'service-validation.json'),JSON.stringify({confirmed:true,account:this.account(),dllSha256:m.dllSha256,receipt,at:this.now()}),{mode:0o600});}
  await this.refresh();return {ack,receipt};
 });}
 receipt(post,target){const rows=post.comments.filter(c=>c.identityVerified&&c.username===target.account&&c.recipient===target.authorId&&c.parentCommentId===target.remoteKey&&c.content===target.text&&!target.beforeIds.includes(c.remoteId));if(rows.length!==1)return null;const c=rows[0],receipt={verified:true,fresh:true,source:'native-readback',account:target.account,objectId:target.objectId,parentCommentId:c.parentCommentId,recipient:c.recipient,content:c.content,remoteId:c.remoteId,createdAt:c.createdAt,createdAtPrecisionMs:1000};return verifiedCommentReceipt(receipt,target)?receipt:null;}
 async readReceipt(target){return this.exclusive(async()=>{await this.refresh();if(!this.client)throw Error(this.state.reason);if(this.client.unknown&&this.client.lastUnknown)await this.client.recoverOriginal(this.client.lastUnknown);const post=await this.client.post(target.objectId);return this.receipt(post,target);});}
 async close(){this.closed=true;await this.serial;}
}
