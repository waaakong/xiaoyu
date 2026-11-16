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
export function readProto(buffer,maxBytes=65536){
  if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>524288||!Buffer.isBuffer(buffer)||buffer.length>maxBytes)throw Error('朋友圈响应过大');let at=0;const fields=[];
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
export function parseMomentsObject(buffer,maxBytes=65536){const rootFields=readProto(buffer,maxBytes),base=rootFields.find(x=>x.key===1&&x.wire===2),objectPart=rootFields.find(x=>x.key===2&&x.wire===2);const ret=base&&readProto(base.value).find(x=>x.key===1&&x.wire===0)?.value;const id=objectPart&&readProto(objectPart.value,maxBytes).find(x=>x.key===1&&x.wire===0)?.value;if(ret===undefined)throw Error('缺少服务端返回码');const result={ret:Number(BigInt.asIntN(32,ret)),objectId:id?.toString()??null,accepted:ret===0n&&!!id};if(!result.accepted)throw Error('朋友圈对象查询未成功');const object=objectPart,fields=readProto(object.value,maxBytes),username=fields.find(x=>x.key===2&&x.wire===2)?.value.toString('utf8'),desc=fields.find(x=>x.key===5&&x.wire===2);let timeline='';if(desc){const d=readProto(desc.value,maxBytes),bytes=d.find(x=>x.key===2&&x.wire===2)?.value,size=d.find(x=>x.key===1&&x.wire===0)?.value;if(bytes&&size===BigInt(bytes.length))timeline=bytes.toString('utf8');}const comments=parseSnsObjectComments(object.value,maxBytes);return {...result,username,timeline,deleted:fields.find(x=>x.key===25&&x.wire===0)?.value===1n,...comments};}

const ENTITY={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
function decodeEntities(value){
  return String(value).replace(/&#x([0-9a-f]+);/gi,(_,h)=>{try{return String.fromCodePoint(parseInt(h,16));}catch{return '';}})
    .replace(/&#([0-9]+);/g,(_,n)=>{try{return String.fromCodePoint(Number(n));}catch{return '';}})
    .replace(/&(amp|lt|gt|quot|apos);/g,(_,k)=>ENTITY[k]);
}
function timelineTag(block,name){
  const open=new RegExp('<'+name+'(?:\\s[^>]*)?>').exec(block);
  if(!open)return '';
  const start=open.index+open[0].length;
  if(block.startsWith('<![CDATA[',start)){
    const end=block.indexOf(']]>',start+9);
    return end<0?'':block.slice(start+9,end);
  }
  const end=block.indexOf('</'+name+'>',start);
  return end<0?'':decodeEntities(block.slice(start,end));
}
export function parseTimelineComments(timeline){
  if(typeof timeline!=='string'||timeline.length>2_000_000)throw Error('朋友圈时间线无效');
  const comments=[],seen=new Set(),re=/<user_comment>([\s\S]*?)<\/user_comment>/g;
  for(const match of timeline.matchAll(re)){
    const block=match[1],deleted=timelineTag(block,'b_deleted');
    if(deleted==='1')continue;
    const content=timelineTag(block,'content').trim();
    if(!content)continue;
    const id=timelineTag(block,'comment_id').trim(),id64=timelineTag(block,'comment_64id').trim();
    const remoteId=id64&&id64!=='0'?id64:id;
    if(!remoteId||seen.has(remoteId))continue;
    const seconds=Number(timelineTag(block,'create_time'));
    const createdAt=Number.isFinite(seconds)&&seconds>0?Math.round(seconds>1e12?seconds:seconds*1000):0;
    const username=timelineTag(block,'username').trim(),nickname=timelineTag(block,'nickname').trim();
    const ref=timelineTag(block,'ref_comment_64id').trim();
    seen.add(remoteId);
    comments.push({remoteId,username,nickname,author:nickname||username,content,createdAt,parentCommentId:ref&&ref!=='0'?ref:(timelineTag(block,'ref_comment_id').trim().replace(/^0$/,'')||null),deleted:false});
  }
  return comments;
}

// On this client, comments are repeated binary SnsObject field 12, outside the XML description.
export function parseSnsObjectComments(buffer,maxBytes=65536){
 const fields=readProto(buffer,maxBytes),items=fields.filter(f=>f.key===12&&f.wire===2);if(items.length>500)throw Error('动态评论超出本次解析上限');
 const rows=[],seen=new Set();for(const item of items){const c=readProto(item.value),one=(k,w)=>{const v=c.filter(f=>f.key===k&&f.wire===w);if(v.length>1)throw Error('评论身份字段重复');return v[0]?.value;},str=k=>one(k,2)?.toString('utf8')??'',number=k=>one(k,0)??0n;
  if(number(13)!==0n)continue;
  const legacy=number(7),id64=number(12),parentLegacy=number(8),parent64=number(11),remoteId=id64||legacy,parent=parent64||parentLegacy,username=str(1),nickname=str(2),content=str(5),recipient=str(9),seconds=number(6);
  if(!content)continue;const key=remoteId.toString(),identityVerified=remoteId>0n&&legacy<=0xffffffffn&&parentLegacy<=0xffffffffn&&/^[-A-Za-z0-9_.]{1,160}$/.test(username)&&seconds>0n&&seconds<=0xffffffffn;
  if(seen.has(key)&&remoteId)throw Error('动态评论ID重复');seen.add(key);rows.push({remoteId:remoteId?key:null,legacyId:legacy.toString(),id64:id64.toString(),parentLegacyId:parentLegacy.toString(),parentId64:parent64.toString(),username,nickname,author:nickname||username,content,createdAt:Number(seconds)*1000,parentCommentId:parent?parent.toString():null,recipient,source:Number(number(3)),type:Number(number(4)),isNotRichText:Number(number(10)),identityVerified,deleted:false});
 }
 const declared=fields.find(f=>f.key===10&&f.wire===0)?.value,returned=fields.find(f=>f.key===11&&f.wire===0)?.value;
 return {comments:rows,commentCount:declared===undefined?null:Number(declared),commentsComplete:declared===undefined?null:declared===BigInt(items.length),commentRowsPresent:items.length>0||declared!==undefined||returned!==undefined};
}
export function momentTimelineText(timeline,name){if(!['username','createTime','contentDesc'].includes(name))throw Error('动态文本字段无效');return timelineTag(String(timeline??''),name);}
