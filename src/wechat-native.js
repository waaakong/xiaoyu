import http from 'node:http';

export const usesCurrentNative=(config,client)=>config.mode==='hook'&&config.nativeAdapter==='xiaoyu-1'&&client.version==='4.2.0.13';

export function nativePacket(peer,text,id){
  const target=Buffer.from(peer),body=Buffer.from(text);
  if(!/^[a-zA-Z0-9_@.-]{1,128}$/.test(peer)||!body.length||body.length>3000||text.includes('\0')||
     !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)){
    const error=Error('WECHAT_NATIVE_PAYLOAD_INVALID：原生文字上限为3000个UTF-8字节');error.deliveryAttempted=false;throw error;
  }
  const packet=Buffer.alloc(48+target.length+body.length);
  packet.writeUInt32LE(0x314e5958);packet.write(id,4,36);packet.writeUInt32LE(target.length,40);packet.writeUInt32LE(body.length,44);
  target.copy(packet,48);body.copy(packet,48+target.length);return packet;
}
export function nativeMentionPacket(peer,text,member,id){
  nativePacket(peer,text,id);if(!peer.endsWith('@chatroom')||typeof member!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(member)||member==='all')throw Object.assign(Error('WECHAT_NATIVE_MENTION_INVALID'),{deliveryAttempted:false});
  const p=Buffer.from(peer),t=Buffer.from(text),m=Buffer.from(member),packet=Buffer.alloc(52+p.length+t.length+m.length);packet.writeUInt32LE(0x334e5958);packet.write(id,4,36);packet.writeUInt32LE(p.length,40);packet.writeUInt32LE(t.length,44);packet.writeUInt32LE(m.length,48);p.copy(packet,52);t.copy(packet,52+p.length);m.copy(packet,52+p.length+t.length);return packet;
}

export class WeChatNativeClient {
  constructor(config,{requestImpl=http.request}={}){this.config=config;this.request=requestImpl;}
  call(route,body){
    const config=this.config(),url=new URL(config.hookUrl);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^[a-f0-9]{64}$/.test(config.hookToken))throw Error('WECHAT_NATIVE_ENDPOINT_INVALID');
    return new Promise((resolve,reject)=>{
      const req=this.request({hostname:url.hostname,port:url.port,path:route,method:body?'POST':'GET',headers:{Authorization:'Bearer '+config.hookToken,...(body?{'Content-Type':'application/octet-stream','Content-Length':body.length}:{})},timeout:5000},response=>{
        let raw='';response.on('data',bytes=>{raw+=bytes;if(raw.length>16384)response.destroy(Error('WECHAT_NATIVE_RESPONSE_LIMIT'));});
        response.on('error',reject);response.on('end',()=>{try{if(response.statusCode!==200)throw Error('WECHAT_NATIVE_REFUSED_'+response.statusCode);resolve(JSON.parse(raw));}catch(error){reject(error);}});
      });req.on('timeout',()=>req.destroy(Error('WECHAT_NATIVE_RESULT_UNKNOWN')));req.on('error',reject);req.end(body);
    });
  }
  async verify({accountDirectory}){
    const health=await this.call('/health');
    if(health.integration!=='XiaoyuNative-1'||health.version!=='4.2.0.13'||health.verified!==true||!Number.isSafeInteger(health.pid)||health.pid<=0||
       health.accountDirectory?.toLowerCase()!==accountDirectory.toLowerCase()||health.submissionLimit<=health.submissions)throw Error('WECHAT_NATIVE_IDENTITY_MISMATCH');
    return health;
  }
  async send(peer,text,id){const result=await this.call('/send',nativePacket(peer,text,id));if(result.state!=='submitted')throw Error('WECHAT_NATIVE_RESULT_UNKNOWN');return result;}
  async sendMention(peer,text,member,id){const result=await this.call('/send-at',nativeMentionPacket(peer,text,member,id));if(result.state!=='submitted')throw Error('WECHAT_NATIVE_RESULT_UNKNOWN');return result;}
}
