// Finite experimental transport. Presence of a DLL/session is never production readiness.
import http from 'node:http';import crypto from 'node:crypto';
import {momentsDetailPacket,parseMomentsObject,parseTimelineComments,momentTimelineText} from './wechat-moments-protocol.js';
export function momentMediaCount(xml){const structure=String(xml??'').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g,''),list=structure.match(/<mediaList(?:\s[^>]*)?>([\s\S]*?)<\/mediaList>/);return list?(list[1].match(/<media(?:\s[^>]*)?>/g)??[]).length:0;}
export function nativeCommentPost(response,{account,objectId,observedAt=Date.now()}={}){
 if(!response||typeof response.protobufHex!=='string'||response.protobufHex.length>1048576||response.protobufHex.length%2||!/^[a-f0-9]+$/i.test(response.protobufHex))throw Error('原生评论详情格式无效');
 const object=parseMomentsObject(Buffer.from(response.protobufHex,'hex'),524288);
 if(object.objectId!==objectId||object.username!==account||momentTimelineText(object.timeline,'username')!==account)throw Error('原生评论动态不属于当前账号或对象不匹配');
 const seconds=Number(momentTimelineText(object.timeline,'createTime'));return {objectId,ownerId:account,identityVerified:true,source:'native-detail',observedAt,text:momentTimelineText(object.timeline,'contentDesc'),mediaCount:momentMediaCount(object.timeline),publishedAt:Number.isFinite(seconds)?seconds*1000:0,commentCount:object.commentCount,commentsComplete:object.commentsComplete,deleted:object.deleted,comments:(object.commentRowsPresent?object.comments:parseTimelineComments(object.timeline)).map(c=>({...c,identityVerified:c.identityVerified!==false&&!!c.username,self:c.username===account}))};
}
export class WeChatCommentNative {
 constructor(session,{request,now=Date.now}={}){
  if(!session||!Number.isInteger(session.pid)||!Number.isInteger(session.port)||session.port<1024||session.port>65535||!/^[a-f0-9]{64}$/.test(session.token??'')||typeof session.objectId!=='string'||!session.wxid)throw Error('独立评论组件会话无效');
  this.session=session;this.now=now;this.send=request??this.http.bind(this);this.pending=false;this.unknown=false;
 }
 http(route,body){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:this.session.port,path:route,method:body?'POST':'GET',timeout:11000,headers:{Authorization:'Bearer '+this.session.token,...(body?{'Content-Type':'application/octet-stream','Content-Length':body.length,...(this.session.signingKey?{'X-Content-Signature':crypto.createHmac('sha256',Buffer.from(this.session.signingKey,'hex')).update(body).digest('hex')}:{})}:{})}},res=>{let data='';res.on('data',b=>{data+=b;if(data.length>(this.maxResponseBytes??140000))res.destroy(Error('评论组件响应过大'));});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('评论组件拒绝请求：'+res.statusCode);resolve(JSON.parse(data));}catch(e){reject(e);}});});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('评论组件超时，不能重发')));req.end(body);});}
 async health(){const h=await this.send('/health');if(h.integration!=='XiaoyuComments-1'||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.allowedObject!==this.session.objectId||h.verified!==true||h.offlineTest!==false)throw Error('独立评论组件实时身份未核验');return h;}
 async detail(){
  if(this.pending||this.unknown)throw Error('存在未确认的原请求，禁止再次派发');this.pending=true;
  try{const h=await this.health();if(h.readAttempts>=h.maxReads)throw Error('只读验收次数已用完');
   const q=momentsDetailPacket({account:this.session.wxid,objectId:this.session.objectId});
   this.unknown=true;const result=await this.send('/submit',q.packet);
   if(result.id!==q.requestId||!result.taskCompleted||!result.taskDestroyed||!['server-accepted','server-rejected'].includes(result.state))throw Error('原生查询结果未知，不重发');
   this.unknown=false;if(result.state!=='server-accepted'||result.ret!==0){const error=Error('服务端拒绝动态详情查询（返回码 '+result.ret+'）');error.code='WECHAT_COMMENT_SERVER_REJECTED';error.nativeResult=result;throw error;}
   return nativeCommentPost(await this.send('/object'),{account:this.session.wxid,objectId:this.session.objectId,observedAt:this.now()});
  }finally{this.pending=false;}
 }
 async submitApprovedComment(packet){
  const hash=crypto.createHash('sha256').update(packet).digest('hex');
  if(this.session.allowComment!==true||this.session.maxComments!==1||hash!==this.session.approvedHash||packet.readUInt32LE(0)!==0x344d5958)throw Error('仅允许本次已审核的完整评论请求');
  if(this.pending||this.unknown)throw Error('存在未确认请求，禁止发送');this.pending=true;
  try{const h=await this.health();if(h.allowComment!==true||h.commentAttempts!==0)throw Error('本次评论发送额度不可用');
   this.unknown=true;const r=await this.send('/submit',packet),requestId=packet.subarray(4,40).toString('ascii');
   if(r.id!==requestId||!r.taskCompleted||!r.taskDestroyed||!['server-accepted','server-rejected'].includes(r.state))throw Error('评论提交结果未知，禁止重试');
   this.unknown=false;if(r.state!=='server-accepted'||r.ret!==0){const error=Error('评论服务端拒绝（返回码 '+r.ret+'）');error.code='WECHAT_COMMENT_SERVER_REJECTED';error.nativeResult=r;throw error;}return {...r,delivered:false};
  }finally{this.pending=false;}
 }
 // Reading/accepting native data does not authorize automatic comment submission.
 readiness(){return {ready:false,reason:'有限验收组件；尚未通过真实评论发送与定向回执验证'};}
}
