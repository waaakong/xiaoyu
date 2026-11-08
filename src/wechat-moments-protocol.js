import crypto from 'node:crypto';

export const MOMENTS_CORE_SHA='afe3d02c58bada3c35009c0cd58ee1f57b2a00fe53237d0dce649107fddb9a20';
export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const uint=n=>{let v=BigInt(n),b=[];if(v<0n||v>0xffffffffffffffffn)throw Error('整数超出范围');do{let x=Number(v&127n);v>>=7n;b.push(x|(v?128:0));}while(v);return Buffer.from(b);};
const num=(k,v)=>Buffer.concat([uint(k*8),uint(v)]);
const bytes=(k,v)=>{v=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([uint(k*8+2),uint(v.length),v]);};

// Text first. Images/video/audience lists require a separately validated upload/profile.
export function momentsPacket({account,text,visibility='public',requestId=crypto.randomUUID(),created=Math.floor(Date.now()/1000)}){
  if(!/^wxid_[A-Za-z0-9_]{1,100}$/.test(account??'')||typeof text!=='string'||!text.trim()||text.length>2000||/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]/u.test(text)||/\p{Surrogate}/u.test(text))throw Error('朋友圈账号或正文无效');
  if(visibility!=='public')throw Error('当前原生候选只开放明确确认的公开文字，其他可见范围尚未验证');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId)||!Number.isSafeInteger(created)||created<1||created>0xffffffff)throw Error('朋友圈请求标识或时间无效');
  const timeline=`<TimelineObject><id>0</id><username>${xml(account)}</username><createTime>${created}</createTime><contentDesc>${xml(text.trim())}</contentDesc><contentattr>0</contentattr><private>0</private><ContentObject><contentStyle>2</contentStyle><title></title><description></description><contentUrl></contentUrl><mediaList></mediaList></ContentObject></TimelineObject>`;
  const desc=Buffer.from(timeline),buffer=Buffer.concat([num(1,desc.length),bytes(2,desc)]);
  const base=Buffer.concat([bytes(1,''),num(2,0),bytes(3,'Windows'),num(4,0),bytes(5,'Windows'),num(6,0)]);
  const proto=Buffer.concat([bytes(1,base),bytes(2,buffer),num(3,0),num(5,0),num(6,0),bytes(7,requestId),num(8,0),num(9,0),num(11,0),num(13,0),num(16,0)]);
  const header=Buffer.alloc(44);header.writeUInt32LE(0x314d5958);header.write(requestId,4,36,'ascii');header.writeUInt32LE(proto.length,40);
  return {packet:Buffer.concat([header,proto]),requestId,timeline,created,account,text:text.trim(),visibility};
}

// Strict bounded reader: never round a 64-bit Moments ID through a JS Number.
export function readProto(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length>65536)throw Error('朋友圈响应过大');let at=0;const fields=[];
  const variable=()=>{let v=0n;for(let i=0;i<10;i++){if(at>=buffer.length)throw Error('截断的响应');const c=buffer[at++];if(i===9&&c>1)throw Error('响应整数溢出');v|=BigInt(c&127)<<(BigInt(i)*7n);if(!(c&128))return v;}throw Error('响应整数无效');};
  while(at<buffer.length){const tag=variable(),key=Number(tag>>3n),wire=Number(tag&7n);if(!key||key>0x1fffffff)throw Error('响应字段无效');let value;if(wire===0)value=variable();else if(wire===2){const n=variable();if(n>BigInt(buffer.length-at))throw Error('响应长度无效');value=buffer.subarray(at,at+Number(n));at+=Number(n);}else if(wire===1||wire===5){const n=wire===1?8:4;if(at+n>buffer.length)throw Error('截断的响应');value=buffer.subarray(at,at+n);at+=n;}else throw Error('响应编码无效');fields.push({key,wire,value});}
  return fields;
}
export function parseMomentsResponse(buffer){
  const f=readProto(buffer),base=f.find(x=>x.key===1&&x.wire===2),obj=f.find(x=>x.key===2&&x.wire===2);
  const ret=base&&readProto(base.value).find(x=>x.key===1&&x.wire===0)?.value;
  const objectFields=obj?readProto(obj.value):[],id=objectFields.find(x=>x.key===1&&x.wire===0)?.value;
  if(ret===undefined)throw Error('缺少服务端返回码');
  return {ret:Number(BigInt.asIntN(32,ret)),objectId:id?.toString()??null,accepted:ret===0n&&!!id};
}

export function momentsDetailPacket({account,objectId,requestId=crypto.randomUUID()}){
  if(!/^wxid_[A-Za-z0-9_]{1,100}$/.test(account??'')||typeof objectId!=='string'||!/^[1-9][0-9]{0,19}$/.test(objectId)||BigInt(objectId)>0xffffffffffffffffn||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId))throw Error('只读朋友圈对象或账号无效');
  const base=Buffer.concat([bytes(1,''),num(2,0),bytes(3,'Windows'),num(4,0),bytes(5,'Windows'),num(6,0)]),proto=Buffer.concat([bytes(1,base),num(2,BigInt(objectId)),num(3,0)]),header=Buffer.alloc(44);header.writeUInt32LE(0x334d5958);header.write(requestId,4,36,'ascii');header.writeUInt32LE(proto.length,40);return {packet:Buffer.concat([header,proto]),account,objectId,requestId};
}
export function parseMomentsObject(buffer){const result=parseMomentsResponse(buffer);if(!result.accepted)throw Error('朋友圈对象查询未成功');const object=readProto(buffer).find(x=>x.key===2&&x.wire===2),fields=readProto(object.value),username=fields.find(x=>x.key===2&&x.wire===2)?.value.toString('utf8'),desc=fields.find(x=>x.key===5&&x.wire===2);let timeline='';if(desc){const d=readProto(desc.value),bytes=d.find(x=>x.key===2&&x.wire===2)?.value,size=d.find(x=>x.key===1&&x.wire===0)?.value;if(bytes&&size===BigInt(bytes.length))timeline=bytes.toString('utf8');}return {...result,username,timeline};}
