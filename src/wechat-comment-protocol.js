import crypto from 'node:crypto';
import {readProto} from './wechat-moments-protocol.js';
const uint=n=>{let v=BigInt(n),b=[];if(v<0n||v>0xffffffffffffffffn)throw Error('评论整数超出范围');do{const x=Number(v&127n);v>>=7n;b.push(x|(v?128:0));}while(v);return Buffer.from(b);};
const num=(k,v)=>Buffer.concat([uint(k*8),uint(v)]),bytes=(k,v)=>{v=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([uint(k*8+2),uint(v.length),v]);};
const account=v=>typeof v==='string'&&/^wxid_[A-Za-z0-9_]{1,100}$/.test(v);
const user=v=>typeof v==='string'&&/^[-A-Za-z0-9_.]{1,160}$/.test(v);
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=0xffffffffffffffffn;
const text=v=>typeof v==='string'&&v.trim()&&v.length<=80&&!/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]/u.test(v)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
export function commentPacket({account:from,objectId,remoteKey,authorId,content='',author='',text:body,createdAt,legacyId,id64,parentLegacyId='0',parentId64='0',recipient='',isNotRichText=1,requestId=crypto.randomUUID(),now=Date.now()}={}){
 if(!account(from)||!user(authorId)||from===authorId||!id(objectId)||!id(remoteKey)||!text(body)||typeof content!=='string'||content.length>5000)throw Error('原生评论的账号、对象、目标或正文无效');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId)||!Number.isSafeInteger(now)||now<1||!Number.isFinite(createdAt)||createdAt<=0)throw Error('原生评论请求标识或时间无效');
 const seconds=Math.floor(now/1000),referenceSeconds=Math.floor(createdAt/1000);if(seconds>0xffffffff||referenceSeconds>0xffffffff)throw Error('评论时间超出范围');
 const bounded=(value,max)=>{if(typeof value!=='string'||!/^\d{1,20}$/.test(value)||BigInt(value)>max)throw Error('评论引用ID无效');return value;};
 const originalLegacy=bounded(legacyId??(BigInt(remoteKey)<=0xffffffffn?remoteKey:'0'),0xffffffffn),original64=bounded(id64??(BigInt(remoteKey)>0xffffffffn?remoteKey:'0'),0xffffffffffffffffn);
 if((BigInt(original64)||BigInt(originalLegacy)).toString()!==remoteKey)throw Error('评论引用ID与目标不匹配');bounded(parentLegacyId,0xffffffffn);bounded(parentId64,0xffffffffffffffffn);
 if(recipient&&!user(recipient))throw Error('原评论接收人无效');
 const action=(from,to,nickname,value,time,replyLegacy,commentLegacy,reply64,comment64)=>Buffer.concat([bytes(1,from),bytes(2,to),bytes(3,nickname.slice(0,60)),bytes(4,''),num(5,2),num(6,0),num(7,time),bytes(8,value),num(9,replyLegacy),num(10,commentLegacy),num(11,isNotRichText?1:0),num(12,reply64),num(13,comment64)]);
 const current=action(from,authorId,'',body.trim(),seconds,originalLegacy,'0',original64,'0'),refer=action(authorId,recipient||from,String(author),content,referenceSeconds,parentLegacyId,originalLegacy,parentId64,original64);
 const group=Buffer.concat([num(1,objectId),num(2,0),bytes(3,current),bytes(4,refer),bytes(5,''),num(6,0)]);
 const base=Buffer.concat([bytes(1,''),num(2,0),bytes(3,'Windows'),num(4,0),bytes(5,'Windows'),num(6,0)]);
 const protobuf=Buffer.concat([bytes(1,base),bytes(2,group),bytes(3,requestId)]),header=Buffer.alloc(44);header.writeUInt32LE(0x344d5958);header.write(requestId,4,36,'ascii');header.writeUInt32LE(protobuf.length,40);
 return {packet:Buffer.concat([header,protobuf]),requestId,account:from,objectId,remoteKey,authorId,text:body.trim(),createdAt,now};
}
export function parseCommentAck(buffer){const base=readProto(buffer).find(f=>f.key===1&&f.wire===2);const ret=base&&readProto(base.value).find(f=>f.key===1&&f.wire===0)?.value;if(ret===undefined)throw Error('缺少评论服务端返回码');return {ret:Number(BigInt.asIntN(32,ret)),accepted:ret===0n,delivered:false};}
