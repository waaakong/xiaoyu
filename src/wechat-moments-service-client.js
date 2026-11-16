import crypto from 'node:crypto';
import {WeChatCommentNative,nativeCommentPost} from './wechat-comment-native.js';
import {ownMomentsPagePacket,parseOwnMomentsPage} from './wechat-moments-page.js';
import {momentsDetailPacket,readProto} from './wechat-moments-protocol.js';
const uint=n=>{let v=BigInt(n),a=[];if(v<0n||v>0xffffffffffffffffn)throw Error('动态游标无效');do{const x=Number(v&127n);v>>=7n;a.push(x|(v?128:0));}while(v);return Buffer.from(a);};
const encode=f=>{if(f.wire===0)return Buffer.concat([uint(f.key*8),uint(f.value)]);if(f.wire===2)return Buffer.concat([uint(f.key*8+2),uint(f.value.length),f.value]);throw Error('动态查询字段无效');};
export function servicePagePacket(account,cursor='0'){
 if(typeof cursor!=='string'||!/^\d{1,20}$/.test(cursor)||BigInt(cursor)>0xffffffffffffffffn)throw Error('动态游标无效');
 const q=ownMomentsPagePacket({account}),fields=readProto(q.packet.subarray(44));fields.find(f=>f.key===4).value=BigInt(cursor);const body=Buffer.concat(fields.map(encode)),header=Buffer.from(q.packet.subarray(0,44));header.writeUInt32LE(body.length,40);return {...q,packet:Buffer.concat([header,body]),cursor};
}
export class WeChatMomentsServiceClient extends WeChatCommentNative {
 constructor(session,{request,now=Date.now,onBeforeTask=()=>{},onTaskResult=()=>{},onTaskError=()=>{}}={}){
  super({...session,objectId:'service'}, {request,now});if(session.scope!=='own-moments'||!/^[a-f0-9]{64}$/.test(session.signingKey??''))throw Error('常驻评论组件会话无效');
  this.maxResponseBytes=1100000;this.onBeforeTask=onBeforeTask;this.onTaskResult=onTaskResult;this.onTaskError=onTaskError;
 }
 async health(){const h=await this.send('/health');if(h.integration!=='XiaoyuMomentsService-1'||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.scope!=='own-moments'||h.verified!==true||h.offlineTest!==false||!Number.isInteger(h.maxReads)||h.maxReads<1||h.maxReads>10000||!Number.isInteger(h.maxComments)||h.maxComments<1||h.maxComments>500||![h.readAttempts,h.commentAttempts].every(n=>Number.isInteger(n)&&n>=0))throw Error('常驻评论组件身份未核验');return h;}
 async task(packet,{kind,objectId=null,beforeSend}={}){
  if(this.pending||this.unknown)throw Error('原生任务未确认，请先只读对账');this.pending=true;let dispatched=false,job;
  try{if(!Buffer.isBuffer(packet)||packet.length<44||packet.readUInt32LE(0)!==({comment:0x344d5958,page:0x354d5958,detail:0x334d5958})[kind])throw Error('原生任务类型与请求不匹配');const h=await this.health(),write=kind==='comment';if(write&&(!h.allowComment||h.commentAttempts>=h.maxComments)||!write&&h.readAttempts>=h.maxReads){const e=Error('原生每日预算已用完或发送未启用');e.notSubmitted=true;throw e;}
   if(write&&typeof beforeSend!=='function'){const e=Error('缺少评论发送前权限检查');e.notSubmitted=true;throw e;}
   beforeSend?.();const id=packet.subarray(4,40).toString('ascii');job={id,kind,objectId,pid:this.session.pid,account:this.session.wxid,created:this.now()};this.onBeforeTask(job);
   this.unknown=true;this.lastUnknown=job;dispatched=true;const signature=crypto.createHmac('sha256',Buffer.from(this.session.signingKey,'hex')).update(packet).digest('hex');
   const r=await this.send('/submit',packet,{signature});if(r.id!==id||!r.taskCompleted||!r.taskDestroyed||!['server-accepted','server-rejected'].includes(r.state))throw Error('原生请求结果未知，禁止重发');
   this.onTaskResult(job,r);this.unknown=false;this.lastUnknown=null;
   if(r.state!=='server-accepted'||r.ret!==0){const e=Error('微信服务端拒绝（返回码 '+r.ret+'）');e.code='WECHAT_COMMENT_SERVER_REJECTED';e.nativeResult=r;throw e;}return r;
  }catch(e){if(!dispatched)e.notSubmitted=true;if(job)this.onTaskError(job,e);throw e;}finally{this.pending=false;}
 }
 async objectFor(id){const raw=await this.send('/object');if(raw.id!==id)throw Error('原生详情缓存请求ID不匹配');return raw;}
 async page(cursor='0'){const q=servicePagePacket(this.session.wxid,cursor);await this.task(q.packet,{kind:'page'});return parseOwnMomentsPage(await this.objectFor(q.requestId),{account:this.session.wxid,observedAt:this.now()});}
 async post(objectId){const q=momentsDetailPacket({account:this.session.wxid,objectId});await this.task(q.packet,{kind:'detail',objectId});return nativeCommentPost(await this.objectFor(q.requestId),{account:this.session.wxid,objectId,observedAt:this.now()});}
 async comment(packet,objectId,beforeSend){return this.task(packet,{kind:'comment',objectId,beforeSend});}
 async recoverOriginal(job){const r=await this.send('/result');if(r.id!==job.id||!r.taskCompleted||!r.taskDestroyed||!['server-accepted','server-rejected'].includes(r.state))throw Error('原任务仍未确认，不会重试');this.onTaskResult(job,r);this.unknown=false;this.lastUnknown=null;return r;}
}
