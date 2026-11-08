import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WeChatSocialClient} from './wechat-social.js';
import {wavInfo} from './voice-audio.js';
import {serverMessageId,rowIdentity,messageText} from './wechat-receipts.js';
const exec=promisify(execFile),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function silkInfo(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length>1024*1024||bytes.subarray(0,10).toString('binary')!=='\x02#!SILK_V3')throw Error('无效腾讯SILK语音');let at=10,packets=0;
  while(at<bytes.length){if(at+2>bytes.length)throw Error('SILK包不完整');const size=bytes.readInt16LE(at);at+=2;if(size<=0||size>1024||at+size>bytes.length)throw Error('SILK包长度无效');at+=size;packets++;}
  if(!packets||packets>1500)throw Error('语音需为20毫秒至30秒');return {milliseconds:packets*20};
}
export function voicePacket({id,peer,basename,bytes,milliseconds,sha256}){
  if(!uuid.test(id??'')||!/^[-A-Za-z0-9_@.]{1,128}$/.test(peer??'')||basename!==id+'.silk'||!Number.isInteger(bytes)||bytes<13||bytes>1024*1024||!Number.isInteger(milliseconds)||milliseconds<20||milliseconds>30000||milliseconds%20||!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('微信语音请求无效');
  const p=Buffer.from(peer),f=Buffer.from(basename),b=Buffer.alloc(88+p.length+f.length);b.writeUInt32LE(0x31565958);b.write(id,4,36);b.writeUInt32LE(p.length,40);b.writeUInt32LE(f.length,44);b.writeUInt32LE(milliseconds,48);b.writeUInt32LE(bytes,52);Buffer.from(sha256,'hex').copy(b,56);p.copy(b,88);f.copy(b,88+p.length);return b;
}
export class VoiceEncoder {
  constructor(root,{execute=exec}={}){this.root=root;this.execute=execute;this.directory=path.join(root,'data','wechat-native-research','voice-outgoing');}
  async prepare(wav,{account,scope,beforeSend=()=>{}}){
    beforeSend();wavInfo(wav);if(!/^wechat:[-A-Za-z0-9_.]+:(private|group):[-A-Za-z0-9_@.]+$/.test(scope)||scope.split(':')[1]!==account)throw Error('微信语音会话无效');
    fs.mkdirSync(this.directory,{recursive:true});const id=randomUUID(),input=path.join(this.directory,id+'.wav'),basename=id+'.silk',output=path.join(this.directory,basename);
    const candidates=['speech-env','astrbot-env'].map(dir=>path.join(this.root,'data',dir,'Scripts','python.exe')),python=candidates.find(p=>fs.existsSync(p));if(!python)throw Error('请先在依赖中心准备本地语音环境');
    fs.writeFileSync(input,wav,{mode:0o600,flag:'wx'});
    try{
      await this.execute(python,['-I','-X','utf8',path.join(this.root,'scripts','voice-silk.py'),'--input',input,'--output',output],{windowsHide:true,timeout:20000,maxBuffer:8192});beforeSend();
      const audio=fs.readFileSync(output),info=silkInfo(audio),sha256=createHash('sha256').update(audio).digest('hex'),peer=scope.split(':')[3],fields={id,peer,basename,bytes:audio.length,milliseconds:info.milliseconds,sha256},expires=Date.now()+120000;let consumed=false;
      return {id,...info,sha256,basename,consume:current=>{beforeSend();if(consumed||Date.now()>expires||current.account!==account||current.scope!==scope)throw Error('微信语音授权已失效');consumed=true;return voicePacket(fields);},dispose:()=>fs.rmSync(output,{force:true})};
    }catch(error){fs.rmSync(output,{force:true});throw Error(/授权|会话/.test(error.message)?error.message:'本地SILK编码未完成，本轮保留文字');}finally{fs.rmSync(input,{force:true});}
  }
}
export class WeChatVoiceClient extends WeChatSocialClient {
  async health(){const h=await this.request('/health');if(h.offlineTest!==false||h.integration!=='XiaoyuVoice-1'||h.pid!==this.session.pid||h.accountDirectory!==this.session.accountDirectory||h.version!=='4.2.0.13'||h.verified!==true)throw Error('微信语音组件身份未核验');return h;}
  async submit(packet,{beforeSend=()=>{}}={}){let attempted=false;try{await this.health();beforeSend();attempted=true;const r=await this.request('/voice',packet);if(r.state!=='submitted')throw Error('微信语音提交结果未知，不自动重试');return r;}catch(e){if(!attempted)e.deliveryAttempted=false;throw e;}}
}
export function sameVoiceSession(a,b){const x=a?.session,y=b?.session;return !!x&&!!y&&['pid','port','accountDirectory','dllSha256','token'].every(k=>x[k]!==undefined&&x[k]===y[k]);}
// Only a separately reviewed, live-accepted component can enable chat voice.
// Never loads a DLL or promotes an experimental build as a side effect.
export async function verifiedVoiceClient(root,{pid,accountDirectory}){
  try{
    const directory=path.join(root,'data','wechat-native-research'),read=file=>JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),v=read('voice-validation.json'),m=read('build-voice/manifest.json'),s=read('voice-session.json');
    if(v.confirmed!==true||v.voiceBubbleVerified!==true||m.offlineTest!==false||m.voiceExperimental!==true||s.pid!==pid||s.accountDirectory!==accountDirectory||v.dllSha256!==m.dllSha256||s.dllSha256!==m.dllSha256||createHash('sha256').update(fs.readFileSync(s.dllPath)).digest('hex')!==m.dllSha256)return null;
    const c=new WeChatVoiceClient(s),h=await c.health();return h.limit>1?c:null;
  }catch{return null;}
}
export function findVoiceReceipt(rows,{baseline,milliseconds,started}){
  // Conservative: require a new server ID, type34 and matching encoded duration.
  // A submitted request alone must never become a delivered voice claim.
  const matches=rows.filter(m=>{const id=serverMessageId(m.serverId),xml=messageText(m),duration=Number(m.voiceDurationMs??/\bvoicelength=["'](\d+)["']/iu.exec(xml)?.[1]);return (m.isSend===true||m.isSend===1)&&Number(m.localType)===34&&id&&!baseline.serverIds.has(id)&&!baseline.rows.has(rowIdentity(m))&&Number(m.createTime)>=Math.floor(started/1000)-2&&duration===milliseconds;});return matches.length===1?matches[0]:null;
}
