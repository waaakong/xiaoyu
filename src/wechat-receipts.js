import {createHash} from 'node:crypto';

export function serverMessageId(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))return null;
  const text=String(value??'');if(!/^-?\d{1,20}$/.test(text))return null;
  let n=BigInt(text);if(n<-(1n<<63n)||n>((1n<<64n)-1n))return null;
  if(n<0)n=BigInt.asUintN(64,n);
  return n>0n?n.toString():null;
}
export const messageText=m=>String(m.fullText??m.content??m.parsedContent??'');
export const textHash=text=>createHash('sha256').update(text).digest('hex');
// Local IDs are shard/table-local. Do not deduplicate on localId alone.
export const rowIdentity=m=>JSON.stringify([String(m.localId??''),String(m.createTime??'')]);
export function receiptBaseline(rows){return {serverIds:new Set(rows.map(m=>serverMessageId(m.serverId)).filter(Boolean)),rows:new Set(rows.map(rowIdentity))};}
export function findReceipt(rows,{baseline,text,started}){
  return rows.find(m=>{
    const id=serverMessageId(m.serverId);
    return (m.isSend===true||m.isSend===1)&&id&&!baseline.serverIds.has(id)&&!baseline.rows.has(rowIdentity(m))&&messageText(m).trim()===text.trim()&&Number(m.createTime)>=Math.floor(started/1000)-2;
  });
}
export function receiptMentions(row){if(Array.isArray(row?.mentions))return row.mentions.map(String);const xml=String(row?.msgSource??'');const raw=/<atuserlist[^>]*>([\s\S]*?)<\/atuserlist>/iu.exec(xml)?.[1]?.replace(/<!\[CDATA\[|\]\]>/gu,'')??'';return raw.split(',').map(s=>s.trim()).filter(Boolean);}

export function findMediaReceipt(rows,{baseline,kind,md5,started}){
  if(!/^[a-f0-9]{32}$/.test(md5))return null;
  return rows.find(m=>{const id=serverMessageId(m.serverId),type=Number(m.localType);
    return (m.isSend===true||m.isSend===1)&&id&&!baseline.serverIds.has(id)&&!baseline.rows.has(rowIdentity(m))&&Number(m.createTime)>=Math.floor(started/1000)-2&&
      (kind==='image'?type===3&&m.imageMd5===md5:kind==='sticker'&&[47,8*2**32+49].includes(type)&&m.stickerMd5===md5);
  });
}
