// Experimental own-first-page reader; no send or background polling methods.
import crypto from 'node:crypto';
import {readProto} from './wechat-moments-protocol.js';
import {WeChatCommentNative,nativeCommentPost} from './wechat-comment-native.js';
const uint=n=>{let v=BigInt(n),a=[];do{const x=Number(v&127n);v>>=7n;a.push(x|(v?128:0));}while(v);return Buffer.from(a);};
const num=(k,n)=>Buffer.concat([uint(k*8),uint(n)]),bytes=(k,v)=>{v=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([uint(k*8+2),uint(v.length),v]);};
export function ownMomentsPagePacket({account,maxId='0',requestId=crypto.randomUUID()}={}){
 if(!/^wxid_[A-Za-z0-9_]{1,100}$/.test(account??'')||maxId!=='0'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId))throw Error('仅支持本人动态首页的有限读取');
 const base=Buffer.concat([bytes(1,''),num(2,0),bytes(3,'Windows'),num(4,0),bytes(5,'Windows'),num(6,0)]),proto=Buffer.concat([bytes(1,base),bytes(2,''),bytes(3,account),num(4,0),num(5,0),num(6,0)]),header=Buffer.alloc(44);header.writeUInt32LE(0x354d5958);header.write(requestId,4,36,'ascii');header.writeUInt32LE(proto.length,40);return {packet:Buffer.concat([header,proto]),account,requestId};
}
export function parseOwnMomentsPage(response,{account,observedAt=Date.now()}={}){
 if(typeof response?.protobufHex!=='string'||response.protobufHex.length%2||response.protobufHex.length>1048576||!/^[a-f0-9]+$/i.test(response.protobufHex))throw Error('本人动态列表响应无效');
 const fields=readProto(Buffer.from(response.protobufHex,'hex'),524288),base=fields.find(f=>f.key===1&&f.wire===2),ret=base&&readProto(base.value).find(f=>f.key===1&&f.wire===0)?.value;
 if(ret!==0n)throw Error('本人动态列表未通过服务端校验');const objects=fields.filter(f=>f.key===4&&f.wire===2);if(objects.length>100)throw Error('本人动态列表超出本次读取上限');
 const posts=objects.map(o=>{const ids=readProto(o.value,524288).filter(f=>f.key===1&&f.wire===0);if(ids.length!==1||ids[0].value===0n)throw Error('动态对象ID不完整');const objectId=ids[0].value.toString();return nativeCommentPost({protobufHex:Buffer.concat([bytes(1,base.value),bytes(2,o.value)]).toString('hex')},{account,objectId,observedAt});});
 const ids=new Set();for(const p of posts){if(ids.has(p.objectId))throw Error('本人动态列表存在重复ID');ids.add(p.objectId);}return {ret:0,account,scope:'own-first-page',posts,observedAt};
}
export class WeChatMomentsPage extends WeChatCommentNative {
 constructor(session,options={}){super({...session,objectId:'1'},options);if(session.scope!=='own-first-page'||session.allowComment!==false||session.maxReads!==1)throw Error('本人动态列表验收范围无效');this.maxResponseBytes=1100000;}
 async health(){const h=await this.send('/health');if(h.integration!=='XiaoyuMomentPage-1'||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.scope!=='own-first-page'||h.verified!==true||h.offlineTest!==false||h.allowComment!==false||h.maxReads!==1)throw Error('本人动态列表组件身份未核验');return h;}
 async detail(){throw Error('本组件仅开放本人动态首页');}
 async firstPage(){if(this.pending||this.unknown)throw Error('原查询尚未确认，禁止再次派发');this.pending=true;
  try{const h=await this.health();if(h.readAttempts>=h.maxReads)throw Error('本人动态列表验收次数已用完');const q=ownMomentsPagePacket({account:this.session.wxid});this.unknown=true;const r=await this.send('/submit',q.packet);
   if(r.id!==q.requestId||!r.taskCompleted||!r.taskDestroyed||!['server-accepted','server-rejected'].includes(r.state))throw Error('本人动态列表查询结果未知，禁止重试');this.unknown=false;
   if(r.ret!==0||r.state!=='server-accepted'){const e=Error('服务端拒绝本人动态列表（返回码 '+r.ret+'）');e.code='WECHAT_COMMENT_SERVER_REJECTED';e.nativeResult=r;throw e;}
   return parseOwnMomentsPage(await this.send('/object'),{account:this.session.wxid,observedAt:this.now()});
  }finally{this.pending=false;}
 }
}
