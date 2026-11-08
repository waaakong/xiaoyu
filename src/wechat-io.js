import {verifiedVoiceClient,VoiceEncoder,findVoiceReceipt,sameVoiceSession} from './wechat-voice.js';
import {verifiedSocialClient,quoteXml,forwardedXml,socialPacket} from './wechat-social.js';
import {receiptMentions} from './wechat-receipts.js';
import {wechatEvent} from './wechat-events.js';
import {receiptBaseline,findReceipt,findMediaReceipt,serverMessageId,textHash} from './wechat-receipts.js';
import {NativeMediaLease,nativeImageBytes} from './wechat-native-media.js';
import {windowsPowerShell,windowsPowerShellEnv} from './windows-powershell.js';
import {StringDecoder} from 'node:string_decoder';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import {loopback} from './model-engines.js';
import {validId} from './chat-identity.js';
import {chatParts} from './chat-rhythm.js';
import {assertClient,nativeProfile} from './wechat-client.js';
export {inspectWeChat} from './wechat-client.js';
import {inspectWeChat} from './wechat-client.js';
import {usesCurrentNative,WeChatNativeClient} from './wechat-native.js';

async function* cancellableReader(body,signal){
  const reader=body.getReader(),cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{if(signal.aborted)cancel();while(!signal.aborted){const {done,value}=await reader.read();if(done)break;yield value;}}
  finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
}
export class ForegroundProcess {
  constructor(root,{spawnImpl=spawn}={}){this.root=root;this.spawn=spawnImpl;this.tail=Promise.resolve();}
  wait(){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.close();reject(Error('前台操作超时，未自动重发'));},60000);this.pending={resolve:v=>{clearTimeout(t);resolve(v);},reject:e=>{clearTimeout(t);reject(e);}};});}
  async start(){if(this.starting)return this.starting;if(this.child)return;const task=this.open();this.starting=task;try{return await task;}finally{if(this.starting===task)this.starting=null;}}
  async open(){const c=this.spawn(windowsPowerShell(),['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(this.root,'integrations','wechat','foreground-sender.ps1')],{windowsHide:true,env:windowsPowerShellEnv(),stdio:['pipe','pipe','ignore']});this.child=c;const ready=this.wait();this.lines=createInterface({input:c.stdout});this.lines.on('line',line=>{const pending=this.pending;this.pending=null;try{pending?.resolve(JSON.parse(line));}catch{pending?.reject(Error('前台协议异常'));}});c.stdin.on('error',()=>this.close());c.on('error',()=>this.close());c.on('exit',()=>{if(this.child===c)this.close();});if(!(await ready).ready){this.close();throw Error('前台组件未就绪');}}
  send(body,beforeSend){const task=this.tail.then(async()=>{await this.start();await beforeSend();const result=this.wait();this.child.stdin.write(JSON.stringify(body)+'\n');return result;});this.tail=task.catch(()=>{});return task;}
  async probe(executable,name){return this.send({probe:true,executable,name,diagnostics:typeof name==='string'},async()=>{});}
  async focus(executable){return this.send({focus:true,executable},async()=>{});}
  close(){const p=this.pending;this.pending=null;p?.reject(Error('前台操作已停止'));const c=this.child;this.child=null;c?.stdin.end();c?.kill();this.lines?.close();}
}
export class WeChatIO extends EventEmitter {
  constructor({config,policy,root,dir,fetchImpl=fetch,inspect=inspectWeChat,foreground,verifyIdentity,controls}={}){super();Object.assign(this,{config,policy,root,dir,inspect,verifyIdentity,controls});this.fetch=fetchImpl;this.foreground=foreground??new ForegroundProcess(root);this.connected=false;this.inflight=new Set();this.tail=Promise.resolve();}
  async json(base,route,token,{body,signal,timeout=5000,maxBytes=2000000}={}){const r=await this.fetch(loopback(base)+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'}),'X-WeChatAgent-Account':this.accountDirectory??''},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});if(!r.ok)throw Error('微信组件请求失败 '+r.status);const raw=await r.text();if(raw.length>maxBytes)throw Error('微信组件响应过大');const data=JSON.parse(raw);if(data.success===false)throw Error('微信读取未就绪');return data;}
  reader(route,o){const c=this.config();return this.json(c.readerUrl,route,c.readerToken,o);}
  async withControls(action){if(this.liveProof&&this.controls?.enabled?.()){const focus=await this.foreground.focus(this.liveProof.client.executable??this.config().executable);if(!focus.accepted){const e=Error('微信前台窗口无法激活'+(focus.code?'：'+focus.code:''));e.deliveryAttempted=false;throw e;}}const run=async({signal})=>{const stop=()=>this.foreground.close();signal.addEventListener('abort',stop,{once:true});try{signal.throwIfAborted();return await action({signal});}finally{signal.removeEventListener('abort',stop);}};return this.controls&&this.liveProof?this.controls.run(this.liveProof,run):run({signal:new AbortController().signal});}
  async verify({checkControls=true}={}){
    const c=this.config(),client=await this.inspect(c.executable);
    assertClient(client);
    if(c.mode==='hook'&&!nativeProfile(client.version)&&!usesCurrentNative(c,client))throw Error('WECHAT_NATIVE_UNSUPPORTED：当前版本没有经过验证的原生发送器');
    const r=await this.reader('/api/v1/reader/status');
    if(r.backend!=='weflow-cli-nt'||r.ownWxid!==c.account||!r.accountDirectory||r.lastError)throw Error('微信读取账号未就绪或与配置不符');
    this.accountDirectory=r.accountDirectory;
    this.liveProof=null;
    let h;
    if(c.mode==='foreground'&&!nativeProfile(client.version)){
      if(!this.verifyIdentity)throw Error('WECHAT_LIVE_IDENTITY_UNVERIFIED：当前版本的实时账号核验尚未适配，自动回复未启用');
      const live=await this.verifyIdentity({client,reader:r});
      if(live?.account!==c.account||live?.accountDirectory!==r.accountDirectory||live?.version!==client.version)throw Error('WECHAT_LIVE_IDENTITY_MISMATCH：实时账号核验失败');
      this.liveProof={client,identity:live};
      if(checkControls){const probe=await this.withControls(()=>this.foreground.probe(c.executable));if(!probe.accepted)throw Error('WECHAT_FOREGROUND_UNAVAILABLE：当前微信未暴露所需聊天控件');}
    }else if(usesCurrentNative(c,client)){
      this.nativeClient??=new WeChatNativeClient(this.config);
      h=await this.nativeClient.verify({accountDirectory:r.accountDirectory});
    }else{
      h=await this.json(c.hookUrl,'/WeChatAgent/health',c.hookToken);
      if(h.integration!=='WeChatAgent-1'||h.backend!=='wechat-hook'||h.startupState&&h.startupState!=='ready'||h.version!==client.version||!Array.isArray(h.databaseAccounts)||h.databaseAccounts.length!==1||h.databaseAccounts[0].toLowerCase()!==r.accountDirectory.toLowerCase())throw Error('原版接入组件版本或实时账号核验失败');
    }
    this.capabilities=c.mode==='hook'?{nativeMention:!!h.nativeMentionSend,text:true,images:h.nativeProtocol===2&&!!h.capabilities?.images,voice:false,stickers:h.nativeProtocol===2&&!!h.capabilities?.stickers}:{text:true,randomFavorite:false,images:false,voice:false,nativeMention:false};
    const socialBinding=String(h?.pid??'')+':'+r.accountDirectory;if(this.socialBinding!==socialBinding||Date.now()-(this.socialCheckedAt??0)>5000){this.social=this.root&&c.mode==='hook'&&c.nativeAdapter==='xiaoyu-1'?await verifiedSocialClient(path.join(this.root,'data','wechat-social-research'),{pid:h?.pid,accountDirectory:r.accountDirectory}):null;this.socialBinding=socialBinding;this.socialCheckedAt=Date.now();}Object.assign(this.capabilities,{nativeQuote:!!this.social,nativePoke:!!this.social,nativeForward:!!this.social});
    if(this.voiceBinding!==socialBinding||Date.now()-(this.voiceCheckedAt??0)>5000){this.voiceClient=this.root&&c.mode==='hook'&&c.nativeAdapter==='xiaoyu-1'?await verifiedVoiceClient(this.root,{pid:h?.pid,accountDirectory:r.accountDirectory}):null;this.voiceBinding=socialBinding;this.voiceCheckedAt=Date.now();}this.capabilities.voice=!!this.voiceClient;
    this.identityCheckedAt=Date.now();return {account:r.ownWxid,version:client.version,mode:c.mode,capabilities:this.capabilities};
  }
  async contacts(){const r=await this.reader('/api/v1/contacts?limit=500');this.rawContacts=r.contacts??[];return this.rawContacts.filter(c=>validId(String(c.username??''),'wechat')).map(c=>({id:c.username,name:c.displayName??c.remark??c.nickname??c.username,kind:c.username.includes('@chatroom')?'group':'private'}));}
  async prepareReply(event,{signal}={}){signal?.throwIfAborted();const c=this.config(),peer=event.message_type==='group'?String(event.group_id):String(event.user_id),scope=`wechat:${c.account}:${event.message_type}:${peer}`;if(!this.connected||!this.policy(scope).enabled)return;await Promise.all([this.inspect(c.executable),...(c.mode==='foreground'&&this.foreground.start?[this.foreground.start()]:[])]);signal?.throwIfAborted();}
  async start(){await this.verify();this.controller=new AbortController();this.connected=true;this.emit('connection',true);this.streamTask=this.stream(this.controller.signal,{verified:true});}
  async stream(signal,{verified=false}={}){while(!signal.aborted){try{if(!verified)await this.verify({checkControls:false});verified=false;const cutoff=Math.floor(Date.now()/1000),c=this.config();const r=await this.fetch(loopback(c.readerUrl)+'/api/v1/push/messages',{headers:{Authorization:'Bearer '+c.readerToken},signal,redirect:'error'});if(!r.ok||!r.headers.get('content-type')?.includes('text/event-stream'))throw Error('微信读取流不可用');this.connected=true;this.emit('connection',true);let buffer='';const decoder=new StringDecoder('utf8');for await(const bytes of cancellableReader(r.body,signal)){buffer+=decoder.write(Buffer.from(bytes));if(buffer.length>200000)throw Error('微信消息流超限');let end;while((end=buffer.indexOf('\n\n'))>=0){const item=buffer.slice(0,end);buffer=buffer.slice(end+2);for(const line of item.split('\n'))if(line.startsWith('data: ')){let payload;try{payload=JSON.parse(line.slice(6));}catch{continue;}const event=this.event(payload,cutoff);if(event)this.emit('message',event);}}}}catch{this.connected=false;this.emit('connection',false);}if(!signal.aborted)await new Promise(r=>{const t=setTimeout(r,3000);signal.addEventListener('abort',()=>{clearTimeout(t);r();},{once:true});});}}
  event(p,cutoff){const c=this.config();if(p?.event==='message.new'&&!p.isSend&&p.talkerId!==c.account&&validId(String(p.sessionId??''),'wechat')&&validId(String(p.talkerId??''),'wechat')&&Number(p.timestamp)>=cutoff){const scope=`wechat:${c.account}:${String(p.sessionId).endsWith('@chatroom')?'group':'private'}:${p.sessionId}`;if(this.policy(scope).enabled)this.emit('activity',{scope});}return wechatEvent(p,cutoff,{config:this.config(),policy:this.policy,onVoice:(id,record)=>{this.voiceRefs??=new Map();this.voiceRefs.set(id,record);while(this.voiceRefs.size>1000)this.voiceRefs.delete(this.voiceRefs.keys().next().value);}});}
  async action(name,params={},{signal,assertFresh=()=>{}}={}){
    if(name!=='get_record'||!/^[a-f0-9]{64}$/.test(params.file??''))throw Error('微信语音引用无效或协议操作未开放');
    const item=this.voiceRefs?.get(params.file),c=this.config();
    if(!item||item.account!==c.account||!this.connected||!this.policy(item.scope).enabled||!this.policy(item.scope).speechInput)throw Error('微信语音授权已失效');
    const assertCurrent=()=>{const current=this.config(),p=this.policy(item.scope);if(current.account!==item.account||!this.connected||!p.enabled||!p.speechInput||item.scope.includes(':group:')&&p.allowedSenders?.length&&!p.allowedSenders.includes(item.sender))throw Error('微信语音授权已失效');};
    assertFresh();signal?.throwIfAborted();assertCurrent();await this.verify({checkControls:false});assertCurrent();signal?.throwIfAborted();assertFresh();
    const result=await this.reader('/api/v1/voices/'+params.file+'?conversationKey='+encodeURIComponent(item.conversationKey)+'&pluginId=speech-recognition&format=wav',{signal,timeout:30000,maxBytes:14*1024*1024});
    signal?.throwIfAborted();assertFresh();assertCurrent();if(result.id!==params.file||result.conversationKey!==item.conversationKey||result.mime!=='audio/wav'||typeof result.b64!=='string'||result.b64.length>Math.ceil(10*1024*1024/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.b64))throw Error('微信语音数据或会话核验失败');
    return {base64:result.b64,mime:result.mime};
  }

  async readImage(id,{signal}={}){if(!/^[a-f0-9]{64}$/.test(id))throw Error('微信图片ID无效');const r=await this.reader('/api/v1/images/'+id,{signal,timeout:20000,maxBytes:9*1024*1024});if(typeof r.b64!=='string')throw Error('微信图片尚未解析');const bytes=Buffer.from(r.b64,'base64');if(bytes.length>6*1024*1024)throw Error('微信图片过大');return bytes;}
  async messages(peer){return (await this.reader('/api/v1/messages?talker='+encodeURIComponent(peer)+'&limit=100')).messages??[];}
  async target(event){
    const peer=event.message_type==='group'?String(event.group_id):String(event.user_id),c=this.config(),scope=`wechat:${c.account}:${event.message_type}:${peer}`;
    if(!validId(peer,'wechat')||!this.connected||!this.policy(scope).enabled||peer.endsWith('@chatroom')!==(event.message_type==='group'))throw Error('微信聊天未授权或已离线');
    const records=(await this.reader('/api/v1/contacts?keyword='+encodeURIComponent(peer)+'&limit=500')).contacts??[];
    const matches=records.filter(r=>r.username===peer&&!r.ambiguous);
    if(matches.length!==1)throw Error('微信目标缺失或身份不明确，未发送');
    const record=matches[0],name=record.displayName??record.remark??record.nickname??peer;
    if(c.mode==='hook'&&c.nativeAdapter==='xiaoyu-1')return {peer,scope,target:{id:peer,name,kind:event.message_type}};
    const names=(await this.reader('/api/v1/contacts?keyword='+encodeURIComponent(name)+'&limit=500')).contacts??[];
    if(names.length>=500||names.filter(r=>(r.displayName??r.remark??r.nickname??r.username)===name).length!==1)throw Error('微信目标同名或无法完整核验，未发送');
    return {peer,scope,target:{id:peer,name,kind:event.message_type}};
  }
  async prepareMention(event,{mention,beforeMention,beforeSend}={}){
    const c=this.config();if(!this.capabilities?.nativeMention||c.mode!=='hook'||c.nativeAdapter!=='xiaoyu-1'||event.message_type!=='group'||!mention||mention.id===c.account||!validId(String(mention.id),'wechat')||mention.id==='all'||typeof mention.name!=='string'||/[\x00-\x1f\u2005]/u.test(mention.name))return null;
    const rows=await this.messages(String(event.group_id));if(!rows.some(m=>!m.isSend&&m.senderUsername===mention.id&&Number(m.createTime)*1000>Date.now()-600000))return null;beforeSend?.();if(beforeMention&&!beforeMention())return null;return mention;
  }
  async socialOriginal(peer,reference){
    const canonical=serverMessageId(reference?.serverId??reference?.id);if(!canonical)throw Object.assign(Error('没有可核验的微信原文编号'),{deliveryAttempted:false});
    const rows=(await this.messages(peer)).filter(m=>serverMessageId(m.serverId)===canonical);if(rows.length!==1)throw Object.assign(Error('引用或转发原文不在当前聊天可核验窗口内'),{deliveryAttempted:false});const row=rows[0],originalType=Number(row.localType??row.type),kind=[3,47].includes(originalType)?originalType:1,text=kind===1?row.text??row.content:row.fullText??row.content??row.text;
    if(typeof text!=='string'||!text||text.length>6000)throw Object.assign(Error('原文内容不可用或过大'),{deliveryAttempted:false});
    return {sender:row.isSend?this.config().account:row.senderUsername,name:row.senderDisplayName??row.senderDisplay??row.senderName??(row.isSend?this.config().account:row.senderUsername),serverId:canonical,text,kind,time:row.createTime,originalType};
  }
  socialAction(event,action,{beforeSend=()=>{}}={}){
    const task=this.tail.then(async()=>{beforeSend();await this.verify({checkControls:false});const {peer}=await this.target(event);if(!this.social)throw Object.assign(Error('当前微信原生社交组件尚未验证'),{deliveryAttempted:false});return action(peer,this.social);});this.tail=task.catch(()=>{});return task;
  }
  async poke(event,member,{beforeSend=()=>{}}={}){return this.socialAction(event,async(peer,client)=>{
    if(!validId(String(member),'wechat')||member===this.config().account||event.message_type==='private'&&member!==peer)throw Object.assign(Error('微信拍一拍目标无效'),{deliveryAttempted:false});
    if(event.message_type==='group'&&!(await this.messages(peer)).some(m=>!m.isSend&&m.senderUsername===member&&Number(m.createTime)*1000>Date.now()-600000))throw Object.assign(Error('无法核验当前群成员，先让对方在群里发言'),{deliveryAttempted:false});
    return client.submit(socialPacket({kind:3,peer,target:member,requestId:randomUUID()}),{beforeSend});
  },{beforeSend});}
  async forward(event,rows,{beforeSend=()=>{}}={}){return this.socialAction(event,async(peer,client)=>{
    if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Object.assign(Error('转发消息选择无效'),{deliveryAttempted:false});const messages=[];
    for(const row of rows){const resolved=this.resolveSocialSource?.(row);if(!resolved||!resolved.peer||!serverMessageId(resolved.serverId))throw Object.assign(Error('转发原文来源无法核验'),{deliveryAttempted:false});const message=await this.socialOriginal(resolved.peer,{serverId:resolved.serverId});if(message.originalType!==1)throw Object.assign(Error('当前独立组件仅验证文字合并记录，此媒体类型未验证'),{deliveryAttempted:false});messages.push(message);}
    return client.submit(socialPacket({kind:2,peer,payload:forwardedXml({messages}),requestId:randomUUID()}),{beforeSend});
  },{beforeSend});}
  reply(event,body,{beforeSend,natural=false,maxParts=3,mention,beforeMention,quote}={}){if(quote&&!this.capabilities?.nativeQuote){const error=Error('当前微信组件未核验原生引用发送，未提交');error.deliveryAttempted=false;return Promise.reject(error);}const task=this.tail.then(async()=>{const out=[];for(const part of natural?chatParts(body,{maxParts}):[body]){let text=part;const startedAt=Date.now(),timing={};let phase=Date.now();beforeSend?.();await this.verify({checkControls:false});timing.preflightMs=Date.now()-phase;phase=Date.now();const {peer,target}=await this.target(event),c=this.config(),mode=c.mode,start=Date.now();timing.targetMs=Date.now()-phase;const member=out.length===0&&!quote?await this.prepareMention(event,{mention,beforeMention,beforeSend}):null;if(member)text='@'+member.name+'\u2005'+text;phase=Date.now();const baseline=receiptBaseline(await this.messages(peer));timing.baselineMs=Date.now()-phase;const id=randomUUID(),file=path.join(this.dir,'delivery-'+id+'.json');const audit={id,peer,account:c.account,mode,at:start,bodyHash:textHash(text),baseline:{serverIds:[...baseline.serverIds],rows:[...baseline.rows]}};fs.writeFileSync(file,JSON.stringify({...audit,state:'dispatching'}),{mode:0o600});try{beforeSend?.();phase=Date.now();let socialReceipt=null;if(quote&&out.length===0){if(!this.social)throw Object.assign(Error('原生引用能力已撤回'),{deliveryAttempted:false});const source=await this.socialOriginal(peer,quote);beforeSend?.();socialReceipt=await this.social.submit(socialPacket({kind:1,peer,payload:quoteXml({peer,text,source}),requestId:id}),{beforeSend});}else if(mode==='foreground'){const leasePid=this.liveProof?.identity.clientPid;const result=await this.withControls(({signal})=>this.foreground.send({executable:c.executable,name:target.name,text},async()=>{signal.throwIfAborted();beforeSend?.();const guardStarted=Date.now();const current=await this.target(event);if(this.config().mode!==mode||current.target.name!==target.name)throw Error('微信目标或模式已经改变');await this.verify({checkControls:false});if(leasePid!==this.liveProof?.identity.clientPid)throw Error('微信进程在发送前已改变');signal.throwIfAborted();timing.sendGuardMs=Date.now()-guardStarted;}));if(Number.isFinite(result.durationMs))timing.foregroundMs=result.durationMs;if(!result.accepted){const error=Error('前台发送未确认'+(/^FOREGROUND_[A-Z_]+$/.test(result.code??'')?'：'+result.code:''));if(result.attempted===false)error.deliveryAttempted=false;throw error;}}else if(c.nativeAdapter==='xiaoyu-1'){if(member)await this.nativeClient.sendMention(peer,text,member.id,id);else await this.nativeClient.send(peer,text,id);}else{const result=await this.json(c.hookUrl,'/SendTextMsg',c.hookToken,{body:{wxidorgid:peer,msg:text}});if(result.ret!==0)throw Error('Hook拒绝发送');}
        timing.controlAndSubmitMs=Date.now()-phase;phase=Date.now();let receipt=socialReceipt;const receiptDeadline=Date.now()+12000;while(!receipt&&Date.now()<receiptDeadline){const rows=await this.messages(peer);const match=findReceipt(rows,{baseline,text,started:start});if(match&&(!member||receiptMentions(match).includes(member.id))){receipt={message_id:serverMessageId(match.serverId),receipt:'wechat-server-id',transport:mode,...(member?{mentionId:member.id}:{})};break;}await new Promise(r=>setTimeout(r,Date.now()-phase<1000?80:300));}if(!receipt)throw Error('微信投递结果未知，未自动重试');timing.receiptMs=Date.now()-phase;timing.totalMs=Date.now()-startedAt;receipt.timing=timing;fs.writeFileSync(file,JSON.stringify({...audit,state:'confirmed',receipt,finishedAt:Date.now()}),{mode:0o600});out.push(receipt);}catch(e){fs.writeFileSync(file,JSON.stringify({...audit,state:e.deliveryAttempted===false?'not-submitted':'unknown',code:String(e.message??'').match(/FOREGROUND_[A-Z_]+/)?.[0]??null,finishedAt:Date.now()}),{mode:0o600});throw e;}}
      return out;});this.tail=task.catch(()=>{});return task;}
  sendMedia(event,input,{kind='image',beforeSend=()=>{}}={}){
    const task=this.tail.then(async()=>{
      beforeSend();await this.verify({checkControls:false});const c=this.config(),{peer,scope}=await this.target(event);
      if(!['image','sticker'].includes(kind)||c.mode!=='hook'||c.nativeAdapter!=='xiaoyu-1'||!this.capabilities[kind==='image'?'images':'stickers'])throw Error('当前微信通道未开放此媒体类型');
      if(!Buffer.isBuffer(input)||!input.length||input.length>5*1024*1024)throw Error('微信媒体大小无效');
      const bytes=await nativeImageBytes(input,kind);
      const md5=createHash('md5').update(bytes).digest('hex'),name=kind==='sticker'?'xiaoyu-sticker.gif':'xiaoyu-image.png';
      this.mediaLeases??=new NativeMediaLease(path.join(this.root,'data','wechat-native-research','outgoing'));
      const lease=await this.mediaLeases.prepare({bytes,kind,name,account:c.account,scope,assertFresh:beforeSend});
      const baseline=receiptBaseline(await this.messages(peer)),started=Date.now(),auditFile=path.join(this.dir,'delivery-'+lease.id+'.json');
      const audit={id:lease.id,peer,account:c.account,kind,sha256:lease.sha256,md5,at:started};
      fs.writeFileSync(auditFile,JSON.stringify({...audit,state:'dispatching'}),{mode:0o600});
      try{
        beforeSend();const current=await this.target(event);if(this.config().account!==c.account||this.config().mode!==c.mode||current.scope!==scope)throw Error('微信发送上下文已改变');
        await this.verify({checkControls:false});beforeSend();const body=lease.consume({account:c.account,scope});const submitted=await this.nativeClient.call('/media',body);if(submitted.state!=='submitted')throw Error('微信媒体提交结果未知');
        while(Date.now()-started<18000){beforeSend();const match=findMediaReceipt(await this.messages(peer),{baseline,kind,md5,started});if(match){const receipt={message_id:serverMessageId(match.serverId),receipt:'wechat-media-server-id',kind,timing:{totalMs:Date.now()-started}};fs.writeFileSync(auditFile,JSON.stringify({...audit,state:'confirmed',receipt}),{mode:0o600});lease.dispose();return receipt;}await new Promise(r=>setTimeout(r,200));}
        throw Error('微信媒体投递结果未知，未自动重试');
      }catch(error){fs.writeFileSync(auditFile,JSON.stringify({...audit,state:'unknown'}),{mode:0o600});throw error;}
    });this.tail=task.catch(()=>{});return task;
  }
  image(event,bytes,options){return this.sendMedia(event,bytes,{...options,kind:'image'});}
  sticker(event,bytes,options){return this.sendMedia(event,bytes,{...options,kind:'sticker'});}
  record(event,file,{beforeSend=()=>{}}={}){
    const task=this.tail.then(async()=>{
      beforeSend();await this.verify({checkControls:false});if(!this.capabilities.voice||!this.voiceClient)throw Object.assign(Error('微信原生语音通道尚未验收'),{deliveryAttempted:false});
      const {peer,scope}=await this.target(event),c=this.config(),client=this.voiceClient;
      const fresh=()=>{beforeSend();const current=this.config();if(!this.connected||current.account!==c.account||current.mode!=='hook'||!this.policy(scope).enabled||this.policy(scope).voiceMode==='off'||!sameVoiceSession(this.voiceClient,client))throw Error('微信语音发送授权已改变');};
      fresh();const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1500000)throw Error('语音文件过大');this.voiceEncoder??=new VoiceEncoder(this.root);const lease=await this.voiceEncoder.prepare(fs.readFileSync(file),{account:c.account,scope,beforeSend:fresh});
      const started=Date.now(),baseline=receiptBaseline(await this.messages(peer)),auditFile=path.join(this.dir,'delivery-'+lease.id+'.json'),audit={id:lease.id,peer,account:c.account,kind:'voice',sha256:lease.sha256,milliseconds:lease.milliseconds,at:started};
      let attempted=false;
      try{await this.verify({checkControls:false});fresh();fs.writeFileSync(auditFile,JSON.stringify({...audit,state:'dispatching'}),{mode:0o600});const packet=lease.consume({account:c.account,scope});attempted=true;await client.submit(packet,{beforeSend:fresh});
        while(Date.now()-started<18000){fresh();const match=findVoiceReceipt(await this.messages(peer),{baseline,milliseconds:lease.milliseconds,started});if(match){const receipt={message_id:serverMessageId(match.serverId),receipt:'wechat-voice-server-id',kind:'voice',milliseconds:lease.milliseconds,timing:{totalMs:Date.now()-started}};fs.writeFileSync(auditFile,JSON.stringify({...audit,state:'confirmed',receipt}),{mode:0o600});lease.dispose();return receipt;}await new Promise(r=>setTimeout(r,200));}throw Error('微信语音投递未知，不自动重试');
      }catch(error){fs.writeFileSync(auditFile,JSON.stringify({...audit,state:attempted?'unknown':'not-submitted'}),{mode:0o600});if(!attempted)lease.dispose();throw error;}
    });this.tail=task.catch(()=>{});return task;
  }
  async stop(){this.controller?.abort();this.connected=false;this.voiceRefs?.clear();this.foreground.close();await this.streamTask?.catch(()=>{});await this.tail.catch(()=>{});}
}
