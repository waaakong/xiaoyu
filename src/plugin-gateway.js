import {responseDecision} from './social-rhythm.js';
import {WebSocket} from 'ws';
import {chatParts} from './chat-rhythm.js';
import {imageInfo} from './media.js';
import crypto from 'node:crypto';

export const coreCommands=new Set(['帮助','状态','表情','收藏','学图','新对话','取消','暂停','继续','记忆','记住','忘记','清空记忆','跨聊记忆','跨聊记住','停止共享','全局忘记','本聊隐藏','插件']);
export function validatePluginCommands(list){if(!Array.isArray(list)||list.length>20||list.some(c=>typeof c!=='string'||!/^[-\p{L}\p{N}_]{1,40}$/u.test(c)||coreCommands.has(c))||new Set(list).size!==list.length)throw new Error('插件命令最多20个，不带斜线且不能与小鱼命令重名');return list;}
export function localPluginUrl(value){const u=new URL(value);if(u.protocol!=='ws:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/ws')throw new Error('插件连接仅允许 ws://127.0.0.1:端口/ws');return u.href;}

// Runs trusted AstrBot plugins behind a target-limited OneBot connection. This is
// an action boundary, not a Python process sandbox or per-plugin attribution.
export class PluginGateway {
  constructor({url='ws://127.0.0.1:6199/ws',token,onebot,getAccount,policy,contacts=()=>[],onSent=()=>{},log=()=>{},now=Date.now}){Object.assign(this,{url:localPluginUrl(url),token,onebot,getAccount,policy,contacts,onSent,log,now});this.leases=new Map();this.seen=new Map();this.socket=null;this.timer=null;this.closed=true;this.alive=true;this.lastRequest=null;this.lastResult=null;this.denied=0;}
  state(){return {connected:this.socket?.readyState===WebSocket.OPEN,url:this.url,lastRequest:this.lastRequest,lastResult:this.lastResult,denied:this.denied,activeTargets:[...this.leases.values()].filter(l=>l.until>this.now()).length};}
  start(){if(!this.closed)return;this.closed=false;this.connect();this.timer=setInterval(()=>{if(!this.socket||this.socket.readyState===WebSocket.CLOSED)this.connect();else if(this.socket.readyState===WebSocket.OPEN){if(!this.alive){this.socket.terminate();return;}this.alive=false;this.socket.ping();this.send({time:Math.floor(this.now()/1000),self_id:Number(this.getAccount()||0),post_type:'meta_event',meta_event_type:'heartbeat',status:{online:!!this.getAccount(),good:!!this.onebot?.connected},interval:5000});}},5000);this.timer.unref();}
  refreshIdentity(){if(this.closed)return;if(this.socket&&this.connectedAccount!==String(this.getAccount()||0)){const previous=this.socket;this.cancel();this.socket=null;previous.terminate();}this.connect();}
  connect(){if(this.closed||this.socket&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(this.socket.readyState))return;this.connectedAccount=String(this.getAccount()||0);const socket=new WebSocket(this.url,{headers:{Authorization:'Bearer '+this.token,'X-Self-ID':this.connectedAccount,'X-Client-Role':'Universal','User-Agent':'Xiaoyu-Plugin-Gateway'},maxPayload:8*1024*1024,handshakeTimeout:5000});this.socket=socket;
    socket.on('pong',()=>{if(this.socket===socket)this.alive=true;});
    socket.on('open',()=>{this.alive=true;this.seen.clear();this.send({time:Math.floor(this.now()/1000),self_id:Number(this.getAccount()||0),post_type:'meta_event',meta_event_type:'lifecycle',sub_type:'connect'});this.log('AstrBot插件通道已连接。');});
    socket.on('message',raw=>{let request;try{request=JSON.parse(raw);}catch{return;}this.dispatch(request).then(result=>{if(this.socket===socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(result));}).catch(()=>{});});
    socket.on('error',()=>{});socket.on('close',()=>{if(this.socket===socket){this.cancel();this.log('AstrBot插件通道已断开，插件请求不自动重试。');}});
  }
  send(event){if(this.socket?.readyState!==WebSocket.OPEN)throw new Error('AstrBot插件环境未连接');this.socket.send(JSON.stringify(event));}
  async enhance(r,{signal,model,onSent,prepareSend,assertFresh,bufferReply,timeoutMs=150000}={}){
    if(this.socket?.readyState!==WebSocket.OPEN||!r.policy.enabled||!r.policy.pluginsEnabled||r.policy.pluginMode!=='enhanced')throw new Error('增强插件未连接或尚未授权');
    if(this.leases.get(r.scope)?.until>this.now())throw new Error('此聊天已有插件任务');
    signal?.throwIfAborted();const trace=crypto.randomUUID(),controller=new AbortController();
    return new Promise((resolve,reject)=>{
      const lease={scope:r.scope,account:r.account,user:r.user,kind:r.group?'group':'private',peer:String(r.group??r.user),mode:'enhanced',voiceMode:r.policy.voiceMode,trace,until:this.now()+timeoutMs,sends:0,calls:0,modelBusy:false,model,onSent,prepareSend,assertFresh,bufferReply,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,resolve,reject};
      lease.cleanup=()=>{clearTimeout(lease.timer);signal?.removeEventListener('abort',lease.abort);if(this.leases.get(r.scope)===lease)this.leases.delete(r.scope);};
      lease.fail=message=>{lease.cleanup();controller.abort();const error=new Error(message);error.sends=lease.sends;reject(error);};
      lease.abort=()=>lease.fail('增强请求已取消');lease.timer=setTimeout(()=>lease.fail('增强请求超时，未自动补发'),timeoutMs);signal?.addEventListener('abort',lease.abort,{once:true});
      this.leases.set(r.scope,lease);this.lastRequest={time:new Date(this.now()).toISOString(),scope:r.scope,mode:'enhanced'};
      try{this.lease(lease.kind,lease.peer);const media=r.event.message.filter(s=>['at','image','mface','face','reply'].includes(s.type));this.send({...r.event,message:[{type:'text',data:{text:r.text}},...media],raw_message:r.text,xiaoyu_request_id:trace});}catch{lease.fail('增强事件发送失败');}
    });
  }
  enhancedLease(trace){const lease=[...this.leases.values()].find(l=>l.trace===trace&&l.mode==='enhanced');if(!lease)throw new Error('增强请求不存在或已结束');this.lease(lease.kind,lease.peer);lease.signal?.throwIfAborted();lease.assertFresh?.();return lease;}
  async callModel(trace,payload,{signal}={}){const l=this.enhancedLease(trace),p=this.policy(l.scope);if(l.modelBusy)throw new Error('同一增强请求不允许并行模型调用');if(l.calls>=(p.pluginCallLimit??3))throw new Error('本轮插件模型调用次数已达上限');l.calls++;l.modelBusy=true;try{const result=await l.model(payload,{signal:signal&&l.signal?AbortSignal.any([signal,l.signal]):signal??l.signal});this.enhancedLease(trace);if(payload.purpose==='reply')l.replyModelFailed=false;return result;}catch(e){if(payload.purpose==='reply')l.replyModelFailed=true;throw e;}finally{l.modelBusy=false;}}
  complete(trace,{error}={}){const l=this.enhancedLease(trace);if(l.modelBusy||l.sendBusy)throw new Error('模型或消息仍在处理');l.cleanup();if(error||l.replyModelFailed){const e=new Error('AstrBot增强流程失败');e.sends=l.sends;l.reject(e);}else l.resolve({sent:l.sends,calls:l.calls});return {ok:true};}
  async handle(r){const explicit=r.text.startsWith('/插件'),text=explicit?r.text.replace(/^\/插件\s*/u,'/'):r.text;const m=/^\/([^\s]+)([\s\S]*)$/u.exec(text);if(!explicit&&(!m||!r.policy.pluginCommands?.includes(m[1])))return false;
    const reply=message=>this.onebot.reply(r.event,message);if(!r.policy.pluginsEnabled){await reply('此聊天尚未开启AstrBot插件。');return true;}
    if(r.group&&!r.at&&!r.word){await reply('群插件命令请明确@小鱼或带唤醒词。');return true;}
    if(!m||!r.policy.pluginCommands?.includes(m[1])){await reply('未配置这个插件命令；请在本机聊天设置核对允许的命令。');return true;}
    if(String(r.account)!==String(this.getAccount())||!this.onebot.connected){await reply('QQ账号尚未核验，插件暂不执行。');return true;}
    if(this.socket?.readyState!==WebSocket.OPEN){await reply('AstrBot插件环境未连接，请在本机“插件”页启动。');return true;}
    const previous=this.leases.get(r.scope);if(previous?.until>this.now()){await reply('此聊天的插件请求仍在处理，请稍后再试。');return true;}
    const lease={scope:r.scope,account:r.account,user:r.user,kind:r.group?'group':'private',peer:String(r.group??r.user),command:m[1],until:this.now()+20000,sends:0};this.leases.set(r.scope,lease);
    const media=r.event.message.filter(s=>['at','image','mface','face'].includes(s.type));const event={...r.event,message:[{type:'text',data:{text:'/'+m[1]+m[2]}},...media],raw_message:'/'+m[1]+m[2]};this.lastRequest={time:new Date(this.now()).toISOString(),scope:r.scope,command:m[1]};this.send(event);return true;
  }
  lease(kind,peer){const account=String(this.getAccount()??''),scope=`qq:${account}:${kind}:${peer}`,l=this.leases.get(scope),p=this.policy(scope);if(!l||l.until<=this.now()||String(l.account)!==account||!p.enabled||!p.pluginsEnabled||!(l.mode==='enhanced'?p.pluginMode==='enhanced':p.pluginCommands?.includes(l.command))||!this.onebot.connected)throw new Error('没有当前目标的有效插件请求');l.signal?.throwIfAborted();l.assertFresh?.();return l;}
  async message(segments,l){if(typeof segments==='string')segments=[{type:'text',data:{text:segments}}];if(!Array.isArray(segments)||!segments.length||segments.length>6)throw new Error('仅允许有界文字和base64图片');let chars=0,images=0;const result=[];for(const s of segments){if(!s||!s.data)throw new Error('消息段无效');if(s.type==='text'){const text=String(s.data.text??'');chars+=Array.from(text).length;if(chars>2400)throw new Error('插件文字最多2400字');result.push({type:'text',data:{text}});}else if(s.type==='at'&&String(s.data.qq)===l.user)result.push({type:'at',data:{qq:l.user}});else if(s.type==='image'){const file=s.data.file;if(++images>1||typeof file!=='string'||!/^base64:\/\/[A-Za-z0-9+/]*={0,2}$/.test(file)||file.length>7*1024*1024)throw new Error('仅允许一张5MB以内的base64图片');const bytes=Buffer.from(file.slice(9),'base64');if(!bytes.length||bytes.length>5*1024*1024)throw new Error('图片大小无效');await imageInfo(bytes);result.push({type:'image',data:{file}});}else throw new Error('插件消息段未授权');}return result;}
  async action(action,p={}){if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('参数无效');
    if(action==='get_stranger_info'){const user=String(p.user_id),l=[...this.leases.values()].find(l=>[String(l.user),String(l.account)].includes(user)&&l.until>this.now());if(!l)throw new Error('仅可读取当前请求发言者或角色昵称');this.lease(l.kind,l.peer);const contact=this.contacts().find(c=>String(c.account)===String(l.account)&&String(c.peer)===user&&c.kind==='private');return {user_id:Number(user),nickname:contact?.name??(user===String(l.account)?'小鱼':user),sex:'unknown'};}
    if(['get_login_info','get_version_info','get_status'].includes(action)){if(!this.getAccount()||!this.onebot.connected)throw new Error('QQ尚未连接');return this.onebot.action(action,{});}
    if(action==='get_friend_list'||action==='get_group_list'){const kind=action==='get_friend_list'?'private':'group',account=String(this.getAccount()??'');return this.contacts().filter(c=>c.kind===kind&&c.account===account&&this.policy(c.scope).enabled&&this.policy(c.scope).pluginsEnabled).map(c=>kind==='private'?{user_id:Number(c.peer),nickname:c.name,remark:c.name}:{group_id:Number(c.peer),group_name:c.name});}
    if(action==='get_group_info'||action==='get_group_member_info'){const l=this.lease('group',String(p.group_id));if(action==='get_group_member_info'&&![l.user,l.account].includes(String(p.user_id)))throw new Error('只能读取当前发言者或角色的资料');return this.onebot.action(action,action==='get_group_info'?{group_id:Number(l.peer)}:{group_id:Number(l.peer),user_id:Number(p.user_id)});}
    if(['send_msg','send_private_msg','send_group_msg'].includes(action)){
      const kind=action==='send_group_msg'||action==='send_msg'&&p.message_type==='group'?'group':'private',peer=String(kind==='group'?p.group_id:p.user_id);
      if(!/^\d+$/.test(peer))throw new Error('目标无效');
      const l=this.lease(kind,peer);if(l.replyModelFailed)throw new Error('本轮模型失败，插件内部错误不发送QQ');if(l.sends+(l.bufferedPackets??0)>=3)throw new Error('每个请求最多发送3次');if(l.sendBusy)throw new Error('此请求的消息仍在投递');l.sendBusy=true;
      try{
        const message=await this.message(p.message,l),pure=message.every(s=>s.type==='text'||s.type==='at'),speechText=message.filter(s=>s.type==='text').map(s=>s.data.text).join('');
        if(l.mode==='enhanced'&&pure&&responseDecision(speechText).kind!=='respond')return {suppressed:true,reason:'model-silence'};
        if(l.mode==='enhanced'&&l.bufferReply){if(this.policy(l.scope).voiceMode!==l.voiceMode)throw Error('只语音模式已改变');this.lease(kind,peer);l.bufferedPackets=(l.bufferedPackets??0)+1;l.bufferReply(message);return {buffered:true,delivered:false};}
        const parts=l.mode==='enhanced'&&pure?chatParts(speechText,{maxParts:this.policy(l.scope).maxBubbles??2}):[speechText];
        const split=parts.length>1&&parts.length<=3-l.sends;
        const packets=split?parts.map((text,index)=>[...(index===0?message.filter(s=>s.type==='at'):[]),{type:'text',data:{text}}]):[message];
        let first;
        for(let packet of packets){
          if(this.lease(kind,peer)!==l||l.sends>=3)throw new Error('请求已变化或发送次数超限');l.sends++;
          let directed,mentionId;if(l.prepareSend&&packet.some(x=>x.type==='text')){directed=l.prepareSend(packet.filter(x=>x.type==='text').map(x=>x.data.text).join(''));packet=[{type:'text',data:{text:directed.text}},...packet.filter(x=>x.type!=='text'&&x.type!=='at')];mentionId=await this.onebot.prepareMention?.({message_type:kind,group_id:Number(peer),self_id:l.account},{mention:directed.target,beforeMention:directed.beforeMention,beforeSend:()=>this.lease(kind,peer)});if(directed.quote){directed.assertQuote?.();packet.unshift({type:'reply',data:{id:directed.quote.id}});}if(mentionId)packet.unshift({type:'at',data:{qq:mentionId}},{type:'text',data:{text:' '}});}
          if(this.lease(kind,peer)!==l)throw Error('插件发送租约已变化');const result=await this.onebot.action(kind==='group'?'send_group_msg':'send_private_msg',{[kind==='group'?'group_id':'user_id']:Number(peer),message:packet});if(mentionId){result.mentionId=mentionId;directed.confirmed();}first??=result;
          this.lastResult={time:new Date(this.now()).toISOString(),scope:l.scope,status:'confirmed'};
          try{await (l.onSent??this.onSent)({scope:l.scope,message:packet,receipt:result,signal:l.signal,speechText});}catch{this.log('插件已投递，记录保存失败；不重发。');}
        }
        return first;
      }finally{l.sendBusy=false;}
    }
    throw new Error('该OneBot动作未授权');
  }
  async dispatch(request){const echo=request?.echo;try{const key=JSON.stringify(echo);if(echo==null||!key||key.length>512)throw new Error('需要有效echo');for(const [id,time]of this.seen)if(this.now()-time>180000)this.seen.delete(id);if(this.seen.has(key)||this.seen.size>=2000)throw new Error('重复或过多请求，不重发');this.seen.set(key,this.now());const data=await this.action(request.action,request.params);return {status:'ok',retcode:0,data,echo};}catch(e){this.denied++;this.lastResult={time:new Date(this.now()).toISOString(),status:'rejected-or-unknown'};return {status:'failed',retcode:1403,data:null,message:'插件请求未确认：'+e.message,echo};}}
  cancel(scope){for(const [key,l]of [...this.leases])if(!scope||scope===key){if(l.mode==='enhanced')l.fail('增强请求已撤销');else this.leases.delete(key);}}
  async stop(){this.closed=true;clearInterval(this.timer);this.cancel();const ws=this.socket;this.socket=null;if(ws)ws.terminate();}
}
