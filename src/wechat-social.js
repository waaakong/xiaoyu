import http from 'node:http';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {serverMessageId} from './wechat-receipts.js';
const id=value=>typeof value==='string'&&/^[-A-Za-z0-9_@.]{1,128}$/.test(value);
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function quoteXml({peer,text,source}){
  if(!id(peer)||!id(source?.sender)||!serverMessageId(source?.serverId)||typeof text!=='string'||!text.trim()||text.length>2000||typeof source.text!=='string'||source.text.length>6000)throw Error('微信引用来源或文字无效');
  const kind=[1,3,47].includes(source.kind)?source.kind:1;const body='<appmsg><title>'+xml(text)+'</title><type>57</type><refermsg><type>'+kind+'</type><svrid>'+serverMessageId(source.serverId)+'</svrid><fromusr>'+xml(source.sender)+'</fromusr><chatusr>'+xml(peer.endsWith('@chatroom')?peer:source.sender)+'</chatusr><displayname>'+xml(String(source.name??source.sender).slice(0,80))+'</displayname><content>'+xml(source.text)+'</content></refermsg></appmsg>';
  if(Buffer.byteLength(body)>32768)throw Error('微信引用内容过大');return body;
}
export function forwardedXml({title='聊天记录',messages}){
  if(!Array.isArray(messages)||!messages.length||messages.length>50||messages.some(m=>!id(m.sender)||!serverMessageId(m.serverId)||typeof m.text!=='string')||messages.reduce((n,m)=>n+m.text.length,0)>6000)throw Error('微信转发需1—50条可验证原文，合计不超过6000字');
  const record='<recordinfo><title>'+xml(title.slice(0,100))+'</title><datalist count="'+messages.length+'">'+messages.map((m,index)=>'<dataitem datatype="1" dataid="'+serverMessageId(m.serverId)+'"><sourcename>'+xml(String(m.name??m.sender).slice(0,80))+'</sourcename><sourcetime>'+xml(String(m.time??''))+'</sourcetime><datadesc>'+xml(m.text)+'</datadesc><dataitemsource><fromusr>'+xml(m.sender)+'</fromusr><msgid>'+serverMessageId(m.serverId)+'</msgid></dataitemsource></dataitem>').join('')+'</datalist></recordinfo>';
  const body='<appmsg><title>'+xml(title.slice(0,100))+'</title><des>'+xml(messages.slice(0,3).map(m=>(m.name??m.sender)+': '+m.text.slice(0,70)).join('\n'))+'</des><type>19</type><recorditem><![CDATA['+record+']]></recorditem></appmsg>';if(Buffer.byteLength(body)>32768)throw Error('微信转发记录过大');return body;
}
export function socialPacket({kind,peer,payload='',target='',requestId}){
  const p=Buffer.from(peer??''),body=Buffer.from(payload),t=Buffer.from(target);
  if(![1,2,3].includes(kind)||!id(peer)||body.length>32768||kind===3&&(!id(target)||payload)||kind!==3&&(!payload||target)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId??''))throw Error('微信社交请求无效');
  const b=Buffer.alloc(56+p.length+body.length+t.length);b.writeUInt32LE(0x34535958);b.writeUInt32LE(kind,4);b.write(requestId,8,36);b.writeUInt32LE(p.length,44);b.writeUInt32LE(body.length,48);b.writeUInt32LE(t.length,52);p.copy(b,56);body.copy(b,56+p.length);t.copy(b,56+p.length+body.length);return b;
}
// The sidecar remains opt-in; creation does not load or start a DLL.
export class WeChatSocialClient {
  constructor(session){if(!session||!Number.isInteger(session.port)||session.port<1024||session.port>65535||!/^[a-f0-9]{64}$/.test(session.token))throw Error('社交组件会话无效');this.session=session;}
  request(route,body){const s=this.session;return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:s.port,path:route,method:body?'POST':'GET',timeout:11000,headers:{Authorization:'Bearer '+s.token,...(body?{'Content-Type':'application/octet-stream','Content-Length':body.length}:{})}},res=>{let data='';res.on('data',chunk=>{data+=chunk;if(data.length>16384)res.destroy(Error('社交组件返回过大'));});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('社交组件拒绝请求：'+res.statusCode);resolve(JSON.parse(data));}catch(e){reject(e);}});});r.on('timeout',()=>r.destroy(Error('社交投递未知，不自动重试')));r.on('error',reject);r.end(body);});}
  async health(){const h=await this.request('/health');if(h.offlineTest===true||h.integration!=='XiaoyuSocial-1'||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.verified!==true)throw Error('社交组件身份尚未核验');return h;}
  async submit(packet,{beforeSend=()=>{}}={}){let attempted=false;try{await this.health();beforeSend();attempted=true;const result=await this.request('/submit',packet);if(result.id!==packet.subarray(8,44).toString('ascii')||result.state!=='server-accepted'||result.ret!==0||!serverMessageId(result.serverId))throw Object.assign(Error('微信社交投递未确认，不自动重试'),{result});return {message_id:serverMessageId(result.serverId),receipt:'wechat-social-cgi-response',experimental:true,requestId:result.id};}catch(e){if(!attempted)e.deliveryAttempted=false;throw e;}}
}
export async function verifiedSocialClient(directory,{pid,accountDirectory}){
  try{const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')),validation=read('validation.json'),manifest=read('build/manifest.json'),session=read('session.json');
    if(!validation.confirmed||!['quoteVerified','pokeVerified','forwardVerified'].every(key=>validation[key]===true)||manifest.offlineTest!==false||session.pid!==pid||session.accountDirectory!==accountDirectory||validation.dllSha256!==manifest.dllSha256||session.dllSha256!==manifest.dllSha256||createHash('sha256').update(fs.readFileSync(session.dllPath)).digest('hex')!==manifest.dllSha256)return null;
    const client=new WeChatSocialClient(session),health=await client.health();if(health.experimental||health.limit<=3)return null;return client;
  }catch{return null;}
}
